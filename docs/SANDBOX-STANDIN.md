# Why this project ships its own Remote Sandbox stand-in

Three of the nine use cases do not read Remote's Sandbox directly. They read
`your-sandbox-standin.vercel.app` — a read-only proxy in front of the real
gateway (`src/remotebridge/`, deployed from `deploy/remote-bridge/`).

Six use cases read the gateway. Three read the proxy. **That asymmetry looks
exactly like configuration drift and it is not.** It has already been "nearly
fixed" once. This document is why it exists, what it is allowed to do, and the
two rules that make it safe rather than dishonest.

---

## 1. The problem: a sandbox that answers, but not with the field you need

Remote's Sandbox is real, public, and genuinely useful — every read in this
project is a real HTTP call against it. But a sandbox is populated for
demonstration, not for the particular question you happen to be asking, and
three use cases here ask questions its data cannot answer.

**UC-04 (work authorization)** gates on
`custom_fields.workation_permission`. The Sandbox returns `undefined`. The gate
is written to fail closed, so every single workation request — from every
employee, in every country, forever — is refused with
`employer_permission_not_granted` (`src/uc04/policyEngine.js:272`).

**UC-05 (resignation notice)** computes statutory notice from tenure, which
needs `basic_information.start_date`. The Sandbox returns `undefined`. There is
no arithmetic to do.

**UC-06 (contract amendment) is the sharpest case, and it is not an empty field
— it is an empty PERIOD.** The Sandbox's payroll calendar simply stops. Read
live, the last `period_end` is 2026-06-30 for SG/FR/CA/US and 2026-07-31 for
NL — all in the past. So `evaluateCutoff()` can find no cycle covering any
future effective date, and UC-06 escalates `noMatchingCycle` for **every
amendment anyone will ever submit.**

### Why "it always refuses" is the worst possible demo failure

A system that refuses everything and a system that is appropriately cautious
are **indistinguishable from outside**. Both produce a refusal with a plausible
reason. A reviewer cannot tell whether the gate is working or whether the gate
has never once been reached, and neither can the person who built it.

That is the actual cost being paid here. Not "the demo looks thin" — *"the
demo cannot distinguish correct behaviour from broken behaviour."*

---

## 2. The rule this project follows: a substitution ladder

Rather than deciding case by case, every fact in the system comes from the
highest rung that can answer it:

| | Rung | Source |
|---|---|---|
| 1 | **Remote's own documentation is the source of truth** | `developer.remote.com`, its OpenAPI, its `.md` pages |
| 2 | **Where the Sandbox holds relevant data, use the Sandbox** | `gateway.remote-sandbox.com` |
| 3 | **Where the Sandbox refuses or lacks the capability, replicate it in our own stand-in** | this proxy |
| 4 | **Where no relevant data exists at all, fabricate** | a named, marked fixture |

**Rung 1 is never overridden by a lower rung**, and that is not a formality.

### The mistake the ladder exists to prevent

Three times this repository recorded a *Sandbox limitation* as a *fact about
Remote's platform* — UC-05's resignation endpoint, UC-06's `automatable`
pre-check, and UC-07's atomic country-transfer endpoint, all three in a single
sentence of an architecture document.

**Two of the three turned out to exist.**

The error is subtle and worth naming precisely: **a Sandbox that refuses is
rung 2 failing, not rung 1 answering.** "I could not find it in the sandbox" and
"Remote does not offer it" are different claims, and only one of them is
checkable against the vendor's own documentation. Every integration claim in
this repo is tagged `[CONFIRMED]` / `[VENDOR-PUBLIC]` / `[INFERRED]` /
`[PROPOSED]` for the same reason.

---

## 3. What the stand-in is allowed to do

It is a **proxy**, not a mock. It forwards the caller's `Authorization` header
untouched to the real gateway, so it can never show you data your own
credentials could not fetch. It refuses every write with **405**. It returns
**502** on upstream failure rather than substituting a cheerful default —
because a fabricated success on a failed call is precisely the lie this whole
design is trying not to tell.

It fills **only fields the real Sandbox left null**, and it does two further
things beyond enrichment:

- **Enrichment** (`enrichment.js`) — fill a field the Sandbox left empty.
- **Projection** (`payrollProjection.js`) — continue each country's *own
  observed cadence* past its last real cycle. The same honesty rule rotated one
  dimension: enrichment may fill a field the Sandbox left empty; projection may
  append a period it leaves uncovered.

### Two constraints, neither negotiable

**1. A substituted fact is always self-identifying.** Nothing fabricated may
ever reach a reader looking like something Remote said:

- projected cycle ids begin `standin-`
- an `X-Standin-Enriched` response header names every field touched
- a `_standin` block in the body says what was substituted
- the audit row carries `cutoffCycleProjected`

**2. Money is never fabricated.** On a projected cycle,
`total_payroll_cost` and `approval_date` stay `null`. **A cadence can be
continued; an amount cannot be invented.** A payroll date is a pattern you can
observe and extend. A payroll *cost* is a fact about money that either exists or
does not, and guessing one — even plausibly, even in a demo — is the single
thing this system will not do.

And one honesty rule underneath both: **a real value always wins.** Rung 3 fills
only what rung 2 left empty; rung 4 only what rung 3 cannot reach.

---

## 4. Both halves of the UC-06 demo are real, and only one needs the proxy

This is the part worth showing, because it is the strongest evidence the
stand-in is not papering over anything.

Pointed at the **raw gateway**, on 100% real Sandbox data:

- a September effective date refuses with `noMatchingCycle`
- a June effective date refuses with `cutoffAlreadyPassed`, **naming a real
  cycle**

Both of those are genuine refusals against genuine data. Only the *approval*
path needs the proxy, because no cycle whose lock has not yet closed exists
anywhere in the Sandbox.

And it is switchable: set `STANDIN_PAYROLL_HORIZON_MONTHS=0` on the deployment
to turn projection off and reproduce the refusal through the same URL. The
claim is falsifiable by anyone reading this.

---

## 5. Do not "fix" the three graphs to point at the gateway

UC-04, UC-05 and UC-06 point at `your-sandbox-standin.vercel.app`
**deliberately**. Repointing them to `gateway.remote-sandbox.com` breaks all
three, in the specific ways described in §1.

**A 404 reproduces identically through both hosts.** That is what makes the
wrong diagnosis so easy to believe: a dead employment id looks exactly like a
wrong host. This has already happened once here — a host difference was
diagnosed as the cause of a 404 that was really a reseeded Sandbox, and the
"fix" was nearly deployed. **Test the id against both hosts before blaming
either one.**

---

## 6. What this demonstrates, and what it does not

**It is not a workaround for a missing vendor.** Remote's API is real, its
documentation is public, and this project reads both. The stand-in exists at
exactly one layer — *sandbox data coverage* — and announces itself in four
places whenever it acts.

The reusable idea is the ladder, not the proxy: **when a demonstration
environment cannot answer a question, say which rung you dropped to, mark
everything you substituted, and never fabricate money.** A demo built that way
can be checked by a reader instead of believed.

The proxy is ~300 lines. The rule is the deliverable.

---

**See also:** `docs/00-FOUNDATION.md` §2a · `qa/contracts/UC-06-acceptance.md`
§18a · `docs/WHY-THIS-SHAPE.md` §14 · `src/remotebridge/` ·
`deploy/remote-bridge/`
