# Metrics — measuring whether the automation deserves to keep running

> Run it: `npm run metrics` (works with no credentials — see *Where the rows
> come from*). Output: a summary in the terminal and `demo/metrics.html`.

Most automation projects can tell you what they built. Far fewer can tell you
whether it is working, and almost none can tell you when to **switch something
off**. This layer exists to answer the second and third questions.

Every `UC-0X.md` spec lists "success metrics" as prose. This is where that prose
becomes arithmetic.

---

## The one idea: every judgement is tier-aware

A naive dashboard maximises "% automated". Here that would be actively
dangerous, because it rewards exactly the behaviour the architecture exists to
prevent.

| Tier | What a high auto-resolution rate means |
|---|---|
| 🟢 **Low** | Success. This is the goal — measure it and push it up. |
| 🟡 **Medium** | Nothing. The human gate is the design; a 0% auto-rate is *correct*. Judge these on whether specialists accept the AI's recommendation. |
| 🔴 **High** | **An integrity violation.** These use cases are specified to have no execution path. An auto-resolution appearing in the data means one exists. |

So `recommend()` in `src/metrics/compute.js` branches on tier, and the test
`"a medium-tier use case is NOT judged on auto-rate"` locks that behaviour in.

---

## The metrics

### Safety invariants (checked first, outrank everything)

Three conditions must never appear in the data. Any one of them condemns a use
case regardless of how good its rates look:

1. **`flagged_auto_resolution`** — a case that auto-resolved while carrying
   escalation flags. `policyEngine.evaluate()` returns `auto_resolve` only when
   no flag was raised, so this means something bypassed the gates.
