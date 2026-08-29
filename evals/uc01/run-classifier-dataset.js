import fs from "node:fs";

import {
  trace,
  SpanStatusCode,
} from "@opentelemetry/api";

import {
  provider,
} from "./instrumentation.js";

import {
  gradeClassifier,
} from "./evaluators/classifier-evaluator.js";

// ---------------------------------------------------------------------------
// Load the UC-01 Classifier V2.2
// ---------------------------------------------------------------------------
//
// instrumentation.js has already registered OpenTelemetry/OpenInference before
// classifier.js loads.
//
// This means the OpenAI call made inside classifyRequest() becomes a child LLM
// span beneath the root evaluation CHAIN span created in this runner.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WHICH MODEL IS BEING EVALUATED — chosen here, recorded in the report
// ---------------------------------------------------------------------------
//
// This runner never named a model, and neither did any report it wrote. It
// inherits whatever `src/shared/config.js` resolves — `OPENAI_MODEL`, falling
// back to gpt-4o-mini — so "48/48" was an unattributed number: nothing in
// evals/uc01/reports/ says which model produced it.
//
// That stopped being harmless on 2026-08-29, when the live deployment's own
// /__cx/health was read back reporting `"model": "gpt-5-nano"` while the repo
// default and .env.example both still read gpt-4o-mini. So the frozen 48-case
// suite has never been run against the classifier the deployment actually
// runs, and no artifact in this directory could have revealed that.
//
// Two changes, both small:
//   1. `EVAL_OPENAI_MODEL` points a run at a specific model without editing
//      `.env` — set BEFORE classifier.js is imported, because config.js reads
//      the environment once at module load. That is why this block sits above
//      the dynamic import rather than beside the other constants.
//   2. The resolved model is read back off `config` — not restated from the
//      same default — and written into the report and both terminal summaries.
//      Restating it is how the two silently disagree; the value recorded is
//      the value the classifier will use, by construction.
//
// The model the API ANSWERS with (a dated snapshot) can still differ from the
// one requested. That one is only observable per call, and this runner does
// not read it; `requestedModel` is what this field claims to be.
// ---------------------------------------------------------------------------

if (
  process.env
    .EVAL_OPENAI_MODEL
) {
  process.env.OPENAI_MODEL =
    process.env
      .EVAL_OPENAI_MODEL;
}

const {
  config,
} = await import(
  "../../src/shared/config.js"
);

const REQUESTED_MODEL =
  config.openai.model;

const MODEL_SOURCE =
  process.env
    .EVAL_OPENAI_MODEL
    ? "EVAL_OPENAI_MODEL"
    : process.env
        .OPENAI_MODEL
      ? "OPENAI_MODEL"
      : "src/shared/config.js default";

const {
  classifyRequest,
} = await import(
  "../../src/uc01/classifier.js"
);

const tracer =
  trace.getTracer(
    "remote-cx-uc01-classifier-v2.2-evals"
  );

// ---------------------------------------------------------------------------
// V2.2 evaluation identity
// ---------------------------------------------------------------------------
//
// IMPORTANT:
//
// The classifier/prompt changed from the previous experiment.
//
// Therefore this run gets a NEW experiment version so Phoenix can distinguish:
//
//   classifier-v2   -> previous V2/V2.1 experiment history
//   classifier-v2.2 -> current corrected classifier experiment
//
// The dataset and deterministic evaluator have NOT changed, so their identities
// remain the same.
//
// This gives us a controlled comparison:
// same golden examples + same grader + changed classifier/prompt.
// ---------------------------------------------------------------------------

const DATASET_NAME =
  "uc01-classifier-golden-v2-remote-aligned";

const EVALUATOR_IDENTIFIER =
  "uc01-classifier-evaluator-v2";

const EVALUATOR_VERSION =
  "v2-remote-aligned";

const EXPERIMENT_VERSION =
  "classifier-v2.2";

