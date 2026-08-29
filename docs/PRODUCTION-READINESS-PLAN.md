# Getting UC-01 … UC-09 production ready

**Status: 2026-08-16, with a 2026-08-17 progress pass marked inline.**
Companion to `docs/PRODUCTION-READINESS.md` (which assesses where we stand —
see its **§6** for what has changed since it was written). This document is the
*plan*: what a system of this shape needs in general, what this system is
missing specifically, and how each gap gets closed.

> **Progress as of 2026-08-17.** Stage 0 is done, Stage 1 is done apart from the
> watchdog and the runbook, and Stage 2 is done and partly proven. Dimensions
> **2 (exactly-once)**, **4 (alerting)** and **13 (proof)** have all moved and
> are updated below. Dimensions 5, 6, 7, 8 and 10 have not moved at all, and
> they are what actually gate the 🟡 and 🔴 use cases.
>
> One dimension should arguably be added to Part 1's thirteen, because this
> project has now been bitten by it four times in one day: **can you tell a
> component that is correctly cautious from one that is structurally incapable
> of succeeding?** Everything here fails closed, so both produce identical
> output, identical audit rows and identical passing tests. The answer is a
> *positive* test per decision path — see `docs/BUILD-LOG.md` §3.28.

The goal is a system whose every claim survives someone opening the console —
which means every claim in it survives someone opening the console and
checking.

---

## Part 1 — What "production ready" means for a system like this

An automation layer that reads an HR system of record, decides, and writes back
to a customer-facing channel is not judged like a web app. It is judged like a
payments system with a natural-language front door. Thirteen dimensions, in the
order a reviewer will probe them.

| # | Dimension | The question it answers |
|---|---|---|
| 1 | **Decision correctness** | Does the logic that runs match the logic that was tested? |
| 2 | **Exactly-once** | Can one customer request produce two customer-visible effects? |
| 3 | **Observability** | Can you reconstruct why a specific decision happened, months later? |
| 4 | **Alerting & incident response** | How do you find out it broke, and what do you do? |
| 5 | **Human-in-the-loop surface** | Where does a human actually click approve? |
| 6 | **Identity & authorization** | Can you prove *which human* approved? |
| 7 | **Data protection** | How long is personal data kept, and who can read it? |
| 8 | **Environments & release** | Is there anywhere to test that is not production? |
| 9 | **Resilience** | Retries, timeouts, rate limits, and where failures go to die |
| 10 | **Capacity & cost** | What happens at 100× volume, and what does it cost? |
| 11 | **Security** | Secrets, rotation, least privilege, blast radius |
| 12 | **Documentation & runbooks** | Can someone who is not you operate it at 3am? |
| 13 | **Proof** | Has each path actually run against real services, unpinned? |

A system can score perfectly on 1–3 and still be nowhere near production if 4,
5 and 13 are empty. That is roughly our situation.

---

## Part 2 — Where this system stands, dimension by dimension

### 1 · Decision correctness — **strong, with one hole just closed**

Deterministic gates, an LLM that only ever interprets, strict shape validation
with a rule-based fallback, and a parity test executing the n8n Code node body
against the Node implementation for every scenario.

**The hole, found and fixed today:** the gates existed in *three* copies, not
two — `policyEngine.js`, `workflows/nodes/gates.js`, and *the body actually
deployed in n8n*. The parity test covered the first two. The third was behind by
three shipped fixes: the over-scope disclosure gate (F-17), the fail-closed
confidence check (F-19), and `out_of_scope` routing. Those were written,
reviewed, tested, committed and pushed — and never ran for a customer.

Closed by redeploying from the parity-tested file and adding
`npm run verify-deployed`, which diffs deployed node bodies against their source
files and exits non-zero on drift.

> **The lesson worth carrying forward:** a parity test between two
> files you control is the easy half. The half that matters is whether the thing
> serving traffic is either of them.

