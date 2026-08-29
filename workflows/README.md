# n8n workflows

## Naming convention

This n8n instance hosts more than one project, so every workflow belonging to
this one carries a prefix, and the list is designed to be scannable without
opening anything.

    RCX UC-01 🟢 Employment Verification
    RCX UC-02 🟢 Expense & Receipt Validation
    RCX UC-03 🟢 Travel Letter / Workation Router
    RCX UC-04 🟡 Work Authorization / Workation
    RCX UC-05 🟡 Resignation Notice Calculation
    RCX UC-06 🟡 Contract Amendment / Payroll Cutoff
    RCX UC-07 🔴 Global Mobility / Permanent Relocation
    ⚠️ 2026-08-21: the normalizer sets `plan: {}` for EVERY Zendesk-originated
       request — correctly, since nothing in a ticket body may be read as a
       destination start date — and the gates' defaults then guarantee `BLOCK`.
       All seven live dossiers are BLOCK with uncertainty pinned at 1. DECIDED
       (DRIFT-034, `R-11`): emit `verdict: NOT_ASSESSABLE` / `planSource: "none"`
       instead of a verdict about the relocation. `normalizeRelocationRequest.js`
       is covered by ONE assertion in the whole suite — "the body is
       syntactically valid" — which is how this survived. NOT YET BUILT.
    RCX UC-08 🔴 Cross-Border Tax & Social Security
    RCX UC-09 🔴 Off-Cycle Payroll Adjustment
    RCX OPS   · Error Alerts (all use cases)
    RCX SETUP · Zendesk webhook + trigger (one-shot)

Three deliberate choices:

- **`RCX` prefix** groups every workflow in this project together in an
  alphabetical list, and distinguishes them from the WhatsApp campaign
  workflows (`WA …`, `Watchdog …`, `Ops Alerts …`) sharing the instance.
- **The tier emoji encodes the risk tier**, which is this system's central
  organising idea — 🟢 automated, 🟡 needs human approval, 🔴 no execution path
  exists. It is the first thing worth knowing about a workflow when something
  breaks, so it belongs in the name rather than in a doc.
- **`OPS` and `SETUP`** sort after the nine use cases, because they are
  infrastructure rather than customer-facing automation.

**Tags carry the same information on a second axis**, so the list can be
filtered as well as sorted: `remote-cx` on all eleven, plus `tier-green` /
`tier-amber` / `tier-red` on the nine use cases.

**`UC-0N` must stay in the name.** `RCX OPS · Error Alerts` derives the failing
workflow's tier by locating `UC-0` in its name and reading the next character.
Renaming a workflow so that substring disappears would silently downgrade every
alert from it to "unknown tier" — the alert would still arrive, just less
useful, which is the kind of degradation nobody notices.

### Credentials

`Remote_CX_Auto` (telegramApi) is this project's own alert bot. The
`iKANWEBLEADbot` credential on the same instance belongs to a different project
and must not be used here — it was briefly wired into the CX error handler by
mistake, and two test alerts reached the wrong chat before it was removed.

---

**UC-01 — Employment Verification** is live:
`https://n8n.your-host.example/workflow/WORKFLOW_UC01_ID`

14 nodes, built through the n8n Workflow SDK.

**Correction (2026-08-01).** This file previously described execution `10` as
"a real execution … through to audit." It was not: execution `10`'s
`Append Audit Log` node was **pinned**, returning `{ success: true }` from pin
data without touching Supabase. The same was true of executions `11`–`17`. The
first execution to write a real `audit_log` row from n8n is `22`
(row `d7b067a1-d402-43f3-a6d9-6c3a76548c85`) — see "Audit ordering" below.

**UC-06 — Contract Amendment / Payroll Cutoff** and **UC-08 — Cross-Border
Tax & Social Security** are built, dry-run verified, and **now ACTIVE**
(2026-08-10, explicit user go-ahead — see the resolved-discrepancy note above):
- `https://n8n.your-host.example/workflow/WORKFLOW_UC06_ID` (UC-06, 11 nodes)
- `https://n8n.your-host.example/workflow/WORKFLOW_UC08_ID` (UC-08, 7 nodes)

Both are credentialed against the same real Remote Sandbox / OpenAI / Zendesk /
Supabase accounts as UC-01, dry-run via `mcp__n8n__test_workflow` with pinned
data, and their Code node bodies are parity-tested (`test/n8nUc06Parity.test.js`,
`test/n8nUc08Parity.test.js`) against `src/uc06/` and `src/uc08/` the same way
UC-01's `gates.js` is. See §7 below for what's still deliberately manual about
inbound delivery, and `docs/BUILD-LOG.md` §3.12 for the full build write-up.

**UC-02, UC-03, UC-04, UC-05, UC-07, UC-09 — all six remaining use cases now
have a built n8n graph, and are also now ACTIVE** (2026-08-10, same
go-ahead), closing out node-graph coverage AND activation for all nine:
- `https://n8n.your-host.example/workflow/WORKFLOW_UC02_ID` (UC-02, 19 nodes)
- `https://n8n.your-host.example/workflow/WORKFLOW_UC03_ID` (UC-03, 15 nodes)
- `https://n8n.your-host.example/workflow/WORKFLOW_UC04_ID` (UC-04, 11 nodes)
- `https://n8n.your-host.example/workflow/WORKFLOW_UC05_ID` (UC-05, 10 nodes)
- `https://n8n.your-host.example/workflow/WORKFLOW_UC07_ID` (UC-07, 6 nodes)
- `https://n8n.your-host.example/workflow/WORKFLOW_UC09_ID` (UC-09, 12 nodes)

> **RESOLVED 2026-08-10 — activation-state discrepancy.** An earlier pass this
> session found UC-02, UC-04, UC-05, and UC-07 unexpectedly `"active": true"`,
> contradicting this project's standing rule that every activation needs a
> fresh, explicit human go-ahead. The user has since confirmed directly that
> the activation was intentional — done deliberately for full production-ready
> confirmed system testing across all nine use cases, not an accident or a
> stray prior-session action. Given that, and with an explicit fresh go-ahead
> for the remaining five, **all nine UC workflows (UC-01 through UC-09) are
> now active**, verified live via `mcp__n8n__search_workflows` immediately
> before and after: `WORKFLOW_UC01_ID` (UC-01), `WORKFLOW_UC02_ID` (UC-02),
> `WORKFLOW_UC03_ID` (UC-03), `WORKFLOW_UC04_ID` (UC-04), `WORKFLOW_UC05_ID`
> (UC-05), `WORKFLOW_UC06_ID` (UC-06), `WORKFLOW_UC07_ID` (UC-07),
> `WORKFLOW_UC08_ID` (UC-08), `WORKFLOW_UC09_ID` (UC-09). This means every one
> of them will process a real webhook call right now, including UC-02's real
> `PATCH /v1/expenses/:id` write on its `auto_approve` branch and UC-06/UC-09's
> real Supabase amendment/adjustment writes once their approval gates are
> filled. **Real (unpinned) execution verification proving actual writes land
> in Supabase for each — not just a green `test_workflow` pin — is the
> immediate next step, not yet done as of this note.**

---

## Webhook authentication — all nine, since 2026-08-27

Every production webhook requires the header `X-YOUR-WEBHOOK-TOKEN`. An
unauthenticated POST gets `403` and **no execution is created**.

- Zendesk side: nine webhook records with `authentication.type: api_key`,
  `add_position: header`.
- n8n side: one `httpHeaderAuth` credential, `n8n Secure Zendesk Comm`
  (`CRED_WEBHOOK_HEADER_AUTH`), selected on all nine webhook nodes.
- Check it: `npm run verify-webhook-auth` — exits **2**, never 0, when it
  cannot reach n8n.

