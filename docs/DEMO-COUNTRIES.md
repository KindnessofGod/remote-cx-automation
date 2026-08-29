# Demo country set — NL · PT · CA · US

> **What this file is.** The demo scenario matrix for all nine use cases on four
> countries, and — more importantly — a record of what each scenario *actually
> did* when it was run against the live Remote Sandbox, not what it was
> predicted to do.
>
> **Every row's "observed" column was produced by running it.** The runner is
> `scripts/demo-countries-matrix.mjs`; it calls the real entry point in each
> `src/ucNN/workflow.js` with real Sandbox employment ids and prints the
> decision, reason and flags that came back. Re-run it with:
>
> ```bash
> NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs
> NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs --only UC06
> ```
>
> It is **not** a test and must never be imported by `npm test`: it reaches the
> network on purpose. Every LLM seam is injected with the real function forced
> into its unconfigured branch, so it never calls OpenAI (CLAUDE.md §6).
>
> **Headline: 77 scenarios run, 68 matched their prediction, 9 did not.** The
> nine are in §6, and they are the most valuable part of this document.
>
> **Why a run and not a table of expectations.** This repo's most expensive
> recurring defect (CLAUDE.md §4; `docs/BUILD-LOG.md` §3.30) is that a use case
> which *structurally cannot succeed* is indistinguishable from one that is
> *appropriately refusing*. Every fail-closed assertion passes in both cases.
> Only a positive test — "this exact input MUST reach `auto_resolve` /
> `ready_for_approval` / `dual_approval_required`" — tells them apart. So every
> use case below carries at least one scenario whose expected outcome is a
> success, and three of this document's findings exist only because that rule
> was followed.
>
> Run date: **2026-08-19**. Sandbox account: `rempel-paucek-4c3wac`, company
> `a9d4ce72-7773-4ea3-830d-c5b36a15e48d`.

---

## 1. The four countries, and whether each earns its place

### Netherlands (NL) — earns it, and is the only country that can demonstrate UC-06's success path on real data

10 active employments across both `employee` (EOR) and `global_payroll_employee`
models. It is the **only country whose payroll calendar runs into H2 2026** —
five real cycles, last `period_end` 2026-07-31 — and the only one carrying two
*overlapping* cycles for the same period with **different cutoffs** (a `main` run
2026-06-01→06-30 cutoff 06-20, and a `one_off` 2026-06-01→06-30 cutoff 06-10).
That overlap is the sole live trigger for UC-06's `ambiguous_payroll_cycle`
gate — the gate that stops the cutoff engine from silently picking whichever
cycle sorted first. Nothing else in the Sandbox exercises it. NL is also
Schengen and EU/EEA, so UC-04's A1-certificate consideration and the 90/180
window both apply.

**Branch it and only it exercises:** `ambiguous_payroll_cycle` (UC-06),
verified live at `UC06-NL-3`.

### Portugal (PT) — earns it, on suppression and on tenure brackets; it is also the set's most instructive failure

4 active employments (contractor **and** EOR employee). PT is in
`NOTICE_PERIOD_TABLE` with genuine tenure brackets (30 days under 2 years / 60
days at or above, plus a 15-day probation rule), so UC-05's bracket arithmetic
and its `earlier_than_statutory` discrepancy branch both fire on real tenure
data. PT is Schengen **and** a member of `DNV_COUNTRIES` in
`src/uc04/riskMatrix.js`, which *suppresses* the Schengen 90/180 check — the one
place in the codebase where a control is removed rather than added, on the
strength of a five-entry list with no cited authority.

**Branch it and only it exercises:** the DNV suppression path in
`src/uc04/decisionFacts.js`, which emits `state: "suppressed"` — deliberately
neither `within_limit` nor `breached`. Verified live at `UC04-NLPT-1`.

PT also has **no payroll calendar in the Sandbox at all** and **no
`global_payroll_employee` record**, which makes it the honest demonstration of a
use case that cannot be demonstrated. See §4 and §5.

### Canada (CA) — earns it, on `basis: "customary"` and on being the second no-calendar case

9 active employments, contractor and `global_payroll_employee`. CA is in
`NOTICE_PERIOD_TABLE` with `basis: "customary"` and no statutory minimum — the
only entry of the nine that is not statutory, and therefore the only live proof
that the system *states* the absence of a statutory floor rather than
manufacturing a number. It is not Schengen and not in the EU A1 regime, so
UC-08's social-security question takes the bilateral-totalization branch. Its
payroll calendar exists but ended 2026-06-30, giving both UC-06 refusals
(`no_matching_payroll_cycle` for a future date, `cutoff_lock_passed` naming a
real cycle) on 100% real data.

**Branch it and only it exercises:** `basis: "customary"` in
`src/uc05/noticePeriodTable.js` and the citation *"Common-law customary notice
(no statutory employee minimum; varies by province)"*. Verified live at
`UC05-CA-1`.

### United States (US) — **earns it, but not for the reason it was added**

The US was added on the argument that it contributes no new code branch —
`us_requires_work_permit` and `ca_requires_work_permit` are structurally
identical twins in `src/uc04/riskMatrix.js:470-476` — but earns its place on
sourcing (public-domain federal documents) and credibility (largest single
country in the Sandbox: 22 active employments; Remote Technology Inc. is
US-incorporated).

**That argument is correct about UC-04 and wrong about the set as a whole.**
Running the matrix produced one finding that changes the verdict:

> **UC-02's `auto_approve` branch is reachable *only* in the United States.**
> `POLICY_CAP_CURRENCY` in `src/uc02/policyCaps.js` is `"USD"`, and the cap gate
> refuses to compare two figures in different currencies (`policy_cap_currency
> _mismatch`, a human review — the honest outcome, and the right one). Every
> pending NL and PT expense in the Sandbox is denominated in EUR and every CA
> one in CAD, so **no NL, PT or CA expense can ever auto-approve**, whatever its
> amount or category. The US is the only country in the set whose expenses are
> USD. Verified in both directions: `UC02-US-1` auto-approved live
> (`all_gates_passed`); `UC02-NL-4` and `UC02-CA-2` returned
> `policy_cap_currency_mismatch` on categories that *do* have caps.

Without the US, UC-02's 🟢 tier could only ever be demonstrated refusing — the
exact failure mode this whole document exists to guard against. That alone
earns the place.

Two further findings on the US, both of which cut the other way and are recorded
honestly:

- **UC-04: the US and Canada twins behave identically, as predicted.**
  `UC04-USNL-1`/`UC04-CANL-1` and `UC04-USNL-2`/`UC04-CANL-2` produced
  byte-identical decisions, reasons, risk levels and Schengen measurement states
  from identical inputs; `UC04-NLUS-2` and `UC04-PTCA-1` produced the same
  deciding-dimension finding text word for word. **The US adds no UC-04 branch.**
  It does add the *most legible* one — see §4.
- **UC-06 cannot be demonstrated on the US at all.** The contract-amendment
  schema read fails upstream for USA (see §4/§6), so every US amendment stops at
  `country_schema_unavailable`, one gate *earlier* than PT's refusal.

**Verdict: keep all four.** NL for UC-06's success path and the ambiguous-cycle
gate, PT for the DNV suppression and the tenure brackets, CA for the customary
basis, US for UC-02's only reachable success path and the largest employment
pool.

---

## 2. Coverage matrix

Legend — **✅ success path proven live** · **⚠️ refusals only (and why)** ·
**❌ not demonstrable on this country** · **➖ country-independent**

| | NL | PT | CA | US |
|---|---|---|---|---|
| **UC-01** Employment verification 🟢 | ✅ `auto_resolve`, letter rendered, no salary | ✅ `auto_resolve` | ✅ `auto_resolve` (contractor) | ✅ `auto_resolve` — largest pool (22 active) |
| **UC-02** Expense validation 🟢 | ⚠️ EUR vs a USD cap corpus → `policy_cap_currency_mismatch` | ❌ **no expenses exist for any PT employment** | ⚠️ CAD vs a USD cap corpus | ✅ **the only reachable `auto_approve`** |
| **UC-03** Travel router 🟢 | ✅ `auto_resolve` (→PT, →US) | ✅ `auto_resolve` (→CA); ✅ `route_to_uc04` | ⚠️ sanctions gate needs a classifier that resolves the destination — see §6 | ✅ `auto_resolve` (→PT) |
| **UC-04** Workation 🟡 | ✅ as origin (→PT suppressed, →US all three visa branches) | ✅ as destination (DNV suppression) and origin (→CA) | ✅ as origin (→NL) and destination (work-permit twin) | ✅ as origin (→NL, →PT) and destination (all three visa branches) |
| **UC-05** Resignation notice 🟡 | ⚠️ **not in `NOTICE_PERIOD_TABLE`** → `unsupported_country` (correct) | ✅ `prepared_for_signoff` + ✅ `statutory_discrepancy`; ❌ probation path (no live probation record) | ✅ `prepared_for_signoff`, `basis: "customary"` | ⚠️ **not in `NOTICE_PERIOD_TABLE`** → `unsupported_country` (correct) |
| **UC-06** Contract amendment 🟡 | ✅ **`dual_approval_required`** (full-time `global_payroll_employee`) + both refusals + the unique `ambiguous_payroll_cycle` | ❌ no payroll calendar **and** no `global_payroll_employee` → stops at `schema_invalid` | ✅ `dual_approval_required` (stand-in cycle) + both refusals on real data | ❌ **schema read fails upstream** → `country_schema_unavailable` for every US amendment |
| **UC-07** Relocation 🔴 | ✅ complete dossier, `PROCEED`, cost `CALCULATED` (as source and destination) | ✅ as destination | ✅ as source, `BLOCK` with 4 populated flags | ✅ as source |
| **UC-08** Cross-border tax 🔴 | ⚠️ dossier complete **but the Netherlands is dropped from `jurisdictions`** — see §6 | ✅ dossier complete, jurisdictions populated | ⚠️ **Canada dropped too** — a totalization dossier naming zero jurisdictions | ✅ dossier complete; ❌ nothing models citizenship-based taxation |
| **UC-09** Off-cycle payroll 🔴+exec | ✅ floor-of-2 + ✅ `unparseable_amount` refusal | ✅ floor-of-2 + ✅ 3rd approver via `taxAdjustment` | ✅ 3rd approver via the **amount** dimension | ✅ both, largest pool |
| `HIGH_TAX_COMPLEXITY_HEURISTIC` (UC-09) | ➖ not on the list (DE/FR/IT) | ➖ not on the list | ➖ not on the list | ➖ not on the list |

**None of the four is in `HIGH_TAX_COMPLEXITY_HEURISTIC`**, which is flagged
`unsourced_heuristic` in `src/uc09/policyEngine.js`. That is deliberate for this
demo: the third approver is demonstrated through the **amount** dimension
(`repo_defined_threshold`, a stated policy value) and the **`taxAdjustment`**
dimension (`request_field`, a fact the requester stated), never through the
uncited country list. The engine still reports the jurisdiction dimension with
`triggered: false` and the note *"a country's absence from this list carries no
finding at all"* — verified live on NL.

---

## 3. Scenario list — expected vs **observed**

Every "Observed" cell below is a real return value. Rows where the two differ
are marked **⚠️ DIFF** and analysed in §6.