**Also fixed today:** `escapeHtml(null)` returns `""`, so a record missing a
start date rendered a verification letter with a silently **blank** field — and
nothing could catch it, because a blank string is a valid render, the Zendesk
write succeeds and the audit row reads `auto_resolve / all_gates_passed`. That
letter goes to a bank or an immigration officer as a statement of fact. Gate 7
now refuses to auto-issue when any printed field is absent.

**Remaining:** the n8n `Render Letter` node is a *different, simpler* letter than
`src/uc01/letter.js` — no legal entity, no disclaimer, no "financial details are
not disclosed" clause. Customers receive the n8n one. This is a fourth
divergence, currently unmanaged.

### 2 · Exactly-once — **built for UC-01 only, and not yet live**

`workflow_claims` with a `PRIMARY KEY (use_case, external_ref)` is the right
design: the guarantee is the database constraint, not application code, because
a check-then-insert in a Code node has exactly the race that caused the original
bug. Verified today: `claimExternalRef` appears in `src/uc01/workflow.js` and
nowhere else.

- **UC-01 Node path:** fixed and tested.
- **UC-01 n8n path:** in the draft, awaiting publish.
- **UC-02 … UC-09:** no claim in either path.

Real duplicate already observed: ticket #5 produced two audit rows 30µs apart
and a duplicate public letter.

> **Updated 2026-08-17 — now live on all nine, proven on four.** The heading
> above is stale and kept for the record. Every graph carries
> `Claim Ticket (Idempotency)`; UC-01's node is confirmed as the *active*
> version (`activeVersionId === versionId`). **Proven end to end on UC-01,
> UC-04, UC-05 and UC-07** — driven twice under one reference, exactly one
> claim row, one record row and one audit row each. **Half-proven on UC-02, 03,
> 06, 08, 09** — one real claim row each, downstream rows unverified.
> One defect found inside this work: a request with **no** external reference
> failed the `NOT NULL` key, took the error output and was silently dropped —
> a green run that wrote nothing and lost a real request. Now claimed under
> `unreferenced:<execution id>`. `docs/BUILD-LOG.md` §3.24–§3.25.

### 3 · Observability — **the strongest dimension**

Append-only `audit_log`, a two-level `audit_trace` recording every LLM/API
*attempt*, source-tagging on every LLM result, and a metrics layer whose
judgements are tier-aware — a high auto-rate is success for 🟢, meaningless for
🟡, and an integrity violation for 🔴.

The audit-before-action ordering is real and has been proven under genuine
failure: every red execution failed at its *last* node with the audit row
already durable.

**Remaining:** no dashboard on live traffic (metrics runs offline over synthetic
tickets), and no alerting on the invariant counts that are supposed to read zero.

**New requirement (user-mandated, 2026-08-18): an Execution & Audit Trail
viewer.** Everything above records; nothing lets a human *watch*. The
requirement is a separate read-only UI that (a) shows every execution as it
happens — a live feed over `audit_log`, both execution paths, since the n8n
graphs write the same table; (b) makes a bug auditable after the fact: click a
decision → its full record and every `audit_trace` attempt beneath it, paste an
externalRef → its `workflow_claims` row(s), every decision carrying it, and any
`ops_alerts` near it in time. Read-only in the UC-08 structural sense (no POST
route exists), gated by the portal's shared key on the public deployment.
**In flight** as `src/auditview/` + `npm run audit-ui` + a `/audit` mount on
the Vercel function; see `docs/AUDIT-VIEWER.md` once landed.

### 4 · Alerting & incident response — ~~**absent**~~ **alerting built 2026-08-17; runbook and watchdog still absent**

No error workflow on any of the nine graphs. No on-call. No runbook. A different
project on the same n8n instance has a Telegram error handler and a five-minute
watchdog; this one has neither.

