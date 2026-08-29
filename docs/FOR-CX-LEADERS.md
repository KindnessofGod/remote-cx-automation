# What this system does, what it refuses to do, and how you would know it is working

**For a CX lead, an operations manager, or anyone deciding whether this belongs
in front of a real support queue. No code, and nothing here needs you to open
any.**

| | |
|---|---|
| **Written** | 2026-08-20 |
| **Every number below** | measured against the live system on the date given, not estimated |

---

## The one-paragraph version

Support requests at an Employer-of-Record company are not all the same kind of
thing. *"Can I have a letter confirming I work here?"* and *"please move £40,000
of off-cycle payroll"* arrive through the same inbox and have nothing else in
common. This system sorts nine common request types into **three levels of trust**
and gives each level a different amount of automation — from *"answer it and
close the ticket"* through *"prepare everything and wait for a named person to
approve"* to *"compile a research dossier and hand it to a specialist, with no
approve button anywhere for anybody."*

The interesting engineering is in that last category. **Building the ability to
refuse to automate something — and proving it structurally rather than promising
it — is the part that makes the rest trustworthy.**

---

## 1. What a "request" is here

A request enters one of two ways, and which one depends on what kind of request
it is:

- **Something already happened inside Remote's product.** An employee submitted
  an expense, filed a work-authorization request, or resigned; an admin proposed
  a contract change. Remote's own system already holds a record. The automation
  reacts to that record.
- **Someone asked a question that corresponds to no record.** *"Can I get a
  letter?" "Can I work from Portugal for three weeks?" "What happens to my tax if
  I move?"* There is nothing to react to except the conversation, so it starts as
  a support ticket.

This was **checked rather than assumed**. `docs/INTAKE-RESEARCH.md` (2026-08-20)
looked at how Remote actually takes these requests today: they are **forms**.
Across five request types the ratio of structured fields (dropdowns, dates,
country pickers) to free-text boxes runs 14:6, 6:4, 8:3, 14:5, 7:1 — a dropdown
with a prose box under it to *explain the choice*, never prose instead of the
choice. The free-text channel is the **fallback**, used when no form models what
you are asking — and that tail is precisely what these nine use cases automate.

In both cases the system does the same work before any human sees anything: it
checks **who is actually asking**, gathers the facts a decision needs, runs the
checks, and *then* — if a person is needed — creates the support ticket already
carrying everything that person would otherwise have to go and find.

---

## 2. Who decides — the three levels, in plain terms

| | What the system is allowed to do | Examples | Who decides |
|---|---|---|---|
| 🟢 | Answer and close it, with no human involved, when every check passes | Employment verification letters · expense receipts · travel questions | Nobody, unless a check fails — then a specialist |
| 🟡 | Do all the preparation, work out the risk, then **stop** and wait | Work authorization · resignation notice · contract amendments | One named specialist. For contract amendments, **two different, entitled people** |
| 🔴 | Compile the evidence and hand it over. **It cannot act at all.** | Permanent relocation · cross-border tax · off-cycle payroll | A senior specialist, on their own authority. Nothing here is an approve button |

**The level is not a label on a document. It is wired into what the code is
physically capable of doing.** For the two 🔴 research cases, the functions that
handle them are not *told* to refuse to write — they are written so that nothing
capable of writing can be handed to them at all. There is no approve button in
the sidebar, no write route on the API, and no branching in the workflow that
could lead anywhere else. Four separate layers, each independently proven by an
automated test.

**Off-cycle payroll is the deliberate exception, and the distinction is worth
holding on to.** It moves real money, so refusing to build a path for it would
be refusing to solve the problem. It has one — behind an approval that requires
at least two different people, always, whatever the system's own risk score says.
*"We do not automate this"* and *"this system cannot do this"* are different
promises, and this one makes both, in the places each belongs.

---

## 3. What happens when nobody can decide — and why that is the headline

There is a screen called the **approval queue**. It lists everything waiting on a
person. Its headline is not the work that is flowing. **It is the work that
nobody can reach.**

That choice is the whole point. A dashboard of green throughput is easy to build
and tells you nothing you did not want to hear. Pointed at the real production
data on 2026-08-19, this one read:

> **226 records. 124 waiting on a person. 31 of them with nowhere to be approved.**

