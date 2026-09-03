# UC-02 demo guide — Expense & Receipt Validation

**Audience:** an EOR/HR/finance operations person, or anyone non-technical who
wants to see this system decide real expense claims. No engineering background
assumed. Every "what you'll see" below was actually observed by sending real
requests to the live system on 2026-09-03 — nothing here is imagined or
extrapolated.

A note on vocabulary before we start, so the steps read cleanly: this system
sits behind Zendesk (the company's support-ticket tool) and Remote's own
employment platform. Internally, each of the nine kinds of request it handles
is called a "use case" and numbered — this guide is about **UC-02**, the
second one. A "gate" is one check in an ordered checklist the system runs
through for every claim — like a form with sixteen yes/no boxes, read top to
bottom, where the first box that says "stop here" decides the outcome. None of
that needs to be understood to follow the demo; it's here so the words don't
feel like jargon when they show up.

---

## 1. Sixty-second orientation

An employee spends their own money on something for work — a client lunch, a
hotel, a software subscription — and files an expense claim with a receipt
attached, the normal way, inside Remote. Someone in Finance then has to look at
that claim: open the receipt, check the total and the date against what was
typed in, check it's the right spending category, check it's under whatever
cap the company sets for that category, check it isn't the same receipt
claimed twice, and decide.

UC-02 does that checking automatically, for every claim, before a person ever
sees it. It runs **sixteen ordered checks** ("gates") against the real Remote
record and, where a receipt is attached, an AI vision model's own reading of
that receipt. Two things can happen:

1. **Every gate passes** → the claim is approved automatically, at Remote,
   with nobody reading it.
2. **Any gate stops the claim** → nothing is approved or declined by the
   system. A Zendesk ticket is raised for Finance Ops, carrying exactly which
   gate stopped it, the figures behind that gate's refusal, and what the
   receipt-reading model saw — so the person who opens it isn't starting from
   the raw claim.

What it will **never** do: invent a total the receipt doesn't show, approve
something above the spending cap because the AI was confident about the
category, or assert that VAT/tax can be recovered on a claim. Those are
deliberately structural limits, not settings — the write this system is
capable of making has no field for any of them.

---

## 2. Setup

Open these, in this order:

1. **The request portal** — `https://remote-cx-apis.vercel.app/portal`
   This is the page a demo is driven from: pick who you're acting as (a
   dropdown of real, named employees), pick **"Expense & receipt
   validation"** as the request type, and either pick a specific claim from a
   live dropdown (populated from Remote, showing the title, amount, currency
   and id of each of that person's own expenses) or click one of the
   pre-built quick-fill buttons described below. It will ask for an access
   key once per browser session — that's a shared password kept in this
   project's configuration file (`.env`, the value named
   `PORTAL_ACCESS_KEY`); ask whoever set up the environment for it rather
   than looking for it in this document, since it's deliberately never
   written down here.

2. *(Optional, to show what happens after a claim is filed)* **The audit
   viewer** — `https://remote-cx-apis.vercel.app/audit`. Read-only. Shows
   every decision the system has made, live, with the reasoning behind each
   one. Same access key.

3. *(Optional, to show the human hand-off queue)* **The approval queue** —
   `https://remote-cx-apis.vercel.app/queue`. Shows what is currently waiting
   on a person and where. Same access key.

No local software is required for any of this — it's all one live web
deployment. (For anyone who does want to run it from a laptop instead:
`npm install` then `npm run uc02-api`, per this repository's own setup
instructions — not needed for the demo below.)

**One honest thing to say up front about what "live" means here.** The portal
you'll click through is real, deployed code, and every decision below was
computed by the real sixteen-gate engine and (where noted) a real Zendesk
ticket was really raised. But the Remote data behind the demo personas is
served by this project's own in-process stand-in for Remote, not the live
Remote Sandbox — deliberately, because a public web page must never write
into a real Remote account. §6 explains what has, separately, been proven
against the *real* Remote Sandbox, and why that can't be the thing a public
demo page runs on.

---

## 3. The run

