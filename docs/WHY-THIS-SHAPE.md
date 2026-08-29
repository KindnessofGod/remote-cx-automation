# Why this system is shaped the way it is

**For an engineer who is about to change something here.**

| | |
|---|---|
| **Written** | 2026-08-20 |
| **Verified against** | the code at `cc551b4`, the live Supabase project `your-project-ref`, the live Zendesk account `your-subdomain`, and `https://remote-cx-apis.vercel.app` |
| **Evidence tags** | `[CONFIRMED]` read from code, a live query or a live run · `[INFERRED]` argued from something confirmed · `[UNKNOWN]` could not be checked from this container, and why |

This is not the architecture document. [`ARCHITECTURE.md`](ARCHITECTURE.md)
answers *what exists and where*; [`00-FOUNDATION.md`](00-FOUNDATION.md) is the
contract every use case inherits; [`BUILD-LOG.md`](BUILD-LOG.md) is the
chronological record. **This one answers a different question: why is it shaped
like this, and what happens if you change it back?**

Every section below is built around a defect this repository actually shipped.
That is deliberate. A design principle stated in the abstract — *"validate LLM
output"*, *"fail closed"* — is unfalsifiable and everybody agrees with it; the
same principle stated as *"here is the afternoon we lost, here is the row in the
database, here is why the obvious fix was the wrong one"* is checkable, and it
is the only version that tells you which change is safe.

---

## 1. Risk tier selects the execution path. It is not a label.

Nine use cases, three tiers.

| Tier | What the code does | Use cases |
|---|---|---|
| 🟢 Low | validate → auto-execute → resolve. Exceptions gate to a human. | 01 verification · 02 expenses · 03 travel router |
| 🟡 Medium | AI prepares and risk-scores → **a human approves** → execute. 06 needs two different, entitled people. | 04 work authorization · 05 notice · 06 amendment |
| 🔴 High | AI compiles a dossier and escalates. **For 07 and 08 no execution path exists at all.** 09 is the deliberate exception. | 07 mobility · 08 tax · 09 off-cycle payroll |

The interesting claim is the 🔴 one, and it is worth being precise about how it
is enforced, because "we check the tier before writing" would be a much weaker
system.

`handleTaxInquiry()` (UC-08) and `handleRelocationReview()` (UC-07) **take no
write-capable client as a parameter**. Not "take one and refuse to use it" —
there is no parameter through which a `RemoteClient` or a `ZendeskClient` could
be passed, even by mistake, even by a future contributor who has not read this.
A policy check that merely declines to call a write method is one bug away from
calling it. **Removing the parameter removes the bug's precondition.**

The same argument is then made again at every layer above:

- `dossierStore.js` has **one write method and zero mutation methods** — there is
  no `markReviewed()` for a bug to live in, because there is no such method.
- `src/uc08/server.js` has **no POST route in the file**, not a POST route that
  returns 403. `test/uc08Server.test.js` asserts a POST 404s as `no_such_route`.
- The n8n graph has **no Switch/IF node anywhere** — every execution ends at the
  same single internal-note update.
- `src/portal/ticketing.js` names UC-07 and UC-08 as deliberately *un*-ticketable
  and says why: linking a ticket means writing an id back onto the record, and
  that would put a mutation method on the two stores whose defining property is
  that they have none.

**UC-09 is the exception and it earns it.** Off-cycle payroll moves real money,
so refusing to build an execution path would be refusing to solve the problem.
It has one, behind a multi-role approval whose floor is written
`Math.max(2, …)`, so no risk score, configuration value or future edit can drop
it below two people. *"No automation"* and *"no execution"* are different claims,
and this system makes both, in the places each belongs.

> **If you are adding a tenth use case:** the tier decision is the first one and
> it is a decision about *the blast radius of being wrong*, not about how hard
> the request is to parse. Everything else follows from it mechanically.

---

## 2. LLMs interpret. Deterministic code decides. The seam is narrower than you expect.

The rule is easy to say and easy to violate accidentally, so here is the sharpest
version of where the line goes, from UC-06.

UC-06 amends a contract — sometimes a salary. The distilled spec said *"LLM:
parse proposed contract changes from ticket text."* Building it that way would
make an LLM the **source of a number that reaches a payroll write**. So it was
not built that way. Proposed changes must arrive as structured data; the LLM's
only job (`changeParser.draftSummary()`) is a plain-English restatement of
values that have **already been decided**, and that restatement can never be
read back into a decision. Amendment-type classification (increase vs. decrease)
turned out to need no LLM at all — it is fully derivable from the structured old
and new values.

Three mechanical consequences you must preserve if you touch an LLM call site:

1. **Every LLM result is validated against a strict shape and falls back to
   rules on any failure** — missing key, network error, bad JSON, wrong enum.
2. **Every result says which path answered.** `source: "llm"` or
   `source: "rule_based_fallback"`, on every result, never implicit
   (`00-FOUNDATION.md` §4 invariant 8). This was found *missing in the canonical
   implementation while already present in its own n8n port* — a reference
   implementation less observable than its copy, which is backwards.
3. **Every LLM call site needs an injectable seam from day one.** Not added
   later when a slow test surfaces the gap.

That third point has a price tag. This devcontainer's environment carries a
genuine but unreachable `OPENAI_API_KEY`, so any test that did not explicitly
inject a fake `classify`/`draftSummary`/`draftNarrative`/`judge` was making a
real, slow, failing network call. One test went from ~1ms to **11.4 seconds**;
the full suite from ~2s to ~26s. It has bitten twice more since, once per new
call site. **A fast full-suite baseline is itself a hermeticity check** — a
sudden jump in `npm test`'s duration after a merge is worth investigating before
believing a "hermetic, all passing" claim. `[CONFIRMED]` — current suite:
**4,109 passing, 0 failing**, 2026-08-27.

There is one place an LLM is allowed to read *inbound* free text and it is
instructive. `src/uc04/intakeExtractor.js` reads a workation request written as a
sentence. Four deterministic checks stand between it and any gate — strict
shape, canonical alpha-2, membership of a curated dictionary, and **grounding**
(the country's name must appear in the request at a word boundary; a date's year
must appear in the request). An extracted value is marked as a *candidate* in the
response, in `audit_log.details.extraction`, and in the human-readable summary —
and **that caveat is appended by code, never asked for in the prompt**, because
a provenance warning a model can omit is one that will eventually be omitted.

---

## 3. Identity comes from an authenticated signal — and "it failed closed" is not "the control works"

Prime directive 3 says identity is proven from an authenticated signal, never
from a claim, and fails closed. Everyone agrees with that sentence. Here is what
went wrong anyway.

**Four identity gates (UC-03, 05, 06, 09, in the n8n ports) could report
`verified: true` having proved nothing.** Two echoed the caller's own
`request.employmentId` back as the "authoritative" record id and then compared
the session against it — comparing a claim with itself. Two compared
`session.companyId` against a `company_id` that defaulted to `null`, so
`null === null` passed.

All four still refused every real request. **They refused by accident of gate
ordering** — a later status gate happened to catch the run. So the decision was
right and the *recorded reason* was false, and the recorded reason is the only
thing that tells a human what to do next.

