# UC-02 — Canonical Acceptance Contract

> **Expense & Receipt Validation · 🟢 Low tier · Remote-native webhook intake**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-02.md`,
> `docs/verification/uc02-expense-endpoints.md`,
> `src/uc02/{policyEngine,workflow,reviewPolicy,expenseStore,expenseClassifier,policyCaps,server}.js`,
> `workflows/nodes-uc02/*.js`, `zaf-app/assets/panels.js`, `src/portal/`,
> `test/uc02*.test.js`, `test/n8nUc02Parity.test.js`.
>
> **Intended business truth.** Divergences from the implementation are in §17.
> No code or test was changed to produce this.
>
> **Updated 2026-08-21 to the DECIDED target.** §4–§16 below now describe what
> UC-02 is supposed to do once the five dispositions in §17 are built, not what
> it does today. Every sentence that is not yet true carries its change tag —
> **`[E-1]`**, **`[E-2]`**, **`[E-3]`** — so a reader can tell a description from
> a promise at a glance. **§18 is the ordered build queue**: what to build, in
> what order, which files, and how each step is known to be done.

---

> ## Decisions — 2026-08-21. UC-02 is now decided
>
> Five findings carried a disposition from the owner (`DRIFT-006`…`DRIFT-010`).
> **Two new findings were opened by the decisions themselves** — `DRIFT-087` and
> `DRIFT-088`, both in §17b — and neither came from reading more code. One came
> from taking the owner's worry about DRIFT-010 seriously enough to trace what
> the change would actually do; the other came from reading **Remote's own
> expenses documentation** in order to honour DRIFT-007's disposition, and found
> a second gate in the same condition DRIFT-006 exists to memorialise.
>
> **The dispositions are written into the findings, never over them.** Same rule
> as UC-01's fourth pass and UC-03's third. Nothing is deleted. A resolved
> finding that vanishes comes back: a later reader re-derives the disagreement,
> re-argues it, and often decides it the other way.
>
> | State | Means |
> |---|---|
> | `DECIDED · NOTHING TO BUILD` | Chosen, and the code **and the spec** already agree. The entry survives as a scar, not a wound |
> | `DECIDED · NOT YET BUILT` | Chosen, and the code still does the old thing. **The drift is still real** — a decision does not close a finding |
> | `OPEN` | Nobody has chosen |
>
> **`DECIDED · NOTHING TO BUILD` is a state UC-01 did not need, and it exists
> because of the question the owner asked about DRIFT-009** — *"why should I
> keep_current?"* UC-01's one closed finding (DRIFT-001) was closed **by that
> pass**, which deleted a stale paragraph. UC-02's two `KEEP_CURRENT` findings
> were closed **months ago, by the commits that fixed them**. Both read as "no
> action", and they are not the same thing: one is work done now, the other is a
> record of work already done. Collapsing them is how a fixed gap gets
> re-investigated by every fresh session — which `CLAUDE.md` §5 records happening
> to UC-01's §12.7 for weeks.
>
> ### The three behaviour changes, named separately
>
> UC-02's changes are prefixed **`E-`** (`E-1`…`E-3`). UC-01's are numbered
> (`G-1`…`G-4`) and UC-03's are lettered (`G-A`…`G-C`). Three schemes, no
> overlap, on purpose: this repository already carries two registers that both
> number their findings `C-N` with code citing both, and `CLAUDE.md` §7 item 20
> records a reader landing in the wrong one.
>
> Each of these changes **what the system decides**, not only what it says. Each
> therefore needs the gate in `src/uc02/policyEngine.js`, the matching edit to the
> n8n port `workflows/nodes-uc02/expenseGates.js`, `test/n8nUc02Parity.test.js`
> green across both, and then a **republish** of graph `WORKFLOW_UC02_ID`. A gate
> changed in one of the two places is a gate that disagrees with itself.
>
> | # | Change | From | To | Source |
> |---|---|---|---|---|
> | **E-1** | **The receipt is read, not merely counted** | The receipt row's *existence* is checked; the file is never fetched and never opened. The control is "a receipt row exists", not "the receipt supports the claim" | The bytes are fetched from Remote and a vision pass extracts vendor, date, currency and totals — used **only to corroborate figures Remote already holds**. It can refuse; it can never supply a number that reaches the write | DRIFT-007 |
> | **E-2** | **The cap names its author** | A claim is refused as "over policy" against a table this project wrote, and the refusal reads to an employee as Remote's policy | Every cap cited to a human carries its provenance, and it is named as the **employer's** policy — because Remote's API and Remote's expense documentation contain no policy, cap or limit concept at all | DRIFT-008 |
> | **E-3** | **An inferred duplicate is a review; an evidenced duplicate is a block** | Both hash kinds produce the same verdict — `blocked`, a hard stop with no appeal | A matching **submitter-supplied** receipt hash stays `blocked` (evidence about the same file). A matching **server-derived** fingerprint becomes `human_review` / `possible_duplicate` (an inference about similar fields) | DRIFT-087 |
>
> **E-3 is the direct answer to the owner's question on DRIFT-010** — *"i hope
> this wont lead to major problems in teh future."* It can, and the risk is not
> the column. See that disposition.
>
> ### One thing that was checked rather than assumed
>
> DRIFT-009's `KEEP_CURRENT` was verified against the tree, not accepted from the
> finding: `src/uc02/server.js:468` now reads `actionable: actionability.allowed`
> — a real policy verdict — and the hard-coded `false` survives only inside the
> comment explaining why it used to be there. `docs/use-cases/UC-02.md:181`
> carries the corrected review-queue row. So there is genuinely nothing
> outstanding. Had either still been stale, `KEEP_CURRENT` would have been the
> wrong disposition and this box would say so.

---

## 1. Business purpose

Expense review is repetitive, error-prone admin: check a receipt, re-check the
arithmetic, confirm the category, approve or decline. The errors it produces —
a duplicate reimbursement, a self-contradicting record, a claim over policy — are
cheap to prevent deterministically and expensive to catch afterwards, because by
then the money has moved.

UC-02 approves the clean, in-policy, evidenced claims with nobody involved, and
puts every claim that is not one of those in front of Finance Ops with the reason
already stated.

## 2. Primary operator persona

**Role:** the **employee** submits. The operator is a **Finance Ops reviewer**.
**Experience/knowledge:** knows expense policy, currencies, and what a receipt
should look like; reviews many claims a day.
**Typical working context:** a Zendesk ticket with the ZAF sidebar, working
through flagged claims.
**They understand:** amounts, currencies, categories, caps, duplicates, receipts,
"approve / decline with a reason / park it".
**They DO NOT know:** the `uc02_expenses` table, `derivedReceiptHash`, gate
positions, `converted_amount` as a field name, or Remote's deprecated flat
category enum.

## 3. Job to be done

*Employee:* "Get reimbursed for what I actually spent, without chasing anyone."
*Finance Ops:* "Decide the claims the system would not, in seconds each, without
re-deriving the arithmetic myself."

## 4. Starting preconditions

- An expense exists at Remote in status `pending`, belonging to a known
  employment.
- The submitter's identity is authenticated and matches the employment on the
  expense.
- Amounts are integers in the currency's minor unit — Remote's own contract.
- The expense carries at least one receipt row. **Remote guarantees this on its
  own creation path** — *"The receipt is necessary to create an expense"* — which
  is why the receipt-*existence* check protects the portal's intake path rather
  than the webhook one (DRIFT-088), and why **`[E-1]`** reads the file instead of
  counting rows.
- The receipt file is **retrievable** — `GET /v1/expenses/{expense_id}/receipts/{receipt_id}`. **`[E-1]`**
- A policy cap corpus exists, **denominated in a stated currency**, and
  **carrying the name of whoever authored it**. It is the *employer's* expense
  policy: Remote's API and Remote's expenses documentation contain no policy,
  cap, limit or threshold concept at all. **`[E-2]`**

## 5. Main successful journey

1. An employee files an expense with a receipt inside Remote's own product.
2. The system confirms the submitter is the employee the claim belongs to, and
   that the claim is still pending and unreviewed.
3. It confirms this receipt has not already been reimbursed.
4. It classifies the category against the employee's own country category list —
   qualitatively, never producing a number.
5. It checks the record does not contradict itself: a receipt exists, the tax
   portion does not exceed its amount, and same-currency converted figures agree.
6. **It fetches the receipt and reads it**, and checks that what the image shows
   — vendor, date, currency, total — does not contradict the figures Remote
   already holds. The reading can only ever *refuse*; it never supplies a
   number. **`[E-1]`**
7. It compares the claim against the **employer's** policy cap **in the billing
   currency**, and every mention of that cap to a human names who set it.
   **`[E-2]`**
8. Every check passes: the claim is approved at Remote and settled. Nobody was
   involved, and the employee finds out because they were reimbursed.
9. The decision was recorded durably **before** the write, and the write's result
   recorded after it.

**On the exception path:** Finance Ops sees the claim, the amount, the cap, the
overage, the employee, and the one check that stopped it, and chooses **approve**,
**decline** (with a mandatory reason that becomes Remote's `reason`), or **hold**
(a local, reversible parking state that writes nothing to Remote).

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Compliant, evidenced, in-currency, under cap, confident category | `auto_approve` / `all_gates_passed` | Exactly one `PATCH` `{status:"approved"}` at Remote; claim reimbursed; no human involved |
| Over the policy cap | `human_review` / `over_policy_cap` | Finance Ops decides; the panel shows claim, cap, overage and percentage |
| Same receipt filed twice, matched on the **submitter-supplied** hash | `blocked` / `duplicate_submission` | No second reimbursement. **Hard stop, not a review** — the two claims name the same file, which is evidence, not inference |
| Two claims matched only on the **server-derived** fingerprint | `human_review` / `possible_duplicate` **`[E-3]`** | Finance Ops sees both claims side by side and decides. Six identical fields is an *inference*: the same employee can buy the same coffee twice in one day. A hard stop here refuses a real claim with no appeal |
| The receipt image contradicts the record — wrong vendor, wrong date, wrong currency, or a total that is not the claimed amount | `human_review` / `receipt_does_not_support_claim` **`[E-1]`** | Finance Ops sees both readings side by side. **Remote's figures are never overwritten by the model's** |
| The receipt cannot be fetched or cannot be read | `human_review` / `receipt_unreadable` **`[E-1]`** | Never an auto-approval. An unreadable receipt is an unchecked one |
| Category not confidently classifiable | `human_review` / `low_confidence` or `category_unverified` | Finance Ops assigns the category |
| Cross-currency claim | `human_review` / `currency_conversion_unverified` | Refused, never estimated: the record carries no conversion rate, so any figure is consistent with some rate |
| Billing currency the cap corpus is not denominated in | `human_review` / `policy_cap_currency_mismatch` | A wrong comparison is not made |
| No receipt row | `human_review` / `missing_receipt_evidence` | A receiptless auto-approval is the one thing this use case must never do |
| `tax_amount > amount` | `human_review` / `tax_exceeds_amount` | The record contradicts itself |
| Same-currency converted figures disagree | `human_review` / `conversion_identity_mismatch` | Same |
| `expense_date` in the future | `human_review` / `expense_date_invalid` | Money not yet spent is not auto-reimbursed |
| Expense not `pending` | `blocked` / `expense_not_pending` | Nothing is re-decided |
| Expense belongs to a different employment | `blocked` / `expense_employment_mismatch` | Access refusal |
| Employment not active | `escalate` / `employee_not_active` | Finance Ops |
| Finance Ops approves a flagged claim | Approved at Remote | Badge reads **APPROVED — NOT CONFIRMED AT REMOTE** until the write returns |
| Finance Ops declines | `PATCH {status:"declined", reason}` | Reason is mandatory; refused `decline_reason_required` (400) without one |
| Finance Ops holds | **No Remote write at all** | The claim stays `pending` at Remote; local, reversible; not terminal |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Duplicate webhook** | One claim row, one decision, **one approval write**. Proven live: executions 4422/4424 approved, 4426 stopped at the NoOp having written nothing |
| **Duplicate across process boundaries** | The duplicate gate must work when memory is empty — serverless memory lasts one request, and `findByReceiptHash()` returned `null` on every deployed call there has ever been. Requires the pooled store |
| **Two claims sharing a submitter-supplied hash but differing in record fields** | **Known gap**: cross-process they match on nothing. In-process they still collide. Closing it is a provisioning step (`derived_receipt_hash` column + index) |
| **Expense 404s at Remote** | `expense_not_found` — an answer *about the record* |
| **Remote 403/5xx** | `upstream_unavailable` — the request was never evaluated. Distinct from the 404 |
| **Category endpoint 403** | The employee-session endpoint always 403s for a company token; the company-side endpoint with an ISO **alpha-3** `country_code` is the only usable one. Alpha-2 returns 422 |
| **LLM invents a category code** | Rejected by `isValidClassification` before use; falls back and tags `rule_based_fallback` |
| **LLM unreachable** | 3 retries with backoff, then rules; every attempt traced |
| **Audit backend down** | The Remote write is refused, not orphaned — the durable `expense_auto_approved` row precedes the write |
| **Remote write fails after a human approval** | The human's decision stands and is recorded; the badge must say **not confirmed at Remote**. The UI may not report it as settled |
| **Two reviewers act at once** | One decision stands; the second is refused |
| **A held claim** | Never renders a terminal badge while its buttons are on screen |
| **Money in the wrong scale** | Impossible by construction — all comparisons stay in Remote's integer minor-unit domain; caps are declared with `POLICY_CAP_CURRENCY` |

## 8. Invariants — must never happen

1. **No claim is auto-approved without at least one usable receipt row.**
2. **The same receipt is never reimbursed twice.**
3. **The auto-approve write body is exactly `{status:"approved"}`** — nothing
   else. This is what makes "never auto-assert VAT recovery" structural rather
   than a runtime flag: there is no field to assert it in.
4. **A confident classification never overrides a failed deterministic check.**
5. **Money never leaves the integer minor-unit domain**, and a cap is never
   compared across currencies.
6. **No decision is written to Remote before it is durably audited.**
7. **A hold writes nothing to Remote.**
8. **A decline always carries a reason.**
9. **One delivery ⇒ one decision ⇒ one write.**
10. **The UI never reports a claim as settled at Remote before the write
    returned.**
11. **The receipt reader can only ever refuse.** **`[E-1]`** There is no return
    value meaning "approved" and no path by which a figure it produced reaches
    the `PATCH`. It is consulted **last**, after every check the policy already
    had, so it can never mask the real reason a claim was stopped, and it is
    **additive** — it can add a refusal, never remove one. Three properties, each
    pinned by a test rather than argued, exactly as
    `src/review/approverEntitlement.js` pins its own.
12. **No cap is ever shown to a human without naming who set it.** **`[E-2]`**
    Including in the `reason` string written back to Remote, which is
    customer-visible. This system must never let a number it authored be read as
    Remote's policy.
13. **A hard stop is only ever reached on evidence, never on inference.**
    **`[E-3]`** `blocked` has no appeal route anywhere in this system; anything
    derived rather than asserted goes to a human instead.

## 9. AI responsibilities

**The LLM may:** classify the expense against the employee's real category list,
including qualitative judgements like client entertainment vs. personal meal;
state its confidence.

**The LLM must never be the source of truth for:** any amount, any tax figure,
any conversion, the cap, whether a duplicate exists, or the approve/decline
decision. It may not produce or alter money. Its output is validated against the
real category list before use and tagged with its source.

**The LLM also reads the receipt image** — vendor, date, currency, totals —
**and its reading is only ever compared, never adopted.** **`[E-1]`**

This is how §5's documented extraction and prime directive #1 hold at the same
time, and it is worth stating precisely because the two look incompatible.
Remote's documentation says *"The receipt is necessary to create an expense"*, so
Remote's record **already carries** the amount, the currency, the tax portion and
the date. The extraction therefore has something to be checked *against*. It
produces a disagreement or it produces nothing. It cannot produce a figure that
anything downstream consumes.

**§5's bounding boxes are a rendering, not an input.** They exist so the Finance
Ops reviewer can see *which part of the image* the disagreement is about. No gate
reads them.

**Previously recorded here as "deliberately not built"**, on the reasoning that
extraction would make a model the source of a money figure. That reasoning was
right about the danger and wrong about the only way to avoid it — see DRIFT-007's
disposition.

## 10. Deterministic responsibilities

Identity and ownership · expense status · duplicate detection (submitter hash,
else a server-derived fingerprint over employment/amount/currency/tax/date/title)
**and which of the two matched, because they carry different verdicts `[E-3]`**
· receipt evidence · **whether the receipt was fetchable `[E-1]`** · tax
containment · conversion identity · cross-currency refusal · policy cap in a
declared currency **and the cap's authorship `[E-2]`** · date validity · money
scaling · audit ordering · the write itself.

**Every comparison between the receipt reading and the record is deterministic
too `[E-1]`.** The model returns fields; deciding whether those fields contradict
Remote's is ordinary code. The model never decides that it disagrees.

The gates exist twice — `src/uc02/policyEngine.js` and
`workflows/nodes-uc02/expenseGates.js`. `test/n8nUc02Parity.test.js` runs the n8n
body against the **real** functions, never a re-implementation.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Any `human_review` or `escalate` outcome. `blocked` outcomes are hard stops |
| **Who** | Finance Ops (`queue_finance_ops`; Zendesk group `Finance Ops`, `6168404929055`, exists) |
| **Evidence needed** | The employee (name, status, country — the country is what makes "over the cap" meaningful, since the category list differs per country); the amount, the cap, **who set the cap `[E-2]`**, the overage; the deciding check; the category and what the confidence was *about*; **on a receipt disagreement, both readings side by side — what Remote holds, what the image shows — plus the image itself `[E-1]`**; **on a `possible_duplicate`, both claims side by side and which fields matched `[E-3]`** |
| **Verbs** | approve · decline (reason required) · hold |
| **After approve** | `PATCH {status:"approved"}` at Remote; badge in Remote's own status vocabulary |
| **After decline** | `PATCH {status:"declined", reason}` |
| **After hold** | Nothing at Remote; local parking state; still actionable |
| **Expiry** | **None defined** — no timeout, no reminder |
| **If nobody responds** | The claim sits `flagged` in `uc02_expenses` indefinitely |

## 12. CROSS_UC_ROUTING

**May receive from** — nothing. UC-02 is triggered by `expense.submitted` from
Remote, or by the portal's own intake form.

**May route to** — nothing.

**Routing conditions** — n/a.

**Context that must transfer** — n/a today.

**Must not happen during handoff** — n/a. One thing worth stating anyway, because
it is a live risk in the *portal* rather than in cross-UC routing: the portal
mints a fresh copy of a fixture expense on request (`<id>~fresh-<token>`). The
reference identifies the **delivery**; the expense identifies the **subject**.
Confusing the two makes a correct duplicate-replay look like a broken control.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Remote / mock UI** | The expense's status changes to `approved` or `declined`; a held claim stays `pending` |
| **Zendesk ticket** | Raised only for claims needing a human: tagged `uc02`, `queue_finance_ops`, plus `escalation_finance_ops` when it really is an escalation. The note carries the employee, what happened, the figures, the owning team and where to act |
| **ZAF sidebar** | The employee block; the deciding gate; the classifier confidence **labelled as being about the category**; the outcome badge in Remote's status words; three buttons (approve / decline / hold) — the only single-approver panel with three. **Plus, when they decided the case: the receipt image with the two readings beside it `[E-1]`, the cap's author `[E-2]`, and the other claim in a `possible_duplicate` `[E-3]`** |
| **Live Feed (`/audit`)** | The decision, and beneath it every classification attempt — UC-02's trace separates a `403 invalid role` on categories from a `404` on the expense **within one decision** |
| **Requests ("My requests")** | The employee sees their claim's state and, when flagged, that they are waiting on Finance Ops |
| **Backend/API** | `POST /uc02/api/expenses` (intake) · `GET` by id / by ticket · `POST /api/expenses/:id/approve\|decline\|hold` behind signed identity. `/release` still routes as the legacy spelling |
| **Database** | `uc02_expenses` (with `receipt_hash`, `external_ref` indexes; **plus `derived_receipt_hash` and its own index, DRIFT-010**) · `audit_log` (decision, then `expense_auto_approved`, then `expense_approved_write`) · `audit_trace` — **including one row per receipt-extraction attempt `[E-1]`** · `workflow_claims`. **No `review_queue` row** — UC-02 owns its own table |
| **Remote Sandbox** | Exactly one status transition per approved claim, and `reviewed_at` set |

## 14. UX_ACCEPTANCE

- **Hierarchy.** Amount and outcome first; the one failed check second; the
  employee third; everything else disclosed.
- **Minimal information.** The category confidence must say what it is *about* —
  an unlabelled confidence on a money screen reads as confidence in the amount.
- **Progressive disclosure.** The 20-reason gate ladder is a disclosure, never
  the lead.
- **No internal language.** Never `conversion_identity_mismatch` alone; say "the
  converted figures on this claim disagree with each other". Never
  `receipt_does_not_support_claim` alone; say "the receipt shows a different date
  from the one claimed". Never `possible_duplicate` alone; say "this looks very
  like a claim already filed — here is the other one".
- **A refusal names its author when the rule is ours. `[E-2]`** "Over the £250
  accommodation cap in **Acme Ltd's** expense policy" — never a bare "over
  policy", which an employee reads as Remote ruling on them.
- **Two readings are shown as two readings. `[E-1]`** The receipt panel puts what
  Remote holds beside what the image shows and marks which is which. It never
  merges them into one corrected figure — the reviewer's job is to decide which
  is right, and a merged figure has already decided.
- **Action clarity.** Three verbs, one primary. Decline names its reason as
  required **in the browser**, not by a 400. Hold says plainly that it changes
  nothing at Remote.
- **Consequences stated.** Approve says money will be reimbursed.
- **Consistency.** The badge uses Remote's status vocabulary — `approved`,
  `declined`, `pending`, `reimbursed` — because that is the vocabulary the
  reviewer will see in Remote. `approve`/`decline`/`hold` everywhere else; never
  `release`, never `deny`.
- **Practicality.** The reviewer must not open Remote to see the amount, the cap
  or who it is about.

## 15. Successful business outcome

> **An employee is reimbursed the right amount, once, for money they actually
> spent and evidenced — without anyone reviewing it.**
>
> And: no duplicate reimbursement ever leaves the system; no claim over policy is
> approved without a person; no claim is approved on a record that contradicts
> itself; and every approval is attributable to either "every check passed" or a
> named human with a reason.

## 16. Required evidence for E2E verification

1. **Remote/mock state** — the expense read back as `approved` with `reviewed_at`
   set. This is the only proof that matters and it is the one that was missing
   for months.
2. **Execution count** — exactly one `PATCH` per claim; a redelivery under the
   same ref produces zero further writes.
3. **Database** — one `uc02_expenses` row; three `audit_log` rows in order
   (decision → pre-write → post-write); `audit_trace` rows.
4. **Duplicate proof, cross-process** — file the same receipt twice against a
   **new store instance sharing only the database**, and require `blocked`.
   An in-memory-only pass reproduces the bug and passes.
5. **Zendesk** — for flagged claims: the ticket, the tags, the group.
6. **ZAF/browser** — the sidebar rendered the employee's name, and all three
   buttons; decline refused without a note in the browser.
7. **Requests** — the employee's own view shows the same state.
8. **A positive test leads.** A real, well-formed, in-policy claim MUST reach
   `auto_approve`. This use case was completely dead three separate times while
   every fail-closed test passed.
9. **The receipt was really fetched and really read `[E-1]`** — the demo receipt
   downloaded through the Sandbox (not loaded from disk beside the code), one
   `audit_trace` row per extraction attempt, and a **positive** case where the
   image agrees with the record and the claim still auto-approves. A reader that
   only ever refuses is indistinguishable from a reader that cannot succeed —
   which is this use case's own recurring failure, twice over.
10. **Zero vision calls from the test suite `[E-1]`**, proven structurally rather
    than by watching a bill; and a repeated extraction of the same bytes making
    exactly one call.
11. **A cap refusal quoted verbatim `[E-2]`** from each surface that can show one,
    each naming its author — including the `reason` string as Remote stored it.
12. **The duplicate pair, both ways `[E-3]`** — a submitted-hash match `blocked`,
    a derived-only match reaching Finance Ops and being resolvable by them.

## 17. Known SPEC_DRIFT

---

### SPEC_DRIFT · DRIFT-006 · The spec's core deterministic check does not exist and cannot

**Original/documented behaviour:** §7 (original) — *"line items sum to stated
total"*, and §12 scenario 6 *"math mismatch"*.
**Current implementation:** Remote's expense model has **no line-item array and
no `total_amount`** [CONFIRMED, 220 live records + OpenAPI]. The gate read
`expense.lines`/`expense.total_amount` — fields that do not exist — so **no real
claim could ever clear it**; live execution 4366 is that failure. It has been
replaced by three checks that *can* fail: receipt evidence, tax containment,
conversion identity.
**Current tests assume:** the three replacements.
**Difference:** the replacement is already documented in §7, so spec and code now
agree. The drift is historical and is recorded because it is the archetype: **a
gate that cannot fail is worse than no gate, because it looks like protection.**
**Evidence:** `docs/use-cases/UC-02.md` §7; `src/uc02/policyEngine.js`.
**Likely reason:** the original spec was written from a research doc, not from the
API.
**Risk if left as-is:** none — it is fixed. The risk is forgetting the lesson.
**Recommendation:** KEEP_CURRENT.
**Confidence:** HIGH

**DISPOSITION — DECIDED 2026-08-21 · NOTHING TO BUILD · recommendation taken.**
`KEEP_CURRENT`. Verified rather than assumed: `docs/use-cases/UC-02.md:144` —
§12 scenario 6 — already reads **"(was 'math mismatch')"** and names the three
replacement checks, and §7's own boxed note at lines 78–79 states that Remote's
expense model has no line items. The spec and the code agree. There is nothing
to change in either.

**Why this entry survives anyway, and why it is the most valuable one in the
UC-02 set.** It is the archetype the rest of this register is measured against:
**a gate that cannot fail is worse than no gate, because it looks like
protection.** Live execution 4366 is what that costs — a use case that could
not clear its own gate for any real claim, while every fail-closed test passed.
`CLAUDE.md` §5 states the general form: refusing correctly and being unable to
succeed are indistinguishable from outside, and only a **positive** test —
*this input MUST auto-approve* — tells them apart.

**The archetype recurred in this very pass.** Honouring DRIFT-007's disposition
meant reading Remote's own expenses documentation, which says a receipt is
*required* to create an expense — so on UC-02's documented trigger path the
receipt-evidence gate may be as unfailable as the line-sum gate was. That is
**DRIFT-088**, in §17b. Deleting this scar would have deleted the pattern that
made the second one recognisable.


---

### SPEC_DRIFT · DRIFT-007 · Vision/OCR is the use case's headline capability and is not built

**Original/documented behaviour:** §4 and §5 — *"Vision LLM: OCR + document
understanding of receipts"*, extracting vendor, date, currency, line items, total
and tax header; §5's exception path annotates with **bounding-box extractions**.
**Current implementation:** no vision pipeline, no OCR, no bounding boxes. The
receipt is checked for *existence and well-formedness of the record row*, never
read. §15 says so honestly.
**Current tests assume:** structured input only.
**Difference:** the use case is named "Expense & **Receipt** Validation" and does
not read receipts.
**Likely reason:** deliberate and defensible — extracting money figures with a
model would make the model the source of a money value (prime directive #1).
**Risk if left as-is:** the receipt could be a photograph of anything. The control
is "a receipt row exists", not "the receipt supports the claim".
**Recommendation:** HUMAN_DECISION_REQUIRED — whether to build a *qualitative-only*
vision pass (does this image look like a receipt for this vendor/date?) that never
produces a number, or to restate the use case's name and §5.
**Confidence:** HIGH

**DISPOSITION — DECIDED 2026-08-21 · NOT YET BUILT · `E-1` · the documented
behaviour is chosen.** *"let go with the documented behaviour. You ahev to
rpovide a receipt, even if it is digital that I will use for the demo. But for
any large scale testing so to not finish my api tokes, we need a owkraround."*

Three things were asked for and all three are answerable. They are separated
below because only the first changes a decision.

---

#### 1 · The documented behaviour is buildable, and Remote's own documentation is why

The finding recorded a genuine conflict — §5's extraction list includes **total
and tax**, and making a model the source of a money figure is prime directive
#1's single prohibition. **It resolves cleanly, and the resolution is not a
compromise.** Read live from `developer.remote.com/docs/working-with-expenses.md`
on 2026-08-21:

> *"The `receipt` field represents the receipt of the purchase, which is
> **required** to create an expense."*
>
> *"Each expense belongs to an employment, has an amount in a given currency,
> the date it was incurred, and a receipt file."*

Remote's record therefore **already carries** the amount, the currency, the tax
portion and the date — and the receipt file always exists. So the vision pass has
something to be **checked against**. Its extraction is never adopted; it is
**compared**. That is the whole design:

> **The vision pass may only ever refuse. There is no path by which a figure it
> produced reaches the `PATCH`.**

This is not a new pattern in this repository — it is `src/review/approverEntitlement.js`'s
exactly. That module is **consulted last**, **can only ever refuse** (there is no
return value meaning "approved"), and is **additive**. Three properties pinned by
test rather than argued, so no future call site can be written that lets the
model's number fill a slot. `E-1` takes all three.

**What it adds:** a new outcome, `receipt_does_not_support_claim` →
`human_review`, when the extracted vendor/date/currency/total contradict Remote's
own record. What it never adds: an amount, a tax figure, or a conversion.

**§5's bounding boxes are a rendering, not an input.** They annotate the
exception path *for the Finance Ops reviewer*, so the person deciding can see
which part of the image the disagreement is about. Nothing downstream reads them.

**The first build step is not the model — it is the bytes.** `restClient.js` has
**no receipt-download method at all** (`grep downloadReceipt src/remote/restClient.js`
→ nothing). You cannot OCR a file you have never fetched. Remote publishes two
routes and the modern one must be used:

| Route | Status |
|---|---|
| `GET /v1/expenses/{expense_id}/receipts/{receipt_id}` | Current. Use this |
| `GET /v1/expenses/{id}/receipt` | **Deprecated since late February 2024** |

One trap, recorded so it is not paid for twice: **Remote's own curl example for
the deprecated route says `--request POST` on a `GET` endpoint.** Copying that
example verbatim will fail in a way that looks like a permissions problem.

---

#### 2 · The demo receipt

The owner supplies one digital receipt for the demo. Two constraints on it, both
standing rules rather than new ones:

- **Prime directive #5 — no real customer data.** A synthetic or the owner's own
  receipt only. A photographed third-party receipt carries a real vendor, a real
  card fragment and a real person's purchase.
- It must be reachable the way production reaches one — **through the Remote
  Sandbox as a real attached receipt**, not as a file loaded from disk beside the
  code. A demo that bypasses the download path proves the vision pass and leaves
  the fetch untested, which is the half more likely to break.

---

#### 3 · The API-token workaround — the part that must be built *first*, not last

*"for any large scale testing so to not finish my api tokes, we need a
owkraround."* Correct, and vision is the most expensive call site this repository
will ever have — images cost far more per call than the text classifications
already in it. Four pieces, in this order:

| # | Piece | What it does |
|---|---|---|
| 1 | **An injectable `extractReceipt` seam** | Exactly the shape `classify`, `draftSummary`, `draftNarrative` and `judge` already use. Unconfigured ⇒ a deterministic fixture reader, never a live call |
| 2 | **A content-addressed cache**, keyed on the **SHA-256 of the receipt bytes** | The same receipt is extracted **once, ever**. The demo receipt costs one call across every rehearsal. Keying on bytes rather than on expense id is what makes the portal's `<id>~fresh-<token>` copies share one extraction |
| 3 | **A recorded fixture corpus**, keyed by that same hash | `npm test`, `npm run simulate` and `npm run loadtest` cost **zero** and stay hermetic |
| 4 | **A test that the suite cannot reach a vision endpoint at all** | Structural, not procedural |

**Piece 4 is not belt-and-braces.** `CLAUDE.md` §6: *"Never let `npm test` reach
OpenAI. This burned real credit once."* And it bit a second time one layer
deeper — a genuine but unreachable `OPENAI_API_KEY` in a devcontainer's `.env`
meant every test without an injected fake made a real, slow, failing network
call; one test went from ~1ms to 11.4 seconds. The standing rule it produced is
already written down: **every new LLM call site needs its own injectable seam
from day one.** Vision is the call site where that rule is worth the most.

Worth adding while the cost is being designed rather than after: a **size and
dimension guard** before any image is sent, and a **per-run call budget** that
refuses rather than spends. A guard added after a bill is a guard added late.

---

#### What this disposition does not settle

**The use case's name.** The finding offered a second half — *"or restate the
use case's name and §5"* — and choosing the documented behaviour removes the need
for it: once `E-1` is built, "Expense & **Receipt** Validation" is accurate for
the first time. Until it is built, the name still overstates, and
`docs/use-cases/UC-02.md:179` still reads **"Vision LLM / receipt image
extraction | Not built — deliberately"**, which this decision reverses. That row
is now stale in the *other* direction and must move in the same unit of work as
`E-1`, not before it: marking it built while it is not is the failure this whole
register exists to prevent.


---

### SPEC_DRIFT · DRIFT-008 · The policy cap corpus is invented data presented inside a real decision

**Original/documented behaviour:** §3 — *"Company expense policy → Policy RAG
index"*, tagged [PROPOSED].
**Current implementation:** `src/uc02/policyCaps.js`, a hand-curated cap table in
integer ×100 with a declared `POLICY_CAP_CURRENCY`. No RAG, no retrieval, no
citation.
**Current tests assume:** the hand-curated table.
**Difference:** a claim is refused as "over policy" against a policy this project
wrote. The refusal reads to an employee as Remote's policy.
**Evidence:** `src/uc02/policyCaps.js`; `UC-02.md` §15 "mock policy corpus".
**Likely reason:** honest interim — the same discipline as UC-08's pre-embeddings
retriever.
**Risk if left as-is:** an employee is told their claim exceeds a cap that has no
authority behind it, and nothing on the screen says so.
**Recommendation:** RECONCILE — the cap's provenance must be visible wherever the
cap is cited to a human, in the same way statutory findings carry their source.
**Confidence:** HIGH

**DISPOSITION — DECIDED 2026-08-21 · NOT YET BUILT · `E-2` · RECONCILE, against
Remote's documentation.** *"RECONCILE. anything we are doing here must be 1000%
true to remote own doucmentation."*

**That standard was applied literally, and it produced a sharper answer than the
finding's own recommendation.** The obvious reading of "be true to Remote's
documentation" is *read the cap from Remote instead of inventing it.* **That is
not possible, and the reason matters more than the fix.**

**Checked, both directions, 2026-08-21:**

| Source | Result |
|---|---|
| `docs/REMOTE-API-INDEX.txt` — Remote's own `llms.txt`, every endpoint | **No expense policy, cap, limit, threshold or allowance endpoint exists.** The only `policy` hits are the rate-limit pages and *leave* policies |
| `developer.remote.com/docs/working-with-expenses.md`, fetched live | The words *policy*, *cap*, *limit* and *threshold* **do not appear**. It documents create-approved, approve/decline a pending expense, show/list, fetch the receipt, and seven webhooks. Nothing else |

**So there is nothing to read, and the conclusion is a domain fact rather than a
gap.** Remote is an **Employer of Record**. An expense policy — what may be
spent, on what, up to how much — belongs to the **employer**, the customer
company. Remote's model gives that company's own approver two verbs, and its
documentation says exactly that and no more:

> *"To approve an expense, simply update its status to `approved`. Conversely,
> to decline an expense, update its status to `declined` and provide a reason for
> declination."*

A reason string. Remote takes no view on *what* a good reason is. **Being 1000%
true to Remote's documentation therefore means the opposite of importing a cap:
it means never presenting our cap as Remote's.**

#### What `E-2` changes

1. **The corpus is renamed to what it is** — the **demo employer's** expense
   policy, not Remote's and not "the policy". `src/uc02/policyCaps.js`'s header
   already calls the numbers `[PROPOSED]` and *"not drawn from any real Remote
   customer policy"*, which is honest **in the file and nowhere the reader
   looks.**
2. **Provenance travels with the cap to every human who sees it** — the ZAF
   sidebar, the portal result page, the Zendesk note, and the `reason` string
   written back to Remote. The same discipline the statutory findings already
   carry: a number that refuses somebody names its source. An employee told
   *"over policy"* by a system wearing Remote's colours will read it as Remote's
   policy unless the screen says otherwise.
3. **The `reason` written to Remote names the author too.** It is the one field
   Remote gives us and it is customer-visible.
4. **The RAG framing comes out of the spec.** `docs/use-cases/UC-02.md:66` and
   `:157` still promise *"policy cap (RAG)"* and a *`rag-retriever`* node. There
   is no retrieval here and there should not be: `docs/RETRIEVAL.md` measured this
   repository's whole citation corpus at **106 passages** and recommends **not**
   seeding a vector store at that size. A hand-curated table is the correct
   mechanism; the spec should say so rather than promising infrastructure that
   was deliberately declined.

#### What it deliberately does not change

**The cap gate stays.** Deleting it would leave nothing between a claim and an
auto-approval except arithmetic — and `POLICY_CAP_CURRENCY` plus the
`policy_cap_currency_mismatch` refusal are already the correct handling of the
one genuinely dangerous case, which is comparing across currencies. The finding
was never *"the cap is wrong"*; it was *"the cap's authorship is invisible at the
moment it refuses somebody."*

**Confidence: HIGH** on the absence — this is two independent reads of Remote's
own published surface, one of them the endpoint index Remote publishes for
machines.


---

### SPEC_DRIFT · DRIFT-009 · §15 claimed there was no Finance Ops review queue while §6 specified one

**Original/documented behaviour:** §6 — *"route to Finance Ops (ZAF) → PATCH
status: declined (with reason) or hold"*.
**Current implementation:** built — `reviewPolicy.js`, three verbs, three routes,
three buttons.
**Current tests assume:** the built behaviour.
**Difference:** resolved. Recorded because of what the contradiction cost: §15
denied the queue existed, `server.js` hard-set `actionable: false` citing "a
Finance Ops review queue outside this API" that existed nowhere, and **no control
anywhere in the system could resolve a flagged claim.**
**Evidence:** `UC-02.md` §15 review-queue row; `docs/BUILD-LOG.md` §3.38.
**Likely reason:** two sections of one document maintained independently.
**Risk if left as-is:** none now.
**Recommendation:** KEEP_CURRENT.
**Confidence:** HIGH

**DISPOSITION — DECIDED 2026-08-21 · NOTHING TO BUILD · recommendation taken,
and the owner's question answered first.**

**The question was:** *"I dont understand this. Why should I keep_current?"* It
is a fair question, because this entry is written in the same shape as findings
that describe live problems, and it does not describe one.

**The short answer: this was already fixed, and `KEEP_CURRENT` means "the code
is right — change nothing", not "keep the bug".** The bug was real and it was
serious: `docs/use-cases/UC-02.md` §15 asserted that UC-02 deliberately had no
Finance Ops review queue, while §6 of the *same document* had always specified
one. `src/uc02/server.js` believed §15, hard-set `actionable: false`, and cited
"a Finance Ops review queue outside this API" — a queue that existed nowhere in
this project. The consequence: a flagged claim sat in `uc02_expenses` with
`status: "flagged"`, rendered read-only in the sidebar, and **no control
anywhere in the system could resolve it.** It was fixed in `docs/BUILD-LOG.md`
§3.38, in favour of §6.

**Checked against the tree in this pass rather than taken from the finding**,
because a stale "already fixed" is exactly what DRIFT-001 turned out to be on
UC-01:

- `src/uc02/server.js:468` reads `actionable: actionability.allowed` — the
  verdict of a real policy function. The old hard-coded `false` survives only
  inside the comment at lines 11–19 explaining why it used to be there.
- `docs/use-cases/UC-02.md:181` carries the corrected review-queue row, which
  states plainly that the row *"previously said the opposite, which was the
  defect."*
- `src/uc02/reviewPolicy.js` holds three verbs; three routes and three buttons
  exist.

So both halves of the original contradiction are gone. **Had either still been
stale, the right disposition would have been `RECONCILE`, not `KEEP_CURRENT`** —
which is the whole reason the check was run.

**Why keep the entry at all, given nothing is wrong.** Because of what the
contradiction cost, and because of how it was produced: **two sections of one
document, maintained independently, drifting into flat contradiction — and the
code picked the wrong section.** That is not a UC-02 problem. `CLAUDE.md` §6
records this repository paying for the same shape in both directions on a single
day: an issue open in one status file and closed in another. A register that
deletes its resolved entries teaches its reader that resolved problems did not
happen, and the next person to maintain §6 and §15 separately has no reason not
to.

**This is why `DECIDED · NOTHING TO BUILD` exists as a state.** "No action
because it was fixed months ago" and "no action because this pass just fixed it"
both read as *no action*, and they are different claims about the tree. UC-01's
DRIFT-001 is the second; this is the first.


---

### SPEC_DRIFT · DRIFT-010 · Duplicate detection stores one hash where two are computed

**Original/documented behaviour:** §7 — dedupe on the submitter's receipt hash,
else a server-derived fingerprint.
**Current implementation:** both are computed; the table has **one** hash column
and stores `derivedReceiptHash ?? receiptHash`.
**Current tests assume:** the gap, explicitly (`test/uc02Persistence.test.js` 1d).
**Difference:** cross-process, two claims whose record fields differ but which
share a submitter-supplied hash match on nothing.
**Evidence:** `UC-02.md` §15 "Duplicate keys, and the one gap left".
**Likely reason:** the column pre-dated the second hash.
**Risk if left as-is:** a narrow but real duplicate-reimbursement path on the
deployed function.
**Recommendation:** RECONCILE — provision `derived_receipt_hash text` + index.
This is a database change, not a code change.
**Confidence:** HIGH

**DISPOSITION — DECIDED 2026-08-21 · NOT YET BUILT · RECONCILE, and the owner's
worry is well-founded.** *"RECONCILE, i hope thsi wont lead to major problems in
teh future."*

**It can, and the risk is not the one this finding describes.** The provisioning
step is safe; what changes underneath it is not. Both halves below.

#### The provisioning step is safe

`alter table uc02_expenses add column derived_receipt_hash text` plus its index
is **purely additive**: nullable, existing rows take `NULL`, nothing reads it
until the query changes. Two details, so they are not discovered at runtime:

- **Two indexes, not one composite.** The lookup becomes `where receipt_hash = $1
  or derived_receipt_hash = $1`, and Postgres will not serve an `OR` across two
  columns from one composite index.
- **Existing rows stay one-sided.** Nothing backfills them, so every row written
  before the migration remains matchable on whichever single hash it stored. The
  gap narrows going forward; it does not close retroactively.

#### The real risk is semantic, and it points the wrong way

Today `findByReceiptHash()` behaves **differently in the two places it runs**,
which is the finding as written:

| Path | Behaviour |
|---|---|
| In-memory (`expenseStore.js:291`) | `row.receiptHash === h \|\| row.derivedReceiptHash === h` — matches on **either** |
| SQL (`:298`) | `where receipt_hash = $1` — matches on **one** |

Provisioning makes the SQL path behave like the in-memory one. **That is
strictly more blocking, and blocking is not a review.** §6 of this contract:
*"Same receipt filed twice → `blocked` / `duplicate_submission`. **Hard stop, not
a review.**"* A hard stop has **no appeal route anywhere in this system** — no
button, no queue, no human.

Now consider what the derived fingerprint actually hashes: employment, amount,
currency, tax, date, title. Two genuinely distinct claims that share all six —
the same employee, the same €4.50 coffee, the same café, the same day, the same
title — are **indistinguishable to it**. Today that already blocks in-process;
after provisioning it blocks everywhere, permanently, for a claim that is real.

**A false positive here refuses a person their own money with no way to say so.**
That is a worse failure than the narrow duplicate-reimbursement path this change
closes, and it arrives *because of* the fix.

#### `E-3` — the two hashes are different kinds of claim and must not share a verdict

| Hash | What it is | Verdict |
|---|---|---|
| **Submitter-supplied `receiptHash`** | **Evidence** — a statement about the same file | `blocked` / `duplicate_submission`. Unchanged |
| **Server-derived fingerprint** | **An inference** — these records look alike | `human_review` / `possible_duplicate`, showing both claims side by side |

This is the distinction this repository already draws elsewhere and is right to:
`upstreamFailure.js` separates a **404** (an answer *about the record*) from a
**403/5xx** (the request was never evaluated), because collapsing them made gates
escalate naming the wrong cause. Same shape. An inference and a piece of evidence
should not produce the same irreversible outcome.

**Order matters: `E-3` should land before or with the migration, not after.**
Provisioning first turns a rare in-process false block into a permanent one, and
the window between the two changes is exactly when a real employee gets refused.

**One thing to verify before either lands**, because it is cheap and decisive:
count how many `uc02_expenses` rows currently share a derived fingerprint with
another row. If that number is zero, the collision is theoretical and the order
is a precaution. If it is not zero, it has already happened.


---

## 17b. Findings opened by the decisions above (2026-08-21)

Neither of these came from reading more code. Both came from checking a
disposition instead of accepting it.

---

### SPEC_DRIFT · DRIFT-087 · A duplicate found by inference and a duplicate found by evidence produce the same irreversible verdict

**Original/documented behaviour:** §7 of the spec — dedupe on the submitter's
receipt hash, **else** a server-derived fingerprint. The two are named as
alternatives and given one outcome between them.
**Current implementation:** both produce `blocked` / `duplicate_submission`,
which §6 and §7 of this contract define as a **hard stop, not a review**. There
is no button, no queue and no human anywhere in the system that can resolve one.
**Current tests assume:** the single verdict.
**Difference:** the two hashes are **different kinds of claim**. A matching
submitter-supplied hash is *evidence about the same file*. A matching derived
fingerprint is an *inference from six fields* — employment, amount, currency,
tax, date, title — and two genuinely distinct claims can share all six: the same
employee buying the same coffee at the same café twice on one day, titled the
same way. That is not a duplicate and it is currently blocked.
**Evidence:** `src/uc02/expenseStore.js:291` (in-memory, matches on either hash)
vs. `:298` (SQL, matches on one); §6 of this contract, "Hard stop, not a review".
**Likely reason:** the derived fingerprint was added later (finding F-24) into a
gate that already had one outcome, and inherited it.
**Risk if left as-is:** an employee is refused their own money with no route to
say so — and **DRIFT-010's fix makes it worse**, because provisioning
`derived_receipt_hash` extends the in-process false block to every process,
permanently. The remedy for one gap widens the other.
**Recommendation:** `E-3` — evidenced duplicate stays `blocked`; inferred
duplicate becomes `human_review` / `possible_duplicate`, showing both claims side
by side. Land it **before or with** the migration, never after.
**Confidence:** HIGH on the mechanism; MEDIUM on the frequency, which is
measurable and has not been measured — count the `uc02_expenses` rows sharing a
derived fingerprint.

---

### SPEC_DRIFT · DRIFT-088 · Remote requires a receipt to create an expense, so the receipt-evidence gate may be unfailable on the documented trigger path

**Original/documented behaviour:** §7 replaced the dead line-sum gate with three
checks that *can* fail. The first is **receipt evidence** —
`missing_receipt_evidence`, gate position 8 — and invariant 1 of this contract
makes it load-bearing: *"No claim is auto-approved without at least one usable
receipt row."*
**Current implementation:** the gate reads whether `expense.receipts` is
non-empty.
**Difference:** Remote's own documentation, fetched live 2026-08-21, says a
receipt is **required to create an expense** — *"The receipt is necessary to
create an expense"* — and UC-02's documented trigger is `expense.submitted`,
which fires for an expense that was therefore created **with** one. On that path
the array is never empty, so the gate never fires: it looks like protection and
protects nothing. **This is DRIFT-006's archetype, in the gate that replaced
DRIFT-006's gate.**
**Evidence:** `developer.remote.com/docs/working-with-expenses.md` §Receipt;
gate at `src/uc02/policyEngine.js:236`/`:386`. Every empty `receipts: []` in this
repository is **constructed by this repository** — `src/remote/mockServer.js:2481`,
`test/uc02.test.js:623`, `test/lowTierExceptionData.test.js:449`/`:469`. Not one
live record demonstrates the case. That is precisely the pattern `CLAUDE.md` §4
names: *"fixtures were written to agree with the code, and the code with the
fixtures, so neither was ever compared to Remote."*
**Likely reason:** the replacement gates were designed from the record *shape*
(a `receipts` array exists, therefore it might be empty) rather than from
Remote's creation *rules*.
**Risk if left as-is:** lower than DRIFT-006's, and it is important to say why
rather than overstate it. **The gate is not useless** — the portal's own intake
path can construct a receiptless claim, and it protects that. What is wrong is
where the protection is believed to be: invariant 1 reads as a guarantee about
Remote-originated claims, and on those it is a tautology.
**Recommendation:** RECONCILE, and **measure before changing anything**. The
decisive check is one query over the 220 live expense records already captured:
how many carry `receipts: []`? If none do, say so in §7 and in invariant 1 — the
gate guards the portal path, not the webhook path — and let `E-1` become the real
receipt control, since a gate that reads the file can fail on a Remote-originated
claim in a way that counting rows cannot. **Do not delete the gate**; deleting a
tautology on one path removes a live control on another.
**Confidence:** HIGH that Remote requires a receipt at creation; **MEDIUM** that
the array is therefore never empty in practice — Remote's stated rule covers API
creation, and whether every UI flow and every historical record obeys it is
exactly what the query would settle.

---

## 18. Build queue

**Everything decided in §17 and §17b, in the order it should be built, with the
files, the tests and the done-criterion for each.** §4–§16 describe the target;
this section is how you get there. Nothing here is built.

**The ordering is not arbitrary and two of the dependencies are load-bearing:**
`E-3` must precede the DRIFT-010 migration or the migration makes a false block
permanent, and the cost harness must precede the vision model or the first
large-scale test run is also the last one the budget allows.

> **Standing rules that apply to every step below**, so they are not repeated
> in each one:
>
> - **The gates exist twice.** `src/uc02/policyEngine.js` and
>   `workflows/nodes-uc02/expenseGates.js`. `test/n8nUc02Parity.test.js` runs the
>   n8n body against the **real** functions. A gate changed in one place is a gate
>   that disagrees with itself.
> - **Every gate change ends in a republish** of graph `WORKFLOW_UC02_ID`, and
>   the only thing that answers *"is this live?"* is `versionId ===
>   activeVersionId`. `mcp__n8n__update_workflow` writes a **draft**; REST `PUT`
>   publishes in place. `npm run verify-deployed` afterwards.
> - **A green n8n execution proves nothing** if a node was pinned. Check the
>   destination table, never the run status.
> - **Positive tests, not only negative ones.** For every step, one test that
>   says *this input MUST succeed*. This use case has been structurally dead
>   three times while every fail-closed test passed.
> - **No real customer data** anywhere, including fixture receipts.

---

### Step 0 · Two measurements, before any code

Both are read-only and both can **change the plan**, which is why they are first.

| # | Question | How | What it decides |
|---|---|---|---|
| **M-1** | Of the live expense records already captured, how many carry `receipts: []`? | One pass over the 220-record capture | DRIFT-088's wording. If none do, invariant 1 is a tautology on the webhook path and must say so |
| **M-2** | How many `uc02_expenses` rows share a derived fingerprint with another row? | `select count(*) from (select derived-fingerprint, count(*) … having count(*) > 1)` — today that means reading `receipt_hash` where the source was `derived` | Whether `E-3`'s false-block risk is theoretical or has already happened |

**Done when:** both numbers are written into DRIFT-087 and DRIFT-088 with the
date they were measured.

---

### Step 1 · `E-3` — split the duplicate verdict

**Before the migration, never after.** Today a derived-fingerprint match blocks
only in-process; Step 2 makes it block everywhere, permanently, on a verdict with
no appeal route.

| | |
|---|---|
| **Behaviour** | Submitter-supplied hash match ⇒ `blocked` / `duplicate_submission` (unchanged). Derived-fingerprint-only match ⇒ `human_review` / `possible_duplicate` |
| **Files** | `src/uc02/expenseStore.js` (`findByReceiptHash` returns **which** hash matched, not just the row) · `src/uc02/policyEngine.js` (new reason, gate ladder entry, plain-language string) · `workflows/nodes-uc02/expenseGates.js` · `src/uc02/reviewPolicy.js` (`possible_duplicate` is actionable) · `src/uc02/server.js` (the other claim on the view) · `zaf-app/assets/panels.js` (both claims side by side, matched fields marked) |
| **Tests** | `test/uc02.test.js` — both directions, and that `blocked` is still unreachable from an inference · `test/n8nUc02Parity.test.js` · a UX test that the panel names the *other* claim, not an id |
| **Done when** | An evidenced duplicate still hard-stops; a derived-only duplicate reaches Finance Ops **and can be resolved by them**; parity green; graph republished and verified |

---

### Step 2 · DRIFT-010 — provision the second hash column

| | |
|---|---|
| **Migration** | `alter table uc02_expenses add column derived_receipt_hash text;` plus an index on it. **Two indexes, not one composite** — the lookup becomes an `OR` across two columns and Postgres will not serve that from a composite |
| **Files** | `src/uc02/expenseStore.js` — write both columns; the SQL lookup ORs them; `hashForColumn()`/the read-through mapper stop collapsing the pair · `docs/SETUP-CHECKLIST.md` (the provisioning entry, same pattern as `audit_trace`) |
| **Tests** | The cross-process case from §16.4 — **a new store instance sharing only the database** — blocking on a submitted hash and reviewing on a derived one. An in-memory-only pass reproduces the bug and passes, so it must not be the test |
| **Note** | Existing rows are **not** backfilled and stay one-sided. The gap narrows going forward; it does not close retroactively. Say so in the checklist rather than discovering it |
| **Done when** | §7's "Two claims sharing a submitter-supplied hash but differing in record fields" row can be deleted from the known-gaps column |

---

### Step 3 · `E-2` — the cap names its author

No gate *decision* changes, but the `reason` string written to Remote does, so
the n8n port is still in scope.

| | |
|---|---|
| **Behaviour** | Every cap shown to a human names who set it, and it is named as the **employer's** policy. Remote has no cap concept, so ours may never wear Remote's authority |
| **Files** | `src/uc02/policyCaps.js` (export a provenance record beside the numbers: author, version, currency, `[PROPOSED]`) · `src/uc02/policyEngine.js` (carry provenance into the decision facts) · `src/uc02/server.js` · `zaf-app/assets/panels.js` · `src/portal/` result copy · the Zendesk note builder · the `reason` string sent to Remote · `workflows/nodes-uc02/expenseGates.js` |
| **Spec edits in the same unit of work** | `docs/use-cases/UC-02.md` — `:66` *"policy cap (RAG)"* and `:157` *"`rag-retriever`"* come out, and §3's `[PROPOSED] Policy RAG index` is reframed. `docs/RETRIEVAL.md` measured the whole citation corpus at 106 passages and recommends **not** seeding a vector store; the spec should not keep promising one |
| **Tests** | A test that **no** cap-bearing string on any surface omits the author, and that none of them claims Remote authored it |
| **Done when** | A cap refusal can be quoted from all four surfaces and the Remote `reason` field, each naming Acme (or whoever the demo employer is) |

---

### Step 4 · `E-1a` — fetch the bytes

**The first vision step is not the model.** `src/remote/restClient.js` has no
receipt-download method at all; you cannot read a file you have never fetched.

| | |
|---|---|
| **Route** | `GET /v1/expenses/{expense_id}/receipts/{receipt_id}` — the current one. **Not** `GET /v1/expenses/{id}/receipt`, deprecated since late February 2024 |
| **Trap** | Remote's own curl example for the deprecated route says `--request POST` on a `GET` endpoint. Copying it verbatim fails in a way that reads like a permissions problem |
| **Files** | `src/remote/restClient.js` (`downloadReceipt`, with the probe table in its comment like every sibling method) · `src/remote/mockServer.js` (serve a fixture receipt on the real route shape) |
| **Tests** | 404 ⇒ `upstream_record_not_found`; 403/5xx ⇒ `upstream_unavailable` — the existing `src/shared/upstreamFailure.js` distinction, not a new one. Mock-server route shape matching the live one |
| **Done when** | The demo receipt downloads through the Sandbox **and** through the mock, byte-identical, with no decision behaviour changed yet |

---

### Step 5 · `E-1b` — the cost harness, before the model

The owner asked for this explicitly: *"for any large scale testing so to not
finish my api tokes, we need a owkraround."* Vision is the most expensive call
site this repository will ever have, and `CLAUDE.md` §6 records real credit
already burned once by a test suite.

| # | Piece | Detail |
|---|---|---|
| 1 | **Injectable `extractReceipt` seam** | The shape `classify`, `draftSummary`, `draftNarrative` and `judge` already use. Unconfigured ⇒ a deterministic fixture reader, never a live call |
| 2 | **Cache keyed on the SHA-256 of the receipt bytes** | Same receipt ⇒ extracted **once, ever**. Keying on bytes rather than expense id is what makes the portal's `<id>~fresh-<token>` copies share one extraction |
| 3 | **Recorded fixture corpus**, keyed by that same hash | `npm test`, `npm run simulate` and `npm run loadtest` cost zero |
| 4 | **Structural test that the suite cannot reach a vision endpoint** | Structural, not procedural — the same class of check as UC-08's "no POST route exists in the file" |
| 5 | **Size and dimension guard, and a per-run call budget** | Refuses rather than spends. A guard added after a bill is a guard added late |

**Done when:** a repeated extraction of the same bytes makes exactly one call,
and the whole suite provably makes none.

---

### Step 6 · `E-1c` — the vision pass itself

| | |
|---|---|
| **Behaviour** | Extract vendor, date, currency, total. Compare against Remote's record. Disagreement ⇒ `human_review` / `receipt_does_not_support_claim`. Unfetchable or unreadable ⇒ `human_review` / `receipt_unreadable` |
| **The three properties, pinned by test** | **Consulted last** (after every refusal the policy already had, so it cannot mask the real reason) · **can only ever refuse** (no return value means "approved", so no call site can be written that lets it fill a slot) · **additive**. Copy the test shapes from `test/approverAuth.test.js` — the pattern exists and is proven |
| **Files** | `src/uc02/receiptExtractor.js` (validated output shape, `source` tag per invariant 8, `withRetry`, `logTraceStep` per attempt) · `src/uc02/policyEngine.js` (the comparison gate — **deterministic**; the model returns fields, code decides whether they contradict) · `workflows/nodes-uc02/expenseGates.js` · `zaf-app/assets/panels.js` (image + the two readings side by side, never merged) |
| **Tests** | A **positive** case where the image agrees and the claim still auto-approves · each disagreement class · a test that no extracted number appears in the `PATCH` body · parity |
| **Done when** | Graph republished and verified; §16.9 and §16.10 satisfied |

> #### ⚠ One open question this step cannot answer for itself
>
> **An n8n Code node cannot fetch bytes and call a vision model the way the Node
> path can.** UC-08's retriever hit the same wall and the answer there was a
> deliberate split — the graph runs the dependency-free path, the parity test
> compares like with like, and `CLAUDE.md` §6 warns future readers not to "fix"
> it. UC-02 has three options and they are not equivalent:
>
> | Option | Consequence |
> |---|---|
> | HTTP Request node + Code node in the graph | Real parity; more graph surface; the vision key lives in n8n too |
> | Graph skips extraction; Node path does it | **The two paths would decide differently** — which is DRIFT-085's defect on UC-01, in a use case that moves money |
> | Graph calls back into `uc02-api` | Introduces the hard Node-process dependency the n8n architecture deliberately avoids |
>
> **Recommendation: option 1.** Option 2 is the one to refuse — UC-01 is already
> carrying an open finding for exactly that shape, and UC-02 writes money.
> **This needs a decision before Step 6 starts, not during it.**

---

### Step 7 · Sync the status, last

Only after each step lands, and **in the same unit of work as the step**:

- `docs/use-cases/UC-02.md:179` — *"Vision LLM / receipt image extraction | Not
  built — deliberately"* becomes built. **This row must not move before Step 6
  lands.** Marking something built while it is not is precisely the failure this
  register exists to prevent.
- §17's dispositions here gain a `BUILT` line, dated, naming the commit.
- `qa/SPEC-DRIFT-INDEX.md` rows move from *not yet built* to *done*, and the
  count line changes.
- `docs/BUILD-LOG.md` gains a §3.x write-up, and `CLAUDE.md` §4/§5/§7 are synced
  in the **same** unit of work — the continuity rule at the top of `CLAUDE.md`,
  which this repository has already paid for twice.

---

### What must NOT change, and why a builder might reasonably think otherwise

1. **Do not delete the receipt-existence gate** once `E-1` reads the file.
   DRIFT-088 says the gate is a tautology on the *webhook* path; it still guards
   the **portal** path, where a receiptless claim can be constructed.
2. **Do not delete the cap gate** as part of `E-2`. The finding was never *the
   cap is wrong* — it was *the cap's authorship is invisible at the moment it
   refuses somebody*.
3. **Do not let the extraction supply a figure**, even a "more accurate" one.
   The reviewer's job is to decide which reading is right; a corrected figure has
   already decided, and prime directive #1 forbids the model being the source.
4. **Do not provision `derived_receipt_hash` before `E-3`.** The migration is
   safe; making the SQL check as strict as the in-memory one is not.
5. **Do not import a cap from Remote.** There is nothing to import — checked
   twice, both directions, 2026-08-21.