### UC-01 — Employment verification letter 🟢

| ID | Country | Input | Employment | Expected | **Observed** | Flags |
|---|---|---|---|---|---|---|
| UC01-NL-1 | NL | "standard employment verification letter for my mortgage" | `673a1884…` Lars van der Berg (EOR employee) | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** | `[]` |
| UC01-PT-1 | PT | "…verification letter for my landlord" | `378eee6b…` João Silva (EOR employee) | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** | `[]` |
| UC01-CA-1 | CA | "…standard employment verification letter for my visa appointment" | `3537d9ee…` Alexandre Tremblay (contractor) | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** | `[]` |
| UC01-US-1 | US | "…standard employment verification letter for my mortgage lender" | `2f7f8210…` Alex Morgan (EOR employee) | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** | `[]` |
| UC01-NL-2 | NL | letter request that **also asks for salary** | `673a1884…` | `human_review` / `over_scope_request` | **`human_review` / `over_scope_request`** | `over_scope_disclosure_requested` |
| UC01-CA-2 | CA | session belongs to a **different** employee | `20b1346b…` requested, `3537d9ee…` authenticated | `escalate` / `identity_not_verified` | **`escalate` / `identity_not_verified`** | `identity_session_employment_mismatch` |
| UC01-US-2 | US | "a letter confirming my engagement" — wording the deterministic fallback does not recognise | `2f7f8210…` | `human_review` / `non_standard_request` | **`human_review` / `non_standard_request`** | `non_standard_request` |

**Letter content verified separately on the live NL record:** the rendered letter
is 3,796 bytes and its rows are *Employee name · Job title · Employment status ·
Contract type · Start date · On probation · Employer of Record*. It contains no
match for `/salary|compensation|remuneration|EUR|7410855/i`, even though the
Sandbox record carries `annual_gross_salary: 7410855 EUR`.

### UC-02 — Expense & receipt validation 🟢

| ID | Country | Input | Expected | **Observed** | Note |
|---|---|---|---|---|---|
| **UC02-US-1** | US | Team Building, USD 327.54, pending → classified `work_meals_and_entertainment.internal_meals_and_entertainment`, cap USD 500 | `auto_approve` / `all_gates_passed` | **`auto_approve` / `all_gates_passed`** | **The one live success in this use case.** Performs a real `PATCH /v1/expenses/:id` |
| UC02-US-1b | US | the same expense, submitted again | `blocked` / `expense_not_pending` | **`blocked` / `expense_not_pending`** | auto-approve is one-shot **by design** |
| UC02-US-2 | US | Office Supplies, USD 319.30 → `company_and_office_expenses.office_supplies_and_shipping`, cap USD 150 | `human_review` / `over_policy_cap` | **`human_review` / `over_policy_cap`** | |
| UC02-US-3 | US | Standing Desk, USD 600.36 → `tech_and_work_equipment.equipment_shipping_and_customs`, no cap in the corpus | `human_review` / `policy_cap_unknown` | **`human_review` / `policy_cap_unknown`** | the F-12 fail-closed contract |
| UC02-NL-4 | NL | Hotel Stay, EUR 557.70 → `business_travel.accommodation`, cap **USD** 1,000 | `human_review` / `policy_cap_currency_mismatch` | **`human_review` / `policy_cap_currency_mismatch`** | a cap exists; the units do not match |
| UC02-CA-2 | CA | Coworking, CAD 693.72 → co-working, cap **USD** 250 | `human_review` / `policy_cap_currency_mismatch` | **`human_review` / `policy_cap_currency_mismatch`** | |
| UC02-NL-1 ⚠️ DIFF | NL | New Monitor, EUR 221.81 | `auto_approve` | **`human_review` / `policy_cap_unknown`** | see §6.1 |
| UC02-CA-1 ⚠️ DIFF | CA | Utilities, CAD 1,396.07 | `human_review` / `over_policy_cap` | **`human_review` / `policy_cap_unknown`** | see §6.1 |
| UC02-NL-2 | NL | an already-**approved** expense, resubmitted | `blocked` / `expense_not_pending` | **`blocked` / `expense_not_pending`** | |
| UC02-NL-3 | NL | an expense belonging to a different employment | `escalate` / `expense_employment_mismatch` | **`escalate` / `expense_employment_mismatch`** | |
| UC02-MOCK-1 | (mock) | reachability control on the checked-in fixtures | `auto_approve` / `all_gates_passed` | **`auto_approve` / `all_gates_passed`** | |

**Restock pass, 2026-08-19 — the supply was surveyed and could not be
replenished.** Run `NODE_USE_ENV_PROXY=1 node scripts/seed-uc02-demo-expenses.mjs`
for the live version of this; the ids below are that run's output.

Live Sandbox inventory: **221 expenses, 15 of them `pending` and billed in USD**
— the only records gate 12 will compare against a cap at all. Every one was put
through the real classifier and the real gates (read-only; neither refusal beat
writes). Rule-based and LLM classification agreed on the decision for all 15.

| Beat | Count | Expense ids (all US, all pending, all USD) |
|---|---|---|
| `auto_approve` / `all_gates_passed` | **0** | — |
| `human_review` / `over_policy_cap` | 6 | `2c18ec6d…` $319.30 · `f959275f…` $383.60 · `1a6b83ec…` $250.94 · `d0203f10…` $153.72 · `f6de3733…` $315.50 · `b049772b…` $273.59 — all "Office Supplies" → `company_and_office_expenses.office_supplies_and_shipping`, cap $150.00 |
| `human_review` / `policy_cap_unknown` | 9 | `d3e831ba…` "Training Course" · `9c542d02…` "Client Gifts" · `3138969b…` "Standing Desk" · `25c3fe17…` "Design Conference" · `a30e1ba2…` "Office Chair" · `6ac76f6e…` "Workshop Fee" · `d2599c5c…` "New Monitor" · `8dbc519b…` "Conference Fee" · `739b1ed1…` "Home Office Setup" |

Re-verified by driving `handleExpenseSubmission()` itself against the live
records: `d0203f10…` → **`human_review` / `over_policy_cap`**, `a30e1ba2…` →
**`human_review` / `policy_cap_unknown`**. `UC02-MOCK-1` re-run as the positive
control → **`auto_approve` / `all_gates_passed`**, so the green path's logic is
intact and what is missing is only supply.

**The two refusal beats are inexhaustible; the success beat cannot be restocked
at all.** `over_policy_cap` and `policy_cap_unknown` write nothing, so the same
record demonstrates them again indefinitely. `auto_approve` fires a real
`PATCH /v1/expenses/:id` and spends its record — and a company API token cannot
mint a replacement. Verified live 2026-08-19, same token, same shell, against
Remote's own OpenAPI first:

```
POST   /v1/expenses          {…}                    -> 201, status "approved"   ("Creates an **approved** expense")
POST   /v1/expenses          {…, status:"pending"}  -> 422 {"status":["only approved expenses can be created"]}
PATCH  /v1/expenses/:id      {status:"pending"}     -> 422 parameter_value_invalid
PUT    /v1/expenses/:id      {status:"pending"}     -> 422 parameter_value_invalid
POST   /v1/employee/expenses {…}                    -> 403 "Forbidden, invalid role for this endpoint"
DELETE /v1/expenses/:id                             -> 404 (no delete route)
```

`POST /v1/employee/expenses` is the only endpoint that creates a *pending*
expense and its `security` is `OAuth2Assertion` — an employee session, which an
unattended system actor structurally cannot hold. Same shape as the
expense-categories lesson in `docs/verification/uc02-expense-endpoints.md`: no
credential change fixes it. So a live `auto_approve` is restocked only by a
human submitting in the Sandbox UI as the employee, or by a Sandbox reseed;
otherwise the beat is demonstrated on the mock, where `<id>~fresh-<token>`
minting makes it repeatable.

### UC-03 — Travel support letter / workation router 🟢

| ID | Route | Input | Expected | **Observed** |
|---|---|---|---|---|
| UC03-NL-1 | NL→PT | 10-day family trip, informational | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** |
| UC03-NL-3 | NL→US | 9-day trip, informational | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** |
| UC03-PT-1 | PT→CA | 12-day holiday, informational | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** |
| UC03-US-1 | US→PT | 10-day holiday, informational | `auto_resolve` / `all_gates_passed` | **`auto_resolve` / `all_gates_passed`** |
| UC03-NL-2 | NL→PT | asks for a **formal** travel support letter | `human_review` / `formal_letter_requested` | **`human_review` / `formal_letter_requested`** |
| UC03-PT-2 | PT→NL | explicit **workation** intent | `route_to_uc04` | **`route_to_uc04` / `work_authorization_requested`** |
| **UC03-CA-2** | CA→IR | Iran, with a classifier that resolves the destination | `escalate` / `sanctioned_region` | **`escalate` / `sanctioned_region`** |
| UC03-CA-1 ⚠️ DIFF | CA→IR | Iran, via the **rule-based** classifier | `escalate` / `destination_jurisdiction_excluded` | **`escalate` / `destination_unknown`** — see §6.3 |

`GET /v1/countries` was re-verified live: 224 rows; NL, PT, CA and US are all
present, IR is absent.

### UC-04 — Work authorization / workation 🟡

Every non-`blocked` row here is carried by one of the **two** Sandbox records the
stand-in has an enrichment profile for (`src/remotebridge/enrichment.js`).
`factors.homeCountry` and `factors.nationality` are request inputs, not the
record's own country, so the carrier changes nothing about the branch being
exercised — it only makes the branch reachable. See §6.4.

| ID | Route | Visa | Expected | **Observed** | Schengen row state |
|---|---|---|---|---|---|
| **UC04-NLPT-1** | NL→PT | DNV | `ready_for_approval` | **`ready_for_approval` / `all_gates_passed`**, risk `low` | **`suppressed`** |
| **UC04-USPT-1** | US→PT | DNV | `ready_for_approval` | **`ready_for_approval` / `all_gates_passed`**, risk `low` | **`suppressed`** — note text identical to NL→PT |
| UC04-CANL-1 | CA→NL | Schengen short stay | `ready_for_approval` | **`ready_for_approval` / `all_gates_passed`**, risk `low` | `within_limit` |
| UC04-USNL-1 | US→NL | Schengen short stay | `ready_for_approval` | **`ready_for_approval` / `all_gates_passed`**, risk `low` | `within_limit` |
| UC04-CANL-2 | CA→NL | + 85 prior Schengen days | `blocked` / `schengen_90_180_exceeded` | **`blocked` / `schengen_90_180_exceeded`** | `breached` |
| UC04-USNL-2 | US→NL | identical history | `blocked` / `schengen_90_180_exceeded` | **`blocked` / `schengen_90_180_exceeded`** | `breached` |
| UC04-NLUS-1 | NL→US | **ESTA** | `blocked` / `visitor_visa_active_work_forbidden` | **`blocked` / `visitor_visa_active_work_forbidden`** | (no row — not Schengen) |
| UC04-NLUS-2 | NL→US | **business visa** | `blocked` / `us_requires_work_permit` | **`blocked` / `us_requires_work_permit`** | — |
| **UC04-NLUS-3** | NL→US | **work permit** | `ready_for_approval` | **`ready_for_approval` / `all_gates_passed`**, risk `low` | — |
| UC04-PTCA-1 | PT→CA | business visa | `blocked` / `ca_requires_work_permit` | **`blocked` / `ca_requires_work_permit`** | — |
| **UC04-PTCA-2** | PT→CA | work permit | `ready_for_approval` | **`ready_for_approval` / `all_gates_passed`** | — |
| UC04-NLIR-1 | NL→IR | any | `blocked` / `sanctioned_region` | **`blocked` / `sanctioned_region`** | — |
| UC04-NLPT-UN ⚠️ DIFF | NL→PT | DNV, carried by a real **NL** record | `ready_for_approval` | **`blocked` / `employer_permission_not_granted`** | see §6.4 |
| UC04-NLPT-GW | NL→PT | DNV, raw gateway | `blocked` / `employer_permission_not_granted` | **`blocked` / `employer_permission_not_granted`** | control |

