// ---------------------------------------------------------------------------
// retry.test.js  —  withRetry(), independent of any call site (issue #32)
// ---------------------------------------------------------------------------
// Pure unit coverage: an injected fn and an injected backoff, no timers, no
// network, no real delay — the suite stays fast and hermetic.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isRetryableStatus } from "../src/shared/retry.js";

const noBackoff = async () => {};

test("a fn that fails twice then succeeds returns success after 3 attempts", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    { backoff: noBackoff }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("a fn that always fails throws after exactly 3 attempts (the default)", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error("permanent");
        },
        { backoff: noBackoff }
      ),
    /permanent/
  );
  assert.equal(calls, 3);
});

test("a fn that succeeds on the first attempt calls backoff zero times", async () => {
  let backoffCalls = 0;
  const result = await withRetry(async () => "immediate", {
    backoff: async () => {
      backoffCalls++;
    },
  });
  assert.equal(result, "immediate");
  assert.equal(backoffCalls, 0);
});

test("backoff is invoked between attempts, never after the final failed attempt", async () => {
  const backoffCallsAt = [];
  await assert.rejects(() =>
    withRetry(
      async () => {
        throw new Error("permanent");
      },
      {
        backoff: async (attempt) => {
          backoffCallsAt.push(attempt);
        },
      }
    )
  );
  // 3 attempts -> backoff after attempt 1 and attempt 2, never after attempt 3.
  assert.deepEqual(backoffCallsAt, [1, 2]);
});

test("onAttempt fires once per attempt with the correct ok/error/attempt fields", async () => {
  const seen = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw new Error("blip");
      return "done";
    },
    { backoff: noBackoff, onAttempt: (info) => seen.push(info) }
  );
  assert.deepEqual(seen, [
    { attempt: 1, ok: false, error: "blip" },
    { attempt: 2, ok: true },
  ]);
});

test("retries is configurable — a caller can ask for fewer or more attempts", async () => {
  let calls = 0;
  await assert.rejects(() =>
    withRetry(
      async () => {
        calls++;
        throw new Error("nope");
      },
      { retries: 1, backoff: noBackoff }
    )
  );
  assert.equal(calls, 1, "retries: 1 means exactly one attempt, no retry at all");
});

// --- shouldRetry (added when withRetry() was wired into the Remote/Zendesk
// REST clients — a 404/400 should never burn extra attempts on a request
// that will never succeed no matter how many times it's repeated) ---------

test("shouldRetry: false stops after the first failure, even with attempts remaining", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error("not found");
        },
        { backoff: noBackoff, shouldRetry: () => false }
      ),
    /not found/
  );
  assert.equal(calls, 1, "a non-retryable failure gets exactly one attempt");
});

test("shouldRetry: default (omitted) retries every failure — existing callers are unaffected", async () => {
  let calls = 0;
  await assert.rejects(() =>
    withRetry(
      async () => {
        calls++;
        throw new Error("transient");
      },
      { backoff: noBackoff }
    )
  );
  assert.equal(calls, 3, "no shouldRetry passed -> the pre-existing 'retry everything' behavior");
});

test("shouldRetry lets a caller retry only SOME failures — a mixed retryable/non-retryable run", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls === 1) {
        const err = new Error("transient");
        err.retryable = true;
        throw err;
      }
      return "ok";
    },
    { backoff: noBackoff, shouldRetry: (err) => err.retryable === true }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

// --- isRetryableStatus ------------------------------------------------------

test("isRetryableStatus: 429 and every 5xx are retryable", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(502), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(599), true);
});

test("isRetryableStatus: 2xx, 3xx, and 4xx other than 429 are NOT retryable", () => {
  assert.equal(isRetryableStatus(200), false);
  assert.equal(isRetryableStatus(201), false);
  assert.equal(isRetryableStatus(304), false);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(403), false);
  assert.equal(isRetryableStatus(404), false, "404 is the one this whole feature exists to NOT retry");
  assert.equal(isRetryableStatus(422), false);
});