The fix was at the construction site, not at the comparison: no usable record now
yields `employment = null`, which is literally what `RemoteClient.getEmployment()`
returns on a 404. Proven in production on UC-05 with **identical input** either
side of the fix — audit row `a324f666` (`employee_not_active`) →
`283dbd1f` (`identity_not_verified`), with `946764ef` still reaching
`all_gates_passed` so the positive path was not broken by the fix. `[CONFIRMED]`

> **The transferable rule: an identity control whose correctness depends on a
> downstream gate is not a control.** And when you audit one, audit the *reason
> string*, not the decision.

A close relative: `onError: continueRegularOutput` on an n8n HTTP node **does not
mark the node red**. It reports `success` and emits `{json:{error:{…,status}}}`
in place of the data, so gates escalated naming the wrong cause — a Remote outage
was recorded as the customer failing identity verification.
`src/shared/upstreamFailure.js` now separates three states:
`upstream_record_not_found` (a 404 — an authoritative answer *about the record*),
`upstream_unavailable` (403/5xx/transport — the request was never evaluated), and
an unchanged policy refusal. It is **fail-closed by construction**: every verdict
it can return is an `escalate`, and it is consulted only at gates that are
already refusing, so it can change a refusal's recorded reason and can never
produce an approval.

---

## 4. Exactly-once is a primary key, not a function

Zendesk ticket **#5** arrived three times. It produced **two `audit_log` rows 30
microseconds apart** (`21:26:20.986108` and `.986138`) and a duplicate
verification letter posted publicly to a customer. `[CONFIRMED]`

The tempting fix is a Code node that reads the ledger and then decides. That has
exactly the race that caused the bug. So:

- One table, `workflow_claims`, keyed **`(use_case, external_ref)`**, and the
  guarantee is **that table's PRIMARY KEY**.
- **One ledger for both execution paths.** The Node app's
  `src/shared/workflowClaims.js` and all nine n8n graphs write to the same table.
  Two ledgers would each read the other's refs as unclaimed.
- **Keyed by use case as well as ref**, because one ticket may legitimately reach
  two use cases (UC-03 routes on to UC-04). Keying on the ref alone would
  silently drop the second — worse than the duplicate it prevents.
- **Placement is deliberate**: after the gates (re-deciding is free and leaves no
  trace, and a duplicate stopped earlier never records *why*) and before the
  first durable write (everything downstream is a record or an outward act).
- **A redelivery stops silently** at a NoOp named `Duplicate Delivery — Stop`.
  Erroring would page a human every time Zendesk behaved normally, which trains
  everyone to ignore the alert.

Two consequences that are not obvious:

**A ref-less request is claimed, not dropped.** Both key columns are `NOT NULL`,
so a bare expression inserted `null`, failed the key, took the error output and
vanished at the NoOp — a *green run that wrote nothing*. Such requests are now
claimed under `unreferenced:<execution id>`.

**A second decision about the same ticket needs its own claim.** When
`cc551b4` made an answered travel question able to become a formal letter, the
answer had already claimed the ticket — so the letter would have been refused as
a duplicate and vanished silently. `ticket.claimRef` splits them: the ticket id
stays on the case row (it is where the conversation is), the claim is taken under
`<ref>#letter`. Two simultaneous accepts are separated by the primary key,
driven concurrently in a test.

---

## 5. The gates exist twice, and parity tests are what make that safe

Each use case's decision logic lives in `src/ucNN/policyEngine.js` **and again**
in `workflows/nodes-ucNN/*.js` as an n8n Code node body. This is real duplication
and it was chosen on purpose: UC-01's n8n graph calls OpenAI, Remote, Zendesk and
Supabase directly and **never depends on the Node app being up**. A thin
orchestrator that called back into a Node service would put a hand-rolled,
singly-instanced process in the ticket-intake path.

Ten parity tests (`test/n8nParity.test.js`, `test/n8nUc02Parity.test.js` … ) load
the **real** n8n Code node body into a `node:vm` sandbox and assert it decides
identically to the real function across a scenario set. **If you edit one, edit
both** — the suite will catch you, but know why.

Three rules that fall out of this, each paid for:

- **n8n Code node bodies must be real `.js` files**, never template literals in a
  builder. Two escapes collapsed on first deploy: `join('\n\n')` became a literal
  newline inside a string literal, and `/https?:\/\//` became `/https?:///` —
  which JavaScript parses as a regex *followed by a line comment*, so a boolean
  silently held a `RegExp` object. Always truthy. Nothing crashes, and **every
  ticket routes to human review while the automation resolves nothing.**
- **`node:vm` results are cross-realm.** `assert.deepEqual` fails on prototype
  identity, not content. JSON round-trip the result — which is also what n8n does
  between nodes.
- **A deliberate divergence must say it is deliberate.** UC-08's retriever is
  embedding-similarity when configured and keyword-matching when not; the n8n
  port keeps only the keyword path, because a Code node has no `pgPool` and no
  embedding client. The parity test therefore compares like with like. **Do not
  "fix" that node by pasting the class into it.**

---

## 6. "Verify against the deployed thing" — and why every verifier exits 2

The single most expensive category of error in this repository is not a wrong
gate. It is **believing that what is in the repo is what is running.** It has
happened in every direction:

- A **pinned** n8n node reports `executionStatus: "success"` **without doing
  anything**. `mcp__n8n__test_workflow` pins every credentialed node, so a
  Supabase write node returns `{success: true}` from pin data and the whole
  execution goes green having touched no database. That is how *"execution 10 ran
  through to audit"* survived in the docs for two sessions while `audit_log` held
  zero n8n-written rows. **A green n8n execution is not evidence an integration
  works — check the destination.**
- `PUT /api/v1/workflows/{id}` **publishes in place**; the MCP `update_workflow`
  writes **only a draft**. Two tools, two opposite defaults, both pointed at live
  automations that reply to real customers. `activeVersionId === versionId` is the
  only thing that answers *"is this live?"* — and it answers it for both.
- **An installed ZAF app is a static upload.** Editing `zaf-app/assets/` changes
  nothing in Zendesk until `zcli apps:update` runs. On 2026-08-19 the repo bumped
  the manifest at 22:58 and the account began serving it at 23:06:54Z — for eight
  minutes the tests, the code and every reviewer's reading of the branch agreed on
  a behaviour the live sidebar did not have. `[CONFIRMED]` today: app `9990001` is
  at **1.4.0**, uploaded `2026-08-20T07:40:13Z`, matching the manifest.
- **n8n orders a fan-out by CANVAS POSITION, not by the connection array**, and
  nothing in the JSON you are editing says so. A must-not-lose branch sitting
  lower on the canvas was left unrun on `nodeExecutionStack` when a sibling
  branch failed. **Reordering the connection array changed nothing** — which is
  what makes it expensive, because the obvious fix is silently a no-op. Only
  `get_execution`'s `nodeExecutionStack` shows a node *pending* rather than
  skipped.

Hence four verifiers that read **the deployed thing**, not a local file:

```
npm run verify-deployed   # every deployed n8n Code node vs its .js file
npm run verify-claims     # the idempotency claim node's WIRING on all nine graphs
npm run verify-traces     # the audit-trace branch's wiring AND canvas position
npm run verify-live-uc01  # UC-01's live chain, read-only, writes nothing
```

