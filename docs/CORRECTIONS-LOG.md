# Corrections log

Every time the project owner corrected the AI assistant, what the mistake
actually was, and what changed as a result.

**On completeness.** This is reconstructed from durable records — `CLAUDE.md`
§5, `docs/BUILD-LOG.md`, git history, and the current session's transcript.
Conversation memory does not survive `/compact` or a session reset, so
corrections that left no trace in a file or a commit are not recoverable. This
is therefore **"every correction that left a trace,"** not a provably exhaustive
list. Where a correction is inferred from a commit message rather than recorded
verbatim, it says so.

**Why keep it.** The failure modes repeat. Five of the entries below are the
same underlying mistake — *claiming something works because a process reported
success, rather than because the destination was checked* — and it recurred
across sessions until it was written down as a rule. A list like this is worth
more than the individual fixes, because it is the only artifact that shows the
*pattern*.

---

## The recurring pattern

| # | Pattern | Entries |
|---|---|---|
| **P1** | **Trusting a success signal instead of checking the destination** | C-03, C-06, C-08, C-11, C-18 |
| **P2** | **Documenting an intention as an accomplishment** | C-02, C-06, C-09 |
| **P3** | **Building something the owner did not ask for, or in the wrong shape** | C-01, C-04, C-05, C-13 |
| **P4** | **Asserting a fact about an external system without checking it** | C-07, C-10 |
| **P5** | **Treating a difference as the cause before confirming it is load-bearing** | C-15 |
| **P6** | **A safety property concealing a defect — a negative test cannot detect a path that can never succeed** | C-16, C-17, C-18 |
| **P7** | **Said less than it knew — the system held a specific fact and reported a weaker one that was still TRUE** | C-19, C-22, C-27, C-28 |
| **P8** | **A capability fully built and reachable by nobody** | C-29, C-30 |
| **P9** | **Said MORE than it did — the customer-facing string asserted an action the system never took, while the true account sat in a code comment** | C-31 |

**P9 is P7 rotated 180°, and it is the more dangerous half.** P7's sentences are
all *true* and merely incomplete, so the reader is under-informed. A P9 sentence
is **false**, so the reader is misdirected — sent to look at a queue that will
always be empty, and left to conclude the system is broken when it is working
exactly as designed. It is invisible to tests for a reason worth stating: the
decision, the audit row, the flags and the recorded reason were all correct, and
the only wrong thing in the system was a string of English prose. No assertion
about behaviour can catch that. The one structural tell is the one C-31 has —
**a code comment and a customer-facing string describing the same branch in
contradictory terms**, with the accurate one facing inward.

**P7 and P8 were added on 2026-08-19**, the first day the system was used as a
product rather than read as a repository, and they are the two patterns no test
can catch. **P7 is the more dangerous.** Every sentence it describes is *true* —
"decided by gate 15", "above the policy cap", "your request could not be listed"
— so every assertion about the output passes while the reader is left to go and
find the four numbers the decision was already made from. **P8 is the cheapest to
fix and the easiest to repeat**: `notListed` and `lookupRef()` were both complete,
correct, tested, and rendered by nothing. Neither pattern is visible from inside
the code; both were found by a person using the thing and asking *"…and then
what?"*

**P5 and P6 were added on 2026-08-17**, because that session produced three
defects none of the first four patterns describe. P5 is a diagnostic error: two
things differ, one fails, and the difference gets blamed without anyone checking
that it is load-bearing. P6 is subtler and is the more valuable of the two —
this system is built to fail closed, and a component that *structurally cannot
succeed* fails closed too. Its output is indistinguishable from correct
caution. Every fail-closed assertion in the suite passed while UC-03 could not
have resolved a single real request.

---

## The corrections

### C-01 · "A human tagging a ticket by hand is not a demo of automation"

**When:** the `src/livedemo/` session.
**Source:** `CLAUDE.md` §5 — "prompted by a correct observation that…"

The demo at that point required a person to create a Zendesk ticket and apply
the right tag, then showed the automation processing it. The owner pointed out
this demonstrated nothing: the entire premise of 🟢-tier automation is that a
*client's own request* is handled with zero human intervention. A human doing
the setup step by hand is the thing being automated away.

**What changed:** built `src/livedemo/` — a client-facing page where someone
picks a real Sandbox employee and submits a request, which creates a genuine
Zendesk ticket tagged the way the live trigger expects, then polls that same
real ticket to show what the live workflow did to it.

**The lesson:** a demo must start where the customer starts. If the first step
is something an operator does, the demo is of the operator.

---

### C-02 · "Execution 10 ran through to audit" — it did not

**When:** discovered during a UC-01 end-to-end verification pass.
**Source:** `CLAUDE.md` §5; the claim survived in the docs for two sessions.

The build log claimed an n8n execution had run "through to audit." It had not:
that execution's `Append Audit Log` node was **pinned**, returning
`{ success: true }` from pin data without touching Supabase. `audit_log` held
zero rows written by n8n. The whole execution reported green having written
nothing.

**What changed:** the claim was corrected in place; the gotcha was written into
`CLAUDE.md` §6 as a standing rule — *a green n8n execution is not evidence that
an integration works; check the destination.* `mcp__n8n__test_workflow` pins
every credentialed node, so only `execute_workflow` exercises a real service.

**The lesson (P1, first occurrence):** the status of a process is not evidence
about the state of the world.

---

### C-03 · The audit-ordering bug hiding behind the same green status

**When:** same verification pass as C-02.

Underneath C-02 was a real defect: `Append Audit Log` sat *downstream* of all
four Zendesk nodes. So a Zendesk failure erased the audit row for a decision
that had genuinely been made, and `auto_resolve` replied to and solved a real
ticket *before* anything was durably recorded. One execution was exactly that —
an `escalate` lost to a 404.

**What changed:** the audit node moved ahead of the routing switch, matching
`src/uc01/workflow.js`'s existing STEP 7 / STEP 8 order, plus a
`Carry Context Forward` node because the Supabase node returns its own insert
response.

