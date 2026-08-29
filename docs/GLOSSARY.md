# GLOSSARY

Every term you will hit reading this repository, in plain language — with a
note on why each one matters *here*, not just what it means in general.

Alphabetical within sections. If a term you need is missing, the two best
places to look next are [`ARCHITECTURE.md`](ARCHITECTURE.md) and the header
comment of the file the term appears in — every non-obvious file in `src/`
opens with a "WHY THIS EXISTS" block.

---

## The business domain

### EOR — Employer of Record
A company that legally employs people on another company's behalf, in
countries where that other company has no legal entity. If a Berlin startup
wants to hire an engineer in Brazil, it asks an EOR to be that engineer's
legal employer: the EOR issues the contract, runs payroll, withholds tax,
handles benefits and carries the compliance risk.

**Why it matters here:** it explains why the support requests in this repo
are so varied and so consequential. An EOR handles employment paperwork in
dozens of legal systems at once, so "issue a letter" and "change someone's
salary before the payroll cutoff" arrive through the same door despite having
wildly different stakes. That mismatch is the entire reason for the risk-tier
design.

### ISO 3166-1 alpha-2 and alpha-3
Two standard ways of abbreviating a country. **Alpha-2** is the two-letter form
everyone recognises — `ES`, `DE`, `NG`. **Alpha-3** is the three-letter form —
`ESP`, `DEU`, `NGA`. They are the same standard and the same countries, just
two different spellings.

**Why it matters here:** Remote's API returns *both*, in fields whose names do
not make the difference obvious. `alpha_2_code` holds `"ES"`. A field simply
called `code` holds `"ESP"` — the alpha-3 form. Reading `code` when you meant
`alpha_2_code` gets you a value that looks perfectly reasonable and silently
matches nothing, because the thing you compare it against is two letters long.
This repo has had that exact bug twice, and it is written up as finding **F-27**.
There is no `country_code` field on the real API at all, despite this repo's own
mock having invented one.

### `eor_onboarding`
A boolean on each country row from Remote's `/v1/countries` endpoint.
Remote's documentation defines it as *"whether Remote supports EOR onboarding
in this country"* — that is, whether Remote can act as the legal employer
there. 91 of the 224 countries carry `true`.

**Why it matters here:** it is tempting to read it as "is this country
supported?" and gate on it. That would be wrong for travel questions.
*Can Remote employ someone here?* and *may an already-employed person visit
here?* are different questions. Gating travel on `eor_onboarding` would refuse
a French employee travelling to Martinique — which is legally part of France,
so it is domestic travel. See `research/COUNTRY-SUPPORT-SEMANTICS.md`.

### Payroll cutoff
The date each month after which a payroll cycle is locked and no further
changes can be applied to it. Anything submitted after cutoff lands in the
*next* cycle.

**Why it matters here:** UC-06's entire risk lives in one question — can this
contract amendment still make the cycle it is meant to apply to? The answer
is pure date arithmetic (`src/uc06/cutoffEngine.js`), with three outcomes:
well before cutoff (ordinary flow), cutoff already passed (escalate — the
system deliberately does **not** silently roll it into the next cycle), and
within 48 hours (proceed, but flag as urgent). A missed cutoff produces a
support contact and a disproportionate trust cost, because payroll errors
read as platform-integrity problems.

### Presence days
The count of days a person was physically present in a given country within a
given window.

**Why it matters here:** cross-border tax questions turn on this number — the
183-day rule, dual-residency tie-breakers. It is plain date arithmetic
(`src/uc08/presenceCalculator.js`) with no model near it, and the function is
deliberately scoped to compute a *number*, never to conclude anything about
tax residency. Concluding is the specialist's job.

### PE risk — Permanent Establishment risk
The risk that an employee working from another country accidentally creates a
taxable corporate presence for their employer there, exposing the company to
local corporate tax and filing obligations.

