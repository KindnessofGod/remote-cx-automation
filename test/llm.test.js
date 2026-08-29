// ---------------------------------------------------------------------------
// llm.test.js  —  tagUsage()/extractUsage(), independent of any real OpenAI call
// ---------------------------------------------------------------------------
// askJson() itself is NOT tested here — it has a top-level `import OpenAI`
// and makes a real network call, so exercising it would break hermeticity
// (see CLAUDE.md's "Never let npm test reach OpenAI" gotcha). What IS pure
// and testable in isolation is the usage-tagging seam: tagUsage() takes an
// already-parsed object and a raw OpenAI-shaped response and returns the
// same object with usage attached; extractUsage() reads it back. Every call
// site (uc01/classifier.js etc.) only ever sees this pair, never askJson()'s
// internals, so covering the pair covers what every call site actually
// depends on.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { tagUsage, extractUsage } from "../src/shared/llm.js";

const fakeResponse = (over = {}) => ({
  model: "gpt-4o-mini",
  usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  ...over,
});

test("tagUsage attaches model + token counts, readable back via extractUsage", () => {
  const parsed = { intent: "standard_verification" };
  const tagged = tagUsage(parsed, fakeResponse());
  const usage = extractUsage(tagged);
  assert.deepEqual(usage, {
    model: "gpt-4o-mini",
    promptTokens: 120,
    completionTokens: 40,
    totalTokens: 160,
  });
});

test("tagUsage returns the SAME object it was given, not a copy", () => {
  const parsed = { intent: "standard_verification" };
  const tagged = tagUsage(parsed, fakeResponse());
  assert.equal(tagged, parsed, "tagUsage must mutate and return the same reference, not clone");
});

test("the attached usage is non-enumerable — Object.keys/for-in/spread never see it", () => {
  const parsed = { intent: "standard_verification", confidence: 0.9 };
  const tagged = tagUsage(parsed, fakeResponse());

  assert.deepEqual(Object.keys(tagged), ["intent", "confidence"]);

  const seenByForIn = [];
  for (const k in tagged) seenByForIn.push(k);
  assert.deepEqual(seenByForIn, ["intent", "confidence"]);

  const spread = { ...tagged };
  assert.deepEqual(spread, { intent: "standard_verification", confidence: 0.9 });
  assert.equal(extractUsage(spread), null, "usage does not survive a spread — that is the point");
});

test("JSON.stringify(tagged) never leaks usage into an audit-log payload", () => {
  const parsed = { intent: "standard_verification" };
  const tagged = tagUsage(parsed, fakeResponse());
  const json = JSON.stringify(tagged);
  assert.equal(json, '{"intent":"standard_verification"}');
  assert.doesNotMatch(json, /prompt_tokens|promptTokens|gpt-4o-mini/);
});

test("extractUsage returns null for an object tagUsage never touched", () => {
  assert.equal(extractUsage({ intent: "standard_verification" }), null);
  assert.equal(extractUsage(null), null);
  assert.equal(extractUsage(undefined), null);
});

test("tagUsage is a no-op when the response carries no usage block", () => {
  const parsed = { intent: "standard_verification" };
  const tagged = tagUsage(parsed, { model: "gpt-4o-mini" }); // no `usage` key
  assert.equal(extractUsage(tagged), null);
});

test("tagUsage falls back to the configured model name when the response omits one", () => {
  const parsed = {};
  const tagged = tagUsage(parsed, { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  const usage = extractUsage(tagged);
  assert.ok(usage.model, "a model name is always present, even when the raw response omits it");
});

test("tagUsage on a non-object parsed value is a safe no-op, never throws", () => {
  assert.equal(tagUsage(null, fakeResponse()), null);
  assert.equal(tagUsage(undefined, fakeResponse()), undefined);
});