The portal's "Expense & receipt validation" card offers **five quick-fill
buttons**, grouped by the two questions the card lets you flip between —
**"what is being asked"** and **"who is asking."** Every one below was driven
for real against the live deployment. Because these five buttons point at a
small, fixed set of demo expenses that get *decided once and then remembered*
(more on this in a moment), the first time each was tried today the system
correctly **replayed its earlier decision** rather than deciding again — so
each was also re-run using the portal's "file this as a new claim" option,
which mints a genuinely fresh, undecided copy of the same expense. Both the
replayed and the freshly-decided runs are reported below, and they agree,
which is itself worth seeing: **the same claim, decided twice, months apart,
comes out the same way.**

### Step 1 — A clean claim, approved with nobody reading it

**WHAT YOU DO:** On the portal, choose the person **Chris Lee** (a real,
active US-based employee) and the "Expense & receipt validation" card. Click
the quick-fill labelled **"Clean meals expense"** — a $142.00 team-dinner
claim, already in Remote as a pending expense, with a receipt attached.
Submit it.

**WHAT YOU'LL SEE:** **decision `auto_approve`, reason `all_gates_passed`.**
No ticket is raised. The panel's plain-language answer: *"Yes — your expense
claim passed every check and was approved at Remote, with nobody needing to
look at it."*

**WHAT WE OBSERVED, driven live:** the button's own claim (already decided in
an earlier session) replayed the stored answer — `auto_approve /
all_gates_passed` — and a **freshly-minted copy** of the same claim
(`d44b487b-…`) was decided from scratch moments later and reached the
identical outcome: `auto_approve`, gate 15 of 16 (*"All gates"*), every rung
above it marked `passed`.

