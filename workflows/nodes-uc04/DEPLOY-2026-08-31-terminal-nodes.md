# UC-04 live-graph deploy — 2026-08-31, the three remaining terminal Zendesk nodes

Everything below is prepared, tested and **not deployed**. It is the sibling of
`DEPLOY-2026-08-31.md`, which covered `Workation Gates` and the FOURTH terminal
node (`Flag Awaiting Specialist Approval`). This one covers the other three:

- `Flag Blocked Workation`
- `Escalate Workation Ticket`
- `Unrecognised Workation Decision`

`WORKFLOW_UC04_ID` was read live on 2026-08-31 (17 nodes, `active: true`,
`versionId === activeVersionId === 50e33f3c-23bc-4e1c-b1d3-016751e57744`) and
the three nodes' parameters below are that capture, verbatim.

Read `CLAUDE.md` §7b before doing any of it. The two rules that matter here:
`PUT /api/v1/workflows/{id}` **publishes in place** (the MCP `update_workflow`
only drafts), and the only thing that answers "is this live?" is
`activeVersionId === versionId` read back afterwards.

**Depends on `DEPLOY-2026-08-31.md`'s change 1.** All three nodes below
interpolate `internalNote`, which only exists once the updated
`Workation Gates` body is deployed. Deploying these three first would give
every blocked/escalated/unrecognised ticket an internal note consisting of the
routing sentence and nothing else — on a fully green execution, with nothing
red anywhere. **Order is not optional.**

---

## Why all three change at once

None of these nodes carries `jsCode`, so `verify-deployed`'s body diff is
structurally blind to them and
`scripts/lib/unguarded-node-baseline.json` baselines them as unguarded. The
prose they write onto real customers' tickets was versioned by nothing — typed
once into a node parameter and read back by no check.

`composeInternalNote()` in `workflows/nodes-uc04/workationGates.js` has emitted
a correct, stage-aware note for **every** decision since
`DEPLOY-2026-08-31.md`'s change 1 — its own comment says the other three nodes
can adopt it "without this file changing again". Only the approval node did. So
the graph has been carrying two descriptions of each decision, one correct and
unread.

What the three retired sentences got wrong is enumerated in
`workflows/nodes-uc04/terminalZendeskNodesSpec.js`'s header, with the evidence.
In one line each:

| node | retired sentence | what is wrong with it |
|---|---|---|
| `Flag Blocked Workation` | "Blocked by the risk matrix or employer permission — not open to approval here." | accurate for **5 of the 12** reachable blocked reasons. FALSE for `factors_invalid` (risk is literally `null` — nothing was computed) and for `sanctioned_region` (a jurisdiction fact, decided before any matrix lookup). Misleading for five form errors. |
| `Escalate Workation Ticket` | "Not open to 1-click approval here." | true, and implies a slower Zendesk approval exists. **None does, on any surface**: `approvalPolicy` 403s `not_awaiting_approval`, the ZAF UC-04 panel has no `renderActions` at all, `/remoteui` diverts blocked rows and 404s a direct POST. |
| `Escalate Workation Ticket` | "ESCALATED to **Mobility Legal Tier-2**" | names a group that does not exist. The live group is **`Mobility & Legal (Tier-2)`**, id `99900000000009`. The same paragraph then appends `routingNote`, which spells it correctly — one team, twice, six words apart, in two spellings, one unsearchable. `docs/ESCALATION-DESTINATIONS.md` §2.2. |
| `Unrecognised Workation Decision` | "Automation produced an unrecognised decision (…). Routed to a human rather than dropped." | not false — just unversioned, and it discards everything `composeInternalNote()` knows. |

**What this deploy does NOT fix.** `composeInternalNote()` embeds `summary`,
and `draftSummaryTemplate()` in the same file still writes "Blocked by the risk
matrix — not open to approval here." and "Escalated to Mobility Legal Tier-2;
not open to 1-click approval here." So the rendered ticket keeps a copy of two
of the three sentences above; what this deploy removes is the node's own copy,
and it puts the remaining one behind a file `verify-deployed` diffs byte for
byte. Follow-up site: `draftSummaryTemplate()`'s `blocked` / `escalate`
branches, which mirror `src/uc04/requestParser.js`'s wording and should move
with it. Verified by executing the current body: a `factors_invalid` run
renders "Risk-matrix level: unknown. Blocked by the risk matrix — not open to
approval here." — the note contradicting itself inside one line.

---

## The expression, and why it addresses `$('Workation Gates')`

