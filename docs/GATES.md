# Gates — what "decided by gate 12" actually means

> Written because a tester read **"Decided by gate 15 — All gates"** on the
> portal and asked, entirely reasonably, what gates 1 to 14 were. A position in
> an order nobody can see is not an explanation; it is a citation to a document
> that did not exist. This is that document.

---

## 1. What a gate is

A **gate** is one deterministic yes/no question about a request. Not a step, not
a stage — a question with an answer that does not depend on an LLM, a model
temperature, or anything that could answer differently twice.

Every use case in this repo decides by running its gates in a fixed order.
Nothing about a decision is emergent: a decision is always *"gate N said no"* or
*"no gate said no"*, and that is the whole of it.

**Two rules govern the order, and everything else follows from them.**

### Rule 1 — the gates run in order, and the first failure wins

The moment a gate refuses, the run stops and that gate's reason becomes the
decision's reason. Nothing further is evaluated.

### Rule 2 — a gate below the deciding one has said *nothing*

This is the rule people get wrong, and it is why the portal prints **"not
reached"** rather than folding those gates in with the ones that passed.

A gate that never ran did not approve of anything. If an expense is refused at
gate 4 for ownership, gate 12 has not decided the amount is within policy — it
has not looked. Reading "not reached" as "fine" is the single most common
misreading of a decision panel, and it is the reason the ladder shows all three
states instead of a pass/fail pair.

### Why first-failure-wins rather than "collect every problem"

Collecting all failures reads as more helpful and is worse here, for two
reasons:

- **Later gates read data earlier gates have not yet validated.** Gate 12
  compares a converted amount against a cap. If gate 9 has not confirmed the
  money fields are valid ×100 integers, "over cap" is arithmetic on a number
  nobody has vouched for. Reporting it as a finding would be reporting a
  computation, not a fact.
- **A refusal must name one cause.** An audit row saying "refused for four
  reasons" cannot be acted on, and cannot be counted. The exception-reason
  ranking in `npm run metrics` — the signal that says what to fix next — needs
  exactly one reason per decision to be a ranking at all.

---

## 2. Where the order lives, and why it is not written twice

`src/uc02/policyEngine.js` holds `GATE_SEQUENCE`, immediately beside the gates
themselves. Two pure functions read it and **nothing else anywhere derives gate
order**:

| Function | Answers |
|---|---|
| `describeDecidingGate(reason)` | Which gate decided this, and was the classifier's confidence ever consulted? |
| `describeGateLadder(reason)` | The whole order, with each rung marked `passed` / `decided` / `not_reached`. |

Both are pure and neither decides anything — they describe a decision already
made. The portal and the ZAF sidebar render what they are given; a test asserts
the browser code contains no gate order of its own, so the page cannot come to
disagree with the engine.

`test/uc02Review.test.js` also scrapes every `reason:` string out of
`evaluate()`'s own source and asserts each has a row in `GATE_SEQUENCE`. A gate
added without a row would otherwise report "unknown" forever without erroring.

---

## 3. UC-02's ladder in full

Sixteen rungs, numbered 0–15. **Gate 0 is deliberately not 1**: the upstream
read is not a policy question — it asks whether the record could be read at all,
and a failure there means the request was never evaluated, which is a different
thing from being refused. Numbering it 0 keeps "gate 1" meaning "the first
policy question".