**If you rotate the secret, do Zendesk FIRST and n8n SECOND.** n8n ignores a
header it is not checking for, so the first step changes nothing; by the time
n8n enforces, every delivery already carries the credential and nothing fails.
Do it the other way and deliveries return 403 — and a Zendesk webhook that
fails once circuit-breaks and cannot be repaired, only replaced, nine times.

**Do not select `Remote Sandbox- Christina` in that credential dropdown.** It
is the same *type* and the opposite *direction* — the outbound Remote API
token, used by 15 nodes across seven graphs. It has been selected by mistake
once already.

Full record and three traps that each cost real time: `docs/WEBHOOK-AUTH.md`.

## UC-01: the node graph

```
Zendesk Ticket Webhook (POST /uc-01-verification)
  └─ Normalize Ticket            (Code)  ticket → internal shape + LLM request
      └─ Classify Request (LLM)  (HTTP)  OpenAI, continues on error
          └─ Validate Classification (Code)  strict shape check + rule fallback
              └─ Fetch Employment (Remote) (HTTP)  the authoritative record
                  └─ Identity + Policy Gates (Code)  ← the decision. No AI here.
                  └─ Append Audit Log       (Supabase)  ← BEFORE any outward action
                      └─ Carry Context Forward (Code)   restores the decision context
                          └─ Route by Decision (Switch)
                              ├─ auto_resolve  → Render Letter → Reply + Solve
                              ├─ human_review  → Flag for Specialist Review
                              ├─ escalate      → Escalate Ticket
                              └─ unrecognised  → Unrecognised Decision
```

This is `src/uc01/workflow.js` redrawn — same order, same gates, same
guarantees. Three properties are deliberate:

- **The LLM is one node, and it is not the decision.** It classifies; the next
  node validates its output against a strict shape and falls back to rules on
  any failure. Nothing unvalidated reaches a gate.
- **The Switch has a fallback output.** An unexpected `decision` value routes to
  a human rather than being silently dropped — n8n's default is to drop.
- **Every branch writes an audit row**, and it is written *before* the branch
  runs. Including the branches where nothing happened, because "we decided not
  to act" is the entry you most want later. See "Audit ordering" below.

## Audit ordering — a bug this graph used to have

Until 2026-08-01 `Append Audit Log` sat **downstream** of all four Zendesk
nodes. Two consequences, neither hypothetical:

1. **A Zendesk failure destroyed the audit trail.** Execution `18` is the
   proof: the gates correctly reached `escalate` on real Sandbox data, then
   `Escalate Ticket` got a `404 RecordNotFound`, and the run stopped — no
   audit row was ever written for a decision the system had genuinely made.
2. **On `auto_resolve`, a customer-facing reply went out and the ticket was
   solved *before* anything was durably recorded.** For a system whose first
   invariant is "audit everything," that ordering is backwards.

`src/uc01/workflow.js` already had this right — it audits at STEP 7 and only
then calls Zendesk at STEP 8, with a comment stating that the internal records
"are already durable regardless of whether this succeeds." So the fix was
**parity with the Node path**, not a new design: the audit node moved ahead of
`Route by Decision`.

Two details worth knowing:

- **`Carry Context Forward` exists because the Supabase node returns its own
  insert response** (`{ id, at, use_case, … }`), not the decision context. That
  one-line Code node restores it, so the Switch, letter renderer and all four
  Zendesk nodes kept their expressions unchanged — a deliberately small blast
  radius on a live workflow.
- ~~`letterIssued` is now derived from the decision (`decision ===
  'auto_resolve'`) rather than from the rendered letter, because the letter is
  rendered after the audit write. No information is lost: … `Boolean
  (letterHtml)` and `decision === 'auto_resolve'` are the same predicate.~~
  **WRONG, and fixed by rca-9lrm (the n8n counterpart of rca-5vdx / commit
  7e02e6c) — GROUND 1 of the round-7 UC-01 verdict.** "No information is
  lost" was true of a successful run and false of a failed one: a render or
  persist failure on the auto_resolve branch left `letterIssued: true`
  written for a letter that was never rendered or stored, because this node
  runs before "Render Letter"/"Prepare Document"/"Persist Document" even
  attempt anything. `Append Audit Log` now always writes the honest default
  (`letterIssued: false, letterDocumentId: null, letterContentHash: null`),
  and a new node, `Update Audit Log With Letter`, sits between "Persist
  Document" and "Carry Context After Persist Document" and patches that SAME
  row to `letterIssued: true` plus the real `letterDocumentId`/
  `letterContentHash` — but only once "Persist Document" has actually
  returned a real inserted `documents` row. See
  `workflows/nodes/updateAuditLogWithLetterSpec.js` for the full design.

Verified by execution `22`: same fake ticket id as execution `18`, so
`Reply + Solve Ticket` still 404s — but `Append Audit Log` succeeded at
execution index 6 while the Zendesk node failed at index 10, and the row is in
Supabase. The audit now survives the failure that used to erase it.

---

## Exactly-once delivery: the `Claim Ticket (Idempotency)` node

A webhook is an **at-least-once** delivery system. Zendesk retries a slow
response, a trigger can fire twice on rapid ticket updates, and a customer can
double-submit a form. None of that is exceptional — it is normal traffic. What
is exceptional is what a graph does about it, and until this pass eight of the
nine graphs did nothing about it at all.

UC-01 paid for the lesson in public. Zendesk ticket **#5** received three
near-simultaneous trigger invocations and produced **two `audit_log` rows 30µs
apart** — and a **second verification letter posted publicly to the customer**.
Nothing in the graph had asked "have I already handled this one?" The same
shape of duplicate, on the other eight, would mean an expense approved twice, an
amendment recorded twice, or a dossier raised twice.

All nine graphs now carry the same three nodes:

```
… Gates
  └─ Claim Ticket (Idempotency)   (Supabase, row-create on workflow_claims)
      ├─ main  → Carry Context After Claim (Code) → <first durable write> → …
      └─ error → Duplicate Delivery — Stop (NoOp)
```

**The per-use-case diagrams below this section are drawn without these nodes.**
Read every `… Gates → <first durable write>` edge in them as
`… Gates → Claim Ticket (Idempotency) → Carry Context After Claim →
<first durable write>`.

### The guarantee is the PRIMARY KEY, not the node

`workflow_claims` is keyed `PRIMARY KEY (use_case, external_ref)`. The claim
node attempts exactly one INSERT:

- **first delivery** — the insert succeeds, the run leaves by the main output
  and carries on;
- **any later delivery** — the insert violates the key, the run leaves by the
  error output, and stops having written nothing.

Postgres adjudicates, in one statement. This is the whole point, and it is why
the node is a Supabase row-create rather than a Code node that reads the table
and then decides: a read-then-write has a gap between the two, and a concurrent
delivery walks straight through it. That gap is not hypothetical — it is
precisely the race that gave ticket #5 two audit rows 30µs apart. Application
logic cannot close it; a unique key already has.

`onError: "continueErrorOutput"` on the claim node is what makes a conflict an
*expected outcome* rather than a failed execution.

### Why it sits exactly there

**After the gates**, because re-deciding costs nothing and leaves no trace —
reading an employment record and running deterministic gates changes no state
— and because a duplicate stopped earlier never records *why* it was stopped.
The claim row carries the decision for exactly that reason (forensics only; it
is never read back into a decision).

**Before the first durable write**, because everything downstream of that point
is either a record or an outward act: a Supabase row, a Zendesk reply, a Remote
`PATCH`. Those are the things that must not happen twice.

### Why it is keyed by use case as well as by reference

One ticket may legitimately reach two use cases — UC-03 routes a travel inquiry
on to UC-04. Keying the ledger on the external reference alone would let the
first use case's claim silently swallow the handoff, and **a dropped request is
a worse failure than the duplicate the ledger exists to prevent**: a duplicate
is visible in the audit log and surfaced by `findRedundantCalls()` in the
metrics layer, whereas a request that vanished looks exactly like nothing ever
happened, and nobody knows to go looking for it.

