# UC-07 Business Case — Global Mobility / Permanent Relocation

Same template as `docs/verification/uc06-business-case.md`. This document
covers business case only; the architecture decision (execution model) is
recorded on wayfinder ticket #8 directly, since it turns out to follow
directly from the business case's own conclusion rather than being a
separate technical question.

## 1. Hypothesized problem and cost mechanism

**[PROPOSED — reasoned hypothesis, not sourced fact]**

An employee currently employed through Remote's EOR entity in Country A
wants to permanently relocate to Country B and continue working for the
same employer. Mechanically this requires ending the Country A employment
relationship and starting a new one through Remote's Country B entity —
two separate legal employment actions that need to be sequenced so the
employee isn't left without valid employment status, benefits, or income
continuity in the gap between them.

This is a known EOR service category (multiple competitor platforms
describe "employee relocation"/"international transfer" as a distinct
product from short-term "workation" support), so the underlying problem is
real. **Cost mechanism, if handled badly**: not primarily "wasted support
hours" the way UC-06's cutoff confusion is — it's **severe harm to a real
person's legal employment/immigration/income status** if the two legal
actions aren't correctly sequenced, plus the same PE/tax/immigration
complexity found in UC-04's research (§ social security totalization, right-
to-work legality), except **permanent rather than temporary**, which raises
the stakes on every one of those dimensions rather than lowering them.

## 2. Confirmed vs. assumed

| Claim | Status |
|---|---|
| No atomic "country transfer" API exists at Remote | [CONFIRMED] — live-verified, both raw docs' hedges on this were correct |
| `/v1/employments` (create) and `/offboardings` (create, `type: "termination"` only) are both real | [CONFIRMED] — live-verified in this project's own prior research |
| Permanent relocation is lower-frequency than temporary workation requests, per employee | **[INFERRED]** — reasoned from base rates (people permanently move countries far less often than they take short trips), not sourced |
| Getting this wrong causes severe, hard-to-reverse harm (employment/benefits/income gap) | **[PROPOSED]** — reasoned from the mechanics (two separate legal actions bridging a gap), consistent with UC-04's research findings on the same underlying risk categories at a permanent (not temporary) scale |
| Ticket volume for this specific use case | **[UNCONFIRMED]** — not knowable from outside, and plausibly very low in absolute count |

## 3. The data that would confirm or shape this

1. Actual volume of permanent-relocation requests Remote's Mobility Team
   handles per year (this is very plausibly a low-double-digit or smaller
   internal caseload, not a high-volume support category — worth confirming
   before investing more than the dossier-compilation piece below).
2. How Remote's own Mobility Team currently handles this today (fully
   manual? partially tooled?) — if there's an existing manual process, the
   automation's job is to accelerate the *research/fact-gathering* portion
   of it, not to replace the judgment calls.
3. Whether Remote's Mobility Team would even want an AI-compiled dossier
   feeding into their process, or whether their existing tooling already
   covers this — a real "would this actually get used" question that no
   outside research can answer.

## 4. What ships vs. what doesn't — this is where the business case and the
    architecture decision converge

**This is the central finding of this ticket.** Given genuinely low
plausible volume + genuinely severe downside-per-error, the economic case
for **autonomous or semi-autonomous execution** (either raw doc's proposed
architecture) is weak on its own terms, before even reaching the safety
argument: you'd be building a complex saga/compensating-transaction engine
or a 5-agent orchestration system for a use case that's likely rare, to
save time on a process where the human's judgment at each step is the part
that actually matters. The efficiency gain is small; the risk if a
compensation step has a bug is a real person's employment/immigration
status. That's a bad trade even before "knowing when not to automate"
enters as a value statement — it fails a plain cost/benefit test.

**What ships**: an AI-compiled dossier — current contract/employment facts,
a destination-country requirements checklist, a timeline/dependency map
between the two legal actions (structured from the raw docs' state-sequence
ideas, repurposed as a checklist rather than an execution graph), and
explicit risk flags (repurposed from the raw docs' PROCEED/REVIEW/BLOCK
idea, as dossier content, not a gate that fires a write). A human specialist
executes every step themselves, exactly matching this project's own tier
definition for UC-07 (🔴, "zero autonomous execution") and the same
structural pattern already proven safe in UC-08 (`handleTaxInquiry()` takes
no write-capable client at all — the parameter doesn't exist, so there's no
execution path to accidentally wire up later). See ticket #8's resolution
for the full architecture writeup.

**What doesn't ship**: any version of either raw doc's execution engine.
Not deferred pending more data — rejected on the numbers as they stand,
because the downside-per-error is severe enough that no plausible volume
number changes the conclusion.
