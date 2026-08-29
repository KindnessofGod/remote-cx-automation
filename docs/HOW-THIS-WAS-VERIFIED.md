# How this system was verified — and what that cost

*A CX automation layer built against Remote's real API. This page is not about
what was built. It is about how it was checked, what the checking found, and
what it cost — because the hardest part was never writing the automation.*

---

## The number that matters

Six independent evaluation rounds were run against UC-01, each one driving the
real deployed product as the people who use it. Findings per round:

| Round | Findings | What changed |
|---|---|---|
| 1 | **14** | first evaluation |
| 2 | 5 | fixes re-checked |
| 3 | 5 | |
| 4 | 4 | |
| 5 | **2** | 12 of 12 required evidence items passing |
| 6 | **31** | **the instrument changed** |

Round 5 said the use case was finished. Twelve of twelve. Two findings left,
both cosmetic.

Round 6 replaced one evaluator playing four stakeholders in sequence with **four
isolated evaluators, each able to see only its own surface**, and found
thirty-one defects — five of which broke the journey outright. The first:

> An employee presses **Get my letter**. A complete, correct letter is generated
> and returned in the HTTP response. The screen shows no letter, no preview, no
> link — only *"This is already final. Open 'My requests' to see it."* My
> requests does not list it, and never says why.
>
> In the evaluator's own words: *"I would have refreshed this page for a week."*

**The product had never once delivered a letter to the person who asked for it,
and five rounds of testing reported it working.**

Nothing regressed between rounds 5 and 6. The measurement got sharper. That is
the single most useful thing in this repository, and it is why the round count
is published here instead of a green tick.

---

## Why the earlier rounds could not see it

One evaluator playing every stakeholder knows too much. By the time it reached
the employee's screen it had already read the audit log, the internal note and
the decision record — so it knew the letter existed and never noticed the
employee could not reach it.

Isolation is not an optimisation of that process. **It is what makes the
stakeholder real.** The cost was measured rather than assumed:

| | Serial (round 5) | Isolated (round 6) |
|---|---|---|
| Cost | $26.95 | **$63.44 — 2.35×** |
| Findings | 2 | **31** |
| Context re-read as share of cost | 74.9% | 54.9% |

**2.35× the money for roughly ten times the findings**, and the one that
mattered was invisible at any price on the old method. The falling
context-re-read share was the pre-registered test for whether the isolation was
real rather than cosmetic; it was stated before the round ran, not after.

A prediction made before that round — that isolation would be *cheaper* — was
wrong by a factor of three and is recorded as wrong.

---

## Deciding what NOT to automate

The three decisions below were harder than anything that was built, and each was
argued from evidence rather than instinct.

**A whole risk tier has no execution path, and a test enforces it.** For
cross-border tax and permanent relocation, the system compiles a dossier and
stops. There is no approve button, no write path, and no route that could reach
one. This is not policy in a document — `test/uc08.test.js` reads the source and
fails if the workflow so much as *references* a write method:

```js
assert.ok(!code.includes(name),
  `workflow.js's actual code must never reference ${name} — UC-08 has no execution path`);
```

An automation you can argue your way past is not a control. This one cannot be
argued past, because the argument is a failing test.

**A vector database was provisioned, measured, and deliberately left empty.**
`docs/RETRIEVAL.md` measured the corpus at **106 passages** and recommended
*not* seeding the index — at that size a lexical index over the real statutory
text is both cheaper and more honest than embedding similarity. The
infrastructure exists. Using it would have been the worse engineering decision,
and the document says so with the number attached.

**Five proposed connections between use cases were refused.** Letting a
low-risk keyword classifier open a high-risk tax case is not integration, it is
a tier violation with extra steps. Use cases connect by *reading* each other's
records, never by one invoking another.

---

## Being wrong in the open

`docs/CORRECTIONS-LOG.md` records **31 occasions** where this system was caught
being wrong — most by the person it was built for — and what changed as a
result. A sample, in their original words:

> *"No matter what I do in UC-02, I always get 'Already decided'"*
> *"I checked Zendesk and did not see a new ticket created"*
> *"The approve was done — I saw it in the live feed — but saw nothing in the request page"*

The most expensive entry is **C-16**, and it is the reason for every rule below
it: a travel-router gate built its country list from a three-letter field and
compared it against two-letter codes, so the use case **could not say yes to any
input, ever** — and every safety assertion in the suite passed, because
*refusing correctly and being unable to succeed are indistinguishable from
outside.*

That single defect produced three standing rules:

1. **The positive test leads.** Not "it refuses correctly" but "this known-good
   input MUST succeed." A suite of only negative tests passes whether the fix
   landed, landed inverted, or never landed.
2. **Exit 2 is not exit 0.** Every checker in this project exits `0` verified,
   `1` defect found, `2` *could not tell you* — and a check that cannot reach
   its target may never report a pass.
3. **Scenarios are discovered, never fixtured.** Fixtures were once written to
   agree with the code and the code with the fixtures, so neither was ever
   compared to the real API.

---

## What is measured continuously

`npm run verify-surfaces` drives the deployed product and asserts one set of
facts across every surface a decision appears on — the sidebar, the internal
note, the customer reply, the audit feed, the ticket's tags.

**The loop is the point, not the checks.** A defect was once fixed on the
sidebar and reappeared two hours later in the internal note, costing a full
round to rediscover. A fact declared once and asserted on *every* surface has
nowhere left to migrate to.

It exits `2` — *could not tell* — rather than `0` when the only evidence for a
failure predates the deployment that could have changed it. A tool that reports
a fixed defect as live teaches its reader to stop believing it, which is the one
failure a verification tool cannot survive.

---

## What is not finished, and said plainly

Eight of the nine use cases are deciding real requests in production today and
have **not** been through this evaluation. They are unverified, not unbuilt, and
the status tables say so. One use case has a build queue and no successful
production decision at all — its positive path depends on a payroll calendar the
sandbox has not extended, so it can currently only ever be observed refusing.
That is stated wherever it is relevant rather than reported as caution.

A reviewer who catches one overstatement discounts everything else. That is why
this page leads with the round where the count went up.
