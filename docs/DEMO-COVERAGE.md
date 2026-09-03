# What the demo has to cover — and why each beat earns its minute

`docs/DEMO-SCRIPT.md` is the shot list. **This is the argument** — what a viewer
must end up believing, which beat produces that belief, and what evidence backs
it. Written for the person choosing what to show and, more importantly, what to
cut.

> **The audience is a CX leader at an EOR platform**, not an engineer. They own
> a queue, a headcount plan and an SLA. Nothing below is worth a minute unless
> it moves one of those three. A second audience — a reviewer judging the work —
> is served by exactly the same beats, because the thing that impresses a
> reviewer is the thing that convinces a buyer: the refusals.

---

## 0. The one-sentence claim

**Routine EOR support requests are decided by deterministic gates in seconds,
the risky ones are prepared for a named human instead, and every one of them
leaves a record you can audit.** Not "AI answers tickets".

If a viewer leaves able to repeat that sentence, the demo worked.

---

## 1. The five things that must be shown, in priority order

Cut from the bottom. A demo that only reaches §1.3 is still a good demo; one
that shows §1.5 without §1.2 is a chatbot pitch.

### 1.1 A real request, decided end to end, with nobody touching it

**Value claim:** the deflection is real, not a demo harness.

Show a real Zendesk ticket arrive, an n8n execution fire, a decision land, the
customer get a reply, and the ticket resolve — **and then open the destination**,
not the run flag. Read the `audit_log` row back. That last step is the whole
difference between this and a screen recording of something that appeared to
work.

**Evidence that exists:** UC-01 execution `9941` / ticket 4 — `pinData: {}`, 28
of 28 nodes `success`, `auto_resolve / all_gates_passed`, rows `cases ec0f6836`,
`audit_log 1309a675`, `audit_trace 918798fa`, `documents c9c7cc78`, ticket
solved and tagged, letter delivered as rendered HTML.

**Say the timing out loud.** Ticket #6's customer comment at `21:34:36` and the
solved letter at `21:34:41`. Five seconds is the number a queue owner
understands.

### 1.2 The same system REFUSING — on camera, twice, for two different reasons

**Value claim:** it knows what it is not allowed to do. This is the beat that
converts scepticism, and it is the one most demos skip.

Two refusals, because one looks like caution and two look like a policy:

- **A gate refusal.** UC-01 asked for salary on a verification letter →
  `human_review / over_scope_request`. Then show the letter it *does* produce
  against a record carrying a real salary — and show the salary is not on it.
- **A structural refusal.** UC-07/UC-08 have **no execution path at all** — no
  POST route, one store write method, zero mutations, no Switch node in the
  graph. Show the test that asserts it. "We chose not to build the button" is a
  stronger claim than "the button is well guarded".

**Then the honest one:** UC-09 execution `9279` — a real ticket, 14/14 nodes
green, and the decision is `escalate / identity_not_verified`, because a Zendesk
ticket carries no Remote session. A green run that refuses is the most credible
thing in the whole system.

### 1.3 The human hand-off, and the queue that admits what nobody can reach

**Value claim:** you are not buying a black box; you are buying a work router
with an inbox.

- The ZAF sidebar inside a real ticket: the **gate ladder**, with each rung
  marked `passed` / `decided` / `not_reached` — `not_reached` deliberately
  distinct from `passed`, because a gate that never ran approved of nothing.
- Approve something and watch the `audit_log` row appear.
- **Then try to approve an escalation and get refused on camera.**
- `/queue` — and lead with the **stuck** list, not the flowing one. It reports
  what is waiting, where it would be actioned, and where that screen does not
  exist. A queue that reports its own dead ends is the credibility beat.

### 1.4 The requester's side of the same event

**Value claim:** the loop closes for the person who asked, which is the half
most automation demos never show.

`/portal` → file an over-cap expense → routed to Finance Ops with a real ticket
number → decline it in the sidebar → **the portal announces it by itself**, with
the approver's name, the timestamp and their note, in the server's own words.

This is also the cheapest beat to film and the easiest to believe, because the
viewer watches one event appear in two places.

### 1.5 Measurement, which is the actual product

**Value claim:** you can decide what to automate NEXT, and what to stop.

`npm run metrics`. The numbers that matter to a queue owner: deflection rate,
decisions per tier, specialist accept rate, cost per decision, time to decision.

**The two verdicts to point at are the negative ones**, because they are what
makes the dashboard trustworthy:

- `insufficient_data` where a 🟡/🔴 use case has zero decided reviews — not a
  false `healthy`.
- `unpriced`, naming the model, where no rate exists — the dollar total declared
  a floor rather than invented.

---

## 1a. UC-03, driven end to end on 2026-08-30 — the one beat that shows all four outcomes from one form

Verified against the live deployment on the date shown, through the portal's own
routes. Quoted because a demo built on an unverified chain fails on camera.

**One text box, four different answers.** That is the demonstration: the viewer
types into the same field four times and the system does something different
each time, for a stated reason.

| Quick-fill | Decision | What the viewer should notice |
|---|---|---|
| Short business trip | `auto_resolve / all_gates_passed` | answered outright, **no ticket raised at all** |
| **Visa support letter** | `auto_resolve / standard_letter_issued` | a real letter, issued with **no human in the path** |
| Workation from Portugal | `route_to_uc04 / work_authorization_requested` | 🟢 refuses to answer a 🟡 question and hands it on |
| **Trip to a restricted country** | `escalate / sanctioned_region` | stopped before anything is drafted |

The last one was added on 2026-08-30 because the other five chips all ended in
the system DOING something. A router seen only saying yes has not been seen
working.