Broken down: 22 had no support ticket at all, 10 were sitting in the account's
default catch-all group, 3 had no approval screen anywhere in the system, and one
pointed at a ticket that did not exist.

Every one of those 36 decisions was **correct, permanently recorded, and reached
nobody.** That is a worse failure than a wrong answer, because a wrong answer
gets complained about and this does not. Three examples, because the shapes are
different:

- **A request that was decided correctly and never reached Finance Ops.** An
  expense over the policy cap. The decision is right, the record is durable, and
  the trail carries a line saying the support ticket could not be created —
  **and there is no retry.** Still true when re-checked on 2026-08-20.
- **A ticket that looks completely fine and is in nobody's queue.** A work
  authorization, decided correctly, labelled correctly for the *Mobility
  Specialists* team — a team that did not exist in the support account. Nothing
  about the ticket looks wrong, which is exactly why it needed a screen to find
  it. The team has since been created; the ticket is *still* in the default
  group, because creating a team fixes the next hand-off and never the backlog.
  **Fifteen tickets are in that state today** (read live, 2026-08-20).
- **A use case where something must be signed and nothing could sign it.** Travel
  letters. Now fixed — but fixed for the one outcome that genuinely needed a
  signature, and deliberately *not* by adding buttons to the four outcomes that
  nobody signs.

**None of that was found by a test.** All of it was found by building the screen
that shows work nobody can reach, and looking at it.

---

## 4. What is measured, and why the obvious metric is the wrong one

A dashboard that maximised *"percentage automated"* would reward exactly what
this architecture exists to prevent. So every judgement it makes is **tier-aware**:

- On 🟢, a high automation rate is **success**.
- On 🟡, it is **meaningless** — the human approval *is* the design.
- On 🔴, it is an **integrity violation**, reported as a count that must read
  zero.

Three further choices are worth knowing about:

- **"Stop" is a first-class verdict**, alongside "healthy" and "iterate". A use
  case that is not earning its complexity should be turned off, and the
  measurement layer is allowed to say so.
- **Zero data is reported as `insufficient_data`, never as healthy.** A medium-
  or high-risk use case with no decided reviews used to read as green. There was
  nothing to be green about.
- **Exception reasons are ranked with exceptions as the denominator**, so the top
  row is directly the next thing worth engineering.

The human-approval numbers are a *measurement* rather than a definition because
every approval records **both** what the system recommended **and** what the
person decided, side by side. Without that pairing, "the specialist agreed with
us" is unfalsifiable.

---

## 5. Eleven judgement calls, and the reasoning behind each

These are the parts that would not appear in a feature list and are the parts
worth interrogating.

### Two of the nine use cases have no approve button anywhere, on purpose

Permanent relocation and cross-border tax produce a **dossier**, not a decision.
For those two, the dossier is not a by-product — it *is* the product. The system
compiles what it can see, quotes the statutes and treaties that actually govern
the question, marks each condition with **how much of it the system can actually
verify** — and it is never allowed to mark one as fully established. A senior
specialist then decides, on their own authority, with the evidence in front of
them.

Two details make this real rather than rhetorical:

- **The dossier now says it is research before it says anything else.** That
  sentence — *"research support only, not a residency, withholding or coverage
  determination"* — was being computed on every dossier ever produced and reached
  the reader on neither screen. On one it was simply dropped. On the other it was
  present and *unreadable*: row 34, beneath a fully-priced cost estimate, 3,876
  pixels down the page. On a friendly-looking dossier where every fee is priced
  and nothing is flagged, a page of confident facts reads as a green light, and a
  disclaimer at the bottom then corrects a conclusion the reader has already
  reached. It now renders directly under the heading, never behind a click.
- **The two most senior humans this system escalates to stopped being handed our
  own summaries.** Until recently those dossiers cited paragraphs this project
  had written itself, while the repository held 30 statutory instruments
  retrieved from their own publishers with checksums. They now quote the
  conventions actually in force — and where the governing text contains no answer
  at all, they say so with the text rather than with an assertion. One example:
  a 273-day presence count in the Netherlands, against a residence article that
  contains **no day count anywhere** — eleven words directing that residence be
  judged on the circumstances. A confident number measured against nothing.

### A vector database was measured and rejected, not skipped

