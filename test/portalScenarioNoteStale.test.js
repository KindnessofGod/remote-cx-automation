// ---------------------------------------------------------------------------
// portalScenarioNoteStale.test.js — a quick-fill's note may not outlive the picker
// ---------------------------------------------------------------------------
// THE REPORT, 2026-09-03, with a screenshot. The note under the UC-04 quick-fills
// read "Signed in as Jane Doe (company admin) now, not Amanda J Walker" directly
// above a sidebar plainly showing Lars van der Berg. Neither was lying; they
// described different moments. showScenarioNote() writes that clause ONCE, in the
// present tense, at click time.
//
// WHAT MAKES IT MORE THAN AN EDGE CASE: the note's own closing sentence is
// "change the person in the sidebar and the same request comes back differently".
// The gesture the note invites is the gesture that falsifies it.
//
// THE WHOLE NOTE IS DROPPED, NOT JUST THE MOVED CLAUSE, and that is the property
// worth pinning. A scenario's own prose is about who is asking too — Lars's says
// "Jane Doe cannot file anything for him — refused on identity", the opposite of
// what happens once the reader IS Lars. Keeping the first half would leave the
// confidently wrong part on screen looking deliberate.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");

function bodyOf(name) {
  const start = APP.indexOf("function " + name + "(");
  assert.ok(start > 0, `${name}() has been renamed`);
  const end = APP.indexOf("\n  function ", start + 10);
  return APP.slice(start, end === -1 ? APP.length : end);
}

function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** The real function against a fake DOM holding one visible note and one hidden one. */
function run(personaName) {
  const visible = { hidden: false, kids: [] };
  const hidden = { hidden: true, kids: [] };
  for (const n of [visible, hidden]) n.appendChild = (node) => n.kids.push(node);
  const sandbox = {
    document: {
      querySelectorAll: () => [visible, hidden],
      createTextNode: (t) => t,
    },
    byId: () => ({ value: "whoever" }),
    personaById: () => (personaName ? { name: personaName } : null),
    clear: (n) => (n.kids.length = 0),
  };
  vm.createContext(sandbox);
  vm.runInContext(stripComments(bodyOf("invalidateScenarioNote")) + "\ninvalidateScenarioNote();", sandbox);
  return { visible: visible.kids.join(""), hidden: hidden.kids.join("") };
}

test("changing the picker by hand replaces the note — the stale claim cannot survive", () => {
  const out = run("Lars van der Berg");
  assert.match(out.visible, /You changed who is signed in to Lars van der Berg/);
  assert.match(out.visible, /no longer applies/);
});

test("NOTHING of the old note survives — not the moved clause, not the scenario's prose", () => {
  // The defect was a note that stayed CONFIDENT while becoming wrong. A partial
  // rewrite would leave "Jane Doe cannot file anything for him" on screen for a
  // reader who is now Lars, which is worse than the sentence it replaced.
  const body = stripComments(bodyOf("invalidateScenarioNote"));
  assert.match(body, /clear\(notes\[i\]\)/, "the note is no longer cleared before rewriting");
  const cleared = body.indexOf("clear(notes[i])");
  const written = body.indexOf("appendChild");
  assert.ok(cleared > 0 && written > cleared, "it writes before clearing, so the old text survives");
});

test("a HIDDEN note is left alone — only the form on screen is rewritten", () => {
  assert.equal(run("Lars van der Berg").hidden, "", "a note for another request type was rewritten too");
});

test("an unresolvable persona still invalidates, and simply does not name anyone", () => {
  // Never leave the stale sentence up because the new persona could not be
  // resolved — the old claim is wrong either way, which is the whole point.
  const out = run(null);
  assert.match(out.visible, /You changed who is signed in\./);
  assert.ok(!out.visible.includes(" to "), "it invented a name it did not have");
});

test("it is bound to the picker's CHANGE event, which only a human fires", () => {
  // Assigning `select.value` from JS fires no `change`, so applyScenario()'s own
  // persona switch never reaches this — that is what makes it safe to bind with
  // no suppression flag, and it must stay a `change` binding for that reason.
  assert.match(
    APP,
    /select\.addEventListener\("change", invalidateScenarioNote\)/,
    "the picker no longer invalidates the scenario note"
  );
});

test("NEGATIVE CONTROL — showScenarioNote still writes the clause this invalidates", () => {
  // If the moved-session sentence were ever removed, these tests would pass
  // while guarding nothing. The defect only exists because that clause exists.
  assert.match(stripComments(bodyOf("showScenarioNote")), /Signed in as/);
});
