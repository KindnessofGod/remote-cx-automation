// ---------------------------------------------------------------------------
// personaNoteSourcePathLeak.test.js — rca-qhw9 (round-7 R7-11)
// ---------------------------------------------------------------------------
// The employee portal's persona picker renders each persona's `note` verbatim
// into the page (src/portal/assets/app.js's renderPersonaNote(),
// `byId('persona-note').textContent = current.note`). The alex persona's note
// once read "...the same one src/livedemo/employees.js uses for the
// real-ticket demo..." — a repo file path shown to a real employee, who has no
// way to know what it means and no business seeing it.
//
// This asserts the OBSERVABLE OUTPUT (what listPersonas() actually sends to
// the browser), not the note text of one persona by name — so it also catches
// a future persona whose note is written the same careless way, not just a
// regression of this one string.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { listPersonas } from "../src/portal/personas.js";

const SOURCE_PATH_PATTERN = /\bsrc\/[A-Za-z0-9_./-]*\.js\b/;

test("no persona note leaks a repo source path to the employee", () => {
  const personas = listPersonas();
  assert.ok(personas.length > 0, "expected at least one persona");

  for (const persona of personas) {
    assert.doesNotMatch(
      persona.note || "",
      SOURCE_PATH_PATTERN,
      `persona "${persona.id}" note leaks a source path: ${persona.note}`
    );
  }
});