> **Updated 2026-08-17.** `RCX OPS · Error Alerts (all use cases)`
> (`WORKFLOW_OPS_IDX`) is now the `errorWorkflow` on all nine. It writes a
> durable `ops_alerts` row (use case, risk tier, failing node, execution URL,
> `audit_durable`) **and then** pushes a notification, push allowed to fail —
> the row is the alert, the chat message is a convenience. `audit_durable`
> carries the triage order: true means the decision survived the failure and it
> can wait; false means a decision was made and never recorded, which is the
> only urgent failure this system produces. 34 rows recorded so far.
> **Still absent: the stale-work watchdog (1.3), the runbook and the kill
> switch (1.4), and on-call itself.** Also note correction C-13 — the first
> version of this alerting was wired to another project's Telegram bot and
> delivered two test alerts there.

### 5 · Human-in-the-loop surface — **built for all nine, installed for none**

Verified today: `zaf-app/assets/panels.js` registers panels for UC-01 through
UC-09. The sidebar refuses the right things — escalations render without
buttons, a 🔴 case can never be executed from it, a decided case cannot be
decided twice, and an approval re-reads the employment record first.

**It has never been installed into the live Zendesk account.** Five use cases end
in a pending-approval state, so today they would prepare decisions into a queue
with no interface. This is the single largest gap between "nine workflows are
active" and "nine use cases work."

### 6 · Identity & authorization — **mechanism built, not provisioned**

Signed approver identity is required by default whenever a durable store is
attached. No verifier is provisioned, so a persistent deployment refuses every
approve/deny — the intended loud failure. There is also no approver *directory*:
"payroll specialist" is a string, and nothing checks that the human clicking
approve holds the role. Dual approval is enforced on slot count, not identity.

### 7 · Data protection — **unaddressed**

No retention policy on `audit_log`, which holds names, emails, employment status,
start dates and country. No PII redaction — customer-authored ticket text is
stored verbatim, indefinitely. No DPA, no residency decision, no
subject-access-request path. For an EOR touching EU employees this is the gap
most likely to stop a real deployment, and it is not a coding problem.

### 8 · Environments & release — **absent**

One n8n instance, one Supabase project, one Zendesk account. Editing a workflow
edits production. n8n's draft/publish split is the only safety, and it is
subtle: `update_workflow` writes a **draft**, so an edit that looks applied
changes nothing until published — a trap already paid for twice.

### 9 · Resilience — **partial**

`withRetry()` is wired into the LLM call sites in all nine use cases (verified).
The REST clients still have no retry/backoff. There is no dead-letter path: a
webhook that fails after retries is simply gone. No rate-limit handling against
Zendesk or Remote.

### 10 · Capacity & cost — **unmeasured**

The load test is explicitly synthetic — no real network call anywhere in it, and
the file says so honestly. Real throughput, real API rate limits, and per-ticket
LLM cost are all unknown. There is no cost model.

### 11 · Security — **defensible posture, thin margins**

RLS is enabled with zero policies on all 19 tables. That is deny-all, which is
the *safe* direction, and Supabase's own advisor rates it INFO rather than a
vulnerability. But the service credential is then the only access control, with
no defence in depth if it leaks. One database function has a mutable
`search_path` (WARN). Credentials are long-lived, shared across nine workflows,
and have no rotation procedure.

### 12 · Documentation — **genuinely strong, and unusually honest**

~7,000 lines across foundation, architecture, coherency map, per-use-case specs,
metrics, glossary, walkthrough, testing guide and build log. Claims are tagged
`[CONFIRMED]` / `[INFERRED]` / `[PROPOSED]`. The status tables are load-bearing
and mostly accurate.

**Remaining:** no runbook, no incident playbook, no architecture decision record
for the big calls.

### 13 · Proof — **1 of 9** for the customer-facing action; **9 of 9** for a real durable decision

Only UC-01 has completed a real, unpinned, end-to-end run including the
customer-facing action. UC-03/04/05 are proven as far as the audit write. Five
have never run against a real service.

> **Updated 2026-08-17.** The second sentence is now wrong in the good
> direction: **all nine** have written at least one real `audit_log` row from an
> unpinned production-webhook drive (83 rows, all nine use cases represented).
> The first sentence still stands unchanged — **UC-01 remains the only use case
> that has ever completed a customer-facing action**, and the only one ever
> driven by a real inbound ticket.
>
> A caution this dimension needs and did not have: **"a real execution wrote a
> real row" is not the same claim as "this use case works."** UC-03 wrote
> genuine unpinned rows for weeks while being structurally incapable of
> approving anything (`docs/PRODUCTION-READINESS.md` §6.4). Proof of *execution*
> and proof of *capability* are different measurements, and only a positive test
> supplies the second.