### UC-05 — Resignation notice calculation 🟡

> ⚠️ **These rows are STALE, in two directions, and must be REGENERATED rather
> than hand-edited.** Their value is that the **Observed** column was observed;
> hand-correcting an observation destroys the only property that makes this file
> worth keeping.
>
> - **Already stale.** `UC05-NL-1` and `UC05-US-1` below record
>   `escalate / unsupported_country` citing *"Country not in the 9-country
>   statutory notice table."* The 2026-08-20 pass added NL to the table and gave
>   the US its own `no_statutory_notice_period` outcome; both rows predate it.
> - **About to be stale.** `UC05-CA-1` and `UC05-CA-2` are observed reaching
>   `prepared_for_signoff` on `basis: customary` figures. Change `[N-7]`
>   (`qa/contracts/UC-05-acceptance.md` §18 Step 5) moves Canada to
>   `escalate / no_statutory_notice_period`, and the queue requires this matrix to
>   be **regenerated in that same commit**.
>
> **The Canadian rows are the most useful thing in this section right now**, for
> the reason the file exists: they show, on live data, the one demo country whose
> signable figure has no retrieved statute behind it.

| ID | Country | Input | Expected | **Observed** | Notice detail (observed) |
|---|---|---|---|---|---|
| **UC05-PT-1** | PT | João Silva, 37 months tenure, LWD 2026-11-30 | `prepared_for_signoff` | **`prepared_for_signoff` / `all_gates_passed`** | `basis: statutory`, **60 days**, end `2026-10-18`, `discrepancy: later_than_statutory`, cite *Código do Trabalho art. 400* |
| UC05-PT-2 | PT | same employee, LWD 2026-09-01 | `escalate` / `statutory_discrepancy` | **`escalate` / `statutory_discrepancy`** | same 60-day figure, `discrepancy: earlier_than_statutory` |
| UC05-PT-3 | PT | Inês Carvalho (contractor), 37 months, LWD 2026-11-30 | `prepared_for_signoff` | **`prepared_for_signoff` / `all_gates_passed`** | identical 60-day bracket from a different engagement type |
| **UC05-CA-1** | CA | David Tremblay, 77 months | `prepared_for_signoff` | **`prepared_for_signoff` / `all_gates_passed`** | **`basis: customary`**, 14 days, cite *"Common-law customary notice (no statutory employee minimum; varies by province)"* |
| UC05-CA-2 | CA | Alexandre Tremblay (contractor), 37 months | `prepared_for_signoff` | **`prepared_for_signoff` / `all_gates_passed`** | `basis: customary`, 14 days |
| UC05-NL-1 | NL | Lars van der Berg | `escalate` / `unsupported_country` | **`escalate` / `unsupported_country`** | `basis: unknown`, `noticeEndDate: null`, `discrepancy: not_comparable`, cite **"Country not in the 9-country statutory notice table."** |
| UC05-US-1 | US | Alex Morgan | `escalate` / `unsupported_country` | **`escalate` / `unsupported_country`** | identical shape and citation |

**The CA output does exactly what it should.** It never uses the word
"statutory": `basis` is `customary`, the citation says *no statutory employee
minimum*, and the 14-day figure is presented as a customary floor for a
discrepancy check. Nothing manufactures a statute.

**The NL/US refusal reads correctly too.** The citation is *"Country not in the
9-country statutory notice table"* — a statement about **this table's** coverage,
not a claim that the Netherlands or the United States has no notice rules. Both
of course do (US notice is contractual and state-level; NL has statutory notice
in Book 7 of the Burgerlijk Wetboek). The refusal does not deny that.

### UC-06 — Contract amendment / payroll cutoff 🟡

**The carrier's employment *type* matters more than its country here**, and
discovering that cost a full run. UC-06 validates a complete next-state payload
against the country's contract-amendment form, sourcing each required field from
the employment's own `contract_details`. Live, that block is **rich on
`global_payroll_employee` records (23–28 keys)** and **thin on `employee` (EOR)
and `contractor` records (2–6 keys)**. See §6.5.

| ID | Country | Carrier | Effective | Host | Expected | **Observed** |
|---|---|---|---|---|---|---|
> **UC-06's demonstrable countries are NL and CA — two of the four, promoted into
> the register on 2026-08-21 as DRIFT-101 (`[A-5]` `[A-6]`).** The rows below have
> carried this as ⚠️ DIFF observations since 2026-08-19, which is the matrix doing
> exactly its job; what had never happened is that any acceptance criterion said
> so. Live, `GET /v1/contract-amendments/schema` answers **200 for NL, PT and CA**
> and **500 for the USA on both employment models** (every `contractor` 404s, so
> UC-06 does not apply to contractors at all). And of the three with a form, only
> **NL and CA** reach `dual_approval_required`: every PT record answers
> `schema_invalid`.
>
> **Decided: the US stays in the set as a labelled refusal rather than being
> dropped** — a refusal that names its cause is a legitimate demo beat, and
> dropping it would hide a real Sandbox limitation. PT is documented rather than
> seeded around; seeding a compliant PT record is roster work with no code in it.
>
> **And the NL/CA positive rows depend on the projected calendar** (§4.3), which
> is `[A-20]`'s clause: `STANDIN_PAYROLL_HORIZON_MONTHS=0` turns projection off and
> reproduces `no_matching_payroll_cycle` through the same URL. **Do not read that
> as the reason production never succeeds** — across 28 production `audit_log` rows
> UC-06 has never reached `dual_approval_required`, and only **1** refusal was
> `no_matching_payroll_cycle` against **9 of 26** `schema_invalid`. Production is
> stopped two gates earlier, by the employment roster. `[A-22]`

| **UC06-NL-1** | NL | full-time `global_payroll_employee` (`ce76d3ed…` Emma de Vries) | 2026-09-15 | stand-in | `dual_approval_required` | **`dual_approval_required` / `all_gates_passed`**, cycle `standin-nl-2026-09`, cutoff 2026-09-20 |
| UC06-NL-2 | NL | same | 2026-09-15 | **gateway** | `escalate` / `no_matching_payroll_cycle` | **`escalate` / `no_matching_payroll_cycle`** |
| **UC06-NL-3** | NL | same | 2026-06-15 | **gateway** | `escalate` / `ambiguous_payroll_cycle` | **`escalate` / `ambiguous_payroll_cycle`** — two real cycles, cutoffs 06-10 and 06-20 |
| UC06-NL-5 | NL | **part-time** `global_payroll_employee` (`293527ed…`) | 2026-09-15 | stand-in | `escalate` / `schema_invalid` | **`escalate` / `schema_invalid`**, flag `missing_default_weekly_hours` |
| UC06-NL-4 | NL | **EOR employee** (`673a1884…`) | 2026-09-15 | stand-in | `escalate` / `schema_invalid` | **`escalate` / `schema_invalid`**, 4 missing fields |
| UC06-CA-1 | CA | `global_payroll_employee` | 2026-09-15 | gateway | `escalate` / `no_matching_payroll_cycle` | **`escalate` / `no_matching_payroll_cycle`** |
| UC06-CA-2 | CA | same | **2026-06-20** | gateway | `escalate` / `cutoff_lock_passed` | **`escalate` / `cutoff_lock_passed`**, real cycle `1bdb5816…` (2026-06-15→06-30, cutoff 2026-06-20), `hoursUntilCutoff: -1440`, flags `retroactive_change` |
| **UC06-CA-3** | CA | same | 2026-09-20 | stand-in | `dual_approval_required` | **`dual_approval_required` / `all_gates_passed`**, cycle `standin-ca-2026-09` |
| UC06-PT-1 ⚠️ DIFF | PT | EOR employee (only type available) | 2026-09-15 | gateway | `escalate` / `no_matching_payroll_cycle` | **`escalate` / `schema_invalid`** — see §6.5 |
| UC06-PT-2 ⚠️ DIFF | PT | same | 2026-09-15 | stand-in | `escalate` / `no_matching_payroll_cycle` | **`escalate` / `schema_invalid`** |
| UC06-US-1 ⚠️ DIFF | US | EOR employee | 2026-09-15 | gateway | `escalate` / `no_matching_payroll_cycle` | **`escalate` / `country_schema_unavailable`** — see §6.6 |
| UC06-US-2 ⚠️ DIFF | US | same | 2026-06-20 | gateway | `escalate` / `cutoff_lock_passed` | **`escalate` / `country_schema_unavailable`** |
| UC06-US-3 ⚠️ DIFF | US | `global_payroll_employee` (`e818418e…`) | 2026-09-20 | stand-in | `dual_approval_required` | **`escalate` / `country_schema_unavailable`** |

### UC-07 — Permanent relocation 🔴 (no execution path)

A 🔴 use case cannot "succeed". The positive test is that the dossier reaching
the escalation is **complete** — facts populated, not null.

> **[AMENDED 2026-08-21 — ninth decision pass]** Two things change what these
> rows will demonstrate once the decided work is built, and both are worth knowing
> before reading the observed column as final.
>
> **1. Every fact below is currently one the requester typed.** UC-07 makes
> **zero Remote API calls on any path** — `destinationSupported`,
> `rightToWorkConfirmed`, `taxTreatyNexusConfirmed` and
> `employerPresenceInDestination` are checkboxes on the requester's own form, not
> answers from Remote (DRIFT-032). "Facts populated, not null" is therefore
> currently a test that the **form was filled in**. Once `R-1`…`R-7` land, the
> availability and entity facts come from Remote and the conflict check runs, and
> these rows measure something different and stronger.
>
> **2. The Zendesk-originated rows will stop being `BLOCK`.** All seven live
> production dossiers are `BLOCK` with uncertainty pinned at `1`, from an **empty
> plan** — nine findings about the absence of a plan, wearing the vocabulary of
> findings about the plan. After `R-11` those become `NOT_ASSESSABLE`, which is a
> different answer and not a worse one (DRIFT-034).

| ID | Route | Expected | **Observed** | Dossier facts (observed) |
|---|---|---|---|---|
| **UC07-NLPT-1** | NL→PT | `escalate`, complete dossier | **`escalate`** | `verdict: PROCEED`, `feasible: true`, `sourceCountry: NL`, `destinationCountry: PT`, `flags: []`, `costEstimate.status: CALCULATED` |
| **UC07-USPT-1** | US→PT | `escalate`, complete dossier | **`escalate`** | `verdict: PROCEED`, `US → PT`, `flags: []`, cost `CALCULATED` |
| UC07-CANL-1 | CA→NL | `escalate`, dossier **flags** the gaps | **`escalate`** | `verdict: BLOCK`, `CA → NL`, cost `CALCULATED`, **4 populated flags**: `UC07_EMPLOYMENT_GAP` (HIGH), `UC07_DUPLICATE_FEE_RISK` (MEDIUM), `UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED` (HIGH), `UC07_IMMIGRATION_REQUIRED` (MEDIUM) |

