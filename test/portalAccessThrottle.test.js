// ---------------------------------------------------------------------------
// portalAccessThrottle.test.js  —  repeated WRONG keys are throttled, and
// nothing else is
// ---------------------------------------------------------------------------
// The defect: checkPortalAccess() compared in constant time and returned, with
// no counter, no lockout and no delay — verified live, eight consecutive wrong
// keys, eight 401s at full speed. Behind that one shared secret sit /audit
// (real audit_log rows) and /queue.
//
// What these tests are really guarding is the OTHER direction. A brute-force
// ceiling is easy; a brute-force ceiling that never touches a legitimate
// key-holder is the hard part, and every way it could go wrong is a test here:
// a success must never count, an absent key must never count (that is the
// ordinary first screen), one address must never be able to lock out another,
// and a broken counter must not lock everyone out of the audit viewer.
//
// HERMETIC. Pure functions plus an injected in-memory counter. No network, no
// pool, no ports bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkPortalAccess,
  checkPortalAccessThrottled,
  portalAccessPosture,
  namespacedRateLimitStore,
  createPortalThrottleStore,
  PORTAL_KEY_HEADER,
  PORTAL_KEY_ENV,
  PORTAL_KEY_FAILURES_PER_HOUR,
  PORTAL_KEY_THROTTLED_CODE,
  PORTAL_KEY_FAILURE_BUCKET_PREFIX,
  OPEN_ACCESS,
} from "../src/portal/access.js";
import { createMemoryRateLimitStore, consume } from "../src/thirdparty/rateLimit.js";

const KEY = "s3cret-portal-key-value";
const GATED = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });

/** A request from one address, with whatever key value (or none). */
function req(address, key) {
  const headers = { "x-forwarded-for": address };
  if (key !== undefined) headers[PORTAL_KEY_HEADER] = key;
  return { headers, socket: { remoteAddress: address } };
}

/** Drive n wrong-key attempts from one address, returning the last verdict. */
async function attempts(store, address, n, { now = Date.now(), key = "wrong" } = {}) {
  let last;
  for (let i = 0; i < n; i += 1) {
    last = await checkPortalAccessThrottled(req(address, key), GATED, { store, now });
  }
  return last;
}

// ---------------------------------------------------------------------------
// Failures throttle.
// ---------------------------------------------------------------------------

test("wrong keys are refused 401 up to the limit, then 429", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  for (let i = 1; i <= PORTAL_KEY_FAILURES_PER_HOUR; i += 1) {
    const verdict = await checkPortalAccessThrottled(req("10.0.0.1", "wrong"), GATED, { store, now });
    assert.equal(verdict.status, 401, `attempt ${i} should still be the ordinary refusal`);
    assert.equal(verdict.body.code, "portal_access_key_invalid");
  }

  const throttled = await checkPortalAccessThrottled(req("10.0.0.1", "wrong"), GATED, { store, now });
  assert.equal(throttled.status, 429);
  assert.equal(throttled.body.code, PORTAL_KEY_THROTTLED_CODE);
});

test("the limit is configurable and the throttle stays tripped for the rest of the window", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  await attempts(store, "10.0.0.2", 3, { now, key: "wrong" });
  for (let i = 0; i < 5; i += 1) {
    const verdict = await checkPortalAccessThrottled(req("10.0.0.2", "wrong"), GATED, {
      store,
      now,
      failuresPerHour: 3,
    });
    assert.equal(verdict.status, 429, "once tripped it stays tripped within the window");
  }
});

// ---------------------------------------------------------------------------
// Successes never throttle. THE point of the design — an owner refreshing
// /audit mid-demo must never be locked out of their own system.
// ---------------------------------------------------------------------------

test("the correct key passes 500 times in a row and consumes no quota", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  for (let i = 0; i < 500; i += 1) {
    const verdict = await checkPortalAccessThrottled(req("10.0.0.3", KEY), GATED, { store, now });
    assert.deepEqual(verdict, { ok: true }, `refresh ${i} must pass`);
  }

  // And the counter is genuinely untouched: a wrong key now still gets the
  // ordinary 401, meaning those 500 successes were not sitting in the bucket.
  const after = await checkPortalAccessThrottled(req("10.0.0.3", "wrong"), GATED, { store, now });
  assert.equal(after.body.code, "portal_access_key_invalid");
});

test("a correct key is admitted even from an address that is already throttled", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  const tripped = await attempts(store, "10.0.0.4", PORTAL_KEY_FAILURES_PER_HOUR + 1, { now });
  assert.equal(tripped.status, 429);

  // The operator who fat-fingered the code eleven times and then got it right
  // is exactly the person this must not shut out.
  assert.deepEqual(
    await checkPortalAccessThrottled(req("10.0.0.4", KEY), GATED, { store, now }),
    { ok: true }
  );
});

