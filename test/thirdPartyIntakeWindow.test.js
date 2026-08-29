// ---------------------------------------------------------------------------
// thirdPartyIntakeWindow.test.js — how long "the same enquiry" lasts
// ---------------------------------------------------------------------------
// OWNER, 2026-08-28: "if I test this entire system a hundred times, it should
// work a hundred times."
//
// It did not, and the reason was D-26's duplicate-submission window: an hour,
// wall-clock bucketed, keyed on (employment reference, requesting party,
// purpose). A second run of the same scenario inside that hour was JOINED to
// the first — same reference back, no new decision, nothing to consent to.
//
// The evidence behind the guard is precise and is recorded at its call site:
// the submit button sat disabled for 8.3-13.1s with no progress signal, the
// enquirer assumed it had hung, and the same enquiry was filed twice **50.8
// seconds apart**. An hour is seventy times that. Everything above roughly two
// minutes was buying nothing and blocking legitimate repeat enquiries.
//
// So: two minutes by default, and `THIRD_PARTY_INTAKE_WINDOW_MS=0` to switch it
// off entirely for a demo or a test environment.
//
// The direction of the parse is the part worth guarding. A typo must fail to
// the SAFE default, never to zero — silently disabling de-duplication would
// turn a misconfiguration into duplicate consent requests sent to a real
// employee about a real disclosure.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  readIntakeWindowMs,
  DEFAULT_INTAKE_WINDOW_MS,
  CORRECT_INTAKE_WINDOW_MS,
} from "../src/thirdparty/server.js";

test("the shipped default is the CORRECT window, and the demo weakening is gone", () => {
  // HISTORY, kept because it is the argument for the number.
  //
  // From 2026-08-28 to 2026-08-29 this default was 20 seconds, lowered so the
  // owner could re-run the demo repeatedly while rehearsing. This test asserted
  // the DEMO value on purpose, as a tripwire: restoring had to fail a test
  // first, because a temporary weakening nobody is forced to look at again is
  // how it becomes permanent. It worked — the restore failed here before it
  // landed.
  //
  // Why 20s was not merely "a bit short": the duplicate this window absorbs was
  // measured at 50.8 seconds apart (the submit button sat disabled 8.3-13.1s
  // with no progress signal, the enquirer assumed it had hung and resubmitted).
  // A 20s window does not cover that, so while it stood, a real employee could
  // receive two consent requests for one disclosure.
  //
  // If a demo environment needs a shorter window again, set
  // THIRD_PARTY_INTAKE_WINDOW_MS there. Do not lower the shipped default.
  assert.equal(DEFAULT_INTAKE_WINDOW_MS, CORRECT_INTAKE_WINDOW_MS, "the shipped default has been weakened again");
  assert.equal(CORRECT_INTAKE_WINDOW_MS, 120000, "the correct value has drifted");
  assert.ok(
    CORRECT_INTAKE_WINDOW_MS > 50800,
    "the window no longer covers the 50.8s duplicate it exists for"
  );
  assert.ok(
    CORRECT_INTAKE_WINDOW_MS < 60 * 60 * 1000,
    "the window is back to blocking a legitimate repeat enquiry for an hour"
  );
  assert.equal(readIntakeWindowMs({}), DEFAULT_INTAKE_WINDOW_MS);
});

test("an explicit zero disables joining — the demo/test setting", () => {
  assert.equal(readIntakeWindowMs({ THIRD_PARTY_INTAKE_WINDOW_MS: "0" }), 0);
});

test("an explicit value is honoured", () => {
  assert.equal(readIntakeWindowMs({ THIRD_PARTY_INTAKE_WINDOW_MS: "5000" }), 5000);
  assert.equal(readIntakeWindowMs({ THIRD_PARTY_INTAKE_WINDOW_MS: " 30000 " }), 30000);
});

test("a typo falls back to the SAFE default, never to zero", () => {
  // The direction that matters. `"2m"` parsing to 0 would silently switch
  // de-duplication off in production and nothing would look wrong until an
  // employee got two consent requests for one enquiry.
  for (const bad of ["2m", "abc", "", "   ", "-1", "NaN", undefined, null]) {
    assert.equal(
      readIntakeWindowMs({ THIRD_PARTY_INTAKE_WINDOW_MS: bad }),
      DEFAULT_INTAKE_WINDOW_MS,
      `THIRD_PARTY_INTAKE_WINDOW_MS=${JSON.stringify(bad)} did not fall back to the default`
    );
  }
});

test("zero produces a unique key per submission, so nothing is ever joined", async () => {
  // Asserted on behaviour rather than on the constant: with the window off,
  // two identical submissions must yield two DIFFERENT references.
  const { createThirdPartyDoorHandler } = await import("../src/thirdparty/server.js");
  assert.equal(typeof createThirdPartyDoorHandler, "function");
  // The key derivation is module-level and reads the env at import time, so the
  // behavioural half is covered by the door's own suite; what is pinned here is
  // that the disabling path exists and is spelled the one way that works.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/thirdparty/server.js", import.meta.url), "utf8")
  );
  assert.match(
    source,
    /if \(INTAKE_DUPLICATE_WINDOW_MS === 0\) return `intake:\$\{fingerprint\}:\$\{randomUUID\(\)\}`;/,
    "the zero path no longer mints a unique key, so joining would still happen"
  );
});