**Each exits `2` — never `0` — when it cannot reach what it is checking.** That
is the whole design. A skipped check that exited 0 would be indistinguishable
from a passing one, and this project has already been burned by silence reading
as success. From a container without n8n credentials they answer
`403 Forbidden` and exit 2. `[CONFIRMED] 2026-08-20`

`verify-traces` also checks something a body diff structurally cannot see: the
collector looks nodes up **by name** and treats an unknown name as *"this graph
doesn't make that call"* — so a typo is indistinguishable from an absence, and
that call is never traced, anywhere, forever, without erroring. The check lifts
its expected set **out of the body fetched from n8n** rather than restating it,
because a local copy would share the typo and compare equal.

---

## 7. The defect that keeps coming back: a gate that cannot fire looks exactly like a gate being careful

This is the most transferable finding in the project, and it has now been paid
for at least six times.

- **UC-03's supported-countries gate compared 2-letter destination codes against
  a list built from the alpha-3 `code` field.** `ES` never matched `ESP`. After a
  *successful* 224-row fetch, `supportedCountries` was `[]` and **the use case
  could not auto-resolve at all**. Every fail-closed test passed throughout.
- **UC-03's sanctions gate**: `SANCTIONED_OR_RESTRICTED` held ten codes and not
  one appeared in `KNOWN_COUNTRIES`, the only thing that turns a country *name*
  into a code. *"I'm travelling to Iran"* came back `escalate /
  destination_unknown` — the right decision under a reason that sends a
  specialist to look the country up instead of stopping. Every sanctions test
  handed `evaluate()` a ready-made classification already carrying
  `destinationCountry: "IR"`, which proves the gate works and says nothing about
  whether anything can reach it.
- **UC-06's payroll gate called `/v1/company-payroll-runs`, a URL Remote has
  never served** — the doc *title* had been read as the path. Dead on both
  execution paths while looking cautious.
- **UC-04's day-count function returned `NaN`** on an unreadable date.
  `Math.max(NaN, winStart)` is `NaN`, the `end < start` guard never tripped
  (`NaN < NaN` is false), and `NaN` loses **both** `> 90` and `> 183`. A 123-day
  Spanish stay plus one blank end date came back `riskLevel: low`, reasons `[]`.
  Worse, `NaN` serialises to `null` through JSON, so the durable row read *"not
  computed"* rather than *"computed wrong"*, while `periodsCounted` still said 2.

The unifying property: **refusing correctly and being unable to succeed are
indistinguishable from outside.** No amount of negative testing separates them.
Only a **positive** test — *"this known-good input MUST auto-resolve"* — does.

Two structural answers now exist, and both are load-bearing:

1. **`docs/DEMO-COUNTRIES.md`** — 77 scenarios across all nine use cases run
   against the **live** Sandbox, every row carrying an **observed** column rather
   than an expected one, and **every use case carrying at least one scenario
   whose expected outcome is a success**. Nine of the 77 disagreed with their
   prediction. That is the document working, not failing. It is not a test and
   must never be imported by `npm test` — it reaches the network on purpose.
2. **Derive the lookup from the set.** UC-03's dictionary is now derived *from*
   `SANCTIONED_OR_RESTRICTED`, so a code added with no name written for it
   **throws at module load** rather than becoming silently unresolvable.

---

## 8. Fixtures that agree with the code instead of with the API

The root cause underneath several of the above: **fixtures were written to agree
with the code, and the code with the fixtures, so neither was ever compared to
Remote.**

`58bad0a` captured every endpoint this project reads from the live Sandbox and
corrected six divergences. The two that cost most:

- The mock's employment route served `{data: <record>}` where the real API nests
  under `data.employment` — so **no test ever drove the nested normalization path
  that production always takes**.
- The mock matched on the id alone and ignored everything after it, so **every
  invented sub-resource answered `200` with the whole record.**

If you add a mock route, capture it from the Sandbox. A mock that teaches the
wrong shape is worse than no mock, because it makes a whole test suite agree with
you.

Related, and a trap with three different disguises: **Remote's API wants alpha-3
on a path and alpha-2 in comparisons, and no two alpha-3 failures look alike.**
`/v1/expenses/categories?country_code=NLD` → 200; the alpha-2 form → `422
{"country_code":["is invalid"]}`; the form-schema endpoint answers `404 "Country
not found"` for the same underlying mistake. `[CONFIRMED]` This is why
`1c7d6d0` replaced eight free-text country boxes with pickers whose option
*value* is the alpha-2 code the gates compare.

---

## 9. Ordering: durable before outward, always

`src/uc01/workflow.js` audits at STEP 7 and touches Zendesk at STEP 8. The n8n
graph originally had `Append Audit Log` **downstream** of all four Zendesk nodes,
which meant two things:

1. A Zendesk failure **erased the audit row for a decision that had genuinely
   been made** (execution `18` is exactly that — an `escalate` lost to a 404).
2. On `auto_resolve` the automation replied to and solved a real customer ticket
   *before* anything was durably recorded.

The active order is now
`Identity + Policy Gates → Claim → Carry Context After Claim → Append Audit Log →
Carry Context Forward → Route by Decision`. `Carry Context Forward` exists
because the Supabase node emits its own insert response rather than the decision
context.

The generalisation, and it is why several red runs count as proof: **read node
status, never run status.** UC-01's executions `3574`/`3577` are marked `error`
in n8n because the final Zendesk write failed on a stale credential — *downstream
of the audit write*, which is precisely the ordering the architecture exists to
guarantee. A pinned green run proves nothing; those red runs proved almost
everything.

Corollary, from the fan-out gotcha in §6: **never place a must-not-lose write
downstream of a branch that can fail.**

---

## 10. Two things that read as drift and are not

Before you "fix" either of these, read this section and then
[`CLAUDE.md`](../CLAUDE.md) §6.

**UC-04, UC-05 and UC-06 point at `your-sandbox-standin.vercel.app` while the
other six point at `gateway.remote-sandbox.com`.** The odd-three-out pattern
reads exactly like drift. The stand-in (`src/remotebridge/`) is a **read-only**
proxy to the real gateway: it forwards the caller's `Authorization` untouched,
refuses writes with 405, 502s on upstream failure, and fills **only fields the
real Sandbox left null**, naming every one it touched in an `X-Standin-Enriched`
header. UC-04 needs `custom_fields.workation_permission`; UC-05 needs
`basic_information.start_date`; the raw Sandbox returns `undefined` for both. On
gateway data UC-04 would block **every** request with
`employer_permission_not_granted`, and UC-05's tenure arithmetic would have no
start date. UC-06's is a different absence — not an empty field but an empty
*period*: the Sandbox's payroll calendar stops in the past, so
`evaluateCutoff()` finds no cycle covering any future effective date and UC-06
escalates `noMatchingCycle` for every amendment anyone will ever submit. A real
cycle is never touched and always wins; projected ids begin `standin-`; and
`total_payroll_cost` stays null because **inventing money is the one thing
forbidden outright.**

*This was nearly deployed as a fix.* The host difference was diagnosed as the
cause of a 404 that was really a **dead employment id** — a 404 that reproduces
identically through both hosts, which is what makes the wrong diagnosis so easy
to believe. **Test the id against both hosts before blaming either one.**

