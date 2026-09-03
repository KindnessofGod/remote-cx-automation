// ---------------------------------------------------------------------------
// portalPersonaEmploymentSync.test.js — the subject follows the reader
// ---------------------------------------------------------------------------
// THE TRAP, reported 2026-09-02 by an approving manager driving the live
// deployment as a persona:
//
//   "changing the persona picker does not update #uc04-employmentId, so filing
//    as João Silva submits Chris Lee's employment id and is refused
//    not_your_employment."
//
// The refusal is CORRECT — src/portal/ownership.js puts UC-04 alone in
// SELF_OR_ON_BEHALF_OF, and an employee may file about their own employment and
// nobody else's. What was wrong is that nothing on the form moved when the
// reader did: they believe they are João, and one box still says Chris. A
// correct refusal a user cannot account for reads as a broken system, and in a
// demo it reads as a broken system on camera.
//
// THE ASYMMETRY IS THE RULE, and it is what these tests pin. An EMPLOYEE has
// exactly one permissible value, so filling it in removes no choice. A COMPANY
// ADMIN files on behalf of any of their people, so their box must be left alone
// — overwriting it would be this fix causing the very defect it removes, one
// persona over.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");

/** A function body with its comments stripped — a guard must read code, not prose about code. */
function bodyOf(name) {
  const start = APP.indexOf("function " + name + "(");
  assert.ok(start > 0, `${name}() has been renamed`);
  const end = APP.indexOf("\n  function ", start + 10);
  return APP.slice(start, end === -1 ? APP.length : end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("switching persona re-points the UC-04 subject box", () => {
  // Wired to the SAME function the persona <select> already calls, so there is
  // one path and not a second listener that can be registered out of order.
  assert.match(bodyOf("renderPersonaNote"), /syncEmploymentIdToPersona\(/, "the persona change no longer moves the subject");
  assert.match(APP, /select\.addEventListener\("change", renderPersonaNote\)/, "the picker no longer calls renderPersonaNote");
});

test("ONLY an employee's box is re-pointed — an admin files on behalf of anyone", () => {
  const body = bodyOf("syncEmploymentIdToPersona");
  assert.match(body, /persona\.kind !== "employee"/, "the sync no longer distinguishes an employee from an admin");
  // The guard must RETURN on a non-employee, not fall through to the write.
  const guard = body.indexOf('persona.kind !== "employee"');
  const write = body.indexOf("setFieldValue(");
  assert.ok(guard > 0 && write > guard, "the write is not behind the employee guard");
});

test("a value the reader TYPED is never destroyed", () => {
  // Same rule as suggestIfEmpty on the continuation completions: this may only
  // replace an empty box or one still naming a different PERSONA. An id a
  // person entered by hand belongs to them and survives.
  const body = bodyOf("syncEmploymentIdToPersona");
  assert.match(body, /personaNameForEmployment\(current\)/, "the sync no longer checks whether the current value is a persona's");
  assert.match(body, /current !== ""/, "the sync no longer distinguishes an empty box from a typed one");
});

test("the persona records carry the id this depends on", () => {
  // If the server ever stopped publishing `employmentId` on a persona, the sync
  // would silently no-op and the trap would return. Pinned against the server's
  // own composer rather than the browser's assumption about it.
  const personas = readFileSync(new URL("../src/portal/personas.js", import.meta.url), "utf8");
  assert.match(personas, /employmentId/, "personas no longer publish an employmentId");
});
