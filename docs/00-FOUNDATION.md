# 00 — Foundation: Shared Platform Specification

**Read order:** This file, then `01-COHERENCY-MAP.md`, then any `UC-0X.md`.
**Golden rule:** Everything common to all 9 use cases lives *here*. A UC spec never re-defines architecture — it only declares what is different. If a UC spec and this file disagree, **this file wins.**

> **Companion, not a replacement: [`WHY-THIS-SHAPE.md`](WHY-THIS-SHAPE.md).**
> This file is the *contract* — the invariants every use case inherits, stated
> as rules. That one is the *argument*: why each rule exists, taught through the
> defect that produced it. They were deliberately kept apart rather than merged.
> A contract has to be short enough to be read before writing code and stable
> enough to be cited in a disagreement; folding a growing body of war stories
> into it would make it neither. Read this one to know what you must do; read
> that one to know what happens if you undo it.

> **Correction, 2026-08-20 — §2's two-door model is now confirmed from Remote's
> side of the wire, and one of its supporting claims is stale.** The two-entry-
> path design below was inferred from what each use case *specifies*.
> `docs/INTAKE-RESEARCH.md` §5.1 verified it against `developer.remote.com`:
> `ContractAmendment` carries a **`zendesk_ticket_url`** property — *"a link to
> the support ticket associated with this amendment, if one was created"* —
> which is this model, confirmed by Remote rather than argued by us.
> **But `POST /v1/contract-amendments` and the `contract_amendment.submitted`
> webhook both exist**, and *"no amendment-request event API exists"* (issue
> #17) is the stated reason `src/remoteui/` was built as a stand-in. Every
> sentence in this repository resting on that absence is now wrong. The
> stand-in remains useful as a credential-free demo of the flow's true starting
> point; it is no longer a workaround for something missing. Remote's intake is
> also **form-first** — structured fields to free-text running 14:6, 6:4, 8:3,
> 14:5, 7:1 across five request objects — which validates the portal's shape
> and was checked rather than assumed.

**Provenance.** This file reconciles 27 raw research/build-case documents
(`docs/research/`) via a per-topic decision process — every open conflict
between raw docs, and every claim checkable against Remote's real API, was
resolved explicitly rather than inherited from whichever doc happened to be
labeled "canonical" or "verified." The full resolution record (reasoning,
sources, live-verification results) lives on the tracking issues; this file
states only the *outcome*. Where a raw doc's own "VERIFIED" tag turned out to
be wrong on a live check, prefer the fresh check over the inherited confidence
label. That distrust is now a standing rule, not a one-off finding.

> **CORRECTED AGAIN 2026-08-21 (UC-06's decision pass) — the worked example was
> being read backwards.** This paragraph used UC-06's `automatable` pre-check as
> its example of a "VERIFIED" claim that *did not survive*. It survived. The probe
> in `src/remote/restClient.js:842–860` answered
> **`200 {"data":{"automatable":false,…}}`** on 2026-08-18 against an active NL
> employment, and the same payload with one undeclared key answered
> **`422 {"errors":{"base_salary":["is not accepted"]}}`**. Both are answers only a
> live endpoint gives. **`POST /v1/contract-amendments/automatable` exists.**
> `qa/contracts/UC-06-acceptance.md` DRIFT-028 and `[A-14]`.
>
> **What actually happened here is worth more than the fix.** The correction pass
> that ran hours earlier fixed two of the three examples in this sentence and
> **restated the third more confidently than the original had** — "the one that
> held". Of the three endpoints this file once declared absent, **two demonstrably
> exist. **The third was re-probed on 2026-08-21 and HOLDS** — UC-07's atomic
> country-transfer endpoint, DRIFT-099 / `[A-15]`, discharged *before* UC-07's
> decision pass exactly as required. Remote's own `llms.txt` returns **zero
> matches** for `relocat`, `country transfer`, `country-transfer`,
> `entity transfer`, `internal transfer` and `mobilit`. So the final tally is
> **one right, two wrong**, and a sentence with that record should not be carrying
> any example at all, so it no longer does.
>
> **One word has to be added to the surviving claim, and it is load-bearing.**
> The absent thing is an **API**, not a capability. `docs/INTAKE-RESEARCH.md` §75
> records that Remote's *product* has a **Country Transfer Service** — *Employee
> profile → Country Transfer Service → relocation form*, **"Structured form,
> employer-driven"**. Writing *"Remote has no country transfer"* overstates in
> Remote's disfavour and is **the identical over-reach that made the other two
> wrong**: a limit of the partner API is not a limit of the platform, in the same
> way that a Sandbox refusal is not the platform answering. See §2a's ladder,
> rung 1.

> **CORRECTED 2026-08-21 — this sentence used to name three examples and two of
> them were wrong.** It read: *"it happened repeatedly (UC-05's resignation
> endpoint, UC-06's `automatable` pre-check, UC-07's atomic country-transfer
> endpoint all don't exist)."* **UC-05's resignation endpoints do exist** —
> `GET /v1/resignations/{offboarding_request_id}`, `GET .../resignation-letter`
> and `PUT .../validate`, all three in Remote's own `llms.txt` index and all
> read from `developer.remote.com` (`docs/REMOTE-API-INDEX.txt:328–330`;
> `qa/contracts/UC-05-acceptance.md` DRIFT-063). They are keyed by
> **`offboarding_request_id`**, not by a resignation id, and a probe with the
> wrong id — or a token lacking `resignation:read` — returns a `404` or a `403`
> indistinguishable from "no such endpoint". **UC-07's claim is untested and is
> not asserted here either**; only the UC-06 example was ever written down with
> its probe, and it is the one that held.
>
> **The rule this sentence states is right and its evidence was discrediting
> it.** The lesson is unchanged and sharper: *a tool or a probe that cannot
> reach a service says nothing about the service* — which is the same rule
> `CLAUDE.md` §6 records for a proxy `403` and for a dead employment id.

---

## 1. What we are building

A production-grade CX automation layer for Remote (an Employer-of-Record platform), demonstrating the pattern:

> **LLMs reason and transform context; deterministic infrastructure executes state changes.**

LLMs handle intent classification, unstructured extraction, multilingual dialogue, and dossier synthesis. They are **never** allowed to directly execute payroll updates, contract changes, or compliance decisions. All state changes pass through deterministic validation + (where risk requires) human approval.

---

## 2. Architecture — the six layers

> **Two entry paths, not one.** Zendesk is not the universal front door — it
> never was, once you look at what UC-02/04/05/06/09 actually specify. A
> request enters this system one of two ways, decided per use case, never
> uniformly:
>
> - **Remote-native webhook** (02, 04, 05, 06, 09) — the employee/admin
>   already acted inside Remote's own product (submitted an expense, filed a
>   work-authorization request, resigned, requested a contract amendment, a
>   drafted off-cycle incentive). A Remote object already models the request,
>   so there is nothing for Zendesk to receive at intake — the automation
>   reacts to the webhook directly.
> - **Zendesk ticket** (01, 03, 07, 08) — the request is a genuine inquiry
>   with no corresponding Remote object ("can I get a letter," "can I work
>   from Spain," "what about my taxes"). There is no webhook to react to
>   because nothing was created anywhere else — the ticket *is* the request.
>
> **Zendesk is not bypassed for the webhook-triggered UCs — it is used more
> deliberately.** Identity verification, deterministic gates, and
> fact-gathering run against the webhook event first. Only once that is done
> does the automation **create the Zendesk ticket itself**, via the API —
> pre-tagged, pre-populated with everything already gathered — to host the
> shared ZAF sidebar for whichever human needs to act. Every use case that
> needs a human ends up on the same ZAF review surface either way; only the
> *first* touch differs (raw ticket vs. webhook-then-authored-ticket). A
> zero-touch resolution on the Remote-native path (e.g. UC-02's auto-approve,
> UC-06's `automatable: true` path) may never need a ticket at all — the
> durable record of what happened lives in `audit_log`/`cases` regardless,
> which is the actual system-of-record log, not Zendesk.

```
     Remote-native event                    Genuine inquiry
  (employee/admin acted in                (no Remote object
   Remote's own product)                    corresponds to it)
             │                                      │
             │ webhook                              │ submits ticket
             ▼                                      ▼
   ┌──────────────────────┐              ┌─────────────────────────┐
   │  n8n Orchestration    │◄─────────────│  Zendesk Support + ZAF  │
   │  (normalize, route,   │              │  (ticket = intake here) │
   │   retry, async)       │              └─────────────────────────┘
   └───────────┬───────────┘
             ┌───────────────┼─────────────────┐
             ▼               ▼                 ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ Identity +   │ │ RAG Knowledge│ │ Remote MCP Server│  ← READS (OAuth2 PKCE)
   │ Risk Engine  │ │ Store (policy│ │ (live employment │
   │              │ │ / legal)     │ │  context)        │
   └──────┬───────┘ └──────────────┘ └──────────────────┘
          │  risk tier decision
          ▼
   ┌──────────────────────────────────────────────────┐
   │  ROUTER:  Low → zero-touch │ Med → HITL │ High → escalate │
   └──────┬─────────────────┬───────────────────┬──────┘
          ▼                 ▼                   ▼
   Auto-execute      Zendesk ticket authored  Dossier + escalate
   (ticket optional)  by automation (if none   (no execution)
          │            existed yet) → ZAF
          │            sidebar review
          │            (1-click approve)
          ▼                 ▼
   ┌──────────────────────────────┐
   │  Remote REST API (WRITES)     │  ← deterministic, OAuth2, schema-validated
   └──────────────┬───────────────┘
                  ▼
            Remote system of record
                  │ webhooks (state changed)
                  ▼
            n8n → Zendesk update + notify + audit log
```

**Layer responsibilities**

| Layer | Responsibility | Never does |
|---|---|---|
| Zendesk + ZAF | Ticket intake for genuine inquiries (01, 03, 07, 08); agent HITL UI for every UC, ticket authored by the automation itself for the Remote-native ones | Business logic; being treated as universal intake |
| n8n | Orchestration, normalization, retries, async polling, notifications | State decisions without validation |
| Identity + Risk engine | Authenticate requester, score risk, pick tier | Guess identity from a claim |
| RAG store | Retrieve policy/legal context with citations | Be treated as authoritative law |
| Remote MCP | Deliberate AI-assist reads (conversational lookups) | Serve as the deterministic backbone |
| Remote REST API | Authoritative reads *and* writes for backend automation | Accept unscaled money / unvalidated schema |

> **MCP positioning.** Remote's MCP server exposes **both reads and writes** — so "MCP can't write" is not the reason to keep it off the backbone. The real reason is the **auth model**: MCP authenticates with OAuth2 PKCE through an interactive browser sign-in, and its write tools act *on the authenticated user's behalf*. That is user-delegated, session-bound, and consent-driven by design — structurally the wrong shape for an unattended service that must run without a human present, retry idempotently, and attribute every action to a system actor in an audit log. Confirmed directly from Remote's own real MCP product, not just reasoned by analogy: its docs state **"Whatever permissions you have in Remote, you have through the CLI/API/MCP"** — built around an already-authenticated human, not a service account.
>
> So: **REST is the backbone for deterministic retrieval and all writes; MCP is a small, deliberate AI-assist capability** for conversational lookups where a human *is* in the loop, never the pipeline for any UC's automated core. Knowing *when not to use MCP* — despite it being a named requirement — is a stronger signal than forcing it everywhere.
>
> **Remote ships a real, public MCP product**: `remote.com/remote-mcp` (OAuth2 browser sign-in; "Connect ChatGPT, Claude, Cursor, or any MCP-compatible client... query live workforce data, automate workflows"). It has a confirmed **Sandbox-compatible endpoint**, `https://mcp.remote-sandbox.com/mcp` (vs. production `https://mcp.remote.com/mcp`), preloaded with sample employees/contracts/payroll/expenses — the same Sandbox account this project already uses, no mocking needed. This changes the project's MCP-fluency plan from "build a generic proxy to prove the concept" to "primarily demonstrate real, documented hands-on use of Remote's own MCP against Sandbox" (roadmap items: a documented live Sandbox-MCP session, and optionally a small custom MCP server wrapping this project's own case data) — a stronger, more directly relevant claim against the named-tooling requirement than a standalone proxy would be.

---

## 2a. The substitution ladder — where a fact is allowed to come from

**Stated by the project owner on 2026-08-21, and load-bearing enough that it is
repeated in `CLAUDE.md` §3, `docs/00-FOUNDATION.md`, `docs/WHY-THIS-SHAPE.md` and
every acceptance contract that leans on it.** It existed as practice — the payroll
projection, the enrichment proxy, the mock's captured shapes — but it had never
been written as a rule, so each new instance was re-argued from scratch and one of
them (`src/remotebridge/payrollProjection.js`) needed an explicit instruction
before it was allowed to exist at all.

Four rungs. **Always take the highest rung that can answer the question.**

| | Rung | Source | Example |
|---|---|---|---|
| 1 | **Remote's own documentation is the source of truth.** | `developer.remote.com`, its OpenAPI, its `.md` pages | Field names, enums, required lists, verbs, status machines |
| 2 | **Where the Sandbox holds relevant data, use the Sandbox.** | `gateway.remote-sandbox.com` | Employment records, countries, real payroll cycles, live schema fetches |
| 3 | **Where the Sandbox refuses or lacks the capability, replicate it in our own stand-in.** | `src/remoteui/`, `src/remotebridge/`, `src/remote/mockServer.js` | A resignation the partner API cannot create; a work-authorization request with no `POST`; an employment field the Sandbox left null |
| 4 | **Where no relevant data exists at all, fabricate.** | A named fixture | A payroll cycle past the calendar's end; an `automatable: true` response never captured live |

**Rung 1 is never overridden by a lower rung.** If Remote's documentation says a
field is an integer, a Sandbox record carrying a quoted number does not make it a
string — it makes that record a thing to handle, not a shape to copy.

**Two constraints make rungs 3 and 4 safe, and neither is negotiable:**

1. **A substituted fact is always self-identifying.** A projected payroll cycle's
   id begins `standin-` and carries `_standin {projected, derivedFrom, cadence}`;
   an enriched field is named in an `X-Standin-Enriched` header and a `_standin`
   body block; the audit row carries `cutoffCycleProjected` so an auditor is told
   rather than left inferring from an id prefix. **Nothing fabricated may reach a
   reader looking like something Remote said.**
2. **Money is never fabricated.** `total_payroll_cost` and `approval_date` stay
   null on a projected cycle for exactly this reason. A cadence can be continued;
   an amount cannot be invented. This is the one rung-4 prohibition with no
   exception.

**And a third that is about honesty rather than safety:** a real value always
wins. Rung 3 may only fill what rung 2 left empty, and rung 4 only what rung 3
cannot reach. `src/remotebridge/enrichment.js` fills **only** fields the real
Sandbox returned as null, and `payrollProjection.js` never touches a real cycle.

**Why this is written down rather than assumed.** Three separate times this
repository has treated a Sandbox limitation as a fact about Remote's platform —
UC-05's resignation endpoint, UC-06's `automatable` pre-check and UC-07's atomic
country-transfer endpoint were all recorded in `00-FOUNDATION.md` as *not
existing*, and two of the three turned out to exist. A Sandbox that refuses is
rung 2 failing, not rung 1 answering. The ladder makes that a routine
substitution instead of a finding.

**The third was finally checked on 2026-08-21, and it holds** — but checking it
produced a fourth lesson the first three did not. The endpoint really is absent;
the **capability is not**. Remote's product has a Country Transfer Service
(`docs/INTAKE-RESEARCH.md` §75) that the partner API simply does not expose. So a
claim can be true about rung 1's *API surface* and false about rung 1's
*platform*, and the two are one word apart. **Name which one you checked.**

**A fifth lesson, 2026-08-21, and it is the first one running the other way.**
The four above are all about **negatives** — a claim that something does not
exist, decaying. This one is a **positive**: `docs/use-cases/UC-08.md` §5 named a
data source for the presence-day count — *"time-off + workation custom fields"* —
carried it as `[CONFIRMED — capability exists; specific endpoint shape not yet
verified]`, and turned it into build task 4. **The source cannot produce the
figure.** `Timeoff` has **no country property and no location property of any
kind** (`timezone` is an IANA identifier whose own example is `Etc/UTC`); a
workation is somebody *working*, so it generates **no time-off record at all**;
and custom fields are `{custom_field_id, name, type, value}` with **no dates**.
Meanwhile `GET /v1/travel-letter-requests` and
`GET /v1/work-authorization-requests` carry `destination_country`,
`travel_date_start`, `travel_date_end` and `status`, filterable by
`employment_id` — dated, located, employer-approved, and never read
(`qa/SPEC-DRIFT-INDEX.md` DRIFT-106/DRIFT-107).

So the rule generalises past negatives: **any claim about someone else's API is a
claim, whether it asserts absence or presence, and both decay.** Note where the
check should have started — the tag's own second half, *"specific endpoint shape
not yet verified"*, was honest and was read for months as a licence to build on
the first half. **"Capability exists" and "this object carries this field" are
different assertions**, and only the second one can be built on.
`docs/WHY-THIS-SHAPE.md` §17 is the long form.

---

## 3. Tech stack (decided — do not re-litigate per UC)

| Concern | Choice | Notes |
|---|---|---|
| Orchestration | **n8n** (self-hosted, docker) | The named orchestration requirement; workflows exported as JSON to repo |
| Support platform | **Zendesk** (free dev account) | ZAF v2 sidebar app |
| Remote reads | **Remote MCP server** | OAuth2 PKCE; role/RLS aware |
| Remote writes | **Remote REST API** | Validated against live OpenAPI |
| Remote test target | **Sandbox + local mock server** | Mock mirrors OpenAPI; sandbox for integration tests |
| LLM | Claude (via API) | Intent, extraction, drafting, dossiers |
| Vision/OCR | Claude vision | UC-02 receipts |
| RAG | Vector store (e.g. pgvector or Chroma) + embeddings | Citations mandatory |
| PDF rendering | Headless renderer (e.g. Playwright/Puppeteer or WeasyPrint) | Letters (UC-01, UC-03) |
| Audit log | Append-only store (Postgres table) | Every action, every UC |
| Language/runtime | **JavaScript (Node 20+, ESM)** | Plain JS with JSDoc types. Chosen over TypeScript deliberately: no build step means the repo clones and runs in one command, which matters more for a reviewable system of this size than compile-time types. |

> **Reality check (kept current).** The table above is the *target* stack. As
> built today: the LLM is **OpenAI** (`gpt-4o-mini` in this repo's default; the live
> deployment sets `OPENAI_MODEL=gpt-5-nano` — CLAUDE.md §7 item 22) behind a single-file
> provider seam at `src/shared/llm.js` — swapping providers is one file.
> RAG/pgvector is built in one place — UC-08's treaty retriever
> (`src/uc08/treatyRetriever.js`, embedding similarity over a pgvector table,
> issue #29) — while vision and PDF rendering are still
> **specified but not yet built**; they are
> needed first by UC-02 (vision), UC-03/04/07 (RAG beyond the treaty corpus)
> and UC-01/03 (PDF).
> `docs/BUILD-LOG.md` §1 is the authoritative build-status table.

---

## 4. Global invariants — enforced once, inherited by all

These caused the most inconsistency across your source docs. They are now shared middleware. Every UC uses them; no UC re-implements them.

1. **Integer currency scaling (×100).** Every monetary value to/from the Remote API is an integer = amount × 100. Middleware divides by 100 before LLM context and multiplies by 100 before REST dispatch. `$50,000.00 → 5000000`. Failing this = catastrophic payroll error. *(Critical for UC-02, UC-05, UC-06, UC-09.)*
2. **Dynamic per-country JSON schema.** Employment fields differ by jurisdiction. Before any write, query the active country schema (`GET /v1/countries/{code}/employment_basic_information`) and validate the payload against it. Never assume static fields. *(Critical for UC-06, UC-07.)*
3. **OAuth2 PKCE** for all Remote access (MCP and REST). No API keys hard-coded.
4. **Async pattern awareness.** Some ops (GL reports, PDF/CSV cost estimates) are create→poll→download, not synchronous. n8n handles the polling loop.
5. **Webhook-first, not polling.** Prefer Remote events (`expense.approved`, `payslip.released`, `timeoff.approved`, …) over polling for status.
6. **Idempotency + rate limiting** on every write path.
7. **Audit everything, at two levels, not one.** Every completed request gets
   the existing durable summary row (timestamp, requester identity, UC id,
   risk tier, inputs, LLM outputs, human approver if any, final result) — but
   that alone only traces requests that reached the end successfully. So
   every LLM call and every Remote/Zendesk API call also gets its own trace
   entry (attempted/succeeded/failed/fell-back), written as it happens, not
   assembled after the fact. This is what makes a failed or abandoned attempt
   traceable at all, and it's what a redundant/duplicate-call check
   (`docs/METRICS.md`) or a "why did this fail at 3am" investigation actually needs —
   a single end-of-request summary row structurally cannot answer either.
   **Status: built** — `AuditLogger.logTraceStep()` (`src/shared/audit.js`)
   records each attempt (attempt number, which call, success/failure, error)
   and links it to its parent decision row's id, persisted to a new
   `audit_trace` Supabase table (RLS enabled, zero policies, same pattern as
   `audit_log`; the table itself is provisioned directly against Supabase by
   the project owner — no migration file ships in this repo). Wired so far at
   ONE call site, the UC-01 classifier's LLM call, as the end-to-end proof;
   the remaining call sites get their tracing via the retry wrapper
   (invariant 10).
8. **Any LLM-call-with-rule-based-fallback function tags which path it
   took.** The returned object carries `source: "llm"` or
   `source: "rule_based_fallback"` — never left implicit. This was found
   missing in the canonical implementation (`src/uc01/classifier.js`) despite
   already being present in that same logic's n8n port
   (`workflows/nodes/validateClassification.js`), which is backwards: a
   reference implementation should never be less observable than its own
   copy. **Status: built** — `classifyRequest()` tags every classification;
   `test/uc01.test.js` proves both the LLM-success and every fallback trigger
   (unconfigured, network error, invalid JSON, schema mismatch) hit the right
   tag, and that `classifyRequestRuleBased()`'s own shape stays untagged.

   **Deliberate exception, decided `rca-v13` 2026-08-22, re-verified
   2026-08-23:** `classifyRequestRuleBased()` itself does NOT tag `source` —
   that is correct, not a gap. The tagging seam is the *wrapper*
   (`classifyRequest()`), because only the wrapper knows the provenance:
   whether the LLM was tried and failed (`"rule_based_fallback"`) or was
   never configured at all. The raw rule-based function has no way to
   distinguish those cases, so tagging inside it would either lie — labelling
   a deliberate direct call a "fallback" when nothing fell back — or force it
   to invent a value it has no information to choose. `test/uc01.test.js`'s
   test 15 pins this shape deliberately (its own name states the design), and
   the production journey is unaffected: `handleVerificationTicket()`
   (`src/uc01/workflow.js`) defaults `classify` to the tagged
   `classifyRequest()` wrapper, so acceptance §16 item 5 is satisfiable as
   built. The only surfaces where `classification.source` reads `undefined`
   are callers that inject the raw function directly — `src/metrics/seed.js`,
   the playground, and the chat demo — none of which are on the production
   path. If one of those non-production surfaces wants a `source` value, the
   *caller* tags it, with an honest value distinct from the fallback one
   (e.g. `source: "rule_based"` meaning chosen directly, never
   `"rule_based_fallback"`) — optional polish, not required.
9. **Curated 9-country scope for all per-country logic.** Remote serves 90+/80+ countries; no public data exists on Remote's actual per-country volume, so a portfolio project can't prioritize by real demand. Instead, build and live-verify country-specific rules (tax-residency thresholds, totalization/treaty coverage, immigration/visa gates, notice-period rules) against a fixed 9-country list chosen for **rule-shape diversity**, so every branch the architecture needs gets exercised at least once: **UK** (no single day-threshold — ties-based sliding scale; proves the system escalates instead of guessing a number that doesn't exist), **Ireland, Germany, Poland** (EU/EEA A1-certificate coverage — "confirmed coverage" cases), **India, Philippines, Mexico** (high real-world EOR volume, no US totalization coverage — "no coverage, treat conservatively" cases), **Canada** (on the US totalization list — contrast case), **Portugal** (real Digital Nomad Visa — exercises the immigration-legality-as-document gate specifically, not just tax). Any country outside this list falls through to **escalate-by-default** — correct behavior per every UC that touches country rules, not a gap. Applies to UC-04, UC-07, UC-08, and any future UC touching country-specific logic.

   > **Note 2026-08-21: UC-05's notice table is deliberately NOT this nine.** It
   > now holds **eleven** rows — the nine above plus **NL** (added 2026-08-20 with
   > a retrieved statute, D-01/D-40) and **US** (added as a *sourced absence*,
   > D-06). The additions were driven by the four-country demo set
   > (`docs/DEMO-COUNTRIES.md`), not by this rule-shape argument, and the two
   > lists should not be conflated. Related and decided but not yet built:
   > **Canada moves to the sourced-absence shape** — it is the only demo country
   > whose signable figure has no retrieved statute behind it
   > (`CONTRADICTIONS.md` C-30, `qa/contracts/UC-05-acceptance.md` `[N-7]`).
10. **Retry-then-escalate on transient API failures.** A failed LLM call is
    retried up to **3 attempts with backoff** before being treated as a
    permanent failure; if it still fails, the case falls back to the existing
    deterministic path rather than silently erroring out mid-workflow or
    (worse) silently skipping a step. Ties directly to invariant 7 above: a
    call that fails once and succeeds on retry produces two trace entries
    (one failed, one succeeded), not a hidden one — the same tracing
    mechanism serves both, via `onAttempt`. **Status: built** —
    `src/shared/retry.js`'s `withRetry()`, wired into the UC-01 classifier,
    UC-06's `changeParser.draftSummary()`, and UC-08's
    `dossierBuilder.draftNarrative()` (issue #32, closing #19). n8n's native
    per-node "Retry On Fail" + "Wait Between Tries" settings remain the
    mechanism for the n8n workflows; the Remote/Zendesk REST clients are not
    yet wrapped — this pass covered the three LLM call sites named in the
    ticket, not every API call in the app.

---

## 5. Risk-tiering framework + routing

Every ticket is classified into one tier; the tier dictates the execution path.

| Tier | Definition | Execution | Human role | UCs |
|---|---|---|---|---|
| 🟢 **Low** | Reversible, low-liability, standard template | **Zero-touch** auto-execute after deterministic validation | None (exception-gated) | 01, 02, 03 |
| 🟡 **Medium** | Financial/contractual impact, but boundable | **HITL** — AI prepares + risk-scores, specialist approves via ZAF 1-click | Approver | 04, 05, 06 |
| 🔴 **High** | Legal/tax/compliance liability, irreversible | **AI never executes unilaterally** (see below — not uniformly zero-execution) | Author (07/08) / dual approver (09) | 07, 08, 09 |

> **🔴 High tier's rule is "AI never executes unilaterally," not "AI never executes."** These are not the same constraint, and collapsing them was an earlier framing bug (raw UC-09 docs specified a real bank-payout Tier with **zero** human sign-off for low-risk-scored cases, which the "no execution" framing would have quietly let through as an exception rather than a contradiction to catch). The actual rule, and how each High-tier UC satisfies it:
> - **07, 08 — dossier-only, structurally zero execution.** The function that builds the dossier takes no write-capable client as a parameter at all — there is no execution path to accidentally wire up later, not merely a policy that refuses to call one. A human specialist executes every step entirely outside the system.
> - **09 — real execution, gated on independent dual-human approval.** AI fully prepares the transaction (calculation, tax, compliance checks); the system executes a real write only after two independent humans approve — segregation of duties (requester ≠ approver ≠ payment releaser), never single- or zero-approval, **at any composite risk score**. A risk score cannot be trusted to decide *whether* a human is involved, only how many above that floor; a "low risk" auto-payout is exactly the failure mode a hard floor of two humans exists to catch.
>
>   **Correction, 2026-08-21 — this sentence describes an intention, not the code.**
>   *"requester ≠ approver ≠ payment releaser"* names three **parties**, and only
>   the second and third are actually enforced against each other.
>   `src/uc09/multiApprovalPolicy.js` compares the three approval **slots** and
>   never compares any of them to `adjustment_row.requester`, the column recording
>   who filed the request — so the person who asked for a payment could sign the
>   box approving it. The floor of two distinct signatures is real and holds; what
>   does not hold is *which* two. **Decided 2026-08-21, reading (A): the filer may
>   fill the `requester` slot and no other.** DRIFT-050 and DRIFT-110 in
>   `qa/contracts/UC-09-acceptance.md`; build items `[P-1]` and `[P-2]`. Note that
>   ADR 0005 asserts the opposite — that UC-09 already holds this *"in its
>   strongest form"* — and its correction is queued **ahead of** the code change.
>
> Money-movement automation with proper controls is real product value — the risk lives in *unilateral* execution, not in execution per se. That's why 09 gets a real write path and 07/08 don't: 09's downside (a bad payroll adjustment) is caught and reversed by the same dual-approval + audit trail that gates it; 07/08's downside (a botched cross-border relocation or a wrong tax position) is not something a second approver reliably catches after the fact, so those stop at "AI recommends, human does."

**Routing decision tree** (implemented in n8n + risk engine). `Ticket` below
means "the intake, whichever shape it took" — a Zendesk ticket for 01/03/07/08,
a Remote-native webhook for 02/04/05/06/09 (§2 above):
```
Ticket/webhook → deterministic identity verify → intent classify (LLM)
      → risk score (rules + tier table)
      → LOW  : validate → auto-execute → resolve + audit (ticket authored
                only if a customer-facing reply is needed, e.g. UC-01's
                letter; UC-02's auto-approve never needs one)
      → MED  : gather facts + score → author/update Zendesk ticket if none
                exists → ZAF sidebar → on approve → execute → audit
      → HIGH (07/08) : gather facts → generate dossier → author/update
                Zendesk ticket → escalate; no execution path exists
      → HIGH (09)     : gather facts → prepare transaction → author/update
                Zendesk ticket → require TWO independent approvals
                (requester ≠ approver ≠ releaser) → execute → audit
```

---

## 6. Cross-cutting components (build once, in foundation)

Every UC imports these. This is the heart of the coherency win.

- `identity-service` — verify requester against Remote employment/user records; never trust a claim.
- `risk-engine` — deterministic tier classifier + escalation rules.
- `money-middleware` — the ×100 scaling in/out.
- `schema-validator` — dynamic per-country schema fetch + payload validation.
- `rag-retriever` — query + return chunks **with citations**; used by 03/04/07/08.
- `mcp-client` — authenticated Remote MCP read wrapper.
- `remote-rest-client` — authenticated write wrapper, OpenAPI-validated, idempotent.
- `zaf-sidebar` — shared Zendesk app shell; each HITL UC registers a panel. **Built** (`zaf-app/`, backed by `src/review/`): `assets/main.js` is the shell (decision, flags, reason, approve/deny), `assets/panels.js` is the registry a UC registers into. UC-01 has a panel; UC-06 adds a key, not a second app. The shell renders and the API decides — whether the buttons appear comes from `src/review/reviewPolicy.js`, never re-derived in browser JavaScript.
- `audit-logger` — append-only writer. Two levels (§4 invariant 7): the
  existing one-row decision summary, plus a per-step trace entry for every
  LLM call and every Remote/Zendesk call, so a failed or abandoned attempt is
  traceable and not just a completed decision. **The trace-entry half is
  built** — `AuditLogger.logTraceStep()`, backed by an `audit_trace` table;
  wired so far only at the UC-01 classifier's LLM call (§4 invariant 7).
- `disclaimer-injector` — appends mandatory legal disclaimers (03/07/08).
- `pdf-service` — letter rendering (01/03).
- `mock-remote-server` + `sandbox-client` — the test harness.
- `narrative-judge` — a scoped LLM-as-judge check, used only where an LLM
  drafts customer/specialist-facing prose from already-decided facts (UC-06's
  `draftSummary()`, UC-08's dossier narrative) and nowhere else. It scores
  faithfulness to the structured inputs it was given — never a general
  accuracy/quality benchmark, since that would need a real historical
  support-ticket dataset this project doesn't have and won't fabricate (same
  discipline as every `[UNCONFIRMED]` ticket-volume claim elsewhere in these
  docs). **Built** (`src/shared/narrativeJudge.js`, issue #27) — pure-
  informational verdict attached to the case/dossier for a human; never a
  second decision input. On any failure (LLM error, invalid shape, judge
  unconfigured) it attaches an explicit `{verdict: "not_evaluated"}`
  sentinel rather than fabricating a positive OR negative verdict.

---

## 7. Repository structure

A flat `src/` layout, not a `packages/` monorepo. With one runtime, one
dependency set and no build step, workspace tooling would add ceremony without
buying anything. Each §6 component is **one file** in `src/shared/` — the module
boundary is the file, and it is enforced by imports rather than by package
manifests.

```
remote-cx-automation/
├── CLAUDE.md                     # build instructions for Claude Code
├── README.md                     # portfolio-facing overview
├── .env.example                  # every credential the system can use
├── docs/
│   ├── 00-FOUNDATION.md          # (this file)
│   ├── 01-COHERENCY-MAP.md
│   ├── BUILD-LOG.md              # authoritative build status + decision log
│   ├── SETUP-CHECKLIST.md
│   ├── use-cases/UC-01.md … UC-09.md
│   ├── research/                 # raw source research the specs distil (27 docs)
│   ├── verification/             # live-API + business-case findings that ground a UC's decisions
│   └── adr/                      # architecture decision records — the hard-to-reverse calls, one file each
├── src/
│   ├── shared/                   # cross-cutting components (§6), one file each
│   │   ├── identity.js  risk-engine → riskEngine.js  money.js
│   │   ├── schemaValidator.js  disclaimer.js  audit.js
│   │   ├── caseStore.js  llm.js  config.js  db.js
│   │   └── (rag-retriever in `src/uc08/treatyRetriever.js`, mcp-client — the latter not yet built)
│   ├── remote/                   # REST client + OpenAPI-mirrored mock server
│   ├── zendesk/                  # REST client + ticket normalizer + mock server
│   ├── uc01/                     # per-use-case logic: classifier, gates, workflow
│   ├── review/                   # the HITL gate: approval policy + the sidebar's API
│   ├── metrics/                  # impact measurement + dashboard renderer
│   └── liveVerify.js             # one real pass against every live service
├── zaf-app/                      # the ZAF v2 sidebar: shared shell + per-UC panels
├── workflows/                    # n8n workflow JSON exports, one per UC
├── test/                         # scenarios per UC (hermetic — never hits network)
└── demo/                         # generated artifacts + seed data
```

Not yet created, and named here so their absence is explicit rather than
implied: `rag-corpus/`, `docker-compose.yml`, `pdf-service`.

---

## 8. Definition of done (per UC — non-negotiable)

Documentation and auditability are part of "done" here, not something added
afterwards if time allows. So:

1. Working n8n workflow exported to `workflows/uc-0X.json`.
2. All writes validated against live OpenAPI; money scaled; schema-checked.
3. HITL/escalation path implemented where the tier requires it.
4. Audit log entries produced and inspectable.
5. End-to-end test in `tests/` passing against mock (and sandbox where possible).
6. `UC-0X.md` kept accurate to what was built.
7. A reproducible demo in `demo/` (seed data + a script/Loom-ready walkthrough).
8. Success metrics defined and measurable.

---

## 9. Evidence hierarchy (carry into every claim)

When a UC spec asserts an endpoint or behavior, tag it so nothing is presented as guaranteed when it isn't:

- **[CONFIRMED]** — in Remote official docs / OpenAPI / MCP docs.
- **[VENDOR-PUBLIC]** — implied by Remote's public product, support and operations content.
- **[INFERRED]** — reasonable architectural bridge.
- **[PROPOSED]** — custom portfolio orchestration.

Before building any write path, upgrade **[INFERRED]** endpoint schemas to **[CONFIRMED]** by fetching `developer.remote.com/llms.txt` (OpenAPI).

> **Trust a raw doc's own "VERIFIED" label with suspicion — it is not the same tag as [CONFIRMED] above.** Live spot-checks against `developer.remote.com` have repeatedly falsified raw docs' self-declared "VERIFIED" claims — but **this sentence's own examples were falsified in the other direction, twice, and are now removed.** It once named three endpoints as not existing: UC-06's `/contract-amendments/automatable`, UC-05's resignation endpoint, UC-07's atomic country-transfer endpoint. **UC-05's three resignation endpoints exist** and are in Remote's own index (corrected 2026-08-21; `qa/contracts/UC-05-acceptance.md` DRIFT-063). **UC-06's `/contract-amendments/automatable` exists** — `200` and `422` bodies both captured live on 2026-08-18 in `src/remote/restClient.js:842–860` (corrected 2026-08-21; `qa/contracts/UC-06-acceptance.md` DRIFT-028, `[A-14]`). **UC-07's atomic country-transfer endpoint genuinely is absent** — re-probed 2026-08-21 against Remote's own `llms.txt`, zero matches on six terms, discharging DRIFT-099 / `[A-15]`; it is the **one of the three that survived**, and it is recorded as a confirmation rather than quietly dropped, because a register that only ever reports faults teaches its reader to distrust everything equally. **Note the word `API`:** the *capability* exists as a product surface (`docs/INTAKE-RESEARCH.md` §75, Country Transfer Service, employer-driven), and omitting `API` would repeat the over-reach that made the other two wrong. Two of three wrong is not a rounding error in a document a UC spec never overrides — and the generalisation is rung 2 of §2a's substitution ladder: **a Sandbox that refuses is rung 2 failing, not rung 1 answering.** A doc's own confidence label reflects what its author believed at write time, not a fresh check. Prefer re-verifying a load-bearing claim over inheriting its label.

This evidence discipline extends to business value, not just API shape: a claim like "this reduces Remote's biggest support bottleneck" is exactly as unverifiable from outside the company as an invented endpoint, and gets the same tagging treatment — see the Business Case step below.

---

## 10. The UC spec template (every UC-0X.md follows this exactly)

0. **Business case** — hypothesized problem + cost mechanism (tagged [CONFIRMED]/[VENDOR-PUBLIC]/[INFERRED]/[PROPOSED], same discipline as API claims — never assert ticket-volume or bottleneck-severity as fact; no public source can confirm Remote's internal support data); confirmed-vs-assumed table; the specific data that would confirm or kill the case; what ships regardless of that data vs. what's gated on it. This is about surviving a real conversation with Remote's business stakeholders, not just technical correctness — "knowing when not to automate" is graded as highly as building. See `docs/verification/uc06-business-case.md` for the template this was built from.
1. **Summary** — trigger · risk tier · automation boundary · primary actor
2. **Trigger & user story**
3. **Data sources** — Remote endpoints (with evidence tag) + RAG indices
4. **Tools** — MCP reads used · REST writes used
5. **Workflow** — ordered n8n steps + a diagram
6. **LLM reasoning scope** — what the LLM does · what it must NOT do
7. **Deterministic logic** — validations, calculations, money scaling, schema checks
8. **Human control points** — HITL gates / ZAF panel / escalation
9. **Failure modes & fallbacks** — with escalation routing
10. **Audit & logging** — what gets logged
11. **Success metrics**
12. **Test plan** — sandbox + mock scenarios, edge cases
13. **Build tasks for Claude Code** — ordered checklist
14. **Foundation dependencies** — which §6 components it imports

This uniformity is what lets Claude Code build 9 use cases without re-learning the architecture each time.