### One ledger, both execution paths

`workflow_claims` is shared by these graphs and by the Node app
(`src/shared/workflowClaims.js`, `claimExternalRef()`). Two ledgers would not
have helped — each execution path would read the other's references as
unclaimed and duplicate its work anyway. Exactly-once is a property of *shared
durable state*, so there can only be one.

### Why the duplicate branch is silent

`Duplicate Delivery — Stop` is a NoOp: the run ends green having written
nothing. Routing a redelivery to an error instead would page a human every time
Zendesk behaved completely normally, and an alert channel that cries wolf is
worse than no alert channel. The claim row already in the table is the record
that the delivery arrived.

### `Carry Context After Claim` exists for the same reason `Carry Context Forward` does

The Supabase node emits its own insert response, not the decision context, so a
one-line Code node restores the gates' output — the same trick, and the same
small blast radius, as the audit-ordering fix above: no downstream expression
had to change when the claim node was inserted.

It sets `pairedItem` explicitly. Several of these graphs address the gates node
**by name** (`$('Workation Gates').item`), which resolves through n8n's item
pairing; a Code node that returns a bare object breaks that chain, and the
failure surfaces as "can't determine which item to use" in a node far away from
the one that actually caused it.

### Per-workflow placement, and what is actually proven

| Use case | Gates node (last node holding the decision) | First durable write (claim goes immediately before it) | Live status |
|---|---|---|---|
| UC-01 | `Identity + Policy Gates` | `Append Audit Log` | Claim node added ahead of this pass — see `CLAUDE.md` §4; confirm `activeVersionId === versionId` before relying on it |
| UC-02 | `Expense Gates` | `Append Audit Log` | Deployed; one real `workflow_claims` row recorded from a live drive |
| UC-03 | `Travel Router Gates` | `Append Audit Log` | Deployed; one real `workflow_claims` row recorded from a live drive |
| UC-04 | `Workation Gates` | `Create Authorization Record` | **Deployed; end-to-end proof pending** — the run never reached the claim node (see below) |
| UC-05 | `Notice Period Gates` | `Create Resignation Record` | **Deployed; end-to-end proof pending** — same cause as UC-04 |
| UC-06 | `Amendment Gates` | `Create Amendment Record` | Deployed; one real `workflow_claims` row recorded from a live drive |
| UC-07 | `Relocation Gates` | `Create Dossier Record` | **Proven live, both halves** — see below |
| UC-08 | `Build Dossier` | `Create Dossier Record` | Deployed; one real `workflow_claims` row recorded from a live drive. ⚠️ **[2026-08-21]** `nodes-uc08/normalizeInquiry.js` derives `session.authenticatedEmail` from the Zendesk-authenticated requester — with a comment saying *"NEVER an address typed into the ticket body"* — and **`buildDossier.js` never reads it**, so the authenticated signal is computed and thrown away. Decided: wire it, and mark the employment id `verified` / `claimed`. **No identity gate is added** — refusing a tax question for want of identity is the wrong failure. DRIFT-069, `T-23` |
| UC-09 | `Adjustment Gates` | `Create Adjustment Record` | Deployed; one real `workflow_claims` row recorded from a live drive |

The claim row's `decision` field is `={{ $json.decision }}` on every graph that
branches, and the literal `escalate` on **UC-07 and UC-08**, whose tier forbids
a branch at all — there is no decision to interpolate because every run
escalates by design.

**UC-07 is the one with both halves proven.** It was driven **twice** through
its production webhook under a single external reference
(`claim-proof-uc07-a`) and produced exactly **one** `workflow_claims` row, **one**
`uc07_dossiers` row and **one** `audit_log` row; the second delivery left by
the error output and stopped at `Duplicate Delivery — Stop`. That is the
guarantee demonstrated end to end rather than argued for.

**Six of the eight** (UC-02, 03, 06, 07, 08, 09) recorded exactly one real
`workflow_claims` row each under references beginning `claim-proof-` — a
genuine unpinned Supabase write, though for the five besides UC-07 the
downstream rows were not separately verified in that pass.

**UC-04 and UC-05 are proven as well**, on a second pass: two independent pairs
each, 12/12 row counts of exactly 1 across `workflow_claims`,
`uc04_authorizations`, `uc05_resignations` and `audit_log`, nothing pinned.

They missed the first pass because it used an employment id that had been
**deleted from the Sandbox** — the account was reseeded and `fde4007b-…` now
404s. Worth knowing before touching these two graphs: their
`Fetch Employment (Remote)` node points at `your-sandbox-standin.vercel.app`
where the other seven use `gateway.remote-sandbox.com`, and that looks exactly
like drift. **It is deliberate — do not repoint it.** The stand-in
(`src/remotebridge/`) is a read-only proxy that fills only fields the raw
Sandbox leaves null, and these are the two use cases that depend on them:
UC-04 reads `custom_fields.workation_permission` and UC-05 reads
`basic_information.start_date`, both `undefined` from the gateway. On gateway
data UC-04 would refuse every request and UC-05 could not compute tenure at
all. The dead id 404s identically through both hosts, which is precisely what
made the host look guilty.

**A request with no `external_ref` is claimed under `unreferenced:<execution
id>`**, not dropped. Both key columns are NOT NULL, so a bare
`{{ $json.externalRef }}` on a ref-less request inserts null, fails the key,
takes the error output and vanishes at the NoOp — green, silent, gone. A
request with no external reference cannot be a duplicate *delivery* of
anything, so a per-execution key lets it through, matching
`src/shared/workflowClaims.js`, whose test for this case is named "an absent
ref is processed, never dropped".

### Gotcha paid for here: a REST `PUT` publishes, `update_workflow` does not

These nodes were inserted through the n8n REST API
(`PUT /api/v1/workflows/{id}`), and on an **already-active** workflow that
**publishes in place**: the change is production the moment the call returns
`200`. That is the opposite of `mcp__n8n__update_workflow`, which writes a
**draft** that does nothing until `publish_workflow` promotes it (see the note
at the very bottom of this file). Two different tools, two opposite defaults,
one live automation — check `activeVersionId` against `versionId` rather than
assuming either behaviour.

---

## Escalation routing: the `Assign Routing` node

A tag is a label something *could* route on. Assignment is the hand-off. Until
this node existed, the nine graphs tagged and annotated **26 human-facing
Zendesk updates and assigned none of them**: a UC-09 off-cycle payroll
escalation (real money, triple approval) and a UC-01 auto-resolved verification
landed in the same undifferentiated queue.

All nine graphs now carry one node, with **the same body byte-for-byte** —
`workflows/nodes/assignRouting.js`, exactly like `collectTraceSteps.js`:

```
… Append Audit Log  (or Carry Context Forward, where the graph has one)
  └─ Assign Routing   (Code — reads the routing table, assigns nothing itself)
      └─ Route by Decision …   (or the single Zendesk node, on UC-07/UC-08)
```

**The per-use-case diagrams below are drawn without this node.** Read the edge
into each graph's `Route by Decision` — or, on UC-07/UC-08, into its single
Zendesk node — as passing through `Assign Routing` first.

### What it emits, and what each Zendesk node does with it

| field | consumed by | note |
|---|---|---|
| `zendeskGroupId` | `updateFields.group` → `body.group_id` | `''` when the group does not exist, so `if (updateFields.group)` skips it cleanly |
| `routingTag` | merged into `updateFields.tags` | never empty; the escalation tag on an escalation, the owning team's `queue_*` tag otherwise, and `queue_unrouted` when nothing resolved |
| `routingNote` | appended to `updateFields.internalNote` | says in words whether the ticket was assigned, and why not |
| `zendeskGroup` / `zendeskTags` / `zendeskPriority` | nothing — the parity anchor | `test/n8nRoutingParity.test.js` holds these against `src/shared/escalationRouting.js` |

