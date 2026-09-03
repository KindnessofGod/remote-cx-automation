// ---------------------------------------------------------------------------
// uc02ConfidenceGate.test.js — gate 13 fails CLOSED on an unusable confidence,
// in both copies, and neither of them did
// ---------------------------------------------------------------------------
// WHAT WAS WRONG, AND WHY IT IS THE WORST SHAPE THIS REPO HAS
//
// UC-02's confidence gate guards the one 🟢 auto path that MOVES MONEY
// (`PATCH /v1/expenses/:id {status:"approved"}`). Until 2026-08-31 the two
// copies were broken in OPPOSITE directions:
//
//   src/uc02/policyEngine.js  called `flags.push("confidence_unknown")`, and
//                             `flags` is bound NOWHERE — not a parameter of
//                             `evaluate()`, not declared in the file. So the
//                             gate threw `ReferenceError: flags is not
//                             defined`. In n8n a throw aborts the node BEFORE
//                             the audit write, losing the decision entirely.
//
//   workflows/nodes-uc02/…    had only `classification.confidence < 0.85`.
//                             `undefined < 0.85` and `NaN < 0.85` are both
//                             FALSE, so a claim whose confidence never arrived
//                             walked past the gate to `auto_approve`. It
//                             FAILED OPEN, on money.
//
// src's own comment described the fail-open bug as already fixed. It was fixed
// in intent and left crashing in fact, and the port never received the fix at
// all.
//
// WHY NOTHING CAUGHT IT. Both classifiers always emit a number
// (`expenseClassifier.js`'s validator rejects anything else and the rule-based
// fallback hard-codes 0.9/0.6/0.3), so no input reaching either copy through
// its normal caller can enter this branch. It is a defensive gate that cannot
// be reached on purpose — and `test/n8nUc02Parity.test.js` only ever feeds
// classifications the real classifiers produced, so it compared the two copies
// on every input EXCEPT the one where they disagreed.
//
// WHICH IS EXACTLY WHY IT NEEDS A TEST AGAINST THE FUNCTION, NOT THE CALLER.
// A guard that only runs when something upstream has already gone wrong is
// tested by calling it directly or it is not tested at all.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluate } from "../src/uc02/policyEngine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * An expense that clears every gate BEFORE 13, so the confidence gate is the
 * one actually under test. Getting here took six corrections — `currency` is an
 * OBJECT (`{code}`, `currencyCode()` returns null for a bare string),
 * `policyCap` is a bare integer not `{amount,currency}`, `converted_tax_amount`
 * is required, and receipts need all four `File` fields to count as evidence.
 * Left as a comment because the next person will otherwise re-derive it: a
 * fixture that stops at gate 9 tests gate 9, and reports a pass.
 */
const CLEAN = {
  identityVerified: true,
  employmentActive: true,
  expenseOwned: true,
  duplicate: false,
  categoryValid: true,
  policyCap: 1500000,
  expense: {
    id: "e1",
    status: "pending",
    amount: 5000,
    converted_amount: 5000,
    tax_amount: 0,
    converted_tax_amount: 0,
    currency: { code: "USD" },
    converted_currency: { code: "USD" },
    expense_date: "2026-01-01",
    category: "office_supplies",
    receipts: [{ id: "r1", name: "r.pdf", type: "application/pdf", inserted_at: "2026-01-02T00:00:00Z" }],
  },
};

const withConfidence = (value) => {
  const classification = { category: "office_supplies", source: "llm" };
  if (value !== "OMIT") classification.confidence = value;
  return { ...CLEAN, classification };
};

test("a usable confidence still reaches auto_approve — the gate did not become a blanket refusal", () => {
  // The positive half, and it is not decoration: a fail-closed fix that also
  // closes on the good input is a 🟢 use case whose green path is unreachable,
  // which this repo has already shipped once (UC-02's own cap corpus, §4).
  const r = evaluate(withConfidence(0.99));
  assert.equal(r.decision, "auto_approve");
  assert.equal(r.reason, "all_gates_passed");
});

test("an unusable confidence is human_review, never auto_approve, and never a throw", () => {
  for (const [label, value] of [
    ["absent", "OMIT"],
    ["NaN", NaN],
    ["null", null],
    ["a numeric STRING", "0.9"],
    ["boolean", true],
    ["an object", {}],
  ]) {
    let result;
    assert.doesNotThrow(() => {
      result = evaluate(withConfidence(value));
    }, `confidence ${label} threw — this is the ReferenceError that lost the decision before the audit write`);
    assert.equal(result.decision, "human_review", `confidence ${label} did not fail closed`);
    assert.equal(result.reason, "low_confidence");
    assert.ok(
      result.flags.includes("confidence_unknown"),
      `confidence ${label} must be distinguishable from a genuinely LOW confidence — "the model was unsure" and "no number arrived" are different findings and a reviewer needs to tell them apart`
    );
  }
});

test("a genuinely low confidence stays distinguishable from an absent one", () => {
  // Both are `low_confidence`, deliberately — the DECISION is the same. The
  // flags differ, which is where the distinction belongs: a reason is what the
  // gate concluded, a flag is what it saw.
  const low = evaluate(withConfidence(0.4));
  assert.equal(low.reason, "low_confidence");
  assert.ok(!low.flags.includes("confidence_unknown"));
});

test("the n8n port carries the same guard — asserted on its SOURCE, and here is why", () => {
  // This one is structural rather than behavioural, and the reason is worth
  // stating rather than hiding. The port's `evaluate()` is not exported — it is
  // a Code-node body — so the only way to drive it is through the whole node,
  // and the node BUILDS its own `classification` from the LLM response or the
  // rule-based fallback, both of which always produce a number. So there is no
  // input to the node that reaches this branch, and a behavioural test would
  // have to fake the very thing the guard exists to survive.
  //
  // Asserting the shape is weaker than asserting the behaviour and it is not
  // nothing: it fails if someone deletes the type check and leaves the bare
  // comparison, which is precisely the state the file was in.
  const body = readFileSync(join(ROOT, "workflows/nodes-uc02/expenseGates.js"), "utf8");
  assert.match(
    body,
    /typeof confidenceValue !== 'number' \|\| Number\.isNaN\(confidenceValue\)/,
    "the n8n port lost its fail-closed confidence guard — `undefined < 0.85` is false, so it auto-approves"
  );
  assert.match(body, /'low_confidence', 'confidence_unknown'/);
  // And the guard must sit BEFORE the bare comparison, or it never runs.
  assert.ok(
    body.indexOf("typeof confidenceValue !== 'number'") < body.indexOf("confidenceValue < CONFIDENCE_THRESHOLD"),
    "the type check must precede the threshold comparison"
  );
});