**Every UC API binds two sockets** — its documented API port and an undocumented
mock-Remote server it seeds from. That second port appears in no README and no
URL, so each file picked its own and claimed in a comment to be distinct from
every other mock port. Three of those comments were wrong the same way: checked
against the other *mocks*, never against the *API* ports. `test/ports.test.js`
now enforces uniqueness and the reserved `4070–4089` band, because **a comment
asserting global uniqueness cannot be checked and a test can.**

---

## 11. Optional integrations degrade; reads that feed a dashboard throw

`AuditLogger`, `CaseStore`, the treaty retriever and every `ucNN` store follow
one pattern: in-memory first, optional `pgPool`, safe default when unconfigured.
That is what lets a fresh clone run `npm test` and every demo with no
credentials at all.

The asymmetry inside it is deliberate: **background writes swallow errors; reads
that feed a dashboard throw.** A wrong number gets acted on; a missing one gets
investigated.

The same discriminator decides security posture, and it is an **OR** rather than
an AND: signed approver identity is required when **a durable store is attached
OR the deployment is publicly reachable**. Without that OR, this URL would have
accepted a payroll approval from anyone who could set a header during exactly the
window when it was live but the database not yet attached. The platform check can
add a requirement and can never remove one.

**Required-but-unconfigured fails loudly and by its own name.**
`approver_entitlement_not_configured` is deliberately *not*
`approver_not_entitled` — those are two different afternoons of work for whoever
reads the log. For two days every approve on the public deployment returned the
first of those; `APPROVER_ROLES` is now set and `/__cx/health` reads
`approverEntitlementSource: "APPROVER_ROLES"`. `[CONFIRMED] 2026-08-20`

---

## 12. The reader is not the builder — and "the information was correct" is why this one kept coming back

**The defect.** The project owner gave the same correction three times, about
three different screens, over several weeks:

> *"All your Zendesk bars are made for the person building, not the person using
> it."* · *"We are supposed to implement it, not tell Remote how they do their
> thing."* · *"This info is useless to the user. Stop littering info all over the
> UI that is useless to my user."*

Three times it was fixed and three times it came back, because **each fix was
mistaken for done.** The instance was corrected; the rule stayed in the
conversation. `27d4b51`'s own commit message: *"Each time the instance was fixed
and the rule was not written down, so the next pass started from zero."*

**Why the usual defences did not catch it.** Every removed passage was **true,
sourced and correct**. `FILE_IT_IN_REMOTE`'s four-step procedure cited Remote's
own words and the status enum, tagged `[CONFIRMED — schema]`. The nationality
note named the endpoint, the schema and the occurrence count it had checked. The
pop-up sentence *"An AI language model read your request in your own words"* was
an accurate statement of invariant 8's `classification.source`. This
repository's whole review reflex — *is it accurate? is it cited? does it
overstate?* — passes all three. **Accuracy was never the property being
violated. Relevance to the reader was, and nothing was checking it.**

That is what makes this a §7-shaped defect rather than a taste dispute: a
correct fact on the wrong screen and a correct fact on the right screen look
identical to every test in the suite, exactly as a gate that cannot fire looks
identical to a gate being careful.

**The rule, and where it now lives.** A fact earns its place on a surface by
answering a question **that surface's reader** has. Being true is not the
qualification. The full version — every surface in this repo, who reads it, the
short list of questions each reader actually has, the three corrections as
worked examples with their before/after strings, and the classes that are
**exempt** from the rule — is [`UI-AUDIENCES.md`](UI-AUDIENCES.md).

