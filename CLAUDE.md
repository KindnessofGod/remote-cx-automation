> **Note for readers arriving from the public repository.**
>
> This is the engineering journal the build ran against — the gotchas, the
> decision record, and the honest list of what is still broken. It is included
> because the code cites it by section throughout, and because how a system is
> reasoned about is part of the system.
>
> Two things are held back in a private working repository and will therefore
> appear here as references to files you cannot open: the multi-agent
> orchestration contract (`qa/orchestration/`, `qa/handoffs/`) and the raw
> per-run evaluator evidence (`qa/evidence/`). The findings from that evidence
> are summarised in [`docs/QA-EVIDENCE.md`](docs/QA-EVIDENCE.md).
>
> Live host names, support-account names and credential handles have been
> replaced with placeholders. Nothing here was ever a secret — the repository
> has never contained a credential — but an inventory of real endpoints is not
> something a portfolio needs to publish.

---

# CLAUDE.md — project context and build instructions

## START HERE — read the acceptance contract, not the library

This file is long because it is a journal rather than a manual. If you are
reading it to understand the system, **§3 (prime directives), §4 (current
status) and §6 (gotchas already paid for) are the three sections worth your
time**; the rest is history, kept because it explains why several rules exist.

**The acceptance contract is the primary document for any use case.**
`qa/contracts/UC-0N-acceptance.md` is human-reviewed, written before the build,
and the only thing that states what a use case must do. §1–§16 is the spec and
is meant to be read whole — roughly 43 KB, deliberately compact. §17 "Known
SPEC_DRIFT" is a register rather than a spec; consult the entries a change
cites.

**Reading order was itself a defect once.** This section used to say "read
`docs/BUILD-LOG.md` first". That was honest advice that became a tax: the build
log reached 784 KB and this file 232 KB, so anyone obeying it spent their
attention on history before reading their own task. Nothing was wrong with the
documents; the order was wrong.

**The acceptance contract is NOT what was cut, and must not be treated as if it
were.** `qa/contracts/UC-0N-acceptance.md` is the primary document for building
a use case: human-reviewed, written before the build, and the only thing that
states what the use case must do. **§1–§16 is the spec and is meant to be read
WHOLE** — it is ~43 KB, deliberately compact. (§17 "Known SPEC_DRIFT" is 44 KB
of findings, a register rather than a spec; consult the entries a change
cites.) An earlier revision of this section told builders to sample it by
citation. That was wrong and is corrected here.

Still authoritative, and still the answer when a decision needs them — fetched,
not swallowed:

- `qa/orchestration/OPERATING-CONTRACT.md` — the mission's rules
- `qa/handoffs/<UC>/` — the frozen validation contract for the CURRENT build
- `docs/BUILD-LOG.md` — §1 snapshot, §4 decision log, and the recent write-ups
- `docs/00-FOUNDATION.md`, `docs/01-COHERENCY-MAP.md` — shared architecture
- Remote's own documentation — for any factual question about Remote

Moved to history on 2026-08-21, unchanged and still cited by number:

- `docs/history/BUILD-LOG-ARCHIVE.md` — write-ups §3.1–§3.84 (a citation like
  "§3.24" resolves by searching that file)
- `docs/history/SESSION-LOG.md` — this file's former §5

Read those when you are asking *why is this like this*. Not to start a task.

> **Continuity rule — read this if you are picking up after `/compact` or a
> session reset.** `/compact` clears conversation memory. It never touches
> files. This file, `docs/BUILD-LOG.md`, and the code are the only things that
> persist, so nothing that matters may live only in conversation — a plan that
> exists solely in this turn's reasoning is a plan that can vanish with no
> warning. **Whenever a task, phase, or milestone finishes, sync
> `docs/BUILD-LOG.md`'s status table + roadmap AND this file's §4 (status),
> §5 (session log), and §7 (next steps) in the SAME unit of work — before
> starting the next task, not "later."** If you are resuming this project and
> anything in conversation contradicts §4 of this file or `BUILD-LOG.md`,
> the file wins; conversation summary is a lossy compression of it, not the
> other way round.

---

## 1. What this is, and the constraint that shapes every decision

