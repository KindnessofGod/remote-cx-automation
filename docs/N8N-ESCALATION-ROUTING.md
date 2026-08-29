# Escalation routing on the n8n path — survey, design and deploy plan

> **STATUS CHANGED 2026-08-19 — THIS PLAN HAS BEEN EXECUTED.** Everything
> below §0 was written as a survey and a plan; §10 at the end of this file
> records what actually happened when it was carried out, including the four
> places reality differed from the plan. Read §10 before acting on anything
> here. The full write-up is `docs/BUILD-LOG.md` §3.40, and the deployed
> behaviour is documented in `workflows/README.md`'s "Escalation routing"
> section.

**Status when written: investigation and local preparation only.** No workflow
was updated, no workflow was published, no `PUT` was issued against the n8n REST
API, and no Zendesk group was created, renamed or deleted. Every live system
named below was read, never written.

**Date of survey: 2026-08-19.** Every fact in §1 was read from the *deployed*
graph via `mcp__n8n__get_workflow_details`, not from this repo's copies under
`workflows/`.

---

## 0. The problem, stated precisely

When a case escalates or otherwise needs a human, the responsible team must
receive the Zendesk ticket — **assigned**, not merely tagged.

Today the nine live graphs tag and annotate. They assign nothing. Across all
nine there are **29 Zendesk write nodes**; **26 of them end a path that needs a
human**, and not one sets a group or an assignee. A ticket that has been
escalated by UC-09 (off-cycle payroll, real money, triple approval) and a ticket
auto-resolved by UC-01 land in exactly the same place: the account's single
`Support` queue, distinguishable only by a tag that nothing routes on.

This document is the n8n half of the fix. The portal half, and the routing table
itself, are being built in parallel — see §4 for the boundary and §6 for the
exact contract this side depends on.

---

## 1. Per-graph survey, read from the live graphs

All nine are `active: true` **and `versionId === activeVersionId`**, so what is
recorded below is what production is running — not a draft. That comparison is
the only thing that answers "is this live?" (CLAUDE.md §6), and it was made for
each graph individually rather than inferred from the first.

| UC | Workflow ID | `versionId` == `activeVersionId` | Branching | Zendesk write nodes | Of those, need a human |
|---|---|---|---|---|---|
| 01 | `WORKFLOW_UC01_ID` | ✅ `8e86a543…` | Switch, 4 out | 4 | 3 |
| 02 | `WORKFLOW_UC02_ID` | ✅ `e25de756…` | Switch, 5 out | 5 | 4 |
| 03 | `WORKFLOW_UC03_ID` | ✅ `29d6821b…` | Switch, 5 out | 5 | 4 |
| 04 | `WORKFLOW_UC04_ID` | ✅ `2be83c3b…` | Switch, 4 out | 4 | 4 |
| 05 | `WORKFLOW_UC05_ID` | ✅ `cf22ba29…` | Switch, 3 out | 3 | 3 |
| 06 | `WORKFLOW_UC06_ID` | ✅ `1e76965d…` | Switch, 3 out → **2 nodes** | 2 | 2 |
| 07 | `WORKFLOW_UC07_ID` | ✅ `6881bd4c…` | **none** | 1 | 1 |
| 08 | `WORKFLOW_UC08_ID` | ✅ `1a5f57d3…` | **none** | 1 | 1 |
| 09 | `WORKFLOW_UC09_ID` | ✅ `6faf85f8…` | Switch, 4 out | 4 | 4 |
| | | | | **29** | **26** |

### 1.1 Which branch reaches which node

Only three Zendesk nodes in the whole system end a path where **nobody needs to
act** — the auto paths. They are the three that must *not* be assigned, because
assigning a solved ticket to a team queue manufactures work that does not exist.