All three nodes get the **same** `internalNote`. The per-decision difference is
composed upstream, in a file that is diffed, rather than typed three times into
three node parameters where three copies drift independently — which is exactly
how the three different wrong sentences above came to exist.

```
={{ $('Workation Gates').item.json.internalNote }}

{{ $('Assign Routing').item.json.routingNote }}
```

**Not `$json`.** At these three nodes `$json` is whatever `Assign Routing` last
emitted, and `Assign Routing` spreads the Supabase insert response it received
upstream — it does not carry the gates' fields at all. Every other expression on
all three nodes already addresses `$('Workation Gates')` for the same reason.
Getting it wrong is **silent**: an n8n expression that dereferences a field
nothing produces renders as an EMPTY STRING on a fully green execution.

The routing sentence is **appended here** rather than composed into
`internalNote`, because it is produced downstream of the gates — `Assign
Routing` has not run when the gates run, so the group and tags it resolves do
not exist yet. Same split, same reason, as `flagAwaitingApprovalSpec.js`.

---

## Change 1 — `Flag Blocked Workation`

Type `n8n-nodes-base.zendesk`. `authentication`, `operation`, `parameters.id`
and credentials **unchanged**.

**`updateFields.internalNote`**

- old:
  ```
  =AI summary — decision: blocked ({{ $('Workation Gates').item.json.reason }}). Flags: {{ $('Workation Gates').item.json.flags.join(", ") || "none" }}. Blocked by the risk matrix or employer permission — not open to approval here. {{ $('Assign Routing').item.json.routingNote }}
  ```
- new: the expression above.

Nothing is lost: the reason and the flags the old note printed are both on the
composed note's `Assessment:` line.

**`updateFields.status`** — unchanged (`pending`). Zendesk's "waiting on
somebody who is not us", which is what a blocked request is: waiting on the
requester to re-submit, or on nobody. `open` would put it in an agent's active
view claiming otherwise.

**`updateFields.tags`** — unchanged. `routingTag` is **already** the queue tag
here (`isEscalation('blocked')` is false), so D-14's extra tag below would be
redundant.

```json
{
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "internalNote": "={{ $('Workation Gates').item.json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
  "status": "pending",
  "tags": [
    "uc04_blocked",
    "={{ $('Assign Routing').item.json.routingTag }}"
  ]
}
```

---

## Change 2 — `Escalate Workation Ticket`

Two changes on this node: the note, and **one added tag**.

**`updateFields.internalNote`**

- old:
  ```
  =AI summary — ESCALATED to Mobility Legal Tier-2: {{ $('Workation Gates').item.json.reason }}. Flags: {{ $('Workation Gates').item.json.flags.join(", ") || "none" }}. Not open to 1-click approval here. {{ $('Assign Routing').item.json.routingNote }}
  ```
- new: the expression above.

**`updateFields.tags`** — rca-iih7 / D-14, already fixed on UC-01's
`Escalate Ticket` and never generalised.

- old: `["uc04_escalated", "={{ $('Assign Routing').item.json.routingTag }}"]`
- new: `["uc04_escalated", "={{ $('Assign Routing').item.json.routing.queueTag }}", "={{ $('Assign Routing').item.json.routingTag }}"]`

**Why.** `Assign Routing` sets `routeTags = escalated ? [queueTag,
escalationTag] : [queueTag]` and builds `routingNote` from
`routeTags.join(', ')` — so on an escalation the note **claims both tags were
applied**. But `routingTag`, the single value this node appends, resolves to
`escalationTag` alone when escalated. So the ticket says
`tagged queue_mobility_specialists, escalation_mobility_legal_t2` and carries
only the second, and a Zendesk view built on the tag the note names shows
nothing — the failure `docs/APPROVAL-QUEUE.md` exists to catch.

Read by node name (`routing.queueTag`) rather than by indexing `zendeskTags[0]`,
so a future reordering of that array cannot silently repoint it at the wrong
element.

**`updateFields.status`** — unchanged (`open`). This IS queued work for a human
here, which is exactly the distinction `pending` would erase.

```json
{
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "internalNote": "={{ $('Workation Gates').item.json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
  "status": "open",
  "tags": [
    "uc04_escalated",
    "={{ $('Assign Routing').item.json.routing.queueTag }}",
    "={{ $('Assign Routing').item.json.routingTag }}"
  ]
}
```

---

## Change 3 — `Unrecognised Workation Decision`

**`updateFields.internalNote`**

