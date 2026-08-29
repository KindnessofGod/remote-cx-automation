# UC-01 evaluation — what was measured, and what was not

Two paths interpret an employment-verification request. This directory
evaluates **both**, on the same 48 cases, with the same grader.

```
node evals/uc01/run-fallback-dataset.js      # offline, free, deterministic
node evals/uc01/run-classifier-dataset.js    # calls OpenAI; needs a key
```

## Results

| Path | Runs when | Exact match |
|---|---|---|
| `classifyRequest` — LLM (`classifier-v2`) | normal operation | **47 / 48** (97.9%) |
| `classifyRequest` — LLM (`classifier-v2.2`) | after the fix below | **48 / 48** (100%) |
| `classifyRequestRuleBased` (`fallback-v2.2`) | no API key · 3 failed validations · every hermetic test | **36 / 48** (75.0%) |

**This is regression evidence on a frozen set. It is not a claim of
unseen-world accuracy** — and there is a sharper reason for that than the usual
one, stated here rather than left for a reader to find.

### The 48/48 is a fit, not a measurement

**Eight of the 48 golden inputs appear verbatim inside `SYSTEM_PROMPT`, each
beside its correct label**, and six more match on their opening 45 characters —
29 per cent of the suite. Worse for the headline: **`cls2-045`, the single case
that moved 47/48 to 48/48, is one of the verbatim eight.**

So the boundary fix has a principled half and a special-cased half, and the
special-cased half is not deniable. The principled half is real — V2.2 added a
*general* rule (a list of the information the standard letter already carries,
and a list of verbs like "make sure the letter includes" that do not by
themselves mean customisation), and that generalises to any request asking only
for template contents. But the failing sentence was also pasted in as a worked
example, so the general rule cannot be credited with the fix.

The honest statement is: **47/48 → 48/48 after rewriting the decision boundary,
on a set that includes the failing case as a prompt example. Treat it as a fit.
The measurement is the holdout, and the holdout has not been run.**

### Two more things a hostile reader will find, so they are here first

**Three of the five graded dimensions have never failed, and one of them
cannot.** Across all 144 gradings in the three runs:

| Dimension | pass | fail |
|---|---|---|
| `attachment_correct` | 144 | **0** |
| `external_url_correct` | 144 | **0** |
| `requester_correct` | 144 | **0** |
| `fields_exact_match` | 139 | 5 |
| `intent_correct` | 131 | 13 |

`attachment_correct` is a **tautology**: the prompt never asks the model for
`hasAttachment`, `classifyRequest()` copies it from the input, and the grader
then compares the input against that copy. It cannot fail.
`external_url_correct` has exactly one positive instance in the dataset. So
"48/48 across five dimensions" is in practice **48/48 on intent**, with a fields
sub-score. Worth measuring; not five independent signals.

**Every number here is a single sample from a stochastic decoder.**
`src/shared/llm.js` sets neither `temperature` nor `seed`, so OpenAI's default
of 1.0 applies. One run per condition, and the entire claimed improvement is one
case. A 47→48 delta under those conditions is not distinguishable from
resampling. `coverage-map.md` lists "how consistent is classification across
repeated runs?" as a Stage-1 question, and it has not been answered.

### What IS verifiable by a third party, in about ninety seconds

**The answer key did not move.** The `(input, expected)` pairs embedded in the
v2 report, the v2.2 report, the fallback report and the live dataset are
set-equal. Nothing was relabelled to suit a result.

```
dataset   classifier-golden-v2.jsonl   sha256 8ed2b0db56fc33a4...
evaluator classifier-evaluator.js      sha256 ab08f270ac6582db...
```

Confidence values are not calibrated and are not presented as such.

## The one failure, and why the answer key did not move

`classifier-v2` missed exactly one case — **cls2-045**:

> *"Please make sure the letter includes my start date and whether my contract
> is fixed-term or indefinite."*

The model answered `customized_letter`. The key says `standard_letter`, because
**start date and contract type are already on the standard template.** Asking
for something the standard letter already contains is not a request to
customise it.

The tempting repair is to change the key to match the model. The boundary was
wrong, not the key, so the boundary was rewritten — Classifier V2.2 — and the
frozen set was re-run unchanged. `cls2-045` now returns `standard_letter` and
all 48 pass.

## The gap this suite was built to close

Every one of the 48 LLM result rows carries `source: "llm"`. **Not one
exercised the deterministic fallback** — the path production takes whenever the
model is unconfigured or returns an invalid shape three times, and the path
every hermetic test in the repository runs on.

So the least-measured path was the one that runs when things are already going
wrong. That was not theoretical:

> Classifier V2.2 narrowed the fallback's in-scope test — correctly, so that the
> bare word "bank" no longer implies employment verification — but placed the
> narrowing **ahead of** the attachment and external-URL signals. So
> *"My bank sent this form, please complete it."* with a real attachment was
> answered `out_of_scope`: a decision about a document nobody had opened, taken
> from the covering sentence. Twenty tests in the main suite caught it.
> `run-fallback-dataset.js` would have caught it first, and said by how much.

The fallback now fails closed on an unread artifact, and the suite that proves
it runs offline on every commit.

## What the fallback still gets wrong — stated, not hidden

`fallback-v2.2`, per dimension:

