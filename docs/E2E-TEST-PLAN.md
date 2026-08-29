# End-to-end test plan — every surface, in order

One pass that starts where a real request starts (a person, in a UI) and ends
where a real decision ends (a durable row a specialist can be held to). Nine
use cases, every UI, both execution paths.

**Run it in order.** Each phase depends on the one before it. Timings assume
you are reading as you go; the whole pass is roughly 60–90 minutes.

**The rule that makes this worth doing:** at every checkpoint, verify the
DESTINATION, never the status. A green n8n run, a 200 response and a rendered
page have all lied on this project before. The SQL in each phase is the actual
assertion — the UI is just how you cause it.

---

## Phase 0 — clean slate and preconditions (5 min)

Already done for this pass, but this is how to redo it:

- Zendesk: all test tickets deleted (only Zendesk's own sample ticket 1 remains).
- Supabase: `cases`, `review_queue`, `documents`, all seven `ucNN_*` tables and
  `workflow_claims` emptied. **`audit_log` and `audit_trace` are deliberately
  KEPT** — they are append-only and hold the record of every earlier proof.

Confirm the deployment's posture before touching anything:

```
https://remote-cx-apis.vercel.app/__cx/health
```

Every one of these must be true before the pass means anything:

| Field | Required | Why it matters |
|---|---|---|
| `supabaseAttached` | `true` | otherwise every read is empty and every check below passes vacuously |
| `zafSharedSecretConfigured` | `true` | otherwise the sidebar cannot sign |
| `zafVerifierBuilt` | `true` | otherwise the API cannot verify |
| `zendeskConfigured` | `true` | otherwise an approval records but never posts back to the ticket |
| `remoteConfigured` | `true` | otherwise approval's employment re-read fails |

If any is false, fix it before starting. A pass run against a half-configured
deployment produces failures that look like defects and are not.

---

## Phase 1 — the real Remote Sandbox (10 min)

**Surface:** Remote's own Sandbox dashboard, in a browser.

This is the only phase using the genuine product. Everything downstream reads
records that live here.

1. Sign in to the Remote Sandbox.
2. Pick **two** employees and record, for each, the **API UUID** and the
   **email address**. The short code Remote shows in its UI (e.g. `DG4KTE`) is
   a display code, **not** the API id — using it is a guaranteed 404.
3. Confirm each is `active`.

**The three subjects for this pass — verified live 2026-08-18**, resolving,
`active`, with the emails confirmed against the record (the identity gate
matches the Zendesk requester against the email ON the Remote record, so a
mismatch is the difference between `auto_resolve` and `identity_not_verified`):

| Role | Name | Employment id | Type | Country |
|---|---|---|---|---|
| Employee 1 | Chris Lee | `8ab12460-b568-4c1e-af9d-09b1fabd8f46` | employee | US / USA |
| Employee 2 | Emma Thompson | `d73cff71-ced7-4bcf-b764-b9899abc6340` | employee | GB / GBR |
| Contractor 1 | Carlos Silva | `c2cd77da-d576-423f-b4f1-f9e40b313353` | contractor | BR / BRA |

Emails, in the same order:

```
owner+employee-eor-usa-10002@rempel-paucek-4c3wac.example.com
owner+employee-eor-gbr-13@rempel-paucek-4c3wac.example.com
owner+contractor-contractor_standard-bra-1@rempel-paucek-4c3wac.example.com
```

Three countries and two employment types is deliberate: it exercises the
per-country schema path (US, GB and BR are separate schemas), the
contractor-vs-employee branches, and gives UC-04 a real non-Schengen origin.

**Re-verify these before a later pass** rather than trusting this table. The
Sandbox has been reseeded before, and the previous set of ids in this document
is now dead.

**`fde4007b-…` is DEAD.** It appears throughout this repo's history and now
404s everywhere. A dead id produces a failure that looks like a credential,
host or permission problem and is none of them.

> **Checkpoint.** List `/v1/employments` and confirm both ids resolve, before
> anything else. Every minute spent here saves an hour of misdiagnosis later.

---

## Phase 2 — the request portal: seven use cases from their true start (20 min)

**Surface:** `npm run portal` → <http://localhost:4042>, **or the deployed
copy at `https://<deployment>/portal`** — same code, same gates, no Node and no
clone needed. The deployed one asks for an access key the first time you open
it (`PORTAL_ACCESS_KEY`, see `deploy/cx-apis/README.md` §3a); the local one
does not, unless you have a Supabase URL configured.

Seven of the nine use cases have no real entry point, because Remote publishes
no API that emits "an employee submitted an expense for validation". This page
stands in for those missing product surfaces, and says so on itself.

> **[AMENDED 2026-08-21 — ninth decision pass]** UC-07's phase gains five beats
> once `qa/contracts/UC-07-acceptance.md` §18 is built, and the first is the one
> that decides whether the others mean anything:
>
> 1. **The conflict check in BOTH directions, positive leading.** An employment
>    *with* an in-flight amendment or offboarding must produce a named conflict;
>    one without must produce a **stated absence**. A negative-only suite passes
>    whether the gate lands correctly, lands inverted, or does not land at all.
> 2. **Identity refused in both directions**, plus the `null` case asserted
>    against a record that genuinely cannot be read — `null === null` passing is
>    the defect UC-06 and UC-09 shipped.
> 3. **A live call visible in `audit_trace` as `sandbox_live`**, and the same
>    request served from a capture as `sandbox_replay` **with the date visible on
>    the rendered page** — assert the page, not only the payload.
> 4. **A dossier leaving the waiting list**, asserted in the same test as
>    `uc07_dossiers` **not** being mutated, so the two halves of the guarantee are
>    pinned against each other.
> 5. **Both drafted documents rendered**, with the structural assertion that
>    neither is a serialised API payload.

> **[2026-08-21 — one thing this plan cannot currently observe for UC-08, and
> it is about to change.]** UC-08 makes **no Remote call on any path today**, so
> "the Sandbox shows no call of any kind" is a valid negative to assert. Once
> `T-1`/`T-2` land it becomes **no *write* of any kind** — two reads are expected
> (`GET /v1/travel-letter-requests`, `GET /v1/work-authorization-requests`) and
> the audit trace must show them, in **three distinguishable outcomes**: records
> found · `200` with `total_count: 0` · the read did not answer. A phase that
> asserts the old negative will start failing correctly.
>
> Two further UC-08 evidence items are decided and not yet buildable here:
> **a positive Remote-read test must lead** (both collections were empty at last
> capture, so a read wired without a fixture proves nothing), and
> **an outcome verb landing on a ticket while `uc08_dossiers` stays
> byte-identical** — that pairing is the whole claim of the aftermath. See
> `qa/contracts/UC-08-acceptance.md` §16 items 11–17.

It calls each workflow **in-process**, deliberately: UC-07 and UC-08 have no
POST route at all, and routing intake through their APIs would have meant
opening a write path into the two 🔴 use cases whose headline claim is that no
execution path exists.

Submit one request per form, using a **real employment id from Phase 1**:

| # | Form | Tier | Expected decision |
|---|---|---|---|
| 1 | Expense claim — a normal receipt, valid category | 🟢 | auto-approve, or a named gate refusal |
| 2 | Expense claim — no receipt, or over policy | 🟢 | exception, with the reason named |
| 3 | Travel / workation — **Spain, 3 weeks** | 🟢 | `auto_resolve` (this is the positive case) |
| 4 | Travel / workation — **Afghanistan** | 🟢 | `escalate` (sanctions override) |
| 5 | Work authorization — a destination needing permission | 🟡 | `pending_specialist_approval` |
| 6 | Resignation notice — an employee with tenure | 🟡 | `pending_signoff` |
| 7 | Permanent relocation | 🔴 | `escalate`, dossier only, **no approve control** |
| 8 | Cross-border tax question | 🔴 | `escalate`, dossier only, **no approve control** |
| 9 | Off-cycle payroll adjustment, with a structured amount | 🔴 | multi-role approval, **≥2 slots** |

> **Checkpoint — the positive test.** Row 3 must reach `auto_resolve`. This is
> the single most important assertion in the whole pass. UC-03 shipped for
> weeks structurally incapable of succeeding, and every fail-closed test
> passed the entire time, because "refuses correctly" and "cannot possibly
> succeed" are indistinguishable from outside. Only a case that MUST succeed
> detects it.

> **Checkpoint — the 🔴 tier.** Rows 7 and 8 must render a dossier with no
> approve/deny control anywhere. Not a disabled button — no control.

```sql
select 'uc02' t, external_ref, status from uc02_expenses
union all select 'uc04', external_ref, status from uc04_authorizations
union all select 'uc05', external_ref, status from uc05_resignations
union all select 'uc07', external_ref, status::text from uc07_dossiers
union all select 'uc08', external_ref, status::text from uc08_dossiers
union all select 'uc09', external_ref, status from uc09_adjustments
order by 1;
```

---

## Phase 3 — UC-06 from inside "Remote" (10 min)

**Surface:** `npm run remoteui` → <http://localhost:4041>

UC-06's true trigger is a company admin requesting a contract amendment inside
Remote's own product. Three role tabs, each a separate server-side authorized
session — the role is never a claim in the request body.

1. **As company admin** — submit a salary amendment, effective ~4 weeks out.
   Expect `dual_approval_required`, a Zendesk ticket created pre-tagged, and
   an amendment row.
2. **As employee** — consent to that amendment. Expect an
   `amendment_employee_consented` row in `audit_log`.
3. **As employer** — consent on the company's behalf.
4. **Now try each crossing and confirm every one is refused**, server-side,
   with a named code:
   - employee submitting a *request* (not consent)
   - admin *consenting*
   - employee consenting to someone else's amendment
   - employer consenting for another company
   - submitting with no session at all
5. Submit one amendment **after** the payroll cutoff. Expect it held, with the
   cutoff named in the reason.

> **What this phase proves, and what it does not.** `npm run remoteui` runs
> against the **mock** Remote server by design (`cli.js` starts
> `remote/mockServer.js`; `docs/use-cases/UC-06.md` §15). So Phase 3 proves the
> role-gating, the consent flow and the dual-approval UI — not the real
> amendment write.
>
> **The real write is proven separately, and more strongly:** on 2026-08-18 a
> genuine contract amendment was filed against the live Sandbox
> (`POST /v1/contract-amendments`, employment `75b88008-…`, amendment
> `82f8d1c6-…`, `compensation.amount` 7200000 → 7500000 with money ×100
> intact) and then cancelled via `PUT /v1/sandbox/contract-amendments/{id}/cancel`.
>
> **Three limits worth knowing before you try this live:**
>
> 1. **No live payroll cycle covers any date from today onward — RESOLVED
>    2026-08-18, and worth filming in both states.** The raw Sandbox calendar
>    ends 2026-06-30 (2026-07-31 for NL) and there is no API to create a cycle
>    (`POST /v1/payroll-runs` and `/v1/sandbox/payroll-runs` both 404), so a
>    live amendment passed the schema gate and then correctly escalated
>    `no_matching_payroll_cycle` — the gate working on the data that exists.
>    UC-06's graph now reads its calendar through the Sandbox stand-in, which
>    continues each country's own observed cadence past its last real cycle, so
>    `dual_approval_required` is reachable. See §6's stand-in gotcha and
>    BUILD-LOG §3.34.
>
>    **This gives you three takes, same gate, same binary — only the calendar
>    differs. Two of the three need no stand-in at all:**
>
>    | Take | Effective date | Calendar | Expected |
>    |---|---|---|---|
>    | 1 — refuses because it cannot know | 2026-09-15 | raw gateway | `noMatchingCycle` |
>    | 2 — refuses because the lock closed | 2026-06-15 | raw gateway | `cutoffAlreadyPassed`, **naming a real cycle** |
>    | 3 — the approval path | 2026-09-15 | stand-in | cycle found, cutoff 2026-09-20, → `dual_approval_required` |
>
>    Take 2 is the stronger refusal on camera: it names a real cycle and a real
>    lock time rather than saying "no information". Take 3 is the only one that
>    needs the stand-in, because no unlocked cycle exists anywhere. To film
>    Take 1 through the same URL rather than swapping hosts, set
>    `STANDIN_PAYROLL_HORIZON_MONTHS=0` on the stand-in deployment.
>
>    Say plainly on camera which is which. The projection is disclosed in the
>    response (`_standin.projectedCycleIds`, ids prefixed `standin-`), so
>    claiming a projected cycle as Sandbox data would be caught by anyone who
>    opened the payload.
> 2. **None of this pass's three subjects can complete a UC-06 amendment.**
>    The US form 500s, the GB record lacks `uk_country` (so it escalates naming
>    that field), and contractors have no amendment form at all (404). Use one
>    of the eleven active Dutch employments for a live UC-06 check — e.g.
>    `75b88008-28f0-4c7a-921b-59498d89ac45` or `293527ed-b8af-4fc2-a4ad-1cb87cda1641`.
> 3. **The form is per EMPLOYMENT, not per country.** The same country's form
>    fetched with two different employments returns different required sets.
>
> **Checkpoint.** UC-06 through a **Zendesk ticket** always escalates with
> `identity_not_verified`, by design — a Zendesk requester is an authenticated
> person but not an authenticated company-admin session. That is correct
> behaviour, not a bug, and it is why this phase exists.
>
> **ADDED 2026-08-21 by UC-06's decision pass** (`qa/contracts/UC-06-acceptance.md`
> §16, `[A-10]` `[A-28]` `[A-5]`). Three things this phase must establish that it
> currently does not:
>
> 1. **The positive case leads, and it must name its country.** UC-06's approvable
>    path exists on **NL and CA only** — PT publishes a form no PT record satisfies
>    and the US Sandbox answers **500** for every employment, both models. A
>    "UC-06 works" observation with no country attached is not checkable.
> 2. **State which payroll calendar the run used.** The approvable path is
>    reachable **only** through the stand-in's projected calendar; the audit row's
>    own `cutoffCycleProjected: true` is the evidence, and
>    `STANDIN_PAYROLL_HORIZON_MONTHS=0` reproduces the refusal through the same URL.
>    **Do not conclude that the calendar is why production never succeeds** — 9 of
>    26 production refusals are `schema_invalid` and only 1 is
>    `no_matching_payroll_cycle`. Production is stopped two gates earlier, by the
>    employment roster.
> 3. **Move the clock between the two signatures.** Decide an amendment with the
>    lock comfortably ahead, advance past that lock, then present the second
>    signature. It must refuse with `cutoff_lock_passed_since_decision`, release the
>    claim, and write nothing. **No such check exists today** — the freshness
>    re-check re-reads the employment and the contract, never the calendar
>    (DRIFT-061). This is the likely path in practice, not an edge case: an
>    `urgent_cutoff` case is by definition inside 48 hours and dual approval
>    routinely takes longer.
>
> And a **segregation** check this phase should carry once `[A-1]` lands: submit as
> one identity, then try to sign the employer slot as that same identity. It must
> refuse `requester_cannot_approve` — and a *different* signatory must still
> execute. A refusal-only check cannot tell a working control from a dead one.