**The half that is easy to get wrong in the other direction.** An over-zealous
reading of "delete what the reader cannot act on" is more destructive than the
litter. Statements of a **limit or an absence** — *"it is never compared to the
Remote employment record, so a wrong country here is not caught anywhere"* — add
no value by any usual reading and are the only thing standing between a
specialist and false completeness. So are the mandatory disclaimers
(`src/shared/disclaimer.js`), the named team a case was routed to
(`src/shared/escalationRouting.js`: *"an escalation that nobody owns is a slower
way of dropping the case"*), and the audit slug a reader would cite afterwards.
**Deleting one of those to tidy a screen is a worse defect than the row it
removed.** The safe compression is to move the *evidence* into the comment beside
the code and keep the *claim* on the page.

**And the interesting case is almost never deletion.** `describeReader()`
(`src/portal/server.js`) is the pattern: the same fact is **silent** for the
requester, because they can do nothing with it, and **still printed** for the
specialist, who is deciding whether to trust an extracted destination — computed
in one function, so the two wordings cannot drift. One fact, two audiences,
**routed rather than deleted**.

**The structural trap this leaves behind.** The portal's `details` array is
rendered *both* on the employee's result page (`src/portal/assets/app.js`) *and*
in the body of the Zendesk ticket a specialist opens (`buildTicketNote()`,
`src/portal/server.js`). One array, two readers, no compile error in either
direction: applying the rule for the employee silently strips a fact the
specialist needed, and adding one for the specialist silently litters the
employee's page. The only routing that exists today is `OPS_ONLY_DETAILS` and
`LEAD_DETAIL`, selected by label string. `[CONFIRMED]` `UI-AUDIENCES.md` §6.

---

## 13. A negative about someone else's API is a claim, and it decays like one

Every principle in this file is taught through a defect this repository shipped.
This one was shipped in a **document**, and it is the most expensive kind,
because documents are what the next engineer builds on without re-checking.

`docs/00-FOUNDATION.md` stated twice that UC-05's resignation endpoint does not
exist. `docs/use-cases/UC-05.md`'s header repeated it in the first person and
made it the use case's defining property: *"Read + compute + inform, never write.
This is a **structural consequence of the API's shape, not a policy choice**."*
Six layers of implementation then cited that as the reason for their own shape —
`workflow.js`'s "THERE IS NO EXECUTION WRITE", `resignationStore.js`'s deliberate
absence of a `markExecuted()`, `server.js`'s "NO REMOTE WRITE ROUTE — BY DESIGN",
and a structural test whose assertion message says *"the spec confirms no such
write endpoint exists."*

**All three endpoints exist**, in Remote's own `llms.txt`. One of them is
`PUT /v1/resignations/{offboarding_request_id}/validate`, whose request body is
shaped almost exactly like this use case's own sign-off form.

Three things are worth extracting, and only the first is about UC-05.

**A negative is harder to establish than a positive, and nothing in the tagging
scheme said so.** `[CONFIRMED]` on *"this endpoint returns X"* means somebody saw
a response. `[CONFIRMED]` on *"this endpoint does not exist"* means somebody saw
a **failure**, and a failure has many more causes than a success does. The likely
mechanism here is recorded elsewhere in this repository three separate times: the
real path is keyed by **`offboarding_request_id`**, the raw docs wrote
`/v1/resignations/{id}`, and a probe with a wrong id — or a token lacking
`resignation:read` — returns a `404` or a `403` **indistinguishable from an
absent route**. `CLAUDE.md` §6 says the same thing about a dead employment id
(*"a 404 that looks like a credential, host, or permission problem and is none of
them"*), §7 says it about a `403 "invalid role"` that named the credential and
was an endpoint problem, and §4 says it about a proxy `403` that named the wrong
layer entirely.

**The one example that was written down is the one that held.** The same
sentence in `00-FOUNDATION.md` named three endpoints as non-existent. Exactly one
of them — UC-06's `automatable` pre-check — has its probe recorded in
`src/remote/restClient.js`, with both the `200` and the `422` body. That one was
right. The two that were asserted without a written-down probe are now one-for-one
wrong. **Recording the probe is not paperwork; it is the difference between a
finding and a recollection.**

**And the rule the sentence was making was correct the whole time.** It said
*prefer the fresh check over the inherited confidence label* — good advice,
resting on a list of three examples of which two were wrong. A true rule
discredited by its own evidence is worse than no rule, because the next reader
discards both. The correction kept the rule and replaced the evidence.

### The corollary: a clamp is a negative too

The same pass found `tenureMonthsBetween()` ending `return Math.max(0, months)`.
A start date in the future produces a negative month count, which the clamp turns
into **zero** — and zero months selects the *shortest* statutory notice bracket,
producing a confident, signable figure indistinguishable from a genuine day-one
employee's. Remote, it turns out, models a resignation before the start date as a
**different object entirely**, whose employer form is one boolean and which
involves no notice arithmetic at all.

That is the same shape as §7's dead gates, rotated: a clamp does not refuse an
impossible input, it **converts it into a plausible one and destroys the
evidence**. This use case already had two findings of exactly this kind —
`Math.max(0, −8 − 0)` turning a negative leave balance into a computable `$0.00`
settlement with `computable: true` and a live sign-off button, and
`Math.max(0, 10 − (−5))` turning a negative `daysUsed` into a 15-day payout from
a 10-day accrual. Three instances, one function family, one habit.

**The rule:** `Math.max(0, x)` is correct when zero is a real answer, and a bug
when zero is merely the nearest lawful-looking one. If you cannot say what the
zero *means*, refuse instead.

## 14. The substitution ladder — where a fact is allowed to come from

§13 says a negative about someone else's API decays. This section says what to do
about it, and it is the rule that governs every fixture, stand-in and mock in this
repository.

**It was stated by the project owner on 2026-08-21**, and the reason it is written
down is that the repository had been *following* it for weeks without it existing
as a rule — so every new instance got re-argued from scratch, and one of them
(`src/remotebridge/payrollProjection.js`) needed an explicit instruction before it
was allowed to exist at all.

**Four rungs. Always take the highest one that can answer the question.**

| | Rung | Source | Where you'll meet it |
|---|---|---|---|
| 1 | **Remote's own documentation is the source of truth** | `developer.remote.com`, its OpenAPI, its `.md` pages | Field names, enums, required lists, verbs, status machines |
| 2 | **Where the Sandbox holds relevant data, use it** | `gateway.remote-sandbox.com` | Employment records, countries, real payroll cycles, live schema fetches |
| 3 | **Where the Sandbox refuses or lacks the capability, replicate it in our own stand-in** | `src/remoteui/`, `src/remotebridge/`, `src/remote/mockServer.js` | A resignation the partner API cannot create (UC-05); a work-authorization request with no `POST` (UC-04); an employment field the Sandbox left null |
| 4 | **Where no relevant data exists at all, fabricate** | A named, marked fixture | A payroll cycle past the calendar's end (UC-06); an `automatable: true` response never captured live |

**Rung 1 is never overridden by a lower rung**, and this is not hypothetical.
Live, `work_hours_per_week: "24"` is a value Remote **stores** on some records and
**refuses** on submission. A Sandbox record carrying a quoted number does not make
the field a string; it makes that record a thing to handle, not a shape to copy.

### The two constraints that make rungs 3 and 4 safe

Neither is negotiable, and both are already implemented — the rule was reverse-
engineered from code that was doing it right.

**1. A substituted fact is always self-identifying.** A projected payroll cycle's
id begins `standin-` and carries `_standin {projected, derivedFrom, cadence}`. An
enriched field is named in an `X-Standin-Enriched` header *and* a `_standin` body
block. The audit row carries `cutoffCycleProjected` as its own boolean, and
`src/uc06/workflow.js`'s comment says exactly why: recording only `cutoffCycle: id`
left an auditor unable to tell a real cycle from a projected one *without knowing
an undocumented id-prefix convention*. **Nothing fabricated may reach a reader
looking like something Remote said.**

**2. Money is never fabricated.** `total_payroll_cost` and `approval_date` stay
`null` on a projected cycle for exactly this reason. A **cadence** can be
continued; an **amount** cannot be invented. This is the one rung-4 prohibition
with no exception, and it is why the projection is defensible at all: it continues
a pattern the Sandbox itself established and refuses to supply the one thing a
pattern cannot imply.

**And a third, about honesty rather than safety: a real value always wins.** Rung
3 may fill only what rung 2 left empty; rung 4 only what rung 3 cannot reach.
`enrichment.js` fills **only** fields the real Sandbox returned as null;
`payrollProjection.js` never touches a real cycle, and never continues a one-off,
because a one-off is not a cadence.

### What it does not authorise

It is not permission to skip rung 1. A fabricated fixture must still reproduce a
shape Remote's documentation **describes**, even when no response has ever been
captured. UC-06's `automatable: true` fixture is
`{"data":{"automatable":true,"message":…}}` because that is the documented
envelope — not because it is convenient.

And it does not cover claims about **people**. A fabricated approver identity is
not a fact about Remote's platform; the ladder has nothing to say about it, and
the answer is to name the requirement and let a human supply the identity.

### The failure it exists to prevent

Three times this repository recorded a Sandbox limitation as a fact about Remote's
platform. All three were in **one sentence** in `docs/00-FOUNDATION.md` — UC-05's
resignation endpoint, UC-06's `automatable` pre-check, UC-07's atomic
country-transfer endpoint, *"all don't exist"*. **Two of the three demonstrably
exist.** The third has never been re-checked.

Worse, and this is the part worth remembering: the pass that corrected two of them
on 2026-08-21 **restated the third more confidently than the original had** — *"the
one that held"* — about an endpoint with a live `200` recorded in this repository's
own `restClient.js`. A correction pass is not immune to the failure it is
correcting.

**A Sandbox that refuses is rung 2 failing, not rung 1 answering.** The ladder
turns substitution into a routine, marked, auditable act instead of an exception
somebody has to justify one instance at a time — which is what it had been.

**Repeated, not cross-referenced.** This text appears in `CLAUDE.md` §3 directive
6, `docs/00-FOUNDATION.md` §2a and `qa/contracts/UC-06-acceptance.md` §18a as well
as here. That is deliberate: a rule that lives in one file is a rule the next
session does not find, and this repository has the scar tissue to prove it.

---

## 15. A control that exempts itself does it in a comment

Every control in this repository is argued somewhere. The question this section
answers is *where*, and the answer is not "wherever the author was working."

`docs/adr/0005-dual-control-segregation-of-duties.md` exists to argue one thing:
that sensitive actions need **"two independent people to jointly authorize"** them.
It is the document a reviewer opens to audit the control. UC-01 implements it as
`self_approval` (`src/review/reviewPolicy.js`). UC-09 implements it in its
strongest form — requester ≠ approver ≠ payment_releaser.

**UC-06 does not, and the exemption is stated in
`src/uc06/dualApprovalPolicy.js:13–29`:**

> *"Unlike UC-01's segregation-of-duties rule ('the requester of a case may not
> approve it'), the admin here IS expected to be one of the two approvers."*

That is a real argument, made in good faith, with a reason attached. It is also
**in the file that implements the control, which is the last place an auditor
looks and the first place its author was already reading.** `requester` is
captured (`src/uc06/workflow.js:241`) and persisted — it has its own column — and
never compared to anything. So the person who typed the new salary can sign the
box confirming they typed it, and slot 1 can never disagree with its own author.

### Why no review caught it

Three properties of this defect are worth internalising, because they generalise.

**It is invisible to a diff.** Nothing is missing from
`dualApprovalPolicy.js`. `role_already_approved`, `same_person_cannot_fill_both_roles`
— canonicalised via `isSameApprover()`, after an exact-match check was walked past
with a trailing space and a capital letter — and `entitlement.check()` consulted
last and able only ever to refuse are all present and all correct. The file reads
as thorough, because it *is* thorough about everything it decided to be thorough
about.

**It is invisible to the tests.** They cover the same-identity and role-reuse
refusals well. A test that submits as one identity and approves as the same
identity in slot 1 would **pass** — it is permitted behaviour.

**It is invisible to a reader of the ADR**, who finds "two independent people",
finds UC-01 and UC-09 both holding the rule, and has no reason to open a third
file's header to discover the third one opted out.

### The rule

**A scoping decision about a control belongs in the document that argues the
control, not in the file that implements it.** If you find yourself writing
"unlike UC-0X, here we…" in a source comment, that sentence is an ADR amendment
wearing a comment's clothes. Write it in the ADR *and* leave the comment — the
comment is where the next person editing the code will look, and the ADR is where
the next person auditing it will.

**The corollary, which is what actually cost the time here:** the vocabulary a
control uses must be checked against what it *means*. `UC-06.md` §5 says
*"Customer Admin approve → Payroll specialist approve"*, and that is true — but it
does not say *the requesting* admin. And "customer admin" is **employer-side**;
"customer" means Remote's customer, which `UC-06.md:53` gives away only by
contrast (*"Customer Admin + **Remote** Payroll specialist"*, where only the second
is qualified). Two different readings of one phrase — a **role** on the employer
side, or **the specific person who filed** — produce two different controls, and
the repository held both at once: the ADR argued the first, the code implemented
the second.

Fixed by naming the signatory in **Remote's own vocabulary** rather than ours:
`awaiting_employer_signature` / `employer_signed_at`, a person
`src/remoteui/roles.js:24` had already modelled as *"distinct from the admin USER
who operates the console"* — in a different file, for a different surface, months
earlier. The distinction existed in the repository the whole time. It just never
reached the gate.

`qa/contracts/UC-06-acceptance.md` DRIFT-098, `[A-1]`…`[A-3]`.

---

## 16. Two rules kept by one mechanism, and only one of them is the invariant

**The defect:** UC-07 is a 🔴 use case with no execution path — by construction,
not by policy. `handleRelocationReview()` takes no write-capable client, the store
has one write method and zero mutations, and `src/uc07/server.js` has no POST
route in the file at all. All of that is correct and none of it should change.

**What was also true, and was not a control:** a portal-submitted dossier reached
**nobody**. No ticket, no group, no queue entry, no notification. `uc07_dossiers`
has no status column, so `awaitingState()` answered `awaiting / reading` **in
perpetuity** — a dossier could never leave the waiting list by any means the
system possessed. And the employee who filed got one acknowledgement at
submission and then silence, permanently.

> **"Nothing may be approved here" and "nobody may ever be told what happened"
> are two different rules. Only the first is the 🔴 invariant.**

They were being satisfied by the **same mechanism** — the absence of a write path
— which is why every attempt to close the second looks like weakening the first,
and why it survived four passes over this use case.

**One file already knew.** `src/approvalqueue/stuck.js:43-48` is the only place in
the repository that states the distinction, and it states it exactly: *"a UC-07
dossier sitting in Mobility Legal's queue is NOT on this list, and one with no
ticket IS — under `no_ticket`, with a `why` that says plainly that the missing
thing is the hand-off and not a control."* That sentence was written months
before anyone acted on it. **A correct observation in one module does not
propagate**; it has to be lifted into the document that argues the design, which
is what §15 says about UC-06's exemption and is the same failure twice.

### Why nothing automatic could catch it

This is the hardest class in this document, and it is worth being precise about
why:

- **Invisible to a diff.** Nothing is *missing* from any file. There is no
  half-written hand-off, no TODO, no dead branch.
- **Invisible to the tests.** A test asserting "a portal dossier reaches nobody"
  would **pass**. The behaviour is not a bug in the code; it is the code working.
- **Invisible to a reviewer checking the invariant.** The invariant is *satisfied*.
  Someone auditing the 🔴 guarantee finds it intact and stops, because the
  guarantee is what they came to check.
- **Invisible to the metrics.** `docs/METRICS.md:226` records that UC-07 has no
  defined dossier metric — and the *reason* is the same missing status column, so
  the measurement layer cannot report the gap that disabled it.

What found it was a person reading the description and asking whether it made
sense: *"when the specialist reaches a conclusion, what will they now do? Nothing?
… the employee who filed is expecting feedback."* **Two consecutive decision
passes have now found their sharpest finding exactly this way** (this one, and
DRIFT-098 in the pass before). That is not a coincidence and it is not a
compliment to the questioner: it is a statement about what automated checking can
and cannot reach. **A test can tell you the code does what it says. It cannot tell
you that the thing it says is the whole of what was needed.**

### The shape that resolves it — and the shape that would have broken it

The tempting fix is `dossierStore.markReviewed()`. **It is wrong**, and wrong in
an instructive way: the store's *one write method, zero mutation methods* property
**is** the structural proof, so adding a mutation would delete the proof in order
to record that the proof worked.

Three properties, and the second is the load-bearing one:

1. **The specialist records an OUTCOME, not a DECISION** — `dossier_read`, then
   one of `proceeding_offline` / `not_proceeding` / `more_information_needed`.
   None of them executes anything. The relocation is still performed by a human in
   Remote's own product, step by step.
2. **The outcome lives on the TICKET, not on the record.** A ticket may be
   **raised** without being **linked**: the dossier does not need to know the
   ticket id for the ticket to carry the dossier id, so **the id travels one way**
   and the store's write surface is untouched.
3. **The requester is told**, in wording that never borrows approval vocabulary —
   because a requester who reads "approved" will act on it, and nothing was
   approved.

### The generalisation

When you find a rule being kept, ask **which rule**, and whether one mechanism is
quietly keeping two. If it is, the weaker one is usually being kept **by
accident**, and the accident is doing work nobody agreed to. The test:
*if I close the second rule, does the first one break?* If the answer is no — as
it is here, since `none_by_design` is unchanged and no approve route is added —
then they were never one rule, and the conflation was costing something.

**The same question applied elsewhere in this repository:** UC-08's store has the
identical shape and the identical silence (`H4` in
`qa/HUMAN-DECISIONS-REQUIRED.md`, undecided on purpose); and
`docs/APPROVAL-QUEUE.md`'s `none_by_design` versus `none_missing` distinction
exists precisely because two states that both render as "no approve button" mean
opposite things. **That distinction was drawn correctly at the queue and not at
the hand-off** — the same idea, one layer apart, one of them noticed.

---

## 17. A source named in a specification is a claim about someone else's API, and it decays exactly like a negative one

§13 teaches that **a negative about someone else's API decays** — `00-FOUNDATION.md`
declared three endpoints absent in one sentence, and two of the three turned out to
exist. This is the **positive** form of the same defect, and the repository paid
for it in a place nobody was looking.

**The defect.** `docs/use-cases/UC-08.md` §5 has said, since the spec was written:

> *"deterministic: compute historical physical-presence days (**time-off +
> workation custom fields**)"*

§3 carried the same source as
`[CONFIRMED — capability exists; specific endpoint shape not yet verified]`, and
§13 task 4 turned it into a build task: *"Presence-day calculator (custom fields +
time-off)."* Four review passes read those lines. `qa/`'s DRIFT-039 was written
about the gap between them and the code. **Nobody read the schemas.**