| # | Gate | It checks | It can refuse with |
|---|---|---|---|
| 0 | Upstream read | the employment record could be read at all | `upstream_unavailable`<br>`upstream_record_not_found` |
| 1 | Identity | the submitter is the employee on the record | `identity_not_verified` |
| 2 | Employment status | the employment is active | `employee_not_active` |
| 3 | Expense exists | the expense record exists at Remote | `expense_not_found` |
| 4 | Ownership | the expense belongs to the submitter | `expense_employment_mismatch` |
| 5 | Expense state | the expense is still pending a decision | `expense_not_pending` |
| 6 | Duplicate receipt | this receipt was not already reimbursed | `duplicate_submission` |
| 7 | Category | the category is a real, fileable one for this employee | `category_unverified` |
| 8 | Receipt evidence | a receipt is attached | `missing_receipt_evidence` |
| 9 | Amount sanity | every money field is a valid ×100 integer | `invalid_amount` |
| 10 | Tax containment | the tax portion does not exceed its whole | `tax_exceeds_amount` |
| 11 | Conversion | a cross-currency expense cannot be verified, so a human decides | `currency_conversion_unverified`<br>`conversion_identity_mismatch` |
| 12 | Policy cap | a cap exists for this category | `policy_cap_unknown`<br>`policy_cap_currency_mismatch`<br>`over_policy_cap` |
| 13 | Classifier confidence | the category classification is confident enough | `low_confidence` |
| 14 | Expense date | the expense date is in the past | `expense_date_invalid` |
| 15 | All gates | every gate above passed | `all_gates_passed` |

Some gates share a position because they are **one question with several ways of
answering no**. Gate 12 is the clearest: no cap could be found, the cap is
denominated in a different currency from the expense, or the expense exceeds it —
three refusals, one gate, and the ladder shows one rung so the count a reader
sees matches the numbers a decision quotes.

### Why the ordering is what it is

- **Identity before everything.** A refusal is itself a disclosure. Telling an
  unverified caller "that expense does not exist" or "that expense is over cap"
  tells them something about a record they have no right to.
- **Ownership (4) before any money question.** Whether the expense is within
  policy is not a question worth answering about somebody else's expense.
- **Duplicate receipt (6) before category and amount.** A receipt already
  reimbursed must be refused whatever it says it was for.
- **Amount sanity (9) before tax (10) before conversion (11) before cap (12).**
  Each reads a number the one before it vouched for. Reversing any pair means
  computing on unvalidated input.
- **Classifier confidence at 13, near the end, on purpose.** It is the only
  gate that reads anything an LLM produced, and it reads it about the **expense
  category** — never about the money, the identity, or the ownership. Prime
  directive #1 ("LLMs interpret; deterministic code decides") is visible in this
  position: twelve deterministic questions are asked and answered before the
  model's opinion is consulted at all, and the model's opinion can only ever
  send an expense to a human, never approve one.

### The misreading this ladder was built to end

A tester submitted an expense belonging to somebody else, got
`escalate / expense_employment_mismatch`, and saw **"Classifier confidence
0.9"** printed beside it. They asked why the system escalates at 0.9
confidence.

It does not. Ownership is gate 4, confidence is gate 13, and that run stopped at
gate 4 — the confidence figure was never consulted by anything. Two true facts
printed side by side with no relationship shown made one look like the cause of
the other.

The fix was **not** to hide the confidence (hiding an input is its own
dishonesty). It was to label what the figure describes and state whether
anything read it, and then to show the ladder so the distance between gate 4 and
gate 13 is visible rather than implied.

---

## 4. Reading a decision panel

On the portal, an ordinary UC-02 result carries:

- **The decision and reason** — the verdict.
- **"Decided by gate N — <name>"**, with what that gate checks.
- **A note** saying whether the classifier's confidence was consulted.
- **"The 16 gates, in the order they run"** — collapsed; open it for the full
  ladder with every rung marked.

The rung that decided is the only one with colour. Passed and not-reached are
both ordinary outcomes and neither should pull the eye.

---

## 5. The other use cases

**This section said "`GATE_SEQUENCE` currently exists for UC-02 only" and was
stale in two directions at once — worth recording, because a status line in a
document is exactly the kind of claim that outlives its own subject.** UC-03,
UC-04, UC-05 and UC-09 had grown ladders of their own since it was written, and
UC-01 — the use case that actually runs live — had not.