---

## Part 3 — Per-use-case gap table

Updated 2026-08-17. "Idempotent" now distinguishes **proven** (driven twice
under one reference, exactly one of every downstream row) from **half** (a real
claim row written, downstream rows not verified in that pass).

| | Core logic | API | ZAF panel | n8n graph | Idempotent | Real proof | Customer action proven |
|---|---|---|---|---|---|---|---|
| UC-01 🟢 | ✅ | ✅ | ✅ | ✅ active | ✅ proven | ✅ | ✅ |
| UC-02 🟢 | ✅ | ✅ | ✅ | ✅ active | 🟡 half | ✅ | ❌ |
| UC-03 🟢 | ✅ | ✅ | ✅ | ✅ active | 🟡 half | ✅ | ❌ |
| UC-04 🟡 | ✅ | ✅ | ✅ | ✅ active | ✅ proven | ✅ | ❌ |
| UC-05 🟡 | ✅ | ✅ | ✅ | ✅ active | ✅ proven | ✅ | ❌ |
| UC-06 🟡 | ✅ | ✅ | ✅ | ✅ active | 🟡 half | ✅ | ❌ |
| UC-07 🔴 | ✅ | ✅ | ✅ | ✅ active | ✅ proven | ✅ | ❌ |
| UC-08 🔴 | ✅ | ✅ | ✅ | ✅ active | 🟡 half | ✅ | ❌ |
| UC-09 🔴 | ✅ | ✅ | ✅ | ✅ active | 🟡 half | ✅ | ❌ |

"Real proof" means *a real, unpinned execution wrote a genuine `audit_log` row*
— all nine now have one, dated 2026-08-17. It does **not** mean the use case
demonstrably works: UC-03 had it for weeks while being structurally incapable of
approving anything. Read it alongside dimension 13's caution.

Idempotency was originally marked `n/a` for UC-07/08 because they have no
execution path — a duplicate dossier is not a duplicate customer effect. The
claim node was added to them anyway, on the grounds that a duplicate dossier is
still a duplicate `audit_log` row, and the audit log is supposed to count
decisions, not deliveries.

---

## Part 4 — The plan

Sequenced so that each stage leaves the system in a defensible state. Stage 0
must come first: it removes a live customer-visible defect.

> **Stage status, 2026-08-17.** Stage 0: **done** (0.1 published, 0.2 clean —
> 20 nodes, 0 drifted; 0.3 still outstanding). Stage 1: **1.1 and 1.2 done**,
> 1.3 and 1.4 outstanding. Stage 2: **done and partly proven** — all nine
> graphs claim, four are proven end to end, five are half-proven (2.3 is the
> remainder). Stages 3–6: **not started**.

### Stage 0 — Stop the bleeding (today, ~1 hour)

| Step | Who | Notes |
|---|---|---|
| 0.1 Publish the UC-01 draft | **You** | Now carries the idempotency claim, the synced gates node, and the real Sandbox URL. Blocked from this session by the permission classifier |
| 0.2 Run `npm run verify-deployed` | You (needs `N8N_API_KEY`) | Confirms no remaining drift. Exits 2 if it cannot reach n8n — a skipped check must not look like a pass |
| 0.3 Scope the third-party bot away from these tickets | You | It currently contradicts the automation on the same ticket |

### Stage 1 — Make failure visible (1–2 days)

| Step | Who | Notes |
|---|---|---|
| 1.1 Build a shared error workflow with a real alert channel | Me | One graph, referenced by all nine via `errorWorkflow` |
| 1.2 Attach it to all nine | Me | Single settings change per workflow |
| 1.3 Add a stale-work watchdog | Me | Flags anything sitting in a pending state too long — the failure mode nobody sees |
| 1.4 Write the runbook and kill switch | Me | How to stop everything in under a minute, per use case |

