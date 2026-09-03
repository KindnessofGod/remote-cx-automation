// ---------------------------------------------------------------------------
// uc04SeedWorld.test.js — the UC-04 demo seed must read the world its fixtures
//                          live in, not whichever world the server talks to
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS (found 2026-08-30 by starting `npm run uc04-api` on a
// machine with a real REMOTE_API_TOKEN, which is every machine this is ever
// demonstrated on).
//
// `seed()` builds its six cases through a RemoteClient. That client used to be
// whichever one the server was about to serve with — the real Sandbox whenever
// a token existed. The seed's cases all name `emp_active_001`, which is a MOCK
// fixture: the Sandbox 404s it, `getEmployment()` answers null, and UC-04's
// identity gate correctly refuses. So all six seeded cases came up
// `escalate / identity_not_verified`, and the sidebar's UC-04 demo showed six
// identity failures and nothing else — no `ready_for_approval`, no `blocked`,
// none of the risk spread the seed's own labels describe.
//
// WHY NO TEST CAUGHT IT, WHICH IS THE PART WORTH KEEPING. A test process has no
// token, so `config.remote.token` is absent, so the mock answered and the seed
// worked perfectly. The defect existed only where a credential existed. That is
// the same shape as CLAUDE.md §3.30's: "structurally cannot succeed" and
// "appropriately cautious" are indistinguishable from outside, and the gate was
// working correctly throughout.
//
// This test is STRUCTURAL because `seed()` is not exported and the failure is a
// wiring choice rather than a computation. It reads the source with comments
// stripped, so the prose above can describe the bug without satisfying the
// assertions that forbid it.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/uc04/cli.js", import.meta.url), "utf8");

/** The file with comments removed, so a comment can never satisfy a check. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = code(SRC);

test("the seed is built through a client of its own, not the server's", () => {
  assert.match(CODE, /const\s+seedRemote\s*=\s*new RemoteClient\(/);
  assert.match(CODE, /seed\(\s*seedRemote\s*,/, "seed() must be handed seedRemote");
  // Anchored on the CALL, not the declaration — `async function seed(remote,`
  // is the parameter name and is none of this test's business.
  assert.doesNotMatch(
    CODE,
    /(?<!function )\bseed\(\s*remote\s*,/,
    "seed() must not be handed the server's client — that is the defect: on a machine with a real token it reads the Sandbox for a mock employment id"
  );
});

test("the seed's client points at the local mock, never at configured Remote", () => {
  // Not `[^}]*` — the URL is a template literal and `${SEED_PORT}` carries its
  // own closing brace, which truncated an earlier version of this match.
  const seedLine = CODE.match(/const\s+seedRemote\s*=\s*new RemoteClient\([\s\S]*?\);/)?.[0] ?? "";
  assert.match(seedLine, /localhost:\$\{SEED_PORT\}/, "the seed client must address the in-process mock");
  assert.doesNotMatch(seedLine, /config\.remote/, "the seed client must never carry the configured base URL or token");
});

test("the mock the seed reads is always started, not only in the seeded posture", () => {
  // It used to be started inside the `else` branch, so a durable-store run had
  // no mock at all and the seed had nowhere correct to read from.
  assert.match(CODE, /const\s+mockServer\s*=\s*await startMockServer\(SEED_PORT\)/);
  assert.doesNotMatch(
    CODE,
    /let\s+mockServer\s*=\s*null/,
    "a conditionally-started mock is how the seed came to be read from the wrong world"
  );
});

test("the server keeps the configured client for real traffic", () => {
  // The fix must not go the other way and quietly make the whole API a mock.
  assert.match(CODE, /remote\s*=\s*new RemoteClient\(\{\s*baseUrl:\s*config\.remote\.baseUrl/);
  assert.match(CODE, /startUc04Server\(\{[^}]*\bremote\b/s, "the server is still handed `remote`, not `seedRemote`");
});
