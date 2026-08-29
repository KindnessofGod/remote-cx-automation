# Approval routing — who approves, and where they actually do it

> **The question this answers**, asked while looking at a UC-04 decision of
> `ready_for_approval` on the request portal, whose own copy says *"a named
> human still has to approve it"*:
>
> > **"Who will approve them and where will they work on them from? What UI,
> > Zendesk or our own Remote UI?"**
>
> The page states that approval is required and names neither the person nor
> the screen. That is a real hole, and it is bigger than missing copy: for two
> of the nine use cases the screen does not exist, and for four of them nothing
> anywhere checks that the person clicking approve is entitled to the role they
> are claiming.

This document is **analysis, not a change**. Nothing in `src/`, `zaf-app/` or
`workflows/` was modified to produce it. §4 is the change proposal, sized and
sequenced, for a separate reviewed unit of work.

---

## 0. How this was established

Everything in §1 comes from the policy modules, not from the specs — the specs
are quoted only where they disagree with the code, and those disagreements are
named. Everything in §2 was **run**, on this branch, on 2026-08-19, in the
posture a reviewer with a fresh clone gets (no `.env`, in-memory stores, mock
Zendesk, rule-based classifier):

```
node src/portal/cli.js --seeded      # :4042
node src/uc04/cli.js   --seeded      # :4052
```

Three observations decide most of what follows.

**Observation 1 — the portal does raise a ticket, and links the record to it.**

```
POST :4042/api/requests/uc04   (admin persona, US→PT, schengen_short_stay, engineering)
 -> decision  ready_for_approval / all_gates_passed
    recordId  70a1462a-a481-4cc7-953a-3eca2dc48286
    ticketId  2000            ticketCreated  true
    tags      portal_request, uc04, uc04_specialist_approval, queue_mobility_specialists
```

**So the first half of `CLAUDE.md` §8 item 2 is STALE.** It still reads *"the
portal creates no Zendesk ticket … nothing joins those two halves yet"*. The
join was built: `src/portal/ticketing.js` decides which decisions qualify,
`raiseTicketIfNeeded()` in `src/portal/server.js` raises the ticket after the
gates and after the record is durable, `store.linkTicket()` repoints the
record's `external_ref` at the ticket id, and `recordTicketRelink()` audits the
substitution so the requester's own reference still resolves. Confirmed on the
record afterwards: `GET :4042/api/my-requests?persona=admin` returns that
request with `externalRef: "2000"`.

**Observation 2 — and the specialist still cannot reach it.**

```
GET :4052/api/authorizations/by-ticket/2000   ->  404  {"found":false}
GET :4042/api/authorizations/by-ticket/2000   ->  404  {"code":"no_such_route"}
```

The ticket id is not the missing link; **the store is**. `npm run portal` owns
its own seven stores in its own process (`src/portal/server.js`'s header states
this plainly), and `npm run uc04-api` seeds a different one. The ZAF sidebar
reads `uc04ApiBaseUrl`, so it reads the second store and the record is in the
first. The two halves are joined only by the `uc04_authorizations` **table** —
i.e. only when `SUPABASE_DB_URL` is attached to both processes. On the Vercel
deployment that is true by construction (one function, one pool, `/portal` and
`/uc01…/uc09` mounted side by side — `deploy/cx-apis/router.js`). On a laptop
it is false, and the failure is silent: a correct, durably-recorded, correctly
ticketed decision that the sidebar reports as `{"found": false}`.

**Observation 3 — the seeded path does work, and it works for anyone.**

```
GET  :4052/api/authorizations/by-ticket/4001
     -> actionable: true, actionableReason: "Awaiting specialist approval."
POST :4052/api/authorizations/bdff829a-.../approve
     -H 'X-ZAF-Approver: mobility.specialist@remote.test'
     -> 200 executed — "Approval recorded; work authorization issued."
```

`actionable` is answered server-side and the sidebar only renders it. That part
is sound. What is not checked anywhere is whether
`mobility.specialist@remote.test` is a mobility specialist. See §1.3.

---

## 1. Who approves

### 1.1 From the code

Read out of `src/review/reviewPolicy.js`, `src/uc02/reviewPolicy.js`,
`src/uc04/approvalPolicy.js`, `src/uc05/signoffPolicy.js`,
`src/uc06/dualApprovalPolicy.js`, `src/uc09/multiApprovalPolicy.js`, and the
receiving-team table in `src/shared/escalationRouting.js`.