**Why it matters here:** it is one of the strongest signals in UC-04's
origin→destination risk matrix. A `pe_risk_dape` flag (dependent-agent PE —
typically an employee with authority to conclude contracts) forces the risk
level to `high`. The matrix is built entirely from five structured factors —
nationality, home country, travel history, visa type, job duties — never from
free-text reasoning, because letting a model be the source of a regulatory
conclusion is exactly what this system is built to prevent.

### Schengen 90/180
The rule that a non-EU national may spend at most 90 days in any rolling
180-day period in the Schengen area.

**Why it matters here:** it is one of UC-04's hard blocks. Note also what the
repo deliberately *doesn't* do: UC-03 was specified twice, once as a thin
router and once as a self-contained compliance engine doing its own Schengen
and 183-day math. The router framing won, precisely so that 🟢-tier code
never owns compliance logic that belongs in a higher tier.

### Statutory notice period
The minimum notice an employee must legally give (or be given) before
employment ends, which varies by country and by length of service.

**Why it matters here:** UC-05 computes it from a curated table of **eleven**
countries, three of which carry a retrieved statute (NL, PT, and the US as a
sourced *absence*).

> ⚠️ **CORRECTED 2026-08-21.** This entry used to say *"a curated nine-country
> table"* and that *"Remote's platform … performs no computation of what the
> legally correct period would be."* **Both are wrong.** The table has eleven
> rows, and Remote's resignation record carries **`days_of_notice`** — *"the
> number of calendar days of notice required based on the contract terms and
> local labor laws."* Remote computes it. UC-05's decided purpose is now the
> **reconciliation**: an independent statute-derived figure held against Remote's
> contract-blended one, with the disagreement surfaced to a human.
> `qa/contracts/UC-05-acceptance.md` DRIFT-063 / DRIFT-095.

The superseded wording, kept because other documents inherited it: Remote's
platform returns the employee's *proposed* last working day but
performs no computation of what the legally correct period would be — that
gap is the value-add. Getting it wrong is a real liability surface even
though nothing is being "terminated."

---

## This system's own vocabulary

### Risk tier
🟢 Low, 🟡 Medium or 🔴 High — assigned per use case, and **not a label**. The
tier selects a different execution path in code: 🟢 validates and acts, 🟡
prepares and waits for a human approval, 🔴 compiles a dossier and escalates
with (for UC-07 and UC-08) no write path existing at all.

**Why it matters here:** it is the spine of the whole design. See
`docs/adr/0001-risk-tier-determines-execution-path.md`. Note also that a tier
can be *raised* at runtime: `src/shared/riskEngine.js` pushes any flagged case
up one tier — low becomes medium, medium becomes high. That is the "when in
doubt, involve a human" default expressed as code.

### Gate
One deterministic check that a request must pass. Gates are *ordered*, and
the first failure wins — so the reason a request was refused is always
specific and always the earliest thing wrong with it.

**Why it matters here:** gates are the system's judgement, and they contain
no AI. UC-01 has six; UC-02 has twelve (identity, employment, ownership,
duplicate, category, itemization, math, currency, policy cap, confidence,
VAT, in that order). Every gate that fails also pushes a *flag*, so the audit
record explains not just what was decided but which check produced it.

### Policy engine
The file that holds a use case's gates: `src/ucNN/policyEngine.js`. A pure
function over plain objects — no database, no network, no clock, no model.

**Why it matters here:** because it is pure, the entire decision surface is
testable with object literals and no infrastructure. It is also the answer to
"where is the business logic?" — there is exactly one place per use case, and
it imports nothing that could make a network call.

### Decision
The output of a policy engine. The vocabulary differs per use case, honestly
rather than uniformly:

