# UC-09 — Canonical Acceptance Contract

> **Off-Cycle Payroll / Adjustment & Tax Withholding · 🔴 High tier, and the one high-tier use case with a real execution path · Remote-native structured submission + portal free text (Zendesk intake exists and fails closed)**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-09.md` (§0–§19),
> `docs/research/UC-09 Chatgpt BUILD CASE.md`,
> `docs/research/UC-09 _ DRAFT 1 Enterprise Global Off-Cycle Payroll Architecture Research.md`,
> `docs/00-FOUNDATION.md` §5, `docs/adr/0005-dual-control-segregation-of-duties.md`,
> `src/uc09/{policyEngine,workflow,multiApprovalPolicy,adjustmentStore,approvalView,adjustmentParser,decisionFacts,server}.js`,
> `src/shared/{approverIdentity,money,upstreamFailure,escalationRouting}.js`,
> `src/review/approverEntitlement.js`, `src/approvalqueue/{approvalRoutes,awaiting}.js`,
> `src/portal/{server,ticketing}.js`, `zaf-app/assets/panels.js`,
> `workflows/nodes-uc09/{adjustmentGates,normalizeAdjustmentRequest}.js`,
> `test/uc09*.test.js`.
>
> **Intended business truth.** §17 records the divergences. No code or test was
> changed to produce this.
>
> **Decision pass 2026-08-21 — the ninth and last of the nine.** §0 records what
> was decided, §17 carries a disposition on each of the six original findings,
> §17b opens eight new ones (`DRIFT-110`…`DRIFT-117`) and §18 is the build queue
> (`P-1`…`P-34`, behind three measurements). Re-read against Remote's own live
> documentation for incentives, company managers and payroll, fetched
> 2026-08-21. **Still no code, test or workflow body was changed.**

---

## 0. DECISIONS — 2026-08-21

*The ninth decision pass, and the last of the nine. Six findings dispositioned
with the project owner, eight more opened by the pass itself (§17b), and a build
queue in §18. **No code, no test and no workflow body was changed to produce
any of it.***

**This pass changed its method again, and got different findings for it.** The
UC-08 pass stopped comparing the contract to `src/` and asked instead what
Remote's API actually publishes for the facts the specification assumes. This
one asked that question of a use case that **moves real money**, and the answers
did not merely correct the spec — three of them **inverted** it. The endpoints
the spec was unsure about all exist; the state machine it assumed they implement
does not. The control it declared absent exists at a different path. The control
it asked us to build is one Remote's own schema says we must not.

---

### 0.1 The finding: `pending` is not an approval state, and that settles DRIFT-051

`UC-09.md` §2 describes the trigger as *"an off-cycle adjustment is drafted in
Remote's own product … the automation runs its gates against that drafted
incentive"*, and §5 names the write as *"whichever write Remote's API uses to
move the already-drafted incentive out of pending status `[INFERRED — exact
endpoint/shape not yet confirmed]`"*.

Remote's own lifecycle documentation, fetched 2026-08-21
(`https://developer.remote.com/docs/working-with-incentives.md`):

> *"The status of an incentive depends on whether it is already associated to a
> payroll cycle or not. When the incentive is created and it is not yet
> associated to a payroll cycle, its status is `pending`. When the incentive is
> associated to a payroll cycle, its status can be `preparing`, `processing`, or
> `paid`."*

And on the object itself:

> *"Incentives are paid out through payroll on the next applicable cycle after
> the effective date."*

**`pending` means "not yet in a cycle". It does not mean "awaiting approval",
and there is no approval state anywhere in the lifecycle.** A `pending`
incentive is already going to be paid; the transition out of it is driven by
payroll-cycle association, not by any API call. So the write §5 went looking for
does not exist — **not because Remote's incentive surface is thin, but because
the state it was supposed to transition out of is not the state the spec thought
it was.**

Therefore **creation is the authorisation**, the code has been right all along,
and DRIFT-051's remedy (a) is taken: the trigger is a *request*, never a drafted
Remote object. `[CONFIRMED — Remote lifecycle documentation]`.

The consequence the finding named stands and is now sharper: **if §2 were ever
implemented on top of today's execution step, one adjustment would produce two
payments** — the admin's draft, already scheduled, plus our create.

### 0.2 The counter-finding: the webhooks exist, and they are worth more than an intake

DRIFT-051 was rated MEDIUM confidence because the pass that wrote it could not
verify whether a Remote incentive webhook exists, and `docs/INTAKE-RESEARCH.md`
recorded that Remote *"names none for incentives"*.

**Five exist**, in Remote's own documentation index: `incentive.created`,
`incentive.updated`, `incentive.paid`, `incentive.processing_started`,
`incentive.deleted` — alongside `GET /v1/incentives`, `GET /v1/incentives/{id}`,
`PATCH /v1/incentives/{id}` and `DELETE /v1/incentives/{id}`. The event payload
carries `event_type`, `incentive_id`, `employment_id` and `company_id`.
`INTAKE-RESEARCH.md`'s sentence is a **false negative about a third party's API**
— the same class §13's decay rule already covers, and DRIFT-117.

They are still not an intake, for the reason in §0.1. **They are a bypass
detector**, and that is the more valuable thing:

> An admin who creates an incentive directly in Remote's own product moves money
> with **zero** signatures. UC-09's floor of two is a control over the requests
> that come through UC-09. Nothing anywhere can currently see a payment that did
> not.

`incentive.created` sees exactly that. Reconciled against `uc09_adjustments`, it
answers *"which disbursements at this company have no signature behind them?"* —
which is DRIFT-054's integrity invariant **measured in the running system**
rather than asserted by tests over the policy engine. That distinction is the one
this repository keeps paying for in the other direction. `P-28`…`P-30`.

### 0.3 Three controls, three different answers — and only one of them is "build it as specified"

DRIFT-049 reported that three of the four deterministic controls `UC-09.md` §7
names do not exist. The absence is confirmed. **What each one should become is a
different answer per control, and two of the three are not what the finding
assumed.**

**(a) Manager authorization — build it; the endpoint the spec names does not
exist.** `UC-09.md` §3 lists `GET /v1/companies/{id}/managers`, tagged
**`[CONFIRMED]`**. That path is not in Remote's documentation index. The real
one is **`GET /v1/company-managers?company_id=`**, returning
`{company_id, user_id, user_name, user_email, role}` with all five required.
**A fourth `[CONFIRMED]` tag on an endpoint that does not exist** — after UC-05's
resignation endpoint, UC-06's `automatable` pre-check and UC-07's country
transfer. DRIFT-111.

The real endpoint is **better than the spec assumed**: `user_email` is comparable
against the ZAF-signed approver identity, so it anchors the *approver* as well as
the filer, where `APPROVER_ROLES` is our own grant list and Remote's is the
company's own roster.

Two honesty limits go on the screen with it. It lists **company** managers, not
*this employee's* line manager — it answers *"is the filer an authorised manager
at this company?"* and **not** *"does the filer have authority over this
employee?"*, and §9's fraud-control language must be corrected to the first.
And `role` is typed `string` with **no enum** (example `"owner"`), so it is
recorded and displayed, never made into a ladder.

**(b) The company off-cycle limit — it is ours, and it must say so.** Zero
matches for `off-cycle` or `off cycle` anywhere in Remote's documentation index.
Rung 1 cannot answer and rung 2 has nothing to read, so **the ceiling is a stated
policy figure** — rung 4, self-identifying, exactly like
`HIGH_TAX_COMPLEXITY_HEURISTIC` and carrying the same disclosure.

And it must **block**, not summon a third signature. Today there is no ceiling of
any kind: the high-value threshold only raises the count, so a €900,000
adjustment in a currency with no policy figure collects the same three signatures
as a €10,001 one. `P-19`, `P-20`.

**(c) Gross-to-net — Remote's own schema says do not compute it.**
`AmountTaxType`, verbatim:

> *"`net` indicates that the amount given is the amount which will be paid to the
> employee after taxes. **Remote will gross this up** to ensure the taxes are
> included and employee receives the amount requested without further reduction."*

Remote performs the gross-up. Computing our own figure would **fabricate money**,
which the substitution ladder forbids outright and which no amount of care makes
safe. So the honest control is **disclosure, not validation**: on a `net` request
the approver's screen must state that the company will pay **more** than the
figure shown, and that this system does not know how much more.

DRIFT-049's own recommendation guessed this — *"it may be that the honest control
is showing the approver that the company's cost is **not** the number on the
screen, rather than computing it"* — and marked it speculative. It is now settled
at rung 1. `P-21`, `P-22`.

### 0.4 Four traps found in passing, each of which would ship silently

1. **`findIntegrityBreaches()`'s premise is false for UC-09.** It flags any
   high-tier row reaching `auto_resolve` because *"`${c.useCase}` is high-tier and
   must have no execution path"*. UC-09 is the one 🔴 that deliberately **has**
   one. Route UC-09 rows into `cases` the obvious way and the dashboard
   manufactures integrity breaches on correct payments — which trains a reader to
   ignore the single alarm this use case exists to raise. **`P-24` before
   `P-23`.**
2. **`Idempotency-Key` is not documented by Remote anywhere**, and
   `#writeHeaders()` defaults it to `randomUUID()` when no key is passed — a
   fresh key per call, which guarantees a retry is treated as new. `createIncentive()`
   does pass a stable key, so the money path is the one write that is not
   idempotency theatre; but **the guarantee it rests on is unpublished**, which
   is a materially different claim from the one §10 makes. Remote's own documented
   anti-duplicate mechanism is the `note` field. DRIFT-113, `M-3`, `P-9`.
3. **Remote publishes two status vocabularies for one object.** The lifecycle
   guide says `pending` / `preparing` / `processing` / `paid` / `deleted`; the
   API reference's own property description says *"(e.g., `pending`, `scheduled`,
   `paid`, `cancelled`)"*. The property is typed `string` with **no enum**. No
   status gate may be built on either list. DRIFT-114.