- old:
  ```
  =Automation produced an unrecognised decision ({{ $('Workation Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}
  ```
- new: the expression above.

The decision value the old note printed is on the composed note's `Assessment:`
line, and the composed note's own unrecognised branch already says "routed to a
human rather than dropped. Nobody has been asked to approve anything."

**No queue tag here, and the reason is not airtight — it is stated so the next
reader does not have to re-derive it.** `isEscalation()` returns **true** for a
missing or blank decision — **and that is precisely the input this branch
exists to catch**, which is why the queue tag IS applied here after all.

**REVISED 2026-08-31, after the reasoning above was shown wrong.** An earlier
draft of this section withheld the queue tag from this node, arguing that a
non-escalate decision leaves `escalated` false so `routingTag` already resolves
to the queue tag. That holds for `blocked`, and for a present-but-unknown
decision STRING. It does not hold for a MISSING one:

| input | `isEscalation()` | consequence |
|---|---|---|
| `"escalate"` | true | defect fires |
| `"blocked"` | false | no defect — `routingTag` IS the queue tag |
| `"weird_new_decision"` | false | no defect |
| `null` / `undefined` / `""` / non-string | **true** | **defect fires** |

`isEscalation()` fails that way deliberately — *"a missing signal takes the
stronger treatment"* — which is correct routing behaviour and is exactly what
makes this node's note wrong on that input. UC-01's own fix covers both its
escalate and its unrecognised node; that was read live, and it is the confirming
evidence. The two halves differ in EVIDENCE, not in shape: the escalate node is
wrong on every escalation (nine observed live tickets, rca-iih7), this one only
on a missing decision (reachable by construction, no live instance observed).

The tag dimension for all fourteen affected nodes across all nine graphs is
owned by `workflows/nodes/escalationQueueTagSpec.js`; this file and that one are
held equal for UC-04's two nodes by a cross-spec test, so publishing from either
cannot revert the other.

```json
{
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "internalNote": "={{ $('Workation Gates').item.json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
  "status": "open",
  "tags": [
    "uc04_exception",
    "={{ $('Assign Routing').item.json.routing.queueTag }}",
    "={{ $('Assign Routing').item.json.routingTag }}"
  ]
}
```

---

## Optional, and separable — the intake loop guard

`DEPLOY-2026-08-31.md`'s change 3 argues for adding `uc_processed` to **all
four** terminal Zendesk nodes, with the risk it carries. If it is applied, add
it to each `tags` array above. `terminalZendeskNodeIssues()` checks tags by
CONTAINMENT, so an extra tag does not turn `verify-deployed` red — asserted by
`test/n8nUc04TerminalZendeskNodes.test.js`.

---

## Reading it back

```
GET /api/v1/workflows/WORKFLOW_UC04_ID
```

For each of the three nodes, assert on the returned node:

- `updateFields.internalNote` contains
  `{{ $('Workation Gates').item.json.internalNote }}` **and**
  `{{ $('Assign Routing').item.json.routingNote }}`;
- `updateFields.tags` contains every entry in the block above;
- `updateFields.group` is `={{ $('Assign Routing').item.json.zendeskGroupId }}`
  and `parameters.id` is `={{ $('Workation Gates').item.json.externalRef }}`;
- `JSON.stringify(updateFields)` contains **none** of
  `blocked by the risk matrix`, `not open to 1-click approval`,
  `mobility legal tier-2`, `one mobility specialist`,
  `mobility specialist's approval`.

`blockedNodeIssues(node)` / `escalateNodeIssues(node)` /
`unrecognisedNodeIssues(node)` in
`workflows/nodes-uc04/terminalZendeskNodesSpec.js` are that check as functions —
point each at its live node and it must return `[]`.

Then `npm run verify-deployed` must report **0 drifted**, and it must not exit
2: exit 2 means it could not reach n8n, never that the nodes are clean.

## Proving it afterwards

`uc04_test` matched **0 tickets** on `your-subdomainhelp` when
`DEPLOY-2026-08-31.md` was written, and all 20 real UC-04 tickets are
portal-raised carrying `uc04`, not `uc04_test` — so nothing drives this graph on
its own. To prove the deploy, raise one ticket carrying `uc04_test` **and** the
employment field `9990000000001`, with factors that reach a **blocked**
decision (the cheapest: a start date in the past, or `visaType: esta_usa`), then
**read the ticket's internal note back** rather than the run status. A green
node that wrote an empty note is the exact failure this expression can produce.
