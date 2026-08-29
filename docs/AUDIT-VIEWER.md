# The Execution & Audit Trail Viewer (`npm run audit-ui`, `/audit`)

The system records every decision durably; until this viewer existed, nothing
could *show* those records. This page is the read side of the four
observability tables — a live feed of decisions as they land, a drill-down
from any decision to every LLM/API attempt underneath it, a bug-audit lookup
by **any id a request carries**, and the ops-alerts ledger.

It is **read-only by construction**: `src/auditview/server.js` has no POST
route at all — not one that refuses, an absence of one, the same structural
discipline as UC-08's API — asserted behaviourally (any write-shaped request
404s as `no_such_route`) and structurally (the source, stripped of comments,
never mentions a write method) by `test/auditview.test.js`. A viewer that
could amend the audit trail would undo the one property (append-only) that
makes the trail evidence.

## What each table contributes

| Table | Written by | What the viewer shows from it |
|---|---|---|
| `audit_log` | The Node path (`src/shared/audit.js`) **and** all nine n8n graphs | The live feed: one row per record — when, **kind** (decision, execution, or follow-up event), use case, action, actor, risk tier, employment id, external ref, **group** (the record id its sibling rows share), **attempt count**, flags, source and reason. The drill-down shows the full `details` as a label/value table. |
| `audit_trace` | `AuditLogger.logTraceStep()` and the n8n trace nodes | The attempts under one decision (`parent_id` → `audit_log.id`): call name, attempt number, ok/failed, duration when the details carry one. The **duplicate-call banner** renders `findRedundantCalls()`'s verdict (the metrics layer's own detector, `src/metrics/compute.js`, issue #33) — attempt numbers forming one clean `1..n` sequence are the retry wrapper's bookkeeping; anything else is a genuine duplicate. The verdict is computed server-side; the page renders it and re-derives nothing. |
| `workflow_claims` | Both execution paths' exactly-once claim (`src/shared/workflowClaims.js`, the n8n claim nodes) | The bug-audit tab: was this ref claimed, when, and by which use case (one ref can legitimately be claimed by two — UC-03 routes on to UC-04). More than one `audit_log` row under one (use case, ref) pair is flagged as a **duplicate delivery** — the pre-ledger failure signature (ticket #5's two rows 30µs apart). |
| `ops_alerts` | The `RCX OPS · Error Alerts` n8n workflow | The alerts tab. The row IS the alert (the Telegram push is a convenience). **`audit_durable` is shown prominently** because it answers the only question that matters at 3am: did this failure lose a decision, or only lose a Zendesk update? |

Column shapes were verified against the live Supabase schema (project
`your-project-ref`) and against the writers themselves — nothing is
invented, and `test/auditview.test.js` pins the query column names.

## Running it locally

```bash
npm run audit-ui                 # http://localhost:4044
npm run audit-ui -- --port 4099
npm run audit-ui -- --seeded     # force demo data even with Supabase configured
```

Three modes, told apart honestly (the page banners which one it is in):

- **`supabase`** — `SUPABASE_DB_URL` is set: every read is a live query.
- **`seeded`** — unconfigured (or `--seeded`): a labelled demo dataset
  (`src/auditview/demoSeed.js`), so a fresh clone shows the whole UI with zero
  credentials. Each demo story is a defect this project actually hit: a clean
  retry sequence, a genuine duplicate call, ticket #5's double delivery, one
  ops alert in each direction of `audit_durable`, and **one portal expense
  submission writing three rows in a single millisecond** — which seeds the
  decision-vs-event labels, the trace verdict's sibling and no-traceable-call
  branches, and the `(at, id)` page-edge tiebreak all at once.
- **`unavailable`** — deployed with no pool: every read answers
  `503 no_durable_store` rather than demo rows, because fabricated rows on a
  public URL would be indistinguishable from live history.

**Reads throw.** The store (`src/auditview/readStore.js`) never swallows a DB
error into an empty list — the §9 rule for anything feeding a dashboard. The
server catches the throw only to *show* it: a `500 audit_read_failed` whose
body the page renders as an error banner. A feed that showed nothing over an
outage would read as "nothing happened".

## The live feed

Newest first, polling every 4 seconds while the **Live** toggle is on. Filters
(use case, decision, free-text over actor/ref/reason) apply server-side;
changing one returns to the newest page. Clicking a row opens the drill-down.

### Paging, and why it is keyset on `(at, id)`

The feed pages **backward through history** with a cursor, 25/50/100 rows at a
time, "Newer / Older", and a line saying which page you are on and what window
it covers.

`at` **is not unique.** One portal expense submission writes three `audit_log`
rows in the same second and routinely inside the same millisecond; ticket #5's
duplicate delivery produced two rows 30µs apart. A cursor of `at` alone
therefore either **skips** a row (`at <`) or **repeats** one (`at <=`), and
which you get depends on where the page edge happens to land — the same class
of defect the repo keyed `workflow_claims` on a composite to avoid. So the
cursor is the composite `(at, id)`: a total order in which `id` decides only
when `at` cannot. OFFSET was never a candidate on top of that, because rows
arrive at the head while a reader pages, so page 3 by offset re-shows page 2.

