# The request portal (`npm run portal` → http://localhost:4042)

One Remote-styled intake page with **seven request forms**, one for each use
case that had no entry point of its own. Every submission runs that use case's
**real workflow function** in this process and renders back exactly what it
returned.

```bash
npm run portal                 # port 4042 (src/shared/ports.js)
npm run portal -- --port 4042
npm run portal -- --seeded     # force in-memory even if Supabase is configured
```

No credentials are needed. Remote is always the local mock; Zendesk is never
touched; OpenAI is used only if it happens to be configured, and each use
case's own rule-based path is passed explicitly when it is not, so a run with
no `.env` at all is deterministic rather than quietly degraded.

**It also runs on the public deployment, at `/portal`** — one URL, so the E2E
test plan's Phase 2 can be run by someone with no Node and no clone. There it
is gated by a shared key; see §7.

---

## 1. Why it exists

Nine use cases; two entry points. UC-01 had three (the live Zendesk trigger,
the playground, the chat demo) and UC-06 had the Remote UI stand-in
(`src/remoteui/`). UC-02, 03, 04, 05, 07, 08 and 09 could only ever be seen as
the two or three rows their own `cli.js` seeded at boot. You could read what
they had decided. You could not make one decide anything.

That is a real gap in what the repository argues, not just a missing demo.
Every trigger in this system starts as a person asking for something — an
expense, a trip, a resignation, a relocation, an off-cycle payment — and
in the real product those requests begin **inside Remote**, not inside Zendesk.
Remote publishes no API that emits "an employee submitted an expense for
validation" as an event (the same absence that made UC-06's Zendesk intake
necessary in the first place — issue #17). So nothing in this repo could
demonstrate any of these seven flows from where they truly start.

This page is that missing surface, generalised from the argument
`src/remoteui/` already makes for UC-06 — and it says so about itself, in a
banner above every form, in the CLI's startup output, and here.

---

## 2. The one architectural decision worth reading first

**The portal calls each workflow function in-process. It does not call the nine
`npm run ucNN-api` servers over HTTP, and it does not require any of them to be
running.**

That is not a convenience choice.

