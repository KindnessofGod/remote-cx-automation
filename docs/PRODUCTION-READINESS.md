# Production readiness assessment

**Date:** 2026-08-16 · **Assessed against:** the live `your-subdomain` Zendesk
account, n8n `n8n.your-host.example`, Supabase `your-project-ref`,
Remote **Sandbox**.

> **Status update — 2026-08-17.** This assessment is kept as written on
> 2026-08-16, because an assessment edited into agreement with later work stops
> being evidence of anything. What has changed since is recorded in **§6** at
> the end, and the findings it affects are marked inline: **A1 and A2 are
> closed**, **A3 is half-closed and its recommended fix was partly wrong**,
> **C5's table count was stale**, and four defects nobody had found on 2026-08-16
> have since been fixed in production. The headline verdict below is unchanged.

**Verdict: no. This cannot go to production tomorrow.**

One use case (UC-01) could go to a **limited pilot** within about a week. The
other eight could not, and five of them have never executed against real
services at all.

This document exists because "all nine workflows are active" and "all nine
workflows are production ready" are very different claims, and the gap between
them is where an automation programme normally gets hurt. Every finding below
is backed by a live read taken today — an execution id, a version id, a table
row — not by a status table.

---

## 1. What is actually proven, per use case

"Proven" here means *a real, unpinned execution against the real service*. A
green n8n run with pinned nodes proves nothing (see `CLAUDE.md` §6), so every
column below was verified by opening executions and reading node-level status.

| Use case | Tier | Decision logic | Real Remote read | Real DB write | Customer-facing action | Driven by a real inbound ticket |
|---|---|---|---|---|---|---|
| **UC-01** Employment verification | 🟢 | ✅ | ✅ | ✅ | ✅ **letter delivered, ticket solved** | ✅ tickets #3–#6 |
| **UC-02** Expense validation | 🟢 | ✅ tests only | ⬜ | ⬜ | ⬜ | ⬜ |
| **UC-03** Travel letter router | 🟢 | ✅ | ✅ exec `404` | ✅ | ⬜ | ⬜ |
| **UC-04** Work authorization | 🟡 | ✅ | ✅ exec `3968` | ✅ | ⬜ fails on synthetic ref | ⬜ |
| **UC-05** Resignation notice | 🟡 | ✅ | ✅ exec `409` | ✅ | ⬜ fails on synthetic ref | ⬜ |
| **UC-06** Contract amendment | 🟡 | ✅ tests only | ⬜ | partial (2 rows) | ⬜ | ⬜ |
| **UC-07** Global mobility | 🔴 | ✅ tests only | ⬜ | ⬜ | ⬜ | ⬜ |
| **UC-08** Cross-border tax | 🔴 | ✅ tests only | ⬜ | ⬜ | ⬜ | ⬜ |
| **UC-09** Off-cycle payroll | 🔴 | ✅ tests only | ⬜ | ⬜ | ⬜ | ⬜ |

**One of nine is proven end to end.** Three more are proven as far as the audit
write. Five have never run against a real service outside a test harness.

The recurring stop is the same in every case: the final Zendesk step is handed a
descriptive `externalRef` like `standin-uc04-2`, and Zendesk requires an integer
ticket id. Execution `3968` is the clean example — nodes 0–6 all succeeded (real
Sandbox read of Alex Morgan, decision `ready_for_approval` with zero flags, real
`uc04_authorizations` row `e23285c6…`, real `audit_log` row `3f165471…`), and it
failed only at node 7. That failure sits **downstream of the audit write**, which
is exactly the ordering the architecture exists to guarantee — but it does mean
the customer-facing half of eight use cases is unexercised.

---

## 2. Blocking gaps

Grouped by what each one blocks. This grouping is the useful one: Tier A stops
any deploy at all, Tier B stops specifically the use cases that need a human
approver, Tier C is what separates "it runs" from "we can operate it."

### Tier A — blocks any production deploy