All three resolve **both** countries. `src/uc07/relocationParser.js`'s dictionary
contains NL, PT, CA and US.

### UC-08 — Cross-border tax & social security 🔴 (no execution path)

> **[2026-08-21 — what every row in this table has in common, and it is not in
> any column.]** Every presence figure below was computed from **travel dates
> typed into the scenario**, not read from Remote. That is honest for a scenario
> matrix and it is also the whole of UC-08's demo: **this is the one use case of
> the nine that makes no Remote API call on any path.**
>
> Remote publishes the facts. `GET /v1/travel-letter-requests` and
> `GET /v1/work-authorization-requests` are filterable by `employment_id` and
> carry `destination_country`, `travel_date_start`, `travel_date_end` and
> `status` — dated, located, employer-approved, and produced by UC-03 and UC-04,
> two use cases in this same table. **Both collections answered `200` with
> `total_count: 0`** on the live Sandbox at last capture
> (`test/fixtures/sandboxCapture.js`), which is why wiring the read is not by
> itself a demo: a correct read of the right endpoint returning nothing is a gate
> that cannot fire, and §6 of this document exists because that shape has cost
> this repository three separate defects.
>
> Decided, not built: read behind a read-only façade, with the count's
> **provenance** stated in the same sentence as the number, and a **marked**
> capture fallback so a Sandbox reseed cannot kill a live demo.
> `qa/contracts/UC-08-acceptance.md` §0.1, DRIFT-106/DRIFT-107, `T-1`…`T-4`.
> **`M-1` re-measures the emptiness before any of it is built.**

| ID | Pair | Presence input | Expected | **Observed** |
|---|---|---|---|---|
| UC08-NLPT-1 | NL→PT | PT 120 + 69 days, window 2026 | `escalate`, dossier complete | **`escalate`**, `dual_residency`, **189 days**, 2 periods, cite `oecd-model-art-4`, disclaimer present, `jurisdictions: ["PT"]` ⚠️ |
| UC08-NLPT-2 | NL→PT | PT 120 + 62 days | `escalate` | **`escalate`**, **182 days** — just under the 183 line, same citation |
| UC08-USNL-1 | US→NL | NL 151 + 48 days | `escalate` | **`escalate`**, `dual_residency`, **199 days**, `jurisdictions: ["US"]` ⚠️ |
| UC08-USPT-1 | US→PT | PT 120 + 62 days | `escalate` | **`escalate`**, `withholding`, **182 days**, `jurisdictions: ["PT","US"]` ✅ both resolved |
| UC08-CANL-1 | CA→NL | NL 273 days | `escalate` | **`escalate`**, `totalization`, 273 days, cite `totalization-general`, **`jurisdictions: []`** ⚠️ — see §6.7 |
| UC08-PT-1 | PT | **no presence data supplied** | `escalate` | **`escalate`**, `presenceDays: null` — an absence, never a manufactured 0 |
| UC08-US-CIT | US | US-citizenship question, PT 365 days | `escalate` | **`escalate`**, `withholding`, 365 days, cite `oecd-model-art-15`, **no citation or field mentions citizenship** — see §6.8 |

Both 183-day sides are verified: 189 over, 182 under, from real arithmetic over
merged (not summed) periods.

### UC-09 — Off-cycle payroll adjustment 🔴-framed, with a real execution path

| ID | Country | Adjustment | Expected | **Observed** | Slots | Flags |
|---|---|---|---|---|---|---|
| **UC09-NL-1** | NL | bonus EUR 5,000 | `dual_approval_required` | **`dual_approval_required` / `standard_adjustment_needs_dual_approval`** | **2** | `sensitive_type_bonus` |
| UC09-PT-2 | PT | bonus EUR 1,000 | `dual_approval_required` | **`dual_approval_required`** | **2** | `sensitive_type_bonus` |
| UC09-US-1 | US | bonus USD 7,500 | `dual_approval_required` | **`dual_approval_required`** | **2** | `sensitive_type_bonus` |
| UC09-CA-1 | CA | bonus CAD 25,000 (**amount** dimension) | `triple_approval_required` | **`triple_approval_required` / `high_risk_adjustment_needs_triple_approval`** | **3** | `high_amount_risk`, `sensitive_type_bonus` |
| UC09-US-2 | US | bonus USD 40,000 (**amount** dimension) | `triple_approval_required` | **`triple_approval_required`** | **3** | `high_amount_risk`, `sensitive_type_bonus` |
| UC09-PT-1 | PT | commission EUR 2,000, `taxAdjustment: true` | `triple_approval_required` | **`triple_approval_required`** | **3** | `manual_tax_adjustment`, `sensitive_type_commission` |
| UC09-NL-2 | NL | bonus with a **quoted** amount `"500000"` | `escalate` / `unparseable_amount` | **`escalate` / `unparseable_amount`** | 0 | `invalid_structure`, `invalid_amount`, `amount_not_an_integer` |

The floor of 2 held on every row that reached an approval path — `Math.max(2,
…)` in `src/uc09/multiApprovalPolicy.js`. The jurisdiction dimension reported
`triggered: false` with `observedCountryCode: "NL"` and the note *"a country's
absence from this list carries no finding at all"*, which is the correct
handling of an unsourced heuristic.

---

## 4. Edge cases — the ones the awkward set was chosen for

### 4.1 UC-06 on PT — no payroll calendar exists

`GET /v1/payroll-runs` was walked live: 17 distinct cycles across **SG, FR, CA,
NL and US only**. Portugal has none, on either host. But UC-06 never reaches the
payroll gate for a PT employment, because PT's schema gate refuses first (§4.4).
So the *actionable* reason a specialist sees for a PT amendment is
`schema_invalid` with `missing_role_description`, `missing_experience_level`,
`missing_contract_duration_type`, `missing_work_schedule`,
`missing_work_hours_per_week` — five named fields, each of which a requester or
an ops person could actually supply. That is a legible refusal, not a confusing
one; it just is not the refusal that was predicted. The calendar gap is real and
sits behind it.

### 4.2 UC-06 on CA — both refusals, on 100% real data. Verified, both directions

- Future date (2026-09-15) → **`no_matching_payroll_cycle`**, `cycle: null`.
- June date (2026-06-20) → **`cutoff_lock_passed`** naming the **real** cycle
  `1bdb5816-9a7c-46bf-b9ae-09fb6b6e2509` (`processing`, 2026-06-15→2026-06-30,
  cutoff 2026-06-20, payout 2026-06-30, approval 2026-06-25), with
  `hoursUntilCutoff: -1440` and the extra flag `retroactive_change`.

Both are Sandbox data with nothing projected.

### 4.3 UC-06 on NL — **the positive test passes.** It is the only country where it does, on the Sandbox's own calendar shape

`UC06-NL-1` reached **`dual_approval_required` / `all_gates_passed`** against
the projected cycle `standin-nl-2026-09` (cutoff 2026-09-20,
`hoursUntilCutoff` positive). The projection is honest by construction: the
cycle id begins `standin-`, it carries
`_standin: {projected: true, derivedFrom: <the real NL cycle>, cadence: "…measured
from that country's last real cycle"}`, and `total_payroll_cost` /
`approval_date` stay `null` because inventing money is forbidden outright.

**And a fact worth stating plainly, because it nearly became a false negative:**
against the *raw gateway*, NL cannot succeed either. The last real NL cycle ends
2026-07-31 and today is 2026-08-19, so **no real cycle in the Sandbox covers any
future effective date, for any country.** UC-06's approvable path is reachable
only through the stand-in's projection, for NL and CA alike. That is not a defect
in UC-06 — the gate is correctly refusing an amendment for a payroll period that
does not exist — but it means *the demo's UC-06 success beat depends on the
stand-in*, and saying otherwise would be an overstatement.

### 4.4 UC-04 NL→PT — the DNV suppression is **stated**, not silent. Verified

`UC04-NLPT-1` returned `ready_for_approval` with `basis.measurements` carrying a
`schengen_90_180` row whose **`state` is `"suppressed"`** — deliberately neither
`"within_limit"` nor `"passed"` — with `measured: null`, `headroom: null`, and
this note, read verbatim off the live result:

> *"PT is inside the Schengen area, so the 90-days-in-180 allowance WOULD govern
> this trip — and it was NOT applied. The check was skipped because this
> destination is treated as running a formal digital-nomad-visa scheme, which is
> assumed to sit outside the short-stay allowance. **No day count was taken, so
> nothing here says the employee is within the limit; the limit was excused,
> which is a different fact.**"*

and its provenance block, also verbatim:

```json
{ "table": "DNV_COUNTRIES", "status": "[PROPOSED] — illustrative, no authority",
  "authority": null, "version": null, "reviewedOn": null,
  "detail": "A curated five-entry list carried in src/uc04/riskMatrix.js. No publishing
             authority, no version, no review date, and no record of the income or
             duration thresholds each scheme actually imposes.",
  "reference": "docs/KNOWLEDGE-SOURCES.md L1-07" }
```

**An excused check does not look like a passed one.** Confirmed by contrast in
the same run: `UC04-CANL-1` (destination NL, not in `DNV_COUNTRIES`) produced
`state: "within_limit"` and `UC04-CANL-2` produced `state: "breached"`. Three
distinct states, three distinct meanings.

**And the suppression is destination-keyed, regardless of origin.** `UC04-USPT-1`
(US national, same destination) produced a byte-identical note. Worth stating in
the matrix explicitly, because a reader could reasonably assume a nomad-visa
exemption depends on the traveller's passport; here it does not.

### 4.5 UC-04 CA→NL and US→NL — non-Schengen nationals entering Schengen

A genuinely different branch from NL→PT: the 90/180 rule **is** applied. Clean
trip → `within_limit`, `ready_for_approval`, risk `low`. With 85 prior Schengen
days in the trailing 180 → `breached`, **`blocked` / `schengen_90_180_exceeded`**.

**CA and US behave identically**, as predicted in the scope change: same
decision, same reason, same risk level, same measurement state, from identical
inputs. The US adds no branch here. What it *does* add is the set's most legible
pair of refusals (§4.6), which the twin rule for Canada also produces but which
nobody will mistake for anything else when the destination is the US.

### 4.6 UC-04 NL→US — the three-way visa test, and the critical positive

| Visa stated | Observed | Deciding finding (verbatim) |
|---|---|---|
| `esta_usa` | **`blocked` / `visitor_visa_active_work_forbidden`** | *"The document TYPE stated — 'esta_usa' — does not permit working at this destination, so the request cannot be granted as worded whatever document is later produced. No document was read; this is a finding about the stated type alone."* |
| `business_visa` | **`blocked` / `us_requires_work_permit`** | same sentence with `'business_visa'` |
| `work_permit` | **`ready_for_approval` / `all_gates_passed`**, risk `low` | no immigration finding — the dimension is not the deciding one |

