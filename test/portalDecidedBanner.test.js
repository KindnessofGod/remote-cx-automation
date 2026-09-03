// ---------------------------------------------------------------------------
// portalDecidedBanner.test.js — the banner above "My requests" is a TALLY
// ---------------------------------------------------------------------------
// WHAT THIS EXISTS FOR, in the words it was reported in: "that bar showing the
// information is too long."
//
// The banner enumerated every settled request, one entry each. Read live on the
// deployment 2026-09-01 by the project owner, on a real history of 85 requests
// with 18 decided, it rendered as:
//
//   18 of your 85 requests have been decided by a person: UC-04 — approved by
//   your manager; UC-04 — approved by your manager; UC-04 — approved by your
//   manager; … (eight times) … UC-02 — approved; UC-02 — declined; UC-02 — …
//
// Four wrapped lines carrying three distinct facts. It was the longest thing on
// the page and it said the least.
//
// THE INVARIANT THAT MAKES SHORTENING SAFE, and it is why this is a tally and
// not a cap: every settled request is still counted exactly once, and no
// outcome is dropped. A "show the first five" banner would have been shorter
// too and would have quietly stopped mentioning outcomes — on a page whose only
// job is "what happened to mine", a silent omission is worse than a long line.
// The two tests below pin exactly that: the counts SUM to the total, and the
// set of outcomes is complete.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { describeDecided } from "../src/portal/requestStatus.js";

/** The shape "My requests" actually hands the banner — a status label and a settled flag. */
const req = (useCase, label, settled = true) => ({ useCase, settled, status: { label } });

/** The owner's real history, reduced to its shape: three outcomes across eighteen decisions. */
const REAL_HISTORY = [
  ...Array.from({ length: 8 }, () => req("UC-04", "Approved by your manager")),
  ...Array.from({ length: 7 }, () => req("UC-02", "Approved")),
  ...Array.from({ length: 3 }, () => req("UC-02", "Declined")),
  ...Array.from({ length: 67 }, () => req("UC-02", "With Finance Ops", false)),
];

test("eighteen decisions render as three entries, not eighteen", () => {
  const decided = describeDecided(REAL_HISTORY);

  assert.equal(decided.count, 18);
  assert.equal(decided.total, 85);
  assert.equal(decided.outcomes.length, 3, "one entry per OUTCOME, not one per request");

  assert.equal(
    decided.summary,
    "18 of your 85 requests have been decided by a person: " +
      "UC-04 — approved by your manager (×8); UC-02 — approved (×7); UC-02 — declined (×3)."
  );

  // The defect, stated directly: no outcome may appear twice.
  const texts = decided.outcomes.map((entry) => entry.outcome);
  assert.equal(new Set(texts).size, texts.length, `the banner repeats itself: ${decided.summary}`);
});

test("NOTHING IS DROPPED — the counts sum to the number decided, and every outcome survives", () => {
  // The invariant that separates a tally from a truncation. Asserted over a
  // deliberately awkward history: seven use cases, uneven counts, and two
  // outcomes that differ only by their label.
  const history = [
    ...Array.from({ length: 4 }, () => req("UC-01", "Answered")),
    ...Array.from({ length: 2 }, () => req("UC-05", "Signed off")),
    req("UC-09", "Approved"),
    req("UC-06", "Approved"),
    req("UC-04", "Declined by your manager"),
    ...Array.from({ length: 3 }, () => req("UC-03", "With a specialist", false)),
  ];
  const decided = describeDecided(history);

  assert.equal(decided.count, 9);
  assert.equal(
    decided.outcomes.reduce((sum, entry) => sum + entry.count, 0),
    decided.count,
    "a settled request went unaccounted for"
  );

  // Every distinct (use case, label) pair the history contains is named.
  const expected = new Set(
    history.filter((r) => r.settled).map((r) => `${r.useCase} — ${r.status.label.toLowerCase()}`)
  );
  assert.deepEqual(new Set(decided.outcomes.map((e) => e.outcome)), expected);

  // And the sentence names all of them — no cap, no ellipsis, nothing implying
  // there is more to see somewhere else.
  for (const outcome of expected) assert.ok(decided.summary.includes(outcome), `dropped: ${outcome}`);
  assert.doesNotMatch(decided.summary, /\.\.\.|…|and \d+ more/i, "the banner truncates instead of tallying");
});

test("ORDER IS STABLE — the same history renders identically however it was filed", () => {
  // Insertion order is SUBMISSION order, so ordering the banner by it would
  // reshuffle the whole line every time an old request was decided.
  const shuffled = [...REAL_HISTORY].reverse();
  assert.equal(describeDecided(shuffled).summary, describeDecided(REAL_HISTORY).summary);
});

test("a single decision keeps its plain phrasing — no '(×1)' on a history of one", () => {
  const decided = describeDecided([req("UC-02", "Approved")]);
  assert.equal(decided.summary, "1 of your 1 request has been decided by a person: UC-02 — approved.");
  assert.doesNotMatch(decided.summary, /×/);
});

test("nothing decided renders NOTHING, never a heading for zero", () => {
  const decided = describeDecided([req("UC-02", "With Finance Ops", false)]);
  assert.equal(decided.summary, "", "a banner reading '0 of 1' makes an absence look like a result");
  assert.equal(decided.count, 0);
  assert.deepEqual(decided.outcomes, []);
});
