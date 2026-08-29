# Remote CX AI Automation

A CX automation layer for an Employer-of-Record platform, built against
[Remote](https://remote.com)'s real API. It resolves support requests on one
principle:

> **AI interprets. Deterministic code decides. Humans control the exceptions.**

An LLM is excellent at reading messy human language and unfit to be trusted with
payroll, contracts, or legal state. So the LLM only *understands* the request —
every decision that changes anything is made by plain, testable code, and the
risk of the request determines how much automation is allowed at all.

> **New here? Pick the door that matches you.**
> - **You will change the code** — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
>   what exists and where. Then, if you want the reasoning,
>   [`docs/WHY-THIS-SHAPE.md`](docs/WHY-THIS-SHAPE.md) — why the system is built
>   this way, taught through the defects that produced each rule. It is long on
>   purpose; read it second, not first.
> - **You will run it or evaluate it** —
>   [`docs/START-HERE.md`](docs/START-HERE.md), a fifteen-minute guided tour that
>   assumes no knowledge of this codebase, of Employer-of-Record platforms, or
>   of the tools involved.
> - **You want to know what it does and what it refuses to do** —
>   [`docs/FOR-CX-LEADERS.md`](docs/FOR-CX-LEADERS.md), no code, written for the
>   person who would own the support queue this sits in front of.
> - **You want to know whether it actually works** —
>   [`docs/QA-EVIDENCE.md`](docs/QA-EVIDENCE.md), fifteen blinded four-observer
>   acceptance rounds and the round that voided 37 of its own findings, ending
>   in a verdict of NEGATIVE. Then [`evals/README.md`](evals/README.md) for the
>   frozen 48-case regression suite on both the model and the fallback.
>
> This README is the summary of all four.

**Built with heavy AI assistance (Claude Code), stated here rather than at the
bottom.** The subject matter is AI-assisted workflows, so how the work itself
was driven is evidence rather than a disclaimer about it — and the same applies
to how it was tested: the four acceptance observers in
[`docs/QA-EVIDENCE.md`](docs/QA-EVIDENCE.md) are separate isolated agent
instances, which is what makes their independence auditable byte-by-byte
instead of taken on trust. [`CLAUDE.md`](CLAUDE.md) is the engineering journal
that records it, including the defects the approach produced and what each cost
to find.

---

## The spine: risk tiers decide the automation boundary

Nine CX use cases, one system. The tier is not a label — it selects the
execution path in code.

| Tier | Execution | Human role | Use cases |
|---|---|---|---|
| 🟢 **Low** | Zero-touch after deterministic validation | Exception-gated only | 01 Employment verification · 02 Expense & receipt validation · 03 Travel-support letters |
| 🟡 **Medium** | AI prepares + risk-scores → human approves, then execute | Approver (dual for 06) | 04 Work authorization · 05 Offboarding & notice · 06 Contract amendment / payroll cutoff |
| 🔴 **High** | AI compiles a dossier and escalates. For 07 and 08, **no execution path exists at all**; 09 is the one exception and earns it (below). | Author / multi-role approver | 07 Global mobility · 08 Cross-border tax · 09 Off-cycle payroll |

The 🔴 tier is the point. Building the ability to *not* automate — and proving
it with a test asserting no write path is reachable — matters more than
automating everything. For UC-07 and UC-08 that is structural, not a policy
check: their workflow functions take no write-capable client as a parameter, so
there is nothing to pass even by mistake.

**UC-09 is the deliberate exception, and the distinction matters.** Off-cycle
payroll moves real money, so it needs a real execution path — but it is gated
behind a multi-role approval whose floor `Math.max(2, …)` guarantees can never
drop below two people, whatever the risk score computes. "No automation" and
"no execution" are different claims, and this system makes both, in the places
each belongs.

---

## Status: what is actually built

Honest, and kept current. `docs/BUILD-LOG.md` is the detailed version.

| Capability | Status |
|---|---|
| UC-01 end-to-end decision flow (classify → fetch → identity → gates → route → audit) | ✅ Built. `npm test` on this published tree: **4,309 passing, 0 failing, 3 skipped**, hermetic — no network, no API keys, across all nine use cases. <sup>[1](#note-1)</sup> |
| Remote API reads | ✅ Real, verified live against Remote **Sandbox** |
| LLM classification with validated JSON + rule-based fallback | ✅ Real (OpenAI) |
| Zendesk read + write + create (reply, resolve, internal note, tags, new ticket) | ✅ Real, verified live via OAuth `client_credentials` |
| Audit log + case/review-queue/document state | ✅ Real, Supabase Postgres |
| Specs for all 9 use cases | ✅ `docs/use-cases/UC-01.md … UC-09.md` |
| Metrics & impact dashboard (`npm run metrics`) | ✅ Built — tier-aware verdicts incl. "stop automating this" |
| n8n workflow (UC-01) | ✅ Built, **live and active**, credentialed end to end. **19 nodes as deployed** (read back from the live graph 2026-08-18) — it began as the 14-node reference graph and grew an idempotency claim pair and two audit-trace nodes. <sup>[2](#note-2)</sup> |
| n8n workflows (UC-02 … UC-09) | ✅ Built, credentialed, parity-tested, and **all active** — re-verified live 2026-08-18 via the n8n API: all nine `active: true`, all nine published (`activeVersionId == versionId`), 150 nodes in total. <sup>[3](#note-3)</sup> |
| Exactly-once delivery (duplicate webhook deliveries) | ✅ Built on **both** execution paths — `claimExternalRef()` in the Node app and a `Claim Ticket (Idempotency)` node in all nine n8n graphs, claiming `(use_case, external_ref)` in one shared `workflow_claims` table before the first durable write. <sup>[4](#note-4)</sup> |
| Identity proved against the record, never against the claim | ✅ Fixed 2026-08-17 and **proven in production**. Four n8n gates (UC-03/05/06/09) could report `verified: true` having proved nothing — two echoed the caller's own `employmentId` back as the "authoritative" record id, two compared a company id against a defaulted `null`. <sup>[5](#note-5)</sup> |
| An upstream outage is not recorded as a policy decision | ✅ Built (`src/shared/upstreamFailure.js`), live on UC-02/06/09. <sup>[6](#note-6)</sup> |
| Ops alerting (a failure reaches a human) | ✅ Built and active on all nine — `RCX OPS · Error Alerts` writes a durable `ops_alerts` row (use case, tier, failed node, execution URL, `audit_durable`) **and then** pushes a notification, push allowed to fail. <sup>[7](#note-7)</sup> |
| ZAF sidebar (human approval UI) | ✅ Built (`zaf-app/` + `npm run review-api`) — approve/decline writes to `audit_log`. <sup>[8](#note-8)</sup> |
| Approver **role** entitlement | ✅ Built (`src/review/approverEntitlement.js`) — the other half of "identity comes from an authenticated signal, never a claim". <sup>[9](#note-9)</sup> |
| Approval queue (`npm run queue-ui` → `:4047`, `/queue` deployed) | ✅ Built (`src/approvalqueue/`) — read-only *by construction*: no POST route exists at all, asserted behaviourally and structurally. <sup>[10](#note-10)</sup> |
| Execution & audit-trail viewer (`npm run audit-ui` → `:4044`, `/audit` deployed) | ✅ Built (`src/auditview/`) — live feed over `audit_log`, drill-down to every `audit_trace` attempt, a bug-audit view keyed by any identifier a request carries, and an `ops_alerts` view. <sup>[11](#note-11)</sup> |
| Statutory knowledge corpus (`docs/knowledge/`) | ✅ **35 of 39** Layer-1 statutory and agency documents retrieved from their own authorities, each with a provenance header carrying source, URL, retrieval date, SHA-256 of the bytes and licence. <sup>[12](#note-12)</sup> |
| Demo scenario matrix (NL · PT · CA · US) | ✅ `docs/DEMO-COUNTRIES.md` — 77 scenarios across all nine use cases, run against the **live** Sandbox, recorded with an *observed* column rather than an expected one. 68 matched their prediction; **9 did not**, and those nine are the useful part. |
| **The nine APIs, deployed and public** | ✅ Live at `https://remote-cx-apis.vercel.app` — one Vercel serverless function serving all nine behind path prefixes `/uc01`…`/uc09`, plus `/`, `/healthz`, `/__cx/health`, `/__cx/routes`. <sup>[13](#note-13)</sup> |
| Interactive playground (act as client + specialist, one page) | ✅ Built (`npm run playground` → `:4030`), offline only |
| Chat demo (UC-01 as a conversation) | ✅ Built (`npm run chatdemo` → `:4046`) — every message runs through the real handler and renders its actual result; a demo/testing aid, not a submission deliverable |
| Live demo (real Zendesk ticket → real n8n pipeline) | ✅ Built (`npm run livedemo` → `:4040`) and **confirmed working end to end** — a real ticket drove the live n8n graph to a real resolution: 29/29 nodes green, nothing pinned, the audit row written before the customer reply, letter delivered, ticket solved. <sup>[14](#note-14)</sup> |
| Request portal (intake for the seven use cases without an entry point) | ✅ Built (`npm run portal` → `:4042`, `/portal` deployed) — seven forms, each running that use case's real workflow in-process, and each now saying in the requester's own words what it is for. <sup>[15](#note-15)</sup> |
| Unified dashboard (all nine use cases on one page) | ✅ Built (`npm run dashboard` → `:4060`) — a viewer only; it starts nothing and polls the nine APIs live |
| Shared design system across every browser surface | ✅ Built (`src/shared/ui/remote-ui.css`) — one stylesheet behind the dashboard, portal, playground, chat demo, live demo, Remote UI stand-in, metrics page and ZAF sidebar, in light and dark |
| UC-06 (Contract Amendment / Payroll Cutoff) | ✅ Built (`src/uc06/`, `npm run uc06-api`) — dual-approval flow + HTTP API + real Supabase persistence + ZAF panel (two named approval roles), cutoff engine, dynamic schema, money ×100. n8n workflow built, parity-tested, **active**, and **proven by real unpinned executions** that wrote genuine `uc06_amendments` and `audit_log` rows (most recent 2026-08-17). <sup>[16](#note-16)</sup> |
| UC-08 (Cross-Border Tax & Social Security) | ✅ Built (`src/uc08/`, `npm run uc08-api`) — the 🔴 use case with **no execution path**, proven structurally and behaviorally by test, true of its store (one write method, zero mutations) and its read-only API (no POST route exists) too. <sup>[17](#note-17)</sup> |
| UC-02 (Expense & Receipt Validation, 🟢) | ✅ Core + API (`src/uc02/`, `npm run uc02-api`) — 12 deterministic gates, LLM category-classification seam. <sup>[18](#note-18)</sup> |
| UC-03 (Travel Support Letter / Workation router, 🟢) | ✅ Core + HTTP API (`src/uc03/`, `npm run uc03-api`) — **not read-only: three sign-off write routes exist** (`server.js:199,242,274`), added by `c295ef1` — thin router to UC-04/07/08, no compliance logic of its own. <sup>[19](#note-19)</sup> |
| UC-04 (Work Authorization / Workation, 🟡) | ✅ Core + API (`src/uc04/`, `npm run uc04-api`) — origin→destination risk matrix, single-specialist approval. <sup>[20](#note-20)</sup> |
| UC-05 (Resignation Notice Calculation, 🟡) | ✅ Core + API (`src/uc05/`, `npm run uc05-api`) — an **11**-country statutory notice table (three rows carry a retrieved statute; the rest carry a short citation string only), single HR Ops sign-off — and the report is the artifact. <sup>[21](#note-21)</sup> |
| UC-07 (Global Mobility / Permanent Relocation, 🔴) | ✅ Core + read-only API (`src/uc07/`, `npm run uc07-api`) — second no-execution-path build alongside UC-08, same structural + behavioral proof. <sup>[22](#note-22)</sup> |
| UC-09 (Off-Cycle Payroll / Adjustment, 🔴-framed, has execution) | ✅ Core + API (`src/uc09/`, `npm run uc09-api`) — the one 🔴-framed use case with a real execution path, gated behind a floor-of-2 multi-role approval that can never drop below 2 regardless of risk score. <sup>[23](#note-23)</sup> |

### Notes on the table above

Every qualification, correction and caveat that would otherwise sit inside a
table cell. Nothing is dropped — a status table exists to be scanned, and
cells of 250–1,800 characters cannot be.

<a id="note-1"></a>**1. UC-01 end-to-end decision flow (classify → fetch → identity → gates → route → audit)** — The count moves, so it is quoted here once, against this tree, and nowhere else

<a id="note-2"></a>**2. n8n workflow (UC-01)** — Real `audit_log` write from n8n proven 2026-08-01, and the audit-before-Zendesk ordering fix is the **active** version, not a draft — `activeVersionId == versionId` on the live workflow (`workflows/README.md`)

<a id="note-3"></a>**3. n8n workflows (UC-02 … UC-09)** — **All nine have now written real rows to real Supabase tables from real unpinned executions** — `audit_log` holds rows for every one of UC-01…UC-09, the most recent from 2026-08-17, alongside populated `uc04_authorizations`, `uc05_resignations`, `uc06_amendments`, `uc07_dossiers` and `uc08_dossiers` tables. An earlier revision of this row said only four or five were proven; that is now out of date in the system's favour. **What is still not proven is per-use-case exactly-once** (see the idempotency row) and inbound triggering: only UC-01 has ever been driven by a real inbound Zendesk ticket rather than by a webhook POST. **For a day the deployed graphs were behind this repository** — UC-03's sanctions-gate fix, UC-08's jurisdiction statement, and the pre-split `Assign Routing` body on all nine. **Closed 2026-08-20**: `e4108d6` ran `scripts/deploy-routing-nodes.mjs` and reports `verify-deployed: 39 nodes, 0 drifted`, re-confirmed live by the project owner. `npm run verify-deployed` is the check, and it exits **2** rather than 0 when it cannot reach n8n — so its silence is never a pass, and a coding container without n8n credentials gets a `403` and cannot confirm this for itself

<a id="note-4"></a>**4. Exactly-once delivery (duplicate webhook deliveries)** — The guarantee is that table's **primary key**, not application code. **Mechanism verified live on all nine graphs 2026-08-18** (`npm run verify-claims`: 9 checked, 0 defective, 0 with unpublished changes) — including the wiring that makes the guarantee hold: the claim node's error output goes to a NoOp that continues to nothing, and the first durable write is reachable *only* through the claim, so a failed claim ends the run rather than writing anyway. **Row-level evidence:** every `claim-proof-*` reference, each driven twice, has exactly **one** `audit_log` row — one durable write per doubly-delivered reference is the guarantee working. `workflow_claims` currently holds rows for eight use cases because test rows were purged deliberately; that table is mutable and `audit_log` is append-only, so the surviving evidence is the audit side. A request arriving with no reference is claimed under `unreferenced:<execution id>` rather than silently dropped. `docs/BUILD-LOG.md` §3.24–§3.25

<a id="note-5"></a>**5. Identity proved against the record, never against the claim** — All four refused anyway, but only by **accident of gate ordering**, so the recorded reason was wrong. Fixed at the construction site: no usable record now yields a record object at all. `src/` was already correct; the defect lived only in the n8n ports. `docs/BUILD-LOG.md` §3.26

<a id="note-6"></a>**6. An upstream outage is not recorded as a policy decision** — A failed Remote read used to report *success* and pass an error object downstream, so gates escalated naming the wrong cause. Three states are now distinct: `upstream_record_not_found` (404 — an answer about the record), `upstream_unavailable` (403/5xx/transport — the request was never evaluated), and an unchanged policy refusal. **Fail-closed by construction** — every verdict is an escalate, consulted only at gates already refusing, asserted by test against three real policy engines. `docs/BUILD-LOG.md` §3.27

<a id="note-7"></a>**7. Ops alerting (a failure reaches a human)** — The row is the alert; the chat message is a convenience. `audit_durable` says whether a failure lost a decision or only lost a Zendesk update. `docs/BUILD-LOG.md` §3.29

<a id="note-8"></a>**8. ZAF sidebar (human approval UI)** — **Drives all nine use cases from one bundle**, and shows the **gate ladder** and the **decision facts** the gate actually compared rather than a decision string, plus the role the agent is being asked to act as. **Installed and enabled in the live Zendesk account** — app `9990001` "Remote CX Review v1.01", manifest **1.10.8**, uploaded `2026-08-20T07:40:13Z`, verified against `GET /api/v2/apps/owned.json`. An installed ZAF app is a *static upload*: it does not track this repo, so the account and the branch can silently disagree

<a id="note-9"></a>**9. Approver **role** entitlement** — The signed token proves *who*; nothing proved *what they may do*, so two support agents could clear a payroll amendment as `customer_admin` + `payroll_specialist`. The module is consulted **last**, is **additive**, and **can only ever refuse** — there is no return value meaning "approved", so no call site can be written that lets it fill a slot or lower a floor. **Now provisioned on the public deployment** — `/__cx/health` reads `approverEntitlementSource: "APPROVER_ROLES"` and `writes: "WORKING"` as of 2026-08-20. For two days before that it read `"unconfigured"` and refused every approve by its own name: a loud failure by design, and a standing reminder that *built* and *provisioned* are two claims

<a id="note-10"></a>**10. Approval queue (`npm run queue-ui` → `:4047`, `/queue` deployed)** — **Its headline is the stuck list, not the flowing one.** Pointed at production on 2026-08-19 it read 54 records, found 39 waiting on a person and **36 of them with nowhere to be approved**. **That figure has not been re-measured since**, and two of its four causes have moved: the two missing Zendesk groups now exist, and UC-03 gained a sign-off surface for the one outcome that needed one. The two that have not moved are the backlog (**fifteen tagged tickets still in the default group**, read live 2026-08-20) and one real submission whose ticket creation failed with **still no retry**. `docs/APPROVAL-QUEUE.md`

<a id="note-11"></a>**11. Execution & audit-trail viewer (`npm run audit-ui` → `:4044`, `/audit` deployed)** — Read-only in the same structural sense: no POST route exists. `docs/AUDIT-VIEWER.md`

<a id="note-12"></a>**12. Statutory knowledge corpus (`docs/knowledge/`)** — The findings are the deliverable: `CONTRADICTIONS.md` records **30 contradictions and 4 confirmations** against code this repo ships today — including that the Schengen 90/180 window is evaluated per *day of stay*, not per trip. **Three findings have since changed code**, each as its own reviewed commit with its own tests — the Schengen window (`73920c9`), a Portuguese notice bracket off by one *against the employee*, and the Dutch notice period being the employee's flat month rather than the employer's ladder (both `43ae3c7`) — and the corpus is separately cited on the 🟡/🔴 decision screens without touching a gate. The rest stay unactioned **by choice**: resolving a rule wrongly makes the system stricter than the law, and a finding is a work order with its own tests, never a number swapped inside an unrelated commit

<a id="note-13"></a>**13. **The nine APIs, deployed and public**** — Every push to the working branch deploys production. **This row said "reads return nothing and writes are refused" for days after that stopped being true, so here is the live reading**, taken from `/__cx/health` on 2026-08-19: `supabaseAttached: true`, reads **working**, writes **working**, `zafVerifierBuilt: true`, and three browser surfaces mounted alongside the nine prefixes — `/portal` (intake), `/audit` (audit trail) and `/queue` (approval queue), each behind a shared key. **One thing was genuinely still refusing when this row was written:** ~~`approverEntitlementSource: "unconfigured"`, so every approve returns `approver_entitlement_not_configured`~~ — **closed 2026-08-20**, the same read now returns `approverEntitlementSource: "APPROVER_ROLES"` and `writes: "WORKING"`. The fail-closed reasoning that used to justify this row still stands and is worth reading in `deploy/cx-apis/README.md` — a public URL must never accept a payroll approval from anyone who can set a header — it is simply now enforced one layer further in

<a id="note-14"></a>**14. Live demo (real Zendesk ticket → real n8n pipeline)** — Verified independently against the live n8n API rather than taken from a run log: execution `9302`, `status: success`, `mode: webhook`, on UC-01's graph. **It had never worked before 2026-08-27, and the reason is the useful part** — the deployment carried a Zendesk employment-id field id that has never existed on the account, so every submission wrote to a nonexistent field, the trigger's `present` condition never matched, and the ticket sat untouched. Silent in every layer: Zendesk discards an unknown field id without erroring, so the create returned 200 and nothing anywhere reported a failure.

<a id="note-15"></a>**15. Request portal (intake for the seven use cases without an entry point)** — **It raises a pre-tagged Zendesk ticket** after the gates and after the record is durable, and repoints the record's reference at the ticket so the reference the requester was shown still resolves. On a laptop the portal and each `ucNN-api` own separate in-process stores, so the sidebar reports `{"found": false}` for a decision that is correct, ticketed and audited; on the deployment — one function, one pool — that split does not exist. `docs/APPROVAL-ROUTING.md` §2, corrected by `docs/APPROVAL-QUEUE.md` §0

<a id="note-16"></a>**16. UC-06 (Contract Amendment / Payroll Cutoff)** — **Decision pass 2026-08-21** (`qa/contracts/UC-06-acceptance.md`): seven findings dispositioned, four opened, a 32-item queue `A-1`…`A-32` — **decided, not yet built.** Three things a reader should know: the **requester can currently sign the employer-side approval slot** (DRIFT-098 — being reframed as the employer's signature); the **`automatable` pre-check has no call site**, so every amendment consumes two approvals including ones Remote would apply instantly (DRIFT-027); and the **approvable path is demonstrable on NL and CA only**, through the stand-in's projected payroll calendar — PT publishes a form no PT record satisfies and the US Sandbox answers 500 (DRIFT-101, DRIFT-030).

<a id="note-17"></a>**17. UC-08 (Cross-Border Tax & Social Security)** — ZAF panel. n8n workflow built, parity-tested, **active**, and **proven by real unpinned executions** that wrote genuine `uc08_dossiers` and `audit_log` rows (most recent 2026-08-17). **Decided 2026-08-21, not yet built** (`qa/contracts/UC-08-acceptance.md` §0/§18): its treaty retrieval is **keyword, not embedding similarity** — the class is built and wired to nothing, and the pgvector table has held zero rows since it was provisioned; its presence-day count is taken over records a **requester typed**, while Remote publishes the same facts dated, located and employer-approved (`GET /v1/travel-letter-requests`, `GET /v1/work-authorization-requests`) and neither is read; and the **employee who asks gets nothing back** once a specialist finishes, because no ticket is raised on the portal path.

<a id="note-18"></a>**18. UC-02 (Expense & Receipt Validation, 🟢)** — ZAF panel built. n8n Code node body, parity test, and a live workflow graph — **active** since 2026-08-10, and **proven by real unpinned executions** that wrote genuine `audit_log` rows (most recent 2026-08-17)

<a id="note-19"></a>**19. UC-03 (Travel Support Letter / Workation router, 🟢)** — ZAF panel built. n8n Code node body, parity test, and a live workflow graph — **active**, and **proven by a real unpinned execution** that wrote genuine Remote-read + Supabase rows. **Its supported-destination gate could never pass until 2026-08-17**: it compared 2-letter destinations against a list built from the alpha-3 `code` field, so a successful 224-row fetch yielded an empty list and no request could ever auto-resolve. Fixed and proven both ways — Spain now auto-resolves (the first `auto_resolve` this use case has ever recorded), an unsupported destination still escalates. Nothing detected it for weeks because a use case that structurally cannot succeed is indistinguishable from one being appropriately cautious: `docs/BUILD-LOG.md` §3.28. **A second gate of the same shape was found on 2026-08-19**: none of the ten codes in `SANCTIONED_OR_RESTRICTED` appeared in the dictionary that turns a country *name* into a code, so "I'm travelling to Iran" came back `escalate / destination_unknown` — the right decision under a reason that sends a specialist to look the country up rather than stop. Fixed in the repo, with the dictionary now *derived* from the set so an unnamed code throws at module load; **republished on 2026-08-20** (`verify-deployed: 39 nodes, 0 drifted`). **UC-03 also gained the one signature it was missing** (`c295ef1`) — a sign-off for `formal_letter_requested` and deliberately no button for the four outcomes nobody signs — and an answered travel question can now become the letter without being asked twice (`cc551b4`)

<a id="note-20"></a>**20. UC-04 (Work Authorization / Workation, 🟡)** — ZAF panel built. n8n Code node body, parity test, and a live workflow graph — **active**, and **proven by a real unpinned execution** that wrote genuine Remote-read + Supabase rows (it is marked `error` in n8n only because the final Zendesk step rejected a non-numeric ticket ref — downstream of the audit write, by design)

<a id="note-21"></a>**21. UC-05 (Resignation Notice Calculation, 🟡)** — ⚠️ **Corrected 2026-08-21: this row used to say "9-country" and "no confirmed write endpoint exists".** The table has eleven rows, and Remote's `PUT /v1/resignations/{offboarding_request_id}/validate` **does** exist and is shaped like this use case's own sign-off form — not writing is a **deliberate choice**, not an API limitation (`qa/contracts/UC-05-acceptance.md` DRIFT-063). ZAF panel built. n8n Code node body, parity test, and a live workflow graph — **active**, and **proven by a real unpinned execution** that wrote genuine Remote-read + Supabase rows (it is marked `error` in n8n only because the final Zendesk step rejected a non-numeric ticket ref — downstream of the audit write, by design)

<a id="note-22"></a>**22. UC-07 (Global Mobility / Permanent Relocation, 🔴)** — **Decision pass 2026-08-21 (`qa/contracts/UC-07-acceptance.md`): eight findings dispositioned, four opened, a 27-item queue written — all `DECIDED · NOT YET BUILT`.** Three things are honestly missing: it makes **no Remote API call at all** (so every gate input is self-declared, and the specified conflict check against in-flight amendments/offboardings has never existed), the **drafted paperwork** one of its two deliverables promises does not exist, and a **portal-submitted dossier reaches nobody** — no ticket, no queue entry, and no status column, so it can never leave the waiting list. Retrieval is **keyword matching**, not the embedding similarity earlier rows here claimed. ZAF panel built. n8n Code node body, parity test, and a live workflow graph — **active** since 2026-08-10, and **proven by a real unpinned execution**: delivered twice through its production webhook under one reference, it wrote exactly one `workflow_claims` row, one `uc07_dossiers` row and one `audit_log` row, the redelivery stopping at the duplicate branch

<a id="note-23"></a>**23. UC-09 (Off-Cycle Payroll / Adjustment, 🔴-framed, has execution)** — ZAF panel built. n8n Code node body, parity test, and a live workflow graph — **active** since 2026-08-10, and **proven by real unpinned executions** that wrote genuine `audit_log` rows (most recent 2026-08-17)


**What remains** is tracked in a working checklist that separates what only a
human can do (record the demo) from what is still owed in code.

**Where the honest line sits.** Nothing above is claimed as production-deployed at
scale, and no part of this has ever served a real customer. What is real is that
all nine workflows are active on a live n8n instance, all nine have written real
rows to a real Postgres database from real executions, one of the nine (UC-01)
has been driven the whole way by a genuine inbound Zendesk ticket, the nine APIs
plus three read-only surfaces are deployed behind a public URL with a real
database attached, and the ZAF app is installed and enabled in a real Zendesk
account. It runs end-to-end against Remote Sandbox, a real Zendesk account, and
a local mock harness.

**Three qualifications belong in the same breath, because "built" and "running"
are different claims and this repository's whole argument is that its status
tables can be trusted.**

*One:* **UC-01 has not passed its own acceptance bar.** Fifteen blinded
four-observer rounds have been run against the deployed system and the most
recent verdict is `NEGATIVE`, on merit and not on a technicality — a clean
observer opened 33 records, found eight asserting a letter was issued, and none
carrying a document id or content hash. `docs/QA-EVIDENCE.md` has the detail,
including the round that voided 37 of its own findings when two observers
leaked.

*Two:* **the evaluation covers the model, not the fallback.** The frozen 48-case
suite scores 48/48 on the LLM path, and every one of those rows is
`source: "llm"`. The deterministic fallback — which runs whenever the model is
unconfigured or returns an invalid shape — scores **36/48**, and its over-scope
detector scores 3/7. Both numbers are published in `evals/README.md` rather than
left unmeasured.

*Three:* the system's most useful output is still a list of things it gets
**wrong** — 31 of 124 items awaiting a human have nowhere to be approved, and 27
of the 30 places where a real statute disagrees with this code are unactioned by
choice. All of it is written down, with the count, in `CLAUDE.md` §7's
honest-gaps list.

---

## Quick start

```bash
npm install
npm test          # 4,309 passing, 3 skipped, hermetic — no network, no API keys
npm run demo      # watch UC-01 decide three real tickets, narrated
npm run scenarios # every scenario in the UC-01 test plan, one block each
npm run metrics   # impact dashboard → demo/metrics.html
npm run review-api # the ZAF sidebar's backend, seeded with real cases → :4020
npm run playground # interactive: act as the client, then the specialist → :4030
npm run chatdemo  # UC-01 as a chat: each message runs through the real handler → :4046
npm run mock      # mock Remote API on :4010
npm run zendesk-mock # mock Zendesk on :4014
npm run live      # ONE real pass: Remote Sandbox + OpenAI + Supabase + Zendesk
npm run livedemo  # ALWAYS real: creates an actual Zendesk ticket the live n8n workflow processes → :4040
npm run uc06-api  # UC-06's dual-approval API, seeded with real amendments → :4021
npm run uc08-api  # UC-08's read-only dossier API (no write route exists) → :4023
npm run remoteui  # UC-06's amendment-request entry point — the "Remote product" stand-in → :4041
npm run portal    # intake for the other seven use cases — one page, seven forms → :4042
npm run dashboard # all nine use cases on one page → :4060 (a viewer only; start the APIs below first)
npm run uc02-api  # UC-02's expense-validation API → :4050
npm run uc03-api  # UC-03's travel/workation router API (has sign-off writes) → :4051
npm run uc04-api  # UC-04's work-authorization API → :4052
npm run uc05-api  # UC-05's resignation notice-period API → :4053
npm run uc07-api  # UC-07's read-only global-mobility dossier API (no write route exists) → :4054
npm run uc09-api  # UC-09's off-cycle payroll multi-approval API → :4055

npm run audit-ui  # execution & audit-trail viewer → :4044
npm run queue-ui  # the approval queue: everything waiting on a human, and everything nobody can reach → :4047

npm run walkthrough       # drive the real HTTP surfaces end to end (catches what hermetic tests can't)
npm run verify-deployed   # diff every deployed n8n Code node against its .js file
npm run verify-claims     # check the idempotency claim node's wiring on all nine graphs
npm run verify-traces     # check the audit-trace branch's wiring AND canvas position
npm run verify-live-uc01  # re-check UC-01's live chain, read-only — writes nothing
```

**One behaviour worth knowing before you run `npm run metrics`.** With no
`SUPABASE_DB_URL` set it seeds ~120 cases through the real gates and writes the
dashboard — that is the fresh-clone path, and it needs no credentials. With
`SUPABASE_DB_URL` set but unreachable it **exits non-zero instead of falling
back**, on purpose: a dashboard that quietly substitutes synthetic numbers for
live ones is worse than one that refuses, because a wrong number gets acted on
while a missing one gets investigated.

The `verify-*` commands need live access to the thing they check and **exit 2
rather than 0 when they cannot reach it**, so a skipped check never looks like a
passing one. They exist because the deployed graph — and the live Sandbox record
— is the thing serving customers, and a test that compares two local files
cannot tell you what is actually running.

Node.js 20+. The test suite never touches the network: the classifier is
dependency-injected so tests cannot reach a live LLM even if a real `.env`
exists (see `docs/BUILD-LOG.md` §4 — this was a bug once, and the fix was
structural rather than procedural).

To run against real services, copy `.env.example` to `.env` and fill it in,
then `npm run live` — one real pass against Remote Sandbox, OpenAI, Supabase
and Zendesk, reading every written row back.

---

## Where to start reading

If you want the guided version of all of this, start with
[`docs/START-HERE.md`](docs/START-HERE.md) instead — it explains the domain
before the code. Otherwise, in order:

1. **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — how the pieces fit: a
   request's full journey, where the AI/code seam sits, and why the same logic
   deliberately exists twice. Two diagrams.
2. **`src/uc01/workflow.js`** — the entire flow in one screen.
3. **`src/uc01/policyEngine.js`** — the deterministic gates. This is the
   system's judgment, and it contains no AI.
4. **`docs/BUILD-LOG.md` §4** — the decision log: why things are built the way
   they are, including bugs found only by running against live services.
5. **`test/uc01.test.js`** — the fastest way to understand actual behaviour.
6. **[`docs/GLOSSARY.md`](docs/GLOSSARY.md)** — when a term is unfamiliar.
   EOR, ZAF, HITL, dossier, payroll cutoff, presence days, parity test.

## Layout

```
src/shared/      foundation: money (×100), identity, risk, schema, disclaimer, audit, case store
src/shared/ui/   the design system every browser surface shares (one stylesheet)
src/portal/      request portal: one intake page, seven forms, real workflows in-process
src/dashboard/   the viewer that shows all nine use cases side by side
src/remote/      Remote API client + a local mock server
src/zendesk/     Zendesk client + ticket normalizer + mock server
src/uc01/        UC-01: classifier (LLM), policy engine, letter, workflow
src/review/      the HITL gate: approval policy, service, and the sidebar's API
src/playground/  interactive UC-01 (offline): act as the client, then the specialist
src/chatdemo/    UC-01 as a chat (offline): every message runs through the real handler
src/livedemo/    real Zendesk ticket -> real n8n pipeline, the actual client front door
src/uc02/        UC-02 core: expense/receipt deterministic gates + classifier seam + API
src/uc03/        UC-03 core: thin travel/workation router + API (has sign-off writes)
src/uc04/        UC-04 core: workation risk matrix + single-specialist approval + API
src/uc05/        UC-05 core: statutory notice-period calculator + HR Ops sign-off + API
src/uc06/        UC-06 core: cutoff engine, policy engine, dual-approval workflow + store + API
src/uc07/        UC-07 core: feasibility gates, dossier store + read-only API -- no execution path
src/uc08/        UC-08 core: presence-day calc, treaty retrieval, dossier store + read-only API -- no execution path
src/uc09/        UC-09 core: multi-role (floor-of-2) approval, off-cycle payroll adjustment + API
src/auditview/   the read-only execution & audit-trail viewer (no POST route exists)
src/approvalqueue/ the read-only approval queue: what is waiting, and what nobody can reach
src/metrics/     impact measurement + the dashboard renderer
zaf-app/         the Zendesk (ZAF v2) sidebar — shared shell + per-UC panels for all nine use cases
workflows/       all nine n8n workflows (live and active) + every Code node body as a real .js file, each pinned to its policy engine by a parity test
docs/            foundation, coherency map, build log, metrics, the 9 UC specs
docs/research/   the raw source research the specs were distilled from
docs/knowledge/  the vendored source material: 35 of 39 statutory documents, each with provenance + SHA-256, and the 34 findings against this repo's own code
test/            the suite, incl. n8n<->policyEngine parity for all nine use cases
evals/           frozen 48-case regression suite, deterministic graders, Phoenix traces
```

---

## Design decisions worth defending

- **Identity comes from an authenticated signal, never a claimed email.** In the
  Node path that is the Remote session; in the n8n path, where no such session
  exists, it is Zendesk's authenticated requester matched against the email on
  the Remote record. Both fail closed. A logged-in user asking about someone
  else is refused; a third party needs recorded consent. This is a security
  gate, so it is plain code — never AI.
- **When the sandbox cannot answer, say which rung you dropped to.** Three use
  cases read a read-only proxy in front of Remote's Sandbox rather than the
  Sandbox itself, because the Sandbox returns `null` for two fields they gate
  on and its payroll calendar stops in the past — so UC-04 would refuse *every*
  request and UC-06 could only ever be demonstrated refusing. A system that
  refuses everything and a system that is appropriately cautious are
  indistinguishable from outside, which is the real cost. The proxy forwards
  your own `Authorization` untouched, refuses writes with 405, fills only
  fields the Sandbox left empty, names every one it touched in a response
  header and body block, and **never fabricates money** — a cadence can be
  continued, an amount cannot be invented. Full reasoning, and the ladder it
  comes from: [`docs/SANDBOX-STANDIN.md`](docs/SANDBOX-STANDIN.md).
- **The n8n workflow is parity-tested against the Node one.** The gates exist
  twice, so `test/n8nParity.test.js` executes the real n8n Code node body and
  asserts it decides identically. Duplication acknowledged and pinned, not
  hoped about.
- **Duplicate delivery is normal traffic, and exactly-once is a database
  constraint.** Webhooks deliver at least once — a retry, a double-fired
  trigger, a double-clicked form. Every path claims `(use_case, external_ref)`
  in one shared ledger before it writes anything durable, and the guard is that
  table's primary key rather than a check-then-insert in code, because a
  read-then-write has a race that a unique key does not. A redelivery stops
  silently: paging a human every time Zendesk behaves normally would train
  everyone to ignore the alert.
- **A refusal has to name the right reason, not just be a refusal.** "It failed
  closed" and "the control works" are different claims. Four identity gates
  refused correctly while proving nothing, and a swallowed 404 was recorded as
  the customer failing identity verification. Both were safe and both were
  false, and an audit log full of confidently wrong reasons sends people to fix
  the wrong thing. The recorded *reason*, not the decision, is the field that
  gets audited here.
- **Every decision path needs a positive test, because failing closed conceals
  a broken one.** UC-03's supported-country gate could not have approved a
  single real request, and every fail-closed assertion in the suite passed
  anyway — a use case that structurally cannot succeed looks exactly like one
  being appropriately cautious. Only a test asserting "this known-good input
  MUST resolve" tells them apart. This is the most transferable finding in the
  project (`docs/CORRECTIONS-LOG.md` P6).
- **A control that can only refuse cannot be misused into approving.**
  Role entitlement returns a refusal or `null` — there is no return value that
  means "approved", so no call site can be written, now or later, in which it
  fills an approval slot or lowers the floor of two. That is a structural
  property rather than a convention, the same argument the 🔴 tier makes by
  taking no write-capable client as a parameter. It is also consulted *last*, so
  it can never mask the refusal a policy already had.
- **Documents were gathered, and then acted on one at a time or not at all.** 35
  statutory and agency sources are vendored with provenance and checksums, and
  they disagree with this code in **30 places**. Three of those disagreements
  have since changed code — the Schengen window, a Portuguese notice bracket off
  by one *against the employee*, and the Dutch notice period being the
  employee's flat month rather than the employer's ladder — each in its own
  reviewed commit with its own tests. **The other twenty-seven have not**, and
  that is the decision rather than a backlog: resolving a legal rule *wrongly*
  makes validation stricter than the law and starts refusing valid requests, a
  new failure wearing the clothes of a fix. The same reasoning already sits in
  `src/shared/schemaValidator.js`, which declines to guess at 81 conditional
  rules it cannot model rather than model them badly.
- **A vector database was measured and rejected, not skipped.** The obvious move
  for a statutory corpus is embeddings. `docs/RETRIEVAL.md` chunked the real
  documents the way a retriever would and counted **106 passages** — at which
  size the case for embedding similarity is weak, the case for a filtered
  lexical index over the real text is strong, and the honest report includes the
  probe results that argue *against* that recommendation. Two pgvector tables
  were provisioned a fortnight ago and hold zero rows to this day, so the
  retrieval that ships is the keyword leg; the document says so rather than the
  status table implying otherwise.
- **Money is an integer scaled ×100 everywhere.** Isolated in one module and
  tested hard, because getting it wrong overpays someone by 100×.
- **The letter template has a hard field whitelist**, so compensation cannot
  leak regardless of what a request asks for or what the classifier misses.
- **REST is the backbone; MCP is deliberately narrow.** Remote's MCP server
  exposes writes as well as reads, but it authenticates as a *user* via OAuth2
  PKCE browser sign-in — which is the wrong shape for an unattended backend
  service. MCP is for AI-assisted lookups; deterministic paths use REST.
- **`cases` and `audit_log` are never conflated.** One is mutable current
  state, the other is append-only history.
- **The sidebar can read an escalation but never close one.** Approve/deny is
  offered only for cases routed to `human_review`; a 🔴 high-tier case has no
  approve path at all, asserted by test. The safe path must not double as a
  dismiss button, and the UI holds no copy of that rule — it renders what
  `src/review/reviewPolicy.js` says it may.
- **An approval re-reads the employment record before acting.** The policy
  engine checked "is this employee active?" when the ticket arrived; approval
  can happen days later. Re-reading asks a different question — *is it still
  true?* — rather than duplicating the gate.

---

This system was built with heavy AI assistance (Claude Code), and that is
stated rather than buried: the subject matter is AI-assisted workflows, so how
the work itself was driven is part of the evidence rather than a disclaimer
about it. `CLAUDE.md` is the engineering journal that records it — including
the defects the approach produced and what each one cost to find.

---

## Licence

MIT — see [`LICENSE`](LICENSE).

One exception, and it is deliberate: `docs/knowledge/` mirrors statutory and
agency documents from EU, US, Canadian and Dutch authorities, and
`docs/REMOTE-API-INDEX.txt` is Remote's own published index. Those are their
publishers' content, not this project's, and each carries a provenance header
naming its source, retrieval date and SHA-256. The terms are in
[`NOTICE.md`](NOTICE.md).