2. **`auto_resolution_on_high_tier`** — any auto-resolution on UC-07/08/09.
3. **`redundant_call`** — an audit trace fired the same call more than once for
   no good reason. The audit trace records one entry per attempt
   (`audit.js`'s `logTraceStep`), and the retry wrapper (`src/shared/retry.js`)
   is the *only* legitimate source of multiple entries for one call, numbering
   them 1, 2, 3, … through its `onAttempt` callback. So `findRedundantCalls()`
   groups trace rows by `(parentId, call)` and flags any group whose attempts
   do not read as one clean 1..n sequence — two entries both claiming
   `attempt: 1`, a second retry run on top of the first, a gap, or a missing
   attempt number. The same call under two different parents is expected (each
   decision row makes its own calls) and is never grouped.

These are reported as a count that must read **0**, not as a rate. A rate would
imply a tolerable level.

### Auto-resolution rate

`auto_resolve ÷ total`, per use case and overall. The headline number for 🟢
low-tier use cases, and deliberately not a verdict input for the others.

### Exception reasons, ranked

Cases that did *not* auto-resolve, grouped by `cases.reason`, most common
first. **The top row is the next thing worth engineering** — this is what turns
"the automation only handles 56%" into "the automation only handles 56%
*because 57% of exceptions are attached forms it can't read*", which is a
roadmap item rather than a complaint.

The denominator is exceptions, not all cases: auto-resolutions must not dilute
the share and make every cause look small.

### Specialist acceptance rate

Of the review-queue rows that reached a terminal state, the share marked
`approved`. This measures whether the AI's preparation is trusted. Pending rows
are excluded from the denominator, and the rate is `null` — not `0` — when
nothing has been decided, because "no data" and "everyone rejected it" are
opposite situations that must never render identically.

**This is now fed by real decisions.** The ZAF sidebar (`zaf-app/`) writes
`approved` / `rejected` to `review_queue` on every approve/deny, alongside an
`audit_log` row naming the human who decided and the AI recommendation they
agreed or disagreed with. Before the sidebar existed this rate could only be
simulated; it is the reason the sidebar was built before the remaining use
cases. `test/review.test.js` pins the loop end to end: two seeded cases, one
approved and one denied, produce an accept rate of exactly 0.5 — and the same
test asserts the rate is `null` beforehand, so a renamed status can never
silently zero the metric.

### Median handling time

Creation to last update, for cases that reached a terminal state. Today that
means the zero-touch path only, since queued cases have no terminal timestamp —
the dashboard labels it *"resolved cases only — queued work excluded"* rather
than implying it covers the slow part too.

### Estimated LLM spend (the cost model)

**Closes the "No cost model" gap this file used to list.** Every LLM call site
in the repo — the UC-01 classifier through UC-08's `dossierBuilder` — tags its
audit-trace entry with the OpenAI response's real token usage:
`details: { usage: {model, promptTokens, completionTokens, totalTokens},
useCase }`. `src/shared/llm.js`'s `askJson()` attaches this to the parsed JSON
object it already returns, as a **non-enumerable property** (`tagUsage()`),
specifically so every existing caller — which reads that return value as the
classification/parse/narrative object itself, spreads it, JSON-stringifies it
into an audit row — is completely unaffected; `extractUsage()` is the one
sanctioned way to read it back out. A rule-based-fallback attempt made no
OpenAI call, so it carries no usage — that is the fallback working as
designed, not a gap in the data.

`computeLlmCost()` (`src/metrics/compute.js`) turns those trace rows into
dollars using a small, explicit, documented pricing table:

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Checked |
|---|---|---|---|
| `gpt-4o-mini` | $0.15 | $0.60 | 2026-08-09 |
| `gpt-4o-mini-2024-07-18` | $0.15 | $0.60 | 2026-08-17 |
| `gpt-5-nano` | **no rate on record** | **no rate on record** | declared unpriced 2026-08-29 |

`openai.com` itself is blocked by this environment's egress proxy, so the
gpt-4o-mini figures were checked via a public pricing search — independent
aggregators agree on the same two figures, which have held unchanged since the
model's 2024 launch and match OpenAI's widely published rate card.

### The deployed model has no price, and the table says so out loud

**`gpt-5-nano` is the model the live deployment runs** — read back from
`/__cx/health` on 2026-08-29, where `OPENAI_MODEL` is set on the Vercel project
and overrides the repo default. It has no row above **and must not be given
one from inside this repository**: `openai.com` is unreachable from the build
container, so no rate can be taken from the source of truth, and CLAUDE.md §3's
substitution ladder forbids fabricating money outright. (A WebSearch on
2026-08-29 returns $0.05 / $0.40 per 1M from several aggregators. That figure
is recorded in `compute.js` so nobody repeats the search, and is deliberately
not used — a rate card is precisely the class of fact where a plausible wrong
number gets acted on. It would not have helped anyway: `tagUsage()` records the
**dated snapshot** the API answers with, and which snapshot `gpt-5-nano`
resolves to has not been observed.)

**What happens to an unpriced call, and what changed on 2026-08-29.** It used
to throw. The reasoning was sound as far as it went — silently excluding real
spend is worse — but the throw was measured against only that one alternative.
`computeMetrics()` calls `computeLlmCost()` unconditionally, so with the
deployed model unpriced, **one attempt took the entire report down** with an
error reading like a bug in the metrics layer rather than "the deployed model
has no rate on record". An exception nobody can read past is not louder than a
verdict; it is quieter, because it never reaches a screen.

So an unpriced attempt is now counted, attributed and **named**, and the report
says its own total is a floor:

- `costs.complete: false`, and `byUseCase[i].cost.complete` per use case.
- `costs.unpriced` — calls, tokens, and every model that caused it.
- `costs.verdict` / `costs.rationale`, in the same `{verdict, rationale}` shape
  every use case already carries. **`unpriced`** names the models and says the
  dollar figure is a floor; **`insufficient_data`** means nothing carried usage
  at all (the seeded run — not a measurement of zero spend); **`priced`** means
  every usage-bearing call had a rate.
- A model is `known: true` when it appears in
  `LLM_MODELS_WITH_NO_PUBLISHED_PRICE` ("we know we call this and have no
  rate") and `known: false` when it appears nowhere ("a model changed under the
  deployment and nobody recorded it"). Two remedies, two signals — the same
  reason `approver_entitlement_not_configured` is kept apart from
  `approver_not_entitled`.

No number is ever invented for a missing rate: an unpriced call adds **$0.00**
to the total and **its real tokens** to the token counts, because the tokens
are knowable without a rate and the dollars are not.

**Still open, and it is the half a reader actually looks at.**
`src/metrics/dashboard.js` renders `costs.totalUsd` and cites the gpt-4o-mini
rate in its footer with the words "never invented" — both still true — but it
does **not** yet render `costs.verdict`, so on today's production data the
dashboard shows `$0.0000` with no indication that every call in the window was
unpriced. The report is honest; the screen is not yet. That is a dashboard
change, not a compute one.

The report carries cost at three levels, all derived from the same trace scan:

- **`report.costs`** — total estimated spend, token totals, and spend per
  *resolved* case (`null`, not `0`, when nothing has resolved yet — the same
  "no data" vs. "measured zero" distinction the accept-rate uses), plus a
  `byTier` rollup and the pricing table itself so the dashboard's footer can
  cite its own source.
- **`report.byUseCase[i].cost`** — the same shape, scoped to one use case, via
  `details.useCase` — which the call site sets, not a join back to `cases` —
  so cost attribution survives even if a case's own row is missing or in a
  different store.
- **The dashboard** (`src/metrics/dashboard.js`) — an "Estimated LLM spend"
  stat tile up top, and two columns (`LLM cost`, `Cost/resolved`) in the
  per-use-case verdict table.

**Why the seeded run (`npm run metrics` with no `SUPABASE_DB_URL`) shows
$0.0000.** `src/metrics/seed.js` deliberately drives every synthetic ticket
through `classifyRequestRuleBased()` directly — the real rule-based
classifier, not `classifyRequest()`'s LLM-with-fallback wrapper — so that a
reviewer can run the dashboard with zero API keys and zero cost (see
`seed.js`'s own header). That means the seeded trace set never carries
`details.usage`, and the cost model correctly reports zero spend rather than
inventing one. This is the honest behavior, not a bug: **a live run with a
configured `OPENAI_API_KEY`** (`npm run live`, or the n8n workflow, both of
which go through the real `classifyRequest()`) **produces real trace rows
with real usage**, and those are what the cost model is built to price.

A worked example from `test/metrics.test.js` (`computeLlmCost prices a single
usage-bearing trace...`): one classification call using 1,000 prompt tokens
and 200 completion tokens costs
`(1000 / 1,000,000) × $0.15 + (200 / 1,000,000) × $0.60` = **$0.00027**. At
UC-01's real seeded volume (120 tickets), a fleet of calls at that same
per-call shape would run well under a dollar — which is the point: `gpt-4o-mini`
at this call size is cheap enough that the interesting number for leadership
is rarely "can we afford this," it's "does the queue it feeds still earn its
complexity" (the accept-rate/auto-rate verdicts above). The cost model exists
so that trade-off is a real number instead of an assumption.

---

## Thresholds → verdicts

Defaults live in `DEFAULT_THRESHOLDS` and are deliberately conservative.

| Threshold | Default | Meaning |
|---|---|---|
| `minAutoRate` | 0.50 | 🟢 below this, the automation is under-delivering → **iterate** |
| `stopAutoRate` | 0.15 | 🟢 below this, nearly everything reaches a human anyway → **stop** |
| `minAcceptRate` | 0.60 | specialists often disagree → **iterate** on recommendation quality |
| `stopAcceptRate` | 0.30 | the recommendation is noise; the queue costs more than it saves → **stop** |
| `minSampleSize` | 10 | below this, report **insufficient_data** rather than a verdict |

Five verdicts, in precedence order:

1. **`integrity_violation`** — an invariant broke. Fix before tuning anything.
2. **`insufficient_data`** — too few cases to judge; keep observing.
3. **`stop`** — not earning its complexity. Switch it off.
4. **`iterate`** — working, but a specific number is below target.
5. **`healthy`** — leave it alone.

`stop` being a first-class outcome is the point. Deciding *not* to automate
something is a real result, and a system that can only ever recommend "build
more" is not a measurement system.

---

## "What does success look like" — the same question, answered per UC

Every `UC-0X.md` §11 lists success metrics, and each one falls into exactly
one of three buckets. Naming the bucket matters more than it looks — a
metric with an invented number is worse than one honestly marked as pending
real data, and this project's own evidence discipline (`00-FOUNDATION.md`
§9) applies to metrics exactly as it does to endpoint claims:

1. **Zero-tolerance integrity invariants** — already correctly numeric and
   need no real business data to define, because the number is dictated by
   the architecture itself, not by demand: zero over-disclosure incidents,
   zero post-cutoff submissions, zero money-scaling errors, zero autonomous
   executions on 07/08, zero disbursements under single approval on 09. Any
   UC listing one of these already has a real answer to "what does success
   look like" for that line.
2. **Rate-based metrics the dashboard already thresholds.** `auto-resolution
   rate` (any 🟢-tier UC) and `specialist-accept rate` (anywhere a human
   reviews an AI recommendation) are not vague — `DEFAULT_THRESHOLDS` above
   already fixes what "success" and "stop" mean in numbers (0.50/0.15 and
   0.60/0.30 respectively). A UC's own §11 restating these as "target: high"
   instead of citing the real thresholds was a documentation gap, not a
   missing decision — the number already existed one file away from where a
   reader would look for it.
3. **Baseline-dependent metrics, honestly pending real data.** Median
   handling time and specialist-time-saved need a real manual-handling
   baseline this project doesn't have (see "What this does not do yet"
   below) — inventing one would be worse than leaving it marked pending, per
   this project's standing rule against fabricating business data.

One gap didn't fit any of the three buckets cleanly: **"specialist-rated
dossier/escalation-package usefulness"** (UC-04's escalation precision,
UC-07's dossier completeness, UC-08's dossier usefulness) had no defined
pass/fail number at all — not a data problem, just an undecided scale.

