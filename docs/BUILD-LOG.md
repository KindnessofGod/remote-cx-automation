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