| UC | Tier | Approval model in code | Role slots the code names | Verbs | Receiving team (`escalationRouting.js`) |
|---|---|---|---|---|---|
| **UC-01** Employment verification | 🟢 | single reviewer on the exception path | *(none — one unnamed approver)* | `approve` / `decline` | HR Ops |
| **UC-02** Expense & receipt | 🟢 | single reviewer on the exception path | *(none)* | `approve` / `decline` / `hold` — three, the only three-button panel; `decline` requires a note (Remote's mandatory `reason`) | Finance Ops |
| **UC-03** Travel letter / router | 🟢 | **none — no approval route exists** | — | — | Travel & Mobility Support |
| **UC-04** Work authorization | 🟡 | **single** approver, one slot, fill once | *(none — "mobility specialist" appears only in prose)* | `approve` / `decline` (`deny` accepted, normalised) | Mobility Specialists; **Mobility & Legal (Tier-2)** on escalate |
| **UC-05** Resignation notice | 🟡 | **single** sign-off, one slot | *(none)* | `signoff` / `decline` | HR Ops |

> **Decided 2026-08-21, not yet built — what the signature *means* changes, not who gives it.** Today HR Ops confirms one statutory figure. After `[N-5]` they are asked *"Remote says N days, the statute says M — which governs?"*, with both figures and both provenances on the screen. And after `[N-15]` the signature **releases the figures to the employee**, where today it moves a database column and reaches nobody. `qa/contracts/UC-05-acceptance.md` §18.

| **UC-06** Contract amendment | 🟡 | **dual**, two named slots, two different people — ⚠️ **and either may be the requester** | `customer_admin`, `payroll_specialist` | `approve` / `decline` | Payroll Ops |

> **UC-06's row understates one thing and it is the whole control (DRIFT-098,
> 2026-08-21).** *"Two different people"* is enforced — `isSameApprover()` refuses
> one identity in both slots. **What is not enforced is that either of them is
> someone other than the person who filed the request.** `requester` is captured
> and persisted in its own column and compared to nothing, so the admin who typed
> the new salary can sign the `customer_admin` slot confirming they typed it. UC-01
> holds this rule (`self_approval`); UC-09 holds it in its strongest form
> (requester ≠ approver ≠ payment_releaser). **UC-06 is the only one of the three
> that exempts itself**, in a comment in `src/uc06/dualApprovalPolicy.js:13–29`
> rather than in `docs/adr/0005-…`, which says *"two independent people."*
>
> **Decided 2026-08-21:** slot 1 becomes the **employer's signature** — Remote's
> own `awaiting_employer_signature` — and the requester is refused by name with
> `requester_cannot_approve`. `[A-1]` `[A-2]` `[A-3]`. **Not yet built.** And note
> the vocabulary: *"customer admin"* is **employer-side** ("customer" = Remote's
> customer), so this table's split was always cross-organisational; what it lacked
> was independence within the employer side.
>
> **Separately: nothing UC-06 produces reaches the Payroll Ops column above.**
> Neither `src/uc06/` nor `src/remoteui/` references the routing table, so every
> UC-06 ticket in the account carries no `queue_payroll_ops` tag and no group.
> DRIFT-062, `[A-30]`.
| **UC-07** Global mobility | 🔴 | **none, structurally** — unchanged by the 2026-08-21 decisions | — | — | Mobility Legal (Tier-3) · reached on the Zendesk path only until `R-23` lands |
| **UC-08** Cross-border tax | 🔴 | **none, structurally** | — | — | Tax Operations |
| **UC-09** Off-cycle payroll | 🔴-framed, has execution | **floor of 2**, up to 3, all distinct people | `requester`, `approver`, `payment_releaser` | `approve` / `deny` | Payroll Ops |

The floor is real and is not weakened anywhere: `multiApprovalPolicy.js:150`
reads `Math.max(2, adjustmentRow.approvalSlotsRequired)`, so no risk score can
drop it below two. `src/shared/approverIdentity.js` decides "is this the same
human" for both UC-06 and UC-09 with NFKC + whitespace + case + confusable
folding, so `"Bob Smith"`, `"bob smith"` and a Cyrillic-`о` variant are one
person. Both controls stand as built and nothing below proposes touching them.

### 1.2 Where code and spec disagree

Three, and only the third matters operationally.

1. **UC-09's role vocabulary.** `UC-09.md` §1 names the primary actors as
   *"Customer Admin + Remote Payroll specialist"*; §5 then names the control as
   *"requester ≠ approver ≠ payment releaser"*. The code implements §5's three
   generic slots. The two are describable as the same thing (an admin is the
   requester, a payroll specialist is the approver), but the sidebar renders the
   §5 words — a payroll specialist sees a block labelled **"Approver"**, not
   **"Payroll Specialist"**, which is the one place a business role would tell
   them the block is theirs. Cosmetic; worth aligning when the panel is next
   touched.

   > **Not cosmetic underneath, found 2026-08-21.** Reconciling the two
   > vocabularies exposes what the "describable as the same thing" reading hides:
   > **if an admin is the requester, the requester slot's control is on a surface
   > that admin cannot reach.** The UC-09 panel renders all three role blocks in
   > the ZAF sidebar — a Zendesk **agent** surface — and the only other place the
   > approve route is offered is `cli.js`. `src/portal/server.js:46` states the
   > portal *"offers no approve/decline anywhere"*. So of UC-09's three roles, two
   > are Remote-internal specialists with a working surface and the third is a
   > customer with none.
   >
   > Decided 2026-08-21: `[P-3]` gives that role its own **confirmation and
   > attestation** screen on the portal, which already authenticates that persona
   > — and it must never grow an approve control for `approver` or
   > `payment_releaser`. `qa/contracts/UC-09-acceptance.md` §11, §18.
2. **UC-02's approver.** `UC-02.md` §1 names *"Finance Ops on exceptions"*; the
   code names no role at all, only an approver identity. Same class of gap as §1.3.
3. **UC-03.** `UC-03.md` §15 already carries the honest note: *"OPEN —
   `human_review` has no sign-off surface anywhere."* Code and spec agree that
   the gap exists. This document does not re-open it; it records it in §2 as a
   dead end because the portal and the sidebar both route a UC-03
   `human_review` somewhere a human can see it and nowhere a human can act.

### 1.3 The finding: **role is a claim, not an authenticated signal**

This is the substantive answer to "who approves", and it is uncomfortable.

- `src/uc06/server.js:150` and `src/uc09/server.js:150` both build the policy
  call as `{ role: body.role, approver: identity.approver }`. The **approver**
  comes from the verified identity. The **role comes out of the request body**.