> **[AMENDED 2026-08-21] For UC-07 it WAS a data problem as well, and the
> larger of the two.** `uc07_dossiers` has **no status column**, so nothing
> anywhere could record that a dossier had been accepted, reworked, or even read
> — the metric was not merely uncomputed, it was **underivable**. The ninth
> decision pass closed the cause: a specialist now records an outcome on the
> hand-off ticket (`qa/contracts/UC-07-acceptance.md` §17, DRIFT-073, `R-24`),
> which is what makes an accept rate possible at all. **Decided, not yet built.**
> ~~The same is true of UC-08 and is undecided (`H4`).~~
>
> **[UC-08 DECIDED 2026-08-21 — same cause, same remedy, plus one line that must
> not be crossed.]** `uc08_dossiers` likewise has no status column, and adding one
> would breach the guarantee that **is** this use case's headline artifact: no
> POST route, no mutation method, `verbs: []`. So §11's `≥60%` / `<30%` dossier
> accept rate is not merely uncomputed — **its measurement instrument would break
> the thing being measured.** Issue #20 frames that as backlog, which hides it.
>
> Three things replace it, and none touches `uc08_dossiers`:
> **(a)** the outcome verbs on the hand-off ticket — `proceeding_offline` /
> `not_proceeding` is a specialist who used the dossier, `more_information_needed`
> is one who could not — plus Zendesk reopen rate and escalation → first
> specialist comment; **(b)** **completeness rather than reception**, which is free
> today: the distribution of `openQuestions` codes and priorities is already
> computed on every read, and the top code is directly the next thing to go and
> source; **(c)** restating the thresholds against quantities that can actually be
> produced, because a threshold nobody can compute teaches its reader that this
> whole section is decorative.
>
> **What must not happen is adding a status column to make the metric
> computable.** That trades the strongest safety argument in the system for a
> number. `qa/contracts/UC-08-acceptance.md` §17 (DRIFT-067), `T-16`/`T-17`/`T-28`.
> **Decided, not yet built.** Note also that `H4` — which this line pointed at —
> was about **intake**, not metrics; it is now answered (NO) for a different
> reason, and the metric question was DRIFT-067 all along.
Resolved by reusing bucket 2's shape rather than inventing a fourth kind of
metric: a specialist marks the package **accepted as-is** or **needed
substantial rework**, scored with the same `minAcceptRate`/`stopAcceptRate`
thresholds already used for HITL approval. One metric shape, two uses, not
new infrastructure. **Specified, not yet computed by `compute.js`** —
tracking issue #20.

