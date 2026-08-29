import "dotenv/config";

import fs from "node:fs";

import {
  gradeClassifier,
} from "./evaluators/classifier-evaluator.js";

// ---------------------------------------------------------------------------
// Phoenix configuration
// ---------------------------------------------------------------------------

const phoenixBaseUrl =
  process.env.PHOENIX_COLLECTOR_ENDPOINT?.replace(
    /\/$/,
    ""
  );

const phoenixApiKey =
  process.env.PHOENIX_API_KEY;

if (!phoenixBaseUrl || !phoenixApiKey) {
  throw new Error(
    "Phoenix configuration is missing."
  );
}

// ---------------------------------------------------------------------------
// Load the frozen Prompt V1 baseline
// ---------------------------------------------------------------------------
//
// IMPORTANT:
//
// This script does NOT call:
// - OpenAI
// - classifyRequest()
// - tracer.startActiveSpan()
//
// We are grading the outputs that already exist.
// ---------------------------------------------------------------------------

const baselinePath = new URL(
  "./reports/classifier-baseline-v1.json",
  import.meta.url
);

const results = JSON.parse(
  fs.readFileSync(
    baselinePath,
    "utf8"
  )
);

if (!Array.isArray(results)) {
  throw new Error(
    "classifier-baseline-v1.json is not a valid result array."
  );
}

console.log(
  `Loaded ${results.length} existing Prompt V1 results.`
);

// ---------------------------------------------------------------------------
// Recalculate grades using the corrected evaluator
// ---------------------------------------------------------------------------

const annotations = [];

for (const result of results) {
  if (!result.spanId) {
    throw new Error(
      `Missing spanId for ${result.id}`
    );
  }

  const correctedGrades =
    gradeClassifier(
      result.expected,
      result.actual,
      result.input
    );

  // Replace the incorrect locally stored grades.
  result.grades =
    correctedGrades;

  for (const grade of correctedGrades) {
    annotations.push({
      span_id:
        result.spanId,

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
          result.id,

        category:
          result.category,

        dataset:
          "uc01-classifier-golden",

        evaluator_version:
          "v1.1-attachment-source-fix",
      },

      // Same evaluator identity means we update the annotations
      // attached to these existing spans.
      identifier:
        "uc01-classifier-evaluator-v1",
    });
  }
}

// ---------------------------------------------------------------------------
// Save corrected local baseline
// ---------------------------------------------------------------------------

fs.writeFileSync(
  baselinePath,

  JSON.stringify(
    results,
    null,
    2
  )
);

// Keep the current/latest report aligned with the corrected baseline too.

const latestPath = new URL(
  "./reports/classifier-raw-results.json",
  import.meta.url
);

fs.writeFileSync(
  latestPath,

  JSON.stringify(
    results,
    null,
    2
  )
);

console.log(
  "Local Prompt V1 grades recalculated."
);

// ---------------------------------------------------------------------------
// Phoenix helpers
// ---------------------------------------------------------------------------

function sleep(milliseconds) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

async function sendWithRetry() {
  const retryDelays = [
    0,
    1000,
    2000,
    4000,
    8000,
  ];

  for (
    let attempt = 0;
    attempt < retryDelays.length;
    attempt++
  ) {
    const delay =
      retryDelays[attempt];

    if (delay > 0) {
      console.log(
        `Waiting ${delay / 1000}s before retry...`
      );

      await sleep(delay);
    }

    console.log(
      `Phoenix annotation attempt ${attempt + 1}/${retryDelays.length}...`
    );

    const response =
      await fetch(
        `${phoenixBaseUrl}/v1/span_annotations?sync=true`,
        {
          method: "POST",

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

    if (response.ok) {
      console.log(
        `SUCCESS: ${annotations.length} corrected CODE annotations written to Phoenix.`
      );

      return;
    }

    const body =
      await response.text();

    console.log(
      `Phoenix returned ${response.status}: ${body}`
    );

    const retryable =
      response.status === 404 ||
      response.status === 429 ||
      response.status >= 500;

    if (!retryable) {
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
// Push corrected grades onto EXISTING Phoenix traces
// ---------------------------------------------------------------------------

console.log(
  `Preparing ${annotations.length} corrected annotations.`
);

console.log(
  "OpenAI calls: 0"
);

console.log(
  "New traces: 0"
);

await sendWithRetry();

console.log();
console.log(
  "Prompt V1 baseline successfully regraded."
);