# UC-03 demo guide — Travel Support Letter / Workation Router

**Audience:** an EOR/HR/mobility operations person, or anyone non-technical who
wants to see this system decide real travel requests. No engineering
background assumed. Every "what you'll see" below was actually observed by
sending real requests to the live system on 2026-09-03 — nothing here is
imagined or extrapolated.

A note on vocabulary before we start, so the steps read cleanly: this system
sits behind Zendesk (the company's support-ticket tool) and Remote's own
employment platform. Internally, each of the nine kinds of request it handles
is called a "use case" and numbered — this guide is about **UC-03**, the third
one. A "gate" is just one check in an ordered checklist the system runs
through for every request — like a form with nineteen yes/no boxes, read top
to bottom, where the first box that says "stop here" decides the outcome. None
of that needs to be understood to follow the demo; it's here so the words
don't feel like jargon when they show up.

---

## 1. Sixty-second orientation

Employees write in with things like *"I need a travel letter,"* *"can I work
from Spain for a few weeks?"*, or *"what do I need for my trip to
Berlin?"* Those look similar but are actually different processes underneath —
some are a simple document request, some are a real work-authorization
question with tax and immigration consequences. UC-03's whole job is to tell
those apart and either handle the simple ones itself or hand the complicated
ones to the right place, with its reasoning attached so nobody starts from a
blank page.

It can do exactly four things with a request:

1. **Answer it on the spot**, in plain language, with a disclaimer — no
   document produced, nothing sent anywhere.
2. **Write and issue a formal travel letter immediately**, for a short,
   ordinary business trip, with no human in the loop.
3. **Draft a formal letter and stop for a named specialist to release it** —
   the one case where the letter cannot be produced automatically.
4. **Hand the request to somebody or something else** — a person, if the
   destination is sanctioned or the employee's record can't answer the
   question, or the correct downstream process (**UC-04**, the work-
   authorization use case) if the person is really asking to *work* from
   abroad rather than just travel there.

What it will **never** do: decide whether someone owes tax in another
country, calculate how many days they've spent in the Schengen area, or make
any call on immigration legality. Those are different use cases' jobs
(UC-04, UC-07, UC-08). UC-03 is a router with two small, safe jobs of its own
attached — not a compliance engine.

---

## 2. Before and after, in one picture each

Two diagrams, both drawn from what actually happens — the "after" one is read
straight off `src/uc03/policyEngine.js`'s nineteen-rung gate ladder and
`src/uc03/workflow.js`'s own step order, not sketched from memory. The
"before" one is a description of how a request like this is typically handled
by a human EOR/HR support team today — the queue-and-handoff shape this
system replaces, not a specific company's documented process.

### Before — a human support team, today

```text
  Employee writes in ("I need a travel letter" / "can I work from Spain?")
        |
        v
  +------------------------+
  |  Shared support queue  |    <- sits with every other ticket type;
  +------------------------+       no triage has happened yet
        |
        |   WAIT #1 (whoever picks it up next, hours to days)
        v
  +--------------------------+
  |  Agent reads it by hand  |  <- works out, from scratch, each time:
  +--------------------------+     employee or contractor? active,
        |                          onboarding or offboarding? a travel
        |                          letter, or a work-authorization ask?
        v
  +-----------------------+
  |  Looks up employment   |  <- a separate system; re-typed
  |     record by hand     |     or copy-pasted into the ticket
  +-----------------------+
        |
        +---- "is this really a WORK question?" ----+
        | no                                          | yes
        v                                              v
  +----------------------------+          +--------------------------+
  |  Drafts a letter by hand,  |          |  Hands off to mobility/  |
  |  checks sanctions by hand  |          |  immigration — WAIT #2,  |
  +----------------------------+          |  a new queue, restarting |
        |                                  +--------------------------+
        v
  +----------------------+
  |  Sends for a second   |   <- WAIT #3
  |  person's sign-off    |
  +----------------------+
        |
        v
  Reply to the employee, close the ticket
  (typical: hours to several days, start to finish)
```

### After — this system

```text
  Employee writes in (portal, or a Zendesk ticket)
        |
        v
  +-----------------------------------------------------+
  |  19 ordered gates, read top to bottom, in one pass   |  <- seconds, not
  +-----------------------------------------------------+     a queue — every
        |                                                     request runs the
        |  the FIRST gate that says "stop here" decides        SAME checklist
        |  the outcome — nothing below it runs
        |
   +----+---------------+------------------+---------------------+
   |                     |                  |                      |
   v                     v                  v                      v
 BLOCKED            AUTO_RESOLVE       HUMAN_REVIEW          ESCALATE, or
 (rungs 1,2,3,5)     (rungs 18-19)      (rungs 8,9,17)        ROUTE_TO_UC04
   |                     |                  |                (rung 10, plus
   |                     |                  |                 rungs 4,6,7,
 contractor asking   clean trip:        either the request     11-16)
 for an EOR-only     answered, or        couldn't be read           |
 letter, or an EOR   the standard        confidently and a     sanctioned
 employee whose      letter is           person reads it       destination /
 record nobody       WRITTEN AND         first, OR a letter    unreadable
 could read — no     ISSUED, with        IS drafted and         request / an
 letter, no wait,    nobody in the       STOPS for a named       archived
 no one asked        loop                Travel & Mobility      employee, OR
                                          specialist to sign     the request is
                                          or decline — or to     really about
                                          fix a record with      WORKING abroad
                                          no letterhead           -> handed to
                                                                   UC-04

  A PERSON ENTERS: never for BLOCKED or AUTO_RESOLVE. For HUMAN_REVIEW, one
  named specialist reads the case — a drafted letter waiting on a signature,
  or a request that needs a human read first — and decides or fixes it. For
  ESCALATE, a ticket is raised immediately, already tagged, routed and
  carrying the system's own reasoning — a person still makes the call, but
  they start from that, not from a blank ticket.
```

---

## 3. Setup

Open these, in this order:

1. **The request portal** — `https://remote-cx-apis.vercel.app/portal`
   This is the page a demo is driven from: pick who you're acting as (a
   dropdown of real, named employees), pick "Travel letter" as the request
   type, and either type free text or click one of the pre-built quick-fill
   buttons described below. It will ask for an access key once per browser
   session — that's a shared password kept in this project's configuration
   file (`.env`, the value named `PORTAL_ACCESS_KEY`); ask whoever set up the
   environment for it rather than looking for it in this document, since it's
   deliberately never written down here.