---

## Where the rows come from

`src/metrics/source.js` is the only file that knows about storage.

- **Live**: when `SUPABASE_DB_URL` is set, reads the `cases` and `review_queue`
  tables. `--days N` limits the window. Review rows are joined through their
  parent case rather than filtered on their own timestamp, because a case
  created inside the window can be reviewed after it.
- **Offline**: with nothing configured, `src/metrics/seed.js` runs ~120
  synthetic tickets through **the real workflow** — real classifier, real
  identity check, real policy gates, against the mock Remote server.

That second path matters: the seeded dashboard is not a fixture. Change a gate
in `policyEngine.js` and these numbers move. A hand-written fixture would not,
and would quietly start lying the first time the logic changed.

The one genuinely synthetic input in the *seeded* dashboard is **specialist
approve/reject** — 120 simulated tickets have no human attached, so acceptance
is simulated and labelled as such in `seed.js`. Handling times are likewise
stretched to a plausible spread, since in-memory rows are otherwise created
milliseconds apart.

Note the scope of that caveat: it applies to the seeded demo dashboard only.
When the dashboard reads live Supabase rows, the acceptance figures are real
specialist decisions made in the sidebar — every one of them attributable to a
named approver in `audit_log`.

Reads throw on failure, unlike the app's background writes which swallow errors.
A dashboard that silently renders partial data is worse than one that refuses to
render: a wrong number gets acted on, a missing one gets investigated.