---

## Phase 4 — UC-01 end to end, through real Zendesk (15 min)

**Surface:** `npm run livedemo` → <http://localhost:4040>, then Zendesk.

This is the only phase that exercises the **live n8n path**: a real ticket, the
real trigger, real OpenAI, real Remote reads, real Supabase writes, real
Zendesk replies. Nothing is mocked and nothing is pinned.

Submit **four** requests, one per outcome:

| Request | Expected |
|---|---|
| Plain verification letter, requester email **matches** the record | `auto_resolve` — letter posted, ticket solved |
| Same, but **with an attachment** | `human_review` — internal note, queued for a specialist |
| Requester email **does not match** the record | `escalate` — `identity_not_verified` |
| Asks for salary to be included | routed for review — and **the letter must never contain salary** |

> **Checkpoint — disclosure.** Open the auto-resolved ticket and read the
> letter Zendesk actually rendered. It must be real HTML, not escaped source,
> and must contain no compensation figure even though the Sandbox record
> carries one. `publicReply` on the n8n Zendesk node is plain text and silently
> escapes HTML — a "successful" run once delivered `&lt;!doctype html&gt;…` to a
> customer with nothing in n8n indicating a problem. **Check the rendered
> comment, never the node's success flag.**

> **Checkpoint — exactly-once.** Re-fire the trigger on one ticket (add and
> remove a tag). Expect exactly ONE audit row, ONE case row, ONE letter. A
> redelivery must stop silently at `Duplicate Delivery — Stop`.

