# DEPLOY 2026-08-31 — the queue tag on the fourteen terminal Zendesk nodes (rca-iih7 / D-14)

**Status: NOT DEPLOYED.** This document is the paste-ready change and its
verification steps. Nothing in the repo pass that produced it wrote to n8n; the
n8n access used was read-only `GET /api/v1/workflows/:id`.

## What changes, and what does not

Each of the fourteen nodes below gains **one array element** in
`parameters.updateFields.tags`:

```
={{ $('Assign Routing').item.json.routing.queueTag }}
```

inserted **immediately before** the existing
`={{ $('Assign Routing').item.json.routingTag }}` entry — the exact shape
UC-01's already-fixed `Escalate Ticket` and `Unrecognised Decision` have carried
since 2026-08-22.

**Nothing else changes.** `id`, `authentication`, `operation`,
`updateFields.group`, `updateFields.status` and `updateFields.internalNote`
differ between graphs and are reproduced under each node below so that a paste
can be *diffed* rather than trusted. The repo's frozen copy of the whole target
is `workflows/nodes/escalationQueueTagSpec.js`
(`ESCALATION_QUEUE_TAG_NODES[].targetParameters`), and
`test/n8nEscalationQueueTag.test.js` asserts that the ONLY difference between
each target and the live capture of 2026-08-31 is the inserted queue tag.

> **⚠️ UC-04 — TAKE THE `tags` ARRAY ONLY.** `Escalate Workation Ticket` and
> `Unrecognised Workation Decision` are also owned, for their PROSE, by
> `workflows/nodes-uc04/terminalZendeskNodesSpec.js`, which rewrites
> `updateFields.internalNote` to read the gates node's composed note. The
> `internalNote` reproduced for those two nodes below is the **pre-change**
> prose captured live; publishing it wholesale after that change lands would
> revert it. That spec also declares its own byte-identical queue-tag constant,
> so the tag dimension is asserted twice today — a known overlap the coordinator
> is reconciling, recorded rather than quietly deduplicated.

## Why (short version — the long one is the spec file's header)

`assignRouting.js` builds the internal note from `routeTags`, which when
`isEscalation()` is true is `[queueTag, escalationTag]` — so the note says
*"tagged queue_hr_ops, escalation_hr_ops"*. The value the Zendesk node actually
appends is `routingTag`, which in that case is the escalation marker **alone**.
The queue tag the note names never lands, and a Zendesk view built on it does
not find the team's own escalations. On UC-01, before the fix, that was nine
real escalations invisible to HR Ops' own view.

## The two halves are not the same claim

| | `Escalate *` (8) | `Unrecognised *` (6) |
|---|---|---|
| when it is wrong | **every escalation** — the decision starts with `escalat`, so `isEscalation()` always matches | **only when the decision is missing or unreadable** — `isEscalation()` returns true for `null`/`undefined`/`""`/non-string, and these sit on `Route by Decision`'s fallback output |
| when it is already right | never | a present-but-unknown string: `isEscalation("weird_new_decision")` is `false`, so `routingTag` already resolves to the queue tag |
| evidence | **nine observed live tickets** on UC-01 (rca-iih7) | **none observed** — reachable by construction |
| fix | identical | identical |

On the already-right input the queue tag will appear twice in `tags`. Zendesk
tags are a set, so a duplicate is a no-op; that is the cost of covering the null
branch, and it is cheaper than a node that is right on one input and silent on
the other.

## The fourteen nodes

| UC | workflowId | node | kind | branch marker |
|---|---|---|---|---|
| UC-02 | `WORKFLOW_UC02_ID` | `Escalate Expense Ticket` | escalate | `uc02_escalated` |
| UC-02 | `WORKFLOW_UC02_ID` | `Unrecognised Expense Decision` | unrecognised | `uc02_exception` |
| UC-03 | `WORKFLOW_UC03_ID` | `Escalate Travel Ticket` | escalate | `uc03_escalated` |
| UC-03 | `WORKFLOW_UC03_ID` | `Unrecognised Travel Decision` | unrecognised | `uc03_exception` |
| UC-04 | `WORKFLOW_UC04_ID` | `Escalate Workation Ticket` | escalate | `uc04_escalated` |
| UC-04 | `WORKFLOW_UC04_ID` | `Unrecognised Workation Decision` | unrecognised | `uc04_exception` |
| UC-05 | `WORKFLOW_UC05_ID` | `Escalate Resignation Ticket` | escalate | `uc05_escalated` |
| UC-05 | `WORKFLOW_UC05_ID` | `Unrecognised Resignation Decision` | unrecognised | `uc05_exception` |
| UC-06 | `WORKFLOW_UC06_ID` | `Escalate Amendment Ticket` | escalate | `uc06_escalated` |
| UC-06 | `WORKFLOW_UC06_ID` | `Unrecognised Amendment Decision` | unrecognised | `uc06_exception` |
| UC-07 | `WORKFLOW_UC07_ID` | `Escalate Relocation Ticket` | escalate | `uc07_escalated` |
| UC-08 | `WORKFLOW_UC08_ID` | `Escalate Tax Inquiry Ticket` | escalate | `uc08_escalated` |
| UC-09 | `WORKFLOW_UC09_ID` | `Escalate Adjustment Ticket` | escalate | `uc09_escalated` |
| UC-09 | `WORKFLOW_UC09_ID` | `Unrecognised Adjustment Decision` | unrecognised | `uc09_exception` |
All fourteen were read live on **2026-08-31**, all eight graphs `active: true`,
and all fourteen carried `["<uc>_<marker>", routingTag]` — i.e. the defect, on
every one.