**A1 · Duplicate customer letters. Live, right now.** — ✅ **CLOSED 2026-08-17, see §6.1**
The running UC-01 workflow has no idempotency claim. Verified today:
`activeVersionId` is `cc7f3ea3-1669-4e30-bb7b-43cadaeabb4a`, and that graph goes
`Identity + Policy Gates → Append Audit Log` with no claim node between them. The
fix exists only in the unpublished draft (`versionId 4d252a97…`).

This is not theoretical. Ticket #5 received three near-simultaneous trigger
invocations and produced **two `audit_log` rows 30µs apart** and a duplicate
public letter to the customer. The other eight workflows have no claim node at
all. *Impact: a customer receives the same employment letter twice, and the
audit log double-counts a single decision.*

**A2 · A failure is silent. There is no alerting on any of the nine workflows.** — ✅ **CLOSED 2026-08-17, see §6.2**
No `errorWorkflow` is configured on any UC graph. Notably, a *different* project
on the same n8n instance (the WhatsApp campaign) has both an `Ops Alerts —
Telegram` error workflow and a `Watchdog — Stale Unanswered Replies` safety net
running every 5 minutes. The CX system — which writes to payroll-adjacent
records — has neither. *Impact: the first sign of a broken automation is a
customer complaint.*

**A3 · Production would be reading from Sandbox, and partly from a demo shim.** — 🟡 **HALF-CLOSED, and the fix recommended in §4 was partly WRONG. See §6.3 before acting on it.**
Every workflow points at Remote **Sandbox**, not production Remote. Worse, the
UC-01 draft points its employment read at
`https://your-sandbox-standin.vercel.app` — a stand-in I built to fill fields
the Sandbox leaves empty. That is correct for a demo and wrong for production.
**Publishing the draft to fix A1 would simultaneously put a demo shim in the
production data path.** Both facts are true and they pull against each other;
see §4.

**A4 · Single shared credential, no rotation.** One Zendesk OAuth client, one
Supabase service credential, one Remote token, all long-lived, all shared across
nine workflows. No rotation procedure exists. Separately, Zendesk retires API
tokens as an auth method on **2027-04-30** — not urgent, but dated.

### Tier B — blocks every 🟡 and 🔴 use case

**B1 · The approval UI is not installed. Five use cases produce work nobody can action.**
UC-04, 05, 06, 09 all end in a `pending_*_approval` state, and UC-07/08 produce
dossiers for a human to read. The ZAF sidebar that renders those queues has never
been installed into the live Zendesk account. *Impact: the automation would
faithfully prepare decisions into a queue with no user interface — worse than not
running it, because the customer has been told their request is in progress.*

**B2 · Even once installed, approvals would fail closed.**
`requireSignedIdentity` defaults to **true** whenever a durable store is attached
(commit `39a7e33`), and no ZAF verifier is provisioned — there are no `ZAF_*`
entries in the environment. So a persistent deployment refuses *every*
approve/deny until a verifier exists. This is the intended loud failure, not a
bug, but it is a deployment step nobody has done.

**B3 · No approver directory.** "Payroll specialist" and "mobility specialist"
are currently strings. Nothing checks that the human clicking approve holds that
role. The dual-approval invariant is enforced on *slot count*, not on *identity*.

### Tier C — operational readiness

| | Gap | Consequence |
|---|---|---|
| **C1** | No monitoring, no on-call, no dashboards on live traffic | No one knows the system's health without opening n8n |
| **C2** | No staging/production separation — one n8n, one Supabase project | Editing a workflow edits production. There is nowhere to test safely |
| **C3** | No runbook, no rollback plan, no documented kill switch | Under incident, the response is improvised |
| **C4** | Load test is explicitly synthetic — no real network call anywhere in it | Behaviour under real load against real APIs is unknown |
| **C5** | RLS enabled with **zero policies** on all ~~19~~ **20** tables (`ops_alerts` added 2026-08-17, same pattern) | Deny-all, which is the *safe* direction — but the service key is the only access control, so no defence in depth if it leaks |
| **C6** | `set_updated_at` has a mutable `search_path` (Supabase advisor, WARN) | Minor privilege-escalation surface |
| **C7** | Ultimate.ai posts a contradictory auto-reply on the same account | On ticket #6 it told the customer to expect a reply within 48 hours, 5 seconds *after* the automation had already answered and solved it |