| UC | Decision branch | Zendesk node | Note encoding | Needs a group? |
|---|---|---|---|---|
| 01 | `auto_resolve` | `Reply + Solve Ticket` | `updateFieldsJson` → `comment.html_body`, public | ❌ no |
| 01 | `human_review` | `Flag for Specialist Review` | `updateFields.internalNote` | ✅ |
| 01 | `escalate` | `Escalate Ticket` | `updateFields.internalNote` | ✅ |
| 01 | *fallback* | `Unrecognised Decision` | `updateFields.internalNote` | ✅ |
| 02 | `auto_approve` | `Resolve Expense Ticket` | `updateFields.publicReply` | ❌ no |
| 02 | `blocked` | `Flag Blocked Expense` | `updateFields.internalNote` | ✅ |
| 02 | `human_review` | `Flag Expense For Review` | `updateFields.internalNote` | ✅ |
| 02 | `escalate` | `Escalate Expense Ticket` | `updateFields.internalNote` | ✅ |
| 02 | *fallback* | `Unrecognised Expense Decision` | `updateFields.internalNote` | ✅ |
| 03 | `auto_resolve` | `Reply + Solve Ticket` | `updateFields.publicReply` | ❌ no |
| 03 | `human_review` | `Flag For Formal Letter Review` | `updateFields.internalNote` | ✅ |
| 03 | `escalate` | `Escalate Travel Ticket` | `updateFields.internalNote` | ✅ |
| 03 | `route_to_uc04` | `Route To UC-04` | `updateFields.internalNote` | ✅ **see §1.4** |
| 03 | *fallback* | `Unrecognised Travel Decision` | `updateFields.internalNote` | ✅ |
| 04 | `ready_for_approval` | `Flag Awaiting Specialist Approval` | `updateFields.internalNote` | ✅ |
| 04 | `blocked` | `Flag Blocked Workation` | `updateFields.internalNote` | ✅ |
| 04 | `escalate` | `Escalate Workation Ticket` | `updateFields.internalNote` | ✅ |
| 04 | *fallback* | `Unrecognised Workation Decision` | `updateFields.internalNote` | ✅ |
| 05 | `prepared_for_signoff` | `Flag Awaiting HR Ops Sign-off` | `updateFields.internalNote` | ✅ |
| 05 | `escalate` | `Escalate Resignation Ticket` | `updateFields.internalNote` | ✅ |
| 05 | *fallback* | `Unrecognised Resignation Decision` | `updateFields.internalNote` | ✅ |
| 06 | `dual_approval_required` | `Flag Awaiting Dual Approval` | `updateFields.internalNote` | ✅ |
| 06 | `escalate` **and** *fallback* | `Escalate Amendment Ticket` | `updateFields.internalNote` | ✅ |
| 07 | *(no branch)* | `Escalate Relocation Ticket` | `updateFields.internalNote` | ✅ |
| 08 | *(no branch)* | `Escalate Tax Inquiry Ticket` | `updateFields.internalNote` | ✅ |
| 09 | `dual_approval_required` | `Flag Awaiting Dual Approval` | `updateFields.internalNote` | ✅ |
| 09 | `triple_approval_required` | `Flag Awaiting Triple Approval` | `updateFields.internalNote` | ✅ |
| 09 | `escalate` | `Escalate Adjustment Ticket` | `updateFields.internalNote` | ✅ |
| 09 | *fallback* | `Unrecognised Adjustment Decision` | `updateFields.internalNote` | ✅ |

**UC-04, 05, 06, 07, 08 and 09 have no auto path at all.** Every execution of
those six ends at a node that needs a human, which is what their 🟡/🔴 tiers
mean. For those six, assignment is unconditional.

### 1.2 UC-07 and UC-08 have no Switch or IF node — confirmed

Both graphs are a straight line ending at a single Zendesk node. This is the
documented 🔴 "no execution path exists" design, and the survey confirms it is
still true of the deployed graphs: no `n8n-nodes-base.switch`, no
`n8n-nodes-base.if`, anywhere in either.

**Assigning a team here means something different from assigning one in a
branching graph, and the difference matters.** In UC-01 or UC-09, "assign the
group" is one outcome among several and the Switch is what picks it. In UC-07
and UC-08 there is nothing to pick: *every* dossier this system will ever build
goes to the same specialist team. The routing node on those two graphs therefore
has no conditional to evaluate — it is a constant. That is a feature, not an
omission, and it should be written as a constant rather than as a lookup that
happens to have one answer, because a lookup implies a choice the tier forbids.

### 1.3 Canvas position and the fan-out trap

CLAUDE.md §6 records that **n8n orders a fan-out by canvas y-position, not by the
connection array**, and that a must-not-lose write placed on the lower branch is
silently skipped when anything upstream of it fails. Five graphs have a live
fan-out on the path this change touches, and every one is currently ordered
correctly — the trace branch sits above the decision branch and therefore runs
first:

| UC | Fan-out node | Branch A (y) | Branch B (y) | Runs first | Safe? |
|---|---|---|---|---|---|
| 04 | `Append Audit Log` | `Collect Trace Steps` (**-220**) | `Route by Decision` (768) | trace | ✅ |
| 05 | `Append Audit Log` | `Collect Trace Steps` (**-220**) | `Route by Decision` (576) | trace | ✅ |
| 06 | `Append Audit Log` | `Collect Trace Steps` (**-28**) | `Route by Decision` (288) | trace | ✅ |
| 07 | `Append Audit Log` | `Collect Trace Steps` (**68**) | `Escalate Relocation Ticket` (288) | trace | ✅ |
| 08 | `Append Audit Log` | `Collect Trace Steps` (**68**) | `Escalate Tax Inquiry Ticket` (288) | trace | ✅ |

UC-01, 02, 03 and 09 fan out from `Append Audit Log` to `Collect Trace Steps`
and to `Carry Context Forward`; the new node goes *downstream of* `Carry Context
Forward`, so it is not a member of that fan-out at all and cannot perturb it.
UC-01 additionally fans out at `Persist Case` (`Queue Gate` y=40 above `Carry
Context After Records` y=300) — the ordering fixed once already. **This change
must not touch it.**

**The rule this yields, and it is the one thing most likely to be got wrong:**
the new routing node must be positioned at the **same y as the node it feeds**.
In every one of the five graphs above, that y is numerically greater than the
trace branch's y, so trace keeps running first. Placing the new node anywhere
"tidy" — say y=0, or above the graph next to the trace nodes — would silently
promote the customer-facing branch above the trace write and reintroduce the
exact bug §6 was written about. Reordering the connection array to compensate
does nothing; only the coordinate matters.

