// ---------------------------------------------------------------------------
// metricsSpendTile.test.js — the dashboard's one money figure must not read as
//                             a fact when it is a floor, or as zero when it is
//                             absent
// ---------------------------------------------------------------------------
// CLAUDE.md §7 item 22. `costVerdict()` has distinguished three states since
// `computeLlmCost()` stopped throwing on an unpriced model. The dashboard tile
// consulted none of them and printed the dollar figure flat — so on production
// data, where every call runs on `gpt-5-nano` and no rate exists for it, the
// screen said **$0.0000** while the report it was rendering said `unpriced`.
//
// Two different wrong readings in the same pixel: a real spend shown as
// nothing, and "we declined to price this" shown as "this was free".
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/metrics/dashboard.js";
import { computeMetrics, costVerdict } from "../src/metrics/compute.js";

/**
 * A REAL report from `computeMetrics()` with only the costs swapped, rather
 * than a hand-built literal. A literal would drift from the renderer's actual
 * contract the first time a field is added, and would then be asserting about
 * a shape production never produces.
 */
function reportWith(costs) {
  return { ...computeMetrics({ cases: [], reviewQueue: [], traces: [] }), costs };
}

const NOTHING = { totalUsd: 0, callsPriced: 0, promptTokens: 0, completionTokens: 0, complete: true,
  perResolvedCase: null, unpriced: { calls: 0, promptTokens: 0, completionTokens: 0, models: [] }, byUseCase: [] };

const UNPRICED = { ...NOTHING, totalUsd: 0, complete: false,
  unpriced: { calls: 7, promptTokens: 900, completionTokens: 120,
    models: [{ model: "gpt-5-nano", calls: 7, promptTokens: 900, completionTokens: 120, known: false }] } };

const PRICED = { ...NOTHING, totalUsd: 0.0123, callsPriced: 4, perResolvedCase: 0.0031 };

/** The rendered VALUE of the spend tile — not "somewhere on the page". */
function spendValue(html) {
  const i = html.indexOf("Estimated LLM spend");
  assert.notEqual(i, -1, "the spend tile must exist");
  return html.slice(i).match(/class="tile-value"[^>]*>([^<]*)</)?.[1]?.trim();
}

test("nothing to price renders an em dash, never a dollar figure", () => {
  assert.equal(costVerdict(NOTHING).verdict, "insufficient_data");
  const html = renderDashboardHtml(reportWith(NOTHING));
  assert.match(html, /Estimated LLM spend/);
  // Asserted on the VALUE, and against ANY dollar figure. An earlier draft of
  // this test looked for "$0.0000" anywhere in the page — which the bug would
  // have survived, because humanUsd() renders the tile to 2dp and the defect
  // printed "$0.00". A guard that names the wrong spelling is not a guard.
  assert.equal(spendValue(html), "—");
  assert.doesNotMatch(
    spendValue(html),
    /\$/,
    "a zero here is a measurement claim nobody made — the seeded run drives the rule-based classifier on purpose"
  );
  assert.match(html, /not a measurement of zero spend/);
});

test("an unpriced model renders the number as a FLOOR and names the model", () => {
  assert.equal(costVerdict(UNPRICED).verdict, "unpriced");
  const html = renderDashboardHtml(reportWith(UNPRICED));
  assert.match(html, /≥/, "the figure must be marked as a lower bound");
  assert.match(html, /gpt-5-nano/, "the model with no rate must be named, so the remedy is obvious");
  assert.match(html, /FLOOR, not the bill/);
});

test("a fully priced window is unchanged — the plain figure still renders", () => {
  assert.equal(costVerdict(PRICED).verdict, "priced");
  const html = renderDashboardHtml(reportWith(PRICED));
  assert.equal(spendValue(html), "$0.01");
  assert.doesNotMatch(spendValue(html), /≥/, "nothing is a floor when every call has a rate");
  assert.doesNotMatch(html, /FLOOR, not the bill/);
});

test("no rate is invented for an unpriced model", () => {
  // The failure this guards is a plausible number appearing where a refusal
  // belongs. Money is the one thing the substitution ladder forbids outright.
  const html = renderDashboardHtml(reportWith(UNPRICED));
  assert.equal(
    spendValue(html),
    "≥ $0.00",
    "the floor is the sum of the PRICED calls — genuinely zero here, and marked as a lower bound rather than presented as the bill"
  );
});