The fashionable answer for "we have a pile of legal documents" is embeddings and
a vector search. This repository provisioned two vector tables a fortnight ago;
**both hold zero rows to this day**, and rather than quietly leaving them empty
somebody went and counted.

Chunked the way a retrieval system would actually chunk them, the corpus is
**106 passages** — and at 106 passages the case for embeddings is weak and the
case for a filtered keyword index over the real text is strong. The written
recommendation (`docs/RETRIEVAL.md`) is therefore **not to seed them**, and it
reports the evidence that argues *against* its own conclusion: the queries it
fails on cluster around documents whose operative text is in Dutch or Portuguese,
which is the single strongest argument for embeddings and is stated as such
rather than buried.

The distinction that stops "add AI retrieval everywhere" being the answer: on the
🟡 path a citation sits next to a decision a human is about to sign, and a
*nearly right* source is worse than none.

### The system tells you when it cannot read your request, instead of escalating

When someone describes a workation in a sentence and the system cannot extract
everything a decision needs, it does not escalate. **It asks.** Escalating would
hand a specialist a case whose stated reason is *"the fields were invalid"* —
which is a fact about our own reading, dressed up as a finding about the
employee's trip.

But the question is subordinate to the safety checks: a message naming a
sanctioned country is stopped outright and is never asked a follow-up, because
sanctions is checked before completeness. And anything the model extracted is
labelled as a **candidate** — on the screen, in the audit trail, and in the
summary — with that caveat added by the code rather than requested from the
model, because a warning a model can forget is a warning that will eventually be
forgotten.

### Documents were gathered, disagreed with the code 30 times, and were mostly not acted on

Thirty statutory sources were retrieved from their own publishers, each stamped
with a checksum. They contradict this system's own rules in **30 places**.

**Three of those have been fixed**, each as its own reviewed piece of work with
its own tests. One of them is worth quoting because it shows what this exercise
is for: the Portuguese notice-period table split at 23 months where the statute
splits at *two years inclusive*, so an employee with **exactly** two years'
service was being told they owed **60 days' notice where the law gives 30** —
double, against the employee, and invisible because no test had ever used exactly
two years.

**The other 27 have deliberately not been touched**, and that is a decision
rather than a backlog. Resolving a legal rule *wrongly* makes the system stricter
than the law and starts refusing valid requests — a new failure wearing the
clothes of a fix. And the sources are not uniformly right either: one retrieved,
authoritative government table pairs the start date of a superseded 1987
agreement with the maximum duration from the 2004 agreement that replaced it.
Only reading the treaties themselves caught that.

---

### A four-eyes control that was really two eyes, found by asking a plain question

Contract amendments — someone's pay, title or hours changing — require two
signatures before anything is filed at Remote. One from the **employer**, one
from a **Remote payroll specialist**. Two organisations, not two colleagues; that
is the stronger form of the control and it is the reason it exists.

Reviewing it, the question that landed was not technical: *"how can the customer
admin both request and approve the change — is that not wrong?"*

It was. The system captured who filed the request, stored it in its own database
column, and **never compared it to who signed.** So the person who typed the new
salary could sign the box confirming they typed it. The second signature — the
Remote specialist's — was real and independent throughout, so nothing could be
filed by one person alone. But the first signature could never disagree with its
own author, and a signature that cannot disagree is a formality.

**Three things about this are worth more than the fix.**

It was **deliberate**, and the reasoning was written down — in a code comment, in
the file that implements the control. It was **not** written in the document that
exists to argue the control, which is where anyone auditing it would look, and
which says plainly *"two independent people."*

It was **invisible to every automatic check.** Nothing was missing. Every other
refusal in that file — the same person signing both slots, one role signing twice,
someone claiming a role they do not hold — was present and correct. The tests
covered them thoroughly. A test of the actual gap would have **passed**, because
the behaviour was permitted.

And the fix was already sitting in the codebase, in Remote's own vocabulary.
Remote's platform distinguishes the admin who operates the console from the
company representative who signs — different people, different acts. Another part
of this system had modelled that distinction months earlier, for a different
screen. It simply never reached the gate. The correction is to use Remote's word:
slot one is the **employer's signature**, and the person who filed the request
cannot provide it.