When somebody did, on 2026-08-21, both halves failed:

- **`Timeoff`** carries `id, employment_id, status, start_date, end_date,
  timeoff_days, total_minutes, timeoff_type, leave_policy, timezone` — **no
  country property, no location property.** `timezone` is an IANA identifier whose
  own example is `Etc/UTC`: a clock, and in that example not even a place.
- **The sign is wrong too.** A workation is someone *working*, so it generates
  **no time-off record at all**. Time off records when a person was not working.
  It never records where they were.
- **Custom fields** are `{custom_field_id, name, type, value}` — one value per
  field per employment, **no dates**. A trip history cannot be represented in it.

So §13 task 4 was a **standing work order to build something impossible**, and the
build's structured-input approach — which DRIFT-039 reads as a shortfall — was
right the whole time, for a reason nobody had written down.

**And the source that does work was three lines away in the same file.**
`GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests`, both
filterable by `employment_id`, both carrying `destination_country`,
`travel_date_start`, `travel_date_end` and `status`: dated, located,
employer-approved. `src/remote/restClient.js:1597` already implements one of them.
The mock already serves both. `src/uc03/letterScope.js:20` already cites the
travel-letter reference by name.

### Why the search had never found it

Because it was looking for **the names the spec supplied** — *time-off*,
*custom fields* — rather than for the question underneath them: *which Remote
object records where somebody was, and when?* The right records were filed under a
different heading, and a search keyed on the wrong noun returns nothing with
complete confidence.