**WHY IT DID THAT:** every one of sixteen checks passed — Chris is the real
employee the claim belongs to, his employment is active, the claim is still
pending, it isn't a repeat of an already-paid receipt, its category
(`work_meals_and_entertainment.internal_meals_and_entertainment`, "Internal
meals and entertainment") is one he can file against, a receipt is attached,
the money fields reconcile with each other, and the $142.00 is under that
category's $500.00 cap. In the system's own words: *"Every check passed: the
expense belongs to this employee, its category is one they can file against,
it carries a receipt, and the amount is within that category's spend cap —
so no person is needed."*

---

### Step 2 — Over the spending cap, sent to a person with the arithmetic attached

**WHAT YOU DO:** Same person, Chris Lee. Click **"Over the category cap"** —
an $880.00 whole-department dinner claim, same category as Step 1.

**WHAT YOU'LL SEE:** **decision `human_review`, reason `over_policy_cap`.** A
real Zendesk ticket is raised and assigned to Finance Ops. The panel's plain
answer: *"Not yet — your expense claim is with Finance Ops, and a person
there decides whether it is paid."*

**WHAT WE OBSERVED, driven live, on a freshly-decided copy:** ticket **#327**,
raised and assigned to Finance Ops, priority normal. The system had already
done the arithmetic a reviewer would otherwise have to do by hand: *"880.00
USD claimed against a 500.00 USD cap for Internal meals and entertainment —
over by 380.00 USD (76% over)."*

**WHY IT DID THAT:** gate 12 — the same claim, the same category, a bigger
number. Every gate before it still passed (it is a real, owned, pending,
non-duplicate, correctly-categorised, receipted, arithmetically-sound claim);
gate 12 is simply the one that says no. Nothing about *this* being an
"exception" changes what a Finance Ops specialist has to do to clear it — the
system has already told them exactly how far over the line it is.

---

### Step 3 — Someone else's expense, refused before any money question is asked

**WHAT YOU DO:** Still Chris Lee. Click **"Someone else's expense"** — a
$96.00 claim that genuinely belongs to a different employee, James Wilson,
submitted under Chris's session.

**WHAT YOU'LL SEE:** **decision `escalate`, reason
`expense_employment_mismatch`.** A real Zendesk ticket is raised. The panel's
plain answer: *"Not decided here — your expense claim could not be judged
automatically, so it has gone to Finance Ops for a person to work through."*

**WHAT WE OBSERVED, driven live, on a freshly-decided copy:** ticket **#328**,
raised and assigned to Finance Ops. *"The expense belongs to a different
employee, so the person who submitted it cannot act on it."*

**WHY IT DID THAT, and why it stops so early:** ownership is gate 4 — before
category, before the receipt, before any figure is even looked at. Whether an
$880 dinner is within policy is not a question worth answering about
somebody else's expense; the system refuses to even get that far. This is
also the gate that stops an honest mistake (a wrong id typed or picked) from
turning into a wrongly-paid reimbursement, whatever the rest of the claim
looks like.

---

### Step 4 — The same expense, filed by the person it actually belongs to

**WHAT YOU DO:** Switch the person to **James Wilson**. Click **"…James's own
expense, filed by James"** — a similar, but not identical, $88.00 claim that
really is his.

**WHAT YOU'LL SEE:** **decision `auto_approve`, reason `all_gates_passed`.**
No ticket, no person involved.

**WHAT WE OBSERVED, driven live, on a freshly-decided copy:** `auto_approve`,
no ticket raised — the mirror image of Step 3, from the same two people,
proving the refusal in Step 3 was really about ownership and nothing else.

**WHY THIS PAIR MATTERS, and a small honest detail:** the demo deliberately
uses *two different* claims for Steps 3 and 4, not one claim submitted twice —
if it reused one claim, the second submission would trip the **duplicate
receipt** gate (gate 6) instead of proving anything about ownership, and the
refusal would be for the wrong reason. Also worth knowing: James is a
UK-based employee but both his demo claims are filed in USD. That isn't an
oversight — the spend-cap corpus this project built is denominated in USD
only (see §6), so a genuinely GBP claim would stop at a *different* gate
(currency mismatch) and no longer isolate the ownership question the pair
exists to demonstrate.

---

### Step 5 — An admin tries to file someone else's expense, and is refused before any gate runs at all

**WHAT YOU DO:** Switch the persona to **Jane Doe (company admin)**. Click
**"Filed by an admin"** — the same clean claim from Step 1, submitted as the
company admin rather than as Chris.

**WHAT YOU'LL SEE:** an immediate refusal, **HTTP 403, code
`persona_cannot_claim`** — *"An expense is filed by the employee it belongs to,
not by an admin."* This is not one of the sixteen gates and no gate runs at
all; it never reaches the workflow.

**WHAT WE OBSERVED, driven live:**
```
{"ok":false,"status":403,"code":"persona_cannot_claim",
 "reason":"An expense is filed by the employee it belongs to, not by an admin."}
```

**WHY IT DID THAT:** every other use case on this portal (work authorization,
payroll adjustments) is something a company admin legitimately files *on
behalf of* an employee. An expense claim is not — it is a statement that a
specific person spent their own money, and Remote's own model has no
"filed by" party other than the employee. So the portal refuses this one at
the front door, before the sixteen-gate engine — an admin acting *for* an
employee here would be indistinguishable from an admin claiming somebody
else's money, which is exactly what Step 3 shows this system refusing when
it's an employee trying it.

---

## 4. Before and after

```text
BEFORE — a human Finance/AP team validates every claim by hand
----------------------------------------------------------------
 Employee                     Finance / AP reviewer (human)
+-----------------+
| Buys something, |
| gets a receipt  |
+--------+--------+
         v
+-----------------+  +--------------------------------+
| Files claim +   |->| Lands in a review queue         |
| receipt, Remote |  | (email / ticket / inbox)        |
+-----------------+  +---------------+------------------+
                                      v
                      +--------------------------------+
                      | Opens receipt by hand, reads it |
                      +---------------+------------------+
                                      v
                      +--------------------------------+
                      | Checks vendor/date/total match  |
                      +---------------+------------------+
                                      v
                      +--------------------------------+
                      | Checks policy: category + cap   |
                      +---------------+------------------+
                                      v
                      +--------------------------------+
                      | Checks it isn't already paid    |
                      | (by memory / manual search)     |
                      +---------------+------------------+
                                      |
                        +-------------+-------------+
                        v                           v
                  +-----------+               +------------+
                  | Fine ->   |               | Off ->     |
                  | approve   |               | bounce it  |
                  | & pay     |               | back       |
                  +-----------+               +------------+

 Same checklist every time, whether or not the claim needed
 one -- the variable is how careful/fast the reviewer is.
```

```text
AFTER — 16 ordered gates, first failure wins, + a vision reading
------------------------------------------------------------------
 Employee files claim + receipt in Remote, same as before
                    v
  gates 0-2  employment readable? submitter=employee? active? --> fail: escalate
                    | pass
  gates 3-5  expense exists? belongs to THIS person? pending? -->fail: escalate/block
                    | pass
  gate  6    this exact receipt already paid? ------------------> fail: blocked
                    | pass
  gate  7    category real & fileable by this person? ----------> fail: human review
                    | pass
  gates 8/8b receipt attached, AND does a VISION MODEL's own
             reading (vendor/date/total) agree with the claim? -> fail: human review
                    | pass
  gates 9-11 money fields reconcile (tax<=total; converted
             figures agree)? ------------------------------------> fail: human review
                    | pass
  gate  12   amount under this category's spend cap? ------------> fail: human review
                    | pass
  gates13-14 AI category call confident enough? date in the past?-> fail: human review
                    | pass
                    v
  gate  15   ALL GATES PASSED -> AUTO-APPROVE. Remote written
             to "approved". Nobody reads it.

  Any "fail" above --> Zendesk ticket to Finance Ops, carrying
  WHICH gate stopped it, the cap figures, and what the vision
  model read off the receipt -- a ticket, not a blank claim.
```

---

## 5. Business value, researched not invented

**Every figure below carries a source, or is marked `[ASSUMPTION]` with its
reasoning shown.** Nothing here should be repeated as a guarantee — it is an
illustration of the mechanism's value using real published baselines, built
so a reader can plug in their own numbers.

### The two sourced baselines

| Figure | Value | Source |
|---|---|---|
| Fully-loaded cost to process one expense report by hand | **$58** | GBTA Foundation / HRS study, cited by the Global Business Travel Association: *"The average cost to process an expense report for a single night hotel stay is $58 and takes 20 minutes to complete."* — [gbta.org](https://gbta.org/how-much-do-expense-reports-really-cost-a-company/) |
| Time to process one expense report by hand | **20 minutes** | same source |
| Share of manually-processed reports that contain an error, and the extra cost/time to fix one | **~19% of reports; +$52 and +18 minutes to correct** | same source |
| Median hourly wage, bookkeeping/accounting/auditing clerks (US) | **$24.36/hr** (March–May 2025 OEWS survey) | U.S. Bureau of Labor Statistics, Occupational Outlook Handbook — [bls.gov](https://www.bls.gov/ooh/office-and-administrative-support/bookkeeping-accounting-and-auditing-clerks.htm) |

The GBTA figure is a **fully-loaded** cost across the whole reporting
workflow — it is not only the reviewer's time, it also includes the
employee's own time filling the report in, which this system does not touch
(the employee still files the claim in Remote exactly as before). The BLS
wage is included as a narrower cross-check on just the *finance-side review*
labor this system removes, and it is lower than the GBTA per-report figure —
which is expected, since GBTA's number bundles in more than one person's
time.

### Inputs you can change

To avoid overclaiming, the model below attributes only **half** of the GBTA
$58 figure to the finance-side review step this system automates (the
receipt look, the math check, the policy check, the decision) — the other
half is treated as the employee's own submission time, which this system
does not remove. It also assumes a conservative auto-approval share, well
below the "healthy" ≥50% bar this project's own metrics framework
(`docs/METRICS.md`) sets for this rate.

| Input | Default | Basis |
|---|---|---|
| Expense claims filed per month | 300 | `[ASSUMPTION]` — replace with your own volume |
| Share of that $58 attributed to the finance-side check (not the employee's own filing time) | 50% → **$29.00** | `[ASSUMPTION]` — a conservative split, not a measured figure |
| Share of claims that are simple, single-currency, in-cap claims (the auto-approve population) | 35% | `[ASSUMPTION]` — chosen below this project's own ≥50% "healthy" target (`docs/METRICS.md`), and see the caveat below about what has actually been measured |
| Reviewer minutes needed for an auto-approved claim | 0 | this system's own design: *"A claim that passes every check is settled without anyone reading it"* |

**Formula:** `monthly claims × auto-approve share × $29.00 attributed cost`

**Illustration at the defaults:** 300 × 35% × $29.00 = **$3,045/month**, or
roughly **$36,500/year** — for one company, at these assumed volumes. Raise
or lower any input and the number moves linearly; nothing here compounds or
is dressed up with a multiplier.

**The one number this guide will NOT put in that table, and why:** neither a
duplicate-claim rate nor an expense-fraud rate is cited here. A search for
published figures on both turned up numbers that disagreed with each other
by a factor of two or more across secondary sources with no single
authoritative primary study behind them, which fails this document's own bar
for a sourced figure. What can honestly be said instead: UC-02's gate 6
catches an **exact** repeat of an already-paid receipt on every single claim,
at zero marginal cost, whatever the true incidence turns out to be at any
given company.

### Non-time value — what a dollar figure alone leaves out

- **The receipt is actually read, not glanced at.** Gate 8b compares a vision
  model's own reading of the attached document — vendor, date, total,
  currency — against the figures on the Remote record, and can only ever
  *flag* a disagreement; it never gets to supply a number that reaches the
  approval write. This has been proven against a real Zendesk ticket and a
  real attached PDF (Zendesk ticket 24, n8n execution `10162`, 2026-08-29 —
  see `docs/BUILD-LOG.md`).
- **A duplicate is caught by what the claim actually is, not by an honor
  system.** The fingerprint used for gate 6 is derived from the claim's own
  fields (employee, amount, currency, tax, date, title) server-side — a
  submitter cannot opt out of it by declining to attach a receipt hash.
- **Every decision carries its own reasoning, not just its outcome.** The
  figures a cap refusal was based on (the amount, the cap, the overage, the
  percentage) are computed once and carried through to the audit trail, the
  Zendesk ticket, and the employee's own "My requests" view — the same
  numbers, not three retellings of them.
- **The policy cap is applied the same way every time**, regardless of who is
  reviewing, what time of day it is, or how many other claims are in the
  queue — the one honest caveat on this point is in §6 below.
- **Nothing here can silently approve above the cap because the AI was
  confident.** The classifier's confidence in the *category* and the
  decision about the *amount* are different gates (13 and 12), run in a
  fixed order, and a confident category call can never substitute for an
  under-cap amount — a defect this project found and fixed in exactly this
  shape (`docs/GATES.md` §2).

---

## 6. What UC-02 currently cannot do live, honestly

**The auto-approve path cannot currently be demonstrated on freshly-created
Sandbox data, and this is a real Remote Sandbox limitation, not a defect in
the gates.** `POST /v1/expenses` on the real Remote Sandbox only ever mints
an **already-approved** expense — there is no way to create a genuinely
*pending* claim through that endpoint. So a brand-new Sandbox expense stops
at gate 5 ("is this still pending a decision?") before any of the interesting
gates run. The auto-approve path can only be shown live against whichever
*pending* expenses already exist in the Sandbox from before, and each one
gives exactly one clean run — once it's decided, it's decided, and
re-submitting it either replays the stored answer (as this guide's Steps 1
and 4 show) or, on the real Sandbox/n8n path, stops at the duplicate-receipt
gate.

**What this guide actually drove, and what it didn't.** Everything in §3 is
real: real HTTP calls against the live deployment, real gate decisions, and
two real Zendesk tickets (#327, #328). But — as noted in §2 — the Remote data
behind the portal's demo personas is this project's own in-process stand-in
for Remote, not the live gateway Sandbox, because a public page must never
write into a real Remote account. **Separately, and this is the part that
used the real thing**: this project's own build log records two genuine
Remote Sandbox expenses driven through the production n8n webhook that
reached `auto_approve` and were **really** approved at Remote (2026-08-17,
n8n executions `4422`/`4424` — the write was read back from the live API
afterwards, confirming `status: "approved"`), and a real PDF receipt read off
a real Zendesk ticket and compared against a real Sandbox claim (ticket 24,
execution `10162`, 2026-08-29). Neither of those paths is something a public
demo page can reproduce on demand, because both depend on whichever pending
claims happen to exist in the Sandbox at that moment.

**The spend-cap corpus covers 26 of 32 selectable expense categories on the
live USA account, and the caps are this project's own numbers, not
Remote's.** Remote's API and documentation contain no policy, cap or
threshold concept at all — there is nothing to look up. The 26 caps are
round, plausible figures chosen for this demonstration (`[PROPOSED]`, in
`src/uc02/policyCaps.js`), not a real customer's actual expense policy and
not a legal requirement. **Six categories are deliberately left uncapped on
purpose, not as a gap to close**: relocation & mobility, visa/immigration
fees, office rental, long-term car lease, equipment shipping & customs, and
"additional travel services" — each is a case where a dollar ceiling alone
wouldn't make the claim safe to auto-approve regardless of the figure (a
lease is a recurring commitment; customs duty is jurisdictional; and so on).
Every claim in one of those six categories goes to a person, every time, by
design.

**Two changes to this policy-cap area have been decided but not yet built**
(recorded in `qa/contracts/UC-02-acceptance.md` §17, checked against the code
for this guide): the cap comparison a claimant or Finance Ops specialist
actually sees does not yet say out loud, in those words, that the cap is
*this project's own policy and not something Remote requires* — the
provenance is true and documented in this repository, but it isn't yet
carried onto the screens people read. And a receipt that merely *resembles*
an already-paid one (an inferred match on its recorded fields, rather than an
exact hash match on the file itself) is currently hard-blocked exactly like a
genuine duplicate, with no path to a second look — the decided change is to
send that inferred case to a human instead.

---

## 7. If something goes wrong on the day

- **The portal asks for a key and you don't have it.** That's
  `PORTAL_ACCESS_KEY`, a shared password in this project's `.env` file — not
  something this guide prints. Get it from whoever manages the deployment
  before the demo starts.

- **A quick-fill you click shows `alreadyHandled: true` / a replayed
  decision, instead of a new one.** This is expected and correct, not a
  bug — the demo's fixed set of expenses gets decided once and then
  remembered, exactly the way a real reimbursement must never be paid twice.
  Tick the **"File this as a new claim"** checkbox next to the expense picker
  before submitting to get a genuinely fresh, undecided copy of the same
  expense — that is how every scenario in §3 was independently re-verified
  for this guide.

- **You want to show a brand-new expense being auto-approved, and it keeps
  refusing at an early gate instead.** See §6 — the real Remote Sandbox
  cannot mint a pending expense through its own API, so a freshly-created one
  will always fail gate 5. Use one of the portal's existing pending fixtures
  (via "File this as a new claim") rather than trying to create a new
  Sandbox expense on the day.

- **A step you run produces a different record id or ticket number than this
  guide's examples.** Expected — every run in this guide created a
  brand-new, real record with its own reference. What should **not** differ
  is the `decision` and `reason` values quoted for each step; those are the
  ones to check against.

- **Somebody asks whether the spend caps are Remote's real policy.** They are
  not, and the system does not currently say so on screen (§6) — be upfront
  that the figures are this project's own illustrative numbers, chosen
  because Remote publishes no expense-policy concept for this system to
  retrieve.

- **You want to show the resulting ticket in Zendesk itself.** This guide
  only verified the portal's own view of each decision, not the live Zendesk
  agent view, which needs separate Zendesk sign-in this guide's preparation
  did not have. The ticket numbers in Step 2/3 were real and correctly
  routed to Finance Ops, but walk into that part of the demo knowing it
  wasn't screenshotted in advance.