The third row is the one that matters: without it, a gate that blocks everything
would be indistinguishable from a gate that blocks correctly. It does not fire on
a work permit.

The output does convey the distinction the source comment claims —
*"the difference between 'the request needs more review' and 'the request is
asking for something illegal as worded'"* — through the phrase **"cannot be
granted as worded whatever document is later produced"** and the decision
`blocked` (not `escalate`). One qualification: the finding text for `esta_usa`
and `business_visa` is otherwise word-for-word identical, so the "illegal as
worded" force is carried by the reason code and the decision, not by distinct
prose. `PT→CA` with a business visa produced the identical sentence, confirming
the twins really are twins.

### 4.7 UC-05 on CA — `basis: "customary"`, no manufactured statute. Verified

Observed on `UC05-CA-1`: `basis: "customary"`, `noticeDays: 14`,
`sourceCitation: "Common-law customary notice (no statutory employee minimum;
varies by province)"`. The system states the absence of a statutory minimum
inside the citation itself and labels the 14 days as customary. It does not
invent a statutory number. ✅

### 4.8 UC-05 on PT — real tenure brackets, both discrepancy directions

Both PT records have a `provisional_start_date` of 2023-06-26 → **37 months**
tenure at run time, so both land in the `>= 24 months` bracket (**60 days**).
`UC05-PT-1` (LWD 2026-11-30) → `later_than_statutory` → `prepared_for_signoff`;
`UC05-PT-2` (LWD 2026-09-01) → `earlier_than_statutory` → `escalate /
statutory_discrepancy`. Both sides of the discrepancy check verified.

**The under-2-year side of the bracket and the 15-day probation path are NOT
demonstrable on live data** — see §5.

**And PT is the only country UC-05 can be shown SUCCEEDING on from the request
portal**, which is why the portal's quick-fill row now leads with four
Portuguese scenarios (`uc05-pt-clean`, `-payout`, `-exact`,
`-under-two-years`). The arithmetic behind that sentence: the demo set is
NL · PT · CA · US, `src/uc05/noticePeriodTable.js` holds GB, IE, DE, PL, IN,
PH, MX, CA and PT, so the intersection is **PT and CA** — and of those two only
Portugal has a persona in `src/portal/personas.js`, because that roster mirrors
the project owner's own Sandbox and carries no Canadian record. NL and US are
correctly `unsupported_country` (§4.9), so on the portal every non-PT demo
country can only ever be shown refusing.

Observed through the real portal route on 2026-08-20, `prepared_for_signoff`
every one, figures read off the stored row rather than the panel:

| Quick-fill | Reading date | Tenure | Notice | Statutory end | Proposed | Payout |
|---|---|---|---|---|---|---|
| `uc05-pt-clean` | 2026-08-20 | 86 mo | **60 days** | 2026-10-19 | 2026-11-30 (`later_than_statutory`, 42) | **2 704.00 EUR** |
| `uc05-pt-payout` | 2026-08-20 | 86 mo | 60 days | 2026-10-19 | 2026-12-31 (`later_than_statutory`, 73) | **3 990.00 EUR** (17.5 days) |
| `uc05-pt-exact` | 2026-08-20 | 86 mo | 60 days | 2026-10-19 | 2026-10-19 (**`match`, 0**) | 2 496.00 EUR |
| `uc05-pt-under-two-years` | 2021-05-01 | 22 mo | **30 days** | 2021-05-31 | 2021-06-30 (`later_than_statutory`, 30) | 1 232.00 EUR |

The payout base is the caller's own accrued/used pair, because that is what the
portal form collects. When nothing is typed the workflow READS Remote instead,
and the field it reads is **`balance`** — the accrued-to-date remaining figure —
never `annual_balance`, which is `annual_entitlement − used` and a different,
larger number on the same record (`src/remote/leaveBalances.js`; 11.25 days
apart on the live row the mock fixture copies).

### 4.9 UC-05 on NL (and US) — `unsupported_country`, legibly

Verified verbatim above. The refusal names the table, not the country's legal
system, and `noticeEndDate` is `null` rather than a fabricated date.

### 4.10 UC-08 — 183 days, both sides