### The rule

**Write down where a fact will come from, and then check that the source can carry
it — before anything is built on the sentence.** Specifically:

1. **A named source is a claim, not a design decision.** `[CONFIRMED — capability
   exists; specific endpoint shape not yet verified]` is an honest tag and it is
   **where the check should start**, not a licence to build on it. The unverified
   half is the whole claim.
2. **"Capability exists" and "this object carries this field" are different
   assertions.** Remote does hold time-off data. The inference that it therefore
   holds *presence* data was never made explicit and never checked, and it is
   false.
3. **Search by the fact, not by the vocabulary.** *"Which object records where
   somebody was, and when"* finds the travel-letter collection. *"Time-off
   endpoint"* does not.
4. **A finding can be right about a gap and wrong about the remedy.** DRIFT-039
   correctly identified that the count is self-declared, and then deferred to a
   source that cannot produce it, because it inherited §5's claim exactly as every
   earlier reader had. **Check the remedy's source, not only the defect.**

### The version of this that is easy to miss

The second half of the rule has produced two findings in two passes, and both came
from reading a **remedy's** material rather than the code the remedy would fix.
**DRIFT-104**: before designing UC-07's Sandbox fallback, somebody read
`scripts/capture-sandbox.mjs` to see what already existed — and found that this
repository's single stated cure for its own most expensive defect class
(fixtures agreeing with code) writes to a **gitignored** directory, so it had never
produced a durable artifact. **DRIFT-106/107**: before wiring DRIFT-039's remedy,
somebody read the schema of the source it named.

Neither finding was reachable by reading the code under discussion. Both were one
file away, in the thing that was about to be relied on.

### What it costs when it slips

Nothing today — that is what makes it hard to see. No test fails, because nothing
is built on the sentence. The cost is entirely in the future: a session follows the
roadmap, spends its time discovering that task 4 cannot be built, and either
records the impossibility as a limitation of Remote's platform — the exact
over-reach §13 exists to prevent — or works around it with something worse. The
gap between *writing a source down* and *checking it* was, in this case, several
months.

---

## 18. A correction can propagate a false claim, and that is the hardest kind to catch

**The defect.** On 2026-08-21 a reconciliation pass found that UC-06's
dual-control gate let the person who *requested* an amendment also *approve* it,
and that the exemption had been argued in a code comment rather than in the ADR
that exists to record such decisions. The fix was correct: `docs/adr/0005` gained
the clause it had always assumed — **the requester may not fill either approval
slot** — naming the use cases that hold it and the one that did not.

The clause read, in part:

> *"UC-01 holds this (`self_approval`, `src/review/reviewPolicy.js`) and **UC-09
> holds it in its strongest form (requester ≠ approver ≠ payment_releaser,
> `src/uc09/multiApprovalPolicy.js`)**. UC-06 did not…"*

**UC-09 did not hold it.** `multiApprovalPolicy.js` compares the three approval
**slots** to each other and never compares any of them to
`adjustmentRow.requester`, the column recording who filed the request. So on the
one use case in the nine that moves real money, the person who asked to be paid
could sign the box approving it — and the document an auditor opens to check
exactly that told them, in the strongest available words, that there was nothing
to find.

**Why this is worse than the original gap.** The gap (DRIFT-050) had been on the
register since the first reconciliation pass; it was known, written down and
queued. What the correction added was an **assurance**. A gap is something a
careful reader can still discover. A gap plus a written statement that there is
no gap **redirects** the careful reader — and it does so through the highest-trust
artefact available, citing the exact file where the reader would go to confirm.
That is why the ADR's correction is queued *ahead of* the code change that would
make its sentence true.

**Why it happened, which is the part worth generalising.** A pass that fixes one
instance of a defect naturally reaches for the other instances as examples —
*"UC-01 holds this, UC-09 holds this, UC-06 did not"* — because naming who *does*
hold a rule is what makes the exception legible. And the other instances get
stated **from memory rather than from the file**, because they are not the
subject of the pass. UC-06 was verified exhaustively. UC-09 was asserted, and
asserted confidently, **because it looked stricter**: it has three slots where
UC-06 has two, an explicit `isSameApprover()` loop, an unwaivable floor and a
320-input grid asserting it. Every one of those is real. None of them is the
control being claimed.

**The trap is structural, not careless.** In a correction, everything around the
false claim was *just checked*. The reviewer's attention is on the fix, the
evidence for the fix is fresh and strong, and the surrounding sentences inherit
its credibility. This is the same shape as §12's finding that *accuracy was never
the property being violated* — here, four of the clause's five assertions were
accurate, and the fifth travelled on their back.