test("an ABSENT key is the ordinary first screen and never counts as a guess", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  // A page load that fires many API calls before the reader has typed anything.
  for (let i = 0; i < PORTAL_KEY_FAILURES_PER_HOUR * 5; i += 1) {
    const verdict = await checkPortalAccessThrottled(req("10.0.0.5"), GATED, { store, now });
    assert.equal(verdict.body.code, "portal_access_key_required");
    assert.equal(verdict.status, 401);
  }

  // Still has its full allowance once it starts actually supplying codes.
  const first = await checkPortalAccessThrottled(req("10.0.0.5", "wrong"), GATED, { store, now });
  assert.equal(first.body.code, "portal_access_key_invalid");
});

test("a misconfigured deployment never consumes quota either", async () => {
  const store = createMemoryRateLimitStore();
  const unconfigured = portalAccessPosture({ VERCEL: "1" }, { persistent: false });
  const now = Date.UTC(2026, 7, 29, 10, 5);

  for (let i = 0; i < 50; i += 1) {
    const verdict = await checkPortalAccessThrottled(req("10.0.0.6", "anything"), unconfigured, { store, now });
    assert.equal(verdict.body.code, "portal_access_key_not_configured");
  }
});

// ---------------------------------------------------------------------------
// One address cannot lock out another — the DoS this control could have been.
// ---------------------------------------------------------------------------

test("one address exhausting its quota leaves every other address untouched", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  const attacker = await attempts(store, "203.0.113.9", PORTAL_KEY_FAILURES_PER_HOUR * 10, { now });
  assert.equal(attacker.status, 429);

  // A neighbour typo-ing their own code gets the ordinary refusal, not the
  // attacker's lockout.
  const neighbour = await checkPortalAccessThrottled(req("198.51.100.4", "typo"), GATED, { store, now });
  assert.equal(neighbour.status, 401);
  assert.equal(neighbour.body.code, "portal_access_key_invalid");

  // And the neighbour's CORRECT key is unaffected, which is the case that
  // matters: no volume of third-party failures can shut a key-holder out.
  assert.deepEqual(
    await checkPortalAccessThrottled(req("198.51.100.4", KEY), GATED, { store, now }),
    { ok: true }
  );
});

test("no global ceiling is enforced: the global bucket is counted, never consulted", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  // Many distinct addresses, each below its own limit. If a global cap existed
  // this would eventually refuse somebody who had guessed only twice.
  for (let a = 0; a < 60; a += 1) {
    for (let i = 0; i < 2; i += 1) {
      const verdict = await checkPortalAccessThrottled(req(`10.1.0.${a}`, "wrong"), GATED, { store, now });
      assert.equal(verdict.body.code, "portal_access_key_invalid", `address ${a} must not be throttled by others`);
    }
  }
});

// ---------------------------------------------------------------------------
// The buckets are our own — the two limiters cannot exhaust each other.
// ---------------------------------------------------------------------------

test("key-failure counting lands under its own prefix, apart from the third-party door", async () => {
  const seen = [];
  const store = {
    kind: "spy",
    async bump(key, start) {
      seen.push(key);
      return 1;
    },
  };
  await checkPortalAccessThrottled(req("10.0.0.7", "wrong"), GATED, { store, now: Date.UTC(2026, 7, 29, 10, 5) });

  assert.ok(seen.length >= 1);
  for (const key of seen) {
    assert.ok(key.startsWith(PORTAL_KEY_FAILURE_BUCKET_PREFIX), `bucket "${key}" must be namespaced`);
  }
  assert.ok(seen.includes(`${PORTAL_KEY_FAILURE_BUCKET_PREFIX}addr:10.0.0.7`));
  // The door's own buckets — `addr:<addr>` and `global` — are never touched.
  assert.ok(!seen.includes("global"));
  assert.ok(!seen.includes("addr:10.0.0.7"));
});

test("the third-party door's own quota survives a flood of key failures, and vice versa", async () => {
  const shared = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  // 200 key-guessing failures against the portal, from many addresses.
  for (let a = 0; a < 20; a += 1) {
    await attempts(shared, `10.2.0.${a}`, 10, { now });
  }

  // The consent door, sharing the same table, is completely unaffected — its
  // global daily ceiling has not been nibbled at.
  const door = await consume({ store: shared, address: "10.2.0.0", now });
  assert.deepEqual(door, { allowed: true });
});

// ---------------------------------------------------------------------------
// The throttled response leaks nothing.
// ---------------------------------------------------------------------------

