// ---------------------------------------------------------------------------
// portalScenarioSession.test.js  —  a quick-fill changes WHO, and says so
// ---------------------------------------------------------------------------
// THE REPORT, in the reader's own words: "how do i start as chris lee and end
// up as admin?" — sent with a screenshot of the UC-04 form showing, at the same
// time, a banner reading "Continued from Chris Lee's travel request", a note
// reading "Filled in from '…the same trip, for Amanda'", a sidebar signed in as
// the company admin, and a 403.
//
// TWO SEPARATE FAULTS PRODUCED THAT ONE SCREEN, and this file pins both.
//
// 1. THE LINK OUTLIVED THE TRIP IT LINKED TO. Several UC-04 quick-fills exist
//    precisely to vary the traveller — two of them differ ONLY in who is going —
//    so pressing one writes a different employment id into the form. But
//    applyScenario() called blankForm(), which empties inputs and knows nothing
//    about `pendingContinuation`, so the continuation went on naming the FIRST
//    employee's UC-03 case. The server refused it `continuation_subject_mismatch`
//    and was right to: a work-authorization record must not point at somebody
//    else's trip. Nobody chose to file Amanda's trip against Chris's request; a
//    button did. clearContinuation()'s own header already argued this exact case
//    for the other trigger — "not relying on somebody else's gate to cover our
//    own state" — and had never been wired to this one.
//
// 2. THE SESSION MOVED IN SILENCE. `scenario.persona` reassigns the picker, and
//    nothing said so. A reader who has been swapped without being told does not
//    trust the rest of the screen, which is the same finding continuationOffer's
//    notice was written for one step earlier in the same journey.
//
// WHY THE ASSERTIONS ARE POSITIVE. CLAUDE.md §4: "refusing correctly and being
// unable to succeed look identical from outside." A test that only checked the
// server still refuses a mismatch would have passed against the broken page —
// the refusal WAS the bug's symptom. So the load-bearing assertion is that
// after a quick-fill there is no continuation left to mismatch, and that the
// sentence naming the new session is actually composed.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, "..", "src", "portal", "assets", "app.js"), "utf8");

/** One function's source, by name, up to the next named thing. */
function cut(name, until) {
  const start = SOURCE.indexOf(`function ${name}(`);
  const end = SOURCE.indexOf(until, start);
  assert.ok(start !== -1 && end > start, `${name}() has moved — re-point this test`);
  return SOURCE.slice(start, end);
}

/**
 * The three real functions, in a stub DOM with stub collaborators.
 *
 * WHAT IS REAL AND WHAT IS STUBBED, deliberately: applyScenario(),
 * showScenarioNote() and personaById() come out of the shipped file unmodified.
 * Everything they call that belongs to another concern — filling boxes, marking
 * gaps, the reference radio — is a spy, because this file's subject is the two
 * decisions those three make and not the eighteen boxes underneath them.
 * clearContinuation() is a SPY RATHER THAN A NO-OP so the test can assert it was
 * reached; the function itself is pinned where it lives.
 */
