// Tests for the money middleware. Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { toRemoteInteger, fromRemoteInteger, formatMoney } from "../src/shared/money.js";

test("toRemoteInteger scales a salary up by 100", () => {
  assert.equal(toRemoteInteger(50000), 5000000);
  assert.equal(toRemoteInteger(50000.0), 5000000);
});

test("toRemoteInteger handles cents without float drift", () => {
  assert.equal(toRemoteInteger(19.99), 1999);
  assert.equal(toRemoteInteger(0.1), 10);
});

test("fromRemoteInteger scales back down", () => {
  assert.equal(fromRemoteInteger(5000000), 50000);
  assert.equal(fromRemoteInteger(1999), 19.99);
});

test("round-trip is stable (the property that matters most)", () => {
  for (const amount of [0, 1, 19.99, 50000, 123456.78]) {
    assert.equal(fromRemoteInteger(toRemoteInteger(amount)), amount);
  }
});

test("formatMoney produces a human display string", () => {
  assert.equal(formatMoney(5000000, "USD"), "50,000.00 USD");
});

test("bad input is rejected loudly (fail fast, never guess with money)", () => {
  assert.throws(() => toRemoteInteger("50000"));
  assert.throws(() => fromRemoteInteger(19.99)); // not an integer
});