### 1.4 One finding that changes the design: UC-03's `route_to_uc04`

UC-03's Switch has a fourth branch, `route_to_uc04`, which exists because a
travel inquiry can turn out to be a work-authorization case. Its Zendesk node's
internal note says so explicitly: *"UC-04 owns its own compliance case."*

That branch must be assigned to **UC-04's** team, not UC-03's. It is the single
place in all nine graphs where the responsible team is *not* a function of the
use case that is executing. A mapping keyed purely by use case cannot express
it, and a routing node that reads only `useCase` will hand a work-authorization
case to the travel-letter queue — which is exactly the kind of miss that nothing
goes red about.

**Recommendation:** the mapping stays keyed by use case (it is right for 28 of
the 29 nodes), and the n8n routing node resolves the routing key as
`handoffUseCase || useCase`, where `handoffUseCase` is set only on this one
branch. That keeps the table single-keyed and puts the one exception where it is
visible, rather than inventing a per-decision table to serve one row. §6 records
this as a required field on the contract.

### 1.5 Two pre-existing wrinkles found while surveying — not fixed here

Neither is caused by this work and neither is mine to change, but both are worth
recording where someone will find them.

1. **UC-06's `unrecognised` fallback shares `Escalate Amendment Ticket` with the
   real `escalate` branch.** An amendment that produced an unrecognised decision
   therefore gets an internal note beginning "AI summary — ESCALATED", which
   describes a decision the gates did not actually reach. Every other graph has a
   distinct `Unrecognised …` node saying so plainly. Cosmetic today; misleading
   in an audit.
2. **`updateFields.tags` REPLACES the ticket's tags — it does not append** (see
   §2.3). Every one of the 29 nodes already sets `tags` to a single-element
   array, so an intake tag such as `uc01_test` is wiped by the first update. This
   currently works *by accident*: wiping `uc01_test` is also what stops the
   Zendesk trigger re-firing. Anything that later depends on intake tags
   surviving will break, and any routing tags added must be merged into the same
   array rather than set separately.

---

## 2. Can the n8n Zendesk node assign a group? — Yes. Evidence below.

This was the unknown that decided the design, so it is answered from the node's
own type definition and from n8n's source, not from the Zendesk REST API's
capabilities (which are not the same question).

### 2.1 The type definition

`mcp__n8n__get_node_types` for `n8n-nodes-base.zendesk`, `resource: ticket`,
`operation: update` returns, inside `updateFields`:

```typescript
/** The group this ticket is assigned to. Choose from the list, or specify an ID
 *  using an expression.
 *  @loadOptionsMethod getGroups
 */
group?: string | Expression<string>;

/** The e-mail address of the assignee */
assigneeEmail?: string | Expression<string>;
```

Both are present, and `group` explicitly documents that an **expression** may be
supplied in place of a picked value — which is what makes a computed, per-item
group possible at all.

### 2.2 What those fields actually become on the wire

From `packages/nodes-base/nodes/Zendesk/Zendesk.node.ts`, `ticket:update`:

```ts
if (updateFields.group)         { body.group_id      = updateFields.group as number; }
if (updateFields.assigneeEmail) { body.assignee_email = updateFields.assigneeEmail as string; }
```

So `group` → `group_id`, and it wants the numeric **group ID**, not the name.

### 2.3 The route this rules out, and what that saves

**An HTTP Request node against `PUT /api/v2/tickets/{id}.json` is NOT required.**
That matters, because CLAUDE.md §6 records that **n8n strips credentials from
HTTP Request nodes on create**, so each of 26 such nodes would have to have its
credential selected by hand in the editor — 26 manual steps, each of which fails
silently-ish (a 401 at the very end of a run, downstream of the audit write) and
none of which can be done from a coding session. Using the native node avoids
that cost entirely and keeps the change inside the standing §7b authorisation.

Also confirmed from the same source, and load-bearing:

```ts
body.tags = updateFields.tags as string[];   // REPLACES; there is no additional_tags
```

### 2.4 The internal note must render — proved from the type definition

CLAUDE.md §6 records that `publicReply` is plain text and silently escapes HTML,
which once delivered a letter to a customer as literal `&lt;!doctype html&gt;…`
on a run n8n reported as successful. The type definition states the distinction
directly — `internalNote` is annotated **"Internal Ticket Note (Accepts HTML)"**
and `publicReply` is annotated only "Public ticket reply" — and the source
confirms why:

```ts
// internalNote
const comment: IComment = { html_body: updateFields.internalNote as string, public: false };
// publicReply
const comment: IComment = { body:      updateFields.publicReply as string, public: true  };
```

`internalNote` → `html_body` + `public: false`. `publicReply` → `body` +
`public: true`. **All 26 human-facing nodes already use `internalNote`, so they
are already correct** and this change must not disturb that.

### 2.5 The one thing the node cannot do: `priority`

`priority` is **absent** from `ticket:update`'s `updateFields`. The node handles
`type`, `externalId`, `subject`, `status`, `recipient`, `group`, `tags`,
`customFieldsUi`, `assigneeEmail`, `internalNote` and `publicReply` — and
nothing else. So two-thirds of the `{ group, tags, priority }` mapping is
natively expressible and one-third is not.