2. *(Optional, to show what happens after a request is filed)* **The audit
   viewer** — `https://remote-cx-apis.vercel.app/audit`. Read-only. Shows
   every decision the system has made, live, with the reasoning behind each
   one. Same access key.

3. *(Optional, to show the human hand-off queue)* **The approval queue** —
   `https://remote-cx-apis.vercel.app/queue`. Shows what is currently waiting
   on a person and where. Same access key.

No local software is required for any of this — it's all one live web
deployment. (For anyone who does want to run it from a laptop instead:
`npm install` then `npm run uc03-api`, per this repository's own setup
instructions — not needed for the demo below.)

---

## 4. The run

Each step below corresponds to a real, named quick-fill button on the portal's
"Travel letter" card. They're grouped by two questions the card itself lets
you flip between — **"what is being asked"** and **"who is asking."** Drive
them in this order; each one makes a different point.

### Step 1 — A clean business-travel question, answered instantly

**WHAT YOU DO:** On the portal, choose the person **Chris Lee** (a real,
active US-based employee) and the "Travel letter" card. Click the quick-fill
labelled **"Short business trip."** It fills in: *"I'm travelling to the
Netherlands for a client meeting from September 14 to October 2, 2026. Can
you confirm business travel is fine?"* Submit it.

**WHAT YOU'LL SEE:** The answer comes back immediately: **decision
`auto_resolve`, reason `all_gates_passed`.** No letter is produced — none was
asked for — and there's no ticket raised for a person to look at, because
nothing here needed one.