**What this repository does about it.**

- **A pass may disposition only the use case it is reading.** Where it needs to
  name another's state, it names it as a claim with a citation, and the citation
  is checked — or the sentence says *"not verified in this pass"*, which is a
  legitimate thing for a document to say and costs nothing.
- **The strongest form of a claim gets the strongest check.** *"Holds it in its
  strongest form"* is a statement it takes one grep to falsify. Superlatives in a
  control document are where verification is cheapest and most valuable.
- **Correcting a document is its own reviewed unit of work**, with the same
  discipline as changing a gate — the rule `docs/knowledge/`'s corpus already
  applies to statutory findings, applied to our own records.
- **When the claim and the code disagree, the document is corrected first.** The
  code change can wait for a queue; the false assurance cannot, because it is
  being read now.

**Where it is recorded:** DRIFT-110 in `qa/contracts/UC-09-acceptance.md` §17b;
the struck sentence and the full box in `docs/adr/0005-dual-control-segregation-of-duties.md`;
build items `[P-2]` (the correction, first) and `[P-1]` (the binding).

**The one-line version.** *A pass that fixes one instance of a defect will cite
the others as examples; cite them from the file, or say you did not look.*

## 19. Where the repo and the running system currently disagree

Kept here rather than in a status table because it is the thing an engineer most
needs to know before trusting a reading, and it changes weekly. Authoritative
list: [`CLAUDE.md`](../CLAUDE.md) §7.

- **Two pgvector tables hold zero rows and have since the day they were
  provisioned** — `uc07_mobility_citation_vectors` and
  `uc08_treaty_citation_vectors`. `[CONFIRMED]` by SQL, 2026-08-20. So the
  "embedding-similarity retrieval" in those two use cases runs permanently on its
  keyword leg. The code is right; the running system is not what the row says.
  `docs/RETRIEVAL.md` measured the corpus at **106 passages** and recommends
  *not* seeding them.
- **On UC-09 — the one path that moves real money — the filer is not bound to a
  single approval slot, and ADR 0005 says it is.** The three slots are compared to
  each other; `adjustment_row.requester` is compared to nothing. Decided
  2026-08-21 (reading (A): the filer may sign `requester` and no other) and **not
  yet built**. The ADR's correction is queued **ahead of** the code change, for
  the reason in §18. DRIFT-050, DRIFT-110; `[P-1]`, `[P-2]`.
- **Nothing in `src/uc09/` writes to Zendesk at all**, so every outcome on the
  money path is silent to the person who asked — approved, denied, executed and
  in-doubt alike. Every UC-09 decision *raises* a ticket; none of them ever
  updates it. DRIFT-115; `[P-7]`…`[P-11]`.
- **UC-09 appears nowhere in the metrics layer**, including the integrity
  invariant that justifies its having an execution path at all. If a
  single-approval disbursement ever happened, no dashboard would show it.
  DRIFT-054; `[P-23]`…`[P-27]`, and `[P-24]` must land first because
  `findIntegrityBreaches()`'s premise is false for the one 🔴 with a write.
- **The n8n half of UC-01's live chain is `[UNKNOWN]`, not proven**, after the
  Sandbox reseed killed the employment id every green run used.
  `docs/LIVE-PATH-STATUS.md` §2 names exactly which three links.
- **`src/remoteui/` stands in for an API that now exists.** `POST
  /v1/contract-amendments` and `contract_amendment.submitted` are live
  (`docs/INTAKE-RESEARCH.md` §5.1, verified 2026-08-20), so issue #17 — the
  stated reason the stand-in was built — is stale.
- **UC-08 counts presence days from records a requester typed, while Remote
  publishes the same facts** — `GET /v1/travel-letter-requests` and
  `GET /v1/work-authorization-requests`, dated, located and employer-approved
  (§17, DRIFT-107). The dossier says nothing about which it holds. **Both
  collections were `200` with `total_count: 0`** at last Sandbox capture, so
  wiring the read without a fixture ships a gate that cannot fire.
- **Neither 🔴 use case raises a ticket on the portal path**, so a compiled,
  audited dossier reaches no queue and the requester is told to wait for a
  specialist who was never notified. `src/portal/ticketing.js`'s
  `TICKETABLE_TYPES` omits `uc07` and `uc08` (§16, DRIFT-109). A test of this
  gap **passes**.

---

## 20. If you change one thing, change these with it

- **A gate** → its n8n port, its parity test, a **positive** test proving a
  known-good input still succeeds, `docs/use-cases/UC-0X.md`, and
  `docs/BUILD-LOG.md`.
- **An LLM call site** → add the injectable seam *first*, tag the `source`, wire
  `withRetry()`, and check the suite's total duration afterwards.
- **A stored decision's shape** → the audit row, the sidebar loader, and the
  approval-queue reader, which reads facts out of stores and **re-derives no
  policy**; where a fact is not recorded it says so rather than computing a rival
  answer.
- **A control, or the document recording one** → the ADR, the invariant list in
  the contract's §8, the screen that tells a human the control is there, **and
  every other use case the same document names as holding it**. Check those from
  the file, not from memory — a correction that cites its neighbours as examples
  is exactly where a false claim gets published with a fresh reviewer's
  confidence behind it (§18).
- **A status word, an id or a label you print from a vendor's object** → check
  whether the vendor already publishes the human-readable form. Remote ships
  `type_label` beside `type`; deriving our own word beside theirs is the small
  version of telling them how their product reads (DRIFT-112). And where the
  vendor's own guide and reference disagree about a field's values, and the field
  has no enum, **treat it as an opaque string** rather than picking one list
  (DRIFT-114).
- **A sentence naming where a fact will come from** → open the source's schema
  and check it can carry the fact, **before** anything is built on the sentence.
  *"Capability exists"* and *"this object carries this field"* are different
  assertions, and the second is the one that matters (§17). Search by the fact —
  *which object records where somebody was, and when* — not by the vocabulary the
  spec happened to use.
- **A remedy you are about to rely on** → read its material too, not only the
  code it will fix. Two findings in two passes came from exactly that and were
  reachable no other way (§17).
- **A claim that an endpoint does not exist** → re-fetch the authority, record
  the probe **with its failure body**, and check whether you used the key the
  resource is actually addressed by. A `403` is a scope answer and a `404` on a
  wrong id is an id answer; neither is an answer about the route (§13). Then grep
  for the claim — the last one was inherited by six files.
- **A `Math.max(0, x)`** → say out loud what the zero means. If it is a real
  answer, keep it; if it is the nearest lawful-looking one, refuse instead (§13).
- **A reader-facing row, label or sentence** → name the surface, name its reader,
  and point at the question it answers ([`UI-AUDIENCES.md`](UI-AUDIENCES.md) §2).
  If it lands in the portal's `details` array it reaches **two** readers, so check
  both. And before removing anything, check §5 of that file — a limit, an absence,
  a disclaimer, a routed team or an audit slug stays regardless.
- **Anything deployed** → run the matching verifier and read its exit code, not
  its silence.
- **A status claim in any file** → the code is authoritative over every status
  file, including this one. Two of them have been stale in *opposite* directions
  on the same day. Grep for the thing a line describes before believing it.