There is a way to set it, already proven in this repo: `jsonParameters: true` +
`updateFieldsJson`, which n8n merges into the request body **verbatim**:

```ts
if (validateJSON(updateFieldsJson) !== undefined) { Object.assign(body, JSON.parse(updateFieldsJson)); }
```

Arbitrary Zendesk fields — `group_id`, `priority` — pass straight through.
UC-01's `Reply + Solve Ticket` already uses this form.

**But converting the 26 nodes to the JSON form is the single riskiest edit in
this whole change, and it should not be done in the same pass as the group
assignment.** In the JSON form the author must hand-write the comment object,
and `internalNote`'s `public: false` stops being supplied by the node. Writing
`comment: { html_body: … }` and forgetting `public: false` **posts the AI's
internal analysis publicly to the customer** — the same class of failure as the
`publicReply` incident, rotated: not garbled text this time, but confidential
reasoning delivered to the wrong audience, on a run that reports success.

**Recommendation: two phases.**

- **Phase 1 — group only.** Add `updateFields.group` to the 26 nodes. One added
  parameter per node. Nothing else on the node changes; `internalNote`'s
  `public: false` continues to be supplied by n8n. This delivers the actual
  requirement — the responsible team gets the ticket, assigned.
- **Phase 2 — priority, if wanted.** Convert to `updateFieldsJson`, one graph at
  a time, with a check on the *rendered comment* of a real ticket confirming it
  is still private. Not part of this plan; listed as follow-up in §7.

Phase 1 keeps the repo submittable after every change, which §1 of CLAUDE.md
requires. Phase 2's value (a priority field) is small next to its downside.

---

## 3. The Zendesk groups that actually exist today

Queried live via `mcp__n8n__explore_node_resources` against the node's own
`getGroups` load-options method, using the account's existing Zendesk credential
(`CRED_ZENDESK_OAUTH`) — a read-only lookup. **Nothing was created or modified.**

```
[{ "name": "Support", "value": 6151578998431 }]
```

**There is exactly one group. `Support`, id `6151578998431`.**

Two consequences, both material:

1. **Assignment cannot do anything useful today.** Every use case would resolve
   to the same queue, which is where the tickets already go. The setup script
   creating the per-team groups is therefore not a nicety — it is the
   precondition for any of this having an effect, and Phase 1 cannot be proven
   until it has run. This is the *only* hard external dependency in the plan.
2. **The mapping's `group` values must be resolved to numeric IDs at deploy
   time, not hard-coded.** The node needs `group_id`. Group IDs are assigned by
   Zendesk on creation and will differ between this account and any other, so a
   literal in the mapping would be an environment-specific value in a
   source-of-truth module. See §6 for the contract that resolves this.

**Incidental correction to CLAUDE.md §4, worth recording because a future
session will otherwise re-debug it:** that section states the n8n Zendesk
credential `CRED_ZENDESK_OAUTH` is stale and fails OAuth with an HTML response from
the token endpoint. **It is not stale.** It authenticated successfully and
returned live account data during this survey. It has also been renamed from
"Zendesk account" to **"Rao"**. Someone completed the browser consent step §4
lists as outstanding. (I have not edited CLAUDE.md — §8 of my instructions
excludes it.)

---

## 4. Scope boundary — what this document does NOT own

The mapping `useCase -> { group, tags, priority }` and the idempotent
`scripts/setup-zendesk-*.mjs` that creates the groups are **being built in
parallel and are not on this branch**. Creating a second copy of that table would
be the same defect as the duplicated gates this repo has paid for repeatedly,
so nothing here defines one.

What this pass delivers is everything that does not depend on the table's
*contents*: the survey above, the capability answers in §2, the real group list
in §3, the parity harness in §5, and the deploy plan in §7.

---

## 5. The port-and-parity design

### 5.1 Why a port is unavoidable

An n8n Code node has no module resolution — it cannot `import` from `src/`. This
is the same constraint that produced `workflows/nodes/gates.js` as a port of
`src/uc01/policyEngine.js`, guarded by `test/n8nParity.test.js` executing the
real node body in a `node:vm` sandbox. A routing table is the same hazard one
layer over, with a quieter symptom: a drifted gate makes a wrong *decision*,
which shows up in the audit log; a drifted routing table sends a correct decision
to the *wrong team*, and nothing anywhere goes red.

### 5.2 One body, nine graphs

`workflows/nodes/assignRouting.js` — a single Code node body deployed
byte-identically to all nine graphs, exactly as `workflows/nodes/collectTraceSteps.js`
already is. Nothing in it is per-workflow: it reads the use case and decision
from the item it is handed and looks the route up. That means one file, one
parity test, and nine rows in `scripts/verify-deployed-nodes.mjs`'s mapping —
instead of nine near-identical bodies drifting apart one edit at a time.

### 5.3 Where the routing decision belongs

**Computed once, before the branch splits; consumed on every branch.**

The alternative — a routing node per branch — would mean up to five nodes per
graph and 26 places for the table to drift. Placing one node between the audit
write and `Route by Decision` means the decision is known (the gates have run),
the record is already durable, and every downstream branch can read the answer.