4. **Remote publishes `type_label`** — *"The human-readable label for `type`
   (e.g., \"Signing bonus\", \"Commission\", \"Severance\")"*. `zaf-app/assets/panels.js`
   rearranges our own slug into `"retroactive pay"` instead. We are supposed to
   implement Remote's product, not restate it in our own words where they have
   published theirs. DRIFT-112.

### 0.5 The six dispositions in one line each

| Finding | Disposition |
|---|---|
| **DRIFT-049** | **BUILD ALL FOUR**, three different answers — manager auth at the real endpoint (a), an owned ceiling that blocks (b), gross-to-net as disclosure never computation (c). `P-16`…`P-22` |
| **DRIFT-050** | **ENFORCE, reading (A).** The filer may fill the `requester` slot **only**, never `approver` or `payment_releaser`. Floor of two signatures unchanged. `P-1` |
| **DRIFT-051** | **RECONCILE — remedy (a).** Creation is the authorisation; §2/§5's trigger model is rewritten as a *request*. Settled at rung 1, against the spec. `P-31`, `P-34` |
| **DRIFT-052** | **RECONCILE.** §5 corrected to match §6 and the code; the figure is echoed back for confirmation by the person who stated it, **before** any signature is collected. `P-3`…`P-6` |
| **DRIFT-053** | **RECONCILE, wider than written.** Every UC-09 outcome is silent, not only the in-doubt one. Four parts, and the fourth makes in-doubt *resolvable* rather than merely recorded. `P-7`…`P-15` |
| **DRIFT-054** | **RECONCILE + build into the metrics layer.** Second source, accept rate, the integrity invariant as a query that must read zero, and the bypass reconciliation. Closes tracking issue #20. `P-23`…`P-30` |

### 0.6 The decision the owner took, stated because it overturns a document

**DRIFT-050, reading (A): the filer may sign the `requester` slot and nothing
else.** Minimum two humans for any payment, three above the floor.

The alternative, reading (B), was ADR 0005's literal words — *"the requester may
not fill **either** approval slot"* — applied as UC-06's `[A-2]` applied them,
making slot 1 an independent employer signatory and the minimum three humans.
(A) was chosen: it is what `00-FOUNDATION.md` §5 says (`requester ≠ approver ≠
payment releaser` names three **parties**, and a party that signs nothing is not
a party to the control), it is what the sidebar's own prose already promises the
requester slot decides — *"that the adjustment is the one they asked for"* — and
it keeps the floor's cost where every document already puts it.

**ADR 0005 is corrected in the same unit of work**, because it currently asserts
the opposite *and* cites UC-09 as the exemplar that already holds it. See §0.7.

### 0.7 The correction that must land even if the build slips

ADR 0005 gained a segregation clause on 2026-08-21, during UC-06's pass:

> *"**the requester may not fill either approval slot.** UC-01 holds this
> (`self_approval`) and **UC-09 holds it in its strongest form (requester ≠
> approver ≠ payment_releaser, `src/uc09/multiApprovalPolicy.js`)**. UC-06 did
> not…"*

**UC-09 does not hold it.** `multiApprovalPolicy.js:105–121` compares the three
approval **slots** to each other and never compares any of them to
`adjustmentRow.requester`. The clause was added to fix UC-06 and, in the same
sentence, **published a false statement about the one use case that moves money**
— in the document a reader auditing the control goes to first, naming the file
they would go to second.

That is a new failure mode this repository has not recorded before: **a
correction propagating a false claim.** The UC-06 pass verified UC-06 and took
UC-09 on trust because UC-09 was the stricter-looking case. `docs/WHY-THIS-SHAPE.md`
§18 now teaches it. DRIFT-110.

It is called out separately from `P-1` because the two have different costs.
`P-1` is a handful of lines and can wait for a queue. **The ADR's sentence is
being read right now by anyone auditing four-eyes**, and its correction is the
one item in this queue whose delay is paid by somebody else.

### 0.8 The change scheme, and why it is a ninth non-corresponding one

`P-1`…`P-34`. UC-01 numbers `G-1`…`G-4`, UC-03 letters `G-A`…`G-C`, UC-02 `E-`,
UC-04 `W-`, UC-05 `N-`, UC-06 `A-`, UC-07 `R-`, UC-08 `T-`. **Nine schemes, none
corresponding.** `CLAUDE.md` §7 item 20 is why: this repository already has two
registers both numbering findings `C-N` with code citing both, and a reader
following a citation can land in the wrong one.

### 0.9 What was NOT decided

- **The two implied routes** (UC-06 → UC-09, UC-05 → UC-09) are dispositioned in
  §12 as **refused for now on the same merit UC-07 and UC-08 refused theirs** — a
  use case may read another's records, never invoke it — but the *reading* half
  is left open as `P-33`, because a UC-05 PTO payout genuinely has nowhere to be
  paid and that is a product gap, not a routing one.
- **Whether the ceiling is per-currency or a single figure with conversion.**
  Recorded as `Q-2` in §18's open questions; the per-currency table already
  exists for the high-value threshold and is the obvious shape, but conversion is
  the trap UC-09 already has one finding about.
- **Whether `payment_releaser` should be summoned by the ceiling too.** Today
  three dimensions summon it; a ceiling that blocks does not need to, and adding
  it would blur "too big to approve here" with "needs another pair of eyes".

---

## 1. Business purpose

Somebody was paid the wrong amount, or is owed something the regular cycle will
not carry — a relocation top-up, a bonus correction, a withholding fix. The
correction has to be made outside the normal payroll run, which means it has
none of the protections a normal run has: no cutoff, no batch review, no second
set of eyes arriving by default.

UC-09 prepares that correction completely — the figure, its currency, whether it
is gross or net, the Remote record that would be written — and then **refuses to
pay it until at least two different named people have signed for it**. That
refusal is the product. It is why this is the only 🔴 use case allowed to
execute anything at all: 🔴 High tier's rule is *"AI never executes
unilaterally"*, not *"AI never executes"* (`00-FOUNDATION.md` §5), and UC-07 and
UC-08 satisfy it by having no write path while UC-09 satisfies it by putting an
unwaivable floor of two humans in front of one.

The raw research this is built from proposed the opposite. `UC-09 _ DRAFT 1`'s
approval matrix specifies **"Tier 1: Auto · System Automated · Direct commit; no
human sign-off required"** for low-composite-risk adjustments, and a Tier 2 with
a single signature (`DRAFT 1`, the tier table at lines 926–949). That is a real
bank payout authorised by a score. `01-COHERENCY-MAP.md` marks it as **a defect,
not merely an older version** — the one place in the nine where the coherency
pass rejected a source document's content rather than preferring a newer one.
Both tiers are rejected outright at any score. What survives of the score is
permission to require a **third** signature, never permission to require fewer.

## 2. Primary operator persona

**Role:** a **company admin** asks for the adjustment; a **Remote payroll
specialist** decides whether it should be paid; a **payment releaser** is
summoned only above the floor, for the specific risk that summoned them.
**Experience/knowledge:** the admin knows the employee, the amount and why it is
owed. The specialist knows payroll, knows what an off-cycle payment costs to
unwind, and knows that a wrong figure here is not recoverable by editing a row.
**Typical working context:** the requester is in Remote's own product or the
request portal; the two signers are on a Zendesk ticket with the sidebar open,
often days apart and never in the same room.
**They understand:** who is being paid, how much, in what currency, on what
gross/net basis, why, and how many signatures this one needs.
**They DO NOT know:** that amounts are stored as ×100 integers; that
`amount_tax_type` is a Remote enum; what `approvalSlotsRequired`,
`pending_approval`, `executing`, `high_amount_threshold_not_comparable` or
`schema_invalid` mean; that `POST /v1/incentives` is the write; that the
high-tax-complexity country list has no authority behind it unless the screen
says so; and that the third signature is only ever *added*, never substituted.
**Added 2026-08-21:** they also do not know that on the intake that works today
**a language model read the figure out of the requester's sentence**
(DRIFT-052), or that on a `net` request **the company pays more than the number
on the screen** because Remote grosses it up and this system does not know by
how much (§0.3c). Both are now the requester's and the approver's business, and
both go on the screen.

## 3. Job to be done

*Admin:* "Get this person the money they are owed, off-cycle, and let me see
that I asked for the right figure before anyone signs."
*Payroll specialist:* "Tell me what leaves the company, on what basis, why this
many signatures, and who has already signed — then let me decide whether it
should be paid at all."
*Payment releaser:* "Tell me which specific risk brought me here, and on what
evidence, before I release money."

## 4. Starting preconditions

- An employment record exists at Remote, resolves, and is `active`.
- The requester holds an authenticated session carrying a **real company id**,
  and it equals the employment's own `company_id`. Both sides must be truthy —
  `null === null` used to pass this gate (`UC-09.md` §15 defect 4).
- **The requester is a manager Remote itself recognises at that company**, read
  from `GET /v1/company-managers?company_id=` — an authorisation to act for the
  company, not authority over this particular employee, and the screen says which
  of the two it checked (§0.3a, `P-16`…`P-18`). **Not built; gated on `M-2`.**
- **The filer may fill the `requester` approval slot and no other.** Two distinct
  signatures are still the floor; what changes is that one of them may no longer
  belong to whoever asked for the payment (DRIFT-050, `P-1`). **Not built.**
- The adjustment names: an incentive `type` Remote actually accepts (one of the
  21 members of `INCENTIVE_TYPES`), a positive amount, a currency, and **whether
  that amount is gross or net**. The last is never defaulted.
- The amount is a usable integer in Remote's ×100 form by the time the money
  guard runs. Structured input is trusted as already scaled; free text is scaled
  exactly once, by the workflow.
- The prepared payload carries every field Remote's own
  `CreateOneTimeIncentiveParams.required` array names: `type`, `amount`,
  `amount_tax_type`, `employment_id`, `effective_date`.
- For execution: two — or three — **different** people, each entitled to the
  role they are filling, have approved.

## 5. Main successful journey

1. A company admin asks for an off-cycle payment for a named employee, stating
   the amount, the currency, and whether it is gross or net.
2. The system confirms the requester is authenticated and acts for this
   employment's company. If it cannot, no approval path opens at all.
3. It confirms the employment is live. Paying someone who has left, off-cycle,
   is both the classic error and the classic fraud.
4. It reads the request into a complete, well-formed payment record. If it
   cannot establish the figure it **refuses to guess** and says so, quoting the
   request back so a human can supply the number.
5. It checks the record against what Remote actually requires — before asking
   anybody to sign. A request that could never be written is not worth two
   people's signatures.
6. It works out how many signatures this payment needs: **two, always**, and
   three when a named risk dimension fires. It states which dimension, with the
   figures, and where its answer came from.
7. The requester sees exactly what was understood: the person, the amount, the
   currency, the gross/net basis, the type, and how many people must sign — and
   **confirms the figure**, because on the intake that works today a model read
   it out of their sentence and they are the last person present who knows the
   right one (DRIFT-052, `P-3`…`P-6`). A `net` request states here that the
   company's cost is higher than the figure shown and that this system does not
   know by how much.
8. A payroll specialist opens the ticket, sees the same facts plus who has
   already signed and which roles are outstanding, and approves.
9. When the last required signature lands — and only then — the system re-reads
   the employment to confirm it is *still* active, takes an exclusive claim on
   the row so no second approval can execute the same payment, and writes the
   incentive to Remote once.
10. The payment is recorded as executed, naming who signed each slot and what
    Remote answered.
11. **The people who need to know are told, on the ticket that already exists.**
    The requester learns it was approved, by whom, and **when the money is
    expected** — Remote answers `expected_payout_date` on the incentive and
    nothing in this system reads it today. A denial and an in-doubt write reach
    the same channel (DRIFT-053, `P-7`…`P-15`). **Not built: nothing in
    `src/uc09/` writes to Zendesk at all.**

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Well-formed adjustment, amount comparable and under the high-value line, no manual tax override, country not on the heuristic list | `dual_approval_required` / `standard_adjustment_needs_dual_approval`, **2 slots** | Two different people sign; one `POST /v1/incentives` |
| Amount over the high-value line **in the currency the line is stated in** | `triple_approval_required` / `high_risk_adjustment_needs_triple_approval`, flag `high_amount_risk`, **3 slots** | A third pair of eyes, and the screen states the amount, the threshold, the overage and the percentage over |
| Amount in a currency for which **no policy figure exists** | 3 slots, flag `high_amount_threshold_not_comparable` | **Not compared, never "under the line."** An unknown costs a third signature rather than buying two |
| Manual tax adjustment requested | 3 slots, flag `manual_tax_adjustment` | No autonomous tax math anywhere; a human authors it |
| Employment country on the high-tax-complexity list (DE/FR/IT) | 3 slots, flag `high_tax_compliance_risk` | And the record says the list is **unsourced**, in the audit row and on the approver's screen |
| Country **not** on that list | 2 slots, and the screen says `assessed: false` — *NOT ASSESSED* | A country's absence from an unsourced list is not a finding that its payroll tax is simple |
| Exactly on the high-value line | 2 slots — the line is exclusive; one unit over is 3 | Pinned by test |
| Free text, model available | Parsed, tagged `source: "llm"`, scaled ×100 once, then gated exactly as structured input | |
| Free text, model unavailable or answering badly | `escalate` / `amount_not_extracted`, flag `parser_llm_not_configured` \| `parser_llm_parse_failed` | A record is still written and the ticket quotes the request, so the human can supply the figure |
| Amount not an integer (string, null, NaN) and it is the first thing wrong | `escalate` / `unparseable_amount` | No approval path opens |
| Amount unusable but an **earlier** gate already refused | The earlier gate keeps the reason; the amount rides along as a flag | Fixed defect F-33b — the amount refusal used to overwrite identity and status refusals, making both gates unobservable |
| Identity unverified | `escalate` / `identity_not_verified`, 0 slots | No route to a payment exists from here |
| Employment not active | `escalate` / `employment_not_active`, 0 slots | Payment to a leaver is a different process |
| Structure malformed (unknown type, no currency, no gross/net) | `escalate` / `invalid_adjustment_structure` with the specific flags | |
| Payload missing a Remote-required field | `escalate` / `schema_invalid` | Nobody is asked to sign an unwritable record |
| Employment read 404s | `escalate` / `upstream_record_not_found` | Distinct from an unverified identity — proven live: row `105cd7c4` (1 upstream failure) vs `590772ee` / `identity_not_verified` (0) |
| Employment read 403/5xx/transport | `escalate` / `upstream_unavailable` | The request was never evaluated; that is a different sentence |
| One approver signs, nobody else | `approved_awaiting_more`, with the count | Nothing is paid. See §11 — this state has no expiry and no reminder |
| A signer denies | `denied` — ends it for every role | The request has to be filed again; no payment |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Same person under a different spelling** | `same_person_cannot_fill_multiple_roles`. Comparison is canonicalised — NFKC, trim, collapse whitespace, lowercase, and a cross-script confusable fold (`src/shared/approverIdentity.js`). `"admin_jane"`, `" Admin_Jane "`, and a Cyrillic-а spelling are one human. **The raw string is what the audit log records; only the comparison is normalised** |
| **Two approvals fire simultaneously against the last slot** | Exactly one `createIncentive`. A compare-and-set (`pending_approval → executing`) that one caller wins; the loser gets `execution_already_claimed` **having still recorded its own approval**. Before this fix, two concurrent approvals produced two real disbursements for one $5,000 adjustment |
| **Duplicate webhook delivery** | One claim on `(UC-09, external_ref)`, one record, one audit row. The second returns `duplicate: true` |
| **A ref-less request** | Claimed under a synthesised ref rather than dropped — both key columns are NOT NULL |
| **`approvalSlotsRequired` missing or malformed on the row** | Read as **2**, never as 0. `1 >= null` is `true` in JavaScript, and that is how a single approval once executed a payment |
| **Three slots filled by two humans on a 3-slot adjustment** | Not fully approved. `isFullyApproved()` counts **distinct canonicalised humans** and requires `>= required`, not `>= Math.min(required, 2)` (F-36) |
| **Employment goes inactive between decision and approval** | Freshness re-read before the write; `employment_no_longer_active` (409), **claim released** because nothing was written |
| **`createIncentive()` throws** | The claim is **deliberately NOT released**. The row stays `executing`, `executedAt` null, a further approval is refused `execution_in_progress`, and exactly one attempt was made. Releasing would hand the retry button to the one situation where pressing it might pay twice. See DRIFT-053 for what is missing around this |
| **Retry of a write that may have landed** | The idempotency key is the adjustment's own id — stable across internal retries and a manual re-submission |
| **A structured caller sends major units** | **Not detected.** Structured input is trusted as already ×100 by design (the alternative — a magnitude heuristic — was removed as a 100× money bug). The portal therefore offers **no amount field at all** for UC-09 |
| **A `$0.00` payload from a missing amount** | Impossible: no amount, no payload. `toRemoteInteger(amount \|\| 0)` once manufactured a well-formed zero-dollar incentive (F-37) |
| **Gross/net not stated** | The request stops. Never defaulted — the same integer moves a different sum under each reading, and Remote grosses a `net` figure **up** |
| **An unresolvable employment id plus an unparseable amount** | Escalates and is audited. This intersection used to throw a `TypeError` before any audit row existed: HTTP 500, request gone, nobody told (F-33a) |
| **Faithfulness judge** | Informational only, never a gate. Given the figure in the units the prose uses — it once returned `not_faithful` on 100% of correct adjustments, which trains an approver to ignore the one drift alarm on the money path |
| **Approver not entitled** | Refused **last**, after every refusal the policy already had. `approver_entitlement_not_configured` is deliberately a different refusal from `approver_not_entitled` |
| **Zendesk-sourced adjustment** | Always `identity_not_verified`. A ticket carries no Remote company id, and deriving one from the record about to be gated would be self-verifying identity |
| **Filer tries to sign `approver` or `payment_releaser`** | **Decided 2026-08-21, not built.** Refused by its own name — not `same_person_cannot_fill_multiple_roles`, which is about two slots and would send a reader to the wrong control. The filer may sign `requester` and nothing else (DRIFT-050, `P-1`) |
| **Filer is not a manager Remote recognises** | **Decided, not built.** Escalates rather than blocking: an unrecognised manager is a fact about the roster, not proof of bad faith, and Payroll Ops can see the roster (`P-17`). Gated on `M-2` — building this against an empty collection ships a gate that cannot fire |
| **Amount above the company off-cycle ceiling** | **Decided, not built.** `blocked`, with the figure, the ceiling and **the fact that the ceiling is ours and not Remote's** on the screen. Today there is no ceiling of any kind — the high-value line only summons a third signature (`P-19`, `P-20`) |
| **In-doubt write, afterwards** | **Decided, not built.** Resolvable rather than merely recorded: the adjustment id goes into Remote's own `note` field, and `GET /v1/incentives` then answers *did it happen?* instead of a human guessing (§0.2, `P-9`, `P-15`) |

## 8. Invariants — must never happen

1. **No adjustment is ever paid on fewer than two distinct human approvals, at
   any risk score.** `Math.max(2, …)` in both copies of the gate; `isFullyApproved()`
   floors a malformed requirement at 2; the floor is asserted over a 320-input
   grid in `src/` and over the same grid in the n8n port.
2. **No risk score, list, flag or threshold may ever *lower* a signature
   requirement.** Structurally guarded: every per-currency threshold row must be
   `<=` the base line, asserted over the table itself, so a "policy addition"
   that would make some amount cheaper to approve fails the suite.
3. **The one real write is reachable only through `isFullyApproved()`.** There is
   exactly one production call site of `remote.createIncentive()`.
4. **The same human never fills two slots**, whatever the spelling — **and, as
   of 2026-08-21, the human who *asked* for the payment fills only the
   `requester` slot.** Those are two different controls sharing one word: the
   first compares slot to slot and is built; the second compares the
   `adjustment_row.requester` **column** to each slot and is not (DRIFT-050,
   `P-1`). `00-FOUNDATION.md` §5, ADR 0005 and `UC-09.md` §8 all describe the
   second; only the first exists.
5. **A third signature is only ever added above the floor, never substituted for
   it.**
6. **An LLM never authorises, approves, or releases a payment**, and a figure it
   could not establish is a refusal, never a guess.
7. **Money is scaled ×100 exactly once.** Free text is scaled by the workflow;
   structured input is trusted as already scaled; nothing rescales twice and
   nothing coerces a numeric string.
8. **No payload is built from a value nobody supplied** — no amount, no payload;
   no gross/net, no payload; no employment, no payload.
9. **A decision is durable before any outward act**, and each human's approval is
   audited **before** the state moves and before the write fires.
10. **An in-doubt write is never automatically retried.** The row stays claimed.
11. **`escalate` opens no approval path at all** — which is the opposite of the
    floor being lowered, and the screens must say so in those words.
12. **The approver-entitlement check can only ever refuse**; it has no return
    value meaning "approved", so it can never fill a slot or satisfy a floor.
13. **This system never grosses up a net figure, and never prints a company cost
    it computed itself.** Remote performs the gross-up (`AmountTaxType`,
    §0.3c); a figure we derived would be fabricated money, which the
    substitution ladder forbids outright. The control is the *disclosure* that
    the cost is higher and unknown here — never an arithmetic. **Decided
    2026-08-21; the disclosure is not built** (`P-21`).
14. **An attempt to move money is durable before it is made.** Today a throwing
    `createIncentive()` leaves the last audit row at `adjustment_approved`, so
    the one state where money may have left the account is the one state with no
    record of an attempt (DRIFT-053, `P-12`). **Not built.**

## 9. AI responsibilities

**The LLM may:** read a free-text adjustment request into a structured proposal
(type, amount in major units, currency, gross/net, description, dates, whether a
manual tax override was asked for); draft the one-line summary a human signs.

**The LLM must never:** execute a disbursement, approve, occupy an approval slot,
influence how many signatures are required downward, or perform statutory
withholding math.

**Stated honestly, because the spec is not:** on the only intake that works in
production today, **the model *is* the source of the payment figure.** §5 of
`UC-09.md` describes the seam as *"restatement only, same narrow seam as UC-06's
changeParser; never the source of the numbers"*, and that is not what is built —
see DRIFT-052. What genuinely constrains it: the answer is validated strictly
(finite number > 0, three-letter currency, non-empty type; a numeric **string**
is rejected rather than coerced), `amountTaxType` is never coerced to a member,
a failed or unconfigured model **refuses** rather than falling back to a rule,
the type is checked against Remote's own 21-member enum, and the figure appears
in major units in the sentence two or three humans sign before anything is paid.

**And the mitigation that is missing, decided 2026-08-21.** Every constraint
above is a *shape* check — a model that answers `1250.00` for *"twelve thousand
five hundred"* satisfies all of them. The only thing that catches a
plausible-but-wrong figure is the person who stated it, and today they are never
asked: the portal returns a result page, not a confirmation. `P-3`…`P-6` add the
echo-back **before any signature is collected**, which is the one moment the
person who knows the right number is still present. Until it exists, §9's honest
sentence is that the parse is checked for form by the machine and for **truth**
by nobody.

## 10. Deterministic responsibilities

Identity and company match (both sides truthy) · employment status · structural
completeness including the gross/net basis · the incentive-type enum · payload
validation against Remote's own `required` array · the ×100 money guard · the
signature-count sizing and its `Math.max(2, …)` floor · segregation of duties by
canonicalised identity · the execution claim · the freshness re-read · the
idempotency key · audit ordering · role entitlement, consulted last.

**Three qualifications this contract states rather than implies.**

- **There is no composite risk score.** §7 of the spec names one; the code has
  three independent boolean dimensions (value, manual tax, jurisdiction), any of
  which sets the requirement to 3. Nothing is composed, weighted or scored. This
  is a simplification in the safe direction and it is worth knowing before
  someone goes looking for the scorer.
- **One of those three dimensions is unsourced, and says so.**
  `HIGH_TAX_COMPLEXITY_HEURISTIC` carries `basis: "unsourced_heuristic"`, a null
  authority, an explicit `[PROPOSED]` provenance string and the list of what a
  real version would need. It travels into the audit row and onto the approver's
  screen. The harm runs in the direction people do not expect: for DE/FR/IT it
  only ever raises the count, so the danger is a genuinely complex jurisdiction
  **absent** from the list collecting two signatures instead of three — which is
  why the absence case reports *NOT ASSESSED* rather than passing quietly. This
  is recorded in `UC-09.md` §17 and in `docs/KNOWLEDGE-SOURCES.md` §1 Test B and
  is deliberately not re-numbered here.
- **Three of the four deterministic controls the spec names do not exist**, and
  as of 2026-08-21 each has a decided and *different* destination — see DRIFT-049
  and §0.3. **Manager authorization** is to be built, at
  `GET /v1/company-managers?company_id=` and **not** at the
  `GET /v1/companies/{id}/managers` §3 tags `[CONFIRMED]`, which is not a path
  Remote publishes. **The off-cycle limit** is not a Remote fact at all — the
  string `off-cycle` appears nowhere in Remote's documentation index — so it is a
  stated policy figure, rung 4, self-identifying, and it must **block** rather
  than summon a third signature. **Gross-to-net validation must never be built**:
  Remote's own `AmountTaxType` says Remote performs the gross-up, so the control
  is a disclosure that the company's cost is higher and unknown here.
- **The idempotency guarantee on the one money-moving write is unpublished.**
  `#writeHeaders()` sends `Idempotency-Key` on every write and **Remote documents
  it nowhere**; where no key is passed it defaults to `randomUUID()`, which is a
  fresh key per call and therefore no guarantee at all. `createIncentive()` does
  pass a stable key — the adjustment id — so the money path is the one write not
  relying on that default, but it rests on a header Remote has not promised to
  honour. Remote's own documented anti-duplicate mechanism is the `note` field.
  DRIFT-113; `M-3` measures it before anything is built on it.

The gates exist twice — `src/uc09/policyEngine.js` and the *Adjustment Gates*
Code node. `test/uc09ApprovalFloor.test.js` runs the deployed node body against
the same 320-input grid and asserts identical decision, reason, flags and slot
count, and that the port holds the floor too. `flags` is compared field for
field, which is why `riskBasis` was added as a *key* rather than a flag.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Every adjustment that clears the gates. There is no auto-pay branch and no score that produces one |
| **Who** | **Two roles minimum, three above the floor** — `requester`, `approver`, and `payment_releaser` only when `approvalSlotsRequired` is 3. All must be different humans by canonicalised comparison, and each must hold the entitlement for the slot they fill (`uc09:requester` / `uc09:approver` / `uc09:payment_releaser`) |
| **Where** | Zendesk, the Remote CX Review sidebar's UC-09 panel (two or three role blocks). `POST /uc09/api/adjustments/:id/approve\|deny`. **The verb is `deny`, not `decline`** — the one row in the system that spells the refusal differently, and offering the wrong word sends a specialist hunting for a button that is not there. ⚠️ **And for one of the three roles that is nowhere the role-holder can reach.** The sidebar is a Zendesk **agent** surface; `UC-09.md` §1 names the requester as the *Customer Admin*, who is not a Zendesk agent, and `src/portal/server.js:46` states the portal *"offers no approve/decline anywhere"*. So the `requester` slot's control renders only in the sidebar and `cli.js`. `P-3` gives that role its own surface — a confirmation and attestation screen, **never** an approve control for the other two slots |
| **Owning team** | Payroll Ops (`queue_payroll_ops`, `escalation_payroll_ops`, priority `urgent`). The group exists in the live account |
| **Evidence needed** | The employee by name, status, contract type and country — not a UUID; the amount, its currency and **whether it is gross or net**; the adjustment type in words; **why this many signatures**, dimension by dimension with figures; **who has already signed and which roles are outstanding**; and which basis was unsourced |
| **After the last approval** | Freshness re-read → claim → one `POST /v1/incentives` → durable audit → row marked executed |
| **After a denial** | Ends for every role. The request must be filed again |
| **Expiry** | **None.** No approval in this system expires — DRIFT-041. Here that means a half-signed payment stays half-signed indefinitely, and a payment scored today can be released next month against a risk picture nobody re-computed |
| **Reminders** | **None.** Nothing chases the second or third signer |
| **If nobody responds** | The record sits at `pending_approval` forever. The approval queue does list it as awaiting — but see DRIFT-053 for the one state it lists as *settled* while a human is in fact needed |
| **What anyone is told** | ⚠️ **Nothing, at any point, by any channel.** Every UC-09 decision raises a Zendesk ticket (`NO_TICKET_DECISIONS.uc09 = []`, so no decision is exempt) and **nothing in `src/uc09/` ever writes to Zendesk again** — no comment verb appears anywhere in the directory. Approved, denied, executed, in-doubt: the ticket that was raised at intake is never updated. DRIFT-053 named this for the in-doubt state; it is true of all four (DRIFT-115, `P-7`…`P-11`) |
| **When the money arrives** | **Not read.** Remote answers `expected_payout_date` on the created incentive — *"the expected date when this incentive will be paid to the employee"* — and it is the one fact the person being paid actually wants. Nothing in this repository captures it (DRIFT-116, `P-8`) |

## 12. CROSS_UC_ROUTING

**May receive from**
- **Nothing. No inbound cross-UC route exists in either direction.** The single
  built route in the whole system is UC-03 → UC-04.
- Intake is: a structured submission carrying a real Remote session (the
  Remote-native shape), the request portal's free-text form, or a Zendesk ticket
  — which reaches the gates and always fails identity closed, by design.

**May route to**
- Nothing. UC-09 terminates in an execution, an escalation, or a denial.

**Routing conditions**
None exist. Two are argued for below and neither is built.

**Context that MUST transfer**

Nothing transfers today, because nothing routes. Stated against the eight
headings so that a future route is not built without them:

| | Carried | Notes |
|---|---|---|
| Customer/user identity | ❌ n/a | Any inbound route must carry a company-admin session, because UC-09's identity gate compares `session.companyId` to the employment's `company_id` and nothing else satisfies it. A route that arrives with a Zendesk requester will land on `identity_not_verified` every time |
| Employment/entity identifier | ❌ n/a | |
| Zendesk ticket / reference | ❌ n/a | `external_ref` and `source` are persisted on the row precisely because approval happens in a different process, days later — a route must set both |
| Trace / correlation id | ❌ n/a | |
| Evidence already gathered | ❌ n/a | An inbound UC-05 or UC-06 case holds the figure, the currency and the reason. None of it has anywhere to go |
| Decision / risk information | ❌ n/a | |
| Approvals already obtained | ❌ n/a | **And any future route must NOT import them.** A signature collected in UC-06's dual-control gate is not a signature on a UC-09 disbursement; carrying it across would satisfy this floor with approvals given for a different question |
| Relevant conversation | ❌ n/a | |
| Other required state | ❌ n/a | The **gross/net basis** has no equivalent in UC-05's or UC-06's records, so any route would arrive missing the one field that is never defaulted |

**Two routes the business relationship implies and the code does not have**

- **UC-06 → UC-09.** `UC-06.md` calls an amendment landing after the cutoff lock
  a *retroactive payroll error*. A retroactive correction to pay already run is
  precisely an off-cycle adjustment. Today it escalates to Payroll Ops as prose
  and a human re-keys it into this use case, or does not.
- **UC-05 → UC-09.** A resignation with a PTO payout produces a computed, signed
  figure that no execution path anywhere in this system can pay — `UC-05.md`
  records that it has no real write endpoint, so its signed report is the
  artifact. UC-09 owns the only write that could pay it.

**DISPOSITION — 2026-08-21. Both routes are refused, on the merit UC-07 and
UC-08 refused theirs, and the *reading* half of one is kept open.**

DRIFT-011 and DRIFT-021 were resolved in UC-08's pass by answering a routing
request with a **read**, and the rule that came out of it applies here unchanged:
**use cases connect through shared reference data and through reads of each
other's records, never by one invoking another.** A UC-06 amendment that lands
after the cutoff lock must not be able to *open* a disbursement — that would let
a 🟡 gate originate a 🔴 payment, and the approval floor would then be protecting
a request nobody in Payroll Ops had ever seen arrive.

The half that is **not** disposed of, because it is a product gap rather than a
routing one: **a UC-05 PTO payout is a computed, signed figure that no execution
path in this system can pay.** `UC-05.md` records that its signed report is the
artifact because no write endpoint exists there; UC-09 owns the only write that
could. Refusing the route does not make that figure payable. Kept open as `P-33`
and as `Q-3` in §18 — the candidate answer is that UC-09 *reads* the signed UC-05
report as evidence on an adjustment a human filed, which keeps the filer, the
gates and the floor intact and carries the number without carrying a decision.

**Must NOT happen during handoff** *(assessed against the hypothetical routes,
since no route exists to observe)*
- ❌ Customer repeats information. *n/a — unverified.* A UC-06 hand-off today is
  a human re-keying a figure, which is exactly this hazard occurring outside the
  system where nothing measures it.
- ❌ Duplicate work created. ⚠️ **At risk** for any future route: UC-09's
  exactly-once key is `(UC-09, external_ref)`, so a route that mints a new
  reference rather than carrying the origin's would let one correction be paid
  twice through two records.
- ❌ Audit continuity lost. ⚠️ **At risk** — see above.
- ❌ Approval state lost. *Satisfied by construction, and must stay so:* no
  approval may cross a route into this use case (see the table).
- ❌ Ownership ambiguous. *Satisfied.* One owning team, one name, `Payroll Ops`,
  used consistently in the routing table and the queue.
- ❌ Two UCs execute conflicting actions. ⚠️ **At risk** — UC-06's `PATCH` to
  basic information and a UC-09 incentive are two different ways to correct the
  same underpayment. Nothing anywhere would notice both happening.
- ❌ Duplicate Zendesk tickets. ⚠️ **Unverified** by any test found in this pass.
- ❌ Identity or persona silently swapped. *Satisfied today* — there is no route
  to swap through, and the identity gate refuses anything that is not a
  company-admin session rather than degrading to it.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Portal (company admin)** | Free text only, and the stated reason is **our** ambiguity, not a product decision: `src/portal/server.js`'s own comment says a field labelled "amount" would sit on the boundary where structured input is trusted as already ×100 while free text is scaled by the workflow. Decided 2026-08-21: name the two units apart and the field becomes safe (`P-5`). The result states the decision, the deciding gate in plain words, and "approvals required before any money moves" as a **statement**, never a bare `0` — and, once `P-3` lands, **asks the requester to confirm the figure a model read out of their sentence** |
| **Zendesk ticket** | Tagged `uc09`, `queue_payroll_ops` (or `escalation_payroll_ops`), priority urgent. The note names the employee, the figure with its currency and gross/net basis, the type in words, and — on a refusal — quotes the original request so a human can supply the figure |
| **ZAF sidebar (UC-09 panel)** | Two or three role blocks in `<fieldset>`s with legends; an approval meter showing filled/required; the employee **by name** with status, contract type and country; the requester block stating that the requester can never also be the approver; the signature-requirement explanation dimension by dimension. This is the one panel of nine that does not print a bare UUID under "Employee" (DRIFT-042) |
| **Approval queue** | `pending_approval` → awaiting. `escalated` → handling. **`executing` → *settled*** — correct for the two-second window between the last signature and the write, wrong for a wedged in-doubt row (DRIFT-053, `P-13`). The queue's stated headline is *the work that cannot move*, and the one row that truly cannot is the one it reports as done |
| **Live Feed / audit viewer** | `dual_approval_required` / `triple_approval_required` / `escalate` decision rows, each `adjustment_approved` / `adjustment_denied` / `adjustment_execution_blocked` / `adjustment_executed`, and the per-attempt parser trace steps beneath |
| **Backend/API** | `GET /uc09/api/adjustments`, `/:id`, `/by-ticket/:ref`; `POST /uc09/api/adjustments/:id/approve\|deny` behind signed identity **and** role entitlement |
| **Database** | `uc09_adjustments` (status, slots, each signature, `risk_basis`, `external_ref`, `source`, `payload`) · `audit_log` · `audit_trace` · `workflow_claims` |
| **Remote Sandbox** | Exactly one `POST /v1/incentives`, carrying the adjustment id as its idempotency key. **Nothing at all** for an escalated or denied adjustment |
| **Metrics dashboard** | **Nothing. UC-09 appears nowhere** — see DRIFT-054. Decided 2026-08-21: `uc09_adjustments` becomes a second source rather than UC-09 being forced into `review_queue`; accept rate is `executed / (executed + denied)`; the integrity invariant is a query reading zero. **`P-24` first** — `findIntegrityBreaches()` would otherwise flag every correct UC-09 payment, because its premise is *"high-tier must have no execution path"* and UC-09 is the one 🔴 that has one |
| **Remote's own incentive collection** | ⚠️ **Never read.** `GET /v1/incentives` lists a company's incentives, and five `incentive.*` webhooks exist. Nothing consumes either. That is where a payment made **without** passing through UC-09 becomes visible, and where an in-doubt write stops being a guess (§0.2, `P-15`, `P-28`…`P-30`) |

## 14. UX_ACCEPTANCE

- **Hierarchy.** Who is being paid, how much, in what currency, gross or net —
  then how many signatures and why, then who has signed, then the evidence.
- **The figure is three facts, not one.** The integer, its currency, and the
  gross/net basis. A euro adjustment once read `$5000.00 EUR`; a summary once
  stopped at `5000.00 EUR` and said nothing about basis, on the sentence a human
  signs.
- **Statements of absence are mandatory** (§5 of the design standard): the
  high-tax list is unsourced and its absence case is *NOT ASSESSED, which is not
  a finding that its payroll tax is straightforward*; an amount that could not
  be compared is **not** reported as under the threshold; a row that cannot say
  which country triggered the dimension says "not recorded" rather than guessing.
- **"No approval path" must never render as "0 approvals required."** Those are
  opposite facts and only one of them is reassuring.
- **Progress before refusal.** The panel names who has signed and who may not
  sign a second slot **before** it refuses them, not as a 409.
- **No internal language.** Never `pending_approval`, `amount_tax_type` or
  `retroactive_pay` in front of a signer; unmapped values are opened into words,
  never printed raw.
- **No modal on the result panel.** UC-09 is a hand-off — the only content an
  interruption could carry is "wait", and the money path is the last place to
  devalue that sentence (`UC-09.md` §18, rule in `UC-03.md` §19).
- **The salary is deliberately not shown.** A proportionality check is a *gate*,
  not a display field; publishing base pay beside the adjustment would ask an
  approver for a judgement this system has never made and cannot record.
- ⚠️ **One inconsistency worth naming.** Each role block asks for "Your name or
  email", but in the enforced posture `resolveApprover()` ignores it entirely and
  records the verified ZAF identity. The field is the identity only in the
  unenforced demo posture.

**Added 2026-08-21, and the first three are for a reader the other bullets never
addressed — the person who asked for the payment.**

- **The figure must be confirmed by the person who stated it, before any
  signature is collected.** Everything else on this list is about presenting a
  decision well; this is the only control that can catch a model's
  plausible-but-wrong number, and it works only at the moment the requester is
  still present (`P-3`, `P-4`).
- **A `net` request must say the company pays more, and that we do not know how
  much.** Remote grosses it up. A screen showing one figure under a `net` label
  is showing the employee's number to a person deciding the company's (`P-21`).
- **The outcome is part of the interaction, not the end of it.** Approved, denied
  or in doubt, and — on success — **when the money is expected**. A request that
  is decided and never reported is indistinguishable, to its requester, from one
  that was lost (`P-7`, `P-8`).
- **Where Remote publishes the word, print Remote's word.** The incentive object
  carries `type_label` — *"Signing bonus"*, *"Commission"*, *"Severance"* —
  while `panels.js` rearranges our own slug into `"retroactive pay"`. We are
  implementing Remote's product, not restating it in our own vocabulary beside
  theirs (DRIFT-112, `P-31`).

## 15. Successful business outcome

> **An employee who was owed money off-cycle is paid the right amount, on the
> right basis, because two different named people — never one, never a score —
> looked at the same complete picture and signed for it.**
>
> And: nothing was ever paid on one signature or none; no third signature ever
> replaced the first two; the same person never signed twice under two spellings;
> no figure the system could not establish was ever guessed into a payment; no
> payment was made twice by two approvals arriving together; and where the system
> did not know something — a currency it could not compare, a jurisdiction nobody
> had assessed — it said so on the screen the signer was reading.

## 16. Required evidence for E2E verification

1. **A positive test leads.** A well-formed $5,000 request **MUST** reach
   `dual_approval_required` with two slots and a `pending_approval` record, and
   $15,000 **MUST** reach `triple_approval_required` with three. Every UC-09
   workflow test once asserted a refusal, so a UC-09 that could never succeed
   would have passed all of them — which is exactly what happens with no model
   configured.
2. **The write, end to end.** A fully approved adjustment reaches
   `POST /v1/incentives` and comes back a real incentive; the payload on the wire
   is Remote's shape exactly — no invented keys, no missing required one; the old
   payload is **rejected** by the mock; `/v1/recurring-incentives` 404s.
3. **The floor, as a property over a grid**, not as one example: over all 320
   inputs, `approvalSlotsRequired >= 2` in `src/` **and** in the deployed n8n
   body, and no input requires fewer signatures than it did before the currency
   fix.
4. **Distinct humans, not filled slots.** Three slots signed by two people on a
   3-slot adjustment must not execute; `1 >= null` must not satisfy a floor.
5. **Segregation of duties under variation** — case, whitespace and confusable
   spellings refused; a genuinely different person still completes the approval.
6. **Concurrency, driven for real.** Approvals fired with `Promise.all` against
   the last slot produce exactly one `createIncentive`, and a real HTTP race
   against the running server agrees.
7. **The in-doubt transaction.** A throwing `createIncentive` leaves the row
   `executing`, `executedAt` null, exactly one attempt, and a further approval
   refused — asserted, because a deliberate absence is what a later cleanup
   silently removes.
8. **Money, round-trip.** $5,000 → `500000` in the record and the payload →
   `5000.00 USD` in the summary; gross and net carried verbatim and paying
   different sums for the same integer; an unstated basis stopping the request.
9. **Refusal to guess.** With no model, the parser refuses, the workflow
   escalates `amount_not_extracted`, a record **is** written, the request text is
   on it, and a redelivery produces one record and one ticket.
10. **Entitlement.** An unentitled approver refused, after every other refusal,
    and `not_configured` named distinctly from `not_entitled`.
11. **Database + queue + ticket + sidebar** agreeing on one state, including the
    number of signatures required and which are outstanding.

**Added 2026-08-21, one per decided change. Each positive case leads**, because
this repository's most expensive recurring defect is a gate that cannot fire, and
a refusal-only suite passes whether the gate lands correctly, lands inverted, or
does not land at all.

12. **The filer bind, both directions.** The filer signing `requester` **MUST**
    succeed and a second person **MUST** then complete the payment; the same
    filer signing `approver` or `payment_releaser` is refused **by its own name**,
    not by `same_person_cannot_fill_multiple_roles`. And the floor is unchanged:
    two distinct signatures still execute (`P-1`, `P-2`).
13. **The ceiling blocks, and says whose it is.** An amount above it reaches
    `blocked`, no Remote write occurs, and the screen carries the figure, the
    ceiling and the statement that the ceiling is **ours and not Remote's**. A
    request *below* it still reaches `dual_approval_required` — the positive case
    (`P-19`, `P-20`).
14. **Manager authorization fires at all.** A filer on the company roster
    **MUST** pass; one absent from it escalates. Gated on `M-2`: run against an
    empty collection this asserts only that nothing succeeds, which is what a
    dead gate also looks like (`P-16`, `P-17`).
15. **The in-doubt write is durable and resolvable.** A throwing
    `createIncentive()` writes `adjustment_execution_in_doubt` naming the payload,
    the key and the error **before** re-throwing; the row still stays `executing`
    with exactly one attempt; the queue no longer reports it settled; and the
    adjustment id is in Remote's `note`, so a reconciliation read can answer
    whether it happened (`P-9`, `P-12`, `P-13`, `P-15`).
16. **The integrity invariant reads zero, from the store.** Any `executed` row
    whose distinct canonicalised approver count is below 2 is reported as a
    breach; the fixture that seeds one **MUST** make the count read 1. And a
    correct UC-09 payment produces **no** `auto_resolution_on_high_tier` breach —
    the guard, asserted, not assumed (`P-23`, `P-24`).
17. **Nobody is silently decided about.** Approve, deny and execute each land a
    comment on the ticket the intake raised, and the executed one carries
    `expected_payout_date` when Remote supplied it (`P-7`, `P-8`, `P-10`).

## 17. Known SPEC_DRIFT

*Six original findings, DRIFT-049 … DRIFT-054, each now carrying a
**DISPOSITION** block appended beneath it — the finding is never overwritten,
because the sequence found → written down → decided is the argument for keeping
the register at all. Eight further findings opened by the 2026-08-21 pass are in
**§17b**. The unsourced high-tax-complexity country
list is **not** renumbered here: `UC-09.md` §17 and
`docs/KNOWLEDGE-SOURCES.md` §1 Test B already carry it as an open item, and the
code already discloses it at every surface. It is summarised in §10.*

---

### SPEC_DRIFT · DRIFT-049 · Three of the four specified deterministic controls do not exist anywhere in the repository

**Original/documented behaviour:** §7 names four deterministic controls, and §9
maps two of them to named failure modes: *"Gross-to-net validation. **Money ×100**
normalization. Company off-cycle limit check. Manager authorization
verification."* §9's guard against *"Unauthorized disbursement / fraud"* is
*"Dual approval **+ manager-auth check**"*, and against *"Miscalculated statutory
withholding"* is *"No autonomous tax math; human authors"*. §3 lists
`GET /v1/companies/{id}/managers` as a data source, tagged **[CONFIRMED]**. §5's
n8n flow reads *"REST: payroll runs (off-cycle window/limits), manager
authorization → deterministic: gross-to-net validation; money ×100
normalization; company off-cycle limit check"*. §12 test 4 requires *"Missing
manager auth → blocked"*.
**Current implementation:** only money ×100 exists. Searched exhaustively across
`src/`, `workflows/` and `test/` for `manager`, `/managers`, `listManagers`,
`managerAuth`, `grossToNet`, `gross-to-net`, `offCycleLimit`, `off_cycle_limit`,
`payrollRun` and `payroll_run` scoped to UC-09, then repo-wide for the manager
endpoint: **no match anywhere**. UC-09 makes exactly one Remote read
(`getEmployment`) and one Remote write (`createIncentive`). It never reads the
payroll calendar, so it has no concept of an off-cycle window or a company limit;
it never reads the company's managers, so it cannot tell an authorised requester
from any other authenticated admin; and the only appearance of "gross" in
`src/uc09/` is the `amount_tax_type` **label** (`gross|net`), which is a reading
of the figure, not a validation of it. `RemoteClient.listPayrollRuns()` exists
and is used by UC-06; nothing in UC-09 calls it.
**Current tests assume:** the three controls do not exist. `test/uc09*.test.js`
contains no test for manager authorization, no gross-to-net assertion and no
off-cycle limit case. §12's own test 4 has no implementation.
**Difference:** the deterministic half of this use case is one control, not four.
The absent manager-auth check is the one §9 names as the guard against
unauthorized disbursement — so the stated defence against fraud is currently the
approval floor alone, doing the work of two controls. The absent limit check
means there is no ceiling of any kind on what a single off-cycle adjustment may
pay: the high-value threshold does not cap anything, it only summons a third
signature. The absent gross-to-net validation means nobody checks that a `net`
figure grosses up to something the company can afford, on a field the code itself
calls *"the only gate in this file whose absence would have been silently paid
for in cash."*
**Evidence:** `docs/use-cases/UC-09.md` §3, §5, §7, §9, §12; `src/uc09/` (whole
directory — no match for any of the search terms above);
`src/uc09/policyEngine.js:305–398` (`evaluate()`, the complete gate list);
`src/uc09/workflow.js:94` (`remote.getEmployment()` — the only Remote read);
`src/remote/restClient.js:1692` (the only Remote write).
**Likely reason:** Cannot be established from the repository. No commit message,
ADR or BUILD-LOG entry found in this pass records a decision to drop them.
`UC-09.md` §15's status list does not mention them either — it says the policy
engine is *"Core build, hardened"*, which is true of what exists and silent about
what does not. A plausible forcing reason exists for one of the three
(`GET /v1/companies/{id}/managers` needs a company id that the Zendesk intake
path cannot supply) but nothing states it.
**Risk if left as-is:** three compounding exposures on the one path that moves
money. (a) Any authenticated company admin can request any payment to any
employment in their company; the system never asks whether they are that
employee's manager or hold any authority to ask. (b) There is no upper limit —
a €900,000 adjustment in a currency with no policy figure collects the same three
signatures as a €10,001 one. (c) The gross/net basis is captured, displayed and
POSTed but never *validated*, so a `net` request that grosses up to several times
the stated figure reaches an approver showing only the stated figure. Every one of
these is invisible from outside: the system refuses correctly on everything it
does check, which is the exact shape this repository has paid for six times.
**Recommendation:** HUMAN_DECISION_REQUIRED. Three separate decisions, not one:
(1) build the manager-authorization read, or **remove it from §7/§9/§12 and state
plainly on the approval screen that requester authority is not verified beyond
the company match** — the current position, where the spec claims a fraud control
that does not exist, is the worst of the three options; (2) decide whether an
off-cycle limit is a Remote fact (read from the payroll calendar) or a stated
policy figure like the high-value threshold, and build whichever it is; (3)
decide what gross-to-net "validation" means when Remote performs the gross-up
itself — it may be that the honest control is showing the approver that the
company's cost is **not** the number on the screen, rather than computing it.
**Confidence:** HIGH on the absence (searched exhaustively, repo-wide, three
ways). LOW on why.


**DISPOSITION — 2026-08-21 · BUILD ALL FOUR, and each of the three is a
different kind of answer.** The finding asked for three decisions and it was
right to; what it could not know is that only one of the three is "build it as
the spec describes."

**(1) Manager authorization — BUILD, at a different endpoint.**
`GET /v1/companies/{id}/managers`, which §3 tags `[CONFIRMED]`, **is not a path
Remote publishes.** The real one is `GET /v1/company-managers?company_id=`,
returning `{company_id, user_id, user_name, user_email, role}`, all five
required. That is the **fourth** `[CONFIRMED]` tag in this repository naming an
endpoint that does not exist as written — after UC-05's resignation endpoint,
UC-06's `automatable` pre-check and UC-07's country transfer — and it is opened
as DRIFT-111 rather than folded in here, because the pattern is now the finding.

The real endpoint is better than the spec assumed: `user_email` is comparable
against the ZAF-signed approver identity, so the same read can anchor the
**approver** as well as the filer — `APPROVER_ROLES` is our grant list, and this
is the company's own roster. Two limits go on the screen with it: it lists
**company** managers, not this employee's line manager, so §9's fraud-control
sentence must be corrected to what is actually checked; and `role` is typed
`string` with no enum, so it is displayed and recorded, never made into a ladder.
**`M-2` first** — against an empty collection this ships a gate that cannot fire,
which is the shape UC-03's two dead gates and UC-06's `A-10` already cost.

**(2) The off-cycle limit — BUILD, as ours, and it must block.** `off-cycle` and
`off cycle` return **zero matches** across Remote's entire documentation index.
Rung 1 cannot answer and rung 2 has nothing to read, so this is a stated policy
figure — rung 4, self-identifying, carrying the same disclosure
`HIGH_TAX_COMPLEXITY_HEURISTIC` already carries. And it **blocks**: the finding
is right that there is no ceiling of any kind today, because the high-value
threshold only ever summons a third signature. A €900,000 adjustment and a
€10,001 one collect the same three.

**(3) Gross-to-net — DO NOT BUILD, and say why on the screen.** Remote's
`AmountTaxType` settles it: *"`net` indicates the amount which will be paid to
the employee after taxes. **Remote will gross this up** to ensure the taxes are
included."* Remote performs the gross-up. A figure we derived would be fabricated
money, which the substitution ladder forbids outright, and no amount of care
makes it safe. The honest control is the **disclosure** that the company's cost
is higher than the figure on the screen and that this system does not know by how
much. This finding's own recommendation guessed exactly that and marked it
speculative; it is now settled at rung 1.

**Rating change:** the finding's `HUMAN_DECISION_REQUIRED` is discharged. Confidence
on the absence was HIGH and stands. Confidence on *why* was LOW and is unchanged
— no commit, ADR or log entry records the drop, and this disposition does not
invent one.

**Build:** `P-16`…`P-22`. **Measure first:** `M-2`.

---

### SPEC_DRIFT · DRIFT-050 · "Requester ≠ approver" is asserted on the approval screen and is not enforced against the requester

**Original/documented behaviour:** `00-FOUNDATION.md` §5: *"segregation of duties
(**requester ≠ approver ≠ payment releaser**), never single- or zero-approval, at
any composite risk score."* `docs/adr/0005`: *"UC-09 applies it unconditionally,
with a third identity requirement (requester ≠ approver ≠ payment releaser) since
real money moves."* `UC-09.md` §8: *"three distinct identities, never the same
person wearing two hats."* The research this comes from is explicit: *"No
self-approval"* (`UC-09 Chatgpt BUILD CASE`, §V Fraud Controls).
**Current implementation:** the row records **who filed the request** —
`adjustmentRow.requester`, taken from `session.authenticatedAdminId` — and
nothing ever compares it to anybody. `evaluateApprovalAction()` compares the
three **approval slots** against each other with `isSameApprover()`, and
`isFullyApproved()` counts distinct humans among those same three slots. The
filer is not in either set. So the admin who asked for the payment may sign the
`approver` slot (or the `payment_releaser` slot), a second person signs
`requester`, and the adjustment executes with two genuinely distinct signatures
of which one belongs to the person who asked to be paid out.
**Current tests assume:** slot-versus-slot comparison only.
`test/uc09.test.js:322` and `:367` both drive the same person into two *slots*.
No test in this pass's reading compares `row.requester` with any approver.
**Difference:** the control that is built is **"two different signatories"**. The
control that is documented, on three separate pages including an ADR, is
**"two different signatories, neither of whom is the person who asked"**. Those
differ by exactly the self-approval case the fraud-control list names first. The
`requester` *slot* is a role in the signature set; it is not bound to the
`requester` *column*, and the two share a name.
**Evidence:** `src/uc09/multiApprovalPolicy.js:105–121` (the slot loop — the only
identity comparison on the approve path); `src/uc09/multiApprovalPolicy.js:153–189`
(`isFullyApproved()`, over the same three slots); `src/uc09/workflow.js:351`
(`const requester = session?.authenticatedAdminId ?? "unauthenticated"`);
`src/uc09/adjustmentStore.js:157` (persisted as `row.requester`);
`src/uc09/server.js:249` (`filerId: row.requester` — read out again, for display);
`src/shared/requesterSubject.js` via `src/uc09/server.js:254–258`, which prints to
the approver, verbatim: *"the requester can never also be the approver, and the
role entitlement check runs on top of that."*
**Likely reason:** Cannot be established from the repository. The likeliest
reading is that "requester" naming both a *column* and a *slot* made the two look
like one thing — the same collapse that let `adjustment_type` hold a decision
string (F-34), one field over.
**Risk if left as-is:** the screen makes a specific fraud-control claim that the
code does not implement, to the person relying on it at the moment they sign.
Role entitlement narrows this — the filer would need `uc09:approver` as well as
admin rights to exploit it — but entitlement is a grant list, and an admin who is
also a payroll approver is an ordinary configuration, not an exotic one. This is
the same class of defect as the byte-comparison segregation-of-duties bug that an
authorised pentest walked through in seconds; that one was *"how many
signatures"* versus *"how many people"*, and this one is *"which people"*.
**Recommendation:** RECONCILE. Either bind the check — refuse
`same_person_cannot_fill_multiple_roles` (or a new, distinctly-named refusal)
when an approver `isSameApprover(row.requester)` — or, if filing and signing are
deliberately allowed to be the same person, correct `00-FOUNDATION.md` §5, ADR
0005, `UC-09.md` §8 and the requester block's own sentence in the same unit of
work. The first is a handful of lines and is the reading every document already
promises; the second requires overturning an ADR. Whichever is chosen, the
**screen must not keep saying what is not enforced.**
**Confidence:** HIGH


**DISPOSITION — 2026-08-21 · ENFORCE, reading (A).** The project owner's
instruction was *"enforce requester is not approver is not payment releaser"*,
and the reading taken is the literal one:

> **The filer — `adjustment_row.requester` — may fill the `requester` approval
> slot and no other.** Signing `approver` or `payment_releaser` is refused. The
> floor stays at two distinct signatures, so the minimum number of humans on any
> payment is two, three above the floor.

The refusal gets **its own name**, not `same_person_cannot_fill_multiple_roles`.
That code is about two *slots* and would send whoever reads it to the loop that is
already correct, in a file where the two concepts share a word — which is how this
defect survived in the first place.

**The alternative was live and was not taken.** ADR 0005's literal words are
*"the requester may not fill **either** approval slot"*, and UC-06's `[A-2]` read
that as making slot 1 an independent employer signatory — which for UC-09 would
mean the filer signs nothing and every payment needs three humans. (A) was chosen
because `00-FOUNDATION.md` §5 names three **parties** (`requester ≠ approver ≠
payment releaser`) and a party who signs nothing is not party to the control;
because the sidebar already promises that this slot decides *"that the adjustment
is the one they asked for"*, which is an attestation only the filer can make; and
because it keeps the floor's cost where every document already puts it.

**ADR 0005 is corrected in the same unit of work, and its correction outranks the
build.** It does not merely omit this rule — it asserts UC-09 **holds** it, *"in
its strongest form"*, citing the file. That sentence is being read right now by
anyone auditing four-eyes. Opened as DRIFT-110 and called out separately in §0.7.

**Build:** `P-1`, `P-2`. **Confidence:** unchanged, HIGH.

---

### SPEC_DRIFT · DRIFT-051 · The trigger model describes reacting to a drafted incentive; the implementation reads no draft and creates one

**Original/documented behaviour:** §1 and §2: *"An off-cycle adjustment is
drafted in Remote's own product (the incentive resource, `POST /v1/incentives`)
… The automation runs its gates against that drafted incentive; only once
identity, gross-to-net validation, and off-cycle-limit checks have run does it
author a Zendesk ticket itself."* §5: on both approvals, *"whichever write
Remote's API uses to move the already-drafted incentive out of pending status
**[INFERRED — exact endpoint/shape not yet confirmed]**"*. Whether a matching
webhook exists at all is marked **[INFERRED — verify at build time]**, with a
filtered poll named as the fallback.
**Current implementation:** no drafted incentive is ever read, referenced or
transitioned. Nothing in `src/uc09/` or `workflows/nodes-uc09/` calls
`GET /v1/incentives`, and there is no incentive id anywhere on the request or the
row. `prepareIncentivePayload()` **builds a new payload from scratch**, and the
execution step **creates** the incentive: `remoteForRow.createIncentive(payload,
{idempotencyKey: adjustmentId})` → `POST /v1/incentives`. The n8n graph's trigger
is a plain webhook whose normalizer accepts (a) a real Zendesk ticket body — which
then always fails identity, by design — or (b) a flat structured POST. No
`incentive.*` webhook is subscribed to and no poll exists. The intake, in
practice, is: the portal's free-text form, or a direct structured API call.
**Current tests assume:** creation, not transition. `test/uc09IncentiveWrite.test.js`
asserts `POST /v1/incentives` is the only path the client posts to, and pins the
created-incentive response shape.
**Difference:** two of them, and the second is the dangerous one. (1) There is no
Remote-native trigger — the *"Remote-native webhook"* intake this contract's tier
table inherits is, for UC-09, a webhook endpoint that nothing at Remote calls.
(2) **If the spec's trigger model were ever implemented on top of today's
execution step, one adjustment would produce two incentives** — the admin's draft
and the automation's create — because the write is a create with no reference to
any prior object. The two halves of §2/§5 and §15 are individually coherent and
mutually incompatible: §15 correctly repointed the write to `POST /v1/incentives`
after discovering `POST /v1/recurring-incentives` 404s, and in doing so turned the
write from *transition* into *creation* without §2's trigger paragraph changing.
**Evidence:** `docs/use-cases/UC-09.md` §1, §2, §5, §15;
`src/uc09/policyEngine.js:656–708` (`prepareIncentivePayload()` — builds from the
adjustment and the employment, no incentive id);
`src/uc09/workflow.js:635` (the create); `src/remote/restClient.js:1692–1706`;
`workflows/nodes-uc09/normalizeAdjustmentRequest.js:33–44` (the two accepted
input shapes); `src/portal/server.js:3199–3214` (free text only, and why).
Two further staleness artefacts sit on the same seam and should be corrected with
it: **§13 build task 7 still reads "POST recurring-incentive on all required
approvals"**, which §3 and §15 both establish is the wrong resource — Remote
documents it as *"a monthly paid incentive"*, and using it would turn one approved
adjustment into a standing monthly payment; and `workflows/README.md`'s UC-09
section still cites `POST /v1/recurring-incentives` and the superseded
`INCENTIVE_REQUIRED_FIELDS` list `["employment_id","type","amount","currency"]`.
**Likely reason:** partially establishable. §15 records the write being verified
live on 2026-08-19 and repointed; the trigger paragraph in §2 predates that and
was not revisited. Whether a Remote incentive webhook exists was never resolved —
§2 still carries its own `[INFERRED — verify at build time]` tag, and
`docs/INTAKE-RESEARCH.md` confirms webhooks for `contract_amendment.*` and
`travel_letter.requested` but names none for incentives.
**Risk if left as-is:** a reader implementing §2 as written adds a webhook that
fires on draft creation and gets a duplicate payment on every approval. Less
dramatically but more certainly: UC-09 is documented as Remote-native intake and
in practice is reachable only through a free-text portal form and a direct API
call, which materially changes what a demo or an E2E plan should exercise.
**Recommendation:** RECONCILE, and settle the endpoint question first. Either
(a) keep creation as the write and rewrite §2/§5 so the trigger is a *request*
(portal or structured submission), not a drafted Remote object — in which case
`src/remoteui/`-style framing applies and §13 task 7 must be corrected; or
(b) confirm whether an incentive draft/transition pair actually exists at Remote,
and if it does, make the write a transition rather than a create. Do not leave
§2 and §15 both standing.
**Confidence:** HIGH on the implementation and the incompatibility; MEDIUM on
whether a Remote incentive webhook exists, which this pass could not verify
against `developer.remote.com`.


**DISPOSITION — 2026-08-21 · RECONCILE, remedy (a) — and the endpoint question
the finding could not settle is now settled, against the spec.**

This finding rated itself MEDIUM on *"whether a Remote incentive webhook
exists, which this pass could not verify"*. **It does — five of them**
(`incentive.created`, `.updated`, `.paid`, `.processing_started`, `.deleted`) —
along with `GET`, `PATCH` and `DELETE` on `/v1/incentives/{id}`. On the finding's
own terms that points at remedy (b): confirm the draft/transition pair, then make
the write a transition.

**Remote's lifecycle documentation refuses (b) anyway, and for a better reason
than a missing endpoint.** *"When the incentive is created and it is not yet
associated to a payroll cycle, its status is `pending`"*, and *"incentives are
paid out through payroll on the next applicable cycle after the effective date"*.
**`pending` is not an approval state.** A `pending` incentive is already going to
be paid, and the transition out of it is driven by cycle association, not by any
call. There is no write to move one *out of pending* because there is no state to
move it out of. So **creation is the authorisation**, the implementation has been
right the whole time, and **remedy (a)** is taken: §2 and §5 are rewritten so the
trigger is a *request* — the portal or a structured submission — never a drafted
Remote object.

The finding's dangerous half stands and is now sharper: implementing §2 on top of
today's execution step would produce **two** payments, the admin's already-
scheduled draft and our create.

**What the webhooks become instead, and it is worth more than an intake.**
`incentive.created` sees a payment made **directly in Remote's product, with zero
signatures** — a bypass of this entire use case that nothing can currently
observe. Reconciled against `uc09_adjustments` it answers *"which disbursements
have no signature behind them?"*, which is DRIFT-054's integrity invariant
measured in the running system rather than asserted by tests. Carried there
(`P-28`…`P-30`) rather than duplicated here.

**Two staleness artefacts the finding names are carried into the queue**, not
left: `UC-09.md` §13 task 7's *"POST recurring-incentive"* (`P-34`) and
`workflows/README.md`'s superseded `INCENTIVE_REQUIRED_FIELDS` (`P-34`).

**Rating change:** MEDIUM → **HIGH**, both halves. **Build:** `P-31`, `P-34`.

---

### SPEC_DRIFT · DRIFT-052 · The LLM is the source of the payment figure on the only intake that works, against a spec that says it never is

**Original/documented behaviour:** §5, describing its own seam: *"LLM: draft
plain-language restatement of the already-decided incentive values ('relocation
top-up post-tax') — **restatement only, same narrow seam as UC-06's changeParser;
never the source of the numbers**."* §6 is wider and does not agree with it:
*"Does: map unstructured adjustment requests to the correct Remote
incentive/recurring-incentive schema."*
**Current implementation:** §6's reading is what is built, and it goes one step
further than §6 says. `parseAdjustmentRequest()` asks the model for `type`,
**`amount`**, **`currency`**, `description`, `effectiveDate`, `processingDate`,
**`amountTaxType`** and `taxAdjustment`. `workflow.js` multiplies that amount by
100 and hands it to the gates; if every gate passes and the humans sign, that
integer is the `amount` on the `POST /v1/incentives` body. The model's
`taxAdjustment` boolean also feeds `assessRisk()` and can raise the signature
count. The portal — the only browser intake for UC-09 — offers **no amount
field**, so every portal request goes through this path.
**Current tests assume:** the LLM path, with a fake injected
(`test/uc09.test.js:719` asserts the seam *"actually exists — the LLM path really
runs"*, which is itself the fix for the seam having been wired to nothing).
**Difference:** UC-06's `changeParser.draftSummary()` restates values a human
already supplied and its output cannot re-enter a decision. UC-09's parser
**originates** the values. That is a categorically wider seam, and §5 asserts the
narrow one by name.
**What genuinely constrains it, stated because the mitigation is real:** the
response is validated strictly (`whyInvalid()` — finite number > 0, three-letter
currency, non-empty type, and a numeric **string** rejected rather than coerced);
`amountTaxType` is never coerced to a member, so an unclear answer stops the
request rather than choosing gross or net; a failed or unconfigured model
**refuses** (`REFUSED_SOURCE`) and there is no rule-based fallback anywhere,
because the deleted regex once parsed *"Q3 2024 relocation top-up of $12,500.00"*
as `amount: 3` — a 4,000× error; the type is checked against Remote's own enum;
and the figure appears in major units, with its currency and basis, in the one
sentence two or three humans sign. Direction of failure is toward refusal.
**Evidence:** `docs/use-cases/UC-09.md` §5 and §6;
`src/uc09/adjustmentParser.js:56–73` (the prompt), `:129–147` (the accepted
result, tagged `source: "llm"`), `:175–185` (`whyInvalid()`);
`src/uc09/workflow.js:132–133` (the ×100 scaling of the model's number);
`src/uc09/policyEngine.js:695` (that number becoming `payload.amount`);
`src/portal/server.js:3206–3214`.
**Likely reason:** partially establishable — §15 defect 5 records the LLM seam
being repaired *because* the regex fallback was producing catastrophic figures,
so the model became the source deliberately, as the safer of two bad options. No
document records §5's sentence being re-examined afterwards.
**Risk if left as-is:** a reviewer applying §5 literally will believe no
model-produced number can reach a payment and will not look for the controls that
actually make it safe. Substantively, a model that answers *plausibly but wrongly*
— `1250.00` for *"twelve thousand five hundred"* — passes every validator, and
the only thing between it and a disbursement is a human reading the summary. That
is a real control and it is the **only** control; it should be described as such
rather than denied.
**Recommendation:** RECONCILE — correct §5 to say what §6 says and what the code
does, and make the requester's screen state explicitly that the figure was read
from their sentence by a model and must be checked. Optionally strengthen: echo
the extracted amount back for confirmation before any signature is collected,
which is the one cheap control that would catch a plausible-but-wrong number at
the moment the person who knows the right one is still present.
**Confidence:** HIGH


**DISPOSITION — 2026-08-21 · RECONCILE, and add the one control that could
actually catch a wrong number.**

§5 is corrected to say what §6 says and what the code does: **on the intake that
works, the model is the source of the figure.** The finding's constraint list is
accurate and stays — strict validation, no rule-based fallback, refusal on
failure, the type checked against Remote's enum, the figure in major units in the
sentence humans sign.

**But every one of those is a check on the answer's *shape*.** A model that
returns `1250.00` for *"twelve thousand five hundred"* satisfies all of them, and
the finding says so: *"the only thing between it and a disbursement is a human
reading the summary."* Two humans read that summary — and **neither of them is
the person who knows the right number.** The requester states the figure in
prose, never sees what was extracted as something to *confirm*, and is not
consulted again.

So the optional strengthening in the finding's own recommendation is **taken, and
is the substantive part of this disposition**: echo the extracted amount back to
the requester **before any signature is collected**, as a confirmation and not a
result page. That is the one moment the person who can falsify the number is
still present.

**And the portal gains an amount field.** Its absence is justified in
`src/portal/server.js` by our own ×100 trust boundary — structured input trusted
as scaled, free text scaled by the workflow. That boundary is real and the
comment is right that a field labelled "amount" sits on top of it. The remedy is
to **name the two units apart** rather than to withhold the field: a requester who
knows the figure should not be forced through a language model to state it.

**Build:** `P-3`…`P-6`. **Confidence:** unchanged, HIGH.

---

### SPEC_DRIFT · DRIFT-053 · The in-doubt payment is preserved for a human and no human is told, and the queue calls it settled

**Original/documented behaviour:** the deliberate design, recorded in
`src/uc09/workflow.js` and pinned by test: a throwing `createIncentive()` means
*"we do not know whether the disbursement happened"*, so the row stays
`executing` **"and a human reconciles it."** §10 requires the audit to log the
*"incentive-post result."*
**Current implementation:** the throw propagates out of
`submitAdjustmentApproval()` uncaught. Therefore: no `adjustment_executed` row is
written (it is downstream of the write); **no audit row of any kind records that
a write was attempted** — the last UC-09 entry in `audit_log` is the
`adjustment_approved` for the final signature; `src/uc09/server.js:169` turns
it into `500 internal_error`; and `src/approvalqueue/awaiting.js:70–73` classifies
`executing` as **settled** for UC-09, with the comment *"A person is not waiting
in it; the machine is."* No ops alert fires — `RCX OPS · Error Alerts` watches
n8n executions, and UC-09 approvals never run through n8n (`UC-09.md` §15: *"the
multi-role approval/execution phase has no n8n counterpart — approvals only ever
happen through the HTTP API"*).
**Current tests assume:** exactly the behaviour above.
`test/uc09.test.js:1183` asserts the row stays `executing`, `executedAt` is null,
the failure surfaces rather than being swallowed, and exactly one attempt was
made. It asserts **nothing** about an audit row, an alert, or anybody being told.
**Difference:** the sentence "a human reconciles it" names a person, a trigger
and an action, and none of the three exists. The row is preserved perfectly and
is invisible: the queue whose stated headline is *the work that cannot move*
reports it as done, the audit trail contains no record that money may have left
the account, and the only signal is an HTTP 500 in the approver's browser. The
`executing`-is-settled classification is correct for the sub-second window it was
written for and exactly wrong for the state it also covers.
**Evidence:** `src/uc09/workflow.js:630–645` (the deliberate absence of a
try/catch, and everything downstream of the write);
`src/uc09/server.js:167–169`; `src/approvalqueue/awaiting.js:70–73`;
`test/uc09.test.js:1183–1229`; `docs/use-cases/UC-09.md` §10, §15.
Compare `src/uc04/`'s `workation_execution_blocked` row, which UC-09's own
freshness-failure path also writes (`adjustment_execution_blocked`) — the pattern
exists in this file and is applied to the recoverable failure but not to the
unrecoverable one.
**Likely reason:** Cannot be established from the repository. The absence of the
try/catch is documented and deliberate; the absence of any *notification* is not
discussed anywhere found in this pass, which suggests it was not a decision.
**Risk if left as-is:** the single worst state this system can enter — a payment
that may or may not have been made — is the one state with no record, no owner
and no queue entry. Nobody discovers it until a reconciliation notices an
incentive at Remote with no executed row behind it, or an employee reports not
being paid. DRIFT-041 (no expiry, no reminder anywhere) compounds it: nothing
ages, so nothing surfaces.
**Recommendation:** RECONCILE. Three changes, none of which touches the deliberate
no-auto-retry decision: (1) wrap the write so a **durable** `adjustment_execution_in_doubt`
row is written naming the payload, the idempotency key and the error, then
re-throw; (2) reclassify `executing` in `awaiting.js` — either as awaiting, or as
a third state, since "the machine is working on it" and "a human must reconcile
this" are the same status column value and different situations; (3) give the
in-doubt state a named owner on the screen, which for UC-09 is Payroll Ops.
**Confidence:** HIGH


**DISPOSITION — 2026-08-21 · RECONCILE, and the gap is wider than the finding
measured.** The owner's instruction was *"anybody that needs to be informed about
a payment or money flow must be involved"*, and checking that against the code
found the finding understated:

> **No UC-09 outcome reaches any human through any channel — not just the
> in-doubt one.** Every UC-09 decision raises a Zendesk ticket
> (`NO_TICKET_DECISIONS.uc09 = []`, so nothing is exempt) and **`src/uc09/`
> contains no Zendesk write verb at all.** The ticket raised at intake is never
> updated. Approved, denied, executed, in doubt: all four are silent.

Opened as DRIFT-115, because "the in-doubt state is invisible" and "every state
is invisible" are different sizes of problem with the same remedy.

All three of the finding's changes are taken, none of them touching the
deliberate no-auto-retry decision — (1) a durable `adjustment_execution_in_doubt`
row naming the payload, the idempotency key and the error, written **before** the
re-throw; (2) `executing` reclassified in `awaiting.js`, since *"the machine is
working on it"* and *"a human must reconcile this"* are one status value and two
situations; (3) the in-doubt state given a named owner on screen, Payroll Ops.

**A fourth is added, and it changes the state's character.** Remote recommends
specific `note` values *"since the Remote API has some mechanisms in place to
prevent the registration of duplicated incentives"*. Put the **adjustment id in
the `note`**, and `GET /v1/incentives` then answers *did this happen?* — so the
in-doubt row stops being a permanent question and becomes a resolvable one, using
Remote's own documented mechanism rather than an idempotency header Remote does
not document (DRIFT-113).

**And the requester is told what they are owed and when.** `expected_payout_date`
is on the created incentive and is read nowhere (DRIFT-116).

**Build:** `P-7`…`P-15`. **Ordering:** `P-9` before `P-15` — the reconciliation
read has nothing to search on until the note carries the id, so building it first
yields a query that can only ever answer *cannot tell*. **Confidence:** unchanged,
HIGH.

---

### SPEC_DRIFT · DRIFT-054 · UC-09 is absent from the metrics layer entirely, including its own integrity invariant

**Original/documented behaviour:** §11 specifies four measures: *"% adjustments
prepared for dual 1-click; **dual-approval accept rate** … (bucket 2, `≥60%`
healthy/iterate, `<30%` stop, `DEFAULT_THRESHOLDS`; **specified, not yet computed
by `compute.js`** — tracking issue #20); **zero** scaling errors; **zero
disbursements executed under single or zero approval, at any risk score** (bucket
1 — integrity invariant, not a rate to optimize)."*
**Current implementation:** tracking issue #20 is still open, and the gap is
wider than it. `src/metrics/compute.js` builds its whole report from the `cases`
and `review_queue` tables — `acceptRate` is `approved / decided` over
`review_queue` rows joined to `cases` by `case_id`. **UC-09 writes to neither
table.** `src/uc09/adjustmentStore.js`'s header records this as a deliberate
choice (`review_queue` has one status slot; UC-09 needs two or three
independently-identified ones), and it is the right choice for the store. The
consequence is that no UC-09 row ever reaches `computeMetrics()`: not the accept
rate, not the auto-rate, not the exception-reason ranking, and **not
`findIntegrityBreaches()`** — which is the function §11's bucket-1 invariant would
have to be implemented in. Grepping `src/metrics/` for `UC-09` returns nothing at
all. `SUCCESS_DECISIONS_BY_TIER` does list `dual_approval_required`,
`triple_approval_required` and `off_cycle_adjustment_required` under `medium`,
which is dead configuration: UC-09 is tiered `high`, and no UC-09 row arrives to
be classified either way.
**Current tests assume:** `test/metrics.test.js` exercises the accept-rate and
`insufficient_data` logic over `cases`/`review_queue` fixtures; nothing asserts
UC-09 coverage, because there is none to assert.
**Difference:** §11 is not partially implemented — it is entirely unimplemented,
and one of its four items is an **integrity invariant** rather than a rate. "Zero
disbursements executed under single or zero approval" is currently guaranteed by
tests over the policy engine and the store, which is a strong guarantee about the
*code*, and measured **nowhere** in the *running system*. That distinction is the
one this repository keeps paying for in the other direction (built versus
deployed).
**Evidence:** `src/metrics/compute.js:555–624` (the `cases`/`review_queue`
derivation, `acceptRate` at `:588`), `:340–351` (`SUCCESS_DECISIONS_BY_TIER`);
`src/uc09/adjustmentStore.js:1–20` (why it is a separate table);
`grep -rn "UC-09" src/metrics/` → no matches; `docs/use-cases/UC-09.md` §11.
**Likely reason:** establishable in part — the store was deliberately not forced
into `review_queue`, and the metrics layer was written against `review_queue`
before UC-06 and UC-09 introduced multi-slot stores. UC-06 has the same shape of
gap; UC-09's is sharper because its metric list includes an integrity invariant.
**Risk if left as-is:** the job criterion this whole portfolio leads with —
*define success metrics, track them, and use them to decide what to iterate on* —
is unmet on the use case where it matters most. Nobody can answer "how often do
approvers send an adjustment back?", which is the one number that would say
whether the AI's preparation is worth a specialist's time. And the integrity
invariant that justifies UC-09 having an execution path at all is unmeasured in
production: if a single-approval disbursement ever happened, no dashboard would
show it.
**Recommendation:** RECONCILE. `compute.js` should read the multi-slot stores as
a second source rather than have UC-06/UC-09 forced into `review_queue`: an
adjustment's accept rate is `executed / (executed + denied)` over
`uc09_adjustments`, and the integrity invariant is a query — any `executed` row
whose distinct canonicalised approver count is below 2 — which should be reported
as a count that must read zero, exactly as `findIntegrityBreaches()` already
reports the 🔴 breaches. Close #20 as part of it rather than separately.
**Confidence:** HIGH


**DISPOSITION — 2026-08-21 · RECONCILE, built the way the finding recommends,
with one trap it did not see.**

`compute.js` reads `uc09_adjustments` as a **second source** rather than forcing
UC-09 into `review_queue` — the store's separation is correct and stays. Accept
rate is `executed / (executed + denied)`. The integrity invariant is a query —
any `executed` row whose distinct canonicalised approver count is below 2 —
reported as a count that must read zero, exactly as `findIntegrityBreaches()`
already reports 🔴 breaches. Tracking issue #20 closes as part of it.

**The trap: `findIntegrityBreaches()`'s premise is false for UC-09.** It flags
any high-tier row reaching `auto_resolve` because *"`${c.useCase}` is high-tier
and must have no execution path"*. That premise holds for UC-07 and UC-08 and is
**wrong for the one 🔴 that deliberately has an execution path.** Route UC-09
rows in the obvious way and the dashboard manufactures breaches on correct
payments — which is worse than no measurement, because it teaches a reader to
discount the one alarm this use case exists to raise. **`P-24` before `P-23`**,
and the guard is asserted rather than assumed.

`SUCCESS_DECISIONS_BY_TIER`'s dead `medium` entries
(`dual_approval_required`, `triple_approval_required`,
`off_cycle_adjustment_required`) are corrected with it — UC-09 is tiered `high`,
so they classify nothing today and would classify it wrongly tomorrow.

**One measure the finding could not have asked for.** §11's invariant is *"zero
disbursements executed under single or zero approval"*, and the query above
answers it **for payments this system made**. It cannot see a payment made
directly in Remote's product, which is single-or-zero approval by definition.
`incentive.created` can (§0.2), and that reconciliation is the invariant measured
where it actually lives.

**Build:** `P-23`…`P-30`. **Confidence:** unchanged, HIGH.

---

## 17b. New SPEC_DRIFT opened by this pass — 2026-08-21

*Eight findings, `DRIFT-110` … `DRIFT-117`. Six came from reading Remote's own
documentation for the facts this use case's specification assumes; two came from
reading `src/uc09/` for something the six implied should be there. None was
produced by changing code.*

---

### SPEC_DRIFT · DRIFT-110 · ADR 0005 states that UC-09 enforces a control UC-09 does not enforce, and names the file

**Original/documented behaviour:** `docs/adr/0005-dual-control-segregation-of-duties.md`,
in the clause added 2026-08-21 during UC-06's decision pass: *"**the requester may
not fill either approval slot.** UC-01 holds this (`self_approval`,
`src/review/reviewPolicy.js`) and **UC-09 holds it in its strongest form
(requester ≠ approver ≠ payment_releaser, `src/uc09/multiApprovalPolicy.js`)**.
UC-06 did not, and exempted itself in a code comment."*

**Current implementation:** UC-09 does not hold it.
`src/uc09/multiApprovalPolicy.js:105–121` builds `allApprovals` from
`requesterApproval`, `approverApproval` and `paymentReleaserApproval` and
compares each to the incoming approver. `adjustmentRow.requester` — the column
recording **who filed the request** — is in neither that set nor
`isFullyApproved()`'s. This is DRIFT-050, unchanged; what is new is that a
document written to fix the same class of defect elsewhere now asserts the
opposite about this use case.

**Current tests assume:** slot-versus-slot only, as DRIFT-050 records.

**Difference:** the ADR is the artefact a reader auditing segregation of duties
opens first, and it makes the strongest available claim — *"in its strongest
form"* — about the one use case in the nine that moves real money, citing the
file where the reader would go to confirm it. A reader who follows the citation
finds a correct-looking loop and stops.

**Evidence:** `docs/adr/0005-dual-control-segregation-of-duties.md` (the clause);
`src/uc09/multiApprovalPolicy.js:105–121`, `:153–189`;
`src/uc09/workflow.js:351`; DRIFT-050.

**Likely reason:** establishable. The UC-06 pass verified **UC-06** — the use
case it was dispositioning — and took UC-09 on trust, because UC-09 was the
stricter-looking case and its slot loop reads exactly like the rule. The clause
is right about UC-01 and right about UC-06.

**Risk if left as-is:** a control that is documented as held, in the document
that exists to record whether it is held, on the money path. Worse than
DRIFT-050 alone: DRIFT-050 is a gap, this is a gap plus an assurance that there
is no gap.

**Recommendation:** RECONCILE, and **land the correction ahead of the build**.
`P-1` closes DRIFT-050 and makes the sentence true; until it does, the ADR must
say which of the three use cases actually hold the clause. This is the one item
in §18 whose delay is paid by somebody else.

**The transferable lesson, which this repository has not recorded before:** *a
correction can propagate a false claim.* A pass that fixes one instance of a
defect naturally reaches for the other instances as examples — and asserts their
state from memory rather than from the file. `docs/WHY-THIS-SHAPE.md` §18.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-111 · A fourth `[CONFIRMED]` endpoint that Remote does not publish

**Original/documented behaviour:** `UC-09.md` §3 lists
`GET /v1/companies/{id}/managers` among its data sources, tagged **`[CONFIRMED]`**
— the tag reserved for a shape verified against Remote's own documentation.

**Current implementation:** no such path exists in Remote's documentation index.
The company-manager surface is `GET /v1/company-managers` (optionally filtered by
`?company_id=`), `GET /v1/company-managers/{user_id}`,
`POST /v1/company-managers` and `DELETE /v1/company-managers/{user_id}`, plus
`company.manager_created` / `_updated` / `_deleted` events. Nothing in this
repository calls any of them, so the wrong path has never produced a 404 anybody
saw.

**Current tests assume:** nothing — the read does not exist (DRIFT-049).

**Difference:** the tag asserts verification that did not happen. **This is the
fourth**: UC-05's resignation endpoint, UC-06's `automatable` pre-check and
UC-07's country transfer were each recorded as settled facts about Remote's API
and each turned out otherwise — two of them by *existing* when declared absent,
this one by being *absent* when declared confirmed. Both directions are now
represented.

**Evidence:** `docs/use-cases/UC-09.md` §3; `docs/REMOTE-API-INDEX.txt`
(zero matches for `companies/{id}/managers`; the four `company-managers` paths
present); `CLAUDE.md` §3 directive 6 and `docs/00-FOUNDATION.md` §2a.

**Likely reason:** Cannot be established. The path is a plausible REST shape and
reads like one somebody wrote from expectation rather than from the index.

**Risk if left as-is:** whoever builds `P-16` starts from a 404 and debugs
credentials, scope and the proxy before doubting the path — the failure mode §6
of `CLAUDE.md` records twice already, once costing hours.

**Recommendation:** RECONCILE with `P-16`. Correct §3, and re-tag it from the
index rather than from the shape.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-112 · Remote publishes a human-readable label for the incentive type and the sidebar prints our rearranged slug instead

**Original/documented behaviour:** Remote's `Incentive` object carries
`type_label` — *"The human-readable label for `type` (e.g., \"Signing bonus\",
\"Commission\", \"Severance\")"* — alongside `type` and `payroll_output_category`.

**Current implementation:** `zaf-app/assets/panels.js`'s UC-09 panel renders
`{ label: "Type", value: words(adj.type) }`, where `words()` lowercases a slug
and replaces underscores — `retroactive_pay` → `"retroactive pay"`. The comment
above it argues, correctly, against a browser-side *map* of slugs to sentences.
It does not consider that Remote already ships the sentence.

**Current tests assume:** the rearrangement. `type_label` appears nowhere in the
repository.

**Difference:** *"retroactive pay"* against Remote's *"Retroactive pay"* is
trivial; *"work from home allowance"* against Remote's own label for the same
enum member is not necessarily, and the divergence is unbounded because one side
is a string transform and the other is a vocabulary Remote maintains. The
project's own instruction is *"we are supposed to implement it, not tell Remote
how they do their thing"* — printing our derived word beside their published one
is the small version of exactly that.

**Evidence:** Remote `Incentive` schema (`type_label`, `payroll_output_category`);
`zaf-app/assets/panels.js` (UC-09 `rows()`, the `words()` helper and its header);
`src/uc09/decisionFacts.js`, which opens the same value the same way.

**Likely reason:** establishable. `words()` was built for slugs the panel gets
from **our** stores, where no published label exists, and the incentive type is
the one value on that panel that also exists as a Remote object property.

**Risk if left as-is:** low individually, and it is the class that matters —
`type` is stored on the row from our own enum copy, so nothing forces the two
vocabularies to agree, and nothing would report it if they stopped.

**Recommendation:** RECONCILE. Carry `type_label` from the create response onto
the row and prefer it; keep `words()` as the fallback for a row that predates it.
`P-31`.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-113 · The idempotency guarantee on the one money-moving write is a header Remote does not document, and it defaults to a fresh random key

**Original/documented behaviour:** §10 of this contract lists *"the idempotency
key"* among the deterministic controls; `UC-09.md` and `src/uc09/workflow.js`
both rest the no-double-payment argument on it — *"stable across this call's
internal retries AND across a manual re-submission after a crash, so the one
money-moving POST in this repo can never be delivered twice."*

**Current implementation:** `src/remote/restClient.js:217–224` sends
`"Idempotency-Key": String(idempotencyKey || randomUUID())` on **every** write.
**`Idempotency-Key` appears nowhere in Remote's documentation index** — not on
`POST /v1/incentives`, not in the incentives guide, not as a general convention.
Remote's own documented anti-duplicate mechanism for this resource is the `note`
field: *"the Remote API has some mechanisms in place to prevent the registration
of duplicated incentives, and having specific notes helps to differentiate them."*
The `|| randomUUID()` default means every write with no key passed sends a key
that can never match a previous one — idempotency in shape only. `createIncentive()`
does pass the adjustment id, so the money path is not that case.

**Current tests assume:** the header is sent, against a mock this repository
wrote. No test — and no live capture — establishes that Remote honours it.

**Difference:** *"can never be delivered twice"* is a claim about Remote's
behaviour, resting on a header Remote has not promised to read. It may well work.
Nothing here shows that it does, and the in-doubt design (§7, invariant 10)
exists precisely because a redelivery might pay twice — so the two halves of the
argument disagree about how much the key is worth.

**Evidence:** `src/remote/restClient.js:217–224`, `:1692–1706`;
`docs/REMOTE-API-INDEX.txt` (zero matches for `idempotency`);
`https://developer.remote.com/docs/working-with-incentives.md` (the `note`
mechanism); `src/uc09/workflow.js` (the comment).

**Likely reason:** Cannot be established. `Idempotency-Key` is a widespread
convention and reads as one adopted by analogy.

**Risk if left as-is:** a duplicate payment is the failure this use case is built
around, and its named defence is unverified. The direction of the error is the
dangerous one — the system behaves as though it is protected.

**Recommendation:** RECONCILE. `M-3` measures it (two identical POSTs, one key,
count the incentives). Whatever it returns, put the **adjustment id in `note`**
(`P-9`) — that is Remote's documented mechanism and it also makes the in-doubt
state resolvable (DRIFT-053). Correct §10's wording to whatever `M-3` shows, and
stop defaulting to `randomUUID()` — a caller who passes no key should send no
header rather than one that guarantees nothing.

**Confidence:** HIGH on the absence from the docs and on the default. UNKNOWN on
whether Remote honours it — `M-3`.

---

### SPEC_DRIFT · DRIFT-114 · Remote publishes two different status vocabularies for one object, and neither is an enum

**Original/documented behaviour:** the incentives guide gives the lifecycle as
`pending` → `preparing` / `processing` / `paid`, with `deleted` for a cancelled
one. The API reference's own property description for the same field reads
*"The current status of the incentive (e.g., \"pending\", \"scheduled\", \"paid\",
\"cancelled\")"*. `status` is typed `"type": "string"` with **no `enum`**.

**Current implementation:** nothing in this repository reads incentive `status`
at all, so nothing is broken today.

**Difference:** `preparing`/`processing`/`deleted` versus
`scheduled`/`cancelled` — two vocabularies for one field, in one vendor's
documentation, with no machine-readable list to prefer. Recorded because
`P-15`'s reconciliation read and `P-28`'s webhook consumer are the first two
things in this repository that will want to interpret it.

**Evidence:** `https://developer.remote.com/docs/working-with-incentives.md`
(lifecycle section); the `Incentive` schema's `status` property.

**Likely reason:** the reference's parenthetical is illustrative and the guide is
normative. That is a reading, not a fact Remote states.

**Risk if left as-is:** a status gate built on either list silently mis-handles
the members of the other. The guide's own warning — *"it is not possible to
cancel a one-time incentive if its status is `paid` or `processing`"* — is the
kind of rule somebody will encode.

**Recommendation:** RECONCILE by constraint, not by choosing: `P-15` and `P-28`
treat `status` as an opaque string, test only for the two values Remote states
normatively in prose, and **never** enumerate it. Record the divergence beside
the code that reads it.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-115 · Nothing in `src/uc09/` ever writes to Zendesk, so every outcome on the money path is silent

**Original/documented behaviour:** §13 of this contract describes the Zendesk
ticket as a surface carrying the employee, the figure, the basis and the type;
`UC-09.md` §10 requires the *"incentive-post result"* to be logged. Every UC-09
decision is ticketed by construction — `NO_TICKET_DECISIONS.uc09 = []`, so no
decision is exempt.

**Current implementation:** the ticket is raised once, by the portal at intake,
and never touched again. `src/uc09/` contains **no Zendesk client, no comment
verb and no ticket update of any kind** — grepped for `createComment`,
`addComment`, `publicReply` and `internalNote` across the directory, zero matches.
The eight audit actions the directory writes (`adjustment_approved`,
`adjustment_denied`, `adjustment_executed`, `adjustment_execution_blocked`,
`adjustment_execution_not_claimed`, `adjustment_needs_approval`,
`adjustment_not_found`, `adjustment_value`) all land in `audit_log` and nowhere a
person is looking.

**Current tests assume:** the absence. No UC-09 test asserts any Zendesk
interaction after intake.

**Difference:** DRIFT-053 reports this for the in-doubt state — *"the row is
preserved perfectly and is invisible"* — and it is true of **all four outcomes**.
A requester who asks for a payment is never told it was approved, never told it
was denied, never told it executed and never told when the money is expected. The
approval sidebar shows the other signer what happened; nothing shows the person
who asked.

**Evidence:** `src/uc09/` (whole directory, no Zendesk write verb);
`src/portal/ticketing.js:62–73`; the audit-action list above;
`src/uc09/workflow.js:630–645`; DRIFT-053.

**Likely reason:** partially establishable. UC-09's approval phase has no n8n
counterpart (`UC-09.md` §15: *"approvals only ever happen through the HTTP API"*),
and the Zendesk write on every other use case lives in the n8n graph. The API
path was built without one and nothing noticed that it was the **only** path.

**Risk if left as-is:** a decided request is indistinguishable, to its requester,
from a lost one — on the use case where the thing requested is money. It also
guarantees the in-doubt state is discovered by an employee reporting they were
not paid.

**Recommendation:** RECONCILE, with DRIFT-053, as one change. `P-7`…`P-11`.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-116 · Remote answers when the money will arrive and nothing reads it

**Original/documented behaviour:** Remote's `Incentive` carries
`expected_payout_date` — *"The expected date when this incentive will be paid to
the employee. Null if not yet determined."* — together with `period_start`,
`period_end` and `payroll_output_category`.

**Current implementation:** `createIncentive()` returns the incentive and
`workflow.js` stores it whole as `remoteResult` in the audit row and via
`markExecuted()`. **No field of it is read, surfaced or promised to anybody.**
`expected_payout_date` does not appear in `src/`, `zaf-app/` or `workflows/`.

**Current tests assume:** the response shape is pinned; no test reads a property.

**Difference:** the one question the person being paid has — *when?* — is
answered by Remote on the response to the write we already make, and is
discarded. `period_start`/`period_end` matter for the quarterly-bonus case §6
admits as a valid variation, and are likewise uncaptured.

**Evidence:** Remote `Incentive` schema; `src/uc09/workflow.js` (the execute
block); zero matches for `expected_payout_date` repo-wide.

**Likely reason:** establishable. The write was repointed to `POST /v1/incentives`
on 2026-08-19 and verified as *a write that succeeds*; nothing revisited what it
returns.

**Risk if left as-is:** low for correctness, high for the product. It is also the
cheapest thing in this entire queue — the value is already in a variable.

**Recommendation:** RECONCILE with `P-8`, as part of telling people (DRIFT-115).

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-117 · `INTAKE-RESEARCH.md` records that Remote publishes no incentive webhooks; it publishes five

**Original/documented behaviour:** `docs/INTAKE-RESEARCH.md` confirms webhooks
for `contract_amendment.*` and `travel_letter.requested` and **names none for
incentives** — a sentence DRIFT-051 then cited when rating its own confidence
MEDIUM on *"whether a Remote incentive webhook exists"*.

**Current implementation:** Remote's documentation index lists
`incentive.created`, `incentive.updated`, `incentive.paid`,
`incentive.processing_started` and `incentive.deleted`, each with a payload
carrying `event_type`, `incentive_id`, `employment_id` and `company_id`.

**Current tests assume:** nothing; no webhook is consumed.

**Difference:** a **false negative about a third party's API, written into our own
research document**, which then propagated into a finding's confidence rating in a
different file. `docs/WHY-THIS-SHAPE.md` §17 already teaches that a *source named*
in a specification decays like a claimed absence; this is the plainer case the
same section covers — a claimed absence that was never true.

**Evidence:** `docs/INTAKE-RESEARCH.md`; `docs/REMOTE-API-INDEX.txt` (the five
event pages); DRIFT-051's confidence line.

**Likely reason:** Cannot be established. `INTAKE-RESEARCH.md` §5.1's subject was
*request objects and their events* — the amendment and travel-letter families —
and incentives are not a request object, so they were plausibly never searched
for rather than searched for and missed.

**Risk if left as-is:** it already caused one finding to under-rate itself. It
would also have hidden the bypass detector (§0.2) from anyone who trusted it.

**Recommendation:** RECONCILE. Correct the sentence and record the five events.
`P-32`.

**Confidence:** HIGH

---

## 18. Build queue — `P-1` … `P-34`

*The ninth build queue and the ninth non-corresponding change scheme (§0.8).
Everything below is **DECIDED · NOT YET BUILT** unless it says otherwise. A
decision does not close a finding: the drift each item answers is still live in
the code until the item lands.*

---

### Step 0 — three measurements, before any code

**All three need `.env` credentials this container does not hold.** They are
first because two of them can change the plan and one of them can invalidate a
sentence this contract currently prints.

| | Question | Why it gates something |
|---|---|---|
| **`M-1`** | Does the Sandbox return a populated `expected_payout_date` on a created incentive, and does `GET /v1/incentives` list what we create? | `P-8` promises the requester a date. If Remote answers `null` in the Sandbox, the promise must be *"Remote has not set one yet"* and not a blank. `P-15`'s reconciliation read needs the list route to work at all |
| **`M-2`** | Does `GET /v1/company-managers?company_id=<sandbox company>` hold **any** rows, and what `role` values appear? | **`P-16` cannot be built against an empty collection.** A gate whose input never arrives refuses everything and looks careful — UC-03's two dead gates and UC-06's `A-10` are the same shape. If it returns zero rows, the fixture comes first and §16's positive test leads |
| **`M-3`** | Two identical `POST /v1/incentives` with the **same** `Idempotency-Key`: one incentive or two? | §10 and `workflow.js` both rest the no-double-payment claim on a header **Remote documents nowhere** (DRIFT-113). Whatever it returns, the wording changes; if it returns two, the in-doubt design becomes the *only* protection and must be described as such |

---

### Step 1 — segregation of duties, and the document that says it is already done

- **`P-1` — bind the filer.** `evaluateApprovalAction()` refuses when
  `isSameApprover(adjustmentRow.requester, approver)` **and** the requested role
  is `approver` or `payment_releaser`. The `requester` slot stays open to the
  filer — that is reading (A), §0.6. New refusal code of its own, **not**
  `same_person_cannot_fill_multiple_roles`. Files: `src/uc09/multiApprovalPolicy.js`,
  `workflows/nodes-uc09/adjustmentGates.js` (the gates exist twice — the parity
  test will catch it, but know why). Tests: `test/uc09.test.js` and the 320-input
  grid. **Done when** §16 item 12 passes in both directions and the floor is
  demonstrably unchanged. *Closes DRIFT-050.*
- **`P-2` — correct the documents in the same unit of work.** ADR 0005 (which
  asserts UC-09 already holds it — DRIFT-110), `00-FOUNDATION.md` §5, `UC-09.md`
  §8, and the requester block's own sentence in `src/uc09/server.js:254–258`,
  which prints *"the requester can never also be the approver"* to the person
  relying on it at the moment they sign. **The ADR half lands even if `P-1`
  slips** — see §0.7.

### Step 2 — the requester gets a surface, and the figure gets confirmed

- **`P-3` — a requester-facing confirmation and attestation screen.** The
  `requester` slot's only controls today are the ZAF sidebar (a Zendesk **agent**
  surface) and `cli.js`; the role-holder is a company admin who is neither.
  Built on the portal, which already authenticates that persona. **It is a
  confirmation and an attestation, never an approve control for `approver` or
  `payment_releaser`** — those stay where they are.
- **`P-4` — echo the extracted figure back before any signature is collected.**
  Amount in major units, currency, gross/net basis, type in Remote's own words
  (`P-31`), and the employee by name. Wrong ⇒ the request is re-filed, not
  edited: an amended figure is a different payment and must re-enter at the
  gates. *Closes the substantive half of DRIFT-052.*
- **`P-5` — give the portal an amount field, by naming the units apart.** The
  field's absence is justified by **our** ×100 trust boundary, not by a product
  decision (`src/portal/server.js`'s own comment). Name the two concepts
  distinctly at the intake boundary so a requester who knows the figure is not
  forced through a model to state it. **Do not** add a magnitude heuristic —
  that was removed as a 100× money bug and must not return.
- **`P-6` — say on the requester's screen that a model read the figure**, per
  invariant 8's `source` and §14. Today the requester is the only reader never
  told.

### Step 3 — telling the people a money flow concerns

- **`P-7` — a Zendesk comment on approve, deny and execute.** `src/uc09/`
  contains **no** Zendesk write verb at all (DRIFT-115), so this is a new seam:
  injected like every other client, absent ⇒ no-op, never a gate. **After** the
  durable audit row, never before.
- **`P-8` — carry `expected_payout_date` onto the executed row and into the
  comment.** Null ⇒ *"Remote has not set a payout date yet"*, never a blank
  (DRIFT-116, gated on `M-1`). Capture `period_start`/`period_end` while there.
- **`P-9` — put the adjustment id in Remote's `note`.** Remote's own documented
  anti-duplicate mechanism, and the handle that makes `P-15` possible. Preserve
  the human-readable description alongside it; `note` is what a Remote-side
  person reads.
- **`P-10` — the executed comment states what was paid**: figure, currency,
  basis, type, both or all three signers, and the payout date.
- **`P-11` — the denied comment states that the request ends and must be
  re-filed**, which §11 already specifies and nobody is told.

### Step 4 — the in-doubt payment

- **`P-12` — a durable `adjustment_execution_in_doubt` audit row** naming the
  payload, the idempotency key and the error, written **before** the re-throw.
  **Do not add a try/catch that releases the claim or retries** — invariant 10
  and §7 are deliberate and stay.
- **`P-13` — reclassify `executing` in `src/approvalqueue/awaiting.js`.**
  *"The machine is working on it"* and *"a human must reconcile this"* are one
  status value and two situations; the queue whose headline is *the work that
  cannot move* currently reports the latter as settled.
- **`P-14` — name the owner on the screen**: Payroll Ops, the team the routing
  table already gives UC-09.
- **`P-15` — a reconciliation read.** `GET /v1/incentives`, matched on the
  adjustment id in `note`, answering *did this payment happen?* Read-only, and
  **`P-9` must land first** or it has nothing to search on. Treat `status` as an
  opaque string (DRIFT-114). *With `P-12`–`P-14`, closes DRIFT-053.*

### Step 5 — manager authorization

- **`P-16` — `listCompanyManagers({companyId})` on the REST client**, at
  `GET /v1/company-managers?company_id=`. **Not** the path `UC-09.md` §3 tags
  `[CONFIRMED]` (DRIFT-111). Correct §3 with it.
- **`P-17` — the gate.** Filer not on the roster ⇒ **escalate**, not block: an
  unrecognised manager is a fact about the roster, not evidence of bad faith, and
  Payroll Ops can see the roster. Gated on `M-2`; **the positive test leads.**
- **`P-18` — say what was checked, and what was not.** *"An authorised manager at
  this company"* — **not** *"this employee's manager"*. `role` is displayed
  verbatim and never turned into a ladder (no enum). Correct `UC-09.md` §9's
  fraud-control sentence to the control that exists.

### Step 6 — the ceiling

- **`P-19` — a company off-cycle ceiling that BLOCKS.** Rung 4, ours, structured
  like `HIGH_TAX_COMPLEXITY_HEURISTIC`: `basis`, null authority, `[PROPOSED]`
  provenance, and what a real version would need. It must satisfy invariant 2 —
  a ceiling may refuse, and may never lower a signature requirement.
- **`P-20` — say whose ceiling it is, on the screen and in the audit row.** An
  amount refused by a policy figure must never read as an amount refused by
  Remote. *With `P-19`, closes DRIFT-049(2).*

### Step 7 — the gross-up disclosure

- **`P-21` — on `amount_tax_type: "net"`, every screen that shows the figure
  states that the company pays more and that this system does not know how much.**
  Approver, requester and ticket comment. **Never compute it** (invariant 13).
- **`P-22` — correct §7/§9 of `UC-09.md`** from *"gross-to-net validation"* to
  the disclosure, citing Remote's `AmountTaxType`. *Closes DRIFT-049(3).*

### Step 8 — the metrics layer

- **`P-23` — `uc09_adjustments` as a second source in `compute.js`.** Accept rate
  `executed / (executed + denied)`; `insufficient_data` on an empty set, per
  issue #28's existing rule. Closes tracking issue **#20**.
- **`P-24` — guard `findIntegrityBreaches()` FIRST.** Its premise is *"high-tier
  must have no execution path"*, false for UC-09 (§0.4). Assert the guard; a
  correct UC-09 payment must produce **no** breach.
- **`P-25` — the integrity invariant as a query**: any `executed` row whose
  distinct canonicalised approver count is below 2, reported as a count that must
  read zero. Reuse `countDistinctApprovers()` — a second canonicalisation is a
  second answer.
- **`P-26` — correct `SUCCESS_DECISIONS_BY_TIER`.** `dual_approval_required`,
  `triple_approval_required` and `off_cycle_adjustment_required` sit under
  `medium` and UC-09 is `high`; they classify nothing today and would classify it
  wrongly tomorrow.
- **`P-27` — the exception-reason ranking** over UC-09's own refusals, which is
  §11's *"what to iterate on"* signal. *With `P-23`–`P-26`, closes DRIFT-054.*

### Step 9 — the bypass detector

- **`P-28` — subscribe to `incentive.created`.** Read-only: it records, it never
  gates, and it must never create an adjustment (that would be the intake §0.1
  refuses).
- **`P-29` — reconcile against `uc09_adjustments`** and report incentives with no
  signed adjustment behind them.
- **`P-30` — surface it as the invariant measured in production**, beside
  `P-25`'s query. `P-25` answers *did we ever pay on one signature?*; `P-30`
  answers *was money paid without us at all?* — and only the second can see a
  disbursement that never entered this system.

### Step 10 — vocabulary and staleness

- **`P-31` — carry Remote's `type_label`** onto the row and prefer it in the
  sidebar and `decisionFacts.js`; keep `words()` as the fallback (DRIFT-112).
- **`P-32` — correct `docs/INTAKE-RESEARCH.md`** and record the five
  `incentive.*` events (DRIFT-117).
- **`P-33` — the UC-05 payout question**, kept open rather than closed: a signed
  PTO figure has no execution path anywhere. Candidate answer in §12 — UC-09
  *reads* the signed report as evidence on an adjustment a human filed. **Not a
  route.**
- **`P-34` — the two `recurring-incentives` artefacts**: `UC-09.md` §13 task 7
  (*"POST recurring-incentive on all required approvals"* — which would turn one
  approved adjustment into a standing monthly payment) and `workflows/README.md`'s
  superseded `INCENTIVE_REQUIRED_FIELDS`. Rewrite §2/§5's trigger model as a
  *request* while there (DRIFT-051). *With `P-31`, closes DRIFT-051's staleness
  half.*

---

### What must NOT change

1. **The deliberate absence of a try/catch around `createIncentive()`.** No
   auto-retry, ever. `P-12` adds a durable row and re-throws; it does not recover.
2. **`Math.max(2, …)`**, in `src/` and in the n8n port.
3. **Exactly one production call site of `remote.createIncentive()`.**
4. **The salary stays off the approver's screen.** A proportionality check is a
   gate with its own tests, not a second number to eyeball.
5. **`deny`, not `decline`** — the one row in the system that spells it
   differently, and changing it now would break the vocabulary the sidebar,
   routing table and queue already agree on.
6. **No composite risk score.** Three independent booleans; nothing weighted.
7. **`HIGH_TAX_COMPLEXITY_HEURISTIC` keeps its disclosure**, including the
   *NOT ASSESSED* absence case.
8. **Entitlement stays consulted last and refuse-only.**
9. **`escalate` opens no approval path**, and the screens keep saying so in those
   words.
10. **`P-3`'s new surface is a confirmation and attestation screen only.** It must
    not grow an approve control for `approver` or `payment_releaser`, and the
    portal must keep offering none.
11. **Structured input stays trusted as already ×100.** `P-5` names the units
    apart at the boundary; it does not add a magnitude heuristic.
12. **The Zendesk intake keeps failing identity closed.** A ticket carries no
    Remote company id, and deriving one from the record about to be gated would
    be self-verifying identity.

### Open questions

- **`Q-1`** — does the ceiling summon `payment_releaser` as well as blocking?
  Recommendation: **no.** *"Too big to approve here"* and *"needs another pair of
  eyes"* are different statements and blurring them weakens both.
- **`Q-2`** — is the ceiling per-currency, or one figure with conversion? The
  per-currency table already exists for the high-value line and is the obvious
  shape; conversion is the trap UC-09 already has a finding about
  (`high_amount_threshold_not_comparable`).
- **`Q-3`** — the UC-05 payout (`P-33`). A product gap, not a routing one.
- **`Q-4`** — should `P-29`'s reconciliation alert, or only report? Alerting on a
  legitimate direct incentive would be a false positive on somebody's ordinary
  work; reporting a count nobody reads is the failure this queue's Step 3 exists
  to fix. To be answered with `M-1`'s evidence about how busy the collection is.
