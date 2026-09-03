// ---------------------------------------------------------------------------
// zafDecisionCounts.test.js — the figures a decider needs, where they can see them
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. A mobility specialist opened the UC-04 sidebar to approve or
// decline a work authorization and asked what the automation was FOR — because
// the page led with who filed it, then a long account of what was NOT
// established, and put every figure the system had computed behind a collapsed
// "Every check that cleared (N)" toggle: 3,613 characters of it on a real case.
//
// The days already spent in the destination, the Schengen allowance and the
// tax-residency watch line — the counts a person weighs before deciding — were
// the one thing the reader had to go looking for, while the caveats were
// unmissable. A panel that leads with its own limitations reads as though it
// has nothing to say. The work HAD been done; it was one click from invisible.
//
// So this asserts the counts are on the page WITHOUT opening anything, and that
// the detail behind them is still there. Both halves matter: a headline number
// without its caveat is the failure this repository is most careful about, so
// the strip is a pointer INTO the findings, never a replacement for them.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderPanelTree } from "./fixtures/nineSidebarPanels.js";

const textOf = (n) =>
  n.textContent ? String(n.textContent) : (n.childNodes || []).map(textOf).join(" ");

/** Find the first node carrying `cls`, and say whether a <details> encloses it. */
function locate(node, cls, insideDetails) {
  if (String(node.className || "").split(" ").indexOf(cls) !== -1) return { node, insideDetails };
  for (const child of node.childNodes || []) {
    const hit = locate(child, cls, insideDetails || node.tagName === "details");
    if (hit) return hit;
  }
  return null;
}

/** Everything visible without clicking: the page minus every <details> body. */
function openText(node) {
  if (node.tagName === "details") {
    const summary = (node.childNodes || []).find((c) => c.tagName === "summary");
    return summary ? textOf(summary) : "";
  }
  if (node.textContent) return String(node.textContent);
  return (node.childNodes || []).map(openText).join(" ");
}

test("the counts a work-authorization decision turns on are visible without opening anything", async () => {
  const { root } = await renderPanelTree("UC-04 · prepared");
  const visible = openText(root).replace(/\s+/g, " ");

  // The two measurements this case produces. Asserted as FIGURES, not as a
  // heading: a strip that rendered its own title and no numbers would pass a
  // heading check and answer nothing.
  assert.match(visible, /Schengen days across a rolling 180 days/, "the Schengen allowance is not on the open page");
  assert.match(visible, /21 of 90 days/, "the Schengen figure is not on the open page");
  assert.match(visible, /Days in Netherlands across a rolling 365 days/, "the tax-residency watch is not on the open page");
  assert.match(visible, /67 of 183 days/, "the tax-residency figure is not on the open page");
  // Headroom is the part a decider acts on — "how much is left" is the question.
  assert.match(visible, /69 days left/);
  assert.match(visible, /116 days left/);
  // A figure never appears without its verdict.
  assert.match(visible, /Within the limit/);
});

test("the strip sits outside every collapsed section", async () => {
  const { root } = await renderPanelTree("UC-04 · prepared");
  const found = locate(root, "r-numbers", false);
  assert.ok(found, "the counts strip did not render at all");
  assert.equal(found.insideDetails, false, "the counts strip is inside a <details> — which is the defect it exists to fix");
});

test("...and the full finding, its window and its sources are still below", async () => {
  const { root } = await renderPanelTree("UC-04 · prepared");
  const all = textOf(root).replace(/\s+/g, " ");
  // The strip is a pointer, not a replacement: the window it was measured over,
  // the per-check reasoning and the citations must all survive.
  assert.match(all, /trailing 180 days/, "the measurement window is gone");
  assert.match(all, /Every check that cleared/, "the full findings block is gone");
  assert.match(all, /Regulation \(EU\) 2016\/399/, "the citation behind the Schengen figure is gone");
  assert.match(
    all,
    /Each figure is repeated in full below/,
    "the strip must say where the detail is, or it reads as the whole answer"
  );
});

test("a panel with no measurements renders no strip rather than an empty one", async () => {
  // UC-06 publishes no measurements. A heading with nothing under it is how a
  // reader learns to distrust the section everywhere else.
  const { root } = await renderPanelTree("UC-06 · prepared");
  assert.equal(locate(root, "r-numbers", false), null);
});