**The lesson:** the Node implementation had the right order, with a comment
explaining why. The n8n port silently did not. Porting logic to a second runtime
loses the reasoning unless the reasoning is tested, not just commented.

---

### C-04 · The stack-mismatch request

**When:** mid-project.
**Source:** `CLAUDE.md` §5.

A request arrived to rewrite `CLAUDE.md` around a Python / FastAPI / Pydantic v2
/ Bedrock stack with a four-phase RAG and multi-agent roadmap. None of it
matched the repository — which is plain Node ESM, OpenAI only, built on the
UC-01…09 risk-tier architecture.

**What changed:** the mismatch was raised rather than acted on. The owner did not
select either option and moved on; it was recorded as **withdrawn, not an open
decision**, and no code or docs changed.

**The lesson:** this one is a correction in the other direction — the right
response to an instruction that contradicts the codebase is to surface the
contradiction before spending a session on it. Recording it as withdrawn (rather
than leaving it ambiguous) is what stopped a later session from "finishing" it.

---

### C-05 · Scope reversal: build all nine, not three

**When:** the six-use-case build session.
**Source:** `CLAUDE.md` §5 — quoted verbatim.

> "I want everything built from beginning to end, so that we can begin to test
> everything out now."

This explicitly reversed a scope decision the project had been treating as
settled and not to be re-litigated: three use cases built deep, nine specified.

**What changed:** UC-02, 03, 04, 05, 07 and 09 went from spec-only to core logic
plus a runnable HTTP API in one pass, via six parallel worktrees, each
hand-reviewed and merged one at a time. Test count went 273 → 512.

**The lesson:** a scope decision recorded as "not to be re-litigated" binds the
assistant, not the owner. When the owner reverses it, the reversal is the new
instruction — and the *reasoning* for the old decision should be preserved
rather than deleted, because it explains why the work was sequenced as it was.

---

### C-06 · Four "hermetic" test suites that were quietly calling OpenAI

**When:** issues #32 and #27, same session.
**Source:** `CLAUDE.md` §5 and §6.

This devcontainer's `.env` carries a genuine but unreachable `OPENAI_API_KEY`.
Any test that did not explicitly inject a fake `classify` / `draftSummary` /
`draftNarrative` / `judge` was therefore making a real, slow, failing network
call. One test went from ~1ms to 11.4 seconds; the suite from ~2s to ~26s. The
suite was still described as hermetic.

It then happened **again** in the same session, one call site later, and a third
time when UC-09's workflow called `judge()` unconditionally with no fake in any
test.

**What changed:** an injectable seam at every LLM call site, from day one rather
than added after a slow test surfaces the gap. And a durable heuristic: *a fast
full-suite baseline is itself a hermeticity check* — a sudden jump in
`npm test`'s duration after a merge is worth investigating before trusting an
"all passing, hermetic" claim.

**The lesson (P1 again):** "all tests pass" was true. "The tests are hermetic"
was false. Both were being reported as one claim.

---

### C-07 · The Zendesk OAuth scope diagnosis was wrong

**When:** 2026-08-15.
**Source:** `CLAUDE.md` "Live resources" — *"that was wrong; the field exists in
the current UI."*

An earlier note asserted that the Zendesk Admin Center OAuth client form has no
scope picker, and that `POST /api/v2/oauth/clients.json` was therefore the only
way to set allowed scopes. This was stated as fact and was incorrect.

**What changed:** the owner found the field, populated it with `read` and
`write`, and `client_credentials` immediately worked. The note was corrected
against Zendesk's own published reference, which also explained both observed
symptoms precisely (a scope outside the allowed list returns `invalid_scope` and
creates no token; an unrecognised scope string *does* create a token that then
403s on every call).

**The lesson (P4):** an assertion about a third-party product's UI is checkable.
Guessing produced hours of work on the wrong path, and a confidently-worded note
that misled the next session.

---

### C-08 · Bisecting trigger conditions against a dead webhook

**When:** 2026-08-15.

A Zendesk trigger was not firing. Three clean negative results "proved" the
custom-field condition was the culprit. All three were actually a
circuit-broken webhook — a webhook that fails once stays dead, and correcting
its endpoint does not revive it.

**What changed:** the rule *confirm delivery works before attributing a
non-firing trigger to its conditions*, and the discovery that recreating the
record fixes it instantly where editing never does.

**The lesson (P1):** a negative result is only evidence if the rest of the path
is known good. Three consistent negatives from a broken harness look exactly
like a finding.

---

### C-09 · The `publicReply` node that delivered escaped HTML to a customer

**When:** 2026-08-15.

The n8n Zendesk node's `publicReply` field is plain text and silently escapes
HTML. A customer received the verification letter as literal
`&lt;!doctype html&gt;…` source. The run was fully "successful" and nothing in
n8n's status showed a problem.

**What changed:** switched that node to `jsonParameters` carrying
`comment.html_body`, and the rule: *check the rendered comment on the ticket,
not the node's success flag.*

**The lesson (P1, P2):** the most expensive failures in this project have all
been ones where every indicator was green.

---

### C-10 · "Remote's MCP is read-only" — it is not

**When:** commit `c1f4208`.

`00-FOUNDATION.md` asserted that Remote's MCP server is read-only, and used that
as the reason for choosing REST as the integration backbone.

**What changed:** the claim was corrected — the MCP exposes writes too. The
*conclusion* (REST for the backbone) survived, but the defensible reason is the
**auth model**: MCP authenticates as a user via interactive OAuth2 PKCE and acts
on that user's behalf, which is the wrong shape for an unattended service that
must retry idempotently and attribute actions to a system actor.

**The lesson (P4):** a right conclusion resting on a wrong premise is still a
finding waiting to happen. The corrected reasoning is genuinely stronger than
the original.

---

### C-11 · "Are we production ready?" — the question that exposed the framing

**When:** this session, 2026-08-16.

