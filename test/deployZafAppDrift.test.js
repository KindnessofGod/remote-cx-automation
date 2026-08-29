// ---------------------------------------------------------------------------
// deployZafAppDrift.test.js — proves assessZafDrift() catches the exact case
// that got past the old version-string-only check (rca-xsbt).
// ---------------------------------------------------------------------------
// Hermetic per CLAUDE.md §6: no network, no git, no fs — assessZafDrift() is
// pure, so every scenario below is just values in, verdict out.
//
// The incident this suite exists to make impossible again: fd15c65 changed
// zaf-app/assets/main.js by 61 lines and did not bump zaf-app/manifest.json.
// Both the installed app and the manifest read v1.10.2, so a version-string
// compare says "in sync" — the FIRST test below reproduces exactly that input
// and asserts it must now come back "drifted", not "in_sync". A checker with
// no test proving it catches the thing is rca-wqq's C-4, paid for three times
// already (persona-leak-audit, verify-isolation, verify-zaf) before this one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { assessZafDrift } from "../scripts/lib/zafDrift.mjs";

test("RED PROOF: same version string, content committed after the install -> drifted, not in_sync", () => {
  // This is fd15c65's exact shape: manifest and installed both v1.10.2, but a
  // zaf-app/ commit landed nine hours after the last install.
  const verdict = assessZafDrift({
    manifestVersion: "1.10.2",
    installedVersion: "1.10.2",
    installedUpdatedAt: "2026-08-22T13:22:20Z",
    treeNewestCommitAt: "2026-08-22T22:31:00Z",
  });
  assert.equal(verdict.status, "drifted");
  assert.match(verdict.reason, /content change landed without a version bump/);
});

test("in sync: same version string, install happened after the newest zaf-app/ commit", () => {
  const verdict = assessZafDrift({
    manifestVersion: "1.10.5",
    installedVersion: "1.10.5",
    installedUpdatedAt: "2026-08-23T00:13:20Z",
    treeNewestCommitAt: "2026-08-23T00:12:58Z",
  });
  assert.equal(verdict.status, "in_sync");
});

test("in sync at the exact instant of install (commit time equals updated_at)", () => {
  const verdict = assessZafDrift({
    manifestVersion: "1.10.5",
    installedVersion: "1.10.5",
    installedUpdatedAt: "2026-08-23T00:13:20Z",
    treeNewestCommitAt: "2026-08-23T00:13:20Z",
  });
  assert.equal(verdict.status, "in_sync");
});

test("drifted: version strings differ outright (the original, still-working case)", () => {
  const verdict = assessZafDrift({
    manifestVersion: "1.10.6",
    installedVersion: "1.10.5",
    installedUpdatedAt: "2026-08-23T00:13:20Z",
    treeNewestCommitAt: "2026-08-23T00:12:58Z",
  });
  assert.equal(verdict.status, "drifted");
  assert.match(verdict.reason, /version strings differ/);
});

test("unknown when the tree's newest commit time could not be read, even if versions match", () => {
  const verdict = assessZafDrift({
    manifestVersion: "1.10.5",
    installedVersion: "1.10.5",
    installedUpdatedAt: "2026-08-23T00:13:20Z",
    treeNewestCommitAt: null,
  });
  assert.equal(verdict.status, "unknown");
  assert.doesNotMatch(verdict.reason, /^in sync$/);
});

test("unknown when the installed app's updated_at could not be read", () => {
  const verdict = assessZafDrift({
    manifestVersion: "1.10.5",
    installedVersion: "1.10.5",
    installedUpdatedAt: undefined,
    treeNewestCommitAt: "2026-08-23T00:12:58Z",
  });
  assert.equal(verdict.status, "unknown");
});

test("unknown when a timestamp is present but unparseable, not silently treated as in_sync", () => {
  const verdict = assessZafDrift({
    manifestVersion: "1.10.5",
    installedVersion: "1.10.5",
    installedUpdatedAt: "not-a-date",
    treeNewestCommitAt: "2026-08-23T00:12:58Z",
  });
  assert.equal(verdict.status, "unknown");
});

test("accepts Date instances as well as ISO strings", () => {
  const verdict = assessZafDrift({
    manifestVersion: "2.0.0",
    installedVersion: "2.0.0",
    installedUpdatedAt: new Date("2026-08-23T00:13:20Z"),
    treeNewestCommitAt: new Date("2026-08-22T00:00:00Z"),
  });
  assert.equal(verdict.status, "in_sync");
});