*The general point for a CX organisation: controls degrade quietly. This one had a
name, a document, a test suite and a deliberate author, and it was still weaker
than everyone involved believed. What found it was somebody reading the description
and asking whether it made sense.*

### Where a fact is allowed to come from, when the sandbox cannot supply it

Building against someone else's platform, you constantly hit things their test
environment will not do. Remote's Sandbox will not let a partner file a
resignation. Its payroll calendar simply stops at a date. Some countries return
errors where others return data.

The tempting response is to invent whatever you need. The other tempting response
is to refuse to demonstrate anything you cannot demonstrate perfectly. Both are
wrong, and this project now has a written rule instead of a case-by-case argument
— **the substitution ladder**, four rungs, always take the highest that answers
the question:

1. **Remote's documentation is the source of truth.** Not our reading of it, not a
   sandbox's behaviour — theirs.
2. **Where the sandbox has real data, use the real data.**
3. **Where the sandbox refuses or cannot do it, replicate it in our own stand-in.**
4. **Where nothing relevant exists at all, fabricate it — marked.**

Two rules make the bottom two rungs safe, and neither bends. **Anything
substituted identifies itself** — a projected payroll cycle's reference literally
begins `standin-`, and the audit record carries a separate flag saying so, rather
than expecting a reader to recognise a naming convention. **Money is never
fabricated.** A schedule can be continued from a pattern; an amount cannot be
invented from anything. And a third, about honesty: **a real value always wins** —
a substitute may only ever fill a gap, never overwrite something the platform
actually said.

**Why it needed writing down.** Three separate times this project recorded "Remote
does not have this endpoint" when what had actually happened was that one test
query, on one day, came back empty. Two of those three endpoints turned out to
exist. A sandbox that refuses is a sandbox failing — it is not the platform
answering.

*The general point: teams building on partner APIs make this mistake constantly,
and it is expensive in a specific way. You build a workaround for a limitation that
is not there, then defend the workaround.*

---

### The case with no approve button still owes the person an answer

Two of the nine use cases deliberately have nowhere to approve anything. That is
the design and it is defensible. **What was not defensible, and went unnoticed for
months, is that the person who filed the request was never told anything again.**

They submitted, got an acknowledgement, and that was the end of it — permanently.
There was no state anywhere in the system that could even record *"a specialist
has read this."* The work was done: the research was compiled, the risks were
flagged, the sources were cited. It simply reached nobody, and nobody could tell.

The reason it survived is worth understanding, because it is not carelessness.
**Two different rules were being enforced by the same mechanism:**

1. *Nobody may approve this.* — the actual safety rule.
2. *Nobody may ever be told what happened.* — an accident.

Because both were satisfied by "there is no button", **fixing the second looked
like breaking the first.** Anyone who proposed adding a control to that screen
appeared to be proposing an approval control, and got the answer "no, that is the
whole point of this tier."

**The fix does not add an approval anywhere.** The specialist records what they
did — *read it* · *taking it forward* · *not proceeding* · *need more from you* —
and none of those does anything to the employee's contract. A human still performs
every step of the relocation in Remote's own system. What changed is that the
person who asked finds out, and the queue can finally tell the difference between
work waiting to be done and work already finished.

**Why a CX leader should care about the general version:** a queue that can only
grow stops being a queue. Once nothing can ever leave it, its size stops meaning
anything, and people stop looking at it. That is a measurable failure disguised as
a safety property.

*Found by someone asking a plain question about the design — "the employee who
filed is expecting feedback" — not by any test. The tests all passed, because the
system was doing exactly what it said.*

---

### A demo that quietly falls back is worse than one that fails

The system reads real data from Remote's sandbox. Sandboxes expire, get reset, and
go down — usually at the worst moment. The obvious protection is to keep a copy of
the data and use it when the live call fails.

**The obvious protection, done the obvious way, is dishonest.** If the page falls
back silently, then a demo that fetched live data and a demo that served a
month-old copy look identical — to the audience, and afterwards to us. The claim
"this system integrates with Remote's API" becomes unfalsifiable, which is a
strange thing to do to a claim you are making because it is true.

So the rule is: **the copy always says it is a copy.** It carries its capture date
on the page, the audit trail records which of the two answered, and a live value
always wins when one is available. The demo survives an outage, and anyone
watching can tell which they watched.