Progress had been reported as a series of green results: workflows activated,
paths turning green, commits pushed. The owner asked directly whether the system
could deploy tomorrow.

Checking properly rather than answering from those reports found: only **1 of 9**
use cases had ever completed a customer-facing action; five had never executed
against a real service at all; there was no alerting on any of the nine; the
approval UI existed for all nine but was installed for none; and the running
UC-01 workflow could still send a customer two letters.

**What changed:** `docs/PRODUCTION-READINESS.md`, this plan, and the recognition
that *"all nine workflows are active"* and *"all nine workflows are production
ready"* had been sliding into each other in the reporting.

**The lesson (P1, P2, together):** the individual green results were all true.
The aggregate impression they created was false. Nobody had lied; the reporting
had simply never distinguished "this step succeeded" from "this capability
works."

---

### C-12 · "Fix the URL so I can publish" — and what it uncovered

**When:** this session, immediately after C-11.

The owner accepted the recommendation to point the draft's Remote URL back at
the real API before publishing, rather than shipping the demo stand-in into the
production path.

Doing that required comparing the deployed n8n node against its source, which
surfaced the most serious defect found in the project: **the decision gates
existed in three copies, and the deployed one was three shipped fixes behind.**
The over-scope gate (F-17), the fail-closed confidence check (F-19) and
`out_of_scope` routing had all been written, reviewed, tested, committed and
pushed — and none had ever run for a customer. No test could catch it, because
the parity test compared two files, neither of which was the one serving
traffic.

**What changed:** the node redeployed verbatim from the parity-tested source, and
`npm run verify-deployed` added to diff deployed bodies against their files —
exiting 2 rather than 0 when it cannot reach n8n, so a skipped check never looks
like a passing one.

**The lesson:** this correction was not about the URL at all. Being asked to do
one careful thing properly is what exposed it. That is an argument for the
owner's instinct throughout this project — *check the thing itself* — over the
assistant's faster instinct to trust the last green result.

---

### C-13 · The alert workflow was wired to another project's Telegram bot

**When:** 2026-08-17, at the start of the session.
**Source:** the owner, on seeing two test alerts arrive in the wrong chat.
Recorded in commit `828d020`.