| UC | Insert between | New node position (x, y) |
|---|---|---|
| 01 | `Carry Context Forward` → `Route by Decision` | (1848, **256**) |
| 02 | `Carry Context Forward` → `Route by Decision` | (2750, **288**) |
| 03 | `Carry Context Forward` → `Route by Decision` | (2090, **288**) |
| 04 | `Append Audit Log` → `Route by Decision` | (1650, **768**) |
| 05 | `Append Audit Log` → `Route by Decision` | (1650, **576**) |
| 06 | `Append Audit Log` → `Route by Decision` | (2120, **288**) |
| 07 | `Append Audit Log` → `Escalate Relocation Ticket` | (1430, **288**) |
| 08 | `Append Audit Log` → `Escalate Tax Inquiry Ticket` | (1672, **288**) |
| 09 | `Carry Context Forward` → `Route by Decision` | (1870, **288**) |

Every y is the y of the node the new node feeds, per §1.3. For UC-04–08 that
also keeps it below the trace branch, preserving the fan-out order.

The node is pure computation with no durable write and nothing outward-facing,
so it cannot lose a record if it fails — but it sits downstream of both the claim
and the audit write regardless, so a failure there cannot cost a decision either.

### 5.4 How each Zendesk node consumes it

One added parameter per node:

```
updateFields.group = {{ $('Assign Routing').item.json.zendeskGroupId }}
```

**Addressed by node name, not by `$json`** — deliberately. The nine graphs are
inconsistent about what `$json` holds on a branch: UC-01/02/03 restore the
decision context through a `Carry Context Forward` node, while UC-04/05/06/07/08/09's
Zendesk nodes already read `$('Workation Gates').item.json.…` and friends. A
named-node accessor is the one form that works identically on all nine.

**`$('X').item` resolves through item pairing**, which is why `Carry Context
After Claim` sets `pairedItem` explicitly (CLAUDE.md §5). The routing node must
do the same, or `.item` fails to resolve on the graphs that use it.

### 5.5 The parity harness — built this pass

`test/n8nRoutingParity.test.js` (added, hermetic, passing).

It executes a Code node body in `node:vm` and compares its `zendeskGroup` /
`zendeskTags` / `zendeskPriority` output against the routing table, per use case.
Two properties are deliberate:

- **It JSON round-trips the result before comparing.** Objects built inside a
  `node:vm` context are cross-realm, so `assert.deepEqual` fails on prototype
  identity rather than on content (CLAUDE.md §6). The round trip is also what n8n
  itself does between nodes, so the test sees the shape production sees.
- **It derives its cases from the table rather than restating them**, the same
  discipline `scripts/verify-trace-nodes.mjs` follows when it lifts
  `TRACED_CALLS` out of the deployed body. A local restatement would share any
  typo with the thing it is checking and compare equal.

**It is not vacuous while the mapping is in flight.** Four tests run today
against fixtures — a fixture table and a fixture port body — proving the harness
really executes a body, really compares it, and **really detects drift** (one
test deliberately alters a single group and asserts the harness catches exactly
that one). A harness that has never caught a difference is not known to be able
to; these four make its later silence informative rather than merely reassuring.
The fifth test — the real one — reports as **skipped with its reason** until both
files exist, which is an honest "not checked", never a green "checked and fine".

Dropping in the real mapping completes it with no edit to the test.

---

## 6. The contract the mapping module must meet

The parity test discovers the table as `ESCALATION_ROUTING`, or `ROUTING`, or the
default export, from `src/shared/escalationRouting.js`. If none matches it fails
with a message naming exactly what is needed, rather than resolving to
`undefined` and passing against nothing.

Required shape — keyed by use case, each value carrying the three fields:

```js
export const ESCALATION_ROUTING = {
  "UC-01": { group: "…", tags: [ … ], priority: "…" },
  // … through UC-09
};
```

Three requests to whoever owns that module, each grounded in a finding above:

1. **Keep `group` a stable NAME, not a numeric ID** (§3). Group IDs are assigned
   by Zendesk per account; a literal ID in a source-of-truth module is an
   environment-specific value that will be wrong in any other account. The
   deploy step resolves name → `group_id` once, against the live account, and
   bakes the resolved ID into the node body it deploys.
2. **Expose the resolution seam.** The setup script already has to know the
   name→ID correspondence to create the groups; exporting it (or writing it to a
   small generated file) is what lets the port carry IDs while the table carries
   names, with no second hand-maintained mapping.
3. **Allow a routing key that is not the executing use case** (§1.4). UC-03's
   `route_to_uc04` branch belongs to UC-04's team. The n8n node will resolve
   `handoffUseCase || useCase`; the table needs no new row, but the field must be
   agreed so both halves use the same name.

---

## 7. Deploy plan, with the proof for each graph

**Nothing below has been executed.** It is gated on the groups existing (§3) and
on the mapping landing (§4).

### 7.0 Preconditions

1. The parallel agent's setup script has run and the per-team groups exist.
   Re-query `getGroups` and confirm — the list in §3 must have grown.