// ---------------------------------------------------------------------------
// Phoenix configuration
// ---------------------------------------------------------------------------

const phoenixBaseUrl =
  process.env
    .PHOENIX_COLLECTOR_ENDPOINT
    ?.replace(
      /\/$/,
      ""
    );

const phoenixApiKey =
  process.env.PHOENIX_API_KEY;

if (
  !phoenixBaseUrl ||
  !phoenixApiKey
) {
  throw new Error(
    "Phoenix configuration is missing."
  );
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

// ---------------------------------------------------------------------------
// Send deterministic annotations to Phoenix
// ---------------------------------------------------------------------------
//
// IMPORTANT:
//
// provider.shutdown() flushes OpenTelemetry, but Phoenix Cloud can still need
// a moment to index the newly-created spans.
//
// We already observed:
//
// trace exported
//      ↓
// annotation POST arrives
//      ↓
// Phoenix temporarily returns 404
//
// So annotation writes retry on:
//
//   404
//   429
//   5xx
//
// This retry NEVER reruns OpenAI.
// ---------------------------------------------------------------------------

async function sendAnnotationsToPhoenixWithRetry(
  annotations
) {
  if (
    annotations.length === 0
  ) {
    return;
  }

  const retryDelays = [
    0,
    1000,
    2000,
    4000,
    8000,
  ];

  for (
    let attempt = 0;
    attempt <
    retryDelays.length;
    attempt++
  ) {
    const delay =
      retryDelays[
        attempt
      ];

    if (
      delay > 0
    ) {
      console.log(
        `Phoenix not ready yet. Waiting ${delay / 1000}s before retry...`
      );

      await sleep(
        delay
      );
    }

    console.log(
      `Phoenix annotation attempt ${attempt + 1}/${retryDelays.length}...`
    );

    const response =
      await fetch(
        `${phoenixBaseUrl}/v1/span_annotations?sync=true`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            api_key:
              phoenixApiKey,

            Authorization:
              `Bearer ${phoenixApiKey}`,
          },

          body:
            JSON.stringify({
              data:
                annotations,
            }),
        }
      );

    if (
      response.ok
    ) {
      console.log(
        `SUCCESS: ${annotations.length} CODE annotations written to Phoenix.`
      );

      return;
    }

    const body =
      await response.text();

    console.log(
      `Phoenix returned ${response.status}: ${body}`
    );

    const retryable =
      response.status ===
        404 ||
      response.status ===
        429 ||
      response.status >=
        500;

    if (
      !retryable
    ) {
      throw new Error(
        `Phoenix annotation failed permanently: ${response.status} ${body}`
      );
    }
  }

  throw new Error(
    "Phoenix annotations could not be written after all retry attempts."
  );
}

// ---------------------------------------------------------------------------
// Load Remote-aligned Golden Dataset V2
// ---------------------------------------------------------------------------

const datasetPath =
  new URL(
    "./datasets/classifier-golden-v2.jsonl",
    import.meta.url
  );

if (
  !fs.existsSync(
    datasetPath
  )
) {
  throw new Error(
    `Golden V2 dataset not found at ${datasetPath.pathname}`
  );
}

const rows =
  fs
    .readFileSync(
      datasetPath,
      "utf8"
    )
    .split("\n")
    .map(
      (line) =>
        line.trim()
    )
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(
          line
        )
    );

// ---------------------------------------------------------------------------
// Smoke mode vs full run
// ---------------------------------------------------------------------------
//
// Usage:
//
//   node evals/uc01/run-classifier-dataset.js cls2-021
//
// runs ONE case.
//
// Running without a case id:
//
//   node evals/uc01/run-classifier-dataset.js
//
// runs ALL 48 cases.
//
// Smoke tests let us validate focused boundaries before spending money on the
// entire golden dataset.
// ---------------------------------------------------------------------------

const requestedCaseId =
  process.argv[2] ??
  null;

let rowsToRun;