| Use case | Possible decisions |
|---|---|
| UC-01 | `auto_resolve`, `human_review`, `escalate`, `out_of_scope` |
| UC-02 | `auto_approve`, `human_review`, `blocked`, `escalate` |
| UC-03 | `auto_resolve`, `human_review`, `escalate`, `route_to_uc04` |
| UC-04 | `ready_for_approval`, `blocked`, `escalate` |
| UC-05 | `prepared_for_signoff`, `escalate` |
| UC-06 | `dual_approval_required`, `escalate` |
| UC-07 | `escalate` — and nothing else. ⚠️ **DRIFT-102 (2026-08-21):** the word is currently doing two jobs — a **duplicate delivery** also returns `decision: "escalate"`, with no dossier, no audit row and no ticket, so *nobody is escalated to*. Decided: a distinct caller-visible outcome (`R-25`), not yet built |
| UC-08 | `escalate` — and nothing else. **[2026-08-21]** Unchanged by UC-08's decision pass, and deliberately: the specialist's **outcome** (`dossier_read` / `proceeding_offline` / `not_proceeding` / `more_information_needed`) is recorded on the hand-off **ticket**, never on the dossier record, so it is not a decision value and does not join this list. UC-07's DRIFT-102 caveat above **also applies here** — a duplicate delivery returns `decision: "escalate"` with no dossier, no audit row and no ticket |
| UC-09 | `approval_required`, `dual_approval_required`, `triple_approval_required`, `escalate` |

### Escalation
The outcome that says "a specialist needs to work this properly." An
escalated case is **visible** in the review queue but has **no buttons** — it
cannot be closed from the sidebar.

**Why it matters here:** this refusal is deliberate and load-bearing.
Allowing a one-click clear on the safe path would turn the safe path into a
dismiss button, which quietly destroys the whole point of escalating.

### Dossier
A compiled research package for a 🔴 use case: the facts gathered, the
computations run, the citations retrieved, the mandatory disclaimer — handed
to a specialist who then decides.

**Why it matters here:** it is what "automation" means at the high tier.
The system saves the specialist's fact-gathering time without touching their
judgement. UC-07 and UC-08 produce nothing else, ever.

### HITL — Human In The Loop
A workflow where the system prepares everything and a person makes the final
call.

**Why it matters here:** on 🟡 use cases, the human gate **is** the design —
not a temporary safety measure to be optimised away. This is why the metrics
layer is tier-aware: a high automation rate on a 🟡 use case would be a
symptom, not an achievement.

### Dual control / four-eyes / segregation of duties
Requiring two different people, in two different named roles, to approve
before an action executes.

**Why it matters here:** UC-06 needs the **employer's signatory** *and* a
Remote **Payroll Specialist** — two people on two sides of the relationship,
which is cross-organisational four-eyes rather than an internal review step.
UC-09 needs a requester *and* an approver, plus a payment releaser for
high-risk cases — with a hard floor of two enforced by `Math.max(2, ...)`, so
no risk score can ever drop it to one. The same person may not fill two roles,
**and the requester may not fill any of them.** See
`docs/adr/0005-dual-control-segregation-of-duties.md`.

> **CORRECTED 2026-08-21 (DRIFT-098, `[A-1]` `[A-2]`).** This entry read
> *"UC-06 needs a Customer Admin **and** a Payroll Specialist"*, and the
> requester-may-not-approve clause was absent — matching the code, where
> `requester` is stored and never compared to either approver. **Note the word:
> "customer admin" is employer-side** — "customer" means *Remote's* customer,
> the client company — so the split was always cross-organisational; what was
> missing was independence *within* the employer side. Slot 1 is now the
> employer's signature, in Remote's own vocabulary
> (`awaiting_employer_signature`). **Decided, not yet built.**

### No execution path
The property that a use case's code contains no route by which it could
perform a state change — enforced structurally, not by a runtime refusal.

**Why it matters here:** UC-07 and UC-08 enforce it four independent ways.
The workflow function takes no write-capable client as a parameter. The store
has one write method and zero mutation methods. The HTTP API has no POST
route *in the file* (a POST returns `404 no_such_route`). The n8n graph has
no branch node at all. A check that merely *refuses* to call a write method
is one bug away from calling it; removing the parameter removes the bug's
precondition.

