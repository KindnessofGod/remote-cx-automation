// ---------------------------------------------------------------------------
// uc02ReceiptSupportsClaim.test.js — gate 8b, the deciding half of [E-1]
// ---------------------------------------------------------------------------
// Gate 8 proves a receipt EXISTS. Gate 8b is the first thing in this use case
// that reads what it SAYS. Acceptance contract §6:
//
//   receipt contradicts the record -> human_review / receipt_does_not_support_claim
//   receipt cannot be read         -> human_review / receipt_unreadable
//
// The contract's §13 adds the constraint that matters most here: "Remote's
// figures are never overwritten by the model's" — two readings shown as two
// readings, never merged into one corrected figure, because a merged figure has
// already decided.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluate, receiptContradictions, GATE_SEQUENCE } from "../src/uc02/policyEngine.js";

/** A claim that passes every gate, so the only variable is the receipt. */
function claim(overrides = {}) {
  return {
    identityVerified: true,
    employmentActive: true,
    expenseOwned: true,
    duplicate: null,
    categoryValid: true,
    classification: { categoryId: "work_meals_and_entertainment.internal_meals_and_entertainment", confidence: 0.95, reason: "", source: "llm" },
    policyCap: 50000,
    expense: {
      id: "exp-1",
      status: "pending",
      amount: 1234,
      tax_amount: 0,
      converted_tax_amount: 0,
      currency: { code: "USD" },
      converted_amount: 1234,
      converted_currency: { code: "USD" },
      expense_date: "2026-08-12",
      // A schema-valid File row — usableReceipts() requires id/name/type/inserted_at,
      // because a row the schema would reject is a placeholder, not an artifact.
      receipts: [{ id: "r1", name: "receipt.pdf", type: "application/pdf", inserted_at: "2026-08-12T10:00:00Z" }],
      title: "Team lunch",
    },
    now: new Date("2026-08-20T00:00:00Z"),
    ...overrides,
  };
}

const READ = (extracted) => ({ extracted, source: "llm", reason: "receipt_read" });
const AGREES = { merchant: "Cafe Central", date: "2026-08-12", total: 1234, currency: "USD", confidence: 0.95, notes: "" };

test("BASELINE: with no reading attempted the claim still auto-approves", () => {
  // The single most important test here. Wiring [E-1] in must NOT disable the
  // green tier — §16.8 exists because this use case was dead three times while
  // every fail-closed test passed.
  const out = evaluate(claim());
  assert.equal(out.decision, "auto_approve", "adding the receipt gate broke the happy path");
});

test("a receipt that AGREES still auto-approves", () => {
  const out = evaluate(claim({ receiptReading: READ(AGREES) }));
  assert.equal(out.decision, "auto_approve");
  assert.equal(out.reason, "all_gates_passed");
});

test("a receipt whose TOTAL differs goes to a human", () => {
  // The headline case: $480 claimed, $12 coffee receipt attached.
  const out = evaluate(claim({ receiptReading: READ({ ...AGREES, total: 48000 }) }));
  assert.equal(out.decision, "human_review");
  assert.equal(out.reason, "receipt_does_not_support_claim");
  assert.ok(out.flags.includes("receipt_total_differs"), "the reviewer is not told WHICH field disagreed");
});

test("a receipt whose CURRENCY differs goes to a human", () => {
  const out = evaluate(claim({ receiptReading: READ({ ...AGREES, currency: "GBP" }) }));
  assert.equal(out.reason, "receipt_does_not_support_claim");
  assert.ok(out.flags.includes("receipt_currency_differs"));
});

test("a receipt whose DATE differs goes to a human", () => {
  const out = evaluate(claim({ receiptReading: READ({ ...AGREES, date: "2026-07-01" }) }));
  assert.equal(out.reason, "receipt_does_not_support_claim");
  assert.ok(out.flags.includes("receipt_date_differs"));
});

test("an UNREADABLE receipt is its own outcome, distinct from a contradicted one", () => {
  // Different findings, different remedies: one wants a human to look, the
  // other wants the claim corrected. Collapsing them sends the reviewer after
  // the wrong fix.
  const out = evaluate(claim({ receiptReading: { extracted: null, source: "not_attempted", reason: "receipt_unreadable" } }));
  assert.equal(out.decision, "human_review");
  assert.equal(out.reason, "receipt_unreadable");
  assert.notEqual(out.reason, "receipt_does_not_support_claim");
});

test("'not configured' does NOT refuse — absent is not unreadable", () => {
  // Treating an unwired extractor as an unreadable receipt would send every
  // claim on every path to a human and silently disable the green tier.
  const out = evaluate(claim({ receiptReading: { extracted: null, source: "not_attempted", reason: "extraction_not_configured" } }));
  assert.equal(out.decision, "auto_approve");
});

test("a NULL field on either side is not a disagreement", () => {
  // A smudged date is not a contradicted date.
  const out = evaluate(claim({ receiptReading: READ({ ...AGREES, date: null, merchant: null }) }));
  assert.equal(out.decision, "auto_approve");
});

test("REMOTE'S FIGURES ARE NEVER OVERWRITTEN BY THE MODEL'S", () => {
  // §13. The expense object handed in must come back untouched — the model's
  // reading is compared and discarded, never merged into the record.
  const input = claim({ receiptReading: READ({ ...AGREES, total: 999999 }) });
  const before = JSON.parse(JSON.stringify(input.expense));
  evaluate(input);
  assert.deepEqual(input.expense, before, "the gate mutated the Remote record");
});

test("the gate can only ever REFUSE — no input makes the model's reading approve", () => {
  const src = evaluate.toString();
  const idx = src.indexOf("receipt_does_not_support_claim");
  assert.ok(idx > 0, "gate 8b has been removed");
  const block = src.slice(Math.max(0, idx - 900), idx + 400);
  assert.doesNotMatch(block, /decision:\s*["']auto_approve["']/, "gate 8b now has a path that approves");
});

test("both outcomes appear in the gate ladder, so a decision can name its rung", () => {
  const reasons = GATE_SEQUENCE.map((g) => g.reason);
  assert.ok(reasons.includes("receipt_unreadable"));
  assert.ok(reasons.includes("receipt_does_not_support_claim"));
});

test("receiptContradictions reports NAMES, never amounts", () => {
  // If it ever returned figures, a caller could render the model's number as
  // if it were Remote's.
  const out = receiptContradictions({ amount: 1234, currency: { code: "USD" }, expense_date: "2026-08-12" }, { total: 9999, currency: "GBP", date: "2020-01-01" });
  assert.deepEqual(out.sort(), ["receipt_currency_differs", "receipt_date_differs", "receipt_total_differs"]);
  assert.doesNotMatch(JSON.stringify(out), /9999|2020/, "an amount or date value leaked into the flags");
});