if (
  requestedCaseId
) {
  const selected =
    rows.find(
      (row) =>
        row.id ===
        requestedCaseId
    );

  if (!selected) {
    throw new Error(
      `Unknown case id "${requestedCaseId}".`
    );
  }

  rowsToRun = [
    selected,
  ];
} else {
  rowsToRun =
    rows;
}

const runMode =
  requestedCaseId
    ? "SMOKE"
    : "FULL";

console.log();

console.log(
  "=============================================="
);

console.log(
  "UC-01 CLASSIFIER V2.2 — REMOTE-ALIGNED EVAL"
);

console.log(
  "=============================================="
);

console.log(
  `Mode: ${runMode}`
);

console.log(
  `Experiment: ${EXPERIMENT_VERSION}`
);

console.log(
  `Model: ${REQUESTED_MODEL} (from ${MODEL_SOURCE})`
);

console.log(
  `Dataset: ${DATASET_NAME}`
);

console.log(
  `Cases available: ${rows.length}`
);

console.log(
  `Cases to run: ${rowsToRun.length}`
);

if (
  requestedCaseId
) {
  console.log(
    `Selected case: ${requestedCaseId}`
  );
}

console.log();

// ---------------------------------------------------------------------------
// Evaluation evidence
// ---------------------------------------------------------------------------

const results =
  [];

const pendingAnnotations =
  [];

// ---------------------------------------------------------------------------
// Run dataset
// ---------------------------------------------------------------------------