### Fails closed
When any piece of information is missing, the answer is "no" rather than an
assumption.

**Why it matters here:** it is how identity works. No session, no email on
the record, or a mismatch all yield `verified: false` and an escalation —
never a benefit of the doubt.

### Money ×100 scaling
Remote's API represents every monetary value as an integer equal to the
amount multiplied by 100. `$50,000.00` is `5000000`.

**Why it matters here:** it avoids floating-point drift when money crosses
international systems, and getting it wrong overpays someone by a factor of
one hundred. It lives in exactly one file (`src/shared/money.js`) with one
function each direction, rather than being re-typed and mis-typed in nine
workflows.

### Dynamic per-country schema
Remote does not use one fixed set of employment fields — each country has its
own required fields (tax IDs, national insurance numbers, local address
shapes). Before any write, that country's schema is fetched and the payload
validated against it.

**Why it matters here:** guessing the fields is how you create an invalid or
non-compliant employment record. One subtlety worth knowing: validation
checks the **full next-state payload, not the diff** — an amendment that only
changes salary still has to produce a complete valid record, or every partial
amendment would spuriously fail on fields it never touched.

### Idempotency
The property that performing the same operation twice has the same effect as
performing it once.

**Why it matters here:** an unattended automation retries. Without
idempotency, a retry after a timeout that actually succeeded pays someone
twice. It is a standing requirement on every write path.

### Exactly-once delivery
The property that one incoming request produces exactly one set of effects, no
matter how many times it is *delivered*. Distinct from idempotency in emphasis:
idempotency is the goal, this is the mechanism.

**Why it matters here:** webhooks are **at-least-once** — Zendesk retries a slow
response, a trigger can double-fire, a customer double-clicks submit. Every path
in this system claims `(use_case, external_ref)` in one shared `workflow_claims`
table before its first durable write. The guarantee is that table's **PRIMARY
KEY**, not any code: a "check whether it exists, then insert" has a gap between
the two steps that a simultaneous delivery slips through, which is exactly the
race that once posted a duplicate letter to a real customer.

### Upstream failure
A call to somebody else's API that did not answer usefully — as distinct from
this system deciding to refuse something.

**Why it matters here:** three states are deliberately kept apart, because they
demand different responses. `upstream_record_not_found` (a 404) is an
authoritative answer *about the record*. `upstream_unavailable` (403, 5xx,
transport) means the request was never evaluated at all — try again later. A
plain policy refusal means the system looked and said no. Before this
distinction existed, an outage and a policy decision produced identical audit
rows, so anyone investigating chased a problem that did not exist.

### Drift
When the deployed copy of something no longer matches the file it came from.

**Why it matters here:** the gate logic exists twice — once in `src/` and once
as an n8n Code node body — so drift means production is running different rules
from the ones the tests check. `npm run verify-deployed` compares all 29 node
bodies against their files and distinguishes *comments-only* drift from
*code differs*, because a checker that treats a reworded comment as an incident
trains you to ignore it.

### Source tagging
Every function that calls an LLM with a rule-based fallback returns
`source: "llm"` or `source: "rule_based_fallback"` on its result.

**Why it matters here:** it makes "how much of this automation actually rests
on model output?" a number rather than an opinion, and it flows into the
audit record so the answer survives.

### Retry-then-escalate
Up to three attempts with backoff before the caller's existing fallback takes
over (`src/shared/retry.js`).

**Why it matters here:** a single try/catch treats one transient blip
identically to a permanent failure. Retry never *replaces* a fallback — it
only decides how many attempts happen first. It also carries a `shouldRetry`
seam so a 404 or a 400 isn't retried pointlessly, and an `onAttempt` seam so
every attempt becomes an audit trace entry. Wired into the three LLM call
sites and both REST clients.

