# START HERE

The front door to this repository. If you have never seen this project
before, read this page top to bottom — it should take about fifteen minutes
and leave you able to run everything and explain what you are looking at.

No prior knowledge is assumed: not of this codebase, not of Employer-of-Record
platforms, not of the tools involved. Terms are explained on first use, and
every term is also in [`GLOSSARY.md`](GLOSSARY.md).

**Verified against the code on 2026-08-14.** Where a claim could not be
verified, this page says so rather than rounding up.

---

## 1. What problem does this solve?

### The business it sits inside

An **Employer-of-Record** (EOR) company legally employs people in countries
where its customers have no legal entity. If a startup in Berlin wants to
hire an engineer in Brazil, it does not open a Brazilian subsidiary — it
asks an EOR like [Remote](https://remote.com) to employ that engineer on
its behalf. The EOR becomes the legal employer: it issues the contract, runs
payroll, withholds tax, handles benefits, and carries the compliance risk.

That means the EOR is on the hook for a large volume of employment
paperwork, in dozens of legal systems at once — and every one of those
employees, plus every customer company's HR admin, can raise a support
request.

### The requests

Support at an EOR is not a single queue of similar questions. It is a mix of
very different things that happen to arrive through the same door:

- *"I need a letter proving I work here, my landlord wants it by Friday."*
- *"I expensed a client dinner three weeks ago and it still isn't reimbursed."*
- *"We're giving Priya a raise — can it land in this month's payroll?"*
- *"I want to work from Portugal for six weeks. Is that allowed?"*
- *"I'm moving to Japan permanently. What happens to my employment?"*
- *"If I spend half the year in two countries, where do I pay tax?"*

The first two are high-volume, repetitive, and low-stakes — a person doing
them by hand is doing data lookup, not judgement. The last two are
low-volume, one-off, and genuinely dangerous to get wrong: bad cross-border
tax guidance can cost a real person real money and expose the employer to
real liability.

### The trap

The obvious move — "put an AI on the support queue" — fails precisely
because these look similar on arrival and are not similar at all. A language
model is very good at reading the messy free text of all six requests. It is
completely unfit to be the thing that decides whether to change someone's
payroll.

So this system's job is not "answer support tickets with AI." It is:

> **Automate the requests that should be automated, at full speed;
> deliberately refuse to automate the ones that shouldn't; and prove which
> is which with code you can read and tests you can run.**

---

## 2. The one idea that shapes everything

> ### AI interprets. Deterministic code decides. Humans control the exceptions.

Break it into its three parts.

**AI interprets.** A language model reads the incoming request and produces
*structured labels*: what kind of request is this, is the sender the employee
or a third party, did they attach a form, how confident am I. That is
reading comprehension, which models are excellent at.

**Deterministic code decides.** Everything after that label is plain
JavaScript with `if` statements — no model involved. Is this employee still
active? Is the requester who they claim to be? Are they asking for fields
we're allowed to disclose? Those checks live in files called *policy
engines*, they are pure functions, and they are unit-tested. You can read
`src/uc01/policyEngine.js` in ninety seconds and know exactly what the system
will do.

**Humans control the exceptions.** Anything that doesn't cleanly pass every
check is handed to a person — with the facts already gathered — rather than
guessed at.

Two structural rules make this real rather than aspirational:

1. **The model's output is validated against a strict shape before anything
   downstream may use it.** Wrong shape, missing field, unparseable JSON,
   network failure — any of these and the system falls back to a rule-based
   classifier and *tags the result* so the audit trail records which path
   answered (`source: "llm"` or `source: "rule_based_fallback"`).
2. **The model never performs a state change.** It cannot issue a letter,
   approve an expense, or write to payroll. It has no such capability
   anywhere in its call path.

---

## 3. Risk tiers: the actual spine

The one idea above tells you *who* decides. The risk tier tells you *how much
the system is allowed to do at all* — and it is not a label stapled on for
documentation. It selects a different execution path in code.

| | 🟢 **Low** | 🟡 **Medium** | 🔴 **High** |
|---|---|---|---|
| **Use cases** | 01, 02, 03 | 04, 05, 06 | 07, 08, 09 |
| **What the system does** | Validate, then act, then close the ticket | Gather every fact, run every check, produce a recommendation | Compile a research dossier |
| **Who acts** | Nobody — it's done | One named human clicks approve (two for UC-06) | A specialist takes it from there |
| **Can the code write to Remote?** | Yes, after all gates pass | Yes, but only from the approval endpoint | **No — for 07 and 08 there is no write path in the code at all** |
| **What "success" looks like** | High auto-resolution rate | High rate of specialists *agreeing* with the recommendation | Specialist time saved on fact-gathering |

### Why the 🔴 tier is the interesting part

Most automation portfolios show you what they automated. The harder and rarer
skill is knowing what *not* to automate — and then building the system so
that the wrong thing is not merely discouraged but impossible.

For UC-07 (permanent relocation) and UC-08 (cross-border tax), that is
enforced four ways, each independent:

1. **The workflow function takes no write-capable client.**
   `handleTaxInquiry()` and `handleRelocationReview()` accept an audit logger
   and nothing else. There is no parameter through which a Remote or Zendesk
   write client could be passed in. A policy check that *refuses* to call a
   write method is one bug away from calling it. Removing the parameter
   removes the bug's precondition.
2. **The data store has one write method and zero mutation methods.** There
   is no `markExecuted()` to add a bug to, because there is no such method.
3. **The HTTP API has no POST route in the file.** Not a POST route that
   refuses at runtime — no POST route at all. Any POST to a dossier path
   returns `404 no_such_route`.
4. **The n8n workflow graph has no branch node.** No Switch, no IF. Every
   execution ends at the same single "post an internal note" step. There is
   no routing node a future edit could quietly wire to a write action.

And a test asserts it, two ways: a **structural** check (read the source,
strip the comments, assert it never references either REST client's write
methods) and a **behavioural** one (across varied inputs, the decision is
always `escalate`).

### The deliberate exception: UC-09

UC-09 is off-cycle payroll — moving real money. It is framed 🔴 and it
*does* have an execution path. That is not an inconsistency; it is what the
tier rule actually says.

The rule is **"AI never executes unilaterally,"** not "AI never executes."
UC-07 and UC-08 satisfy it by having no execution path. UC-09 satisfies it
by requiring at least two independent human approvals — from different
people, in different named roles — before the write fires. A risk score can
push that number *up* (a third approver, a "payment releaser", for
high-risk cases). Nothing can push it below two: the code is literally
`Math.max(2, ...)`.

That distinction matters because an earlier design proposal for UC-09 had a
"low risk score → commit directly, no human" tier. It was rejected outright.
A risk score can decide *how many* humans, never *whether* a human.

---

## 4. The nine use cases

Each one is a category of support request. Each has a full spec at
`docs/use-cases/UC-0X.md`, core logic at `src/ucNN/`, and an HTTP API.

| # | Name | Tier | What it does in one line |
|---|---|---|---|
| **01** | Employment Verification | 🟢 | Issues a standard "yes, this person works here" letter — auto-resolved when identity is proven and the employee is active. |
| **02** | Expense & Receipt Validation | 🟢 | Runs twelve ordered checks on an expense claim (ownership, duplicate receipt, arithmetic, currency, category cap, VAT) and auto-approves only if every one passes. |
| **03** | Travel Support Letter / Workation Router | 🟢 | A deliberately thin triage router: works out whether a travel question is a documentation ask, a work-authorization question (hand to UC-04), or a tax question — and owns no compliance logic of its own. |
| **04** | Work Authorization / Workation | 🟡 | Scores a temporary work-from-abroad request against an origin→destination risk matrix (permanent-establishment risk, Schengen and US–Canada hard blocks) for one mobility specialist to approve. |
| **05** | Resignation Notice Calculation | 🟡 | Computes the legally correct notice period from a nine-country statutory table plus accrued-leave payout, for one HR Ops sign-off. Remote exposes no write endpoint here, so the signed-off report *is* the deliverable. |
| **06** | Contract Amendment / Payroll Cutoff | 🟡 | Checks a proposed contract change against the country's field schema and the monthly payroll cutoff clock, then requires **two** approvals from **two different roles** before writing. |
| **07** | Global Mobility / Permanent Relocation | 🔴 | Compiles a feasibility dossier for a permanent move between countries. **No execution path.** |
| **08** | Cross-Border Tax & Social Security | 🔴 | Computes presence days, retrieves relevant tax-treaty citations, and assembles a dossier with a mandatory disclaimer. **No execution path.** |
| **09** | Off-Cycle Payroll / Adjustment | 🔴 | Prepares an off-cycle payment and holds it behind a floor-of-two multi-role approval before executing. **The one 🔴 use case that can write.** |

Every one of the nine has: core logic in `src/`, an HTTP API you can start
with one command, a panel in the Zendesk sidebar app, and an n8n workflow
graph. See §7 for what is *not* proven about them.

---

## 5. What can I actually run?

```bash
npm install    # required — a fresh clone fails without it
npm test       # 4,109 passing, 2 skipped, ~2 minutes, no network, no API keys
```

`npm test` reports **4,109 passing, 2 skipped**. The skips are deliberate and
opt-in: one test drives a real headless Chromium to render a PDF, and it only
runs with `RUN_REAL_PDF_TESTS=1`. Everything else is *hermetic* — it cannot
reach the network, by construction rather than by convention (see
[`GLOSSARY.md`](GLOSSARY.md) → *hermetic test*).

Nothing below costs money or touches a real service **except** `npm run live`
and `npm run livedemo`, which are flagged.

### Read the terminal

| Command | Port | What you see |
|---|---|---|
| `npm run demo` | — | Three employment-verification tickets decided in front of you, narrated: the classification, the gates, the outcome. The fastest way to see the idea. |
| `npm run scenarios` | — | Every scenario from UC-01's test plan, one labelled block each — including the ones that are *supposed* to be refused. |
| `npm run walkthrough` | — | Drives all nine use-case APIs over real HTTP, one at a time, against seeded data. Starts each server, calls its real routes, walks an approve/deny including a refusal, shuts it down. No credentials. |
| `npm run metrics` | — | The impact dashboard. Prints a summary and writes `demo/metrics.html`. Runs 120 tickets through the *real* gates — change a policy engine and the numbers move. |
| `npm run loadtest` | — | Real `autocannon` throughput numbers against the nine APIs. Results and caveats in `docs/LOAD-TEST-RESULTS.md`. |
| `npm run pdf-demo` | — | Renders a UC-01 letter to a real PDF via Playwright/Chromium. |

### Open in a browser

| Command | Port | What you see |
|---|---|---|
| `npm run playground` | **4030** | One page where you play *both* roles: submit a ticket as the employee (one-click fills for every scenario), then switch hats and approve or deny it as the specialist. Offline; runs the real workflow code. |
| `npm run chatdemo` | **4046** | UC-01 as a chat window. Every message you type becomes a ticket through the real handler, and the real result comes back. (Port 4046, not 4045 — Chrome refuses to load 4045.) |
| `npm run remoteui` | **4041** | A stand-in for Remote's *own product* UI, where a UC-06 contract amendment actually starts. Three separate role-authenticated forms (company admin requests; employee and employer consent), each gated server-side. |
| `npm run dashboard` | **4060** | All nine use cases on one page. **This starts nothing** — it is only a viewer that polls the nine APIs below. Start whichever you want to see first; a section whose API is down says so rather than showing a blank. |

### The nine use-case APIs

Each starts a real HTTP server and seeds itself with demo rows on boot, so
every one is inspectable with zero credentials. All nine can run at once.

| Command | Port | Main route | Notes |
|---|---|---|---|
| `npm run review-api` | **4020** | `/api/review/tickets` | UC-01's review API — also the backend the Zendesk sidebar talks to. |
| `npm run uc06-api` | **4021** | `/api/amendments` | `POST /:id/approve\|deny` takes a `role` — **two** roles must both approve. |
| `npm run uc08-api` | **4023** | `/api/dossiers` | **Read-only. No POST route exists.** |
| `npm run uc02-api` | **4050** | `/api/expenses` | `POST /api/expenses` runs the real twelve-gate workflow. |
| `npm run uc03-api` | **4051** | `/api/cases` | One write route: `POST /api/cases/:id/signoff\|decline`, the drafted travel letter's sign-off. Every other UC-03 outcome is refused there by name — UC-03.md §15.2. |
| `npm run uc04-api` | **4052** | `/api/authorizations` | Single-specialist approve/deny. |
| `npm run uc05-api` | **4053** | `/api/resignations` | `POST /:id/signoff` records a sign-off; there is no Remote write to make. |
| `npm run uc07-api` | **4054** | `/api/dossiers` | **Read-only. No POST route exists.** |
| `npm run uc09-api` | **4055** | `/api/adjustments` | Multi-role approve/deny; execution only when the approval floor is met. |

Every one also answers `GET /healthz`, and `GET /api/<thing>/by-ticket/:ref`
for the sidebar. Per-route `curl` commands are in
[`WALKTHROUGH.md`](WALKTHROUGH.md).

### The mocks

| Command | Port | What it is |
|---|---|---|
| `npm run mock` | **4010** | A local stand-in for Remote's API, mirroring the real response shapes. |
| `npm run zendesk-mock` | **4014** | A local stand-in for Zendesk. |

You rarely need to start these by hand — each API above starts its own
private copy on an internal port in the reserved `4070–4089` band.

### The two that touch real services

| Command | Cost | What it does |
|---|---|---|
| `npm run live` | Real API calls | **One** pass against Remote Sandbox + OpenAI + Supabase + Zendesk, reading every written row back. Requires a filled-in `.env`. |
| `npm run livedemo` (port **4040**) | Real API calls | Creates an **actual Zendesk ticket**, tagged exactly the way the live n8n automation expects, then polls that same real ticket to show what the automation did to it. |

Credentials live in `.env` (gitignored; copy `.env.example`). **Every unset
variable keeps that integration on its safe default** — mock server,
rule-based classifier, in-memory store. There is no configuration state in
which an unset key causes a crash instead of a degradation.

### A note on ports

`src/shared/ports.js` is the single registry, and `test/ports.test.js`
enforces it. Never write a port number into a server file — this exact bug
bit three times (each API quietly binds a *second*, undocumented socket for
its seed mock, and several of those collided with other APIs' public ports).
Read that file's header comment; it is the best short lesson in the repo.

---

## 6. Where do I go next?

Read in this order depending on what you want.

### "Show me the idea, in code"

1. **`src/uc01/workflow.js`** — one screen, eight numbered steps, the whole
   flow.
2. **`src/uc01/policyEngine.js`** — the deterministic gates. This is the
   system's judgement and it contains no AI.
3. **`test/uc01.test.js`** — the fastest way to learn actual behaviour.

### "Explain how the pieces fit"

- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — a request's full journey with
  diagrams, the LLM/code seam, the shared foundation, the storage model, and
  why the same logic deliberately exists twice.
- **[`GLOSSARY.md`](GLOSSARY.md)** — every term, short, with why it matters
  *here*.
- **[`00-FOUNDATION.md`](00-FOUNDATION.md)** — the shared architecture all
  nine use cases inherit, including the ten global invariants.

### "What is actually built, honestly?"

- **[`BUILD-LOG.md`](BUILD-LOG.md)** — the authoritative status record and
  the decision log. Long (1100+ lines), but §1 is a status table and §4 is
  *why* each decision was made, including bugs only found by running against
  live services.
- **`workflows/README.md`** — node-by-node account of all nine n8n graphs,
  including what each one deliberately does *not* have.
- **[`../README.md`](../README.md)** — the short overview.

### "Why is it built this way?"

- **`docs/adr/`** — ten architecture decision records, each one page:
  risk-tier-as-execution-path, REST-not-MCP, no multi-agent orchestration,
  trigger source per use case, dual control, the two-level audit model,
  retry-then-escalate, the nine-country scope, sensitive data to the LLM,
  JavaScript not Python.
- **`docs/01-COHERENCY-MAP.md`** — how twenty-seven source research
  documents were resolved into nine non-contradictory specs. Note its own
  header: an early recency-based heuristic was later found wrong and
  re-resolved.
- **`docs/verification/`** — primary-source research behind specific claims
  (which Remote endpoints actually exist, what the payroll cutoff really is).

### "How do I measure whether it works?"

- **[`METRICS.md`](METRICS.md)** — the impact layer, and the one subtlety
  worth reading: every judgement is tier-aware, because a dashboard that
  maximised "% automated" would reward exactly what this architecture exists
  to prevent.

### "I want to run or extend it"

- **[`TESTING-GUIDE.md`](TESTING-GUIDE.md)** — click through everything.
- **[`WALKTHROUGH.md`](WALKTHROUGH.md)** — per-API `curl` commands.
- **[`SETUP-CHECKLIST.md`](SETUP-CHECKLIST.md)** — accounts, credentials,
  and the Supabase tables that need provisioning by hand.
- **`CLAUDE.md`** (repo root) — the working agreement for AI-assisted
  sessions on this repo, including a "gotchas already paid for" section. Not
  a reader's document, but the scars are real.

### Documents that are point-in-time, not current

`docs/HANDOFF-2026-08-03.md`, `docs/HANDOFF-2026-08-09.md`,
`docs/audit-findings.md`, and `docs/LOCAL-MIGRATION.md` were written for a
specific moment and are kept for history. Do not read them for current
status.

---

## 7. What is *not* proven

The repo's seventh prime directive is: *be honest in every artifact; a
reviewer who catches one overstatement discounts everything else.* So:

- **All nine n8n workflows are live and active** — verified directly against
  the n8n instance, all nine returning `active: true`. But *active* only means
  "will accept a real webhook call." It is **not** the same claim as "proven to
  write real data," and the two are tracked separately here.

  > **Updated 2026-08-17 — this list has grown.** **All nine** have now written
  > at least one real `audit_log` row from an unpinned production-webhook drive
  > (83 rows, every use case represented). The table below is the original
  > four and is kept because those executions are the ones documented
  > node-by-node. The *customer-facing* half of the claim has not moved: UC-01
  > is still the only use case that has ever completed one.
  >
  > And a caution this section needs, learned the hard way the same day:
  > **"a real execution wrote a real row" is not the same claim as "this use
  > case works."** UC-03 wrote genuine unpinned rows for weeks while its
  > supported-country gate was structurally incapable of ever approving
  > anything (`docs/BUILD-LOG.md` §3.28). Proof of execution and proof of
  > capability are different measurements.

  **Four of the nine have that stronger proof: UC-01, UC-03, UC-04 and UC-05.**
  Each has a real, unpinned execution that made genuine API calls and wrote
  genuine rows — verified by opening the execution and reading each node's
  status, not by trusting the run's overall result:

  | | Execution | What really happened |
  |---|---|---|
  | UC-01 | `22` | Real Supabase `audit_log` row `d7b067a1…`, `classification.source: "llm"` |
  | UC-03 | `404` | Real Remote read, real OpenAI classify, real `audit_log` row |
  | UC-04 | `408` | Real Remote read (960ms, live Sandbox record), real `uc04_authorizations` row `bb105479…` **and** real `audit_log` row |
  | UC-05 | `409` | Same, `pinData: {}` — nothing pinned anywhere in the run |

  **All four are marked `error` in n8n, and that is the interesting part.**
  Every one failed at its final Zendesk node with
  `400 — id must be an integer`, because the test passed a descriptive
  reference (`prod-proof-uc04-20260810b`) where Zendesk requires a numeric
  ticket id. The failure is *downstream of the audit write*, which is exactly
  what the architecture is built to guarantee: the decision is durable before
  any customer-facing action is attempted. A red execution here is the design
  working, not the design failing.

  **Still outstanding for UC-02, UC-06, UC-07, UC-08 and UC-09.**

  - Reading node-level status rather than the run's summary matters in both
    directions. n8n's *test-run* tool **pins** every credentialed node, so a
    database-write node returns a canned `{success: true}` without touching
    the database and the whole run goes green — which is how "this workflow
    ran through to audit" survived in these docs for two sessions while the
    audit table had zero rows from n8n. And, as above, a run marked `error`
    may still have written everything that mattered. **Neither the green tick
    nor the red cross is the evidence — the destination is.**
- ~~**No workflow has ever been driven by a real inbound Zendesk ticket.**~~
  **Superseded 2026-08-15 for UC-01, still true for the other eight.** Zendesk
  ticket **#6** on the live account was created by a customer comment at
  `21:34:36`, fired the trigger, ran n8n execution `3645` (`status: success`,
  nothing pinned), and was answered with a rendered HTML letter and **solved
  five seconds later**, with a real `audit_log` row at `21:34:41.156537+00`.
  Tickets #3–#5 carry the same shape. The rest of this bullet is kept as
  written, because it remains accurate for UC-02…UC-09:
  - The four proven executions above were *manually invoked*. They prove the
    decision logic, the Remote reads and the Supabase writes are real. They do
    **not** prove a ticket arriving in Zendesk starts any of it.
  - A webhook and trigger were built for the original account, and their
    condition was corrected once (it required ticket status `new`, but that
    account moved agent-created tickets straight to `open`, so it could never
    match). That corrected version was never observed firing.
  - The project has since been pointed at a **different Zendesk account**, so
    that webhook and trigger do not exist on it at all. They have to be created
    fresh, and the n8n Zendesk credential re-pointed, before any of this can be
    tested. Nothing about the earlier setup carries over.
  - Real inbound delivery for the other eight workflows was never wired.
- **The Zendesk step will reject a non-numeric ticket reference.** All four
  proven executions died on it. `externalRef` is passed straight to the Zendesk
  node as the ticket id, and Zendesk requires an integer — so any caller that
  supplies a descriptive reference (the request portal and the Remote UI
  stand-in both do) gets a `400` at the final step, *after* the decision has
  been recorded. Harmless to the audit trail by design, but it means those
  paths cannot currently close the loop on a ticket.
- **The Zendesk sidebar app is built and tested but not installed** in the
  live Zendesk account. It needs `zcli apps:package` and an upload.
- **Approver identity defaults to a trusted header.** By default the review
  API believes the `X-ZAF-Approver` header, which anyone who can reach the
  endpoint could set to any name. Real RS256 signature verification of a
  Zendesk-signed token **is built** (`src/review/zafAuth.js`) and is opt-in
  via `requireSignedIdentity`. Turned on without a verifier configured, every
  state-changing call is refused — it deliberately cannot degrade silently
  back to trusting the header.
- ~~**Some Supabase tables are not provisioned.**~~ **Superseded — all 20
  tables now exist**, including `uc09_adjustments` (6 rows) and both vector
  tables. The remaining gap is narrower and worth stating precisely: UC-08's
  `uc08_treaty_citation_vectors` and UC-07's `uc07_mobility_citation_vectors`
  are provisioned but **hold zero rows**, because seeding needs real embedding
  API calls. Until they are seeded, both retrievers run their keyword fallback
  — which is the same path they take unconfigured, and is what keeps
  `npm test` hermetic. `scripts/seed-embeddings.mjs` and
  `docs/SETUP-CHECKLIST.md` cover it. **DECIDED 2026-08-21: they are not going to
  be seeded, and *"until they are seeded"* should be read as *"permanently"*.**
  At a measured **106 passages** BM25 beat embeddings **3/6 against 2/6**
  (`docs/RETRIEVAL.md`), so the remedy is a country-filtered **lexical** index
  over the real statutory corpus, one decision across UC-07 and UC-08.
  **`npm run seed-vectors` must not be run.** Two things are also worth knowing:
  the emptiness is not the only thing forcing the fallback — nothing constructs
  the retriever with dependencies either — and the status rows elsewhere in the
  repo still call this *"embedding similarity"*, which is true of the class and
  false of the running system. `T-26`/`T-27`.
- **`audit_trace` has 11 rows, all from the Node path.** The per-attempt trace
  (every LLM/API *attempt*, not just the final decision) is wired into
  `src/shared/audit.js` and **not** into any n8n graph, so the execution path
  that actually serves traffic contributes nothing to it. The decision-level
  row is still written by both. This is the difference between "why did this
  decision come out this way" (answered) and "was that one 403 or forty"
  (not answered on the live path).
- **Some things are specified but not built:** vision/OCR for receipt images
  (UC-02's spec calls for a vision model to read a receipt; the classifier
  works from the claim's own text and says so in its header), and the demo
  video (the *script* exists at `docs/DEMO-SCRIPT.md`; the recording does
  not).
- ~~**A request portal … treat it as arriving, not as present.**~~
  **It has since landed:** `src/portal/` exists and `npm run portal` serves
  seven intake forms on port 4042, each running that use case's real workflow
  in-process. Submissions land in the portal's own store, so they do **not**
  appear in `npm run dashboard`.

### Added 2026-08-17 — four defects that were live while this page said the system was in good shape

Stated here rather than buried in the build log, because they are the honest
counterweight to everything above. All four are fixed and verified in
production; the reason they are worth reading is *why nothing caught them*.

- **UC-03 could never have said yes.** Its supported-destination gate compared
  two-letter destination codes against a list built from Remote's *three*-letter
  `code` field, so a successful 224-row fetch produced an empty list and the use
  case could not auto-resolve any request, ever. Fixed and proven both ways —
  Spain now resolves (audit row `c644cdce`, the first `auto_resolve` this use
  case has ever recorded), an unsupported destination still escalates
  (`c8992d3d`).
- **Four identity gates verified a claim against itself** (UC-03/05/06/09) —
  two echoed the caller's own `employmentId` back as the "authoritative" record
  id, two compared a company id against a defaulted `null`. All four still
  refused, but only because a *later* gate caught the run. Proven on UC-05 with
  identical input either side: `a324f666` (`employee_not_active`) →
  `283dbd1f` (`identity_not_verified`).
- **An upstream outage was recorded as a policy decision.** A failed Remote read
  configured with `onError: continueRegularOutput` reports *success* and passes
  an error object downstream, so gates escalated naming the wrong cause. 404,
  403/5xx and a genuine refusal are now three different recorded states
  (`105cd7c4` vs `590772ee`).
- **A request with no external reference was silently dropped** at the new
  idempotency claim node — a green run that wrote nothing and lost a real
  request. Now claimed under `unreferenced:<execution id>`.

**The common thread, and the most transferable thing in this repository:**
every fail-closed assertion in the suite passed before all four were fixed. This
system is built to refuse when unsure, which means **a broken component and a
correctly cautious one produce the same output, the same audit row and the same
passing test.** The instrument that separates them is not a safety test — it is
a *positive* test, "this specific known-good input MUST resolve", for every
decision path. See `docs/CORRECTIONS-LOG.md` pattern **P6**.

Nothing in this repository is claimed as production-deployed at scale. It
runs end to end against Remote's Sandbox, a real Zendesk account, a real
Supabase database, and a local mock harness.
