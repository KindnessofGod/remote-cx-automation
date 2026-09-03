// ---------------------------------------------------------------------------
// uiAccessibility.test.js  —  the accessibility guarantees of every browser
//                             surface, pinned rather than promised
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// Browser assets are never imported by `npm test` (the standing gotcha in
// CLAUDE.md §6), so anything true of them is true only until the next edit.
// zafApp.test.js already pins that they compile and never touch innerHTML.
// These are the other properties that were quietly wrong and would quietly
// break again:
//
//   1. EVERY form control has an accessible name. All six approval surfaces
//      relied on `placeholder` alone, which several screen readers do not treat
//      as a name and which disappears the moment the field is typed into. On
//      the panel where a human authorises a payroll change, "which box is my
//      name and which is the note?" is not a cosmetic question.
//   2. Anything that changes asynchronously is announced. These pages swap
//      their contents in place with no navigation and no focus change, so
//      without a live region a screen-reader user is told nothing when a case
//      loads, an approval is recorded, or a backing API turns out to be down.
//   3. The sidebar still renders its states — loading, empty, unreachable —
//      instead of leaving a blank panel, and still offers the retry.
//
// The parser here is deliberately crude (regex over the HTML, not a DOM). It
// only has to answer "does every control have SOME name", and a real DOM
// would need a dependency this repo does not carry.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

/** Every static page in the repo that a human types into. */
const PAGES = [
  "src/playground/assets/index.html",
  "src/chatdemo/assets/index.html",
  "src/remoteui/assets/index.html",
  "src/remoteui/assets/workauth.html",
  "src/livedemo/assets/index.html",
  "src/dashboard/assets/index.html",
  "zaf-app/assets/iframe.html",
];

const CONTROL = /<(?:input|textarea|select)\b[^>]*>/gi;
const idOf = (tag) => (tag.match(/\bid="([^"]+)"/) || [])[1];

/**
 * The three mechanisms that actually give a control an accessible name:
 * a <label for>, a wrapping <label>, or an explicit aria-label. A placeholder
 * is deliberately NOT one of them — that is the bug this test exists to catch.
 */
function namedControls(html) {
  const byFor = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  const wrapped = new Set();
  for (const block of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
    for (const c of block[1].matchAll(CONTROL)) {
      const id = idOf(c[0]);
      if (id) wrapped.add(id);
    }
  }
  return { byFor, wrapped };
}

for (const page of PAGES) {
  test(`every form control in ${page} has an accessible name`, () => {
    const html = read(page);
    const { byFor, wrapped } = namedControls(html);
    const unnamed = [];

    for (const match of html.matchAll(CONTROL)) {
      const tag = match[0];
      if (/\btype="(hidden|submit|button)"/.test(tag)) continue;
      const id = idOf(tag);
      const named =
        /\baria-label(?:ledby)?=/.test(tag) || (id && (byFor.has(id) || wrapped.has(id)));
      if (!named) unnamed.push(id || tag.slice(0, 70));
    }

    assert.deepEqual(
      unnamed,
      [],
      `${page} has controls with no accessible name: ${unnamed.join(", ")}.\n` +
        `A placeholder is not a label — it is not exposed as a name by every screen reader and it ` +
        `vanishes as soon as the field is typed into. Use a <label>, or aria-label for one half of a ` +
        `value pair whose visible caption names the pair.`
    );
  });
}