- `resolveApprover()` (`src/shared/approverAuth.js:104`) returns
  `verdict.identity` from the signed token — and the token carries no role.
  `src/review/zafAuth.js` extracts one identity claim and nothing else, and its
  own header is explicit that under HS256 *"the claims are OURS, supplied by
  `zaf-app/assets/main.js`"*, so a valid signature proves the call came through
  a real installed instance of the app in an account holding the secret, **not
  which agent clicked and certainly not what they are entitled to do**.
- UC-04, UC-05 and UC-02 have no role concept at all: `evaluateApprovalAction()`
  requires only that `approver` be a non-empty string.

So today:

- Any identity that can reach `POST /uc04/api/authorizations/:id/approve` can
  issue a work authorization. Nothing checks it is a mobility specialist.
- On UC-06 and UC-09 the four-eyes control holds — two *different* people are
  genuinely required, canonicalised — but nothing requires either of them to be
  **entitled** to the slot they filled. Two support agents can clear a payroll
  amendment as `customer_admin` + `payroll_specialist`.

> **Two updates to the bullet above, 2026-08-21. The first closes it; the second
> reopens it one level down, and that one is worse.**
>
> **Entitlement now exists.** `src/review/approverEntitlement.js` and
> `APPROVER_ROLES` landed after this section was written, are wired into
> UC-04/05/06/09, and are provisioned on the deployment. Consulted last,
> refuse-only, additive. The paragraph above describes the state before it.
>
> **But on UC-09 the four-eyes control does *not* hold in the form every document
> claims.** *"Two different people"* is enforced across the three approval
> **slots**; it is **not** enforced against `adjustment_row.requester`, the column
> recording who filed the request. So the admin who asked for a payment may sign
> the box approving it, with a genuinely different second person signing the other
> slot — two distinct signatures, one of them belonging to the beneficiary of the
> request. `00-FOUNDATION.md` §5, ADR 0005 and `UC-09.md` §8 all promise
> otherwise, and **the requester block on the sidebar prints the promise to the
> approver at the moment they sign**: *"the requester can never also be the
> approver."*
>
> Decided 2026-08-21, reading (A): the filer may fill the `requester` slot and
> **no other**; the floor of two distinct signatures is unchanged. DRIFT-050,
> `[P-1]` — and `[P-2]` corrects ADR 0005, which currently asserts UC-09 already
> holds this *"in its strongest form"* (DRIFT-110). **The document correction is
> queued ahead of the code change**, because a gap plus a written assurance that
> there is no gap is worse than the gap.
>
> Entitlement narrows the exposure and does not remove it: the filer would need
> `uc09:approver` as well as admin rights, and an admin who is also a payroll
> approver is an ordinary configuration, not an exotic one.

This is prime directive #3 (*"identity comes from an authenticated signal, never
a claim"*) correctly applied to the **requester** and not yet applied to the
**approver's role**. It is an addition, never a relaxation: see §4 Unit 4.

---

## 2. Where they do it, today, actually

Three intake paths reach these use cases. For each pair, this is what a
specialist can reach **today**, marked honestly.

Legend: ✅ works · ⚠️ works only under a stated condition · ❌ dead end · — not
applicable (no such intake for this use case) · 🚫 correct by design, no control
should exist.

| UC | Intake: **Zendesk ticket** (n8n graph) | Intake: **request portal** (`:4042`, `/portal`) | Intake: **Remote UI stand-in** (`:4041`) | Approval screen |
|---|---|---|---|---|
| **UC-01** | ✅ trigger → n8n → `cases`/`review_queue`; sidebar reads `apiBaseUrl` (`:4020`) | — (no UC-01 form) | — | ZAF sidebar, UC-01 panel |
| **UC-02** | ✅ graph writes `uc02_expenses` under the ticket id | ⚠️ ticket raised + record relinked; sidebar finds it **only with Supabase attached to both processes** | — | ZAF sidebar, UC-02 panel (approve/decline/hold) |
| **UC-03** | ❌ **no approval route exists** — `src/uc03/server.js` has no POST, by design | ❌ same; ticket raised (`uc03_formal_letter_review`) and it leads to a read-only panel | — | **none.** The drafted letter reaches no customer |
| **UC-04** | ✅ | ⚠️ same condition as UC-02 — **this is the case the question was asked about** | — | ZAF sidebar, UC-04 panel |
| **UC-05** | ✅ | ⚠️ same condition | — | ZAF sidebar, UC-05 panel |
| **UC-06** | ✅ graph `WORKFLOW_UC06_ID` creates the amendment under the ticket id | — (no UC-06 form on the portal) | ⚠️ raises a pre-tagged ticket after the real gates; **local only — `src/remoteui/` is not mounted on the deployment** | ZAF sidebar, UC-06 panel, two role blocks |
| **UC-07** | 🚫 dossier compiled, escalated to Mobility Legal (Tier-3) | ❌ **no ticket is raised at all** (see below) — **DECIDED 2026-08-21:** raise it **without linking it**, so the ticket carries the dossier id and the record never carries the ticket id. The store keeps one write method and zero mutations; the "Unit 5 (🔴 hand-off, shape (b))" design pass this document asked for is `qa/contracts/UC-07-acceptance.md` §17's DRIFT-073 disposition (`R-23`) · **not yet built** | — | 🚫 none, and none should exist — **unchanged.** The aftermath added by `R-24` records an **outcome** (`dossier_read` / `proceeding_offline` / `not_proceeding` / `more_information_needed`), **not an approval**, and it lives on the **ticket**, never on the dossier record |
| **UC-08** | 🚫 dossier compiled, escalated to Tax Operations | ❌ **no ticket is raised at all** | — | 🚫 none, and none should exist |
| **UC-09** | ✅ | ⚠️ same condition; every UC-09 decision is ticketed (`NO_TICKET_DECISIONS.uc09 = []`) | — | ZAF sidebar, UC-09 panel, 2–3 role blocks |