**WHY IT DID THAT:** Every one of the nineteen checks passed: Chris is a real
employee (not a contractor — more on why that matters in Step 4), his record
is active, the request was read confidently, the destination is a real,
recognised country, it's not on any sanctions list, and the trip is well
within the 30-day cap this system uses for "this is short enough to answer
without pausing." In the system's own words, this is *"every check passed, so
the question was answered directly, with the standing note that entry
requirements are the destination's to set. No formal travel letter was
written — none was asked for, and an answer is not a letter."*

---

### Step 2 — A standard travel letter, issued with no human signature

**WHAT YOU DO:** Same person, Chris Lee. Switch the card to the **"who is
asking"** view and click **"Visa support letter."** It fills in: *"I need a
travel letter for my visa application for a conference in Portugal from
September 20 to September 26, 2026."* Submit it.

**WHAT YOU'LL SEE:** **decision `auto_resolve`, reason
`standard_letter_issued`.** This time there *is* a document — the panel shows
a letter marked "Ready," with a button to open or save it. Pulling that
document back off the system directly (its own words): *"The formal travel
letter for this trip has been written and issued. It is yours to open or
save,"* and the underlying record is explicitly flagged
`issuedWithoutSignature: true`. Nobody approved this trip and nobody signed
this letter — it went out the moment every check passed.

**WHY IT DID THAT:** This is Remote's project owner's own product decision,
made 2026-08-30 (`UC-03.md` §23): a *standard* travel letter — one that states
only the rows the template already carries, for a qualified employee, on a
trip inside the cap — used to always wait for a specialist to sign it. That
signature step was found to be gating the *routine* case just as hard as the
*exceptional* one, so the routine case now issues on the spot. In the
system's words: *"Nobody had to approve the trip or sign the letter — it was
issued as soon as every check passed."* The important caveat, honestly stated
by the system itself right next to the letter: this is **this project's own
policy call**, not Remote's platform doing it — Remote's own travel-letter
product still requires its Mobility Team's sign-off before it will generate
one, but this system renders its own letter and never calls that endpoint, so
there's no platform gate to defer to here.

---

### Step 3 — A formal letter that stops for a specialist, and where they sign it

**WHAT YOU DO:** Switch the person to **David Chen** (a real, active
US-based EOR *employee* — not a contractor). Switch the card to the "who is
asking" view and click **"…the same letter, asked by David."** It fills in
the *exact same words* as Step 2's letter request, word for word, submitted by
a different person: *"I need a travel letter for my visa application for a
conference in Portugal from September 20 to September 26, 2026."* Submit it.