```sql
select external_ref, decision, reason, status from cases order by created_at;
select count(*) from audit_log where details->>'externalRef' = '<ticket id>';
```

---

## Phase 5 — the ZAF sidebar, inside Zendesk (15 min)

**Surface:** the Zendesk agent UI → **⊞ Apps tray** on the right rail.

1. Open the `human_review` ticket from Phase 4. The panel must show the tier,
   what the tier *means*, the flags, the reason, and approve/deny.
2. **Approve it.** Expect a confirmation banner that persists, the ticket
   updated, and a durable row.
3. Open an **escalated** ticket. It must be visible with **no buttons** — the
   safe path must never double as a dismiss button.
4. Try to approve the same case twice. Expect `409 already_decided`.
5. Approve with **no note**. Expect `reason_required`.
6. Open a UC-06 amendment. Expect **two independently-gated role blocks**, and
   confirm one role's approval does not fill the other's slot.

> **Checkpoint — the metric.** The audit row must carry BOTH the AI's
> recommendation and the human's verdict:
> ```sql
> select actor, action, details->>'aiDecision' ai, details->>'note' note
> from audit_log where action in ('human_approved','human_denied')
> order by at desc;
> ```
> `actor` must be a **real Zendesk email**, not a header default. That pairing
> is what makes the specialist accept rate a measurement rather than a
> definition.

