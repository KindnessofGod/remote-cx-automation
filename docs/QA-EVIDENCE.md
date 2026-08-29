# How this system was tested — and why it is not signed off

Most portfolios show a green test suite. This one has 3,000-plus passing tests
and they are the *least* interesting evidence here, because this repository has
shipped at least six gates that could never fire while every test passed. A gate
that cannot fail is worse than no gate.

So the acceptance question was asked a different way: **put an observer in front
of the running system, give them a goal and no knowledge of the implementation,
and see whether they can achieve it.** Each observer is a separate AI agent
instance — which is what makes the isolation audit in §2 possible at all. Fifteen such rounds were run. The raw output —
1,351 files of transcripts, screenshots and per-observer findings — is kept in a
private working repository. This is the summary.

---

## 1. The method

Each round drives the **deployed** system, not a local checkout, through four
independent observers who never see each other's work:

**Each observer is a separate AI agent instance, not a human tester.** Each
runs in its own sandbox, with its own working directory and its own transcript,
and is given the goal without the acceptance criteria. That is what makes the
isolation audit below both necessary and possible: a human's independence has to
be taken on trust, whereas an agent's can be checked by reading what it was
exposed to, byte by byte.

| Observer | Goal | Surface |
|---|---|---|
| **employee** | Get my own employment verified | the request portal |
| **third party** | Verify someone else's employment | the public consent door |
| **specialist** | Work the queue this generates | Zendesk + the ZAF sidebar |
| **ops** | Audit what the system recorded | the audit-trail viewer |

Each runs in its own sandbox with its own working directory. They are given the
goal, never the acceptance criteria — an observer told what "correct" looks like
will find it.

## 2. The isolation audit, which is the part that matters

An observer who has seen the spec is not an observer. So after every round, an
audit scans each transcript for vocabulary the observer could only have got from
the spec or from another persona, and reports **where it first appears** and
whether there was a legitimate route for it to arrive.

The consequence is the design decision worth defending:

> **Every criterion a leaked observer was the SOLE observer of is VOID for that
> round.** Not downgraded to a caveat. Not re-run until it passes. Void.

In the most recent round, two of four observers leaked — on ordinary English
words (`byte-identical`, `indistinguishable`) that each generated while
describing its own first-hand observation. The audit could not prove those were
independent, so **37 findings were voided**, including the single question the
round existed to answer.

That is expensive and it is the point. A round that discards its own best
evidence rather than argue for it is a round you can believe when it says yes.

## 3. What the last round concluded

**NEGATIVE. Not promoted.** Recorded on four independent grounds, deliberately
separated because they are not equally informative:

1. **On merit, from an observer whose isolation held.** The contract requires a
   stored document with a content hash on every auto-resolve. A clean observer
   opened 33 records, found eight asserting `letterIssued: true`, and **none
   carrying a document id, a content hash, or any recorded attempt naming a
   letter operation.** The letter the customer was told they received is not in
   the record.
2. Two observers leaked, voiding every criterion each solely observed.
3. Three criteria were measured by nobody.
4. No demo recording exists, which the packaging gate requires.

**Ground 1 alone is disqualifying** — had both leaks been clean, the verdict
would still be negative. That is stated explicitly in the round's own write-up so
it cannot be read as a round lost to an instrument fault.

Of 46 findings, **24 were new** and 44 remained open.

## 4. A representative sample

Chosen because they are the kind of defect a test suite structurally cannot see:

- **The sidebar and the note disagree, and the sidebar is right.** Every
  long-form escalation note tells the specialist *"open the sidebar to
  decide"* — on escalation tickets, where the sidebar correctly renders zero
  controls. Counted on nine tickets: `buttons: 0, inputs: 0, selects: 0`.
- **A ticket asserting a disclosure it also denies.** One note states the
  subject's name, job title, status, contract type and country, then closes
  *"nothing about this employment was disclosed"* — while the sidebar beside it
  withholds all of it. Two answers on one screen to *may we speak about this
  person*.