### The letter is the strongest single artefact in the demo

Open it (My requests → the letter row → open). It is on the employing entity's
letterhead, names the employee, job title, status, contract type, start date,
destination and dates — and it prints **"Annual gross salary 95,000.00 USD"**.

**Show that beside UC-01's letter, which contains no salary at all.** The
contrast is the point, and both sides are sourced:

- **UC-01 omits it** because Remote's own published template omits it, fetched
  from their Help Center (`docs/UC01-INTAKE-FIELDS.md`), and asking for it is
  refused as `over_scope_request`.
- **UC-03 includes it** because the EU Visa Code Handbook names *"salary slips"*
  and a *"certificate of employment"* under **means of subsistence** (§5.2.2(d)/(e)),
  `[CONFIRMED]`, Commission Implementing Decision C(2024) 4319, with a SHA-256
  of the retrieved bytes in `src/uc03/letter.js`.

Two documents about the same person, one disclosing pay and one refusing to,
each able to name the authority for its choice. That is the whole thesis of the
project in one side-by-side.

### The continuation, and the trap that will catch you rehearsing it

The workation chip routes to UC-04 and offers **Continue**. Clicking it records
a durable audit row, carries five values across, and names four things UC-03 has
no source for (nationality, visa type, job duties, signing authority) — the
honest half: `docs/INTAKE-RESEARCH.md` §6.4 establishes those have no home in
any Remote object, so a person is asked rather than a value invented.

**The page silently switches the session to the company admin at that point**,
because UC-04's identity gate wants a company session and an employee persona
has no `companyId`. It is correct and it is invisible.

> **Do not rehearse this part with `curl`.** The continuation refuses an admin
> and the UC-04 intake refuses an employee, so driven by hand in that order it
> is a dead end for every persona and looks broken. It closes in the browser
> and only in the browser.

### What is NOT demoable in this chain today

The UC-04 request the continuation produces reaches `ready_for_approval /
all_gates_passed` (ticket 36) and then **the approve button refuses**:
`approver_not_entitled`. The roster has an entitled UC-04 specialist —
`/__cx/health` reports `approverEntitlementCoverage {"UC-04": 1}` — but it is
not the Zendesk agent the demo signs in as, and the sidebar approves as that
agent's email. **One `APPROVER_ROLES` entry on the Vercel project**, which no
coding session can set.

Until then: end UC-03 at the letter and the refusal, both of which are complete,
and do not click approve on ticket 36 on camera.

---

## 2. The named tooling, shown rather than listed

One sentence each, in passing, while something else is on screen. Nobody wants a
tour.

| Tool | Where it is visible | The beat |
|---|---|---|
| **Zendesk** | the ticket itself | trigger → webhook, authenticated with a shared secret |
| **ZAF** | the sidebar | an app inside the agent's screen, not a separate tab |
| **n8n** | the execution | open one and read NODE status, never run status |
| **REST** | Remote Sandbox | a real `PATCH /v1/expenses/:id`, read back |
| **Webhooks** | `X-YOUR-WEBHOOK-TOKEN` | all nine refuse an unauthenticated POST |
| **Postgres** | `audit_log` | the row, not the log line |

---

## 3. The three things that make it credible, and cost 30 seconds each

These are what a reviewer remembers.

1. **Exactly-once.** Deliver the same ticket twice. One claim row, one record,
   one audit row; the redelivery stops at `Duplicate Delivery — Stop` having
   written nothing. The guarantee is a PRIMARY KEY, not application code.
2. **Audit before action.** `Append Audit Log` runs *before* `Route by
   Decision`. Show an execution where the final Zendesk write FAILED and the
   audit row is still there. The decision survives the outage; only the
   customer-facing update is lost, and `ops_alerts.audit_durable` says which.
3. **Identity fails closed.** A ticket carries no Remote session, so identity is
   derived from the Zendesk-authenticated requester matched against the Remote
   record — never an address typed in the ticket body.

---

## 4. What NOT to claim — the list to read before filming

Every item here is something the repo currently gets wrong or cannot do. Being
caught on one of these discounts everything else (`CLAUDE.md` §1, directive 7).

- **Do not say "nine use cases live in production."** Real unpinned execution
  proof exists for **five** — UC-01, 03, 04, 05, 09. UC-02 now too on its own
  paths. UC-06, 07, 08 do not have it.
- **Do not demo UC-06's approval path as pure Sandbox data.** The Sandbox's
  payroll calendar stops in the past, so an approvable cycle only exists via the
  stand-in's projection. The two REFUSALS are 100% real; say which is which.
- **Do not call the retrieval "embedding similarity".** Both pgvector tables
  have held zero rows since they were provisioned. It runs on its keyword leg.
- **Do not quote a cost figure.** The deployed classifier is `gpt-5-nano`, which
  the repo does not price; the metrics report says `unpriced` and means it.
- **Do not show the ZAF sidebar on a low-numbered ticket without checking it.**
  Ticket numbering restarts per Zendesk account. Guarded at the API as of
  2026-08-30, but the *reason* is worth knowing before you point a camera at it.
- **Do not read a green n8n run as success.** A pinned node reports `success`
  having done nothing. This is the single most expensive lesson in the repo and
  it belongs in the narration, not in a footnote.

---

## 5. The closing beat

End on the **refusal**, not the success. The last thing on screen should be the
system declining to do something it could technically do — and the audit row
proving it declined.

The pitch for an EOR platform is not "we automated support". It is: **the
routine 60% is decided in seconds and recorded; the dangerous 15% is never
touched by a machine; and you can prove which is which for every single
request.**