> **Checkpoint — the breach.** From a terminal with no credentials:
> ```
> curl -s https://remote-cx-apis.vercel.app/uc01/api/review/ticket/<id>
> ```
> This **must** be refused. Until today it returned employment ids and real
> email addresses to anyone on the internet.

---

## Phase 6 — the read-only surfaces (10 min)

> **Coming to this phase: the Execution & Audit Trail viewer** (user-mandated
> requirement, 2026-08-18; being built as `src/auditview/`, `npm run audit-ui`,
> and `/audit` on the deployed function). It is the observability half of this
> whole plan: a live feed of every decision as it lands in `audit_log` from
> either execution path, and a bug-audit view — decision → its `audit_trace`
> attempts; externalRef → its claim row(s), decisions and nearby `ops_alerts`.
> Once landed, every checkpoint below that says "verify the destination" can be
> done in that UI instead of raw SQL — but the SQL remains the ground truth.

| Surface | Command | What to confirm |
|---|---|---|
| Dashboard | `npm run dashboard` → :4060 | all nine use cases visible; start each API first — the dashboard only polls |
| Metrics | `npm run metrics` → `demo/metrics.html` | auto-rate per tier, exception reasons ranked, **false-auto-approvals reads 0**, "stop automating" verdicts |
| Playground | `npm run playground` → :4030 | UC-01 offline, both hats |
| Chat demo | `npm run chatdemo` → :4046 | same handler, conversational |
| Walkthrough | `npm run walkthrough` | drives the real HTTP surfaces end to end |
| PDF | `npm run pdf-demo` | a letter rendered via Chromium |