**WHAT YOU'LL SEE:** **decision `human_review`, reason
`formal_letter_requested`**, with flags `formal_letter_requested` and
`letterhead_unavailable`. No letter is produced — the panel shows "None,"
not "Ready" — but unlike Steps 5 and 6, a real Zendesk ticket *is* raised
immediately, tagged and assigned to **Travel & Mobility Support**. This is a
real live-deployment run (ticket **#325** in this project's Zendesk account),
not a simulation: the same portal and the same live decision endpoint as
every other step in this guide, with a different named person asking.

**WHY IT DID THAT:** every check about the trip itself passed — same
destination, same dates, same words as Chris's letter in Step 2 — but David's
Remote employment record **names no employing legal entity**. There is
nothing to put on the letterhead, so nothing was auto-issued and nothing was
silently guessed either. In the system's own words: *"A travel letter was
asked for and the trip qualifies for it, but your employing entity's record
could not be read — so there was no letterhead to write on and nothing was
written. A Travel & Mobility Support specialist has it."*

**Why this is a different kind of stop from David's own colleague Chris's
outcome in Step 2, even though nothing about the *trip* differs:** the
routine, no-signature path (Step 2) still requires there to be an entity to
put on the page — it was never a blanket "skip the signature," it is "skip
the signature when there is nothing left to check." An unwritable letterhead
is a record problem, not a travel problem, so a person is asked to fix the
record rather than the system inventing an entity name to fill the gap.

**Where a specialist actually does this, in the real product:** inside
Zendesk, in a sidebar panel built for this system (the "ZAF sidebar"
mentioned in this project's own documentation), a person holding the
**Travel & Mobility Support specialist** role opens ticket #325 and is shown
who the letter is about, why it stopped, and two buttons: sign off, or
decline. We tried to drive that exact click from outside Zendesk, against the
live deployment, to see what happens without one — and it refused, correctly
and by design:

```
{"ok":false,"code":"signed_identity_required","reason":"This service requires
a signed ZAF identity token ... and none was supplied."}
```

That is the same fail-closed rule this project applies everywhere a human
approval carries weight (`CLAUDE.md` prime directive 3: identity comes from an
authenticated signal, never a claim) — a specialist's sign-off has to come
from inside the real Zendesk sidebar, with a token Zendesk itself signs, or it
does not happen. So the live demo can now drive the request all the way to
"a named specialist is looking at ticket #325 with a drafted case in front of
them" by clicking through the portal — what it cannot do without a real
Zendesk login is click the sign-off button itself. If you want to show that
last click, it needs a Zendesk-signed-in browser (see §7 below, same caveat as
viewing Steps 5/6's tickets directly).

---

### Step 4 — A contractor, refused outright

**WHAT YOU DO:** Switch the person to **Alexandre Tremblay** — a real,
active Canada-based person, engaged as an independent **contractor**, not an
employee. Click the quick-fill labelled **"…the same letter, asked by
Alexandre"** — it is the *exact same words* as Step 2's letter request, word
for word, submitted by a different person.

**WHAT YOU'LL SEE:** **decision `blocked`, reason
`engagement_not_eor_contractor`.** No letter, no document of any kind, and no
ticket raised for anyone to review — this is not a "wait for a person" outcome
at all.

**WHY IT DID THAT, in business terms:** Remote is Alexandre's *client*, not
his legal employer — he is engaged as an independent contractor. A travel
support letter is Remote, as the legal employer, attesting to someone's
employment; Remote cannot attest to an employment relationship it does not
have. This is Remote's own published position, not a caution this project
added: both of Remote's travel articles are headed **"This is applicable to
EOR customers only"** (support.remote.com articles
[37802056865933](https://support.remote.com/hc/en-us/articles/37802056865933)
and
[37802834593805](https://support.remote.com/hc/en-us/articles/37802834593805)),
Remote states plainly that **"Direct Employees and Contractors are not
eligible"** for the related employment verification letter
([17537524163853](https://support.remote.com/hc/en-us/articles/17537524163853)),
and separately that Remote **"cannot assist contractors with sponsored
routes for work permits"** unless the client converts them to a full-time
employee
([20362380655501](https://support.remote.com/hc/en-us/articles/20362380655501)).
Nothing the employee adds changes this — it is a fact about the relationship,
not a judgement about the trip — so there is no one to route it to for a
second look.

**What the system tells Alexandre to do instead**, in its own words: *"What
usually works instead is your contract together with your invoice or payment
history, which is what most consulates accept from a contractor."*

**Why this is a *harder* stop than Step 6's (below), and worth contrasting
out loud:** a contract type is a fact about *what the relationship is*, and
nobody — not the system, not a specialist — can turn a contractor into an
employee by looking at the case again. An employment *status*, which is
what Step 6 is about, is a fact about *a moment in time* — someone can be
mid-offboarding, there might be a severance question or a dispute behind it —
so that one goes to a person to actually look at, rather than being refused
outright.

---

### Step 5 — A destination the system will never allow, whoever asks

**WHAT YOU DO:** Back to Chris Lee. Click **"Trip to a restricted country"** —
it fills in a request for a business trip to Iran.

**WHAT YOU'LL SEE:** **decision `escalate`, reason `sanctioned_region`.** No
letter, and this time a real Zendesk support ticket *is* raised and assigned
to the Travel & Mobility Support team, tagged for their queue.

**WHY IT DID THAT:** Iran is on a fixed list of sanctioned or heavily
restricted destinations the system checks before anything else about the
trip. In its own words: *"The destination is on the sanctioned or restricted
list. This is not a support question at all… and no extra information from
the employee changes that."* This is the one refusal in the whole use case
that genuinely has no recourse — not "a person will look at it and maybe say
yes," but a hard stop that goes to a person only so a human is aware of it,
not so they can overturn it. **One small, honest wording note**: the
on-screen explanation for this refusal currently says the request "has gone
to Travel & Mobility Support," which is exactly where it goes — but a related
sentence elsewhere in this system's own documentation still names an older,
non-existent team, "Global Mobility," as the owner. It's a known, tracked
wording mismatch (see §7 below), not a mistake in the decision itself.

---

### Step 6 — An archived employee, sent to a person rather than refused

**WHAT YOU DO:** Switch to **Thomas Weber** — a real employment record whose
status is genuinely **archived** (not currently employed). Click **"Asked by
an archived employee."** Same short trip wording as Step 1, different person.

**WHAT YOU'LL SEE:** **decision `escalate`, reason `employee_not_active`.**
A ticket is raised and assigned to Travel & Mobility Support, same as Step 5
— but this is a *different kind* of stop, and worth pointing out to a
business audience even though it lands on the same team.

**WHY IT DID THAT, and why this is not the same shape as Step 4's refusal:**
Thomas's employment record is not active, so there is no live employment for
a travel letter to describe. In the system's own words: *"The employment
record is not active, so there is no live employment to give travel support
against. A former or suspended employee's travel is not something this can
answer."* This goes to a **person**, not a hard stop, on purpose: an
employment status is a fact about a specific moment, and there may be more
going on behind it than the label says — an offboarding still in progress,
severance, a dispute. Somebody has to actually look, which is exactly the
distinction drawn at the end of Step 4: a contract type is permanent and
un-overturnable; a status is a snapshot that deserves a second look.

---

### Step 7 — A request that's really about working abroad, not just visiting

**WHAT YOU DO:** Back to Chris Lee. Switch the card to **"what is being
asked"** and click **"Workation from the Netherlands."** It fills in: *"I'd
like to work remotely from the Netherlands for a month while on holiday — can
I do my normal job from there?"* — deliberately with no dates typed in, which
matters (see below).

**WHAT YOU'LL SEE:** **decision `route_to_uc04`, reason
`work_authorization_requested`.** No letter, no simple answer — instead the
panel offers a **continuation**: *"Working from another country needs
authorization… Continuing carries your trip details across and asks you for
the things a travel request never states; nothing is submitted until you send
that form."* It shows what would carry over automatically (Chris's own
employment id, his home country of "US," and the destination "NL" it read out
of the sentence) and what it genuinely cannot supply and has to ask for by
name: his nationality, the visa he intends to travel on, what he'll actually
be doing while there, and whether he can sign contracts on the company's
behalf.

**WHY IT DID THAT:** the moment a request is about *working* from somewhere,
rather than just visiting, it stops being a simple travel question — it
becomes a real question about tax exposure, permanent-establishment risk and
immigration status, which is a different, more careful process (**UC-04**,
"work authorization"). In the system's own words: *"Nothing has been
submitted on the employee's behalf and nobody is reviewing anything — this
answer is the whole of what has happened so far… Whether working from the
destination is allowed is settled on that request, and it has not been
settled yet."* Nothing about the trip has been approved *or* refused at this
point — it's a handoff, not a verdict. (This guide stops at the handoff:
actually filing that follow-on UC-04 request is a separate use case with its
own demo.)

---

## 5. What this is worth, and how to check the arithmetic yourself

**This section is deliberately conservative.** This deployment has no real
production ticket volume behind it — every number below either carries a
published source or is marked `[ASSUMPTION]` with the reasoning shown, so a
sceptical reader can substitute their own inputs and get their own answer
rather than take this document's word for it. Where a figure could not be
found published anywhere, it is not quietly estimated and presented as fact.

### What UC-03 actually removes from a person's day

Two of the four outcomes (Steps 1, 2) need no person at all. One (Step 3)
still needs a specialist's signature, but arrives at their desk already
triaged, already checked against the employment record, and with a drafted
document rather than a blank ticket. The remaining outcomes (Steps 4–7) are
either a hard, unappealable fact (Step 4) or a ticket that still needs a
person to make the actual call (Steps 5, 6, 7) — UC-03 does not shorten the
decision there, only the time it takes to reach the right queue with the
right context attached.

### The published benchmarks

| What | Figure | Source |
|---|---|---|
| Average cost per Tier-1 support ticket (agent-handled) | **$22** (range $6–$35) | [ScreenMeet, "IT Help Desk Cost Per Ticket Benchmarks," citing MetricNet/HDI-class benchmarking](https://www.screenmeet.com/blog/it-help-desk-cost-per-ticket-benchmarks) |
| Average agent *working* time on an HR ticket, once picked up | **63 minutes** | [Unthread, "HR Help Desk Statistics 2026," citing Endsight](https://unthread.io/blog/hr-help-desk-statistics/) |
| Average *total elapsed* time for an HR ticket (queue + handoffs, not working time) | **82 hours** (median; top 20% of teams: 43 hours; top 5%: 17 hours) | [Unthread, "HR Help Desk Statistics 2026," citing a Jitbit analysis of 1,000 SaaS companies](https://unthread.io/blog/hr-help-desk-statistics/) |
| Average hourly rate, Immigration/Global Mobility Specialist (US) | **$40/hr** (range $31–$51/hr) | [Salary.com, "Immigration Specialist Salary," updated 2026-09-01](https://www.salary.com/research/salary/benchmark/immigration-specialist-salary) |
| Fully loaded cost multiplier over base salary | **1.25×–1.7×** base salary (worked example: 1.61×) | [ScaleArmy, "Fully Loaded Cost of an Employee"](https://scalearmy.com/blog/calculate-fully-loaded-cost-of-an-employee/) |

None of these are travel-letter-specific — nobody publishes a benchmark for
"cost to triage one EOR travel-letter request," so the HR-ticket and
Tier-1-support figures above are the closest published proxies, not an exact
match. That gap is named, not hidden.

### Inputs you can change, and the arithmetic in the open

| Input | This document's value | Where it comes from |
|---|---|---|
| Travel-letter / workation tickets per month, one mid-size customer | **40** | `[ASSUMPTION]` — a round, deliberately modest number for a company with a few hundred internationally-mobile staff; substitute your own volume |
| Share landing on Steps 1–2 (`auto_resolve` — no person at all) | **50%** | `[ASSUMPTION]` — this guide's own four "who is asking" / "what is being asked" quick-fills show 2 of 4 named scenarios landing here (Chris on a clean trip, and on a standard letter); no live production mix exists to measure this against |
| Person-time a manual triage + draft would otherwise take, per routine request | **30 minutes** | `[ASSUMPTION]`, reasoned down from the 63-minute *general* HR-ticket average above — a travel letter is a narrower, more templated task than the average HR ticket, so half that figure is used as a conservative floor rather than the full 63 minutes |
| Fully loaded hourly cost of the person who would have done that triage | **$40/hr** | Salary.com, Immigration/Global Mobility Specialist average, cited above — used as-is, not inflated by the 1.25–1.7× multiplier, because it is already a market rate rather than a raw base salary |

```
monthly saving  =  tickets/month  ×  share auto-resolved  ×  time saved  ×  hourly cost
                =  40             ×  50%                  ×  0.5 hr      ×  $40/hr
                =  $400/month  (≈ $4,800/year)
```

**Deliberately modest, and it should read that way.** Doubling any one input
(more tickets, a higher auto-resolve share, a fuller 63-minute estimate, a
senior specialist's rate) roughly doubles the figure — the arithmetic is
linear and left in the open so a reader can run it against their own numbers
rather than trust this document's. This is the saving on the **routine
share only**; the escalation and specialist-sign-off outcomes are addressed
separately below because their saving is smaller and different in kind.

**What this figure does *not* include, and why not**: the AI classification
call this system makes on every request has a real, non-zero marginal cost
(OpenAI usage), and this project's own status notes
(`CLAUDE.md` §7, item 22) record that the exact model and rate in production
are not currently priced against a published rate card. Rather than invent a
per-call cost, this document leaves it out — it is real, it is small compared
to 30 minutes of a $40/hr person's time, and it is not quantified here.

### The smaller, but real, saving on the outcomes that still need a person

For Step 3 (a drafted letter stopped for a specialist) and Steps 5–6
(a ticket raised for a genuine judgement call), UC-03 does not remove the
person — it removes the **first several minutes of figuring out what this
even is**: confirming the employment record, reading the trip details out of
free text, checking whether this is a travel question or a work-authorization
one, and deciding which queue it belongs in. Call that **10 minutes per
ticket** `[ASSUMPTION]`, reasoned from the same 63-minute HR-ticket average as
a fraction rather than the whole — a specialist still has to make the actual
call, but does not have to do the reading and routing UC-03 has already done.
On the same 40-ticket month, if half of the remaining 20 tickets land here:
`20 × 0.5 × (10/60 hr) × $40/hr ≈ $67/month`. Small on its own; the honest
reason to include it is that it is the same kind of saving, not a bigger one.

### The value that is not a time saving at all

- **Consistency of refusals.** Every contractor asking for an EOR-only
  travel letter gets refused the same way, citing the same two published
  Remote articles, every time — not "whichever agent picked up the ticket
  happened to know Remote's contractor policy that day." Step 4 is the
  demonstration: the reason and the remedy sentence are identical on every
  run, because they are read off Remote's own published position rather than
  recalled from memory.
- **An audit trail per decision, not per agent's notes.** Every one of the
  seven steps in this guide produced a real, timestamped record naming which
  of the nineteen gates decided it, in `audit_log` and (for Steps 3, 5, 6) a
  tagged Zendesk ticket — reconstructable later without asking the person who
  handled it what they remember doing.
- **A sanctioned destination never reaches a work-authorization record.**
  Step 5's Iran example is checked *before* anything else about the trip, and
  hard-stops rather than merely flags. This document does not attach a dollar
  figure to that — the cost of a sanctions-adjacent compliance failure is
  real but genuinely speculative to price for a system that has never
  produced one, and inventing a number here would be exactly the kind of
  overclaim this section exists to avoid. The concrete claim is narrower and
  verifiable: no sanctioned-destination request has ever produced a Remote
  travel-letter or work-authorization record through this router, and Step 5
  demonstrates why that is structural rather than a matter of the model
  "usually" getting it right.
- **A contractor is never told the wrong thing.** Before the engagement gate
  existed, real tickets were filed by contractors and routed to a specialist
  who then had to discover, by hand, a fact Remote already publishes (see
  Step 4's citations). Every such misroute costs a specialist's time on a
  question that had exactly one correct answer from the start.

### What this system does *not* save — said plainly

- **The specialist's sign-off in Step 3 still needs a person, every time.**
  UC-03 gets the case to their desk faster and more complete; it does not
  make the decision for them, and it should not — Remote's own platform
  requires the same signature at the equivalent stage of its Request Hub
  flow.
- **Steps 5, 6 and 7's escalations still need a person to make the actual
  call.** A sanctioned destination, an archived employee's trip, and a
  work-authorization question are all handed to someone with context
  attached — none of them is decided by this router. That is deliberate, not
  a shortfall: `docs/use-cases/UC-03.md` scopes UC-03 as a router with two
  small jobs of its own, not a compliance engine.
- **UC-03 answers no tax, immigration, or day-counting question, on
  purpose.** Section 1 above says so plainly, and Step 7 demonstrates the
  boundary directly: a workation request is handed to UC-04 unresolved,
  neither approved nor refused. Whatever those questions are worth to
  automate — and some of them may not be worth automating at all — is out of
  scope for this document and, by this project's own design, out of scope for
  UC-03.

---

## 6. Questions they will ask

**"Why was that person refused, and can they appeal it?"**
Depends which kind of refusal. A sanctioned destination (Step 5) and a
contractor asking for an EOR-only document (Step 4) can never be overturned —
they're facts, not judgement calls, so there's nobody to appeal to and the
system says so plainly. An archived employee (Step 6) and anything the system
couldn't read confidently *do* go to a person, because there might be more to
the story.

**"Why did that one get a letter instantly, with nobody checking it?"**
Because every one of nineteen checks passed and the letter is the *standard*
one — every fact it states is already true on the employee's record, nothing
was added, nothing was removed. That's a deliberate 2026-08-30 decision by
this project's owner (not something Remote's own platform does automatically
— see Step 2's caveat) to stop making a human sign off on a document that
was never in question.

**"Who decides, and when does a person actually get involved?"**
Three shapes: (1) never — the system answers or issues on its own, as in
Steps 1 and 2; (2) a named Travel & Mobility Support specialist inside
Zendesk signs off a drafted letter before it goes out, as in Step 3, for the
cases the system can't finish with confidence; (3) a ticket is raised for a
person to work through something the system correctly won't decide on its
own — a sanctioned destination, an unreadable request, an archived employee.

**"What happens to it now?"** — after a ticket is raised (Steps 3, 5 and 6): it
lands in Zendesk, tagged and assigned to the Travel & Mobility Support team's
queue, with the classification and reasoning already attached, so whoever
picks it up isn't starting from the raw message.

**"Is that Remote's actual rule, or something you invented?"** Called out
explicitly, scenario by scenario, in this guide: the contractor refusal
(Step 4) and its two remedy sentences are Remote's own published policy,
cited by article. The sanctions list (Step 5) is this project's own
illustrative list — modelled on Remote's public exclusions, but not Remote's
authoritative compliance list, which this project has no access to. The
"issue the standard letter instantly" decision (Step 2) is explicitly this
project's own product call, made against a document this system renders
itself — Remote's own travel-letter product still requires its Mobility
Team's approval before *it* will generate one.

---

## 7. If something goes wrong on the day

- **The portal asks for a key and you don't have it.** That's
  `PORTAL_ACCESS_KEY`, a shared password in this project's `.env` file — not
  something this guide prints. Get it from whoever manages the deployment
  before the demo starts.

- **Step 5 (Iran) comes back `escalate` with reason `destination_unknown`
  instead of `sanctioned_region`.** This is a known, tracked gap, not a new
  bug: if the AI reader that normally understands the free text is
  unreachable for any reason, the system falls back to a much simpler
  keyword-matching reader, and that fallback's country dictionary happens not
  to include any of the ten sanctioned codes — so it correctly still refuses
  the request (it fails safely), but for the honest-but-less-useful reason
  "we couldn't tell where you're going" rather than "that destination is
  restricted." If this happens, say so out loud rather than re-running it
  hoping for a different answer — it's evidence the AI reader was briefly
  unavailable, not evidence the sanctions check is broken.

- **Step 3 (David Chen's letter) — the request and hand-off are live-clickable
  from the portal; the specialist's actual sign-off click is not, without a
  real Zendesk login.** Driving the request through the portal (as the step
  says) is a normal, real, driven-live step, same as every other one in this
  guide — it was not always: until commit `04daf21` on 2026-09-03, the one
  persona whose record had no employing entity was also a contractor, so an
  earlier engagement check refused him first and this outcome could not be
  reached by clicking through the demo at all. If asked to show the actual
  sign-off button being clicked, be upfront that it needs a Zendesk-signed-in
  browser — this guide confirmed the sign-off route itself is real and
  correctly gated (it refuses an unsigned request with
  `signed_identity_required` rather than accepting one), but clicking the
  button needs the same Zendesk sign-in named in the bullet below.

- **A step you run produces a different case ID or ticket number than this
  guide's examples.** Expected — every run in this guide created a brand-new,
  real record with its own reference. What should **not** differ is the
  `decision` and `reason` values quoted for each step; those are the ones to
  check against.

- **You want to show the resulting ticket in Zendesk itself.** This guide
  only verified the portal's own view of each decision (what the requester and
  the audit trail see), not the live Zendesk agent view, which needs separate
  Zendesk sign-in this guide's preparation did not have. The ticket numbers
  and group assignment shown in Step 5/6's testing were real and correctly
  routed, but walk into that part of the demo knowing it wasn't screenshotted
  in advance.

- **Somebody asks why the on-screen wording still says "Global Mobility"
  instead of "Travel & Mobility Support" for the sanctioned-destination
  case.** It's a known, already-documented inconsistency in this system's own
  internal notes (`docs/ESCALATION-DESTINATIONS.md`) — the ticket really does
  go to the correct team, only one explanatory sentence hasn't been updated to
  match. Worth naming rather than papering over if it comes up.