2. `src/shared/escalationRouting.js` exists and `npm test` passes with
   `test/n8nRoutingParity.test.js`'s real case **no longer skipped**. A skip here
   means parity is unproven, and deploying an unproven port is exactly what §7b's
   authorisation does not cover.
3. `workflows/nodes/assignRouting.js` exists, and its nine rows are added to
   `scripts/verify-deployed-nodes.mjs`.

### 7.1 Order

One graph at a time, lowest risk first, verifying each before starting the next:

**UC-07 → UC-08 → UC-05 → UC-03 → UC-02 → UC-01 → UC-04 → UC-06 → UC-09.**

UC-07 and UC-08 first because they have no branch: one node, one constant, the
smallest possible edit, and any mistake affects a dossier that was going to a
human regardless. UC-09 last because it is the money path.

### 7.2 Per graph, what changes

1. Add the `Assign Routing` Code node at the coordinate in §5.3.
2. Rewire: `<upstream> → Assign Routing → <downstream>`, replacing the single
   existing connection. No other connection changes.
3. Add `updateFields.group` to that graph's human-facing Zendesk nodes only —
   the ✅ rows in §1.1. **The three ❌ auto-path nodes are not touched.**
4. Deploy, then **read the deployed body back and diff it byte-for-byte** against
   the local file before trusting the success flag (§7b).
5. Confirm **`activeVersionId === versionId`**. A `PUT` publishes in place; the
   MCP `update_workflow` writes only a draft. That comparison is the only thing
   that answers "is this live?" — for either tool.

### 7.3 How each one is proven

**A green run proves nothing and a pinned node reports success having done
nothing** (§6). So every proof below reads the **destination** — the ticket's
`group_id` as returned by Zendesk — and none reads the run status.

And per the lesson §5 of CLAUDE.md calls the most expensive of its session:
*only a positive test distinguishes "correctly cautious" from "structurally
cannot succeed."* A graph whose routing node silently returns `null` for every
input, and a graph correctly declining to assign an auto-resolved ticket, look
identical from outside. So every graph below gets an **escalation that MUST land
in a named group** — not only a refusal.

For each graph, drive its production webhook, unpinned, with a fresh external
ref, then assert:

| UC | Positive case — MUST land assigned | Negative / control case |
|---|---|---|
| 01 | identity mismatch → `escalate` → ticket `group_id` == the UC-01 group | `auto_resolve` ticket keeps its original group — **must NOT be reassigned** |
| 02 | expense over policy → `human_review` → assigned to the UC-02 group | `auto_approve` ticket not reassigned |
| 03 | unsupported destination → `escalate` → assigned to the UC-03 group | `auto_resolve` ticket not reassigned; **and** a `route_to_uc04` case assigned to the **UC-04** group, not UC-03's (§1.4) |
| 04 | any request → `ready_for_approval` → assigned to the mobility group | sanctioned destination → `blocked` → still assigned (a blocked case still needs a human) |
| 05 | any resignation → `prepared_for_signoff` → assigned to the HR Ops group | — (no auto path exists) |
| 06 | amendment → `dual_approval_required` → assigned to the payroll group | a `noMatchingCycle` escalation → still assigned |
| 07 | any relocation → assigned to the mobility-legal group, **unconditionally** | — (no branch exists; that is the point) |
| 08 | any tax inquiry → assigned to the tax-ops group, **unconditionally** | — (no branch exists) |
| 09 | high-risk adjustment → `triple_approval_required` → assigned to the payroll group | `escalate` → still assigned |

Additionally, on **every** graph:

- **The idempotency guarantee still holds.** Drive twice under one external ref;
  confirm exactly one `workflow_claims` row, one record row and one `audit_log`
  row, with the redelivery stopping at `Duplicate Delivery — Stop`. The routing
  node sits downstream of the claim, so this should be unchanged — which is
  precisely why it is worth confirming rather than assuming.
- **The trace branch still wrote.** Confirm `audit_trace` rows for the run. This
  is the check that catches a fan-out reordering (§1.3) — the failure mode where
  the decision still lands, the customer still gets an answer, and the trace is
  simply missing, with nothing going red.
- **The internal note still rendered and is still PRIVATE.** Read the rendered
  comment on the ticket, not the node's success flag (§6). Under Phase 1 this
  should be untouched; confirming it is what makes Phase 2 safe to attempt later.

### 7.4 Rollback

Per graph, the change is one added node, one rewired connection and one added
parameter on N nodes. `mcp__n8n__get_workflow_history` / `restore_workflow_version`
returns a graph to its pre-change version; the version IDs recorded in §1's table
are the pre-change baselines for all nine and should be kept until every graph is
verified.

---

## 8. Changes this design needs in files not touched here

Listed rather than made, because each belongs to work in flight elsewhere.