- **Internal identifiers shipped to the public internet.** The public consent
  page's HTML source carried developer comments naming internal file paths and
  the previous round's own defect ids — visible to any visitor via view-source.
  The fixes for round 6's defects were leaking round 6's defect ids.
- **Success and failure rendered simultaneously.** An employee's first-ever
  click produced an amber panel — *"Already processed: refused as a repeat
  delivery"*, explaining the idempotency ledger's primary key — at the same
  moment as a modal reading *"Your letter is ready."* The observer's words:
  *"did that work or not?"*
- **The letter carries no reference number.** Not the record id, not the
  reference the portal tells the employee to quote. It survives only in the
  download filename. A landlord ringing to check has nothing to quote.
- **Seventeen identical replies to one customer**, all inside the same minute.

None of these are crashes. Every one of them is a person being misled by a system
that believed it had succeeded.

## 4a. The other half of the evidence: the LLM seam is measured separately

Personas test the running system. They cannot tell you whether the *classifier*
is right, because a classifier is a function with an answer key. That lives in
[`evals/`](../evals/README.md):

| Path | Runs when | Exact match |
|---|---|---|
| LLM (`classifier-v2`) | normal operation | 47 / 48 |
| LLM (`classifier-v2.2`) | after the boundary fix | **48 / 48** — but see below |
| Deterministic fallback | no API key · 3 failed validations · every hermetic test | **36 / 48** |

The single v2 failure was not repaired by moving the answer key — the pairs are
provably unchanged across all three runs. The model read *"make sure the letter
includes my start date and contract type"* as a customisation request; those
fields are already on the standard template, so the boundary was wrong and the
boundary was rewritten.

**That 48/48 is a fit, not a measurement, and `evals/README.md` says so at
length.** Eight of the 48 inputs sit verbatim in the prompt being graded,
including the one that flipped; three of the five graded dimensions have never
failed and one of them structurally cannot; and nothing sets a temperature, so
each figure is one sample. The honest claim is a regression set that catches
taxonomy drift on known boundaries. The holdout is the measurement, and it has
not been run.

The third row is the one that was missing entirely. Every LLM result carries
`source: "llm"`, so the deterministic fallback — the path production takes when
the model is unavailable — had never been evaluated at all. It scores 75%, and
its weakest dimension is stated rather than hidden: the over-scope detector
catches *"include my salary"* and misses *"my current pay shown on the letter"*.

## 5. What did pass

Driven through the deployed portal in a real browser, real clicks, real
submissions:

| Use case | Scenario | Outcome |
|---|---|---|
| UC-02 | Clean meals expense | **Approved automatically**, expense record written |
| UC-03 | Short business trip | **Resolved automatically**, letter offered |
| UC-04 | Low-risk Schengen trip | `ready_for_approval` / `all_gates_passed` |
| UC-04 | **Sanctioned destination** | **Blocked** — and no work-authorisation record is created |

The last row is the one worth reading twice. An earlier version escalated
sanctioned destinations rather than blocking them, and `escalate` was a decision
that *wrote a real record*. The fix moved the jurisdiction screen to first
position. This is that fix, observed in production.

## 6. One finding about the instrument, kept on purpose

An automated probe in that same pass reported UC-04 as broken — *"submitted three
times, never produced a result panel."* **It was wrong.** The probe read the
first 800 characters of the card; UC-04's card carries 13 scenario presets and 20
fields, so 800 characters never reached the result, which renders at the bottom.
Reading the tail of the same element showed the decision immediately.

It is recorded in the evidence rather than quietly deleted, because the lesson
generalises: **read the element, not a prefix of the page — a truncated read is
indistinguishable from an absent one.** A false defect that gets silently removed
teaches nobody; the same mistake had already been made once against the sidebar.

---

**The honest summary: UC-01 is built, deployed, and running end to end on real
infrastructure, and it has not passed its own acceptance bar.** The bar is
public — [`qa/contracts/UC-01-acceptance.md`](../qa/contracts/UC-01-acceptance.md)
— and so is the list of what is still broken, in
[`CLAUDE.md`](../CLAUDE.md) §7.