test("the ZAF sidebar builds its controls through the labelling helper, never bare", () => {
  // main.js/panels.js create controls in JS, so the HTML scan above cannot see
  // them. The guarantee there is structural: labelledField() is the only way a
  // control is made, and it always emits a <label for>.
  const main = read("zaf-app/assets/main.js");
  const panels = read("zaf-app/assets/panels.js");

  assert.ok(/function labelledField\(/.test(main), "main.js must define labelledField()");
  assert.ok(
    /label\.setAttribute\("for", id\)/.test(main),
    "labelledField() must associate the label with its control by id"
  );

  // No panel may hand-roll an input or textarea and skip the helper.
  for (const [name, source] of [["main.js", main], ["panels.js", panels]]) {
    const bare = [...source.matchAll(/\bel\(\s*"(input|textarea)"/g)].map((m) => m[1]);
    assert.deepEqual(
      bare,
      [],
      `${name} creates a bare <${bare[0]}> with el() instead of going through ctx.labelledField() — ` +
        `that control would ship with no accessible name.`
    );
  }
});

test("the sidebar announces asynchronous changes to assistive tech", () => {
  const main = read("zaf-app/assets/main.js");
  // The whole panel is swapped in place on load, on retry, and after an
  // approve/decline re-read. None of that moves focus or navigates.
  assert.ok(/aria-live/.test(main), "the sidebar's root must be a live region");
  assert.ok(/aria-busy/.test(main), "loading must be exposed as aria-busy, not just as a spinner");
  assert.ok(
    (main.match(/setAttribute\("role", "status"\)/g) || []).length >= 1,
    "the approve/decline verdict must be announced"
  );
});

test("the sidebar designs its loading, empty and unreachable states — and can retry", () => {
  const main = read("zaf-app/assets/main.js");

  assert.ok(/function renderLoading\(/.test(main), "loading must be a rendered state, not a blank panel");
  assert.ok(/function renderState\(/.test(main), "empty/error states must be rendered blocks");

  // The error state must NAME the failing service and offer recovery. A
  // swallowed failure is the one thing this whole repo argues against, so the
  // sidebar must not be the surface that swallows one.
  assert.ok(/unreachable/.test(main), "an unreachable API must be named as such");
  assert.ok(/onRetry/.test(main), "an unreachable API must be retryable without reloading Zendesk");
  assert.ok(
    /Do not treat a missing panel as/.test(main),
    "the error state must warn that 'no panel' is not the same claim as 'no case exists'"
  );

  // And the two must stay distinguishable — the original code was careful about
  // this and it must survive the redesign.
  assert.ok(
    /No automated case for this ticket/.test(main),
    "'no case exists' must remain a separate, differently-worded state from 'the API is down'"
  );
});

test("the dashboard exposes its horizontally-clipped tables to the keyboard", () => {
  // Several of the nine tables are wider than the card. A mouse can scroll
  // them; before this, nothing else could, and nothing on screen even said the
  // columns continued.
  const app = read("src/dashboard/assets/app.js");
  assert.ok(/function markClipping\(/.test(app), "the dashboard must detect which tables overflow");
  assert.ok(/setAttribute\("tabindex", "0"\)/.test(app), "an overflowing scroller must be focusable");
  assert.ok(
    /removeAttribute\("tabindex"\)/.test(app),
    "a table that fits must NOT be a tab stop — an empty stop is its own accessibility defect"
  );
  assert.ok(/is-clipped/.test(app), "an overflowing table must be visibly marked as clipped");
});

test("the dashboard never prints a raw JSON blob into a table cell", () => {
  // Three columns carry objects. fmtValue()'s JSON fallback is the right
  // default for an undescribed shape, but it was reaching the page: UC-04's
  // "Cumulative days" rendered {"days":0,"periodsCounted":0} and UC-05's
  // "Notice" a 400-character record truncated mid-key.
  const app = read("src/dashboard/assets/app.js");
  assert.ok(/var SHAPES = \{/.test(app), "the object-shaped columns need named formatters");
  for (const field of ["cumulativeDays", "presenceDays", "notice"]) {
    assert.ok(
      new RegExp("\\b" + field + ":\\s*function").test(app),
      `${field} carries an object and still has no named formatter — it will render as raw JSON`
    );
  }
  // The honest fallback must survive: a shape nobody described still shows its
  // JSON rather than a guess.
  assert.ok(/return null; \/\/ malformed/.test(app), "a malformed value must fall back, not throw or guess");
});