function sandbox({ personas, signedInAs }) {
  const calls = { clearContinuation: 0, blankForm: [], filled: {} };
  const picker = { value: signedInAs };
  const personaNote = { textContent: "" };

  const make = (tag) => ({
    tag,
    className: null,
    textContent: "",
    hidden: false,
    childNodes: [],
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
  });
  const el = (tag, className, text) => {
    const node = make(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const context = {
    document: {
      createElement: make,
      createDocumentFragment: () => make("#fragment"),
      // showScenarioNote() appends bare text, not elements. A text node is a
      // childNode with no tag and no children, which is exactly what textOf()
      // walks — so the stub models it rather than special-casing it.
      createTextNode: (text) => ({ tag: "#text", textContent: String(text), childNodes: [], appendChild() {} }),
    },
    el,
    context: { personas },
    byId: (id) => {
      if (id === "persona") return picker;
      if (id === "persona-note") return personaNote;
      // Every other box is a field this scenario may write into. Recorded so a
      // test can prove the traveller really was replaced — the fact that made
      // the stale link a mismatch rather than a harmless leftover.
      if (!calls.filled[id]) calls.filled[id] = { value: "", type: "text", closest: () => null };
      return calls.filled[id];
    },
    clear: (node) => {
      node.childNodes.length = 0;
      node.textContent = "";
    },
    blankForm: (typeId) => calls.blankForm.push(typeId),
    clearContinuation: () => {
      calls.clearContinuation += 1;
    },
    setFieldValue: (node, raw) => {
      node.value = raw === null || raw === undefined ? "" : String(raw);
    },
    setRefMode: () => {},
    refreshGapMarks: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    [
      cut("personaById", "  function renderPersonaNote("),
      cut("renderPersonaNote", "  function renderExpenses("),
      cut("showScenarioNote", "  function applyScenario("),
      cut("applyScenario", "  function markRequiredFields("),
    ].join("\n"),
    context
  );
  return { context, calls, picker, el, make };
}

/** All the text under a node, in reading order. */
function textOf(node) {
  return node.childNodes.reduce((acc, child) => acc + textOf(child), node.textContent || "");
}

const ROSTER = [
  { id: "chris", name: "Chris Lee", kind: "employee", employmentId: "chris-emp", note: "an employee" },
  { id: "admin", name: "Jane Doe (company admin)", kind: "company_admin", employmentId: null, note: "an admin" },
];

function press(scenario, { signedInAs = "chris", personas = ROSTER } = {}) {
  const box = sandbox({ personas, signedInAs });
  const note = box.make("p");
  const movedFrom = vm.runInContext("applyScenario(TYPE, SCENARIO)", Object.assign(box.context, { TYPE: "uc04", SCENARIO: scenario }));
  vm.runInContext(
    "showScenarioNote(NOTE, SCENARIO, MOVED)",
    Object.assign(box.context, { NOTE: note, MOVED: movedFrom })
  );
  return { ...box, note, movedFrom };
}

// --- 1. THE LINK ----------------------------------------------------------

test("a quick-fill drops the continuation, so it cannot name somebody else's trip", () => {
  // The exact button in the report: same trip, different traveller.
  const amanda = {
    id: "uc04-amanda",
    label: "…the same trip, for Amanda",
    persona: "admin",
    fields: { "uc04-employmentId": "e818418e-1db7-431d-a663-9f477addb8bd", "uc04-destinationCountry": "ES" },
  };

  const { calls } = press(amanda);

  assert.equal(
    calls.clearContinuation,
    1,
    "a quick-fill left the continuation open. It now names a UC-03 case about a different employee than the one this form holds, which the server refuses as continuation_subject_mismatch — a refusal nobody on the page chose."
  );
  // The other half of the mismatch, so this test fails for the RIGHT reason:
  // the traveller really is replaced. Without this assertion the test above
  // would still pass if quick-fills stopped writing an employment id at all.
  assert.equal(calls.filled["uc04-employmentId"].value, "e818418e-1db7-431d-a663-9f477addb8bd");
});

test("blanking the form is not what drops the link — the two are separate calls", () => {
  // blankForm() empties inputs and has never known that `pendingContinuation`
  // exists. Pinning both calls keeps a future "simplification" from folding one
  // into the other and re-opening the gap on whichever type it forgets.
  const { calls } = press({ id: "x", label: "x", persona: "admin", fields: {} });
  assert.deepEqual(calls.blankForm, ["uc04"]);
  assert.equal(calls.clearContinuation, 1);
});

// --- 2. THE SESSION -------------------------------------------------------

test("a quick-fill that moves the session names both people", () => {
  const { note, movedFrom, picker } = press({
    id: "uc04-amanda",
    label: "…the same trip, for Amanda",
    persona: "admin",
    fields: {},
  });

  assert.equal(picker.value, "admin", "the picker did not move");
  assert.equal(movedFrom, "chris", "applyScenario must report who the reader WAS, or the note has nothing to say");

  const text = textOf(note);
  assert.match(
    text,
    /Jane Doe \(company admin\)/,
    "the reader was signed in as somebody else and the note does not name them: this is the report, verbatim — \"how do i start as chris lee and end up as admin?\""
  );
  assert.match(text, /Chris Lee/, "naming only the new person leaves the reader working out whether anything changed at all");
});

test("a quick-fill that keeps the reader as themselves says nothing about the session", () => {
  // The line must appear exactly when something happened. A note that announced
  // the session on every click would be noise, and noise is what a reader skims
  // past on the one click that mattered.
  const { note, movedFrom } = press({ id: "uc04-chris", label: "Filed by the employee", persona: "chris", fields: {} });

  assert.equal(movedFrom, null);
  assert.doesNotMatch(textOf(note), /Signed in as/);
});

test("a scenario naming no persona at all leaves the session alone", () => {
  const { note, movedFrom, picker } = press({ id: "uc04-plain", label: "Low-risk Schengen trip", fields: {} });

  assert.equal(picker.value, "chris");
  assert.equal(movedFrom, null);
  assert.doesNotMatch(textOf(note), /Signed in as/);
});

test("a persona the server did not send is never named", () => {
  // personaById() returns null for an unknown key, and the note stays silent
  // rather than composing an identity this page was not given — the same rule
  // carriedSubjectName() follows for the other direction.
  const { note } = press({ id: "uc04-ghost", label: "ghost", persona: "nobody", fields: {} }, { personas: ROSTER });

  assert.doesNotMatch(textOf(note), /Signed in as/);
});

// --- the label is still the first thing on the line -----------------------

test("the note still leads with which quick-fill was clicked", () => {
  // "which one did I click" was the first question this note was written to
  // answer, and a sentence added in front of it would take that away.
  const { note } = press({ id: "uc04-amanda", label: "…the same trip, for Amanda", persona: "admin", fields: {} });
  assert.match(textOf(note), /^Filled in from “…the same trip, for Amanda”\./);
});
