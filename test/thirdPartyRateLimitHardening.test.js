// ---------------------------------------------------------------------------
// thirdPartyRateLimitHardening.test.js — the counter closes itself at birth
// ---------------------------------------------------------------------------
// `third_party_rate_limit` was the ONE table in this project that Supabase's
// linter flagged as `rls_disabled_in_public` (2026-09-01), and it was the only
// one for a structural reason: every other table is created by a migration,
// and this one is created by the application on first use. So an ALTER run by
// hand against the live database fixes production and leaves a fresh
// environment born open.
//
// These tests pin the fix at the place that reproduces — the creation path —
// rather than trusting the state of one database. The load-bearing assertion is
// the REVOKE, not the RLS: row-level security does not govern TRUNCATE, so
// enabling RLS alone would still leave `anon` able to wipe the counters that
// bound an unauthenticated, publicly-linked door.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPgRateLimitStore } from "../src/thirdparty/rateLimit.js";

/** A pool that records every statement and answers the upsert plausibly. */
function recordingPool() {
  const statements = [];
  return {
    statements,
    async query(sql, params) {
      statements.push(String(sql));
      if (/INSERT INTO third_party_rate_limit/i.test(sql)) {
        return { rows: [{ hits: 1 }] };
      }
      return { rows: [] };
    },
  };
}

const normalise = (sql) => sql.replace(/\s+/g, " ").trim();

test("the table is created AND closed, in that order, on first use", async () => {
  const pool = recordingPool();
  const store = createPgRateLimitStore(pool);
  await store.bump("addr:198.51.100.7", new Date(0).toISOString());

  const create = pool.statements.findIndex((s) => /CREATE TABLE IF NOT EXISTS third_party_rate_limit/i.test(s));
  const harden = pool.statements.findIndex((s) => /ENABLE ROW LEVEL SECURITY/i.test(s));

  assert.ok(create >= 0, "the table is still created on first use");
  assert.ok(harden >= 0, "the creation path must also close the table");
  assert.ok(
    create < harden,
    "the table cannot be altered before it exists — CREATE must come first"
  );
});

test("RLS alone is not enough: the grant is revoked too", async () => {
  // THE NEGATIVE CONTROL FOR THIS WHOLE FILE. RLS governs SELECT/INSERT/UPDATE/
  // DELETE and NOT truncate, which is privilege-only. A fix that enabled RLS and
  // stopped there would leave `anon` able to TRUNCATE the counters — defeating
  // the ceiling entirely while the linter went green. If someone deletes the
  // REVOKE, this test is what notices.
  const pool = recordingPool();
  const store = createPgRateLimitStore(pool);
  await store.bump("global", new Date(0).toISOString());

  const harden = pool.statements.find((s) => /ENABLE ROW LEVEL SECURITY/i.test(s));
  assert.ok(harden, "expected a hardening statement");

  const sql = normalise(harden).toUpperCase();
  assert.match(sql, /REVOKE ALL ON THIRD_PARTY_RATE_LIMIT FROM ANON, AUTHENTICATED/);
});

test("hardening can never take the door down — it swallows two conditions, named", async () => {
  // A limiter that refused traffic because it could not tighten its own
  // permissions would turn a security improvement into the outage that
  // migrations/0004's header exists to avoid. But a blanket catch would also
  // hide a real fault, so the tolerance is enumerated: a role that may create
  // without owning, and a Postgres that has no Supabase roles.
  const pool = recordingPool();
  const store = createPgRateLimitStore(pool);
  await store.bump("addr:203.0.113.9", new Date(0).toISOString());

  const harden = normalise(
    pool.statements.find((s) => /ENABLE ROW LEVEL SECURITY/i.test(s))
  ).toUpperCase();

  assert.match(harden, /EXCEPTION/, "must not throw on a privilege it lacks");
  assert.match(harden, /WHEN INSUFFICIENT_PRIVILEGE THEN/);
  assert.match(harden, /WHEN UNDEFINED_OBJECT THEN/);
  assert.doesNotMatch(
    harden,
    /WHEN\s+OTHERS/,
    "a blanket handler would hide a real fault as well as a tolerable one"
  );
});

test("hardening is paid once per pool, not once per request", async () => {
  // The hot path of a page whose whole problem was doing too much work per
  // request. `ensuredPools` already guarantees this for the CREATE; the
  // hardening rides the same promise and must not add a round trip per call.
  const pool = recordingPool();
  const store = createPgRateLimitStore(pool);
  const at = new Date(0).toISOString();
  await store.bump("addr:198.51.100.7", at);
  await store.bump("addr:198.51.100.7", at);
  await store.bump("addr:198.51.100.7", at);

  const hardenings = pool.statements.filter((s) => /ENABLE ROW LEVEL SECURITY/i.test(s));
  assert.equal(hardenings.length, 1, "three submissions, one hardening");
});