### Tier D — data and compliance

**D1 · No real customer data has ever passed through this system.** Everything to
date is Remote Sandbox. That is correct practice, and it also means the
production data shapes are unvalidated.

**D2 · No retention policy on `audit_log`.** The table holds names, email
addresses, employment status, start dates and country. Nothing in the repo
defines how long those rows live or who may read them. For an EOR handling EU
employees this is a GDPR question that must be answered before real data enters.

**D3 · No PII redaction in audit details.** The `details` JSON captures the
classification input, which is customer-authored ticket text. It is stored
verbatim, forever.

---

## 3. What "yes" would require

### Option 1 — UC-01 limited pilot (~1 week)

The narrowest honest deployment: one 🟢 use case, tag-scoped, with a human
watching.

1. ~~Publish the idempotency fix **with the Remote URL pointed back at the real
   API**, not the stand-in (A1 + A3).~~ **Done 2026-08-17 for UC-01** — but the
   same repoint would have broken UC-04 and UC-05, which need the stand-in.
   See §6.3.
2. ~~Attach an error workflow with a real alert channel (A2).~~ **Done
   2026-08-17** (§6.2).
3. Write the runbook and the kill switch — how to deactivate the workflow in
   under a minute (C3).
4. Define `audit_log` retention and get it agreed (D2).
5. Scope the Ultimate.ai trigger away from these tickets (C7).
6. Keep the trigger tag-scoped. Do not widen it.

### Option 2 — all nine in production (~4–6 weeks)

Everything in Option 1, plus:

7. Install and configure the ZAF app; provision the signed-identity verifier;
   build the approver-role directory (B1, B2, B3).
8. Drive each of the eight remaining workflows from a **real inbound ticket with
   a real numeric id**, and read the resulting rows — the proof UC-01 has and
   they do not.
9. ~~Add the idempotency claim node to the other eight graphs.~~ **Done
   2026-08-17** — all nine carry it; four are proven end to end and five are
   half-proven (§6.1).
10. Separate staging from production (C2).
11. Point at production Remote and re-verify every schema (A3, D1).
12. Load-test against real services (C4).
13. Rotate and scope credentials properly (A4).

---

## 4. The one decision I need from you — ✅ **RESOLVED, and the recommendation was partly wrong. Read §6.3.**

Publishing the UC-01 draft is both the fix for A1 and the introduction of A3.
Three ways to go, in my order of preference:

1. **Edit the draft's Remote URL back to `gateway.remote-sandbox.com`, then
   publish.** Gets the idempotency fix live without putting the demo shim in the
   path. Costs the populated start-date field in demos, which is what the
   stand-in was for.
2. **Publish as-is**, accept the shim, and treat the whole thing as a demo
   environment rather than a production one. Fine if no real customer traffic is
   coming.
3. **Leave it unpublished** and accept that duplicate letters remain possible.
   Only reasonable if the trigger stays tag-scoped to test tickets.

I recommend (1). It is a two-minute edit and it keeps the demo useful while
removing the one production-correctness objection.

---

## 5. What is genuinely strong

Stating the gaps plainly does not mean the system is weak. Assessed honestly,
these hold up:

- **The audit-before-action ordering is real and proven under failure.** Every
  red execution in §1 failed at its *last* step with the audit row already
  durable. That is the architecture working exactly as designed, demonstrated
  by accident rather than by claim.
- **1104 hermetic tests** (1105 total, 1 skipped; 969 at the time of writing),
  no network, no keys, verified in CI with no secrets configured.
- **The 🔴 no-execution-path guarantee is structural**, not conditional —
  UC-07/08 take no write-capable client as a parameter, their stores have no
  mutation method, their APIs have no POST route, and their n8n graphs have no
  branch node. There is no bug that could turn them into an execution path.
- **The LLM boundary holds.** Every model output is validated against a strict
  shape with a rule-based fallback, every result is tagged `llm` or
  `rule_based_fallback`, and no model output reaches a gate unvalidated.
- **Failing closed is the default everywhere it matters** — unverified identity,
  missing effective date on an approvable amendment, unsigned approver identity.