### The five conditions and dead ends, spelled out

**⚠️ The portal→sidebar join needs a shared durable store.** Proven in §0
Observation 2. On the deployment it holds; on a laptop it does not, and the
symptom is `{"found": false}` on a decision that is correct, ticketed and
audited. Nothing on either surface says which posture you are in — the portal
prints `Persistence: in-memory` at startup, the sidebar prints "no case for this
ticket". A reviewer following `docs/E2E-TEST-PLAN.md` on a laptop meets this and
has no way to tell it from a bug.

**❌ UC-03 is the one genuine unclosable-today dead end.** `human_review` drafts a
formal travel letter, stores it as a document, queues it — and no route can
issue it. The portal raises a `uc03_formal_letter_review` ticket that leads to a
panel showing the case read-only. Worth noting **where that read-only verdict is
decided**: `loadUc03` in `zaf-app/assets/main.js:1693` sets
`actionable: false` **in the browser**, the only one of the nine loaders that
does (UC-07 and UC-08 set theirs server-side in their own `server.js`). It fails
closed — there is no route to call even if it said `true` — but it is the one
place actionability is not the server's answer, and the repo's own rule is that
the server decides.

**❌ UC-07/UC-08 on the portal path reach no queue.** ⚠️ **DECIDED 2026-08-21 —
this is being fixed, and the fix keeps the store guarantee untouched.** Both use
cases join `TICKETABLE_TYPES`, and **the ticket id travels one way, record →
ticket**: nothing is written back onto the dossier record, so `dossierStore` keeps
its one write method and zero mutations and the structural test passes unchanged.
Raising a ticket and *linking* a ticket are separable, and conflating them is the
one step too wide that made this paragraph's conclusion wider than its premise.
The change is UC-08's `T-13` and UC-07's `R-24` prerequisite — **the same change;
build it once** — and it unblocks three separately-taken decisions: the specialist
outcome, the requester notice, and UC-08's only tier-legal success metric.
`qa/SPEC-DRIFT-INDEX.md` DRIFT-109. **Not yet built.** The original analysis
follows and is still the reason the store layer must not be touched:

This is correct at the
store layer and wrong at the hand-off layer, and the two must not be conflated.
`src/portal/ticketing.js` excludes both from `TICKETABLE_TYPES` because linking a
ticket means writing the ticket id back onto the record, and their stores have
**one write method and zero mutation methods** — the structural guarantee the 🔴
tier is argued from. That reasoning is right and must not be undone. But its
consequence is that a portal-submitted relocation or tax dossier is compiled,
audited, and then sits in `uc07_dossiers` / `uc08_dossiers` with **nothing in
anybody's queue**: no ticket, no group, no view. The specialist named in
`escalationRouting.js` — Mobility Legal (Tier-3), Tax Operations — is never told.
The answer to "where does this get approved" for 🔴 is *"nowhere, and correctly
nowhere"*; the answer to "where does the specialist **read** it" is currently
*"they have to know to look"*, which is not a hand-off. §4 Unit 5.

**⚠️ Every hand-off is tagged; assignment is a separate thing, fixed forward and
not backward.**

> **UPDATE 2026-08-20, measured rather than assumed.** Both missing groups were
> created — `Local HR & Legal` `9990000000002`, `Mobility Specialists`
> `9990000000003` — and `npm run sync-groups` regenerated the map. `GET
> /api/v2/groups` now returns ten: the nine teams this table routes to, plus the
> account default `Support`. **Every future hand-off can be assigned.**
>
> **Nothing already raised moved.** The approval queue was re-run against the
> same 60 production records and the same live tickets, once with the group map
> as it stood before provisioning and once after: 43 waiting, **36 stuck in both
> runs**, 7 reachable in both. Three items changed category (`queue_owner_absent`
> → `queued_elsewhere`) and none changed reachability. Fifteen open tickets carry
> a routing tag and sit in the default group, ticket **#51** among them — the very
> ticket the observation below names. Provisioning a group is necessary and it is
> not remediation; the two are separate units of work and only the first has been
> done. `docs/APPROVAL-QUEUE.md` §0a has the full before/after.

The observation this row was written from, live in §0 Observation 1:

> *"Raised Zendesk ticket #2000, tagged … but it is UNASSIGNED. The Zendesk group
> `"Mobility Specialists"` does not exist in this account."*

`handoffFor()` puts the right `queue_*` tag on every ticket and the right
`escalation_*` tag on escalations only, and looks the group up rather than
creating it. Until `scripts/setup-zendesk-groups.mjs` has run, every hand-off
lands correctly labelled in nobody's queue. `src/shared/escalationGroupIds.js`
exists as the synced-id fallback and needs `npm run sync-groups`.

