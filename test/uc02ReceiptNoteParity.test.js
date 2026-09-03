// ---------------------------------------------------------------------------
// uc02ReceiptNoteParity.test.js — the reviewer's sentence, in both copies
// ---------------------------------------------------------------------------
// `describeReceiptReading()` exists twice for the reason everything in UC-02
// exists twice: the Node path imports src/uc02/policyEngine.js and an n8n Code
// node can import nothing, so workflows/nodes-uc02/expenseGates.js carries a
// ported copy. The standing rule is "if you edit one, edit both", and this is
// what enforces it for this function.
//
// WHY THE SENTENCE MATTERS ENOUGH TO PIN. Gate 8b's header says the model's
// figures "reach a human as a second reading beside Remote's, never merged
// into one corrected figure". Until this function existed nothing delivered
// them anywhere at all — the Zendesk internal note named the decision and the
// flags and never mentioned that a receipt had been read. So the reviewer the
// reading was compiled for could not see it.
//
// The property that must survive every future edit is BOTH FIGURES, ALWAYS,
// SIDE BY SIDE — including when they agree. A note printing only the receipt's
// total is the merged figure the gate forbids, one indirection away: a reader
// takes it as "the amount".
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describeReceiptReading } from "../src/uc02/policyEngine.js";

/**
 * Lift the ported copy out of the n8n body and make it callable.
 *
 * It is EXTRACTED from the deployed body rather than re-declared here, for the
 * same reason verify-traces lifts TRACED_CALLS out of the live node: a local
 * restatement would share any typo and compare equal to itself.
 */
const NODE_SRC = readFileSync(new URL("../workflows/nodes-uc02/expenseGates.js", import.meta.url), "utf8");

function portedCopy() {
  const start = NODE_SRC.indexOf("function describeReceiptReading(");
  assert.ok(start > 0, "the ported copy is gone from expenseGates.js — the n8n note will be undefined");
  // Its dependency, which the ported copy calls.
  const depStart = NODE_SRC.indexOf("function receiptContradictions(");
  assert.ok(depStart > 0, "receiptContradictions is missing from the n8n body");
  const slice = (from) => {
    const end = NODE_SRC.indexOf("\n}\n", from) + 3;
    return NODE_SRC.slice(from, end);
  };
  const consts = NODE_SRC.slice(NODE_SRC.indexOf("RECEIPT_NOT_ATTEMPTED_REASONS"));
  const constDecl = consts.slice(0, consts.indexOf("]") + 2);
  return new Function(
    "expense",
    "receiptReading",
    `const ${constDecl.startsWith("RECEIPT") ? constDecl : "RECEIPT_NOT_ATTEMPTED_REASONS = []"};\n` +
      slice(depStart) +
      slice(start) +
      "\nreturn describeReceiptReading(expense, receiptReading);"
  );
}

const CLAIM = { amount: 25805, currency: { code: "USD" }, expense_date: "2026-05-15" };

const CASES = [
  ["agreeing", CLAIM, { extracted: { merchant: "Lakeside Conference Center", total: 25805, currency: "USD", date: "2026-05-15" }, source: "llm", reason: "receipt_read" }],
  ["total differs", CLAIM, { extracted: { merchant: "Cafe", total: 6855, currency: "USD", date: "2026-05-15" }, source: "llm", reason: "receipt_read" }],
  ["date differs", CLAIM, { extracted: { merchant: "Cafe", total: 25805, currency: "USD", date: "2026-08-12" }, source: "llm", reason: "receipt_read" }],
  ["currency differs", CLAIM, { extracted: { merchant: "Cafe", total: 25805, currency: "GBP", date: "2026-05-15" }, source: "llm", reason: "receipt_read" }],
  ["nobody tried", CLAIM, { extracted: null, source: "not_attempted", reason: "no_receipt_attached" }],
  ["tried and failed", CLAIM, { extracted: null, source: "not_attempted", reason: "receipt_unreadable" }],
  ["no reading at all", CLAIM, null],
  ["illegible fields", CLAIM, { extracted: { merchant: null, total: null, currency: null, date: null }, source: "llm", reason: "receipt_read" }],
];

test("both copies produce the identical sentence for every case", () => {
  const ported = portedCopy();
  for (const [label, expense, reading] of CASES) {
    assert.equal(ported(expense, reading), describeReceiptReading(expense, reading), `the two copies disagree on: ${label}`);
  }
});

test("BOTH figures appear even when they agree — the merged-figure trap", () => {
  const out = describeReceiptReading(CLAIM, {
    extracted: { merchant: "Lakeside Conference Center", total: 25805, currency: "USD", date: "2026-05-15" },
    source: "llm", reason: "receipt_read",
  });
  assert.match(out, /Receipt reads:/);
  assert.match(out, /Claim records:/, "the claim's own figure is missing — this is the merged figure gate 8b forbids");
  assert.match(out, /agree/);
});

test("a disagreement names the gate's own contradiction codes, not a second opinion", () => {
  const out = describeReceiptReading(CLAIM, {
    extracted: { merchant: "Cafe", total: 6855, currency: "USD", date: "2026-08-12" },
    source: "llm", reason: "receipt_read",
  });
  assert.match(out, /receipt_total_differs/);
  assert.match(out, /receipt_date_differs/);
  // And it must not claim either reading has been corrected.
  assert.match(out, /neither has been corrected/);
});

test("'nobody tried' and 'tried and failed' are different sentences", () => {
  const notTried = describeReceiptReading(CLAIM, { extracted: null, source: "not_attempted", reason: "no_receipt_attached" });
  const failed = describeReceiptReading(CLAIM, { extracted: null, source: "not_attempted", reason: "receipt_unreadable" });
  assert.notEqual(notTried, failed);
  assert.match(notTried, /nothing was assumed/);
  assert.match(failed, /could NOT be read/);
});

test("no reading at all yields null, so a caller can append it unconditionally", () => {
  assert.equal(describeReceiptReading(CLAIM, null), null);
});

test("it decides nothing — no decision word can leak out of it", () => {
  for (const [, expense, reading] of CASES) {
    const out = describeReceiptReading(expense, reading);
    if (out === null) continue;
    assert.doesNotMatch(out, /auto_approve|approved\b/, "the sentence asserts an outcome; it describes evidence");
  }
});

test("the n8n node carries the sentence on its output", () => {
  assert.match(NODE_SRC, /receiptNote: describeReceiptReading\(expense, receiptReading\)/,
    "the gates node no longer emits receiptNote — the Zendesk internal note will render undefined");
});