The system's decision-making is in good shape. What is missing is almost
entirely the operational layer around it: alerting, a place for humans to click
approve, and proof against real traffic.

---

## 6. What changed on 2026-08-17

Everything below was verified against the live systems, not against a status
table: `npm run verify-deployed` (20 nodes, 0 drifted), `npm run verify-claims`
(9 workflows, 0 defective), 1104 hermetic tests, and direct reads of
`audit_log`, `workflow_claims` and `ops_alerts`.

**The verdict in §0 does not change.** Two of the four Tier A blockers are gone
and none of Tier B has moved, so the shape of "what yes would require" is the
same. What did change materially is §1's honesty: **four defects that this
assessment did not find were sitting in production while it was being written**,
three of them invisible to every test in the suite.

### 6.1 · A1 (duplicate letters) — CLOSED

Every one of the nine graphs now claims `(use_case, external_ref)` in a shared
`workflow_claims` table before its first durable write, and **the guarantee is
that table's PRIMARY KEY**, not application code — a check-then-insert has
exactly the race that produced the original two-audit-rows-30µs-apart bug.

UC-01's claim node was the specific thing this finding named as unpublished. It
has since been read back from the live graph: `activeVersionId === versionId`,
node present and wired `Identity + Policy Gates → Claim → Carry Context After
Claim → Append Audit Log`.

**Proven end to end on four of the nine** — UC-01, UC-04, UC-05, UC-07 — each
driven twice through its production webhook under one reference, each producing
exactly one claim row, one record row and one `audit_log` row, with the
redelivery stopping silently (12/12 row counts of exactly 1 across UC-04/UC-05's
two independent pairs, `pinData: {}` throughout). **Half-proven on the other
five**: UC-02, 03, 06, 08 and 09 each recorded a real claim row, but their
downstream rows were not separately verified in that pass. That distinction is
the finding that remains.

One defect found and fixed inside this work is worth carrying forward as a
warning: a request arriving with **no** external reference failed the key on a
`NOT NULL` column, took the claim node's error output and vanished at the
duplicate-stop NoOp — a green run that wrote nothing and dropped a real request.
Those are now claimed under `unreferenced:<execution id>`. `docs/BUILD-LOG.md`
§3.24–§3.25.

### 6.2 · A2 (silent failures) — CLOSED

`RCX OPS · Error Alerts (all use cases)` (`WORKFLOW_OPS_IDX`, active) is attached
as the `errorWorkflow` on all nine graphs. It writes a durable `ops_alerts` row —
use case, risk tier, failing node, execution URL, `error_message`,
`audit_durable`, `acknowledged` — **and then** pushes a notification, with the
push set to continue on error. The row is the alert; the push is a convenience,
because a chat message can be dismissed, cannot be counted and cannot feed a
dashboard.

`audit_durable` is the operationally important column: it says whether a failure
lost a *decision* or only lost a Zendesk update. Given this architecture's
audit-before-action ordering, most failures are the second kind and can wait;
the first kind is the only genuinely urgent failure this system produces, and it
is now identifiable without investigation.

34 rows recorded at the time of writing, including real induced failures. The
alerting bootstrap also produced correction C-13 (`docs/CORRECTIONS-LOG.md`):
the first version was wired to a Telegram credential belonging to a **different
project** on the shared n8n instance and delivered two test alerts there before
the owner caught it.

### 6.3 · A3 (Sandbox and the demo shim) — half-closed, and §4's recommendation was partly wrong

**Read this before acting on §4.** §4 recommended repointing the stand-in URL
back to `gateway.remote-sandbox.com` before publishing. That was correct for
UC-01 and has been done. It would have been **an outage** for UC-04 and UC-05.

The stand-in (`src/remotebridge/`) is not drift and not a mock: it is a
read-only proxy that forwards the caller's `Authorization` untouched, refuses
writes with `405`, and fills **only** fields the raw Sandbox leaves null, naming
each one in an `X-Standin-Enriched` header. UC-04 reads
`custom_fields.workation_permission` and UC-05 reads
`basic_information.start_date`; the raw gateway returns `undefined` for both. On
gateway data UC-04 would refuse **every** request with
`employer_permission_not_granted` and UC-05 would have no start date from which
to compute tenure.