The server issues the cursor already encoded (`<iso at>~<uuid id>`) and the
page only keeps a **stack** of the cursors it has walked — "Older" pushes,
"Newer" pops. The browser never assembles a cursor, so `(at, id)` has one
encoding in the system rather than two that can disagree. A malformed cursor is
a `400 bad_cursor`, never a silent fall back to page 1: "your cursor was
nonsense, here is page 1" is indistinguishable from paging having broken.
`hasMore` comes from fetching one row beyond the page, so a page that happens
to be exactly full is not reported as having more after it.

### Paging vs. live tail

They are in genuine tension — polling prepends rows while a reader is looking
at a fixed window — and the resolution is explicit rather than raced:

- The tail runs **only on the newest page**.
- Paging away pauses it, the toggle reads **"Paused (paging)"**, and a line
  under the pager says so in words.
- Returning to the newest page resumes it, without the reader re-clicking the
  toggle: their preference and whether the tail is *currently* running are two
  different pieces of state.
- A poll that lands after the reader has paged away discards its rows rather
  than injecting them into the history page.

The tail cursor is composite too (`since` + `since_id`), for the same reason
the page cursor is: a row sharing the newest millisecond would otherwise never
arrive, or arrive twice.

## Decision, execution, follow-up event

**One submission is usually several `audit_log` rows.** A UC-02 expense writes
the `auto_approve` decision, then `expense_auto_approved`, then
`expense_approved_write` — and only the first has `audit_trace` attempts under
it, because attempts hang off a decision's `parent_id`, never off what came
after it. Presented as peers, a reader cannot tell which row IS the decision,
clicks a follow-up, and gets an empty Attempts table that reads like a defect.
That is exactly what happened the first time someone used this viewer.

Two things fix it, both derived server-side from data actually present:

1. **Kind**, one of three. `readStore.js` holds two vocabularies, each derived
   by reading the writers rather than by pattern-matching the action string:
   - **`DECISION_ACTIONS`** — the actions that ARE a request's answer. Mostly
     the words the nine policy engines return as a `decision`, plus
     `duplicate_request_ignored` (see below) and the **fourteen human-verdict
     actions** (see *A person's decision* below).
   - **`EXECUTION_ACTIONS`** — the six actions recording a **real outward
     act**: `expense_approved_write` (UC-02's automated path),
     `expense_released_write` / `expense_declined_write` (UC-02's **human**
     review path), `workation_executed` (UC-04), `amendment_executed` (UC-06)
     and `adjustment_executed` (UC-09). Each is appended *after* its `remote.*`
     call resolved and carries that response in `details.remoteResult`. That
     property is the test — it is why `expense_auto_approved` (written durably
     *before* the PATCH, so an intent) and `resignation_signed_off` (UC-05 has
     no confirmed Remote write endpoint at all) are **not** on the list,
     despite reading like completions. It is also why there is no
     `expense_held_write`: a hold returns before any Remote call.

     The last two are never spelled out in the source — UC-02 builds them as
     ``action: `expense_${status}_write` `` — so grepping for the literal
     string finds nothing. The test derives them from the writer's own
     `statusForAction()` rather than restating them, which is what will make
     the `release` → `approve` rename land as a named failure rather than a
     silent under-claim.
   - Everything else is a **follow-up event**.

   The suffix is a hint, never the rule: `amendment_execution_blocked` and
   `adjustment_execution_not_claimed` both contain "execution" and both mean
   the opposite. UC-01 contributes nothing here — its Zendesk reply is never
   audited as a row of its own.

   **`duplicate_request_ignored` is a decision, and the reasoning is worth
   keeping.** Live, 2026-08-18/19, one expense was submitted twice two hours
   apart and wrote four rows under one `storeId`: `auto_approve`,
   `expense_auto_approved`, `expense_approved_write` — then, two hours later,
   `duplicate_request_ignored`. That last row is not a fourth thing that
   happened to the first submission; it is *everything* that happened to the
   second. UC-02's duplicate gate writes it and returns immediately, so no
   other row for that request exists anywhere. Classified as an event it would
   assert that a row recorded at 00:40 followed a decision made at 22:31 in the
   same submission — false in both halves. In substance it is a verdict on a
   request, the same shape as `blocked`: refusing to act on a claim already
   decided. That the gate lives in `workflow.js` rather than `policyEngine.js`
   says where the code sits, not what the row means. It did not get a kind of
   its own because the Kind column answers "which row is this request's
   answer?", and a fourth badge would split that answer while helping no one.

   **It is the only refusal-to-reprocess visible in this feed.** The
   delivery-level ledger (`claimExternalRef`) writes no `audit_log` row at all
   — every `if (!claim.claimed)` branch across UC-01…UC-09 returns silently,
   and the n8n graphs' `Duplicate Delivery — Stop` NoOp writes nothing. A
   redelivered webhook leaves a `workflow_claims` row and nothing here, findable
   through the bug-audit view's claims panel. Both facts are pinned by tests.

   **The unknown action falls to `event`, deliberately.** Under-claiming makes
   a real write read as a dull follow-up and costs a reader one click.
   Over-claiming tells a reader money moved when it did not, and that is the
   error somebody acts on.
2. **Correlation.** `CORRELATION_FIELDS` is the **record** id each use case
   writes into `details` on its decision row and on every row that follows it
   (`caseId` UC-01/03 and the sidebar's review rows, `storeId` UC-02,
   `authorizationId` UC-04, `resignationId` UC-05, `amendmentId` UC-06,
   `dossierId` UC-07/08, `adjustmentId` UC-09). The feed shows it as **Group**;
   the drill-down lists the sibling rows and their attempt counts.

   **A record, not a submission**, and the wording used to get this wrong. One
   record can be submitted more than once — the four-row group above is one
   expense and two submissions. Grouping all four is correct: a reader auditing
   that expense wants all four. Calling them "the rows of this submission" was
   not, and the drill-down now says **Same record**. Two consequences follow: a
   group may hold more than one decision row, so `traceVerdict.js`'s
   `decisionAuthorising()` picks the most recent decision recorded *before* the
   row being explained rather than the first one in the group — a write must
   never announce that it followed a decision made after it. Time is used there
   only to order rows already known to be correlated, never to decide that they
   are related.

**Rows were deliberately NOT collapsed into one feed entry.** Two reasons, and
the first is decisive: a group whose members can straddle a page edge makes the
page size non-deterministic and the keyset cursor ambiguous, so collapsing
would have fought the pagination shipped in the same pass. The second is
honesty — an n8n-written row need not carry the same `details` keys as its Node
counterpart, so grouping would work silently for some rows and silently not for
others. **Time proximity is never used as a correlation.** Three rows in one
millisecond is evidence of nothing; a busy day guarantees it. A row carrying no
key on that list is reported as uncorrelatable, in those words, rather than
grouped on a guess.

## A person's decision

The 🟡 tier's whole design is that the automation prepares and risk-scores, and
a **named person decides**. Live, 2026-08-19, that moment looked like this:

```
04:50:48.103  UC-02  expense_review_release   Follow-up event
04:50:48.453  UC-02  expense_released_write   Follow-up event
```

A Finance Ops specialist authorising a real reimbursement rendered exactly like
a tag update. Neither action was in `DECISION_ACTIONS`, and the second was not
in `EXECUTION_ACTIONS` either, though its siblings on the automated paths all
were. The most consequential row in the system was the least legible one on the
page.

**`src/auditview/humanDecision.js`** holds the fix, and both halves of it are
the server's judgement, rendered by the page and re-derived nowhere.

**`HUMAN_VERDICTS` — the fourteen actions that record a person's verdict**, and
the plain word for what each decided. Read off the writers one call site at a
time, not from the shape of the string:

| Where | Actions |
|---|---|
| UC-02 `submitExpenseReview()` | `expense_review_release` · `expense_review_approve` · `expense_review_decline` · `expense_review_hold` |
| UC-04 `submitWorkationApproval()` | `workation_approved` · `workation_denied` |
| UC-05 `submitResignationSignoff()` | `resignation_signed_off` · `resignation_denied` |
| UC-06 `submitAmendmentApproval()` | `amendment_approved` · `amendment_denied` |
| UC-09 `submitAdjustmentApproval()` | `adjustment_approved` · `adjustment_denied` |
| ZAF sidebar, `src/review/service.js` | `human_approved` · `human_denied` |

Each passes `DECISION_ACTIONS`' own test — a verdict on a request, written
*instead of* a second automated decision row rather than alongside one — which
is the same test `duplicate_request_ignored` was admitted on. A **slot** is
still a verdict: `amendment_approved` records one role's signature on a request
needing two, so it renders as *"approved — one role's slot"* rather than
implying the request is settled. A **hold** is still a verdict: UC-02 writes
the row and returns, so it is the whole of that invocation.

**Deliberately not verdicts**, each read and rejected: `*_refused` (the *system*
declining an attempt — no person's decision was recorded), `*_execution_blocked`
/ `*_execution_not_claimed` / `resignation_signoff_blocked` (follow-ups of a
verdict that already has its own row), `amendment_*_consented` (consent is an
*input* to the amendment, not an answer to it), and `expense_auto_approved` (no
human anywhere near it).

**Both spellings of UC-02's verb are recognised, permanently.** The review verb
`release` is becoming `approve`; `audit_log` is append-only, so the rows already
written under the old verb stay live history a specialist searches. Dropping the
old spelling would un-classify real rows on the day the rename shipped.

**`writeOutcome()` — did the write that verdict authorised actually land?**
`details.remoteResult` is the fact, and its **absence** is the thing worth
seeing: a verdict with no execution row beneath it means a human said yes and
nothing in this trail records Remote having taken it. The audit write is ordered
*before* the outward act precisely so the two can disagree.

It **reports, it does not predict** — four codes, all facts about the record:

| Code | What it says |
|---|---|
| `remote_confirmed` | an execution row on this record carries Remote's own response |
| `execution_without_response` | an execution row exists and carries no `remoteResult` — unconfirmed, not done |
| `execution_stopped` | a `*_execution_blocked` / `*_not_claimed` row followed the verdict; nothing was sent |
| `no_write_recorded` | nothing on this record records a write, and **both readings are named**: the verdict may not call for one (a denial, a hold, a signature still outstanding, or UC-05, which has no Remote write endpoint at all), or a write was attempted and never recorded |

Guessing which of those two applies would paint a red "missing write" over a
perfectly correct UC-05 sign-off, so the viewer names both and resolves neither.
It is also scoped to the **record**, not the submission — on a two-slot record
the execution follows the *second* signature — which is why the headline says
"on this record".

The feed shows the verdict as a chip beside the action (`human: released for
payment`); the drill-down adds a **Human decision** block: who decided, in which
role, their note (or *"no note recorded"* — absent is stated, never blanked),
**what the automation had recommended** (`aiDecision`, recorded on the same row
so "did the specialist agree with the AI?" is answerable from history), and the
write-outcome verdict.

## What a reason means

Every policy engine returns a `reason` **slug** — `over_policy_cap`,
`no_matching_notice_bracket`, `sanctioned_region` — and the viewer printed it
bare on all nine use cases. That is the worst place in the system for a message
less specific than what the code already holds: this is the surface someone
opens **when something has already gone wrong**, often not the person who wrote
the gate.

Five policy engines (UC-02, UC-03, UC-04, UC-05, UC-09) publish a
`GATE_SEQUENCE` with a plain-words `means` per reason, reached through their own
`describeDecidingGate(reason)` (see `docs/GATES.md` and
`src/shared/gateLadder.js`). The viewer reads `audit_log` rows rather than
policy-engine results, so it had no use case in hand to ask.
**`src/auditview/gateMeanings.js`** is the missing `useCase →
describeDecidingGate` registry.

Four rules make it correct rather than merely wired:

1. **A use case with no ladder renders exactly as before.** UC-01 and UC-06
   publish no `GATE_SEQUENCE`; UC-07/UC-08 are the dossier builds. No entry, no
   prose, no placeholder.
2. **An unrecognised reason renders exactly as before.** Both ladder shapes
   already answer honestly — UC-03/04/05/09's bound helper returns `null`,
   UC-02's returns a row whose `means` is `""` — and neither is papered over.
3. **The slug survives beside the prose.** It is the exact string in
   `audit_log`, in the metrics exception ranking and in the n8n Code-node ports
   — what a person greps for and what this page's own filters match. Prose that
   *replaced* it would make the page readable and the system harder to trace.
4. **The viewer stays read-only structurally.** The registry imports five
   `policyEngine.js` files and nothing else; their whole transitive import set
   is pure (gate ladder, country codes, money, upstream failure, schema
   validator, risk matrix, policy caps, notice table, PTO payout). A test walks
   that graph and fails if any of it ever reaches a REST client, a store or an
   audit logger — because "policy engines are pure" is a claim, and the one
   thing that must not enter this file is a write path.

The rendering follows the same split as everything else here: the feed shows
the slug with the sentence clamped to two lines beneath it (whole text on the
title), and the drill-down shows the sentence in full with the rung it names —
*"gate 12 of 16 (Policy cap)"*.

## Why an Attempts table is empty

`src/auditview/traceVerdict.js` answers it, per row, from the data —
replacing a single line that covered every case at once ("either it predates
the trace nodes, or it made no LLM/API calls") and so explained none of them.

| Verdict | Means |
|---|---|
| `traced` | Attempts exist; nothing to explain. |
| `sibling_has_trace` | A correlated row of the same submission has them. The row is named and one click away. |
| `execution_row` | This row records the outward act — the write itself, appended after the Remote call returned and carrying its response. Empty for an ordinary reason: performing a write is not a traced *attempt*, and the traced work sits on the decision row, which is named and one click away. Kept distinct from `follow_up_event` so the prose cannot contradict the **Execution** badge sitting directly above it. |
| `follow_up_event` | This is a lifecycle event of a decision row that is also empty — attempts hang off the decision, so that is where to look, and its own verdict finishes the story. |
| `predates_tracing` | This row is older than the oldest `audit_trace` row that exists anywhere, so nothing was tracing when it ran. |
| `no_traceable_call` | The row itself says why, and the fields are quoted: `categorySource`/`classification.source`/`extractionSource`/`parseSource` = `rule_based_fallback` means the deterministic rules answered and no LLM was called; `source: "portal"` means the Remote reads went to the mock fixtures rather than the live API. |
| `unexplained` | Zero attempts and nothing accounts for it. Kept as its own visible answer on purpose — it is the one that means somebody should look, and folding it into a benign code would hide a trace branch that is genuinely broken. |

The verdict is a **judgement**, so it is made server-side and the page renders
its words. Money formatting is presentation and stays in the browser; "why is
this empty" is not.

## Reading a record

`audit_log.details` renders as a **label/value table** — headers down the side
with `scope="row"`, the portal's `detailTable()` idiom — not a JSON dump.

- **Money** is an integer in the currency's minor unit everywhere in this
  system (`src/shared/money.js`), so `12500` renders as `125.00 USD` **from the
  row's own paired currency field** (`amount`/`currency`,
  `convertedAmount`/`convertedCurrency`). A money-shaped integer whose currency
  field is absent renders as the integer: a figure labelled with the wrong
  currency is worse than one labelled with none, and no default is hard-coded
  anywhere in the page (a test asserts that).
- **Arrays** are chips, **booleans** are words, **timestamps** are localised
  with the raw ISO on hover.
- **Empty is not absent.** A key present with a null or empty value keeps its
  em dash; an empty array reads "none"; a key that is not in the object has no
  row at all.
- **Nested objects** (`remoteResult` is large and genuinely nested) collapse
  behind a disclosure, and the whole record's raw JSON stays one click away at
  the bottom — reachable for debugging, no longer the primary presentation.

## The bug audit — "Trace a reference"

The second tab, deliberately not buried: paste a **request reference** and see
its `workflow_claims` rows, every `audit_log` row carrying it, and any
`ops_alerts` within **±15 minutes** of its activity. Time proximity is the
strongest join that exists — `ops_alerts` carries no ref column — and the page
labels it as such.

The reference is the id the portal reports after a submission
(`uc02-20260819104528-11aomw`), or the Zendesk ticket id when the request
arrived on a ticket. The tab, the field label and the button all say so now:
the lookup had existed for a while and nothing on any surface told a person
holding a reference that it was the thing to trace with, which for that person
is indistinguishable from the lookup not existing.

Two supporting affordances, both one-way into this tab:

- The feed's **Reference** column renders each value **whole** (never elided —
  a truncated reference cannot be copied or quoted) as a button that traces it.
  The row's own click still opens the drill-down; the button stops propagation.
- An **empty feed search** offers "Trace *&lt;what you typed&gt;*". The feed
  searches `audit_log` only, so it can only match a reference a decision row
  actually *carries*; the exactly-once ledger may hold it either way. Leaving
  "no rows" as the last word turns a processed request into a lost one.

## Trace by ANY id, not only the reference

**The failure this closes.** On 2026-08-19 a request went through the portal,
was decided, and was recorded. The portal reported
`uc04-20260819205605-2hnba` and told the requester, in bold, that it was "the
id that ties every record of this request together; quote it to have this
request traced." They pasted it here and got nothing. The decision was in
`audit_log` the whole time under `externalRef "50"` — the Zendesk ticket the
UC-03 travel request had been handed on from.

An empty result reads as **"the decision was never recorded"**. The truth was
**"recorded under a different key"**. Those are opposite conclusions, and the
page presented the alarming one silently. That is the worst failure this
surface can have, because it is the surface a person opens *when something
already looks wrong*: it converts a working system into a reported outage.

### What could be searched before, and what can be now

| Identifier | Before | Now |
|---|---|---|
| `audit_log.details.externalRef` | ✅ `/api/refs/:ref` (exact) and the feed's `q` (substring) | ✅ |
| `workflow_claims.external_ref` | ✅ `/api/refs/:ref` | ✅ |
| `audit_log.actor` | 🟡 feed `q` substring only | ✅ exact |
| `audit_log.details.reason` | 🟡 feed `q` substring only | (still `q` — a reason is not an id) |
| `audit_log.id` | 🟡 only by already holding the row (`/api/decisions/:id`) | ✅ |
| The **record id** (`caseId`, `storeId`, `expenseId`, `authorizationId`, `resignationId`, `amendmentId`, `dossierId`, `adjustmentId`, `reviewId`) | ❌ nothing could search it — while `refVerdict` told readers to | ✅ lookup **and** the feed's `q` |
| `employmentId` | ❌ | ✅ |
| The **hand-off** ids `uc03CaseId` / `uc04AuthorizationId` | ❌ | ✅ |
| `workAuthorizationId` (Remote's own) | ❌ | ✅ |
| `audit_trace.id` / `parent_id` | ❌ | ✅ |
| `audit_trace.details` `externalRef` / `executionId` / `workflowId` | ❌ | ✅ |
| `ops_alerts` `id` / `execution_id` / `workflow_id` / `execution_url` | ❌ | ✅ |

Twenty-two fields for a non-UUID, twenty-six for a UUID — the four extra being
the uuid columns a non-uuid cannot possibly sit in. The registry is
`src/auditview/identifiers.js`, and **the list the page shows as "where this
lookup looked" is generated from the same list the queries are generated
from**, so the viewer cannot claim to have searched somewhere it did not.

Two of those rows are worth naming. `uc03CaseId` is, for the request above,
**the single most useful identifier that exists** — it is the only one that
reaches both halves of the hand-off (`caseId` on the UC-03 side,
`uc03CaseId` on UC-04's continuation rows), where the ticket reference reaches
only the UC-04 half. And the **record id** was advice the page was already
giving and could not honour: `refVerdict`'s `claimed_not_audited` note told
readers to "search the feed for that record id", which the feed could not do.
It can now, on both paths, and the note points at this box.

### `GET /api/lookup/:value` — and what an empty answer is allowed to mean

`src/auditview/identifierVerdict.js` is the judgement, computed server-side and
rendered verbatim like every other verdict here. Its whole job is to never
answer **A** when the truth might be **B** or **C**:

- **A.** no record exists for this id
- **B.** this is not an id this viewer can search by
- **C.** we cannot tell which of A and B this is

That is the same line the gate ladder draws between `not_reached` and `passed`,
and `src/uc04/decisionFacts.js` between `unknown` and `cleared`: a check that
never ran cleared nothing, and a place that was never searched found nothing.

| `code` | Means |
|---|---|
| `found` | Something carries it. Counts what, and **every row names the field it matched on** — a row can match because it IS this request or merely because it shares the employee, and only the field tells you which. An employment-id-only match is explicitly labelled *a person's history, not one request's*. |
| `found_under_unregistered_key` | The registry missed it, and the fallback scan found the value under a `details` key nothing indexes as an identifier. The key and its row count are named; the verdict deliberately stops short of calling it this request's id, because a value can be a reason slug or a decision word that happens to equal what was typed. |
| `not_found` | Nothing anywhere. **Shape-aware, and never conclusive about the request.** A portal reference gets the hand-off reading named (a continuation records the *originating* request's reference) and is told plainly that a decided request whose rows do not repeat its reference is a gap in the writer, not evidence nothing happened. A UUID is told a record id no writer copied into `audit_log` lives only in its own use case's table, which this viewer does not read. An unrecognised shape gets **C** in those words: *"this viewer CANNOT TELL whether this is an identifier it can search by."* |
| `empty` | Nothing was typed. Costs no queries. |

Every `not_found` carries two lists, and the second is the load-bearing one:

- **Searched** — the N fields, by name, generated from the registry.
- **Not searchable here** — the use cases' own record tables
  (`uc02_expenses`, `uc04_authorizations`, `uc06_amendments`, …), a Zendesk
  ticket no run ever recorded, and Remote-side ids never written back. Each
  says *what*, *why*, and *where to look instead*. A reader cannot tell "not
  here" from "not looked for" unless the page shows where it looked.

Plus **next steps** — try the originating request's reference, try any other id
from the same request, use the feed's substring filter. The `<details>` holding
the two lists **opens itself when nothing was found**, because that is exactly
when the boundary of the search is the thing worth reading.

### Cross-shape search, and what it costs

Four queries, one per table, run **concurrently**; each is a single pass with
the candidate places OR'd together — never one query per key. Matches are
**exact**: an identifier is exact, and a substring lookup on an id returns a
superset nobody asked for (the feed's `q` is the substring tool, and the page
says so). The value travels as `$1` and **appears in the SQL text nowhere**;
the key names are module constants whose shape a test asserts, on a public
surface reading a table whose whole value is being untampered-with.

`details->>'k' = $1` is not indexable without an expression index per key, so
each probe is a sequential scan. Measured on the live store (218 `audit_log`
rows, 224 `audit_trace`, 101 `ops_alerts`, 57 `workflow_claims`), `EXPLAIN
ANALYZE` reports **0.38 ms** for the `audit_log` pass. Three bounds are built in
rather than promised later: every probe is capped (default 50 rows, hard max
200), the four run concurrently, and the expensive pass below runs only on a
miss. When the numbers change, the index is a GIN one and the rewrite is to
containment:

```sql
create index audit_log_details_gin on audit_log using gin (details jsonb_path_ops);
-- then: details @> jsonb_build_object('caseId', $1) — @> is GIN-servable, ->> is not.
```

It is not carried today because it is not yet paying for itself, and an index
added ahead of its need is a claim about load nobody has measured.

**The second pass is the honest part.** When nothing in the registry matches,
one bounded `jsonb_each_text` scan asks a different question: does this value
appear under *any* key of `details`, including one the registry has never heard
of? Measured on the same store: **6.2 ms**, sixteen times the registry pass —
which is exactly why it runs only on a miss. A miss is precisely when the extra
information is worth paying for, and precisely when the reader is most stuck.

### It is still read-only, structurally

The lookup added a `GET` and nothing else. `src/auditview/server.js` still has
no branch for any method but `GET`, asserted both ways — and
`test/auditViewLookup.test.js` adds the same pair of assertions for
`/api/lookup` specifically, so the new route cannot be the one that quietly
introduces a write. The same `PORTAL_ACCESS_KEY` gate covers it, because the
gate sits **before** the route match: a route added later is gated by existing,
not by being remembered.

### `refVerdict` — what this reference actually lets you trace

`src/auditview/refVerdict.js` answers one question the three tables cannot:
which of four situations an empty table means. It is computed server-side and
rendered verbatim, the same division of labour as `traceVerdict`.

| `code` | Means |
|---|---|
| `traced` | Ledger claimed it and `audit_log` rows carry it. Counts what it holds. |
| `claimed_not_audited` | **The request WAS processed.** The ledger holds the reference *and the verdict each run reached*; no `audit_log` row carries the reference, so a lookup keyed on it cannot reach the decision. A gap in the **writer**, not in the trail. Names the record id as the identifier that *does* group the rows. |
| `audited_not_claimed` | Decisions carry it, no claim row. Ordinary: a path that answers and returns *before* claiming (UC-02's duplicate gate), or a run predating the ledger. |
| `not_found` | Nothing anywhere. References match exactly, not by prefix. |

A `notes` entry fires when the reference spans more than one use case: that is
a **hand-off**, not a repeat — `workflow_claims` is keyed `(use_case,
external_ref)` so UC-03 routing on to UC-04 claims once in each. A repeat is
two rows under *one* pair, which the duplicate-delivery banner reports.

`claimed_not_audited` is not hypothetical. On 2026-08-19, thirteen real portal
submissions sat in exactly that state — every one with a claim row naming its
decision, not one `audit_log` row findable by its reference. See
`docs/BUILD-LOG.md` §3.68 for which writers are missing the field.

## How the deployed mount is gated

Mounted at **`/audit`** on the existing Vercel function
(`deploy/cx-apis/`), exactly the way `/portal` is: routed by prefix
(`deploy/cx-apis/router.js`'s `AUDIT_VIEW`), delegated whole — gate included —
by `handler.js`, wired by `deps.js`'s `buildAuditViewHandler()`. It is **not**
a tenth `USE_CASES` entry for the same reason the portal is not: it cannot
present a ZAF token, and listing it there would subject it to a gate it can
never pass.

The gate is the portal's shared-key mechanism, reused whole
(`src/portal/access.js`): env `PORTAL_ACCESS_KEY`, header `x-portal-key`, and
the same fail-closed posture rule — a key is required when a durable store is
attached **or** the deployment is publicly reachable, ORed so the platform
check can add the requirement but never remove one. **One key opens both
surfaces** — the operator already holds it. When a key is required and none is
configured, every `/api` call under `/audit` is refused with
`portal_access_key_not_configured`; the page itself still loads and prompts,
because serving the empty shell is how the operator is told a key is needed.

This surface serves real audit rows — employment ids, actors, requester
emails inside `details`, full decision records — which is why leaving it open
would be the same class of exposure the nine APIs' read gate closed (§3.32).

`GET /__cx/health` reports the whole posture as data (`auditView` block):
mounted, read-only, whether a store is attached, whether the key is required
and configured.

## API (all GET; anything else 404s)

| Route | Answers |
|---|---|
| `GET /api/meta` | `{ mode }` — the page's boot probe (and, being gated, the key check) |
| `GET /api/decisions?use_case=&action=&q=&limit=&before=&since=&since_id=` | One page of the feed, newest first, plus `page: {size, returned, hasMore, nextCursor}`. `before` is the keyset cursor (`<iso at>~<uuid id>`; a malformed one is `400 bad_cursor`); `since`+`since_id` are the live tail's strictly-newer cursor. Every row carries `kind`, `humanVerdict` (null on automated rows), `reasonMeaning` (null when there is no ladder or no matching rung), `note` / `role` / `aiDecision`, and `hasRemoteResult` |
| `GET /api/decisions/:id` | One row + its `trace`, `correlation`, `siblings`, `traceVerdict` (why the trace is empty), `redundantCalls` and `writeOutcome` (whether the write a person authorised reached Remote; `null` on any row that is not a human verdict) — every verdict the server's, none re-derived in the page |
| `GET /api/alerts?limit=` | The ops ledger, newest first |
| `GET /api/refs/:externalRef` | `{ claims, decisions, alerts, alertWindow, duplicateDeliveries, refVerdict }` — `refVerdict` is `{code, tone, headline, detail, notes[], useCases[]}`; see "The bug audit" above for the four codes |
| `GET /api/lookup/:value?limit=` | One value tried against **every** identifier the four tables carry: `{ shape, searched[], matches[], decisions[], traces[], claims[], alerts[], unregistered[], exhaustiveScanRan, rowCap, notSearchableHere[], identifierVerdict, reference }`. Each returned row carries `matchedOn` — the fields that actually matched. `reference` is the `/api/refs` payload, composed in by the **same** function that route uses (so the two cannot disagree) when the value resolved as an external reference, and `null` otherwise — an empty reference panel is never rendered as a plausible-looking shell |

## Tests

`test/auditViewLookup.test.js` covers the id lookup, and its fixture is the
**real** UC-03 → UC-04 hand-off chain — every id read out of production
Supabase on 2026-08-19, never copied from the code that writes it, because a
lookup test built from the writer's own vocabulary reproduces exactly the
fixtures-agree-with-code defect this repo keeps paying for. The load-bearing
ones:

- **The row is findable by every identifier it carries** — reference, ticket
  id, `caseId`, `authorizationId`, `employmentId`, its own row id — and each
  reports the field it matched on. Six ids, one row, positive assertions: a
  lookup that finds nothing passes every negative test ever written.
- **The hand-off id reaches BOTH use cases**, matching on `caseId` on one side
  and `uc03CaseId` on the other.
- **The reference the portal actually displayed reaches nothing** — verified
  against production — **and the answer never asserts the request does not
  exist**, names the hand-off reading, and points at the id that would reach it.
- **The value is a parameter**: `'; drop table audit_log; --` appears in no
  statement, and travels as `$1` in all of them.
- **A non-uuid never reaches a uuid column** — the parameter is `null`, so the
  predicate is simply false rather than a cast error.
- **The exhaustive scan runs only on a miss** — four statements on a hit, five
  on a miss, and the fifth is the only one mentioning `jsonb_each_text`.
- **A store failure on the lookup is a 500 that renders**, never a 200 with an
  empty result: the whole point of the fix, one layer down.
- **The page branches on no verdict code** — it renders the server's words.

`test/auditview.test.js` (store, server, gate, assets — including the
node:vm compile of `app.js`, the no-`innerHTML` assertion, and the
reads-throw rule in both store and HTTP form) and the `/audit` section of
`test/deployRouter.test.js` (routing, health, key gate in both directions,
the 503-not-demo-rows rule, and the vercel.json bundle check). All hermetic.

The load-bearing ones, and what each would catch:

- **Paging walks the whole feed once** — no id on two pages, and the walked
  order equals the single-page order. Catches a cursor that skips or repeats.
- **Three rows sharing one millisecond survive a page edge between them**,
  walked at one row per page so every edge falls inside the shared timestamp.
  This is the tiebreak test; an `at`-only cursor fails it in one direction or
  the other.
- **The live tail tiebreaks too** — tailing from the newest of those three
  re-delivers neither of its same-millisecond neighbours and misses nothing
  newer.
- **`hasMore` on an exactly-full page is false**, so the pager cannot offer a
  next page that does not exist.
- **Each trace-verdict branch**, from the seeded data where the seed carries
  it (`follow_up_event`, `no_traceable_call` with both evidence fields named,
  `predates_tracing`, `traced`) and from constructed input where it does not
  (`sibling_has_trace`, `unexplained`).
- **Correlation priority and its absence** — `storeId` over `expenseId`,
  `caseId` over `reviewId`, and `{field: null}` for a row carrying neither.
- **Money never invents a currency**: no three-letter code exists anywhere in
  the page's code, comments stripped.
- **A human's verdict classifies as a decision and names WHO and WHAT** —
  positive, and deliberately so. The failure mode is silence: a vocabulary that
  has simply never heard of an action behaves identically to one correctly
  declining to classify it, and no negative assertion tells the two apart. The
  sweep covers all six approval handlers, and pins that a `*_refused` row and a
  consent row stay events.
- **Both spellings of UC-02's review verb classify** — `release` (live history,
  forever) and `approve` (the rename), so shipping the rename cannot
  un-classify rows already written.
- **Every entry in `EXECUTION_ACTIONS` is derived from its writer**, including
  the two UC-02 builds from `statusForAction()` rather than as literals — and
  the reverse direction too: every name that function can produce must be *in*
  the vocabulary, which is the assertion that fails loudly when the rename
  lands.
- **`writeOutcome()` in all four states**, including the two that must not be
  confused: an execution row carrying no `remoteResult` (unconfirmed) and an
  execution row recorded *before* the verdict (belongs to something else).
- **A reason resolves to its own engine's sentence**, compared against
  `describeDecidingGate()` itself rather than a pasted copy — a copy is how the
  two would drift.
- **No ladder and no matching rung both render as before** — UC-01, UC-06,
  UC-07, UC-08 and an unknown slug all return `null`, and a UC-01 row is
  asserted unchanged in all three respects (no verdict, no prose, same slug).
- **The registry's whole transitive import graph is walked** and must reach no
  REST client, store or audit logger.
