# Remote CX Automation — System Overview

> **Status: living draft.** This document is written incrementally, in step
> with what is actually built, and is not complete. Where a section describes
> something not yet built, it says so plainly rather than implying it exists.
> The authoritative build-status record remains `docs/BUILD-LOG.md`; this
> document exists to explain the *system*, not to track progress on it.

## What this system does

This is an automation layer that sits between Remote's platform, the support
team, and the people who submit requests through either one. It handles nine
categories of customer-facing request — from simple document generation to
cross-border tax questions to payroll adjustments — by splitting each request
into two separate jobs: understanding what's being asked, and deciding what
to do about it. Those two jobs are handled by different kinds of code on
purpose, and that separation is the core design idea of the whole system.

## The one rule everything else follows

An AI model reads and classifies free-form requests. It never decides
whether to act, and it never performs the action itself. Every decision that
changes something — issuing a document, approving an expense, writing to a
payroll record — is made by plain, deterministic logic that can be read,
tested, and audited like any other business rule. The AI's output is treated
the same way user input is: validated against a strict shape before anything
downstream is allowed to use it, and discarded in favor of a safe default if
it doesn't validate.

This means a request is never resolved because "the model decided it was
fine." It's resolved because a specific, inspectable set of checks passed.

## Requests don't all start the same way

A request enters the system in one of two ways, and which one depends on
what kind of request it is — not on a single universal channel:

- **It already happened inside Remote's own product.** An employee submitted
  an expense, filed a work-authorization request, resigned, or an admin
  requested a contract change. In these cases, Remote's own systems already
  hold a record of the request, and the automation reacts to that record
  appearing (via a webhook) rather than waiting for someone to describe it in
  a support ticket.
- **It's a question with no corresponding record.** "Can I get a letter,"
  "can I work from another country for a few weeks," "what happens to my
  taxes if I move" — these don't correspond to anything Remote's product
  tracks as an object. There's nothing to react to except the conversation
  itself, so these begin as a support ticket.

In both cases, the system does the same work before anything reaches a
person: it checks who is actually asking, gathers the facts a decision needs,
and runs the relevant checks. Only after that is done does a support ticket
get created for the cases where a human needs to see something — and when
the automation creates that ticket itself, it arrives already carrying the
context a person would otherwise have to go dig up, rather than as a raw,
unprocessed message.

## Three levels of how much the system is trusted to do on its own

Every request category is assigned one of three levels, and the level is
what determines the actual mechanics of how it's handled — it isn't just a
label.

- **Resolve it directly.** Reserved for requests that are low-stakes and
  fully reversible — for example, issuing a standard letter to someone whose
  employment status is confirmed active. The system still runs every check
  first; anything that doesn't cleanly pass every check is handed to a
  person instead of guessed at.
- **Prepare it, then have a person approve it.** Used where the outcome has
  real financial or contractual weight but a human reviewer can catch a
  problem before it takes effect. The system gathers every fact, runs every
  check, and presents a specific recommendation — but a person makes the
  final call, one click, with everything they need already in front of them.
- **Research it, then hand it entirely to a specialist.** Reserved for the
  requests with the highest stakes — cross-border tax questions,
  international relocations, off-cycle payroll changes. For most of these,
  the system is deliberately built so that there is no code path by which it
  could ever take the action itself, not just a rule telling it not to. The
  one exception is money movement that has already passed two independent
  people's approval — even there, the system never acts on a single
  approval, at any confidence level.

## Nothing happens without a record

Every decision the system makes — automatic or human-approved — is written
to a permanent, append-only log: what was asked, what was checked, what the
outcome was, and who (human or automated) was responsible for it. This log
is what makes it possible to answer, after the fact, questions like "how
often did a specialist agree with what the system recommended," or "did
anything ever get resolved automatically that shouldn't have been" — without
having to trust anyone's memory of what happened.

---

## What changed on 17 August 2026, and why it matters

Five things were fixed on the live system in one day. All five are the same
kind of problem underneath: **the system was behaving safely, and reporting
something that wasn't true about why.** None of them let a bad request through.
Several of them would have sent a colleague chasing the wrong problem, and one
of them meant a whole category of request could never be handled at all.

Each is explained here in ordinary terms. The technical write-ups are in
`docs/BUILD-LOG.md` §3.25–§3.29; the record of who caught what is in
`docs/CORRECTIONS-LOG.md`.

### 1. The same request arriving twice

When another system sends us a request — a support ticket being updated, a form
being submitted — it can arrive more than once. That is normal: the sender
retries if our reply is slow, a person double-clicks, a rule fires twice. It is
not a fault to be prevented at the source; it has to be handled at ours.

It had already caused real harm once. A single ticket arrived three times and a
customer was sent the **same employment letter twice**, with the decision
recorded twice as though two separate things had happened.

Every request now takes a numbered ticket before anything permanent is written —
one ticket per request, issued by the database itself, which can only ever issue
it once. A second copy of the same request finds the ticket already taken and
stops quietly, having changed nothing. It stops *quietly* on purpose: a repeat
delivery is ordinary traffic, and an alarm that goes off during ordinary traffic
is one people learn to ignore.

**One related gap, fixed the same day.** Some requests legitimately arrive
without an identifying reference. Those were failing to take a ticket at all,
and — because of how the failure was handled — were being silently discarded.
The request vanished, nothing was written, and every status light stayed green.
A duplicate is visible and can be cleaned up; a request that disappeared looks
exactly like one nobody ever sent. Those requests now get a generated reference
and are processed normally.

### 2. An identity check that could be fooled

Before this system tells anyone anything about an employment, it checks that the
person asking is who the record says they are. That check is the single most
important control in the whole design — everything downstream assumes it held.