---

## Storage

### `cases`
The **mutable current state** table: one row per request, with a `status`
that changes as a specialist works it. Answers *"what is the state of this
request right now?"*

### `audit_log`
The **append-only history** table: one row per event, never updated, never
deleted. Answers *"what happened, and why?"* It records the AI's
recommendation beside the human's verdict, which is what makes the human
agreement rate a measurement rather than a definition.

**Why the distinction matters:** update an audit row and you have destroyed
the record of what the system used to believe. Read a `cases` row as history
and you cannot answer "what did we decide at the time?" — the status has
moved on. Neither failure announces itself.

### `audit_trace`
The second level of the audit model: one row per individual LLM or API
**attempt**, written as it happens, linked by foreign key to the decision row
that owns it.

**Why it matters here:** a single end-of-request summary row structurally
cannot answer "why did this fail at 3am," because a request that never
finished never writes one. See
`docs/adr/0006-two-level-audit-model.md`.

### `review_queue`
One row per case that needs a human. Has exactly **one** status slot — which
is why UC-06 and UC-09, needing two and N independently-identified approval
slots, got their own stores rather than overloading this table.

### Per-use-case stores
`uc06_amendments`, `uc07_dossiers`, `uc08_dossiers`, `uc09_adjustments`. Each
follows the same pattern: in-memory arrays always populated (so tests and
demos need no database), plus an optional Postgres pool that also writes in
the background when configured.

### RLS — Row Level Security
A Postgres feature restricting which rows a given role may see or change.

**Why it matters here:** every table in this project has RLS **enabled with
zero policies defined**, which means no role can touch it except the owner.
Access is backend-only, through the `postgres` role (the Node app) or the
Supabase API credential (n8n).

---

## Tooling

### n8n
An open-source workflow automation tool: you build a pipeline as a visual
graph of connected nodes (HTTP requests, code, database writes, branches) and
it runs on a schedule or on a webhook.

**Why it matters here:** it is the production orchestrator. Each of the nine
use cases has an n8n graph that calls OpenAI, Remote, Zendesk and Supabase
**directly** — it does not depend on the Node app being up. That
independence is why the gate logic is deliberately duplicated rather than
extracted behind a shared service.

### Code node
An n8n node that runs a block of JavaScript.

**Why it matters here:** each use case's gates live in exactly one Code node.
Their bodies are stored as **real `.js` files** in `workflows/nodes*/`, never
as template literals in a builder script — because on the first deployment
two escape sequences collapsed, and one of them turned a regex into a regex
followed by a line comment, so a boolean silently held a `RegExp` object.
Always truthy. Nothing crashed, and every ticket would have routed to human
review while the automation resolved nothing.

### Pinned node
An n8n node running from saved sample data instead of actually calling its
service.

**Why it matters here — this is the single most important tooling gotcha in
the repo.** n8n's test-run tool pins *every* credentialed node, so a database
write node returns a canned `{success: true}` and the whole execution reports
green having touched no database. That is exactly how "this workflow ran
through to audit" survived in these docs for two sessions while the audit
table had zero rows written from n8n. **A green n8n execution is not evidence
that an integration works — check the destination.**

### Draft vs published (n8n)
An n8n workflow has an editable **draft** version and a live **active** version.
`versionId` is the draft; `activeVersionId` is what production actually runs.

**Why it matters here:** the two tools that write workflows have **opposite
defaults**, and both point at automations that reply to real customers. The MCP
`update_workflow` writes a draft that changes nothing until it is published —
so a fix appears to fail because production keeps running the old graph. A REST
`PUT /api/v1/workflows/{id}` **publishes in place** — it is a production change
the moment it returns 200, with no promote step and no second look. The only
reliable question is whether `activeVersionId` equals `versionId`.

### Item pairing
n8n's record of which output item came from which input item, which is what
lets a later node say `$('Some Earlier Node').item` and get the *matching* row.