test("the throttled body is one fixed literal and reveals nothing about the key or the count", async () => {
  const store = createMemoryRateLimitStore();
  const now = Date.UTC(2026, 7, 29, 10, 5);

  await attempts(store, "10.0.0.8", PORTAL_KEY_FAILURES_PER_HOUR, { now });

  // Two callers, one guessing a near-miss and one guessing nonsense, both far
  // past the limit: byte-identical bodies.
  const nearMiss = await checkPortalAccessThrottled(
    req("10.0.0.8", KEY.slice(0, -1)),
    GATED,
    { store, now }
  );
  const nonsense = await checkPortalAccessThrottled(req("10.0.0.8", "zzzzzzzz"), GATED, { store, now });
  const missing = await checkPortalAccessThrottled(req("10.0.0.8", "  "), GATED, { store, now });

  assert.equal(nearMiss.status, 429);
  assert.deepEqual(nonsense, nearMiss, "a near miss and a wild guess must be indistinguishable");

  const text = [nearMiss.body.reason, nearMiss.body.why, ...nearMiss.body.howToFix].join(" \n ");
  assert.ok(!text.includes(KEY), "the real key must never appear");
  assert.ok(!text.includes(KEY.slice(0, -1)), "the attempted value must never be echoed");
  assert.ok(!/\d/.test(text), `must not state a count, a limit or a countdown: ${text}`);
  assert.ok(!/attempt|remaining|left|tries left|close/i.test(text), `must not hint at attempts remaining: ${text}`);

  // Developer vocabulary stays out of the employee-facing gate (R7-43 / D-08).
  for (const jargon of ["durable store", "audit_log", "rate limit", "bucket", "Postgres", "anonymous caller"]) {
    assert.ok(!text.includes(jargon), `throttled copy must not read as developer output: "${jargon}"`);
  }

  // A blank header is "absent", so it is NOT counted — but it must not become
  // an oracle either: it simply gets the ordinary required-code screen.
  assert.equal(missing.body.code, "portal_access_key_required");
});

// ---------------------------------------------------------------------------
// The window rolls.
// ---------------------------------------------------------------------------

test("the hour rolls and the address gets a fresh allowance", async () => {
  const store = createMemoryRateLimitStore();
  const hourOne = Date.UTC(2026, 7, 29, 10, 55);

  const tripped = await attempts(store, "10.0.0.9", PORTAL_KEY_FAILURES_PER_HOUR + 1, { now: hourOne });
  assert.equal(tripped.status, 429);

  // Still throttled at the end of the same hour...
  const stillInHour = await checkPortalAccessThrottled(req("10.0.0.9", "wrong"), GATED, {
    store,
    now: hourOne + 4 * 60 * 1000,
  });
  assert.equal(stillInHour.status, 429);

  // ...and clear in the next one.
  const nextHour = Date.UTC(2026, 7, 29, 11, 0);
  const afterRoll = await checkPortalAccessThrottled(req("10.0.0.9", "wrong"), GATED, { store, now: nextHour });
  assert.equal(afterRoll.status, 401);
  assert.equal(afterRoll.body.code, "portal_access_key_invalid");
});

// ---------------------------------------------------------------------------
// Degradation — the fail-OPEN decision, and why it is the opposite of the
// third-party door's.
// ---------------------------------------------------------------------------

test("a broken counter does not lock a key-holder out of the audit viewer", async () => {
  const broken = {
    kind: "broken",
    async bump() {
      throw new Error("ENOTFOUND db.your-project-ref.supabase.co");
    },
  };
  const now = Date.UTC(2026, 7, 29, 10, 5);

  // The correct key still works — the key, not the counter, is the control.
  assert.deepEqual(await checkPortalAccessThrottled(req("10.0.0.10", KEY), GATED, { store: broken, now }), {
    ok: true,
  });
  // And a wrong key still gets the ordinary refusal rather than a 429 nobody
  // can clear: a counter that cannot count has not made the secret weaker.
  const wrong = await checkPortalAccessThrottled(req("10.0.0.10", "wrong"), GATED, { store: broken, now });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, "portal_access_key_invalid");
});

test("with no store injected, behaviour is byte-identical to checkPortalAccess", async () => {
  const cases = [req("10.0.0.11", KEY), req("10.0.0.11", "wrong"), req("10.0.0.11")];
  for (const r of cases) {
    assert.deepEqual(await checkPortalAccessThrottled(r, GATED), checkPortalAccess(r, GATED));
  }
});

test("an open posture is still a no-op, store or not", async () => {
  const store = createMemoryRateLimitStore();
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(
      await checkPortalAccessThrottled(req("10.0.0.12", "anything"), OPEN_ACCESS, { store }),
      { ok: true }
    );
  }
});

// ---------------------------------------------------------------------------
// Wiring helpers.
// ---------------------------------------------------------------------------

test("createPortalThrottleStore picks postgres when a pool is attached, memory otherwise", () => {
  assert.equal(createPortalThrottleStore(null).kind, "memory");
  assert.equal(createPortalThrottleStore(undefined).kind, "memory");
  assert.equal(createPortalThrottleStore({ query: async () => ({ rows: [{ hits: 1 }] }) }).kind, "postgres");
});

test("namespacedRateLimitStore prefixes every key it is given", async () => {
  const seen = [];
  const wrapped = namespacedRateLimitStore({ kind: "spy", bump: async (k) => (seen.push(k), 1) }, "pfx:");
  await wrapped.bump("addr:1.2.3.4", "2026-08-29T10:00:00.000Z");
  await wrapped.bump("global", "2026-08-29T00:00:00.000Z");
  assert.deepEqual(seen, ["pfx:addr:1.2.3.4", "pfx:global"]);
});
