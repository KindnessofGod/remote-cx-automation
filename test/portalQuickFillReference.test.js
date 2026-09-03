// ---------------------------------------------------------------------------
// portalQuickFillReference.test.js — a quick-fill DECIDES, it does not replay
// ---------------------------------------------------------------------------
// THE DEFECT, MEASURED LIVE ON THE DEPLOYMENT 2026-09-01.
//
// `applyScenario()` used to call `setRefMode(type, "reuse")` for any scenario
// that pinned an `externalRef` — 41 of them across five use cases, `4001`…`4015`
// on UC-04 alone. Every workflow claims its reference in `workflow_claims`
// before its first durable write, and those references were claimed weeks ago.
// So on the shared deployment the FIRST click a new reader made returned a
// duplicate-delivery REPLAY of a stranger's decision. All fifteen UC-04
// quick-fills were driven in a real browser and not one of them decided
// anything.
//
// It is the same shape CLAUDE.md §6 already records one use case over: "every
// portal scenario was a one-shot… a tester who generated a new reference and
// expected a new decision got the replay and read the reference control as
// broken."
//
// AND THE REPLAY PANEL IS NOT A HONEST REFUSAL EITHER — it renders "Accepted /
// Ready for a specialist's approval" beside "TRIP LENGTH not determined" and a
// tax-residency row reading "Not reached — a hard block decided this request",
// which is false; nothing blocked it. That half is its own finding; this file
// pins the half that stops a reader reaching the replay at all.
//
// WHAT WAS TRADED AWAY: nothing. The comment being replaced justified the pin
// as "how several of them demonstrate the duplicate-delivery refusal", and NO
// scenario in that file is that demonstration — asserted below, so the
// justification cannot come back without the thing it describes.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");

/**
 * The body of applyScenario() with its COMMENTS STRIPPED.
 *
 * Stripping is not tidiness — the first draft of this file asserted against the
 * raw source and failed on its OWN fix, because the comment explaining what was
 * removed necessarily spells the call it removed. A guard that cannot tell a
 * line of code from a line of prose about that code will fail every time the
 * change is documented, which is exactly when it should pass.
 */
function applyScenarioBody() {
  const start = APP.indexOf("function applyScenario(");
  assert.ok(start > 0, "applyScenario() has been renamed");
  const end = APP.indexOf("\n  function ", start + 10);
  return APP.slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("a quick-fill never switches the form to reuse — it mints a fresh reference", () => {
  const body = applyScenarioBody();

  assert.doesNotMatch(
    body,
    // `[^;]*`, NOT `[^)]*`. The real call is
    // setRefMode(id.replace(<suffix>, ""), <mode>) — its first argument
    // contains a close-paren, so a `[^)]*` bound stops short and matches
    // nothing. The first draft of this guard used exactly that and its own
    // negative control PASSED against the restored defect: a guard that cannot
    // fail on the bug it names is not a guard. Bounded to one statement so it
    // cannot reach across into unrelated code.
    /setRefMode\([^;]*"reuse"/,
    "a quick-fill forces reuse mode again, so every scenario replays a claimed reference instead of deciding"
  );

  // The mechanism it must rely on instead: "new" is the default mode, and
  // reference() mints when the mode is not reuse.
  assert.match(APP, /function refMode\(typeId\)/);
  assert.match(APP, /refMode\(typeId\) === "reuse"/);
});

test("the UC-03 CONTINUATION still shares its reference, and that is a different thing", () => {
  // The continuation deliberately submits UC-03's own reference so both
  // decisions land under one string in the audit trail. It is not a quick-fill
  // and must not be swept up by the fix above — the server re-derives the ref
  // from the durable UC-03 row regardless, so this only keeps the page honest
  // about what it is about to send.
  const idx = APP.indexOf('setRefMode("uc04", "reuse")');
  assert.ok(idx > 0, "the continuation no longer pins the shared reference");
  const around = APP.slice(idx - 700, idx);
  assert.match(around, /shared reference|audit trail/i, "the surviving reuse call is not the continuation's");
});

test("NO scenario claims to be the duplicate-delivery demonstration", () => {
  // The justification for pinning described a thing nothing did. This asserts
  // the absence directly, so the comment cannot be restored without a scenario
  // that actually demonstrates it — at which point pinning ONE reference is
  // defensible and pinning forty-one is still not.
  const block = APP.slice(APP.indexOf("var SCENARIOS"), APP.indexOf("function applyScenario("));
  const labels = [...block.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length > 20, "the scenario block was not located");
  const dup = labels.filter((l) => /duplicat|repeat|redeliver|again/i.test(l));
  assert.deepEqual(dup, [], `a scenario now names duplication (${dup}) — re-read whether pinning is right for it`);
});

test("every pinned reference is still WRITTEN to the box, so the duplicate demo stays one click away", () => {
  // Nothing was deleted. The value lands in the reuse box; switching the radio
  // shows and submits it. Submitting normally first and THEN switching replays
  // your OWN request, which is a better demonstration than colliding with a
  // stranger's claim.
  const body = applyScenarioBody();
  assert.match(body, /setFieldValue\(node, scenario\.fields\[id\]\)/, "scenario values are no longer written to their fields");
  assert.match(APP, /if \(reuse && !input\.value && lastRef\[typeId\]\)/, "the reuse box no longer prefills from the last reference used");
});