> **Checkpoint — the invariant.** False-auto-approval count must read **0**,
> and no 🔴 use case may show any auto-resolution. A high auto-rate is success
> for 🟢, meaningless for 🟡 where the human gate *is* the design, and on 🔴 it
> is an integrity violation.

---

## Phase 7 — the deployed graphs (5 min)

```bash
npm run verify-claims     # exactly-once node on all nine, published and wired
npm run verify-deployed   # deployed Code-node bodies match the repo
npm run verify-traces     # audit_trace node on all nine
```

All three must report **0 defective, 0 with unpublished changes**. An update
that reports success while production runs the old graph is this project's
most expensive recurring mistake; `activeVersionId === versionId` is the only
thing that answers it.

---

## What a pass does NOT prove

Say this plainly rather than letting a green pass imply more than it earns:

- **Load.** One user clicking. No concurrency, no sustained rate.
- **Failure modes.** Supabase down, OpenAI rate-limited, n8n restarting
  mid-execution, Zendesk 500ing. None are exercised here.
- **Security beyond authn.** No penetration test, no dependency audit, no
  secret-rotation drill.
- **Data volume.** Tens of rows, not millions. Every query here is unindexed
  against a small table.
- **Time.** Nothing about certificate expiry, token rotation, or a Sandbox
  reseed — which has already broken this system once.

A complete pass means *the paths work end to end for one careful user*. That
is a real and necessary claim. It is not the same claim as "production ready",
and the difference should be stated wherever the results are.