### Stage 2 — Exactly-once everywhere (1 day)

| Step | Who | Notes |
|---|---|---|
| 2.1 Add `claimExternalRef` to UC-02…UC-06, UC-09 Node paths | Me | Same ledger, keyed by use case |
| 2.2 Add the claim node to the seven graphs that need it | Me | Mirrors UC-01's shape exactly |
| 2.3 Test the duplicate path per use case | Me | Two deliveries, one effect |

### Stage 3 — Give humans somewhere to click (2–4 days)

| Step | Who | Notes |
|---|---|---|
| 3.1 Package and install the ZAF app | **You** | `zcli apps:package zaf-app`, upload in Admin Center. Panels already exist for all nine |
| 3.2 Provision the signed-identity verifier | **You** + me | Without it every approve/deny is refused |
| 3.3 Build the approver-role directory | Me | So "payroll specialist" is checked, not asserted |
| 3.4 End-to-end approval test per 🟡 use case | Both | Approve one, deny one, confirm both land in `audit_log` |

### Stage 4 — Prove the other eight (2–5 days)

| Step | Who | Notes |
|---|---|---|
| 4.1 Create a real Zendesk ticket per use case with a real numeric id | Both | The synthetic `externalRef` is what has blocked every run at the last node |
| 4.2 Read the resulting rows and the ticket itself | Me | Destination, not run status |
| 4.3 Record the execution id per use case | Me | The table in Part 3 becomes all ✅ |

### Stage 5 — Operational hardening (1–2 weeks)

| Step | Who | Notes |
|---|---|---|
| 5.1 Separate staging from production | **You** | Second n8n project + Supabase branch. The biggest structural gap |
| 5.2 Retry/backoff on the REST clients | Me | The LLM sites have it; the REST clients do not |
| 5.3 Dead-letter path for exhausted retries | Me | Today a failed webhook is simply gone |
| 5.4 Live metrics dashboard + invariant alerting | Me | The tier invariants must alert, not just report |
| 5.5 Load test against real services | Both | Discovers the rate limits we have never hit |
| 5.6 Credential rotation + least privilege | **You** | Per-workflow credentials, documented rotation |

### Stage 6 — Data protection (needs a decision, not code)

| Step | Who | Notes |
|---|---|---|
| 6.1 Decide `audit_log` retention | **You** | Competing pulls: audit value vs. GDPR minimisation |
| 6.2 Implement retention + redaction | Me | Once 6.1 is decided |
| 6.3 Subject-access-request path | Me | "What do you hold about me" must be answerable |
| 6.4 Residency and DPA position | **You** | Only matters against real data |

---

## Part 5 — What I can start now without you

Everything marked "Me" above, in this order: **1.1 → 1.4 → 2.1 → 2.2 → 5.2 →
5.3 → 3.3**. That is roughly a week of work and it needs no credential I do not
already have.

Three things genuinely need you, and they are the ones on the critical path:

1. **Publish the UC-01 draft** (Stage 0.1) — removes a live defect.
2. **Install the ZAF app** (Stage 3.1) — without it, five use cases are
   decorative.
3. **Decide retention** (Stage 6.1) — a business judgement, not an engineering
   one.

---

## Part 6 — How to describe this system honestly

Two framings, both true, and the second is much stronger.

**Weak:** "I built nine automated use cases across three risk tiers."

**Strong:** "I built nine, put them behind a tiered execution model, and then
measured what was actually true. One was provably working end to end; four had
never completed a customer-facing action; and the deployed decision logic had
silently drifted three fixes behind the tested source — which no test could
catch, because every test compared two files neither of which was running. I
built the check that closes that gap, and I can tell you exactly what each of
the remaining eight still needs."

The second answer demonstrates the thing the role is actually scarce in:
measuring impact honestly and knowing what *not* to claim. The gaps in Part 2
are not weaknesses in the story — they *are* the story, provided you can name
every one of them and say how it gets closed.
