// ---------------------------------------------------------------------------
// portalTravellerName.test.js — the form names WHO the trip is about
// ---------------------------------------------------------------------------
// THE REPORT, 2026-09-03, from the owner driving the live deployment: signed in
// as Chris Lee, pressed the "Low-risk Schengen trip" quick-fill, and the Zendesk
// ticket named João Silva.
//
// NOTHING WAS WRONG WITH THE TICKET, and that is why this is a UI test and not a
// gate test. That quick-fill files as Jane Doe the company admin ABOUT João, and
// filer ≠ subject is the NORMAL shape of a work authorization — Remote's own
// two-stage model has the employee's manager approve and the employee travel.
// What was missing is that the page announced one of the two switches and not
// the other: the filer change is a sentence on screen, the subject change
// rewrote a raw identifier inside a collapsed panel, under a hint that went on
// saying "Chris Lee by default" after the value had stopped being Chris's.
//
// The invariant these tests pin is DERIVATION. The name must be resolved from
// the box's own value, never written beside each scenario by hand — a second
// copy of a fact the form already holds is the thing that goes stale, and this
// file has paid for that twice (the continuation banner naming the previous
// traveller; the persona caption printing a session role as an engagement).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../src/portal/assets/index.html", import.meta.url), "utf8");

/** A function's source, comments stripped — a guard must read code, not prose about code. */
function bodyOf(name) {
  const start = APP.indexOf("function " + name + "(");
  assert.ok(start > 0, `${name}() has been renamed`);
  const end = APP.indexOf("\n  function ", start + 10);
  return APP.slice(start, end === -1 ? APP.length : end);
}

function stripComments(src) {
  return src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
    .join("\n");
}

/**
 * The real function, run against a two-element fake DOM and a stub roster.
 * Behavioural rather than textual: what a reader is told is the thing at issue.
 */
function run(fieldValue, roster) {
  const out = { textContent: "", classes: new Set() };
  out.classList = {
    toggle: (name, on) => (on ? out.classes.add(name) : out.classes.delete(name)),
    remove: (name) => out.classes.delete(name),
  };
  const sandbox = {
    byId: (id) => (id === "uc04-traveller-name" ? out : id === "uc04-employmentId" ? { value: fieldValue } : null),
    personaNameForEmployment: (v) => roster[v] || null,
  };
  vm.createContext(sandbox);
  vm.runInContext(stripComments(bodyOf("renderTravellerName")) + "\nrenderTravellerName();", sandbox);
  return out;
}

const ROSTER = { "378eee6b-c6db-4484-ba32-7283bd0e2de9": "João Silva", "8ab12460-b568-4c1e-af9d-09b1fabd8f46": "Chris Lee" };

test("the subject is named in words, from the id the form will submit", () => {
  assert.match(run("378eee6b-c6db-4484-ba32-7283bd0e2de9", ROSTER).textContent, /João Silva/);
  assert.match(run("8ab12460-b568-4c1e-af9d-09b1fabd8f46", ROSTER).textContent, /Chris Lee/);
});

test("it says the subject need not be the filer — the whole point of the report", () => {
  const said = run("378eee6b-c6db-4484-ba32-7283bd0e2de9", ROSTER).textContent;
  assert.match(said, /not necessarily the person filing/i, "the sentence no longer separates subject from filer");
});

test("an unrecognised id SAYS SO rather than going blank", () => {
  // Blank reads as "this request has no subject", and it always has one. A
  // hand-typed Sandbox id belongs to nobody on the roster and is legitimate.
  const out = run("00000000-dead-4000-8000-000000000000", ROSTER);
  assert.notEqual(out.textContent, "", "an unknown id renders nothing at all");
  assert.match(out.textContent, /read from Remote/i);
  assert.ok(out.classes.has("is-unknown"), "the unknown case is not marked");
});

test("an EMPTY box renders nothing, and drops the unknown mark with it", () => {
  const out = run("   ", ROSTER);
  assert.equal(out.textContent, "");
  assert.ok(!out.classes.has("is-unknown"), "the mark survives a cleared box");
});

test("NEGATIVE CONTROL — no person's name is written into the renderer", () => {
  // The failure this replaces was a hard-coded "Chris Lee by default" that
  // outlived the value it described. A name spelled here would do it again.
  const body = stripComments(bodyOf("renderTravellerName"));
  for (const name of ["Chris", "João", "Joao", "Silva", "Jane", "Amanda"]) {
    assert.ok(!body.includes(name), `renderTravellerName() spells "${name}" — it must derive, not state`);
  }
  assert.match(body, /personaNameForEmployment\(/, "it no longer resolves through the persona roster");
});

test("the stale hint is gone from the UC-04 form", () => {
  // Scoped to the field this report was about. UC-09's "Employee to be paid"
  // carries the identical hint and the identical shape — an admin filing about
  // somebody else — and is deliberately NOT changed here: it is the money path,
  // so it is its own work order rather than a widening of this one.
  const field = HTML.indexOf('id="uc04-employmentId"');
  assert.ok(field > 0, "the UC-04 subject box has been renamed");
  const label = HTML.lastIndexOf("<label", field);
  const block = HTML.slice(label, HTML.indexOf("</label>", field));
  assert.ok(!block.includes("Chris Lee by default"), "the hint still claims a default the quick-fills overwrite");
  assert.ok(block.includes('id="uc04-traveller-name"'), "the form has no element to name the subject in");
});

test("it is wired to the box's own input event, and after the roster is loaded", () => {
  // setFieldValue() dispatches `input`, so ONE listener covers quick-fills, the
  // persona sync and a continuation prefill without any of them knowing this
  // exists. Ordering matters: personaNameForEmployment() reads context.personas,
  // which renderPersonas() is given.
  const wire = stripComments(bodyOf("wireTravellerName"));
  assert.match(wire, /addEventListener\("input", renderTravellerName\)/);
  assert.match(wire, /renderTravellerName\(\);/, "it never renders the initial value");
  const boot = APP.indexOf("function boot()");
  const personas = APP.indexOf("renderPersonas(data.personas", boot);
  const wired = APP.indexOf("wireTravellerName();", boot);
  assert.ok(personas > 0 && wired > personas, "wireTravellerName() runs before the persona roster exists");
});