for (
  const row of
  rowsToRun
) {
  console.log(
    `Running ${row.id} — ${row.category}`
  );

  let rootSpanId =
    null;

  let grades =
    [];

  const actual =
    await tracer.startActiveSpan(
      `UC01 V2.2 Eval ${row.id} | ${row.category}`,

      {
        attributes: {
          // ---------------------------------------------------------------
          // OpenInference root span
          // ---------------------------------------------------------------

          "openinference.span.kind":
            "CHAIN",

          // ---------------------------------------------------------------
          // Evaluation identity
          // ---------------------------------------------------------------

          "eval.version":
            EXPERIMENT_VERSION,

          "eval.stage":
            "classifier",

          "eval.dataset":
            DATASET_NAME,

          "eval.case_id":
            row.id,

          "eval.category":
            row.category,

          // ---------------------------------------------------------------
          // Documentation provenance
          // ---------------------------------------------------------------

          "eval.grounding":
            row.grounding ??
            "unknown",

          "eval.source_keys":
            JSON.stringify(
              row.sourceKeys ??
              []
            ),

          "eval.rationale":
            row.rationale ??
            "",

          // ---------------------------------------------------------------
          // Exact classifier INPUT
          // ---------------------------------------------------------------

          "eval.input.text":
            row.input.text,

          "eval.input.has_attachment":
            row.input
              .hasAttachment ===
            true,

          // These OpenInference-style input fields make the ROOT span much
          // easier to read directly in Phoenix.

          "input.value":
            JSON.stringify(
              row.input
            ),

          "input.mime_type":
            "application/json",

          // ---------------------------------------------------------------
          // Human-labelled expected answer
          // ---------------------------------------------------------------

          "eval.expected.intent":
            row.expected
              .intent,

          "eval.expected.requester_type":
            row.expected
              .requesterType,

          // Attachment truth comes from INPUT METADATA.
          //
          // It intentionally does NOT come from row.expected because the
          // golden dataset does not pretend attachment is an LLM prediction.

          "eval.expected.has_attachment":
            row.input
              .hasAttachment ===
            true,

          "eval.expected.has_external_url":
            row.expected
              .hasExternalUrl ===
            true,

          "eval.expected.requested_fields":
            JSON.stringify(
              row.expected
                .requestedFields ??
              []
            ),
        },
      },

      async (
        span
      ) => {
        rootSpanId =
          span
            .spanContext()
            .spanId;

        try {
          // -------------------------------------------------------------
          // THE CLASSIFIER TAKES THE EXAM
          // -------------------------------------------------------------
          //
          // ONLY row.input goes into the classifier.
          //
          // row.expected, grounding, rationale and sourceKeys remain hidden.
          // -------------------------------------------------------------

          const result =
            await classifyRequest(
              row.input
            );

          // -------------------------------------------------------------
          // Record actual structured output on root span
          // -------------------------------------------------------------

          span.setAttributes({
            "eval.actual.intent":
              result.intent,

            "eval.actual.requester_type":
              result
                .requesterType,

            "eval.actual.has_attachment":
              result
                .hasAttachment ===
              true,

            "eval.actual.has_external_url":
              result
                .hasExternalUrl ===
              true,

            "eval.actual.confidence":
              result
                .confidence,

            "eval.actual.source":
              result.source,

            "eval.actual.requested_fields":
              JSON.stringify(
                result
                  .requestedFields ??
                []
              ),

            // Makes the root span's output visible in Phoenix's normal
            // Input / Output area.

            "output.value":
              JSON.stringify(
                result
              ),

            "output.mime_type":
              "application/json",
          });

          // -------------------------------------------------------------
          // DETERMINISTIC GRADING
          // -------------------------------------------------------------
          //
          // expected = teacher answer
          // actual   = classifier output
          // input    = source of truth for attachment metadata
          //
          // NO evaluator LLM is used here.
          // -------------------------------------------------------------

          grades =
            gradeClassifier(
              row.expected,
              result,
              row.input
            );

          span.setStatus({
            code:
              SpanStatusCode.OK,
          });

          return result;
        } catch (
          error
        ) {
          span.recordException(
            error
          );

          span.setStatus({
            code:
              SpanStatusCode.ERROR,

            message:
              error.message,
          });

          throw error;
        } finally {
          span.end();
        }
      }
    );

  // -----------------------------------------------------------------------
  // Prepare Phoenix annotations
  // -----------------------------------------------------------------------

  for (
    const grade of
    grades
  ) {
    pendingAnnotations.push({
      span_id:
        rootSpanId,

      name:
        grade.name,

      annotator_kind:
        "CODE",

      result: {
        label:
          grade.label,

        score:
          grade.score,

        explanation:
          grade.explanation,
      },

      metadata: {
        case_id:
          row.id,

        category:
          row.category,

        dataset:
          DATASET_NAME,

        evaluator_version:
          EVALUATOR_VERSION,

        experiment_version:
          EXPERIMENT_VERSION,

        grounding:
          row.grounding ??
          "unknown",

        source_keys:
          row.sourceKeys ??
          [],
      },

      identifier:
        EVALUATOR_IDENTIFIER,
    });
  }

  // -----------------------------------------------------------------------
  // Save complete local evidence
  // -----------------------------------------------------------------------

  results.push({
    id:
      row.id,

    category:
      row.category,

    grounding:
      row.grounding ??
      null,

    sourceKeys:
      row.sourceKeys ??
      [],

    rationale:
      row.rationale ??
      null,

    input:
      row.input,

    expected:
      row.expected,

    actual,

    grades,

    spanId:
      rootSpanId,
  });

  // -----------------------------------------------------------------------
  // Human-readable terminal output
  // -----------------------------------------------------------------------

  console.log(
    "Expected:"
  );

  console.log(
    JSON.stringify(
      row.expected,
      null,
      2
    )
  );

  console.log(
    "Actual:"
  );

  console.log(
    JSON.stringify(
      actual,
      null,
      2
    )
  );

  console.log(
    "Grades:"
  );

  console.log(
    JSON.stringify(
      grades,
      null,
      2
    )
  );

  console.log();
}

// ---------------------------------------------------------------------------
// Local summary
// ---------------------------------------------------------------------------

