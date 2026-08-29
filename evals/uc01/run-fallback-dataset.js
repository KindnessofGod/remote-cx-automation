// ---------------------------------------------------------------------------
// run-fallback-dataset.js — grade the DETERMINISTIC FALLBACK on the same
//                           48 cases the LLM was graded on.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The frozen suite reached 48/48 exact match — and every one of those 48 rows
// carries `source: "llm"`. Not one case exercised classifyRequestRuleBased().
//
// That is the path production actually takes whenever OPENAI_API_KEY is unset,
// whenever the model returns a shape that fails validation three times, and in
// every hermetic test in the repository. So the least-evaluated path was the
// one that runs when things are going wrong.
//
// The gap was not theoretical. Classifier V2.2 narrowed the fallback's
// in-scope test and moved it ahead of the attachment and external-URL signals,
// so "My bank sent this form, please complete it." with a real attachment was
// answered `out_of_scope` — a decision about a document nobody had opened.
// Twenty tests in the main suite caught it. This suite would have caught it
// first, and would have said by how much.
//
// Deliberately offline: no API key, no network, no cost, deterministic. It can
// run on every commit, which is the whole argument for having it.
//
//   node evals/uc01/run-fallback-dataset.js
//   node evals/uc01/run-fallback-dataset.js --write   # persist the report
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyRequestRuleBased } from "../../src/uc01/classifier.js";
import { gradeClassifier } from "./evaluators/classifier-evaluator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATASET = join(HERE, "datasets", "classifier-golden-v2.jsonl");
const REPORT = join(HERE, "reports", "fallback-v2.2-raw-results.json");

const rows = readFileSync(DATASET, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const results = rows.map((row) => {
  // The fallback takes exactly what production hands it, and nothing else.
  // hasExternalUrl is NOT passed in: the fallback derives it from the text,
  // and passing the answer in would grade the harness instead of the code.
  const actual = classifyRequestRuleBased({
    text: row.input.text,
    hasAttachment: row.input.hasAttachment === true,
  });
  const grades = gradeClassifier(row.expected, actual, row.input);
  return { id: row.id, category: row.category, input: row.input, expected: row.expected, actual, grades };
});

// `llm_path` asserts the classification came from the model. On this path it is
// false for all 48 by construction — that is the definition of the path, not a
// defect in it — so it is excluded from exact match and reported separately.
// Leaving it in would report 0/48 and say nothing at all.
const SCORED = (g) => g.name !== "llm_path";
const exact = results.filter((r) => r.grades.filter(SCORED).every((g) => g.label === "pass"));
const summary = {
  exactPasses: exact.length,
  exactFailures: results.length - exact.length,
  exactMatchRate: exact.length / results.length,
};

// Per-dimension, because one number hides which dimension is weak — and a
// fallback that gets intent right and requesterType wrong is a different
// problem from one that does the reverse.
const byDimension = {};
for (const r of results) {
  for (const g of r.grades) {
    byDimension[g.name] ??= { pass: 0, fail: 0 };
    byDimension[g.name][g.label === "pass" ? "pass" : "fail"] += 1;
  }
}

const report = {
  evaluation: {
    version: "fallback-v2.2",
    dataset: "uc01-classifier-golden-v2-remote-aligned",
    evaluator: "uc01-classifier-evaluator-v2",
    path: "classifyRequestRuleBased (deterministic, no LLM, no network)",
    mode: "FULL",
    caseCount: results.length,
  },
  summary,
  byDimension,
  results,
};

console.log(`FALLBACK PATH — ${summary.exactPasses}/${results.length} exact match (${(summary.exactMatchRate * 100).toFixed(1)}%)`);
console.log("\nper dimension:");
for (const [name, v] of Object.entries(byDimension)) {
  console.log(`  ${name.padEnd(24)} ${String(v.pass).padStart(2)}/${v.pass + v.fail}`);
}
const failed = results.filter((r) => !r.grades.filter(SCORED).every((g) => g.label === "pass"));
if (failed.length) {
  console.log(`\n${failed.length} case(s) the fallback gets wrong:`);
  for (const r of failed) {
    const bad = r.grades.filter(SCORED).filter((g) => g.label !== "pass").map((g) => g.name).join(", ");
    console.log(`  ${r.id} [${r.category}] — ${bad}`);
    console.log(`      "${r.input.text.slice(0, 92)}"`);
  }
}

if (process.argv.includes("--write")) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${REPORT}`);
}