Four request types were performing that check against **the requester's own
claim** rather than against the record held by Remote. In effect: *"You say you
are employee 123. Let me check… yes, you say you are employee 123."* In two of
the four, an empty value was being compared against another empty value, and
matching.

Those requests were still refused — but only because a *later* check (is this
employee currently active?) happened to catch them first. That is luck, not
control. It would have stopped working the moment anyone reordered the checks.

The fix removes the thing being compared against. Where there is no genuine
record from Remote, there is now no record object at all, so there is nothing
for a claim to be matched against and the check cannot help but fail.

The visible difference is in what gets written down. Before the fix, one test
request was refused as *"employee not active"*; after the fix, the **identical**
request is refused as *"identity not verified"* — the true reason. Both refuse.
Only one tells the reader what actually happened.

### 3. Telling an outage apart from a decision

If Remote's system is unreachable, or refuses our credentials, the honest thing
to record is *"we could not find out."* What the system was recording instead
was *"we checked, and this person's identity did not verify"* — which is a
statement about the customer, and it was false.

This happened because a failed lookup did not look like a failure. The step
reported success and passed an error message along in place of the data, so the
checks downstream saw nothing where an employment record should have been and
drew the obvious, wrong conclusion.

Three situations are now recorded as three different things:

| What happened | What it means | Who should act |
|---|---|---|
| Remote answered "that record does not exist" | A real answer about the record — the reference is wrong | Whoever owns the data or the request |
| Remote could not be reached, or refused us | The request was **never assessed**. Nothing about it is known | Whoever owns the integration |
| Remote answered normally and the rules said no | A genuine policy decision | The specialist, on the merits |

The middle row is the one that matters most, because it is the only case where
the system knows nothing at all and previously said something anyway. The
distinction is safe by construction: this logic can only ever make the system
escalate to a human, never approve. It runs only where the system has already
decided to refuse, so at worst it can improve the explanation of a refusal — it
can never create an approval.

One further consequence, in operational terms: the internal dashboard ranks the
most common reason for escalation and treats it as the next thing to fix. While
outages were being filed as identity failures, that ranking would have pointed
the team at a customer-identity problem that did not exist, for as long as the
outage lasted.

### 4. A request type that could never say yes

The travel-support request type checks the destination country against the list
of countries Remote supports. It was comparing two-letter country codes (`ES`
for Spain) against a list built from three-letter codes (`ESP`). Nothing ever
matched. The list came back healthy — 224 countries — and was then effectively
empty for comparison purposes.

The result: **this request type could not approve a single request, for any
customer, for any destination, for its entire life in production.** Spain — a
country Remote plainly supports — was being escalated as an unsupported
destination.

It is now fixed, and proven both ways: a request to work from Spain resolves
automatically; a request for a destination genuinely outside the supported list
still escalates.

**Why this one is worth a business reader's attention.** Nobody noticed for
weeks, and no test caught it, because *the failure looked exactly like caution*.
This system is deliberately built to refuse when it is unsure. A component that
is broken in this way also refuses — every time, for every request, with a
plausible-sounding reason. From the outside, "correctly careful" and "completely
broken" produce the same output.

The only way to tell them apart is to test the opposite thing: not just *"does
it refuse what it should refuse?"* but *"does it still approve what it should
approve?"* Three of the five problems fixed that day were invisible for exactly
this reason. That is now a standing rule for every request type in the system,
and it is the most transferable lesson the project has produced.

**The rule found its next case within hours, and this one involved money.**
Off-cycle payroll adjustments normally need two named people to approve before
anything is paid; for Germany, France and Italy they need **three**. The check
that raises the number to three was comparing the country against a value that
arrives from Remote in a different format, so it was never true. The third
approver had never once been required on a real record.

Nothing looked wrong, for the same reason as before: two approvals is a strict
control, every payment had genuinely been approved by two people, and no alert
or test exists for *"a rule that should sometimes fire has never fired."* It
fires now, and there is a test holding it there. A control that has never been
triggered and a control that cannot be triggered are indistinguishable until
somebody deliberately tries to trigger it.

### 5. When something breaks, a person finds out

Until this point, a failure anywhere in the nine automated processes was
silent. The first sign of a broken automation would have been a customer
complaining.

Every process now reports its own failures. The failure is **written to a
durable record first**, and only then does a notification get pushed to a chat
channel — in that order, and the notification is allowed to fail without losing
the record. A chat message can be dismissed, cannot be counted, and cannot be
reported on; the record can. If the notification channel is down, the failure
still exists in writing.

Each record answers the one question that determines urgency: *did this failure
lose a decision, or did it only lose a customer-facing update?* Because this
system always writes its decision down before it acts, most failures are the
second kind — the decision survived, the customer message did not, and it can be
picked up in business hours. The rare first kind is the only genuinely urgent
case, and it is now identifiable at a glance instead of by investigation.

### 6. What was deleted, and what was deliberately not

Testing all of this created 29 leftover rows describing requests that were never
real. Those were deleted from the working tables, because those tables represent
the current state of actual cases and false entries there would distort any
count taken from them.

**The audit log was left completely untouched, on purpose.** It is an
append-only history of every decision the system has ever made, and deleting
from it — even entries everyone agrees are meaningless — is precisely the thing
an auditable system must never do. "They were only test rows" is exactly the
argument that would be made the first time somebody wanted a *real* entry
removed.

The consequence is visible and correct: the audit log now contains the history
of some cases whose working records no longer exist. History does not shrink
because the current state did.

---

*More sections will be added here as each part of the system is built out —
this document is not meant to describe a finished product before one
exists.*