Expressions address the node **by name** (`$('Assign Routing').item.json.…`),
not `$json`: the nine graphs disagree about what `$json` holds on a branch —
UC-01/02/03/09 restore the gates context through `Carry Context Forward`, the
rest read `$('…Gates').item` directly — and a named-node accessor is the one
form that works identically on all nine. That resolves through **item pairing**,
which is why the routing node sets `pairedItem` explicitly.

### It knows its use case from the audit row

Nothing on the item carries one. Every graph writes a *literal* `use_case` into
`audit_log` immediately upstream, and the Supabase create returns the inserted
row — so the node reads it back off that row. Same source `Collect Trace Steps`
uses, for the same reason: it is the record that exists, and reading it needs no
`$('…Gates').item` lookup that item pairing could break.

### The one branch whose owning team is not its use case

UC-03's `route_to_uc04` is a travel inquiry that turned out to be a
work-authorization case; its own Zendesk note says "UC-04 owns its own
compliance case". `workflows/nodes-uc03/travelRouterGates.js` sets
`handoffUseCase: 'UC-04'` beside the handoff event it already builds, and the
routing node resolves `handoffUseCase || useCase`. The table stays keyed by use
case, and the exception lives at the site that decided it — not as a second rule
inside the routing node. Proven live: ticket 27 came back tagged
`uc03_routed_uc04` **and** `escalation_mobility_legal_t2`.

### Three nodes deliberately do NOT get it

UC-01's and UC-03's `Reply + Solve Ticket` and UC-02's `Resolve Expense Ticket`
end **auto** paths. Assigning a solved ticket to a team queue manufactures work
that does not exist. `scripts/deploy-routing-nodes.mjs` names them and asserts
it touched exactly 27 nodes — a drifting count means a graph changed shape and
the skip-list is stale, which must fail loudly rather than quietly assign one
node more or fewer.

### Canvas position, and the fan-out trap

The new node sits at **the y of the node it feeds**, read from the live graph.
Five graphs fan out from `Append Audit Log` to a trace branch *and* to the
branch this node joins; n8n orders that fan-out by canvas position, not by the
connection array, so any "tidy" placement would promote the customer-facing
branch above the trace write. `--dry-run` prints the coordinate and the sibling
ys so this is checkable before anything is written.

### Groups have to exist first, and today they do not

The account has one group, `Support`. `scripts/setup-zendesk-groups.mjs` creates
the per-team groups and is the only thing that may — a workflow that quietly
created org structure in a live account as a side effect of an escalation would
be the wrong kind of automation. Until it runs, every route takes the
tag-and-say-so path and the ticket says so:

> ASSIGNMENT SKIPPED — the Zendesk group "Mobility Legal (Tier-3)" does not
> exist in this account, so this ticket was tagged
> `queue_mobility_legal_t3, escalation_mobility_legal_t3` but NOT assigned. Run
> `scripts/setup-zendesk-groups.mjs` to create the groups, then re-deploy the
> routing node.

### Two tags, and one row with two teams

`zendeskTags` carries the owning team's **`queue_*`** tag on every ticket and
adds the **`escalation_*`** tag only when the decision really is an escalation.
It used to be one tag, `escalation_<team>`, on everything — so a routine
`ready_for_approval` reached Zendesk claiming the automation had given up, and
on UC-04 it was addressed to the Tier-2 Mobility/Legal queue that UC-04.md §5
reserves for an unconfirmed dimension. Escalation tags are what a support org
routes and reports on, so that made the escalation rate a constant rather than a
measurement. Dropping the tag for reviews would have been the wrong fix: a
flagged UC-02 claim goes to the same Finance Ops queue an escalated one does, so
the reviews need a routing tag too — hence two tags rather than one tag applied
conditionally.

UC-04 is also the only row with an `escalationGroup`: its spec names a mobility
specialist for the 1-click path and Mobility/Legal Tier-2 for the escalation.
The node reads the decision from `$json.decision`, then from the audit row's
`decision`/`action` column (every `workflow.js` writes `action: result.decision`),
and a decision it cannot classify counts as an **escalation** — the fail-closed
direction, so an unclassifiable UC-04 case never lands as a one-click approve.
`isEscalation()` is ported verbatim from `src/shared/escalationRouting.js` and
held against it by `test/n8nRoutingParity.test.js`.

> **Not deployed yet.** The tag split changed the port's body and
> `Mobility Specialists` has no id in the GENERATED `GROUP_IDS` block, so until
> `scripts/setup-zendesk-groups.mjs` + `npm run sync-groups` +
> `scripts/deploy-routing-nodes.mjs` are run, the nine live graphs still carry
> the single-tag body and `npm run verify-deployed` will report drift on
> `Assign Routing`.

Afterwards: `npm run sync-groups` resolves the names to ids into the port's
GENERATED block, then `node scripts/deploy-routing-nodes.mjs` redeploys. Group
ids live in the port and never in `src/shared/escalationRouting.js` — that
module answers *which team*, a fact about Remote's org, while an id is a fact
about one Zendesk instance.

### Priority is not set, on purpose

`priority` is absent from the n8n Zendesk node's `updateFields` entirely. Only
`updateFieldsJson` can set it, and that form is where hand-writing the comment
object can drop `public: false` and post the AI's internal analysis publicly to
the customer — the `publicReply` incident rotated one dimension. `zendeskPriority`
is emitted and parity-checked so the table stays whole; nothing consumes it.

### What is proven

Each graph was deployed, re-read, and driven through its **production webhook,
unpinned**, against a real Zendesk ticket — then the **ticket** was read back,
never the run status: UC-01 #31, UC-02 #29, UC-03 #26, UC-03→UC-04 #27, UC-04
#30, UC-05 #23, UC-06 #32, UC-07 #21, UC-08 #22, UC-09 #33. Every one carried
its routing tag **merged with** its outcome tag (`updateFields.tags` replaces,
so the merge is the check), a `public: false` note explaining the routing, and
exactly one `workflow_claims` row and one `audit_log` row with trace rows
present.

The **assignment mechanism itself** was proved separately, because with no
groups every route takes the skipped path and a node that silently returns
nothing looks identical to one correctly declining. UC-07 was temporarily
deployed with its group id set to `1` and driven; Zendesk answered `422
RecordInvalid` naming **`group_id`** — the value reached the wire. UC-07 was
returned to the real body and re-verified byte-identical immediately after.

## Why Code node bodies live in `nodes/*.js`

They are real files, not strings inside the builder, and that is a scar rather
than a preference.

The first deployed version embedded them as template literals. Two escape
sequences collapsed on the way in:

| Written | Became | Effect |
|---|---|---|
| `join('\n\n')` | a literal newline inside a string literal | syntax error |
| `/https?:\/\//` | `/https?:///` | parses as a regex **then a line comment** — so `hasExternalUrl` held a `RegExp` object instead of a boolean. Always truthy. **Every ticket** would have routed to human review. |

The second is the dangerous one: nothing crashes. The workflow runs, the
dashboard fills up, and the automation quietly resolves nothing. A file cannot
have that bug, and `test/n8nParity.test.js` compiles all four bodies on every
run so a broken one fails CI instead of failing a customer.

## The parity test

`src/uc01/policyEngine.js` and `nodes/gates.js` are two copies of the most
safety-critical logic in the system. Rather than pretend that duplication is
fine, `test/n8nParity.test.js` executes the real n8n node body in a `node:vm`
sandbox with `$()` and `$input` mocked, and asserts it produces the same
decision, reason and flags as `policyEngine.evaluate()` for all ten UC-01
scenarios. Edit one without the other and the suite fails.

---

## Identity: the one place n8n differs from the Node path, on purpose