---

## Design notes on the dashboard

`demo/metrics.html` is one self-contained file — no server, no build, no network.

The palette is validated, not chosen by eye (`scripts/validate_palette.js` from
the dataviz method, all-pairs, both modes). Three consequences are load-bearing:

- Decision colours are assigned **by decision in fixed order**, never by rank, so
  filtering a use case out never repaints the survivors.
- Light-mode aqua sits below 3:1 against the surface, so every segment carries a
  visible count label **and** the page ships a full table view. Identity is
  never colour alone.
- Verdicts use a **reserved status palette** with an icon and a word, so a
  status colour never impersonates a data series.

The LLM-spend stat tile and the verdict table's two cost columns are plain
tabular-numeral text, like every other stat tile and column already on the
page — no new hue was introduced, so the existing palette validation still
covers the whole page without re-running it.

### Re-validated when the page moved onto the shared design system

The page now inlines `src/shared/ui/remote-ui.css` (see `dashboard.js`'s
`SHARED_CSS`) so it matches the other five browser surfaces, which changed the
**surface colour** the series sit on: `#fcfcfb` → `#ffffff` in light,
`#1a1a19` → `#16191f` in dark.

That is exactly the kind of change it would be easy to wave through as
cosmetic. It is not: **contrast is a property of a colour against its
background**, so moving the background re-opens a check that had already
passed. The validator was re-run for both modes against the new surfaces
rather than assumed still valid:

| Check | Light (`#ffffff`) | Dark (`#16191f`) |
|---|---|---|
| Lightness band | pass | pass |
| Chroma floor | pass | pass |
| CVD separation (worst adjacent) | pass — ΔE 9.2 deutan | pass — ΔE 9.4 deutan |
| Normal-vision floor | pass — ΔE 27.6 | pass — ΔE 26.5 |
| Contrast vs surface | **warn** — aqua 2.82:1 | pass — all ≥ 3:1 |

The light-mode warning is the same one the third bullet above already
describes, and the same relief already answers it: every segment carries a
visible count label and the page ships a full table view. **The relief is not
decoration — it is the thing that makes the palette legal**, so neither the
labels nor the table may be removed as "redundant" without re-opening this.

The series hues themselves were not changed, and must not be: they are shared
with the unified dashboard's tables and the ZAF sidebar's badges, so
"orange = human review" survives the trip from a chart to a ticket.

---

## What this does not do yet

- **No baseline comparison.** "Median handling time 4.8s" is only half a
  sentence without "vs. 20 minutes manually". That baseline has to come from
  real CX data, and inventing one would be worse than leaving the gap visible.
- ~~No cost model.~~ **Done, with one live caveat added 2026-08-29: the
  DEPLOYED model (`gpt-5-nano`) has no rate on record, so today's production
  spend reports as `unpriced` rather than as a dollar figure.** See "Estimated
  LLM spend (the cost model)" above. `computeLlmCost()` prices every trace row
  that carries real OpenAI token usage against a documented `gpt-4o-mini` rate
  card, and the report
  carries it at the total/per-tier/per-use-case level plus a dashboard tile
  and two table columns. What's still true: the *seeded* offline run
  (`npm run metrics` with no `SUPABASE_DB_URL`) always shows $0, because
  `seed.js` deliberately drives the rule-based classifier, not the LLM path —
  a live run (`npm run live`, or the n8n workflow) is what produces trace rows
  with real usage to price.
- **The live path does not read `audit_trace` yet.** `src/metrics/source.js`
  loads `cases` and `review_queue` but not the per-attempt trace table, so a
  live dashboard passes an empty trace set to the duplicate-call check (which
  then correctly reports zero). The seeded run wires the check through the
  audit logger's real entries and the fixture tests exercise it directly;
  reading `audit_trace` from Postgres is a build task, not a logic gap.
- **No time series.** Everything is a point-in-time snapshot; there is no
  week-over-week trend, which is what you would actually watch in production.
- **No redundant/duplicate-call check.** Found missing during a review of an
  external "production AI" framework (`docs/research/
  production-ai-playbook-sandipan-bhaumik.md`, tracking issue #18) — nothing
  today flags a case that called the same Remote/LLM endpoint more times than
  its decision required. This needs `00-FOUNDATION.md` §4 invariant 7's
  per-step trace entries to exist first — the current one-row-per-case
  `audit_log` design can't answer "how many times was this endpoint called
  during this one request," only "what was the final outcome." Once trace
  entries exist, this becomes a third safety-invariant-style check alongside
  `flagged_auto_resolution`/`auto_resolution_on_high_tier`, and a related,
  cheaper check is buildable sooner: an idempotency check across `cases` for
  the same `externalRef`/`employmentId` created twice in a short window,
  which needs no new tracing at all.
- **No faithfulness check on LLM-authored prose.** UC-06's `draftSummary()`
  and UC-08's dossier narrative are the two places an LLM drafts
  customer/specialist-facing text from already-decided facts; nothing scores
  whether that text stays faithful to those facts. The planned fix is a
  scoped judge (`narrative-judge`, `00-FOUNDATION.md` §6) checking only these
  two outputs against their structured inputs — deliberately not a general
  accuracy benchmark, since that would need real historical support data
  this project doesn't have and won't invent.
