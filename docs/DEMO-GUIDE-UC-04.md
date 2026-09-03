# UC-04 demo guide — Work Authorization / Workation

**Audience:** an EOR/HR/mobility operations person, or anyone non-technical who
wants to see this system decide real work-authorization requests. No
engineering background assumed. Every "what you'll see" below was actually
observed by sending real requests to the live system on 2026-09-03 — nothing
here is imagined or extrapolated, and every place this guide could not drive
something live says so plainly rather than describing it as if it had.

A note on vocabulary before we start. This system sits behind Zendesk (the
company's support-ticket tool) and Remote's own employment platform. Internally,
each of the nine kinds of request it handles is called a "use case" and
numbered — this guide is about **UC-04**, the fourth one. A "gate" is one check
in an ordered checklist the system runs through for every request — like a form
with eighteen yes/no boxes, read top to bottom, where the first box that says
"stop here" decides the outcome. A "workation" is what this project (and much of
the industry) calls working remotely from a country other than where you're
normally based, for a defined stretch of time, rather than relocating for good.
None of that needs to be understood to follow the demo; it's here so the words
don't feel like jargon when they show up.

---

## 1. Sixty-second orientation

An employee wants to work — not just visit — from another country for a while:
*"can I work from Spain for three weeks?"*, *"I want to extend my trip with a
few remote days."* That is a real question with real consequences: whether the
company now has a taxable presence in that country (permanent-establishment
risk), whether the employee is working legally on the visa or entry status
they'll actually be on, and whether they've quietly run up more days abroad
than a treaty or a border rule allows.

UC-04 gathers the facts, runs them through **eighteen ordered checks**, and
prepares a single, evidenced case for whoever has to decide — it never decides
itself, at any risk level, for anybody. It can reach exactly three outcomes:

1. **Prepared and ready** — every check passed. Nothing is approved yet; the
   case is ready for the person whose decision it actually is.
2. **Escalated** — either the case needs a Mobility & Legal specialist's own
   judgement (a high permanent-establishment risk, an ambiguous destination),
   or something about the request couldn't be verified at all.
3. **Blocked** — a hard stop nobody can override with more information: a
   sanctioned destination, a visa that forbids the work being asked for, a
   Schengen limit already exceeded, or — as this guide's central example shows
   — an employer who has not agreed to this employee working abroad at all.

What it will **never** do: approve a work authorization itself, at any risk
score; infer immigration legality from how strictly a destination is known to
enforce its own rules; or collapse permanent-establishment risk, visa rules,
day-counting and signing authority into one score that decides on its own.

---

## 2. Who decides, and in what order

This is UC-04's defining feature, and it is worth reading before anything else,
because it is easy to get backwards — this guide's own first draft got it
backwards and was corrected before this section was written.

**Remote's own work-authorization object states a two-stage approval, and this
project adds a third stage of its own.** Remote's API status enum is
`pending / cancelled / declined_by_manager / declined_by_remote /
approved_by_manager / approved_by_remote` — the vocabulary itself names the two
deciders. There is no third status for anyone else, and there is no `POST`
anywhere on this resource: a work-authorization request is created inside
Remote's own product by the employee, never by this system.

| Stage | Decider | Where | Written to Remote? |
|---|---|---|---|
| **1 · request** | **The employee** — the primary actor, per Remote's own object ("submitted by an employee who needs authorization to work in a different country") | Remote's own Request Hub — **the stand-in here**, `/remoteui` | No — Remote publishes no `POST`, so this system's copy of the request is a self-identifying stand-in record |
| **2 · employer approval** | **The customer's own manager** — the one and only approving party inside the customer | `/remoteui` — the Remote-product stand-in | **Yes** — `PATCH` to `approved_by_manager` / `declined_by_manager`, the only work-authorization write Remote's API allows any client to make |
| **3 · Remote's mobility review** | **Remote's own Mobility Team** | The Zendesk sidebar (ZAF panel) | **No** — `approved_by_remote` is a status this project has never had, and will never have, an endpoint to set |

**Read that last row carefully, because it is the one thing every surface in
this system says out loud rather than lets the reader assume.** Remote's
mobility review is a real, separate compliance check Remote performs after the
employer approves — but Remote publishes no API for it. So since 2026-08-31
this system records that stage **in itself**: a mobility specialist opens the
ticket in Zendesk and clicks **clear** or **decline** (deliberately not
*"approve"* — that word is already taken, by stage 2, on the very same record),
and the verdict is written durably to this system's own audit log, under their
name, visible to the employee. It is never transmitted to Remote, because there
is nowhere to transmit it to, and the panel, the audit row, the employer's
screen and the employee's own status page all say so in the identical sentence:

> *"Recorded here as Remote's mobility review. Remote publishes no endpoint for
> this stage, so this is not sent to Remote and Remote's own systems will not
> show it."*

**Nobody at Remote reviewing a work-authorization request in a Zendesk sidebar
approves anything.** Only the customer's own manager's click is a real approval
of the trip, and it approves only the employer's half. This project used to get
this wrong — an earlier build had this system's own specialist making the
employer-side call, which the project owner corrected on 2026-08-30 after
reading Remote's own published API. This guide follows the corrected model
throughout, and every screen you will see follows it too.

---

## 3. Setup

Open these, in this order:

1. **The request portal** — `https://remote-cx-apis.vercel.app/portal`
   Where an employee or a company admin files a work-authorization request:
   pick who you're acting as, pick **"Work authorization / workation"**, and
   either type free text or click one of the pre-built quick-fill buttons
   described below. It asks for an access key once per browser session — a
   shared password in this project's `.env` file, `PORTAL_ACCESS_KEY`; ask
   whoever set up the environment for it rather than looking for it in this
   document, since it's deliberately never written down here.

2. **The manager surface** — `https://remote-cx-apis.vercel.app/remoteui`.
   This is the Remote-product stand-in — where the *customer's own manager*
   approves or declines a request the employee already filed. Same access key,
   same prompt. This is stage 2 above, and it is the one surface in this whole
   guide where a real decision genuinely gets written.

3. *(Optional)* **The audit viewer** —
   `https://remote-cx-apis.vercel.app/audit`. Read-only. Every decision this
   system has made, live, with the reasoning behind each one. Same key.

4. *(Optional)* **The approval queue** —
   `https://remote-cx-apis.vercel.app/queue`. What is currently waiting on a
   person and where. Same key.

**One thing to set before driving anything: the pinned demo clock.** Every
scenario in this guide states its own dates against **"Evaluate as at"
2026-09-14** — a field on the form, not a hidden default. Change it and every
day-count and Schengen-window figure below changes with it; leave it as printed
and you will see exactly the numbers this guide quotes.

No local software is required for any of this — it's all one live web
deployment. (To run it from a laptop instead: `npm install` then
`npm run uc04-api` for the API alone, or `npm run portal` for the intake
surface and `npm run remoteui` for the manager surface — not needed for the
demo below.)

---

## 4. The run

The portal's "Work authorization / workation" card offers **fifteen quick-fill
buttons**. Every one below was driven for real against the live deployment on
2026-09-03, most of them twice (once during preparation, once again with a
fresh reference for this write-up) — the decisions agreed both times. Two of
the fifteen — the two whose whole point is the traveller's own history —
briefly timed out on first attempt against the live deployment and returned
correctly on retry; that is noted where it happened rather than smoothed over.

### 4a. A note before the run: who is filing, and who it's about

**Read this before the individual steps, because it is easy to draw the wrong
conclusion from the button labels alone.** UC-04 is the one request type on
this portal where the person filing and the person the request is *about* are
routinely different people — and, since 2026-08-30, it's also the one request
type either party may file. Remote's own object names the employee as the
primary actor: a work-authorization request is *"submitted by an employee who
needs authorization to work in a different country."* A company admin filing
on an employee's behalf is a real, kept, secondary path — a genuine support
workflow — not the normal case.

**Thirteen of the fifteen quick-fills below file as Jane Doe, the company
admin. Only two file as the employee, Chris Lee, himself** ("Filed by the
employee themselves" and "…the same trip, filed about a colleague"). Read
that split as a fact about **this demo's construction**, not about the
business model: two of this guide's central scenarios — "…the same trip, for
Amanda" and "…the same request, for Lars" — exist to show the *identical*
trip decided differently for a *different* traveller, and an employee session
can only ever file about themselves. Showing "the same trip, someone else" at
all **requires** an admin filer. That is a demo-construction reason, not a
statement that admins normally file these.

**A chip named "for Amanda" or "for Lars" signs you in as Jane Doe and points
the request AT that person — it does not sign you in as them.** The form
itself now says this in words, printed under the employee-identifier box on
every submission: *"This request is about [name] — who is not necessarily the
person filing it."* Watch for that sentence as you go through the steps below;
it is there because a reader who only reads the button label can otherwise
come away thinking the traveller filed their own refusal.

**The picker can also fall out of step with a scenario's own note, and the
system now says so rather than leaving a stale sentence on screen.** If you
change who is signed in by hand after clicking a quick-fill, the note that
loaded with that scenario is replaced with: *"You changed who is signed in…
The quick-fill's note described this request as it loaded, so it no longer
applies — submit it and see how this person's own record changes the
answer."* Worth knowing if you're clicking around rather than following the
steps in order.

### Step 1 — A low-risk trip, prepared and ready

**WHAT YOU DO:** Choose **Jane Doe (company admin)** and the "Work
authorization / workation" card. Click **"Low-risk Schengen trip"** — a
two-week trip for João Silva (a real, active Portugal-based employee) to the
Netherlands, October 1–14, 2026, with one stated prior stay in the Netherlands
this spring.

**WHAT YOU'LL SEE:** **decision `ready_for_approval`, reason
`all_gates_passed`**, flag `a1_certificate_recommended`. Ticket **#342**
raised, tagged `queue_mobility_specialists`, assigned to **Mobility
Specialists**. The panel's own figures: *"Trip length: 14 days. Cumulative
days abroad: 46 day(s) over 1 prior trip(s)."* The Schengen row: *"46 day(s)
already stated in Netherlands… plus 14 day(s) for this trip = 60 of 90 — 30
day(s) of headroom."* The 183-in-365 tax-residency watch row separately:
*"60 of 183 — 123 day(s) of headroom."*

**WHY IT DID THAT:** every one of eighteen checks passed — João is active,
Portugal has granted him workation permission on his Remote record, the
destination is real and unsanctioned, every one of the seven structured
factors is well-formed, and the risk matrix classified the pair as low risk.
The "What happened" line is deliberately blunt about what has *not* happened
yet: *"It is NOT approved yet, and it will not be approved here: that
decision belongs to the employer, and it is made by the customer's own manager
in Remote's own product."* This is the record this guide carries into Step 12
below, where the manager actually approves it.

---

### Step 2 — The same trip, a different traveller: refused, and this is the guide's central example

Covered in full in §5 below, because it needs the room. In short: **decision
`blocked`, reason `employer_permission_not_granted`**, no ticket, no risk
computed at all.

---

### Step 3 — The same request, for someone at a different company

**WHAT YOU DO:** Still Jane Doe. Click **"…the same request, for Lars"** — the
mirror trip (Netherlands → Portugal, same dates) for Lars van der Berg, who
works for a *different* Remote client entirely.

**WHAT YOU'LL SEE:** **decision `escalate`, reason `identity_not_verified`.**
Ticket **#343**, escalated to **Mobility & Legal (Tier-2)**. The plain answer:
*"Not decided here — this request, about Portugal, could not be judged
automatically, so it has gone to Mobility & Legal (Tier-2) for a person to
work through."*

**WHY IT DID THAT:** Jane Doe's session is authorised for her own company;
Lars's employment belongs to another one entirely. This is checked **before**
anything about the trip is looked at — the same company boundary UC-06 and
UC-09 enforce, applied here. Nothing about the destination, the dates or the
visa type was ever reached.

---

### Step 4 — Same country in, same country out

**WHAT YOU DO:** Jane Doe again. Click **"Same-country workation"** — a
request for João Silva to work from Portugal while based in Portugal.

**WHAT YOU'LL SEE:** **decision `blocked`, reason `same_country_workation`.**
No ticket.

**WHY IT DID THAT:** there is no workation to authorise if the destination is
the country the employee already works from. This is almost always a form
filled in wrong, and the fix is simply the destination field — nobody has to
review or overturn it for a corrected request to go through.

---

### Step 5 — A sales role with contract-signing authority

**WHAT YOU DO:** Click **"Sales role, signing authority"** — a ten-day trip to
the Netherlands to close deals, with contract-signing authority marked `true`.

**WHAT YOU'LL SEE:** **decision `escalate`, reason `high_risk_pair`.** Ticket
**#344**, escalated to **Mobility & Legal (Tier-2)**.

**WHY IT DID THAT:** signing contracts on the company's behalf, in another
country, while doing sales work, is exactly the profile that creates
dependent-agent permanent-establishment exposure — the risk that the other
country decides the company has a taxable presence there because of what this
one person did while visiting. The matrix does not attempt a one-click path
for this; it hands the whole case to a specialist, deliberately with no
approve button offered at all.

---

### Step 6 — The United States, on the right document

**WHAT YOU DO:** Click **"US, with a work permit"** — two weeks in the US,
visa type `work_permit`.

**WHAT YOU'LL SEE:** **decision `ready_for_approval`, reason
`all_gates_passed`.**

**WHY THIS ONE MATTERS ON ITS OWN:** without it, the only US or Canada
scenario on this page would be a refusal — and a gate that has only ever been
seen refusing is indistinguishable from a gate that cannot pass at all
(this repository's own most expensive recurring defect, named in `CLAUDE.md`
§7). This row is the positive control: the United States and Canada are hard
blocked for every visa type **except** a genuine work permit, and this proves
the block lifts when the right document is actually held.

---

### Step 7 — An executive, with the matrix's highest exposure

**WHAT YOU DO:** Click **"Executive abroad (PE risk)"** — job duties
`executive`, signing authority `true`, leadership meetings and signing two
supplier agreements while in Amsterdam.

**WHAT YOU'LL SEE:** **decision `escalate`, reason `high_risk_pair`.** Ticket
**#346**, Mobility & Legal (Tier-2).

**WHY IT DID THAT:** `executive` is the matrix's highest permanent-establishment
category — the combination of authority and visibility that creates the most
exposure if that person is seen to be *running the business* from abroad,
however briefly. Same escalation shape as Step 5, for a sharper reason.

---

### Step 8 — A destination the system will never allow, whoever asks

**WHAT YOU DO:** Click **"Sanctioned destination"** — a business-visa trip to
Iran.

**WHAT YOU'LL SEE:** **decision `blocked`, reason `sanctioned_region`,** flag
`sanctioned_region`. No ticket. The plain answer: *"No — this request, for
Iran, was refused because the destination is on the sanctioned or restricted
list."* And the follow-up: *"Nothing you or the employer can do changes this
one — no approval here can grant it, no further detail will help, and nothing
was sent to Remote, so there is nobody to ask and nothing to correct."*

**WHY IT DID THAT, and why it runs FIRST:** this check sits ahead of every
other gate in the whole ladder — ahead of even the employer-permission check —
on purpose. The reason is structural, not just cautious: an `escalate`
decision (unlike `blocked`) is one this system would otherwise be willing to
resolve a real Remote work-authorization request against, and a specialist can
one-click-approve an `escalate`d case's employer side once it's Mobility &
Legal's. So a sanctioned destination has to be caught **before** it could ever
reach that path, not merely flagged after the fact. It is checked and refused
before the employer-permission gate, before the seven structured factors are
even validated, and before the risk matrix runs at all.

---

### Step 9 — Two day-counts, two different answers, on one request

**WHAT YOU DO:** Click **"Two counts, two answers"** — a fortnight in the
Netherlands, with two stated prior stays that together put the traveller well
past one line and comfortably inside the other.

**WHAT YOU'LL SEE:** **decision `ready_for_approval`, reason
`all_gates_passed`,** flags `a1_certificate_recommended` and
`tax_residency_watch`. The two counters genuinely disagree: *"Schengen
90-in-180: … 59 of 90 — 31 day(s) of headroom"* against *"183-in-365
tax-residency watch: OVER THE WATCH LINE. … 210 of 183 — over by 27."*

**WHY IT DID THAT, and why this matters:** the Schengen 90-in-180 rule and the
183-day tax-residency watch are **two different questions measured over two
different windows**, and this system computes both rather than reducing them
to one number. A request can be comfortably within the border-entry limit and
past the tax-residency watch line at the same time — that is not a
contradiction to reconcile, it is two separate real-world facts a specialist
needs, side by side, exactly as they disagree.

---

### Step 10, 11, 12 — Prior stays, well inside, exactly on the line, and over it

Three scenarios that only differ in how much of the Schengen allowance is
already used, all sharing the same request otherwise:

- **"Prior stays, well inside"** — 20 days already spent in the Netherlands,
  plus this 14-day trip. **`ready_for_approval`**, Schengen row: *"34 of 90 —
  56 day(s) of headroom."* A real, non-zero count that changes nothing —
  included specifically so "a number appeared" and "a number mattered" are
  demonstrably not the same thing.

- **"Exactly on the Schengen line"** — 76 prior days plus this 14-day trip is
  exactly 90 of 90. **`ready_for_approval`** — the row prints *"90 of 90 — 0
  day(s) of headroom."* The rule breaches on exceeding 90, not on reaching it,
  and this is the proof: zero headroom still clears.

- **"Two stays that overlap"** — two prior stays (July 1–Aug 14 and July
  31–Sept 9) that share a fortnight. **`ready_for_approval`**, Schengen row:
  *"85 of 90 — 5 day(s) of headroom."* The two stays are 45 and 41 days on
  paper, 86 summed — but they overlap for 15 of those days, so the real count
  is 71 distinct days, not 86. A day spent once is counted once. Summed
  instead of unioned, this request would read 100 of 90 and be wrongly
  refused — a traveller blocked on days they never actually spent.

- **"Over the Schengen limit"** — 107 prior days plus this 14-day trip.
  **`blocked` / `schengen_90_180_exceeded`**, flag `schengen_overstay`. The
  Schengen row states the actual overage rather than a bare verdict: *"OVER
  THE LIMIT. … 121 of 90 — over by 31."* No ticket — a legal limit set by a
  border regulation, not by Remote or by this project, so there is nobody to
  escalate an exception to. The 183-in-365 watch line is reported separately
  as *"Not reached — a hard block decided this request before the
  rolling-window count was taken,"* which is a different fact from "under the
  line" and the panel is careful to say so.

---

### Step 13 — Filed by the employee themselves

**WHAT YOU DO:** Switch the person to **Chris Lee** (a real, active US-based
employee). Click **"Filed by the employee themselves"** — Chris files his own
fortnight in the Netherlands.

**WHAT YOU'LL SEE:** **decision `ready_for_approval`, reason
`all_gates_passed`.** Ticket **#351**, Mobility Specialists.

**WHY THIS ONE MATTERS ON ITS OWN:** this is the demonstration of §2 and §4a
above — the employee filing about their own trip, exactly as Remote's own
object says the request is normally submitted. It used to be refused outright:
an earlier version of UC-04's identity check compared the session's
*company* id against the employment's, which only a company-admin session
carries at all, so an employee filing about themselves failed a check about
representing the company — a check that was never about them. Fixed
2026-08-30. Driven both before and after that fix: identical outcome, proving
the pair really does turn on *who filed it* and nothing else about the trip.

---

### Step 14 — An employee tries to file for a colleague, and is refused

**WHAT YOU DO:** Still Chris Lee. Click **"…the same trip, filed about a
colleague"** — the same words and dates, but the employment named is Anna
Müller's, not his own.

**WHAT YOU'LL SEE:** an immediate refusal, **HTTP 403, code
`not_your_employment`** — *"You may file a workation request about your own
employment. A request about someone else's is filed by a company admin, whose
session is authorised for that employee's company."* This is not one of the
eighteen gates; it never reaches the workflow at all.

**WHY IT DID THAT:** the rule that widened submission to include the employee
(Step 13) is narrow on purpose — *"a party to the record."* An employee may be
that party for their own trip. Filing about somebody else is the company
admin's role (Step 3's Lars scenario shows an admin doing exactly that, and
succeeding at the identity check, for their own company's employee). This
scenario and Step 3 are the two shapes of the same boundary, from opposite
sides: Step 3 is an admin correctly refused by *company*; this one is an
employee correctly refused by *whose employment it is*.

---

## 5. The Amanda beat — the same trip, refused for a different person, and why

**One quick-fill exists specifically to make this point, and it is the
sharpest thing in this guide.**

**WHAT YOU DO:** Sign in as **Jane Doe (company admin)**. Click **"…the same
trip, for Amanda"** — the identical fortnight in the Netherlands, October
1–14, 2026, the same destination, the same dates, the same visa type, the same
duties, submitted for **Amanda J Walker**, a real, active US-based employee,
instead of João Silva.

**WHAT YOU'LL SEE:** **decision `blocked`, reason
`employer_permission_not_granted`.** No ticket — `ticketCreated: false`, and
the panel's own note says why: *"No Zendesk ticket: this decision needs no
human, so there was nothing to raise for review."* No risk was ever computed:
the panel's own figures read *"Trip length: not determined,"* *"Cumulative
days abroad: not computed for this decision,"* and *"Remote work-authorization
request: A blocked request is a hard stop that no one decides, so no Remote
work-authorization request was looked up for it."*

**Contrast this with João's identical trip in Step 1**: `ready_for_approval`,
a real ticket, a real risk score, real Schengen and tax-residency figures. Two
requests, word-for-word the same trip, opposite outcomes — because of one fact
that has nothing to do with the trip at all.

### Why this happened, in business terms

**Companies decide which of their own people are allowed to work from
abroad — by role, by contract type, by seniority, for whatever reason is
theirs to have. They record that decision against the employee's own record in
Remote. This system reads it; it does not decide it, and it is not baked into
this system's own policy.** Amanda's employer has not granted her workation
permission on her Remote record. That is the whole of the finding: nothing
about her trip, her destination, or her dates was ever assessed, because
nothing about the trip is relevant until that precondition is met. The gate
reads `employment.custom_fields.workation_permission !== true` — deliberately
`!== true`, not `!== false`: an **unset** field blocks exactly like an explicit
no. An unrecorded permission is not a granted one.

**The honest part, said plainly rather than smoothed over:** custom fields are
a real, documented Remote feature (`GET /v1/custom-fields`, per-employment
values, company-scoped, with a `custom_field.value_updated` webhook), and a
custom field's *name* is the customer's to choose. But this specific field —
`workation_permission` — is **this project's own slug**. The real Remote
employment record does not carry a field called that; it is this project's own
placeholder for a policy every real customer would set up and maintain
themselves (`docs/KNOWLEDGE-SOURCES.md`, `docs/SANDBOX-STANDIN.md`). In
production, a customer would need to create and maintain that field
themselves, on every employee it applies to, before this gate could tell
anyone anything real. If a customer chooses not to maintain that field at all,
the honest configuration is to switch this specific check off — not to leave
it silently blocking every request forever, which is what an unmaintained
field does today. A cleaner version of this same check, named as the known
next step rather than built here, would read the permission live off Remote's
own per-employment custom-fields endpoint rather than off a field baked onto
the employment object the mock server returns.

**Why this is built as a gate and not as a rule about contractors, or roles,
or seniority, hardcoded into the policy engine.** It would have been just as
easy — easier, even — to write "contractors never get a workation" or "only
senior staff may work abroad" directly into `policyEngine.js`, and it would
have demoed identically. It would also have been worse: a policy that varies
company to company does not belong compiled into code the customer cannot see
or change without a deploy. Reading a fact off the employee's own record is
the correct shape even though — and partly because — this project's own
stand-in for that fact is not yet the field a real Remote account would carry.
Logic that never varies (a sanctioned destination, a Schengen limit) belongs
in the gate. Policy that varies by company belongs on the record.

### How to say this on camera

> *"Same trip, same dates, same destination, submitted for a different
> person — and the answer flips, instantly, with no ticket raised and no risk
> even computed. That's not this system guessing who's allowed to travel — it's
> reading a permission the company itself set on this employee's record. If
> the company hasn't recorded that permission, the honest answer is 'we don't
> know,' not 'probably fine.' And that's the whole difference between the two
> requests you just watched: nothing about Amanda's trip was wrong. Nobody
> ever asked."*

---

## 6. The manager's approval, driven end to end

This is the one place in this whole guide where a real decision is genuinely
made and genuinely written somewhere durable — worth walking through slowly.

**WHAT YOU DO:** Open `/remoteui` and sign in as the demo manager session
(`admin` — Jane Okonkwo, Head of People Operations, Meridian Analytics — a
named, marked fixture; no such person exists at Remote, and the panel says so).
Open **"Work authorizations."** João Silva's request from Step 1 — the one
that reached `ready_for_approval` — is sitting there, `pending`, alongside
every other one this guide's quick-fills prepared. Approve it.

**WHAT YOU'LL SEE:** `code: "approved_by_manager"`. The response states
plainly what this write is and is not: *"Approving here records the
EMPLOYER's decision and nothing more. Remote's own Mobility Team then
performs a second, separate review, and only that review produces
`approved_by_remote`… The employee is not cleared to travel until Remote has
answered, and you will not learn Remote's answer here."* The hand-off fires
automatically: Zendesk ticket **#342** (the same ticket Step 1 raised) receives
an internal note recording the employer's decision, tagged
`uc04_employer_approved`, still assigned to **Mobility Specialists**.

**WHAT THIS PROVES, and what it doesn't.** This is a real write to this
project's own durable store — `uc04_authorizations`, `audit_log` — under a
named approver, with a real Zendesk hand-off. It is **not** a write to Remote:
the response's own `remoteWrite` block says so directly — *"Written to this
system's own `uc04_authorizations` record, not to Remote. Remote holds no such
request — it publishes no endpoint that creates one — so there is nothing
there to `PATCH`."* That is the honest limit of stage 1 being a stand-in
rather than a real Remote request: on the real Sandbox, where a genuine
employee-filed request exists, this exact same code really does `PATCH`
Remote's API to `approved_by_manager` — the one write this whole use case is
built to make — but nothing filed through this demo portal is a request Remote
has ever heard of, so there is nothing at the far end of that `PATCH` today.

### What the mobility specialist sees next, and where this guide had to stop

**Stage 3 only becomes actionable after stage 2 — never before, and the
system refuses out of order by name rather than merely not offering the
button.** Before João's request was approved, the employee's own "My requests"
page showed stage 3 as `not_reached`: *"Remote's mobility review comes AFTER
the employer's approval, and this request has not been approved by the
customer's manager yet."* Now that the manager has approved it, that same case
is `open` — *"The customer's manager has approved this trip. Remote's mobility
review is the stage that follows it, and it is recorded here."*

**We drove this all the way up to the entitlement gate itself, live, and it
refused correctly.** Reading or acting on ticket #342 from the ZAF sidebar's
own API — without a genuine, Zendesk-signed identity token — returns:

```
{"ok":false,"code":"signed_identity_required","reason":"This service requires
a signed ZAF identity token — as Authorization: Bearer <token> (what the
sidebar's client.request() jwt block sends) or in X-ZAF-Token — and none was
supplied."}
```

That is the same fail-closed rule this project applies everywhere a human
decision carries weight (`CLAUDE.md` prime directive 3: identity comes from an
authenticated signal, never a claim) — a mobility specialist's clearance has to
come from inside a real, Zendesk-signed-in sidebar, or it does not happen. So
this guide can prove the request reached the right ticket, in the right group,
correctly gated behind a real approval — and it cannot click the "clear" or
"decline" button itself, because doing that legitimately needs a real Zendesk
login this environment does not have.

**The next layer down — an entitled-but-wrong reviewer — is not something a
live demo can show either, for the same reason, and it is proven a different
way: this repository's own hermetic test suite.** `test/uc04MobilityReview.test.js`
drives the identical code path, offline, with a reviewer who is a real,
Zendesk-signed identity but is **not** on the `uc04:mobility_specialist`
roster:

```
assert.equal(refused.code, "approver_not_entitled");
```

and — the sharper assertion, run right after it — that an *unentitled*
reviewer attempting to act on a request the employer hasn't approved yet is
told the true, ordering reason (`employer_approval_not_recorded`), never the
role reason, because a wrong role would have been the wrong explanation for
that particular refusal. **The standing decision here, deliberately not acted
on:** nobody was added to this deployment's `APPROVER_ROLES` for this guide.
Proving the gate refuses correctly — live, up to the exact point a real login
would be needed, and offline for the layer beyond that — is itself the
demonstration of a control working, and widening entitlement to make a demo
click go further would be the opposite of that.

---

## 7. Before and after

```text
BEFORE — a human mobility team assesses a workation request by hand
----------------------------------------------------------------------
 Employee                    Mobility / Global HR team (human)
+----------------+
| "Can I work    |
| from Spain for |
| 3 weeks?"      |
+-------+--------+
        v
+----------------------------------+
| Sits in a shared queue           |  <- no triage yet
+----------------+------------------+
                 v
+----------------------------------+
| Looks up the employment record   |  <- a separate system,
| by hand                          |     re-typed or copy-pasted
+----------------+------------------+
                 v
+----------------------------------+
| Checks the destination against a |  <- sanctions list, treaty
| sanctions/treaty list by hand    |     coverage — separate lookups
+----------------+------------------+
                 v
+----------------------------------+
| Counts prior Schengen/tax-       |  <- by hand, across trips,
| residency days by hand           |     easy to mis-sum overlaps
+----------------+------------------+
                 v
+----------------------------------+
| Chases the employee for missing  |  <- visa type, job duties,
| details                          |     nationality, signing authority
+----------------+------------------+
                 v
    +------------+-------------+
    v                          v
+-----------+          +------------------+
| Low risk: |          | High risk / PE:  |
| approve   |          | route to Legal   |
+-----------+          +------------------+
                 |
                 v
        Wait for the employer's manager to sign off
                 |
                 v
        Reply to the employee
   (typical: days, start to finish — no published benchmark
    exists for this specific process; see §8)
```

```text
AFTER — this system
------------------------------------------------------------------
 Employee OR company admin files (portal, or Remote's own Request Hub)
                    v
  18 ordered gates, read top to bottom, ONE PASS, seconds not a queue
                    |
   +--------+-------+--------+-----------------------+
   v                v                                v
 BLOCKED        ESCALATE                     READY_FOR_APPROVAL
(gates 3,6,7,   (gates 1,2,16,17)             (gate 18)
 8,9,10,11,     identity unverified,          every check passed —
 12,13,14,15)   employee inactive,            NOT approved yet
 sanctioned,    matrix has no rule,
 same country,  high PE risk (sales/
 wrong visa,    exec + signing auth),
 Schengen over, or an out-of-company
 no permission  filer
   |                |                                |
   v                v                                v
 nobody           Mobility & Legal                STAGE 2
 decides —        (Tier-2) — a person             The CUSTOMER'S
 no Remote        owns it end to end,             OWN MANAGER
 record,          no one-click offered            approves/declines
 no ticket                                        in /remoteui
                                                        |
                                                        v  (approve only)
                                              PATCH approved_by_manager
                                              — the ONLY write Remote's
                                              API accepts from any client
                                                        |
                                                        v
                                                     STAGE 3
                                            Remote's Mobility Team
                                            reviews it — recorded in
                                            THIS system's own audit
                                            log (no Remote endpoint
                                            exists for this stage)
                                                        |
                                                        v
                                            approved_by_remote — decided
                                            entirely inside Remote,
                                            never written by any client
```

---

## 8. Business value, researched not invented

**Every figure below carries a source, or is marked `[ASSUMPTION]` with the
reasoning shown.** This deployment has no real production ticket volume behind
it, so nothing here should be read as a guarantee — it's an illustration built
so a sceptical reader can substitute their own numbers.

### The published benchmarks

| What | Figure | Source |
|---|---|---|
| Average hourly rate, Global Mobility Specialist (US) | **$41/hr** ($85,652/yr average, as of 2026-09-01) | [Salary.com, "Global Mobility Specialist Salary"](https://www1.salary.com/job/global-mobility-specialist-salary) |
| Average hourly rate, Immigration Specialist (US), for cross-check | **$40/hr** (range $31–$51/hr) | [Salary.com, "Immigration Specialist Salary"](https://www.salary.com/research/salary/benchmark/immigration-specialist-salary) — reused from this project's own UC-03 guide, same underlying labor market |
| Fully loaded cost multiplier over base salary | **1.25×–1.7×** base | [ScaleArmy, "Fully Loaded Cost of an Employee"](https://scalearmy.com/blog/calculate-fully-loaded-cost-of-an-employee/) — reused from UC-03's guide; not applied below, since Salary.com's figure is already a market rate rather than a raw base salary |
| Average *total elapsed* time for an HR-adjacent ticket (queue + handoffs) | **82 hours** median (top 20%: 43 hours; top 5%: 17 hours) | [Unthread, "HR Help Desk Statistics 2026," citing a Jitbit analysis of 1,000 SaaS companies](https://unthread.io/blog/hr-help-desk-statistics/) — the closest published elapsed-time proxy; not workation-specific |
| OECD's own 2025 threshold for when working from home creates a taxable presence | *"less than 50% of total working time over any 12-month period"* generally does not | [EY, "OECD 2025 Update: New Rules on Permanent Establishment for Remote Work," 2025-11-19](https://www.ey.com/en_ch/technical/tax-alerts/oecd-2025-update-new-rules-on-permanent-establishment-for-remote-work) |
| Remote's own published lead-time guidance for a work-authorization request | *"at least 3–8 weeks before your intended departure"* (under two weeks needs live messaging); travel letters, *"at least two weeks before"* | [Remote Help Center, "Remote Work Authorization: What it is and How to request it," article 37802834593805](https://support.remote.com/hc/en-us/articles/37802834593805-Remote-Work-Authorization-What-it-is-and-How-to-request-it) |

**What this guide will NOT cite, and why.** A search for a published, credible
dollar figure on "cost of a permanent-establishment compliance failure" turned
up only unsourced marketing ranges — one vendor article states *"legal and
professional fees which routinely reach five figures per case"* and *"early
identification… reduces potential penalties by 20–30%"* with no citation to
loss data, case studies, or a named study behind either number. That fails
this document's own bar for a sourced figure, the same way the UC-02 guide
declined to cite a fraud rate it could not verify. What can be said honestly
instead is qualitative, and it's in §7's non-time value below: the exposure is
real, described by the OECD's own current framework, and this system checks
for it on every single request rather than only when someone remembers to
ask.

### Inputs you can change, and the arithmetic in the open

| Input | This document's value | Where it comes from |
|---|---|---|
| Work-authorization / workation requests per month, one mid-size customer | **20** | `[ASSUMPTION]` — deliberately modest; substitute your own volume |
| Time a specialist would otherwise spend gathering the facts this system gathers automatically, per request | **45 minutes** | `[ASSUMPTION]`, reasoned up from the 30-minute figure this project's own UC-03 guide used for a simpler travel-letter triage: UC-04 additionally means checking a sanctions list, validating seven structured factors, running two separate day-count windows by hand (Schengen and tax-residency), and checking a treaty/A1 position — genuinely more to gather than a travel letter, not more to *decide* |
| Fully loaded hourly cost of the person who would have done that gathering | **$41/hr** | Salary.com, Global Mobility Specialist, cited above |
| Share of requests where this system's fact-gathering removes work rather than merely routes it (excludes hard blocks with no assessment to speed up, like Amanda's) | **75%** | `[ASSUMPTION]` — every scenario in this guide except the sanctioned-destination and same-country-and-permission blocks (Steps 4, 8, and §5) involved real fact-gathering a specialist would otherwise have done by hand, whatever the eventual decision |

```
monthly saving  =  requests/month  ×  share with real fact-gathering  ×  time saved  ×  hourly cost
                =  20               ×  75%                            ×  0.75 hr     ×  $41/hr
                =  $461/month  (≈ $5,540/year)
```

**Deliberately modest, and it should read that way.** This is the saving on
fact-gathering only — the decision itself is never made by this system, at any
risk level, and this figure does not pretend otherwise. Doubling the volume
input roughly doubles the figure; the arithmetic is linear and left in the
open so a reader can run it against their own numbers.

**What this figure does not include, and why not**: the AI classification call
this system makes on free-text intake has a real, non-zero marginal cost, and
this project's own status notes (`CLAUDE.md` §7, item 22) record that the
exact model and rate in production are not currently priced against a
published rate card. Left out here rather than invented, same as the UC-02 and
UC-03 guides.

### The value that is not a time saving at all

- **A sanctioned destination is refused before any Remote record exists, not
  merely flagged after one is created.** Verified in this guide's own Step 8:
  the sanctions check runs first, ahead of the employer-permission gate, ahead
  of factor validation, ahead of the risk matrix — specifically because an
  `escalate` (not just a `ready_for_approval`) can otherwise reach a real
  Remote work-authorization request and a specialist's one-click path. A
  sanctioned-destination request never gets that far.
- **Schengen day-counting is done per day of stay, not per trip — stricter than
  at least one named commercial competitor.** `docs/UC04-RESEARCH-FINDINGS.md`
  records that of the mobility-tech vendors checked, only one (Deel) publishes
  a hard administrative cap at all (45 business days / 70 calendar days), and
  frames it explicitly as an internal cap with an escalation path — not a
  legal safe harbor. This system's own calculator measures every day of a
  proposed trip against its own trailing 180-day window, which Step 9–12 above
  demonstrate directly: an overlapping pair of prior stays is unioned rather
  than summed, so a traveller is never refused on days they did not actually
  spend (Step 11), and the exact boundary (90 of 90) is shown clearing rather
  than merely asserted (Step 10).
- **A defensible record of enquiry, not just a decision.** Two English cases —
  *Dusek v StormHarbour Securities* [2015] EWHC 37 (QB) and *Cassley v GMP
  Securities* [2016] EWCA Civ 711* — both turn on whether the employer made
  "some form of inquiry" before a business trip, not on whether the trip
  itself was risky. In both, the breach was the *absence* of enquiry. Every
  request through this system leaves a durable, timestamped record of exactly
  which of eighteen checks were run and what they found — the shape of record
  those two judgments say matters.
- **Identical treatment of identical requests.** Step 1 and §5's Amanda
  scenario are the same trip, word for word, and the only thing that differs
  between them is a fact recorded on the traveller's own employment record.
  That is the whole demonstration that this system's decisions come from
  facts on file, not from how a request happened to be worded or who was
  reviewing it that day.

### What this system does not save — said plainly

- **No case is ever decided here, at any risk score.** `ready_for_approval`
  still needs the customer's own manager's click, `escalate` still needs a
  Mobility & Legal specialist's judgement, and `blocked` needed nobody in the
  first place because it isn't a judgement call. This system compiles the
  case; it never makes it.
- **Five of the seven structured factors this system decides on have no
  source in any Remote object** — see §9. Fact-gathering that still has to
  come from the requester by hand is not eliminated, only organised.
- **The specialist's own judgement on an escalated case is not shortened by
  this system, only better evidenced.** Sales-role and executive scenarios
  (Steps 5, 7) still land on a human's desk with no proposed answer at all —
  by design, because a permanent-establishment call is not one this system is
  built to be confident about.

---

## 9. What UC-04 cannot do, said plainly

- **Five of the seven structured factors this system's risk matrix runs on have
  no source in any Remote object at all**: nationality, visa type, job duties,
  prior travel history, and home country (`docs/INTAKE-RESEARCH.md` §6.4).
  They are *declared* by whoever files the request, not *read* from a Remote
  record, and every screen that shows them says so — the panel states plainly
  that a wrong stated country here "is not caught anywhere."
- **What the traveller will actually be doing there is captured, and scored by
  nothing.** The activity-profile fields this guide's quick-fills fill in
  (*"Activities to be performed," "Institutions or organizations visiting,"
  "Special worksites," "Where you will be working"*) are Remote's own
  published questions, verbatim, from its Request Hub form — and this
  project's own test suite (`test/uc04ActivityProfile.test.js`) fails the
  build if `policyEngine.js`, `riskMatrix.js`, `approvalPolicy.js` or
  `requestParser.js` so much as *mentions* that module. This is deliberate: a
  rule keyed on the word "laboratory" appearing in free text is a rule anybody
  can pass by rephrasing, and one an honest requester can fail by being
  specific. The value of this text is that a specialist reads what the
  traveller actually wrote — never that a machine judges it.
- **Stage 3 — Remote's own mobility review — cannot be sent to Remote, at
  all, ever, by design.** §2 and §6 above cover this in full: there is no
  endpoint, this system records the clearance in its own audit log, and every
  surface that shows it says so in the identical sentence rather than letting
  a reader infer that Remote has been told.
- **UC-04 makes no tax residency determination, no permanent-establishment
  determination, and no immigration legality determination, as a fact.** It
  routes to a human wherever one of those questions is live — a high-risk role,
  an unclear jurisdiction, a treaty-coverage watch flag — and the flags it
  raises (`tax_residency_watch`, `a1_certificate_recommended`,
  `non_treaty_pair`) are named as *watch* flags, never as verdicts.

---

## 10. If something goes wrong on the day

- **The portal or `/remoteui` asks for a key and you don't have it.** That's
  `PORTAL_ACCESS_KEY`, a shared password in this project's `.env` file — not
  something this guide prints. Get it from whoever manages the deployment
  before the demo starts.

- **A quick-fill you click times out or takes a while to answer.** Two of the
  fifteen scenarios in this guide's own preparation briefly timed out against
  the live deployment on first attempt and answered correctly on retry —
  nothing about the decision changed, only the response time. If a click seems
  to hang, wait and try again before assuming something is broken.

- **You approve João Silva's request in `/remoteui` and then can't find it in
  the ZAF sidebar without a real Zendesk login.** Expected, and covered in §6
  — reading or acting on the case from outside a genuine, signed-in Zendesk
  session correctly refuses `signed_identity_required`. That refusal is itself
  the thing worth showing on camera; the actual "clear"/"decline" click needs
  a real Zendesk-signed-in browser this guide's preparation did not have.

- **You want to show an unentitled reviewer being refused `approver_not_entitled`
  live, and the sidebar won't let you get that far.** It won't, from outside
  Zendesk, for the same identity reason as above — an unentitled *but
  Zendesk-signed-in* reviewer is a step beyond what a public demo environment
  can produce. §6 shows this from this project's own hermetic test suite
  instead, which drives the identical code path offline.

- **A step you run produces a different ticket number or record id than this
  guide's examples.** Expected — every run in this guide created a brand-new,
  real record with its own reference. What should **not** differ is the
  `decision` and `reason` values quoted for each step; those are the ones to
  check against.

- **Somebody asks whether `workation_permission` is a real Remote field.** It
  is not, and §5 says so plainly — it's this project's own stand-in for a
  custom field a real customer would need to create and maintain themselves.
  Be upfront about that rather than letting it sound like something Remote
  already tracks for every customer.

- **You want to show the resulting ticket in Zendesk itself.** This guide only
  verified the portal's and `/remoteui`'s own view of each decision, plus the
  ZAF sidebar's refusal at the identity gate, not the live Zendesk agent view
  in full, which needs separate Zendesk sign-in this guide's preparation did
  not have. The ticket numbers and group assignments quoted above (#342–#351)
  were real and correctly routed, but walk into that part of the demo knowing
  it wasn't screenshotted in advance.