189 (over) and 182 (under) on NL→PT; 199 on US→NL; 182 on US→PT. All computed
from merged, not summed, periods (`presenceCalculator.js`'s union arithmetic).
`UC08-PT-1` with no presence data returned `presenceDays: null`, never `0`.

### 4.11 UC-03 — sanctioned blocks, supported resolves

A supported destination resolves (`auto_resolve`, four routes). A sanctioned one
blocks — **but only when the classifier resolves the destination at all**; see
§6.3, which is the more interesting half.

### 4.12 UC-09 — the floor of 2, and the third approver by the sourced route

Verified in both directions (§3). The third approver was demonstrated via the
**amount** threshold and the **`taxAdjustment`** request field, never via the
uncited `HIGH_TAX_COMPLEXITY_HEURISTIC` — none of NL/PT/CA/US is on it, and the
engine says so rather than treating absence as a clean bill of health.

---

## 5. What is NOT demonstrable on NL / PT / CA / US

1. **Nothing in `src/` models US states — or Canadian provinces.**
   Verified: `grep -rn "province_of_employment|province_of_residency|us_state|stateCode" src/`
   returns **zero** matches outside the mock server (which has none either).
   `NOTICE_PERIOD_TABLE`'s Canada entry says *"varies by province"* in its
   citation and then applies one national figure. Meanwhile the **live** CA
   `contract_details` block carries `province_of_employment: "QC"` and
   `province_of_residency: "QC"`, and the live CA contract-amendment schema has
   an `allOf` branch keyed on `province_of_residency` — so Remote's own data
   model has the concept and this codebase discards it.
   **Scope boundary of the demo:** US notice, US employment law and US/CA
   sub-national tax vary by state/province, and this system reasons at country
   granularity only. Every US and CA answer it gives is a country-level answer.
2. **UC-02 on Portugal — no expenses exist.** All 220 Sandbox expenses were
   walked; none belongs to a PT employment. Needed: file at least one pending PT
   expense.
3. **UC-02's `auto_approve` outside the US** — structurally impossible while
   `POLICY_CAP_CURRENCY` is `"USD"` and the corpus is single-currency. Needed:
   a per-currency cap corpus, which is real policy data this repo does not have
   and must not invent. The refusal is correct; it is simply not demonstrable as
   a success.
4. **UC-02's `auto_approve` a second time on the same expense.** It performs a
   real `PATCH`, so it is one-shot per expense. **As of this run there are ZERO
   remaining fresh USD pending expenses in the Sandbox that would auto-approve**
   — the verification consumed the last one. Before demoing, file a new pending
   USD expense under an internal-meals category below USD 500, or use the
   portal's existing "file this as a new claim" fresh-copy path
   (`src/remote/mockServer.js`'s `<id>~fresh-<token>`).
5. **UC-05's PT under-2-year bracket and its 15-day probation path.** Every
   active PT record starts 2023-06-26 (37 months) and none has a
   `probation_period_end_date` in the future. Needed: a PT employment onboarded
   within the last 24 months, and one still inside probation.

   **Half of this is now demonstrable off live data, and the distinction is
   worth keeping straight.** The request portal's `uc05-pt-under-two-years`
   quick-fill moves the READING DATE rather than the record: it evaluates João
   Silva as at 2021-05-01, a month before his second anniversary, and Portugal's
   30-day bracket answers instead of the 60-day one (tenure 22 months, statutory
   end 2021-05-31, `prepared_for_signoff`). Driven by
   `test/portalUc05Success.test.js`. That is the BRACKET demonstrated, not the
   Sandbox gap closed — the portal's Remote reads are the mock fixtures
   (`createInProcessFetch()`), and the live account still holds no PT record
   under two years and none inside probation. The **probation** path remains
   undemonstrable either way: `probation_period_end_date` is a field on the
   record, and no reading date can conjure one.
6. **UC-06 on Portugal** — no payroll calendar *and* no `global_payroll_employee`
   record. Needed: either. The stand-in cannot help: its projection continues an
   *observed* cadence, and PT has none to continue.
7. **UC-06 on the United States** — `GET /v1/contract-amendments/schema?…&country
   _code=USA` returns **500 Internal Server Error** live, and the alpha-2
   fallback `GET /v1/countries/US/…` returns 404 *"Country not found"* (the path
   wants alpha-3). Every US amendment therefore stops at
   `country_schema_unavailable`. Needed: an upstream fix, or a different country.
8. **UC-06's approvable path against the raw gateway, for any country.** The
   whole Sandbox calendar ends 2026-07-31. Needed: the stand-in's projection
   (which is what the live n8n graphs already use), or a reseeded calendar.
9. **UC-06 for part-time NL employees.** The NL form's `allOf` branch adds
   `default_weekly_hours` for a part-time `work_schedule`, and no live NL record
   carries that field. Reproduced at `UC06-NL-5`.
10. **UC-04 for any employment other than two.** Only `3537d9ee…` (CA
    contractor) and `2f7f8210…` (US employee) have stand-in enrichment profiles,
    so only those two carry `custom_fields.workation_permission`. Every other
    record — every NL and PT one — is `blocked / employer_permission_not_granted`
    before the risk matrix runs. Needed: NL and PT entries in `STANDIN_PROFILES`.
11. **UC-03's sanctions gate through the deterministic classifier.** Its
    `KNOWN_COUNTRIES` dictionary has 18 entries and none of the ten sanctioned
    codes. Needed: the LLM path, or a longer dictionary. See §6.3.
12. **UC-08's jurisdiction extraction for the Netherlands and Canada.** Neither
    is in `src/uc08/inquiryParser.js`'s 9-entry dictionary. See §6.7.
13. **Citizenship-based taxation.** `grep -rni "citizen" src/` matches only
    three lines, all of them comments recording that Remote's employment record
    carries no nationality/citizenship/passport field. The US taxes its citizens
    on worldwide income regardless of residence; UC-08's dossier says nothing
    about it. See §6.8.
14. **A real payroll write.** UC-06's write goes to `/v1/contract-amendments`;
    nothing in this run executed one, and no approval was submitted.
15. **The n8n execution path.** Everything here is the Node path. UC-04, UC-05
    and UC-06's graphs point at `your-sandbox-standin.vercel.app` on purpose
    (CLAUDE.md §6) and were not touched.

---

## 6. Gaps, defects and surprises found by running this

Nine rows ended with observed ≠ expected. Six more discrepancies were found
*during* the run and resolved by correcting the scenario (never `src/`); they are
recorded here too, because two of them are the most useful findings in the file.

### 6.1 ⚠️ UC-02: the cap corpus and Remote's category codes are two namespaces, and the currency makes it worse

*Predicted `auto_approve` on NL, observed `human_review / policy_cap_unknown`.*

Three separate things, all correct behaviour, compounding:
- `POLICY_CAPS` covers **8** of the **36** selectable categories the live account
  returns. Anything else is `policy_cap_unknown` — the deliberate F-12
  fail-closed contract, documented in `policyCaps.js` as *"that gap IS the
  design"*.
- The classifier maps expenses to plausible-but-uncapped leaves. "New Monitor"
  → `tech_and_work_equipment.equipment_shipping_and_customs`; "Utilities" →
  `home_office_and_co_working.utilities`. Neither is in the corpus.
- `POLICY_CAP_CURRENCY` is `"USD"`, so even a *capped* category refuses to
  compare against a EUR or CAD figure (`policy_cap_currency_mismatch`).

**Net effect: UC-02 cannot auto-approve anything outside the United States.**
Not a bug — but it is a structural fact that a demo built on NL/PT/CA alone would
have hidden behind a wall of correct-looking refusals.

**Also worth recording:** CLAUDE.md's standing issue *"UC-02 cannot validate an
expense category live — the token 403s on `/v1/employee/expense-categories`"* is
**stale**. The client now calls `GET /v1/expenses/categories?employment_id=…`,
which returned **36 categories, HTTP 200** in this run. The 403 endpoint is no
longer on the code path.

### 6.2 ⚠️ UC-02's live success is destructive, and it consumed the demo asset

`auto_approve` fires a real `PATCH /v1/expenses/:id`. The verification run
approved **three** Sandbox expenses (`ae93eeeb…` Team Lunch, `d2c4246c…` Team
Building, `5949669c…` Team Building) and there are now **no fresh USD candidates
left**. This is correct behaviour — `UC02-US-1b` proves the second submission is
properly refused as `expense_not_pending` — but it means the demo asset must be
recreated. **Restock attempted 2026-08-19 and refused by the API** — a company
token cannot create a pending expense at all, so this beat is not replenishable;
see the restock-pass addendum under §3's UC-02 table and
`scripts/seed-uc02-demo-expenses.mjs`.

### 6.3 ⚠️ UC-03's sanctions gate is unreachable through the deterministic classifier

*Predicted `destination_jurisdiction_excluded`, observed `destination_unknown`.*

`SANCTIONED_OR_RESTRICTED` holds ten codes (CU IR KP SY RU BY MM VE AF IQ).
`src/uc03/classifier.js`'s `KNOWN_COUNTRIES` holds eighteen — **and none of the
ten is among them**. So on the rule-based fallback path, a request naming Iran
resolves to no destination at all and the gate that would have said "sanctioned"
is never reached. The run still escalates (`destination_unknown`), so it fails
closed — but the recorded reason is *"we could not tell where you are going"*
when the truth is *"that destination is restricted"*. **Same defect class this
repo has already paid for twice**: a control that fails closed only by accident
of a later gate, and a reason string nobody can act on.

Proven by contrast in the same run: `UC03-CA-2`, identical text with a classifier
that resolves `IR`, returned **`escalate / sanctioned_region`**. The *gate* is
fine; the *dictionary in front of it* is what makes the gate dead on the fallback
path. Not fixed here — reported, per the brief.

### 6.4 ⚠️ UC-04 is blocked for every Sandbox employment except two

*Predicted `ready_for_approval` on a real NL record, observed `blocked /
employer_permission_not_granted`.*

`src/uc04/policyEngine.js` refuses unless
`employment.custom_fields.workation_permission === true`. The raw Sandbox
returns **no `custom_fields` key for any employment**, and
`src/remotebridge/enrichment.js`'s `STANDIN_PROFILES` supplies it for exactly
**two** ids — Alex Morgan (US) and Alexandre Tremblay (CA). Every NL and PT
employment gets `profileFound: false` and stops at the permission gate.

Confirmed live on the stand-in for `673a1884…`:
`_standin: {"enriched": [], "stillEmpty": ["basic_information.start_date",
"address_details","custom_fields"], "profileFound": false}`.

This is the reason every UC-04 row in §3 names a carrier. **The branches are all
real and all verified** — the carrier only supplies the permission flag; the
origin, nationality, destination and visa are request inputs. But a demo that
opens a UC-04 request against a Netherlands employee will show a blocked
permission gate and nothing else. **Fix is two entries in `STANDIN_PROFILES`**;
not made here, per the brief.

### 6.5 ⚠️ UC-06's schema gate depends on employment **type**, not country — and this nearly produced a false major finding

*Predicted `no_matching_payroll_cycle` on NL and PT, observed `schema_invalid`
for both — until the carrier was changed.*

The first two runs used EOR `employee` records for NL and PT and concluded
"UC-06 cannot succeed on NL." That conclusion was **wrong**, and only the
positive-test rule caught it. Live measurement across ten records:

| Type | `contract_details` keys | `role_description` / `work_schedule` / `work_hours_per_week` / `contract_duration_type` |
|---|---|---|
| `global_payroll_employee` (NL, CA) | 23–28 | all present |
| `employee` (EOR — NL, PT, US) | 4–6 | all absent |
| `contractor` (PT, CA) | 2 | all absent |

UC-06 sources each required field from `contract_details`, so an EOR or
contractor record can never satisfy a contract-amendment form. Re-targeted at a
**full-time NL `global_payroll_employee`**, `UC06-NL-1` reached
**`dual_approval_required` / `all_gates_passed`** and `UC06-NL-3` reached the
unique **`ambiguous_payroll_cycle`**.

Two real, narrower findings survive:
- **PT has no `global_payroll_employee` record at all** (all four active PT
  employments are `employee` or `contractor`), so PT genuinely cannot pass the
  schema gate — for a reason that has nothing to do with its missing calendar.
- **A part-time NL `global_payroll_employee` also fails**, on
  `missing_default_weekly_hours`: the NL form's `allOf` branch requires it for
  `work_schedule: part_time`, and no live NL record carries the field
  (`UC06-NL-5`).

**Methodological note, and the reason this section is long:** "UC-06 fails on the
Netherlands" and "UC-06 fails on EOR employees" are different claims, only the
second is true, and the first is what three consecutive runs reported. A single
positive test forced the correction.

### 6.6 ⚠️ UC-06 on the US: an upstream 500 that reads as a policy refusal

*Predicted two refusals and one success, observed `country_schema_unavailable`
for all three.*

Live: `GET /v1/contract-amendments/schema?employment_id=2f7f8210…&country_code=USA`
→ **500 "Internal Server Error"**. The fallback `getCountrySchema("US")` →
**404 "Country not found"** (that path wants alpha-3, and the normalizer
correctly yields alpha-2). Flags: `country_schema_unavailable`,
`upstream_country_schema_error`.

Credit where due: this is **exactly** what `src/shared/upstreamFailure.js` was
built for — the reason names the upstream, not a policy. But it means UC-06 is
undemonstrable on the largest country in the account, and the failure is silent
in the sense that it looks like a cautious gate unless you read the flag.

### 6.7 ⚠️ UC-08 drops the Netherlands and Canada from its jurisdiction list

`src/uc08/inquiryParser.js`'s `KNOWN_COUNTRIES` has nine entries: germany, spain,
portugal, nigeria, united kingdom, uk, united states, usa, france. **Neither
`netherlands` nor `canada` is present.** Observed consequences on real inputs:

- `UC08-USNL-1`, a dual-residency question naming both the United States and the
  Netherlands: `jurisdictions: ["US"]`.
- `UC08-CANL-1`, a totalization question naming Canada and the Netherlands:
  **`jurisdictions: []`** — a 🔴 tax dossier reaching a specialist naming **zero**
  jurisdictions, while confidently reporting 273 presence days and citing
  `totalization-general`.

The dossier does not *invent* a country (the file's header records that a bare
`de:` key once did exactly that), so this fails in the safe direction. But on a
use case where *the jurisdictions are the answer*, an empty list beside a
confident day count is a dossier a specialist could misread. `src/uc03` and
`src/uc07` both carry NL and CA in their dictionaries; UC-08 is the outlier.

> **[STILL OPEN after the 2026-08-21 decision pass, and named rather than
> quietly folded in.]** This is a dictionary gap in `KNOWN_COUNTRIES`, not one of
> the seven findings that pass dispositioned, and it is **not** in the `T-1`…`T-28`
> queue. Two of that pass's decisions bear on it and neither closes it: the
> `T-2` Remote read would supply the **subject** country structurally, from
> `destination_country` on a real record, so a count would stop depending on the
> dictionary — but `jurisdictions` is extracted from the request **text** and
> would still come back empty; and invariant 8 (*a day count is never printed in
> the shape of an answer without its jurisdiction*) is the guard that keeps this
> failing safely today. **Add NL and CA to the dictionary regardless** — it is a
> two-line change with a test, and it should not wait on a queue it is not in.

### 6.8 ⚠️ UC-08 says nothing about citizenship-based taxation

Probed with a text that states it outright: *"Our employee is a US citizen living
full-time in Portugal. The US taxes its citizens on worldwide income regardless
of residence…"*. Observed: `withholding`, 365 presence days, one citation
(`oecd-model-art-15` — the 183-day rule), `jurisdictions: ["PT"]`. **No field,
flag or citation in the dossier mentions citizenship.** `grep -rni "citizen" src/`
matches three lines, all comments noting that Remote's record carries no
nationality/citizenship field.

Recorded as a **silence, not a handled case**, per the brief. The 183-day frame
the dossier applies is a residence test, and for a US person it is not the only
test that matters.

### 6.9 ⚠️ UC-09's `riskBasis` is on the audit row, not on the response

`handleAdjustmentRequest()` returns `decision, reason, flags, adjustmentId,
adjustmentType, summary, faithfulness, approvalSlotsRequired, approvalPathOpen,
amountEstablished` — no `riskBasis`. It *is* written to the audit row and read by
`src/uc09/approvalView.js`. So the intake surface reporting the outcome cannot
show the jurisdiction dimension's "absence is not a finding" note, while UC-04
and UC-06 both return a `basis` block on the response for exactly that purpose.
An asymmetry, not a defect.

### 6.10 Predictions corrected during the run (my error, not the code's)

Recorded for transparency, since the run counts in §3 reflect the corrected
predictions:

| What I predicted | What it actually is |
|---|---|
| UC-09 3-slot decision string `dual_approval_required` | **`triple_approval_required`** |
| UC-09 quoted-amount reason `invalid_adjustment_structure` | **`unparseable_amount`** |
| UC-03 sanctions reason `destination_jurisdiction_excluded` | **`sanctioned_region`** (the other name belongs to the registry-membership gate) |
| UC-04 Schengen breach → `escalate` | **`blocked`** — `riskLevel: "blocked"` routes to `blocked`, not `escalate` |
| UC-04 `tourist_visa` into Canada → `ca_requires_work_permit` | **`visitor_visa_active_work_forbidden`** — the visitor-visa gate fires first; use `business_visa` to reach the work-permit twin |
| UC-01 "letter confirming my engagement" → `auto_resolve` | **`non_standard_request`** — the deterministic fallback recognises four literal phrases (`standard`, `proof of employment`, `employment letter`, `verification letter`). Kept as `UC01-US-2`, because a demo script must use wording the fallback recognises if the LLM is unavailable |

### 6.11 Stale entries in `CLAUDE.md` confirmed by this run

Not edited (that file is out of scope for this task), but worth folding in:

- **§7 Stage 3.5 issue 1** — *"UC-02 cannot validate an expense category live;
  the token 403s"* — **stale**. `GET /v1/expenses/categories?employment_id=…`
  returned 36 categories, HTTP 200.
- **§6's stand-in note** — *"UC-05 needs `basic_information.start_date`; the raw
  Sandbox returns `undefined`"* — **stale for UC-05's purposes**.
  `normalizeEmployment()` now falls back to the top-level
  `provisional_start_date`, which the gateway does return, and all seven UC-05
  scenarios ran successfully against the raw gateway with correct tenure.
  UC-04's `custom_fields` need is unchanged and still real (§6.4).

---

## 7. Reproducing this

```bash
# whole matrix (77 scenarios; ~3 min; touches the live Sandbox)
NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs

# one use case
NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs --only UC06

# machine-readable, with per-use-case detail (notice brackets, cutoff cycles,
# Schengen measurement states, dossier facts, approval slots)
NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs --json out.json
```

Requires `REMOTE_API_TOKEN` in `.env`. `NODE_USE_ENV_PROXY=1` is mandatory in
this container (CLAUDE.md §6: Node's global `fetch` ignores `HTTPS_PROXY`).

**Two rows will not reproduce as written**: `UC02-US-1` (its expense is now
approved — file a fresh one) and any UC-06 stand-in row once the projection
horizon moves past the effective dates chosen here.

---

## 8. UC-04's day arithmetic, exercised — travel-history scenarios

**Why this section exists.** The project owner drove a real UC-04 request and
got `blocked / travel_history_unreadable`, and said: *"I thought we worked on
everybody having travel history, whether it is 0 or the required variations of
days, so that we can easily demo what this system is supposed to do under
several circumstances."* They were right, and the gap was wider than the form.

UC-04's substance **is** the day counting — the Schengen 90/180 peak measured
per day of stay, the 183-in-365 tax-residency watch, the union-not-sum overlap
rule, and the refusal on a stay that cannot be read. Three of those four were
rewritten in commit `73920c9`. **§3's UC-04 rows demonstrate none of them, by
construction**: every date in them was deliberately chosen to be *insensitive*
to the change, so that the rewrite could be shown not to move an existing demo
figure. That was the right call for that commit and it leaves the new behaviour
undemonstrated. This section is the other half.

**Every figure below was computed by the functions under test**, in two layers,
and reported as observed:

- **Arithmetic** — `schengenPeakDays()` and `computeCumulativeDays()` called
  directly. Pure, offline, no employment record involved.
- **Decision** — the real `handleWorkationRequest()` against a **live Remote
  Sandbox employment** through the read-only stand-in, so the gates that sit in
  front of the arithmetic (identity, employment status, employer permission)
  really run.

Carrier: **Alexandre Tremblay `3537d9ee-2017-4a53-952e-9d3b042aeab5`**
(contractor, `active`), re-verified live against the raw gateway at the top of
the run. It is one of the two records the stand-in has an enrichment profile
for, which is what makes any UC-04 branch other than `blocked` reachable at all
(§6.4). **The origin country is an input** (`factors.homeCountry`), never the
carrier's own country, so the carrier makes a branch reachable and changes
nothing about which branch runs.

Run `2026-08-20`, `now = 2026-08-20`:

```bash
NODE_USE_ENV_PROXY=1 node scripts/uc04-travel-history-matrix.mjs
node scripts/uc04-travel-history-matrix.mjs --arithmetic-only   # no network, no credentials
```

### 8.1 The matrix — expected behaviour vs **observed**

All rows use `jobDuties: engineering`, `hasContractSigningAuthority: false`.
Schengen rows are CA→NL on `schengen_short_stay`; residency rows are GB→CA on
`work_permit` (a non-Schengen destination, so the 90/180 allowance never
governs and no Schengen row is produced at all).

| # | behaviour under test | trip | prior stays stated | **Schengen peak / 90** | **peak day, window** | **183/365 total** | **observed decision / reason** | risk | flags |
|---|---|---|---|---|---|---|---|---|---|
| **TH-00** | no prior stays — 0 over 0 is a **floor, not a count** | 2026-09-07→09-27, 21d | *none* | **21** (headroom 69) | 2026-09-27, `2026-04-01 → 2026-09-27` | 21 — **row omitted entirely** | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-01** | a real count that changes nothing | 21d | NL 2026-08-01→08-10 (10d) | **31** (headroom 59) | 2026-09-27, `2026-04-01 → 2026-09-27` | **31** of 183 | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-02** | **approaching** the allowance | 21d | NL 2026-05-01→07-06 (67d) | **88** (headroom **2**) | 2026-09-27, `2026-04-01 → 2026-09-27` | 88 of 183 | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-03** | **breaching** by the smallest margin | 21d | NL 2026-05-01→07-09 (70d) | **91** (over by **1**) | 2026-09-27, `2026-04-01 → 2026-09-27` | — | **`blocked` / `schengen_90_180_exceeded`** | `blocked` | `schengen_overstay` |
| **TH-04** | breaching with **no history at all** — the trip is itself days of stay | 2026-09-07→12-15, **100d** | *none* | **100** (over by 10) | 2026-12-15, `2026-06-19 → 2026-12-15` | — | **`blocked` / `schengen_90_180_exceeded`** | `blocked` | `schengen_overstay` |
| **TH-05** | **the per-day window mattering** — see §8.2 | 2026-09-01→10-30, 60d | NL 2026-03-06→05-04 (60d) | **61** (headroom 29) | **2026-09-01**, `2026-03-06 → 2026-09-01` | 120 of 183 | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-06** | **union, not sum** — and the difference decides | 2026-09-07→10-21, 45d | NL 2026-05-01→05-31 **and** NL 2026-05-10→06-10 (31+32 stated, **41 distinct**) | **86** (headroom 4) | 2026-10-21, `2026-04-25 → 2026-10-21` | 86 of 183 | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-07** | the 180-day boundary — a stay **inside** it counts | 21d | NL 2026-04-01→04-10 (10d) | **31** | 2026-09-27, `2026-04-01 → 2026-09-27` | 31 of 183 | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-08** | the same stay **ten days earlier** counts for nothing | 21d | NL 2026-03-22→03-31 (10d) | **21** | **2026-09-17**, `2026-03-22 → 2026-09-17` | **31** of 183 | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-09** | the 183 watch, measured and **not** fired | 21d | CA 2026-01-20→06-30 (162d) | *not governing (CA)* | — | **183** of 183, headroom **0** | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-10** | the 183 watch, **fired** | 21d | CA 2026-01-19→06-30 (163d) | *not governing (CA)* | — | **184** of 183, over by **1** | **`ready_for_approval` / `all_gates_passed`** | **`medium`** | `tax_residency_watch` |
| **TH-11** | an **unreadable** stay — blank end date | 21d | NL 2026-03-01→07-01 (123d) **+** NL 2026-05-01→`""` | `NOT_EVALUATED` | — | `NOT_EVALUATED` | **`blocked` / `travel_history_unreadable`** | `blocked` | `travel_history_unreadable` |
| **TH-12** | unreadable — dates the wrong way round | 21d | NL 2026-07-01→2026-03-01 | `NOT_EVALUATED` | — | `NOT_EVALUATED` | **`blocked` / `travel_history_unreadable`** | `blocked` | `travel_history_unreadable` |
| **TH-13** | unreadable — no country on the row | 21d | `""` 2026-03-01→07-01 | `NOT_EVALUATED` | — | `NOT_EVALUATED` | **`blocked` / `travel_history_unreadable`** | `blocked` | `travel_history_unreadable` |
| **TH-14** | a prior stay in a **different Schengen state** — counted for nothing (finding C-3) | 21d | **ES** 2026-05-01→07-19 (80d) | **21** | 2026-09-27, `2026-04-01 → 2026-09-27` | 21, **row omitted** (0 periods) | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |
| **TH-15 ⚠️** | the **same 80-day stay written as `"Netherlands"`** rather than `"NL"` | 21d | `Netherlands` 2026-05-01→07-19 | **21** | 2026-09-27, `2026-04-01 → 2026-09-27` | 21, **row omitted** (0 periods) | **`ready_for_approval` / `all_gates_passed`** | `low` | `[]` |

Named problem strings, verbatim, for the three refusals:

```
TH-11  prior stay 2: unreadable dates "2026-05-01" → ""
TH-12  prior stay 1: the stay ends (2026-03-01) before it starts (2026-07-01)
TH-13  prior stay 1: unreadable country ""
```

### 8.2 What `73920c9` actually changed, demonstrated rather than asserted

The commit's own message states the honest caveat that motivated most of this
section: *"for a history whose stays all end before the trip begins, the per-day
peak is never GREATER than the old single-window total, so this is a
RELAXATION."* The task that produced this section asked whether an input can
genuinely be found where the two computations **disagree on the verdict** — and
said plainly that "no such input exists" would itself be the finding. Two exist,
and they are different from each other.

The script vendors the pre-`73920c9` body of `computeCumulativeDays()` verbatim
from `git show 73920c9^:src/uc04/riskMatrix.js` — a summing counter, no interval
merge — plus the single trailing 180-day window anchored at the trip start, so
the "what the old arithmetic said" column is **computed by the old code**, not
remembered.

**TH-05 — the window change alone flips the verdict.**

| | window | prior days | + trip | total | verdict |
|---|---|---|---|---|---|
| pre-`73920c9`, per trip | `2026-03-05 → 2026-09-01` | 60 | 60 | **120 of 90** | **blocked** |
| art. 6(1), per day of stay | `2026-03-06 → 2026-09-01` | — | — | **peak 61 of 90** on 2026-09-01 | **cleared** |

A 60-day workation, refused by 59 days under arithmetic the regulation does not
describe. This is the commit's own worked example, re-derived end to end: the
observed decision is `ready_for_approval / all_gates_passed`, and the basis row
a specialist reads carries `measured: 61, headroom: 29, window 2026-03-06 →
2026-09-01`.

**TH-06 — the union change alone flips the verdict**, and it does so with
*both* windows, which is what makes it the cleaner of the two.

| | prior days | + trip | total | verdict |
|---|---|---|---|---|
| pre-`73920c9`, summed | 31 + 32 = **63** | 45 | **108 of 90** | **blocked** |
| today, union of distinct days | **41** | 45 | **86 of 90** | **cleared** |

Two stays that overlap by 22 days. The old code counted the overlap twice and
refused a compliant traveller; the peak window makes no difference here (the
start-anchored window gives 86 too), so this row isolates the union fix on its
own.

**TH-08 — the per-day scan is doing real work, and the reported window proves
it.** The peak falls on **2026-09-17, mid-trip**, over `2026-03-22 → 2026-09-17`
— not on the trip's last day, which is where every other Schengen row here
peaks. The prior stay is inside the window at the start of the trip and has
fallen out of it by the end, so the count plateaus and the *first* day reaching
the maximum is a day in the middle. A start-anchored window cannot produce that
row at all.

**TH-11 — the disguise, and what replaced it.** The pre-`73920c9` counter,
run on TH-11's input, returns **`NaN` prior days → `NaN` of 90 → `breached:
false`**: a 123-day stay plus one blank end date, silently clearing both
thresholds. Today the same input returns `status: NOT_EVALUATED`,
`days: null`, `periodsCounted: 0` and a named row, and `classifyRisk()` turns
that into a hard block. **The old and new outputs are both visible in the
script's TH-11 block**, one line apart.

**TH-00 — the floor.** No history at all is `COUNTED` at zero, not
`NOT_EVALUATED` — deliberately, because a workation request with no prior stays
is the ordinary case and refusing it would block every request anyone ever
files. The 183 row is then **omitted entirely** from the decision basis rather
than shown as "0 of 183", so a reader is never handed a manufactured half.
TH-14 and TH-15 produce the same omission for the opposite reason: stays were
stated, and none of them counted.

### 8.3 Three things that did not behave as their label claims

Kept, per this document's rule that a row disagreeing with its prediction is
the most valuable row in the table. **None was fixed** — `src/uc04/**` was
read-only for this pass, and the deployed n8n Code nodes currently verify as
`0 drifted`, which a change under `src/uc04/` would end until the graph is
republished.

**8.3.1 ~~⚠️ A blocked-for-unreadable-history decision still renders
`schengen_90_180: within_limit`.~~ CLOSED 2026-08-20.** The row now reports
`state: "not_assessed"`, `measured: null`, **`window: null`** and a note reading
*"Not measured, and therefore not cleared… there is no total here that is under
90, and none that is over it."* `not_assessed` was already a state the sidebar
knew and glossed — *"This check never ran, because an earlier gate decided
first. It has approved of nothing."* — so no new vocabulary was invented for it.
The fabricated window went too: `trailingWindow()` would compute a plausible
one, and a window nothing measured over is the same lie in a smaller font. Both
directions are pinned in `test/uc04TravelHistoryMatrix.test.js` §8.3.1,
including the contrast case, so the fix cannot be read as "always refuse".
**What follows is the finding as it stood**, because the mechanism is the point: TH-11, TH-12 and TH-13 each come back
`blocked / travel_history_unreadable` — correct — and the decision basis a
specialist reads on the sidebar carries, observed verbatim:

```json
{ "key": "schengen_90_180", "state": "within_limit", "measured": null,
  "window": { "from": "2026-03-11", "to": "2026-09-07", "spanDays": 180 },
  "note": "Within the limit. The measured total is not recorded on this row:
           this decision predates the matrix carrying its Schengen figure
           forward, so \"under 90\" is what is known, not by how much." }
```

Two things are wrong and they compound. The row **asserts compliance** about a
traveller whose day count was explicitly refused; and its explanation is
**false** — the decision does not predate anything, and the window it prints
was never measured over. The mechanism is in `src/uc04/decisionFacts.js`:
`state` is derived as `flags.includes("schengen_overstay") ? "breached" :
"within_limit"`, a binary with no third value for *not measured*, and the
`counted` branch below it falls back to the legacy "this row predates the fix"
prose whenever `risk.schengen` is null — which is now true for two different
reasons that mean opposite things. `travel_history_unreadable` is a
`NOT_EVALUATED` case wearing the costume of an old record, which is precisely
the rotation `73920c9`'s commit message describes one layer down. Reproduce
with any of TH-11/12/13.

**8.3.2 ~~⚠️ A country written as a name instead of a code is silently
dropped, and nothing anywhere says so.~~ CLOSED 2026-08-20, within the hour,
by the tripwire this section left behind.** `test/uc04TravelHistoryMatrix.js`
asserted the defect *as it behaved*, with the note "when this is fixed, this
line fails first" — and it did. `computeCumulativeDays()` now tests
**well-formedness** rather than non-emptiness (`isWellFormedCountryCode()`,
which had sat unused in `src/shared/countryCodes.js` one import away), so
TH-15 answers `blocked / travel_history_unreadable` naming the row, and the
count is refused rather than cleared. TH-14 is unchanged and still correct.
The n8n port carries the same guard. **What follows is the finding as it
stood**, kept because the mechanism recurs: TH-14 and TH-15 state the *same* 80-day stay;
TH-14 writes it `"ES"` and TH-15 writes it `"Netherlands"`. Both return
`periodsCounted: 0`, `days: 0` and an identical `ready_for_approval`. For TH-14
that is correct and documented (the count is per destination country, finding
C-3). For TH-15 the requester **named the destination itself** and their 80 days
in it vanished.

`travelHistoryProblems()` reports a row with unreadable *dates* or an *empty*
country, and `normalizeCountryCode()` only trims and upper-cases, so
`"Netherlands"` becomes `"NETHERLANDS"`, matches no destination, and is dropped
by the `continue` in `computeCumulativeDays()`'s loop. The file's own comment
states the rule this breaks: *"silently dropping a row is how a count that is
missing a period gets presented as a count."* `isWellFormedCountryCode()` lives
in the same `src/shared/countryCodes.js` the normaliser is imported from and is
not consulted here.

**It gets through the portal's front door too.** `buildTravelHistory()` in
`src/portal/server.js` accepts any non-empty country string
(`String(r.country).trim().toUpperCase()`), so `"Netherlands"` passes the intake
guard that exists specifically to stop an unreadable stay reaching this
arithmetic. A quick-fill that offers a free-text country box will produce this;
one that offers a two-letter code list will not.

**8.3.3 ⚠️ The portal's own result panel recomputes the Schengen figure with
the OLD window, so it can contradict the decision printed beside it.**
`describeTravelWindows()` in `src/portal/server.js` recomputes the row from a
single trailing 180 days anchored at the trip start — the computation
`73920c9` replaced — and its prose still says the per-day reading *"is an open
finding, not something this figure reflects."* On **TH-05** the two disagree
outright:

| | figure | source |
|---|---|---|
| the decision, and the sidebar's basis row | **61 of 90**, headroom 29 | `risk.schengen`, observed |
| the portal panel's own recomputation | **120 of 90** | `computeCumulativeDays()` over `2026-03-05 → 2026-09-01`, observed |

The panel's heading is read from `result.flags`, which is empty here, so the
row is titled **"Within the limit"** and then prints a total of 120 against a
limit of 90 — a negative headroom under a positive heading. *(The two figures
are observed; the rendering is read from the source of `describeTravelWindows()`,
not from a running portal.)* TH-06 does **not** show this — the panel's union
arithmetic already matches there — so TH-05 is the reproducing input.

### 8.4 Field values, for the quick-fills

The portal's UC-04 form ids are `uc04-employmentId`, `uc04-homeCountry`,
`uc04-destinationCountry`, `uc04-nationality`, `uc04-startDate`, `uc04-endDate`,
`uc04-visaType`, `uc04-jobDuties`, `uc04-hasContractSigningAuthority`
(`src/portal/uc03Continuation.js`). Prior stays are not yet on the page;
`BUILDERS.uc04`'s own header names the convention to add —
`uc04-h1-country` / `uc04-h1-startDate` / `uc04-h1-endDate`, and `h2` likewise,
sent as `travelHistory: [{country, startDate, endDate}, …]`, with untouched rows
dropped server-side.

Constant for every row below: `employmentId =
3537d9ee-2017-4a53-952e-9d3b042aeab5`, `jobDuties = engineering`,
`hasContractSigningAuthority = false`. **Every date is load-bearing** — the
figures in §8.1 move if any of them does, so copy them exactly rather than
adjusting them to look tidy.

| quick-fill | home | dest | nat | visa | start | end | h1 (country / start / end) | h2 |
|---|---|---|---|---|---|---|---|---|
| TH-00 no history | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | *(blank)* | *(blank)* |
| TH-01 counted, nothing flags | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-08-01 / 2026-08-10 | — |
| TH-02 approaching 90 | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-05-01 / 2026-07-06 | — |
| TH-03 breaching 90 | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-05-01 / 2026-07-09 | — |
| TH-04 breach, no history | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | **2026-12-15** | *(blank)* | — |
| TH-05 per-day window | CA | NL | CA | `schengen_short_stay` | **2026-09-01** | **2026-10-30** | NL / 2026-03-06 / 2026-05-04 | — |
| TH-06 overlap | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | **2026-10-21** | NL / 2026-05-01 / 2026-05-31 | NL / 2026-05-10 / 2026-06-10 |
| TH-07 boundary, inside | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-04-01 / 2026-04-10 | — |
| TH-08 boundary, outside | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-03-22 / 2026-03-31 | — |
| TH-09 183 exactly | GB | CA | GB | `work_permit` | 2026-09-07 | 2026-09-27 | CA / 2026-01-20 / 2026-06-30 | — |
| TH-10 183 exceeded | GB | CA | GB | `work_permit` | 2026-09-07 | 2026-09-27 | CA / **2026-01-19** / 2026-06-30 | — |
| TH-11 unreadable, blank end | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-03-01 / 2026-07-01 | NL / 2026-05-01 / *(leave end blank)* |
| TH-12 unreadable, reversed | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | NL / 2026-07-01 / 2026-03-01 | — |
| TH-13 unreadable, no country | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | *(blank)* / 2026-03-01 / 2026-07-01 | — |
| TH-14 other Schengen state | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | **ES** / 2026-05-01 / 2026-07-19 | — |
| TH-15 ⚠️ country as a name | CA | NL | CA | `schengen_short_stay` | 2026-09-07 | 2026-09-27 | **`Netherlands`** / 2026-05-01 / 2026-07-19 | — |

Four cautions for whoever builds these:

1. **TH-11's h2 is a partially-filled row, not an empty one.** `buildTravelHistory()`
   drops a row where country, start and end are *all* blank — that is how a
   form can render two always-present blocks safely. TH-11 needs the country
   and the start filled and the end left empty, or it becomes TH-01 with extra
   steps. TH-13's blank country refuses for the same reason only when its dates
   are filled.
2. **Through the portal, TH-11/12/13 stop one layer earlier than they do here,
   and the wording differs.** `buildTravelHistory()` refuses at intake with
   **HTTP 400 `travel_history_unreadable`** before `handleWorkationRequest()` is
   ever called, so the surface shows the portal's own strings — observed:
   `prior stay 2: end date missing`, `prior stay 1: the stay ends (2026-03-01)
   before it starts (2026-07-01)`, `prior stay 1: no country` — and no
   authorization row is created. The **`blocked / travel_history_unreadable`
   decision** in §8.1 is what the API and the n8n path produce, where nothing
   guards the arithmetic. Both are correct and they are defence in depth; a
   quick-fill labelled "shows the unreadable-history block" should say which of
   the two it is about to show.
3. **`now` matters.** Every start date here is in the future relative to
   `2026-08-20`. Past a start date, `classifyRisk()` adds `start_in_past` and
   the row becomes a `blocked` about something else entirely. When these dates
   age out, shift the whole set forward together — the *intervals between* the
   dates are what produce the figures, not the dates themselves.
4. **TH-15 passed the portal's intake guard too**, observed at the time:
   `buildTravelHistory()` returned `{country: "NETHERLANDS", …}` with an empty
   `unreadable` list. That was the whole of §8.3.2 — the guard that exists to
   stop an unreadable stay was not the guard that stops an unmatchable one.
   **Still true of the portal's own guard**, which is a separate function: it is
   now defence in depth rather than the only barrier, because the arithmetic
   refuses the row on its own. Worth closing there as well, since the portal's
   message names the field a requester must fix.

### 8.5 The standing guard

`test/uc04TravelHistoryMatrix.test.js` pins every arithmetic figure this
section publishes — hermetic, no network, the same standing-guard pattern
`73920c9` established for §3's rows in `test/uc04.test.js`. If a future change
to the window, the union rule or the refusal moves any number above, that test
fails before anyone films a demo against it.