A Zendesk ticket carries no Remote session. The repo's `identity.js` matches a
session's `authenticatedEmploymentId`; there is nothing to match here.

Taking an email out of the ticket *body* would be worse than useless — a
claimed address proves nothing. So the workflow uses the ticket's **requester**,
whom Zendesk itself authenticated, and matches it against the email on the
authoritative Remote record. It fails closed: no requester, no email on the
record, or a mismatch all yield `verified: false` → escalate.

This is a real design decision with a real limitation worth stating: it trusts
Zendesk's authentication of the end user. That is appropriate for a support
channel and is not equivalent to a Remote-authenticated session.

---

## UC-06: the node graph

```
Amendment Request Webhook (POST /uc-06-amendment)
  └─ Normalize Amendment Request  (Code)  webhook body → internal shape
      └─ Fetch Employment (Remote)         (HTTP)
          └─ Fetch Country Schema (Remote) (HTTP)  needs employment.country_code
              └─ Fetch Payroll Runs (Remote) (HTTP)  needs employment.company_id
                  └─ Amendment Gates (Code)  ← the decision. No AI here.
                      └─ Create Amendment Record (Supabase, uc06_amendments)
                          └─ Append Audit Log (Supabase, audit_log)
                              └─ Route by Decision (Switch)
                                  ├─ dual_approval_required → Flag Awaiting Dual Approval (Zendesk)
                                  ├─ escalate    → Escalate Amendment Ticket (Zendesk)
                                  └─ unrecognised → Unrecognised Amendment Decision (Zendesk)
```

`Unrecognised Amendment Decision` was added 2026-08-19. Before it, the fallback
output shared `Escalate Amendment Ticket` with the real `escalate` branch, so an
unrecognised decision got a note beginning "AI summary — ESCALATED: …" —
describing a decision the gates never reached, and reading `reason`/`flags` off
an outcome that has neither. Every other branching graph already had a distinct
`Unrecognised …` node; this one now matches them.

Deliberately different from UC-01 in two ways, both already decided in
`src/uc06/changeParser.js`'s own header and carried through here unchanged:

- **No LLM node parses the proposed changes.** `changes` arrives as structured
  data in the webhook payload — the equivalent of a real amendment form's
  fields — never text an LLM would have to extract a salary figure from. The
  one LLM-touching function in the Node app (`draftSummary()`) is display text
  only, so n8n uses its deterministic template fallback directly instead of
  adding a fourth HTTP dependency for text that was never load-bearing.