The 404 that made the host look guilty was a **dead employment id** — the
Sandbox had been reseeded, and `fde4007b-…` 404s through *both* hosts
identically. Full write-up as correction C-15; the generalisable rule is that
when two things differ and one fails, the difference is a hypothesis, not a
cause.

What remains open in A3 is unchanged: everything still points at Sandbox rather
than production Remote, and no production schema has been validated (D1).

### 6.4 · Four defects this assessment did not find

None of these were known on 2026-08-16. All four were live. All four are now
fixed and verified in production.

| | Defect | Why §1's table said nothing | Evidence |
|---|---|---|---|
| **1** | **UC-03 could never succeed.** Its supported-destination gate compared 2-letter destinations against a list built from the alpha-3 `code` field, so a successful 224-row fetch yielded an empty list | The gate fails closed, so it produced a plausible escalation every time. §1 marked UC-03 as having working decision logic on the strength of exactly those runs | Execution `4259`: `supportedCountries: []` beside a healthy fetch. Post-fix audit rows `c644cdce` (Spain, `auto_resolve` — the **first** this use case has ever recorded) and `c8992d3d` (Afghanistan, `unsupported_destination`) |
| **2** | **Four identity gates verified a claim against itself** (UC-03/05/06/09) — two echoed the caller's own `employmentId` back as the authoritative record id, two compared a company id against a defaulted `null` | All four still refused, but by accident of gate ordering. The audit rows named a *different, plausible* reason, so nothing looked wrong | UC-05, identical input either side: `a324f666` (`employee_not_active`) → `283dbd1f` (`identity_not_verified`), with `946764ef` confirming a sound request still passes |
| **3** | **An upstream outage was recorded as a policy decision.** `onError: continueRegularOutput` reports *success* and emits an error object in place of data, so gates escalated naming the wrong cause | The node was green, the run was green, and the recorded reason was a normal one | Executions `4218`/`4232`/`4238`. Post-fix: UC-09 `105cd7c4` = `upstream_record_not_found` (1 failure) vs `590772ee` = `identity_not_verified` (**0**); UC-02 `f45e06c3` keeps `expense_not_found` with 2 failures as provenance |
| **4** | **A ref-less request was silently dropped** at the new claim node (see §6.1) | Green run, nothing written, no alert | Two deliveries now producing two distinct `unreferenced:` claims, both processed |

**The finding that matters more than the four fixes**, and it is a finding about
this assessment as much as about the system: *every fail-closed assertion in the
suite passed before all four of these were fixed.* This system is built to
refuse when unsure, which means **a broken component and a correctly cautious
one produce the same output, the same audit row, and the same passing test.**
Three of the four above were invisible for precisely that reason.

The instrument that detects this class of defect is not a safety test. It is a
**positive** test — "this specific known-good input MUST resolve" — for every
decision path. That is now a standing rule (`docs/BUILD-LOG.md` §4,
`docs/CORRECTIONS-LOG.md` P6), and it should be read as a gap in this document's
own method: §1's table asked "did a real execution write a real row?" and every
one of these four defects answers *yes*.

### 6.5 · §1's table, restated as of 2026-08-17

Two columns move; the rest do not.

- **Real DB write:** now ✅ for **all nine**. Every use case has written at
  least one real `audit_log` row from an unpinned production-webhook drive dated
  2026-08-17 (83 rows total, 9 use cases represented).
- **Customer-facing action:** unchanged — ✅ **UC-01 only**. The others still
  stop at the Zendesk step, most commonly on a non-numeric `externalRef`.
- **Driven by a real inbound ticket:** unchanged — ✅ **UC-01 only** (tickets
  #3–#6).

So the honest headline moves from *"five have never run against a real service"*
to *"all nine have written real decisions; one has ever completed a
customer-facing action."* Tier B is untouched: the approval UI is still not
installed, signed approver identity is still not provisioned, and there is still
no approver-role directory — which is what actually gates the 🟡 and 🔴 use
cases, whatever their execution proof now says.