**Six of nine now publish a `GATE_SEQUENCE`:** UC-01, UC-02, UC-03, UC-04, UC-05
and UC-09. Only UC-02's is numbered from 0 (see §3's note on why its upstream
read is gate 0); the rest number from 1. The traversal is shared —
`src/shared/gateLadder.js`'s `bindGateDescriptions()` — so each engine publishes
only the DATA, beside the gates it describes, and a new gate and its row are
added in the same edit. UC-02 keeps its own copy of the two functions because
its positions collapse (three reasons share rung 12) and the shared traversal
assumes one row per position.

**Three do not: UC-06, UC-07 and UC-08.** Each still expresses its order as the
control flow of its `policyEngine.js`, so a decision from them names its reason
without a position. Lifting each into the same shape is mechanical; the reason
to do it deliberately rather than in passing is that the numbering must be
derived from the gates rather than transcribed beside them, or the two drift and
the number becomes worse than no number at all.

Until then, the ordered list for those three is readable directly in its
`src/ucNN/policyEngine.js`, top to bottom, and each `docs/use-cases/UC-0N.md`
§ gates section states the order in prose.

---

## 6. The figures, not only the rung

A ladder answers *which question refused this*. It does not answer *what it
refused about* — and that second half is a separate defect with its own entry in
`docs/CORRECTIONS-LOG.md` (**C-27**, pattern **P7**): the panel said an expense
was "above the policy cap" while holding the claimed amount, the category cap,
the overage and the percentage, every one of which the gate had just compared.

So each of the three 🟢 use cases also publishes `describeDecisionFacts()`
alongside its ladder — pure, decides nothing, and returns the figures the
deciding gate compared, ranked most-decisive-first, with anything unavailable
stated as an explicit unknown carrying the reason it is unknown. The shared
vocabulary is `src/shared/decisionFacts.js`.

Three rules govern what may appear:

- **Never invent, never default.** An unavailable figure is `known: false` with a
  note, never a `0` and never an empty string. `0` and "not recorded" are
  opposite facts, and a defaulted value that looks like a measurement is the
  worst outcome available, because the reviewer acts on it.
- **Rank, do not dump.** A panel of forty fields fails the same way a bare slug
  does, by making the reviewer find the decisive fact themselves.
- **Describe what happened, never more.** This is **P9** (C-31) and it is the
  more dangerous half: adding detail is precisely the opportunity to assert
  something the system never did. UC-03's UC-04 handoff bundle therefore states
  `Dispatched to UC-04: no` as a literal, matching the `dispatched: false` in
  `src/uc03/uc04Intake.js`, rather than leaving it to be inferred from an
  absence.

And one constraint specific to UC-01: **no fact bundle may ever carry a
compensation value.** `over_scope_request` fires because somebody asked for
salary, so the obviously "helpful" move would put compensation into the exception
surface of the use case whose whole safety property is that its letter does not
carry it. The field NAME travels; the value never does. A test asserts it for
every reason on the ladder.

`docs/BUILD-LOG.md` §3.72 has the full write-up.

---

## 7. Related

- `docs/use-cases/UC-02.md` — the use case these gates belong to.
- `docs/METRICS.md` — how exception reasons are ranked, and why one reason per
  decision is what makes that ranking possible.
- `docs/CORRECTIONS-LOG.md` — C-22, C-27 (pattern P7) and C-31 (pattern P9), the
  three corrections §6 exists because of.
- `CLAUDE.md` §3 — the prime directives the ordering enforces.


## A fourth status — `not_evaluated` (2026-09-02)

`describeGateLadder()` marks status by **position**: rungs above the deciding
one are `passed`, below it `not_reached`. Position cannot tell *ran and found
nothing* from *never had its inputs*. UC-05's gate 9 compares the statute's
notice with Remote's own `days_of_notice`; when that figure was never read the
ladder said `passed` directly beneath the panel's own sentence that the
comparison "has NOT been checked". `qualifyGateLadder()` in
`src/uc05/policyEngine.js` now marks that rung **`not_evaluated`**, with the
reason on the rung, from the stored row — the one place that knows whether the
check ran. The sidebar names it "not evaluated" and draws it dotted, never in
the settled colour. Rule 2 above applies to it as it does to `not_reached`: it
is not a pass.
