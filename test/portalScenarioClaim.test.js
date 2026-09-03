// ---------------------------------------------------------------------------
// portalScenarioClaim.test.js — the quick-fill row must not claim a fill the
//                                form no longer holds
// ---------------------------------------------------------------------------
// REPORTED 2026-08-30: "I am still so confused as to why this did not prefill",
// against a UC-04 card showing a pressed "Low-risk Schengen trip" chip, the note
// "Filled in from “Low-risk Schengen trip”", and a grid of EMPTY boxes with five
// of them marked "(still needed)".
//
// Nothing had failed to fill. Two mechanisms were both claiming the form:
//
//   - a quick-fill chip, which had filled it, and
//   - applyContinuation(), which runs blankForm("uc04") FIRST — deliberately,
//     because a leftover prior-stay row with a country and no dates makes the
//     server refuse `travel_history_unreadable` for something nobody chose —
//     and then writes back only the five fields UC-03 has a source for.
//
// blankForm() emptied the boxes. The chip row is OUTSIDE the <form>, so its
// `aria-pressed` and its note survived untouched, and the louder of the two
// claims was the one that had been undone. The reader was right and the page
// was wrong.
//
// This is the same class as the persona picker that captioned eleven legal
// relationships "employee" (BUILD-LOG §3.93): nothing false was computed, and
// the screen still contradicted itself.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");

/** Source with comments stripped, so the prose above cannot satisfy a check. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const CODE = code(APP);

function bodyOf(name) {
  const i = CODE.indexOf("function " + name + "(");
  assert.notEqual(i, -1, name + "() has moved — re-point this test");
  // Far enough to cover the function without needing a brace matcher.
  return CODE.slice(i, i + 1800);
}

test("blanking a form also un-presses its quick-fills", () => {
  const fn = bodyOf("blankForm");
  assert.match(
    fn,
    /clearScenarioSelection\(typeId\)/,
    "blankForm() empties the boxes and must therefore withdraw the claim that a scenario filled them"
  );
});

test("clearing a selection un-presses EVERY chip and hides the note", () => {
  const fn = bodyOf("clearScenarioSelection");
  assert.match(fn, /aria-pressed["']\s*,\s*["']false/, "every chip must be un-pressed, not just the active one");
  assert.match(fn, /querySelectorAll\(["']button["']\)/, "it must reach all of the row's buttons");
  assert.match(fn, /note\.hidden = true/, '"Filled in from …" must be hidden, not merely emptied');
  assert.match(fn, /clear\(note\)/, "the note's text must go too — a hidden node still carries it");
});

test("the continuation is the caller that made this visible, and still blanks first", () => {
  // The blanking itself is CORRECT and must not be removed to fix the label:
  // it is what stops a stale prior-stay row producing travel_history_unreadable.
  const fn = bodyOf("applyContinuation");
  assert.match(fn, /blankForm\("uc04"\)/, "the continuation must still start from an empty form");
});

test("the fix is in blankForm, not in the continuation", () => {
  // Putting it in applyContinuation() would leave the next caller that empties
  // the boxes free to keep the label — the defect would come back wearing a
  // different name.
  const fn = bodyOf("applyContinuation");
  assert.doesNotMatch(
    fn,
    /clearScenarioSelection/,
    "the withdrawal belongs to whoever blanks the form, not to one caller of it"
  );
});

test("the note element is found from the row, never by an invented id", () => {
  // renderScenarios() appends the note to the row's PARENT and gives it no id.
  // A second selector here would be a copy that drifts the first time either
  // moves — the same second-copy hazard the persona caption fix refused.
  const render = bodyOf("renderScenarios");
  assert.match(render, /scenario-note/, "renderScenarios still owns the note's class");
  const clearFn = bodyOf("clearScenarioSelection");
  assert.match(clearFn, /row\.parentNode/, "the note must be located relative to the row");
  assert.doesNotMatch(clearFn, /byId\(/, "no invented id — the note has none");
});
