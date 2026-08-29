# REMOTE-VOCABULARY.md — our words vs Remote's words

**Status:** audit only. **No code was changed to produce this document**, and none
should be changed from it without reading §7 (the execution plan) first — three
of the renames below are on the wire or in a persisted column and need a
compatibility step, not a `sed`.

**Why this exists.** The user's ask was: *"make sure you change all my
terminologies to remote own terminologies."* They found the first instance
themselves — UC-02's positive review verb is `release` where Remote's expense
status enum says `approved`, and the four sibling use cases say `approve`. That
rename is in flight on another branch. This document is the search for **every
other one**, done the way §3 directive 4 requires: against Remote's own pages,
with the field or enum quoted, and every row tagged.

**Method.** 38 pages fetched from `https://developer.remote.com/docs/<page>.md`
and `…/reference/<page>.md` (the `.md` twins named by
`docs/REMOTE-API-INDEX.txt`, Remote's official `llms.txt`), plus five read-only
`GET` probes against the live Sandbox (`$REMOTE_BASE_URL`) to settle two
questions the docs left ambiguous. **Nothing in this document is inferred from
`src/remote/mockServer.js`, our fixtures, or our own comments** — those are the
three sources this repo has been burned by, and one of the findings below
(§6.2) is a case where a fixture-shaped belief survived in a comment for
months.

**Verdict counts:** **21 RENAME · 24 KEEP (ours by right) · 9 RENAME-IS-WRONG**,
plus **7 already-misused Remote words** in §6, which are the ones that read as
verified and are not.

**Suite:** `npm test` → hermetic, 0 failing (count in README)
(unchanged; this branch adds one document and touches no code. The earlier
figure recorded here, 2008, was true when §1–§12 were written; trunk has moved
since).

**Revised 2026-08-19 — §13 only.** The eight open questions §13 recorded
honestly as unconfirmed were taken back to Remote's own pages and to the live
Sandbox, **reads only**. Seven closed; one is open with a named next step.
Two of the closures contradict `[CONFIRMED]`-tagged claims that are in this
repository today, listed with file and line in **§13.10** — and one of them,
`POST /v1/work-authorization-requests`, is a live write into an endpoint that
does not exist. Nothing outside this file was changed.

---

## 1. How to read the verdicts

| Verdict | Meaning |
|---|---|
| **RENAME** | Remote has a word for this exact concept and we use a different one. `release` → `approved` is the template. |
| **KEEP — ours by right** | The concept is OURS and Remote has no counterpart. Risk tiers, gates, escalation, `human_review`, exceptions, idempotency claims, the audit trail. These describe decisions *about* Remote records, not fields *on* them. **Adopting a Remote word here would be worse than the mismatch** — it would claim the API has a concept it does not, which is the same defect as inventing an endpoint. |
| **RENAME IS WRONG** | The words collide but the concepts differ. Flagged loudly: these are the expensive mistakes. |

Evidence tags follow CLAUDE.md §3 directive 4: `[CONFIRMED]` = quoted from
Remote's own page or read live from the Sandbox; `[CONFIRMED-LIVE]` = a `GET`
this session made against `$REMOTE_BASE_URL`; `[INFERRED]` = reasoned from
absence in Remote's reference index; `[PROPOSED]` = our suggestion, no Remote
evidence either way.

**A corpus-absence note, because it does most of the work below.** Across the 38
fetched pages plus the full 468-line reference index, these strings occur **zero
times**: `workation`, `dossier`, `escalate`, `escalation`, `risk tier`, `human
review`, `sign-off`, `claim`, `deny`, `seniority`, `presence`, `treaty`, `hire
date`, `audit`, `idempotenc`, `specialist`, `requester`. `decline`/`declined`
occurs **648 times across the fetched pages and 47 more in the index**. That
asymmetry is the single most useful fact in this document.

---

## 2. Cross-cutting vocabulary (all nine use cases)

### 2.1 The negative review verb — the largest single rename

| Our term | Where it appears | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| `deny` / `denied` | `src/uc04/approvalPolicy.js` `ACTIONS`, `src/uc05/signoffPolicy.js`, `src/uc06/dualApprovalPolicy.js`, `src/uc09/multiApprovalPolicy.js`, `src/review/reviewPolicy.js`; store `status: "denied"` in `uc04_authorizations` / `uc05_resignations` / `uc06_amendments` / `uc09_adjustments`; audit actions `workation_denied`, `resignation_denied`, `amendment_denied`, `adjustment_denied`, `human_denied`; **route path `POST /api/…/:id/deny`**; ZAF sidebar buttons "Deny", "Deny as …"; portal label "Denied" | **`decline` / `declined`** | `[CONFIRMED]` Expense status enum: `"canceled","pending","declined","approved","processing","reimbursed"`, described as *"`declined`: Declined by a reviewer. See `reason` for details."* (`get_v1_expenses.md`). `DeclineExpenseParams` — *"Decline an expense"*, `{"status": {"enum": ["declined"]}, "reason": …}` required (`patch_v1_expenses_id.md`). `TimeoffStatus`: `"approved","cancelled","declined","requested","taken","cancel_requested"`. `DeclinedTravelLetter` / `DeclinedWorkAuthozation`, both `{"status": {"enum": ["declined_by_manager"]}, "reason": …}`. Endpoint `POST /v1/timeoff/{timeoff_id}/decline` — *"Decline Time Off"*. Webhooks `expense.declined`, `timeoff.declined`, `travel_letter.declined_by_manager`, `work_authorization.declined_by_manager`. **`deny` appears 0 times in Remote's entire corpus.** | **RENAME** | **HIGH.** Persisted (4 store status columns), on the wire (route path posted by the installed ZAF app), and in 5 audit action names. Needs the §7 Stage C treatment. |
| `rejected` | `src/review/reviewPolicy.js:59` — `["deny", {caseStatus:"denied", reviewStatus:"rejected", auditAction:"human_denied"}]`; persisted in `review_queue.status` | `declined` | `[CONFIRMED]` Remote uses `rejected` in exactly one place: `MinimalPayrollRun.status` — *"`rejected`: Rejected during approval and needs revision."* That is a **payroll run** being sent back by the company, not a human declining a review item. | **RENAME**, and separately **flagged**: we are already using a Remote word for something Remote does not mean by it. See §6.1. | **HIGH** — persisted, and the HITL accept-rate metric counts on this exact string. |

### 2.2 The positive review verb

| Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| `release` / `released` | `src/uc02/reviewPolicy.js` `ACTIONS` + `TERMINAL_ACTIONS`, `src/uc02/workflow.js`, ZAF "Release" button, portal "Released" | **`approved`** | `[CONFIRMED]` `ApproveExpenseParams` — *"Approve an expense"*, `{"status": {"enum": ["approved"]}}`; enum member described as *"`approved`: Approved by a reviewer and queued for reimbursement."* | **RENAME** *(already in flight on another branch — listed for completeness and blast radius)* | MEDIUM. The Remote write already sends `{status:"approved"}` (`src/uc02/workflow.js:591`), so this is our own verb only. But see §6.3: `released` is itself a misused Remote word. |
| `approve` / `approved` | `src/uc04`, `src/uc06`, `src/uc09`, `src/review` | `approved` / `approved_by_manager` | `[CONFIRMED]` as above, plus `ApprovedWorkAuthozation` / `ApprovedTravelLetter` `{"status": {"enum": ["approved_by_manager"]}}` | **KEEP** — matches. But see §5.4: which *member* we write is wrong for UC-03/04. | — |

### 2.3 Vocabulary that is ours by right — do not "align" these

Every row here was checked for a Remote counterpart and none exists. Adopting a
Remote word for any of them would claim the API has a concept it does not.

| Our term | Where | Remote counterpart | Evidence | Verdict |
|---|---|---|---|---|
| Risk tier 🟢/🟡/🔴, `USE_CASE_TIERS`, `classifyRisk()` | `src/shared/riskEngine.js`, every UC, ZAF "Low/Medium/High risk" | none | `[CONFIRMED]` `risk tier` = 0 hits. Remote's only `risk_*` vocabulary is `risk-reserve` (a cash deposit at onboarding) and `risk_assessment_reasons` (an offboarding termination-risk enum) — both about *money and legal exposure on a record*, not about how much human review a request needs. | **KEEP** |
| `gate`, `GATE_SEQUENCE`, gate ladder, `passed`/`decided`/`not_reached` | `src/shared/gateLadder.js`, `src/uc02/policyEngine.js`, `docs/GATES.md` | none | `[CONFIRMED]` `gate` occurs 124 times in the fetched corpus and **every occurrence is inside `gateway.remote.com` / `gateway.remote-sandbox.com` / "aggregated" / "investigate"**. Remote has no gate concept. | **KEEP** |
| `escalate`, `escalation`, `ESCALATION_ROUTES`, `escalation_tag` | `src/shared/escalationRouting.js`, every UC | none | `[CONFIRMED]` 0 hits for both strings. | **KEEP** |
| `human_review`, `auto_resolve`, `auto_approve`, `blocked` (our decision enum) | every `policyEngine.js` | none | `[CONFIRMED]` 0 hits. These name *what our automation did about a request*; Remote's statuses name *what state its record is in*. Different axes. | **KEEP** |
| `exception`, exception reason ranking | `src/metrics/compute.js`, UC-01 tag `verification_exception` | none | `[CONFIRMED]` no counterpart. | **KEEP** |
| `workflow_claims`, `claimExternalRef()`, "exactly-once", idempotency | `src/shared/workflowClaims.js`, all nine n8n graphs | none | `[CONFIRMED]` `idempotenc` = 0 hits; Remote's reference documents no `Idempotency-Key` header. (Our `#writeHeaders(idempotencyKey)` sends one anyway, which is harmless but unverified — `[INFERRED]`.) | **KEEP** |
| `audit_log`, `audit_trace`, `AuditLogger`, `logTraceStep()` | `src/shared/audit.js` | none | `[CONFIRMED]` `audit` = 0 hits in the whole corpus. | **KEEP** |
| `cases`, `review_queue`, `case` | `src/shared/caseStore.js`, ZAF "Case detail" | none | `[CONFIRMED]` no counterpart. | **KEEP** |
| `hold` / `held` | `src/uc02/reviewPolicy.js`, ZAF "Hold", portal "On hold" | none | `[CONFIRMED]` Remote's expense enum has **no held member** — `canceled\|pending\|declined\|approved\|processing\|reimbursed`. `reviewPolicy.js`'s own header already reasons this out correctly and it is worth preserving verbatim: mapping hold onto `canceled` would let a specialist asking for information silently kill an employee's claim. | **KEEP** — and see §2.5 for the near-miss. |
| `Finance Ops`, `HR Ops`, `Mobility specialist`, `Travel & Mobility Support`, `Mobility/Legal Tier-2` | `src/shared/escalationRouting.js` | none | `[CONFIRMED]` `specialist`, `finance ops`, `HR ops`, `payroll specialist` = 0 hits each. These are the *customer's* CX org, which Remote's API has no view of. | **KEEP** |
| `toRemoteInteger()` / `fromRemoteInteger()` / "×100 scaling" | `src/shared/money.js` | Remote's own phrasing is *"multiply your input value by 100"*, "input value" vs "API value", and in the OpenAPI *"integers in the currency's minor unit (cents)"* | `[CONFIRMED]` `docs/money-format.md`. No function-level name is offered. | **KEEP** — our names are descriptive and collide with nothing. |
| `externalRef` | every store, every n8n claim node | Remote's `external_id` is *a customer-defined identifier on an employment*; `zendesk_ticket_url` is the ticket link | `[CONFIRMED]` `MinimalEmployment.external_id`; `ContractAmendment.zendesk_ticket_url` — *"A link to the support ticket associated with this amendment, if one was created."* | **KEEP** — ours means the delivery reference (a Zendesk ticket id or a portal reference), which is neither of Remote's. Renaming it to `external_id` would be a §6-class error. But see §5.5 for a real alignment opportunity. |
| `approver`, `note` (the human's free text) | all approval policies | Remote has `employer_approver` and, for prose, `reason` | `[CONFIRMED]` `TravelLetterRequest.employer_approver` (`$ref → TravelLetterUser`). | **KEEP** for `approver` (aligned). `note` — see §2.4. |

### 2.4 `reason` — a collision to hold the line on

| Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| `reason` (a machine gate code: `over_policy_cap`, `identity_not_verified`, `all_gates_passed`, …) | every `policyEngine.js`, every store, `audit_log.details` | Remote's `reason` is **human prose shown to the employee** | `[CONFIRMED]` `DeclineExpenseParams.reason` — *"Reason for declination."*, required; example `"Expense not refundable"`. `DeclinedTravelLetter.reason` likewise required. `Expense.reason` is read back for display. | **RENAME IS WRONG** — the two are the same word for different things, and the safe answer is to keep both and never map one to the other. | **The live risk is a future mapping bug.** `src/uc02/workflow.js:591` currently does it right — it sends the reviewer's `note.trim()` as Remote's `reason`. Anyone "tidying" that to send `result.reason` would put `over_policy_cap` in front of an employee. Worth a comment at the call site rather than a rename. |
| `note` (the human's free text) | all approval policies, ZAF "Reason / note" | Remote's `reason` on a decline; `note` on an incentive | `[CONFIRMED]` `Incentive.note` — *"An optional note describing the reason or context for this incentive."* | **KEEP** — `note` is a real Remote word with a compatible meaning, and it is also what makes the pairing above legible. | LOW |

### 2.5 The near-misses worth naming so nobody "fixes" them

| Our term | The Remote word that looks like it fits | Why adopting it would be wrong | Verdict |
|---|---|---|---|
| `hold` / `held` (UC-02) | **`send-back`** — `POST /v1/timesheets/{timesheet_id}/send-back`, *"Sends the given timesheet back to the employee for review or modification."* `[CONFIRMED]` | Different resource and a different act. `send-back` returns the record to the employee and takes it out of the reviewer's queue; our `hold` **leaves the expense `pending` at Remote and writes nothing**, keeping it in the specialist's queue. Remote's expense API has no send-back and no held state. Renaming would imply a Remote write that does not happen. | **RENAME IS WRONG** |
| `payment_releaser` (UC-09's third role) | **`payslip.released`** `[CONFIRMED]` — the only "release" in Remote's corpus | Remote's release is publishing a payslip to an employee. Ours is the third signature on a four-eyes money control. Same word, unrelated acts. Keep ours; just be aware §6.3 exists. | **KEEP**, with the collision noted |
| `escalate` (our 🔴 outcome) | `in_review` (`ContractAmendmentStatus`, `TerminationOffboarding.status`) | `in_review` means **Remote** is reviewing the record. Our `escalate` means **the customer's** specialist team now owns the ticket, and on 🔴 it means no execution path exists at all. Mapping ours onto `in_review` would assert Remote is looking at something Remote has never been told about. | **RENAME IS WRONG** |

---

## 3. UC-01 — Employment Verification (🟢)

| Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| "employment verification letter", `letterIssued`, `letter.js` | `src/uc01/letter.js`, ZAF "Employment verification", "Letter issued" | **none** | `[CONFIRMED]` `verification letter`, `employment verification`, `proof of employment`, `employment letter`, `letter of employment` — 0 hits each. Remote's only letter resources are the **travel letter** (`/v1/travel-letter-requests`), the **resignation letter** (`GET /v1/resignations/{id}/resignation-letter`) and the **probation completion letter** (`POST /v1/probation-completion-letter`). None is an employment-verification letter. | **KEEP — ours by right.** This is the whole reason UC-01 exists: the request has no Remote resource, so it lands in support. | — |
| `identity_not_verified`, `requester_matches_employment`, `third_party_request` | `src/shared/identity.js`, `src/uc01/policyEngine.js` | Remote has `/v1/identity-verification/{employment_id}` with `verify` / `decline` | `[CONFIRMED]` — but that is **right-to-work identity verification at onboarding**, a KYC step. Ours is "is the person who opened this ticket the employee on the record?" | **RENAME IS WRONG** — same word, unrelated act. Do not rename toward `identity-verification`; if anything, ours could be narrowed to `requester_identity` to remove the ambiguity `[PROPOSED]`. | LOW |
| `employee_not_active` | `src/uc01`, `uc02`, `uc03`, `uc04`, `uc05`, `uc06` (`uc09` says `employment_not_active`) | `EmploymentStatus` | `[CONFIRMED]` *"The current status of the **employment record**."*, enum `active, created, pre_hire, created_awaiting_reserve, created_reserve_paid, initiated, invited, pending, review, job_title_review, pending_post_self_enrollment_actions, offboarding, archived, deleted`. Remote's noun for the thing that has a status is the **employment**, not the employee. | **RENAME** — `employee_not_active` → `employment_not_active`, which UC-09 already says. Fixes an internal inconsistency and Remote's noun at once. | MEDIUM — appears in persisted `flags` arrays and in `audit_log.details.reason`, so history comparison breaks. §7 Stage C. |
| `terminated` (a status our mock and tests flip employments to) | `src/remote/mockServer.js`, several tests | **not a member** of `EmploymentStatus` | `[CONFIRMED]` the enum above has `offboarding`, `archived`, `deleted` — no `terminated`. Remote uses "termination" for the **offboarding type** (`TerminationOffboarding.type: "termination"`), not for an employment status. | **RENAME IS WRONG to keep as-is / RENAME the fixture.** Flagged in §6.5. | MEDIUM |

---

## 4. UC-02 — Expense & Receipt Validation (🟢)

| Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| `release` → `approved` | see §2.2 | `approved` | `[CONFIRMED]` | **RENAME** *(in flight)* | MEDIUM |
| **"claim"** | `src/uc02/reviewPolicy.js` (throughout its prose and every `REFUSALS` message), `src/uc02/policyEngine.js` `GATE_SEQUENCE` (`gate: "Claim exists"`, `"Claim state"`, and 12 of the 20 `means` strings), ZAF, portal | **"expense"** | `[CONFIRMED]` `claim` = **0 hits** in Remote's corpus. Remote's nouns are `Expense` — *"A submitted expense record with complete data"* — and `DraftExpense` — *"A draft expense that the employee has saved but not yet submitted for approval."* | **RENAME** — "claim" is insurance vocabulary we imported. | **LOW — rendered only.** The store is already `uc02_expenses` with `expenseId`; nothing persisted or on the wire says "claim". This is the single highest ratio of user-visible improvement to risk in the whole document. |
| `category` (a flat string) | `src/uc02/expenseCategories.js`, `expenseClassifier.js`, gate 7 `category_unverified` | Remote has **two**: the flat `category` enum is `"deprecated": true, "description": "Categories allowed for an expense (legacy, deprecated)"`, superseded by `expense_category` — *"New hierarchical expense category (recommended)"* — an object `{code, slug, title}` | `[CONFIRMED]` `get_v1_expenses.md`, `Expense.category` and `Expense.expense_category` | **RENAME** — our `category` should name Remote's `expense_category.slug` (or `.code`), and the gate should say so. | MEDIUM — the classifier's output shape and the cap lookup key both change. Blocked in practice by the standing issue that the Sandbox token 403s `/v1/employee/expense-categories` (CLAUDE.md §7.1). |
| `flagged`, `held`, `auto_approved`, `blocked`, `escalated` (our store statuses) | `uc02_expenses.status` | Remote's expense statuses are the six in §2.1 | `[CONFIRMED]` | **KEEP — ours by right.** These record *what our automation decided*, alongside (not instead of) Remote's status on the expense itself. Conflating them would lose the distinction the whole store exists to hold. | — |
| `duplicate_submission`, `missing_receipt_evidence`, `over_policy_cap`, `policy_cap_*` | `src/uc02/policyEngine.js`, `policyCaps.js` | none | `[CONFIRMED]` Remote has no spend-cap concept in its API at all — no `policy`, no `cap`, no per-category limit endpoint. | **KEEP — ours by right.** The cap table is the customer's policy, not Remote's. | — |
| `receipt` | gate 8, `deriveReceiptFingerprint()` | `receipts` | `[CONFIRMED]` `Expense.receipts` array; `GET /v1/expenses/{expense_id}/receipt`, `…/receipts/{receipt_id}` | **KEEP** — already Remote's word. | — |

---

## 5. UC-03 / UC-04 — Travel Letters & Work Authorization (🟢 / 🟡)

These two share Remote's most complete request lifecycle, and it is the place
where our vocabulary diverges most consequentially.

**Remote's status enum, identical on both resources** `[CONFIRMED]`
(`get_v1_travel-letter-requests.md`, `get_v1_work-authorization-requests.md`):

```
pending | cancelled | declined_by_manager | declined_by_remote
        | approved_by_manager | approved_by_remote
```

Remote's own gloss, quoted:

> `pending`: Submitted by the employee and awaiting manager review.
> `cancelled`: Cancelled by the employee before approval.
> `declined_by_manager`: The employer manager declined the request.
> `declined_by_remote`: Remote declined the request after manager approval (e.g., compliance reasons).
> `approved_by_manager`: Approved by the employer manager, awaiting Remote's review.
> `approved_by_remote`: Fully approved by both the manager and Remote. The travel letter will be generated.

| # | Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|---|
| 5.1 | **`workation`** | 112 occurrences repo-wide (47 in `src/uc04/` + `workflows/nodes-uc04/`): `normalizeWorkationRequest.js` + `workationGates.js`, audit actions `workation_approved` / `workation_denied` / `workation_executed` / `workation_execution_blocked`, ZAF "Work authorization / workation", portal "Same-country workation", `custom_fields.workation_permission` | **none for the trip; `work authorization request` for the record** | `[CONFIRMED]` `workation` = **0 hits** in Remote's entire corpus. But `work authorization` = 170 hits, and the resource is `/v1/work-authorization-requests`. | **SPLIT.** The *trip concept* ("employee works from another country for a few weeks") has no Remote word — **KEEP**. Anything naming the **record** is a **RENAME**: the four audit actions and the store `uc04_authorizations` describe a `WorkAuthorizationRequest`, so `workation_approved` → `work_authorization_approved`. | **HIGH** for the audit action names (history comparison), LOW for labels. Keep the dual label "Work authorization / workation" — it is honest, and the customer-facing word really is "workation". |
| 5.2 | `custom_fields.workation_permission` | `src/uc04/policyEngine.js:271` — gate 4 | a **custom field** is a real Remote concept (`GET /v1/custom-fields`, `custom_field.value_updated` webhook), and its name is the customer's to choose | `[CONFIRMED]` `custom field` = 23 index hits | **KEEP** — a custom field's slug is customer vocabulary by construction. | — |
| 5.3 | "travel support letter" | `src/uc03/letter.js`, `classifier.js` (regex + prompt), `policyEngine.js` `GATE_SEQUENCE`, `workflow.js`, portal "Travel support letter", ZAF "Travel support / workation router" | **"travel letter"** / "travel letter request" | `[CONFIRMED]` `/v1/travel-letter-requests`, *"List travel letter requests"*, webhooks `travel_letter.requested` / `.approved_by_manager` / `.approved_by_remote` / `.declined_by_*`, scopes `travel_letter:read` / `travel_letter:write` | **RENAME** (soft) — "travel letter" is Remote's noun; "support" is ours. | **LOW — rendered only.** One caution: `src/uc03/classifier.js:208`'s regex already accepts `travel (support )?letter`, so the classifier needs no change; only the prose does. |
| 5.4 | **`status: "approved_by_remote"` written on our specialist's approve** | `src/remote/restClient.js:1060-1067` (`patchWorkAuthorization` doc + contract) | **`approved_by_manager`** | `[CONFIRMED]` — see the quoted gloss above, and `ApprovedWorkAuthozation`: `{"properties": {"status": {"enum": ["approved_by_manager"]}, "employer_special_instructions": {…}}, "required": ["status"], "additionalProperties": false}`. `approved_by_remote` is **Remote's own** verdict, reachable only after a manager approval. | **RENAME IS WRONG in the worst direction — we are already misusing a Remote word.** See §6.4. Our approver is the *employer's* mobility specialist. Writing `approved_by_remote` records that **Remote** approved a work authorization it has never seen. | **HIGHEST severity in this document.** |
| 5.5 | `status: "declined"` written on deny | same call site | **`declined_by_manager`** | `[CONFIRMED]` — `declined` is **not a member** of this enum; `DeclinedWorkAuthozation` requires `{"status": "declined_by_manager", "reason": …}`, `additionalProperties: false`. | **RENAME** | HIGH — a `422` on the one write UC-04 makes. |
| 5.6 | `approved_by`, `approved_at`, `decision_reason` (our patch body) | `src/remote/restClient.js:1066` JSDoc | **`reason`**, **`employer_special_instructions`**; the approver is read back as **`employer_approver`** | `[CONFIRMED]` both update schemas are `additionalProperties: false` and accept only `status` + `reason` (+ instructions). | **RENAME** | HIGH — same 422. |
| 5.7 | `createWorkAuthorization()` → `POST /v1/work-authorization-requests` | `src/remote/restClient.js:1033`, called by `src/uc04/workflow.js` | **no such endpoint** | `[INFERRED]` Remote's reference index lists exactly four operations on this resource — `get_v1_work-authorization-requests`, `get_v1_work-authorization-requests_id`, `patch_…_id`, `patch_…_id-2` (the latter is a `PUT` in its own OpenAPI). There is no `post_v1_work-authorization-requests` page. Same for travel letters. **Not probed** — a probe would be a write, and this audit is read-only. `GET /v1/work-authorization-requests` returns `200 {"total_count":0}` live `[CONFIRMED-LIVE]`, so the collection exists and is simply empty. | **Not a vocabulary verdict — a correctness flag.** Remote's model appears to be that the **employee** creates the request in Remote's product and the employer only approves/declines it, which is the same shape as UC-06's missing amendment-request API (issue #17). | **HIGH.** Named here rather than fixed because it is a design question, not a rename. |
| 5.8 | `sanctioned_region`, `destination_out_of_scope`, `risk_matrix_blocked`, `schengen_90_180_exceeded`, `us_requires_work_permit`, PE risk | `src/uc03/policyEngine.js`, `src/uc04/riskMatrix.js` | none | `[CONFIRMED]` no counterpart. Remote types `destination_country` as `$ref → Country`, described as *"A supported country on Remote"* — membership, nothing about sanctions or permanent-establishment risk. | **KEEP — ours by right.** | — |
| 5.9 | `destination_jurisdiction_excluded` / "supported destination" gate | `src/uc03/policyEngine.js` | `Country` with `alpha_2_code` / `code` / `eor_onboarding` | `[CONFIRMED]` `Country.alpha_2_code: "PT"`, `Country.code: "PRT"` — alpha-2 and alpha-3 respectively | **KEEP** — the predicate and its field reading were settled 2026-08-18 (CLAUDE.md §7.2) and are correct. Listed so nobody re-opens it. | — |
| 5.10 | `cancelled` (our word, where we have one) vs `canceled` | mixed across the repo | **Remote spells it both ways, per resource** | `[CONFIRMED]` `cancelled` on `TimeoffStatus`, `TravelLetterRequest.status`, `WorkAuthorizationRequest.status`. `canceled` on `Expense.status`, `ContractAmendmentStatus`, `TerminationOffboarding.status`. | **RENAME IS WRONG to normalise.** Whichever spelling we use must match **the resource being written**, not a house style. A repo-wide `sed` here would break two enums to fix two others. | MEDIUM — a real trap for a later pass. |

---

## 6. Words we have ALREADY taken from Remote and used to mean something else

**This is the inverse defect and it is worse than a mismatch, because it reads as
verified.** Seven of them.

| # | The word | Where we use it | What Remote means by it | Evidence | Severity |
|---|---|---|---|---|---|
| 6.1 | **`rejected`** | `review_queue.status` for a human denial (`src/review/reviewPolicy.js:59`) | *"`rejected`: Rejected during approval and needs revision."* — a **payroll run** sent back by the company for revision. It is **not terminal**; ours is. | `[CONFIRMED]` `MinimalPayrollRun.status` | MEDIUM |
| 6.2 | **`process_date`, `pay_date`** | `src/uc06/cutoffEngine.js:131` JSDoc, describing the shape `listPayrollRuns()` returns | **Neither field exists.** A payroll run carries `approval_date`, `cutoff_date`, `expected_payout_date`, `period_start`, `period_end`. | `[CONFIRMED]` `MinimalPayrollRun` properties, exhaustively | LOW (doc only) — and instructive: `src/remote/restClient.js:673` and `src/remote/mockServer.js:923-926` **already record that these were invented and were removed from the fixture.** The JSDoc that first taught them is the last copy still standing. This is exactly the fixture-agrees-with-the-code failure mode CLAUDE.md §4 describes, caught one layer late. |
| 6.3 | **`release` / `released`** | UC-02's positive review verb; UC-09's `payment_releaser` role | Remote's only "release" is **`payslip.released`** — publishing a payslip to an employee. | `[CONFIRMED]` webhook `payslip.released`; `release`/`released` occur nowhere else in the corpus | MEDIUM — strengthens the rename already in flight: `release` is not merely *not* Remote's word for approving an expense, it is Remote's word for something else. |
| 6.4 | **`approved_by_remote`** | the status UC-04 writes on a specialist approve (`restClient.js:1060`) | *"Fully approved by both the manager and Remote."* Remote's own compliance verdict. | `[CONFIRMED]` | **HIGHEST.** We record Remote's approval of something Remote has never evaluated, on the one write UC-04 makes. |
| 6.5 | **`terminated`** (as an employment status) | `src/remote/mockServer.js` fixture mutation, several tests | Not a member of `EmploymentStatus` (`offboarding`, `archived`, `deleted` are). Remote's `termination` is an **offboarding type**. | `[CONFIRMED]` `EmploymentStatus` enum; `TerminationOffboarding.type: {"enum": ["termination"]}` | MEDIUM — a fixture teaching a status the API does not have. Same class as the `{data:{countries:[…]}}` envelope in CLAUDE.md §7.4. |
| 6.6 | **`paid`, `cancelled`** described as expense statuses | comments at `src/uc02/policyEngine.js:23,118` and `workflows/nodes-uc02/expenseGates.js:471` | The expense enum has **`reimbursed`**, not `paid`, and **`canceled`** (one `l`), not `cancelled`. | `[CONFIRMED]` `Expense.status` | LOW (comments only — the code correctly whitelists `pending`), but it is the documentation a future widening of `APPROVABLE_EXPENSE_STATUSES` would be argued from. |
| 6.7 | **`/v1/recurring-incentives`** | `src/remote/restClient.js:1092` `createIncentive()` — the one endpoint UC-09 POSTs money to | **404. The path does not exist.** Remote's are `POST /v1/incentives` (one-time) and `POST /v1/incentives/recurring` (recurring). | `[CONFIRMED-LIVE]` this session: `GET /v1/recurring-incentives` → **404 `"Not Found"`**; `GET /v1/incentives/recurring` → **200**; `GET /v1/incentives` → **200, 53 records**. | **HIGHEST.** See §9. |

---

## 7. UC-05 — Resignation Notice (🟡)

| Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| `signoff` / `signed_off` / `pending_signoff` / `prepared_for_signoff`, route `POST /api/resignations/:id/signoff`, audit `resignation_signed_off` | `src/uc05/signoffPolicy.js`, `resignationStore.js`, `server.js`, ZAF "Sign off" / "HR Ops sign-off" / "Awaiting sign-off" | **`validate`** | `[CONFIRMED]` `PUT /v1/resignations/{offboarding_request_id}/validate` — *"Validate resignation request. Validates a resignation employment request"*, scope `resignation:write`. Its body is `ValidateResignationRequestParams` with `accepts_proposed_notice`, `agrees_to_pto_amount`, `agrees_to_resignation_reason`, `proposed_last_date`, `is_owed_outstanding_reimbursements` — which is **exactly** what UC-05's HR Ops sign-off decides. `sign-off` = 0 hits. | **RENAME — but contested, and I recommend NOT taking the verb.** `validate` already means JSON-Schema validation everywhere in this repo (`src/shared/schemaValidator.js`, `validateAgainstSchema()`, `schema_invalid`). Adopting it for a human approval would create a §6-class collision *inside our own codebase* to fix one with Remote's. **Recommendation: keep `signoff` as the verb, adopt Remote's field names below, and record the mapping.** `[PROPOSED]` | MEDIUM |
| `missing_seniority_date`, gate `seniority_date` | `src/uc05/policyEngine.js:108,290`; the field actually read is `employment.start_date` | **`start_date` / `contract_start_date`** | `[CONFIRMED]` `seniority` = **0 hits** in Remote's corpus. `ResignationAfterStartDate.contract_start_date` — *"The original start date from the employee's contract."* `Employment.basic_information.start_date`. | **RENAME** — the gate names a concept Remote does not have, for a field Remote does. | MEDIUM — `missing_seniority_date` is a persisted flag and an `audit_log` reason. §7 Stage C. |
| notice days (`notice.days`, `statutory notice end`) | `src/uc05/noticePeriodCalculator.js`, ZAF "Statutory notice end" | **`days_of_notice`** | `[CONFIRMED]` `ResignationAfterStartDate.days_of_notice` — *"The number of calendar days of notice required based on the contract terms and local labor laws."* | **RENAME** (soft) — align the field name. | LOW — internal shape. |
| `proposedEndDate`, "last working day" | `src/uc05/policyEngine.js`, `noticePeriodCalculator.js` | **`proposed_last_day`** (read) / **`proposed_last_date`** (write) | `[CONFIRMED]` *"The employee's proposed last working day, calculated based on the notice period and local labor laws."* Note Remote itself uses **day** on read and **date** on write — do not normalise. | **RENAME** (soft) | LOW |
| `pto`, `ptoPayout`, `pto_balance_unusable` | `src/uc05/ptoPayout.js` | **PTO** | `[CONFIRMED]` Remote uses "PTO" in its own prose: `agrees_to_pto_amount`, `paid_timeoffs_breakdown_labels`, *"Whether the employer agrees with the employee's current PTO balance."* | **KEEP** — already Remote's word. | — |
| `statutory_discrepancy` | `src/uc05/policyEngine.js:205` | Remote's nearest is `agrees_to_pto_amount: false` + `agrees_to_pto_amount_notes` | `[CONFIRMED]` | **KEEP — ours by right.** Our discrepancy is between *our* statutory table and *the record*; Remote's is between *the employer* and *the employee*. Different disagreements. | — |
| `unsupported_country`, `no_matching_notice_bracket`, the 9-country statutory table | `src/uc05/noticePeriodTable.js` | none | `[CONFIRMED]` Remote computes `days_of_notice` itself and exposes no table. | **KEEP — ours by right**, and worth saying loudly: Remote *already computes this*, so our table is a stand-in, not a rival. | — |
| "No real write endpoint exists (spec-confirmed)" | `src/uc05/resignationStore.js:19-21` header; CLAUDE.md §4's UC-05 row | **One does.** | `[CONFIRMED]` `PUT /v1/resignations/{offboarding_request_id}/validate`, scope `resignation:write`; the resource is a `ResignationOffboarding` under `/v1/offboardings` with `type: "resignation"`. | **Not a rename — a standing claim that is false.** Named here because the vocabulary follows the endpoint: if UC-05 ever writes, the words are `validate`, `accepts_proposed_notice`, `agrees_to_pto_amount`, `offboarding_request_id`. | **HIGH** — it inverts UC-05's architecture claim. Out of scope to fix here. |

---

## 8. UC-06 — Contract Amendment / Payroll Cutoff (🟡)

| Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|
| `oldAmount` / `newAmount`, `oldValue` / `newValue` | `src/uc06/changeParser.js`, `policyEngine.js`, the amendment store's `changes` jsonb, ZAF panel | **`previous` / `current`** | `[CONFIRMED]` `ContractAmendment.changes` example: `{"compensation.amount": {"current": 500000, "previous": 400000}, "contract.job_title": {"current": "A new job title", "previous": "An old job title"}}` | **RENAME** | **MEDIUM — persisted.** `changes` is a jsonb column in `uc06_amendments`; renaming needs a read-both/write-new step. |
| `changes.salary` / `.jobTitle` / `.weeklyHours` | `src/uc06/changeParser.js:66-73` | **`compensation.amount`**, **`contract.job_title`**, and dotted paths generally | `[CONFIRMED]` same example, plus `"contract_details.details.contract_duration_type"` | **RENAME** (soft) — adopting Remote's dotted key form would make our `changes` blob directly comparable to what `GET /v1/contract-amendments/{id}` reads back. | MEDIUM — same persisted blob. |
| `amendmentType`: `SALARY_INCREASE` / `SALARY_DECREASE` / `JOB_TITLE_CHANGE` / `WORKING_HOURS_CHANGE` / `COMPOSITE` / `OTHER` | `src/uc06/changeParser.js` | Remote has **`reason_for_change`**: `annual_pay_adjustment, country_rule_change, error_correction, job_change_reevaluation, promotion, other`; and for decreases, **`salary_decrease_reason`**: `change_in_working_hours, trade_salary_for_equity, error_in_initial_salary, role_change_or_demotion, compensation_restructure, other`, plus `was_employee_informed` | `[CONFIRMED]` `RequestDetails`, `SalaryDecreaseDetails` in `post_v1_contract-amendments.md` | **RENAME IS WRONG — these are different axes, and we are missing one.** Our `amendmentType` is *what changed* (derivable, deterministic — correctly so). Remote's `reason_for_change` is *why*, which is not derivable and which we **do not collect at all**. Keep `amendmentType`; the gap is that a real amendment needs `reason_for_change` too, and a salary decrease needs `salary_decrease_reason` + `was_employee_informed`. | **HIGH as a gap, not as a rename.** A `SALARY_DECREASE` submitted without `was_employee_informed` is a compliance omission. |
| store statuses `pending_dual_approval`, `dual_approval_required`, `approved`, `denied`, `executing`, `executed` | `src/uc06/amendmentStore.js` | **`ContractAmendmentStatus`**: `submitted, in_review, done, canceled, deleted` | `[CONFIRMED]` *"`submitted`: The amendment has been submitted and is awaiting Remote's review. `in_review`: Remote is reviewing the amendment for compliance and feasibility. `done`: The amendment has been approved and applied to the contract."* | **RENAME IS WRONG.** Remote's enum tracks **Remote's** review of an amendment already submitted to it. Ours tracks **the customer's** dual approval *before* submission. Mapping our `approved` onto `done` would claim the contract has been amended. **Both must coexist**, and the sidebar should eventually show both. | — |
| `cutoff`, `cutoff_lock_passed`, `hoursUntilCutoff` | `src/uc06/cutoffEngine.js` | **`cutoff_date`** | `[CONFIRMED]` `MinimalPayrollRun.cutoff_date`. Also `Cycle.input_cutoff_date` and `Cycle.employee_inclusion_cutoff_date` on the *calendar* resource. | **KEEP** — already Remote's word, and the field read is exactly `cutoff_date`. | — |
| `payrollCycles`, `cyclesCovering()`, `noMatchingCycle`, "the cycle" | `src/uc06/cutoffEngine.js`, `policyEngine.js` (`ambiguous_payroll_cycle`, `no_matching_payroll_cycle`) — reading rows from `GET /v1/payroll-runs` | Remote has **both** nouns, and they are different schemas | `[CONFIRMED]` `MinimalPayrollRun` = `{id, status, period_start, period_end, approval_date, cutoff_date, expected_payout_date, currency_code, country, total_payroll_cost, type}`. `Cycle` (under `/v1/payroll-calendars`) = `{start_date, end_date, input_cutoff_date, employee_inclusion_cutoff_date, payment_date}` — **no overlapping field name except none**. Remote *does* use "payroll cycle" in prose: *"the incentive is not paid out on the effective date, but during the next payroll cycle."* | **RENAME** (soft, precise). The informal noun "payroll cycle" is Remote's and is fine in prose. Naming a **`payroll_runs` row** a `cycle` object is not: it imports a Remote schema name whose fields are all different. `payrollCycles` → `payrollRuns`. | LOW–MEDIUM — internal names + two reason strings (`ambiguous_payroll_cycle`, `no_matching_payroll_cycle`) that are persisted. |
| `type: "main"` vs `"one_off"` handling | `src/uc06/cutoffEngine.js:69-83` (the NL ambiguity note) | `PayrollRun.type`: `main, one_off, pro_forma, tax_documents, expenses, parallel` | `[CONFIRMED]` *"`main`: Regular recurring payroll. `one_off`: Ad-hoc off-cycle payment. `pro_forma`: Simulated run for cost estimation. `tax_documents`: … `expenses`: Dedicated expense reimbursement run. `parallel`: Supplementary run alongside the main payroll."* | **KEEP** — already Remote's words, correctly used. The `ambiguous_payroll_cycle` refusal is well-founded: a `pro_forma` run is a *simulation* and should arguably be filtered out entirely `[PROPOSED]`. | — |
| `externalRef` (the Zendesk ticket) on an amendment | `src/uc06/amendmentStore.js` | **`zendesk_ticket_url`** | `[CONFIRMED]` `ContractAmendment.zendesk_ticket_url` — *"A link to the support ticket associated with this amendment, if one was created. Null otherwise."* | **KEEP `externalRef` internally** (it is the idempotency key and must stay a bare id), **but this is a real alignment opportunity**: Remote already models the amendment↔ticket link, which is precisely the join CLAUDE.md §8 item 2 says is missing between a portal submission and the sidebar. `[PROPOSED]` | LOW |
| `customer_admin` (UC-06 approval role) | `src/uc06/dualApprovalPolicy.js:35`; `src/remoteui/roles.js` says `company_admin` | **`company_admin`** | `[CONFIRMED]` `company_admin` = 174 doc hits / 46 index hits; it is the name of Remote's own scope category — *"Manage company resources (`company_admin`)"*. `customer_admin` = 0 hits. | **RENAME** — and it also fixes an internal inconsistency: `src/remoteui/roles.js` already says `company_admin`, `src/uc06/dualApprovalPolicy.js` says `customer_admin`, for the same person. | **HIGH** — persisted in `uc06_amendments` approval-slot columns and posted in the ZAF request body (`{role: "customer_admin"}`). §7 Stage C. |
| `payroll_specialist` (UC-06's second role) | `src/uc06/dualApprovalPolicy.js:35` | none | `[CONFIRMED]` 0 hits. | **KEEP — ours by right.** | — |

---

## 9. UC-09 — Off-Cycle Payroll / Adjustment (🔴-framed, with execution)

This is the money path, and it has the densest cluster of vocabulary defects in
the repo. Every row here was verified against Remote's `POST /v1/incentives`
schema, and the first was verified live.

| # | Our term | Where | Remote's term | Evidence | Verdict | Risk |
|---|---|---|---|---|---|---|
| 9.1 | **`/v1/recurring-incentives`** | `src/remote/restClient.js:1092-1099` — the URL and the error label | **`/v1/incentives`** (one-time) or **`/v1/incentives/recurring`** | `[CONFIRMED-LIVE]` `GET /v1/recurring-incentives` → **404 `"Not Found"`**; `GET /v1/incentives/recurring` → **200**; `GET /v1/incentives` → **200**, 53 real records. | **RENAME — and it is not only a name.** | **HIGHEST.** |
| 9.2 | `createIncentive()` posting the **recurring** resource for a **one-time** off-cycle adjustment | same | `POST /v1/incentives` — *"One-Time Bonus and Recurring Incentives"*; the recurring one is *"Create a Recurring Incentive, **that is, a monthly paid incentive**."* | `[CONFIRMED]` index line 400 | **RENAME IS WRONG to keep the recurring resource.** An off-cycle *adjustment* is by definition not monthly. Even with 9.1 fixed, pointing at `/recurring` would create a standing monthly payment from a single approved adjustment. | **HIGHEST** — this is the four-eyes money path. |
| 9.3 | `currency` in the payload | `src/uc09/workflow.js:630`; `INCENTIVE_REQUIRED_FIELDS` at `policyEngine.js:38` lists it as **required** | **not a field** | `[CONFIRMED]` `CommonIncentiveParams` properties are exactly `amount`, `amount_tax_type`, `effective_date`, `note`; `CreateOneTimeIncentiveParams` adds `employment_id`, `type`, `period_start`, `period_end`. Remote: *"Incentives use the currency of the employment specified provided in the `employment_id` field"* and *"The amount (in the currency of the employment)"*. | **RENAME IS WRONG — remove, do not rename.** We are requiring a field Remote does not accept, and worse, we are *validating* against it, so the gate passes on a currency Remote will ignore. | HIGH |
| 9.4 | `description` | `src/uc09/workflow.js:630` | **`note`** | `[CONFIRMED]` `CommonIncentiveParams.note`; `Incentive.note` — *"An optional note describing the reason or context for this incentive."* | **RENAME** | MEDIUM |
| 9.5 | `processing_date` | `src/uc09/workflow.js:632` | **not a field.** Nearest are `expected_payout_date` (read-only) and `period_start` / `period_end` | `[CONFIRMED]` `Incentive` properties, exhaustively | **RENAME IS WRONG — remove.** | MEDIUM |
| 9.6 | `tax_calculation_method: "automatic"` | `src/uc09/workflow.js:633` | **`amount_tax_type`**, enum **`gross` \| `net`**, and it is **required** | `[CONFIRMED]` *"`gross` indicates that the amount given is the amount to be paid before taxes are subtracted. `net` indicates that the amount which will be paid to the employee after taxes. **Remote will gross this up** to ensure the taxes are included and employee receives the amount requested without further reduction."* | **RENAME**, and it is a **money-correctness** issue, not cosmetic: `gross` and `net` produce different amounts leaving the company's account for the same integer. `"automatic"` is not a member of anything. | **HIGHEST after 9.1/9.2.** |
| 9.7 | `type: "bonus"` default | `src/uc09/workflow.js:629` | `type` enum on `CreateOneTimeIncentiveParams`: `acting_up_allowance, allowance, car_allowance, health_and_wellness_allowance, internet_allowance, meal_allowance, on_call_allowance, parenthood_allowance, phone_allowance, relocation_allowance, travel_allowance, work_from_home_allowance, bonus, holiday_bonus, referral_bonus, retention_bonus, commission, other, overtime, stipend, signing_bonus` | `[CONFIRMED]`; live Sandbox shows `bonus, commission, holiday_bonus, overtime, referral_bonus, signing_bonus` in use `[CONFIRMED-LIVE]` | **KEEP** — `bonus` is a valid member. But defaulting is worth questioning: `other` is also a member and is the honest default for an adjustment nobody typed a category for `[PROPOSED]`. | LOW |
| 9.8 | "off-cycle payroll adjustment" (the use case's own name), `adjustment`, `uc09_adjustments` | everywhere in UC-09, portal "Off-cycle payroll adjustment" | Remote's word for the *payment instrument* is **incentive**; for the *run* it lands in, `type: "one_off"` — *"Ad-hoc off-cycle payment"* | `[CONFIRMED]` `MinimalPayrollRun.type` gloss; `adjustment` = 8 corpus hits, none of them a payroll concept | **SPLIT.** "off-cycle" is aligned with Remote's own `one_off` gloss — **KEEP**. "adjustment" as the name of the *record we create at Remote* is a **RENAME** to `incentive`; the store row can stay `adjustment` (it holds our approval state, which Remote has no concept of). | MEDIUM — audit action names `adjustment_approved` / `adjustment_denied` / `adjustment_executed`. |
| 9.9 | `executed` (our terminal status) | `uc09_adjustments.status`, audit `adjustment_executed` | An incentive's lifecycle is `pending` → `processing` → `paid` | `[CONFIRMED-LIVE]` live Sandbox distinct statuses: **`paid`, `pending`, `processing`**. `[CONFIRMED]` webhooks `incentive.created`, `incentive.processing_started`, `incentive.paid`, `incentive.updated`, `incentive.deleted`. **There is no `approved` state for an incentive** — creating one *is* the approval. | **KEEP — ours by right**, with a caution to write down: our `executed` means *"we successfully created the incentive"*, i.e. Remote's `pending`. It does **not** mean paid. A dashboard reading `executed` as "money moved" would be wrong by up to a payroll cycle. | MEDIUM — a reporting hazard, not a rename. |
| 9.10 | `requester` / `approver` / `payment_releaser` (the floor-of-2 roles) | `src/uc09/multiApprovalPolicy.js:15` | `requested_by` exists on Remote records; the other two have no counterpart | `[CONFIRMED]` `ContractAmendment.requested_by`, `ResignationOffboarding.requested_by`; `requester` = 0 hits, `payment releaser` = 0 hits | **KEEP — ours by right.** Four-eyes control is the CX layer's, not Remote's. | — |
| 9.11 | `high_risk_adjustment_needs_triple_approval`, `standard_adjustment_needs_dual_approval` | `src/uc09/policyEngine.js` | none | `[CONFIRMED]` | **KEEP — ours by right.** | — |

---

## 10. UC-07 / UC-08 — the two 🔴 no-execution-path use cases

Almost everything here is ours by right, which is expected: these compile
*dossiers about* Remote records and write nothing.

| Our term | Where | Remote's term | Evidence | Verdict |
|---|---|---|---|---|
| `dossier`, `dossierStore`, `dossierBuilder` | `src/uc07/`, `src/uc08/` | none | `[CONFIRMED]` `dossier` = 0 hits | **KEEP — ours by right** |
| `presence days`, `presenceCalculator`, 183-day counting | `src/uc08/presenceCalculator.js` | none | `[CONFIRMED]` `presence` = 0 hits | **KEEP — ours by right** |
| `treaty`, `treatyRetriever`, citations, `matchedOn` | `src/uc08/treatyRetriever.js` | none | `[CONFIRMED]` `treaty` = 0 hits | **KEEP — ours by right** |
| `disclaimer` | `src/shared/disclaimer.js` | none | `[CONFIRMED]` | **KEEP — ours by right** |
| `transitionGate`, `PE_REVIEW`, `TAX_REVIEW`, `IMMIGRATION_ASSESSMENT`, `PRESERVED`/`RESET`, `safe_to_offboard` | `src/uc07/transitionGate.js` | none | `[CONFIRMED]` | **KEEP — ours by right** |
| **"EOR management fee"** | `src/uc07/costCalculator.js` | **Remote's own term** | `[CONFIRMED]` `PUT /v2/employments/{id}/pricing-plan-details` — *"The frequency determines how often Remote bills the employer for **management fees**."* | **KEEP — already aligned.** Listed so a later pass does not "improve" it. |
| **"minimum onboarding time"**, `MOT_VIOLATION` | `src/uc07/transitionGate.js:90,426` | **Remote's own term** | `[CONFIRMED]` `POST /v1/employments/{id}/invite` — *"`provisional_start_date` must consider the **minimum onboarding time** of the employment's country."* | **KEEP — already aligned.** And a bonus: Remote's word for the date UC-07 proposes is **`provisional_start_date`** `[CONFIRMED]`, which is a better name than `destinationStartDate` `[PROPOSED]`. |
| `source offboarding`, `offboarding` | `src/uc07/transitionGate.js` | **Remote's own term** | `[CONFIRMED]` `/v1/offboardings`, `ResignationOrTerminationOffboarding`, webhooks `offboarding.submitted` / `.review_started` / `.submitted_to_payroll` / `.done` / `.completed` / `.deleted` | **KEEP — already aligned.** |
| `originalHireDate`, `seniorityDate` | `src/uc07/transitionGate.js:312-347` | `hire date` = **0 hits**; Remote says `start_date` / `contract_start_date` | `[CONFIRMED]` | **RENAME** (soft) — `originalHireDate` → `originalStartDate`. Low risk: internal, not persisted, not on the wire. |
| `managementFeeBasisPoints` | `src/uc07/costCalculator.js` | `basis point` = 0 hits | `[CONFIRMED]` | **KEEP — ours by right.** Remote does not publish the rate at all; the module correctly refuses to invent one. |

---

## 11. Blast radius, per RENAME

The rule for the table below: a **rendered-only** term appears solely in prose a
human reads, so a rename is a one-commit change with no compatibility step. A
**persisted** term is a value in a Supabase column or a jsonb blob, so existing
rows keep the old value and every read must accept both for one release. **On
the wire** means an HTTP path or request field posted by a client we do not
redeploy atomically — chiefly `zaf-app/`, which is **installed and enabled in
the live Zendesk account** ("Remote CX Review v1.01", app id `9990001`,
CLAUDE.md §8) — or a Code-node body inside one of the nine **active** n8n graphs.
An **audit action name** is the worst of the three: renaming one silently breaks
the metrics layer's ability to compare against history, and nothing errors.

| Rename | Rendered | Persisted | On the wire | Audit action | Needs |
|---|---|---|---|---|---|
| "claim" → "expense" (§4) | ✅ all of it | — | — | — | one commit |
| "travel support letter" → "travel letter" (§5.3) | ✅ all of it | — | — | — | one commit |
| `originalHireDate` → `originalStartDate` (§10) | ✅ | — | — | — | one commit |
| `payrollCycles` → `payrollRuns` (§8) | ✅ mostly | ⚠️ `ambiguous_payroll_cycle`, `no_matching_payroll_cycle` are stored reasons | — | — | dual-read on two reason strings |
| `release` → `approve` (§2.2, in flight) | ✅ | ⚠️ `uc02_expenses.status` may hold `released` | ⚠️ `POST /api/expenses/:id/release` from ZAF | — | dual-read + route alias |
| `deny` → `decline` (§2.1) | ✅ | ⚠️ 4 store `status` columns hold `denied` | ⚠️ `POST /api/…/:id/deny` from ZAF | ⚠️ 5 action names | **full Stage C** |
| `rejected` → `declined` (§2.1) | — | ⚠️ `review_queue.status` | — | — | dual-read; metrics query updated |
| `employee_not_active` → `employment_not_active` (§3) | ✅ | ⚠️ persisted in `flags[]` and `reason` | — | — | dual-read across 6 use cases |
| `missing_seniority_date` → `missing_start_date` (§7) | ✅ | ⚠️ persisted flag + reason | — | — | dual-read |
| `customer_admin` → `company_admin` (§8) | ✅ | ⚠️ approval-slot columns | ⚠️ `{role:"customer_admin"}` posted by ZAF | — | **full Stage C** |
| `oldAmount`/`newAmount` → `previous`/`current` (§8) | ✅ | ⚠️ `uc06_amendments.changes` jsonb | — | — | dual-read on the blob |
| `workation_*` audit actions → `work_authorization_*` (§5.1) | — | — | — | ⚠️ 4 names | metrics dual-count |
| `adjustment_*` audit actions → keep (§9.8) | — | — | — | — | no change recommended |
| UC-04 wire fields: `approved_by_remote` → `approved_by_manager`, `declined` → `declined_by_manager`, drop `approved_by`/`approved_at`/`decision_reason` (§5.4–5.6) | — | — | ✅ **the Remote write itself**, plus `workflows/nodes-uc04/` if that graph ever writes | — | code + a live re-drive |
| UC-09 payload: path, `currency`, `description`→`note`, `processing_date`, `tax_calculation_method`→`amount_tax_type` (§9.1–9.6) | — | ⚠️ `INCENTIVE_REQUIRED_FIELDS` is used by a gate | ✅ **the Remote write itself** | — | code + a live re-drive + a **new positive test** |

---

## 12. Execution plan — ordered, with what each stage may and may not touch

Three other agents are mid-flight across `src/uc02/**`, `zaf-app/**`,
`src/auditview/**`, `src/portal/**` and `src/remoteui/**`. **Nothing in this plan
should start until those land**, and Stage A is deliberately chosen to be the
part that conflicts with none of them.

### Stage A — rendered-only, safe to do together, one commit
Zero compatibility risk; nothing persisted, nothing on the wire, no audit name.

1. §4 "claim" → "expense" throughout `src/uc02/` prose, `GATE_SEQUENCE`'s
   `gate`/`checks`/`means` strings, ZAF and portal labels.
   *(Coordinate with the in-flight `release`→`approve` branch — same files.)*
2. §5.3 "travel support letter" → "travel letter" in `src/uc03/` prose and
   labels. Leave `classifier.js`'s regex alone: it already matches both.
3. §10 `originalHireDate` → `originalStartDate` in `src/uc07/transitionGate.js`.
4. §6.2 delete the invented `process_date, pay_date` from
   `src/uc06/cutoffEngine.js:131`'s JSDoc; replace with `approval_date,
   expected_payout_date`.
5. §6.6 correct the two comments naming `paid`/`cancelled` as expense statuses
   to `reimbursed`/`canceled`.
6. §2.4 add a comment at `src/uc02/workflow.js:591` stating that Remote's
   `reason` takes the reviewer's **note**, never our gate `reason`.

### Stage B — the two Remote writes that are wrong today
These are correctness fixes that happen to be renames. **Each needs a real
unpinned execution and a POSITIVE test** — "this input MUST succeed" — because a
write that 422s and a gate that correctly refuses are indistinguishable from
outside, which is the failure mode CLAUDE.md §4 keeps paying for.

7. **UC-09's incentive payload** (§9.1–9.6): repoint `/v1/recurring-incentives`
   → `/v1/incentives`; drop `currency` and `processing_date`; `description` →
   `note`; `tax_calculation_method` → `amount_tax_type` with an explicit
   `gross`/`net` that the requester must supply (**not** a default — a defaulted
   tax type is the same class of manufactured value as the manufactured zero
   `prepareIncentivePayload()` already guards against); update
   `INCENTIVE_REQUIRED_FIELDS` to Remote's actual required set
   `["type","amount","amount_tax_type","employment_id","effective_date"]`.
8. **UC-04's work-authorization patch** (§5.4–5.6): `approved_by_remote` →
   `approved_by_manager`; `declined` → `declined_by_manager` with a required
   `reason`; drop `approved_by`/`approved_at`/`decision_reason`
   (`additionalProperties: false`). Separately raise §5.7 — whether
   `POST /v1/work-authorization-requests` exists at all — as a design question,
   not a patch.

### Stage C — persisted and on-the-wire renames, one at a time, each with a compatibility step
The pattern for every one: **read both, write new, migrate, then drop the old
read.** Never a bare `UPDATE`, because `audit_log` is append-only and the
metrics layer compares across it.

9. `deny` → `decline` (§2.1). Largest. Order within it: (a) accept both
   `/deny` and `/decline` route paths server-side; (b) write `declined`, read
   both, in the four stores; (c) emit both audit action names for one release,
   or add a `vocabulary_version` to `audit_log.details`; (d) redeploy `zaf-app`
   to Zendesk posting `/decline`; (e) migrate rows; (f) drop the old reads.
10. `customer_admin` → `company_admin` (§8). Same pattern; smaller. Do this one
    **first** as the rehearsal for step 9 — it is the same shape at a tenth the
    size, and it also removes an existing internal contradiction with
    `src/remoteui/roles.js`.
11. `rejected` → `declined` in `review_queue` (§2.1/§6.1), with the metrics
    query updated in the same commit — the HITL accept rate reads this string.
12. `employee_not_active` → `employment_not_active` (§3) and
    `missing_seniority_date` → `missing_start_date` (§7): both are persisted
    flags and reasons across six use cases. Dual-read; no wire change.
13. `oldAmount`/`newAmount` → `previous`/`current` in `uc06_amendments.changes`
    (§8): dual-read on the jsonb blob.

### Stage D — needs an n8n redeploy
No rename in this document lands inside a deployed Code-node body **except**
through the UC-04 write (Stage B step 8) and any of the nine graphs' audit
action strings if Stage C step 9 changes them. When that happens, CLAUDE.md
§7b's standing authorisation applies and its four rules are what make it safe:
`activeVersionId === versionId` is the only answer to "is this live"; a pinned
node reports success having done nothing; diff the deployed body byte-for-byte;
prove with a real unpinned execution **in both directions**.

`npm run verify-deployed` and `npm run verify-claims` should both be green
before and after each Stage D step.

---

## 13. What I could not confirm — and what a second pass closed

**Status of this section: rewritten 2026-08-19.** The eight items below were
recorded honestly as unknowns by the vocabulary audit. A follow-up pass went
back to Remote's own pages and to the live Sandbox with **reads only** and
closed **seven of the eight**; the eighth is open with a named next step. Two
of the closures contradict `[CONFIRMED]`-tagged claims that are in this
repository today — those are listed with file and line in §13.10, **not
edited**, because the files belong to other work in flight.

Every item now ends in one of two states, per the brief that produced this
pass: **CLOSED**, with the page, enum member or live response quoted; or
**OPEN**, with the *specific request* that would close it. "Unknown" with no
next step does not appear.

### 13.0 Two techniques this pass added — both read-only, both reusable

**(a) The Sandbox tells you whether a path is routed, in the shape of its 404.**
Two different 404 bodies, perfectly separated across seven live probes:

| Body | Meaning | Observed on |
|---|---|---|
| `"Not Found"` (a bare JSON **string**) | **no route** for this method+path | `GET /v1/no-such-endpoint-xyz`, `GET /v1/resignations`, `OPTIONS /v1/countries`, `OPTIONS /v1/work-authorization-requests`, `OPTIONS /v1/travel-letter-requests` |
| `{"message":"Not Found"}` (an **object**) | route exists, **record** missing | `GET /v1/resignations/{uuid}`, `GET /v1/work-authorization-requests/{uuid}`, `GET /v1/travel-letter-requests/{uuid}` |

`[CONFIRMED-LIVE]`. This is what let §13.8 be settled without a write. Note the
control that makes it trustworthy: `OPTIONS /v1/countries` — a path that
certainly exists — returns the **bare-string** form, so this API answers a
**method** mismatch with 404, never 405. That is why the brief's "405 proves the
path exists" test could not be run here, and why a bare-string 404 on a `POST`
would be ambiguous between "no POST route" and "no route at all" only if you
had not first established that the `GET` on the same collection returns 200.
Since it does (§13.1), a bare-string 404 on that path from a POST would mean
exactly one thing: **no POST route.**

**(b) A list endpoint's `status` filter can enumerate a closed enum, read-only.**
`GET /v1/incentives?status=<x>` validates against a closed set and answers an
unknown member with

```
422 {"message":{"code":"parameter_value_invalid",
                "message":"Value `scheduled` is invalid for parameter `status`",
                "param":"status"}}
```

so candidate values can be probed one at a time without writing anything. That
is how §13.2 was closed. **The technique is not universal and you must check it
before trusting it:** `GET /v1/expenses?status=<x>` accepts *every* value —
`pending`, `reimbursed`, `deleted`, `banana` — and returns the full unfiltered
220 rows each time, because `/v1/expenses` documents no `status` parameter and
the API silently drops unknown query params. **A filter that silently does not
filter is worse than one that errors**; confirm the parameter is in the
endpoint's own `parameters` list before reading anything into a 200.

---

### 13.1 `POST /v1/work-authorization-requests` — **CLOSED: it does not exist, and UC-04 writes into nothing**

This was the priority question, and it is the second live defect of the same
class as UC-09's incentive write (§14.1).

**Documentary evidence** `[CONFIRMED]`. Remote's live `llms.txt`, re-fetched
this pass (475 lines, **79 `post_…` entries**), lists for these two resources
exactly:

```
get_v1_travel-letter-requests          get_v1_work-authorization-requests
get_v1_travel-letter-requests_id       get_v1_work-authorization-requests_id
patch_v1_travel-letter-requests_id     patch_v1_work-authorization-requests_id      (→ PUT)
patch_v1_travel-letter-requests_id-2   patch_v1_work-authorization-requests_id-2    (→ PATCH)
```

No `post_…` page for either. Absence from an index is weak on its own — but
the index carries `post_v1_offboardings`, `post_v1_incentives`,
`post_v1_expenses` and 76 more, so **this index does document POSTs where they
exist**, and the two `{id}` pages resolve to a `put` and a `patch` on the same
path (the page *titles* say "Update…"; the methods in the embedded OpenAPI are
`put` and `patch`). The absence is a pattern, not a gap.

**Structural evidence — the API's own design says why there is no POST**
`[CONFIRMED]`. From `patch_v1_work-authorization-requests_id-2.md`:

- `WorkAuthorizationRequest` is described as *"A work authorization request
  **submitted by an employee** who needs authorization to work in a different
  country."*
- Its `status` enum is closed: `pending, cancelled, declined_by_manager,
  declined_by_remote, approved_by_manager, approved_by_remote`, and `pending`
  is glossed *"Submitted and awaiting manager review."*
- `UpdateWorkAuthorizationRequestParams` is `additionalProperties: false` and a
  `oneOf` over exactly two branches: `ApprovedWorkAuthozation`
  (`status` enum `["approved_by_manager"]`, plus optional
  `employer_special_instructions`) and `DeclinedWorkAuthozation`
  (`status` enum `["declined_by_manager"]`, `reason` **required**). *(Remote's
  own schema titles carry the typo "Authozation" — copy it, do not correct it.)*
- There is a `work_authorization.requested` webhook: *"triggered when a work
  authorization is requested."*

So the integration contract is **created by the employee inside Remote's
product, decided by the partner over the API**: you receive `requested`, you
`PATCH` one of two verdicts. A company-side create would be a different
product, not a missing endpoint. `travel_letter.*` is identical in shape
(`UpdateTravelLetterRequestParams`, same two branches).

**Live evidence** `[CONFIRMED-LIVE]`, this container, `$REMOTE_BASE_URL`:

```
GET     /v1/work-authorization-requests           → 200  {"data":{"total_count":0,…}}
GET     /v1/travel-letter-requests                → 200  {"data":{"total_count":0,…}}
GET     /v1/work-authorization-requests/{uuid}    → 404  {"message":"Not Found"}   (routed)
OPTIONS /v1/work-authorization-requests           → 404  "Not Found"               (unrouted method)
```

The collections are routed and readable; the account holds zero of either.

**What remains strictly open, and the one request that would close it.** A
`POST` was not made, per the brief. The decisive probe is a **single
`POST /v1/work-authorization-requests` with an empty body `{}`**: by §13.0(a)
it returns the bare-string `"Not Found"` if there is no POST route, or a `422`
naming missing params if there is — and **both branches are error paths that
create no record.** Until someone runs it, "no POST exists" is
`[CONFIRMED — docs + design + live reads]`, not `[CONFIRMED-LIVE]`.

**Why it matters, and it is not theoretical.** `src/uc04/workflow.js:113–131`
calls `remote.createWorkAuthorization()` on **every `ready_for_approval` and
every `escalate`** — and swallows the failure (`console.error` + continue), so
the workflow cannot tell a written record from an unwritten one. See §13.10 for
the exact lines, including two enum values sent to that endpoint that are not
members of Remote's enum at all.

---

### 13.2 The full `Incentive.status` enum — **CLOSED: `pending | processing | paid`, and Remote's own prose is wrong**

`[CONFIRMED-LIVE]` by the §13.0(b) technique, corroborated three ways.

1. **The filter validates against a closed set.** Accepted: `pending` (18),
   `processing` (7), `paid` (28). **Rejected with
   `parameter_value_invalid`:** `scheduled`, `cancelled`, `canceled`, `draft`,
   `approved`, `declined`, `rejected`, `failed`, `deleted`, `archived`,
   `created`, `submitted`, `in_review`, `review`, `completed`, `done`,
   `active`, `inactive`, `on_hold`, `hold`, `error`, `refunded`, `reversed`,
   `queued`, `planned`, `upcoming`, `processed`, `payout`, `paid_out`,
   `awaiting_payment`, `pending_payment`, `scheduled_payment`, `new`, `open`,
   `closed`, `voided`, `expired`, `PENDING`, `Pending` (39 rejections).
2. **The three accepted values partition the population exactly**:
   18 + 7 + 28 = **53** = `total_count` of `GET /v1/incentives`. No record is
   in a fourth state.
3. **Remote's own DELETE page agrees** (`delete_v1_incentives_id.md`):
   *"`one_time` incentives that have the following status **CANNOT** be
   deleted: `processing`, `paid`"* — it names the same lifecycle, and it
   implies **deletion is how an incentive is undone; there is no `cancelled`
   state.** The webhook set says the same: `incentive.created`,
   `incentive.updated`, `incentive.processing_started`, `incentive.paid`,
   `incentive.deleted`. No `cancelled`, no `scheduled` event exists.

**The correction, and it is a trap worth naming.** The OpenAPI's `status`
description reads *"(e.g. `"pending"`, `"scheduled"`, `"paid"`,
`"cancelled"`)"*. **Two of those four values are rejected by Remote's own API.**
Prose examples in a description field are not a contract; the previous revision
of this section was right to refuse them and wrong only in its guess that the
true set was larger. **Reverse the earlier instruction:** whitelisting against
the three observed values is now the *correct* thing to do, and a `scheduled`
or `cancelled` branch in our code would be dead.

---

### 13.3 Does Remote honour an `Idempotency-Key` header? — **CLOSED: no, and Remote says so in its own words**

`[CONFIRMED]`. Three independent findings, all pointing the same way:

1. **No such request header is documented anywhere.** `Idempotency-Key`
   occurs zero times in the 475-line live `llms.txt`, and the guide pages that
   enumerate request headers name only two: `Authorization`
   (`docs/authentication.md` — *"you always send the token as a bearer token in
   the `Authorization` header"*) and `Content-Type` (`docs/rate-limit.md`'s
   worked examples). The only *response* headers Remote documents are
   `x-ratelimit-count` / `-remaining` / `-reset`.
2. **Where "idempotent" does appear, it is a property of a specific
   endpoint's semantics, never of a header** — e.g. the pre-onboarding
   document endpoints: *"Idempotent: repeated calls return the same document
   until it is signed."* That is find-or-create behaviour baked into one
   operation, not a general replay guarantee you can ask for.
3. **Remote pushes de-duplication onto the consumer, explicitly.**
   `docs/receiving-webhooks.md`, "Handle duplicates": *"Assume at-least-once
   delivery. The same event can arrive more than once because of retries,
   replays, or network hiccups. **De-duplicate on the event id in the payload
   and make your processing idempotent**, so a repeated delivery has no extra
   effect. The timestamp is not a de-duplication key, because each attempt is
   signed with its own fresh timestamp."*

**So the assumption the exactly-once design rests on is correct**: our
guarantee is the `workflow_claims` PRIMARY KEY, not anything Remote provides,
and it must stay that way. Two consequences worth carrying forward:

- `restClient.js`'s `#writeHeaders(idempotencyKey)` sends a header no
  documented endpoint reads. It is harmless (unknown headers are ignored) but
  **its name asserts a guarantee that does not exist**, which is the same
  class of error as an invented endpoint — one layer quieter. Renaming it, or
  commenting it as "sent speculatively; Remote documents no such header", is a
  one-line honesty fix for whoever owns `src/remote/`.
- Remote names the de-dup key it expects us to use: **the event id in the
  webhook payload**. Our claims are keyed `(use_case, external_ref)` where
  `external_ref` is a Zendesk ticket id — appropriate for the intake path we
  actually have, but if a Remote webhook ever becomes a trigger source, its
  event id is the key Remote itself tells you to claim on.

---

### 13.4 What `PATCH /v1/expenses/{id}` accepts beyond approve/decline — **CLOSED: nothing, and the other three states are not ours to set**

`[CONFIRMED]`, from `patch_v1_expenses_id-2.md` (the page titled "patch" whose
sibling `patch_v1_expenses_id.md` is the `put` on the same path).

`UpdateExpenseParams` is a **`oneOf` over exactly two branches**:

| Branch | `required` | `status` enum |
|---|---|---|
| `ApproveExpenseParams` | `status` | `["approved"]` |
| `DeclineExpenseParams` | `status`, **`reason`** | `["declined"]` |

That is a *closed* contract, not silence — the earlier "whether a `canceled` or
`reimbursed` transition is reachable is not stated" was reading a gap that is
not there. And the full `Expense.status` enum **is** documented, with a gloss
naming the actor for each state:

```
canceled    "Canceled by the employee before approval."
pending     "Submitted and awaiting approval."
declined    "Declined by a reviewer. See `reason` for details."
approved    "Approved by a reviewer and queued for reimbursement."
processing  "Being processed as part of a payroll run."
reimbursed  "Successfully reimbursed to the employee."
```

So the three states outside the write contract are reached by **the employee**
(`canceled`) or **by payroll** (`processing`, `reimbursed`) — not by an API
caller, and not by us. UC-02's `hold` correctly writing nothing is not merely
"not blocking anything"; it is the only representable behaviour, because
Remote offers no third verb.

*(Live check, and a gotcha: `GET /v1/expenses?status=…` accepts every value
and filters by none — see §13.0(b). Do not use it to enumerate this enum.)*

---

### 13.5 Remote's word for a spend cap / expense policy limit — **CLOSED: there is none, and `policyCaps.js` should keep its own name**

`[CONFIRMED]` by exhaustion, which is a weak instrument in general and a strong
one here because the search space is small and the near-misses are checkable.

- Across the live 475-line index: `spend`, `allowance`, `budget`, `cap`,
  `threshold`, `maximum`, `max_amount` occur **zero** times; `limit` occurs
  only as `rate-limit`, `Rate Limit Policy` and `"limited to 100"` (page size).
- The category resource — the natural place for a per-category cap — has no
  monetary field at all. Live, a row is exactly:
  `{code, parent{code,title,slug}, scope, status, instructions, description,
  title, prompt, slug, is_selectable}`. The closest things to a policy control
  are the free-text `instructions` / `prompt` and the boolean `is_selectable`.
  **Remote's expense policy surface is guidance and selectability, not
  amounts.**

So a cap is either a Remote *product* feature not exposed on the API, or the
customer's own policy — and in both readings it is a decision *about* a Remote
record rather than a field *on* one, which is precisely §2.3's "ours by right"
test. **Verdict: KEEP.** Adopting a Remote word here would claim the API has a
concept it does not.

---

### 13.6 `expense_category.slug` or `.code` as the stable key — **CLOSED live: both, for different jobs. And this item was already stale.**

The previous revision said this could not be settled because
`/v1/employee/expense-categories` 403s. **The 403 is real but it is the wrong
endpoint.** There is a company-scoped twin, `GET /v1/expenses/categories`,
which our token reads fine `[CONFIRMED-LIVE]`:

```
GET /v1/employee/expense-categories        → 403 {"message":"Forbidden, invalid role for this endpoint"}
GET /v1/expenses/categories                → 422 employment_id "can't be blank when neither
                                                  expense_id nor country_code is provided"
GET /v1/expenses/categories?country_code=PRT → 200, 33 rows
GET /v1/expenses/categories?country_code=GBR → 200, 32 rows
```

Note what the 403 actually says: **"invalid role"**, not "missing scope". The
`/v1/employee/*` family wants an *employee*-role token; ours is company-scoped.
That is a property of the token's role, not a permission someone forgot to
grant — and it is not a blocker, because the company-scoped endpoint returns
the same taxonomy.

**The answer** `[CONFIRMED-LIVE]`:

| Field | Live value | What it is | Use it for |
|---|---|---|---|
| `code` | `business_travel.accommodation` | stable, human-readable, two-level `parent.child`; identical across country queries for every shared category | **policy rules, audit rows, anything a human reads** |
| `slug` | `17fde76f-a927-4463-84eb-b7a9e69fc8b6` | an **opaque UUID**, per account | **the wire key on a write** — `ParamsToCreateExpense.expense_category_slug` |
| `category` | `meals`, `lodging`, … | the flat legacy enum | **nothing — `deprecated: true` in Remote's own OpenAPI** |

The doc descriptions are what misled the first pass: `slug` is glossed *"Unique
identifier for the category"* and the OpenAPI **example** shows
`"slug": "travel-flights-abc123"`, which reads like a slug. Live it is a UUID.
When an example and a live response disagree, the live response wins.

Two further live facts worth keeping:

- **The set is country-dependent.** PRT has 33 rows, GBR 32; PRT alone carries
  `business_travel.personal_meals_lunch` and
  `…_personal_meals_excluding_lunch`, GBR alone
  `…_personal_meals_during_business_travel`. Rows carry
  `scope: "global" | "country"` (the schema also names `company` and
  `legal_entity`). **A category list fetched for one country is not the list
  for another** — which is exactly why the endpoint refuses to answer without
  an `employment_id`, `expense_id` or `country_code`.
- **`ParamsToCreateExpense` states the precedence itself:** *"For category
  selection, you can use either `category` (legacy enum values, deprecated but
  supported) or `expense_category_slug` (new hierarchical categories,
  recommended). If both are provided, `expense_category_slug` takes
  precedence."*

**This unblocks §4's category rename**, with one design consequence: a policy
table keyed on `code` (the right key) needs a `code → slug` lookup at write
time, from the same live call. `src/uc02/expenseCategories.js` already keys on
`code` and never touches `slug`, which is correct — UC-02's only write is the
approve/decline `PATCH`, which carries no category at all. The slug is only
needed if something ever *creates* an expense.

---

### 13.7 Would the ZAF sidebar's live installation break on a route-path rename? — **CLOSED: yes; a rename needs a re-upload, not a settings edit**

`[CONFIRMED-LIVE]`, read from the Zendesk account this pass
(`GET /api/v2/apps/installations.json`).

The enabled installation is **`6164712182559` → app `9990001`, "Remote CX
Review v1.01", `enabled: true`** (the earlier `9990002` install is present and
`enabled: false` — the superseded upload). Its **complete** settings key list
is:

```
apiBaseUrl  uc02ApiBaseUrl  uc03ApiBaseUrl  uc04ApiBaseUrl  uc05ApiBaseUrl
uc06ApiBaseUrl  uc07ApiBaseUrl  uc08ApiBaseUrl  uc09ApiBaseUrl
name  title  signWrites
```

Every one of the nine is a **base URL**. Nothing after the origin — no path
segment, no route template — is configurable. Therefore any rename of a route
*path* lives in the bundle's own JavaScript and requires re-uploading the app
(`zcli apps:update`), exactly as **Stage C step 9(d) assumed**. That assumption
is now tested rather than inferred.

What is still not proven, and it is a narrower question than the one recorded
before: **whether the deployed bundle is byte-identical to `zaf-app/` on this
branch.** The Zendesk API exposes the installation's settings and the app's
manifest metadata, not its asset source. **What would close it:** `zcli apps:
validate` + a re-upload from a known commit, or a diff of the uploaded package
against the repo at the commit the install was made from
(`updated_at: 2026-08-18T10:25:24Z`). Until then, treat a route rename as
requiring a redeploy *and* a verification that the redeploy is what is running.

---

### 13.8 `PUT /v1/resignations/{offboarding_request_id}/validate` — **CLOSED: the endpoint exists, is fully specified, and the repo says the opposite in five files**

This is the largest correction in this section.

**The endpoint is real** `[CONFIRMED]`. It is in the live `llms.txt`
(`put_v1_resignations_offboarding_request_id_validate`), its reference page
returns 200, and its embedded OpenAPI defines `put` on
`/v1/resignations/{offboarding_request_id}/validate`, scope `resignation:write`,
`200 → SuccessResponse {data:{status:"ok"}}`.

**Its sibling read is real too**, and this one is confirmed *live*: `GET
/v1/resignations/{uuid}` returns `{"message":"Not Found"}` — the **routed**
404 shape of §13.0(a) — where the unrouted `/v1/resignations` returns the bare
string. **The route exists and our token may call it**: a scope the token
lacked would answer `403 "Forbidden, invalid role for this endpoint"`, the way
`/v1/employee/*` does. So this Sandbox token already holds `resignation:read`.

**Body — `ValidateResignationRequestParams`, a `oneOf`, both branches
`additionalProperties: false`:**

*`ResignationAfterStartDateRequestParams`* — required:
`accepts_proposed_notice`, `agrees_to_pto_amount`,
`agrees_to_resignation_reason`, `has_additional_information`,
`has_more_salary_info`, `is_owed_outstanding_reimbursements`,
`will_take_more_pto`. Each boolean has a conditionally-required `_notes`
partner; `accepts_proposed_notice: false` requires
`proposed_last_date {date, notes}`; `is_owed_outstanding_reimbursements: true`
requires `owed_outstanding_reimbursements {amount, notes}` where `amount` is
**an integer in minor units** (Remote's own gloss: *"EUR 500.25 → `50025`"* —
our ×100 rule, in Remote's words). Optional `timesheet_file`, whose description
points at the Time Off Balance endpoint for PTO accuracy.

*`ResignationBeforeStartDateRequestParams`* — required
`proposed_resignation_accepted`, with `_notes` required when false.

**Every field is glossed as the EMPLOYER's answer**: *"Whether the employer
accepts the proposed notice period and last working day"*, *"Whether the
employer agrees with the employee's current PTO balance"*. This is not a
resignation-submission endpoint. **It is the employer-side sign-off** — which
is, field for field, what UC-05's HR Ops step produces.

**And the read side already carries the calculation** `[CONFIRMED]`.
`GET /v1/resignations/{id}` → `ResignationAfterStartDate`, whose required
fields include `days_of_notice` (*"The number of calendar days of notice
required **based on the contract terms and local labor laws**"*),
`proposed_last_day` (*"calculated based on the notice period and local labor
laws"*), `contract_start_date`, `contract_probation_period_end_date`,
`contract_proabtion_period_passed` *(Remote's typo — copy it)*, and
`paid_timeoffs_breakdown_labels`. **Remote computes the statutory notice
itself.**

**What is NOT confirmed, precisely.** Whether *we* can execute it. Three
separate unknowns, only one of which is about scope:

1. **The token's `resignation:write` scope is untested** — testing it is a write.
2. **There is nothing in this Sandbox to call it against.** Live:
   `GET /v1/offboardings` returns **one** record —
   `299a91ae-e9fa-4da6-a1ff-7c02b3e4bc21`, `type: "resignation"`,
   `status: "in_review"` — and `GET /v1/resignations/299a91ae-…` **404s**,
   because the show endpoint is documented as *"Shows the details of a
   resignation with status `submitted`"* and this one has moved past it.
   (`GET /v2/offboardings` shows 11 more, all `completed` or
   `pending_payment`; none `submitted`.)
3. **We cannot create one.** `POST /v1/offboardings` →
   `CreateOffboardingParams.type` is `enum: ["termination"]`, with the
   description *"For now, only `termination` is allowed."* A resignation
   originates in Remote's employee self-service portal.

**What would close it:** a resignation raised through Remote's employee portal
in the Sandbox, left at status `submitted`; then `GET /v1/resignations/{that
id}` to confirm the read shape, then one `PUT …/validate` with
`accepts_proposed_notice: true, agrees_to_pto_amount: true,
agrees_to_resignation_reason: true, has_additional_information: false,
has_more_salary_info: false, is_owed_outstanding_reimbursements: false,
will_take_more_pto: false` and a `200 {"data":{"status":"ok"}}`. Neither half is
reachable from this container: the first is a UI action, the second is a write.

**The architecture question this raises is in §13.9. It is not a patch.**

---

### 13.9 The UC-05 architecture question — options, consequences, and a recommendation

**The problem.** UC-05 is 🟡. Its "execution" is an HR Ops sign-off, and **the
signed-off report is the durable artifact *because no Remote write was believed
to exist*.** `src/uc05/resignationStore.js`'s header says so in as many words,
and reasons from it to the absence of a `markExecuted` method. That premise is
false. A tier design that rests on a false premise is not wrong yet — but it is
no longer *justified*, and the difference matters for a system whose whole
argument is that the tier selects the execution path.

There is a second, quieter consequence. `src/uc05/noticePeriodTable.js` is a
hand-curated 9-country statutory-notice table, honestly labelled *"EVERY FIGURE
HERE IS A SIMPLIFICATION OF PUBLIC STATUTORY PROVISIONS."* Remote returns
`days_of_notice` and `proposed_last_day` for the same employment, computed from
the contract and local law. **We are now maintaining a table that duplicates an
authoritative source we can read** — and the two can silently disagree, with our
number being the one a human signs.

**Option A — leave it exactly as it is.** UC-05 stays report-only; the endpoint
is documented in the spec as known-but-unused.
*For:* zero risk, zero work, nothing to re-prove. The 🟡 human gate is intact.
*Against:* the reason recorded in five files is false, so the next reader
re-derives it or, worse, trusts it. And "we chose not to write" is a much
stronger position than "we believed we could not" — the second reads as a gap
when a reviewer finds the endpoint in two minutes, which is how long it took.
*Tier impact:* none.

**Option B — read-only adoption. Fetch the resignation record, compare Remote's
`days_of_notice` / `proposed_last_day` against ours, and surface the delta.**
UC-05 still writes nothing.
*For:* it turns the duplicate table from a liability into a **control** — a
disagreement between our figure and Remote's is exactly the discrepancy UC-05
exists to catch, and it is the kind of thing that gets caught by nobody today.
It needs only `resignation:read`, which the token demonstrably has. It is
additive: no gate changes, no tier changes, no new failure mode on the write
side because there is no write side. The signed-off report gets *better*
without getting more dangerous.
*Against:* needs a `submitted`-status record to exercise, which the Sandbox
does not currently have (§13.8) — so it ships behind the same
upstream-failure attribution every other read has, and its positive path stays
unproven until someone raises one.
*Tier impact:* none. 🟡 unchanged, human gate unchanged.

**Option C — full adoption. The HR Ops sign-off becomes a `PUT …/validate`.**
*For:* "done" would mean the offboarding actually moved in Remote, not that a
report exists in our database. It is the honest completion of the use case, and
the field mapping is close to one-to-one — our sign-off already collects
"accepts the proposed notice", "agrees the PTO figure", "proposed alternative
last date", "outstanding reimbursement owed".
*Against, and this is the load-bearing part:* it converts UC-05 from a use case
with **no execution path** into one with a **real, irreversible, money-adjacent
write** — `owed_outstanding_reimbursements.amount` is a payment instruction,
and `proposed_last_date` moves a termination date. That is UC-09's risk
profile, and UC-09 is gated behind a floor-of-2 multi-role approval that
`Math.max(2, …)` guarantees can never drop below two. UC-05 today has **one**
HR Ops sign-off. Adopting the write without adopting the control would be the
worst of the three options: the same single approver, a much larger blast
radius. It also needs the ×100 discipline applied to a *new* field, a schema
validation of the next-state payload, an idempotency claim, and a positive
end-to-end proof — none of which exist and none of which can be built against
this Sandbox until a `submitted` resignation exists.
*Tier impact:* **UC-05 stops being 🟡 as currently specified.** Either it is
re-tiered, or the approval floor rises to two roles.

**Recommendation: B now, C only as a deliberate, separately-scoped decision.**

B is the option that fixes the actual defect. The defect is not "UC-05 fails to
write"; it is "UC-05 believes something false about the API, and independently
maintains a statutory table it could be checking against Remote's own answer."
B closes both, changes no tier, adds no risk, and — because it makes our number
and Remote's number visible side by side in one artifact — it is also the
strongest possible evidence for the interview claim that this system knows when
*not* to automate: we read the authoritative figure, we show the human both,
and we still do not move the record.

C should be reopened only with its own ticket, and only alongside a second
approval role. The line to hold is the one this repository already holds
everywhere else: **a write that can move money or a termination date needs more
than one human**, and adding the write without adding the human is exactly the
trade this project exists to refuse.

**Do not implement either from this document.** `src/uc05/**` belongs to other
work in flight; this pass changed no source.

---

### 13.10 Claims elsewhere in this repository that these findings contradict

Named with file and line so a later pass can correct them. **None were edited
by this pass** — every one lives in a file owned by concurrent work.

| Claim | Where | What this pass found |
|---|---|---|
| *"UC-04.md §3 lists the endpoints as `[CONFIRMED]`: create one before a specialist's approve can issue it"* | `src/remote/restClient.js:1019–1020` | UC-04.md §3 says the **opposite**. See the next row. |
| *"Travel letter / work-authorization request … **no `POST`**; the request is created inside Remote's own 'Request Hub' UI, not the partner API. `PATCH` accepts only two transitions from `pending`: `approved_by_manager` or `declined_by_manager`"* `[CONFIRMED — live]` | `docs/use-cases/UC-04.md:46` | **Correct.** The spec had the right answer all along; the client comment misquotes it and the code follows the misquote. |
| `createWorkAuthorization()` — `POST /v1/work-authorization-requests` | `src/remote/restClient.js:1028, 1033–1046` | No such POST is documented (§13.1). |
| `remote.createWorkAuthorization({… status: "pending_mobility"})`, called on every `ready_for_approval` **and** every `escalate`, failure swallowed with `console.error` | `src/uc04/workflow.js:113–131` (status at `:124`) | `pending_mobility` is not a member of Remote's `status` enum. The swallow means the workflow cannot distinguish a written record from an unwritten one. |
| `patchWorkAuthorization(id, {status: "approved_by_remote", approved_by, approved_at, decision_reason})` | `src/uc04/workflow.js:357–361`; documented at `src/remote/restClient.js:1062–1065` and `src/uc04/workflow.js:25` | The caller-settable enum is **`approved_by_manager`** only; `approved_by_remote` is Remote's own verdict (§5.4's finding, again). `declined` is not an enum member at all — `declined_by_manager` is. And both branches are `additionalProperties: false`, so `approved_by` / `approved_at` / `decision_reason` are refused; the only companion fields are `employer_special_instructions` and, on decline, a **required** `reason`. |
| Mock implements `POST /v1/work-authorization-requests` | `src/remote/mockServer.js:2432` | This is why the whole suite passes. The fixture agrees with the code; neither was compared to Remote — the failure mode CLAUDE.md §4 names as the through-line of 2026-08-18. |
| *"Endpoints below override all three raw docs, live-verified against `developer.remote.com` — **none of the three docs' assumed `/v1/resignations/{id}` endpoint or `PUT .../validate` write path exists**"* | `docs/use-cases/UC-05.md:3` | Both exist, in the live `llms.txt` today, and `/v1/resignations/{id}` answers with the **routed** 404 shape live (§13.8). A `[CONFIRMED]`-tagged negative. |
| *"The spec explicitly notes that NO write endpoint to Remote is confirmed for resignations"* | `src/uc05/resignationStore.js:20–29` | False premise; the store's whole no-`markExecuted` argument rests on it (§13.9). |
| Same claim, restated | `src/uc05/server.js:20`, `src/uc05/policyEngine.js:38`, `src/uc05/cli.js:132`, `docs/use-cases/UC-05.md:154` | Same. |
| *"UC-02 cannot validate an expense category live. The Sandbox token's role lacks access to `/v1/employee/expense-categories`"* — listed as a standing open issue | `CLAUDE.md` §7 (Stage 3.5, standing issue 1) | **Stale — already closed in code.** `src/remote/restClient.js:859–932` moved to the company-scoped `/v1/expenses/categories`, which our token reads (§13.6). |
| `#writeHeaders(idempotencyKey)` sends `Idempotency-Key` on every write | `src/remote/restClient.js` | Harmless, but Remote documents no such header (§13.3). The name asserts a guarantee that does not exist. |

---

### 13.11 What is still genuinely open after this pass

One item, and it is the one the brief said to leave open rather than guess:

- **A single `POST /v1/work-authorization-requests` with body `{}`** would
  convert §13.1 from `[CONFIRMED — docs + design + live reads]` to
  `[CONFIRMED-LIVE]`, and both of its outcomes create nothing. It is a write
  request, so this pass did not make it.

And two that are open only because the Sandbox lacks the data, not because the
API is unclear:

- **§13.8's `PUT …/validate`** — needs a `submitted`-status resignation raised
  through Remote's employee portal. Not creatable via the API
  (`CreateOffboardingParams.type` is `enum:["termination"]`).
- **§13.7's bundle identity** — needs a diff of the uploaded ZAF package
  against the repo at the install commit, or a fresh `zcli apps:update` from a
  known commit.

**Suite, unchanged by this pass:** `npm test` → **2048 tests, 2047 pass,
0 fail, 1 skipped, ~10.0s**. This section changed one document and no code.

---

## 14. Summary — the four highest-value renames

1. **§9.1 + §9.6 — UC-09's incentive write.** The path 404s live, and the
   required `amount_tax_type` is missing while an invented
   `tax_calculation_method` is sent in its place. This is the one code path in
   the repo that POSTs money, and `gross` vs `net` changes the amount that
   leaves the account. Two of the three defects are pure vocabulary; all three
   are invisible to the current tests because no test asserts the write
   *succeeds*.
2. **§5.4 — `approved_by_remote`.** We write Remote's own compliance verdict to
   record our customer's specialist's decision. The correct member is
   `approved_by_manager`, and Remote's gloss makes the difference explicit:
   *"awaiting Remote's review"* versus *"Fully approved by both the manager and
   Remote."*
3. **§2.1 — `deny` → `decline`.** `deny` occurs **zero** times in Remote's
   entire corpus; `decline`/`declined` occurs **648**. It is the single most
   pervasive mismatch, it is what a Remote reviewer would notice first, and it
   is the one that most needs the compatibility discipline in §12 Stage C
   rather than a `sed`.
4. **§4 — "claim" → "expense".** The best ratio in the document: entirely
   rendered, zero compatibility risk, and it removes an insurance word from
   twelve of UC-02's twenty gate descriptions.

And the one to **resist**: nothing in §2.3 should be aligned to a Remote word.
Risk tiers, gates, escalation, `human_review`, exceptions, idempotency claims
and the audit trail are the CX automation layer's own vocabulary. They describe
decisions *about* Remote records rather than fields *on* them, and Remote's
corpus contains zero of them. Borrowing a Remote word for any of these would
claim the API has a concept it does not — which is exactly the defect that put
`POST /v1/cost-calculator/employment` into a spec tagged `[CONFIRMED]`.