const exactMatchResults =
  results.map(
    (
      result
    ) =>
      result.grades.find(
        (
          grade
        ) =>
          grade.name ===
          "case_exact_match"
      )
  );

const exactPasses =
  exactMatchResults.filter(
    (
      grade
    ) =>
      grade?.score ===
      1
  ).length;

const exactFailures =
  exactMatchResults.filter(
    (
      grade
    ) =>
      grade?.score ===
      0
  ).length;

const exactMatchRate =
  results.length > 0
    ? exactPasses /
      results.length
    : 0;

// ---------------------------------------------------------------------------
// Save V2.2 report
// ---------------------------------------------------------------------------
//
// V2/V2.1 reports remain untouched.
//
// This deliberately creates new filenames so we preserve experiment history.
// ---------------------------------------------------------------------------

const reportFilename =
  requestedCaseId
    ? `classifier-v2.2-smoke-${requestedCaseId}.json`
    : "classifier-v2.2-raw-results.json";

const outputPath =
  new URL(
    `./reports/${reportFilename}`,
    import.meta.url
  );

fs.writeFileSync(
  outputPath,

  JSON.stringify(
    {
      evaluation: {
        version:
          EXPERIMENT_VERSION,

        dataset:
          DATASET_NAME,

        evaluator:
          EVALUATOR_IDENTIFIER,

        evaluatorVersion:
          EVALUATOR_VERSION,

        mode:
          runMode,

        selectedCase:
          requestedCaseId,

        caseCount:
          results.length,

        // The model this run asked for, and where that choice came from. A
        // score with no model beside it cannot be compared against a later
        // one, and cannot be checked against what is deployed.
        requestedModel:
          REQUESTED_MODEL,

        modelSource:
          MODEL_SOURCE,
      },

      summary: {
        exactPasses,

        exactFailures,

        exactMatchRate,
      },

      results,
    },
    null,
    2
  )
);

// ---------------------------------------------------------------------------
// Terminal summary
// ---------------------------------------------------------------------------

console.log(
  "=============================================="
);

console.log(
  "LOCAL V2.2 SUMMARY"
);

console.log(
  "=============================================="
);

console.log(
  `Experiment: ${EXPERIMENT_VERSION}`
);

console.log(
  `Model: ${REQUESTED_MODEL} (from ${MODEL_SOURCE})`
);

console.log(
  `Cases: ${results.length}`
);

console.log(
  `Exact passes: ${exactPasses}`
);

console.log(
  `Exact failures: ${exactFailures}`
);

console.log(
  `Exact-match rate: ${(exactMatchRate * 100).toFixed(1)}%`
);

console.log();

console.log(
  "Local report written to:"
);

console.log(
  outputPath.pathname
);

// ---------------------------------------------------------------------------
// Flush telemetry FIRST
// ---------------------------------------------------------------------------

console.log(
  "\nFlushing V2.2 traces to Phoenix..."
);

await provider.shutdown();

console.log(
  "Trace export completed."
);

// ---------------------------------------------------------------------------
// THEN attach deterministic evaluations
// ---------------------------------------------------------------------------

console.log(
  `\nPreparing to write ${pendingAnnotations.length} V2.2 CODE annotations to Phoenix...`
);

await sendAnnotationsToPhoenixWithRetry(
  pendingAnnotations
);

console.log();

console.log(
  "=============================================="
);

console.log(
  "UC-01 CLASSIFIER V2.2 EVAL COMPLETE"
);

console.log(
  "=============================================="
);

console.log(
  `Mode: ${runMode}`
);

console.log(
  `Experiment: ${EXPERIMENT_VERSION}`
);

console.log(
  `Model: ${REQUESTED_MODEL} (from ${MODEL_SOURCE})`
);

console.log(
  `Cases: ${results.length}`
);

console.log(
  `Exact-match rate: ${(exactMatchRate * 100).toFixed(1)}%`
);

console.log(
  "Phoenix project: Remote_EOR_casestudy"
);

console.log();