**The general version, which applies well beyond demos:** any fallback that cannot
be distinguished from the real thing eventually gets trusted as the real thing.
The value of a fallback is that it keeps you running; the cost is paid the day
somebody makes a decision on it without knowing.

### The travel record already existed — we were asking people to remember it

The cross-border tax review answers a question that turns on one number: how many
days somebody spent in a country, over a window. The system computed that number
from **travel dates the person typed into a form.**

Remote already knows. Every travel-letter request and every work-authorization
request an employee has ever filed carries the destination country, the start
date, the end date and whether it was approved — and the API publishes both
collections, filterable by employee. Those are the records the travel-support and
work-authorization use cases in this same system *create*. Nobody had read them.

Two things follow, and the second is the more useful one.

**A number's source is part of the number.** *"189 days"* measured from an
employer-approved record and *"189 days"* recalled by the person being assessed
are different pieces of evidence for the same figure, and a tax specialist acting
on the second while believing the first is exactly the mistake this system exists
to prevent. So the source now travels in the same sentence as the count.

**And the source the specification named could never have worked.** For months
the document said the count would come from *time-off records and workation
fields*. Time-off records carry no country — they record when somebody was not
working, never where they were — and a workation is somebody *working*, so it
produces no time-off record at all. A build task had been sitting in the roadmap
asking a future engineer to build something impossible. It was found by opening
the schema and reading it, which nobody had done because the sentence sounded
reasonable.

The general rule that came out of it: **writing down where a fact will come from
is a claim about somebody else's system, and it goes stale — or is wrong on the
day it is written — exactly like any other claim.** Check the source can carry the
fact before anything is built on the sentence.

### One question about who gets told found a defect four reviews had passed over

The question was plain: *when an employee asks a cross-border tax question and a
specialist finishes reviewing it, what does the employee get?*

Nothing. And the message meant to be that answer had been built, had the legal
disclaimer attached, and was covered by tests — and was **displayed by no screen
anywhere.** The compliance requirement it satisfied was therefore satisfied
*vacuously*: a disclaimer perfectly attached to something nobody sends.

Underneath it was a single confusion worth naming, because it is the hardest kind
of defect to catch. **Two rules were being kept by one mechanism.** *Nobody may
approve a tax determination here* and *nobody may ever be told what happened* are
different rules. The first is the safety guarantee. The second is nobody's rule at
all. Both were satisfied by the same thing: the absence of any way to write to the
record.

That is invisible to every check we run. Nothing is missing from the code, so a
diff shows nothing. A test of the gap **passes**, because the guarantee genuinely
holds. A reviewer auditing the safety property finds it intact. And the metrics
that would have shown it were disabled by the same missing piece.

It took somebody asking what the person on the other end receives.

The fix keeps both rules and separates the mechanisms: the specialist records what
they concluded — read it, proceeding, not proceeding, need more information — on
the support ticket rather than on the research record, and the person who asked is
told. Nothing is approved. Nothing executes. The safety guarantee is untouched,
and the person who asked a question gets an answer.


### The document that recorded a control said the control was already there

The last review looked at off-cycle payroll — the one place in this system where
money actually leaves a company's account. It is deliberately the most guarded:
nothing is paid until **two different named people, in different roles, sign for
it**, and no risk score can lower that floor.

The question put to it was plain: *does it actually enforce that the person who
asked for the money is not one of the two who approve it?*

**It does not.** It checks that the three signature slots are filled by three
different people — which is real, and was tested against a 320-case grid. What it
never checks is whether one of those signatures belongs to **the person who filed
the request in the first place**. So the admin who asked for a payment could sign
the box approving it, with a genuinely different second person signing the other
slot. Two signatures, one of them the beneficiary's.

That gap had been on the register for weeks and was queued to be fixed. **What
made it worth writing up here is what we found next to it.**

The day before, a different review had fixed exactly this defect on a *different*
use case, and had correctly added the missing rule to the architecture decision
record where such controls are supposed to be argued. In naming which use cases
already followed the rule, it wrote that off-cycle payroll **held it "in its
strongest form"** — and named the file.

