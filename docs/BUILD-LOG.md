# UC-01 Build Log — living documentation

> **What this file is:** the up-to-date, honest record of what's actually built, how it works, why it was built that way, and what's left — for UC-01 specifically, and for the shared foundation other use cases will reuse. Read this alongside:
> - `docs/use-cases/UC-01.md` — the target spec (what SHOULD exist)
> - `docs/research/UC-01 BUILD CASE ChatGpt — EMPLOYMENT VERIFICATION REQUEST AUTOMATION & RESOLUTION.md` — the original, fuller build case (27 sections; this is the canonical ambition, not everything in it is in scope yet). `docs/HOW-THIS-WORKS.md`, the earlier mock-only-era guided tour that used to be listed here, was removed — its content is superseded by `docs/SYSTEM-OVERVIEW.md` (plain-language explainer) and this file (status); it also carried some "for your interview" framing that had no place staying in a reviewed repo, the same reasoning `APPLICATION-ANSWERS.md` was deleted for earlier.
>
> **Maintenance rule:** every time a component is added or changed, update this file in the same change. If this file says something is "not built" and it becomes built, fix that line — don't leave stale status here.

---

## 1. System snapshot

| Component | Status | File(s) | Notes |
|---|---|---|---|
| Classifier (intent, artifact/URL flags, requester type, requested fields, out-of-scope) | **Real** | `src/uc01/classifier.js`, `src/shared/llm.js` | Real OpenAI call, JSON-validated, falls back to rule-based on any failure. Detects `standard_letter`/`non_standard`/`out_of_scope` intent, extracts `requestedFields` for disclosure-scope enforcement, and tags `source: "llm"`/`"rule_based_fallback"` (issue #25, `00-FOUNDATION.md` §4 invariant 8). The LLM call retries up to 3x with backoff before falling back (issue #32, `src/shared/retry.js`, invariant 10) |
| Entity extraction (employee name, purpose, requested fields) | Partial | `src/uc01/classifier.js` | `requestedFields` is extracted; full entity extraction (who, purpose) not yet built |
| Artifact/URL *analysis* (read the form, read the page) | Not built | — | Only presence is detected (`hasAttachment`, `hasExternalUrl`); nothing is fetched or read |
| Case summarization / CX recommendation text | Not built | — | No AI-authored specialist note yet |
| Remote API reads (employment, legal entity) | **Real**, verified live against Sandbox | `src/remote/restClient.js` | `normalizeEmployment()` bridges the real API's nested shape vs the mock's flat one — see §3 |
| Remote API retry/backoff | **Real** | `src/shared/retry.js`, `src/remote/restClient.js`, `src/zendesk/restClient.js` | `withRetry()` is wired into the three LLM call sites (issue #32 — the UC-01 classifier, UC-06's `draftSummary()`, UC-08's `draftNarrative()`) **and into both REST clients**, which retry transient failures with backoff before the caller's error propagates. A 404 or any other definite answer is returned, not retried — retrying a question the server already answered just multiplies load. `retries`/`backoff` are constructor seams so `test/restClientRetry.test.js` can inject a no-op backoff and stay instant |
| Policy engine (deterministic gates) | **Real** | `src/uc01/policyEngine.js` | Routes `out_of_scope` to a polite refusal and over-scope `requestedFields` to `human_review`; otherwise unchanged — pure functions, no I/O |
| Letter generation | **Real**, HTML only | `src/uc01/letter.js` | Remote.com-styled HTML template with letterhead, signature block, job title, and purpose line; PDF rendering not yet built |
| Custom-letter draft workflow (§15 of the build case) | Not built | — | Non-standard requests just route to `human_review`; no AI-drafted custom letter |
| Zendesk outbound actions (reply+resolve, internal note+tags, **create**) | **Real**, verified against both the local mock AND the live account — read AND write, via `npm run live`'s Zendesk step | `src/zendesk/restClient.js`, wired into `workflow.js` STEP 8 and `liveVerify.js` step 4 | Auth: OAuth `client_credentials`, live-verified (see decision log for the Public→Confidential and scope gotchas found). Token mode kept as fallback. Optional dep — no-ops unless a `zendesk` client AND `ticket.source === "zendesk"` are both present. `createTicket()`/`getTicketComments()` added this session, used only by `src/livedemo/` — the automation itself never creates tickets, only reacts to them |
| Zendesk ticket → internal shape | **Real**, pure function, tested | `src/zendesk/normalizeTicket.js` | Two documented gaps: `employmentId` needs a custom field populated upstream; `session` is always `null` (Zendesk carries no Remote session) — see file header |
| Zendesk inbound webhook receiver (real, live-triggered) | **Not built** | — | Needs a publicly reachable URL (tunnel or deployment) once real credentials exist — see roadmap |
| Zendesk sidebar (ZAF app UI) | **Real**, built + tested, not yet installed in a live account | `zaf-app/`, `src/review/*`, one `src/ucNN/{server,cli}.js` per use case | ZAF v2 ticket sidebar: shared shell + per-use-case panel registry, now driving **all nine** use cases from one bundle. `main.js` tries each configured API base URL in turn (`apiBaseUrl` for UC-01, then one optional `ucNNApiBaseUrl` per other use case) and normalizes whatever shape that use case's API returns into one common view via a per-source loader. The action surface varies by tier, all of it server-decided: UC-01 keeps its original single approve/deny pair **and now requires a reason before either action is accepted**; UC-04 and UC-05 use a shared single-approver block (`renderSingleApproverActions` — UC-05's button is a *sign-off*, not an approval, because no Remote write exists behind it); UC-06 supplies its own `renderActions` for two independently-gated role slots; UC-09 renders the floor-of-2 (3 for high-risk) multi-role blocks; UC-02/03/07/08 supply NO controls at all, each for its own documented reason (auto-approves inside the workflow / router with no write route / 🔴 no execution path). **Every recorded decision writes an `audit_log` row** carrying the reason, which is what makes the HITL accept rate in `docs/METRICS.md` a measurement rather than a definition. Approver identity is currently a trusted header — see the security note in `src/review/server.js` and the roadmap |
| Review API (the sidebar's backend) | **Real** | `src/review/{reviewPolicy,store,service,server,cli}.js` | `npm run review-api`. Holds every credential the sidebar must not. Serves live Supabase rows when configured, otherwise seeds four real cases through the actual workflow so the UI is demonstrable with zero credentials |
| **Interactive playground** (act as client + specialist, one page) | **Real** | `src/playground/{server,cli}.js`, `src/playground/assets/*` | `npm run playground` → `http://localhost:4030`. A hands-on way to exercise every §12 scenario without curl or Postman: submit a ticket as the client (free text + identity/attachment/consent toggles, or one-click §12.1–§12.7 examples), watch the real workflow decide, then switch hats and approve/deny as the specialist. The specialist dashboard now shows the original ticket text, requester identity, classification source, attachment/URL flags, and auto-advances to the next awaiting case after approve/deny. **Approve/Deny now require a specialist name and a reason; the reason is shown in the audit log.** UI restyled as a clean Remote.com-inspired specialist dashboard. Reuses `handleVerificationTicket`, `reviewPolicy.js` and `service.js` directly — no gate logic is duplicated. In-memory only; never touches Supabase or a real Zendesk ticket |
| **Live demo** (real Zendesk ticket, real n8n pipeline) | **Real**, **not yet confirmed working end-to-end** | `src/livedemo/{server,cli,employees}.js`, `src/livedemo/assets/*` | `npm run livedemo` → `http://localhost:4040`. Creates an actual Zendesk ticket (tag `uc01_test` + Remote Employment ID field) as the client, then polls that same real ticket to show what the live n8n workflow did — no decision logic of its own. See §3.8 |
| **Chat demo** (conversational wrapper over UC-01) | **Real** | `src/chatdemo/{server,cli}.js`, `src/chatdemo/assets/*` | `npm run chatdemo` → `http://localhost:4046`. Every message typed is sent as a ticket into the real `handleVerificationTicket()` and the actual result rendered back as the reply — a demo/testing aid, not a submission deliverable, in-memory only, never touching Supabase or a real Zendesk ticket. Now lets the user pick from all mock employees or type a custom employment ID, and politely refuses out-of-scope requests. See §3.14 |
| n8n orchestration | **Real**, **19 nodes as deployed** (started at 14; the idempotency claim pair and two audit-trace nodes were added since — read back from the live graph 2026-08-18), **ACTIVE and published** (`activeVersionId == versionId`) | `workflows/` (builder + `nodes/*.js`), n8n workflow `WORKFLOW_UC01_ID` | Built via the n8n Workflow SDK; activated with all four credentials attached (OpenAI, Remote Sandbox, Zendesk, Supabase). Verified against pinned data for all 7 §12 scenarios AND against live non-pinned executions confirming real OpenAI + real Remote Sandbox + real Zendesk auth. A real `audit_log` write from n8n was first proven 2026-08-01 (execution `22`) — **earlier claims that execution `10` ran "through to audit" were wrong; that node was pinned.** **Both formerly-open gaps are now closed:** the Zendesk trigger fires (ticket **#6**, 2026-08-15 — customer comment → execution `3645` `success` → letter posted, ticket solved, real `audit_log` row, nothing pinned), and the audit-ordering fix (§3.13) **is the active version**, re-read from the live graph 2026-08-17: `Identity + Policy Gates → Claim Ticket (Idempotency) → Carry Context After Claim → Append Audit Log → Carry Context Forward → Route by Decision`, so the decision is durable before any Zendesk node runs |
| **Exactly-once delivery (idempotency ledger)** | **Real**, both execution paths; **mechanism verified live on all nine graphs** 2026-08-18 (`verify-claims`: 9 checked, 0 defective, 0 unpublished) | `src/shared/workflowClaims.js`, the `Claim Ticket (Idempotency)` node in all nine n8n graphs, `workflow_claims` (Supabase) | A webhook is at-least-once: Zendesk ticket #5 arrived three times and produced two `audit_log` rows 30µs apart plus a duplicate letter to the customer. Every path now claims `(use_case, external_ref)` before its first durable write; **the guarantee is the table's PRIMARY KEY**, not application code, because a check-then-insert has the same race that caused the bug. A redelivery stops silently at a NoOp — redelivery is normal traffic, not an incident. One ledger for the Node app and n8n both (two would each read the other's refs as unclaimed). **Verified live 2026-08-18.** `verify-claims` reports **9 checked, 0 defective, 0 with unpublished changes**, and it checks the wiring the guarantee actually rests on: the claim node's `main[1]` error output reaches a `Duplicate Delivery — Stop` NoOp, that NoOp continues to *nothing*, and the first durable write is reachable **only** through the claim. Those assertions together mean a failed claim insert ends the run — so an `audit_log` row for a reference is itself proof that that reference's claim insert succeeded. Row-level: all ten `claim-proof-*` references, each driven twice, have exactly **one** `audit_log` row apiece. One durable write per doubly-delivered reference is the guarantee working.

**A correction about a correction, kept because the reasoning error is the useful part.** An earlier revision of this file inferred from `workflow_claims` holding no UC-04 rows that UC-04's claim node "was not claiming" and had no guarantee in force. That inference was wrong. `workflow_claims` is **mutable** and its test rows were purged deliberately; `audit_log` is append-only and survived. Absence in a deletable table means "no row now", never "no row ever". The disconfirming evidence was already in hand and misread: `claim-proof-uc07-a` has no claim row either, and UC-07 is the case that *is* demonstrated in both halves — which should have identified a purge rather than a defect. This project's standing rule "a green run is not evidence — check the destination" has a mirror image that now belongs beside it: **an empty destination is not evidence either, when the table is mutable.** A request arriving with **no** external ref is claimed under `unreferenced:<execution id>` rather than dropped — see §3.25 for the green-run-that-wrote-nothing that fixed. See §3.24 |
| **Identity gates prove identity against a record, not against the claim** (UC-03/05/06/09) | **Real**, fixed 2026-08-17, proven in production | `workflows/nodes-uc03/travelRouterGates.js`, `nodes-uc05/noticePeriodGates.js`, `nodes-uc06/amendmentGates.js`, `nodes-uc09/adjustmentGates.js` | Four gates could report `verified: true` having proved nothing — two echoed the caller's own `request.employmentId` back as the "authoritative" record id, two compared `session.companyId` against a `company_id` defaulted to `null` (`null === null`). All four failed closed only by **accident of gate ordering**, so the recorded reason was wrong while the decision was right. Fixed at the construction site: no usable record now yields `employment = null`, which is what `RemoteClient.getEmployment()` returns on a 404. `src/` was already correct in all four cases; the defect lived only in the n8n ports. Proven on UC-05 with identical input either side of the fix — audit row `a324f666` (`employee_not_active`) → `283dbd1f` (`identity_not_verified`), plus `946764ef` still reaching `all_gates_passed`. See §3.26 |
| **Upstream-failure attribution** (an outage is not a policy refusal) | **Real**, live on UC-02/UC-06/UC-09 | `src/shared/upstreamFailure.js`, ported verbatim into those graphs' gates | `onError: continueRegularOutput` does **not** mark a node red: it reports `success` and emits `{json:{error:{…,status}}}` in place of the data, so gates escalated naming the wrong cause. Three states are now distinct — `upstream_record_not_found` (404, an authoritative answer *about the record*), `upstream_unavailable` (403/5xx/transport, the request was never evaluated), and an unchanged policy refusal. **Fail-closed by construction**: every verdict is an `escalate`, consulted only at gates already refusing, asserted by test against three real policy engines. Proven live: UC-09 row `105cd7c4` = `upstream_record_not_found` with 1 failure vs `590772ee` = `identity_not_verified` with **0**; UC-02 `f45e06c3` keeps `expense_not_found` and carries 2 failures as provenance. See §3.27 |
| **Ops alerting** (a failure now reaches a human) | **Real**, active on all nine | n8n `RCX OPS · Error Alerts (all use cases)` (`WORKFLOW_OPS_IDX`), `ops_alerts` (Supabase) | Attached as the `errorWorkflow` for all nine graphs. Writes a durable `ops_alerts` row (use case, risk tier, failed node, execution URL, `audit_durable`) **and then** pushes a notification, with the push set to continue on error — the row is the alert, the push is a convenience. `audit_durable` is the triage order in one boolean: true means the decision survived and this can wait; false means a decision was made and never recorded. Closes `docs/PRODUCTION-READINESS.md` finding A2. See §3.29 |
| `audit_log` (immutable event trail) | **Real** | `src/shared/audit.js` | Supabase Postgres, RLS enabled, zero policies (backend-only). Plus a two-level trace (issue #26, invariant 7): `AuditLogger.logTraceStep()` records every LLM/API *attempt*, not just the final decision, to a new `audit_trace` table (same RLS pattern, human-provisioned) |
| `cases` / `review_queue` / `documents` (mutable operational state) | **Real**, verified live for all 3 decision paths | `src/shared/caseStore.js` | Same RLS pattern as `audit_log` |
| `consent_records` / `request_artifacts` / `extracted_requirements` | **Real** (store methods + tables) | `src/shared/caseStore.js` | Written for the build case's §18 data model. `createExtractedRequirement()` has no caller yet — it waits on the file/URL extraction pipeline |
| File pipeline (virus scan, OCR, form-field extraction) | Not built | — | `hasAttachment` is a boolean flag only |
| URL pipeline (fetch, validate, extract form requirements) | Not built | — | `hasExternalUrl` is a regex flag only |
| Config / secrets | **Real** | `src/shared/config.js`, `.env.example` | dotenv-based, `.env` gitignored |
| `npm test` | **Real**, hermetic | `test/*.test.js` | **3,069 tests, 3,068 pass, 0 fail, 1 skipped — re-run 2026-08-20** on the tree at `cc551b4` *plus* uncommitted in-flight work from concurrent agents (**3,021 on the quiet tree at `cc551b4`**), 16.4s, mock-only, no network calls ever. (This cell read "1,400+ … 1488" for a day after the count had almost doubled, and the count moved again — 2,698 → 2,737 — in the forty minutes it took to write that correction. `npm test` is the authority, not this row; quote it with a commit or not at all.) The fast baseline is itself a hermeticity check — a sudden jump in total duration after a merge means something is reaching the network (see §4) |
| `npm run demo` | **Real**, hermetic | `src/uc01/demo.js` | Narrated mock walkthrough |
| `npm run scenarios` | **Real**, hermetic | `src/uc01/scenarios.js` | Every §12 test-plan case, one labeled block each, writes `demo/letter.html` |
| Metrics / impact dashboard | **Real** | `src/metrics/*`, `docs/METRICS.md` | Tier-aware verdicts (healthy/iterate/**stop**/integrity_violation). Reads live Supabase rows when configured; otherwise seeds ~120 cases through the REAL workflow, so the numbers move when a policy gate changes. `recommend()` now reads a 🟡/🔴 use case with zero decided reviews as `insufficient_data`, not a false `healthy` (issue #28); `findRedundantCalls()` flags a trace group that isn't a clean `1..n` retry sequence as a genuine duplicate call (issue #33) |
| `npm run live` | **Real** | `src/liveVerify.js` | One real run against OpenAI + Remote Sandbox + Supabase, reads every written row back |
| **UC-06 core** (cutoff engine, policy engine, dual approval) | **Real**, real Supabase persistence + ZAF panel + n8n (built, **ACTIVE**) | `src/uc06/*.js`, `workflows/nodes-uc06/*.js` | Deterministic gates + a two-slot (customer admin + payroll specialist) approval flow, a dedicated HTTP API (`npm run uc06-api`), the real `uc06_amendments` Supabase table, a ZAF sidebar panel with its own dual-role `renderActions`, and an n8n workflow (`WORKFLOW_UC06_ID`) dry-run verified and parity-tested against `src/uc06/policyEngine.js`, **active since 2026-08-10** (verified `active: true` and published live again 2026-08-18). **Real unpinned executions have since landed genuine rows** — `uc06_amendments` and `audit_log` both carry rows from live webhook drives, most recently 2026-08-17. See `docs/use-cases/UC-06.md` §15. **Also now has a Remote-native entry-point stand-in** (`src/remoteui/`, `npm run remoteui`) — see the row below and §3.18 |
| **UC-06 Remote UI stand-in** (the amendment request's true starting point) | **Real**, hermetic, demo-only | `src/remoteui/{server,cli,employees,roles}.js`, `src/remoteui/assets/*` | `npm run remoteui` → `http://localhost:4041`. Stands in for the one thing UC-06's real trigger needs and Remote has no public API for — a contract amendment request inside Remote's own product. The REAL UC-06 gates (identity → employment → schema → cutoff) run first via `handleAmendmentRequest()`, then a Zendesk ticket is created pre-tagged with the decision's outcome tag and pre-populated with the drafted summary + amendment id, then linked via `externalRef` — mirroring issue #17's trigger-source model (00-FOUNDATION.md §2). **Submissions are role-gated server-side (issue #34): employee / employer / company-admin each have their own authenticated session and their own permitted actions** — the admin requests an amendment, the employee consents to their own, the employer consents on the company's behalf; anything outside a role is refused. Remote reads always the mock; Zendesk real when configured, mock otherwise. See §3.18 and §3.19 |
| **UC-08 core** (presence calc, treaty retrieval, dossier, escalate-only) | **Real**, real persistence + read-only ZAF panel + n8n (built, **ACTIVE**) | `src/uc08/*.js`, `workflows/nodes-uc08/*.js` | The 🔴 use case with NO execution path — `handleTaxInquiry()` takes no remote/zendesk dependency at all, asserted structurally and behaviorally by test. `dossierStore.js` (one write method, zero mutation methods) persists dossiers to the real `uc08_dossiers` table; `src/uc08/server.js` exposes them **read-only** — no POST route exists in the file at all; the ZAF panel shows the dossier with no action controls; the n8n workflow (`WORKFLOW_UC08_ID`) has no Switch/IF node anywhere in its graph, dry-run verified, **active since 2026-08-10** (verified `active: true` and published live again 2026-08-18). **Real unpinned executions have since landed genuine rows** — `uc08_dossiers` and `audit_log` both carry rows from live webhook drives, most recently 2026-08-17. Treaty retrieval is now embedding-similarity over the curated corpus's vectors in a `uc08_treaty_citation_vectors` pgvector table (issue #29), keyword fallback when unconfigured. See `docs/use-cases/UC-08.md` §15 and §3.15 |
| **Approver role entitlement** | **Real** (`src/review/approverEntitlement.js`), wired into UC-04/05/06/09 | `src/review/approverEntitlement.js`, `test/approverEntitlement.test.js` | Prime directive #3 had been applied to the requester and never to the approver's ROLE. Both `src/uc06/server.js` and `src/uc09/server.js` built the policy call as `{role: body.role, approver: identity.approver}` — the approver from the verified signature, **the role out of the request body** — and `src/review/zafAuth.js` carries no role claim to read one from. So the four-eyes controls held as built (two genuinely different, canonicalised people) while nothing required either of them to be **entitled**; UC-04 and UC-05 had no role concept at all, only a non-empty `approver` string. Three properties are pinned rather than asserted: consulted **last** (after every refusal the policy already had, so it cannot hide the real reason), **refusal-only** (`check()` returns a refusal or `null` — no value means "approved", so no call site can be written in which it fills a slot or lowers a floor), and **additive** (no existing gate, floor or `isSameApprover()` check is touched or reordered). Entitlement is a configured roster (`APPROVER_ROLES`) rather than Zendesk group membership, chosen on one decisive property: it is the only source that can be **non-empty on the day it ships**, and an entitlement source with no entries is a gate that refuses everything while looking exactly like a gate that works. The Zendesk-backed seam is already there (`createEntitlementChecker({grants})` takes an already-resolved map) for when those groups exist. Required-but-unconfigured refuses as `approver_entitlement_not_configured`, deliberately not `approver_not_entitled` |
| **Approval queue** (what is waiting on a human, and what nobody can reach) | **Real**, read-only, deployed | `src/approvalqueue/*.js`, `docs/APPROVAL-QUEUE.md` | `npm run queue-ui` → `:4047`; `/queue` on the Vercel function. Read-only **by construction** — no POST route exists in `server.js`, asserted behaviourally (a write-shaped request 404s) and structurally (the source, comments stripped, never names the method). It re-derives no policy: waiting-ness, destination and reachability are read out of the stores, the routing table and Zendesk, and an unrecorded fact is reported as unrecorded rather than computed. The brief was explicit that the **stuck list is the headline** — a pretty list of what works is worth much less than an honest inventory of what nobody can act on — and pointed at production it read 54 records, 39 waiting, **36 unreachable**. Findings in §5's roadmap and `CLAUDE.md` §7 |
| **Execution & audit-trail viewer** | **Real**, read-only, deployed | `src/auditview/*.js`, `docs/AUDIT-VIEWER.md` | `npm run audit-ui` → `:4044`; `/audit` on the deployment, same shared key. Live feed over `audit_log` for both execution paths, drill-down to every `audit_trace` attempt with a duplicate-call banner, a bug-audit view now keyed by **any** identifier a request carries (not only an external ref), `ops_alerts` surfacing `audit_durable`, and an empty answer that says **which kind** of empty it is. Read-only in UC-08's structural sense: no POST route exists in the file |
| **Statutory knowledge corpus** | **Real** (documents + findings); **nothing built on it** | `docs/knowledge/`, `docs/KNOWLEDGE-SOURCES.md` | 35 of 39 Layer-1 statutory/agency documents retrieved from their own authorities across three passes, each with a provenance header carrying source, publisher, exact URL, retrieval date, **SHA-256 of the retrieved bytes**, licence and catalogue id — *a vendored file with no provenance header is worse than no file, because it looks authoritative and cannot be checked*. Four remain unretrieved for four different reasons (`RETRIEVAL-BLOCKED.md`); the class "our own network refused an authority" is empty. **The findings are the deliverable**: `CONTRADICTIONS.md` holds **30 contradictions and 4 confirmations** against shipped code (34 findings, counted 2026-08-20). **No file was changed by the pass that produced it. Three findings have since changed code, each as its own reviewed commit with its own tests** — C-1 (`73920c9`), C-18 and C-14/C-20/C-28 (`43ae3c7`) — and the corpus is separately **cited on the 🟡/🔴 decision screens** without touching a gate (`src/uc04/decisionSources.js` references 24 findings by id; UC-05/07/08 reference their own). The rest stay unactioned **by choice**, and the reason is unchanged — resolving a legal rule wrongly makes validation stricter than the law and starts refusing valid requests, which is a new failure rather than a fix |
| **Demo scenario matrix** (NL · PT · CA · US) | **Real**, run against the live Sandbox | `docs/DEMO-COUNTRIES.md`, `scripts/demo-countries-matrix.mjs` | 77 scenarios across all nine use cases, each row carrying an **observed** column produced by calling the real entry point in `src/ucNN/workflow.js` with real Sandbox employment ids. 68 matched their prediction; **9 did not**, and §6's nine are the point. Every use case carries at least one scenario whose expected outcome is a **success**, because the repo's most expensive recurring defect is that a use case which structurally cannot succeed is indistinguishable from one that is appropriately refusing. **Not a test and must never be imported by `npm test`** — it reaches the network on purpose; every LLM seam is injected with the real function forced into its unconfigured branch |
| **G-3 — the third-party consent round trip** | **Real**, all four parts built | `src/shared/{consentArtifact,identity,caseStore}.js`, `src/uc01/{policyEngine,workflow,refusalCopy}.js`, `workflows/nodes/{gates,normalizeTicket}.js`, `src/thirdparty/*` (L-12), `src/portal/server.js`'s consent-request routes (L-13), `src/approvalqueue/{awaiting,stuck}.js` (L-19), `src/portal/requestTypes.js` + `src/uc01/selfServiceLetter.js` (L-14) | `consent_records` (L-7, migrated and read back live 2026-08-21) now backs a real three-state regime — **granted** (verified, still `human_review`, never zero-touch), **denied** (`blocked`/`consent_refused`, the third party told nothing about why), **pending** (`awaiting_employee_consent`, a genuinely new decision that is NOT a refusal — VC-06). `identity.js`'s third-party branch is now tested AHEAD of "does the employment even exist" so a real employee and a nonexistent one are indistinguishable (VC-33). L-12 is `npm run thirdparty` (:4048) — an unauthenticated door whose HTTP response is a literal constant no branch can select, proven by driving all four of VC-33's cases (real-pending, real-denied, nonexistent, internal error) and asserting byte-identical bodies. L-13 lets the employee grant/deny through the portal (`GET/POST /api/consent-requests`), scoped server-side to their own employment, mirroring `src/remoteui/roles.js`'s cross-party refusal. L-19 surfaces a pending request's age in the approval queue as OUR policy figure, never Remote's (owner answer A5), and never transitions a row on elapsed time alone. L-14 is the destination G-2's deflection has promised since it shipped — `src/uc01/selfServiceLetter.js`, a deliberately separate, LLM-free, ticket-free path reusing only the three facts genuinely shared with the ticket-driven workflow (engagement eligibility, required-field completeness, the one letter template). See §3.90 |

---

## 2. Architecture — current state

```
ticket object (constructed in code — no real Zendesk yet)
   │
   ▼
classifyRequest()  ──── real OpenAI call, JSON-validated ──── falls back to rule-based on failure
   │  (src/uc01/classifier.js, src/shared/llm.js)
   ▼
RemoteClient.getEmployment()  ──── real Sandbox call ──── normalizeEmployment() bridges shape
   │  (src/remote/restClient.js)
   ▼
verifyRequester()  ──── deterministic, no I/O
   │  (src/shared/identity.js)
   ▼
policyEngine.evaluate()  ──── deterministic, no I/O
   │  (src/uc01/policyEngine.js)
   ▼
    ├── auto_resolve → RemoteClient.getLegalEntity() → renderLetterHtml()
    ├── human_review  → (nothing further automated)
    ├── escalate      → (nothing further automated)
    └── out_of_scope  → polite refusal, no case created
    │
    ▼
CaseStore.createCase() [+ createReviewQueueEntry() / createDocument() as applicable]
    │  (src/shared/caseStore.js) → Supabase cases/review_queue/documents; now also stores `ticket_text`
    ▼
AuditLogger.log()
    │  (src/shared/audit.js) → Supabase audit_log
    ▼
[optional] ZendeskClient.resolveWithLetter() / flagForReview()
    │  (src/zendesk/restClient.js) → real ticket, if ticket.source==="zendesk" and a client was passed
    ▼
return { decision, letterHtml, flags, reason, caseId }
```

Still missing: real Zendesk ticket *ingestion* (the arrow feeding the top of this diagram — see §3.4/§5), PDF instead of HTML, a real sidebar.

---

## 3. Component deep-dives

### Archived write-ups — §3.1 … §3.84

Moved to **`docs/history/BUILD-LOG-ARCHIVE.md`** on 2026-08-21, unchanged and
still numbered. A citation such as "§3.24" resolves by searching that file.

They were archived because this is the file `CLAUDE.md` tells every agent to read
first, and at 784 KB it consumed an agent's context before any work began. The
write-ups are complete; they are simply not needed in order to start a task.

<details>
<summary>Index of archived write-ups</summary>

- **§3.1** — Classifier + LLM adapter (`src/shared/llm.js`, `src/uc01/classifier.js`)
- **§3.2** — Remote client + schema normalization (`src/remote/restClient.js`)
- **§3.3** — CaseStore (`src/shared/caseStore.js`) — operational state
- **§3.4** — Zendesk client (`src/zendesk/restClient.js`, `src/zendesk/normalizeTicket.js`)
- **§3.5** — Database schema
- **§3.6** — ZAF sidebar + review API (`zaf-app/`, `src/review/`)
- **§3.7** — Interactive playground (`src/playground/`)
- **§3.8** — Live demo (`src/livedemo/`) — the real front door
- **§3.1** — UC-08 core (`src/uc08/`) — Cross-Border Tax & Social Security Review
- **§3.11** — Going deeper on UC-06/UC-08: real persistence for UC-08, and one ZAF sidebar for three use cases
- **§3.12** — n8n workflows for UC-06 and UC-08 — built, dry-run verified, deliberately NOT activated (at the time; both are
- **§3.13** — Auditing UC-01 end to end — two overstatements found, one real bug fixed
- **§3.14** — Chat demo (`src/chatdemo/`)
- **§3.15** — UC-08 treaty retriever: keyword matching → pgvector embedding similarity (issue #29)
- **§3.16** — Retry-then-escalate wrapper around every LLM call (issue #32, closing #19)
- **§3.17** — Narrative-faithfulness judge for UC-06/UC-08 LLM-authored prose (issue #27)
- **§3.18** — UC-06 Remote UI stand-in (`src/remoteui/`)
- **§3.19** — Remote UI stand-in role gate (`src/remoteui/roles.js`, issue #34)
- **§3.2** — Source-tagging every LLM fallback (issue #25, invariant 8)
- **§3.21** — Two-level audit: per-attempt trace under the decision row (issue #26, invariant 7)
- **§3.22** — `recommend()` no longer calls zero data "healthy" (issue #28)
- **§3.23** — Redundant-call detection over the audit trace (issue #33)
- **§3.24** — Exactly-once delivery for the other eight n8n graphs (`Claim Ticket (Idempotency)`)
- **§3.25** — A request with no external reference must be processed, never dropped
- **§3.26** — Four identity gates could verify a claim against itself (UC-03, UC-05, UC-06, UC-09)
- **§3.27** — Telling "the read failed" apart from "the policy refused" (`src/shared/upstreamFailure.js`)
- **§3.28** — UC-03 could never have said yes — and every safety test passed anyway
- **§3.29** — Ops alerting that reaches a human — and the rows that were deliberately not deleted
- **§3.3** — One disease, six symptoms: fixtures that agreed with the code instead of the API
- **§3.31** — A gate that crashes is worse than a gate that refuses
- **§3.32** — The read side of the API was never authenticated
- **§3.33** — Publishing the intake surface without reopening what was just closed
- **§3.34** — A calendar that stopped, and the half of UC-06 nobody could see
- **§3.35** — The table was already there — UC-02's dedupe gate had no memory to check
- **§3.36** — Mirroring three real Sandbox people into the mock, without pointing the portal at a real account
- **§3.37** — A Sandbox-only roster, and the six demonstrations that had to be re-housed rather than deleted
- **§3.38** — The exception nobody could resolve, and the four things that followed from fixing it
- **§3.38** — A third row kind for the audit viewer, and the portal fields the roster change missed
- **§3.39** — The other half of §3.35 — UC-02's dedupe gate on the n8n path could not fire
- **§3.39** — The three standing `src/remote/` issues, re-verified live — and the fourth one they were hiding
- **§3.42** — UC-05 and UC-07 driven as a user — seven defects, every one green beforehand
- **§3.4** — An escalation nobody owns — the routing table on the n8n path
- **§3.41** — UC-08 and UC-09 driven as a user: seven defects on the money path, two on the tax dossier
- **§3.43** — UC-06 could not succeed from its own UI, and five other defects found by using the surfaces
- **§3.41** — UC-03 and UC-04, driven rather than read — six defects, and the two that could never have succeeded
- **§3.44** — "Decided by gate 15" — a number citing an order nobody could see
- **§3.45** — The ticket that was never created, and the one that reached nobody
- **§3.46** — "9 backing services are unreachable" — nine services that answered
- **§3.47** — Legible gate ladders for UC-03, UC-04, UC-05 and UC-09 (`src/shared/gateLadder.js`)
- **§3.48** — Two labels that told a reader something untrue — the escalation tag on routine work, and the green `escalate`
- **§3.51** — The secret was right all along — a bundle 32 minutes too old
- **§3.5** — Three suspected defects in the n8n ports, and the two the merge itself uncovered
- **§3.49** — UC-07: three ways the dossier was less than it claimed to be
- **§3.52** — Decided in one world, executed in another — the portal's records could never be released
- **§3.53** — "Already been released or declined" — a refusal that listed possibilities the row did not have to guess betwee
- **§3.54** — The mock's memory is not a place to keep a record — closing §3.52's serverless hole
- **§3.55** — The same defect, swept: seven more places the system said less than it knew
- **§3.56** — "I did not see the effect of the approve on the UI/portal" — a feature that could never once succeed, behind a
- **§3.57** — "In real life when a client makes a request, they expect feedback" — the other half of every human gate
- **§3.58** — Four words for one act — UC-02's `release`, and a DECISION panel that never said what was decided
- **§3.59** — The human's decision rendered as a dull follow-up — and the slug that said less than the code held
- **§3.6** — Our words vs Remote's words — a vocabulary audit, and the two writes it found are wrong
- **§3.61** — The money write pointed at a URL Remote has never served
- **§3.62** — Seven of eight "could not confirm" closed — and the second endpoint we write into that does not exist
- **§3.63** — Executing the safe half of the vocabulary audit — and two things a refusal knew but never said
- **§3.64** — A word Remote has never used — `deny` → `decline` across four use cases
- **§3.65** — Twelve requests as twelve cards — the my-requests listing becomes a table
- **§3.66** — UC-04 decided on a record it had invented — and what the use case is once it cannot
- **§3.67** — The portal's identity refusals left no trace — a reference the requester was shown that named nothing anywhere
- **§3.68** — "I hope there is an id that ties the entries together" — there is, and for five of seven use cases it never re
- **§3.69** — The one id a requester holds was the one id the audit trail did not carry
- **§3.7** — "Am I supposed to just go to UC-04?" — the one line on the panel that was not true
- **§3.71** — Reading the Sandbox instead of our own fixtures — six divergences, and the one that decides whether UC-04 can 
- **§3.72** — The employee's own next step — continuing a UC-03 routing into UC-04
- **§3.74** — The 🟢 exception surface — every figure the gate compared, on the screen the one human sees
- **§3.75** — The 🔴 tier's dossiers, read as a deliverable — what the reader needs, and what the system already knew but did
- **§3.76** — What the 🟡 approver never saw — C-27 generalised to UC-04, UC-05 and UC-06
- **§3.77** — Fetching the catalogue's sources — thirteen statutory authorities attempted, zero reachable, and a licence gra
- **§3.78** — The day the log fell behind the code — a documentation sync, and what it could and could not establish
- **§3.79** — Re-auditing a gaps list instead of restating it — and what falsification found
- **§3.8** — The rule that was given three times and written down none — `docs/UI-AUDIENCES.md`
- **§3.81** — The requirements register — `qa/`, three decision passes, and the first build queue
- **§3.82** — UC-04 decided — an employee surface, a false refusal found in a statute, and a section that promised something
- **§3.83** — UC-05 decided — the business case was false, Canada is the only demo country whose signable number has no stat
- **§3.84** — UC-06 decided — a four-eyes control that was two eyes, a pre-check nothing calls, and the first project-wide r

</details>

### 3.9 UC-06 core (`src/uc06/`) — Contract Amendment / Payroll Cutoff

The second of the portfolio's "3 deep use cases" (`CLAUDE.md` §1), built in
the same order UC-01 was: deterministic core logic, fully tested against the
mock, before any sidebar/n8n/live-service wiring. Six files, split along the
same pure-logic/storage/orchestration lines every other use case in this repo
uses:

- **`cutoffEngine.js`** — pure date arithmetic. Given a payroll cycle
  calendar and a requested effective date, it answers three questions:
  which cycle applies, has that cycle's cutoff already passed, and is
  submission within 48 hours of it. `now` is always an explicit argument
  (never `new Date()` read internally), the same discipline every other
  pure function in this repo follows so tests can be deterministic.
- **`changeParser.js`** — the LLM seam, deliberately narrower than UC-01's.
  `amendmentType()` (SALARY_INCREASE, JOB_TITLE_CHANGE, etc.) is a
  **deterministic function**, not an LLM call — it's fully derivable from
  which structured fields changed and, for salary, whether new ≥ old.
  `draftSummary()` is the one place an LLM may run, and its output is
  display/audit text only, structurally incapable of being read back into a
  decision or a payload. The actual new salary/title/hours values must
  arrive as structured input — an LLM parsing "give me a raise to $90k" out
  of free text and writing that number toward a payroll field would violate
  the one rule this whole portfolio is built on.
- **`policyEngine.js`** — ordered gates: identity (session company matches
  the employment's company) → employment active → dynamic per-country
  schema → cutoff. It builds the **full next-state** basic-information
  payload (existing employment fields merged with the proposed changes) —
  not just the diff — before validating it against the country schema. This
  matters: a country's "required" field list describes a complete valid
  record, so validating a bare diff against it would flag every field the
  amendment didn't touch as "missing" on every single amendment.
- **`amendmentStore.js` / `dualApprovalPolicy.js` / `workflow.js`** — the
  dual-control HITL gate. See the decision-log entry below for why this is a
  new, small, purpose-built store rather than a forced fit into
  `src/review/`'s single-slot `review_queue`.

Mock server extended with three new endpoints (`getCountrySchema`,
`listPayrollRuns`, `patchEmploymentBasicInformation`) and a dedicated
`emp_active_003` fixture, kept separate from `emp_active_001` specifically so
tests that mutate state (the execution test, the freshness-recheck test)
can't corrupt other tests' assumptions about the shared mock — same
reasoning as UC-01's `emp_terminated_002` existing as its own fixture rather
than mutating `emp_active_001` in place.

**Also built this session — the HTTP API** (`src/uc06/{server,cli}.js`,
`npm run uc06-api`, 7 new tests): `GET /api/amendments/:id` and
`POST /api/amendments/:id/approve|deny` with `{role, approver, note}`, a
dedicated server rather than adding a `role` parameter to
`src/review/server.js`'s endpoints (that server's policy was never designed
to carry one). Seeds three real amendments through the actual workflow so
it's demonstrable with zero credentials, matching `review-api`'s seeded-mode
pattern. **Not yet wired to a browser panel**: `zaf-app/assets/main.js`
renders exactly one approve/deny pair per case, driven by a single
`currentUser` as the sole approver — teaching it "which of two roles is this
agent acting as right now" is a real UI design question (a role selector?
two separate panel views? a query param the sidebar is opened with?) that
deserves its own deliberate pass rather than a rushed generalization of an
already-working, tested shared shell. Also not built, on purpose: an n8n
workflow and the Slack urgent-cutoff alert (the `urgent_cutoff` flag is
computed and audited; nothing sends it anywhere yet).

**Real Supabase persistence added in a later pass this session**:
`uc06_amendments` (RLS enabled, zero policies — same pattern as every other
table), applied via the Supabase MCP the same way UC-01's tables were.
`AmendmentStore` takes an optional `pgPool` mirroring `caseStore.js`
exactly: `createAmendment()` is fire-and-forget in the background;
`recordApproval()`/`markDenied()`/`markExecuted()` are awaited and allowed
to throw, since each IS the durable record that a human authorized
something (or that a real write happened) — same asymmetry
`AuditLogger.logDurable()` already establishes. `findById()`/
`findByExternalRef()` check local memory first, then Postgres, so the API
can run as a separate process from whatever created the amendment. Verified
the real INSERT/SELECT/UPDATE round trip directly against the live table
via the Supabase MCP, since this session has no real `SUPABASE_DB_URL` to
exercise the Node path live. The source research pack for
UC-06 describes a genuinely enterprise-scale system — four AI agents, a
vector-DB legal RAG pipeline, a 12-state formal state machine, a 6-table
schema with document versioning. None of that is built, deliberately,
following the exact same precedent UC-01 set: distill to the lean, defensible
core and say so honestly, rather than half-build the larger vision.

## 4. Decision log

Chronological, most-recent-relevant-first isn't the point — this is a record of *why*, for anyone who wonders "why is it built this way and not the obvious other way."

- **The portal gets a shared key, not the ZAF-signed identity the nine APIs use.** Not a weaker choice made for convenience — the stronger mechanism is unavailable by construction, because a ZAF token is minted by Zendesk for an app running inside Zendesk and the portal stands in for Remote's own product surfaces. Two alternatives were rejected: leaving it ungated (a public write path, strictly worse than the read defect closed the same week), and widening the ZAF verifier to accept something a non-Zendesk page could present (which would weaken the nine to fit the tenth — the repair that must never look tempting). The key is documented as proving possession of a secret and nothing else, so nobody reasons about it as though it were authentication.

- **Postgres connection via direct connection string (`pg` package), not `@supabase/supabase-js` + service key.** The user asked for a ".env with... Supabase Postgres URL" — took that literally. The `postgres` role from that connection string owns the tables and bypasses RLS, so no policies were needed.
- **`normalizeEmployment()` exists because the real API doesn't match the mock.** Verified live: real Sandbox employment records nest under `{data: {employment: {...}}}` and have no flat `contract_type`/`start_date`/`probation`/`legal_entity_id` — those concepts live under `basic_information`, `employment_model`, `probation_period_end_date`, `engaged_by_legal_entity_id`. The mock's flat shape was a reasonable simplification for local dev, but code needed a bridge, not a rewrite of the mock.
- **`getLegalEntity` needed a fallback strategy, not a straight swap.** The build case (Phase 3) assumed a `get_legal_entity()`-style single lookup. The real endpoint for that doesn't exist; discovered via the `remote-api-integration` skill's discovery protocol (developer.remote.com), not by guessing. Real path needs `company_id`, which the mock's employment records don't have — so the fallback is conditional on `companyId` being present.
- **Classifier/demo/tests must not depend on ambient `.env` state.** Early in this build, `npm test` silently made real, billed OpenAI calls because a real `.env` already existed on the dev machine outside git's visibility (gitignored). The fix wasn't "don't commit `.env`" (already true) — it was explicit dependency injection (`classify` param) so hermeticity is structural, not incidental.
- **`caseStore` writes are chained per-case, not fire-and-forget.** Found via actually running `npm run live`, not via review: a document insert raced ahead of its parent case insert and hit a live FK violation. Async writes to related tables need explicit ordering when they share a foreign key.
- **`§12.6` (non-English/ambiguous → low confidence) can't be demonstrated by the rule-based classifier alone.** Its confidence heuristic and its intent heuristic are derived from the same signal, so "standard-looking but low-confidence" never occurs from rules alone — only a real LLM's independently-reasoned confidence could produce that combination. `scenarios.js` injects a small labeled stand-in classify function for this one scenario rather than skipping it or mislabeling a different scenario as if it were this one.
- **`§12.7`'s "disclosure gate" is structural, not a text-pattern check.** The build case implies detecting "salary requested in text → block". What's actually built: the letter template names its rows one by one and none is a compensation field, so salary is never emitted regardless of what's asked. This is arguably *safer* — it works even if the classifier misses the salary mention. ~~but means an over-scope request still silently auto-resolves rather than being flagged for a human authorization decision, which is a real behavioral gap from the build case's intent — noted, not yet fixed (see §5).~~ **CORRECTED 2026-08-19 — the routing half is BUILT and this clause was stale, contradicting §5 item 3 in the same file (marked Done there).** An over-scope request routes to `human_review` / `over_scope_request` with flag `over_scope_disclosure_requested`, and it fails CLOSED when the classifier omits `requestedFields` altogether (`over_scope_undetermined`) rather than reading absence as "nothing was asked for". Covered in both directions in `test/uc01.test.js`, `test/n8nParity.test.js` and `test/n8nChainReachability.test.js`, and re-verified live through `npm run playground`. The two mechanisms are complementary and both real: the template cannot leak, and the router will not answer an over-scope request without a human. NOTE: the whitelist named here as the enforcement mechanism is the TEMPLATE's own row list — `STANDARD_LETTER_FIELDS` is a different list, consulted only by the over-scope gate; see §3.40.
- **No Zendesk MCP → REST API directly, same as Remote.** Checked the connector registry; nothing exists. This isn't a workaround — it matches the build case's own §17 argument almost exactly (API for deterministic paths, MCP only for optional AI-assistant convenience), except here there wasn't even an MCP option to reject.
- **`normalizeZendeskTicket()` throws rather than defaulting `employmentId` to something.** An unidentifiable verification request must not proceed automatically under any circumstance — silently guessing which employee a ticket is about would be a disclosure risk, not a convenience.
- **Approve/deny writes are awaited and allowed to throw, unlike every other write in the app.** Everywhere else, a write is a side-effect of a decision already made and acted on, so failures are swallowed rather than breaking a customer-facing outcome. A human clicking Approve is the opposite: the audit row *is* the record that they authorised it, and the agent is about to be told "approved". Reporting success while the row silently failed to land would make the sidebar lie about accountability. Hence `AuditLogger.logDurable()` and the async `CaseStore.update*` methods — the same asymmetry `metrics/source.js` already applies to reads, for the same reason (a missing number gets investigated, a wrong one gets acted on).
- **The `CaseStore` update methods do not require the row to be in memory.** The review API normally runs as a *separate process* from the workflow that created the case, so its in-memory arrays start empty and Postgres is the only place the row exists. They update whichever backing actually has it and report "not found" only when neither did. Getting this wrong would have produced an API that worked perfectly in tests and silently no-opped in production — the failure mode is invisible precisely where it matters.
- **Refusals are audited only when the caller is identified.** A refused approve on a real case is exactly what an audit log is for, so those are recorded. But `approver_required` / `unknown_action` / `case_not_found` are not: with no authenticated actor to attribute, writing them would let anyone who can reach the endpoint append unlimited rows to an append-only table just by POSTing ticket ids, burying the attributed rows that matter. Found by a test that expected zero rows and got one.
- **Refusals are logged best-effort while decisions are logged durably.** The refusal has *already* prevented the state change, so its row is evidence rather than the control itself — and making it durable would let a database blip turn a correct 403 into a 500, which is a worse answer to give a specialist.
- **The sidebar sends the approver in a header the server trusts, and this is written down rather than quietly shipped.** It is fine for a local demo and not fine on a public URL. ~~The production fix (ZAF signs a JWT for the current agent; the server verifies it) is specified in `src/review/server.js` and not built.~~ **BUILT — this clause went stale and is corrected 2026-08-29, in the dangerous direction: it understated a control that exists, so a reader auditing this repository's authorization story concluded it was weaker than it is and could reasonably have set out to "fix" something already fixed.** The verifier is `src/review/zafAuth.js` (HS256 — ZAF signs client-side app tokens with HS256 only, and an earlier RS256-pinned draft of that file could never have accepted a real one; both paths are now supported and the file records why), and `src/shared/approverAuth.js` is the one mechanism all five approving services share, so "who are you?" has one answer rather than five. `signedIdentityRequired()` makes the requirement follow the posture rather than a flag someone must remember: a durable store attached ⇒ required. Verified against the DEPLOYMENT, not the source — `GET /__cx/health` on 2026-08-29 reports `signedIdentityRequired: true`, `zafSharedSecretConfigured: true`, `zafVerifierBuilt: true`, `readsRequireSignedIdentity: true`. What survives from the original bullet is its reasoning, which is why it is struck rather than deleted: `ZAF_REQUIRE_SIGNED_IDENTITY=true` makes the server refuse every state-changing call rather than look more trustworthy than it is. An unauthenticated approve endpoint writing to `audit_log` would make the log's attribution field worthless, which is worse than having no endpoint.
- **The seeded mode exists because a sidebar has nothing to render until a ticket has been through the workflow.** Rather than requiring live Zendesk + Supabase before the UI can even be looked at, `npm run review-api` runs four real tickets through the *real* `handleVerificationTicket` and serves the resulting rows. The cases are genuine — same gates, same flags — only the storage is ephemeral.
- **n8n's "Append Audit Log" node had to become a Supabase node, not a Postgres one, discovered only when actually wiring it live.** The workflow was built assuming a Postgres credential (raw host/port/user/password) would eventually exist in n8n; when it came time to activate, the account had a `supabaseApi` credential instead (project URL + service key — the credential type the dedicated Supabase *node* uses, not the generic Postgres node's raw-SQL approach). Rather than ask for a second, different credential to be created just to match the original design, the node itself was swapped to `n8n-nodes-base.supabase`'s row-create operation against the real `audit_log` table, discovered via `mcp__n8n__explore_node_resources` (which also confirmed the table's real columns) rather than guessed. `id`/`at` are left unset in the row and rely on the table's own `gen_random_uuid()`/`now()` column defaults — confirmed via `mcp__Supabase__list_tables`, not assumed.
- **The Zendesk trigger's original single-fire guard (`status: new`) was wrong for this account, found only by testing on a real ticket.** The design reasoned "a ticket only has status New once, so gating on it prevents the automation's own follow-up update from re-triggering the same trigger." Correct reasoning, wrong assumption: this account moves agent-created tickets straight to `Open`, skipping `New` entirely, so the condition could never match anything. Replaced with a guard that doesn't depend on Zendesk's status semantics at all: fire only while none of the automation's own outcome tags (`uc01_auto_resolved`/`uc01_human_review`/`verification_exception`) are present yet — a `not_include` tag condition. Same single-fire property, no dependency on an assumption about ticket lifecycle that turned out to be account-specific.
- **The short employment id shown inside Remote's own UI is not the API id.** `DG4KTE` is what the Sandbox dashboard displays as "Employment ID" in the page itself — a human-friendly display code. The actual id the REST API needs (`GET /v1/employments/{id}`) is the long UUID in the page's URL (`fde4007b-6257-4504-9467-8d61b5785488`). Confirmed by testing both against the real Sandbox API rather than assuming the UI's own label meant what it said; only the UUID returned real employment data.
- **`src/livedemo/` exists because manually creating a Zendesk ticket to test the pipeline isn't a demo of automation.** While getting n8n live, testing required an agent to type the client's request into Zendesk directly — necessary for verifying the pipeline, but if used as *the* demo it would misrepresent the system: the point of 🟢-tier automation is a client's own request getting processed with zero human intervention. See §3.8 for the full reasoning and what it does and doesn't do.
- **UC-06's dual approval is its own store, not a forced fit into `review_queue`.** `src/review/reviewPolicy.js`'s own header says "UC-06's dual approval extends this rule rather than replacing it" — and the *principles* do extend (pure policy separate from storage, one decision surfaces at a time, actionability computed server-side never re-derived in a UI). The *schema* doesn't: `review_queue` has one status/assignee/notes slot for one decision, and UC-06 needs two independently-identified slots (customer admin, payroll specialist) that both have to fill before anything executes. Encoding a role into a free-text `notes` column to make one table pretend to be two would be worse than a small, purpose-built store following the identical discipline. Extending a principle and reusing a schema are different claims; this build did the first, not the second.
- **UC-06's schema validation checks the FULL next-state payload, not the diff.** The country schema's `required` list describes a complete valid employment record. An amendment that only changes salary still has to produce a payload where `job_title`/`weekly_hours`/etc. are present — via the *existing* employment values, not the change — or every amendment that touches one field would spuriously fail validation on every field it didn't touch.
- **UC-08's `treatyRetriever.js` used to be keyword matching, explicitly not RAG, and said so in its own header — until issue #29 built the real thing.** The old reasoning stands as history: this repo had no vector database or embeddings pipeline, and building a search interface that LOOKED like semantic retrieval over three hand-typed paragraphs — a fake similarity score, a fake "top-k" ranking — would have claimed infrastructure that didn't exist. Issue #29 then built the infrastructure honestly: the same curated corpus (issue #23's boundary — not expanded) is now retrieved by cosine similarity against vectors in a `uc08_treaty_citation_vectors` pgvector table, provisioned by a human (schema in `docs/SETUP-CHECKLIST.md`), never created by code. What carried over is the discipline: every citation still states why it matched, now as a plain-language rank-and-threshold statement, never a percentage, because an embedding similarity is a retrieval signal, not a precision figure.
- **The embedding-similarity retriever degrades to keyword matching, it doesn't replace it with a failure mode.** `TreatyRetriever` (issue #29) needs two things the old version never had — an `embed` function and stored vectors — and either can be absent (no key, no table yet, an n8n Code node). Rather than throw, retrieval falls back to the original keyword matcher, the same "optional integration degrades to a safe default" rule as `audit.js`'s optional `pgPool`. This is what keeps `npm test` hermetic (no embed function is ever configured there) AND keeps the n8n "Build Dossier" Code node in parity — an n8n Code node has no pgPool or embedding client, so it runs the keyword path, which is the exact path the real function runs unconfigured. `matchedOn` honesty holds on both paths: keywords on the fallback, a plain-language rank/threshold statement on the embedding path — never a raw similarity number that could read as "92% relevant".
- **UC-08's `handleTaxInquiry()` takes no `remote`/`zendesk` dependency, structurally, not just behaviorally.** UC-01 and UC-06 both accept those dependencies and gate what they do with them; a 🔴 use case with a policy check that merely REFUSES to call a write method is still one bug away from calling it. Removing the parameter entirely — there is no way to pass a write-capable client into this function even by mistake — is a stronger guarantee than any runtime check, and it's the thing `test/uc08.test.js`'s structural test (source-level, comments stripped) actually verifies.
- **UC-06's LLM seam is narrower than UC-01's, by deliberate design, not omission.** The distilled `UC-06.md` spec's n8n diagram says "LLM: parse proposed contract changes from ticket text" — i.e. have the LLM extract the actual new salary figure from free text. Building it that way would mean an LLM is the *source* of a number that could end up in a real payroll write, which is exactly the failure mode "LLMs interpret; deterministic code decides" (CLAUDE.md's prime directive #1) exists to prevent. Resolution: `proposedChanges` must arrive as structured data (the equivalent of a real amendment form's fields); the LLM's only job (`changeParser.draftSummary()`) is a plain-English restatement of those already-decided values for a specialist screen — output that can never be read back into a decision. `amendmentType()` needed no LLM at all once this was settled, since SALARY_INCREASE vs. DECREASE is fully derivable from the structured old/new values.
- **UC-08's `dossierStore.js` has exactly one write method and zero mutation methods, deliberately.** Giving the 🔴 use case ANY persistence risked quietly growing into a second execution path over time — the natural next PR after "save the dossier" is "let a specialist mark it resolved," and the one after that is a status column with a state machine. The fix was to make that next PR structurally awkward: there is no `updateDossier`/`markReviewed`/`markExecuted` method to extend, only `createDossier` (write-once) and `findById`/`findByExternalRef` (read). `src/uc08/server.js` carries the same discipline into the API layer — no POST route exists in the file, not merely refused at runtime — and `test/uc08Server.test.js` pins both: any POST 404s as `no_such_route`, and CORS never advertises anything but `GET, OPTIONS`.
- **UC-06/UC-08's n8n workflows duplicate the gates in Code nodes, the same pattern as UC-01, rather than calling back into a bespoke Node HTTP service.** The alternative — a thin n8n orchestrator that POSTs to a new "decide" endpoint on `uc06-api`/`uc08-api` — looked simpler, but it would introduce something UC-01's design deliberately doesn't have: a hand-rolled, singly-instanced Node process as a hard dependency in the ticket-intake critical path. UC-01's n8n workflow calls OpenAI/Remote/Zendesk/Supabase directly; the Node app is dev/test/demo-only for that piece, never itself a production service in the loop. The ZAF sidebar's approve/deny calls (`review-api`/`uc06-api`) already ARE a real, always-on Node dependency — but that's an existing, accepted piece of the architecture, not one this decision would add to. Keeping intake resilient the way UC-01's already is outweighs the cost of a second copy of the gates, which is exactly the tradeoff the parity-test pattern (`test/n8nUc06Parity.test.js`, `test/n8nUc08Parity.test.js`) exists to make safe.
- **The ZAF sidebar normalizes three different API shapes into one, in the loader, not in the renderer.** `main.js`'s `render()`/`renderActions()` were written once, against UC-01's `{case, review, documents}` shape, and stayed exactly that — untouched — when UC-06 and UC-08 were added. Each new use case gets its own small loader function (`loadUc06`/`loadUc08`) whose only job is producing that same shape from a differently-structured response, plus a `post` closure bound to its own endpoint. The alternative — teaching `render()` to branch on which use case it's looking at — would have put use-case-specific logic back in the one file the whole panel-registry design (`00-FOUNDATION.md` §6) exists to keep generic.
- **The Remote UI stand-in runs the gates BEFORE the ticket exists, which is the opposite of UC-01 — on purpose.** UC-01's entry point IS a Zendesk ticket, so its gates run against it and the outcome lands back on it. UC-06's entry point is a Remote-native event that has no public API, so the stand-in fabricates that event's stand-in and lets `handleAmendmentRequest()` run to completion BEFORE any ticket is created — then creates the ticket already carrying the outcome and links it via `externalRef` (issue #17's trigger-source model, 00-FOUNDATION.md §2). The ordering is the point: on the real webhook path the ticket exists only to host the ZAF sidebar, never to be the thing being decided, so a ticket failure (or an over-scoped `POST /api/v2/tickets`) must never erase a decision that was already made. That is what the ordering test in `test/remoteui.test.js` (a deliberately throwing Zendesk client) actually verifies.
- **The three-role authorization matrix (issue #34) is grounded in what UC-06 already says about who does what, and each role's rule had to earn its place.** The customer admin requests amendments because that IS the use case's trigger (UC-06.md §1/§2); the employee consents to their own contract and the employer consents on the company's behalf because UC-06's research (`UC-06 ChatGpt v1` §6, `awaiting_employee_signature`/`awaiting_employer_signature`) models the employee/employer as the two signature parties, and v1's §5 explicitly restricts *requesting* to the company owner/super admins. The roles are a server-side session, never a body claim, so the submission surface "employee, employer, company-admin" is not a shared form wearing a role dropdown — each role genuinely cannot do the others' acts, and the refusals carry the reason. Two rules got rejected before landing: making the employer a second requester (contradicts v1's restriction and would have made the role a no-op) and giving the admin a consent path (the admin's UC-06 control point is dual approval in the sidebar, §8 — a signature there would blur two different control layers). Consent is recorded through the real surfaces the repo has (durable audit row first, then a best-effort Zendesk internal note) and is honestly documented as a stand-in for UC-06's signature stage, not a new gate in the approval pipeline — no `amendmentStore`/`workflow` change was needed or made.
- **`npm run walkthrough` (`scripts/walkthrough.mjs`, `docs/WALKTHROUGH.md`) exists because `npm test`'s hermeticity is exactly what let a real integration bug hide for two sessions.** Every UC-09 unit/workflow test injects its own fake `remote.getCountrySchema()` — reasonably, to stay offline — but the fake in `test/uc09.test.js` returns `{required: ["employment_id", "type", "amount", "currency"]}`, fields chosen to match what an incentive payload actually needs. The REAL mock server's `getCountrySchema()` answers a different question — UC-06's `employment_basic_information` schema (`{required: ["job_title", "weekly_hours"]}`) — and `src/uc09/workflow.js` was handing that straight to the incentive-payload validator, unchanged, copy-pasted from the UC-06 pattern without adapting it to a fundamentally different Remote write. Every seeded UC-09 adjustment escalated with `schema_invalid`/`approvalSlotsRequired: 0` when actually run over real HTTP against the real mock — 628 green tests never caught it because none of them exercised the real fixture's shape. Fixed by giving UC-09 its own fixed, code-defined `INCENTIVE_REQUIRED_FIELDS` (`policyEngine.js`) instead of fetching and reusing a schema meant for a different Remote object — `remote.getCountrySchema()` had no other use in `workflow.js`, so the call was removed outright rather than kept and ignored. This is the same shape of bug the n8n gotchas section (§6 of `CLAUDE.md`) already warns about for a different reason: a fully green automated signal (here, `npm test`; there, a pinned n8n execution) is not evidence an integration actually works — only exercising the real thing is. A `src/uc09/cli.js` fix already in flight this session (`co_adjust_01` → `co_amend_01`, a company_id typo also found via this same walkthrough) was necessary but not sufficient on its own — identity verified correctly after that fix, but every request still escalated on this second, independent bug until both landed.

- **Ports became a registry (`src/shared/ports.js`) because three separate bugs were the same bug.** Each UC API process binds *two* sockets: its documented API port, and an undocumented mock-Remote server it seeds from and then keeps alive for the life of the process. That second port appears in no README, no URL and no UI, so every file picked its own and carried a comment asserting it was "distinct from every other mock-server port already in use." Every one of those comments was sincere, and every one had been checked only against the other *mock* ports: uc02's seed mock sat on `4051` — UC-03's public API port — and uc03's sat on `4052`, UC-04's. uc04's and uc05's were both `4028`. So following `npm run dashboard`'s own instruction to start all nine killed two of the nine sections it then reported as "could not reach", and *which* two depended on start order, which made it look nondeterministic. `test/audit.test.js:272` records the same class of collision in the suite itself (`4016`, under `node --test`'s parallel execution). The fix is not better comments — a comment asserting global uniqueness cannot be checked by anything, which is precisely why three of them were wrong. One frozen registry, a reserved `4070–4089` band for internal mocks that no test may enter, and `test/ports.test.js` proving uniqueness, band membership, and that no CLI hard-codes a port literal at all. API port *values* were deliberately left unchanged, since they appear in the README, the demo script, the ZAF manifest defaults and the dashboard's client-side fetches; only the invisible mock ports moved. Found by running all nine at once rather than by reading — the same lesson `npm run walkthrough` above was built to institutionalise.

- **A red n8n execution turned out to be proof, not failure — and the docs had been understating the project by three use cases because nobody opened one.** For weeks every document here said "only UC-01 has a real unpinned execution proving a write lands." That claim came from reading the executions *list*, where UC-03/`404`, UC-04/`408` and UC-05/`409` all show `status: error`. Opening them tells a completely different story. UC-04's run fetched Alexandre Tremblay's real record from the live Remote Sandbox (880ms), inserted a real `uc04_authorizations` row (`bb105479…`), inserted a real `audit_log` row (`a4f93179…`), routed correctly on `blocked` — and *then* failed, at the Zendesk node, with `400 — id must be an integer`, because the test had passed `prod-proof-uc04-20260810b` where Zendesk wants a numeric ticket id. UC-05's is stronger still: `pinData: {}`, nothing pinned anywhere. Every failure sits **downstream of the audit write**, which is precisely the ordering this architecture was rebuilt around (see the audit-before-Zendesk entry above) — so the red cross is the design working. The lesson generalises past this repo: the gotchas section already warns that a *green* pinned run is not evidence, and this is the same error wearing the opposite colour. **The run status is not the verdict in either direction; the destination is.** Four of nine are now honestly provable (UC-01, 03, 04, 05); UC-02, 06, 07, 08, 09 are not, and no workflow has yet been driven by a real inbound Zendesk ticket.
- **The Zendesk node takes `externalRef` as the ticket id with no guard, and that is a real robustness bug, not just a test artifact.** It is what killed all four executions above. Zendesk's `tickets/update` requires an integer, and two of this repo's own surfaces — the request portal and the Remote UI stand-in — legitimately generate descriptive references rather than numeric ticket ids. Any request originating from them therefore records its decision correctly and then `400`s on the customer-facing step. The audit trail survives (by design), but the loop never closes. Not yet fixed: the fix is a guard that skips or routes the Zendesk step when the reference is not numeric, rather than attempting a call that cannot succeed.
- **Exactly-once in the n8n graphs is a database constraint, not a Code node — and the duplicate branch is silent on purpose.** Two designs were available for §3.24's claim node: a Code node that reads `workflow_claims` and decides, or a single INSERT adjudicated by the table's `PRIMARY KEY (use_case, external_ref)`. The first is the more natural thing to write in n8n and is wrong: the gap between its read and its write is exactly the race that gave Zendesk ticket #5 two `audit_log` rows 30µs apart and posted a second verification letter to the customer. A duplicate delivery is not an exceptional event to be detected — a webhook is an at-least-once channel by definition — so the guard has to hold under concurrency, which application logic cannot do and a unique key already does. The second decision follows from the same premise: because redelivery is *normal traffic*, the conflict branch ends at a NoOp and the run finishes green having written nothing. Routing it to an error would page a human every time Zendesk behaved correctly, and an alert channel that cries wolf is worse than none. The claim node's own placement carries a third judgement — after the gates (re-deciding is free and leaves no trace; a duplicate stopped earlier never records why) and before the first durable write (everything past that point is a record or an outward act) — and its key includes the use case because UC-03 legitimately routes a ticket on to UC-04, and a ledger that silently swallowed that handoff would trade a visible duplicate for an invisible dropped request.

- **An absent employment record is `null`, not a partially-filled object — the fix for the identity bugs went at the construction site, not the comparison (§3.26).** Four gates could report `verified: true` having proved nothing, two by falling back to the caller's own `request.employmentId` as the "authoritative" record id, two by comparing `session.companyId` against a `company_id` that defaulted to `null`. The obvious fix is to harden each comparison (`a && b && a === b`). It was rejected: the misleading object still exists for every other reader, and the next gate someone adds will not carry the guard. Building `employment = null` instead removes the *precondition* for the entire bug class, and it makes the n8n port model absence exactly the way `RemoteClient.getEmployment()` already does on a 404 — so the two execution paths now agree about what "no record" looks like, which is the thing that diverged in the first place. Same reasoning as UC-08 taking no write-capable client at all rather than refusing to call one.
- **A 404 and a 403 are recorded as different things, because one is information and the other is its absence (§3.27).** Collapsing every failed upstream read into "the gates escalated" was not merely imprecise — a 404 is an authoritative answer *about the record* (fix the id), while a 403/5xx/transport error means the request was **never evaluated**, so any recorded reason about the employee is fabricated. They also demand different humans: one is a data problem, the other an integration outage. The reasons are distinct exact strings rather than a boolean flag because `rankExceptionReasons()` counts by string and `docs/METRICS.md` puts the top exception reason forward as the next thing to engineer — which only works if the reason names the thing to engineer. The whole module is fail-closed *by construction* rather than by policy: every verdict it can produce is an `escalate`, and it is consulted only at gates already refusing, so no bug in it can manufacture an approval. That property is asserted by test against three real policy engines, not argued for in a comment.
- **A country row that offers only an alpha-3 code is dropped, not converted (§3.28).** UC-03's gate compared 2-letter destinations against a list built from `code`, which is alpha-3 (`ESP`), so a successful 224-row fetch produced an empty list and the use case could never auto-resolve. The tempting fix — `?? row.code` — reproduces the defect one level down: `"ESP"` enters the set and compares false against `"ES"` forever, while *looking* fixed. Converting properly needs a 249-entry alpha-3→alpha-2 table, and this repo does not invent API data (the same rule that kept UC-08's treaty corpus honest). So `code` is consulted last and accepted only when it already matches `/^[A-Z]{2}$/`, and an unplaceable row is dropped: "a code we cannot compare" honestly means "not confirmed supported", which on a 🟢 auto-reply-and-solve path must escalate. The cost is explicit and small; the alternative was a silent, permanent false comparison.
- **Every fail-closed decision path needs at least one POSITIVE test, and this is now a rule rather than an observation (§3.28).** Assertions of the form "this must not auto-resolve" pass identically against a correctly cautious gate and against a gate that is structurally incapable of ever passing. UC-03 sat in the second state for the whole life of the node with a fully green suite, and two of this session's other three defects hid the same way. The only instrument that separates them is a test asserting that a specific known-good input **must** succeed. This generalises beyond this repo: in any system designed to fail closed, the safety property itself is what conceals a broken path, so the test that detects the breakage cannot be a safety test.
- **A request with no external reference is claimed under a synthetic key, not waved past the ledger (§3.25).** Both key columns are `NOT NULL`, so a bare `{{ $json.externalRef }}` inserted null, failed the key, took the claim node's error output and vanished at the NoOp — a green run that wrote nothing and dropped a real request, which is strictly worse than the duplicate the ledger exists to prevent. Skipping the claim when the ref is absent was rejected: it opens a path into the durable writes that no ledger covers, and "sometimes we claim" is not a guarantee. `unreferenced:<execution id>` is always claimable, which is the correct semantics — a request carrying no reference cannot be a duplicate *delivery* of anything, because a second delivery would carry nothing identifying it as the same request. The Node path (`src/shared/workflowClaims.js`) had this right from the start, pinned by a test named "an absent ref is processed, never dropped"; the graphs disagreed with their own reference implementation, in a **node parameter expression** — configuration, not code, and therefore the one place the parity tests structurally cannot reach.
- **The ops alert writes its row BEFORE it pushes a notification, and the push is allowed to fail (§3.29).** A chat message can be swiped away, cannot be counted and cannot feed a dashboard, so the `ops_alerts` row is the alert and the push is a convenience. Pushing first would let a Telegram outage erase the record of a payroll-adjacent failure — the same mistake the audit-ordering bug already cost this project once. The row's `audit_durable` column carries the triage order in one boolean: a failure with the decision already durable is the architecture working as designed and can wait, while `audit_durable: false` means a decision was made and never recorded, which is the only genuinely urgent failure this system produces.
- **Test rows were purged from the operational tables and deliberately NOT from `audit_log` (§3.29).** 29 rows from this session's live drives were deleted from `workflow_claims`, `uc04_authorizations`, `uc05_resignations` and `uc07_dossiers`, because those tables are current state and rows describing requests that were never real corrupt any count taken from them. `audit_log` was left intact. Deleting from an append-only audit log is exactly what an auditable system must not do, and "they were only test rows" is precisely the reasoning that would be reached for the first time someone wanted a *real* row gone. The `cases`-vs-`audit_log` distinction this project has documented since `00-FOUNDATION.md` §4 is only worth anything if it survives an occasion where breaking it would have been tidier. The visible consequence — `audit_log` holding rows for claims that no longer exist — is correct: history does not shrink because the current state did.

---

## 5. Roadmap — what's left, and the honest blockers

> **For submission specifically, see `docs/SUBMISSION-CHECKLIST.md`** — it
> separates human-only steps from what is still owed in code. This section is
> the fuller engineering roadmap behind it.

Ordered roughly by "buildable now without new external access" → "needs a decision or credentials only the project owner can provide":

### Standing issues found 2026-08-17 — recorded rather than patched in place (**all six now closed**, as of 2026-08-19)

These surfaced while fixing §3.26–§3.28 and were deliberately left alone at the
time: each one either changes a shared contract or answers a product question,
and smuggling that into an unrelated fix is how the contradictions in this
file's own history got made.

**All six are now closed, most of them within hours, by separate units of
work** — recorded here rather than deleted, because the list is more useful as a
record of what each one turned out to *be* than as a to-do that quietly emptied.
Two of the six turned out not to be the thing they were filed as: #1 was an
endpoint problem filed as a credentials problem, and #2's premise was simply
wrong. That is a better hit rate for *re-reading a finding* than for *fixing*
one, and it is an argument for writing findings down in this shape rather than
opening tickets against them straight away.

1. ~~**UC-02 cannot validate an expense category live.**~~ **CLOSED
   2026-08-19, and "needs a token with the right role" was the wrong work
   order** — which is the part worth keeping. `/v1/employee/expense-categories`
   is the **employee-session** endpoint; no company token opens it, so no
   credentials decision could ever have fixed this and it sat here as a blocked
   item waiting for a human with admin access. The company-side route is
   `/v1/expenses/categories`, and it needs a discriminator. Verified live in
   both directions, same token, same shell:

   ```
   GET /v1/employee/expense-categories          -> 403 "Forbidden, invalid role for this endpoint"
   GET /v1/expenses/categories?country_code=NLD -> 200, 36 rows
   ```

   `src/remote/restClient.js` routes to the working endpoint and carries its own
   probe table (36/33/32/32 rows for NLD/PRT/CAN/USA). **The diagnosis is the
   lesson.** A 403 whose text says *"invalid role"* names the credential as the
   cause, so it was filed as a credentials problem; it was an endpoint problem
   the whole time — the same shape as the proxy-403 gotcha in `CLAUDE.md` §6, an
   error whose own words point at the wrong layer. Note also that `country_code`
   here wants **alpha-3**: the alpha-2 form returns `422
   {"country_code":["is invalid"]}`, a different failure string from the
   form-schema endpoint's `404 "Country not found"` for the same underlying
   mistake. No two alpha-3 failures in this API look alike, which is why each has
   had to be found separately. `CLAUDE.md` §7 recorded this closure on
   2026-08-19 while this line still called it open.
2. ~~The supported-countries gate is near-vacuous.~~ **CLOSED — the premise was
   wrong, overturned by research against primary sources**
   (`docs/research/COUNTRY-SUPPORT-SEMANTICS.md`, commit `5b8a109`). Diffing the
   live 224 rows against ISO 3166-1 shows **26 codes absent**, and they are
   sanctions-shaped (`AF`, `BY`, `CU`, `IQ`, `IR`, `KP`, `MM`, `RU`, `SY`, `VE`,
   plus disputed and uninhabited territories). Remote's own `llms.txt` — already
   in this repo — states the rule verbatim: *"The countries present in the list
   are the ones where creating a company is allowed."* So membership is a real
   KYB screen sourced from Remote's registry, and it **outperforms** this repo's
   hand-written eight-entry `SANCTIONED_OR_RESTRICTED` list, whose exclusions it
   is a strict superset of among sovereign states. Recommendation adopted: keep
   membership, and **do not** switch to `eor_onboarding: true`, which answers a
   different question ("can Remote employ someone here") from the one UC-03 asks
   ("may an already-employed person visit here") — gating on it would refuse a
   French employee travelling to Martinique, which is domestic travel.
3. ~~`normalizeEmployment()` carries the same latent alpha-3 fallback.~~
   **CLOSED (`8dae81e`)** — it now shape-checks candidates before accepting
   them, so a 3-letter code is never placed in a field only ever compared
   against 2-letter values; unusable becomes `null`, matching UC-03's drop
   decision (§3.28). Each consuming gate was then checked to fail closed on
   `null`: UC-05 `unsupported_country`, UC-06 `country_schema_unavailable`,
   UC-09's approval floor staying at 2. **The claim that UC-09's third approver
   had never fired against a real record was an OVERSTATEMENT, corrected here
   because it was published before it was verified.** Executions `4345`
   (unfixed graph) and `4349` (fixed) both returned three slots for a real
   German employment: the old chain tried a flat `country_code` first, absent on
   real employment records, so `alpha_2_code` already won. The defect is latent
   — it needs `alpha_2_code` missing, or a flat alpha-3 `country_code` reaching
   the record, which this API does emit on sibling objects. Still worth fixing,
   and fixed with a positive test; but "a money control that had never fired"
   was not true, and the difference between latent and live is exactly the kind
   of thing this file exists to keep honest.
4. ~~`src/remote/mockServer.js` teaches a shape the real API does not use.~~
   **CLOSED (`8dae81e`)** — the mock now serves the real `/v1/countries` shape
   (array directly under `data`, alpha-3 in `code`, `alpha_2_code` alongside, no
   `country_code` field at all). Four non-EOR rows were added deliberately so
   that "in the list" and "`eor_onboarding: true`" stop being observationally
   identical offline. Making the fixture faithful **broke three tests, all real
   findings** — including one named *"normalizeEmployment falls back to the
   3-letter code when alpha_2_code is absent"*, which had pinned the defect as
   intended behaviour and passed for its entire life. A fourth test did *not*
   break and mattered more: a `Set` built from `c.country_code` would have filled
   with `undefined` and passed vacuously — the same failure mode relocated into
   the test written to catch it.
5. ~~`RemoteClient.listPayrollRuns()` coerces its own 404 into
   `{payroll_runs: []}`.~~ **CLOSED** — an unreachable payroll calendar is now
   distinguishable from a genuinely empty one, so UC-06's gate is reachable from
   the Node path for the first time and reports `upstream_record_not_found`
   instead of the misleading `no_matching_payroll_cycle`. **Attribution
   corrected 2026-08-19:** this line credited `8dae81e`, which never touched
   `restClient.js`'s payroll code at all. The coercion was actually removed by
   **`cd445f0`** ("Call the payroll endpoint Remote actually has, and name the
   country"), and the reporting variant `listPayrollRunsResult()` was added
   later still, by **`5762af0`**. A commit hash in a status line is checkable in
   two seconds and is worth checking — this one was wrong for two days and read
   as authoritative precisely *because* it was specific.

   **All three of the above (3, 4, 5) independently re-verified against the live
   Sandbox 2026-08-19 (§3.39)** — not against the comments claiming them fixed,
   which is a different check and the one that had never been run. `GET
   /v1/countries` (224 rows, array directly under `data`, no `country_code` on
   any row), `GET /v1/employments/{id}` on four live ids (country nested only,
   no top-level `country_code`) and `GET /v1/payroll-runs` all match what the
   code and the mock now assume. `[CONFIRMED]`. That pass also found the **fourth
   instance of the same conflation, still live**: `listCountries()` turned its
   own 404 into `[]`, so UC-03 reported `destination_jurisdiction_excluded` — a
   claim about a destination it had never checked — for any failed registry
   read. Fixed the same way (null vs `[]`, recorded as an upstream failure); the
   n8n port still has it and now diverges from the Node path. See §3.39.
6. ~~`audit_trace` has no rows from n8n.~~ **CLOSED — verified 2026-08-18 by
   reading the table.** `audit_trace` now holds **71 rows**, and 22 of them are
   `call = "n8n.run"`, which only the graphs write; every row carries a
   `parent_id`, so the two-level shape (§3.21) holds rather than the trace
   floating free of its decision. All nine live graphs carry the collector pair
   (`Collect Trace Steps` → `Append Audit Trace`), confirmed in the same read-back
   that checked their claim nodes. The per-attempt breakdown is real: e.g.
   `remote.employment` 17 attempts, `remote.expense_categories` 6,
   `openai.classify_expense` 6 — which is exactly the "was that one 403 or forty"
   question the decision-level summary could not answer.

Also from §3.24, **restated 2026-08-18**: the claim mechanism is verified live
on all nine graphs (`verify-claims`: 9/9, 0 defective), and every doubly-driven
`claim-proof-*` reference has exactly one `audit_log` row. What is *not*
currently re-inspectable is the `workflow_claims` side for the references whose
rows were purged — the cheap restoration is to re-drive one use case twice under
a fresh reference and leave those rows in place. **UC-07 is the one whose
redelivery half was observed directly** (second delivery stopping at the NoOp);
for the others the redelivery half is inferred from the one-audit-row-per-ref
count plus the verified wiring, which is strong but is inference, not
observation.

**Recently closed:** out-of-scope chat guard (`out_of_scope` intent → polite refusal, no case created); playground/chat employee picker with all mock employees + custom ID inputs; specialist dashboard shows original ticket text, requester, classification source, and attachment/URL flags; auto-advance to next case after approve/deny; Remote.com-styled HTML letter with letterhead, signature block, job title, and purpose line.

1. **Metrics baseline + cost model** — the metrics layer (`src/metrics/`, `docs/METRICS.md`) is built, but two gaps are named in that doc: there is no manual-handling baseline to compare against (needs real CX data, and inventing one would be worse than leaving the gap visible), and LLM spend per resolved case is computable from the audit log but not yet wired in.
2. ~~**Retry/backoff on Remote API calls**~~ **DONE** — `withRetry()`
   (`src/shared/retry.js`) is wired into both REST clients as well as the three
   LLM call sites, per `00-FOUNDATION.md` §4 invariant 10: 3 attempts with
   backoff, and a definite answer (a 404) returned rather than retried. Closed
   issue #19; §1's own row already said so while this line still called it open.
3. ~~**§12.7 fix** — when a request asks for a field outside the standard whitelist (e.g. salary), route to `human_review` with an explicit "over-scope disclosure requested" flag, instead of silently redacting and auto-resolving.~~ **Done.** The classifier now extracts `requestedFields`; the policy engine routes any over-scope field to `human_review` with flag `over_scope_disclosure_requested`.
4. **Entity extraction + case summarization + CX recommendation text** — extends the existing OpenAI classifier call (or a second call) to also return a specialist-facing summary; feeds `review_queue.notes`. (Partial: `requestedFields` extraction is done; prose summary is not.)
5. **PDF rendering** — HTML → PDF (e.g. a headless-browser-based renderer). No new external account needed, but a new dependency.
6. **URL pipeline** — fetch + read the linked page, extract what fields it appears to request. Needs a real (careful, scoped) outbound fetch — no new account, but new attack-surface considerations (SSRF, untrusted content) worth thinking through before building.
7. **File pipeline (attachments)** — text extraction is buildable now (no OCR needed for text-based PDFs); real OCR for scanned images and virus scanning both realistically need a third-party service/library — worth a explicit decision on which, rather than guessing.
8. **Custom-letter draft workflow (§15)** — AI drafts non-standard letter text; human reviews/approves before send. Buildable now.
9. **n8n workflow (real) — DONE and ACTIVE.** Built via the n8n Workflow SDK on the live instance, credentials attached, activated. See §3.8 and the decision log for how it got there.
10. **Zendesk outbound — DONE, credentials configured, read+write+create live-verified, wired into `npm run live`.** Inbound ingestion is now built (webhook + trigger, `scripts/setup-zendesk-trigger.mjs`), narrowly scoped to test-tagged tickets — no publicly-reachable-URL decision was actually needed, since the n8n instance itself already has one. **Now confirmed live**: Zendesk ticket **#6** (2026-08-15) went from a customer comment to a solved, tagged ticket with a real `audit_log` row in about five seconds, with nothing pinned — the tag-guard trigger fires. UC-01 is the only one of the nine driven this way; the other eight have been driven by webhook POSTs, not by inbound tickets.
    - Widening the trigger beyond test-tagged tickets to all qualifying ones is a deliberate later step, not yet done.
11. **Sidebar / ZAF app — BUILT** (`zaf-app/`, `src/review/`, `npm run review-api`). Approve/deny works end to end and writes to `audit_log`. Two things remain, neither buildable from a coding session alone:
    - ~~**Verify a ZAF-signed identity token** instead of trusting the `X-ZAF-Approver` header. This is the one thing standing between the current app and a deployable one, and it is a real piece of work (ZAF JWT verification against the app's shared secret), not a config change. Until it exists, `ZAF_REQUIRE_SIGNED_IDENTITY=true` fails closed.~~ **DONE — and this entry was stale in the direction that matters, so it is struck rather than deleted (2026-08-29).** `src/review/zafAuth.js` verifies the token (HS256, which is the only algorithm ZAF signs a client-side app's token with) and `src/shared/approverAuth.js` is the shared mechanism all five approving services use, with `signedIdentityRequired()` deriving the requirement from the posture instead of a flag. `ZAF_REQUIRE_SIGNED_IDENTITY=true` is now an override, not the only safe setting. Verified on the deployment rather than in the source: `/__cx/health` reports `signedIdentityRequired: true`, `zafVerifierBuilt: true`, `zafSharedSecretConfigured: true` (2026-08-29). Note the residual: `zafPublicKeyConfigured: false`, which is the RS256/server-side-app path that this repo does not ship and does not need.
    - **Install it into the live Zendesk account** (`zcli apps:package zaf-app` → upload) and point `apiBaseUrl` at a reachable review API. Blocked on the same publicly-reachable-URL decision as #10.
12. **UC-06 (Contract Amendment / Payroll Cutoff) — core logic + HTTP API + real Supabase persistence + ZAF panel + n8n workflow DONE** (`src/uc06/*.js`, `npm run uc06-api`, real `uc06_amendments` table, `zaf-app/assets/panels.js`'s `"UC-06"` entry with its own dual-role `renderActions`, n8n workflow `WORKFLOW_UC06_ID`). Deterministic gates, dual-approval flow, a dedicated API surface, a browser UI that drives it, and a credentialed, dry-run-verified, parity-tested n8n graph — **ACTIVE as of 2026-08-10**, explicit user go-ahead given (`workflows/README.md`). Remaining:
    - A Zendesk trigger pointed at its webhook. (The workflow itself is already active and published — the stale "activate the workflow" line that used to sit here contradicted this same bullet's own ACTIVE note.)
    - The Slack "Urgent Cutoff Escalation" alert — the `urgent_cutoff` flag is computed and audited; nothing sends it anywhere yet.
    - A real trigger still doesn't exist. The Remote UI stand-in (`src/remoteui/`, `npm run remoteui`, §3.18) demonstrates the amendment flow from its TRUE starting point end to end, but until Remote exposes an amendment-request event/webhook surface, a production trigger has nothing real to attach to — issue #17's gap, honestly still open. The stand-in is the honest stand-in for that gap.
13. **UC-08 (Cross-Border Tax & Social Security Review) — core logic + real dossier persistence + read-only API + ZAF panel + n8n workflow + embedding-similarity treaty retriever DONE** (`src/uc08/*.js`, `npm run uc08-api`, real `uc08_dossiers` table, `zaf-app/assets/panels.js`'s `"UC-08"` entry, rows-only, no `renderActions`, n8n workflow `WORKFLOW_UC08_ID`). The 🔴 use case with no execution path, asserted by test both structurally and behaviorally — now true of the store, the API surface, AND the n8n graph too (one write method on the store, zero mutation methods; no POST route in the API at all; no Switch/IF node anywhere in the workflow — every execution ends at the same single Zendesk internal-note update). Treaty retrieval is embedding-similarity over the curated corpus's vectors (`uc08_treaty_citation_vectors` pgvector table), keyword fallback when unconfigured (issue #29). **ACTIVE as of 2026-08-10**, explicit user go-ahead given. Remaining:
    - A Zendesk trigger pointed at its webhook; the workflow itself is already active and published.
    - Provisioning the `uc08_treaty_citation_vectors` table and supplying an `embed` function — the retriever's code path is built and tested against fakes; the real table and embeddings client are human/credentials steps (schema in `docs/SETUP-CHECKLIST.md`).
    - Real Remote reads for presence periods, once the actual endpoint shape for "travel log" data is confirmed — currently structured input, honestly, rather than an invented fetch.
    - `/federal_taxes` schema verification against the real OpenAPI spec — irrelevant until a future pass actually calls it.

---

### 3.85 UC-07 decided — two rules kept by one mechanism, a client that removed the reads along with the writes, and the first pass to start on a checked foundation

**2026-08-21. Documentation only.** `git diff --stat` against `src/`, `test/`,
`workflows/`, `zaf-app/`, `package.json` and `scripts/` is **empty**. Eight
findings dispositioned (`DRIFT-032`…`DRIFT-035`, `DRIFT-070`…`DRIFT-073`), four
opened (`DRIFT-102`…`DRIFT-105`), five owner questions answered, and a 27-item
build queue written. **UC-09 is now the only use case with no decision pass.**

Register: **95 → 99 findings · 45 → 53 decided · 50 → 46 open.**

---

#### The precondition, and why it was worth imposing

UC-06's pass ended by writing `[A-15]` into its own build queue: **UC-07's
decision pass must not start** until one sentence in `docs/00-FOUNDATION.md` was
re-probed. That sentence names three endpoints as absent *in one breath* —
UC-05's resignation endpoint, UC-06's `automatable` pre-check, UC-07's atomic
country-transfer endpoint — and **two of the three had already turned out to
exist.** UC-05's entire §0 business case had been falsified because its pass
inherited the sentence instead of checking its own third of it.

Probed against `docs/REMOTE-API-INDEX.txt`, Remote's own `llms.txt`, 468 lines:
zero matches for `relocat`, `country transfer`, `country-transfer`,
`entity transfer`, `internal transfer`, `mobilit`. **UC-07's third holds.** It is
recorded as a **confirmation**, deliberately, for the reason
`CONTRADICTIONS.md` keeps its four `K-` entries: a register that only ever reports
faults teaches its reader to distrust everything equally.

**This is the first decision pass in the register to begin on a checked
foundation rather than an inherited one, and the sequencing worked.** It is now
the pattern for UC-08 and UC-09.

**One word had to be added even so, and it is the sharpest small finding of the
pass.** `docs/INTAKE-RESEARCH.md` §75 records that Remote's **product** has a
**Country Transfer Service** — *Employee profile → Country Transfer Service →
relocation form*, marked *"Structured form, employer-driven"* — with nothing in
`llms.txt` against it. So the true claim is **"no atomic country-transfer *API*"**.
Dropping the word `API` reads as *Remote cannot do this*, which is false, and is
the **identical over-reach** that made the other two-thirds of that sentence
wrong. The correction is not cosmetic: it changes what UC-07 is *for*. It does not
supply a missing capability; it compiles **the research a specialist does before
opening a form that already exists**.

That one row then decided two things on evidence rather than on preference — the
portal's status as primary intake, and the company admin as the default filer.

---

#### The finding the owner's question exposed, which no automated check could have

> *"When the specialist reaches a conclusion, what will they now do? Nothing?
> Should the demo not include an aftermath instead of saying no button at all,
> because the employee who filed is expecting feedback."*

Today: **nothing, permanently.** `uc07_dossiers` has no status column, so
`awaitingState()` returns `awaiting / reading` in perpetuity; combined with
DRIFT-041 (no expiry, no reminder anywhere in the system) a UC-07 dossier can
**never leave the waiting list by any means the system possesses.** The employee
receives one acknowledgement at submission and is never told anything again.

Underneath it:

> **"Nothing may be approved here" and "nobody may ever be told what happened"
> are two different rules. Only the first is the 🔴 invariant. They were being
> kept by the same mechanism, and that is why removing the second reads like
> weakening the first.**

`src/approvalqueue/stuck.js:43–48` is the **only** place in the entire repository
that already states the distinction, and states it exactly. Everywhere else the
two are welded together.

**Why nothing automated could have found this.** There is no defect to detect:
every structural assertion passes, every behavioural test passes, and the absence
is the *correct* behaviour for one of the two rules it satisfies. A test of the
gap would **pass**. It is the same shape as DRIFT-098 in the pass before —
`requester` never compared to either approver, invisible to a diff because nothing
was missing, invisible to the tests because the behaviour was permitted. **Two
consecutive passes have now found their sharpest item this way, from a plain
question about whether the described behaviour makes sense.**

**The resolution keeps the guarantee and closes the gap.** The specialist records
an **outcome**, never a decision — `dossier_read`, then one of
`proceeding_offline` / `not_proceeding` / `more_information_needed`, **none of
which executes anything in Remote**. It lives **on the ticket**, never on the
dossier record, because that store's *one write method, zero mutation methods*
property **is** the structural proof, and `markReviewed()` would delete the proof
in order to record that it worked. `none_by_design` is unchanged; no approve route
is added; the API still has no write verb of any kind.

**And it is the better demo.** The obvious challenge to a 🔴 use case is *"you
built something with no buttons — isn't that just an unfinished feature?"* The
answer becomes: **there is a button; it executes nothing. It closes the loop with
the human who asked.** That is the difference between a control and an omission,
made visible on screen.

---

#### The client that removed the reads along with the writes

UC-07 makes **zero Remote API calls, on any path, ever**.
`handleRelocationReview()` takes no `remote` parameter, and no file in `src/uc07/`
imports `RemoteClient`. This has been read for months as the 🔴 guarantee, and it
is — **and it is also DRIFT-032**, welded to it. `workflow.js`'s own header argues
the removal **for writes** and never addresses reads.

The consequence: every gate input is a fact the requester typed about their own
case. §7's *"same 4-dimension coverage/risk gate as UC-04, reusing UC-04's
maintained tables"* is four **checkboxes** — `destinationSupported`,
`taxTreatyNexusConfirmed`, `employerPresenceInDestination`,
`rightToWorkConfirmed` — and `src/uc07/` imports nothing from `src/uc04/`.

**The owner's instruction settled it in both halves:** *"one of the important
things for the job is the ability to use APIs, so if there is a way to leverage
Remote Sandbox and get the info we need, let's do that — also a fallback so the
demo won't fail live."*

**The decision is a façade, and that distinction is the whole thing.** Handing
`handleRelocationReview()` a `RemoteClient` re-opens the parameter the guarantee
is argued from, **and nothing fails when it does**: the structural test greps for
write-method *names*, and a client that merely *could* write names nothing. So the
built shape is a `ReadOnlyRemoteClient` of exactly six methods on which a write is
**unnameable** — the same reasoning that gave `dossierStore` one write method and
zero mutation methods rather than a store that declines to mutate. The test
extends before the façade ships: the method list is pinned exactly, and `src/uc07/`
is asserted never to import `RemoteClient`.

**The conflict check is where "one use case genuinely impacts another" is
literally true and currently invisible by construction.** A dossier compiled for
an employee who already has an offboarding submitted is **byte-identical** to one
for an employee who does not. Same defect as UC-08's *"273 presence days with
`jurisdictions: []`"*: an answer to a different question, printed in the same
shape, with the reader supplying the missing half from memory. It is also exactly
the scenario the transition-safety rule exists to prevent, arriving where that
rule cannot see it — `sourceExitPlanValidated` is a **checkbox**, and an
offboarding somebody else already submitted does not tick it.

**The API index made it cheaper and corrected the spec.** The real path is
`GET /v1/offboardings/employments/{employment_id}` (`offboarding:read`), which is
**better than the specified** `GET /offboardings` — a string that is not a
published path at all. Neither read exists in `src/`; the string `offboarding`
does not appear there at all, so **the mock must be built before a local test can
be written.**

---

#### DRIFT-104, found by checking a remedy's tooling rather than the code it fixes

Reading `scripts/capture-sandbox.mjs` to see what already existed turned up
something the pass was not looking for. The script is real, is **GET-only by
construction**, already captures the endpoints needed, and states its own purpose
exactly:

> *"This project's most expensive recurring defect is fixtures written to agree
> with the code and code written to agree with the fixtures, so neither is ever
> compared to Remote. Every one of the worst defects this repo has found passed
> the full test suite. The only cure is a capture."*

It writes to `.sandbox-cap`, and **`.gitignore:44` ignores it.** So the
repository's single stated cure for its own worst defect class **has never
produced a durable artifact** — it corrected the mock by hand in `58bad0a` and
left nothing behind — and there is **no fallback at all** if the Sandbox token
expires or the account is reseeded mid-demo. That has already half-happened: the
reseed that killed `fde4007b-…` invalidated every "known good employee" payload in
this repository's history.

**Checking a remedy's tooling is a source of findings distinct from reading the
code the remedy would fix**, and it had not been used before.

**The fallback is a rung 2 → rung 3 move**, so the substitution ladder's
constraints apply verbatim: committed captures with provenance headers carrying
the SHA-256 of the retrieved bytes; **loud** replay (`X-Sandbox-Replay`, a
`_replay` block, the date on the page); **a live value always wins**; GET-only on
both legs; and `source: "sandbox_live" | "sandbox_replay"` on the trace row, the
same discipline invariant 8 established for `"llm" | "rule_based_fallback"`.

**The loudness rule is not decoration.** A demo that silently falls back is
**worse** than one that fails, because nobody can tell afterwards which they
watched — and an unmarked replay converts a claim about API competence into an
unfalsifiable one. The claim becomes checkable in the same move: a reviewer can
ask *show me the call*, and the honest answer must be a real request with a real
`sandbox_live` trace row behind it.

---

#### The routing question, and the rule that came out of it

The owner: *"I don't think we need to route 03 to 07. But I don't just want to
push this under the bus — kindly explain how in reality UC-07 connects to UC-04 /
UC-03 and if it is something we should build, because now I feel one use case can
genuinely impact others here."*

`docs/use-cases/UC-07.md:91` specifies *"Ticket (routed from UC-03, or direct)"*.
`src/uc03/policyEngine.js:183`'s decision union is
`auto_resolve | human_review | escalate | route_to_uc04`, and "relocat" appears
nowhere in `src/uc03/` outside a comment. **The route is spec-only and has never
existed** — registered as **DRIFT-105**, distinct from DRIFT-011 (the misroute
that *does* happen) because the two need opposite remedies.

**Struck on merit.** UC-03 answers *"may I work from X for three weeks."* A
permanent relocation is not a longer workation — it is a different legal event.
A routing edge would let a 🟢 router's classifier open a 🔴 case on a keyword, and
UC-03's parser has already read `fr` inside *from* and published *"Source country:
DE"* for a request that said Portugal, on live ticket 18.

**Three real connections exist, and the only one that is control flow is the only
one not to build:** shared reference data (a module — UC-03's restricted set is
already *imported* by UC-04, and *"a jurisdiction property is not a use-case
property, and two copies drift"*); an evidential read (prior UC-04 workations bear
on PE and tax residency — read them, never be triggered by them); and the conflict
check.

> **Use cases connect through shared reference data, and through reads of each
> other's records — never by one deciding to invoke another.** A routing edge
> makes the caller's classifier the gate of the callee's tier, and a 🟢 classifier
> must never be able to open a 🔴 case.

`route_to_uc04` is the boundary case rather than a counter-example: UC-03 does not
invoke UC-04 — it records a normalized hand-off **event** and stops, and
`signoffPolicy.js` refuses to let anyone sign it, precisely because a 🟢 router
must not mint a 🟡 authorization by click. **What it hands over is a request, not
a decision.**

---

#### Two orderings a builder will get wrong, and one measurement that decides the plan

- **`R-1` before `R-6`.** Building the conflict gate against the full client "for
  now" re-opens the parameter the guarantee rests on, silently.
- **`R-16` before `R-14`.** The assertion that would catch a payload-shaped object
  on a 🔴 dossier must exist **before** the generator that could produce one. The
  invariant is currently satisfied **vacuously** — nothing may submit the
  paperwork because there is nothing to submit, which is not the same as something
  preventing submission.
- **`M-3`** — does any Sandbox employment carry an in-flight amendment or
  offboarding? If none does, a marked rung-4 fixture becomes load-bearing and its
  **positive test must lead**. `[A-10]`'s rule, restated: *a gate that cannot fire
  and a gate being careful are indistinguishable from outside.* This repository
  has paid for that shape three times — UC-03's alpha-3 comparison, UC-03's
  unnameable sanctions codes, UC-06's `automatable` pre-check — and **every one of
  them passed the full suite.**

---

#### What was deliberately NOT decided

**DRIFT-034's reframing was not generalised to UC-08**, which is the same tier
with the same absent Remote surface, and to which the argument appears to
transfer wholesale. Appearing to transfer is precisely the condition under which
this repository has been wrong before — three endpoints in one sentence, two of
them wrong. And there is a concrete reason it may not hold: UC-07's reframing
rests on `INTAKE-RESEARCH.md` §75 establishing that Remote's product *has* the
surface our portal stands in for. **No equivalent row has been established for
UC-08.** It is `H4` in `qa/HUMAN-DECISIONS-REQUIRED.md`, and its recommendation is
to check `INTAKE-RESEARCH.md` first — the same sequencing `[A-15]` imposed here.

Also open and named rather than guessed: whether the aftermath must reach the
requester by email (`H1`), the capture staleness horizon (`H2`), and whether
Zendesk remains a UC-07 intake at all (`H3`). **DRIFT-041 is explicitly not
closed**: a dossier can now leave the waiting list by being *acted on*, not by
growing *stale*, and those are different mechanisms.

**Files:** `qa/contracts/UC-07-acceptance.md` (1,080 → 2,555 lines) ·
`qa/SPEC-DRIFT-INDEX.md` · `qa/HUMAN-DECISIONS-REQUIRED.md` (new §H) ·
`docs/use-cases/UC-07.md` · `docs/00-FOUNDATION.md` · `docs/WHY-THIS-SHAPE.md` ·
`docs/FOR-CX-LEADERS.md` · `docs/RETRIEVAL.md` · `docs/APPROVAL-ROUTING.md` ·
`docs/APPROVAL-QUEUE.md` · `docs/ESCALATION-DESTINATIONS.md` ·
`docs/INTAKE-RESEARCH.md` · `docs/METRICS.md` · `docs/ARCHITECTURE.md` ·
`docs/GLOSSARY.md` · `docs/SETUP-CHECKLIST.md` · `docs/UI-AUDIENCES.md` ·
`docs/DEMO-COUNTRIES.md` · `docs/E2E-TEST-PLAN.md` · `workflows/README.md` ·
`README.md` · `CLAUDE.md` · this file.

---

### 3.86 UC-08 decided — a specification that named a data source that cannot work, a source that does that nobody read, and the second consecutive pass to find two rules kept by one mechanism

**Tenth decision pass. Documentation only — no file under `src/`, `test/`,
`workflows/`, `zaf-app/` or `scripts/` was changed, and no status row was
flipped.** Seven findings dispositioned (`DRIFT-036`…`DRIFT-039`,
`DRIFT-067`…`DRIFT-069`), four questions answered, four new findings opened
(`DRIFT-106`…`DRIFT-109`), two long-standing cross-UC findings **resolved**
(`DRIFT-011`, `DRIFT-021`), and the sixth build queue written — `T-1`…`T-28`,
behind a Step 0 of three measurements. **UC-09 is now the only use case with no
decision pass at all.**

Register: **99 → 103 findings, 53 → 62 decided, 46 → 41 open.**

---

#### The pass's method changed, and that is why its findings are different

Every previous pass compared the contract to `src/`. This one asked a question
none of them had: **what does Remote's API actually publish for the facts this
specification assumes?** Two answers came back, opposite to each other, and both
of them were wrong in the file.

**The source §5 names cannot produce the figure §5 asks for.** UC-08's workflow
has said *"compute historical physical-presence days (**time-off + workation
custom fields**)"* since the spec was written, and `UC-08.md` §3 carried it as
`[CONFIRMED — capability exists; specific endpoint shape not yet verified]`. Both
schemas were read this pass, from Remote's own OpenAPI:

- **`Timeoff`** — required properties `id, employment_id, status, start_date,
  end_date, timeoff_days, total_minutes, timeoff_type, leave_policy, timezone`.
  **There is no country property and no location property of any kind.**
  `timezone` is *"[TZ identifier](https://www.iana.org/time-zones)"* whose own
  example is **`Etc/UTC`** — a clock, and in that example not even a place; zones
  neither partition countries nor are partitioned by them. `TimeoffDay` is
  `{day, hours, minutes}`.
- **And the sign is wrong.** A workation is someone *working*. It produces **no
  time-off record at all**. Time off records when a person was not working; it
  never records where they were.
- **Custom fields** — `{custom_field_id, name, type, value}`. One value per field
  per employment, **no dates**. A trip history is not representable in it.

So **§13 task 4 — *"presence-day calculator (custom fields + time-off)"* — has
been a standing work order to build something impossible.** Opened as
**DRIFT-106**.

**And a source that does work exists, three lines away in the same `llms.txt`.**

```
GET /v1/travel-letter-requests       ?employment_id= &status= &page= &page_size=
GET /v1/work-authorization-requests  ?employment_id= &status= &page= &page_size=
```

`TravelLetterRequest` and `WorkAuthorizationRequest` both carry
`destination_country` (`$ref → Country`), `travel_date_start`, `travel_date_end`,
`status`, and `travel_address` / `work_location`. **Dated, located,
employer-approved** — rung 2 of the substitution ladder, for a figure the build
takes at rung 4. `src/remote/restClient.js:1597` already implements
`listWorkAuthorizations({employmentId, status})`; `src/remote/mockServer.js`
already serves both collections; `src/uc03/letterScope.js:20` already cites the
travel-letter reference by name. **Only UC-08 calls none of it.** Opened as
**DRIFT-107**.

**Why the search had never found it:** it had been looking for *time-off and
custom fields*, the names §5 supplied, rather than for *"which Remote object
records where somebody was, and when."* The right records were filed under a
different heading the whole time.

**The transferable form**, now `docs/WHY-THIS-SHAPE.md` §17: §13 of that file
already teaches that **a negative about someone else's API decays** — three
endpoints were declared absent in one sentence of `00-FOUNDATION.md` and two of
the three turned out to exist. **This is the positive form of the same defect.** A
*presence* was asserted — a data source — and never checked, and it does not
exist in usable form. Same failure to verify, opposite direction, and the rule
covers both.

**A third check, settled negatively.** §13 task 8 has required
`/v1/federal_taxes` be verified before use. **There is no GET.** What exists is
`PUT /v1/employments/{id}/federal-taxes` (v1 and v2) and
`PUT /v1/employee/federal-taxes` — W-4 submission, US Global Payroll,
post-enrollment. Note the hyphen; `federal_taxes` with an underscore is only a
*form name* on the country form-schema endpoint. **A negative is a result**, and
recording it stops the next pass re-running the check. **DRIFT-108.**

---

#### DRIFT-039 is the finding all three of those correct, and the correction has a shape worth keeping

DRIFT-039 said the presence count is arithmetic over self-declared records where
the spec specifies Remote's own data. It was **right about the gap** — the count
is self-declared, the provenance is unstated, and the window is caller-chosen —
and it **deferred to a source that cannot produce the figure**, because it took
§5's claim at face value exactly as every reader before it had.

**A finding can be correct about a gap and wrong about the remedy**, and only
checking the remedy's own source finds it. That is the second time in two passes
that reading a *remedy's* material rather than the code it would fix has produced
a finding — DRIFT-104 came from reading `scripts/capture-sandbox.mjs` before
designing UC-07's fallback, and finding that this repository's one stated cure for
fixtures-agreeing-with-code writes to a **gitignored** directory.

---

#### The cross-routing question, answered the same way as UC-07's and arrived at independently

The owner asked whether routing should be built from UC-03, UC-04 and UC-07 into
UC-08. **No edges. Reads.**

> *Use cases connect through shared reference data and through reads of each
> other's records, never by one invoking another.*

That rule came out of UC-07's pass a week earlier, from the opposite direction —
there it killed an inbound edge from UC-03. Here it answers three questions at
once, and the reason is the same: **a routing edge lets a 🟢 keyword classifier
open a 🔴 case on a phrase.**

But the instinct behind `DRIFT-011` and `DRIFT-021` was right, and the read form
delivers it without the coupling:

| Neighbour | What it causes to exist in Remote | The read that reaches it |
|---|---|---|
| **UC-03** | `TravelLetterRequest` — destination + dates | `GET /v1/travel-letter-requests?employment_id=` |
| **UC-04** | `WorkAuthorizationRequest` — the same, plus `work_location` | `GET /v1/work-authorization-requests?employment_id=` |
| **UC-07** | nothing — UC-07 makes zero Remote API calls (`R-2`) | none; the connection runs the other way, as a fact |

The read is **strictly better than the edge** on three counts: no edge to keep in
sync, it works for trips that went through neither use case, and it is Remote's
own system of record rather than a message one of our use cases chose to send.
**DRIFT-011 and DRIFT-021 are resolved, not deferred** — the first two
long-standing cross-UC findings any pass has closed.

**v1's Track F gate is refused on merit.** The build pack makes
`UC07_EXECUTION_ALLOWED = TRUE` conditional on `TAX_CLEARANCE = APPROVED`, *"to
avoid the dangerous scenario where the tax engine approves a move that is legally
impossible from an immigration perspective."* The safety intuition is sound and
the mechanism is not: that is a 🔴 use case issuing a determination that gates
another's execution, which is the judgement this tier exists to refuse. It
survives in tier-legal form — *"an unresolved tax question exists for this
employment"* is a **fact** UC-07's dossier carries and a specialist weighs. Now
invariant 24: **UC-08 may hand another use case a fact, never a verdict.**

---

#### Two rules kept by one mechanism, second consecutive pass

The owner's question was *"I thought it was the specialist that gets tax advice,
not the customer. When an employee makes a request, what do they get as an output
after the specialist has finished reviewing?"*

**Today: nothing.** And the object built to be that answer already exists and
reaches nobody. `dossier.customerFacingAcknowledgement` — the disclaimer §5 and §7
actually name — is composed in `buildDossier()`, disclaimed, and covered by three
tests. Grepped repository-wide, it is referenced by **no surface at all**: not the
portal, not the ZAF panel, and the n8n graph posts an internal note only. So §11's
**100% disclaimer coverage invariant is satisfied vacuously**, and
`audit.details.disclaimerApplied` is the hardcoded literal `true`
(`src/uc08/workflow.js:201`) — a field that exists to be trusted, *declaring*
rather than *reporting*. `src/uc03/workflow.js` derives the same field correctly.

**The answer is two artifacts for two readers.** The specialist gets the
**dossier** — citations, limbs, coverage, declared absences — and that does not
change. The employee gets the **outcome**, in their own words, carrying the
disclaimer. Neither reader gets the other's document.

**And the underlying defect is the one UC-07's pass named a week ago.** *Nothing
may be approved here* and *nobody may ever be told what happened* are two
different rules; only the first is 🔴's invariant; both were being kept by the
absence of a write path. The aftermath is adopted from UC-07's `R-24` **verbatim**
— `dossier_read`, then `proceeding_offline` / `not_proceeding` /
`more_information_needed`, **recorded on the ticket, never on the dossier record**
— so the two 🔴 use cases share one vocabulary rather than inventing two.

---

#### DRIFT-109: one missing surface blocks three separately-taken decisions

`src/portal/ticketing.js` derives `TICKETABLE_TYPES` from `NO_TICKET_DECISIONS`,
whose keys are `uc02, uc03, uc04, uc05, uc06, uc09`. **`uc07` and `uc08` are
absent.** The stated reason is sound — linking a ticket means writing an id back
onto the record, and these stores have one write method and zero mutations.

**The conclusion is one step too wide: raising a ticket and linking a ticket are
separable.** The id can travel one way, record → ticket, leaving the store's
surface and the structural test untouched.

Three decisions taken in this session collide with it at once — the aftermath, the
outside-the-record metric, and §12's *"the receiving human must not be left
unaware the case arrived."* **UC-07's `R-24` has the identical blocker.** `T-13`
builds it once, for both; building it twice would give one hand-off two
vocabularies.

**Why four review passes did not surface it:** a test of the gap would **pass**.
The invariant is satisfied. It is invisible to a diff (nothing is missing), to the
suite (nothing fails), to a reviewer auditing the 🔴 guarantee (it holds), and to
the metrics (the same absent status column disables them). It took a plain
question about what the requester receives.

---

#### The metric that cannot be computed, and the one line of it that must not be crossed

§11 names **dossier accept rate** as UC-08's bucket-2 metric, `≥60%` healthy,
`<30%` stop, *"specified, not yet computed — tracking issue #20."* Recording an
accept needs a status to flip on a record **whose defining property is that it has
none**: no POST route, no mutation method, `verbs: []`. Issue #20 frames a design
contradiction as backlog, and framing it that way hides it.

**Decided: measure outside the record, and measure completeness.** Once `T-13`'s
ticket exists, the outcome verbs *are* the accept signal — `proceeding_offline` /
`not_proceeding` is a specialist who used the dossier, `more_information_needed`
is one who could not — plus Zendesk reopen rate and escalation → first specialist
comment, all of which touch `uc08_dossiers` not at all. And the distribution of
`openQuestions` codes and priorities is **already computed on every read**: a
real, tier-legal iteration signal that is free today.

**What must not happen is adding a status column to make the metric computable.**
That trades the strongest safety argument in the system for a number.

This one is weighted above its finding number because the role this repository is
a portfolio for names *"define success metrics, track them, and use them to decide
what to iterate on and what to stop"* as its first and scarcest criterion — and
UC-08 is the use case with the best safety argument and **no measurement of
whether it is any good.**

---

#### `H4` answered NO, from the check `H4` itself named

UC-07's pass left `H4` open: *does the portal-primary decision apply to UC-08 as
well?* It named the check — *"check `INTAKE-RESEARCH.md` for a UC-08 row first"* —
and the row exists, at §2:

> *"**Cross-border tax question** (UC-08) | No request object exists → a support
> conversation | Free text | ❌"*

UC-07's decision rested on Remote's **product** having a Country Transfer Service
that our portal stands in for. **UC-08 has no such surface** — there is no Remote
object for a tax question at all — so the ticket genuinely **is** the request, and
Zendesk here is not a stand-in but the real channel. Of the four contracts
subtitled *"Zendesk-native"*, defined as *"the ticket **is** the request"*, **only
UC-08 earns it**, which `qa/SPEC-DRIFT-INDEX.md`'s second-pass box had established
and nothing had picked up.

**Same tier, same absent approval surface, opposite answer.** That is exactly why
it was left open rather than settled by analogy last week. *"It obviously
transfers"* is the reasoning that put three endpoints into one sentence of
`00-FOUNDATION.md` and got two of the three wrong.

---

#### The build queue, and the four orderings that are expensive to get wrong

**`T-1`…`T-28`, the sixth queue.** Eight schemes now, none corresponding — `G-1…4`
(UC-01), `G-A…C` (UC-03), `E-1…3` (UC-02), `W-1…10` (UC-04), `N-1…18` (UC-05),
`A-1…32` (UC-06), `R-1…27` (UC-07), `T-1…28` (UC-08). `CLAUDE.md` §7 item 20 is
the evidence for why.

**Step 0 is three measurements**, two of which can change the plan. `M-1`: do the
two travel collections hold **any** rows? Both answered **`200` with
`total_count: 0`** at last capture, so the read can ship correct, honest and
returning nothing — *a gate that cannot fire and a gate being careful are
indistinguishable from outside*, third instance after UC-03's dead gates and
UC-06's `A-10`. `M-2`: what does `GET /v1/timeoff` actually return? `M-3`: does any
Sandbox employment carry travel dates at all?

1. **`T-13` before `T-14`/`T-15`/`T-16`** — no ticket, nowhere for an outcome to
   land.
2. **`T-1` before `T-2`** — the façade before the read, UC-07's `R-1` before `R-6`
   for the same reason. §16 item 15 is the only test that can tell a façade from a
   client used carefully.
3. **`T-23`/`T-24` before `T-2`** — a **prerequisite inversion**. Reading another
   person's travel history on an unverified id is a materially different exposure
   from labelling a dossier with one, and the identity work has always looked like
   a follow-up.
4. **`T-4`'s fixture before `T-2`'s gate, if `M-1` returns zero** — and **§16 item
   11, the positive test, leads.**

---

#### Files changed

`qa/contracts/UC-08-acceptance.md` (1,041 → ~2,230 lines: a new §0 Decisions
section, edits to §§3–16, seven DISPOSITION blocks, §17b, §18) ·
`qa/SPEC-DRIFT-INDEX.md` · `qa/HUMAN-DECISIONS-REQUIRED.md` (new §I; `E15` and
`H4` answered) · `docs/use-cases/UC-08.md` · `docs/WHY-THIS-SHAPE.md` (new §17) ·
`docs/FOR-CX-LEADERS.md` · `docs/00-FOUNDATION.md` · `docs/RETRIEVAL.md` ·
`docs/APPROVAL-ROUTING.md` · `docs/APPROVAL-QUEUE.md` ·
`docs/ESCALATION-DESTINATIONS.md` · `docs/INTAKE-RESEARCH.md` ·
`docs/METRICS.md` · `docs/ARCHITECTURE.md` · `docs/GLOSSARY.md` ·
`docs/SETUP-CHECKLIST.md` · `docs/UI-AUDIENCES.md` · `docs/DEMO-COUNTRIES.md` ·
`docs/E2E-TEST-PLAN.md` · `docs/START-HERE.md` · `docs/KNOWLEDGE-SOURCES.md` ·
`workflows/README.md` · `README.md` · `CLAUDE.md` · this file.

---

### 3.87 UC-09 decided — three of the specification's own claims reversed by the vendor's documentation, and the first time this register caught one of its own passes publishing a false claim

**The ninth and last decision pass. Every use case is now decided.** Six findings
dispositioned (`DRIFT-049`…`DRIFT-054`), **eight opened**
(`DRIFT-110`…`DRIFT-117`, the largest single-pass block), and a build queue of
thirty-four changes behind three measurements:
`qa/contracts/UC-09-acceptance.md` §0, §17/§17b, §18. **No code, no test and no
workflow body was changed.** The contract went 824 → 2,031 lines.

#### What the method produced this time

The UC-08 pass stopped comparing the contract to `src/` and asked instead what
Remote's API actually publishes for the facts a specification assumes. This pass
asked that of a use case that **moves real money**, and three answers came back
**inverted** rather than merely corrected.

**1. `pending` is not an approval state, and that alone settles DRIFT-051.**
`UC-09.md` §2 has described the trigger as *"an off-cycle adjustment is drafted in
Remote's own product … the automation runs its gates against that drafted
incentive"*, with §5 looking for *"whichever write Remote's API uses to move the
already-drafted incentive out of pending status `[INFERRED]`"*. Remote's own
lifecycle guide: *"When the incentive is created and it is not yet associated to a
payroll cycle, its status is `pending`"*, and *"incentives are paid out through
payroll on the next applicable cycle after the effective date."*

**A `pending` incentive is already going to be paid.** There is no approval state
anywhere in the lifecycle and no write to move one out of `pending` — that
transition is driven by cycle association. So the endpoint §5 went looking for
does not exist, **not because Remote's incentive surface is thin, but because the
state it was supposed to transition out of is not the state the spec thought it
was.** Creation is the authorisation; the implementation has been right the whole
time. And the danger the finding named is sharper than it knew: implementing §2 on
top of today's execution step would produce **two payments**, the admin's
already-scheduled draft and our create.

**2. The webhooks exist, and they are worth more than the intake they were
sought for.** DRIFT-051 rated itself MEDIUM because it could not verify whether an
incentive webhook exists, citing `docs/INTAKE-RESEARCH.md`, which *"names none for
incentives"*. **Five exist** — `incentive.created`, `.updated`, `.paid`,
`.processing_started`, `.deleted` — plus `GET`, `PATCH` and `DELETE` on
`/v1/incentives/{id}`. That sentence is a false negative about a third party's API,
written into our own research and propagated into another file's confidence rating
(DRIFT-117).

They are still not an intake, per (1). **They are a bypass detector**, which is the
more valuable thing: an admin who creates an incentive directly in Remote's product
moves money with **zero** signatures, and nothing in this system can currently see
it. Reconciled against `uc09_adjustments`, `incentive.created` answers *"which
disbursements have no signature behind them?"* — DRIFT-054's integrity invariant
measured in the running system rather than asserted by tests over the policy
engine. `[P-28]`…`[P-30]`.

**3. Three named controls, three different destinations, and only one is "build it
as written."** DRIFT-049 correctly reported that three of the four deterministic
controls §7 names are absent. Each resolves differently:

- **Manager authorization — build, at a path the spec does not name.**
  `GET /v1/companies/{id}/managers`, tagged `[CONFIRMED]`, **is not published**.
  The real surface is `GET /v1/company-managers?company_id=`, returning
  `{company_id, user_id, user_name, user_email, role}` — better than assumed,
  because `user_email` anchors the *approver* too. Two limits go on the screen:
  it lists **company** managers, not this employee's line manager; and `role` has
  no enum, so it is displayed, never laddered.
- **The off-cycle limit — ours.** `off-cycle` returns **zero matches** across
  Remote's whole documentation index. Rung 1 cannot answer and rung 2 has nothing
  to read, so it is a stated policy figure, rung 4, self-identifying. And it must
  **block**: today there is no ceiling of any kind, because the high-value line
  only summons a third signature.
- **Gross-to-net — never build it.** `AmountTaxType`: *"`net` … **Remote will
  gross this up** to ensure the taxes are included."* Remote performs the gross-up;
  a figure derived here would be fabricated money. The control is the
  **disclosure** that the company's cost is higher and unknown to this system.
  DRIFT-049's own recommendation guessed this and marked it speculative; it is now
  settled at rung 1.

#### The finding that is about this register's own method

**DRIFT-110 is the sharpest of the eight, and it is a defect in a correction.**
On 2026-08-21 the *eighth* pass fixed UC-06's self-approval exemption and added the
missing clause to ADR 0005 — correctly. The clause read: *"UC-01 holds this … and
**UC-09 holds it in its strongest form (requester ≠ approver ≠ payment_releaser,
`src/uc09/multiApprovalPolicy.js`)**. UC-06 did not…"*

**UC-09 does not hold it.** That file compares the three approval **slots** to each
other and never compares any of them to `adjustment_row.requester`. So the ADR — the
artefact an auditor opens first — asserted the strongest available form of a
four-eyes control about the one use case that moves real money, **citing the file
where the reader would go to confirm it.**

Why it happened is the generalisable part. A pass that fixes one instance of a
defect reaches for the other instances as examples, because naming who *does* hold
a rule is what makes the exception legible — and states them **from memory rather
than from the file**, because they are not its subject. UC-06 was verified
exhaustively. UC-09 was asserted confidently **because it looked stricter**: three
slots, an explicit `isSameApprover()` loop, an unwaivable floor, a 320-input grid.
All real; none of them the control being claimed. In a correction, everything
around the false claim was just checked, so the surrounding sentences inherit the
fix's credibility.

`docs/WHY-THIS-SHAPE.md` gains **§18** for it (previous §18/§19 renumber to
§19/§20). The rule that came out: **a pass may disposition only the use case it is
reading; where it names another's state, it cites the file or says it did not
look.** And: **the document correction is queued ahead of the code change**
(`[P-2]` before `[P-1]`) — a gap is discoverable by a careful reader, a gap plus a
written assurance that there is no gap redirects them.

#### Two findings from reading `src/uc09/` for what the others implied

Neither is subtle once looked for, and both were invisible because nothing was
looking:

- **`src/uc09/` contains no Zendesk write verb at all** (DRIFT-115). Every UC-09
  decision raises a ticket (`NO_TICKET_DECISIONS.uc09 = []`, nothing exempt) and
  that ticket is **never updated again**. Approved, denied, executed, in-doubt: all
  four silent to the person who asked for the payment. DRIFT-053 reported this for
  one state; it is true of all of them. UC-09's approval phase is the only one with
  no n8n counterpart, and the Zendesk write on every other use case lives in the
  graph — so the API path was built without one and nothing noticed it was the only
  path.
- **`expected_payout_date` is answered by Remote on the write we already make and
  read nowhere** (DRIFT-116) — the one question the person being paid has. The
  value is already in a variable. Cheapest item in the queue.

#### Two traps that would have shipped silently

- **`findIntegrityBreaches()`'s premise is false for UC-09.** It flags any
  high-tier row reaching `auto_resolve` because *"high-tier must have no execution
  path"* — true of UC-07 and UC-08, **wrong for the one 🔴 that deliberately has
  one.** Route UC-09 rows into metrics the obvious way and the dashboard
  manufactures breaches on **correct** payments, which is worse than no measurement
  because it teaches a reader to discount the single alarm this use case exists to
  raise. **`[P-24]` before `[P-23]`.**
- **`Idempotency-Key` is documented by Remote nowhere** (DRIFT-113), and
  `#writeHeaders()` defaults it to `randomUUID()` — a fresh key per call, which is
  idempotency in shape only. `createIncentive()` passes a stable key, so the money
  path is not that case, but *"can never be delivered twice"* is a claim about
  Remote's behaviour resting on a header Remote has not promised to read. Remote's
  own documented anti-duplicate mechanism is the `note` field — which is also what
  makes the in-doubt state **resolvable** rather than merely recorded: put the
  adjustment id in `note`, and `GET /v1/incentives` answers *did it happen?*
  `[M-3]`, `[P-9]`.

#### The decision the owner took, and the one it overturns

**DRIFT-050, reading (A): the filer may sign the `requester` slot and no other.**
Floor of two distinct signatures unchanged, so the minimum is two humans on any
payment and three above the floor. Reading (B) — ADR 0005's literal *"either
approval slot"*, applied as UC-06's `[A-2]` applied it — would have made slot 1 an
independent employer signatory and the minimum three. (A) was chosen because
`00-FOUNDATION.md` §5 names three **parties** and a party who signs nothing is not
party to the control; because the sidebar already tells the reader this slot decides
*"that the adjustment is the one they asked for"*, an attestation only the filer can
make; and because it leaves the floor's cost where every document already puts it.

#### The demo requirement, and the gap it found

The owner's framing was *"the UI for every human interaction must be built,
especially when job roles differ."* UC-09 has three roles and the ZAF panel renders
all three properly — `approvalRoles()` names each slot, what it decides, who signed
and when, with the meter drawn as filled and empty slots.

**But the sidebar is a Zendesk *agent* surface, and one of the three role-holders is
not a Zendesk agent.** §1 names the primary actor as *Customer Admin*;
`src/portal/server.js:46` states the portal *"offers no approve/decline anywhere"*.
So the `requester` control renders only in the sidebar and `cli.js`. Two of the
three roles are Remote-internal specialists with a working surface; the third is a
customer with none. `[P-3]` gives that role a **confirmation and attestation**
screen — and §18's "must NOT change" list pins that it may never grow an approve
control for the other two slots.

That screen is also where DRIFT-052's remedy lands. Every constraint on the parsed
figure is a check on its **shape** — a model returning `1250.00` for *"twelve
thousand five hundred"* satisfies all of them — and the only reader who can falsify
it is the person who stated it, who is never asked. `[P-4]` echoes it back before
any signature is collected. One build, two findings.

#### Numbers

Register **103 → 111 findings, 62 → 68 decided, 41 → 43 open**; 111 rows, 111 unique
ids, verified. `qa/HUMAN-DECISIONS-REQUIRED.md` **56 → 60 entries, 26 → 30
answered** — `A1`, `E16`, `E17` and `E18` were the last four questions belonging to
a use case that had never had a decision pass — plus a new **§J** (`J1`…`J4`).
**Nine build queues, nine non-corresponding change schemes**: `G-1…4`, `G-A…C`,
`E-1…3`, `W-1…10`, `N-1…18`, `A-1…32`, `R-1…27`, `T-1…28`, **`P-1…34`**.

**Files:** `qa/contracts/UC-09-acceptance.md` · `qa/SPEC-DRIFT-INDEX.md` ·
`qa/HUMAN-DECISIONS-REQUIRED.md` ·
`docs/adr/0005-dual-control-segregation-of-duties.md` ·
`docs/use-cases/UC-09.md` · `docs/WHY-THIS-SHAPE.md` · `docs/00-FOUNDATION.md` ·
`docs/INTAKE-RESEARCH.md` · `docs/APPROVAL-ROUTING.md` · `docs/FOR-CX-LEADERS.md` ·
`workflows/README.md` · `README.md` · `CLAUDE.md` · this file.

---

### 3.88 The cross-cutting backlog, answered in one sitting — and a register whose headline had drifted from its own table

**Not a use-case pass.** After §3.87 closed the last of the nine, the owner
dispositioned the standing backlog in `qa/HUMAN-DECISIONS-REQUIRED.md`:
**nineteen entries answered** (`A4`, `A5`, `B1`, `B2`, `D3`, `D8`, `D9`, `D10`,
`E6`, `E8`, `E9`, `E10`, `E11`, `E12`, `E13`, `E14`, `F1`, `F2`, `G3`), **§F's
routing decision taken**, and `A1`, `E15`, `E16`, `E17` confirmed as already
answered. Thirty answered → **forty-seven of sixty**. Nine cross-cutting findings
moved to decided in the index. **No code, no test, no workflow body changed.**

#### Why these nine survived nine passes

Each use-case pass read one contract and dispositioned that contract's findings.
A finding filed under **cross-cutting** had no pass that owned it — so DRIFT-003,
040, 041, 044, 045, 046, 047, 048 and 077 sat through all nine, not because they
were hard but because they were nobody's. That is precisely the failure mode a
cross-cutting register exists to catch, and it took a session whose subject was
*nothing in particular* to catch it.

#### The standing instruction was "let Remote's docs guide you", and on four entries the docs changed the answer

- **`A5` / DRIFT-041 — nothing expires.** The instruction was *"add a clock to
  everything, nothing must get lost or unattended to."* Remote's entire
  documentation index returns **two matches for `expired` and two for
  `reminder`**, and exactly one is a real construct:
  **`employment.probation.period_ending_reminder_sent`** — *"triggered when an
  employee probation period is nearing its end"* — which **fires ahead of a
  boundary and changes no state.** Remote models **no approval expiry anywhere.**

  So the decision is **age and warn everywhere, lapse nowhere**, and the second
  half is the one worth writing down: nothing may become approved **or denied**
  because time passed. Auto-denying a legitimate payment is also an action, also
  unrecoverable in the moment that matters, and also something no human decided.
  *An unattended request must become loud, never resolved* — which turns out to be
  *"nothing gets lost"* and *"nothing decides itself"* read as one instruction.

  Two clocks, two rungs: **UC-06's cutoff is Remote's** (rung 2, real cycle dates
  from `GET /v1/payroll-calendars`); **every other clock is ours** (rung 4 — Remote
  publishes no approval SLA, so *"waiting 6 days"* is a fact and *"6 days is too
  long"* is our policy figure, labelled as such on the screen). And UC-09's
  invariant 2 now reads *no score, list, flag, threshold **or clock** may lower a
  signature requirement.*

- **`D10` / DRIFT-047 — the four doors.** Re-deriving them from Remote's
  documentation rather than from our own `00-FOUNDATION.md` §2 changed which four
  they are, and produced the sentence the entry most needed — from the use case
  that moves money: **an event existing is not a reason to subscribe it as a
  trigger.** UC-09's five `incentive.*` events are real, and subscribing them as an
  intake would produce **two payments**, because `pending` means *already scheduled
  to be paid*. They are a bypass detector. The identity half is the part that
  matters most: §2 is the file a reader consults **to reason about identity** and
  it describes two of the three models in use — the portal's shared
  `PORTAL_ACCESS_KEY` plus a server-resolved persona key is a third, and materially
  the weakest.

- **`E8` / `E10` — UC-07's missing reads and paperwork.** Remote publishes
  `GET /v1/offboardings/employments/{employment_id}` — better than the
  `GET /offboardings` the spec names, which is not a published path — and both
  `POST /v1/offboardings` and `POST /v1/employments`, so the never-submitted
  paperwork is drafted against **Remote's own required arrays**. UC-05's pass
  supplies the constraint that keeps it honest: `CreateOffboardingParams.type` is
  `enum: ["termination"]`, so a resignation cannot be drafted this way at all.
  **Drafting a payload is not a write** — the read-only façade gains no create
  method, and if a submit button ever appears beside it UC-07 has acquired an
  execution path.

- **`F2` — the urgent-cutoff alert.** Shaped by the same single Remote deadline
  construct: it warns ahead of a real payroll cycle date and changes nothing.
  Routed through `RCX OPS · Error Alerts`'s durable-row-then-push pattern rather
  than Slack — *the row is the alert, the push is a convenience* — with an explicit
  kind, because `ops_alerts` currently means *a workflow failed* and an urgent
  cutoff is not a failure.

#### §F: use cases connect by READING, never by invoking

The largest single answer in the register, and it **refuses all five proposed
routes.** The argument is Remote's own data model: every one of these use cases is
about a Remote object with its own `GET`, and **Remote relates them by
`employment_id` and by nothing else** — no endpoint turns one request into
another, no workflow edge, no state machine spans two resources. Building routing
edges between our nine would invent a topology Remote's platform does not have.

A read is not a weaker route; it is a different act. **A route originates work; a
read informs work somebody already started.** All three hazards this section had
listed are properties of origination and dissolve rather than being mitigated: the
exactly-once key cannot mint a duplicate reference because a read mints nothing;
two use cases correcting the same underpayment becomes *detectable* instead of
prevented-by-hope; and no approval can cross because there is no carrier.

**And it drew the distinction that had made §F read as five missing features:
intake classification is not runtime routing.** *"This request is actually a
work-authorization request"* is a decision at the door, before any gate runs —
legitimate, and why UC-03 → UC-04 stays. *"This decided case should cause another
case"* is origination, and is refused. Which makes the cheapest fix in the section
the first one, and it is not a route at all:
**`src/uc07/relocationParser.js` classifies `temporary_workation` and
`business_travel` and then discards the classification**, compiling both as
permanent-relocation dossiers for the most senior mobility queue. The system
already knows the request belongs elsewhere and throws the knowledge away.

Track F — v1's proposal that UC-08's work-authorization clearance gate UC-07's
execution — is refused on the same ground UC-08's pass refused it: **UC-07 has no
execution to gate**, and *a 🔴 use case may hand another a fact, never a verdict.*
What the concern actually asks for is a **read**. One genuine defect fell out of
the same paragraph: `dossierView.js` treats tax residence at both ends as a
finding a relocation raises by existing, and routes the flag to **Mobility Legal,
where UC-08's mandatory tax disclaimer and Tax Operations' queue do not apply** —
a finding already crossing a boundary today, without the receiving use case's
protections.

#### The register's headline had drifted from its own table

Measured on 2026-08-21: **93 of 111 rows carry a disposition; 18 are open.** The
headline read **"68 decided, 43 open"** — an understatement of sixteen, and it was
already wrong *before* this session touched it (84 decided at `09d0b72`).

The cause is mechanical: each pass incremented the headline by the findings **it**
dispositioned and never by rows other passes had marked — including the findings a
pass *opened and dispositioned in the same sitting*, recorded in the table as
`DECIDED · NOT YET BUILT` and counted in the headline as open.

**It drifted in the safe direction, which is why nobody caught it.** A register
that understates how much has been settled invites the reading *"so almost nothing
has been decided"* — wrong, but harmless. The same mechanism pointing the other way
would be a status file claiming decisions it does not hold. Corrected by
**recounting from the table**, with the drift recorded in the §Count box rather
than quietly applied — the same lesson `CLAUDE.md` §4 already carries for the test
count, which moved twice while a single sync was being written. **A count that is
added to rather than measured is not a count.**

#### One entry deliberately left open

**`F3` — a second employer-side identity.** `[A-1]` makes the requester ineligible
for slot 1, so a walkthrough needs one person to file and a different person to
sign; without it UC-06's positive path cannot be demonstrated at all once `[A-1]`
lands, which makes this a **demo blocker**. It stays open because *"a fabricated
approver identity is the one kind of fabrication the substitution ladder does not
cover — it is not a fact about Remote's platform, it is a claim about a person."*
The requirement is stated; the identity is the owner's to supply. Its third
provisioning step is the one that bites: the `uc06:customer_admin` read-alias must
be in place **before** `[A-2]`/`[A-3]` rename the role, or entitlement drops to
`approver_entitlement_not_configured` and refuses every approve on UC-04, UC-05 and
UC-09 too — the outage `APPROVER_ROLES` already caused once, reproduced
deliberately.

**Files:** `qa/HUMAN-DECISIONS-REQUIRED.md` · `qa/SPEC-DRIFT-INDEX.md` ·
`CLAUDE.md` · this file.

---

### 3.89 UC-01 IMPLEMENTATION, first build pass — a letter generator becomes a triage gate, and four invariants that held on one path only

**The first pass to build against a FROZEN VALIDATION CONTRACT rather than
against a spec.** `qa/handoffs/UC-01/0001-builder-to-validator.md` was
negotiated and countersigned before any code was written — thirty-three
criteria (`VC-01`…`VC-33`), four of them amended in the Validator's second
pass, plus two build-scope corrections to the Builder's own file lists. This
entry records what was built against it, what was proved, and what is blocked.
**Nothing in it was decided here**; every choice traces to a countersigned
criterion or to a disposition already in `qa/contracts/UC-01-acceptance.md`.

**Step 0, and the measurement that the tooling said was unanswerable.**
`npm run verify-deployed` exits **2** from this container — no `N8N_API_KEY`,
no `.env` at all — and the contract is explicit that **exit 2 is not a pass**.
Read as "UNKNOWN" that would have made every n8n-half criterion unknowable.
It was answered instead through the **n8n MCP connector**, a different caller
for the same question: graph `WORKFLOW_UC01_ID`, 24 nodes,
`activeVersionId === versionId`, and all four repo-backed Code-node bodies
**byte-identical** to the working tree. `M-2` is a **PASS**, measured.
`M-1` and `M-4` genuinely cannot be measured here (no Remote or Zendesk
credentials) and are recorded as such rather than as failures. `M-3` was
struck before the pass began — the Validator had already read the live table.

That read also settled the precondition **Amendment 1** rests on:
`audit_trace.parent_id` is **nullable**, FK to `audit_log.id`. The schema
already permitted a parentless trace row; only the application refused to write
one. That is what separates `DRIFT-121` from `DRIFT-120`, which genuinely needs
a migration.

**What was built** — `G-1`, `G-2`, `L-10`, `L-11`, `L-16`/`L-1`, `L-17`,
`L-18`, across three commits (`88bd07e`, `ea21f8a`, `0746619`):

| | What it closes |
|---|---|
| **`L-3`/`L-4`/`L-6`** | Engagement eligibility, **first position, ahead of identity**, in both gate copies. A contractor used to pass every gate and receive a letter saying Remote employs them — a false attestation about a legal relationship, and it shipped live. Five reasons, not one, per DRIFT-074's own table. Fails closed on an **absent** engagement type AND on an **unrecognised** one, distinguishably |
| **`L-5`** | `deflected_to_self_service`. An eligible EOR employee signed in to Remote is pointed at the Requests tab rather than issued a second copy of a document Remote already produces |
| **`L-10`** | `requesterType` becomes deterministic. The model may only ever tighten `self → third_party`, never the reverse; an unreadable answer fails closed to third party |
| **`L-11`** | The two normalizers derived **opposite identities from one ticket**, so `auto_resolve` was structurally unreachable on the Node path. Per the Validator's correction this also needed `src/shared/identity.js` (which read only `authenticatedEmploymentId`) and the **ordering** divergence |
| **`L-16`/`L-1`** | The live path was issuing a **four-fact** letter where `letter.js` issues seven |
| **`L-17`** | The sidebar answered *who is this about* with an employment id |
| **`L-18`** | An out-of-scope refusal recorded **nothing**, so "the gate ran and wrote nothing" and "the gate never ran" produced identical evidence |

**The methodological point this pass adds to the four §5 already records: a
gate that changes live behaviour is discovered through its TESTS, and the
tests are where the damage would have been done.** `G-2` broke ten assertions
across seven files on the first run, and every one of them was a fixture
holding a **logged-in Remote session** on a path whose subject was the letter.
The lazy repair — relax the assertion — would have produced a fully green suite
in which `auto_resolve` was **unreachable in production**, which is this
repository's most expensive shape for the fourth time. What was done instead:
the deflection became its own positively-asserted outcome, and every letter
fixture moved to the **ticket-requester** signal, which is the population
auto-issue still serves. **`VC-25` is pinned by a positive test in three
files.** One bulk edit did briefly rewrite a *"wrong person"* fixture to name
the **right** person, and two UC-02/UC-03 sessions that had no business
changing; caught by reading the diff rather than the result, and reverted.

**Four things were found that no criterion had named, and none is fixed here:**

1. **`VC-11` is violated on the deployed graph.** Every persistence node runs
   **before** `Route by Decision`, so an `out_of_scope` ticket already writes a
   `workflow_claims` row, a `cases` row and an `audit_log` row and then falls
   through to `Unrecognised Decision`. The Node path writes none of them.
   Closing it is a **graph-shape change**, not a Code-node edit.
2. **`L-16`'s fuller letter needs a legal entity the graph never fetches.**
   Twenty-four nodes, none reading `/v1/legal-entities`. The node now **throws**
   rather than defaulting to a plausible employer name — inventing one would be
   DRIFT-074's false attestation produced by a renderer instead of a gate.
   **Deploying `renderLetter.js` without adding that fetch node turns every
   `auto_resolve` into a failed run**, and the file says so at the site.
3. **`classifyRequestRuleBased` does not tag `source`**, so
   `classification.source` is `undefined` on every surface that injects it
   directly — the playground and the chat demo among them. Test 15 in
   `test/uc01.test.js` pins that shape **deliberately**, and issue #25's own
   principle points the other way. Left alone: changing an invariant-8 behaviour
   an existing test pins is its own reviewed unit of work.
4. **The acceptance contract carries two slug schemes for one gate.** §6's table
   says `not_eor_engagement` / `onboarding_incomplete` / `employment_winding_down`;
   DRIFT-074's disposition says `engagement_not_eor_contractor` /
   `engagement_not_eor_direct` / `engagement_onboarding_incomplete` /
   `engagement_offboarding`. **Built to DRIFT-074's**, because `L-3` names it —
   but a reader landing on §6 will not find these slugs in the code.

**Two smaller repairs, both of the same class — an assertion that could not
fail.** `describeDecidingGate`'s `total` returned `GATE_SEQUENCE.length`, which
stopped being the ladder length the moment one gate refused five ways: a
specialist was reading *"decided at gate 11 of 18"* about a 13-rung ladder. And
two assertions in `test/uc01.test.js`'s out-of-scope test read a `CaseStore` and
an `AuditLogger` that were **never passed to the workflow** — they would have
read zero whatever the code did.

**A named absence, stated rather than discovered later.** An employee **serving
notice whose status still reads `active`** is invisible to `G-1`: Remote exposes
that at `GET /v1/offboardings/employments/{id}` and **UC-01 makes no such call**.
`OFFBOARDING_STATUSES` catches only the case where the status itself says so.

**Blocked, and why.** `L-7`'s migration is **written and not applied** — the
dispatching bead's hard stop, awaiting the owner. `L-8`, `L-9`, `L-12`, `L-13`
and `L-19` all need those columns or the store they enable, so the third-party
consent round-trip (`G-3`) is **not built**. `L-15`, `L-20` and `L-21` need an
n8n republish, which this pass is forbidden. **`VC-07` and invariant 13 are
NAMED UNTESTED GAPS** — which is a legitimate outcome, and the one thing that
would not have been is quietly passing `VC-07`.

**Numbers, with the tree state attached, because this file has been wrong about
that before.** Pre-build baseline at the dispatch commit: **3,631 tests, 3,629
pass, 1 fail, 1 skipped, 226s** — the failure `EADDRINUSE` on 4061, a dashboard
already running in this shared container. After the three commits: **3,691
tests, 3,688 pass, 1 skipped**, two failures, **neither from this work** — the
same `EADDRINUSE`, and the model-policy check, which `6e9bf5e` broke at 21:42Z
by adding a literal forbidden-family model identifier — a `claude-<family>-N`
string — as a price-table key in `scripts/orchestration/negotiation-view.mjs`.

*Recording this cost a second violation before it was understood.* Naming the
offending identifier **literally, in prose describing the bug**, trips the very
scan being described: `model-policy-check.mjs` reported two files, not one, and
the second was this build log. The check reads a concrete `claude-<family>-N`
string as a SELECTION wherever it appears, and it is right to — a literal id is
usable as a model choice, while a family name is not. Both sites are fixed the
way `modelPolicy.mjs` fixes its own: **build the identifier from the family
list, never spell it out.** The dashboard's forbidden rows are now generated
from `FORBIDDEN_FAMILIES`, so the price table follows the ban automatically if
it ever widens, and this paragraph names the family instead of the model.

### 3.90 UC-01 CONTINUATION build — G-3, the third-party consent round trip, built end to end

**The blocker recorded in §3.89 is gone.** That pass stopped honestly with
`L-7`'s migration written and not applied, under a hard stop the dispatching
bead imposed. The owner has since granted standing authority over Supabase
("nobody is supposed to be waiting on me for anything... free reign in my
supabase" — `qa/orchestration/OPERATING-CONTRACT.md` line 462), the mayor
applied the migration and verified the live schema by reading it back (twelve
columns, matching `migrations/0001-consent-records-invariant-13.sql` exactly),
and this pass re-verified that same schema independently — via the Supabase
MCP connector, not by trusting the prior pass's word for it — before writing a
line of code against it. This entry records what was built on top of it: all
five of the previously-blocked changes (`L-8`, `L-9`, `L-12`, `L-13`, `L-19`),
plus the not-reached `L-14`, plus completing `L-2`'s audit.

**The core design decision, stated once because it drives everything below.**
`consentOnRecord` used to be a boolean that could only ever ask *"may this
proceed?"* — collapsing "nobody has answered yet" into the same "no" as "the
employee said no". VC-06 requires the first of those to be a genuinely
**pending** state, never a refusal. So the third-party regime is now three
outcomes, not two:

- **granted** (`isConsentGranted` in the new `src/shared/consentArtifact.js`)
  — every one of invariant 13's four facts present AND `status === "granted"`.
  Verifies the disclosure; the request still reaches `human_review` /
  `third_party_request` — never zero-touch, even with consent (VC-07).
- **denied** (`isConsentDenied`) — `status === "denied"`, completeness not
  required (a "no" needs no purpose on file). Reaches `blocked` /
  `consent_refused` — a terminal refusal, never `escalate`, because there is
  nothing left for a specialist to look at once the employee has said no
  (VC-08).
- **pending** (`isConsentPending`, the safe default) — no row at all, or a
  row that is neither granted-and-complete nor denied. Reaches
  `awaiting_employee_consent` — not a refusal, not a queue item, just: nobody
  has decided anything yet (VC-06). A `status: "granted"` row missing a fact
  (a legacy write, a partial insert) is deliberately treated as pending rather
  than trusted or refused — the only one of the three directions that cannot
  itself cause harm.

**VC-33's hardest requirement — a real employee with no consent (a), a real
employee who refused (b), and a person who does not exist at Remote at all
(c) must be indistinguishable from outside — forced a reordering inside
`identity.js` that is easy to get backwards.** The function used to check
`if (!employment) return no_employment_record` before ever looking at
`requesterType`. Under G-3 the third-party branch now runs FIRST, ahead of
that check: if "no employment" ran first, (c) would reach a different verdict
than (a)/(b), and the shape of the refusal alone would disclose that nobody by
that reference exists — invariant 14's exact concern. `workflows/nodes/
gates.js` mirrors the same reordering (its own comment explains why an n8n
Code node reimplements the completeness rule inline rather than importing it).

**What was built, per change:**

| | What it closes |
|---|---|
| **`L-8`** | `caseStore.findConsentArtifact({employmentId, requestingParty, purpose})` — the lookup that replaces the boolean. Scoped by all three fields, deliberately: `consent_records` has no `employment_id` column of its own (only `case_id`, NOT NULL, FK to `cases.id`), so the join runs through `cases`, and an unscoped party/purpose can never match anything — "a standing yes to anyone, forever" stays unrepresentable. `workflow.js` STEP 2c runs the lookup before STEP 3's `verifyRequester()` call |
| **`L-9`** | The `awaiting_employee_consent` decision, in both gate copies. `L-9`'s own note — "the case must exist first" — is honoured: the pending consent_records row is created at STEP 6c, AFTER the case row exists, only when no artifact was already found and the third party supplied both a requesting party and a purpose (an unscoped ask can never be looked up again, so recording one would create an artifact nobody could find or grant against) |
| **`L-12`** | `src/thirdparty/` (`npm run thirdparty`, :4048) — the deliberately unauthenticated third-party door. Its HTTP response is `THIRD_PARTY_ACK_MESSAGE`, a module-level string constant with zero parameters; the route sends it literally (`send(res, 200, { ok: true, message: THIRD_PARTY_ACK_MESSAGE })`), so no branch in the handler is even structurally capable of selecting a different reply — Amendment 3's preferred "structural" proof over a sampled timing comparison. `test/thirdPartyDoor.test.js` drives all four of Amendment 3's cases (pending, denied, nonexistent employment, and a throwing Remote client) and asserts byte-identical response bodies, not merely equal-looking ones |
| **`L-13`** | `GET /api/consent-requests` / `POST /api/consent-requests/:id/decide` in `src/portal/server.js` — the employee's own read of "who is asking to be told about me". Deliberately NOT a violation of the portal's stated "no approve/decline anywhere" rule: consenting to one's own disclosure is the employee's act about their OWN record, the same distinction `src/remoteui/roles.js` already draws between UC-06's consent (employee/employer) and its approval (the ZAF sidebar's dual gate). Cross-party access is refused server-side by reading the consent row's employment id back through `findConsentRecordById()`'s join and comparing it to the acting persona's own — never trusting a claimed id |
| **`L-19`** | `src/approvalqueue/awaiting.js` gained a check for `useCase === "UC-01" && status === "awaiting_consent"` — ahead of the existing `queueStatus` branch, because a consent-pending case deliberately creates NO review_queue row (the person waited on is the employee, not a specialist) and would otherwise read as "settled" for lack of one. `stuck.js` gained a parallel exception: a consent request skips the ticket-based stuck checks entirely, because the third-party door raises no Zendesk ticket by design and "no ticket" would otherwise read as the exact defect this surface exists to catch |
| **`L-14`** | `src/uc01/selfServiceLetter.js` + `src/portal/requestTypes.js`'s eighth entry — the destination `refusalCopy.js`'s `self_service_available` message has promised since G-2 shipped. Deliberately NOT `handleVerificationTicket()` run a second way: no LLM (nothing to classify — a click is not a sentence), no third-party regime (self-service is by definition the self path), reusing only the three facts genuinely common to both channels (`engagementEligibility.js`, `REQUIRED_LETTER_FIELDS`, `letter.js`) |
| **`L-2`** | `test/uc01VcAudit.test.js` — one test per VC-01..VC-14, indexed by criterion id, checking the same evidence categories (UI/Zendesk/API/DB/Audit) the contract names for that row, driven through the real workflow against the real mock server (a fake Remote client only for the three engagement-eligibility fixtures the mock server does not carry under a stable id — `test/engagementEligibility.test.js` already covers `classifyEngagement()` as a pure function; this proves the SAME records reach the SAME outcome through the whole workflow) |

**One retirement, done carefully because ~15 call sites depended on the old
shape.** `ticket.consentOnRecord` is gone from `verifyRequester()`'s signature,
from both normalizers, and from every demo surface (`playground`, `chatdemo`,
`review/cli.js`'s seed, `metrics/seed.js`'s archetypes, `scenarios.js`). Every
one of those now demonstrates the **granted** path by writing a real artifact
first (a throwaway `cases` row + a `consent_records` row) rather than passing
a flag the workflow no longer reads. `metrics/seed.js`'s seed case is
explicitly excluded from the aggregate the dashboard renders — it never went
through a real ticket, and the file's own header says this pass "does NOT
fabricate rows".

**Regression, measured rather than assumed.** Every existing test asserting
the OLD binary behaviour for a third-party/mismatched-session scenario had to
be found and updated to the new three-state one — five files
(`test/uc01.test.js`, `test/uc01RequesterType.test.js`,
`test/lowTierExceptionData.test.js`, `test/zendesk.test.js`,
`test/pdfRender.test.js`), each confirmed to be asserting the CORRECT new
behaviour rather than merely un-broken (each rewrite states, in its own
comment, why the new outcome is right — a pending consent question, never a
refusal, for a signal that does not match its own claimed record). Two
failures found in the full suite were confirmed **pre-existing** via
`git stash` on a clean tree before this pass touched anything —
`test/portalTicketNote.test.js` (a UC-09 free-text parsing edge case,
unrelated to UC-01) and the well-documented `EADDRINUSE:4061` collision in
`test/dashboard.test.js` (another process in this shared container already
holds that port) — and are not this pass's to fix. `test/zafExecutionClaim.test.js`
failed once, under full-suite load, and passed cleanly in isolation both
before and after this pass's changes — a timing race under CPU load, not a
regression (`npm test`'s own baseline-duration hazard, CLAUDE.md §6).

**Numbers.** 15 new tests in `test/uc01VcAudit.test.js` (one per VC-01..VC-14,
VC-14 covering both its attachment and URL cases), 12 in
`test/thirdPartyDoor.test.js`, plus new coverage added to
`test/portal.test.js` (3), `test/approvalQueue.test.js` (2), and
`test/chatdemo.test.js` (1) — **33 new tests**, all passing, alongside the
five existing files updated in place. A full, quiet `npm test` run at the end
of this pass: **3,732 tests, 3,729 pass, 2 fail, 1 skipped, 124.5s** — the two
failures are the confirmed-pre-existing `test/portalTicketNote.test.js` and
the environment-collision `test/dashboard.test.js` named above, neither
touched by this pass. Quote this count with this pass's own commit, per this
file's own recurring correction about carrying a number forward past the tree
it was measured on.

**Blocked, and why — unchanged from §3.89's list, all still correctly
untouched by this pass.** `L-15`/`L-20`/`L-21` need an n8n republish, which
this pass is forbidden (sequenced separately by the mayor). `rca-1bk`
(VC-11 violated on the deployed graph), `rca-dy0` (`renderLetter.js` needs a
legal-entity fetch the graph never runs), `rca-v13` (`classifyRequestRuleBased`
does not tag `source` — a decision, already reverted once, left alone) and
`rca-4v5`/`rca-2et` are all previously-raised findings this pass did not
re-escalate or attempt to fix, per the dispatching bead's explicit instruction.

**One structural gap found and NOT closed, named rather than silently
skipped.** `workflows/nodes/gates.js`'s consent branch now reads
`ctx.consentRecord` — but no Supabase node yet exists in the deployed graph to
populate it before "Identity + Policy Gates" runs. Until `L-15`'s republish
adds that lookup node (a graph-shape change, not a Code-node edit — an n8n
Code node has no imports and no database client), the LIVE n8n path's
`ctx.consentRecord` is always `undefined`, which this code treats identically
to "no matching row" — the safe (pending) default, never a false grant. So the
live graph can already REACH `awaiting_employee_consent` for a third-party
ticket (every one, since nothing populates a granted row for it yet) but
cannot yet reach `human_review`/`third_party_request` via a genuinely granted
consent, until the lookup node is wired in. This is recorded here rather than
left for a future session to rediscover the hard way.

### 3.89 The last two build queues — and three things the dispositions had said but not made actionable

**2026-08-21. Documentation only. Nothing in `src/`, `test/` or `workflows/`
changed.**

UC-01 and UC-03 were the two decided use cases with no §18 build queue. Their
changes were numbered inside their §17 dispositions — `G-1`…`G-4` and
`G-A`…`G-C` — which is enough to know *what* was decided and not enough to know
*in what order*, or which file a builder opens first. **All nine contracts now
carry a §18.**

#### Numbering: why the gate names were kept and the build items were not

`G-1`…`G-4` and `G-A`…`G-C` are cited from `docs/use-cases/UC-01.md`,
`docs/use-cases/UC-03.md`, `qa/SPEC-DRIFT-INDEX.md` and each contract's own §5,
§6 and §12. Renaming them would have broken every one of those citations for no
gain. So the gate names stayed and the **build items** took new prefixes —
**`V-1`…`V-7`** for UC-01 and **`L-1`…`L-8`** for UC-03 — with each `V-`/`L-`
item naming the `G-` it carries where it carries one.

That makes **eleven schemes, none corresponding**, which is deliberate for the
reason `CLAUDE.md` §7 item 20 gives: this repository already has two registers
both numbering findings `C-N` with code citing both, and a reader following a
citation into the wrong register lands on a confident, specific, entirely
unrelated finding. Adding a twelfth collision to avoid an eleventh scheme would
have been the wrong trade.

#### The finding that justifies writing queues at all

**UC-01's Step 3 breaks the only end-to-end demo this repository has ever run in
production — and it does so correctly.**

`CLAUDE.md` records tickets #3–#6 auto-resolving and posting a public letter for
Alexandre Tremblay. `src/livedemo/employees.js:55–61` still lists him:
`contract_type: contractor_of_record`, CAN, active. So once `G-1` lands — the
engagement-eligibility gate, first position, fails closed — **that request
refuses**, which is the entire point of the gate. And once `G-2` lands, the only
other listed demo employee (Alex Morgan, EOR/USA, `:48–52`) asking for the plain
standard letter is **deflected** to Remote's own Requests-tab flow, which is also
the entire point of that gate.

Both behaviours are right. Together they mean the auto-issue demo needs a
**third** shape that exists nowhere today: an eligible EOR employee asking for
something Remote's self-serve flow will not serve.

That shape is exactly what `docs/INTAKE-RESEARCH.md` §6.5 says UC-01 is *for* —
*"not 'automate employment verification letters', which Remote automated years
ago"* — so the demo gets **better**, not worse. But it has to be built, and §16's
evidence list moves with it. The queue therefore requires it **in the same unit
of work as `V-4`**: a queue that lands a correct behaviour change and leaves the
demo broken has shipped a regression by every measure a reviewer applies.

**Neither disposition says any of this.** Both are correct about the gate and
silent about what the gate costs the demo, because a disposition answers *what
should the system do* and a queue answers *what happens on the day you do it*.

#### A stale line number inside the register itself

DRIFT-014's disposition names *"four strings in `src/uc03/policyEngine.js` (444,
468, 667, 735) and one in `workflow.js`."* Grepped 2026-08-21, the file has grown
and the real set is **six** — `:21`, `:390`, `:630`, `:654`, `:954`, `:1027` —
plus one in `src/uc03/workflow.js:22`.

And three of the six (`:390`, `:654`, `:1027`) belong to the over-cap path, which
**`G-B` deletes rather than rewrites**. So doing `L-2` before `L-7c` turns a
seven-string edit into a four-string one.

The failure mode is the one worth recording: **a builder working from the stale
list hunts four line numbers that point at nothing, finds no "Global Mobility"
there, and may reasonably conclude the fix already landed.** That is §6's
stale-status-file gotcha appearing inside this register's own prose — the
register exists to stop status files drifting from code, and its own citations
drift the same way. The queue states the verified figures and says where they
came from.

#### A cross-UC dependency that was visible from only one end

**`G-A` is dispositioned in UC-03's contract and is a change to `src/uc04/`.**
`CLAUDE.md` §7 already recorded that UC-04's `[W-4]` — the employee surface —
does not work without it: build `W-4` first and the new surface files a request
our own gate then refuses. Neither contract's own §18 said so, because UC-04's
was written before UC-03 had one. It is now stated in UC-03's Step 4 as well, so
the dependency reads from both ends.

Also verified while writing Step 3: **both `G-C` destinations already exist** —
`Tax Operations` `6168394287519` and `Mobility Legal (Tier-3)` `6168424846751`,
both in `src/shared/escalationGroupIds.js`. No group needs creating, which is not
true of every routing change in this repository (§7 item 7 cost two).

#### One thing deliberately left as a hold

UC-03's Step 9 is **DRIFT-084, and its content is a decision not to decide.**
Remote publishes `GET /v1/travel-letter-requests` and five `travel_letter.*`
events; we subscribe to none. Subscribing today would mean receiving an event
announcing the **start** of a two-approval chain and answering it by handing the
requester the finished artifact that chain exists to produce — UC-03 issues the
letter first, with nobody in the path, and that is the design.

So the question it opens is DRIFT-076's question one use case over: does UC-03
duplicate a flow Remote already runs? The queue records the recommendation
verbatim — *"Remote publishes this; here is why subscribing would force us to
re-examine the premise; here is why we did not do that in a week"* is the
stronger artifact than a redesign rushed in the final week.

**Files:** `qa/contracts/UC-01-acceptance.md` (§18, `V-1`…`V-7`) ·
`qa/contracts/UC-03-acceptance.md` (§18, `L-1`…`L-8`) · `qa/SPEC-DRIFT-INDEX.md` ·
`CLAUDE.md` · this file.

---

### 3.91 UC-01 — an `auto_resolve` with no reference is now REFUSED, on both execution paths (rca-fawf / R7-26 / K3)

**What round 7 saw.** Three live `auto_resolve` rows carried
`externalRef: null`. No ticket, no portal reference, nothing naming the request
that asked for the letter. The reviewer's sentence for it was the right one:
*"if someone asks which request produced this letter?, the record cannot
answer"* — and the record was the only place the answer could ever have lived.

**The ruling, and the branch that was declined.** The owner ruled that such a
decision is **not legitimate**, and explicitly declined the cheaper option of
letting it stand while attributing it with `source` + `caseId` (the two columns
rca-sek1 had just landed). Attribution says what KIND of surface produced a
decision; only a reference names WHICH REQUEST. Durable record:
`qa/HUMAN-DECISIONS-REQUIRED.md` §K3.

**The second consequence is the one that actually bites.** The idempotency
claim in `src/uc01/workflow.js` runs only `&& ticket.externalRef` — there is
nothing else to key a claim on — so an unreferenced decision skipped the
exactly-once ledger **entirely**, and a redelivery would have issued a second
letter with nothing in its way. That is not hypothetical: real Zendesk ticket #5
produced two `audit_log` rows 30µs apart and a duplicate public letter. A
refusal writes nothing, sends nothing and claims nothing, so it is idempotent by
construction — which is why refusing, rather than attributing, is the only
branch that closes this half at all.

**Node path — `src/uc01/workflow.js`, new STEP 5b.** Placed after the gates and
before the claim, so it is upstream of every durable write and every
customer-facing act. Shaped exactly like the `out_of_scope` refusal beneath it:
one standalone `audit_trace` row (`uc01.unreferenced_auto_resolve`, `ok: false`,
carrying the withheld decision) and **nothing else** — no `audit_log` decision
row, because writing one would be doing the very thing the ruling refuses. It
returns `decision: "refused"` / `reason: "unreferenced_request"`, a decision
string of its own rather than a reused one: `blocked` is G-1's engagement
refusal and `out_of_scope` is the classifier's, and both are statements about
the REQUEST where this is a statement about the DELIVERY.

**n8n path — `workflows/nodes/gates.js` on `WORKFLOW_UC01_ID`.** A fix on one
path is not this bead. The refusal there is a **throw**, and the graph forces
that rather than it being a preference: "Identity + Policy Gates" is the last
node before `Claim Ticket (Idempotency)`, and only `out_of_scope` has a branch
that bypasses `Persist Case` — every other decision value, including any new
one, flows on through `Persist Case` and `Append Audit Log` and writes exactly
the untraceable row being refused. Adding a fourth bypass branch is a
graph-SHAPE change, which §K4 authorised once, for the consent lookup, and for
nothing else. A throw stops the run before the claim, the case row, the audit
row, the document and the Zendesk reply, and `RCX OPS · Error Alerts`
(`WORKFLOW_OPS_IDX`) still records it durably in `ops_alerts`.

**Narrow on purpose.** `auto_resolve` only — the one outcome UC-01 acts on the
requester's behalf for, unsupervised and irreversibly, and the only one the
ruling covers. An unreferenced `human_review`, `escalate` or `blocked` still
records and still queues exactly as before; two tests pin that, because widening
the guard would have refused work nobody ruled on.

**Deployed and read back, not inferred from a 200.** `npm run deploy-node
--publish` → `versionId === activeVersionId == 6f00db49-2b39-44db-8906-140f07ba6de3`,
`active: true`; the live node's `jsCode` re-fetched off the graph and diffed
byte-for-byte against the file (36,413 bytes, identical); `npm run
verify-deployed` → **57 nodes checked · 0 drifted · 0 unpublished**.

**Guard: `test/uc01UnreferencedAutoResolve.test.js`, 11 tests, proven red
before green** (6 fail with the two guards disabled; the 5 controls stay green,
so the controls are not vacuous). Every assertion is on observable output — the
returned result, the rows in the case store, the lines that reach the audit
destination FILE, and the calls that reach a Zendesk spy — never on an internal
branch and never on a value the test injected. Each negative is paired with a
positive control differing only in the presence of the reference.

**Full suite: 4241 tests, 4239 pass, 0 fail, 2 skipped** (baseline before this
pass: 4230/4228/0/2, measured on the same tree). Four existing fixtures gained a
reference — `test/audit.test.js`, `test/pdfRender.test.js`, `test/uc01.test.js`
(×3) and `test/uc01RequesterType.test.js`'s `runGatesFromRawInputs()` harness —
because each drives a genuine `auto_resolve` and production always supplies one
("Normalize Ticket" sets it from the Zendesk ticket id). No test's subject
changed.

**Found in passing, NOT fixed here, filed separately: `npm run pdf-demo` cannot
reach `auto_resolve` at all.** `src/pdf/cli.js`'s ticket carries an
`authenticatedEmploymentId` session, so **G-2 deflects it**
(`deflected_to_self_service` / `self_service_available`) and the CLI's own
`result.decision !== "auto_resolve"` check fails. Verified against the tree
directly; this guard never fires on that path, so the breakage is pre-existing
G-2 fallout and independent of this change. Fixing it is a judgement about what
the PDF demo should demonstrate, not a fixture tweak.

**Files:** `src/uc01/workflow.js` · `workflows/nodes/gates.js` (deployed) ·
`test/uc01UnreferencedAutoResolve.test.js` (new) · `test/audit.test.js` ·
`test/pdfRender.test.js` · `test/uc01.test.js` · `test/uc01RequesterType.test.js` ·
`docs/use-cases/UC-01.md` · this file.

---

### 3.92 The nine production webhooks stop being an open door (F-4b), and two detectors are caught lying about it

**2026-08-27.** Every one of the nine live n8n webhooks executed for anyone who
knew its URL, and eight of the nine handed that caller an employment record on
the way out. Both halves are now closed, proved in both directions, and the
whole thing is written up in **`docs/WEBHOOK-AUTH.md`** — this entry is the
decision record, that file is the operating manual.

**Why "nobody knows the URL" was never the control it looked like.** The
address has two halves and neither was secret. The path slugs are in the public
repository. The *host* is in public Certificate Transparency logs — every Let's
Encrypt certificate is published there by policy, with no opt-out, because it is
how browsers detect forged certificates. Confirmed with an unauthenticated query
to a public CT API: `n8n.your-host.example | Let's Encrypt | 2026-07-30`.
`scripts/build-public-tree.sh` rewrites that host to `n8n.your-host.example` in
the published tree, which is good hygiene and **not** a security control: it
cannot un-publish a name from a log that already holds it. There was also no
gate in front of n8n — a POST to a nonexistent path returns `404`, not `403`, so
the proxy forwards everything.

**Severity, stated the way §1 requires.** These point at a Remote *Sandbox* and
a demo Zendesk account; no real customer data was reachable. The damage was to
`audit_log` — the table every honesty claim in `README.md` rests on. A stranger
able to write rows into it is what turns *"every decision is recorded"* from a
guarantee into a hope.

**What was built.** One shared secret (32 crypto-random bytes, 64 hex) in ten
places: nine Zendesk webhook records (`authentication.type: api_key`, header
`X-YOUR-WEBHOOK-TOKEN`) and one n8n credential (`n8n Secure Zendesk Comm`)
selected on all nine webhook nodes. Nine separate secrets were considered and
rejected — all nine endpoints share one n8n instance and one Zendesk account, so
per-endpoint secrets buy no isolation while multiplying the chances of a typo
that silently takes a use case offline. The eight graphs still on
`responseMode: "lastNode"` were moved to `onReceived` with a fixed literal body,
finishing what §3.9x's F-4a fix had only done for UC-01.

**Ordering is the load-bearing decision, and it is counter-intuitive.** Zendesk
gets the header FIRST; n8n starts checking SECOND. n8n ignores a header it is
not configured for, so step one is observably a no-op — and by the time n8n
enforces, every delivery already carries the credential, so **not one request
fails**. The reverse order produces failed deliveries, and a Zendesk webhook
that fails once **circuit-breaks and cannot be repaired**: correcting its
endpoint does not revive it, and the only fix is a new webhook plus a repointed
trigger, nine times. `webhookResponseSpec.js`'s header had predicted exactly
this five days earlier, which is why F-4b was filed separately rather than
bundled.

**Proved in both directions, because either alone is misleading.**
`npm run verify-webhook-auth` (new, `scripts/verify-webhook-auth.mjs`) reads
each graph, then POSTs to each production path unauthenticated and requires
`403` **and no new execution** — 9 checked, 0 defective. It follows the
`verify-deployed` contract and exits **2**, never 0, when it cannot reach n8n;
all three exits were negative-controlled (bad key → 2, absent key → 2, a path
pointed at a 404 → 1). But a `403` sweep only proves the door is *shut*, and a
lock nobody can pass is an outage — so the positive direction was proved by a
**real Zendesk ticket**: #135 → trigger → invocation `16:58:10Z success HTTP
200` → execution `9279`, `pinData: {}`, **14 of 14 nodes success**, real Remote
read, `uc09_adjustments` row `8d395fd6-…`, real `audit_log` row
`f3f5e07b-5fe1-4995-833a-ded4cdab31df`, real Zendesk write. That makes UC-09 the
**fifth** graph with real unpinned execution proof and the **second** driven by
a real inbound ticket. It decided `escalate / identity_not_verified`, so it
proves the chain and the fail-closed path — **not** UC-09's approval path, which
still nothing has exercised.

**Two detectors were caught lying, in opposite directions, about the same fact.**
n8n **prunes any parameter equal to the node's default** before saving, and the
Webhook node's default `responseMode` *is* `onReceived` — the value this project
wants. So a node configured through the editor stores no `responseMode` key at
all. An ad-hoc check written during this session defaulted the missing key to
`lastNode` and reported nine healthy graphs as a live disclosure; and
`webhookResponseParamIssues()` compared strictly and reported the same nine as
DRIFTED, with a message naming F-4 as reopened while it was shut — so
`npm run verify-deployed` would have gone red on nine correct nodes. Fixed in
`f5336c3` via `RESPONSE_MODE_NODE_DEFAULT`, with negative controls (an explicit
`lastNode` must still fail, and so must a third mode), because *absent means
default* is one careless edit away from *accept anything*. It had been latent
since F-4a shipped and could only ever surface this way: those nodes had only
ever been written by an API `PUT`, which prunes nothing, so **the first hand
edit in the editor changed the stored shape on all nine simultaneously.**

**Two traps recorded in §6 rather than solved.** Zendesk's `POST
/api/v2/webhooks/test` builds a synthetic `fake_webhook` carrying **no
credentials** — it drops declared authentication and the request body — so it
reports every correctly-secured webhook as broken. It returned `403` against a
UC-09 configuration a real delivery accepted minutes later, and twenty minutes
went into believing the tool over the system. And n8n's `Authentication → Header
Auth` dropdown offers every `httpHeaderAuth` credential on the instance,
including the **outbound Remote API token** (`Remote Sandbox- Christina`), which
was selected and saved to production UC-01 before being caught by reading the
live graph back. Had it stayed, callers would have had to present a
payroll-capable Remote credential, pasted into nine Zendesk config screens. No
delivery occurred in that window — luck, not design.

**Also corrected here:** CLAUDE.md asserted in two places that the n8n API
returns `403` to this container. It returns `200`; every reading in this session
used it. A stale environment claim of that shape is expensive, because it tells
the next agent a capability is absent and it stops trying.

**Files:** `docs/WEBHOOK-AUTH.md` (new) · `scripts/verify-webhook-auth.mjs`
(new) · `package.json` · `workflows/nodes/webhookResponseSpec.js` ·
`test/n8nWebhookResponseParity.test.js` · `qa/evidence/UC-01/2026-08-22-uc01-e2e/FINDINGS.md` ·
`qa/evidence/UC-01/2026-08-22-uc01-e2e-5/_scripts/redeliver.mjs` ·
`workflows/README.md` · `CLAUDE.md` · this file.

---

### 3.93 UC-01's portal card, checked against Remote's own published form — and a picker that called eleven relationships "employee"

**2026-08-28.** Two reports in one sitting, both about the same card, and the
second is the more serious of the two.

**Report 1 — "I cannot find options to quick-fill."** The UC-01 card rendered a
**"Quick-fill a scenario" heading above an empty row**. `SCENARIOS` in
`src/portal/assets/app.js` had keys for `uc02`…`uc09` and none for `uc01`, and
the guard in `test/portalCopy.test.js` asserted `Object.keys(all).length === 7`
— so *a request type with no scenarios at all* and *the count being correct*
were the same observation. It has been like that since the card shipped.

**Report 2 — "I thought Carlos Silva was a contractor, why is he showing as an
employee? Is it as if everybody there is an employee?"** He is a contractor —
`src/remote/mockServer.js` mirrors a real Sandbox record whose `contract_type`
is genuinely `contractor`, the note under the picker said so in prose, and the
letter refused him `engagement_not_eor_contractor`. **The dropdown said "Carlos
Silva — employee", and said it about all eleven people.**

The cause is one word doing two jobs. `persona.kind` answers *who is at the
keyboard* — two values, `employee` and `company_admin`. `contract_type` answers
*what the legal relationship with Remote is*. Both spell one of their values
"employee", so the label was **strictly true and read as a claim about something
it had never been about**, on the one card whose entire demonstration is that a
contractor is refused. The screen contradicted the answer it was about to give.

**The fix is where it is, not what it says.** It would have been half a line to
add `engagement: "contractor"` to each persona in `personas.js`. That is the
version that drifts: a second hand-maintained copy of a fact the employment
record already holds, free to disagree the moment either changes — *which is
precisely the failure that had just happened one level up*. `labelledPersonas()`
instead reads the same `contract_type` that `classifyEngagement()` branches on,
so the caption and the refusal are one fact. It **fails soft** — an unreadable
record is captioned with **nothing** rather than a default, because captioning
an unknown record "employee" is the defect being fixed.

#### What Remote actually asks for — Rung 1, fetched rather than inferred

`support.remote.com` is itself a Zendesk Help Center, so every article has a
JSON representation:

```sh
curl -s "https://support.remote.com/api/v2/help_center/en-us/articles/<id>.json"
```

Seven articles fetched live, all `[CONFIRMED]`, written up in
**`docs/UC01-INTAKE-FIELDS.md`**. This **upgrades `docs/INTAKE-RESEARCH.md`
§6.5**, which reached the same headline judgement and marked itself `[INFERRED]`
because it only ever had search-result summaries. Four findings matter:

1. **The standard form is one field** — a language, and a button
   (`4422684040461`). No name, no date, no reason, no addressee. Not
   minimalism: **the platform already holds every fact the template prints, so
   there is nothing to ask.** A form asks for what the system does not know.
   That is also why UC-01's self-service path takes no identity input.
2. **The template's contents** (`8429306915085`) match 5 of our 6
   `STANDARD_LETTER_FIELDS` — and **salary is on neither list**. UC-01's
   over-scope refusal was argued in this repository from first principles about
   disclosure; it turns out to be *what Remote's real template does*. A stronger
   position than the one we thought we were in.
3. **The eligibility article** (`17537524163853`) names the same four classes
   `engagementEligibility.js` arrived at from DRIFT-074, before anyone here had
   read it — **two documents, written independently, refusing the same people
   for the same reasons.** Each is now a quick-fill chip driven by a persona
   whose record genuinely carries the disqualifying fact.
4. **Third-party verification is a mailbox**, answered only *"after receiving
   permission from you (the employee)"* (`19201215338509`) — G-3's whole premise
   in Remote's own words, including a telephone route answered by a **callback
   to a supplied number**, which is itself an identity control we do not model.

#### The engagement taxonomy, and the question "does a contractor get one at all?"

**No — and the reason is stronger than "not eligible".** Remote is **not a party
to the contract**: *"the contractual relationship is strictly between the
Contractors and the Client (Not Remote)"* (`4410706624909`); *"Remote is not a
party to that agreement"* (`4410700925709`). And the letter attests employment
**with a Remote legal entity** (§3 of the new doc). So issuing one would be a
false statement about a third party's legal relationship — the sentence
`engagementEligibility.js` has carried in its header since it was written, now
confirmed from the vendor.

Remote publishes **two** enums, both on the employment object:
`type` (`employee` · `contractor` · `direct_employee` · `global_payroll_employee`)
and `employment_model` (`eor` · `global_payroll` · `peo`), plus `contractor_type`
(`standard` · `cor` · `plus`). Three corrections followed:

- **`hris` added to `NON_EOR_ENGAGEMENTS`, in BOTH copies of the gate** (§6 —
  the gates exist twice). It is the create-side spelling of `direct_employee`
  and was falling through to `eor_status_unknown`: same refusal, wrong reason.
- **`restClient.js`'s "a contractor has `employment_model: "contractor"`" is
  wrong** — there is no such value. **The code was already right** (it reads
  `employment_model || type`, and the `|| type` arm carries every contractor);
  only the comment was wrong, which is the more expensive of the two, because
  the next person to "simplify" that fallback would have deleted the working arm
  on the comment's authority.
- **`eor_employee` has zero occurrences in Remote's documentation.** Kept —
  nothing can carry it — but now flagged in its own JSDoc the way `full_time`
  and `part_time` already were.

**Two things deliberately NOT changed**, recorded in `UC01-INTAKE-FIELDS.md`
§9.5 rather than patched, because each is a judgement call about what Remote's
product means: **`peo` is in neither list** (Remote *co-employs* — a legal
employer but not the employer of record; it fails closed today, so nothing
unsafe is shipping, but it refuses as "we could not read this engagement" when
we read it fine and have no rule for it), and **`contractor_type: "cor"` makes
our deflection copy factually wrong**, because a COR contractor *does* sign an
agreement with Remote (`4410700925709`) — so "your contract is with the client,
not Remote" is untrue for them.

#### Two guards that failed on coverage going UP

`portalCopy.test.js` and `portalResultDialog.test.js` both restated a count
(`7`) that UC-01's new chips made `8`. **A literal count cannot tell "a type
lost its scenarios" from "a type gained some"** — and the second test's failure
message printed *"Escape was only exercised on"* above a list of all eight.
Both now compare against `REQUEST_TYPES`, which is stricter *and* says what they
always meant: **every type the portal serves must have a way to demonstrate
itself.** UC-01's empty row survived for exactly as long as the number said 7
and meant it.

#### Also

- **The language picker is honest about what it cannot do.** `src/uc01/letter.js`
  has one template. A picker offering twenty languages and quietly answering all
  of them in English is a **fake control** — this repository has already paid for
  one of those (n8n's "Response Data" dropdown, §6). So the limit is stated
  *before* the click, a non-English choice is recorded as its own document, and
  it is said back to **the requester**, not specialist-only, per
  `specialistDetail()`'s rule that a statement of a limit never goes one-sided.
  Remote states the language count four different ways across four of its own
  articles (11 / 15+ / 20 / 24) and the only enumerated list belongs to the
  **offer** letter — so the picker's twenty options are a **ladder rung-3
  substitution**, labelled as one.
- **`setFieldValue()` now announces its writes.** Assigning `.value` fires no
  event, so the character counter sat at **"0/500" above 48 characters** of
  quick-filled text, and the continuation's gap marks never heard a prefill
  either.
- **`src/livedemo/` gains four example requests** — one per outcome the ticket
  channel can reach (standard, customized, third-party, over-scope), each
  written from the articles above. The one surface that writes to a real account
  was the only one where every demonstration had to be typed from memory.

**Verified:** 4,274 tests, 0 fail, 2 skipped. Every persona was driven through
`issueSelfServiceLetter()` before its chip was written, so a button marked
"refused" is one that was observed refusing. Rendered and screenshotted in
Chromium end to end.

**Files:** `docs/UC01-INTAKE-FIELDS.md` (new) · `test/portalUc01Intake.test.js`
(new) · `src/portal/assets/{index.html,app.js}` · `src/portal/server.js` ·
`src/livedemo/assets/{index.html,app.js,style.css}` ·
`src/uc01/engagementEligibility.js` · `workflows/nodes/gates.js` ·
`src/remote/restClient.js` · `test/{portalCopy,portalResultDialog,portalCountryPicker}.test.js` ·
`CLAUDE.md` · this file.

---

### 3.94 UC-04 — the employer's approval belongs to the CUSTOMER, and two of the three stages had the wrong owner

**2026-08-30.** UC-04 modelled one approval, made by a `mobility_specialist` in
the ZAF sidebar and written to Remote as `approved_by_manager`. That status is
the customer's manager's decision, and a Remote CX specialist was making it and
signing it. Nothing about it looked wrong from inside: `APPROVER_ROLES` carried
the entitlement, the sidebar had the button, `approvalPolicy.js` had the floor,
the audit row had a name on it. **It was consistent about the wrong actor**,
which is the failure mode a consistent system cannot detect about itself.

Raised by the project owner, who knew Remote's product: *"Is it a customer's
employer that approves? ... It will now be that remote own employee who approve.
No. That's not how it's done."*

#### What Remote's API actually says (rung 1, read live)

Four endpoints exist on this resource — two `GET`, two `PATCH`. **No `POST`.**
`PATCH` accepts exactly two transitions from `pending`, and the object carries
an `employer_approver` field whose published example value is
`user0@company.com` — a customer address, not a Remote one. `approved_by_remote`
is a status the object can hold that **no endpoint can set**.

| Stage | Decider | Surface | Written to Remote? |
|---|---|---|---|
| 1 · request | the employee | `/portal` | no — no `POST` exists |
| 2 · employer approval | **the customer's manager** | `/remoteui` | ✅ the only write the API allows anyone |
| 3 · Remote's mobility review | Remote's Mobility Team | ZAF sidebar | ❌ no endpoint at all |

The ladder was checked before anything was built, rather than assumed:

```
GET  /v1/work-authorization-requests           -> 200, correct shape, 0 rows
POST /v1/work-authorization-requests           -> 404
POST /v1/employee/work-authorization-requests  -> 404
GET  /v1/employee/work-authorization-requests  -> 404
```

Rung 2 answers the read and cannot create. So the request **object** is a rung-3
stand-in and the stage-2 `PATCH` stays **real** wherever a record genuinely
exists — a real record's approval must never travel through a fake. Recorded as
the owner's product call in `qa/HUMAN-DECISIONS-REQUIRED.md` §K14.

#### Stage 1 — the employee may file their own request

`src/uc04/submissionIdentity.js` is now the one rule, imported by `workflow.js`
and `textIntake.js`. The gate had been `session.companyId === employment.company_id`
— an **admin-only** shape — so the employee who actually submits in Remote's
product was refused by our own portal, with a reason describing our plumbing as
though it were a finding about the traveller. The portal then grew a rule on top
of that defect (*"a workation request is filed by the company admin"*), which was
a consequence, not a decision, and contradicted `UC-04.md` §1/§2.

A submitter must be a **party to the record**: the subject, or an admin of the
employing company. Both sides must be present and non-empty **before** any
comparison — `null === null`, `""` and whitespace all refuse, which is the exact
shape that once passed UC-06's and UC-09's identity gates. Widening submission
widens approval by nothing: the function's only truthy return is `verified`, and
every other gate is untouched.

Two things this uncovered:

- **The n8n port compared against the wrong id.** Its `employment.id`
  deliberately falls back to `request.employmentId` for display, so an identity
  check against it would verify a session's claim against a body's claim with no
  Remote record between them. It now takes `recordId` off the raw payload only.
- **The audit row recorded `"unauthenticated"` for requests that had just
  PASSED the gate**, which would have collapsed every employee's history onto one
  unscopable owner.

#### Stage 2 — the customer's manager gets a surface

`/work-authorizations` in `src/remoteui/`, mounted on the deployment at
`/remoteui` behind `PORTAL_ACCESS_KEY` and failing closed like `/portal`. Two
verbs exist anywhere in it; `approved_by_remote`/`declined_by_remote` are
exported **only** so a test can assert we never send one. A decline with no
reason is refused rather than given an invented one. Company scope comes from
the **server session** and is checked by reading each employment back from
Remote; there is no argument, param, body field or header through which a caller
can name a company. Which world a write reaches is keyed on the record's
**origin**, never on the shape of its id.

#### Stage 3 — the sidebar stops making the customer's decision

UC-04's panel offers no approve/decline — no `renderActions`, no `view.post`,
and the server reports `actionable: false` — and it **explains the absence on
the panel** rather than leaving a blank, because a missing button is
indistinguishable from a broken one. It deliberately does not borrow the 🔴
tier's *"no execution path exists"*: UC-04 has one, it is simply not on that
screen. The "Who decides this" card had been printing the **employer's**
signature under a Remote mobility specialist's name; that slot is now null and
the settlement still renders in full in the decision card.

#### Three defects found by DRIVING the surfaces, none of which a test saw

1. **The stand-in asserted a company the record contradicts.** It claimed
   `co_amend_01` for an employee whose employment record says `a9d4ce72-…`, so
   one response told the reader Chris Lee was **not** in this company (scope) and
   that his request **was** this company's to decide (requests). Rung 3
   overriding rung 2, which the ladder forbids outright. The stand-in index now
   names only an employment and has no way to acquire a company id at all.
2. **`remoteProbe` could not tell two claims apart.** It reported
   `employmentsQueried: 0, rowsReturned: 0, failures: []`, which reads as
   *"Remote holds nothing"* and meant *"we asked Remote nothing"*. It now carries
   `asked` and a `verdict`, and the page renders the two differently.
3. **`npm run uc04-api` had never once seeded a decidable case.** Its six demo
   cases name `emp_active_001`, a **mock** fixture, and were built through
   whichever Remote client the server uses — so on any machine with a real
   `REMOTE_API_TOKEN` (every machine this is demonstrated on) the Sandbox 404'd
   it, `getEmployment()` answered null, and the identity gate correctly refused.
   **All six came up `escalate / identity_not_verified`**, so the UC-04 sidebar
   demo has only ever shown six identity failures — no `ready_for_approval`, no
   `blocked`, none of the risk spread its own labels describe.

   **A test process has no token, so the mock answered and the seed passed: the
   defect existed only where a credential existed.** That is §3.30's shape again
   — "structurally cannot succeed" and "appropriately cautious" are
   indistinguishable from outside, and the gate was working perfectly throughout.
   The seed now reads the world its fixtures live in; the server keeps the
   configured client for real traffic. `test/uc04SeedWorld.test.js` pins it, and
   was negative-controlled against the pre-fix file rather than assumed to bite.

#### Proven by driving, not by the suite

Both directions at every stage, over HTTP: employee files own trip →
`ready_for_approval`; about someone else → `403 not_your_employment`; sidebar →
`actionable: false` with the explanation; employer route →
`employerActionable: true`; approve → `PATCH` accepted **and the request leaves
the pending list when read back**; decline with no reason → 400; a third verdict
→ `400 unknown_action`; Lars van der Berg quoted by id → `403 not_your_company`,
with the test flipping the console to his company so the admitted set
**reverses** — a boundary that only ever refuses one person could be refusing him
for any reason.

Verified live after deploy: `/remoteui` and `/remoteui/work-authorizations` 200,
`10 of 11` in scope, probe `asked: true / answered`, and `401
portal_access_key_required` without the key.

`npm test`: **4714 tests, 4711 pass, 0 fail, 3 skipped.**

#### The n8n port was half-done, and publishing it is what revealed that

`workationGates.js` was deployed to `WORKFLOW_UC04_ID` under §7b, read back
byte-for-byte (`verify-deployed`: 58 checked, 0 drifted) with
`activeVersionId === versionId`. **Reading the graph afterwards found the other
half:** `normalizeWorkationRequest.js` — the node immediately upstream, and the
only thing that constructs a session on the n8n path — built one out of
`companyId` + `authenticatedAdminId` and nothing else. It **stripped
`authenticatedEmploymentId` on the way in**, so the employee-subject leg was
dead in production the moment it shipped: present in the deployed body,
unreachable by any input.

**Nothing could have caught it.** `n8nUc04Parity.test.js` hands the gates node a
session directly — the right shape for comparing two decision engines, and it
means the normalizer has never been in that loop. Two nodes each correct in
isolation, wired into something that cannot work.
`test/n8nUc04NormalizerSession.test.js` now covers the seam, and was
negative-controlled against the pre-fix body (3 of its 6 fail there). The
session is whitelisted field by field rather than passed through, because that
object is the one thing downstream treats as authenticated.

#### Proven live, both directions, nothing pinned

Driven through the production webhook after republishing both nodes:

| | execution | decision | `uc04_authorizations` | `audit_log` | `audit_trace` |
|---|---|---|---|---|---|
| employee files their own trip | `10663` | **`ready_for_approval / all_gates_passed`** | `39735ffb` | `e6f07084` | `7493dbce` |
| employee names someone else | `10661` | `escalate / identity_not_verified` | `8c72919d` | `af8c176b` | `eaa8500f` |

`pinData: null` on both, 13 nodes each, every node `success` except the final
Zendesk write, which fails `400 — id must be an integer` on the descriptive
proof ref (`uc04-idproof-self-b`). That failure sits **downstream of the audit
write**, which is exactly the ordering the architecture exists to guarantee —
the same shape as the UC-04/UC-05 proofs in §3.24. **Do not read the run status
as the verdict in either direction.**

The positive case is the load-bearing one: before this pass an employee filing
about themselves could only ever reach `escalate / identity_not_verified`, and
the first attempt (`10660`) landed on `blocked / factors_invalid` — a gate
*after* identity, which is itself the proof that identity had passed. Gate order
in the deployed body puts identity at line 632 and factors at line 652.

### 3.95 The two 🔴 dossiers stop citing a model where the instrument belongs — UC-07 and UC-08 reach the retrieved corpus

**What was wrong, measured rather than reasoned about.** UC-07 and UC-08 are the
two use cases whose entire deliverable is a **dossier for a specialist**. Both
searched a hand-written corpus in their own source file — three sentences in
`src/uc08/treatyRetriever.js` (`TREATY_CORPUS`, paraphrases of the OECD **Model**
Tax Convention) and six in `src/uc07/mobilityRetriever.js`. Nine sentences,
quoting no retrieved document. Driven against the real functions on the four
demo country pairs (`docs/DEMO-COUNTRIES.md`):

| Question | What the specialist got |
|---|---|
| US→PT, naming the US–Portugal treaty | **nothing** |
| NL→PT, naming the Netherlands–Portugal convention | **OECD Model, Article 4** |
| US→CA, naming the US–Canada convention | **OECD Model, Article 15** |
| CA→NL totalization | *"Totalization agreements — general principle"* |

Meanwhile `docs/knowledge/layer-1-statutory/` held **28 documents / 112
passages**, retrieved from their own publishing authorities with the source
bytes' SHA-256 recorded — including a governing instrument for **every one of
the six unordered demo pairs**: D-24 (NL–PT), D-25 (CA–NL), D-26 (CA–PT),
D-27/D-28/D-29 (the three US conventions, full IRS PDFs), plus every domestic
residence rule (D-31 NL, D-32 PT, D-33/D-34 CA, D-35 US).

`docs/RETRIEVAL.md` had measured the same thing from the other side and named
the remedy — *"replace the hand-written passages with a country-filtered lexical
index over the 106 real statutory passages"* — adopted by UC-07's and UC-08's
decision passes as `T-26`/`T-27`, and its own status line read **"nothing is
built."** This is that build.

**What was built.**

- **`src/knowledge/citationCorpus.js`** — 55 passages / 14 documents, GENERATED
  from the sidecars by `scripts/build-citation-corpus.mjs` (`npm run
  build-citation-corpus`). Generated rather than walked at run time because the
  retriever runs in three places that do not share a filesystem: this repo, a
  Vercel function, and an n8n Code node. Every passage carries publisher, source
  URL, retrieval date and the source SHA-256.
- **`src/knowledge/documentCountries.js`** — which jurisdictions each document
  speaks for, **hand-written**, because a filename heuristic under-tags the three
  sidecars that carry more than one instrument and drops the EU regulations
  entirely. A document with no entry is EXCLUDED and the test names it, rather
  than defaulting to "no countries" — which is indistinguishable from "never
  matched" at the point a specialist reads the dossier.
- **`src/knowledge/lexicalIndex.js`** — BM25 with a country filter, a relevance
  floor and document diversification.
- **`src/knowledge/statutoryRetrieval.js`** — the one leg both use cases call.

**Three properties, each pinned by test.**

1. **An instrument always outranks a model.** `authority` sorts before score, and
   the model paraphrases are only reachable when the statutory index returns
   nothing — at which point the citation says so in `matchedOn`. `CLAUDE.md` §7
   item 17 names the harm exactly: a model offered where an instrument belongs
   *"reads exactly like an answer."*
2. **A bilateral instrument needs BOTH its parties.** Tagging D-24 as {NL, PT}
   and asking "does it serve any wanted country?" makes the Netherlands–Portugal
   convention answer a **US**–Portugal question — a real treaty, not this pair's
   treaty, and authoritative-looking while being wrong. `pairs` states the
   parties explicitly because three sidecars carry several instruments each and
   the parties cannot be read off a flat country list.
3. **The country filter never manufactures silence.** A question naming no
   recognised country searches everything; filtering to nothing on a parsing miss
   would turn a bad parse into an empty dossier.

**The relevance floor, and why a score threshold was not the answer.** BM25 always
ranks something, so without a floor *"Please reset my password"* cited a tax
convention — "please" occurs in statutory prose. A SCORE cut does not separate
the cases: measured over five realistic inquiries and five plainly unrelated
ones, the best irrelevant hit scored **5.20** while a genuine certificate-of-
coverage question scored **6.20**. What does separate them is how many distinct
query terms matched — relevant `5, 4, 3, 3, 5` against irrelevant `1, 2, 1, 1, 1`.
So the floor is a term count, with one escape hatch for a short pointed query
("totalization Canada") via two RARE terms, rarity measured against this corpus.
The ten calibration queries are kept verbatim in
`test/statutoryRetrieval.test.js`, so a corpus change that destroys the
separation fails the suite.

**What it produces now**, same four pairs:

| Pair | Citations |
|---|---|
| US→PT | the three US income tax conventions · Portugal CIRS art. 16 · EU Reg. 987/2009 |
| NL→PT | Portugal CIRS art. 16 · Netherlands AWR art. 4 · **the NL–PT convention** |
| CA→NL | **Canada's social security agreements** · Netherlands AWR art. 4 · EU Reg. 883/2004 |
| US→CA | the three US income tax conventions · US substantial presence test · Canada ITA s. 250 |

**Four defects found while building it, three of them mine.**

- **The country matcher broke on punctuation, twice.** Matching `" portugal "`
  against *"…in Portugal, dual residency…"* fails on the comma; keeping `.` in
  the strip set to preserve "u.s." then broke *"…to Portugal."* on the full stop.
  It failed SOFT — an empty country list searches everything — so nothing errored
  and the only symptom was a worse ranking.
- **A comment claimed an ordering the code did not hold.** `search()` says
  "authority first, score second", and `diversifyByDocument()` then reorders,
  so an instrument from an already-seen document can land below a first-seen
  administrative passage. The guarantee is narrower than the comment claimed;
  both the comment and the test now state the narrow version, and the guarantee
  that actually protects a specialist — no model beside an instrument — is
  unaffected.
- **A test named the wrong variable.** The hyphenation test compared two
  sentences differing in five words *and* a hyphen, then blamed the difference on
  punctuation. It now compares one sentence one character apart.
- **The n8n port indexed only its own feed** — an obvious saving that silently
  breaks parity, because BM25's IDF and average document length are computed over
  whatever is in the index, so a 6-passage index and a 55-passage index cross the
  relevance floor at different points. **UC-07's parity test caught it; UC-08's
  would not have**, because UC-08's compares citation ids only and UC-07's
  compares the whole dossier. The same test also caught the n8n copy dropping
  publisher/URL/date/SHA-256 to save ~4KB — which would have meant the n8n path
  showing a quote with none of the four signals a specialist uses to trust it.

**One pre-existing guard needed a narrow exclusion.**
`test/portalRequesterFacts.test.js` refuses a bare ISO country code on a
requester-facing surface. *"Regulation **(EC)** No 883/2004"* is the formal
citation form of an EU legal act and `EC` is Ecuador, so it reported four leaks
in titles that name no country. Excused only in the form `(EC)`/`(EU)` followed
by `" No "`, with its own negative control asserting `Ecuador (EC)`,
`Spain (ES)` and a bare `(EC)` all still fail.

**Both n8n ports are regenerated by the same script**, so the two copies cannot
drift by hand, and `test/citationCorpusFreshness.test.js` regenerates in memory
and compares — a stale corpus fails the suite rather than reaching a specialist
carrying a publisher, a URL and a hash beside text the document no longer holds.
`npm run verify-deployed` still byte-diffs against the live graphs; **neither
graph has been republished** — see §7.

**Not changed, and named rather than folded in.** `DOWNLOAD-MANIFEST.md` routes
the bilateral conventions and the social-security agreements to **UC-04 and
UC-08 only**, so UC-07's statutory feed is D-17 and D-20 — six passages. A
permanent relocation arguably raises the same instruments, but that is a curated
routing decision and rewriting it is its own work order.

Suite: **4768 tests, 4765 pass, 0 fail, 3 skipped.** The 27 tests in
`test/statutoryRetrieval.test.js` were negative-controlled against a stubbed
pre-fix retriever: **10 of 27 fail** there.

### 3.96 The country filter's own hole — and why "recognise" and "hold a document for" must be different questions

**Found by updating the portal prefills, and introduced by §3.95 rather than by
the code §3.95 replaced.** `countriesNamed()` knew four countries — the demo set
— so *"Germany and Spain"* named nothing it recognised. This file's own property
2 turns that into **search everything**, and a Germany–Spain dual-residency
question came back with Canada's deemed-residence rule, Portugal's CIRS art. 16
and the US substantial presence test: **three real instruments, correctly
quoted, about three countries nobody asked about.**

That is a **worse** failure than the OECD Model paraphrase §3.95 removed. A model
is at least not wrong about a jurisdiction. This was authoritative, specific,
carried an IRS URL and a SHA-256, and was about the wrong place.

**The fix is a distinction, not a longer list.** The vocabulary must cover
countries the corpus holds **nothing** for — that is precisely what lets the
filter come back empty and fall through to the labelled model paraphrase.
Recognising a country and holding a document about it are two different
questions, and only the first belongs in the vocabulary. `countriesNamed()` is
now derived from `src/shared/countryNames.js` (249 countries) plus an explicit
demonym table. DE/ES now returns Regulations 883/2004 and 987/2009 — multilateral
instruments that genuinely govern both.

**Bare two-letter codes are matched only in UPPER CASE.** Lower-cased, the ISO
list is a minefield of ordinary English: the hand-written table carried
`us: "US"`, so *"please tell us about the policy"* named the United States.
`it`, `in`, `no`, `is`, `at`, `be`, `or`, `me`, `so` and `am` are all words and
all country codes. Written `US`, written `us` — the case is the signal.

**The countries now come from the PARSE, not the prose.** A person asking whether
they owe tax in Toronto names Canada and never mentions being employed in
Portugal, so the Canada–Portugal convention could not be reached however good the
ranking was. `parsed.jurisdictions` and the request's own `targetCountry` are
both already established at the call site. An empty list is passed as **null**,
deliberately: `null` means "read the text" and `[]` would mean "restrict to
nothing" — a parse that found no jurisdiction must not silence the retriever.

**The portal prefills moved onto the agreed demo set**, because the retriever is
country-filtered and the old ones named Germany, Spain, the UK and France —
countries with no bilateral instrument in the corpus, so they could only ever
produce the weakest dossier this use case has:

| Scenario | Was | Now | What it reaches |
|---|---|---|---|
| `uc08-dual` | DE / ES | **US / PT** | the US–Portugal convention (D-28, IRS) + PT CIRS art. 16 |
| `uc08-183` | GB | **PT → CA** | Canada ITA s. 250 + the CA–PT convention |
| `uc08-a1` | DE → FR | **NL → PT** | the EU regulations **and** the NL–PT convention |
| `uc07-review` | GB → DE | **US → NL** | the SSA totalization table's US–NL row |

`uc08-183`'s text also names both countries and the threshold: the shorter draft
retrieved **one** citation where this retrieves three.

**BOTH GRAPHS REPUBLISHED AND PROVEN, same day.** `Build Dossier`
(`WORKFLOW_UC08_ID`) and `Relocation Gates` (`WORKFLOW_UC07_ID`), read back
**byte-identical** to their files, `versionId === activeVersionId`,
`verify-deployed` **58 checked · 0 drifted**, and each driven through its
production webhook with **`pinData: None`**:

- **UC-08 execution `10708`** — 11 of 12 nodes `success`; `uc08_dossiers` row
  `1c39305b`, `audit_log ad32eff9`, a `workflow_claims` row, citing D-35, D-32
  and D-27/28/29 with publishers *Internal Revenue Service* and *Autoridade
  Tributária e Aduaneira*.
- **UC-07 execution `10710`** — 10 of 11 nodes `success`; route parsed `US → NL`;
  citations are Remote's process guidance FIRST (month-end alignment, immigration
  guidance, PTO portability) and then D-17 and D-20, which is the order
  `#unconfiguredLeg()` documents.

**Both runs are marked `error` and both are proof.** The single failing node in
each is the final Zendesk write — `Bad request` on a descriptive `externalRef`
where Zendesk wants a numeric ticket id — and it sits **downstream of every
durable write**, which is the ordering the architecture exists to guarantee.
Read node status, never run status.

Suite: **4771 tests, 4768 pass, 0 fail, 3 skipped.**

### 3.97 Every portal quick-fill moved onto the demo countries — all 48, not the four §3.96 reached

§3.96 moved four scenarios and left thirty-two. This is the sweep. **48
scenarios audited; every country field is now NL, PT, CA or US**, with two
deliberate keeps.

| Use case | Was | Now |
|---|---|---|
| UC-03 | `trip`/`terminated` ES · `letter`/`letter-no-entity` DE | **NL** · **PT** |
| UC-04 | fifteen rows on DE/DE → ES (and DE → DE) | **PT/PT → NL** (and **PT → PT**) |
| UC-05 | `sandbox-gb` · `de` | **`sandbox-ca`** · **`nl`** |
| UC-08 | `empty` GB | **CA** |

**PT → NL is the analogue of DE → ES, and the choice is not cosmetic.** Both
countries are EU, so the A1 consideration still fires; and NL is Schengen but
**not** in `DNV_COUNTRIES`, so the 90/180 arithmetic is still **applied**.
Routing these through **PT as the destination** — the obvious move, since PT is
in the demo set — would have silently **suppressed** the Schengen check and
taken every travel-history scenario with it. That is precisely the failure mode
`DNV_COUNTRIES_PROVENANCE` exists to warn about: membership removes a control
rather than adding one, and the result looks exactly like a trip that was
assessed and cleared.

**Verdicts were snapshotted before and after rather than reasoned about.**
14 of the 15 UC-04 scenarios are identical in decision, reason, flags **and
Schengen peak** — including *"Exactly on the Schengen line"* at **90** and
*"Over the Schengen limit"* at **121**. Only `uc04-pe` changed, and additively:
still `high` on `pe_risk_dape`, now also carrying an A1 consideration and a
Schengen row at 10 of 90. Its visa moved from `business_visa` to
`schengen_short_stay` because it had to — every non-Schengen country in the demo
set hard-blocks a business visa on its own work-permit rule
(`us_requires_work_permit`, `ca_requires_work_permit`), which would decide the
case at the document gate and never reach the duties the scenario exists to
isolate.

**UC-05's two are genuine substitutions, not renames**, and both are stated as
such in the file. No demo country has the UK's sliding scale (ERA 1996 §86), so
that row now shows **Canada** — `basis: "customary"`, whose citation states
*"no statutory employee minimum; varies by province"* instead of manufacturing a
statute. That is the better thing to demonstrate: *the system did not invent a
rule* is harder to show than arithmetic. Germany's month-anchor becomes the
**Netherlands'**, which anchors on month **end** rather than the 15th — same
shape, so the row still shows *"a leaving date has to LAND on something"* rather
than *"clear a bracket"*.

**Two deliberate keeps**, both because no demo country can stand in: **Iran**
(`uc03-restricted`, `uc04-sanctioned`) exercises the real
restricted-jurisdiction list, imported from UC-03 rather than copied; and
**Brazil** (`uc05-sandbox-br`) is the only way to reach *"no rule in the
table"*, because all four demo countries are in it.

**Free text was swept too, and it had drifted from the fields above it.** Ten
`uc04-reasonText` values still said *"the Amsterdam team"*'s predecessor —
**Madrid** — while the destination had become the Netherlands, and one said
*"the London office"*. A reason line that names a different city from the
destination box is the same defect class as the persona picker that captioned
eleven relationships "employee": nothing is computed wrongly and the screen
contradicts itself.

**Two tests restated a value they could have read, and both blamed the change
rather than a regression.** `portalPlainAnswer.test.js`'s country check
hard-coded `/Spain/` and failed with *"the answered trip does not name its
destination"* while the answer under test said *"the Netherlands"* perfectly
correctly. It now derives the expected name from the scenario's own field —
`driveEveryScenario()` carries `fields` for that purpose, lifted from `app.js`
rather than copied, which is the same reason `SCENARIOS` itself is lifted.
`portalUc03StatedTrip.test.js`'s table is updated; the assertion beneath it —
that the reader's own label for the code appears in the scenario's own text —
is what actually enforces the agreement and needed no change.

Live bundle verified after deploy: the only country codes in the deployed
`SCENARIOS` are **CA, IR, NL, PT, US**.

Suite: **4771 tests, 4768 pass, 0 fail, 3 skipped.**

---

## §3.98 — the sidebar was contradicting the corpus it was displaying (2026-08-30)

**Found by rendering the ZAF sidebar for the flagship demo pair.** §3.95 moved
UC-08's retrieval leg onto the 55 retrieved statutory passages. The **view**
layer did not move with it, and nothing failed, because every sentence it
produces is prose and no test read the prose.

On a US/PT dossier the panel printed, directly above the IRS's own substantial
presence test, Portugal's CIRS art. 16.º and the text of the US–Portugal
convention:

> The reference corpus is **3 passage(s) of GENERAL principle** — OECD Model Tax
> Convention articles … **Nothing in the corpus matched this request at all.** …
> they are **not the governing instrument** for this request and **must not be
> cited to the requester** as if they were.

Three false claims and one dangerous one. *"Nothing matched"* was the `else`
arm of a ternary that had never been given a `statutory_lexical` limb. The count
came from `TREATY_CORPUS`, which is no longer where these passages come from.
And the last clause — a disclaimer written to stop a **paraphrase** being
over-trusted — was telling a specialist to discount the instrument in force.

**A stale caution is not the safe direction of a stale sentence.** It spends the
credibility of every other caution on the page.

### The discriminator is the citation, not the mode

Each passage carries `authority: "instrument" | "model"`, so the caution is now
attached to the model passages only — the population it was always about. A mode
label alone cannot do this: a `statutory_lexical` result **falls back** to the
OECD paraphrases when nothing statutory matched, and that result needs the
original warning verbatim. `citations_model_only` raises it as a ranked open
question, the same treatment `citations_keyword_matched` always had.

The same sentence was also wrong in the other direction. *"The bilateral
convention … is not one of the passages below, which are general principle
only"* was true of every result while the corpus was three paraphrases, and told
the specialist the instrument was absent from a list it was sitting in.

### And the panels rendered a bare title

Both dossier panels printed a citation as a title and nothing else — defensible
while every passage carried the same weight (none), and indefensible once the
IRS's own text and an OECD paraphrase appear in the **same list**. They now
render the publisher, the retrieval date, and whether this is the instrument in
force or the paraphrase it was drafted from. UC-08 leads with
`citationCoverage.scope`, which the API had computed for months and **no surface
had ever shown**.

`matchedOn` arrives in two shapes and only one carries its own framing — the
statutory leg emits a whole sentence, the older legs emit bare stems, which a
plain join turns into `(pto; liquidat)`. The prefix is added only where the
entries do not already say it. Caught by an existing test, which is the reason
that test was written to read the sentence rather than count the rows.

## §3.98b — a bundled bilateral document answering for a pair it does not govern

The same render exposed a defect one layer down, and it is the more serious of
the two.

`D-27+D-28+D-29` is **three separate conventions in one file** — US–NL, US–PT,
US–CA — and jurisdictions were mapped per **document**, so every passage in it
was eligible on any of the three pairs. Two failures followed:

1. the section holding all three quotations was split **by size**, so a US/PT
   dossier displayed the **US–Netherlands** article, and the next chunk opened
   with a bare `> …` because the `**US–Portugal**` label had landed on the chunk
   boundary; and
2. the operative clause of a treaty **never names its parties** (*"remuneration
   derived by a resident of one of the States…"*), so no scoring change could
   ever have told the three apart. The jurisdiction has to come from the
   structure, not from the words.

Each convention is now its own `###` in the source document — **markup only, not
one word of quoted treaty text is altered**, and the SHA-256s in the provenance
header are of the retrieved PDFs and are unaffected. The generator then narrows
a passage to the single pair its own heading names.

**That rule can only ever REMOVE reach.** A heading it cannot parse, or one that
names a pair ambiguously, leaves the passage eligible for the whole document's
set — so the cost of a miss is the status quo, while a rule that could **add** a
jurisdiction would be inventing coverage. Pinned by its own test.

Measured per demo pair on one query. Each now leads with **its own** convention
article and neither of the other two:

| pair | first hit | then |
|---|---|---|
| US/PT | US–Portugal, Article 16(2) | IRS substantial presence · CIRS art. 16.º |
| US/NL | US–Netherlands, Article 16(2) | IRS substantial presence · AWR art. 4 |
| US/CA | US–Canada, Article XV(2) | IRS substantial presence · ITA s. 250 |
| NL/PT | NL–PT convention, Article 15(2) | CIRS art. 16.º · AWR art. 4 |

Corpus **55 → 57 passages**, 14 documents.

### Proven on the live graphs, not on the files

Both node bodies regenerated, republished and read back — `verify-deployed`
**58 checked · 0 drifted · 0 unpublished**. Then driven through the production
webhooks, `pinData: null` on every run:

- **UC-08 execution `10739`** — a US/PT residency question returned three
  citations, all `authority: instrument`, led by **US–Portugal, Article 16(2)**.
  Durable `audit_log` row `a03b8c0d`.
- **UC-07 execution `10743`** — a US→NL relocation returned four: Remote's own
  process guidance **first**, then D-17 (Regulation (EC) No 883/2004) and D-20
  (SSA totalization status). Dossier row `76584fe7`, audit row `a6cbd3bc`.

Both runs are marked `error` and both are proof: the single failing node in each
is the final Zendesk write, on a descriptive `externalRef` where Zendesk wants a
numeric ticket id, and it sits **downstream of every durable write**. Read node
status, never run status.

**One thing worth recording because it looked like a regression and was not.**
An intermediate UC-07 drive returned **zero** citations. The same query returns
zero against the local retriever too — so parity holds and nothing had broken.
The probe sentence was simply too thin to clear the relevance floor, which is
the floor doing its job: it is what stops *"please reset my password"* citing a
tax convention. Realistic requests return what they returned before.

Every new test is negative-controlled — the six coverage tests, the panel test
and the two corpus tests all fail against the pre-fix tree.

Suite: **4781 tests, 4778 pass, 0 fail, 3 skipped.**

---

## §3.99 — the UC-04 and UC-07 panel audit (2026-08-30)

Two subagents audited the two panels for the §3.98 defect class — *a data layer
changed and the view layer did not move with it, and nothing failed because the
view's output is prose no test reads.* Every claim below was re-verified by
driving the real code before it was acted on. **Five defects fixed, one of them
introduced by §3.98 itself an hour earlier.**

### Fixed

**1. `citationLabel()` handled two of the three authorities the corpus
declares.** Shipped in §3.98 with exactly the shape of the bug it fixed: an
if-chain never given a limb for a value the data layer already carried.
`AUTHORITY_RANK` is `{instrument, administrative, model}`; the `else` swallowed
`administrative`, so the **U.S. Social Security Administration's published
detached-worker rule was labelled "Guidance"** — the same label as
`MOBILITY_CORPUS`, this project's own hand-written internal notes with no
publisher and no retrieval date. **14 of the 57 passages are `administrative`,
and three of UC-07's six are**, so half that use case's statutory feed read as
an internal note. `model` is kept: unreachable from the generated corpus, but
its live producer is `TREATY_CORPUS`'s last-resort OECD paraphrases — the one
population the "must not be cited as the governing instrument" caution is about.

**2. UC-07's PTO row fabricated a zero from a documented null.**
`show(pto.destinationOpeningBalance, "0")` printed *"opening balance 0 day(s), 0
liquidated"* for a dossier whose own `pto.cashout` reports `{computable: false,
unusable: [{field: "liquidatedDays", reason: "missing"}]}`.
`transitionGate.js` states the rule at the default it defends: *"null, NOT 0 …
defaulting the first to the second is how a dossier came to state a confident
0.00 payout on a balance nobody had counted (F-29)."* **The gate refused the
unknown and the panel re-invented it one layer up** — the rule the money rows
already get right, which days had never been held to.

**3. UC-07 searched the statutory index on the prose while it knew the route.**
A **wrong-jurisdiction** failure, not a missing-citation one. On a **US →
Canada** relocation whose prose named no country, the top statutory hit was
**Regulation (EC) No 883/2004** — the EU's internal social-security coordination
instrument, which binds neither party. Threaded through
`src/uc07/{workflow,mobilityRetriever}.js` and the n8n port.

**4. The port then passed `[]` where src passes `null`** — introduced by fix 3
and invisible to parity, whose fixtures name both countries in the prose either
way. An empty **array** is an explicit "filter by this list", which `lxServes()`
treats as serving everything, so it silently means *no filter*; `null` means
"read the jurisdictions out of the text". Proven on the live graph: execution
`10756` cited D-17 on US → CA, execution `10759` (after) cites **only** D-20.

**5. The UC-04 sidebar said Germany over a Portugal → Netherlands trip.** Caused
by §3.97's own demo-country sweep, which moved every quick-fill's FIELDS to
PT/PT→NL and left the SUBJECT as Anna Müller, whose record is Germany.
`src/uc04/server.js` publishes the record's country beside the stated one
*"to put that comparison in front of the one party who can make it"*, so **the
demo was exercising a discrepancy-detection feature with an unintentional
discrepancy.** Eleven scenarios moved to João Silva (PT, active, same company).

`uc04-executive` was the interesting one and **the first attempt was wrong**: it
states a Dutch home country, and the only Dutch record in the mock is Lars, who
is deliberately in `co_northwind_02` so `uc04-other-company` can fail identity
with him — so pointing this scenario at him turned an executive-PE
demonstration into an identity refusal. It moved to PT → NL on João instead,
keeping both flags, and its `digital_nomad_visa` became `schengen_short_stay`
because while the destination was PT **that field was never examined** (PT is in
`DNV_COUNTRIES`, which suppresses the Schengen check outright).

> **The check that nearly passed and proved nothing.** The first before/after
> snapshot reported **IDENTICAL across all fifteen scenarios** — because every
> single run had errored on a missing store, so both sides were fifteen
> identical `ERROR` lines. A green diff over a uniformly broken harness. The
> rewritten snapshot compares identity basis, record country, flag set and
> Schengen peak, and it is the one that caught the Lars regression. Same lesson
> as §4's receipt-path trio: **a success is not a success until you read what
> was actually produced.**

### Reported, not fixed — each is its own work order

- **UC-04's citation map has no jurisdiction filter.** `sourcesForFinding()`
  takes only a finding key, so `treaty_coverage_unconfirmed` cites the **US SSA
  and the Canada CRA on a Portugal → Netherlands trip**, and on Portugal → Iran.
  **UC-05, UC-07 and UC-08 all take a jurisdiction argument; UC-04 alone does
  not.** The fix needs jurisdiction data for the 12 of its 24 documents that
  `documentCountries.js` does not yet map — and a wrong entry there makes a
  citation *disappear* from a finding it governs, which is worse than showing an
  extra one, so it deserves the same care §3.98b got rather than a bolt-on.
- **`openQuestions`, `uncited`, `confirmations` and `citationCoverage` reach
  nobody.** Computed, serialised, sent over the wire and dropped by the loaders.
  On one real UC-07 dossier that is seven ranked questions, including
  `pe_risk_unsourced` — *"Permanent-establishment exposure is flagged and this
  repository cites NOTHING for it"* — which has no other route to the screen,
  while the flag it qualifies is rendered in full.
- **Four UC-04 scenarios still state a home country their subject's record
  contradicts.** All four PREDATE the sweep and are deliberate-person scenarios
  (Amanda's missing permission, Lars's other company, Chris filing for himself,
  Anna as not-the-session-person). Changing them changes what each
  demonstrates — an owner's call, not a cleanup.
- **No scenario now demonstrates `DNV_COUNTRIES` suppression.** It was only ever
  incidental to `uc04-executive`, and that membership *removes* a control on a
  `[PROPOSED]` list with `authority: null`, so it fails open. Worth a scenario
  of its own.

Suite: **4784 tests, 4781 pass, 0 fail, 3 skipped.** ZAF app **v1.10.12**,
verified from `owned.json`.

---

## §3.100 — UC-04's citation map now answers for the route it is looking at

The largest of the items §3.99 reported and did not fix.

`sourcesForFinding()` took a finding key and **nothing else**, so a finding's
citations were identical whatever countries the trip involved. Observed, on the
flagship demo pair, under "Totalization / treaty coverage" for a Portugal →
Netherlands workation:

```
treaty_coverage_unconfirmed
  D-20   U.S. Social Security Administration
  D-21   Canada Revenue Agency (CPP/EI Rulings)
```

Neither authority has anything to do with a Portuguese employee spending a
fortnight in the Netherlands, and **the same two were the only sources shown for
Portugal → Iran.** UC-05, UC-07 and UC-08 have each taken a jurisdiction
argument for some time; UC-04 was the one that never did.

### Each pair now gets its own convention

The six bilateral conventions were **already on this shelf** and all six showed
on every route. Measured, same finding, four routes:

| route | cited |
|---|---|
| PT → NL | D-31 AWR art. 4 · D-32 CIRS art. 16 · **D-24 Netherlands–Portugal convention** |
| US → PT | D-32 · D-35 substantial presence · **D-27 the three US conventions** |
| PT → CA | D-32 · D-33 · D-34 · **D-26 Canada–Portugal convention** |
| DE → MX | *(none — and it says so)* |

That is §3.98b's outcome reached for the hand-curated map rather than the
retrieved corpus.

### The rule: it can only ever REMOVE, and only on positive evidence

An unmapped document, an unrecognised scope and a routeless request are all
**kept**. The asymmetry is the whole safety argument: one document too many
costs a specialist a moment, while hiding the instrument that governs their case
costs them the decision. Same rule `byTicketAccountGuard.js` states for its own
refusal. Nationality counts as part of the route, which also only ever widens. A
bilateral instrument needs **both** its parties — an `.includes` on a flat
country list would have kept every US convention on a PT → NL trip, because
D-27's `countries` names all four.

`D-36`/`D-39`, the sanctions registers, are `global` and survive every route
including PT → Iran. Scoping those would be the one filtering mistake here with
a real safety cost.

### Two things the existing tests were right about and I was not

**`decisionSources.js` is asserted to import NOTHING** — *"it is frozen data and
must stay that way"* — with the sibling assertion that policyEngine, riskMatrix,
approvalPolicy and workflow must never import **it**, because *"a citation must
never be able to change an outcome"*. My first version imported `SCHENGEN` out
of `riskMatrix.js`, coupling the source map to the gate engine in exactly the
direction that guard keeps clear. The map now takes an **injected predicate**;
the knowledge lives in the new `src/uc04/sourceJurisdiction.js`.

**A group whose every citation is filtered out must not be dropped.** On Germany
→ Mexico this repository holds no residence test for either country, so every
citation goes — and **C-12**, which records that one 183-in-365 line stands in
for four different domestic tests, applies to that trip *more* than to a sourced
one. Returning null would have taken the warning out with the citations. The
group survives with its caveats and a sentence saying why it is empty, and that
sentence is rendered.

### Two things this change made visible, fixed with it

- The treaty-coverage dimension said *"this system holds no register of pairs
  that ARE covered"* **unconditionally**, which on an intra-EU pair was false
  while the same page cited Regulation (EC) No 883/2004 with its three operative
  articles inches above. It now names what IS settled (social security, by
  883/2004) and what is not (the tax side, a separate instrument). **The STATE is
  deliberately unchanged** — whether an EU pair should still read `unknown` is a
  policy question and is the owner's call.
- *"The rules this is based on — 0 documents"* reads as a bug rather than as the
  finding it is. It is now *"No document here governs this route — why, and what
  still applies"*.

Twelve jurisdiction entries were added to `src/knowledge/documentCountries.js`
for the UC-04 documents the corpus never fed. **`CITATION_PASSAGES` is
unchanged** — 57 passages, 14 documents — because the generator only looks up
documents that are in a feed. Two scopes are resolved by the consumer rather
than restated in the map: `schengen` against UC-04's own `SCHENGEN` set, so
there is never a second answer to which countries are Schengen, and `global`,
which is not a list at all.

Negative-controlled by reverting `decisionSources.js` alone: the four
behavioural tests fail while the six unit tests of the predicate correctly still
pass.

Suite: **4794 tests, 4791 pass, 0 fail, 3 skipped.** ZAF app **v1.10.13**.

**Still open from §3.99, unchanged:** `openQuestions`, `uncited` and
`confirmations` are computed and rendered by nothing; four UC-04 scenarios state
a home country their subject's record contradicts (all deliberate-person, all
predating the sweep); and no scenario now demonstrates `DNV_COUNTRIES`
suppression.

---

## §3.101 — `openQuestions` and `uncited` reach the sidebar

Two of the three items §3.100 closed with *"computed and rendered by nothing"*.

Five use cases compute an **`uncited`** list — the findings this repository
deliberately records as resting on no citation, each with the reason — and the
two 🔴 dossiers compute **`openQuestions`**, the things the dossier could not
answer. Every one was computed on every read, serialised, sent over the wire,
and drawn by no renderer. `src/uc04/decisionFacts.js` said otherwise, in a
comment above the line that produces it:

> `sources` is the reading list; `uncited` is the same statement in the other
> direction, **and it is rendered too**: a citation block that only ever appears
> where a citation exists teaches a reader that everything unmarked is fine.

That sentence described a renderer that did not exist. It is now true.

### Where each one goes, and why they go to different places

**An absence belongs beside the finding it is about.** UC-04's dimensions and
UC-05's blocks publish `{sources, uncited}` together, so `renderSources()` now
takes both and draws the absences inside the same collapsed disclosure as the
citations. The reader who has opened *"the rule this is based on"* is asking
exactly the question an absence answers; a section further down the page would
be a bibliography of silences — true, and read by nobody at the moment it
mattered.

**The summary counts both populations**, because a disclosure that counts only
the documents leaves the absences invisible until it is opened, and the whole
point of stating an absence is that a reader who never opens the box would
otherwise take silence for a clean bill. A group holding only absences now says
*"This finding rests on no source — the reason for each"* rather than a
document count of zero.

**An absence is not a caveat and is not drawn as one.** A caveat is a
contradiction the corpus records *against* a source it holds; `.r-caveat`
carries the warning colour to say so. Borrowing it would claim the corpus found
something wrong here when what it found was nothing. `.r-uncited` is dotted and
in the secondary colour, so the three kinds of entry inside one disclosure —
citation, caveat, absence — are told apart by shape as well as by wording.

**UC-07 and UC-08 publish a FLAT list instead**, because most of their absences
belong to no finding on the page at all: three of UC-08's are stated
unconditionally on every dossier ever compiled — citizenship-based taxation, the
treaty residence tie-breaker, permanent-establishment exposure. Those get their
own collapsed section, below the record and above the controls.
`basis.sources.uncited` is deliberately **not** read there: UC-04 publishes the
same absences twice, once per dimension and once deduped for an API reader, and
rendering both would print every one of them again.

### The open questions sit above the record they qualify

`openQuestions` is UC-07's and UC-08's only — the two use cases with no
execution path, so nothing on their page is a decision and everything on it is
research. That makes *"what this dossier could not settle"* the most
decision-relevant thing it holds. A priority-1 question is a sentence like *"a
day count is present and this system holds no residence test for any
jurisdiction it concerns"*, which a reader needs **before** the count, not
after — the same argument the mandatory framing statement wins on, one rung
down.

**The top band is open and the rest is counted.** A real UC-07 relocation raises
eight questions, 1,780 characters, a fifth of the page — rendering all eight
open puts that above the record they qualify, which is the *"multiple reports in
one"* complaint this page's design exists to answer. Collapsing all of them
would be worse: a section that is only a summary line states nothing at the
moment it is read. The split is **the server's own ordering**, not a judgement
the panel makes, and it is *"the highest band present"* rather than *"priority
1"* — nothing in the contract promises band 1 is ever populated, and a view that
emitted none would otherwise collapse entirely. `priority` is rendered as an
order and never as a severity word: the server publishes 1 and 2 and no
vocabulary for them, so inventing *critical* / *minor* would be a claim it never
made.

### The bug this found on the way, committed by yesterday's own fix

`panels.js` has read `view.citationCoverage.scope` since the hour it shipped and
leads UC-08's rows with it (*"What this material is"*) — and **`loadUc08` never
set the field**, so the sentence saying what the retrieved statutory material is
and is not reached no real sidebar at all. It was green in the suite throughout:
`test/zafApp.test.js` calls `panels.rows()` with a view built by hand, which
cannot see a loader that drops a field. The §3.98 defect class, introduced
inside the commit that fixed it.

`test/zafUnsettled.test.js` (8 tests) therefore runs the **real** sidebar
against the **real** API handlers over the fake DOM and reads the words that
came out, rather than asserting on a constructed view. Reverting
`zaf-app/assets/` alone fails all eight.

**One limb is deliberately unreachable and says so in place.** Only UC-04's
`immigration_document` can raise a cited and an uncited finding at once, and its
two populations are mutually exclusive today. UC-05's `readingList()` already
takes an array of keys, so one added key makes it reachable with no change to
the renderer; dropping the limb would mean that group then names one population
and hides the other. No fixture exercises it, because a fixture written to reach
it would have to be written to agree with the panel.

Suite: **4802 tests, 4799 pass, 0 fail, 3 skipped.** ZAF app **v1.10.14**.

**Still open from §3.99:** `confirmations` is computed and rendered by nothing;
four UC-04 scenarios state a home country their subject's record contradicts;
and no scenario demonstrates `DNV_COUNTRIES` suppression.

---

## §3.102 — `confirmations` reach the sidebar, and so do the three framings

The last of the three items §3.99 reported and did not fix.

A **confirmation** is the corpus agreeing with the code: one named thing — a
number, a list, a date — tested against the authority it was taken from and
found to match. Three use cases publish them on every source group, and nothing
drew them. Both libraries state the argument for rendering in their own headers:

> *(UC-04)* The one confirmation worth carrying: **a list of faults teaches
> distrust of everything equally.**
>
> *(UC-08)* … recorded because the neighbouring Canada–Netherlands pairing did
> **not** check out, and **a reader needs to know that this pair was checked
> rather than assumed to fail together.**

### What the reader was actually seeing

Measured on the seeded UC-04 workation, on the Schengen allowance:

| entry kind | count | rendered before |
|---|---|---|
| citations | 2 | yes |
| caveats | 2 | yes |
| **confirmations** | **2** (K-2, K-1) | **no** |

So the page said the 90/180 rule as applied here is disputed, and never said
that **the 90 and the 180 are Article 6(1)'s own numbers** and that the 29-code
Schengen set matches the Council's own enumeration. Only the application is in
dispute; the page reported the dispute and suppressed its bound.

### The order is the corpus's, not a layout preference

K-2's own detail ends *"How they are applied is **the caveat above**."* The
confirmation is written as a bound on the dispute that precedes it, so
confirmations render **after** caveats — printing them first would leave that
sentence pointing at nothing. It is the safer order independently: a reader
scanning a finding meets what changes their action before what does not.
`test/zafUnsettled.test.js` asserts the corpus still states that ordering before
asserting the DOM follows it, so the test cannot outlive its own premise.

Drawn as its own kind, never as a caveat. A caveat is a contradiction recorded
*against* a source we hold and carries the warning colour; `.r-confirmation`
takes the settled rail and the marker **"Checked and matched — "**, which names
what was done and claims nothing about the request.

### The framings, rendered for the first time

`SOURCE_FRAMING` and `CAVEAT_FRAMING` are each commented *"Rendered once above
the citation block. **Not decoration** — see rule 2."* Neither had ever been
rendered anywhere. So citations were drawn with no statement that a citation
decides nothing, and caveats with no statement that a contradicted finding is
not evidence for the opposite conclusion.

A confirmation is the one of the three that can be *misread as an endorsement*,
so it could not ship without its bound. `CONFIRMATION_FRAMING` is new, verbatim
in UC-04/UC-07/UC-08 exactly as `CAVEAT_FRAMING` already is — the SOURCE_FRAMING
sentences are tailored per use case because each names its own decision; this
one names none, so one wording is one wording rather than three that drift.

**Once for the page, not once per disclosure.** "Rendered once above the citation
block" was written when a citation block was a single list; they are now a
collapsed disclosure per finding and a UC-04 case has five. Three sentences ×
five would be most of the panel, and repetition is the specific complaint this
page's design answers. They sit once, above the findings, under *"How to read
the sources under each finding"*.

Every word is the server's. The panel chose placement and the marker word and
nothing else — a second copy of a safety sentence is how the first one goes
stale.

### One defensive widening, named

The group filter in `renderSources()` kept a group only if it had citations or
caveats, so a group whose sole content was a confirmation was dropped — the
failure confirmations exist to prevent, arriving through the filter that decides
whether they are drawn. Now widened. No seeded case reaches it; it is not
fixture-tested, for the reason §3.101 gives about the other unreachable limb.

`test/zafUnsettled.test.js` is now 13 tests. Reverting `zaf-app/assets/` alone
fails all 13; reverting it after the server change fails the five added here.

Suite: **4807 tests, 4804 pass, 0 fail, 3 skipped.** ZAF app **v1.10.15**.

**This closes §3.99's list.** `openQuestions`, `uncited` and `confirmations` are
all rendered. Still open and unrelated: four UC-04 scenarios state a home
country their subject's record contradicts, and no scenario demonstrates
`DNV_COUNTRIES` suppression.

---

## §3.103 — four UC-04 quick-fills stopped calling four people Portuguese

The last of §3.99's list. Found by the sweep that fixed the other half of it:
eleven UC-04 scenarios were moved onto João Silva (PT), and **four rows that
name somebody else kept the `PT` the sweep wrote.**

| quick-fill | subject | record says | form said |
|---|---|---|---|
| `uc04-persona` | Chris Lee | **US** | PT |
| `uc04-no-permission` | Amanda J Walker | **US** | PT |
| `uc04-other-company` | Lars van der Berg | **NL** | PT |
| `uc04-persona-other` | Anna Müller | **DE** | PT |

### Why it is not cosmetic, and why the fix belongs on the demo data

Nothing in UC-04 compares the stated home country to the record — **on purpose**,
and the sidebar discloses it beside the value:

> Stated on the request as the employee's work country. **It is not read from
> the Remote employment record and is never compared to it, so a wrong country
> here is not caught anywhere.**

So the panel rendered *"Stated home country: Portugal"* over a United States
employment and was telling the truth twice. A demo whose rows exercise exactly
the hole the product discloses teaches the wrong lesson twice over, and the
stated country is not inert: it is the risk matrix's origin. Chris Lee's own
request was being assessed as an intra-EU Portugal → Netherlands trip when the
real route is US → NL.

**This is the second time, in the opposite direction.** The first was a Nigerian
subject under a form saying DE, and the header comment recording that fix was
still in this file — describing a rule the file had since broken.

### What changed, and what it cost

Each row now states its subject's own country. Driven before and after, all
fifteen: **every decision and every reason identical.** One flag correctly
disappears — `uc04-persona` raised `a1_certificate_recommended` as Portuguese,
and a US worker travelling to the Netherlands is outside the EU coordination
regulation entirely. That flag was an artefact of the wrong country; `uc04-low`
still demonstrates the A1 recommendation on a route where it applies.

**Lars needed a second correction that followed from the first.** Setting his
origin to NL made his destination — also NL — a same-country request: nonsense
on its face, and *not* what the row refuses on, since identity is checked first.
The screen would have shown a self-contradictory trip turned away for an
unrelated reason. His trip is now João's mirrored, NL → PT, and the refusal is
`escalate / identity_not_verified` either way because nothing about the route is
ever reached.

**The cost, paid deliberately: the three "who" rows are no longer the identical
trip.** They cannot be — a workation's origin is where the person works, and
this fixture set holds exactly one Portuguese employment, one person without
workation permission (US) and one person at another company (NL). Inventing
Portuguese doubles would be fabricating people to make a demo tidier with real
data available a rung up (CLAUDE.md §3's ladder). Identical now means the
destination, the dates, the visa type, the duties and the prior stays; each
refusal names its own gate, so the comparison survives and the false statement
does not.

`schengen_short_stay` is **kept** for Chris Lee and is not an oversight: Art.
6(1) applies the same 90-in-180 allowance to visa-exempt third-country nationals
as to visa holders, so the field is the stay category and not a claim that a
visa was issued.

### The guard that was pinning the defect in place

`test/portalCopy.test.js` required every field but the subject to match across
the trio — *"the claim the page makes when it says the same trip"*. That
requirement is what kept Amanda and Lars Portuguese: **the guard was enforcing
the defect.** It now exempts the subject's own country, and two new tests do the
work it could not:

- every UC-04 quick-fill's stated home country equals its subject's country
  **read out of the mock through the same client the portal uses** — a table
  restated in the test would be a second copy of the fixtures and would agree
  with a scenario that had drifted, which is how both instances survived review;
- no quick-fill sends its subject to the country they already work in, except
  `uc04-same`, which is the gate it demonstrates.

Reverting `app.js` alone fails both — including the second on Lars, catching the
latent contradiction that had been sitting under the first one.

**Nationality is deliberately not asserted.** The employment record carries no
nationality field (`INTAKE-RESEARCH.md` §6.4 — one of the five UC-04 gate inputs
with no source in any Remote object), so there is nothing to compare against and
a test that asserted one would be inventing the fact whose absence it documents.

Suite: **4809 tests, 4806 pass, 0 fail, 3 skipped.**

**§3.99's list is now closed in full.** `openQuestions` (§3.101), `uncited`
(§3.101), `confirmations` (§3.102) and the four home countries (here). Still
open and unrelated: no scenario demonstrates `DNV_COUNTRIES` suppression.

---

## §3.104 — the UC-04 page a specialist actually opens

The project owner walked the demo — UC-03 workation → continue → UC-04 in the
Zendesk sidebar — and said *"I saw so many things here I was not happy with. e.g.
how can the relevant doc be absent"*, and asked whether US → Portugal is the
right demonstration. Three subagents audited it in parallel. Sixteen defects,
every one a **string**, and not one had a test: `npm test` never imports a
browser asset, and server prose is only ever compared to itself.

### The page contradicted itself, and the citation underneath proved it

The treaty dimension read:

> US → PT … **this system holds no register of pairs that ARE covered**, so
> nothing here confirms one.

…printed inches above a citation to **D-20, the SSA's own status table, which
carries the US–Portugal row** (in force 1989-08-01, TIAS 12121). False three
ways: UC-08's `SOCIAL_SECURITY_COVERAGE` is a five-column register naming six
pairs, `EU_EEA_FOR_A1` is a coverage register too, and **caveat C-9 — rendered
under this very finding — names five covered pairs with their authorities,
effective dates, certificate forms and detachment maxima.** §3.100 fixed exactly
this shape in the EU branch of the same function and left the other branch
standing.

Fixed to the true, narrow claim: UC-04's own matrix holds a known-gap list and no
register of covered pairs, so nothing *in the check* confirms coverage. **The
state stays `unknown`** — flipping it would stop C-9 itself from rendering, and
dimension 1 asks about tax as well as social security while the register answers
only the second. Written up for the owner as `HUMAN-DECISIONS-REQUIRED.md`
§D2(a), reopened with the evidence that the table partially exists.

### The loudest sentence on the page was false

Gate 18's `means` — rendered as the panel's lead — said *"a dossier was prepared
for a mobility specialist to approve. The workation is NOT approved yet — a
named human still has to approve it"*, four inches above the capacity card
saying **"Nobody approves this here."** The 2026-08-30 three-stage rework (§3.94,
§K14) established that no stage this system can reach approves a work
authorization, rewrote the panel and the server, and never touched this string.

It now names the party that really decides — the customer's own manager, in
Remote's product. **Note the vocabulary:** the first rewrite used "API" and
"endpoint" and `test/portalRequesterFacts.test.js` rejected it, because this
string is requester-facing and those words are banned from anything an employee
reads. The guard doing its job.

### The demo route, and why PT could not be rescued

`suggestedVisa("PT")` answers `digital_nomad_visa` **because PT is in
`DNV_COUNTRIES`** — so the continuation filled in a residence visa for a 21-day
holiday a US national needs no visa for. Then `classifyRisk()` guards its
Schengen block with `!DNV_COUNTRIES.has(dest)`, and **the same five-entry list
cancelled the count.** One uncited list — `[PROPOSED]`, no authority, no
version, never reviewed — both picked the document and suppressed UC-04's single
most substantive computation, which rendered as *"Excused, not measured"*.

Changing the visa does not help: measured, `schengen_short_stay` to PT is still
suppressed, because the suppression keys on the destination. **NL is the only one
of the four demo countries that can produce the number** — PT is suppressed, CA
and US are not in the Schengen area at all. The route is now **US → Netherlands**,
which keeps the persona and where the allowance genuinely binds a US passport
holder (art. 6(1) applies to visa-exempt third-country nationals).

**PT → NL was the richer alternative and was rejected**: three instruments
instead of one and an A1 flag, but it applies the 90/180 allowance to an EU
citizen exercising free movement, with no nationality caveat on the row. That is
the same defect as the DNV suppression pointing the other way.

**The continuation now offers one prior stay**, because it offered none and an
empty history is not neutral: the 183-in-365 row is not rendered at all without
one, the Schengen count demonstrates no arithmetic, and cumulative presence
answers `unknown`. 46 days is chosen so both windows report and neither decides
— **67 of 90 Schengen, 67 of 183 residency**. Driven end to end: `ready_for_approval
/ all_gates_passed`, both windows measured, where before the page showed one
excused measurement and two unknowns.

### The rest, by class

**Machine vocabulary where a human one already existed.** "Filed by
8ab12460-…" sat six inches under a card resolving that id to *Chris Lee* —
and `renderSubject` 190 lines up already refuses to print the same UUID twice
(*"the same UUID twice is not two facts"*). Three prose sites interpolated a raw
code or enum beside a row rendering the same value in words: *"NL is inside the
Schengen area"* over *"Destination Netherlands"*, *"Duties are 'engineering'"*
over *"Job duties Engineering"*. And a **composed** label, *"Days in NL across a
rolling 365 days"*, which the browser's country registry cannot reach at all
because it maps whole labels.

**Counts that did not describe the screen.** *"All 18 gates"* was a row count
wearing the wrong word — UC-04 has 18 positions across **8** gate names, ten of
them `risk_matrix` — now *"All 18 checks … grouped into 8 gates"*. Findings were
numbered **1, 3, 4** because a cleared dimension is filed into a collapsed
section and takes its number with it; they now number by where they render.
*"The rule this is based on — 1 document"* hid **three** recorded
contradictions; caveats are counted now.

**An em dash that walked through its own guard.** Gate 15 carried `checks: "—"`
and rendered as *"15. risk_matrix passed · Checks: —"* — a bug canary shown as a
check that ran and cleared. `test/gateLadder.test.js` required `length > 0`;
`"—"` is length 1, while `means` on the next line was floored at 20. Both are 20
now, **and the tightened guard immediately found the identical placeholder in
UC-09.**

**Two risk numbers that looked like a disagreement.** *"This request: medium
risk"* is, with zero flags, the static **use-case** baseline; *"Risk rollup:
low"* at the bottom is the only per-request assessment made. The subject now
switches with the fact.

**A false absence.** *"The requester's own words — Not stated"* asserted the
requester explained nothing, while the note attached to that row says the words
exist in the audit record and this table has no column for them.

**My own bug from §3.102**: the framing note sat between the heading *"What was
not established"* and the findings it names, effectively retitling it. Moved
below them.

### Two things reported and deliberately not done

**The role slug** (`uc04:mobility_specialist`) was gated on `openHere` and the
change was **reverted within the hour**: `test/zafApprovalRole.test.js` refused
it, and the test is right — the rendered string is an identifier, not an
invitation, and the sentence above it already says the absence is structural.
The invitation lived in a code comment, which is what to fix if it ever misleads.

**The `unknown` state on six documented pairs** — the owner's call, §D2(a).

`test/uc04SidebarCopy.test.js` (12 tests) drives the real workflow, the real read
handler and the real bundle over the fake DOM and reads the words that came out.
Reverting `src/uc04/`, `src/uc09/` and `zaf-app/` fails all twelve.

Suite: **4821 tests, 4818 pass, 0 fail, 3 skipped.** ZAF app **v1.10.16**.

---

## §3.105 — the treaty dimension stopped saying "Unknown" over its own citation, and Chris Lee stopped being two people

The owner read the UC-04 page again and asked two things: *"i thought Chris lee
is an engineer, or is he a data scientist now?"* and *"so much feels wrong here,
e.g. 'totalization / treaty coverage Unknown' — our demo is not meant to have
unknown."* Both were about the same page. Neither was a rendering bug.

### The register existed. It was one use case over, twice.

`Totalization / treaty coverage: Unknown` was printed for United States →
Netherlands directly above a citation to **D-20** — the SSA's own status table,
which carries the US–Netherlands row — and above caveat **C-9**, which names the
pair as covered with its authority and effective date. §3.100 fixed the EU half
of that sentence and left this one; the 2026-08-31 pass fixed the remaining false
clause and left the STATE, twice recording that flipping it was the owner's call.
It has now been called.

What the fix needed was already in the repository:

| Register | File | Holds |
|---|---|---|
| `SOCIAL_SECURITY_COVERAGE` | `src/uc08/decisionSources.js` | six pairs · network · certificate · maximum initial detachment |
| `TAX_CONVENTION_BY_PAIR` | `src/uc07/decisionSources.js` | the bilateral tax convention for the same six |

**The same six, checked rather than assumed** — both key sets are `CA|NL, CA|PT,
CA|US, NL|PT, NL|US, PT|US`, which is every pair of the four demo countries
(`DEMO-COUNTRIES.md`: NL · PT · CA · US). So **no pair in the demo matrix reads
`unknown` any more**, and the six that changed did so from documents already
retrieved, hashed and provenance-headed. Nothing was fabricated and no figure was
computed: the pair is looked up and the columns are printed.

Both are **imported, not copied** — the rule `src/uc04/policyEngine.js` already
follows for UC-03's `SANCTIONED_OR_RESTRICTED`. Whether an instrument is in force
between two states is a property of the pair, not of the use case asking, and two
copies of a jurisdiction fact drift silently. Exporting a frozen citation map
breaks neither of `decisionSources.js`'s two structural properties: it still
imports nothing, and no gate still reads it.

### Both limbs, or neither — and the absences had to survive

The dimension asks about a social-security **or tax** agreement, and those are
different instruments settling different things. `cleared` therefore requires an
entry in **both** registers; a pair only one holds falls through to `unknown`
unchanged. That is the split `qa/HUMAN-DECISIONS-REQUIRED.md` §D2(a) recommended,
enforced by the condition rather than by two rows — and its third objection
("coverage is settled would be true of half the question") dissolved on
measurement, because the tax half turned out to be answerable for the same six.

**Answering a question by making "I do not know" unreachable is not an answer.**
Both gap branches are driven in the tests on pairs the registers genuinely do not
hold — DE → MX for the plain one, DE → ES for the intra-EU one that still says
the tax side is unsettled — and IN → US still reports a **known gap** rather than
an absence. If those ever go green, the register has stopped being a register.

### The caveats moved, and only one of them retired

The citation group is keyed on the dimension's state, so the covered case got its
own key (`treaty_coverage_confirmed`) rather than reusing the unknown one — which
is where §D2(a)'s second objection would otherwise have bitten, silently.

- **C-9 retires.** It says "four country pairs this system reports as unknown are
  in fact covered". UC-04 no longer makes that claim. Marked acted-on in
  `CONTRADICTIONS.md`, not deleted.
- **C-8 and C-24 stay.** Both dispute the *maximum initial detachment* column the
  finding now **prints**, and neither was discharged by anything: there is still
  no single detachment maximum, and the CRA's Canada–Netherlands row still pairs
  one agreement's date with another agreement's limit. **A caveat retires when
  the claim it disputes stops being made, never when the finding it sits under
  turns green.**
- **K-4 joins them** — Canada–Portugal checked against the agreement text and
  held. A page that prints only the failure teaches a reader that nothing on it
  was verified.

The finding states its own bound out loud: an instrument in force is **not** a
certificate obtained for this trip, and this system checks for neither.

### A fourth document would have been cited on a pair it does not govern

Listing the instruments surfaced a latent defect in the route filter.
Regulation 883/2004 is tagged with all thirty EU/EEA codes and was matched with
`.some()`, so **D-17 and D-18 survived a United States → Netherlands route**
because the Netherlands is on the list. Under the old `unknown` finding they were
never cited; under the new one they would have been — the page would have named
the EU regulation as an instrument in force for a pair the United States is one
half of. That is the "OECD Model on a DE/ES question" defect one level down: the
right family of document, the wrong jurisdiction, printed with a real publisher
and a real retrieval date.

`scope: "eu"` now requires **both work-side endpoints** inside the Union. Work
side and not nationality, deliberately: 883/2004 keys on where a person works and
is posted, and a third-country national legally resident in a Member State is
inside the coordination — testing nationality would drop the regulation from an
intra-EU posting made by a US national, which is the opposite error. The filter's
rule is unchanged: it only ever removes, and only on positive evidence, so a
route missing either end falls through untouched.

### Nothing about the decision moved

No flag, no risk level, no gate, no routing. `NON_TREATY_PAIRS` remains the only
country-pair rule with any effect on the outcome, and it was not touched — which
is why this needed **no n8n republish**: `workflows/nodes-uc04/workationGates.js`
has no treaty dimension to drift from. Asserted two ways rather than argued:
neither `riskMatrix.js` nor `policyEngine.js` can even name the registers or the
new key, and a covered route raises no flag.

### Chris Lee is a Data Scientist, and ten of eleven fixtures said otherwise

"Job title: Data Scientist" and "Duties are 'Engineering'" sat six inches apart.
Both were correct and nothing said so. Two separate causes:

**1. The mock had drifted from the record it stands in for.** Read live from the
Sandbox on 2026-08-31, employment by employment: **ten of eleven mock job titles
contradicted the live record for the same id** — Chris Lee "Staff Engineer" here
and *Data Scientist* there, Emma Thompson "Customer Experience Manager" and
*Staff Photographer*, Lars van der Berg "Data Engineer" and *Sales Coordinator*.
Only Alex Morgan agreed. The portal dispatches its Remote reads into the mock;
the sidebar reads the live gateway — so one person had two job titles on one
demo, and the file's own header said job title was "this file's own."

**The ladder settles it, not a preference** (CLAUDE.md §3): a real value always
wins, and rung 3 fills only what rung 2 left empty. Rung 2 answers this for every
one of these ids. Eight titles were rewritten from the live record; Thomas Weber
is left without one because the Sandbox returns null for him, and rung 3 may fill
what rung 2 left empty but must not invent what rung 2 answered with nothing.

**2. Nothing on the page said the two facts come from different places.** The
stated home country has carried exactly that disclosure for weeks — *"not read
from the Remote employment record and never compared to it"* — and the duty
category never did, so the one row where the record offers an independent check
read as though it **were** the record. `src/uc04/server.js`'s own comment already
said the title is "the only independent evidence about the role this system
holds" and that "nothing here compares them; a human does" — and the human cannot
do that if nobody tells them there are two facts.

The fix is the label and the sentence, on all three branches including the one
that **escalates**, where a miscategorised `executive` costs most. Not a
comparison: `src/uc04/intakeExtractor.js` already refuses that judgement by name,
because choosing which of seven categories a job title implies is exactly what a
model must not do here. A Data Scientist selecting 'engineering' is a correct
answer; so is 'other'.

### Also fixed, one level down

The prose said "US → NL" while the evidence row beneath it said "United States →
Netherlands" — both this dimension's own output. The row goes through the
sidebar's country registry because its *label* is mapped; a code interpolated
into a sentence is unreachable by it, which is the same defect §3.101 fixed for
"Days in NL". All four branches now spell the names where the codes are.

### Evidence

`test/uc04TreatyCoverage.test.js` (12 tests) drives the real matrix, the real
describer and the real route filter. Reverting `src/uc04/decisionFacts.js` and
`src/uc04/sourceJurisdiction.js` fails **8 of 12**; the four that pass are the
invariants that held before and exist to catch a future regression — the two
surviving absences, the two registers agreeing on their key set, and the
structural guard that no gate can read either.

Suite: **4833 tests, 4830 pass, 0 fail, 3 skipped.**

---

## §3.106 — the reference control that could not be used, and two Unknowns that were demo data

Three reports from one sitting with the sidebar and the portal open. All three
were the same shape: a screen stating something true in a way that could only be
read as something else.

### The one that blocked a real attempt

The owner corrected the prior-stay boxes on a UC-04 form reached by continuing a
travel request, resubmitted, and got:

> Reference sent: `uc04-20260831090845-4tyos`
> … Already processed — this reference was refused as a repeat delivery
> Reference already claimed: **59**

Two ids, no stated relationship, and the second never shown to them before.
*"i tried doing it myself, but could not go through."*

**The server was right and the page was wrong.** `src/portal/server.js` files a
continuation under the TRAVEL request's own reference, so the routing and the
work authorization sit side by side under one id — deliberate, documented, and
already tested (`test/portalUc03Continuation.test.js` asserts both the
substitution and the redelivery refusal). What no test covered was what the
requester is told. The browser sends `reference("uc04")`, a freshly generated
id, and reported **that** back — while the server had recorded a different one.

Measured on the deployment before the fix, two submissions carrying two
genuinely different references:

```
UC-04 sent externalRef=repro-fresh-AAAA → recordedRef 64 · alreadyHandled false
UC-04 sent externalRef=repro-fresh-BBBB → recordedRef 64 · alreadyHandled true · duplicateOf 64
```

So on this path **no value of the reference control can produce a new
submission**, and the control said nothing about it. "Generate a new reference"
was an offer the page could not honour.

**A comment is what let it live.** `server.js` said the override was *"a no-op
in the ordinary case"* because *"the page sends this same value back (it
received it from the continue route)"*. It never did — `CARRIED_FIELDS` in
`uc03Continuation.js` does not include the reference. On the continuation path
the override is **always** a correction, so the belief that it was usually
invisible was exactly backwards. Corrected in place, with the measurement.

Three changes, none to the substitution itself:

- **The page reports `recordedRef`** — the id the server actually claimed —
  rather than its own guess, and everything the control does keys off it, or
  "Reuse" repeats an id that was never used. `recordedRef` was already on the
  wire, published with a comment naming this very hazard for the audit trail;
  the browser simply never read it.
- **When the two differ, the page says so**: which id was discarded, which one
  the record is under, and that the control does not apply to this submission —
  the part that actually unblocks a reader, so they stop trying.
- **The refusal says what happened.** `deliveryFields()`'s wording is written
  for a webhook that fired twice, where sending a different reference IS the
  remedy. Here there is none. `continuationDuplicateFields()` narrows it — it
  returns nothing at all unless the workflow reported a duplicate AND this was
  a continuation, and it changes only the explanation, leaving `alreadyHandled`,
  `duplicateDelivery` and `duplicateOf` exactly as they were:

  > This travel request already has a work authorization … **The details
  > currently on the form were not used**, and the decision shown is the one the
  > first submission reached … To have a different work authorization assessed,
  > start a new travel request.

### The second Unknown, which was demo data rather than a defect

The live page for ticket 62 reported *"Cumulative presence, rolling window —
Unknown"* on a request that had passed every check. The check was right: nothing
was supplied, so 0 over 0 trips is a **floor, not a measurement**, and refusing
to read silence as a clean record is the point. But **the two quick-fills a demo
drives to a green decision were the only place a reader met it**, and an absence
sitting among four findings reads as a gap in the system rather than in the
request.

`uc04-low` and `uc04-persona` now carry the same prior stay the UC-03
continuation already offers (`DEMO_PRIOR_STAY`), so the two routes into this
form do not disagree about the traveller's history: **60 of 183** against the
residency watch line, **60 of 90** in the Schengen window. Their PAIRED refusal
rows got it too — `test/portalCopy.test.js` asserts each pair differs only on
who is travelling, and it caught the first attempt, which changed one side. The
other refusals are deliberately left blank: each refuses at a check that runs
before the risk matrix, and handing them history risks moving which check
decides, which is the thing those rows exist to demonstrate.

**The floor case moved rather than disappeared.** `portalUc04TravelScenarios`
relied on `uc04-low` happening to be empty; it now clears the boxes explicitly,
which is what a tester does to see the floor and is a stronger claim than a
quick-fill's incidental emptiness. A prefilled demo value must not be able to
hide the honest answer, so the same scenario is driven both ways.

### The third — a filer with no name

*"Filed by admin_jane"* appeared in the slot that reads *"Filed by Chris Lee"*
when the filer IS the subject. Both correct; only one a name. This is the
**opposite** of §3.104's bare-UUID defect, and the two look identical at a
glance: that one had a name and did not use it, this one has no name at all.
The substitution deliberately does not fire for a company admin — nothing has
read a record for them, and inventing one would be worse — so what is fixed is
the row no longer *looking* like a resolved name. It is drawn in the same face
as `.r-case-id`, which is where a reader already meets identifiers on this
panel. The note under "What each of these does not establish" already said what
the value is; the row now agrees with it at a glance.

### Evidence

Four new behavioural tests plus the two repointed ones; reverting `src/portal/`
and `zaf-app/` fails all four. The continuation pair is driven through the real
portal handler with a real ledger, both outcomes, and the narrowing is pinned
from the other side too — an ordinary admin-filed duplicate must KEEP the
repeated-delivery wording, or the fix has widened into a lie about webhooks.

Suite: **4840 tests, 4837 pass, 0 fail, 3 skipped.**

---

## §3.107 — the immigration document nobody had looked for

**2026-08-31.** The project owner, reading UC-04's fourth dimension: *"Immigration
documents. Is this documents the employee we provide? In every life scenario,
would the employee have an important documents in their sandbox or in their
employee details, or did they usually have that?"*

The answer is yes on both counts, and the panel was saying no without having
looked. `documentDimension()` published an evidence row reading
**`Document read from Remote: none`** — a hard-coded string literal, on an
employment record the same request had already fetched.

### What was measured, and on which rung

**Rung 1 — Remote really does collect these.** *"Remote's Right-to-Work Checks"*
(help article `31105131499789`, retrieved 2026-08-31): *"Remote collects
nationally recognized identification documents and conducts secure identity
verification through trusted providers. For employees working in a country other
than their country of nationality or usual residence, the Mobility team reviews
residence permits and other relevant documentation to confirm both legal stay and
work authorization."* Ordinary EOR onboarding, and **Remote** is a holder of the
document, not only the employee.

**Rung 1 — the API has a typed home for it, on the record UC-04 already reads.**
`GET /v1/employments/{id}` carries `files[]`, documented as *"Documents
associated with this employment (e.g., contracts, tax forms, identity
documents)"*, whose `File` schema example is literally
`{name: "id.pdf", type: "id", sub_type: "personal_id"}`.

**Rung 2 — the Sandbox holds none.** Swept across all 112 employments: 333 files,
`contract` 108, `expense` 221, `document_scan` 2, `background_check` 2, **zero of
type `id`**, every `sub_type` null. (The two `document_scan` rows are named
`receipt.pdf`.) A Sandbox holding none of a thing is **rung 2 being empty, never
rung 1 answering** (CLAUDE.md §3), so nothing here reads that emptiness as a
statement about how Remote works.

**And the field was being thrown away.** `grep -n files src/remote/restClient.js`
returned nothing: `normalizeEmployment()` built its result from an allow-list and
`files` was not on it — the same mechanism that lost `custom_fields` and broke
UC-04's employer-permission gate for every live record.

### The half of this change that must NOT work

**Finding an identity document does not clear the dimension, and that is Remote's
own rule rather than caution.** A right-to-work document on the employment record
establishes entitlement in the **country of employment**. UC-04 asks about the
**destination**, and Remote's *"Remote Work Authorization"* article
(`37802834593805`, updated 2026-08-18) puts it on both sides at once: a work
authorization is *"subject to the visa or work permit regulations of both the
destination country and the employment country."*

So `UC-04.md` §5's *"never inferred from 'this destination usually doesn't
enforce it'"* and §9's *"No immigration document on file → Escalate — never
inferred"* survive untouched. `summariseIdentityDocuments()` has **no `cleared`
state and no caller that could produce one**, and
`test/uc04ImmigrationDocuments.test.js` drives all six reachable record shapes
through the real function asserting it each time. The dimension stays
`unavailable` with the document **reported** and the bound **stated**.

### What was built

- **`src/remote/restClient.js`** carries `files` raw, as the array Remote sends —
  same reason `basic_information` / `contract_details` / `custom_fields` are
  carried unflattened. **An absent key stays `null`, never `[]`**: "the record
  did not carry the field" and "the record carried it and it was empty" are two
  states and `?? []` erases one before any caller can see it.
- **`src/uc04/identityDocuments.js`**, the one place that interprets it. Four
  states — `not_read`, `field_absent`, `none_on_file`, `on_file` — because
  "nobody looked", "we read a record with no such field" and "we looked and there
  are none" were all rendering as the same word, and only the third is a fact
  about the employee. Same argument `employeeSubject.js` makes for its five and
  `upstreamFailure.js` for `not_found` vs `unavailable`. **Presence only, never
  content**: no file name, number, URL or body leaves the summariser, and a test
  serialises the result and asserts each is absent. `background_check` and
  `document_scan` are deliberately **not** identity documents.
- **Read at view time, not persisted.** `uc04_authorizations` has no column for
  it and half-adding one the store would drop is worse; the same three reasons
  `employeeSubject.js` gives for re-reading a display name apply, and the first is
  the one that matters here — a document filed the day after the request was
  submitted is exactly the case a specialist cares about.
- **One GET serves both blocks.** `readEmploymentForSubject()` was split out of
  `describeEmployee()` so the subject panel and dimension 4 share a read. The
  alternative was a second GET per panel open or a second copy of the
  not_found/unavailable/not_looked_up distinction — and that distinction is the
  whole point of the file. The other eight callers pass nothing and are unchanged.
- **Both fixtures, one marked.** `emp_active_001` (Amara Okafor) carries a
  `standin-` identity file, because that is the record `npm run uc04-api` seeds
  all six demo cases against and the one the sidebar fixture renders — the
  on_file branch is unreachable on live data, so the demo record is the only
  place it is ever seen. Chris Lee carries the same shape for the portal
  personas;
  the marker makes the whole summary declare itself and every surface prints
  *"STAND-IN FIXTURE, not a document Remote returned"* beside the finding
  (rung 4: fabricated is permitted, unmarked is not). Emma Thompson carries a
  contract and no identity document — **the shape all 112 live employments
  have**, so the demo shows the distinction the Sandbox alone cannot.

### Two sentences that were false and are now branch-dependent

The ZAF gloss for `unavailable` read *"The check does not exist yet — nothing was
ever consulted"*. It was wrong for **both** of its users: UC-09's
`pending_approval` branch consults the record twice and holds no confirmation
only between them, and UC-04's now reads `files[]`. A shared state word must not
assert how any one dimension reached it.

And the finding's own closing clause — *"which is why it is reported as absent
rather than assumed"* — is a flat contradiction one clause after reporting a
document. **Caught by driving both fixtures, not by reading the string**, which
is the only way it could have been: the `on_file` branch is unreachable on live
Sandbox data, so nothing but the stand-in exercises it.

`decisionSources.js`'s `immigration_document_on_file` note said *"no document is
read from Remote at all"*. True of the code, no longer true, corrected in place
with what the read can and cannot establish.

### Pinned

`test/uc04ImmigrationDocuments.test.js`, 17 tests. Negative control: reverting
`decisionFacts.js`, `restClient.js` and `decisionSources.js` fails **6 of 15**
of the ones that existed at that point (the nine that still pass are the new
summariser's own, which the revert does not touch). Includes a structural guard
that `policyEngine`, `riskMatrix`, `approvalPolicy` and `requestParser` never
import the summariser — a fact that cannot change an outcome can be reported
honestly without anyone re-auditing the gates — and an assertion that the demo
record still carries its marked fixture, since a dropped fixture would return
the demo to "not carried on the record read" with the whole suite green.

### Verified live, and the live reading is the honest one

Two portal requests were filed against the deployment and read back through the
ZAF `by-ticket` route (tickets **70** and **71**). The sidebar's Remote client is
the real one, so what it reported is **genuine Sandbox data** rather than the
mock: Chris Lee `none_on_file`, 1 file, `contract`; Emma Thompson
`none_on_file`, 2 files, `contract` + `document_scan`. That independently
reproduces the sweep — Emma really is one of the two employments holding a
`document_scan` — and it is the field arriving end to end from Remote's API
through the deployed function to the panel.

**So on the deployment this dimension will always read "none on file", and that
is correct rather than a shortfall.** The populated branch is a property of the
mock, by necessity: rung 2 holds no identity document to read.

Suite: **4857 tests, 4854 pass, 0 fail, 3 skipped.**

---

## §3.108 — the request that reached nobody, and the two stages that had no button

**2026-08-31.** The project owner filed a UC-04 work authorization through `/portal`,
opened the employer screen, and it was not there. Their words: *"It is meant to reflect
INSTANTLY on the employer screen."*

They were right, and the session before this one had already found it and left it as a
question instead of a fix — *"worth deciding whether stage 1 in the portal should mint a
work-authorization row so the two halves join up."* **An approver who cannot see the
request that was just filed does not have a workflow, and framing that as a design option
was the error.** The same reading produced three more: the employer screen was a column of
tall cards repeating the same two paragraphs of ladder prose under every row, stage 3 had
no control at all, and the employee never learned the answer.

### What was wrong, in four independent places

1. **Nothing joined the two surfaces.** `resolveEmployerScope()` read Remote's real
   `GET /v1/work-authorization-requests` and an in-memory rung-3 stand-in store. The
   portal writes `uc04_authorizations`. Neither knew about the other.
2. **`npm run remoteui` built an unpooled store**, so even after the join the LOCAL demo
   would show an empty queue — the portal and the employer screen are different processes.
   This would have looked exactly like the bug being fixed.
3. **The employer's own decision was invisible in `/audit`.** Its audit row carried
   `details.workAuthorizationId` and no `details.externalRef`, and
   `src/auditview/readStore.js` searches that field BY NAME — so the feed showed the
   request filed and the ticket handed off with the decision between them unreachable from
   the only id a human holds.
4. **Two of UC-04's three deciders had nowhere to click.** Stage 2 had a screen and stage
   3 had none.

### The join

`src/remoteui/workAuthRecords.js` maps a stored row into Remote's own
`WorkAuthorizationRequest` shape, emitting **only fields the portal actually collects** —
`reason`, `travel_document_number`, `work_location`, `user` are **omitted, never
invented**, and facts Remote's schema has no field for (nationality, visa type, job
duties, the risk verdict) live outside `request` rather than being smuggled into it.

`resolveEmployerScope()` takes the store as a third source and is handed **only the
employment ids already read back from Remote and found to be in the session's company** —
so it cannot widen scope, and nothing from a query, header or body reaches it. Deduped
against rungs 2 and 3, **a real Remote row always wins** and ours is skipped and named in
`recordProbe.displacedByRemote`. Sorted newest-first, which is the whole of "instantly".

### No migration, because none was available and none was needed

Supabase is unreachable over raw TCP from this container, so a schema change was not on
the table. The employer's verdict goes to columns that already exist, and **the status
strings are Remote's own enum** (`approved_by_manager` / `declined_by_manager`) so the
store's status and the screen's status are one string. Stage 3 lives on the append-only
`audit_log`, read back by `mobilityReviewLog.js` — the same choice `src/portal/server.js`
already documents for UC-04, with the trade stated in that file's header rather than
glossed: no uniqueness constraint (mitigated by a `workflow_claims` claim), no index, and
a second place UC-04 state lives.

### Stage 3: recorded, never transmitted

The owner's call (`qa/HUMAN-DECISIONS-REQUIRED.md` §K14, extended). **The API fact was not
overruled** — Remote publishes no endpoint that sets `approved_by_remote`. What changed is
that the reviewer's verdict is now recorded here, durably, naming them, and drives the
employee's page and document.

Three properties are structural rather than conventional:
- **`submitMobilityReview()` takes no Remote client.** There is no path along which it
  could transmit.
- **The verbs are `clear` / `decline`, not `approve`.** The employer used that word on
  this same record at stage 2, and one record carrying two people's "approved" is how a
  reader comes to believe one of them settled the other.
- **It refuses by name when the employer has not approved first**
  (`employer_approval_not_recorded`), so a stage-3 clearance cannot arrive out of order.

The same sentence — recorded here, not sent to Remote, Remote's own systems will not show
it — appears on the reviewer's panel *before* they click, in the audit row, on the
employee's status page and on the issued document. This repository has shipped a record
claiming Remote approved a trip Remote never saw exactly once
(`src/uc04/workflow.js`'s header); that is why the guarantee is built rather than promised.

### The screen

One row per request — name · destination · dates · reason, provenance badge, **Approve /
Decline on the row**. Six to nine visible at once, where it was one per screenful. Decline
reveals its reason box inline and sends nothing until confirmed, so Remote's mandatory
reason never arrives as a post-click refusal. The verdict lands on the row in the server's
words.

**The ladder and stand-in prose are said once**, in a collapsed explainer, and a test
COUNTS OCCURRENCES — a substring check cannot tell "said once" from "said under every
card", which is how it came to be repeated in the first place. What stays per row is only
what is true of that row: the origin badge and the permanent-establishment warning.
Polling is 10s, stops entirely on a hidden tab, and defers the re-render while a decline
reason is being typed. The origin badge renders an **unrecognised token verbatim** rather
than switching on a closed list, so a new provenance cannot silently render as "From
Remote's API".

### Three registers that did not know about any of it

Found by asking what else reads UC-04's status, and all three failed in the
under-claiming direction — nothing was ever false, which is the only reason they were
findable at all:

- **`src/approvalqueue/awaiting.js`** had no case for either employer status, so both read
  `unknown` and dropped out of the queue's headline. Registered — and
  **`approved_by_manager` is `awaiting`, not settled**, because the employee is not cleared
  to travel until stage 3 answers. This is precisely the "a status added to a store later"
  failure that file's own header warns about, arriving after the warning was written.
- **`src/auditview/humanDecision.js`** had no verdict entry for the four new actions, so
  two real human decisions rendered in the live feed as generic events. The words differ
  on purpose — stage 2 "approved", stage 3 "cleared" — and stage 2's shape is `slot`
  rather than `settles`, matching the queue's judgement one file over.
- **`src/approvalqueue/approvalRoutes.js`** named a mobility specialist as the person
  making the *customer's* decision. Corrected, with stage 2 and stage 3 both enumerated —
  **and the residual hole named rather than smoothed over**: the registry is one row per
  use case, so a stage-2 item and a stage-3 item resolve to the same directions. Making
  the route status-dependent is the real fix and is a shape change to that file's key.

### Pinned

62 new tests across four files. The queue UI test boots the real `workauth.js` in
`node:vm` against the **real server handler**, so what it asserts on is what the server
sends rather than a fixture. Negative controls were run per agent and per file, including
one where reverting a store made the test file fail to *import* — which proves nothing, so
the tighter control was used instead.

Suite: **4923 tests, 4920 pass, 0 fail, 3 skipped** (baseline 4857/4854/0/3).

### Not done, and named

`workflows/nodes-uc04/` knows nothing about stage 3 — the n8n graph is untouched.
`src/portal/ownership.js` lets an admin file a request they can then never collect the
document for; deliberate, documented in `recordDelivery.js`, and a product call worth
confirming.

## §3.109 — the last copy of the wrong actor, and why stage 3 does not belong in the graph

**2026-08-31.** §3.108 closed with a named gap: *"`workflows/nodes-uc04/` knows nothing
about stage 3 — the n8n graph is untouched."* This is that gap, opened up and answered.
It turned out to be two questions, and the second one's honest answer is a refusal.

**Nothing here has been deployed.** The files are tested and the live-graph change is
written down in `workflows/nodes-uc04/DEPLOY-2026-08-31.md`; the deploy and the live
proof are the owner's.

### What the graph was telling people

`workationGates.js` composed the summary sentence *"Awaiting one mobility specialist's
approval before the authorization is issued."* for every `ready_for_approval` decision,
and the live `Flag Awaiting Specialist Approval` Zendesk node wrote *"AI drafted
workation authorization {id} — awaiting ONE mobility specialist's approval"* onto the
ticket, tagged `uc04_ready_for_approval`.

Both are false under the model settled on 2026-08-30 (`UC-04.md` §1a). A
`ready_for_approval` request waits on **the customer's own manager**, in Remote's own
product, and it is the only work-authorization decision Remote's API accepts. **No
Zendesk agent can make it** — `src/uc04/approvalPolicy.js` refuses them and the UC-04
sidebar panel offers no approve control at all. So the ticket was instructing a Remote
specialist to do something every other layer of this system refuses. Same defect,
same day's work, as the three registers §3.108 corrected; the graph was the fourth copy.

**It survived because no check reads a Zendesk node's prose.** `verify-deployed` diffs
`jsCode`, and a Zendesk node has none — all four of UC-04's terminal Zendesk nodes are
baselined as unguarded in `scripts/lib/unguarded-node-baseline.json`. And
`test/n8nUc04Parity.test.js` compares **decisions**, by design and by its own header, so
a node that reaches the right verdict and describes it to the wrong person passes it
every time. One of its assertions was `assert.match(a.summary, /specialist's approval/)`
— **the test was pinning the defect.**

### The fix, and the one thing it deliberately did not touch

`workationGates.js` now names the actor and the surface for each stage, composes a
deterministic `internalNote` (the note the ticket carries), and emits an
`awaitingDecision` block saying who a decision is waiting on as data rather than as
prose to be re-derived. The words are **copied from `src/`, with attribution per
constant**, not composed fresh — an n8n Code node has no imports, so the established
pattern is to copy and say where from, because a second wording is a second thing to
drift. Sources named in the file: `src/remoteui/workAuthPolicy.js`'s `STAGES`/
`STAGE_3_NOTE`, `src/uc04/mobilityReview.js`'s notice and its `clear`/`decline` verbs,
`src/uc04/server.js`'s `CX_SIDEBAR_NO_DECISION`, `src/approvalqueue/approvalRoutes.js`'s
UC-04 row.

**`approvalRoute` keeps the token `specialist_approval`.** It is a machine value, never
rendered, persisted by no node on this graph, and `src/uc04/workflow.js` emits the
identical string — renaming it would make two copies of one decision disagree about a
field while changing nothing a human reads. What was wrong was the prose.

**The note moved out of the node parameter and into the file**, which is the part that
lasts: `Flag Awaiting Specialist Approval` will interpolate
`{{ $('Workation Gates').item.json.internalNote }}`, the same shape UC-01's
`Compose Internal Note` already feeds its two note nodes. From then on the sentence a
customer's ticket carries is covered byte for byte by `verify-deployed`, instead of
being a string somebody typed once into an editor.

### Stage 3 does not belong in this graph, and the reasons are measured

Three findings, all read live on 2026-08-31 rather than reasoned about.

1. **The graph is not in the chain at all.** UC-04's intake trigger `99900000000009`
   requires `current_tags includes uc04_test`. `uc04_test` matches **0 tickets** on
   `your-subdomainhelp`. The **20** real UC-04 tickets that exist are all portal-raised and
   carry `portal_request, uc04, uc04_specialist_approval, queue_mobility_specialists` —
   `src/portal/ticketing.js`'s tags, which do not include `uc04_test`. So no real UC-04
   request has ever reached this graph or can, and all 13 of its executions were direct
   `POST`s from scripts. `uc04_employer_approved` likewise matches 0 tickets: the stage-2
   hand-off has never run against a real ticket either.
2. **The graph could not reach an employer approval even if it were in the chain.** The
   trigger does NOT exclude `uc04_employer_approved`, so an approval's ticket update
   really would re-fire it — and `Claim Ticket (Idempotency)` claims
   `(UC-04, ticketId)`, which the intake run already consumed. The redelivery would die
   at `Duplicate Delivery — Stop` having written nothing, so **a stage-3 branch placed
   anywhere downstream of the claim can never run.** Moving it upstream of the claim is
   the shape that produced 21 duplicate customer replies on UC-01 (F-3), and
   `routeByDecisionSpec.js`'s header says in terms: do not move a branch ahead of the
   claim node again.
3. **The hand-off already exists and is better placed.** `handOffToMobility()` in
   `src/remoteui/server.js` updates the existing ticket the moment the manager decides —
   after both durable writes, unable to lose the decision, auditing its own failure under
   its own action name and reporting it to the manager in the HTTP response. An n8n leg
   would be an asynchronous second copy with no way to tell the decider it failed.

**So what n8n owns is preparing the case, and that is what was built.** The reviewer's
prepared case itself — the facts, the four dimensions, the risk posture, the gate ladder
— already exists and was checked: `src/uc04/decisionFacts.js` computes it,
`GET /uc04/api/authorizations/by-ticket/:ref` serves it, and the ZAF UC-04 panel renders
it along with the stage-3 `clear`/`decline` control and `MOBILITY_REVIEW_NOTICE`. The
note **points at that surface rather than reproducing it**: porting 1,400 lines of
dimension reasoning into a Code node would be a second copy kept in step by nothing.

### A repo-wide finding, not owned here

**All nine intake triggers carry `uc_processed` in their `not_includes` loop guard, and
nothing anywhere sets it** — grepped across all nine deployed graphs, 0 occurrences. So
every one of these graphs re-fires itself on its own terminal Zendesk write. It is
durably harmless (the claim node stops the redelivery) and it is not free: on UC-04,
`Fetch Employment (Remote)` runs *before* the claim and carries no `onError`, so once an
employment id ages out, the next comment on a long-finished ticket becomes an errored
run, an `ops_alerts` row and a Telegram push. Recommended as a separable change in
`DEPLOY-2026-08-31.md` §3, with its blast radius stated: `uc_processed` excludes a ticket
from all nine intakes, not just UC-04's.

### Pinned

`test/n8nUc04StageVocabulary.test.js`, 15 tests: the decision vocabulary is unmoved, the
prose names the customer's manager and Remote's product, four phrases can never come
back, the note carries no harness vocabulary, and the note expression is asserted against
the field the gates node **actually emits** — an n8n expression naming a field nothing
produces renders as an empty string on a fully green execution, which is the
`verify-traces` dead-probe-name class one graph over. Negative-controlled twice: **7 of
15 fail** against the pre-change node body, and `flagAwaitingApprovalIssues()` is shown
rejecting the live node as it stands today plus seven single-field mutations of the
target.

Suite: **4943 tests, 4940 pass, 0 fail, 3 skipped** (baseline 4928/4925/0/3).
`verify-deployed`: **58 checked · 1 drifted** — `Workation Gates`, which is the deploy.

### Not done, and named

- **`src/uc04/requestParser.js` still carries the old sentence** verbatim
  (`draftSummaryTemplate`, the `specialist_approval` branch). It is the same defect in
  the Node path, it is outside this pass's ownership, and it means the two copies of
  UC-04's summary now say different things until it is corrected. The n8n parity test
  does not compare summaries across the two, so nothing will go red.
- **`src/portal/ticketing.js` tags every UC-04 hand-off `uc04_specialist_approval`** —
  the wrong actor again, on 20 live tickets.
- **The new Zendesk-node spec is not wired into `verify-deployed`.** Adding the
  `STRUCTURAL_MAPPINGS` row is a two-line change to `scripts/lib/deployedNodeMappings.mjs`
  and would move `Flag Awaiting Specialist Approval` out of the unguarded baseline; until
  it lands, `flagAwaitingApprovalIssues()` is checked hermetically only.

### The checker nothing called (closed 2026-08-31, same day)

The pass above shipped `flagAwaitingApprovalIssues()` and fifteen hermetic tests that
prove it catches every one of the four defects on the live node — and its own header
said, honestly, that **nothing ran it against the deployment**: the node had no
`STRUCTURAL_MAPPINGS` row and sat in `unguarded-node-baseline.json` as accepted debt.
That is a detector, not a guard. For a few hours the state was the one
`scripts/lib/nodeCoverage.mjs` exists to describe: `verify-deployed` reporting
**0 drifted**, true and meaningless, because the node was never among the ones it
compared.

Wired now. `scripts/lib/deployedNodeMappings.mjs` gains the row —
`checkParams: flagAwaitingApprovalIssues`, `expectedInputs: ["Route by Decision"]`,
`expectedOutputs: []` — and the baseline entry is removed in the same change.
**Live afterwards: `59 nodes checked · 0 drifted · 126 of 183 live nodes NOT checked ·
0 new unguarded nodes failing the ratchet`** (58 / 127 immediately before). It is the
first `STRUCTURAL_MAPPINGS` row on UC-04's graph and the second outside UC-01's.

**`expectedInputs` is doing real work here, not filling a field.** Output **0** of
UC-04's `Route by Decision` is the `ready_for_approval` branch (read live: rules are
`0:ready_for_approval 1:blocked 2:escalate`, fallback `unrecognised`), and
`structuralNodeIssues()`'s `expectedInputs` check reads `main[0]` specifically — so a
rule reorder that pointed the *awaiting-your-manager* note at a **blocked** trip turns
`verify-deployed` red. `expectedOutputs: []` pins the node terminal, so anything wired
downstream of a customer-facing Zendesk write has to be declared rather than appear.

**Three tests hold the wiring itself**, because a guard is only as real as the thing
that invokes it, and `ratchetViolations()` keys off the LIVE unchecked set — which
makes a leftover baseline entry harmless residue rather than an error, and therefore
invisible. So the baseline's *absence* is asserted directly. All three were
negative-controlled against a mutated tree, one regression at a time: row deleted
(**2 fail**), `checkParams` swapped for a stub returning `[]` (**1 fail**), baseline
entry restored (**1 fail**), `expectedInputs` emptied (**1 fail**), restored (**0 fail**).
The stub case is the one worth naming — the row is checked by *running* its
`checkParams` against both the good node and the known-bad snapshot, not by comparing
function identity, so a row wired to something merely named alike still fails.

**Two things this does not cover, stated rather than implied.** UC-04's
`Route by Decision` has no `STRUCTURAL_MAPPINGS` row of its own, because
`routeByDecisionSpec.js`'s `RULES` are UC-01's seven decisions and UC-04 emits three —
a UC-04 route spec is its own work order. And the graph's **other three terminal Zendesk
nodes** (`Flag Blocked Workation`, `Escalate Workation Ticket`, `Unrecognised Workation
Decision`) are still baselined and their prose has never been read against UC-04.md §1a.
The defect this pass fixed was found by accident; nothing has yet looked for it in the
three places it is most likely to also be. Inventory and counts:
`docs/DEPLOYED-NODE-COVERAGE.md`'s 2026-08-31 update.

---

## §3.110 — twenty-six terminal Zendesk nodes deployed and proven on real tickets, and the outage that found itself on the way

**2026-08-31.** The 2026-08-31 audit found wrong prose on the terminal Zendesk
nodes of seven graphs. This is the pass that published the corrections, wired
them into `verify-deployed`, and drove **thirteen real Zendesk tickets** (83–95)
through
production to prove it. It also found, by accident and by driving rather than by
reading, that **UC-01 currently answers no new ticket at all**.

### What a "terminal Zendesk node" is, and why nothing could see it

A Zendesk *update ticket* node carries no `jsCode`. `MAPPINGS` in
`scripts/lib/deployedNodeMappings.mjs` diffs `parameters.jsCode` against a file,
so it is **structurally blind** to these nodes: their sentences were typed into
node parameters, versioned by nothing and diffed by nothing. And
`test/n8nUc0NParity.test.js` compares **decisions** — so a node that reaches the
right verdict and describes it to the wrong person passes every parity test
there is.

That blind spot is where all of the following lived at once:

- UC-09's payroll notes said `AI drafted` and `HIGH RISK` on a graph with **zero
  LLM nodes**, and told a specialist an escalated adjustment `needs manual
  payroll handling`.
- UC-05's sign-off note asserted *"No Remote write exists"* — false since
  `PUT /v1/resignations/{id}/validate` shipped. The boundary is a **policy
  choice**, and saying it is an absence in Remote's API misdescribes the one
  decision the use case is built on.
- UC-06 printed *"Payroll cycle: none identified"* where the calendar had
  **never been consulted** — a refusal dressed as a finding.
- UC-03's `Render Informational Answer` — the one string on that graph a
  customer reads — told them to *"reply to this ticket and a specialist will
  review and issue it"*. The graph claims `(UC-03, ticket)` before its first
  durable write, so a reply re-triggers it and stops at `Duplicate Delivery —
  Stop`. Advice to do the one thing that produces nothing. `UC-03.md` had
  **quoted that sentence as a defect** for longer than it took to fix, because
  nothing read the node.
- UC-01's `Reply Out of Scope` opened *"I'm sorry, I only handle…"* — first
  person singular, from an automation, promising a return it does not make.
- Fourteen escalation notes claimed a queue tag the ticket never receives
  (rca-iih7 / D-14).

### One table, two consumers

`workflows/nodes/terminalZendeskDeployTargets.js` pairs all **26** nodes with
the spec that owns their parameters and the checker(s) that must pass after
publication. `scripts/deploy-terminal-nodes.mjs` publishes from it;
`STRUCTURAL_MAPPINGS` checks from it. They are the same objects, so what is
deployed and what is verified cannot drift.

The **orthogonality** is what makes two specs naming one node sane rather than
redundant: a per-use-case spec owns the node's PROSE, `escalationQueueTagSpec.js`
owns one dimension of its TAGS and deliberately inspects nothing else. A node
covered by both gets one parameters object and **both** checkers — stricter than
picking a winner. And the module **throws at import** if a prose edit would
revert D-14, so the deploy tool cannot start rather than silently undoing
rca-iih7 on thirteen nodes and reporting success.

### Deploy order is not interchangeable

**Code nodes first, Zendesk parameters second.** The Zendesk nodes interpolate
fields the gates bodies compose; published in the other order they dereference a
field that does not exist and render an **empty string on a fully green
execution**. On UC-02's `Resolve Expense Ticket` that is an empty public reply
to a customer whose expense has just been approved.

`verify-deployed` afterwards: **86 nodes checked · 0 drifted · 0 unpublished**,
baseline pruned 111 → 99.

### The proof — thirteen tickets driven, eight completed, read back off Zendesk

Thirteen `uc0N_test` tickets were created (83–95). **Eight completed** and are
the proof below; the other **five are UC-01 and completed nothing** — that is
the outage in the next section, not a gap in this one. Both numbers are stated
because quoting only the eight would describe a pass that went better than it
did.

Not deploy status codes. The notes themselves, read from the tickets:

- **#91 — UC-03, the strongest.** `auto_resolve`, ticket **solved**, and the
  customer received the replacement paragraph: a formal letter *"is a separate
  request rather than a reply here… Raise one in Remote's Request Hub"*. Plain
  text, no entities, no harness vocabulary.
- **#83 — UC-09.** *"DECIDED BY DETERMINISTIC CODE — this workflow runs no
  language model at any step"*, and for `identity_not_verified`: *"Money never
  starts moving on a request whose origin is unverified… There is no route from
  here to a payment."* No `HIGH RISK`, no `AI drafted`, no `manual payroll
  handling`.
- **#84 — UC-05.** Names `PUT /v1/resignations/{id}/validate`, scope
  `resignation:write`, and calls the boundary *"a policy choice, not an absence
  in Remote's API"*.
- **#85 — UC-06.** *"Payroll cycle: NOT EVALUATED — the run stopped before the
  payroll calendar was consulted."*
- **#89 — UC-02.** States that the run stopped at gate 1 **before** gate 13,
  so the classifier's confidence *"played no part in this outcome"* — the
  fail-closed confidence guard landed earlier the same day, rendered.
- **#90 — UC-04.** `Mobility & Legal (Tier-2)` spelled one way throughout, and
  the three-stage model named.

One incidental finding: `&amp;` appears in a note's `plain_body` and
`html_body` but **not** in `body`. That is Zendesk's own rendering, not the
note — worth knowing before someone "fixes" a group name that is already
correct.

### What driving found that reading could not

**UC-01 processes nothing.** Five real `uc01_test` tickets (88, 92, 93, 94, 95)
produced executions `11174`, `11179`–`11182`. All five `success`, `pinData:
null`, all five decided correctly at `Identity + Policy Gates` — and **all five
stopped at `Duplicate Delivery — Stop`**, claim node `main[0]` empty and
`main[1]` populated: the primary key refused the insert.

`workflow_claims` keys `(use_case, external_ref)` and `external_ref` is a bare
ticket number with no record of which account minted it. `your-subdomain` reached
**#143**; `your-subdomainhelp` restarted at **#1**. So a brand-new ticket is refused
service as a redelivery of an unrelated one. It is the **write-side twin of
CLAUDE.md §7 item 23**, and item 23's fix (`zendeskAccounts.js`, derive the
account from a row's timestamp) does not touch the ledger at all.

The other eight graphs looked fine because the key includes the use case and
UC-01 is the most-driven graph in this project's history — **the sample that
worked was the larger one, and the use case that is completely dead is the
flagship.** Recorded as CLAUDE.md §7 honest-gaps **item 24** with two remedies;
not fixed here, because every remedy rewrites how a production ledger is keyed
and §7b reserves that.

### Also this pass — the screen that sorted by a fact it did not show

`/remoteui`'s work-authorization queue listed 23 rows with no filing time, while
`sortBySubmittedAt()` **ordered the list by `submitted_at`**. So an employer
could not tell which row was the request they had just filed — the question the
screen exists to answer — with the data already in the payload governing the
order. Now rendered per row, absolute (the list auto-refreshes every ten
seconds, so a relative stamp restates itself against a moving now), with the
exact ISO instant in the `title`, and an unrecorded time rendered as *"filing
time not recorded"* rather than as a plausible date. Three tests, negative-
controlled against the pre-fix asset: exactly those three fail there.

---

## §3.111 — the ledger key is now account-qualified, and UC-01 answers tickets again

**2026-08-31, immediately after §3.110 found the outage.** §3.110 ended with a
diagnosis and no fix: `workflow_claims` is keyed `(use_case, external_ref)`,
`external_ref` was a bare Zendesk ticket number, this project has moved account
twice, and the current account restarted its numbering at 1 while the retired
one reached 143 — so five brand-new tickets were each refused by the PRIMARY
KEY as a redelivery of an unrelated old one, silently, with every execution
reporting `success`. That was left unfixed on purpose: every remedy rewrites how
a production ledger is keyed, and CLAUDE.md §7b reserves that. The owner chose
**option 1** within the hour.

### What was built

`src/shared/claimRef.js` — `qualifyClaimRef()` turns a bare ticket number into
`<account>:<number>` and leaves everything else alone. The account comes from
the open row in `ZENDESK_ACCOUNTS`, the register this project already updates on
an account move, so a fourth move is one line.

**The fix is additive, and that is the whole argument for it.** A qualified ref
can never equal a bare one, so no row was migrated, updated or deleted: every
historical claim keeps its meaning and keeps protecting the ticket it was really
about. It also meant no write to the production database — which could not have
been executed from this container anyway (CLAUDE.md §6: Supabase is unreachable
over raw TCP here). The rejected alternative, deleting the pre-migration claim
rows, is one statement and instantly correct, and it throws away the
exactly-once history of every ticket the retired account processed. Cheaper and
strictly worse.

**Only a bare ticket number is qualified**, and the narrowness is load-bearing.
A descriptive proof ref, a portal submission id, a content-derived dedupe key
(`src/thirdparty/`, `src/uc01/selfServiceLetter.js`) and the authorization UUID
UC-04's stage 3 claims under are already globally unique and name no account.
Qualifying them would change a key for no reason AND break continuity with the
rows that already hold them — a new failure in exchange for nothing.

### One rule, two execution paths

The Node app calls a function; the nine n8n graphs evaluate a STRING, and a
string is covered by no test that imports a function. So
`workflows/nodes/claimNodeSpec.js` GENERATES the expression from the same
`currentZendeskAccount()` the Node path keys on, and
`test/claimRefQualification.test.js` executes the published expression in a
`node:vm` sandbox with n8n's own `$json` / `$execution` in scope and asserts the
two agree over one shared table of inputs — the same discipline
`test/n8nParity.test.js` applies to Code-node bodies, applied to an expression.

Two paths keying differently would be the two-ledger failure the single shared
table exists to prevent, reintroduced one level down. And an n8n Code node
cannot read `process.env` at all (CLAUDE.md §4 records a webhook header that
went out empty for exactly this reason), so the account HAS to be a literal in
the published expression — which is why it comes from a versioned table rather
than an environment variable.

`CLAIM_TARGETS` moved out of `scripts/verify-claim-nodes.mjs` into that spec, so
the deploy and the live checker now read one object. `test/claimNodeContract.js`
used to scrape the table out of the script's source with a regex, because that
script runs network calls at module scope and cannot be imported; it now imports
the real table, the same upgrade `deployedNodeMappings.mjs` got in rca-rqeo.

### The read side, widened — but only where it moved

`readStore.lookupRef()` and `findClaimDecision()` now search BOTH spellings,
qualified first. Rows written before today hold the bare form, and a human
typing `93` into the audit viewer's bug-audit tab means "the ticket in front of
me" — on that screen an absent claim row is read as *"the exactly-once ledger
did not protect this ticket"*, so answering with one spelling would be a
confidently wrong answer rather than a near miss.

The DECISION search was deliberately **not** widened. Only the claim node's key
changed; `audit_log.details->>'externalRef'` still carries the bare ticket
number, and matching a qualified spelling there would match nothing while
implying the audit trail had moved too.

### Proven in both directions, on one real ticket, minutes apart

Deployed to all nine graphs and verified from the read-back — 9/9
`versionId === activeVersionId`, `verify-claim-nodes` **9 checked · 0 defective ·
0 unpublished**. Then a real `uc01_test` ticket, **100**, chosen deliberately
INSIDE the collision range:

| | execution | claim node outputs | outcome |
|---|---|---|---|
| first delivery | `11198` | `main[0]` **1**, `main[1]` 0 | 22 nodes `success`, `pinData: None` — `cases 57486123`, `audit_log 0f73955e`, audit trace, review queue, routing, Zendesk write. Identity `requester_matches_employment`; decision `human_review / over_scope_request`. Claim row reads **`external_ref: "your-subdomainhelp:100"`** |
| redelivery, same ref | `11200` | `main[0]` 0, `main[1]` **1** | 9 nodes, `lastNodeExecuted: "Duplicate Delivery — Stop"`, nothing written |

The first row is the exact inverse of the five dead runs in §3.110. The second
matters just as much: **exactly-once was not traded away to get
exactly-anything.**

`npm test` on this tree: **5,318 tests, 0 fail.**

---

## §3.112 — the sidebar dropped the employer's approval at the moment it mattered

**2026-08-31, found by the project owner opening an approved ticket** (#82) and
asking where the employer's name and position were. Three defects, none visible
to any existing test, compounding into one blank space.

**1. The block was hidden, not missing.** The API published it the whole time —
verified live against the deployment for that exact ticket, which returned
`settled: {headline: "Approved.", facts: [...]}`. `main.js`'s `renderActions()`
drew `settled` only inside its `if (!view.actionable)` branch, a rule written
when *settled* and *nothing left to do here* were the same thing. Since
2026-08-31 (§3.109) UC-04 is BOTH: stage 2, the employer's approval, is settled,
while stage 3, Remote's own mobility review, is open on that very screen. So the
employer's approval vanished from the panel at exactly the moment a specialist
is asked to review it — the one moment knowing who approved it matters. The
panel's own comment asserted the settlement *"is rendered in full by the DECISION
card's `settled` rows"*, which had silently become false.

It now renders above the controls, set off by a rule, **without the `finality`
sentence** — *"an approved request cannot be approved or declined again"* is true
of the stage below and reads as "there is nothing to do here" when printed
directly above a live control. The closed-case branch still prints it in full.

**2. The name was never durable.** `uc04_authorizations` has no column for the
approver's display name (`recordEmployerDecision()` says so and explains why),
so it lived on the in-memory row and in the prose of a Zendesk note. The sidebar
reads Postgres from another process, so the strongest thing the panel could have
said was *"Approved by admin_jane"* — a session id, which is an audit-grade
identity and not an answer to "who approved this".

The audit log is now the store for it, exactly as it already is for stage 3:
`src/remoteui/server.js` records `approverName` in the append-only row's jsonb
`details` (no migration, and `actor` still carries the id unchanged), and
`src/uc04/employerDecisionLog.js` reads it back. It fills a null and never
overwrites a fact the row already holds; a missing name yields null and the
panel prints the id alone, because an id is a worse answer than a name and a
fabricated name would be far worse than either. An unreachable audit table costs
the name, never the panel.

**3. An employer DECLINE was not settled at all.** `settledFacts()`'s approve
branch accepts a row on `approvedAt` — precisely because the employer's stored
status is Remote's own `approved_by_manager` rather than `executed`. The decline
branch tested only the status word, and `declined_by_manager` is not an alias of
`declined` (`STATUS_ALIASES` maps `denied` and nothing else). So a decline fell
through to null and the panel showed no settled facts: the decliner, the date
AND the mandatory reason all gone, on the outcome where a reason is compulsory.
Asymmetric handling of two halves of one decision is how a negative outcome comes
to be less well recorded than a positive one.

`test/uc04EmployerApproverIdentity.test.js` (9 tests) pins all three, and is
negative-controlled: exactly 3 of the 9 fail on the pre-fix tree, one per defect.

---

## §3.113 — UC-01 driven green on a real ticket, and what the green run found

**2026-08-31.** The first UC-01 ticket to complete since the ledger fix
(§3.111), driven end to end and verified from the destination rather than the
run flag.

**Ticket 101** — real `uc01_test` ticket, requester Alex Morgan, whose email the
identity gate matched against the Remote Sandbox record. Execution **`11206`**,
`pinData: None`, **29 of 29 nodes `success`**, `auto_resolve /
all_gates_passed`, zero flags. `classification.source: "llm"`, intent
`standard_letter`, confidence 0.95. Real rows with server-generated ids:
`cases 9cbc7daa`, `audit_log 0544fbe5`, and a `workflow_claims` row reading
**`external_ref: "your-subdomainhelp:101"`** — the qualified key, on a green run.

Read back off Zendesk, not inferred from the execution: ticket **101 solved**,
tagged `uc01_auto_resolved`, in HR Ops (`99900000000009`), with a public reply
delivered as **rendered HTML** rather than escaped source. The letter names the
employing entity, status, contract type, start date and probation, and carries
the confidentiality sentence. **It contains no salary** — against a record whose
`compensation_gross_amount` is `10399748`, checked by reading that value off the
Sandbox and searching the delivered text for it.

### The finding the green run produced

Ticket **100**, driven an hour earlier against the SAME employee, asked for
*"my job title"* and was correctly refused to a human as
`human_review / over_scope_request` — `job_title` is not in
`STANDARD_LETTER_FIELDS`. Ticket 101 did not ask for it **and the letter
delivered it anyway**: `Job title — Content Writer Wizard`.

So UC-01 escalates a request that NAMES the job title and discloses it unasked
to a request that does not — same person, same document, same automation. Both
lists are individually defensible (one answers "what may this letter contain",
the other "what may be asked for without a human looking") but not in this
direction: a field cannot be too sensitive to be asked for while being printed
unasked.

**Not fixed here.** Adding `job_title` to `STANDARD_LETTER_FIELDS` widens what
auto-resolves and feeds `authorisableDisclosures()`, the release path — a
disclosure-policy change, not a mechanical one, and this repository does not
widen a gate as a side effect of an unrelated pass. Recorded with both options
and a recommendation as `qa/HUMAN-DECISIONS-REQUIRED.md` **K15**.

---

## §3.114 — the sidebar stops showing repository internals, and names the approver

**2026-08-31, both found by the project owner reading the panel before showing
it to an audience.**

### 1. Repository internals in customer-facing prose

The panel was rendering source-tree paths (`src/uc04/decisionSources.js`),
`docs/knowledge/…md` citations, internal register ids (`C-8`, `K-4`), an
entitlement-roster key (`uc04:mobility_specialist`), a refusal code
(`approver_not_entitled`), the decision slug (`all_gates_passed`) and raw UUIDs
where a person's name belongs.

**The rule already existed and this surface was missed.** On 2026-08-29 the
public surfaces — `/portal`, `/audit`, `/queue` — were stripped of exactly this
class ("internal issue ids and `src/` paths", CLAUDE.md §4). The ZAF sidebar is
served by Zendesk out of `zaf-app/`, not by that deployment, so it was not in
that pass.

**A citation is not weakened by losing its file path.** What makes it checkable
— the instrument, the article locator, the publisher, the retrieval standing
(*"Regulation (EU) 2016/399, Article 6(1), [CONFIRMED — statute, retrieved
2026-08-19]"*) — all still renders. The repo path only ever said where OUR COPY
lives, which is not a fact about the law. The API still publishes `path` for a
reviewer who has the repository; a screen is not that reviewer.

`test/zafNoDeveloperArtifacts.test.js` is the durable part: it renders the REAL
`main.js`/`panels.js` into the fake DOM and scans the text that came out for
seven forbidden patterns. Asserting on the rendered page rather than the payload
is the whole point — the payload may legitimately carry a path.

### 2. "Approved by admin_jane" is not an answer

The owner's objection, in their words: *"admin_jane could be anybody… just
imagine Remote has a hundred companies as clients. How do they know which
company admin_jane is? How do we know the position of admin_jane?"* — and
`admin_jane` reads like somebody at Remote when the entire point of stage 2 is
that the decision belongs to the **customer**.

Three rows now, each omitted rather than guessed when it was not recorded:

| | |
|---|---|
| Approved by | Jane Okonkwo (admin_jane) |
| Their role | Head of People Operations |
| Acting for | Meridian Analytics — the employer, not Remote |

*Their role*, not *job title*: it is the standing the decision was made in,
which is the question a reviewer is asking. The session id stays beside the
name because it is what the audit trail is keyed on and what the Zendesk
hand-off note already prints — the two surfaces must agree; it is only demoted
from being the whole answer.

**The identity is a named, marked fixture — rung 4, and it had to be.** No
company name exists anywhere in the Sandbox record: an employment carries
`company_id` and `legal_entity_id` and no human name for either, so there is no
higher rung to take it from. `approverTitle`/`approverCompany` have no column on
`uc04_authorizations` either, so they ride on the append-only audit row's jsonb
and are read back by `employerDecisionLog.js` — the same route the name took in
§3.112, for the same reason.

### Identifiers a person can read

`shortReference()` renders a UUID as its first block (`45cca190`) — a **prefix
of the real id**, not a hash, so it still resolves by prefix search and can
never name a record that does not exist. The full key stays on the record and on
the audit row. Anything that is not a UUID is returned unchanged: an email
address or a ticket number is already readable, and truncating one would destroy
information rather than hide noise.

It exists three times — `main.js`, `panels.js`, `src/shared/publicReference.js`
— because the two browser files are separate `<script>` tags with no module
system between them. Publishing it on `window` from one and reading it in the
other was tried first and **silently degraded to a no-op**, which is precisely
why the three copies are now held equal by test.

### Four tests changed direction, not by accident

Four existing tests asserted these strings MUST survive, each with a stated
reason. Every one was written for a specialist with database access; none was
written for a page shown to customers. Each is now inverted with the argument
recorded in place: `uc02Review` and `zafApp` (the decision slug — traceability
lives on the `audit_log` row, which is where a searchable identifier belongs),
`zafApprovalRole` (the role slug — the row already names the role in words and
says what it decides), and `uc04DecisionSources` (the spec section number — what
the assertion was FOR, that the requirement is this use case's own rule and not
an authority's, is now asserted directly).

`npm test`: **5,333 tests, 0 fail.**

---

## §3.115 — the same sweep across the other eight use cases

**2026-08-31.** §3.114 cleaned the UC-04 panel and guarded it by rendering that
panel and scanning the text. The project owner's reply was the right challenge:
*"I hope when I check all the other use cases, I will not see developer
information in the sidebars again."*

**They would have.** §3.114 fixed the panel that was reported and guarded only
that one — a render check proves what a reader sees, but only for a case
somebody seeded, which is how the leak survived the first pass.

### What the wider check found

`test/decisionProseIsCustomerFacing.test.js` covers all nine use cases at the
place every one of these leaks actually lived: the `decisionSources.js` /
`decisionFacts.js` modules that compose the prose the panels display. It runs
twice over each module — once walking **exported values**, once over the
**source text** — and the second pass is the one that matters. Run alone, the
export walk passed eight of nine modules while `src/uc05/decisionFacts.js` still
contained *"Adding this country's statutory notice rule to
src/uc05/noticePeriodTable.js"* and `src/uc04/decisionFacts.js` still named
`uc04_authorizations`, both **inside functions**, both destined for a screen. A
guard that reports clean on prose it never looked at is worse than no guard.

Comments are stripped first, and that distinction is the design: this repository
explains itself in comments and must keep naming files, tables and findings
there. The rule is not *never write `src/` in this file*; it is *never put it in
a string a customer will read*.

Fixed in UC-04, UC-05, UC-07 and UC-08 — a source file behind a notice figure, a
routing module named as its own finding, a spec section behind a treaty table, a
`travel_document_number` traced to the module that resolves it, and four
references to the `uc04_authorizations` table. Every sentence keeps its meaning:
*"the notice-period table"*, *"the routing table"*, *"this system's
work-authorization record"*.

### And every panel's identifier rows

`panels.js` printed a bare `employmentId` and `requester` in **every** use
case's rows. UC-04's were shortened when it was reported; the other eight were
not — exactly the gap the owner asked about. All seventeen id renders now go
through `shortRef()`, and a structural test refuses a bare id in any panel,
present or future. It also asserts the transform is still REACHED, because a
guard that passes by the rows having been deleted would be worse than the leak.

`npm test`: **5,352 tests, 0 fail.** Two more existing assertions changed
direction with the prose, each for the same reason as the four in §3.114: both
demanded a repository artifact — `/audit_log|reason_text/` and
`/noticePeriodTable\.js/` — in a sentence that renders on a customer-facing
screen. What each was FOR is unchanged and is now asserted in the words that
replaced them.

---

## §3.116 — all nine panels opened, and the two leaks that only opening them found

**2026-08-31.** §3.115 swept the prose modules for all nine use cases and
guarded the class statically. The project owner then asked for the thing that
had still not been done: **open each of the nine panels and check them.** Two
leaks were sitting there that nothing already written could have found.

### What only rendering found

- **UC-01 printed `uc01:hr_ops`** in the middle of a sentence about who decides:
  *"the entitlement roster grants uc01:hr_ops"*. Invisible to the prose check,
  which reads `decisionSources`/`decisionFacts` — this string is composed in
  `panels.js`.
- **UC-08 cited the Dutch residence article and rendered a passage naming
  `src/uc04/riskMatrix.js` and `src/uc04/decisionFacts.js`** — this project's own
  source files, shown to a customer as though they were part of Netherlands tax
  law. Invisible to everything, because the string lives in a **generated**
  corpus built from a retrieved statutory document that nobody would think to
  scan for source paths.

The second is the more serious finding, and it is not really about strings. Each
sidecar under `docs/knowledge/` is a retrieved authority **plus this project's
own commentary about it** — *"What this settles"*, *"Why this is the entry most
likely to change someone's mind"*. The chunker admitted every `##` section
equally, so those notes became **citable passages**, served beside the statute,
in the same shape, under the same authority's title.

### The fix, and the measurement that corrected it

The chunker now refuses text that names this repository's own code — on the
principle that a passage written about our system cannot be source material.

**The first attempt dropped the whole section and was wrong.** It took the corpus
from 57 passages to 30, lost two documents entirely, and broke UC-08's 183-day
retrieval outright — `test/uc08.test.js` failed with *"a 183-day question must be
answered from the retrieved corpus, never from a model paraphrase"*. These
sidecars **interleave** a quoted limb with a note about what it settles for our
code; the quote is the citation, the aside is not.

Filtering per **paragraph** keeps 51 passages and all 14 documents, drops six
maintainer asides, and leaves every measured pair answering from the statute.
`test/statutoryRetrieval.test.js`'s floor of 50 now sits one above the count, on
purpose: a further fall means real coverage is eroding, which is when it should
go red.

Two n8n Code node bodies are regenerated from the corpus
(`nodes-uc08/buildDossier.js`, `nodes-uc07/relocationGates.js`), so both were
republished and read back.

### The guard is now nine panels, not one

`test/fixtures/nineSidebarPanels.js` seeds one case per use case, serves it
through that use case's **real HTTP handler**, and boots the real sidebar against
it. Every seed asserts its own decision and every panel asserts it actually
loaded — a not-found page passes any scan trivially, which is the exact shape of
false confidence this file exists to remove.

All nine: **clean**. `npm test`: **5,361 tests, 0 fail.**

The transferable lesson is the one this repository keeps paying for, in a third
costume: a check that covers the case somebody happened to seed reports clean on
everything it never looked at. §3.114 guarded one panel; §3.115 guarded the prose
modules; neither could see a slug composed in the panel layer or a source path
inside a generated corpus.

---

## §3.117 — seeds for the decline and blocked outcomes, and the leak they found

**2026-08-31.** §3.116 opened all nine panels and proved them clean, and named
its own limit honestly: nine *seeded* cases, one decision path each. A panel
branch only some other outcome reaches was not covered. The project owner asked
for those branches to be seeded too.

### What is now opened

**19 panel states**, up from 9 — every prepared case, plus:

| outcome | use cases | why not the others |
|---|---|---|
| **blocked** | UC-01 (`consent_refused`), UC-02 (`duplicate_submission`), UC-04 (`sanctioned_region`) | only these three have a `blocked` decision at all; the rest top out at `escalate` |
| **declined** | UC-01, UC-02, UC-03, UC-04, UC-05, UC-06, UC-09 | **UC-07 and UC-08 are absent BY CONSTRUCTION** — no execution path, no POST route, nothing to decline. A decline seed for either would assert the opposite of their headline guarantee |

These are the pages where a leak matters most: somebody is being told their
request was refused, and by whom.

### The leak it found

**UC-02's blocked panel printed a raw store-row UUID and a raw ISO instant** —
*"Its store row a8bd1baa-f808-43d7-b8be-dbb5ae378763 … Decided at
2026-08-31T22:10:50.422Z"*. Nothing before this reached it: the prepared seed
decides `human_review`, and this text is composed only on the duplicate-receipt
refusal.

The pointer itself is right and stays — it exists so a reviewer can open the
earlier record instead of searching for a row they have no key for. It is now a
short reference (a **prefix**, so a prefix search still finds it) and a date a
person reads.

### Three seeds were wrong before they were right, and the seeds caught it

Each seed asserts its own outcome, which is what turned three quiet fixtures
into three loud failures:

- **UC-02 blocked** first re-submitted the *same* expense. That is not a
  duplicate receipt and is correctly not blocked — the gate's own words are
  *"already reimbursed on ANOTHER expense"*. Fixed to two different expenses
  sharing one receipt hash.
- **UC-09 declined** posted `decline`; that API still speaks Remote's older
  negative verb and answered `unknown_action`.
- **UC-03 declined** could not reach `formal_letter_requested` at all, because
  since 2026-08-30 a letter request auto-resolves as `standard_letter_issued`
  for every seeded employment. It uses `letterAutoIssue: false` — UC-03's own
  documented deployment switch for turning the 🟢 auto-issue rung off — rather
  than a fabricated employment. **That is the product working, not a gap.**

A seed that had quietly rendered the wrong outcome would have produced a green
scan of a page nobody asked for.

`npm test`: **5,371 tests, 0 fail.** One existing assertion changed with the
prose — it demanded the FULL store-row UUID in the panel text, and now demands
the short reference and refuses the full one.

---

## §3.118 — the panel computed the numbers and then hid them

**2026-08-31.** The project owner opened UC-04's sidebar as the mobility
specialist would and asked the question the whole use case rests on: **what is
the point of this automation?** They could not see the research. The only thing
that stood out was who approved it — which was there because they had asked for
it the day before.

**They were right, and it is measurable.** On a real prepared case the panel is
19,483 characters. What is open by default: the risk rail, who this is about,
who filed it, the trip line, *what was NOT established* at full length, and the
decision form. What is **collapsed**:

| collapsed section | characters |
|---|---|
| Every check that cleared (N) | **3,613** |
| The rules this is based on | 4,856 + 2,228 |
| What each of these does not establish | 1,580 |
| Decided by check 18 of 18 | 2,228 |
| How to read the sources under each finding | 995 |

**Every figure the system computed was in the first row of that table.** Days
already spent in the destination, the Schengen 90-in-180 allowance, the
183-in-365 tax-residency watch, the treaty and PE findings — all one click away,
while the caveats were unmissable. The work HAD been done. A panel that leads
with its own limitations reads as though it has nothing to say.

### The change

`renderMeasurementStrip()` puts the counts directly under the trip they are
about, open, before anything that qualifies them:

```
THE COUNTS THIS DECISION TURNS ON
Schengen days across a rolling 180 days      21 of 90 days     69 days left   Within the limit
Days in Netherlands across a rolling 365 …   67 of 183 days   116 days left   Within the limit
Each figure is repeated in full below, with the window it was measured over
and what the source says about it.
```

**It adds no figure, recomputes nothing and reorders no finding.** Every number
is `basis.measurements`, rendered from the same data the collapsed block renders
in full — and the window, the citations and the caveats all stay exactly where
they were, because a headline number without its caveat is the failure this
repository is most careful about. Each line ends in the state word the full
finding carries, so a measurement that is NOT within its limit says so here
first. A panel with no measurements renders no strip rather than an empty
heading.

### The seed had to change to see it

UC-04's prepared seed carried no `travelHistory`, so it produced ONE measurement
and no cumulative-presence breakdown — half of what a specialist actually gets.
It now carries a prior stay and reproduces the owner's own case: US → NL, 21
days, 46 already spent, 67 of 183.

`test/zafDecisionCounts.test.js` asserts the figures appear in text computed by
**stripping every `<details>` body** — i.e. what is on screen before anyone
clicks — that the strip is outside every collapsed section, that the window,
findings and citations are still below it, and that a measurement-free panel
renders nothing. Negative-controlled: the whole file fails on the pre-fix tree.

`npm test`: **5,375 tests, 0 fail.**

## §3.119 — UC-04's decision surface: four things a mobility specialist needs, put on the panel

**2026-09-01.** The owner asked whether everything a mobility specialist needs
to authorize a work authorization was on the sidebar. It was not, and the
answer named four gaps. All four are now closed, each as its own commit with
its own tests. Scope and rationale: `docs/UC04-DECISION-SURFACE.md`; evidence:
`docs/UC04-RESEARCH-FINDINGS.md`.

| | what the panel now shows | commit |
|---|---|---|
| **W-5b** | 20 findings rewritten to *state the fact, say what it blocks, say what would clear it* — capped and guarded by test | `3f37e8a`, `211d5bd` |
| **W-3** | **Notice before departure**, against Remote's own published 14-day floor and 3-8 week recommendation | `5550f10`, `32ba438` |
| **W-1** | **The request the employee raised in Remote**, read live — travel document number, work location, signing answer, reason, status | `d992b56` |
| **W-2** | **What they will be doing there** — the three questions Remote's own RWA form asks, plus the work location | `41bb894` |
| **Z = Y** | **Where the customer has companies** — art. 15(2)(b), the treaty condition the panel had been printing a caveat about | `1dc4579` |

**Five things worth keeping, each of which cost something to find.**

1. **A floor is not a ceiling, and both measurement renderers assumed a
   ceiling.** They print "67 of 90 days · 23 days left". Applied to a minimum
   that inverts — "91 of 14 days · 77 days left" reads as the worst row on the
   page when it is the safest. Rows now declare `comparison: "floor"`; absent
   still means ceiling, so nothing existing moved.
2. **The panel's own vocabulary already had the right word.** `urgent` —
   *"checked, and the time left to act on it is short"* — was written before the
   lead-time row existed and describes it exactly. The first draft used
   `breached`, which renders "OVER THE LIMIT" in the tone reserved for things an
   approval cannot override.
3. **Rung 1 was sitting unread.** W-3 shipped a `[PROPOSED]` 14-day line this
   project chose. Remote publishes a notice expectation for exactly this
   request (article `37802834593805`), and the research recording it was written
   the day before. Now `[VENDOR-PUBLIC]`, with a second line at 21 days that is
   reported and never flagged — advice is not a threshold, and this repository
   has twice turned a recommendation into a refusal (C-10, C-20).
4. **W-1 and W-2 both shipped smaller than scoped and better.** W-1 asked for
   two columns and a migration; `work_authorization_id` was already durable, so
   what was missing was a live READ, which brings six fields rather than two and
   cannot go stale. W-2 asked for six invented yes/no questions; Remote's own
   form asks three open ones, and rung 1 is not overridden by this project's
   opinion about what a form should ask.
5. **Two defects only DRIVING the bundle found, and both were invisible to every
   unit test.** `loadUc04()` builds its view from a whitelist, so two published
   server fields reached nobody while every test passed — the shape that once
   put `gateLadder` on zero of nine panels. And the linked-request provenance
   sentence printed a raw UUID at the specialist, caught by
   `zafNoDeveloperArtifacts.test.js` before it shipped.

**Nothing new can decide anything.** The activity profile, the linked request
and the employer presence are each asserted, by reading the gate files, not to
be imported by `policyEngine.js`, `riskMatrix.js`, `approvalPolicy.js`,
`workflow.js` or `requestParser.js` — and the activity profile behaviourally
too: the same request decides identically with an empty profile and with one
reading *"negotiating and signing a distribution contract in a biosafety level 3
laboratory"*. UC-04's blocking set stays immigration and data quality only.

**`npm test`: 5,428 tests, 0 fail.** **NOT deployed** —
`workflows/nodes-uc04/workationGates.js` carries the lead-time flag and is ahead
of the live graph `WORKFLOW_UC04_ID`, which it already was.