| File | Change needed | Why it is not made here |
|---|---|---|
| `src/shared/escalationRouting.js` | The mapping itself, meeting §6's contract | Owned by the parallel agent; a second copy is the defect being avoided |
| `scripts/setup-zendesk-*.mjs` | Create the per-team groups; expose name → `group_id` | Same owner. Group creation must stay an explicit, deliberate act |
| `src/zendesk/restClient.js` | Add group/assignee support to `updateTicket()` | Explicitly excluded from this pass. Needed by the **portal** path, not by the n8n path — the graphs call Zendesk through the native n8n node and never through this client. Worth stating plainly so nobody adds it *for* n8n and concludes the n8n half is done |
| `scripts/verify-deployed-nodes.mjs` | Nine rows mapping each workflow's `Assign Routing` node to `workflows/nodes/assignRouting.js` | Depends on the port existing |
| `workflows/README.md` | Document the routing node in each graph's node list | Deferred until the graphs actually carry it |
| `CLAUDE.md` §4 | Correct the "Zendesk credential `CRED_ZENDESK_OAUTH` is stale" note — it works, and is now named "Rao" (§3) | Excluded from this pass by instruction |

---

## 9. Summary of what is and is not established

**Established, from live systems:**

- All nine graphs are live and unmodified-since-publish (`versionId ==
  activeVersionId`, checked individually).
- 29 Zendesk write nodes; 26 need a human; none assigns anything today.
- The native n8n Zendesk node **can** set `group` (→ `group_id`) and
  `assigneeEmail` (→ `assignee_email`). **No HTTP Request node is needed**, so
  the credential-stripping cost is avoided entirely.
- The node **cannot** set `priority` via `updateFields`; only the
  `updateFieldsJson` form can, and that form is where an internal note can
  accidentally be made public. Hence the two-phase recommendation.
- `internalNote` → `html_body` + `public: false`; `publicReply` → `body` +
  `public: true`. All 26 human-facing nodes already use `internalNote` and are
  already correct.
- `updateFields.tags` **replaces**; there is no append.
- The account has **one** group, `Support` (`6151578998431`).
- The n8n Zendesk credential works, contrary to CLAUDE.md §4.

**Not established, and deliberately so:**

- Whether the routing node's output is correct for any real use case — the
  mapping does not exist yet. The parity harness is proven; the parity itself is
  unchecked, and the test says so by skipping rather than passing.
- Whether any of this works deployed. Nothing has been deployed.

---

## 10. What happened when this plan was executed (2026-08-19, same day)

All nine graphs now carry `Assign Routing`
(`workflows/nodes/assignRouting.js`, one body deployed byte-identically), and
every one of the 26 human-facing Zendesk nodes consumes it. Deployed in the §7.1
order — UC-07 → 08 → 05 → 03 → 02 → 01 → 04 → 06 → 09 — by
`scripts/deploy-routing-nodes.mjs`, each verified by re-reading the graph
(body byte-identical, wiring, y-coordinate, every consumer carrying
`updateFields.group`, `activeVersionId === versionId`).

`test/n8nRoutingParity.test.js`'s real case, which had been failing on purpose,
now passes. Suite: 1728 → 1740 tests, 0 failing, duration unchanged.

### 10.1 The plan held where it mattered

- **Every §5.3 coordinate was correct** except UC-02's, which the plan gave as
  (2750, 288) and is now (3630, 288) — UC-02 was restructured by parallel work
  after the survey. The deploy script derives the coordinate from the LIVE graph
  rather than from a table, so this needed no edit.
- **The native Zendesk node does assign.** Confirmed on the wire, not from the
  type definition: UC-07 was temporarily deployed with its group id set to `1`
  and driven; Zendesk answered `422 RecordInvalid` naming **`group_id`**. Had
  the expression been a no-op the update would have succeeded silently. This was
  done because with no groups provisioned every route takes the skipped path,
  and a routing node that silently returns nothing is indistinguishable from one
  correctly declining. UC-07 was returned to the real body immediately after and
  re-verified byte-identical.
- **`updateFields.tags` replaces**, exactly as §1.5 said. Routing tags are
  merged into each node's existing array; every proof below checks that the
  graph's own outcome tag survived.
- **Priority was not set**, per §2.5. `zendeskPriority` is emitted and
  parity-checked; nothing consumes it, and the port's header says so.
- **The three auto-path nodes were not touched** and were asserted so against
  the live graphs afterwards: no `group`, no reference to the routing node.

### 10.2 Four places reality differed from the plan

1. **§6's contract was written against a module that shipped differently.** The
   plan asked for `ESCALATION_ROUTING` with `tags: [...]`; what landed is
   `ESCALATION_ROUTES` with `tag: "…"` (one string) plus a `source` citation per
   row. `src/shared/escalationRouting.js` was not changed. The parity test's
   discovery now accepts all four export names and normalises `tag` to a
   one-element array — it compares MEANING, and a spelling difference between a
   source module and a transport format is not drift.

2. **§6.3's `handoffUseCase` needed no module change at all.** `routeFor()` is a
   pure keyed lookup, so resolving `handoffUseCase || useCase` *before* the
   lookup is the entire mechanism. The field is set in
   `workflows/nodes-uc03/travelRouterGates.js`, beside the handoff event that
   already encodes the same decision — not inferred in the routing node from a
   decision string, which would have been a second routing rule living apart
   from the first.

3. **The shared body needed a source for its own use case, which §5.2 did not
   address.** No graph puts a use case on the item. Each writes a *literal*
   `use_case` into `audit_log`, and the Supabase create returns the inserted
   row, so the node reads it back off the row it sits downstream of — the same
   source `Collect Trace Steps` already uses. Six tests were added to drive that
   resolution, because the parity harness supplies `$json.useCase` and **no live
   graph does**: the path production actually takes would otherwise have been
   entirely untested.