**Why it matters here:** a Code node that returns a bare object breaks the
chain, and the resulting error ("can't determine which item to use") surfaces
far from the node that caused it. Every Code node this project inserts into an
existing graph sets `pairedItem` explicitly.

### Company token vs employee token
Remote's API distinguishes a token acting for a **company** from one acting as
an individual **employee**. Some endpoints exist in both forms.

**Why it matters here:** this system is an unattended service acting as a system
actor, so it holds a company token and structurally cannot hold an employee
session. Calling an employee-scoped endpoint (`/v1/employee/expense-categories`)
returns *"Forbidden, invalid role for this endpoint"* — which reads exactly like
a missing permission and is not one. The company-side equivalent
(`/v1/expenses/categories`) works with the same token. **A 403 is not always a
credentials problem; check you are on the right side of the API first.**

### Zendesk
The customer support platform: tickets, agents, triggers, an app framework.

### ZAF — Zendesk Apps Framework
The system for building apps that run *inside* the Zendesk agent interface —
version 2 apps are static HTML and JavaScript in an iframe.

**Why it matters here:** because a ZAF app is a downloadable static bundle,
it can never hold a credential and cannot reach a database. So the split is
strict: the sidebar renders and clicks, and the API behind it holds every
credential and every gate. The browser holds no copy of any policy.

### Zendesk trigger / webhook
A **webhook** is a URL Zendesk will POST to. A **trigger** is the rule
deciding when to POST — "when a ticket matching these conditions is created
or updated."

**Why it matters here:** this pair is what turns a real customer ticket into
a real automation run, and it is the least-proven link in the chain. The
current trigger is scoped narrowly (a test tag plus the Remote employment ID
field, and *not* already carrying one of the automation's own outcome tags —
which is how it avoids re-processing its own work). The original condition
required ticket status `new`; this Zendesk account moves agent-created
tickets straight to `open`, so it could never match. The corrected version
**has not been observed firing on a real ticket.**

### MCP — Model Context Protocol
A standard letting an AI assistant connect to external tools and data
sources.

**Why it matters here:** Remote ships a real MCP server, and it exposes
writes as well as reads — so "MCP can't write" is *not* the reason this
project keeps it off the automated backbone. The real reason is the **auth
model**: MCP authenticates a *user* through an interactive browser sign-in
and acts on that user's behalf. That is session-bound and consent-driven by
design, which is structurally the wrong shape for an unattended service that
must run with no human present, retry idempotently, and attribute actions to
a system actor. REST is the backbone; MCP is a narrow AI-assist capability
for lookups where a human *is* in the loop. Knowing when *not* to use a named
tool is itself part of what this repo is demonstrating. See
`docs/adr/0002-rest-not-mcp-for-the-automated-backbone.md`.

### Remote Sandbox
Remote's test environment, preloaded with sample employees, contracts,
payroll and expenses — real API shapes, no real people.

**Why it matters here:** it is how schemas get verified against reality
instead of invented. No real customer data ever enters this project.

### Supabase
A hosted Postgres database with an API layer. This project uses it purely as
Postgres — `audit_log`, `cases`, the per-use-case tables.

### pgvector
A Postgres extension for storing and searching vector embeddings (numeric
representations of text that let you find semantically similar passages
rather than exact keyword matches).

**Why it matters here:** UC-08's treaty retriever uses it for real
embedding-similarity search over a curated corpus. Note the honesty
discipline that came with it: every citation states *which similarity rank
and threshold* it cleared, in plain language, and **never a raw similarity
number** — an invented precision score would claim more than the retrieval
knows. When unconfigured, it degrades to the keyword matcher it replaced.

---

## Testing

### Hermetic test
A test that cannot reach the network, cannot reach a database, and does not
depend on the machine's environment.