- **The write never happens in this graph.** `Amendment Gates` can only
  ever route to `dual_approval_required` or `escalate` — both branches just
  create a record and update the ticket. The real write,
  **`POST /v1/contract-amendments`** (`createContractAmendment()`, with the
  amendment's own id as the idempotency key), only fires from
  `src/uc06/workflow.js`'s `submitAmendmentApproval()`, reached through
  `npm run uc06-api` and the ZAF sidebar's dual-role panel, once both approval
  slots are independently filled — exactly the same split UC-01 already has
  between n8n (decide + route) and `review/server.js` (approve/decline), just
  with two role slots instead of one.

  > **CORRECTED 2026-08-21 (DRIFT-029, `[A-17]`).** Both sentences above named
  > `PATCH /v1/employments/:id/basic-information`. That has not been UC-06's write
  > since `ecdc89c` (2026-08-18), and **it is not an endpoint Remote has**: the
  > `PATCH` verb 404s on that path for every status tried, the documented verb is
  > `PUT` with an enveloped body, its supported statuses exclude **`active`** —
  > the only status UC-06's own gate 2 admits — and the form it validates against
  > has no salary and no hours property at all. `restClient.js`'s own header now
  > begins *"NO LONGER UC-06'S WRITE, AND NOT AN ENDPOINT REMOTE HAS"*.
  > **Do not delete `patchEmploymentBasicInformation()`** — other use cases' tests
  > use it to mutate mock fixtures.

- **⚠️ Nothing feeds this graph.** It is **active** (`WORKFLOW_UC06_ID`, since
  2026-08-10) and its webhook is `POST /uc-06-amendment`, but **no Remote
  subscription exists** (`contract_amendment.submitted` is buildable and not
  subscribed — DRIFT-031) and **no Zendesk trigger keys off `uc06_*`**. So every
  UC-06 ticket in the account is authored by `src/remoteui/`, and because that
  surface does not consult `src/shared/escalationRouting.js`, **every one of them
  carries no `queue_payroll_ops` tag and no group assignment** — worse than the
  backlog in `CLAUDE.md` §7 items 7–8, which at least carries a tag a later
  backfill could act on. DRIFT-062, `[A-30]`…`[A-32]`.

`Amendment Gates` ports `src/uc06/{policyEngine,changeParser,cutoffEngine}.js`
verbatim into one Code node; `test/n8nUc06Parity.test.js` executes that exact
file (`workflows/nodes-uc06/amendmentGates.js`) and asserts it reaches the
same decision/reason/flags/amendmentType/payload as the real functions for 11
scenarios, the same discipline as UC-01's `test/n8nParity.test.js`.

---

## UC-08: the node graph

```
Tax Inquiry Webhook (POST /uc-08-inquiry)
  └─ Normalize Inquiry        (Code)  webhook body → internal shape + LLM request
      └─ Classify Inquiry (LLM) (HTTP)  OpenAI, continues on error
          └─ Build Dossier (Code)  ← presence days, citations, dossier. No branch.
              └─ Create Dossier Record (Supabase, uc08_dossiers)
                  └─ Append Audit Log (Supabase, audit_log)
                      └─ Escalate Tax Inquiry Ticket (Zendesk — internal note only)
```

The headline property of this graph is what it does **not** have: no Switch,
no IF, no second path anywhere. Every execution ends at the same single
Zendesk update — an internal note, ticket left `open`, no public reply sent
automatically (the dossier's `customerFacingAcknowledgement` is drafted for
whichever human picks the ticket up to send, not for n8n to send unattended).
That mirrors `src/uc08/workflow.js`'s own guarantee — "no branch, anywhere in
this file, that leads anywhere else" — one level up, at the graph itself:
there is no routing node here that a future edit could quietly wire to a
write action.

`Build Dossier` ports `src/uc08/{inquiryParser,presenceCalculator,
treatyRetriever,dossierBuilder}.js` into one Code node (rule-based
classifier fallback, deterministic presence-day arithmetic, keyword-matched
citations — the retriever's safe unconfigured path, honestly kept here
because an n8n Code node has no pgPool or embedding client for issue #29's
pgvector path — and the template narrative);
`test/n8nUc08Parity.test.js` executes that exact file
(`workflows/nodes-uc08/buildDossier.js`) and asserts its computed
inquiryType/jurisdictions/presenceDays/citations match the real functions.

---

## UC-02: the node graph (🟢 — 28 nodes, **ACTIVE — see the warning above**)

```
Expense Submission Webhook (POST /uc-02-expense)
  └─ Normalize Expense Submission (Code)  webhook body → internal shape
      └─ Fetch Employment (Remote)         (HTTP)
          └─ Fetch Expense (Remote)         (HTTP)
              └─ Fetch Expense Categories (Remote) (HTTP)
                  └─ Derive Receipt Fingerprint (Code)          the F-24 server-side hash
                      └─ Fetch Receipt Matches (Supabase)       uc02_expenses.receipt_hash, alwaysOutputData
                          └─ Check Duplicate Receipt (Supabase) (Code — interprets the rows)
                      └─ Prepare Classification Prompt (Code)
                          └─ Classify Expense (LLM)     (HTTP)  OpenAI, no continueOnError set
                              └─ Expense Gates (Code)  ← the decision, 12 ordered gates. No AI here.
                                  └─ Claim Ticket (Idempotency) (Supabase, workflow_claims)
                                      └─ Carry Context After Claim (Code)
                                          └─ Create Expense Record (Supabase, uc02_expenses)
                                              └─ Carry Context After Expense Record (Code)
                                                  └─ Append Audit Log (Supabase, audit_log)
                                      └─ Carry Context Forward (Code)
                                          └─ Route by Decision (Switch)
                                              ├─ auto_approve   → Approve Expense (Remote PATCH) → Carry Context After Approve → Resolve Expense Ticket
                                              ├─ blocked        → Flag Blocked Expense
                                              ├─ human_review   → Flag Expense For Review
                                              ├─ escalate       → Escalate Expense Ticket
                                              └─ unrecognised   → Unrecognised Expense Decision
```

`Expense Gates` ports `src/uc02/{policyEngine,expenseClassifier,policyCaps}.js`
verbatim into one Code node — identity, employment, ownership, duplicate,
category validity, itemization, math, currency, policy cap, confidence, VAT,
in that order, first failure wins, matching `policyEngine.js`'s own ordered
gate list. **`auto_approve` is the one branch in this file that performs a
real write** — `Approve Expense (Remote)` issues a real
`PATCH /v1/expenses/:id` with `{status: "approved"}`, gated behind every one
of those 12 checks passing, mirroring `src/uc02/workflow.js`'s single write
path.

### The duplicate-receipt gate (fixed and proven — `docs/BUILD-LOG.md` §3.39)

`Check Duplicate Receipt (Supabase)` **used to be a Code node returning
`{duplicate: null}` unconditionally**, on the stated premise that no
`uc02_expenses` table had been provisioned. The table existed the whole time,
with the only non-primary-key indexes of any `uc0*` table — on `receipt_hash`
and `external_ref`, i.e. exactly this gate's lookups. §3.35 fixed the Node half;
this is the n8n half.

There were **three** dead layers, each sufficient on its own, which is why a
partial fix would have changed nothing observable:

1. the lookup returned a constant;
2. `Expense Gates` discarded the answer anyway unless the submitter supplied a
   `receiptHash` — and the **Zendesk intake path always sets it to `null`**, so
   on the real inbound channel nothing looked and nothing would have been
   believed if it had;
3. **nothing in this graph had ever written `uc02_expenses`**, so even a correct
   lookup would have queried a table this path never fills.

All three are closed. `Derive Receipt Fingerprint` recomputes the F-24
server-side fingerprint — **SHA-256 hand-written in plain JavaScript**, because a
Code node takes no imports and `crypto` is not guaranteed in the sandbox; the
parity test proves it byte-identical to `src/uc02/workflow.js`'s
`deriveReceiptFingerprint()` for every mock expense, and to `node:crypto` across
multi-block, NUL-containing and lone-surrogate inputs. If those two ever diverged,
one claim filed through the portal and through the graph would land under
different keys and never collide — a dedupe that looks live and catches nothing.
`Create Expense Record` writes the row the *next* claim is checked against, in the
same claim → carry → first-durable-write slot UC-04…UC-09 use.

Two things here are load-bearing and easy to undo by accident:

- **`alwaysOutputData: true` on `Fetch Receipt Matches (Supabase)`.** A read
  matching nothing emits **zero items**, and an n8n node with no input is
  *skipped* — which would silently kill the rest of the graph on every
  non-duplicate run, i.e. almost all of them.
- **`Create Expense Record` carries `onError: continueRegularOutput`** (with
  retries) and is followed by `Carry Context After Expense Record`, which reads
  `$('Expense Gates')` by name. So a failed record write can never cost the
  `audit_log` row downstream of it.

**Proven live, nothing pinned** (`pinData: {}` on the workflow and both runs).
Because the claim node keys on `(use_case, external_ref)`, re-sending one ref
proves the *claim*, not the dedupe gate — so the proof uses **two different
external refs carrying the same receipt**:

| | ref | execution | decision |
|---|---|---|---|
| 1st filing | `dedupe-proof-uc02-a1` | `5317` | `human_review` / `policy_cap_currency_mismatch` |
| 2nd filing | `dedupe-proof-uc02-a2` | `5319` | **`blocked` / `duplicate_submission`** |

Both sent `receiptHash: null`, so the derived fingerprint did all the work
(`duplicateMatchedOn: "derived_receipt_fingerprint"`). 6/6 row counts of exactly
1 across `uc02_expenses`, `workflow_claims` and `audit_log`.

**`Classify Expense (LLM)` does NOT set `onError: continueRegularOutput`** —
unlike UC-03/UC-08's LLM nodes, an OpenAI failure here stops the whole
execution rather than falling through to the rule-based classifier inside
`Expense Gates`. Worth fixing to match the graceful-degradation pattern
established elsewhere in this repo; not fixed in this pass (out of scope —
this session's job was the UC-03 duplicate and UC-09's build, not auditing
every prior graph for parity with the repo's own conventions).

## UC-03: the node graph (🟢 — 15 nodes, workflow `WORKFLOW_UC03_ID`)

```
Travel Inquiry Webhook (POST /uc-03-inquiry)
  └─ Normalize Inquiry            (Code)  ticket → internal shape + LLM request
      └─ Fetch Employment (Remote) (HTTP)
          └─ Fetch Countries (Remote) (HTTP)  fails closed: empty list means nothing confirmed supported
              └─ Classify Inquiry (LLM) (HTTP)  OpenAI, onError: continueRegularOutput
                  └─ Travel Router Gates (Code)  ← the thin-router decision. No AI here.
                      └─ Append Audit Log (Supabase, audit_log)
                          └─ Carry Context Forward (Code)
                              └─ Route by Decision (Switch)
                                  ├─ auto_resolve   → Render Informational Answer → Reply + Solve Ticket
                                  ├─ human_review    → Flag For Formal Letter Review
                                  ├─ escalate        → Escalate Travel Ticket
                                  ├─ route_to_uc04   → Route To UC-04 (handoff event recorded, never dispatched)
                                  └─ unrecognised    → Unrecognised Travel Decision
```

**This session resolved a duplicate**: two separate workflows both named
"UC-03 — Travel Support Letter / Workation router/Router" existed
(`WORKFLOW_UC03_ID`, created 22:17, and `xvkKRLnmsAoTZsCe`, created 16:35),
left over from the building agent dying mid-session and being retried without
noticing the first attempt had already partially succeeded. Compared both via
`mcp__n8n__get_workflow_details`: `WORKFLOW_UC03_ID`'s `Travel Router Gates`
Code node carries the full header-comment block that matches the local
source (`workflows/nodes-uc03/travelRouterGates.js`) verbatim, while
`xvkKRLnmsAoTZsCe`'s is a stripped, uncommented earlier draft. `WORKFLOW_UC03_ID`
also sets `onError: "continueRegularOutput"` on its `Classify Inquiry (LLM)`
node — a real functional difference, not cosmetic: `xvkKRLnmsAoTZsCe` omits
it, so an OpenAI failure there would kill the whole execution instead of
falling through to `Travel Router Gates`' rule-based classifier. Kept
`WORKFLOW_UC03_ID`, archived `xvkKRLnmsAoTZsCe` via `mcp__n8n__archive_workflow`.

`Travel Router Gates` ports `src/uc03/{policyEngine,classifier}.js` and
`workflow.js`'s `buildUc04HandoffEvent()` verbatim; `test/n8nUc03Parity.test.js`
executes that exact file (`workflows/nodes-uc03/travelRouterGates.js`) and
asserts parity. This is the thin router — it never computes a write payload
(UC-03 has no execution path of its own by design; see `UC-03.md` §15), and
the `route_to_uc04` branch only ever records a normalized handoff event on the
ticket, never a live UC-04 call.

## UC-04: the node graph (🟡 — 11 nodes, **ACTIVE — see the warning above**)

```
Workation Request Webhook (POST /uc-04-workation)
  └─ Normalize Workation Request (Code)  webhook body → internal shape
      └─ Fetch Employment (Remote)         (HTTP)
          └─ Workation Gates (Code)  ← the decision: origin→destination risk
             matrix, PE risk, Schengen/US-CA hard blocks. No AI here.
              └─ Create Authorization Record (Supabase)
                  └─ Append Audit Log (Supabase, audit_log)
                      └─ Route by Decision (Switch)
                          ├─ specialist_approval_required → Flag Awaiting Specialist Approval
                          ├─ blocked                       → Flag Blocked Workation
                          ├─ escalate                       → Escalate Workation Ticket
                          └─ unrecognised                   → Unrecognised Workation Decision
```

`Workation Gates` ports `src/uc04/{policyEngine,requestParser}.js` verbatim.
Deliberately **single**-specialist approval, not dual — `UC-04.md` names one
mobility specialist as the approval role, unlike UC-06's two-role split — so
this graph, like UC-06/UC-09, only ever creates a record and routes the
ticket; the real work-authorization approval write (if any) happens through
`uc04-api`, not from this graph.

## UC-05: the node graph (🟡 — 10 nodes, **ACTIVE — see the warning above**)

```
Resignation Request Webhook (POST /uc-05-resignation)
  └─ Normalize Resignation Request (Code)  webhook body → internal shape
      └─ Fetch Employment (Remote)          (HTTP)
          └─ Notice Period Gates (Code)  ← the decision: 9-country statutory
             notice table + PTO payout reconciliation. No AI here.
              └─ Create Resignation Record (Supabase)
                  └─ Append Audit Log (Supabase, audit_log)
                      └─ Route by Decision (Switch)
                          ├─ hr_ops_signoff_required → Flag Awaiting HR Ops Sign-off
                          ├─ escalate                 → Escalate Resignation Ticket
                          └─ unrecognised              → Unrecognised Resignation Decision
```

`Notice Period Gates` ports `src/uc05/{policyEngine,letterExtractor}.js`
verbatim. No real write endpoint exists for this use case (spec-confirmed —
see `UC-05.md` §15), so the graph's only durable artifact is the signed-off
resignation record itself, exactly matching `src/uc05/workflow.js`'s own
"the report is the deliverable, not an execution" framing — there is no
Remote POST/PATCH node anywhere in this graph.

## UC-07: the node graph (🔴 — 6 nodes, **ACTIVE — see the warning above**)

```
Relocation Request Webhook (POST /uc-07-relocation)
  └─ Normalize Relocation Request (Code)  webhook body → internal shape
      └─ Relocation Gates (Code)  ← dossier assembly. No AI here, no Remote
         read (mirrors handleRelocationReview() taking no remote dependency
         at all — src/uc07/workflow.js's own no-execution-path guarantee).
          └─ Create Dossier Record (Supabase, uc07_dossiers)
              └─ Append Audit Log (Supabase, audit_log)
                  └─ Escalate Relocation Ticket (Zendesk — internal note only)
```

The second no-execution-path graph after UC-08's: no Switch/IF node anywhere,
every execution ends at the same single Zendesk internal-note update, no
public reply, no write node of any kind. `Relocation Gates` ports
`src/uc07/{policyEngine,relocationParser,dossierBuilder}.js` verbatim,
matching `src/uc07/workflow.js`'s own structural guarantee — `
handleRelocationReview()` takes no `remote`/`zendesk` dependency through which
a write-capable client could ever be passed in — one level up, at the graph
itself.

## UC-09: the node graph (🔴-framed but WITH execution — 12 nodes, workflow
`WORKFLOW_UC09_ID`, **ACTIVE as of 2026-08-10**, built this session)

```
Adjustment Request Webhook (POST /uc-09-adjustment)
  └─ Normalize Adjustment Request (Code)  webhook body → internal shape
      └─ Fetch Employment (Remote)         (HTTP)
          └─ Adjustment Gates (Code)  ← the decision: floor-of-2 multi-approval
             gates (identity, active employment, fixed incentive schema,
             risk-based slot count). No AI here, no write here.
              └─ Create Adjustment Record (Supabase, uc09_adjustments)
                  └─ Append Audit Log (Supabase, audit_log)
                      └─ Carry Context Forward (Code)
                          └─ Route by Decision (Switch)
                              ├─ dual_approval_required   → Flag Awaiting Dual Approval
                              ├─ triple_approval_required → Flag Awaiting Triple Approval
                              ├─ escalate                  → Escalate Adjustment Ticket
                              └─ unrecognised               → Unrecognised Adjustment Decision
```

Built this session, closing out node-graph coverage for all nine use cases.
Modeled on UC-06's Switch pattern (the closest match for UC-09's
record-creation-only shape), with two UC-09-specific corrections against the
local source:

1. **No "Fetch Country Schema (Remote)" node — deliberately.** A different
   session found and fixed a real bug in `src/uc09/policyEngine.js`
   (`docs/BUILD-LOG.md`, "UC-09 incentive-schema bug found via
   `npm run walkthrough`"): `workflow.js` used to validate the incentive
   payload against `remote.getCountrySchema()` — UC-06's
   `employment_basic_information` schema (`job_title`/`weekly_hours`), a
   completely different Remote write than this use case's
   `POST /v1/recurring-incentives`. Every real incentive payload failed
   `schema_invalid` on fields it had no business carrying. `workflow.js` now
   validates against its own fixed `INCENTIVE_REQUIRED_FIELDS` list
   (`["employment_id", "type", "amount", "currency"]`) instead. This session
   found the local `workflows/nodes-uc09/adjustmentGates.js` draft (left by
   the prior, killed session) still wired to the OLD pattern — a
   `ticket.countrySchema` sourced from a `Fetch Country Schema (Remote)` node
   that was never actually in the graph. Rewrote the Code node to hardcode
   `INCENTIVE_REQUIRED_FIELDS` instead, matching the CURRENT, fixed
   `policyEngine.js` — not the stale version. There is consequently no
   "Fetch Country Schema" node in this graph at all, unlike UC-06's, which
   genuinely needs one for its own different write.
2. **`adjustmentType: result.decision`** (the decision string used as the
   adjustment's "type") looks odd but is ported EXACTLY as
   `workflow.js`'s own `handleAdjustmentRequest()` sets it — not fixed here,
   since this file's job is parity with the real function as it stands
   today, not correcting it. Flagging it here rather than silently
   "improving" it.

`Adjustment Gates` also had to be restructured to read employment from a
separate `Fetch Employment (Remote)` node (the stale draft bundled a
pre-fetched `employment` directly into the normalized ticket, which no
Code node in an n8n graph can do without its own HTTP call) — the parity
test's sandbox mock was updated to match, now mocking two node references
(`Normalize Adjustment Request` + `Fetch Employment (Remote)`) the same way
UC-03/UC-06's parity tests do. `test/n8nUc09Parity.test.js` (9 tests,
including one added this session asserting no `schema_invalid` false-positive
from the removed country-schema path) executes the real
`workflows/nodes-uc09/adjustmentGates.js` and asserts parity with
`policyEngine.evaluate()`.

> **STALE ON TWO POINTS, corrected 2026-08-21 — both resources named above are
> wrong, and one of them would be expensive.**
>
> **The write is `POST /v1/incentives`, not `POST /v1/recurring-incentives`.**
> The latter 404s; `UC-09.md` §15 records the repoint after it was verified live
> on 2026-08-19, and this file was never updated. The correct recurring path is
> `POST /v1/incentives/recurring`, and Remote documents it as **"a monthly paid
> incentive"** — so posting it would turn one approved off-cycle correction into a
> **standing monthly payment**. Do not "restore" it.
>
> **`INCENTIVE_REQUIRED_FIELDS` is superseded.** Remote's own
> `CreateOneTimeIncentiveParams.required` is
> `["type", "amount", "amount_tax_type", "employment_id", "effective_date"]`. The
> list quoted above — `["employment_id", "type", "amount", "currency"]` — names
> `currency`, which is not a member, and **omits `amount_tax_type`**, which is the
> gross/net basis and the one field UC-09 never defaults: the same integer moves a
> different sum under each reading, because Remote grosses a `net` figure **up**.
>
> The narrative above is kept because the bug it describes was real and its
> reasoning is the design record. `qa/contracts/UC-09-acceptance.md` §17's
> DRIFT-051 disposition and `[P-34]`.

**No real write anywhere in this graph** — same "compute, don't execute"
split as UC-06/UC-04/UC-05: the actual write (`POST /v1/incentives` — see the
box above) only
fires from `submitAdjustmentApproval()` via `uc09-api`, once
`approvalSlotsRequired` slots are filled (the floor-of-2 invariant, enforced
by `multiApprovalPolicy.js` and `Math.max(2, ...)` in both the real function
and this node, ported verbatim).

**⚠️ No `uc09_adjustments` Supabase table exists yet** — confirmed via
`mcp__Supabase__list_tables` on project `your-project-ref` during this
session: the table list includes `uc06_amendments`, `uc08_dossiers`,
`uc07_dossiers`, `audit_trace`, and the two vector tables, but no
`uc09_adjustments`. `src/uc09/adjustmentStore.js` already targets this exact
table name (see its `createAdjustment()` insert statement) for when
`SUPABASE_DB_URL` is configured, so the Node app's real-persistence path is
equally blocked on this — it is a human provisioning step (a table with RLS
enabled, zero policies, matching every other table's pattern), not a code
gap. **A real "Create Adjustment Record" write from this graph would fail
with an undefined-table error until that table is provisioned.** Built and
dry-run verified anyway per instructions, flagged here and left for a human
to provision alongside the retriever/embedding tables already noted as
pending elsewhere in this file.

Credentialed against the same real Remote Sandbox (`Fetch Employment
(Remote)`, attached by hand post-creation — n8n skips credential
auto-assignment for HTTP Request nodes, the standing gotcha) / Supabase /
Zendesk accounts as every other graph in this file. Dry-run verified via
`mcp__n8n__test_workflow` across three scenarios (standard bonus →
`dual_approval_required`, high-amount + manual-tax bonus →
`triple_approval_required`, terminated employment → `escalate`), all
`status: success`. The deployed `Adjustment Gates` Code node body was
confirmed byte-identical to the local source by round-tripping the exact
`JSON.stringify`d literal sent to `create_workflow_from_code` back through
`JSON.parse` and diffing against `workflows/nodes-uc09/adjustmentGates.js`
directly (`12760` chars, identical) — not just eyeballed — avoiding the
escaping-corruption class of bug `CLAUDE.md` §6's "Gotchas" section warns
about. **Now `active: true`** (2026-08-10, explicit user go-ahead — see the
resolved-discrepancy note near the top of this file).

---

## Still to do

- **⚠️ Two Code node bodies changed on 2026-08-19 (post-merge) and have NOT
  been redeployed — the live graphs still run the old ones.**
  - `nodes-uc08/buildDossier.js`: ported the real calculator's RULE 4. With an
    empty `presencePeriods` the node answered `{days: 0, status: "COUNTED"}`
    while `src/uc08/presenceCalculator.js` answered `NOT_EVALUATED` — a
    confident "0 distinct days" printed beside a 183-day citation, computed
    from no evidence. `src/` already had the rule; only the port was missing
    it, so this is a pure parity fix.
  - `nodes-uc09/adjustmentGates.js`: the unusable-amount money guard now
    preserves an EARLIER gate's reason instead of overwriting it, and unions
    flags instead of replacing them. Before this, an unverified requester or a
    terminated employee whose payload also quoted its amount was recorded as
    `unparseable_amount` — a security- or status-relevant refusal filed as an
    integration bug, in the column the metrics exception table ranks by.
  Both were found by a differential harness against the real functions (28 and
  40,960 generated cases respectively; both now report 0 divergences) and are
  pinned by `test/n8nUc08Parity.test.js` / `test/n8nUc09Parity.test.js`.
  Read the deployed body back and diff it after publishing, per the gotcha
  above. `docs/BUILD-LOG.md` §3.50.

Both items this section used to carry are now **done**, and are recorded here
rather than deleted so the sequence stays legible:

- ~~Real inbound delivery.~~ **Done 2026-08-15.** Every use case now has its own
  Zendesk trigger + webhook on `your-subdomain`, and tickets **7–14** each fired
  their own and produced a real `audit_log` row. Before this, only UC-01 had
  ever been driven by an actual inbound ticket rather than by a POST from a
  coding session.
- ~~Publish the audit-ordering fix.~~ **Done.** The reordering is the active
  version; UC-01's executions `3574`/`3577` confirm it behaviourally (audit
  lands at node index 6, Zendesk fails at index 10).

What is still outstanding:

- **UC-06's audit `actor` reads `"unauthenticated"` — and that is correct, not
  a bug.** Worth stating explicitly because it looks like the UC-02/UC-03 bug
  below and is its exact opposite. `normalizeAmendmentRequest.js` deliberately
  sets `session: null` on the Zendesk path: a Zendesk requester is an
  authenticated *person*, but UC-06's identity gate needs an authenticated
  *company-admin session* (it matches `session.companyId` against the
  employment's `company_id`). Recording "unauthenticated" is the fail-closed
  design working. Do not "fix" it by reading the requester email.

### Audit `actor`/`externalRef` were null on the Zendesk path (UC-02 fixed, UC-03 open)

Found by reading the `audit_log` rows tickets 7–14 actually produced, rather
than the executions' green status. Seven of the nine recorded a usable actor
and an `externalRef`. Two did not:

| | `actor` | `externalRef` |
|---|---|---|
| UC-02 | `null` | `null` |
| UC-03 | `null` | ok |

Two independent causes, both only reachable from the **Zendesk** intake path —
which is why every dry run and every direct-API POST looked fine:

1. **`actor`.** Both audit nodes read `$json.session.authenticatedEmploymentId`.
   The Zendesk branch of each normalizer never sets that field; it sets
   `session.authenticatedEmail`, because a ticket carries no Remote session and
   the requester Zendesk itself authenticated is the next-best signal. So the
   expression evaluated to `undefined` on exactly the traffic that matters.
   **This is the same bug already fixed once in UC-01** (`CLAUDE.md` §5 records
   `actor` referencing "a field that never existed") — it was reintroduced when
   UC-02/UC-03 were built from UC-01's shape. The fix prefers the email, falls
   back to the employment id the direct-API path uses, and still records
   `"unauthenticated"` when there is genuinely no session.
2. **`externalRef`.** UC-02's audit `details` expression simply omitted it,
   alone among the nine. The normalizer sets it and `Expense Gates` spreads it
   through, so nothing upstream needed changing — the field was only ever
   missing from the one expression that writes the row. Without it a UC-02
   decision cannot be traced back to the ticket that caused it, which is most
   of what the audit row is for.

**UC-02 is fixed and proven live.** Its row now reads
`actor: owner+employee-eor-usa-10001@…`, `externalRef: "verify-externalref-2"`,
`source: "zendesk"`.

**UC-03's identical `actor` fix is NOT applied** — the update was declined when
offered. Its rows still record a null actor. The change is one
`updateNodeParameters` call on its `Append Audit Log` node, same expression as
UC-02's.

**Gotcha, paid for during this fix: `update_workflow` writes a DRAFT.** On an
already-active workflow it does not change what production runs. The first
re-drive after the edit produced a row with the *old* shape — which reads
exactly like the fix not working. `publish_workflow` promotes the draft; the
next run then showed the new fields. Check `activeVersionId` against
`versionId`, not whether the update call returned success.