It did not. The reviewer had checked the use case they were reviewing
exhaustively, and stated the others from memory — **because off-cycle payroll
looked stricter.** It has three signature slots where the other has two, an
explicit identity comparison, an unwaivable floor, and the largest test grid in
the system. Every one of those is real. None of them is the control being claimed.

**Why this is worse than the original gap, and why it is in this document.** A gap
is something a careful person can still find. A gap plus a written statement that
there is no gap **sends the careful person away** — and it does so through the
most trusted document available, citing the exact file where they would go to
check. An auditor asking "is four-eyes properly enforced here?" would have been
answered *yes, in its strongest form*, by us.

So two things changed. The **document correction is queued ahead of the code
change**, which inverts the usual order: the code gap is a few lines and can wait
for a queue, but the false assurance is being read now. And the rule for reviews
is now explicit — **a review may only make claims about the thing it is reading;
where it names something else, it cites the file or says it did not look.**

*The general version, which is not specific to software: when you fix one instance
of a problem, you naturally list the places that don't have it, to show the
contrast. Those places are the ones you didn't check. And they are the hardest
claims to catch afterwards, because everything around them was just verified.*

---

## 6. How you would know it is working — and how you would know it is not

The honest answer has three parts, and the third is the one most systems skip.

**1. Every decision is recorded before anything is said to anybody.** The order
is deliberate and was corrected once after being wrong: the durable record is
written *first*, and only then does the system reply to the customer or update
the ticket. Getting that backwards meant that a failure to update the ticket
erased the record of a decision that had genuinely been made. There is a
read-only viewer over the whole trail, including every individual attempt the
system made to read an external service, so "why did this fail at 3am" is
answerable without a database query.

**2. A duplicate request cannot produce a duplicate action.** Support webhooks
deliver at least once, not exactly once. One ticket once arrived three times and
produced two records and **a duplicate letter sent to a customer**. Every path
now reserves the request in a shared ledger before it does anything durable, and
the guarantee is a database constraint rather than a piece of code that checks
and then acts — because check-then-act has the very race that caused the bug. A
redelivery stops silently: paging a human every time the support tool behaves
normally trains everyone to ignore the alert.

**3. The system publishes what it gets wrong.** `CLAUDE.md` §7 carries a
numbered list of everything currently broken or unreachable — including the
approval-queue findings in §3 above, the two empty vector tables, and the places
where what is deployed disagrees with what is in the repository. On 2026-08-20
that list was re-audited item by item: six items had been fixed and the document
did not know, two were true but *understated*, one "fix" had not achieved what
its own description claimed, and four new problems were found by the audit
itself. Closed items are struck through with the evidence that closed them and
are **never deleted**, because a list whose entries quietly vanish teaches its
reader that the list is decorative.

That third part is the one to judge this by. Any system can show you a green
dashboard.

---

## 7. What this is not

- **It is not deployed to real customers.** It runs against Remote's public
  Sandbox and a test support account. No real customer data has ever been in it.
- **It is not a chatbot.** A model reads and classifies. It never decides, and it
  never performs an action.
- **It is not finished.** The most consequential unfinished thing is the one in
  §3: decisions that are correct and reach nobody. Every one of them is written
  down.
- **The decisions in §5 are decided, not yet built.** **All nine** use cases have
  now been through a review where every discrepancy between what the documentation
  promises and what the code does is put to a human, one at a time, and answered —
  off-cycle payroll, the last and the only one that moves money, went through on
  2026-08-21. **111 findings, 68 decided, 43 open.** Deciding is not building, and
  the register says which is which on every line — because a list that quietly
  upgrades *decided* to *done* is worse than no list.
- **The reviews kept finding things, right to the end.** The ninth and last opened
  **eight** new findings, the largest of any single review — including one in a
  correction the eighth review had just made. That is the argument for doing all
  nine rather than sampling: the rate of discovery never fell.

---

**Where to go next**

- [`START-HERE.md`](START-HERE.md) — run it yourself, fifteen minutes, no
  credentials needed.
- [`METRICS.md`](METRICS.md) — the measurement layer in full.
- [`APPROVAL-QUEUE.md`](APPROVAL-QUEUE.md) — the stuck list, and how it is
  derived.
- [`RETRIEVAL.md`](RETRIEVAL.md) — the vector-database question, measured.
- [`../CLAUDE.md`](../CLAUDE.md) §7 — everything currently broken.