| Dimension | Score |
|---|---|
| `requester_correct` | 48/48 |
| `attachment_correct` | 48/48 |
| `external_url_correct` | 48/48 |
| `fields_exact_match` | 43/48 |
| `intent_correct` | **36/48** |
| `compensation_recall_case` | **3/7** |
| `customized_route_recall_case` | 9/14 |
| `third_party_route_recall_case` | 11/16 |

**`compensation_recall_case` at 3/7 is the one to read twice.** That is the
detector behind `over_scope_request` — the gate that stops compensation being
disclosed. It matches literal words, so it catches *"include my salary"* and
misses *"My lender needs my current pay shown on the letter."*

The consequence is bounded and worth stating precisely: a missed over-scope
detection does **not** disclose salary. UC-01's letter renders from a field
whitelist (`STANDARD_LETTER_FIELDS`), so compensation cannot reach the document
whatever the classifier concluded. What is lost is the **routing** — the request
auto-resolves with a correct letter instead of going to a human who would have
seen what was actually asked for.

That is a real defect and it is not fixed here. It is recorded because a number
nobody has measured is worse than a number that is low and known.

`llm_path` is excluded from the fallback's exact-match score: it asserts the
classification came from the model, which is false for all 48 by construction.
Scoring it would report 0/48 and say nothing.

## Which model was this measured on? (and the one that is deployed)

**Every result in `reports/` was produced without recording the model**, and
that omission is now the most important caveat on this page. The runner
inherits whatever `src/shared/config.js` resolves — `OPENAI_MODEL`, defaulting
to `gpt-4o-mini` — so the 47/48 and the 48/48 are almost certainly gpt-4o-mini
numbers (the repo default and `.env.example` both name it, and nothing else was
ever set for a run), but *"almost certainly"* is the whole problem: no artifact
here says so.

**The live deployment does not run that model.** Read back from
`https://remote-cx-apis.vercel.app/__cx/health` on 2026-08-29, its `llm` block
reports `"model": "gpt-5-nano"` — `OPENAI_MODEL` is set on the Vercel project
and overrides the repo default. So:

> **The classifier this repository has evaluated and the classifier the
> deployment runs are not the same classifier, and no run in `reports/` bears
> on the deployed one.** The frozen 48 measure a model that production stopped
> using.

Nothing here is retracted by that. The dataset, the grader, the boundary
analysis and the "48/48 is a fit, not a measurement" caveat above all still
hold — they are statements about a decision boundary, and they were true of the
model they were run on. What is *not* available is any claim about the model in
front of real requests today.

Both runners now say which model they used:

```
EVAL_OPENAI_MODEL=gpt-5-nano node evals/uc01/run-classifier-dataset.js
```

`EVAL_OPENAI_MODEL` is applied before `classifier.js` loads (config reads the
environment once, at module load), and the resolved value is read back off
`config` rather than restated — so the `requestedModel` / `modelSource` fields
now written into every report are the values the classifier actually used, by
construction, not a second copy that can drift. Both terminal summaries print
them too.

One honest limit on that field: it is the model **requested**. OpenAI answers
with a dated snapshot (`gpt-4o-mini-2024-07-18`), which is what
`src/shared/llm.js`'s `tagUsage()` records per call and what
`src/metrics/compute.js` prices. This runner does not read it back, so
`requestedModel` claims exactly what its name says.

**Re-running against `gpt-5-nano` costs money and has not been done here.** It
is the obvious next step and it is deliberately left as a decision rather than
performed silently: a second frozen number under a different model is a
comparison worth having, and one produced by accident is not.

## Two vocabularies for one field

The frozen prompt teaches `"Please include my salary." -> ["compensation"]` and
the dataset encodes `compensation`. The acceptance contract came first and says
`salary` — VC-09 requires that exact word reach the specialist.

Neither side was renamed. Renaming the prompt or dataset invalidates a measured
result; renaming VC-09 edits an acceptance criterion to suit an implementation.
They are translated in one place, `FIELD_VOCABULARY` in
`src/uc01/policyEngine.js`, on the way into policy.

## Files

```
datasets/classifier-golden-v2.jsonl   48 human-labelled cases. The
                                      `grounding`/`sourceKeys` fields are
                                      internal tokens and no registry resolving
                                      them ships here — treat them as labels,
                                      not provenance. docs/knowledge/ is what
                                      real provenance looks like in this repo
evaluators/classifier-evaluator.js    deterministic graders — no LLM judge
instrumentation.js                    OpenInference -> Phoenix (env-configured)
run-classifier-dataset.js             the LLM path. EVAL_OPENAI_MODEL picks
                                      the model; the run records which one
run-fallback-dataset.js               the deterministic path — offline
reports/                              raw results, span ids, per-dimension
coverage-map.md                       maps the acceptance contract to layers
```

No credential appears anywhere here: the Phoenix project, endpoint and API key
are all read from the environment.

**These two runners need dependencies `npm test` does not.**
`@arizeai/phoenix-otel`, `@arizeai/openinference-instrumentation-openai` and
`@opentelemetry/api` — and the last of those is imported directly by
`run-classifier-dataset.js` and `instrumentation.js` while appearing in no
`dependencies` block, so it resolves only if a transitive hoist supplies it. A
container with the hermetic test deps installed and not these fails at import
with `ERR_MODULE_NOT_FOUND` before any case runs, which is a setup gap and not
an eval failure.
