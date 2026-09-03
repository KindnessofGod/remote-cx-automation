// ---------------------------------------------------------------------------
// uc02ReceiptExtraction.test.js — [E-1], the reading half
// ---------------------------------------------------------------------------
// UC-02 is called "Expense & Receipt Validation" and until now never opened the
// receipt: gate 8 checked that an artifact EXISTS, nothing checked whether the
// document says anything like the number claimed. A $480 claim with a $12
// coffee receipt attached passed every gate that could see it.
//
// This file tests the READING half only. It decides nothing, and the tests are
// written to hold it to that: there is no input that makes it return an
// approval, and every unreadable case is distinguishable from every other.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  extractReceipt,
  isReadableReceipt,
  isValidExtraction,
  EXTRACTION_SOURCES,
} from "../src/uc02/receiptExtraction.js";

const PDF = { mimeType: "application/pdf", fileName: "receipt.pdf", dataBase64: "JVBERi0xLjQK" };
const GOOD = { merchant: "Cafe Central", date: "2026-08-12", total: 1234, currency: "EUR", confidence: 0.93, notes: "" };

/** A fake transport. The real one is never reachable from a test. */
const reads = (answer) => ({ readReceipt: async () => answer });

test("a well-formed receipt is transcribed", async () => {
  const out = await extractReceipt(PDF, reads(GOOD));
  assert.equal(out.source, EXTRACTION_SOURCES.LLM);
  assert.equal(out.extracted.total, 1234);
  assert.equal(out.extracted.currency, "EUR");
  assert.equal(out.reason, "receipt_read");
});

test("a JSON STRING answer is parsed, since that is what a chat model returns", async () => {
  const out = await extractReceipt(PDF, reads(JSON.stringify(GOOD)));
  assert.equal(out.extracted.total, 1234);
});

test("THE SEAM: with no transport injected it does not reach for a real client", async () => {
  // CLAUDE.md §6 — a test that forgets to inject must fail loudly, never make a
  // real billed call. "Not configured" is also distinct from "unreadable".
  const out = await extractReceipt(PDF, {});
  assert.equal(out.extracted, null);
  assert.equal(out.reason, "extraction_not_configured");
});

test("an unsupported file type is answered WITHOUT spending an API call", async () => {
  let called = false;
  const out = await extractReceipt(
    { mimeType: "application/zip", dataBase64: "AAA" },
    { readReceipt: async () => { called = true; return GOOD; } }
  );
  assert.equal(out.reason, "unsupported_receipt_format");
  assert.equal(called, false, "a paid call was made for a file we cannot read");
});

test("a transport error becomes 'unreadable' and never leaks the error text", async () => {
  const out = await extractReceipt(PDF, { readReceipt: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:443"); } });
  assert.equal(out.extracted, null);
  assert.equal(out.reason, "receipt_unreadable");
  assert.doesNotMatch(JSON.stringify(out), /ECONNREFUSED|10\.0\.0\.1/, "transport internals reached the caller");
});

// --- validation: a partial answer is discarded WHOLE --------------------------

test("MONEY: a float total is rejected — it means major units, understating 100x", () => {
  assert.equal(isValidExtraction({ ...GOOD, total: 12.34 }), false);
});

test("MONEY: a negative or absurd total is rejected", () => {
  assert.equal(isValidExtraction({ ...GOOD, total: -1 }), false);
  assert.equal(isValidExtraction({ ...GOOD, total: 100_000_001 }), false);
});

test("a malformed currency or date invalidates the WHOLE answer, not just that field", async () => {
  for (const bad of [{ currency: "euros" }, { currency: "eu" }, { date: "12/08/2026" }, { date: "2026-13-45" }]) {
    const out = await extractReceipt(PDF, reads({ ...GOOD, ...bad }));
    assert.equal(out.extracted, null, `${JSON.stringify(bad)} was accepted`);
    assert.equal(out.reason, "receipt_unreadable");
  }
});

test("nulls are legitimate — an unreadable FIELD is not an unreadable receipt", async () => {
  // A till roll with no merchant name is still a valid transcription.
  const out = await extractReceipt(PDF, reads({ ...GOOD, merchant: null, date: null }));
  assert.equal(out.source, EXTRACTION_SOURCES.LLM);
  assert.equal(out.extracted.total, 1234, "a readable total was thrown away with the unreadable fields");
});

test("a confidence outside 0..1 is rejected", () => {
  assert.equal(isValidExtraction({ ...GOOD, confidence: 1.4 }), false);
  assert.equal(isValidExtraction({ ...GOOD, confidence: "high" }), false);
});

test("IT CAN NEVER APPROVE ANYTHING", async () => {
  // The property that keeps this on the right side of directive 1. No input —
  // including a model that tries to answer the question it was not asked —
  // produces a decision, a reason string a gate consumes, or an amount the
  // caller could mistake for a verdict.
  const out = await extractReceipt(PDF, reads({ ...GOOD, decision: "auto_approve", approved: true, withinPolicy: true }));
  assert.equal(out.extracted.decision, undefined);
  assert.equal(out.extracted.approved, undefined);
  assert.equal(out.extracted.withinPolicy, undefined);
  assert.deepEqual(
    Object.keys(out.extracted).sort(),
    ["confidence", "currency", "date", "merchant", "notes", "total"],
    "the extractor grew a field that is not a transcription"
  );
});

test("the readable-type list is the one the UI advertises", () => {
  assert.equal(isReadableReceipt("application/pdf"), true);
  assert.equal(isReadableReceipt("image/jpeg"), true);
  assert.equal(isReadableReceipt("IMAGE/PNG"), true, "mime types are case-insensitive in the wild");
  assert.equal(isReadableReceipt("text/html"), false);
  assert.equal(isReadableReceipt(undefined), false);
});