**Why it matters here:** every test in this repo is hermetic (one is a
deliberate opt-in exception — a real-Chromium PDF render behind
`RUN_REAL_PDF_TESTS=1`). Crucially, this is enforced **structurally, not
procedurally**: every LLM call site takes an injectable dependency, so a test
that doesn't inject a fake gets the rule-based path rather than a real API
call. This mattered concretely — the development environment has a genuine
but unreachable OpenAI key, and before the seams existed, tests were making
real, slow, failing network calls. One test went from 1ms to 11.4 seconds.

**A corollary worth internalising:** a sudden jump in `npm test`'s total
duration is itself a hermeticity check. Investigate it before trusting an
"all passing, hermetic" claim.

### Positive test
A test asserting that a valid input reaches the *successful* outcome — "this
request MUST auto-resolve" — rather than only asserting that bad inputs are
refused.

**Why it matters here, and it is the hardest-won lesson in this repo:** a system
that fails closed is *supposed* to refuse things. So a use case that is
**structurally incapable of ever succeeding** looks exactly like one being
appropriately cautious. Every fail-closed assertion passed while UC-03 could
never auto-resolve in production — a Spain trip refused with Spain fully
supported, after a *successful* 224-row fetch. No amount of negative testing can
tell a dead gate from a cautious one. Only a positive test can.

**A caution that belongs with the lesson:** the same investigation also claimed
UC-09's third-approver rule had never fired. That turned out to be false — a
positive test on the *unfixed* production graph showed it firing. The habit
that catches a dead gate is the same habit that catches an overstatement about
one, and it has to be applied to your own findings too.

### Parity test
A test that executes the **real** n8n Code-node body in a sandbox and asserts
it produces the same decision, reason and flags as the corresponding Node
policy engine, across every scenario.

**Why it matters here:** the gate logic deliberately exists twice — once in
`src/ucNN/policyEngine.js`, once in `workflows/nodes*/`. The duplication is a
considered production trade-off (see [`ARCHITECTURE.md`](ARCHITECTURE.md)
§6), and the parity tests are what stop it becoming drift. Edit one without
the other and the suite fails.

One quirk you will hit if you write one: results from `node:vm` are
cross-realm, so `assert.deepEqual` fails on prototype identity rather than
content. JSON round-trip the result — which is also what n8n itself does
between nodes.

### Injectable seam
A dependency passed in as a parameter with a real default, so tests can
substitute a fake without any environment manipulation. `handleVerificationTicket(ticket, { remote, audit, caseStore, classify })`
is the pattern.

**Why it matters here:** it is the mechanism behind hermetic tests, and the
rule is that **every new LLM call site needs one from day one** — not added
later once a slow test surfaces the gap.

---

## Where these terms live in code

| Term | File |
|---|---|
| Money ×100 | `src/shared/money.js` |
| Identity, fails closed | `src/shared/identity.js` |
| Risk tier | `src/shared/riskEngine.js` |
| Per-country schema | `src/shared/schemaValidator.js` |
| `audit_log` + `audit_trace` | `src/shared/audit.js` |
| `cases`, `review_queue`, `documents` | `src/shared/caseStore.js` |
| Retry-then-escalate | `src/shared/retry.js` |
| Gates / decisions | `src/ucNN/policyEngine.js` |
| Payroll cutoff | `src/uc06/cutoffEngine.js` |
| Presence days | `src/uc08/presenceCalculator.js` |
| PE risk / Schengen blocks | `src/uc04/riskMatrix.js` |
| Statutory notice | `src/uc05/noticePeriodTable.js` |
| Dual control | `src/uc06/dualApprovalPolicy.js`, `src/uc09/multiApprovalPolicy.js` |
| HITL gate | `src/review/reviewPolicy.js` |
| ZAF signed identity | `src/review/zafAuth.js` |
| Parity tests | `test/n8nParity.test.js`, `test/n8nUcNNParity.test.js` |
| Port registry | `src/shared/ports.js` |