A CX automation layer for an Employer-of-Record platform, built against
[Remote](https://remote.com)'s real API. Remote is the domain because it
publishes a real API, a real Sandbox and real documentation — so every
integration claim in here can be checked by a reader rather than taken on
trust.

**A hard delivery deadline is the dominant constraint**, and it is the reason
for the rule below rather than a footnote to it:

> **The repository must be submittable after every single change.**
> Never leave it mid-surgery. Finish and commit each unit of work before
> starting the next. Prefer a smaller complete thing over a larger half thing.

The system is built to demonstrate four things, in this order of how hard they
are to do well:

1. **Measuring impact** — define success metrics, track them, and use them to
   decide what to iterate on and what to stop. This is the hardest of the four.
2. **Knowing when *not* to automate** — being "as comfortable making the case
   against automating something as building it."
3. **Named tooling** — n8n, Zendesk *and its application framework* (ZAF),
   REST, webhooks, MCP.
4. **Documentation as part of "done"**, not an afterthought.

**The scope decision has moved twice, and both moves were mine.** It is
recorded here in order, because a reader who finds only the first will think the
repo overshot its own plan:

1. **Originally: 3 use cases built deep + 9 specified**, covering all three risk
   tiers. Nine shallow builds would read worse than three complete ones, and
   scoping judgement is itself part of what the system demonstrates.
2. **Reversed** — I decided to build everything ("I want everything built from beginning to end, so
   that we can begin to test everything out now"). **All nine are now built** —
   core logic, an HTTP API, a ZAF panel, an n8n graph and a parity test each.
   §5 records the pass that did it.
3. **Narrowed again, on the demo rather than the build.** The demonstrable
   surface is now **four countries — NL · PT · CA · US**
   (`docs/DEMO-COUNTRIES.md`), chosen so that every one of the nine has at least
   one scenario that is *supposed to succeed* on real Sandbox data. That
   constraint is the whole point: 77 scenarios were run against the live
   Sandbox and **9 did not match their prediction**, and those nine are the
   most useful thing in that document.

The scoping *judgement* survives all three moves and is still what is being
demonstrated — it just now lives in the demo set and in the 🔴 tier's refusal to
own an execution path, rather than in a count of use cases.

---

## 2. Setup

```bash
npm install          # REQUIRED — a fresh clone fails without it (openai, pg, dotenv, playwright)
npm test             # hermetic: no network, no API keys. See README for the current count
npm run demo         # UC-01 decides three tickets, narrated
npm run scenarios    # every UC-01 §12 scenario, one labelled block each
npm run metrics      # impact dashboard → demo/metrics.html
npm run review-api   # the ZAF sidebar's backend on :4020 (seeds real cases)
npm run playground   # interactive UC-01: act as client + specialist → :4030
npm run chatdemo     # UC-01 as a chat: each message runs through the real handler → :4046
npm run thirdparty   # L-12: the unauthenticated third-party consent door → :4048 — every
                      # submission gets the SAME acknowledgement, whatever it finds (VC-33)
npm run mock         # mock Remote API on :4010
npm run zendesk-mock # mock Zendesk on :4014
npm run live         # ONE real pass: Remote Sandbox + OpenAI + Supabase + Zendesk
npm run livedemo     # ALWAYS real: creates an actual Zendesk ticket the live n8n workflow processes → :4040
npm run uc06-api     # UC-06's dual-approval API, seeded with 3 real amendments → :4021
npm run uc08-api     # UC-08's read-only dossier API (no write route exists), seeded with 3 dossiers → :4023
npm run remoteui     # UC-06's amendment-request entry point — the "Remote product" stand-in → :4041
npm run dashboard    # all nine use cases on one page → :4060 (a viewer only — start the APIs below first)
npm run uc02-api     # :4050   npm run uc03-api  # :4051   npm run uc04-api  # :4052
npm run uc05-api     # :4053   npm run uc07-api  # :4054   npm run uc09-api  # :4055
npm run portal       # the intake surface for the eight request types with no Remote event API → :4042
npm run walkthrough  # drives the real HTTP surfaces end-to-end (catches what hermetic tests can't)
npm run audit-ui     # Execution & Audit Trail viewer → :4044 (live feed + bug audit)
npm run queue-ui     # the approval queue → :4047 — everything waiting on a human, and everything NOBODY can reach
npm run pdf-demo     # renders a UC-01 letter to PDF via Playwright/Chromium
npm run simulate     # traffic simulator      npm run loadtest  # autocannon against a running API
npm run remotebridge # the read-only Remote Sandbox stand-in (see §6 before "fixing" any host)

# Checks against the DEPLOYED thing, not against a local file. Each exits 2 —
# never 0 — when it cannot reach what it is checking, so a skipped check can
# never be misread as a passing one.
npm run verify-deployed   # diff every deployed n8n Code node against its .js file
npm run verify-claims     # the idempotency claim node's WIRING on all nine graphs
npm run verify-traces     # the audit-trace branch's wiring AND canvas position
npm run verify-live-uc01  # UC-01's live chain, read-only — writes nothing (needs NODE_USE_ENV_PROXY=1)
npm run verify-ticket-hygiene  # 0 harness-vocabulary leaks in the LIVE Zendesk queue — and it
                          # NEGATIVE-CONTROLS ITSELF FIRST, refusing to sweep at all unless 7
                          # known-dirty spellings flag AND 13 known-clean live values pass. rca-1qju
                          # was nearly closed twice on a confident zero from a half-broken detector
                          # (once spaced-only, once raw-only), so exit 2 here also means "the
                          # instrument failed its own control", not just "I could not reach it".

npm run seed-uc02    # mints UC-02 demo expenses in the Sandbox (see docs/DEMO-COUNTRIES.md §6.2)
npm run sync-groups  # syncs Zendesk group ids into src/shared/escalationGroupIds.js
npm run deploy-node      # publishes ONE n8n Code node from its .js file (see §7b)
npm run deploy-routing   # publishes the Assign Routing node to all nine graphs
npm run seed-vectors     # embeds the citation corpus into pgvector — READ docs/RETRIEVAL.md FIRST:
                         # it recommends NOT running this, and argues it from a measured 106 passages
```

Every port above is allocated in `src/shared/ports.js` — the single registry.
`npm run dashboard` starts *nothing*; it only polls the nine APIs, so start
whichever you want to see first. All nine can run simultaneously.

The ZAF sidebar (`zaf-app/`) drives **all nine** use cases from one bundle: set
`apiBaseUrl` (UC-01, required) and one optional `ucNNApiBaseUrl` per other use
case in the app's settings (or in `zcli`'s local params), pointed at whichever
of the APIs above are running — or at the deployed `/uc01`…`/uc09` prefixes,
which is how the live install is configured. An earlier revision of this
paragraph said "all three built use cases", which stopped being true when the
other six were built and stayed here for weeks afterwards.

Node.js 20+. No build step, no TypeScript.

`npm run live` is the only command that touches real services and costs money.
Everything else is free and offline.

Credentials live in `.env` (gitignored; see `.env.example`). Leaving any unset
keeps that integration on its safe default — mock server, rule-based
classifier, in-memory stores.

### Git

Work on **`claude/remote-cx-ai-automation-hphnkj`**, push with
`git push -u origin claude/remote-cx-ai-automation-hphnkj`. The repo default
branch is `main`. (`master` is dead — an older unrelated history whose content
is a strict subset of `main`. Ignore it.)

---

## 3. Prime directives

1. **LLMs interpret; deterministic code decides.** An LLM may classify, extract
   and draft. It may never perform a state change, and its output may never
   reach a gate unvalidated. Validate against a strict shape, fall back to
   rules on any failure.
2. **Risk tier selects the execution path** — it is not a label.
   - 🟢 **Low (01–03):** validate → auto-execute → resolve. Exception-gated.
   - 🟡 **Medium (04–06):** AI prepares + risk-scores → human approves in ZAF → execute. 06 needs *dual* approval.
   - 🔴 **High (07–09):** AI compiles a dossier → escalate. **No execution path may exist** — assert this with a test. 09 is the dual-approval money path.
3. **Identity comes from an authenticated signal, never a claim.** Fails closed:
   any missing piece means unverified.
4. **Verify schemas against the real API.** `docs/REMOTE-API-INDEX.txt` is
   Remote's official `llms.txt`; each page has a `.md` at
   `https://developer.remote.com/docs/<page>.md`. Do not invent request/response
   shapes. Tag every claim `[CONFIRMED]` / `[VENDOR-PUBLIC]` / `[INFERRED]` / `[PROPOSED]`.
5. **No real customer data.** Mock server + Remote Sandbox only.
6. **Documentation and tests are part of "done."** Every change updates
   `docs/BUILD-LOG.md` and the relevant `UC-0X.md`, and adds or updates a test.
7. **Be honest in every artifact.** If something is not built, say so. The
   status tables in `README.md` and `BUILD-LOG.md` are load-bearing — a reviewer
   who catches one overstatement discounts everything else.

6. **The substitution ladder — where a fact is allowed to come from.** Stated by
   the project owner on 2026-08-21, and load-bearing enough to be repeated here
   rather than cross-referenced. **Always take the highest rung that can answer
   the question:**

   | | Rung | Source |
   |---|---|---|
   | 1 | **Remote's own documentation is the source of truth** | `developer.remote.com`, its OpenAPI, its `.md` pages |
   | 2 | **Where the Sandbox holds relevant data, use the Sandbox** | `gateway.remote-sandbox.com` |
   | 3 | **Where the Sandbox refuses or lacks the capability, replicate it in our own stand-in** | `src/remoteui/`, `src/remotebridge/`, `src/remote/mockServer.js` |
   | 4 | **Where no relevant data exists at all, fabricate** | A named, marked fixture |

   **Rung 1 is never overridden by a lower rung.** Two constraints make rungs 3
   and 4 safe and neither is negotiable: **a substituted fact is always
   self-identifying** (`standin-` ids, `_standin` blocks,
   `X-Standin-Enriched`, `cutoffCycleProjected` on the audit row — nothing
   fabricated may reach a reader looking like something Remote said), and **money
   is never fabricated** (`total_payroll_cost` and `approval_date` stay null on a
   projected cycle; a cadence can be continued, an amount cannot be invented).
   And one honesty rule: **a real value always wins** — rung 3 fills only what
   rung 2 left empty, rung 4 only what rung 3 cannot reach.

   **Why it is a rule and not a habit.** Three times this repository recorded a
   Sandbox limitation as a fact about Remote's platform — UC-05's resignation
   endpoint, UC-06's `automatable` pre-check and UC-07's atomic country-transfer
   endpoint, all three in one sentence in `00-FOUNDATION.md` — and **two of the
   three turned out to exist**. A Sandbox that refuses is **rung 2 failing, not
   rung 1 answering.** Full version with worked examples:
   `qa/contracts/UC-06-acceptance.md` §18a, `docs/00-FOUNDATION.md` §2a,
   `docs/WHY-THIS-SHAPE.md` §14.

### Global invariants (enforced once, in `src/shared/`)

- **Money ×100 scaling** (`money.js`) on every value in/out of the Remote API.
- **Dynamic per-country JSON schema** validation before any write (`schemaValidator.js`).
- **Audit everything** (`audit.js`): who, what, tier, inputs, LLM output, approver, result.
- `cases` (mutable current state) and `audit_log` (append-only history) are
  never conflated.
- **Tests stay hermetic.** No test may reach the network. Inject dependencies
  — as `handleVerificationTicket` does with `classify` — rather than relying on
  the environment being clean.

---

## 4. Current status

> **2026-08-29 — what landed today, before pointing a public audience at the
> deployment.** Six changes, all committed, all with tests. Named here because
> each is a control whose absence this file or another register described as
> current until today; none of them is a new capability.
>
> - **The third-party door has a ceiling.** `src/thirdparty/rateLimit.js`, wired
>   into the door and consulted before any lookup: 20 per address per hour, 250
>   globally per day, counted in **Postgres** (an in-memory counter on a
>   serverless function bounds nothing) and **failing closed** — a counter that
>   cannot be read refuses 503 rather than allowing. It cannot become a VC-33
>   side channel: it is keyed only on the caller and has no access to what the
>   lookup found. Live `/__cx/health` reports it `effective: true`.
>   `docs/WEBHOOK-AUTH.md` §6's "no rate limiting" entry is struck accordingly.
> - **The door says it is a demonstration.** A static banner — one literal,
>   selected by no branch, so it cannot become the side channel VC-33 forbids —
>   plus `noindex`. It carries Remote's name and asks a stranger for a third
>   party's legal name and date of birth; prime directive 5 is why.
> - **Free text is capped at 4,000 characters** on third-party intake and
>   follow-up, enforced on shape before any lookup, so the refusal is identical
>   whether or not the reference resolves. `message` is the one field that
>   reaches a real billed OpenAI call.
> - **The intake de-duplication window is back to 120s** (`c889444`). It was cut
>   to 20s for a demo rehearsal; the duplicate it exists to absorb was measured
>   at 50.8 seconds apart, so at 20s the deployment could file a duplicate
>   enquiry — meaning a real employee receiving two consent requests for one
>   disclosure. The restore was forced by a test that asserted the demo value on
>   purpose. `/__cx/health` now reports the **effective** window and whether an
>   env override is in play, because reporting that a control exists is not
>   reporting that it is in effect.
> - **UC-09: the person who asked for the money can no longer sign it off**
>   (DRIFT-050). Segregation of duties compared the incoming approver against the
>   three approval SLOTS only; `adjustmentRow.requester` was compared to nothing,
>   so the filer could approve their own request and every control still reported
>   satisfied — the floor of two held, two distinct names appeared. The filer may
>   now fill the `requester` slot and no other, under its own refusal code, via
>   `isSameApprover()` rather than `===`. `deny` is still allowed.
> - **Comment-stripping and security headers on the public surfaces.** `/portal`,
>   `/audit` and `/queue` are public by design and were serving their own source
>   comments — internal issue ids and `src/` paths (portal 297KB/49 references →
>   134KB/0; audit 61KB/14 → 41KB/1, the survivor a tooltip; queue 19KB/1 →
>   16KB/0). `src/thirdparty/` had stripped since it shipped, which is how it came
>   to be true of one surface of four. Added on every response:
>   `frame-ancestors 'none'` + `X-Frame-Options: DENY`, `nosniff`,
>   `strict-origin-when-cross-origin`, and a `Permissions-Policy`. The ZAF sidebar
>   is served by Zendesk from `zaf-app/`, not from this deployment, so framing it
>   is unaffected.
>
> **Also today, and it is a gap rather than a fix:** the deployed classifier runs
> **`gpt-5-nano`**, not the `gpt-4o-mini` this repo documents, evaluates and
> prices — see §7's honest-gaps item 22. The metrics layer now reports that
> honestly (`unpriced`) instead of throwing; the divergence itself is unfixed.

> **2026-08-21 (later) — read this box after the 2026-08-29 box above (which
> does not supersede it — the two cover different things); it supersedes the
> 2026-08-20 box
> below wherever the two disagree.** This is the UC-01 CONTINUATION build
> against the frozen validation contract (`qa/handoffs/UC-01/
> 0001-builder-to-validator.md`) — G-3, the third-party consent round trip,
> the last major piece the previous pass (§4 box below, §5's "UC-01
> IMPLEMENTATION, first build pass" entry) stopped short of because its
> migration (`L-7`) was written and not yet applied. The migration is now
> applied and verified live (`consent_records` genuinely carries all twelve
> columns), and this pass built everything that depended on it:
> `L-8`/`L-9` (the consent lookup and the new `awaiting_employee_consent`
> pending state — replacing the old boolean `consentOnRecord`, which is now
> retired everywhere), `L-12` (the third-party door, `npm run thirdparty`
> at :4048), `L-13` (the employee's own consent surface, in the portal),
> `L-19` (consent ageing in the approval queue) and `L-14` (UC-01 gains an
> eighth portal request type — the self-service letter G-2's deflection has
> promised since it shipped). `L-2`'s audit is also complete:
> `test/uc01VcAudit.test.js` covers all fourteen VC-01..VC-14 criteria by id.
> Full write-up: `docs/BUILD-LOG.md` §3.90.
>
> **The one invariant this pass is built around, restated because it is easy
> to get backwards**: a third party who has not been answered yet is
> **pending**, never refused (VC-06); one who was told no is **blocked**,
> never escalated (VC-08); and a real unanswered employee, a real employee who
> declined, and a person who does not exist at Remote at all must be
> **indistinguishable from outside** (VC-33) — proved for the third-party
> door by a response body that is a literal string constant no code branch can
> select, not by comparing decision strings after the fact.
>
> **Test count, measured on this pass's own tree**: 33 new tests
> (`test/uc01VcAudit.test.js` ×15, `test/thirdPartyDoor.test.js` ×12, plus new
> cases added to `test/portal.test.js`, `test/approvalQueue.test.js` and
> `test/chatdemo.test.js`), and five existing files updated in place because
> G-3 changes what a mismatched-session or absent-consent scenario correctly
> means (`test/uc01.test.js`, `test/uc01RequesterType.test.js`,
> `test/lowTierExceptionData.test.js`, `test/zendesk.test.js`,
> `test/pdfRender.test.js`). A full `npm test` run on this pass's tree passed
> with only two **confirmed pre-existing** failures (verified via `git stash`
> against the clean tree before this pass touched anything —
> `test/portalTicketNote.test.js`, a UC-09 parsing edge case unrelated to
> UC-01, and `test/dashboard.test.js`'s documented `EADDRINUSE:4061` from
> another process in this shared container) and one load-dependent timing
> flake (`test/zafExecutionClaim.test.js`, passed cleanly in isolation both
> before and after this pass).
>
> **What is still blocked, unchanged from the previous pass's own list**:
> `L-15`/`L-20`/`L-21` need an n8n republish of graph `WORKFLOW_UC01_ID`,
> sequenced separately. Until that republish adds a Supabase lookup node
> before "Identity + Policy Gates" (a graph-shape change no Code-node edit can
> make), the **live** n8n path's `ctx.consentRecord` is always absent — treated
> identically to "no matching row" (the safe, pending default), so the
> deployed graph can already reach `awaiting_employee_consent` for every
> third-party ticket but cannot yet reach a genuinely **granted** disclosure
> until that node exists. Named here rather than left for a future session to
> rediscover.
>
> **SUPERSEDED 2026-08-23 20:06Z — that republish has happened. Do not quote the
> paragraph above as a current blocker.** `qa/HUMAN-DECISIONS-REQUIRED.md` §K4
> authorised exactly one production graph-*shape* change, and `e5c3a17` landed
> it: *Fetch Employment (Remote) → **Lookup Consent Records** → Identity +
> Policy Gates*. Read back off the live API at 20:19Z — `WORKFLOW_UC01_ID`,
> **38 nodes** (was 37), `versionId === activeVersionId === 0d4694e3-…`, the new
> node carrying `alwaysOutputData: true` and `onError: continueRegularOutput`,
> and *Identity + Policy Gates* holding **exactly one** inbound edge, so no
> execution can route around it. Observable output moved with it: audit row
> `5d731994` (19:56:20Z) carries `identity.consentRecordId`, against **twelve**
> earlier `awaiting_employee_consent` rows spanning 08-22 and 08-23 that are all
> still null — the temporal boundary is clean, so this is the fix and not a
> field that was always populated. `L-15`/`L-20`/`L-21` are no longer a standing
> blocker for `consentRecordId`. The authorisation was **narrow**: this graph,
> this lookup. It did not open production graph editing generally.

> **Three superseded status boxes (2026-08-20, -19, -18) moved to
> `docs/history/STATUS-ARCHIVE.md` on 2026-08-23, unchanged.** They were the
> newest thing in this file on their own day and were superseded by the box
> above. Read them when asking *why is this like this*.

| Capability | Status |
|---|---|
| UC-01 decision flow end-to-end | ✅ Built, now including G-3's full third-party consent round trip (pending/granted/denied — a genuine pending state, never a refusal), the third-party door (`npm run thirdparty`, :4048), the employee's own consent surface (in the portal), consent ageing (in the approval queue) and an eighth portal request type (the self-service letter). **The count moves several times a day and this row has been wrong about it before — quote `npm test` with a tree state or not at all.** Measured on this session's own tree, 33 new tests added and passing on top of the prior baseline; full accounting in `docs/BUILD-LOG.md` §3.90. **2026-08-28 (§3.93):** the portal card was checked against Remote's OWN published form, fetched live from its Help Center (`support.remote.com` is a Zendesk instance — every article has JSON at `/api/v2/help_center/en-us/articles/<id>.json`, which is how `docs/UC01-INTAKE-FIELDS.md` upgrades `INTAKE-RESEARCH.md` §6.5 from `[INFERRED]` to `[CONFIRMED]`). Three findings are load-bearing: **the standard form is ONE field** (a language, and a button — the platform already holds every fact the template prints); **salary is absent from Remote's own template too**, so UC-01's over-scope refusal matches the product rather than merely being cautious; and Remote's eligibility article names **the same four classes `engagementEligibility.js` reached independently from DRIFT-074**. The card gained the quick-fills it had never had (its "Quick-fill a scenario" heading rendered above an EMPTY row since it shipped, invisible because two guards restated a literal `7`) |
| Remote API reads | ✅ Real, verified against Sandbox |
| LLM classification + validated JSON + rule fallback | ✅ Real. **The MODEL differs by execution path, measured 2026-08-29 and not yet reconciled (§7 item 22): the deployed API runs `gpt-5-nano` (`OPENAI_MODEL` on the Vercel project, read off `/__cx/health`), while the repo default, `.env.example`, the `evals/` suite and four n8n Code nodes all say `gpt-4o-mini`.** Every result is tagged `source: "llm"` / `"rule_based_fallback"` (issue #25, `00-FOUNDATION.md` §4 invariant 8), and the LLM call itself retried up to 3x with backoff before falling back (issue #32, `src/shared/retry.js`, invariant 10) |
| Zendesk read/write (reply, resolve, note, tags, create) | ✅ Real, OAuth `client_credentials` |
| Audit log + cases/review_queue/documents | ✅ Real, Supabase Postgres — plus a two-level trace (`AuditLogger.logTraceStep()`, issue #26, invariant 7): every LLM/API *attempt*, not just the final decision, gets its own `audit_trace` row |
| **Metrics & impact dashboard** | ✅ Built (`npm run metrics`) — the specialist-accept-rate verdict now reads `insufficient_data` (not a false `healthy`) when a 🟡/🔴 use case has zero decided reviews (issue #28); also flags `redundant_call`s in the audit trace, distinguishing a genuine duplicate from a legitimate retry sequence (issue #33, `findRedundantCalls()`) |
| **n8n workflow UC-01, 14 nodes** | ✅ Built, **ACTIVE**, credentials attached (OpenAI/Remote Sandbox/Zendesk/Supabase). Real `audit_log` write from n8n proven 2026-08-01 (execution `22`). The audit-ordering fix **is live**, not a draft — read back from the active graph 2026-08-15 and confirmed behaviourally by executions `3574`/`3577`; see "Live resources" |
| **Exactly-once delivery (idempotency)** | ✅ Built on **both** execution paths — `claimExternalRef()` (`src/shared/workflowClaims.js`) in the Node app, and a `Claim Ticket (Idempotency)` Supabase node in **all nine** n8n graphs, both claiming `(use_case, external_ref)` in the one shared `workflow_claims` table before the first durable write. The guarantee is the table's **PRIMARY KEY**, not the node — a check-then-insert has the race that gave ticket #5 two `audit_log` rows 30µs apart and a duplicate letter to the customer. A redelivery leaves by the claim node's error output and stops silently at a NoOp. **Proven live on UC-01, UC-04, UC-05 and UC-07** — each driven twice through its production webhook under one external ref, each producing exactly one claim row, one record row and one `audit_log` row, with the redelivery stopping at the NoOp having written nothing (12/12 row counts of exactly 1 across UC-04/UC-05's two independent pairs). UC-02/03/06/08/09 each recorded one real claim row but had no downstream verification in that pass. `docs/BUILD-LOG.md` §3.24, `workflows/README.md` |
| **Upstream-failure attribution** | ✅ Built (`src/shared/upstreamFailure.js`), live on UC-02/06/09. Four graphs carry `onError: continueRegularOutput` on their Remote reads, which does NOT mark the node red — it reports `success` and emits `{json:{error:{…,status}}}` in place of the data, so the gates escalated with a reason naming the wrong cause. Three states are now distinct: `upstream_record_not_found` (404 — an answer *about the record*), `upstream_unavailable` (403/5xx/transport — the request was never evaluated), and an unchanged policy refusal. Flags pair call with status (`upstream_employment_404`). **Fail-closed by construction** — every verdict is an `escalate`, consulted only at gates already refusing, so it can change a refusal's recorded reason but never produce an approval. Proven live: UC-09 row `105cd7c4` = `upstream_record_not_found` (1 failure) vs `590772ee` = `identity_not_verified` (**0** failures); UC-02 `f45e06c3` = `expense_not_found` + provenance |
| **Identity fixes (UC-03/05/06/09)** | ✅ Four gates could report `verified: true` having proved nothing. UC-03/UC-05 echoed the caller's own `employmentId` back as the "authoritative" record id and compared the session against it; UC-06/UC-09 compared `session.companyId` to a defaulted `null` `company_id`, so `null === null` passed. All failed closed only by *accident* of a later status gate. Fixed at the **construction site** in every case — no usable record now yields `employment = null`, which is literally what `RemoteClient.getEmployment()` returns on a 404. `src/` was already sound in each case; the defect lived only in the n8n ports |
| **Ops alerting** | ✅ `RCX OPS · Error Alerts` (`WORKFLOW_OPS_IDX`) fires on any of the nine, writes a durable `ops_alerts` row (use case, tier, failed node, execution URL, `audit_durable`) and then pushes to Telegram — **in that order**, with the push set to continue on error, because the row is the alert and the push is a convenience. `audit_durable` is the column that matters: it says whether a failure lost a decision or only lost a Zendesk update |
| Specs for all 9 use cases | ✅ `docs/use-cases/UC-01.md … UC-09.md` |
| **ZAF sidebar + review API** | ✅ Built (`zaf-app/`, `src/review/`) — approve/**decline** (the verb changed from `deny` in `7486cf8`; Remote has never used "deny") writes `audit_log`. **Drives all nine use cases from one bundle**, and now renders the *gate ladder* and the *decision facts* rather than a decision string, plus the role a given agent is being asked to act as (`docs/SIDEBAR-APPROVAL-ROLES.md`). **INSTALLED AND ENABLED in the live account** — app `9990001` "Remote CX Review v1.01", manifest **1.10.8**, `updated 2026-08-20T07:40:13Z`, verified live from this container against `GET /api/v2/apps/owned.json`. Approver identity is a **verified ZAF signature whenever a durable store is attached or the deployment is publicly reachable** — the trusted-header posture survives only for a seeded in-memory demo, so a fresh clone still runs; and the approver's **role** is now checked too (row below) |
| **Approver role entitlement** | ✅ Built (`src/review/approverEntitlement.js`, `APPROVER_ROLES`), wired into UC-04/05/06/09. Prime directive #3 was applied to the requester and never to the approver: the four-eyes floor genuinely required two different *people*, and nothing required either of them to be an *entitled* person — two support agents could clear a payroll amendment as `customer_admin` + `payroll_specialist`. Three properties are pinned by test rather than argued: it is **consulted last** (after every refusal the policy already had, so it cannot mask the real reason), it **can only ever refuse** (`check()` returns a refusal or `null`; there is no value meaning "approved", so no call site can be written that lets it fill a slot or lower a floor), and it is **additive**. Enforcement keys off the same discriminator signed identity uses — durable store attached ⇒ required; seeded in-memory demo ⇒ not enforced, so a fresh clone still approves. **Required-but-unconfigured refuses by its own name** (`approver_entitlement_not_configured`, deliberately NOT `approver_not_entitled` — those are two different afternoons of work). **Provisioned on the deployment as of 2026-08-20**: `/__cx/health` reads `approverEntitlementEnforced: true`, `approverEntitlementSource: "APPROVER_ROLES"`, `writes: "WORKING"`. For the days before that it read `"unconfigured"` and refused every approve by its own name — the fail-closed default working as designed, and a reminder that **built** and **provisioned** are two claims |
| **Approval queue** (`npm run queue-ui` → :4047, `/queue` deployed) | ✅ Built (`src/approvalqueue/`, `docs/APPROVAL-QUEUE.md`). Read-only **by construction** — no POST route exists in `server.js` at all, asserted both behaviourally (a write-shaped request 404s) and structurally (the source, comments stripped, never names the method). It re-derives no policy: whether an item is waiting, where it would be actioned and whether anyone can reach it are read out of the stores, the routing table and Zendesk, and where a fact is not recorded it says so rather than computing a rival answer. **Its headline is the stuck list, not the flowing one** — see §7's honest-gaps list for what it found the first time it was pointed at production |
| **Approval routing, analysed** | ✅ `docs/APPROVAL-ROUTING.md` — who approves each of the nine, in which screen, and where that screen does not exist. Analysis, not a change: nothing under `src/` was modified to produce it. It is the document that found the role-entitlement hole above |
| **Statutory knowledge corpus** | ✅ `docs/knowledge/` — **35 of 39** Layer-1 statutory/agency documents retrieved from their own authorities across three passes, each with a provenance header carrying source, URL, retrieval date, SHA-256 of the retrieved bytes and licence. Four remain unretrieved for four different reasons (`RETRIEVAL-BLOCKED.md`); the class "our own network refused an authority" is now empty. **The findings are the deliverable, not the files**: `CONTRADICTIONS.md` holds **30 contradictions and 4 confirmations** against code this repo currently ships (34 findings, counted 2026-08-20). **Three have now changed code**, each as its own reviewed commit with its own tests — C-1 (`73920c9`), C-18 and C-14/C-20/C-28 (`43ae3c7`) — and the corpus is separately **cited on the 🟡/🔴 screens** without touching a gate (`src/uc04/decisionSources.js` alone references 24 findings by id). The earlier flat claim *"nothing under `src/` was changed on the strength of it, and nothing should be"* is retired: the rule was never "never act", it was **a finding is a work order with its own tests, never a number swapped inside an unrelated commit**. The rest stay unactioned by choice — see §7 item 4 |
| **Demo scenario matrix (NL · PT · CA · US)** | ✅ `docs/DEMO-COUNTRIES.md` + `scripts/demo-countries-matrix.mjs` — 77 scenarios across all nine use cases, run against the **live** Sandbox, with an *observed* column rather than an expected one. 68 matched, **9 did not**, and §6's nine are the valuable part. Not a test and must never be imported by `npm test`: it reaches the network on purpose |
| **Interactive playground** | ✅ Built (`src/playground/`, `npm run playground`) — one page to act as client + specialist, offline only, reuses the same workflow/policy/service code as production |
| **Chat demo** | ✅ Built (`src/chatdemo/`, `npm run chatdemo`) — a conversational wrapper: each typed message runs through the real `handleVerificationTicket()` and renders its actual result. A demo/testing aid, not a submission deliverable — in-memory only, never touches Supabase or a real Zendesk ticket |
| **Live demo (real Zendesk ticket)** | ✅ Built (`src/livedemo/`, `npm run livedemo`) — client-facing page that creates a REAL ticket the live n8n workflow processes. **CONFIRMED WORKING END TO END 2026-08-27**, and it never had been before: `.env` carried `ZENDESK_EMPLOYMENT_ID_FIELD_ID=9990000000007`, an id that has never existed on this account, so every submission wrote to a nonexistent field, the trigger's `custom_fields_… present` condition never matched, and the ticket sat untouched. Silent in every layer — Zendesk drops an unknown field id without erroring, so the create returned 200. `qa/evidence/UC-01/2026-08-22-uc01-e2e/FINDINGS.md` had named the wrong id five days earlier; nothing had changed the `.env`. Now: ticket 142 → execution `9302`, `pinData: {}`, **29/29 nodes success**, `auto_resolve`/`all_gates_passed`, audit row `8d96de6a-…`, letter delivered, ticket solved. Also fixed: the first comment is now authored by the CUSTOMER (`findUserIdByEmail()` + `comment.author_id`) — it used to be attributed to the API account, so the customer's own words and the automated reply both appeared under the account owner's name |
| **UC-06** (Contract Amendment / Payroll Cutoff) | ✅ Core logic + HTTP API + real Supabase persistence + ZAF panel + n8n workflow (`src/uc06/`, `npm run uc06-api`, `WORKFLOW_UC06_ID`) — dual-role approval controls live in the shared sidebar; n8n workflow built, credentialed, dry-run verified, parity-tested. `draftSummary()`'s LLM call now retries before falling back (issue #32) and its drafted prose gets an optional narrative-faithfulness check — informational only, never a gate (issue #27). **Plus the Remote-native entry-point stand-in** (`src/remoteui/`, `npm run remoteui`) — submits the webhook-shaped amendment event, runs the REAL gates, then creates the pre-tagged Zendesk ticket (issue #17's trigger-source model). **Submissions are role-gated server-side** (issue #34): company admin requests, employee/employer consent, everything else refused. **ACTIVE as of 2026-08-10** — explicit user go-ahead given for full production-ready confirmed system testing across all nine use cases (see §5's "all nine n8n workflows activated" entry); real (unpinned) execution verification is the next step, not yet done |
| **UC-08** (Cross-Border Tax & Social Security) | ✅ Core logic + real dossier persistence + read-only API + ZAF panel + n8n workflow + a treaty retriever (**keyword in production**; the embedding leg is built and unfed) (`src/uc08/`, `npm run uc08-api`, `WORKFLOW_UC08_ID`) — the 🔴 use case with **no execution path**, asserted structurally and behaviorally by test, now true of the store, API, AND n8n graph too (one write method, zero mutations; no POST route at all; no Switch/IF node in the workflow). Treaty retrieval **runs on its keyword leg in production** — the `uc08_treaty_citation_vectors` pgvector table has held zero rows since it was provisioned, so every citation any real run has shown was keyword-matched. The embedding class is built and wired to nothing (issue #29). `draftNarrative()` likewise retries before falling back (issue #32) and gets the same optional, non-gating narrative-faithfulness check (issue #27). **ACTIVE as of 2026-08-10** — same explicit go-ahead as UC-06; real (unpinned) execution verification is the next step, not yet done |
| Demo video + case-study page | 🟡 Script + page **built** (`docs/DEMO-SCRIPT.md`, `docs/case-study.html`) — the video itself is **not yet recorded** and the page is **not yet published/sent**; see §7 Stage 4 |
| **UC-02** (Expense & Receipt Validation, 🟢) | ✅ Core logic + HTTP API (`src/uc02/`, `npm run uc02-api`, port 4050) — 12 ordered deterministic gates, LLM category-classification seam (retried, source-tagged, never trusted for money/math), the one write (`PATCH /v1/expenses/:id`) durably audited before it fires. No ZAF panel/n8n/PDF yet |
| **UC-03** (Travel Support Letter / Workation router, 🟢) | ✅ Core logic + HTTP API (`src/uc03/`, `npm run uc03-api`, port 4051) — thin router only (auto_resolve/human_review/escalate/route_to_uc04), deliberately no Schengen/183-day compliance logic of its own. **NOT read-only** — `c295ef1` added three sign-off write routes; only UC-07 and UC-08 have no POST route at all. ZAF panel and n8n graph both exist |
| **UC-04** (Work Authorization / Workation, 🟡) | ✅ Core logic + HTTP API (`src/uc04/`, `npm run uc04-api`, port 4052) — deterministic origin→destination risk matrix (PE risk, Schengen/US-CA hard blocks), single-specialist approval (not dual — UC-04.md names one mobility specialist). No ZAF panel/n8n yet |
| **UC-05** (Resignation Notice Calculation, 🟡) | ✅ Core logic + HTTP API (`src/uc05/`, `npm run uc05-api`, port 4053) — 9-country statutory notice table, PTO payout reconciliation, single HR Ops sign-off. No real write endpoint exists (spec-confirmed), so the signed-off report is the durable artifact, not an execution. No ZAF panel/n8n yet |
| **UC-07** (Global Mobility / Permanent Relocation, 🔴) | ✅ Core logic + read-only dossier API (`src/uc07/`, `npm run uc07-api`, port 4054) — the second no-execution-path reference build alongside UC-08: `handleRelocationReview()` takes no remote/zendesk dependency at all, dossierStore has one write method and zero mutations, no POST route exists. No ZAF panel/n8n yet |
| **UC-09** (Off-Cycle Payroll / Adjustment, 🔴-framed but WITH execution) | ✅ Core logic + HTTP API (`src/uc09/`, `npm run uc09-api`, port 4055) — the one 🔴-framed use case with a real execution path, gated behind a floor-of-2 multi-role approval (requester+approver, +payment_releaser for high-risk) that `Math.max(2, ...)` guarantees can never drop below 2 regardless of risk score. No ZAF panel/n8n yet |
| PDF rendering | ✅ Built (`src/pdf/`, `npm run pdf-demo`) — renders a UC-01 letter via Playwright/Chromium |
| **Gate ladder + `docs/GATES.md`** | ✅ Built — `describeGateLadder(reason)` (`src/uc02/policyEngine.js`) returns the whole ordered ladder with each rung marked `passed`/`decided`/`not_reached`, rendered collapsed under the deciding gate on the portal and carried on UC-02's API view. Written up in `docs/GATES.md`. Built because "Decided by gate 15" cited an order nobody could see; `not_reached` is deliberately distinct from `passed` — a gate that never ran approved of nothing. `GATE_SEQUENCE` is still **UC-02 only** and the doc says so rather than implying nine ladders exist. `docs/BUILD-LOG.md` §3.44 |
| **Fresh copies of a fixture claim** | ✅ Built — `src/remote/mockServer.js` mints a new claim from an existing one on `<id>~fresh-<token>`, offered on the portal's UC-02 form as "File this as a new claim". Without it every portal scenario was a **one-shot**: UC-02 replays the stored decision for an expense it has already judged (correct — it is what stops a second approval write), and the fixture list is fixed, so a tester who generated a new *reference* and expected a new *decision* got the replay and read the reference control as broken. The reference identifies the DELIVERY; the expense is the SUBJECT. The minted title carries the token because `deriveReceiptFingerprint()` hashes the title — an identical copy would be refused at gate 6 as an already-reimbursed receipt. Nothing in `src/uc02/` knows the id form exists. `docs/BUILD-LOG.md` §3.44 |
| **Execution & Audit Trail viewer** | ✅ Built and DEPLOYED — `npm run audit-ui` (:4044) and `/audit` on the Vercel function, gated by the same `PORTAL_ACCESS_KEY`. Live feed over `audit_log` (both execution paths), drill-down to every `audit_trace` attempt with a duplicate-call banner, a bug-audit tab keyed by externalRef (claims + decisions + nearby `ops_alerts`), and an `ops_alerts` view surfacing `audit_durable`. Read-only in UC-08's structural sense: **no POST route exists in the file**. `docs/AUDIT-VIEWER.md` |
| MCP client | ⬜ Not built |

### Live resources

- **The nine review/approval APIs are DEPLOYED and public** —
  `https://remote-cx-apis.vercel.app`, one Vercel serverless function serving
  all nine behind path prefixes (`/uc01` … `/uc09`), plus `/`, `/healthz`,
  `/__cx/health`, `/__cx/routes`. Vercel project `remote-cx-apis`
  (`prj_YOUR_VERCEL_PROJECT`). **The production branch is
  `orchestration/gascity-pilot`, MEASURED 2026-08-28 — not
  `claude/remote-cx-ai-automation-hphnkj`, which this line named for weeks.**
  A push to that branch builds green as a **Preview** and leaves the live URL
  serving the previous bundle: push succeeded, build succeeded, nothing
  changed. Verify with `gh api repos/<owner>/<repo>/deployments` (each row
  carries `environment: Production|Preview`) and `.../deployments/<id>/statuses`
  — no Vercel token needed. See `deploy/cx-apis/README.md` §2.
  Verified live 2026-08-18: `/` 200 listing all nine, `/__cx/health` 200,
  `/uc06/api/amendments/by-ticket/3001` reaching UC-06's own handler
  (`{"found":false}` — the right code, no row).

  **The request portal is mounted on the same function at `/portal`** (prepared
  2026-08-18, not yet verified live from this container — the proxy blocks
  `vercel.app`). It is the intake surface for the seven use cases with no
  Remote event API, and it is what makes `docs/E2E-TEST-PLAN.md` Phase 2
  runnable without Node or a clone. **It is gated by its own shared key**
  (`PORTAL_ACCESS_KEY`, header `x-portal-key`, `src/portal/access.js`) and NOT
  by the ZAF-signed identity below — a ZAF token is minted by Zendesk for an
  app inside Zendesk, and the portal deliberately is not. The rule for when a
  key is demanded is copied from `readPosture()`, OR and not AND: a durable
  store attached **or** `VERCEL` set. Until `PORTAL_ACCESS_KEY` is set on the
  project, `/portal` serves its page and refuses every `/api` call with
  `portal_access_key_not_configured` — the same fail-closed choice as the ZAF
  gate. Its Remote reads are the **mock fixtures dispatched in-process**
  (`createInProcessFetch()`), on purpose: its personas are mock ids that a real
  Sandbox 404s, and a public page must not write into a real account. Its
  stores are the real pooled ones, so submissions land in Supabase.
  `/__cx/health`'s `portal` block reports all of this. `docs/BUILD-LOG.md`
  §3.33.

  **RE-VERIFIED LIVE 2026-08-19/20, and the surface has grown.**
  `GET /__cx/routes` now lists three browser surfaces alongside the nine
  prefixes: **`/portal`** (intake), **`/audit`** (the audit-trail viewer) and
  **`/queue`** (the approval queue) — all three read-only or intake-only, all
  three behind `PORTAL_ACCESS_KEY`. `/__cx/health` reports reads WORKING and
  writes WORKING.

  **~~One thing on it is switched off~~ — CLOSED 2026-08-20.** For two days this
  URL read `approverEntitlementEnforced: true` with
  `approverEntitlementSource: "unconfigured"`, so **every approve refused
  `approver_entitlement_not_configured`**. `APPROVER_ROLES` is now set on the
  project: the same read on 2026-08-20 returns
  `approverEntitlementSource: "APPROVER_ROLES"` and
  `writes: "WORKING — approve/deny will be accepted (subject to each use case's
  own policy gates)."` The refusal was the intended fail-closed default — a
  refused approval is recoverable in a minute by whoever is deploying, an
  approval by an unentitled person is not recoverable at all — and the episode
  is kept because **"the gate is built" and "the gate is provisioned" are two
  claims**, and for two days only the first was true of this URL.

  **STALE AS OF 2026-08-18 (later the same day) — the deployment is now FULLY
  CONFIGURED.** `/__cx/health` verified live from this container (the proxy no
  longer blocks `vercel.app`): `supabaseAttached: true` (reads return real
  rows), writes WORKING (`zafSharedSecretConfigured: true`,
  `zafVerifierBuilt: true`), `remoteConfigured: true` (gateway Sandbox),
  `zendeskConfigured: true`, and the portal's `accessKeyConfigured: true` — so
  `/portal` accepts submissions from anyone holding the shared key, and they
  land in the real Supabase. The paragraph below is kept because its
  fail-closed reasoning is the design record, but its factual claims described
  the pre-configuration window:

  ~~**Reads return nothing and writes are refused, both on purpose.**~~
  `SUPABASE_DB_URL` ~~is unset~~ (now set) and ~~no ZAF verifier exists~~ (now
  built and configured). The write refusal was the load-bearing one:
  `readPosture()` requires a signed approver identity when a durable store is
  attached **OR** the deployment is publicly reachable, ORed so the platform
  check can add the requirement but never remove one. Without that OR this URL
  would have accepted a payroll approval from anyone who can set a header,
  during exactly the window where the URL was live but the database not yet
  attached — the window is now closed from the safe side.

  **Four different 404s were paid for getting here, and only the body tells
  them apart** — a branch name typed into *Root Directory* (a folder path;
  must be empty here) instead of *Settings → Environments → Production →
  Branch Tracking*; a production alias still serving the previous build,
  because changing the branch does not rebuild; `/api/health`, which is not a
  route at all and returns `no_such_use_case` **on a fully healthy
  deployment**; and `/` itself, which `vercel.json`'s `/:cxpath*` never
  matched, so Vercel answered before any of this code ran. That last one is
  the instructive one: every routing unit test passed throughout, including
  the one asserting an empty `__cx_path` resolves to `/`. The defect was
  entirely in configuration, which is why its test now reads `vercel.json`.
  Full write-up: `deploy/cx-apis/README.md` §2.

- **n8n workflow:** `WORKFLOW_UC01_ID`, **active: true** —
  `https://n8n.your-host.example/workflow/WORKFLOW_UC01_ID`
- **~~THE DEPLOYED GRAPHS ARE BEHIND THE REPO~~ — CLOSED 2026-08-20.** For a day
  the deployed graphs ran superseded bodies and nothing recorded it: UC-03's
  sanctions gate (`c17b839`), UC-08's jurisdiction statement (`5b6bd45`, whose
  own commit says *"NOT deployed, the live graph needs republishing"*), and the
  **pre-split `Assign Routing` body on all nine**, which sent every routine
  UC-04 approval to the Tier-2 legal queue that `UC-04.md` reserves for
  unconfirmed cases — the exact defect `escalationRouting.js`'s header describes
  in the past tense. `e4108d6` ran `scripts/deploy-routing-nodes.mjs` and
  reports **`verify-deployed: 39 nodes, 0 drifted`**, re-confirmed live by the
  session owner on 2026-08-20.

  **~~[UNKNOWN] from a container without n8n access~~ — STALE AS OF 2026-08-27.
  The n8n API answers this container fine.** `GET /api/v1/workflows/{id}` with
  the `.env` `N8N_API_KEY` returns **200**, and this session read all nine
  graphs back node by node on it. Treat any claim that n8n 403s from here as
  describing a key that has since been replaced, not a standing condition —
  **check before repeating it.** The paragraph is kept because its reasoning
  still holds and is the transferable part: `verify-deployed` exits **2**, not
  0, when it cannot reach what it is checking, so its silence is never a pass;
  and a permissions 403 and a proxy-allowlist 403 read identically in a log
  line while being different failures (a proxy denial never prints
  `HTTP/1.1 200 Connection Established`; an allowed host does, even when the
  API then answers 403). §7b's standing authorisation to deploy is unchanged.
- **THAT GREEN RUN'S EMPLOYMENT ID IS DEAD, and the chain was re-checked
  because of it (2026-08-19, `docs/LIVE-PATH-STATUS.md`).** Ticket #6 used
  `fde4007b-…`; the Sandbox has since been reseeded and that id 404s. So the
  whole chain became of **unknown** status — not broken, unknown — and a demo
  recorded against an unknown chain fails on camera. What was re-verified from
  this container, live: the demo ids are alive and `active`, real OpenAI
  classification (`source: "llm"`, not the fallback), the real Sandbox read,
  the identity gate **in both directions**, the positive decision
  (`auto_resolve` / `all_gates_passed`) *and* the refusal
  (`human_review` / `over_scope_request`), and the letter rendering with zero
  salary against records that carry `25000` and `10399748`. What is **still
  UNKNOWN**: the deployed n8n graph, the ticket → trigger → webhook → n8n hop,
  and therefore the n8n-written `audit_log` row. `npm run verify-live-uc01`
  re-runs the verifiable half read-only and writes nothing.
- **UC-01 IS FULLY GREEN END TO END (2026-08-15).** Zendesk ticket **#6** was
  created and, with no further intervention, was **solved 5 seconds later**:
  customer comment `21:34:36` → n8n **execution `3645` (`status: success`)** →
  letter posted publicly at `21:34:41`, rendered as real HTML, no salary →
  ticket `solved`, tagged `uc01_auto_resolved` → real `audit_log` row at
  `21:34:41.156537+00`, `classification.source: "llm"`,
  `identity: requester_matches_employment`. Tickets **#3/#4/#5** carry the same
  shape. Nothing pinned anywhere.

  **Live config that produces this** — do not "fix" any of it without reading
  the three gotchas below: employment-ID field **`9990000000001`**, webhook
  **`01ZENDESKWEBHOOKIDPLACEHLD`** ("UC-01 n8n verification v4" →
  `…/webhook/uc-01-verification?src=zendesk`), trigger **`9990000000004`**
  ("UC-01 verification v2", the three-condition tag guard).
- **`publicReply` on the n8n Zendesk node is PLAIN TEXT and silently escapes
  HTML.** Its `internalNote` sibling is the one documented "(Accepts HTML)".
  With `publicReply` the customer received the letter as literal
  `&lt;!doctype html&gt;&lt;html&gt;…` source — a fully "successful" run that
  delivered garbage to the customer, visible nowhere in n8n's status. Fixed by
  switching that node to `jsonParameters: true` with
  `updateFieldsJson` carrying `comment.html_body`. **Check the rendered comment
  on the ticket, not the node's success flag.**
- **A Zendesk trigger record can wedge permanently after partial `PUT`s.**
  Trigger `9990000000005` fired exactly once, then never again — while a
  co-resident Ultimate.ai trigger fired on the very same ticket updates. It read
  back perfectly every time (`active: true`, correct conditions, correct webhook,
  position moved to 1) and still never fired, including with a single
  `current_tags includes` condition and a freshly-created webhook whose delivery
  Zendesk's own `POST /api/v2/webhooks/test` confirmed working. **Creating a new
  trigger with byte-identical conditions fixed it instantly** (3 invocations on
  the first nudge). If a trigger stops firing and its JSON looks right, stop
  bisecting conditions — recreate the record.
- **Bisecting trigger conditions against a circuit-broken webhook proves
  nothing.** An earlier pass here concluded "the custom-field condition is the
  culprit" from three clean negative results, all of which were actually the dead
  webhook. Confirm delivery works (`POST /api/v2/webhooks/test`) *before*
  attributing a non-firing trigger to its conditions.
- **Idempotency — now on all nine graphs, and proven on one of them.** Ticket #5 received three
  near-simultaneous trigger invocations and produced **two `audit_log` rows 30µs
  apart** (`21:26:20.986108` and `.986138`), plus a duplicate public letter.
  Nothing in the workflow checked whether a decision for that `externalRef`
  already existed. Now:
  - **Node path: fixed and tested.** `caseStore.claimExternalRef()` claims the
    ref before the case row, the audit row and any Zendesk action.
  - **The ledger is one table for both paths** — `workflow_claims`, keyed
    `(use_case, external_ref)`, provisioned 2026-08-16. Two ledgers would not
    have helped: each execution path would read the other's refs as unclaimed.
    The guarantee is the **PRIMARY KEY**, not application code — a
    check-then-insert in a Code node has exactly the race that caused the bug.
    Keyed by use case as well as ref because one ticket may legitimately reach
    two use cases (UC-03 routes on to UC-04); keying on the ref alone would
    silently drop the second, which is worse than the duplicate it prevents.
    It supersedes `uc01_processed_refs` (empty at migration time, left in place
    rather than dropped).
  - **n8n path: all nine graphs now carry the claim node.** Each runs
    `…Gates → Claim Ticket (Idempotency) → Carry Context After Claim →
    <first durable write>`, with the claim node's error output (conflict =
    already claimed) ending at a NoOp named `Duplicate Delivery — Stop`, so a
    redelivery stops quietly instead of erroring the run — redelivery is normal
    webhook traffic, and erroring would page a human every time Zendesk behaved
    normally. Placement is deliberate: **after** the gates (re-deciding is free
    and leaves no trace, and a duplicate stopped earlier never records why) and
    **before** the first durable write (everything downstream is a record or an
    outward act). `Carry Context After Claim` restores the gates' output,
    because the Supabase node emits its own insert response, and it sets
    `pairedItem` explicitly — several graphs address the gates node by name
    (`$('Workation Gates').item`), which resolves through item pairing.
  - **What is proven vs. deployed, per graph.** **UC-07 is proven in both
    halves**: driven twice through its production webhook under one external
    ref (`claim-proof-uc07-a`), it produced exactly one `workflow_claims` row,
    one `uc07_dossiers` row and one `audit_log` row, and the second delivery
    stopped at the NoOp. **UC-02, 03, 06, 07, 08, 09** each recorded exactly
    one real claim row under a `claim-proof-` ref. **UC-04 and UC-05 are also
    proven in both halves** — two independent pairs each (executions
    `4248`/`4250` and `4263`/`4265` for the first deliveries, `4252`/`4253` and
    `4267`/`4268` stopping at the NoOp), **12/12 row counts of exactly 1**
    across `workflow_claims`, `uc04_authorizations`, `uc05_resignations` and
    `audit_log`, `pinData: {}` on every run. They missed the first pass only
    because that pass used a **dead employment id** (see the stand-in gotcha
    below), not because of anything about their graphs. **UC-01's**
    claim node predates this pass and was drafted via the MCP, which does not
    publish; it has since been **verified live and published** — read back
    2026-08-17, `activeVersionId === versionId` on `WORKFLOW_UC01_ID`, the node
    present and wired `Identity + Policy Gates → Claim → Carry Context After
    Claim → Append Audit Log`. The earlier "DRAFTED, NOT PUBLISHED" warning
    here is therefore closed. Full write-up: `docs/BUILD-LOG.md` §3.24 and
    `workflows/README.md`'s "Exactly-once delivery" section.

  `findRedundantCalls()` in `src/metrics/compute.js` remains the detector.
- **Ultimate.ai posts a contradictory auto-reply after resolution.** On ticket #6
  it told the customer "a member of the support team will get back to you within
  the next 48 hours" — 5 seconds *after* the automation had already answered and
  solved the ticket. Not a bug in this project, but it makes the live account a
  poor demo surface until that trigger is scoped away from `uc01_test` tickets.
- **UC-01 was first proven from a real inbound Zendesk ticket earlier the same
  day (2026-08-15).** This
  was the one thing no execution had ever demonstrated. Zendesk ticket **#3** on
  `your-subdomain` (requester Alexandre Tremblay, tagged `uc01_test`, employment
  field set) fired trigger `9990000000005` → webhook → n8n **execution `3577`**,
  which ran: real OpenAI classify (`gpt-4o-mini-2024-07-18`, `classification.
  source: "llm"`, 151 tokens) → real Remote Sandbox employment read → identity
  `requester_matches_employment` → `auto_resolve` / `all_gates_passed`, zero
  flags → **real `audit_log` row `cdbff141-9355-4a40-97a4-65ee7c2d3405`
  (`at 18:12:58.507864+00`, `details.externalRef: "3"`)** → letter rendered with
  no salary despite the Sandbox record carrying `compensation_gross_amount:
  25000`. Execution `3574` is the same chain driven by a direct POST
  (audit row `2e85be29-b7a5-4857-b619-b719c2aac3b9`). **Nothing was pinned in
  either run.**

  Both are marked `error` in n8n because the FINAL Zendesk write fails on a
  stale credential (below) — downstream of the audit write, which is precisely
  the ordering the architecture exists to guarantee. Read node status, never run
  status.
- **The audit-ordering fix is LIVE, not a draft.** Earlier revisions of this
  file said the active version still audited after the Zendesk action. Read back
  from the live graph 2026-08-15, the active connection order is
  `Identity + Policy Gates → Append Audit Log → Carry Context Forward → Route by
  Decision`, and executions `3574`/`3577` confirm it behaviourally: the audit row
  lands at execution index 6 while Zendesk fails at index 10.
- **TWO n8n credentials are stale and are the only thing left blocking a fully
  green run. Neither can be fixed from a coding session** — credential *values*
  are not exposed through the n8n MCP, so both are human steps in the n8n UI:
  1. **`CRED_REMOTE_SANDBOX` ("Remote Sandbox", httpHeaderAuth)** holds a token for
     the **previous** Sandbox account. Proof: it resolves `fde4007b-…`
     (Alexandre Tremblay) which returns 404 for the token in this container's
     `REMOTE_API_TOKEN`, and 404s `2f7f8210-…` (Alex Morgan) which that token
     resolves fine. Paste the current `REMOTE_API_TOKEN` into it.
  2. **`CRED_ZENDESK_OAUTH` ("Zendesk account", zendeskOAuth2Api)** still points at
     the retired account and fails with *"Expected JSON response from OAuth2
     token endpoint (content-type: text/html…)"* — the token endpoint answers
     with an HTML page, not JSON. **Root cause found and half-fixed 2026-08-15:**
     the `remote-ikan` OAuth client (id `YOUR_OAUTH_CLIENT_ID`, confidential) had
     `redirect_uri: ["https://n8n.your-host.example/oauth/callback"]`, which
     is **not** n8n's callback — n8n uses
     `/rest/oauth2-credential/callback`. The mismatch sends the browser to a
     non-callback page, so n8n parses HTML where it expects a token JSON. The
     correct URL has now been added to the client via
     `PUT /api/v2/oauth/clients/YOUR_OAUTH_CLIENT_ID.json` (both entries kept). What
     remains is the **browser consent click** in n8n — inherently interactive,
     and the one step no coding session can perform.

     Note for future debugging: that client's granted scopes read
     `["read","write","tickets:read","tickets:write","users:read","users:write",
     "triggers:read","triggers:write", …]` — no `webhooks:*` entry, yet webhook
     creation succeeds, because the broad `write` scope covers it.

  **Only #2 blocks a fully green run.** #1 is a mismatch, not a failure:
  n8n's Remote credential resolves its own (older) Sandbox account perfectly —
  execution `3577`'s employment read succeeded against it. It only needs
  changing if a demo should feature the employees in the *newer* Sandbox that
  this container's `REMOTE_API_TOKEN` sees. Demos using Alexandre Tremblay
  (`fde4007b-…`) need no credential change at all.
- **Node's global `fetch` ignores `HTTPS_PROXY`, and this container refuses
  anything that goes direct.** Every `npm run live` / `livedemo` / `remoteui`
  invocation here needs **`NODE_USE_ENV_PROXY=1`** or it fails with
  `403 Host not in allowlist: <host>` — a message that reads like an allowlist
  problem even when the host IS allowlisted and `curl` to it returns 200 in the
  same shell. The OpenAI SDK needed more than the env var (it installs its own
  dispatcher); `src/shared/llm.js` now delegates to `globalThis.fetch` whenever
  `HTTPS_PROXY` is set.
- **Supabase Postgres is NOT reachable from this container at all** — `pg` opens
  a raw TCP connection, which an HTTP CONNECT proxy cannot relay, so
  `db.<ref>.supabase.co:5432` fails `ENOTFOUND` no matter what is allowlisted.
  `npm run live` therefore cannot complete its step 3 here. This is an
  environment limit, not a bug: n8n writes `audit_log` over the Supabase **API**
  and is unaffected, which is why executions `3574`/`3577` audited successfully.
  Verify rows with the Supabase MCP rather than `psql`.
- **All nine UC n8n workflows are now active as of 2026-08-10**, per an
  explicit user go-ahead for full production-ready confirmed system testing:
  UC-02 `WORKFLOW_UC02_ID`, UC-03 `WORKFLOW_UC03_ID`, UC-04 `WORKFLOW_UC04_ID`,
  UC-05 `WORKFLOW_UC05_ID`, UC-06 `WORKFLOW_UC06_ID`, UC-07 `WORKFLOW_UC07_ID`,
  UC-08 `WORKFLOW_UC08_ID`, UC-09 `WORKFLOW_UC09_ID` — all verified `active:
  true` live via `mcp__n8n__search_workflows` immediately after activation.
  See `workflows/README.md`'s resolved-discrepancy note for the full context
  (an earlier session had found four of these already active unexpectedly;
  it has since been confirmed as intentional).
- **Real unpinned execution proof: FIVE of the nine have it — UC-01, UC-03,
  UC-04, UC-05 and (2026-08-27) UC-09.** Established by opening each execution and reading node-level
  status, not by trusting the run result:
  - UC-01 execution `22` — real `audit_log` row `d7b067a1…`.
  - UC-03 execution `404` — real Remote read, real OpenAI classify
    (`classification.source: "llm"`), real `audit_log` row.
  - UC-04 execution `408` — real Remote read (880ms, live Sandbox record for
    Alexandre Tremblay), real `uc04_authorizations` row `bb105479…` AND real
    `audit_log` row `a4f93179…`.
  - UC-05 execution `409` — same shape, and `pinData: {}` (nothing pinned
    anywhere in the run, so it is the strongest of the four).

  **All four are marked `error` in n8n**, every one failing at its final
  Zendesk node with `400 — id must be an integer`, because the test passed a
  descriptive `externalRef` (`prod-proof-uc04-20260810b`) where Zendesk wants
  a numeric ticket id. The failure sits *downstream of the audit write*, which
  is exactly the ordering the architecture exists to guarantee. **Do not read
  the run status as the verdict in either direction** — a pinned green run
  proves nothing, and these red runs proved almost everything.

  - **UC-09 execution `9279` (2026-08-27) — the strongest of the five, and the
    only one driven by a real inbound Zendesk ticket THROUGH AN AUTHENTICATED
    webhook.** Ticket **135** created by hand (tag `uc09_test`, employment field
    `3537d9ee-…`) → trigger → Zendesk invocation `16:58:10Z success HTTP 200`
    (carrying `X-YOUR-WEBHOOK-TOKEN`) → execution `9279`, **`pinData: {}`**,
    **14 of 14 nodes `success`**: real Remote employment read, gates, claim,
    `uc09_adjustments` row `8d395fd6-…`, real `audit_log` row
    **`f3f5e07b-5fe1-4995-833a-ded4cdab31df`** at `16:58:13.425499+00`, audit
    trace, routing, and a real Zendesk write back to ticket 135.
    **It is a REFUSAL, and that is the honest framing** — the decision is
    `escalate / identity_not_verified`, because a Zendesk ticket carries no
    Remote session and the requester does not match the employment record. So
    this proves the chain and the fail-closed path; it does **not** prove
    UC-09's approval path, which nothing has yet exercised end to end.

  Still outstanding for **UC-02, UC-06, UC-07, UC-08**. Two of the nine have now
  been driven by a real inbound Zendesk ticket (UC-01, UC-09); the earlier flat
  claim that none ever had was true when written and is superseded.
- **Webhook (production):**
  `https://n8n.your-host.example/webhook/00000000-0000-4000-8000-00000000n8n0/uc-01-verification`
- **ALL NINE PRODUCTION WEBHOOKS NOW REQUIRE A SHARED SECRET HEADER (2026-08-27).**
  `X-YOUR-WEBHOOK-TOKEN`, one 64-hex secret held in nine Zendesk webhook records
  (`authentication.type: api_key`) and one n8n credential
  (`n8n Secure Zendesk Comm`, `CRED_WEBHOOK_HEADER_AUTH`) selected on all nine webhook
  nodes. **Anything that POSTs to these paths must send that header or it gets
  403.** Before this date every one of them executed for anybody who knew the
  URL, and eight of the nine returned the employment record on the way out
  (F-4). Verify with `npm run verify-webhook-auth` — exits 2, never 0, when it
  cannot reach n8n. Proven in both directions: 9/9 refuse an unauthenticated
  POST and create no execution, and a REAL Zendesk ticket drove UC-09 green
  (invocation `16:58:10Z success HTTP 200` → n8n execution `9279 success`).
  **Rotation order is Zendesk first, n8n second, and it is not optional** — the
  reverse produces failed deliveries, and a Zendesk webhook that fails once
  circuit-breaks and can only be replaced. Full record, and three traps that
  each cost real time: `docs/WEBHOOK-AUTH.md`.
- **Zendesk account CHANGED.** The project now points at **`your-subdomain`**
  (employment-id custom field **`9990000000001`** — NOT `9990000000007`, which
  has never existed on this account and is corrected further down this list),
  not the `your-subdomain` /
  `99900000000006` pair most of this file's history refers to. The webhook and
  trigger created by `scripts/setup-zendesk-trigger.mjs` exist only on the OLD
  account, so **nothing carries over** — they must be created fresh, and the
  n8n Zendesk credential re-pointed.
- **Container egress is now OPEN and verified (2026-08-15).** The environment's
  allowlist needed **`*.zendesk.com`**, not `zendesk.com` — the apex matched
  (301) while `your-subdomain.zendesk.com` was refused at the proxy's `CONNECT`
  with a 403. That 403 reads identically to an API permission error but is not
  one: a proxy denial never prints `HTTP/1.1 200 Connection Established`, and
  an allowed host does, even when the API then answers 403. **Check for that
  line before debugging credentials** — hours were lost here. Verified live
  afterwards: Remote Sandbox `200`, OpenAI `200`, n8n reachable, Zendesk
  reachable. `npm test` re-run with real keys AND open egress: 810 tests, 6.0s,
  still hermetic — the timing baseline is the check (see §6).
- **The `your-subdomain` OAuth client is scopeless — `client_credentials` cannot
  be used with it.** Requesting ANY scope (`read`, `tickets:read`, `write`,
  every combination, form-encoded and JSON, string and array) returns
  `invalid_scope` — "exceeds the previously granted scope". Omitting `scope`
  DOES return a valid 182-char bearer token, which then 403s on every endpoint
  with `"You are missing the following required scopes: read"`. So the token is
  genuine and the client secret is correct; the client simply has an empty
  granted-scope set. `scopes` (plural) is silently ignored and yields the same
  useless token — do not mistake that 200 for success.

  **Cause, confirmed against Zendesk's own reference** (`developer.zendesk.com/
  api-reference/ticketing/oauth/grant_type_tokens/`, fetched live 2026-08-15):
  an OAuth client has an **Allowed scopes** setting, and the docs name exactly
  our two symptoms as distinct cases. *"Scope outside client's allowed scopes:
  if the OAuth client has allowed scopes configured and you request a scope not
  included in that list, the endpoint returns 400 Bad Request with an
  `invalid_scope` error and no token is created."* And *"Unrecognized scope
  string (for example a typo such as an array instead of a string): the
  endpoint still creates an access token. However, any API request made with
  that token will return a 403 Forbidden error."* So the `your-subdomain` client
  has a **non-empty but wrong Allowed-scopes list** — an empty list would allow
  everything ("leave this field empty to allow all scopes"), which is not what
  we observe.

  **Resolution — populate Allowed scopes on the existing client**, in Admin
  Center → Apps and integrations → APIs → OAuth clients → the client → the
  **Scopes** field → select `read` and `write` → Save. No new client, no code
  change, no API token. `client_credentials` with `scope: "read write"` then
  works. An earlier revision of this note claimed the Admin Center form has no
  scope picker and that `POST /api/v2/oauth/clients.json` was the only way —
  **that was wrong**; the field exists in the current UI.
  **DONE 2026-08-15** — populated by hand; `scope: "read write"` now
  returns a working token and `users/me`, `ticket_fields`, `webhooks` and
  `triggers` all answer `200`.
- **`your-subdomain` resources, all created 2026-08-15 and all live.** The field id
  this file previously recorded (`9990000000007`) **never existed on this
  account** — `GET /api/v2/ticket_fields/9990000000007` returns 404 and no field
  on the account mentions Remote or employment. Created fresh:
  - **Remote Employment ID** custom field — **`9990000000001`** (type `text`).
    This is the value `ZENDESK_EMPLOYMENT_ID_FIELD_ID` must carry, and it is
    also hard-coded in the n8n `Normalize Ticket` node (see below).
  - **Webhook `01ZENDESKWEBHOOKIDOLDPLACE`** → `https://n8n.your-host.example/webhook/uc-01-verification`.
  - **Trigger `9990000000005`** — "UC-01 verification — test-tagged tickets
    only", the three-condition tag-guard form (tag `uc01_test` + employment
    field present + none of the automation's own outcome tags).
- **The production webhook URL is `/webhook/uc-01-verification` — NOT the
  webhookId-prefixed form.** This file and `scripts/setup-zendesk-trigger.mjs`
  both recorded `…/webhook/00000000-0000-4000-8000-00000000n8n0/uc-01-verification`,
  which is also what n8n's own `get_workflow_details` triggerInfo prints. POSTing
  it returns **404 "webhook not registered"** while the plain path executes. Trust
  a live POST over the reported URL.
- **A Zendesk webhook that fails once is circuit-broken, and fixing its endpoint
  does not revive it.** The first webhook 404'd against the wrong URL above; its
  invocation went `status: "terminated"`. After correcting `endpoint` via
  `PUT /api/v2/webhooks/{id}` (a `PATCH` there silently returns an empty body —
  use `PUT`, which answers `204`) it still never fired again, and
  `GET /webhooks/{id}/invocations` stayed frozen at that one dead record while
  the trigger itself was firing normally. This looks exactly like a broken
  trigger condition and is not one — hours can be lost bisecting conditions.
  **Create a NEW webhook and repoint the trigger at it.**
- **Two webhook nodes sharing one webhookId stop the path registering at all.**
  The workflow carried a disabled leftover `Zendesk Ticket Webhook1` with the
  same `webhookId` and path as the live trigger; the production URL 404'd even
  though the workflow reported `active: true`. Removing it and republishing
  fixed registration.

  **Do NOT route around this with an API token.** Zendesk is removing API
  tokens as an API auth method: unused-token deactivation began 2026-07-28,
  replacement tokens stop being issuable 2026-10-27, and all tokens stop
  working **2027-04-30**. `restClient.js` still supports that path
  (`authMode`, line 88, picks `token` when the OAuth pair is absent) and it
  remains a valid local fallback, but building the live demo on it would be
  building on something with a published end-of-life date.
- **Setup workflow `WORKFLOW_SETUP_1`** — "UC-01 — Zendesk webhook + trigger
  setup (one-shot)". Creates the webhook + trigger on `your-subdomain` via
  Zendesk's REST API, from n8n. It exists because a coding session's container
  may have no network egress to `*.zendesk.com`, while n8n always does — so
  the setup runs from the machine that can actually reach Zendesk. Ported from
  `scripts/setup-zendesk-trigger.mjs`; same payloads, same tag-based
  single-fire guard.
  - The Zendesk `{{ticket.id}}`-style placeholders are assembled in **Code
    nodes**, not in HTTP parameters, because they share `{{ }}` syntax with
    n8n expressions and would otherwise be evaluated instead of stored.
    Verified by reading the deployed `jsCode` back.
  - **Before running it:** the `zendeskOAuth2Api` credential
    (`CRED_ZENDESK_OAUTH`) still points at the old account and must be
    re-pointed at `your-subdomain`. That credential is n8n's **authorization-code**
    OAuth, so the Zendesk OAuth client's redirect URL must be
    `https://n8n.your-host.example/rest/oauth2-credential/callback` — a
    different requirement from the app's own `client_credentials` flow, which
    ignores redirect URLs entirely.
  - **Its three HTTP nodes have no credential attached** — n8n strips
    credentials from HTTP Request nodes on create (see §6's gotcha), so they
    must be selected by hand in the editor once.
  - Creating webhooks/triggers needs broader scope than the app's routine
    `tickets:read tickets:write`; the original script requested `read write`.
    If the run returns 403, that is the cause.
- **n8n credential IDs:** Remote Sandbox `CRED_REMOTE_SANDBOX` (httpHeaderAuth) ·
  Zendesk `CRED_ZENDESK_OAUTH` (zendeskOAuth2Api) · OpenAI `CRED_OPENAI` (openAiApi) ·
  Supabase `CRED_SUPABASE` (supabaseApi, named "remote")
- **"Append Audit Log" runs BEFORE `Route by Decision`**, not after the Zendesk
  nodes, so the decision record is durable before any customer-facing action —
  matching `src/uc01/workflow.js`'s STEP 7/STEP 8 order. `Carry Context
  Forward` restores the decision context afterwards, because the Supabase node
  outputs its own insert response. **This is currently a draft; the active
  version still has the old ordering.**
- **"Append Audit Log" node is a Supabase node, not Postgres** — the Postgres
  credential type needs a raw host/port/user/password connection the account
  never had; the Supabase node's row-create operation uses the API-key
  credential above against the real `audit_log` table instead. `id`/`at` are
  left unset in the row and rely on the table's own `gen_random_uuid()`/`now()`
  defaults (confirmed via `mcp__Supabase__list_tables`).
- **Zendesk:** `your-subdomain.zendesk.com`; "Remote Employment ID" custom field `99900000000006`
- **Zendesk webhook + trigger** (created by `scripts/setup-zendesk-trigger.mjs`,
  corrected by `scripts/fix-zendesk-trigger-condition.mjs`): fires only when a
  ticket carries tag `uc01_test` + the Remote Employment ID field, AND does
  **not yet** carry one of the automation's own outcome tags
  (`uc01_auto_resolved`/`uc01_human_review`/`verification_exception`) — the
  original condition required `status: new`, but this Zendesk account moves
  agent-created tickets straight to `Open`, skipping `New` entirely, so that
  never matched. **As of this session the corrected trigger has not yet been
  confirmed to actually fire** — my local machine (where the real
  Zendesk OAuth credentials live) went out of reach before re-running the fix
  script. This is the immediate next step, not a resolved item.
- **One known real Remote Sandbox employee for demos**, confirmed live:
  Alexandre Tremblay, id `fde4007b-6257-4504-9467-8d61b5785488`, contractor,
  status active — see `src/livedemo/employees.js` for how to add more.
- **Supabase:** project `your-project-ref` ("remote-cx-automation").
  Tables `audit_log`, `cases`, `review_queue`, `documents`,
  `consent_records`, `request_artifacts`, `extracted_requirements`. RLS enabled,
  zero policies — backend-only via the `postgres` role (Node app) or the
  `supabaseApi` credential above (n8n).

---

## 5. Session log — moved

The full session log is **`docs/history/SESSION-LOG.md`** (moved 2026-08-21,
unchanged). It records what each past session changed and why.

Read it when you are asking *why is this like this*. Do not read it by default:
it was 69 KB of the 232 KB that every agent loads before starting work.

What belongs to the CURRENT state is still here: §4 (status), §6 (gotchas —
read those, each one cost a real afternoon) and §7 (what is still open).

## 6. Gotchas already paid for — do not rediscover these

- **Never write a port literal into a server file — add it to
  `src/shared/ports.js` and import it.** Every UC API binds *two* sockets: its
  documented API port and an undocumented mock-Remote server it seeds from and
  keeps alive for the whole process. That second port is in no README and no
  URL, so each file picked its own and claimed in a comment to be "distinct
  from every other mock-server port already in use." Three of those comments
  were wrong in the same way — checked against the other *mocks*, never against
  the *API* ports. uc02's mock sat on UC-03's API port, uc03's on UC-04's, and
  uc04's and uc05's were identical. Starting all nine the way
  `npm run dashboard` tells you to killed two of them, and which two depended
  on start order. `test/ports.test.js` now enforces uniqueness, the reserved
  `4070–4089` band for internal mocks, and that no CLI hard-codes a port at
  all. A comment asserting global uniqueness cannot be checked; a test can.
- **n8n Code node bodies must be real `.js` files** (`workflows/nodes/*.js`),
  never template literals in the builder. Two escapes collapsed on first
  deploy: `join('\n\n')` became a literal newline inside a string literal, and
  `/https?:\/\//` became `/https?:///` — which JavaScript parses as a regex
  *followed by a line comment*, so a boolean silently held a `RegExp` object.
  Always truthy, nothing crashes, and **every ticket routes to human review**
  while the automation resolves nothing. The suite now compiles all four bodies
  on every run.
- **A Zendesk ticket carries no Remote session.** `session` was always `null`,
  so the identity gate failed for every ticket and the auto-resolve path was
  unreachable. n8n now derives identity from the ticket's Zendesk-authenticated
  **requester**, matched against the email on the Remote record. Never an
  address from the ticket body — a claimed address proves nothing.
- **The gates exist twice** (`src/uc01/policyEngine.js` and
  `workflows/nodes/gates.js`). `test/n8nParity.test.js` executes the real n8n
  body in a `node:vm` sandbox and asserts identical decisions. **If you edit one,
  edit both** — the suite will catch you, but know why.
- **UC-08's retriever is in the same "exists twice" shape, with a deliberate
  split.** `src/uc08/treatyRetriever.js` is now embedding-similarity over a
  pgvector table when configured (issue #29), and its n8n counterpart in
  `workflows/nodes-uc08/buildDossier.js` keeps the keyword path — NOT an
  accidental divergence: an n8n Code node has no pgPool or embedding client,
  and the real function runs the same keyword path whenever unconfigured, so
  the parity test compares like with like. **If you touch the retriever, do not
  "fix" the n8n node by pasting the class into it** — the node's whole point
  is the dependency-free fallback the real function also falls back to.
- **`node:vm` results are cross-realm.** `assert.deepEqual` fails on prototype
  identity, not content. JSON round-trip the result (which is also what n8n does
  between nodes).
- **`npm install` is required.** `src/shared/llm.js` has a top-level
  `import OpenAI`, so a fresh clone fails `npm test` without it.
- **Never let `npm test` reach OpenAI.** This burned real credit once. The fix
  was structural (dependency injection), not procedural. This bit again this
  session, one layer deeper: a genuine but unreachable `OPENAI_API_KEY` sitting
  in this devcontainer's `.env` meant any test not explicitly injecting a fake
  `classify`/`draftSummary`/`draftNarrative`/`judge` was making a real, slow,
  failing network call — caught twice in the same session (issues #32 and #27)
  before either shipped. **Every new LLM call site needs its own injectable
  seam from day one**, not added after a slow test surfaces the gap.
- **`caseStore` child inserts must chain on the parent's write.** A `documents`
  insert once beat its parent `cases` row to Postgres and hit a live FK
  violation.
- **n8n skips credential auto-assignment for HTTP Request nodes.** They must be
  selected by hand in the editor.
- **The review API usually runs in a DIFFERENT PROCESS from the workflow**, so
  its in-memory `CaseStore` arrays are empty and Postgres is the only place the
  row exists. `updateCaseStatus`/`updateReviewQueueStatus` therefore never
  require the row to be in memory. Getting this backwards yields an API that
  passes every test and silently no-ops in production.
- **Browser assets are never imported by `npm test`**, so a syntax error in
  `zaf-app/assets/*.js` ships while the suite stays green — the same shape of
  risk as the n8n Code node bodies. `test/zafApp.test.js` compiles them on every
  run, and also asserts no `innerHTML` and no re-derived policy.
- **`computeMetrics().byUseCase` is an ARRAY, not a map** keyed by use case.
  `report.byUseCase["UC-01"]` is `undefined`, not an error.
- **A PINNED n8n node reports `executionStatus: "success"` without doing
  anything.** `mcp__n8n__test_workflow` pins every credentialed node, so a
  Supabase write node returns `{ success: true }` from pin data and the whole
  execution goes green having touched no database. This is how "execution 10
  ran through to audit" survived in the docs for two sessions while
  `audit_log` had zero n8n-written rows. **A green n8n execution is not
  evidence that an integration works — check the destination.** Only
  `execute_workflow` (not `test_workflow`) exercises the real service.
- **`PUT /api/v1/workflows/{id}` on the n8n REST API PUBLISHES IN PLACE;
  `mcp__n8n__update_workflow` only writes a DRAFT.** Two tools, two opposite
  defaults, both pointed at live automations that reply to real customers. §5
  used to record only the MCP behaviour, which reads as if every n8n edit is
  safely staged — it is not. A REST `PUT` against an already-active workflow is
  a production change the moment it returns `200`; there is no promote step and
  no second chance to look at the diff. The MCP path is the reverse trap: the
  update returns success, production keeps running the old graph, and the first
  re-drive produces a row with the old shape, which reads exactly like the fix
  not working (that is how the UC-02 audit fix looked broken for a run).
  **Whichever tool you used, check `activeVersionId` against `versionId`** —
  that comparison is the only thing that answers "is this live?", and it
  answers it for both.
- **Why the stand-in exists at all is written up for a reader outside this
  project: `docs/SANDBOX-STANDIN.md`.** The substitution ladder, the two
  non-negotiable constraints (every substituted fact self-identifies; money is
  never fabricated), and the reason "it always refuses" is the worst possible
  demo failure. Written to be published — link it rather than re-explaining.
- **UC-04, UC-05 and UC-06 point at `your-sandbox-standin.vercel.app` ON
  PURPOSE. Do NOT "fix" them to `gateway.remote-sandbox.com` — that repoint
  breaks all three.** The other six graphs do use the gateway, and the
  odd-three-out pattern reads exactly like drift. It is not. The stand-in
  (`src/remotebridge/`, deployed from `deploy/remote-bridge/`) is a read-only
  proxy to the real gateway: it forwards the caller's `Authorization`
  untouched, refuses writes with 405, 502s on upstream failure, and fills
  **only fields the real Sandbox left null**, naming every one it touched in an
  `X-Standin-Enriched` header and a `_standin` body block. UC-04 needs
  `custom_fields.workation_permission` and UC-05 needs
  `basic_information.start_date`; the raw Sandbox returns `undefined` for both.
  On gateway data UC-04 would block **every** request with
  `employer_permission_not_granted` (`policyEngine.js:120`) and UC-05's tenure
  arithmetic would have no start date to compute from. `enrichment.js` names
  these two use cases as the ones that need it.

  **UC-06 was added 2026-08-18, and for a different reason: not an empty FIELD
  but an empty PERIOD.** The Sandbox's payroll calendar stopped — live, the
  last `period_end` is 2026-06-30 for SG/FR/CA/US and 2026-07-31 for NL, all in
  the past. So `evaluateCutoff()` finds no cycle covering any future effective
  date, and UC-06 escalates `noMatchingCycle` for **every** amendment anyone
  will ever submit. That is the gate working correctly and it is also a use
  case that can only ever be demonstrated refusing — the exact failure shape
  §3.30 keeps costing us, where "structurally cannot succeed" and
  "appropriately cautious" are indistinguishable from outside.
  `payrollProjection.js` continues each country's own observed cadence past its
  last real cycle, under the same honesty rule rotated one dimension:
  enrichment may fill a field the Sandbox left empty, projection may append a
  period it leaves uncovered. A real cycle is never touched and always wins;
  projected ids begin `standin-`; `total_payroll_cost` and `approval_date` stay
  null because inventing money is the one thing forbidden outright.

  **Both halves of the UC-06 demo are therefore real, and only one needs the
  stand-in.** Pointed at the raw gateway, a September date refuses with
  `noMatchingCycle` and a June date refuses with `cutoffAlreadyPassed` naming a
  REAL cycle — both on 100% Sandbox data. Only the approval path needs a cycle
  whose lock has not yet closed, because no such cycle exists anywhere. Set
  `STANDIN_PAYROLL_HORIZON_MONTHS=0` on the deployment to turn projection off
  and reproduce the refusal through the same URL.

  **This was nearly deployed as a fix.** The host difference was diagnosed as
  the cause of a 404 that was really a dead employment id — a 404 that
  reproduces **identically through both hosts**, which is what makes the wrong
  diagnosis so easy to believe. Test the id against both hosts before blaming
  either one.
- **`fde4007b-6257-4504-9467-8d61b5785488` IS DEAD. The Sandbox was reseeded.**
  Every "known good employee" payload in this repo's history points at it, and
  it now 404s from the container, from n8n, and through both hosts above. The
  same person exists under a new id: **Alexandre Tremblay
  `3537d9ee-2017-4a53-952e-9d3b042aeab5`** (contractor, active). Others
  verified live 2026-08-17: Alex Morgan `2f7f8210-91fc-47db-803c-77a1cc625781`
  (employee), Anna Müller `09b65526-643b-4956-959b-916e6429bd23` (employee),
  Amanda J Walker `e818418e-1db7-431d-a663-9f477addb8bd`. A dead id produces a
  404 that looks like a credential, host, or permission problem and is none of
  them — **list `/v1/employments` and confirm the id still exists before
  debugging anything else.** Relatedly, this file's warning that credential
  `CRED_REMOTE_SANDBOX` holds a *previous* account's token is now **stale**: it
  resolves the current account (execution `4263`), and it is `fde4007b-…` that
  is gone, not the credential that is wrong.
- **n8n orders a fan-out by CANVAS POSITION, not by the connection array.**
  A branch that must not be lost has to sit HIGHER on the canvas, and nothing
  in the JSON you are editing says so. UC-01's `Persist Case` fans out to a
  review-queue branch and the audit spine; the spine sat at y=40 and the queue
  branch at y=240, so n8n walked the spine to its end first, `Escalate Ticket`
  failed on a non-numeric ticket id, the execution ended — and the queue branch
  was still sitting unrun on `nodeExecutionStack`. Two deliveries recorded
  `claim 1 / case 1 / audit 1 / queue 0` on an `escalate` that must be queued.
  **Reordering the connection array changed nothing**, which is what makes this
  expensive: the obvious fix is silently a no-op, and the second failure looks
  like the first diagnosis was right but incomplete. Only `get_execution`'s
  `nodeExecutionStack` shows the node pending rather than skipped. Swapping the
  y-coordinates fixed it (`claim 1 / case 1 / queue 1 / audit 1`, twice
  delivered). Corollary: a fan-out branch is only reached if **everything**
  before it survives, so never place a must-not-lose write downstream of a
  branch that can fail.
- **An installed ZAF app is a STATIC UPLOAD. It does not track this repo.**
  Editing `zaf-app/assets/` changes nothing in Zendesk until `zcli apps:update`
  runs, and the account will happily keep serving a bundle that is hours old
  while the repo, the tests and every reviewer's reading of the code all agree
  on the new behaviour. Check the app's own `version` and `updated_at` via
  `GET /api/v2/apps/owned.json`, not the manifest in the working tree. (As of
  2026-08-19 the two DO agree: app `9990001` is at manifest `1.1.0`, uploaded
  `23:06:54Z`, ~8 minutes after the commit that bumped it.)
- **A closed issue can stay open in one status file and closed in another, and
  both directions happened on the same day.** `CLAUDE.md` §7 listed three
  `src/remote/` standing issues as open for two days after `docs/BUILD-LOG.md`
  §5 had recorded them closed with a commit hash; simultaneously, BUILD-LOG §5
  still called UC-02's expense-category 403 a credentials problem after
  `CLAUDE.md` §7 had recorded that it was never one. **Neither file is
  authoritative over the other — the code is.** When a status line matters,
  grep for the thing it describes before believing it, and when you close
  something, close it in both files in the same unit of work. That is what the
  continuity rule at the top of this file is for, and this is what it costs
  when it slips.
- **A Vercel deployment that reports `Canceled` in ~10s is almost certainly
  `vercel.json`'s `ignoreCommand` working correctly — and NO number of
  redeploys will ever change it.** The command is
  `git diff --quiet ... -- api deploy src package.json package-lock.json
  vercel.json`, and `git diff --quiet` exits **0** when those paths are
  unchanged. **Vercel treats exit 0 as "skip this build", which it reports as
  `Canceled`** — indistinguishable in the UI from a build that was killed.
  A docs-only commit is therefore permanently unbuildable by redeploy.

  **The trap that costs the time: an environment-variable change does not alter
  the git diff.** So "set the var, then redeploy" — the standard advice, and
  what Vercel's own UI implies — **cannot work** on a commit the ignore step
  skips. Observed 2026-08-27: five consecutive `Canceled` redeploys of
  `064374a` (README + `test/` + `workflows/`, none of them watched paths) while
  a genuinely needed `ZENDESK_EMPLOYMENT_ID_FIELD_ID` sat unapplied. The fix is
  to land a commit that touches a watched path; there is nothing to debug in
  the build itself. Check with
  `git diff --quiet <sha>^ <sha> -- api deploy src package.json package-lock.json vercel.json`
  — exit 0 means Vercel will skip it.
- **The test band can be occupied by something that is not a test.** `npm test`
  binds real ports out of `TEST_BAND` (`src/shared/ports.js`). A long-running
  dev server in the same container holding one of them fails a test with
  `EADDRINUSE`, which reads as a logic failure and is not one. Read the
  `failureType` — `uncaughtException` with `code: 'EADDRINUSE'` at a
  `server.listen` is an environment collision, not a regression.
- **Zendesk's webhook TEST endpoint cannot validate authentication — it will
  report a correctly-secured webhook as broken, every time.**
  `POST /api/v2/webhooks/test` builds a **synthetic webhook that carries no
  credentials**: the receiver sees `X-Zendesk-Webhook-Id:
  test_webhook:fake_webhook:…`, no auth header, and `Content-Length: 0` (it
  drops the body too). Proved by aiming a test at an echo service with an
  `api_key` declared **in the same call** and reading what arrived — the header
  was not sent. On 2026-08-27 it returned `403 Authorization data is wrong!`
  against a UC-09 configuration that a REAL Zendesk delivery accepted minutes
  later. **Only a real delivery proves a secured webhook works.** Twenty
  minutes went into believing the test tool over the system.
- **n8n PRUNES any parameter equal to the node's default, so ABSENT MEANS
  DEFAULT — and a checker that reads absent as "unset" inverts its own
  verdict.** The Webhook node's default `responseMode` **is** `onReceived`,
  which is also the value this project wants, so a node configured through the
  n8n EDITOR saves with no `responseMode` key at all
  (`raw keys = ['httpMethod','options','path']`). Two detectors got this wrong
  in opposite directions on the same afternoon: an ad-hoc check defaulted the
  missing key to `lastNode` and called nine healthy graphs a live disclosure,
  and `webhookResponseParamIssues()` compared strictly and called the same nine
  DRIFTED, with a message naming F-4 as reopened while it was shut — so
  `npm run verify-deployed` would have gone red on nine correct nodes. Fixed in
  `workflows/nodes/webhookResponseSpec.js` via `RESPONSE_MODE_NODE_DEFAULT`
  (`f5336c3`), with negative controls, because "absent means default" is one
  careless edit from "accept anything". It stayed hidden for five days because
  these nodes had only ever been written by an API `PUT`, which prunes nothing
  — **the first hand edit in the editor changed the stored shape on all nine at
  once.** Any check that diffs a UI-edited node against an API-written baseline
  shares this hazard.
- **An INBOUND door must never reuse an OUTBOUND credential, and n8n's
  dropdown will happily offer you one.** Setting a webhook node to
  `Authentication → Header Auth` lists every `httpHeaderAuth` credential on the
  instance — including **`Remote Sandbox- Christina`** (`CRED_REMOTE_SANDBOX`),
  the Remote API token that 15 nodes across seven graphs use to CALL Remote.
  Same type, opposite direction. It was selected and saved to production UC-01
  on 2026-08-27; had it stayed, every caller would have had to present the
  Remote API token, so a payroll-capable credential would have been pasted into
  nine Zendesk config screens any Zendesk admin can read, and rotating that one
  token would have broken all nine webhooks AND all 15 outbound calls at once.
  Caught by reading the live graph back rather than trusting the editor, and
  reverted within minutes; **no delivery occurred in the window**, so nothing
  failed and nothing circuit-broke — luck, not design.
- **A form field can be strictly true and still lie, when one word does two
  jobs.** The portal's persona picker printed `persona.kind` — the SESSION ROLE,
  which has exactly two values (`employee`, `company_admin`) — so it captioned
  **eleven different legal relationships "employee"**, including a contractor
  the very same card was about to refuse as `engagement_not_eor_contractor`.
  Nothing was false; `kind` genuinely was `employee`. It was read as a claim
  about the employment because `contract_type` spells one of ITS values the same
  way. **The screen contradicted the answer it was about to give.** Fixed by
  DERIVING the caption from the field the gate branches on
  (`labelledPersonas()` calls the same `contract_type` `classifyEngagement()`
  reads), not by adding an `engagement:` string beside each persona — that is
  the version that drifts, being a second copy of a fact the record already
  holds, and a drifting second copy is exactly what had just gone wrong one
  level up. It fails SOFT on an unreadable record (no caption at all), which is
  the one place in this repo where soft is right: captioning an unknown record
  "employee" is the defect. `docs/BUILD-LOG.md` §3.93.
- **A test that restates a COUNT cannot tell coverage going up from coverage
  going down, and will blame you for the wrong one.** `portalCopy.test.js` and
  `portalResultDialog.test.js` both asserted `7` request types with quick-fills.
  UC-01 had never had any — its card rendered a "Quick-fill a scenario" heading
  above an **empty row** from the day it shipped — and the guard could not see
  it, because "a type has no scenarios" and "the count is 7" were the same
  observation. When UC-01 finally got chips, both tests failed on the ADDITION,
  and one printed *"Escape was only exercised on"* above a list of all eight.
  Both now compare against `REQUEST_TYPES`, which is stricter and says what they
  meant: every type the portal serves must be demonstrable.
- **`support.remote.com` is a Zendesk Help Center, so Remote's own help
  articles are fetchable as JSON from this container** —
  `curl -s "https://support.remote.com/api/v2/help_center/en-us/articles/<id>.json"`,
  plus `…/articles/search.json?query=…`. This is **ladder rung 1** and it was
  sitting unused for weeks while `docs/INTAKE-RESEARCH.md` marked whole sections
  `[INFERRED]` off search-result summaries. Before writing `[INFERRED]` against
  anything on `support.remote.com`, try the API. `docs/UC01-INTAKE-FIELDS.md`.
- **A "green" metrics run is not evidence a retry sequence is legitimate,
  either.** `findRedundantCalls()` (issue #33) exists because the audit trace
  alone can't tell a genuine duplicate call from `withRetry()`'s own
  bookkeeping without checking whether the attempt numbers in a group form a
  clean `1..n` sequence — two entries both claiming attempt 1 look identical
  to a retry sequence unless you check the numbers, not just the count.

---

## 7. Next steps, in order

### Stage 3 — ZAF sidebar ✅ DONE
Built as `zaf-app/` (ZAF v2 sidebar: shared shell + per-use-case panel registry)
plus `src/review/` (approval policy, store, service, API). Approve/deny writes
to `audit_log`. See §5 above and `docs/BUILD-LOG.md` §3.6.

Two things remain, neither doable from a coding session alone — both are in §8:
verifying a **ZAF-signed identity token** instead of trusting the
`X-ZAF-Approver` header (a real piece of work, not a config change), and
**installing the app** into the live Zendesk account.

**Also done — the interactive playground** (`src/playground/`,
`npm run playground`). Not on the original roadmap; built because the fastest
way to trust the system is to click through it yourself. See §5 above and
`docs/BUILD-LOG.md` §3.7. This is a demo/testing aid, not a submission
deliverable in its own right — it doesn't change Stage 4 below.

**Also done — the chat demo** (`src/chatdemo/`, `npm run chatdemo`). The
playground's form+queue UI swapped for a conversation: each typed message runs
through the real `handleVerificationTicket()` and the actual result renders
back. Same demo/testing-aid framing and the same in-memory-only boundary.
See §5 above and `docs/BUILD-LOG.md` §3.14.

### Stage 3.5 — go live + the real-ticket demo (in progress, not done)
The n8n workflow is active and credentialed; `src/livedemo/` is built. The one
thing standing between here and a fully-proven live path:
1. On my own machine (real Zendesk credentials required — this
   session has none): re-run `scripts/fix-zendesk-trigger-condition.mjs`
   (already pushed; only needs re-running since the PC went out of reach
   before this was confirmed), then submit one real ticket — either by hand
   or via `npm run livedemo` — and confirm it flows all the way through:
   correct decision, correct real Zendesk update, a real `audit_log` row.
2. Once that's confirmed, decide whether to widen the trigger beyond
   test-tagged tickets, and update this file + `BUILD-LOG.md` to say "proven
   live end-to-end" instead of "not yet confirmed."

**Standing issues found 2026-08-17, none fixed — each needs a decision, not
just a patch:**
1. ~~**UC-02 cannot validate an expense category live.**~~ **CLOSED 2026-08-19 —
   this was never a token-role problem, and "needs a token with the right role"
   was the wrong work order.** `/v1/employee/expense-categories` is the
   **employee-session** endpoint; no company token opens it, so no credential
   change could ever have fixed it. The company-side route is
   `/v1/expenses/categories`, and it needs a discriminator. Verified live both
   directions this session, same token, same shell:

   ```
   GET /v1/employee/expense-categories        -> 403 "Forbidden, invalid role for this endpoint"
   GET /v1/expenses/categories?country_code=NLD -> 200, 36 rows
   ```

   `src/remote/restClient.js` already routes to the working endpoint (see its
   own probe table at the `listExpenseCategories` comment): 36/33/32/32 rows for
   NLD/PRT/CAN/USA. **The diagnosis is the lesson, not the fix.** A 403 saying
   *"invalid role"* reads as a permissions problem and names the credential as
   the cause, so it was filed as one and sat here as a blocked item needing a
   human with admin access. It was an endpoint problem the whole time. This is
   the same shape as §6's proxy-403 gotcha — an error whose own words point at
   the wrong layer. **Note also that `country_code` here wants ALPHA-3**: the
   alpha-2 form returns `422 {"country_code":["is invalid"]}`, which is a
   different failure string from the form-schema endpoint's `404 "Country not
   found"` for the same underlying mistake. No two alpha-3 failures in this API
   look alike, which is why each has had to be found separately.
2. ~~**The supported-countries gate is near-vacuous.**~~ **CLOSED 2026-08-18 —
   UC-03's predicate is CORRECT and unchanged; the real defect was one use case
   over.** Settled by a primary source the earlier 815-line research note
   missed: Remote's own OpenAPI for `/v1/travel-letter-requests` and
   `/v1/work-authorization-requests` types `destination_country` as
   `$ref → Country`, described as **"A supported country on Remote"**, with
   exactly the eleven `/v1/countries` properties. Registry membership is not a
   proxy this repo invented — it is the **domain of the field**. And
   `eor_onboarding` rides *inside* that destination object: Remote hands the EOR
   flag to a reviewer as context about the destination, never as a filter on it
   — if it filtered, a non-EOR country could never appear there at all. So
   "can Remote employ someone here" and "may this person spend three weeks
   here" are different questions, and answering the second with the first was
   always the error. `[CONFIRMED]`. (Live re-verify: 224 rows, 91 EOR / 133
   not, two captures on two days agreeing exactly. Also: 12 rows are neither
   EOR nor contractor-capable, so "can Remote transact here at all" fails as a
   travel predicate for the same reason.)

   **What the collapse actually hid: UC-04 had no jurisdiction screen at all.**
   Iran and Montenegro were indistinguishable — both `escalate |
   destination_out_of_scope`, a reason describing the risk matrix's own
   coverage rather than the destination. That is not cosmetic: `escalate` is
   one of the two decisions `src/uc04/workflow.js` calls
   `remote.createWorkAuthorization()` for (`blocked` is not), **so a sanctioned
   destination produced a real Remote work-authorization record** whose
   `destination_country` the schema above cannot even represent. Now a
   first-position hard block (`blocked` / `sanctioned_region`, no Remote write),
   with the restricted set **imported from UC-03 rather than copied** — a
   jurisdiction property is not a use-case property, and two copies drift.

   ~~**Still open, and it is the live half.**~~ **CLOSED — verified stale
   2026-08-19.** `workflows/nodes-uc04/workationGates.js` on the ACTIVE graph
   `WORKFLOW_UC04_ID` (`activeVersionId === versionId`) carries all ten
   restricted codes, normalised on both sides. Production does NOT escalate a
   sanctioned destination and does not write the record. Read read-only from
   the live graph rather than from the repo's copy, which is the only reading
   that answers the question.
3. ~~**`normalizeEmployment()` has the same latent alpha-3 fallback.**~~
   **CLOSED (`8dae81e`), and stale here for two days.** It now shape-checks a
   candidate before accepting it, so a 3-letter code is never placed in a field
   only ever compared against 2-letter values; unusable becomes `null`, and each
   consuming gate was then checked to fail closed on `null` (UC-05
   `unsupported_country`, UC-06 `country_schema_unavailable`, UC-09's floor
   staying at 2). `docs/BUILD-LOG.md` §5 has carried the closure since; **this
   list did not**, which is the exact failure mode §5's stale-§12.7 note warns
   about — a fixed gap that stays listed gets re-investigated by every fresh
   session.
4. ~~**`src/remote/mockServer.js` teaches the wrong shape.**~~ **CLOSED
   (`8dae81e`, extended by `58bad0a`).** The mock now serves the real
   `/v1/countries` shape, and `58bad0a` went further and captured *every*
   endpoint this project reads from the live Sandbox, correcting six
   divergences. The two that cost the most: the employment show route served
   `{data: <record>}` where the API nests under `data.employment` — so no test
   ever drove the nested normalization path **production always takes** — and it
   matched on the id alone and ignored everything after it, so every invented
   sub-resource answered `200` with the whole record.
5. ~~**`RemoteClient.listPayrollRuns()` coerces its own 404 to
   `{payroll_runs: []}`.**~~ **CLOSED, and the shape is now a documented
   pair**: `listPayrollRuns()` keeps its throwing contract while
   `listPayrollRunsResult()` (added in `5762af0`) reports instead, so an
   unreachable calendar is distinguishable from a genuinely empty one and
   UC-06's gate is reachable from the Node path for the first time. Items 3 and
   4 were also independently re-verified against the live Sandbox on 2026-08-19
   (`docs/BUILD-LOG.md` §3.39) — against the API, not against the comments
   claiming them fixed, which is a different check and the one that had never
   been run.
6. ~~**`audit_trace` still has zero rows from n8n.**~~ **CLOSED 2026-08-18 —
   this was stale, and the correction is worth keeping.** The per-attempt trace
   was already built, deployed, published and body-verified on all nine graphs
   (`Append Audit Log → Collect Trace Steps → Append Audit Trace`); `audit_trace`
   held 87 rows, every one written by n8n (`details.source: "n8n"`), covering
   `openai.classify*`, `remote.employment`, `remote.expense*`,
   `remote.countries`, `remote.country_schema` and `remote.payroll_runs`. The
   only real gap was **UC-04, deployed but never exercised** — zero rows because
   it had not run since deployment, not because anything was broken. Driven
   through its production webhook (execution `4973`, nothing pinned), it traced
   correctly, `parent_id` resolving to the audit row written moments earlier.
   All nine now have real trace rows.

   What replaced the phantom work is the check nothing had: `npm run
   verify-traces` (`scripts/verify-trace-nodes.mjs`) verifies the branch's
   WIRING and POSITION, which a body diff cannot see. Two failures it catches
   are silent in production. **Canvas position** — the first deployment placed
   these nodes below the graph and execution `4325` lost its trace because an
   error aborted the run before the queue drained (see the fan-out gotcha in
   §6). And **dead probe names** — the collector looks nodes up by name and
   treats unknown as "this graph doesn't make that call", so a typo is
   indistinguishable from an absence and that call is never traced, anywhere,
   forever, without erroring. The check lifts `TRACED_CALLS` out of the body
   fetched from n8n rather than restating it, because a local copy would share
   the typo and compare equal. Live: 9 checked · 0 defective · 0 unpublished ·
   0 dead probe names.

   The per-attempt data is discriminating in the way it was meant to be: UC-02's
   rows separate a `403 Forbidden, invalid role` on expense categories from a
   `404` on the expense itself **within one decision**, which is exactly the
   distinction `upstreamFailures` in `details` cannot make.

**Known broken — the honest-gaps list, re-audited item by item on 2026-08-20.**
Every item here is something the repository currently gets wrong, or cannot do,
and is recorded because omitting it would be the overstatement §1 says discounts
everything else. **The list was written on 2026-08-19 and every one of its
sixteen items has now been re-checked against the code, the database, the
Zendesk account or the deployment.** Six closed, four changed shape, six stand;
four new ones were found by the audit itself and are numbered 17–20. **Nothing
is deleted — a closed item is struck through and says when and how it closed**,
because a gaps list whose entries quietly vanish teaches its reader that the
list is decorative, and the sequence *found → written down → fixed* is the whole
argument for keeping one.

*Arithmetic and jurisdiction — the gates themselves.*

1–3. ~~`computeCumulativeDays()` clears a traveller it should refuse on an
   unreadable date; the same function double-counts overlapping stays; and the
   Schengen window is per-trip where art. 6(1) is per-day-of-stay.~~ **ALL THREE
   CLOSED by `73920c9`, which landed minutes after this list was written.** The
   calculator now answers `{days: null, status: "NOT_EVALUATED", problems: […]}`
   naming the offending row, and `classifyRisk()` turns that into `blocked` /
   `travel_history_unreadable` **before any window is chosen** — so the portal's
   intake guard becomes defence in depth rather than the only thing between a
   caller and a silent clearance, which matters because the n8n path and any
   direct API caller reached this arithmetic unguarded. Days are now a union
   rather than a sum, and `schengenPeakDays()` measures every day of the trip
   against its own trailing 180 days and reports the peak, the day it falls on
   and the window. **The first `C-` finding in the corpus to be acted on**, and
   acted on the way the corpus asks: its own reviewed unit of work, its own
   tests, D-07 quoted verbatim.
4. **CHANGED SHAPE, and the change is larger than a number.** The corpus now
   holds **34 findings — 30 contradictions and 4 confirmations** (counted
   2026-08-20: `grep -cE '^### (C|K)-' CONTRADICTIONS.md` → 34, headings `C-1`
   … `C-30`, `K-1` … `K-4`), not the 27+4 this line recorded. More importantly,
   **the claim "nothing under `src/` was changed on the strength of it" is no
   longer true, and its retirement was earned rather than slipped.** Three
   findings have now changed code, each in its own reviewed commit:
   **C-1** (`73920c9`, above); **C-18** — the Portuguese notice bracket split at
   23 months where art. 400.º(1) splits at *"até dois anos"* inclusive, so
   exactly 24 months' service was told it owed 60 days where the statute gives
   30, double, against the employee — corrected in `43ae3c7` and the boundary
   comment in `src/uc05/noticePeriodTable.js` names the finding and the date; and
   **C-14/C-20/C-28**, which is why the NL row added by the same commit is a flat
   **one month with a `month_end` anchor** and not the 1/2/3/4-month ladder at the
   top of art. 7:672 — that ladder is the *employer's* (lid 2), and C-20 records
   this table falling into the identical trap once already for Portugal. Separately
   and without touching a gate, the corpus is now **cited on the screens**:
   `src/uc04/decisionSources.js` references 24 findings by id, and
   `src/uc05/`, `src/uc07/`, `src/uc08/` reference their own. The remaining
   findings stay unactioned **by choice** — a residence-permit exclusion the
   regulation states and `DNV_COUNTRIES` implements as an undocumented blanket
   skip (C-2/C-15), six treaties with six different 183-day windows and none of
   them the code's (C-10), UN two-letter regime codes that are not ISO 3166-1,
   one of them the United Kingdom (C-25).
5. **STANDS, and is worse than this line said.** `src/shared/schemaValidator.js`
   is a **presence** validator: its own header says *"It does not check types,
   formats or bounds."* It reads `required`, and consults a field's `type` for
   exactly one purpose — deciding whether `null` counts as satisfying a required
   field (`dacf8f2`). It reads no **81 conditional `allOf` rules on the live USA
   `contract_details` form**, none of the **72 on Canada's**, no `minimum`
   (including 34 US per-state hourly floors), no `properties: {x: false}`
   prohibition. `src/uc06/policyEngine.js`'s `effectiveSchema()` *does* resolve
   `if`/`then`/`else`; five use cases reach for the shallow shared one.
   Deliberately not lifted: resolving a branch wrongly makes validation
   **stricter than Remote** and starts refusing valid payloads, which is a new
   failure rather than a fix.

*Hand-off — decisions that are correct, durable, audited, and reach nobody:*

6. **RE-MEASURED 2026-08-23 — and the number moved a long way.** Read live off
   `/queue` on the deployment, in a real browser (`d487b01`): **226 records
   read, 124 waiting, 31 with nowhere to be approved, 93 reachable, 0 unknown.**
   **Do not quote the old 54 / 39 / 36 reading** — it is from 2026-08-19, it is
   superseded, and "36 with nowhere to be approved" in particular has been read
   by three separate passes as if it were current.
   *How the block that used to be here was cleared, because it is the more
   transferable lesson:* this item said for four days that `npm run queue-ui`
   **cannot** be re-run from this container — `pg` opens a raw TCP connection
   and `db.<ref>.supabase.co:5432` answers `ENOTFOUND` through an HTTP CONNECT
   proxy. That was true **of that caller**, and it was never true of the
   question. `/queue` on the deployment answers the same question over HTTPS and
   needs only `PORTAL_ACCESS_KEY`, which `.env` does hold. A blocker that names
   one caller is not a blocker on the measurement — see the standing rule about
   naming the caller that failed *and* one alternative tried.
7. **TWO THIRDS CLOSED — and the closure did not fix the ticket that prompted
   it, which is the part worth keeping.** Both missing groups now exist, read
   live from `GET /api/v2/groups.json` on 2026-08-20: **`Local HR & Legal`
   `9990000000002`** and **`Mobility Specialists` `9990000000003`**, created by
   `scripts/setup-zendesk-groups.mjs` in `e4108d6`, and
   `src/shared/escalationGroupIds.js` now carries an id for **all nine** routing
   teams. **But ticket #51 is still sitting in the default `Support` group**,
   read live the same minute — creating a group fixes the *next* hand-off and
   nothing retro-assigns the ones raised while it was missing. **The third part
   is untouched:** `src/uc03/policyEngine.js` still tells the reader *"Global
   Mobility owns it"* in six places, and `src/uc03/workflow.js` once more, while
   the routing table sends the ticket to *Travel & Mobility Support* —
   `docs/ESCALATION-DESTINATIONS.md` argues that rewriting the prose to name the
   routed team would make the sentence contradict itself, so this is a
   recommendation with no obviously correct fix, not a typo.
8. **STANDS, and the real number is bigger than ten.** Read live 2026-08-20:
   **fifteen tickets carrying a `queue_*` or `escalation_*` tag are still in the
   default `Support` group** — #19, #21–#27, #29–#33, #38 and #51. Everything
   raised later landed correctly: #34 in *Mobility Legal (Tier-3)*, #39–#47 in
   *Finance Ops*, #48/#49/#50/#55 in *Travel & Mobility Support*, #53/#54 in
   *HR Ops*. So assignment works now and the backlog was never repaired. A
   backlog to re-assign, not a live bug — but it is fifteen, not ten.
9. **STANDS, re-verified.** `select action, count(*) from audit_log where action
   ilike '%ticket%'` returns exactly one row on 2026-08-20:
   **`portal_ticket_creation_failed`, count 1**. Record `293b0f4e`, a UC-02
   portal submission over the policy cap — correct, durable, audited, and
   Finance Ops has never heard of it. **There is still no retry**, and no action
   name anywhere in the trail suggests one was attempted.
10. **HALF CLOSED — and the half that closed is not the half these rows
    needed.** `c295ef1` built UC-03 the one signature it was missing:
    `signoffPolicy.js`, `submitTravelLetterSignoff()`,
    `POST /api/cases/:id/signoff|decline`, and `uc03:travel_support_specialist`
    in `USE_CASE_ROLES`. It is live — `/__cx/routes` reports
    `hasWriteRoutes: true` for `/uc03`, read 2026-08-20. It covers **one outcome
    only**, `human_review / formal_letter_requested`, and refuses the other four
    by name on purpose: an approve button on `route_to_uc04` would be a 🟢 router
    minting a 🟡 work authorization by click. **Every UC-03 row actually waiting
    in production is `route_to_uc04 / work_authorization_requested`** — now five
    of them (`48`, `49`, `50`, `55`, `9002`), read from `review_queue` joined to
    `cases` on 2026-08-20. Those need the continuation into UC-04, not a
    signature. And `documents` still holds **3 `travel_informational_response`
    rows and zero `travel_support_letter` rows**: nobody has yet got a letter out
    of this system, which is exactly the premise `cc551b4`'s letter-offer was
    built on, and it has not been exercised in production either.
11. **STANDS, and is now argued in the code rather than only in a doc.**
    `src/portal/ticketing.js` names UC-07 and UC-08 as deliberately absent from
    the ticketable set and says why: linking a ticket means writing an id back
    onto the record, and those stores have one write method and zero mutations,
    which *is* the 🔴 guarantee. Correct at the store layer, still wrong at the
    hand-off layer — the dossier is compiled, audited, and the named specialist
    is never told. "Where is this approved?" is *nowhere, and correctly
    nowhere*; "where does the specialist **read** it?" is still *they have to
    know to look*.
12. **STANDS, narrower than written.** `9001` and `9002` survive as
    `cases.external_ref` (both UC-03). `2004` and `2007` appear in none of
    `cases`, `uc02_expenses`, `uc04_authorizations`, `uc05_resignations` or
    `uc06_amendments` — queried 2026-08-20. Anything that treats a numeric
    reference as a Zendesk link still sends a specialist to a 404.

*Deployment — where the repo and the running system disagree:*

13. ~~UC-03's and UC-08's n8n graphs run the old bodies, and the routing table on
    all nine is the pre-split one.~~ **CLOSED per `e4108d6`, which ran
    `scripts/deploy-routing-nodes.mjs` and reports `verify-deployed: 39 nodes,
    0 drifted` — and re-confirmed live by the session owner on 2026-08-20.**
    ~~**[UNKNOWN] from this container**~~ — **STALE AS OF 2026-08-27: the n8n
    API answers this container with `200`.** All nine graphs were read back
    node by node from `GET /api/v1/workflows/{id}` this session. The `403` this
    line recorded was a key that has since been replaced, not a standing
    property of the container. The distinction it was written to preserve still
    holds and is the transferable part: a `403` that reads like a permissions
    problem and a `403` from a proxy allowlist look identical in a log line and
    are different failures — a proxy denial never prints
    `HTTP/1.1 200 Connection Established`, and an allowed host does even when
    the API then answers 403.
14. ~~Every approve on the public deployment refuses
    (`approver_entitlement_not_configured`) until `APPROVER_ROLES` is set
    there.~~ **CLOSED. Verified live 2026-08-20** at
    `GET https://remote-cx-apis.vercel.app/__cx/health`:
    `approverEntitlementEnforced: true`, **`approverEntitlementSource:
    "APPROVER_ROLES"`**, and `writes: "WORKING — approve/deny will be accepted
    (subject to each use case's own policy gates)."` The gate is now both built
    **and** provisioned, which were always two claims.
15. **NARROWED 2026-08-27 — the chain SHAPE is now proven, on UC-09 rather
    than on UC-01.** Ticket **135** → trigger → authenticated webhook →
    execution `9279` (`pinData: {}`, 14/14 nodes `success`) → real `audit_log`
    row `f3f5e07b-…` → real Zendesk write. So *ticket → trigger → webhook → n8n
    → audit row* demonstrably works on this account today, which is the general
    doubt this item carried. **What is still specifically UNKNOWN is UC-01's
    OWN chain since the Sandbox reseed**: its webhook invocation log shows
    deliveries succeeding as recently as `2026-08-25T03:19:07Z`, but no run in
    that window was opened node-by-node, so the n8n-written `audit_log` row for
    UC-01 remains unverified. One real `uc01_test` ticket closes it; nothing in
    this session did that.
    `docs/LIVE-PATH-STATUS.md` §2 marks exactly which three links those are, and
    nothing in this session could close them for the reason in item 13.

*Housekeeping:*

16. **RE-MEASURED, and it did not fire this time — which is itself the finding.**
    `npm test` on 2026-08-20 (tree at `cc551b4` **plus** uncommitted in-flight
    work from concurrent agents): **3,069 tests, 3,068 pass, 0 fail, 1 skipped,
    16.4s.** Zero `EADDRINUSE`. The hazard is unchanged — a long-running dev
    server holding a port out of `TEST_BAND` fails a test with `EADDRINUSE`,
    which reads as a logic failure and is not one — but **the ~15 failures
    several agents reported through 2026-08-20 were this, not defects.** A
    reported failure count with no `failureType` attached is indistinguishable
    from a regression; read the `failureType` before quoting a number.

*Found by this audit, 2026-08-20:*

17. **Two pgvector tables have held zero rows since the day they were
    provisioned.** `uc07_mobility_citation_vectors` and
    `uc08_treaty_citation_vectors` are both `count(*) = 0`, queried live against
    project `your-project-ref` on 2026-08-20. So UC-07's and UC-08's
    "embedding-similarity retrieval" runs **permanently on its keyword leg** —
    which is what `docs/RETRIEVAL.md` (`2aef4da`) establishes and argues about.
    Every row in this file, `README.md` and `docs/BUILD-LOG.md` describing that
    retrieval as embedding similarity is **true of the code and false of the
    running system**, which is the same built-vs-deployed gap as item 13 wearing
    different clothes. `npm run seed-vectors` exists; `docs/RETRIEVAL.md`
    recommends **not** running it and argues the case from a measured corpus
    size of 106 passages. **DECIDED 2026-08-21 (UC-08's pass): do not seed** —
    `npm run seed-vectors` must not be run, and the remedy is a country-filtered
    **lexical** index over the 106 real statutory passages, as one decision
    across UC-07 and UC-08 (`T-26`/`T-27`; `E15` in
    `qa/HUMAN-DECISIONS-REQUIRED.md` is now fully answered). **The item stays
    open**, because the status rows in this file, `README.md` and
    `docs/BUILD-LOG.md` still describe the retrieval as embedding similarity, and
    a decision is not a correction. What makes it urgent is not the overclaim but
    the *output*: the keyword leg can hand a specialist *"OECD Model Article 4 —
    Resident (tie-breaker rules)"* on a DE/ES question — the template the
    governing convention was drafted from, offered where the convention
    belongs.
18. **`src/remoteui/` stands in for an API that now exists.**
    `docs/INTAKE-RESEARCH.md` §5.1 records `POST /v1/contract-amendments` and the
    `contract_amendment.submitted` / `.review_started` / `.done` / `.canceled` /
    `.deleted` webhooks as live on `developer.remote.com`, verified 2026-08-20 —
    along with `travel_letter.requested` and, sharper still,
    `ContractAmendment.zendesk_ticket_url`, which is `00-FOUNDATION.md` §2's
    two-door model confirmed from Remote's side of the wire. **Issue #17 — "no
    amendment-request event API exists" — is stale**, and it is the stated reason
    the stand-in was built. Every sentence in this file, `UC-06.md` §15 and
    `src/remoteui/`'s own header resting on it is now wrong. The stand-in is not
    wasted (it demonstrates the flow from its true starting point and needs no
    Remote credentials), but it should be described as a demo surface, not as a
    workaround for an absence.
19. **Five of UC-04's seven gate inputs have no source in any Remote object**
    (`docs/INTAKE-RESEARCH.md` §6.4): nationality, visa type, job duties, prior
    travel, home country. A gate whose input has no source can only ever
    escalate, and this repository has already paid for that exact shape twice
    (UC-03's alpha-3 comparison, UC-03's unnameable sanctions codes). Not a
    defect today — the portal and the free-text intake both supply these — but it
    is the reason a *webhook-driven* UC-04 could not work as specified, and it
    should be settled before anyone builds one.
21. ~~**`ZENDESK_EMPLOYMENT_ID_FIELD_ID` is WRONG on the Vercel deployment, and
    every portal-raised ticket loses its employment id because of it.**~~
    **CLOSED 2026-08-29 — the variable is now SET on the project.** Struck
    rather than deleted, per this list's own rule. Verified against the
    deployment: `GET https://remote-cx-apis.vercel.app/__cx/health` reports
    `portal.employmentIdField: {configured: true, id: "9990000000001"}` — the
    id this entry named as correct, and the one that really exists on the
    `your-subdomain` account. **One caveat the endpoint states itself and this
    closure repeats rather than smooths over:** `configured: true` proves the
    variable is set and carries the expected id; it does not prove a
    portal-raised ticket comes back with the field populated, because Zendesk
    discards an unknown field id silently and returns 200 either way. The
    original entry's own verification instruction therefore still stands —
    **raise one portal request and read the field back** — and nothing in this
    session did that. The reasoning below is kept in full because the failure
    mode (silent in every layer) is the transferable part. Found
    2026-08-27 by raising one real UC-05 request against
    `https://remote-cx-apis.vercel.app/portal` and reading the ticket back:
    ticket 143 came back correctly tagged (`portal_request`, `queue_hr_ops`,
    `uc05`, `uc05_hr_ops_signoff`) and correctly grouped, with field
    **`9990000000001` present but NULL**. **CAUSE CONFIRMED by the project
    owner reading the Vercel settings the same day: the variable is NOT SET AT
    ALL.** The probe alone could not have told us that — an unset var makes
    `custom_fields` `undefined`, a wrong id makes Zendesk discard it, and
    either way the field reads NULL on the ticket because it is an
    account-level field present on every ticket. (This entry twice named a
    cause it had not observed before the settings page settled it; the fix was
    the same throughout, but a register must not carry an unobserved cause.)
    The eight variables that ARE set date from 2026-08-18, when the deployment
    was first configured — this one was simply never added.
    **Silent in every layer**: Zendesk discards an unknown field id without
    erroring, the create returns 200, and `#healDroppedCustomFields`'s
    follow-up PUT writes to the same dead id and changes nothing — it does not
    even leave an audit event.

    **Why this is more than cosmetic.** All nine UC intake triggers condition on
    `custom_fields_9990000000001 present`, so **a portal-raised ticket can never
    drive an n8n workflow**, and the specialist who opens it cannot see which
    employment it concerns. It is the same class as items 7–8: the hand-off
    exists, is tagged, is grouped, and is missing the one field that makes it
    actionable.

    ~~**Fix is a project setting, not code**: set
    `ZENDESK_EMPLOYMENT_ID_FIELD_ID=9990000000001` on the Vercel project and
    redeploy. Not doable from this container — no `VERCEL_TOKEN`, no CLI.~~
    **Applied.** The verification instruction it ends on is NOT struck, because
    it is the half that has not been done: verify by raising one portal request
    and reading the field back, NOT by reading the env var or the health block
    — the whole failure mode is that writing it looks successful.

22. **The DEPLOYED classifier runs a different model from the one this
    repository documents, evaluates and prices — found 2026-08-29.** The live
    `/__cx/health` reports `"model": "gpt-5-nano"` (`OPENAI_MODEL` is set on the
    Vercel project); `src/shared/config.js` and `.env.example` both default to
    `gpt-4o-mini`. Three consequences, each verified rather than inferred:
    - **The two execution paths run different models, and no test can see it.**
      Four n8n Code nodes hard-code `model: 'gpt-4o-mini'` in the request body
      they build — read back off the LIVE graphs, not the repo copies:
      UC-01 `Normalize Ticket`, UC-02 `Prepare Classification Prompt`, UC-03
      `Normalize Inquiry`, UC-08 `Normalize Inquiry`. (The other five graphs
      make no OpenAI call. `Collect Trace Steps` on all nine mentions
      `gpt-4o-mini-2024-07-18` only in a comment; it reads the model off the
      response, correctly.) The parity tests compare DECISIONS, so a model
      divergence is exactly the class of difference they are blind to — the
      same shape as the `verify-deployed` lesson: the check that would catch it
      has to read the deployed thing, and there is no check on this at all.
    - **The frozen 48-case classifier suite has never been run on the deployed
      model.** `evals/` inherits `config.openai.model`, and no report in
      `evals/uc01/reports/` records which model produced it. The runner now
      records `requestedModel`/`modelSource` and takes `EVAL_OPENAI_MODEL`
      (`evals/README.md`); actually re-running it costs money and was not done.
    - **Every production run is unpriced.** `gpt-5-nano` has no rate in
      `LLM_PRICING_USD_PER_MILLION_TOKENS`, and until 2026-08-29 that made
      `computeMetrics()` **throw** — so the metrics report did not degrade, it
      died. It now reports an `unpriced` verdict naming the model, with the
      dollar total declared a floor; no rate was invented, because money is
      never fabricated (§3's ladder). `docs/METRICS.md` has the detail.
    **What is NOT fixed:** nothing was changed under `workflows/` or on the live
    graphs (owned elsewhere), so the divergence itself stands; and
    `src/metrics/dashboard.js` still renders the dollar figure without the new
    verdict, so the screen shows `$0.0000` on production data where the report
    says `unpriced`.

20. **Two documents in `docs/` both number their findings `C-N`, and code cites
    both.** `docs/knowledge/layer-1-statutory/CONTRADICTIONS.md` runs `C-1`…`C-30`
    (statute vs. code); `docs/CORRECTIONS-LOG.md` runs its own `C-1`…`C-31`
    (user-reported corrections). `src/uc05/decisionSources.js` cites `C-18`
    meaning the first; `src/shared/decisionFacts.js` cites `C-31` meaning the
    second. A reader following a citation can land in the wrong register and
    read a confident, specific, entirely unrelated finding. Cheap to fix by
    prefixing one register; not fixed here because renaming a citation scheme
    touches files this pass does not own.

**Newly required, and cheap — finish proving exactly-once** (§4's idempotency
row, `docs/BUILD-LOG.md` §3.24). The claim node is deployed on all nine graphs
and proven end to end on UC-07 only. Three follow-ups, in order:
1. Once the UC-04/UC-05 `Fetch Employment (Remote)` host fix lands
   (`your-sandbox-standin.vercel.app` → `gateway.remote-sandbox.com`, being
   done separately), re-drive each of those two twice under one external ref
   and confirm exactly one `workflow_claims` row and one downstream record —
   until then their claim nodes stay documented as **deployed, not proven**.
2. Do the same double-drive for UC-02, 03, 06, 08, 09, which have a real claim
   row each but no verified downstream rows from that pass.
3. ~~Confirm UC-01's own claim node is actually the active version.~~ **Done
   2026-08-17** — `activeVersionId === versionId` on `WORKFLOW_UC01_ID`, claim
   node present and correctly wired. It had been drafted via the MCP (which
   does not publish, unlike the REST `PUT` used for the other eight, §6), so
   this was worth checking rather than assuming.

**Newly required (user-mandated 2026-08-18) — the Execution & Audit Trail
viewer.** Every decision is already recorded (`audit_log` per decision on both
execution paths, `audit_trace` per LLM/API attempt, `ops_alerts` per failed n8n
run, `workflow_claims` as the exactly-once ledger) but nothing lets a human
WATCH executions or audit a bug without raw SQL. Requirement: a separate
read-only UI — live feed over `audit_log`, drill-down decision → trace
attempts, and a bug-audit view keyed by externalRef (claims + decisions +
nearby alerts). Being built as `src/auditview/` + `npm run audit-ui` + `/audit`
on the Vercel function, gated by the same `PORTAL_ACCESS_KEY`; requirement
recorded in `docs/PRODUCTION-READINESS-PLAN.md` §3 and `docs/E2E-TEST-PLAN.md`
Phase 6. Read-only in the UC-08 structural sense: no POST route exists.

**Newly required (2026-08-21) — the requirements register in `qa/`, and the
first build queue.** A body of work this file has never mentioned: nine canonical
acceptance contracts (`qa/contracts/UC-0N-acceptance.md`), an **82-finding**
spec-drift register (`qa/SPEC-DRIFT-INDEX.md`), and `qa/HUMAN-DECISIONS-REQUIRED.md`
for the subset that is a product call rather than a mechanical fix. Written up in
`docs/BUILD-LOG.md` §3.81. **Nothing in `src/`, `test/` or `workflows/` was
changed to produce any of it.**

**The nine use-case decision passes and the 2026-08-21 backlog session moved to
`docs/history/DECISION-PASSES.md`** on 2026-08-23, unchanged and still cited by
number. They are a record of work already dispositioned rather than a list of
next steps, and this section is where an agent looks for what to do next. The
rules they produced are stated in §3 and in each acceptance contract, not only
there.

### Stage 4 — package and submit (next, after Stage 3.5)
- **Demo video script — DONE** (`docs/DEMO-SCRIPT.md`, shot-by-shot, 3–5
  minutes): `npm run livedemo` → real Zendesk ticket → real n8n execution →
  decision → letter → Zendesk resolved → real audit row → metrics dashboard
  updating. The sidebar beat: show an approve landing in `audit_log` and the
  accept rate moving, then try to approve an escalation and get refused on
  camera. `npm run review-api` seeds all four states with no credentials
  needed for that part of the recording. **The script itself is the plan, not
  the deliverable — actually filming it is the remaining work.**
- **Case-study page — DONE** (`docs/case-study.html`, self-contained,
  intended to be sent as a single link). **Not yet published or sent** —
  it currently exists only as a file in the repo; making it reachable (or
  attaching it directly) and actually sending the link is the remaining step.
- Final `BUILD-LOG.md` pass so every status line is true on the day it ships —
  including the two documentation gaps flagged at the end of §5 above
  (the duplicate `§3.16`/`§3.17` numbering, and issues #25/#26/#28/#33 having
  no §3.x write-up).
- **Submit.**

### Stage 5+ — after submitting (the repo keeps improving in the pipeline)
- **UC-06 Contract Amendment / Payroll Cutoff (🟡) — core logic + API +
  real Supabase persistence + ZAF panel + n8n workflow + **Remote-native
  entry-point stand-in** DONE**
  (`src/uc06/`, `npm run uc06-api`, `WORKFLOW_UC06_ID`, built across the
  session my PC was unreachable for live n8n verification and the
  "go deeper on 06/08" session that followed it — see §5; the stand-in is
  `src/remoteui/`, `npm run remoteui`, issue #30 — see §5). Chosen over
  UC-05: the densest EOR-real logic in the set — money ×100, dynamic
  per-country schema before write, a hard deterministic cutoff-lock time
  gate, and dual control. The ZAF sidebar now drives two named approval
  roles, not one; the n8n workflow is built, credentialed, dry-run verified,
  and parity-tested — **ACTIVE as of 2026-08-10** (explicit user go-ahead,
  see §5). Remaining: real (unpinned) execution verification, the Slack
  urgent-cutoff alert, and a real production trigger — the stand-in
  demonstrates the flow from its true starting point, but a Remote
  amendment-request event/webhook API still doesn't exist (issue #17).
  See `docs/use-cases/UC-06.md` §15 for the full status
  table.
- **UC-08 Cross-Border Tax (🔴) — core logic + real dossier persistence +
  read-only API + ZAF panel + n8n workflow + embedding-similarity treaty
  retriever DONE** (`src/uc08/`,
  `npm run uc08-api`, `WORKFLOW_UC08_ID` — see §5). Chosen over UC-07: needs
  no write path, so it is cheap, and its headline artifact is a test
  asserting **no execution path is reachable**, proved both structurally and
  behaviorally — now true of its store (one write method, zero mutation
  methods), its API (no POST route exists at all), AND its n8n graph (no
  Switch/IF node anywhere) too, not just its workflow function. Deterministic
  presence-day calculator + mandatory disclaimer + dossier; treaty retrieval
  is embedding-similarity over the curated corpus's vectors in pgvector
  (issue #29), keyword fallback when unconfigured.
  n8n workflow built, credentialed, dry-run verified, parity-tested —
  **ACTIVE as of 2026-08-10** (explicit user go-ahead, see §5). Remaining:
  real (unpinned) execution verification, provisioning the retriever's
  pgvector table + embedding client (human steps), real Remote reads for
  presence periods. See `docs/use-cases/UC-08.md` §15 for the full status
  table.

**All "3 deep use cases" (§1) now have core logic, persistence, a ZAF
panel, AND an n8n workflow built** — UC-01 fully live, UC-06 and UC-08
real-Supabase-backed with tested core logic, a working browser UI, and a
credentialed, dry-run-verified n8n graph awaiting explicit activation.
What's left for 06/08 is going live (a deliberate human decision, not a
coding task) and, for 06, the Slack alert — not foundational logic, the
sidebar, or n8n itself, which are all done — worth remembering before
starting a 4th use case from scratch.
- Then remaining UCs in tier order (02, 03 → 04, 05 → 07, 09), plus the
  `BUILD-LOG.md` §5 roadmap: retry/backoff on the Remote/Zendesk REST clients
  (the three named LLM call sites already got this, issue #32 closing #19 —
  the REST clients are the part still open), PDF rendering, the §12.7
  over-scope disclosure fix, metrics baseline + cost model.

---

## 7b. Standing authorisation for live n8n deployments (2026-08-18)

**The user has given standing permission to deploy and publish changes to the
live n8n workflows without asking each time.** This supersedes the
"explicit go-ahead every time" rule referred to throughout §5 and §7 above.
Those earlier notes are kept because they record why the rule existed, not
because it still binds.

The scope is deliberate and limited: **deploying a change that is already
tested, and driving a production webhook to prove it landed.** It is not
permission to skip the proof. Everything §6 says about n8n still applies and
is what makes the permission safe rather than reckless:

- `PUT /api/v1/workflows/{id}` publishes in place; the MCP `update_workflow`
  writes only a draft. **`activeVersionId === versionId` is the only thing
  that answers "is this live?"**
- A pinned node reports success having done nothing. **Check the destination
  table, never the run status.**
- Read the deployed body back and diff it byte-for-byte before trusting a
  success flag.
- Prove the change with a real, unpinned execution and real row counts, in
  both directions — the positive case as well as the refusal.

Still requires asking: deleting or disabling a workflow, changing credentials,
anything that touches real customer data, and anything outward-facing that is
not a deploy (posting publicly, sending mail, opening a PR).

---

## 8. Manual actions only the human can do

Corrected this session: several items this list used to carry (selecting n8n
node credentials, creating an audit-write path, activating the workflow) turned
out to be doable via the n8n/Supabase MCP tools available in a session like
this one — they're done now, see §5. What's left genuinely needs the human:

1. **Re-run `scripts/fix-zendesk-trigger-condition.mjs` and submit one real
   ticket** — needs the real `ZENDESK_OAUTH_CLIENT_ID/SECRET` that only exist
   in my local `.env`. This session cannot do it. See Stage 3.5 above.
2. ~~**Install the ZAF app**~~ **DONE — the app is installed and enabled.**
   Verified live 2026-08-18 against `GET /api/v2/apps/installations.json`:
   **"Remote CX Review v1.01", app id `9990001`, `enabled: true`** (an earlier
   `9990002` "Remote CX Review" is installed but disabled — the superseded
   upload). This item sat here as outstanding long after it had been done,
   and a session read it and asserted to my face that the app was not
   installed. **Verify an install claim against the account, not against this
   list.** For local iteration without re-uploading: `zcli apps:server zaf-app`
   + `?zcli_apps=true` on a ticket URL, against `npm run review-api`.

   ~~**Still open, and a different thing entirely:** the portal creates no
   Zendesk ticket…~~ **HALF STALE as of 2026-08-19 — the join was built.**
   `src/portal/ticketing.js` decides which decisions qualify,
   `raiseTicketIfNeeded()` raises the ticket **after** the gates and after the
   record is durable, `store.linkTicket()` repoints the record's `external_ref`
   at the ticket id, and `recordTicketRelink()` audits the substitution so the
   reference the requester was shown still resolves. Observed live on the
   portal: a UC-04 submission returns `ticketId 2000`, `ticketCreated true`,
   tagged `portal_request, uc04, uc04_specialist_approval,
   queue_mobility_specialists`.

   **What survives is narrower, and worse in one place than the old note said.**
   Read `docs/APPROVAL-ROUTING.md` §2 and `docs/APPROVAL-QUEUE.md` §0 rather
   than re-deriving it — the second corrects the first. In short:
   - The **portal→sidebar join needs a shared durable store**. On a laptop the
     portal owns its own seven stores and each `ucNN-api` seeds a different one,
     so a correct, ticketed, audited decision reads `{"found": false}` in the
     sidebar. **On the deployment this does not exist** — one function, one
     pool — where the same lookup answers `401 signed_identity_required`, which
     is the route existing and refusing. It is a local-development caveat, not a
     production dead end, and `docs/APPROVAL-QUEUE.md` §0 says so explicitly
     against `APPROVAL-ROUTING.md`'s four ⚠️ rows.
   - **Tagging works and assignment does not.** Every hand-off carries the right
     `queue_*` tag; the group it names does not exist for UC-04, and ten older
     escalations were raised before assignment worked at all. §7's honest-gaps
     list, items 7–8.
   - **UC-03 has no approval route to join to**, and **UC-07/UC-08 raise no
     ticket by design** and therefore reach nobody's queue. §7 items 10–11.
3. **Add more known Sandbox employees to `src/livedemo/employees.js`** if the
   demo should show more than one — needs logging into the Sandbox dashboard
   to copy each one's real UUID (not the short display code) and email.

The one remaining *code* task that blocks a public deployment — verifying a
ZAF-signed identity JWT instead of trusting the `X-ZAF-Approver` header — is
not on this list, because it is buildable from a coding session. It is tracked
in `docs/BUILD-LOG.md` §5 item 11.

---

## 9. Conventions

- **Plain JavaScript (Node 20+, ESM) with JSDoc types.** No TypeScript, no build
  step — the repo must clone and run in one command.
- Flat `src/` layout, not a `packages/` monorepo. One foundation component = one
  file.
- Pure logic separated from I/O so it is testable without infrastructure —
  `policyEngine.js` and `src/metrics/compute.js` are the pattern to copy.
- Optional integrations degrade to safe defaults when unconfigured, rather than
  failing. Background writes swallow errors; **reads that feed a dashboard
  throw**, because a wrong number gets acted on while a missing one gets
  investigated.
- Every write path: schema-validated, money-scaled, idempotent, audit-logged.
- Explain non-obvious logic in comments, and record *why* in `BUILD-LOG.md` §4.
  The author is building his first production system and must be able to
  understand and defend every part of it.
- Charts and dashboards: load the `dataviz` skill first and **run the palette
  validator** — do not eyeball colour accessibility.

## Definition of done (per use case)

Working n8n workflow · validated writes · correct HITL/escalation for the tier ·
inspectable audit log · passing end-to-end test · accurate `UC-0X.md` ·
reproducible demo · defined and *measured* success metrics.