Building the ops alerting (the fix for `PRODUCTION-READINESS.md` A2, "a failure
is silent"), the new `RCX OPS · Error Alerts` workflow was pointed at the
`iKANWEBLEADbot` Telegram credential and chat id that already existed on the
shared n8n instance. Those belong to a **different project of the owner's**.
Two test alerts reached that chat before the owner pointed it out.

No credential value was ever read — n8n does not expose them, and the workflow
referenced the credential by id while n8n did the sending — but the alerts
still landed somewhere they had no business landing.

**What changed:** the Telegram node was removed from the graph entirely, and
alerts were re-pointed at a **durable `ops_alerts` table** first. That table is
now the actual fix, independently of which bot delivers anything: a chat
message can be swiped away, cannot be counted, and cannot feed a dashboard. The
row carries the use case, risk tier, failing node, execution URL and
`audit_durable` — whether the decision survived the failure, which is the first
question worth asking about any incident. Push delivery was then left
deliberately **unconfigured** until the owner provisioned a credential belonging
to this project (`Remote_CX_Auto`), and `workflows/README.md` now records
explicitly that `iKANWEBLEADbot` must not be used here.

**The lesson (P3):** "a credential that is already connected" is not the same
claim as "a credential this project may use." On shared infrastructure, reaching
for whatever is already wired up is the fastest way to make another system's
users your test audience. It also produced a better design than the one being
corrected — the durable row would have been right even if the bot had been ours.

---

### C-14 · "Use multiple agents"

**When:** 2026-08-17, when the session's plan was a single sequential worklist.
**Source:** the owner, directly.

The plan for the session was to work through the fixes one at a time in one
context. The owner instructed that the work be split across parallel agents
instead — the same model this project had already used for the ten-issue backlog
and the six-use-case build (C-05), each agent in its own lane, hand-reviewed and
merged one at a time.

**What changed:** the session ran five lanes in parallel (identity gates,
upstream-failure attribution, UC-03, ops alerting, documentation), which is how
five independent live fixes landed in one session rather than one or two. It
also enforced a boundary that turned out to matter: the documentation lane was
explicitly forbidden from touching `src/`, `test/`, `scripts/` and `workflows/`
while other agents were editing them, so no lane could silently overwrite
another's work.

**The lesson:** this is the only correction in this file about *how to work*
rather than about what is true, so it belongs to no pattern. It is worth
recording anyway, because sequential work in one context is the assistant's
default and it is frequently the wrong shape for a session with several
independent fixes in it. The constraint that makes it safe is not the
parallelism — it is giving each lane a disjoint set of files and reviewing every
merge by hand.

---

### C-15 · "UC-04 and UC-05 point at the wrong host" — they do not, and the fix would have caused an outage

**When:** 2026-08-17. **This is a correction of my own diagnosis, caught before
it shipped.** Commit `b9c1a08`.

Seven n8n graphs read employment records from `gateway.remote-sandbox.com`.
UC-04 and UC-05 read from `your-sandbox-standin.vercel.app`. Both of those two
were failing with a 404. I recorded the host difference as drift, wrote it up as
the cause, and queued a repoint to the gateway.

It was wrong twice over.

- **The stand-in is deliberate infrastructure**, not drift (`src/remotebridge/`,
  deployed from `deploy/remote-bridge/`): a read-only proxy that forwards the
  caller's `Authorization` untouched, refuses writes with `405`, and fills
  **only** fields the raw Sandbox leaves null, naming each one it touched in an
  `X-Standin-Enriched` header. UC-04 reads `custom_fields.workation_permission`
  and UC-05 reads `basic_information.start_date`; the raw gateway returns
  `undefined` for both. `enrichment.js` names those two use cases as the ones
  that need it.
- **So the repoint would have broken both use cases in production.** On gateway
  data UC-04 would have refused *every* request with
  `employer_permission_not_granted`, and UC-05 would have had no start date to
  compute tenure from.
- **The real cause was a dead employment id.** The Remote Sandbox had been
  reseeded and `fde4007b-…` no longer exists — it 404s through *both* hosts,
  identically, which is exactly what made the host explanation so plausible.

**What changed:** the diagnosis was retracted in the same session it was made,
`CLAUDE.md` §6 gained a standing "do NOT 'fix' this" warning on the two hosts,
and the reseeded ids were re-verified live (Alexandre Tremblay is now
`3537d9ee-2017-4a53-952e-9d3b042aeab5`).

**The lesson (P5, new):** when two things differ and one of them fails, the
difference is a *hypothesis*, not a cause. Confirming it is load-bearing costs
one test — send the same id through both hosts — and skipping that test would
have turned a dead fixture into a production outage. Note also which direction
the error ran: the "fix" was more dangerous than the bug.

---

### C-16 · UC-03 could never have said yes — and every safety test passed anyway

**When:** 2026-08-17.

UC-03's supported-destination gate built its country list from the `code` field
of Remote's `GET /v1/countries` response, then compared two-letter destination
codes against it. `code` is the **alpha-3** form: `ESP`, not `ES`. The real array
also sits directly under `data`, not `data.countries` as the node's own comments
claimed, and `country_code` — the field the code originally looked for — does not
exist on that endpoint at all.

The consequence: a *successful* 224-row fetch produced an **empty** supported
list, every destination failed the membership test, and UC-03 could not reach
`auto_resolve` for any input, ever. Execution `4259` records it verbatim —
`"supportedCountries": []` next to a healthy countries fetch, with Spain
(`eor_onboarding: true`) escalating as `unsupported_destination`.

**Why it survived so long is the point.** The gate fails closed, so its output
was always a safe escalation. Every fail-closed assertion in the suite passed.
Every audit row looked defensible. The run status, the node status and the
recorded reason all agreed, and all of them were wrong about the same thing.
It was also actively taught by the fixtures: `src/remote/mockServer.js` serves
`{data: {countries: […]}}` with flat `{country_code}` rows — an envelope and a
row shape the real API does not use — so the mock agreed with the code rather
than with reality.

**What changed:** the list is now normalised on the alpha-2 axis explicitly, and
**a row offering only an alpha-3 code is dropped**, deliberately. Adding
`?? row.code` would have put `"ESP"` in the set to compare false against `"ES"`
forever — the same defect one level down. Converting properly needs a 249-entry
alpha-3→alpha-2 table this repo must not invent, and "a code we cannot compare"
honestly means "not confirmed supported", which on a 🟢 auto-reply-and-solve
path must escalate.

Proven live, and this is the evidence that matters: audit row **`c644cdce`**,
`auto_resolve` / `all_gates_passed` for Spain — **the first `auto_resolve` UC-03
has ever recorded** — against **`c8992d3d`**, `escalate` /
`unsupported_destination` for Afghanistan. Afghanistan was chosen precisely
because it is *unsanctioned*, so it tests the supported-list gate rather than
being caught earlier by the sanctions override.

**Postscript, hours later.** The mock server that had been teaching the wrong
shape was then made faithful to the real API (commit `8dae81e`). Doing so broke
three tests — every one of them a real finding, including one named *"normalize
Employment falls back to the 3-letter code when alpha_2_code is absent"*, which
had pinned the defect as **intended behaviour** and passed for its whole life.
A fourth test did not break and mattered more: it built a `Set` from a field
that does not exist, filled it with `undefined`, and passed vacuously — the same
failure mode relocated into the test written to catch it.

That work also found the next instance of this exact pattern, in a place with
real money attached: **UC-09 raises its approval floor from two people to three
for Germany, France and Italy, and it was comparing against a country value
arriving as `"DEU"`.** The comparison was always false, so the third approver had
never once been required against a real Remote record. A control that has never
fired and a control that has never been *needed* look identical from the outside.
It fires now, and there is a positive test holding it there.

**The lesson (P6, new):** *no negative test can detect this class of bug.* A use
case that structurally cannot succeed is indistinguishable from one being
appropriately cautious — both refuse everything, both fail closed, both look
responsible. Only a **positive** test ("this specific input MUST auto-resolve")
separates them. Three of this session's five defects were invisible for exactly
this reason, and the safety property the whole architecture is built around is
what concealed them.

---

### C-17 · Four identity gates verified a claim against itself

**When:** 2026-08-17.

Identity is this project's prime directive #3 — *identity comes from an
authenticated signal, never a claim.* Four n8n gates broke it in two different
ways, and both could report `verified: true` having proved nothing:

- **UC-03 and UC-05** built their "authoritative" employment record by falling
  back to `request.employmentId` — the caller's own claim — when the Remote fetch
  returned nothing, then compared the caller's session against that. The claim
  was checked against itself.
- **UC-06 and UC-09** compared `session.companyId` against a `company_id` that
  defaulted to `null` when the record was absent, so `null === null` passed.

All four still refused in practice — but only because a **later** gate (employment
status) happened to catch the run first. An identity control whose correctness
depends on a downstream gate is not a control; it is a coincidence, and it
survives exactly until someone reorders the gates or a record arrives with a
status field populated and nothing else.

**What changed:** the fix is at the construction site in every case, not at the
comparison. No usable record now yields `employment = null` — which is literally
what `RemoteClient.getEmployment()` returns on a 404 — so there is no synthetic
object for a caller's claim to be compared against. The reference implementations
in `src/` were already sound; the defect lived only in the n8n ports.

Proven in production on UC-05 with **identical input** either side of the fix:
audit row **`a324f666`** (`uc05-identity-defect-PREFIX-01`) recorded
`employee_not_active`; row **`283dbd1f`** (`…-POSTFIX-01`) records
`identity_not_verified`. Same refusal, correct reason. Row **`946764ef`** is the
positive half — a sound request reaching `prepared_for_signoff` /
`all_gates_passed`, proving the gate still says yes when it should.

**The lesson (P6):** "it failed closed" and "the control works" are different
claims, and the first was being reported as the second. The only way to tell them
apart is to ask *which* gate refused and why — which is why the recorded reason,
not just the decision, is the thing worth auditing.

---

### C-18 · A node reported success, emitted an error object, and the audit log blamed the customer

**When:** 2026-08-17.

Four graphs carry `onError: continueRegularOutput` on their Remote HTTP reads.
That setting does **not** mark the node red and does **not** stop the run: the
node reports `executionStatus: "success"` and emits
`{json: {error: {message, status, …}}}` *in place of the data*, which then flows
downstream as if it were a record. The gates read `…json.data.employment`, got
`undefined`, and escalated — recording `identity_not_verified` for what was
actually a 404 or a 403 from Remote.

Live proof (executions `4218`/`4232`/`4238`): UC-02 swallowed a 404 on the
employment read, a 404 on the expense read *and* a 403 on the expense-categories
read, then wrote an audit row saying `identity_not_verified` — while the webhook
had supplied a perfectly good `session.authenticatedEmploymentId` that would have
passed the identity gate on a good fetch. A human reading that row triages an
identity problem that does not exist, while the real causes (a dead Sandbox id, a
scope-less token) are recorded nowhere.

**What changed:** `src/shared/upstreamFailure.js` now separates three states that
had been collapsed into one — `upstream_record_not_found` (a 404: an
authoritative answer *about the record*), `upstream_unavailable` (403/5xx/
transport: the request was never evaluated and nothing about it is knowable), and
an unchanged policy refusal. It is **fail-closed by construction**: every verdict
it produces is an `escalate`, and it is only ever consulted at a gate that was
already refusing, so it can change a refusal's recorded reason and can never turn
a refusal into an approval.

Proven live in one back-to-back pair: UC-09 audit row **`105cd7c4`** =
`upstream_record_not_found` with **1** recorded upstream failure, against
**`590772ee`** = `identity_not_verified` with **0**. Same use case, same shape of
request, two genuinely different causes now recorded as two different things.
UC-02 row **`f45e06c3`** keeps its true policy reason (`expense_not_found`) and
carries **2** upstream failures alongside it as provenance.

**The lesson (P1 and P6 together):** this is the pinned-node lesson (C-02) wearing
a third disguise. First a green run hid a node that did nothing; then a green node
delivered escaped HTML (C-09); here a green node handed an error object downstream
and the system blamed the customer's identity for Remote's outage. The status of a
step is not evidence about the state of the world — and when the system's response
is a *safe* one, nothing about the outcome will tell you either.

---

### C-19 · "There has to be a place in the UI, and even documentation, that explains what the gates mean"

**When:** 2026-08-19.
**Verbatim:** *"there has to be a place in the ui, and even documentation that expalsin what the gates means. 1 to 15."*

The UC-02 decision panel said **"Decided by gate 15."** Fifteen of what, in what
order, and what did gates 1 to 14 conclude? The system knew all of it — the
ordered ladder is `GATE_SEQUENCE` in `src/uc02/policyEngine.js` and it decides
every expense — and showed a reader a number citing an order that existed
nowhere they could see.

**What changed:** `describeGateLadder(reason)` returns the whole ordered ladder
with every rung marked `passed` / `decided` / `not_reached`, rendered collapsed
under the deciding gate, plus `docs/GATES.md`. `not_reached` is deliberately a
different word from `passed`: **a gate that never ran approved of nothing**, and
collapsing those two would let a reader conclude fourteen checks had cleared a
claim when in fact five of them never looked at it.

Honest boundary kept in the doc: `GATE_SEQUENCE` is **UC-02 only**. The doc says
so rather than implying nine ladders exist.

---

### C-20 · "When I click generate a new reference, I want to see the new id it generates"

**When:** 2026-08-19.
**Verbatim:** *"when i click on generate a new refrence i want to see the new id it generate."*

The control minted a reference and never showed it. So the one thing a person
needs in order to check what happened to their submission — the string every
downstream table is keyed by — was generated on their behalf and withheld from
them.

**What changed:** the reference is built once, sent, and reported back verbatim.
Building it twice (once to send, once to display) would have generated a second,
different reference and quietly made the "reuse this reference" control lie.

---

### C-21 · "No matter what I do in UC-02, I always get 'Already decided'"

**When:** 2026-08-19.
**Verbatim:** *"i ticked generate a new refrence and instead i got this"* and then
*"no matter wht i do in UC-02 i will always get 'Already decided — the stored
decision was replayed'."*

Every UC-02 scenario in the portal was a **one-shot**, and the system looked
broken while behaving perfectly. Two correct mechanisms collided:

1. The request reference identifies the **DELIVERY**. Claiming it before the
   first durable write is what makes delivery exactly-once.
2. UC-02 separately asks *"have I already judged this expense?"* and replays the
   stored decision when it has. That check is correct and load-bearing — a
   second decision would mean a second approval write.

The fixture list is fixed. So a tester who generated a new *reference* and
expected a new *decision* got the replay, and read the reference control as
broken. Nothing was broken; the two ids answer two different questions and the
page never said which was which.

**What changed:** `src/remote/mockServer.js` mints a genuinely new claim from an
existing one (`<id>~fresh-<token>`), offered as *"File this as a new claim"* —
the fixture equivalent of the employee buying another dinner. It changes the
**subject**, not the delivery. The minted title carries the token because
`deriveReceiptFingerprint()` hashes the title, so a byte-identical copy would be
correctly refused at gate 6 as an already-reimbursed receipt. Nothing in
`src/uc02/` knows the id form exists.

**The lesson:** correct behaviour that cannot be distinguished from a bug is a
usability defect with the same cost as a real one. The owner spent that cost
before anyone noticed the design had never been explained.

---

### C-22 · "Say that the reason this needs a human review is that the expense is above the policy cap"

**When:** 2026-08-19.
**Verbatim:** *"make this easier to understad by saying that the reason this needs
a human eview is beacuse the expense is above the policy cap."*

The panel printed the reason slug `over_category_cap`. Correct, precise, and
meaningless to the person waiting for their money.

**What changed:** every rung of `GATE_SEQUENCE` gained a per-**reason** `means`
string — plain words for what that reason *is to a person* when it fires — and
the panel now leads with it, with the slug kept beside it rather than replaced.
The slug is what an engineer greps for; the sentence is what a requester reads.
Dropping either one would have traded one audience for the other.

---

### C-23 · "I checked Zendesk and did not see a new ticket created"

**When:** 2026-08-19.
**Verbatim:** *"i checked zendesk and did not see a new ticket created as a result
of this."*

**Every single portal hand-off to Zendesk had been failing, for every use case,
since the surface was built.** The portal built each persona's requester address
under `@portal.invalid` — a reserved TLD, chosen deliberately so a demo could
never mail a real person. Zendesk rejects it with a **422** on ticket creation.
So no ticket was ever created, and the failure was invisible: the decision was
already durable by then (which is the architecture working exactly as intended),
so the requester saw a correct decision and Finance Ops saw nothing at all.

**What changed:** `@example.com` — also reserved, also unmailable, and accepted
by Zendesk. And, found in the same pass because the owner's question forced a
look at the whole hand-off: the escalation group lookup was 403-ing on every
call (`GET /api/v2/groups` needs the `read` scope the runtime client deliberately
lacks), so **every** escalation had been landing in the default `Support` group,
unassigned. Now resolved once by `npm run sync-groups` into
`src/shared/escalationGroupIds.js`, with the live read still authoritative and
the synced id as fallback — and the response says which of the two answered.

**The lesson (P1 again, and the most expensive instance yet):** the portal
reported success because *its own* work had succeeded. Nothing checked the
destination. One question — "I looked and it isn't there" — found a defect that
had been shipping in seven use cases.

---

### C-24 · "But I thought I already did this, way back when"

**When:** 2026-08-19.
**Verbatim:** *"but i thought i already did this, way back when. cxSharedSecret →
paste the same value as ZAF_SHARED_SECRET on the Vercel project."*

The sidebar was refusing reads, and the assistant told the owner to go and set a
setting. **They had already set it, and they were right.** The real cause was
that the installed ZAF bundle predated read-signing by about half an hour, so
the app was not sending the signature the API required — a *deployment* problem
that had been diagnosed as a *configuration* problem.

**What changed:** the app now reports `lastRequestWasSigned`, because ZAF secure
settings are never sent to the browser — the app genuinely cannot inspect its own
secret, so *"the secret is wrong"* and *"this bundle does not sign at all"* were
indistinguishable from inside. Now they are not.

**The lesson:** the assistant proposed a fix for a state it had not verified,
against an owner who had verified it. The correction was the owner refusing to
redo work on the assistant's say-so.

---

### C-25 · "Why the term 'released' and not 'approved' or 'denied'?"

**When:** 2026-08-19.
**Verbatim:** *"Why the term released and not 'approved' or 'denied?'"* → *"please
do it. A proper renaming."* → *"make sure you change all my terminologies to
remote own terminologies."*

A question about one word turned into an audit of the whole vocabulary, and the
finding is a single number: **`deny` occurs zero times in Remote's entire
documented corpus.** `decline`/`declined` occurs **648** times, measured across
the 38 `.md` pages named by Remote's own `llms.txt`. Their expense status enum
member is `declined`; their time-off endpoint is `POST /v1/timeoff/{id}/decline`;
four of their webhooks are named `*.declined*`.

UC-02 had said `decline` since the day it was built — not by taste, but because
Remote's API forced it to. Every other approval surface said `deny`, which was
**ours by accident rather than by decision**: nothing in the repository had ever
defended it.

**What changed:** `docs/REMOTE-VOCABULARY.md` — 21 renames, 24 deliberate keeps,
and **9 cases where renaming would have been wrong**, each with its reasoning.
`deny → decline` executed across UC-01's review, UC-04, UC-05 and UC-06. The
keeps matter as much as the renames: matching a vendor's vocabulary is a service
to the reader, not an obligation, and a word this system uses more precisely than
Remote does should stay.

**The lesson:** an agent reading our DENIED beside Remote's `declined` was
translating where they could have been reading the same word twice. That cost is
invisible in any test.

---

### C-26 · "In real life, when a client makes a request, they expect feedback"

**When:** 2026-08-19.
**Verbatim:** *"in real l life when a client makes a request, tehy expect feed
back, so the approved esp ones that require human reveiw or declined, should not
juts remain on zendesk but sent back to my own remote ui, and even be in the live
view and audit logs."*

The most architectural correction of the project. A decision made by a specialist
in the ZAF sidebar landed in Zendesk and in `audit_log` — and **the person who
filed the request was never told.** The loop was open on the only end that
matters to a customer.

This is not a UI omission. It is a whole half of the system that had not been
built, and it was invisible from the inside because every internal surface
(feed, audit trail, ticket, sidebar) showed the decision correctly.

**What changed:** the requester-facing half — the portal's "My requests" reads
each record's live state and reports who decided, when, what they wrote, and
whether the write to Remote actually landed, in the deciding use case's own
words. Read-only by construction: no approve control exists on that surface,
because a second place to decide would be a second, unaudited place to decide.

---

### C-27 · "I did not see the amount, the cap, by how much, or by what percent"

**When:** 2026-08-19.
**Verbatim:** *"the zendesk told me that the requetsw was above the policy cap, but
i did not see the amount the person wants approved, what the policy cap for that
category is, and by hwo much and by how mnay percent is it above the policy cap."*

The system **held every one of those four numbers** — it cannot decide
`over_category_cap` without them — and told a Finance Ops specialist only that a
cap had been exceeded. The specialist then has to go and look up the figures the
decision was already made from.

**What changed:** the claimed amount, the category cap, the overage and the
percentage now travel with the decision to every surface that reports it.

**The lesson, and it names a pattern this log did not have (P7):** *the sentence
that was printed was **true**.* "Above the policy cap" is not wrong. That is
exactly why nothing caught it — there is no test for "said less than it knew",
because every assertion about the output passes. This pattern recurred roughly
eight times across today alone, and it is only ever found by a person reading the
output and asking *"…and then what?"*

---

### C-28 · "The approve was done — I saw it in the live feed — but saw nothing in the request page"

**When:** 2026-08-19.
**Verbatim:** *"i just tried now, the approve was done, at least i saw something in
the live feed, but saw nothing in the request page."*

Two defects, and the second one made the first catastrophic.

1. Three stores (`uc04`, `uc05`, `uc09`) built their SQL with `${params.length}`
   where `$${params.length}` was meant, so Postgres received
   `employment_id = 1` — a text column compared to an integer literal — and
   refused. `src/shared/caseStore.js` had it right; the three copied from it did
   not, in both the condition and the `limit`.
2. The listing let that throw escape to the route's catch, which answers **500
   for the whole page**. So a UC-02 claim approved minutes earlier was invisible
   because **UC-05's** query was malformed. One use case took down all seven.

**Why no test caught it:** every test drives the **in-memory** branch —
`listByOwner()` checks `this.pgPool` first and returns a filtered array without
building SQL at all. The Postgres path, *the only one the deployment uses*, was
entirely untested. Same shape as the fixture problem this project keeps paying
for: the tests exercised a path production never takes.

**What changed:** the SQL, plus per-store isolation in the listing — a use case
that cannot be read is now reported *beside* the ones that could, with its
reason, and the message says the record itself is unchanged. Two tests added, one
asserting the SQL string handed to a fake pool contains `$n` placeholders and no
bare numbers; both verified load-bearing by reverting a store and watching them
go red.

**Found by:** the Vercel runtime logs, which named it in one line. A diagnostic
channel the assistant had not used all session.

---

### C-29 · "I don't like the format the My Requests page is in"

**When:** 2026-08-19.
**Verbatim:** *"oKay good but i dont like the format the my request page is in.
Make it just like the the live feed page, where there is horizontal scrollig,
this makes readbilty better. and add timestamps."*

Twelve requests rendered as twelve cards. Readable for one, unusable for twelve:
nothing lines up, so no column can be compared down the page, and each card's
identifier grid pushes the next request most of a screen further down.

**What changed:** the same shape as the audit viewer's live feed — one row per
request, a floor width, and the card scrolling sideways rather than the page
(measured in Chromium: 2347px table inside a 906px wrapper, page body zero).
Column order carries the argument: what happened, when and who decided it come
first; the identifiers follow, off the right edge, which is what the sideways
scroll buys — the plumbing does not have to be *deleted* to stop it crowding out
the answer. Timestamps became three things at once: local time (quotable),
"9 min ago" (which is what actually answers *did my approval just land?*), and
the untouched ISO in `title`.

**Found while doing it — a second instance of C-26's shape:** the server had
**always** sent `notListed`, naming the use cases a listing could not read and
why, and **nothing in the browser ever rendered it.** So a failed read looked
identical to having filed nothing — precisely the confusion C-28 caused in
production.

---

### C-30 · "This is supposed to appear in the live feed — and I hope there's an id that ties the entries"

**When:** 2026-08-19.
**Verbatim:** *"this is supposed to appear in the live feed. i hope there is an id
that ties the enteires in the live feed, so that naybody that wants to do a
deeper auidit and trace anything can use it?"*

Sent with a screenshot of a portal refusal — an admin persona filing an employee's
expense, refused 403 `persona_cannot_claim`.

Two findings in one message:

1. **The refusal reaches no audit trail at all.** It returns from the adapter
   *before* the use case's handler is called, so no gate runs and no `audit_log`
   row is written. The reference the owner was shown existed in no table
   anywhere. An identity refusal is the *most* audit-worthy event this system
   produces — someone attempted to act on a record they are not entitled to — and
   it was the one event that left no trace.
2. **The tying id exists and cannot be found.** `audit_log.details->>'externalRef'`,
   `workflow_claims` keyed on it, `audit_trace.parent_id` hanging off the decision
   row, and `readStore.lookupRef()` already joining all of them behind the
   viewer's bug-audit tab. The portal prints the reference and says nothing about
   what it is for.

**The lesson (P8):** twice in one day — `notListed` in C-29, and this — a
capability was fully built, correct, and reachable by nobody. **A capability that
cannot be found is, for the person in front of it, a capability that does not
exist.** That is not a documentation problem; it is an unfinished feature that
passes all its tests.

---

---

### C-31 · "Am I supposed to just go to UC-04 and see what was forwarded to it?"

**When:** 2026-08-19.
**Verbatim:** *"How is this supposed to work? Am I supposed to just go to UC-04
and see what was forwarded to it?"*

Sent after filing a UC-03 travel request through the portal and getting
`route_to_uc04 / work_authorization_requested`.

**The answer is no, and the system had told them otherwise.** Two lines about
the same branch contradicted each other, and the false one was the one the
customer read:

- `src/uc03/workflow.js` (a code comment, accurate): *"The UC-04 handoff event
  exists ONLY for the route_to_uc04 decision — it is recorded and returned for
  inspection, **never dispatched to UC-04**."*
- `src/uc03/policyEngine.js` (rendered to the requester, **false**): *"It **has
  been handed to** the work-authorisation case (UC-04)…"*

"Has been handed to" asserts a transfer that does not happen. No UC-04 record is
created, nothing enters a UC-04 queue, and a person who goes and looks finds
nothing — which is the correct thing to find. The panel reinforced it twice
over: a "Routed to" row printing a slug, and a "Handoff to UC-04" row reading
like a message sent.

**This is the inverse of P7 and it opened P9.** P7 is the system saying *less*
than it knew in sentences that were all true. Here it said **more than it did**,
and the overstatement was in the customer-facing string while the honest account
sat in a comment only a developer reads.

**The tempting fix was wrong.** "Then dispatch it" fails three ways, any one of
them decisive:

1. **There is nothing to dispatch into.** `POST /v1/work-authorization-requests`
   does not exist (`docs/REMOTE-VOCABULARY.md` §13.1, `[CONFIRMED]`). Remote's
   contract is create-by-employee, decide-by-API: the request is raised by the
   employee in Remote's Request Hub and UC-04 `PATCH`es a verdict onto it.
   `src/uc04/requestLink.js` exists precisely because UC-04 used to invent the
   record it decided on; dispatching from UC-03 would rebuild that defect one
   use case upstream.
2. **It would be a tier escalation performed by automation.** UC-03 is 🟢
   (auto-execute); UC-04 is 🟡 (a human approves). A 🟢 workflow minting a 🟡
   record creates the *object* of a human approval with no human in it —
   `CLAUDE.md` §3 directive 2 exists to forbid exactly that.
3. **The data does not exist.** Of UC-04's seven required intake inputs, UC-03
   can source one reliably (home country, off the employment record), two
   best-effort (destination and dates, from the classifier — and the routing
   gate decides *before* either is checked), and **four not at all**:
   nationality, visa type, job duties, and contract-signing authority. A
   dispatched record would be `blocked / factors_invalid` on arrival — a refusal
   describing our own incomplete forwarding while reading as a finding about the
   employee's trip.

**What changed.** The requester-facing sentence now says nothing was sent, no
case was created, and there is no queue to go and look in; then says what *does*
exist, where the work-authorization request is actually raised, and **names the
four things a travel ticket never states**. `src/uc03/uc04Intake.js` holds that
list as data and reports per run what this particular handoff carries and what it
does not — recorded in `audit_log` with a literal `dispatched: false`, so the
record *asserts* that nothing was sent instead of leaving it to be inferred from
a missing row. The same overstatement had reached the specialist too, in the
Zendesk note and the review-queue note; both were corrected. And the portal
stopped printing the gate's sentence twice, which mattered once it grew from one
line to four.

**Not built, deliberately, and said so rather than quietly working toward it:**
a real dispatch. If Remote ever ships a create endpoint, forwarding becomes
possible — and it would still be a tier-crossing automatic write, which is the
owner's decision, not an agent's.

**The lesson (P9):** the decision was right, the audit row was right, the flags
and the reason slug were right, and 2,166 tests passed. **The only wrong thing
in the system was a sentence of English**, and no assertion about behaviour can
catch that. What can: when a code comment and a customer-facing string describe
the same branch in opposite terms, the one facing outward is the one being read.

## What this list is actually evidence of

Reading the thirty-one together, the assistant's errors cluster in two places, and
the second cluster only became visible once the system was used rather than read.

**The first eighteen: the gap between a process reporting success and the world
actually changing.** Pinned nodes, escaped HTML, dead webhooks, unreachable API keys,
drifted deployments, a node emitting an error object and calling it success —
every one of them produced a green signal over a broken reality.

The 2026-08-17 session added a second cluster worth naming separately (P6):
**this system's own safety property is capable of hiding defects from it.**
Everything here is built to fail closed, which means a broken component and a
correctly cautious one produce the same output, the same audit row, and the same
passing test. Fail-closed is still the right design — the alternative fails
*open*, which is worse in every case — but it comes with a testing obligation
nobody had noticed: **every use case needs at least one positive test asserting
that a known-good request MUST succeed.** Without it, a use case can quietly
stop working entirely and every signal will stay green.

**C-19 to C-31, all from one day: the gap between a system being correct and a
person being able to use it.** 2026-08-19 was the first day this system was
*driven* rather than read, and thirteen corrections came out of it — every single
one found by the owner using a real surface as a real user would. None of them
were caught by the passing suite, and none of them could have been:

- The system decided correctly and **printed a true sentence that withheld what
  it knew** (P7): "decided by gate 15" citing an order nobody could see; "above
  the policy cap" without the amount, the cap, the overage or the percentage.
- The system built a capability and **rendered it nowhere** (P8): `notListed`
  and `lookupRef()`, both complete and both invisible.
- The system reported its own success while **the destination had rejected every
  request for the life of the feature** (C-23): seven use cases handing off to
  Zendesk under a reserved TLD that Zendesk 422s.
- The system was **correct in a way indistinguishable from broken** (C-21): two
  ids answering two different questions, with nothing saying which was which.
- The system **tested the path production never takes** (C-28): every store test
  drove the in-memory branch while the Postgres branch — the only one the
  deployment uses — shipped a two-character SQL bug that made one use case's
  failure erase all seven.
- The system **claimed an action it had never taken** (P9, C-31): a 🟢 router
  telling the customer their request "has been handed to" UC-04, while the code
  comment two files away said, correctly, that nothing is ever dispatched. Every
  test passed; the only defect was a sentence.

**The two clusters have the same root and it is worth naming exactly.** In the
first, the assistant trusted a *signal* instead of the *destination*. In the
second, it trusted the *code* instead of the *experience of using it*. Both are
the same substitution: taking something adjacent to the truth as the truth,
because the adjacent thing is cheaper to check.

The owner's corrections cluster in the opposite place from the assistant's
errors, and across all thirty-one they are consistently the same instruction in
different clothes: *go and look at the thing itself.* In the first eighteen that
meant the database row, the rendered comment, the live graph. In the last
thirteen it meant the screen a customer is looking at — and in C-31, the
sentence printed on it.

That is worth stating plainly, because it is a real finding about working with
AI assistants on production systems, and it is not one the literature covers. The sharpest version of it is this: **a system can pass
every test it has, be correct at every gate, record every decision durably — and
still tell the person waiting on it nothing useful.** No amount of engineering
rigour detects that. Only use does.