4. **§1.5's UC-06 mislabel was fixed rather than filed.** `Unrecognised
   Amendment Decision` is a new leaf node at (2456, 576); the switch's fallback
   output (index 2) points at it, and `escalate` still points at
   `Escalate Amendment Ticket`. It is the shape seven other graphs already use.

### 10.3 The proofs

Each graph driven through its **production webhook, unpinned**, against a real
Zendesk ticket, with the **ticket** read back — never the run status.

| UC | ticket | routing tag on the ticket | outcome tag survived |
|---|---|---|---|
| UC-01 | 31 | `escalation_hr_ops` | `verification_exception` |
| UC-02 | 29 | `escalation_finance_ops` | `uc02_escalated` |
| UC-03 | 26 | `escalation_travel_support` | `uc03_escalated` |
| UC-03 → UC-04 | 27 | `escalation_mobility_legal_t2` | `uc03_routed_uc04` |
| UC-04 | 30 | `escalation_mobility_legal_t2` | `uc04_escalated` |
| UC-05 | 23 | `escalation_hr_ops` | `uc05_escalated` |
| UC-06 | 32 | `escalation_payroll_ops` | `uc06_escalated` |
| UC-07 | 21 | `escalation_mobility_legal_t3` | `uc07_escalated` |
| UC-08 | 22 | `escalation_tax_operations` | `uc08_escalated` |
| UC-09 | 33 | `escalation_payroll_ops` | `uc09_escalated` |

Ticket 27 is §1.4's finding proven in production: a `route_to_uc04` case
carrying **UC-04's** tag, not UC-03's.

> **The tags in this table are what the THEN-DEPLOYED body emitted, and the
> vocabulary has since been split.** Left as recorded rather than rewritten —
> it is a log of live runs, and editing it would falsify the proof. What
> changed: one `escalation_<team>` tag was going onto every ticket, including
> the routine `ready_for_approval`/`human_review` hand-offs, which made the
> escalation rate a constant and (on UC-04) addressed one-click approvals to
> the Tier-2 legal queue. `src/shared/escalationRouting.js` now carries a
> `queue_*` tag for the owning team, applied always, and an `escalation_*` tag
> applied only to a real escalation; UC-04 additionally carries a separate
> `escalationGroup`. All ten runs above escalated, so every tag shown would
> today be joined by its `queue_*` partner rather than replaced — except
> ticket 27, whose `route_to_uc04` is a hand-off rather than an escalation and
> which would now carry `queue_mobility_specialists` alone and go to UC-04's
> specialist rather than to Tier-2 legal. **The split is not deployed:** the
> graphs still run the single-tag body until the routing node is redeployed.

Every note rendered `public: false`. On all ten runs: exactly one
`workflow_claims` row and one `audit_log` row, with `audit_trace` rows present —
so exactly-once still holds and the fan-out ordering was not perturbed. UC-07
was additionally driven twice under one external ref (`claims 1 / dossiers 1 /
audit 1 / trace 1`), the redelivery stopping at `Duplicate Delivery — Stop`.

### 10.4 What remains — one human step

**`scripts/setup-zendesk-groups.mjs` has not been run.** The account still has
exactly one group, `Support` (`6151578998431`), so all ten proofs above landed
there carrying their routing tag and a note saying, in words, that assignment
was skipped and why. Creating groups in a live account is a deliberate act and
was deliberately not done here.

To finish:

```bash
node scripts/setup-zendesk-groups.mjs   # creates the 7 groups (needs `read`+`write` scope)
npm run sync-groups                     # resolves names → ids into the port's GENERATED block
node scripts/deploy-routing-nodes.mjs   # redeploys all nine, idempotently
```

Then re-drive any one webhook and confirm the ticket's `group_id` is the team's,
not `6151578998431`. Nothing else changes — no graph edit, no test change.

**Note on credentials:** `scripts/setup-zendesk-groups.mjs` and
`npm run sync-groups` both read `/api/v2/groups`, which needs the `read` scope.
The shared `ZendeskClient`'s `client_credentials` flow requests only
`tickets:read tickets:write`, so a scoped-down OAuth client 403s on the group
read while its ticket calls work perfectly — a 403 that looks like a broken
credential and is not one.

### 10.5 One correction to §3, and one pre-existing finding left alone

§3's incidental note stands: the n8n Zendesk credential `CRED_ZENDESK_OAUTH` is
**not** stale, is now named "Rao", and authenticated on every one of the ten
runs above. CLAUDE.md §4 still says otherwise.

Left alone deliberately, because it belongs to parallel work in flight on
UC-02: `npm run verify-deployed` reports UC-02's `Expense Gates` body drifted
from its file (the deployed one is *newer* — "the check is now ALWAYS on"), and
`npm run verify-claims` reports UC-02's claim node is no longer on the path to
its first durable write. Both predate this pass, were confirmed present in a
snapshot taken before UC-02 was touched, and were preserved intact by the
routing deploy.