**UC-01 (`WORKFLOW_UC01_ID`) is deliberately absent: both its affected nodes are
already fixed** (rca-iih7, 2026-08-22) and are owned by
`workflows/nodes/escalationCloseNodesSpec.js`.

**UC-07 and UC-08 contribute one node each, not two.** Neither graph has an
`Unrecognised *` node at all — read live, their only `n8n-nodes-base.zendesk`
node is the escalation one. Both are 🔴 use cases where every decision is an
escalation, so there is no second terminal branch. 8 + 6 = 14.

## Paste-ready, per node

### UC-02 — `WORKFLOW_UC02_ID` — `Escalate Expense Ticket`

```json
[
  "uc02_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(\", \") || \"none\" }}. No auto-approval issued. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-02 — `WORKFLOW_UC02_ID` — `Unrecognised Expense Decision`

```json
[
  "uc02_exception",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-03 — `WORKFLOW_UC03_ID` — `Escalate Travel Ticket`

```json
[
  "uc03_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(\", \") || \"none\" }}. No letter was issued. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-03 — `WORKFLOW_UC03_ID` — `Unrecognised Travel Decision`

```json
[
  "uc03_exception",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-04 — `WORKFLOW_UC04_ID` — `Escalate Workation Ticket`

```json
[
  "uc04_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Workation Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI summary — ESCALATED to Mobility Legal Tier-2: {{ $('Workation Gates').item.json.reason }}. Flags: {{ $('Workation Gates').item.json.flags.join(\", \") || \"none\" }}. Not open to 1-click approval here. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-04 — `WORKFLOW_UC04_ID` — `Unrecognised Workation Decision`

```json
[
  "uc04_exception",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Workation Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=Automation produced an unrecognised decision ({{ $('Workation Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-05 — `WORKFLOW_UC05_ID` — `Escalate Resignation Ticket`

```json
[
  "uc05_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Notice Period Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI summary — ESCALATED: {{ $('Notice Period Gates').item.json.reason }}. Flags: {{ $('Notice Period Gates').item.json.flags.join(\", \") || \"none\" }}. No report was prepared for sign-off. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-05 — `WORKFLOW_UC05_ID` — `Unrecognised Resignation Decision`

```json
[
  "uc05_exception",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Notice Period Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=Automation produced an unrecognised decision ({{ $('Notice Period Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-06 — `WORKFLOW_UC06_ID` — `Escalate Amendment Ticket`

```json
[
  "uc06_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Amendment Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI summary — ESCALATED: {{ $('Amendment Gates').item.json.reason }}. Flags: {{ $('Amendment Gates').item.json.flags.join(\", \") || \"none\" }}. Amendment record {{ $('Create Amendment Record').item.json.id }} created for reference; this request needs manual payroll/HR handling and will not go through dual approval. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-06 — `WORKFLOW_UC06_ID` — `Unrecognised Amendment Decision`

```json
[
  "uc06_exception",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Amendment Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=Automation produced an unrecognised decision ({{ $('Amendment Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-07 — `WORKFLOW_UC07_ID` — `Escalate Relocation Ticket`

```json
[
  "uc07_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Relocation Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Relocation Gates').item.json.dossier.narrative }} RESEARCH SUPPORT ONLY, not a decision to proceed. For review by a qualified Remote Mobility Legal specialist. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-08 — `WORKFLOW_UC08_ID` — `Escalate Tax Inquiry Ticket`

```json
[
  "uc08_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Build Dossier').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Build Dossier').item.json.narrative }} RESEARCH SUPPORT ONLY, not a determination. For review by a qualified Remote Tax Operations specialist. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-09 — `WORKFLOW_UC09_ID` — `Escalate Adjustment Ticket`

```json
[
  "uc09_escalated",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Adjustment Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=AI summary -- ESCALATED: {{ $('Adjustment Gates').item.json.reason }}. Flags: {{ $('Adjustment Gates').item.json.flags.join(\", \") || \"none\" }}. Adjustment record {{ $('Create Adjustment Record').item.json.id }} created for reference; this request needs manual payroll handling, no approval path was offered. {{ $('Assign Routing').item.json.routingNote }}"
}
```

### UC-09 — `WORKFLOW_UC09_ID` — `Unrecognised Adjustment Decision`

```json
[
  "uc09_exception",
  "={{ $('Assign Routing').item.json.routing.queueTag }}",
  "={{ $('Assign Routing').item.json.routingTag }}"
]
```

Unchanged in the same node, reproduced so a paste can be diffed rather than trusted:

```json
{
  "id": "={{ $('Adjustment Gates').item.json.externalRef }}",
  "authentication": "oAuth2",
  "operation": "update",
  "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  "status": "open",
  "internalNote": "=Automation produced an unrecognised decision ({{ $('Adjustment Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}"
}
```

## Publishing — this is a production change the moment the PUT returns 200

These are eight **live, active** graphs answering real Zendesk tickets. There is
no promote step and no second look at the diff.

1. **`PUT /api/v1/workflows/{id}` publishes in place.** The n8n MCP's
   `update_workflow` writes a DRAFT instead — two tools, two opposite defaults.
   Whichever is used, the only thing that answers *"is this live?"* is
   `activeVersionId === versionId` on a fresh `GET`.
2. **`settings` must be filtered to the allowed whitelist on the PUT, or the
   API answers `400 settings must NOT have additional properties`.** The API
   *returns* keys on read (`availableInMCP`, `binaryMode`) that it then
   *refuses* on write, so echoing back what was read fails. The whitelist, the
   same one `scripts/deploy-node.mjs` and `scripts/deploy-routing-nodes.mjs`
   already use:

   ```
   executionOrder, saveDataErrorExecution, saveDataSuccessExecution,
   saveManualExecutions, saveExecutionProgress, executionTimeout,
   errorWorkflow, timezone, callerPolicy, callerIds
   ```

   The PUT body is `{ name, nodes, connections, settings }` — read-only fields
   are rejected on write, so send nothing else.
3. **Strip any trailing dot or slash from `N8N_BASE_URL`.** A trailing dot makes
   the n8n REST API return **HTTP 200 with a zero-byte body** — not an error,
   not a timeout, a success code with nothing in it, which every JSON parser
   reports as a parse failure rather than a connectivity one.
4. From this container, every call needs **`NODE_USE_ENV_PROXY=1`**: Node's
   global `fetch` ignores `HTTPS_PROXY`, and a direct connection is refused with
   `403 Host not in allowlist` even when the host *is* allowlisted.
5. **Sequence UC-04 against the parallel prose change** rather than racing it.
   Whichever lands second must re-read the node and re-apply only its own
   dimension; publishing a stale whole-`parameters` blob is how one fix silently
   reverts the other.

**Ordering note.** The Zendesk-first/n8n-second rotation order is **not**
relevant here — that rule governs the shared `X-YOUR-WEBHOOK-TOKEN` secret,
which lives in two systems. This change is n8n-only: nothing in Zendesk holds a
copy of these tag expressions, no Zendesk record needs touching, and there is
no window in which the two can disagree.

## Verifying it landed — check the destination, never the run flag

1. **Read each node back** off `GET /api/v1/workflows/{id}` and diff
   `parameters.updateFields.tags` against
   `ESCALATION_QUEUE_TAG_NODES[].targetUpdateFields.tags`. Confirm
   `activeVersionId === versionId` on each of the eight graphs.
2. **`npm run verify-deployed`** — once `STRUCTURAL_MAPPINGS` rows are wired for
   these fourteen (owned by a separate work item; do not edit
   `scripts/lib/deployedNodeMappings.mjs` from here), it runs
   `escalationQueueTagIssues()` against the live nodes. It exits **2**, never 0,
   when it cannot reach n8n, so its silence is never a pass.
3. **The only proof that counts is a real ticket.** Drive one escalation through
   a production webhook and read the TICKET's tag list back off the Zendesk API
   — not the n8n node's status. `queue_<team>` **and** `escalation_<team>` and
   the branch marker must all be present, and the team's own Zendesk view must
   now contain the ticket. A pinned n8n node reports `success` having done
   nothing; a green execution is not evidence the tag reached Zendesk.
4. **The six `Unrecognised *` nodes cannot be proven the same way**, and that is
   worth stating rather than glossing: their affected input is a run whose
   decision is missing or unreadable, which no ordinary ticket produces. Their
   fix is proven by the target diff and by
   `test/n8nEscalationQueueTag.test.js`'s `isEscalation()` branch test, not by a
   live escalation.
