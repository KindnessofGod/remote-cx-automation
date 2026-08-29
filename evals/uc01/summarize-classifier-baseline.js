import fs from "node:fs";

// ---------------------------------------------------------------------------
// Load frozen Baseline V1
// ---------------------------------------------------------------------------

const reportPath = new URL(
  "./reports/classifier-baseline-v1.json",
  import.meta.url
);

const results = JSON.parse(
  fs.readFileSync(reportPath, "utf8")
);

if (!Array.isArray(results) || results.length === 0) {
  throw new Error(
    "Baseline report is empty or invalid."
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function findGrade(result, name) {
  return result.grades?.find(
    (grade) => grade.name === name
  );
}

function gradeScore(result, name) {
  return findGrade(result, name)?.score;
}

function isCaseCorrect(result) {
  return gradeScore(
    result,
    "case_exact_match"
  ) === 1;
}

// ---------------------------------------------------------------------------
// Aggregate annotation metrics
// ---------------------------------------------------------------------------

const metricScores = new Map();

for (const result of results) {
  for (const grade of result.grades ?? []) {
    if (!metricScores.has(grade.name)) {
      metricScores.set(
        grade.name,
        []
      );
    }

    metricScores
      .get(grade.name)
      .push(grade.score);
  }
}

console.log();
console.log("======================================================");
console.log("UC-01 CLASSIFIER — BASELINE V1");
console.log("======================================================");
console.log();

console.log(`Cases: ${results.length}`);
console.log();

console.log("CORE METRICS");
console.log("------------------------------------------------------");

for (const [name, scores] of metricScores) {
  const passed = scores.reduce(
    (sum, score) => sum + score,
    0
  );

  const rate =
    passed / scores.length;

  console.log(
    `${name.padEnd(26)} ${String(passed).padStart(2)}/${String(scores.length).padEnd(2)}  ${percent(rate)}`
  );
}

// ---------------------------------------------------------------------------
// Execution paths
// ---------------------------------------------------------------------------

const llmCases =
  results.filter(
    (result) =>
      result.actual?.source === "llm"
  );

const fallbackCases =
  results.filter(
    (result) =>
      result.actual?.source ===
      "rule_based_fallback"
  );

console.log();
console.log("EXECUTION PATH");
console.log("------------------------------------------------------");

console.log(
  `LLM path:       ${llmCases.length}/${results.length}`
);

console.log(
  `Fallback path:  ${fallbackCases.length}/${results.length}`
);

// ---------------------------------------------------------------------------
// Exact-match failures
// ---------------------------------------------------------------------------

const failedCases =
  results.filter(
    (result) => !isCaseCorrect(result)
  );

console.log();
console.log("CASE EXACT-MATCH FAILURES");
console.log("------------------------------------------------------");

console.log(
  `Failed cases: ${failedCases.length}/${results.length}`
);

if (failedCases.length === 0) {
  console.log(
    "No exact-match failures."
  );
}

for (const result of failedCases) {
  const failedDimensions =
    (result.grades ?? [])
      .filter(
        (grade) =>
          grade.score === 0 &&
          grade.name !== "llm_path"
      )
      .map(
        (grade) => grade.name
      );

  console.log();
  console.log(
    `${result.id} — ${result.category}`
  );

  console.log(
    `Confidence: ${result.actual?.confidence}`
  );

  console.log(
    `Source: ${result.actual?.source}`
  );

  console.log(
    `Failed dimensions: ${failedDimensions.join(", ")}`
  );

  console.log(
    "Expected:"
  );

  console.log(
    JSON.stringify(
      result.expected,
      null,
      2
    )
  );

  console.log(
    "Actual:"
  );

  console.log(
    JSON.stringify(
      result.actual,
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------
// High-confidence wrong answers
// ---------------------------------------------------------------------------

const HIGH_CONFIDENCE_THRESHOLD =
  0.85;

const highConfidenceWrong =
  failedCases.filter(
    (result) =>
      typeof result.actual?.confidence ===
        "number" &&
      result.actual.confidence >=
        HIGH_CONFIDENCE_THRESHOLD
  );

console.log();
console.log("HIGH-CONFIDENCE WRONG CASES");
console.log("------------------------------------------------------");

console.log(
  `Threshold: >= ${HIGH_CONFIDENCE_THRESHOLD}`
);

console.log(
  `Count: ${highConfidenceWrong.length}`
);

for (const result of highConfidenceWrong) {
  console.log(
    `${result.id} — ${result.category} — confidence=${result.actual.confidence}`
  );
}

// ---------------------------------------------------------------------------
// Performance by dataset category
// ---------------------------------------------------------------------------

const categories = new Map();

for (const result of results) {
  if (!categories.has(result.category)) {
    categories.set(
      result.category,
      {
        total: 0,
        exactMatches: 0,
      }
    );
  }

  const stats =
    categories.get(result.category);

  stats.total += 1;

  if (isCaseCorrect(result)) {
    stats.exactMatches += 1;
  }
}

console.log();
console.log("CASE EXACT MATCH BY CATEGORY");
console.log("------------------------------------------------------");

for (const [category, stats] of categories) {
  console.log(
    `${category.padEnd(28)} ${stats.exactMatches}/${stats.total}  ${percent(
      stats.exactMatches /
        stats.total
    )}`
  );
}

// ---------------------------------------------------------------------------
// Confidence buckets
// ---------------------------------------------------------------------------

const confidenceBuckets = [
  {
    name: "< 0.70",
    test: (value) =>
      value < 0.7,
  },

  {
    name: "0.70–0.84",
    test: (value) =>
      value >= 0.7 &&
      value < 0.85,
  },

  {
    name: ">= 0.85",
    test: (value) =>
      value >= 0.85,
  },
];

console.log();
console.log("CONFIDENCE VS CORRECTNESS");
console.log("------------------------------------------------------");

for (const bucket of confidenceBuckets) {
  const bucketCases =
    results.filter(
      (result) =>
        typeof result.actual?.confidence ===
          "number" &&
        bucket.test(
          result.actual.confidence
        )
    );

  if (bucketCases.length === 0) {
    console.log(
      `${bucket.name.padEnd(12)} no cases`
    );

    continue;
  }

  const correct =
    bucketCases.filter(
      isCaseCorrect
    ).length;

  console.log(
    `${bucket.name.padEnd(12)} ${correct}/${bucketCases.length} correct  ${percent(
      correct /
        bucketCases.length
    )}`
  );
}

// ---------------------------------------------------------------------------
// Safety summary
// ---------------------------------------------------------------------------

const salaryGrades =
  results
    .map(
      (result) =>
        ({
          result,
          grade: findGrade(
            result,
            "salary_recall_case"
          ),
        })
    )
    .filter(
      ({ grade }) =>
        grade !== undefined
    );

console.log();
console.log("SAFETY — SALARY DETECTION");
console.log("------------------------------------------------------");

if (salaryGrades.length === 0) {
  console.log(
    "No golden salary cases were found."
  );
} else {
  const caught =
    salaryGrades.reduce(
      (sum, { grade }) =>
        sum + grade.score,
      0
    );

  console.log(
    `Salary cases detected: ${caught}/${salaryGrades.length}`
  );

  console.log(
    `Salary recall: ${percent(
      caught /
        salaryGrades.length
    )}`
  );

  const missed =
    salaryGrades.filter(
      ({ grade }) =>
        grade.score === 0
    );

  if (missed.length > 0) {
    console.log();

    console.log(
      "MISSED SALARY CASES:"
    );

    for (const { result } of missed) {
      console.log(
        `${result.id} — ${result.category}`
      );
    }
  }
}

console.log();
console.log("======================================================");
console.log("END BASELINE V1 ANALYSIS");
console.log("======================================================");
console.log();