> **CORRECTION (2026-08-20) — the `groups:read` blocker recorded above is
> false.** The read was diagnosed as scope-refused, and that diagnosis is what
> `src/shared/escalationGroupIds.js`'s header, `src/review/approverEntitlement.js`
> and the paragraph above are all built on. The audit behind
> `docs/ESCALATION-DESTINATIONS.md` read the live `your-subdomain` account and
> **`GET /api/v2/groups` answered `200`**, listing eight groups; seven of the
> eight routing teams have one, and the two absentees (`Mobility Specialists`,
> `Local HR & Legal`) are missing because nobody created them, not because the
> read was refused. **RE-VERIFIED FIRST-HAND 2026-08-20** (this container does
> hold the OAuth pair after all): `GET /api/v2/groups` returns `200` with ten
> groups — the nine `escalationRouting.js` names, each matching the id in
> `src/shared/escalationGroupIds.js`, plus the account default `Support`. The
> `groups:read` blocker is confirmed false against the live account, not merely
> reported false.
>
> **What follows from it, and what does not.** The synced-id fallback is *not*
> made pointless: an id is a fact about one account and a cache of it can go
> stale, which is why every caller reads the account first and falls back only
> when nothing authoritative came back (`src/shared/groupAssignment.js`). What
> does change is the *cause* a reader should chase when a hand-off lands
> unassigned: it is a group that was never created, not a token that cannot see
> it. That is the same shape as CLAUDE.md §6's proxy-403 and §7's
> `invalid role for this endpoint` — an error whose own words name the wrong
> layer, filed as a permissions problem and left blocking work it was never
> blocking. `src/review/approverEntitlement.js` and
> `src/shared/escalationGroupIds.js` still carry the old reasoning in their
> headers and are owned by other work in flight; correcting them is a
> follow-up.