UC-07's and UC-08's APIs have **no POST route**. Not a POST route that refuses
at runtime — an *absence* of one, asserted by `test/uc08Server.test.js` ("any
POST to a dossier path 404s as `no_such_route`"). "No execution path exists" is
the single headline artifact of the 🔴 tier in this portfolio, and it is
enforced at four layers: the workflow function takes no write-capable
parameter, the store has one write method and zero mutations, the API file
contains no POST route, and the n8n graph contains no branch node.

Routing portal intake through those two APIs would have required opening a
write route into both of them. The portal would have had to break the thing the
portfolio is arguing, in order to demonstrate it.

Calling the workflow function directly costs nothing and breaks nothing,
because `handleRelocationReview()` and `handleTaxInquiry()` take an audit logger
and a dossier store and **no `remote`/`zendesk` client at all**. There is no
write-capable dependency for `server.js` to pass them — not by configuration,
not by a later bug in that file. Look at the two adapters in `server.js`: their
`deps` objects are visibly missing `remote`, and that is the point.
`test/portal.test.js` pins it twice — structurally (the adapters' source, with
comments stripped, never names either client) and behaviourally (both dossiers
compile normally when the portal is wired with a Remote client that throws on
every call).

---

## 3. What the seven forms do

Each form's fields are the arguments its adapter in `server.js` documents.
Nothing is re-implemented: the decision, reason, flags, record id and every
detail line in a response came out of the real `handle*()` function.

| Form | Use case | Tier | What it submits, and the one thing worth knowing about it |
|---|---|---|---|
| Submit an expense for validation | UC-02 | 🟢 | An **expense id that already exists in Remote**, not an amount. Every figure the twelve gates check — total, line items, currency, conversion, VAT, the category cap — is read off the Remote record by the workflow. That is why the form has no money field. The receipt hash is optional, and with none the duplicate gate does not run at all, rather than a fabricated hash making every second demo look like a duplicate. |
| Ask about travel / request a support letter | UC-03 | 🟢 | Free text. The classifier may describe the request; it never decides it. The router answers the plainly-safe questions, hands anything that is really work authorisation to UC-04, and holds a formal letter back for a specialist. |
| Request permission to work from another country | UC-04 | 🟡 | The fields **are** the risk matrix's inputs: origin, nationality, destination, dates, visa type, duties, whether the traveller can sign contracts abroad — and, since 2026-08-19, their **prior stays**. `travelHistory` used to be a hard-coded `[]` on the grounds that the portal has no source of prior trips; that was true and the conclusion was wrong, because it made both of UC-04's day thresholds (Schengen 90-in-180 and the 183-in-365 residency watch) unreachable from this page for every request ever filed. A stated stay is a claim, exactly like the nationality and visa type beside it, and the result panel says whose figures they are rather than implying they were read from Remote. State none and the behaviour is unchanged: 0 over 0 trips is still reported as a **floor**, never as a confirmed zero. A stay whose dates cannot be read is **refused by name**, not trimmed away — `computeCumulativeDays()` answers `NaN` for one, and NaN loses every threshold comparison silently, so a history with one bad row would clear a traveller the same history would otherwise block. |
| File a resignation and calculate notice | UC-05 | 🟡 | Both intake paths the workflow supports: an explicit proposed last working day (tagged `structured_input`, no extractor runs at all) or a pasted letter the extractor reads a date out of. The **statutory** date is always computed by the calculator; the extracted date is only ever the employee's stated intent, which is exactly what the discrepancy gate compares against. Leave the accrued days blank and the payout honestly reports `no_time_off_records` rather than a zero it never computed. State days but leave the **hourly rate** blank and the balance reaches UC-05 with the rate still MISSING, so its own gate escalates `pto_balance_unusable` (F-28) — the adapter never fills a figure the requester did not give, because a manufactured zero is a confident 0.00 payout on real accrued days (F-30). |
| Open a permanent relocation review | UC-07 | 🔴 | A structured relocation plan. The form exposes the facts that move the gates; the remainder are declared once, visibly, as `UC07_PLAN_DEFAULTS` in `server.js` rather than hidden in browser state. Transfer and mobility fees are deliberately *not* collected, so the cost estimate reads `QUOTE_REQUIRED` instead of rendering a missing quote as zero. Seniority is tri-state: "unknown" routes to legal review, which is a different and more honest answer than "resets". The PTO day count is the same kind of tri-state: left blank it stays **unset**, so a liquidated balance nobody counted is flagged `UC07_PTO_CASHOUT_NOT_COMPUTABLE` instead of being settled at zero (F-29/F-30). |
| Ask a cross-border tax or social-security question | UC-08 | 🔴 | Free text plus optional presence periods and a counting window. A partly-filled period row is dropped, never padded with a guessed date; with no target country and window, the result says the days were not counted rather than reporting a count of nothing. |
| Request an off-cycle payroll adjustment | UC-09 | 🔴 | Free text **only**, on purpose. `handleAdjustmentRequest()` treats a *structured* amount as already being in Remote's ×100 integer form (its own comment records the 100× money bug that assumption exists to prevent), while the parsed free-text path is documented as human-scale and is scaled by the workflow itself. A form field labelled "amount" would sit exactly on top of that trap. |

### 3.5 Continuing a UC-03 routing into UC-04

A UC-03 `route_to_uc04` used to end the journey. The requester was told —
correctly — that nothing had been dispatched and that a work-authorisation
request has to be raised in Remote, and then had nothing to click. The one
person who can unblock the request was the one person with no next step.

**The one distinction the flow turns on.** Remote's rule is that a Remote Work
Authorization is raised *by the employee*, in Remote's Requests section, and no
API creates one (`docs/research/CROSS-BORDER-FLOW.md` §5). This portal is the
stand-in for that surface. So the employee clicking **Continue to work
authorization** IS the employee raising it — Remote's own flow, performed on the
surface that stands in for it. UC-03's *automation* creating the same thing
would be automation raising it, which `src/uc03/uc04Intake.js` refuses and this
build does not undo. The difference between the two is a deliberate human act in
between, so that act gets its own authenticated route
(`POST /api/requests/uc03/continue`) and its own durable `audit_log` row before
anything else happens. It runs no gate, submits nothing, and creates no UC-04
record and nothing in Remote.

**What carries, and what is asked.** Five values carry — the employee, the home
country (both off the Remote employment record), and the destination and dates
(the classifier's *reading* of free text). Every one is prefilled into an
editable field and labelled with which of those two it is, because a reading is
not a fact. What is still asked comes whole from `describeUc04Intake()` rather
than a second derivation, keeping each entry's own reason — the four UC-03 has
no source for, plus any date the routing gate decided before anything looked for.

**Nationality is asked, not read.** `GET /v1/employments/{employment_id}`'s
schema has zero occurrences of `nationality`, `citizenship` or `passport`
(fetched live 2026-08-19), and neither does Remote's work-authorization object.
`src/remote/mockServer.js`'s fixtures *do* carry one, so reading it would work
perfectly, offline, forever, against a field Remote has never returned — the
fixture-agrees-with-the-code defect this repo keeps paying for. The continuation
module is handed a handoff event and never an employment record, and a test
reads its source to keep it that way.

**Both records stay tied together.** The UC-04 submission is filed under the
UC-03 request's own reference — safe by design, because `workflow_claims` is
keyed `(use_case, external_ref)` precisely so one ticket may reach two use cases
— and two `audit_log` rows (`uc03_continuation_requested`,
`uc03_continuation_linked`) name both ids, so the trail reads in either
direction. Nothing is created in Remote, so `src/uc04/requestLink.js` correctly
resolves the assessment as `unlinked`, and the panel says the verdict has
nowhere to go until the employee files the real request.

### Identity

The page sends a **persona key**; the server looks it up in `personas.js` and
builds the session itself. A key it does not know is refused with a 401 rather
than defaulted — the same fail-closed shape the identity gate itself has
(prime directive #3). Nothing in a request body can name a company, an admin id
or an employment id that a session is built from, and a request filed by the
wrong kind of persona is refused server-side: an admin cannot file an
employee's expense, and an employee cannot request their own off-cycle
payment.

UC-07 and UC-08 take no persona at all. A dossier is compiled for a specialist
and executes nothing on anyone's behalf, so there is nothing for a session to
authorise.

#### Mirrored Sandbox personas

Three of the personas — **Chris Lee**, **Emma Thompson** and **Carlos Silva** —
are keyed by employment ids that genuinely exist in the project owner's Remote
Sandbox, confirmed live 2026-08-18 against `gateway.remote-sandbox.com`:

| Persona key | Name | Real Sandbox employment id | Country | Type |
|---|---|---|---|---|
| `chris` | Chris Lee | `8ab12460-b568-4c1e-af9d-09b1fabd8f46` | US | employee |
| `emma` | Emma Thompson | `d73cff71-ced7-4bcf-b764-b9899abc6340` | GB | employee |
| `carlos` | Carlos Silva | `c2cd77da-d576-423f-b4f1-f9e40b313353` | BR | contractor |

**The reads are still the mock's.** Each of those ids resolves to a fixture in
`src/remote/mockServer.js` (its `MIRRORED SANDBOX RECORDS` block), dispatched
in-process exactly as before, so the safety property is unchanged: a publicly
reachable page cannot read or write a real Remote account. What changed is that
the name and the id on screen are ones the Sandbox owner recognises, and the id
is the genuine one — so the same persona would resolve if a surface with real
credentials were ever pointed at the live gateway.

**Only four facts per person are mirrored** — name, employment id, country, and
employment type + status. Email, salary, start date, job title, legal entity and
company id are this repo's own fixture data, deliberately `.test` addresses and
round numbers. Nothing on these records should be quoted as something the
Sandbox returned. Each persona's `note`, rendered under the sidebar picker,
prints the real UUID and says all of this in one line.

All three sit in `co_amend_01`, the same company as every other fixture, so the
existing `admin` persona (Jane Doe) files UC-04 and UC-09 requests on their
behalf. No second admin was added: the real Sandbox company id was not captured,
and a second admin scoped to an invented company would be a company nobody could
interact with.

**Each one reaches a real success, not only a refusal.** That is the point of
mirroring them at all — CLAUDE.md §4's recurring lesson is that "refuses
correctly" and "structurally cannot succeed" are indistinguishable without a
must-succeed case, so `test/portal.test.js` drives each of the three to a green
decision through its real workflow:

| Persona | Use case | Decision |
|---|---|---|
| Chris Lee | UC-02, his own clean expense `exp_sandbox_clean_401` | `auto_approve` |
| Emma Thompson | UC-05, GB statutory notice (ERA 1996 §86, 35 days) | `prepared_for_signoff` |
| Carlos Silva | UC-03, a short business trip | `auto_resolve` |

…and the refusals are pinned by *reason*, not merely by "not success": Chris's
`exp_sandbox_over_cap_402` is `human_review` / `over_policy_cap`, and a
resignation from Carlos is `escalate` / `unsupported_country` because Brazil is
not in UC-05's nine-country notice table — the correct answer, not a gap.

### Quick-fill scenarios

Every form has a row of scenario buttons whose values are copied from that use
case's own `cli.js` seed constants. At least one per form **fails a real gate**
and is labelled `refused`: someone else's expense, a same-country "workation",
notice shorter than statute, a relocation to an unsupported country, a payment
to a leaver. A refusal demonstrates the system better than a success does.

---

## 4. What the portal deliberately does not do

- **It re-implements no gate.** The only logic in `server.js` is shaping form
  fields into the ticket object each workflow documents, and shaping the return
  value into one common envelope the browser can render without branching per
  use case.
- **It offers no approve or deny control, anywhere.** The portal is an *intake*
  surface. The human gates live where they already live — the ZAF sidebar and
  each use case's own approval endpoint — and duplicating one here would create
  a second, unaudited place a 🟡 decision could be made. For UC-07 and UC-08 the
  page renders **no control at all**, not a disabled one: a disabled button says
  "you may not do this here", when the truth is that the capability does not
  exist anywhere.
- **The browser decides nothing.** `assets/app.js` holds no threshold, no tier
  comparison and no copy of a description, a tier word or a "what the human
  controls" sentence — those all come down from `GET /api/context`, which serves
  `requestTypes.js` verbatim. Its one map from a decision string to a colour is
  presentation only; an unrecognised decision still renders, with its word, in
  the neutral style. Every dynamic value is written with `textContent`, never
  `innerHTML`, because this page renders text a person typed.

---

## 5. The store boundary — read this before opening the dashboard

**The portal writes to its own in-memory stores (or its own rows in Supabase),
not to the stores the nine `npm run ucNN-api` processes seeded. A submission
made here will NOT appear in `npm run dashboard`.**

The dashboard polls each of the nine APIs, and each of those is a separate
process that seeded its own store at boot. The portal is a tenth process with a
tenth set of stores. Nothing is broken when a portal submission does not show
up there — they are simply not the same store, and joining them would mean
either running all nine servers as a hard dependency of the portal (see §2 for
why not) or having the portal write into their process memory, which it cannot
do.

The page states this in its banner and the CLI prints it on every start, rather
than leaving someone to wonder.

Audit rows are the exception in one direction: when `SUPABASE_DB_URL` is
configured, the portal's `AuditLogger` writes to the same real `audit_log`
table everything else does, and every record it creates carries
`source: "portal"` (`PORTAL_SOURCE`) so it can always be traced back to "a human
typed this into the portal" rather than "a seed script produced it".

---

## 6. Access: open locally, gated once anything is at stake

`src/portal/access.js` decides whether a request may reach any `/api` route.
The rule is copied, on purpose, from `readPosture()` in
`deploy/cx-apis/deps.js`:

```
a key is required  =  (a durable store is attached)  OR  (the deployment is public)
```

ORed, never ANDed — the platform check can **add** the requirement and can
never remove one. Those two conditions come apart in exactly one state, and it
is the state a first deploy lands in: the URL is live and `SUPABASE_DB_URL` is
not set yet, so the durability half alone would leave a public write surface
open.

| Situation | Key required? |
|---|---|
| Fresh clone, `npm run portal`, no `.env` | no — it just runs |
| `npm run portal -- --seeded` | no |
| `npm run portal` with `SUPABASE_DB_URL` set | **yes** — set `PORTAL_ACCESS_KEY` in `.env`, or use `--seeded` |
| The Vercel deployment, always | **yes** |

The key is sent as the header `x-portal-key` and compared in constant time.
The page asks for it once and keeps it in `sessionStorage` for the browser
session; nothing is ever baked into the bundle. `PORTAL_ALLOW_OPEN_ACCESS=true`
relaxes the durability half for a local demo and **cannot** open a public
deployment.

**What this is not.** It is a shared secret, so it proves possession of that
secret and nothing else — not who is asking, and not that they may act for a
given employee. It is deliberately weaker than the ZAF-signed identity the nine
review APIs use, because that mechanism is unavailable here by construction: a
ZAF token is minted by Zendesk for an app running inside Zendesk, and this page
stands in for Remote's own product surfaces. What it closes is the thing worth
closing — an anonymous caller on the internet driving a surface that writes
`audit_log` rows and use-case records.

**The page itself is not gated**, and that is a decision rather than an
oversight: it carries no data and no key, and serving it is how you are told a
key is needed. Refusing it would leave a bare 401 in a browser with no way to
supply one.

**Every refusal explains itself** — what is missing, why it is being asked for,
and where to set it — and `GET /__cx/health` on the deployment reports the
portal's posture, so "is it mounted, and is it gated?" is answerable without
making a request.

---

## 7. Layout

```
src/portal/
  server.js          the HTTP handler + the seven adapters (one per use case)
  access.js          the shared-key gate: the rule, the check, the refusals
  wiring.js          the stores and LLM seams, shared by the CLI and the deployment
  requestTypes.js    the seven types described ONCE — id, tier, description,
                     executionPath, humanControl, recordLabel
  personas.js        the demo identities the server believes are signed in
  uc03Continuation.js  the UC-03 -> UC-04 continuation, as a pure describer:
                     what carries across, what is still asked, and the one
                     distinction the whole flow turns on (§3.5)
  cli.js             `npm run portal`
  assets/
    index.html       the shell + the seven forms (field names = the adapters' contract)
    app.js           builds the nav/descriptions from /api/context, posts, renders
    style.css        only what src/shared/ui/remote-ui.css does not already provide
```

`test/portalAccess.test.js` covers §6 in both directions — an anonymous
submission is refused *and* writes nothing, and with the key the trip that must
`auto_resolve` still does. Only the second kind of test can tell a gate from a
wall.

`test/portalUc03Continuation.test.js` covers §3.5 from both sides: that the act
is real (its own route, its own durable row, and no success if that row cannot
be written), that the automation still cannot perform it, that nationality is
never read off a record, and that the two records stay tied under one reference.

`test/portal.test.js` covers all of it hermetically: the assets compile and
never write markup, all seven types reach their real workflow with a passing
and a refused input, the 🔴 no-write-path guarantee holds structurally and
behaviourally, and no file here hard-codes a port.