**⚠️ The installed ZAF bundle is a static upload.** `zaf-app/README.md` records
"Remote CX Review v1.01", app id `9990001`, installed and enabled. An installed
ZAF app does not track this repo — `assets/` reaches the account only via
`zcli apps:update`. The nine-panel `main.js` and the nine `ucNNApiBaseUrl`
parameters are in the repo; **whether the live install has them, and whether the
eight optional URLs are filled in, is not knowable from a coding session** (this
container's egress to `*.zendesk.com` is blocked). If `uc04ApiBaseUrl` is blank
in the install, UC-04 has no sidebar in production no matter what `main.js`
contains. Verify against the account, not against this table.

---

## 3. The recommendation

**Zendesk/ZAF stays the single approval surface. Do not build a new one, and do
not turn the Remote UI stand-in into one.** Four reasons, all from this
project's own constraints.

**1. The decision is already made and written down.** `00-FOUNDATION.md` §2:
*"Every use case that needs a human ends up on the same ZAF review surface either
way; only the first touch differs (raw ticket vs. webhook-then-authored-ticket)."*
That sentence is the architecture, and the portal's ticketing already implements
it — gates first, then a pre-tagged ticket, then the sidebar. Building a second
approval surface re-opens a settled decision to solve a problem (§2's ⚠️ and ❌)
that is not caused by the surface.

**2. The objection is real but is about access, not about the surface.** A
mobility specialist, a payroll specialist and a payment releaser plausibly do not
live in Zendesk. But "does not live in Zendesk" is solved *inside* Zendesk, and
the machinery is already emitted: one group per business role (the exact names in
`escalationRouting.js`), one view per `queue_*` tag, light agents for people who
only ever approve. A payroll specialist needs one bookmarked view, not a second
product. Building a second product to avoid provisioning six groups is the
expensive answer to the cheap problem.

**3. The named requirement is Zendesk *and its application framework*.** The role
this portfolio is for names ZAF explicitly; the app is installed and enabled. The
strongest artifact is one sidebar that nine use cases register a panel into,
which is what `zaf-app/assets/panels.js` already is. A second surface splits that
artifact in half and halves the claim.

**4. A new surface would have to answer `actionable` again, and that is the bug
this repo has already fixed twice.** `main.js` renders and the server decides;
`view.actionable` is one server-side answer and it is the single question gating
a control. Any new surface must call the same `GET .../by-ticket/:externalRef`
and read the same `actionable` — at which point it is a second skin over the same
API, and the only thing it adds over a Zendesk view is a login page. If a second
surface is ever built, **that constraint is non-negotiable**: it may render
`actionable`, never re-derive it, and it may not host its own copy of any
approval policy.

**What the Remote UI stand-in is, and what it must not become.** It stands in for
**intake** — the trigger source `00-FOUNDATION.md` §2 describes, the customer
admin acting inside Remote's own product. Its routes are `POST /api/submit`,
`POST /api/consent` and a read; it has **no approve or decline route**, and
`src/remoteui/roles.js` deliberately refuses an admin's attempt to consent
because *"their control point is the sidebar's dual approval"*. Putting the
approval control into the product the requester uses is where four-eyes is
weakest — the requester and the approver would share a surface, a session model
and a mental model. Leave it as intake.

**So the answer to the owner's question, in one sentence each:**

> **Who?** The team in `src/shared/escalationRouting.js` for that use case —
> Mobility Specialists for UC-04, Payroll Ops for UC-06/09, Finance Ops for
> UC-02, HR Ops for UC-01/05, and Tier-2/Tier-3 legal or Tax Operations on
> escalation. Today any authenticated caller can act as any of them; §4 Unit 4
> closes that.
>
> **Where?** The Remote CX Review sidebar inside Zendesk, on the ticket the
> portal raised — ticket #2000 in the run above. Not the portal, which is
> read-only by design, and not the Remote UI stand-in, which is intake only.

---

## 4. The smallest change that closes the gap

Five units. 1–3 are cheap and close most of the visible hole; 4 is the real
control; 5 needs a design pass. Nothing here weakens `view.actionable`, any
approval floor, or the 🔴 no-execution guarantee.

### Unit 1 — Say where, with a link (S, ~half a day)

**The gap.** The portal's result panel says *"the gate lives where it already
lives — the ZAF sidebar and this use case's own approval endpoint"* — true, and
it names neither. Meanwhile the server already returns everything needed:
`humanControl` (*"One named mobility specialist approves or denies in the ZAF
sidebar"*), `ticketId`, `ticketAssignment.intendedGroup`, and — on "My requests"
— `status.awaitingRole: "Mobility specialist"` and a `detail` sentence. **The
facts are on the wire and the result panel does not print them.**

**The change.** In `src/portal/`: when `ticketCreated`, the hand-off envelope
gains a server-composed `ticketUrl` (built from the configured Zendesk subdomain,
never composed in the browser — that page composes no sentences of its own) and
an `awaitingRole`, and the result panel renders one line: *"Zendesk ticket #2000
— Mobility Specialists — a mobility specialist decides this in the Remote CX
Review sidebar"*, hyperlinked.

**When Zendesk is unconfigured — which the portal must keep working through.**
`ticketUrl` is `null` and the existing sentence already covers it honestly
(*"no Zendesk client is configured for this portal. The decision and its audit
row are recorded either way"*). Add to it the offline pointer that does exist:
the record id, and the by-ticket URL on that use case's own API. Never a link
that 404s.

~40 lines, one file plus its asset. **Owned by another agent right now**
(`src/portal/**`).

### Unit 2 — Create the Zendesk groups (S, not code) — ✅ DONE 2026-08-20

*(Was "…and grant the read scope". There is no scope to grant — see the
correction in §2: `GET /api/v2/groups` answers `200` on the live account. The
two missing groups were missing because nobody had created them.)*

`scripts/setup-zendesk-groups.mjs` created `Local HR & Legal` and `Mobility
Specialists`; `npm run sync-groups` regenerated `escalationGroupIds.js` and
`workflows/nodes/assignRouting.js`. All nine routed teams now resolve.

**And it split into two units the moment it landed, which is the useful part.**
Verifying it by re-submitting a portal request tests the *next* hand-off, and the
next hand-off was never the problem for the work already in flight. Re-measured
the same day: 36 items stuck before, 36 stuck after, three of them merely
reclassified. **Unit 2b — re-assign the 15 open tickets sitting in the default
group with a routing tag** (#19, #21–#27, #29–#33, #38, #51) is a separate,
outward act on a live account and is deliberately not folded in here. Counting
them is read-only; moving them is not.

### Unit 3 — Verify and complete the ZAF install (S–M, not code)

`zcli apps:update` the current bundle, then read the installation's settings back
from `GET /api/v2/apps/installations.json` and confirm all nine
`ucNNApiBaseUrl` values point at `https://remote-cx-apis.vercel.app/ucNN`, and
`signWrites` is ticked with `cxSharedSecret` matching `ZAF_SHARED_SECRET`. Verify
against the account, not against a checklist — this repo has already told a user
to their face that an installed app was not installed.

### Unit 4 — Role entitlement, server-side and additive (M, the real control)

**The gap** is §1.3: `role` arrives in the body, the token carries no role, and
UC-02/04/05 have no role concept at all.

**The shape.** One shared module, `src/shared/approverRoles.js`, exporting a pure
`isEntitled(approver, role)` over an explicit allow-list (env-configured, or a
small table, in the same optional-dependency style as `audit.js`). It is
**injected into** the four approval policies, consulted **after** every existing
refusal, and it may only ever **refuse** — it can never grant an approval, fill a
slot, or lower `Math.max(2, …)`. UC-02/04/05 gain a nominal role
(`finance_ops`, `mobility_specialist`, `hr_ops`) so the same predicate covers all
four.

**The default, and why it keys off the same thing everything else does.**
Required whenever `requireSignedIdentity` is true — i.e. `readPosture()`'s
existing OR: a durable store is attached **or** the deployment is publicly
reachable. A seeded in-memory run stays open so a fresh clone still works. Same
rule, one place; a second, weaker rule would be the first to fall behind.

**How it must be tested.** A refusal test alone proves nothing here — this repo's
most expensive recurring defect is that "structurally cannot succeed" and
"appropriately cautious" look identical from outside. Every case needs its
**positive** twin: *an entitled specialist MUST be able to approve*. Without it,
a typo in the allow-list produces a use case that refuses everything and passes
every test.

### Unit 5 — The 🔴 hand-off, without giving either store a mutation method (M, design pass)

**The constraint is absolute:** `uc07_dossiers` and `uc08_dossiers` keep one
write method and zero mutations, and neither API grows a POST route. So the
dossier must not be linked to a ticket; **the ticket must be linked to the
dossier.**

Two candidate shapes, both needing review before either is built:

- **(a) Cheap, no code.** Unit 1's copy is the fix: for a 🔴 submission the result
  panel names the receiving team from `escalationRouting.js` and links the
  dossier's own read-only URL and the audit viewer entry. No ticket, no queue —
  honest, and it says out loud that a specialist has to be told out of band.
- **(b) Correct, needs design.** Raise a ticket for 🔴 too, carrying the dossier
  id and the portal's reference in a Zendesk custom field (the account already
  has the pattern — the employment-id field), tagged and assigned to
  `queue_mobility_legal_t3` / `queue_tax_operations`. The dossier is never
  touched. The cost is that the sidebar's UC-07/UC-08 loaders would look the
  dossier up by that field rather than by ticket id, which changes the loader
  contract for two of nine panels.

**Recommendation: ship (a) inside Unit 1 now, and put (b) through a design pass.**
(b) is the right end state — a 🔴 dossier that reaches no queue is a hand-off
that did not happen — but it changes a shared contract and must not be rushed
into the same unit as a copy fix.

### Sequence

```
Unit 2  (groups exist)         ─┐
Unit 3  (install verified)     ─┼─ do these first; they are configuration,
Unit 1  (say where + link)     ─┘  and they make the next two observable

Unit 4  (role entitlement)        the real control; positive tests mandatory
Unit 5  (🔴 hand-off, shape (b))  design pass first
```

### Explicitly out of scope

- Any new approval surface. §3.
- Any change to `Math.max(2, …)`, `isSameApprover()`, or
  `evaluateAmendmentActionability()` / `evaluateAdjustmentActionability()`.
- Any write method, mutation method or POST route on UC-07 or UC-08.
- Any client-side derivation of `actionable`. (`loadUc03`'s hard-coded `false`
  should move server-side when `src/uc03/server.js` is next touched, but it
  fails closed today and is not urgent.)

---

## 5. Corrections this analysis owes other documents

Not applied here — flagged for their owners.

0. **`src/shared/escalationGroupIds.js`'s header and
   `src/review/approverEntitlement.js`** both reason from *"`GET /api/v2/groups`
   403s — the client holds the least privilege its ticket path needs"*. The live
   account answers that read `200` (§2's correction). Their *conclusions* survive
   — a resolved id is still a cache, and a deliberate sync is still better than
   widening every running service's token — but the stated cause is wrong, and a
   wrong cause is what sends the next reader to fix a scope that was never
   broken. Both files are owned by other work in flight.

1. **`CLAUDE.md` §8 item 2** is stale in its first half. The portal *does* create
   a pre-tagged Zendesk ticket and relink the record (§0 Observation 1). The
   surviving gap is different and narrower: the portal and the nine APIs share a
   record **only through Postgres**, so the sidebar cannot find a portal
   submission on any run without `SUPABASE_DB_URL` attached to both.
2. **`docs/E2E-TEST-PLAN.md`** has an unstated dependency across its phases.
   Phase 2 submits through the portal (`localhost:4042`, or the deployment) and
   Phase 3 through the Remote UI stand-in (`localhost:4041`, local only); Phase 5
   then opens the sidebar **inside the live Zendesk account** and, at step 6,
   says *"Open a UC-06 amendment"*. Those two halves meet only if every process
   in the chain shares one `SUPABASE_DB_URL` — and Phase 3's surface is not
   deployed at all, so a tester on a laptop cannot get there. The plan should
   say so where it asks for the chain, because the failure surfaces as
   `{"found": false}` in the sidebar, which reads as a bug in the sidebar rather
   than as a posture mismatch.

---

## 6. The hand-off now says where to act, what the verbs are, and what you cannot do here

Added 2026-08-20, closing §4 Unit 1's copy half and
`docs/ESCALATION-DESTINATIONS.md` §7 item 3.

### 6.1 The gap, and why it survived so long

Read the last comment on ticket **#51** — a real UC-04 hand-off — and it is a
good note. Decision, deciding gate, risk level, trip length, and two explicit
statements of what was **not** established. What it never says is **where a
person goes to decide, which buttons they will find there, and what that screen
will not let them do.** The same is true of all nine.

Every one of those facts already existed, correct, in
`src/approvalqueue/approvalRoutes.js` — `surface`, `endpoint`, `roles`,
`slotsRequired`, `control` — and was read by exactly one internal dashboard
(`npm run queue-ui`) that no receiving specialist opens. The data reached the
people who built the system and never the people who have to act on it.

### 6.2 `src/approvalqueue/handoffDirections.js`

One function turns a row into three sentences:

```js
import { handoffDirections } from "../approvalqueue/handoffDirections.js";

handoffDirections({ useCase: "UC-04", actionable, actionableReason });
//  -> { where, options, limits, lines, text, html, control, open, endpoint, verbs }
```

Four properties it is built around, each pinned by
`test/handoffDirections.test.js` (21 tests):

1. **One source, not nine.** Nothing is written per use case — a test asserts
   the module's own code (comments and string literals stripped) contains no
   `UC-0N` at all. `surface`/`endpoint`/`roles`/`slotsRequired`/`verbs` come off
   the row; the receiving team comes off `src/shared/escalationRouting.js`. Nine
   copies of a sentence is how the routing table came to contradict itself
   (`docs/ESCALATION-DESTINATIONS.md` §2), and a note builder is exactly where a
   tenth copy gets written.
2. **It reads a verdict; it never forms one.** `{actionable, actionableReason}`
   is the server's answer and is echoed verbatim. The same source scan asserts
   the module never touches `status`, `decision`, `approver`, `escalated` or a
   store's status vocabulary. An **omitted** verdict is not a refusal: the note
   then says the panel is the authority and that this note did not re-check,
   which is true.
3. **It composes a fragment, never a Zendesk comment object.** `public: false`
   stays the caller's, where the caller's own test can see it. A test asserts no
   `public`, `html_body`, `createTicket` or `updateTicket` appears in the code —
   `CLAUDE.md` §4 records what the other shape cost, when a hand-written comment
   payload posted a rendered document straight to a customer on a run that
   reported success everywhere.
4. **`verbs` moved onto the row, because it was the one fact a hand-off needed
   that lived only inside each policy module.** Three rows are not the
   approve/decline pair a note builder would have assumed: **UC-02** also holds,
   **UC-03 and UC-05 sign off**, **UC-09 denies**. Each token is cited on its row
   to the `ACTIONS` set it was read from. A note offering the wrong word sends a
   specialist hunting for a button that is not on their screen.

### 6.3 The four states, as a receiver reads them

**🟡 a surface that is open to you** — `UC-04`, `actionable: true`:

> **Where to act.** Zendesk — the Remote CX Review sidebar, UC-04 panel. Open
> this ticket in Zendesk and the panel is on it; the decision is recorded by
> POST /uc04/api/authorizations/:id/:action.
> **Your options.** Approve or decline — those words and no others, because they
> are the tokens the endpoint accepts. The named slot is Mobility specialist; one
> person fills it, once.
> **What you cannot do here.** Record it anywhere else — no other panel, queue or
> endpoint in this system decides UC-04. Also true of this one: One mobility
> specialist approves or declines, once. […] The API has already confirmed this
> case is open to a decision.

**🟡 a surface that exists but is not open to you** — `UC-06`,
`actionable: false`:

> **Where to act.** Zendesk — the Remote CX Review sidebar, UC-06 panel (two role
> blocks). […] the decision is recorded by POST /uc06/api/amendments/:id/:action.
> **Your options.** None on this case right now. The panel is there and its
> controls are closed for this record.
> **What you cannot do here.** Record a decision on it. The reason recorded with
> that verdict: "This amendment is past its payroll cutoff." The verdict was made
> server-side and is not this note's opinion: the endpoint will refuse the
> decision, not merely hide the button.

The surface is still **named** and the verbs are **withheld**, on purpose.
Naming nothing would read like the no-surface case below; listing the buttons
would send somebody to press one and be refused, which is how a correct refusal
gets read as a broken screen.

**🔴 `none_by_design`** — `UC-07`:

> **Where to act.** Nowhere in this system, and that is the design. This is a
> high-risk (🔴) dossier: it was compiled for Mobility Legal (Tier-3) to act on
> in their own process, and it is on this ticket so that it reaches them.
> **Your options.** There is no approve verb and no decline verb — not missing,
> not permitted. […]
> **What you cannot do here.** Approve, execute or dispose of this from the
> sidebar, the approval queue, or any endpoint. This use case's server has no
> POST route at all and a test asserts it never gains one, so there is nothing to
> look for and nothing to request. Read the dossier, decide outside this system,
> and record what you did where your team records it.

**`none_missing`** — the opposite fact, in words:

> **Where to act.** Nowhere yet, and that is a gap rather than a rule. Travel &
> Mobility Support owns this ticket and this system currently gives them no
> screen to record a decision on.
> **Your options.** None, and none exist to be found anywhere else. […]
> **What you cannot do here.** Complete this request from any surface this system
> provides. This is NOT the deliberate refusal that protects a high-risk path:
> something is supposed to be able to sign this off and nothing can. Until that
> surface exists, say so on the ticket rather than closing it — a closed ticket
> would record a decision nobody made.

Two tests pin the pair apart in prose, not only in a code: `none_by_design`'s
text may never contain "gap", and `none_missing`'s may never contain "that is
the design".

**No use case is in `none_missing` today.** UC-03 left it on 2026-08-20 when its
sign-off surface was built. That is why `directionsForRoute()` — which takes the
row rather than looking it up — is exported alongside `handoffDirections()`: a
renderer reachable only through a use-case id would have silently stopped
covering that branch the same morning, and an untested branch is one refactor
away from reading like its opposite.

### 6.4 Adopted where, and the two one-line changes still owed

Adopted this pass (`src/approvalqueue/**`, this work's own territory):

- `buildQueue()` puts `directions` on every item, wiring the verdict **in one
  direction only**. `false` is passed for an escalation, because that judgement
  is already published by `awaiting.js` in its own header — *"nobody approves an
  escalation; the sidebar deliberately gives one no buttons"* — and reading a
  verdict this module family already makes is not forming a second one. `true`
  is **never** passed: a stored status that reads as awaiting can still be
  refused by the approval API for a reason no status column carries, and only
  that API may promise a specialist a control. So the worst this can do is
  withhold a verb list from somebody who had one; it can never offer a verb to
  somebody who does not. Pinned by a test over every seeded item.
- `GET /api/meta` returns `directions` on each of the nine routes, so a reviewer
  can read exactly what a specialist will be told.
- The page renders the three sentences verbatim, with the only local decision
  being a left-border colour so the two absences never look alike at a glance.

**Still owed, and both are one line plus an import.** Neither file was touched
here; both are owned by other work in flight.

1. **`src/portal/server.js` — `buildTicketNote()`.** Insert one element into the
   existing `parts` array, immediately after the `handOff` line:

   ```js
   import { handoffDirectionsHtml } from "../approvalqueue/handoffDirections.js";
   // …inside buildTicketNote()'s parts array:
   handoffDirectionsHtml({ useCase: type.useCase }),
   ```

   The comment object around it is unchanged, so `public: false` stays exactly
   where `test/portalTicketNote.test.js` already asserts it.

   **Optionally, and in one direction only**, `buildTicketNote()` already holds
   `assignment.escalated` — `handoffFor()`'s own verdict, from the same shared
   routing table — and may pass `{ actionable: false, actionableReason: … }`
   when it is true, which withholds the verb list from a hand-off that has no
   approval control while still naming the surface. It must never pass `true`:
   at ticket-creation time nothing has asked the approval API whether the case
   is open, and omitting the flag produces the honest *"the panel is the
   authority, this note has not re-checked"* clause instead of a promise.

2. **`workflows/nodes/assignRouting.js` — the n8n `routingNote`.** An n8n Code
   node cannot import, so this is the "gates exist twice" shape the repo already
   manages for `gates.js` and `assignRouting.js` itself: port the module body and
   pin it with a parity test that runs the real function in a `node:vm` sandbox
   and asserts identical text for all nine use cases in all four states. Until
   that lands, the n8n path's notes carry the owning team and not the surface.

