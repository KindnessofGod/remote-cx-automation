// ---------------------------------------------------------------------------
// thirdPartyRateLimit.test.js — the ceiling on a deliberately open door
// ---------------------------------------------------------------------------
// The third-party door is unauthenticated by design and stays that way. These
// tests pin the bound that was added around it, and — more importantly — pin
// the two properties that make the bound safe to have on THIS door:
//
//   1. It cannot become a VC-33 side channel. It is keyed only on the caller
//      and runs before any lookup, so its refusal is byte-identical whether
//      the enquiry names a real employee or nobody at all. A limiter consulted
//      after the lookup would answer the exact question the door exists to
//      refuse.
//   2. It fails CLOSED. A counter that cannot count cannot bound anything, and
//      "the store is broken" is precisely the moment an unbounded bill runs.
//
// The concurrency test is the one that would catch a rewrite: the durable
// store's guarantee is the primary key and the atomic upsert, not the
// application code, and a check-then-write would pass every other test here.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  consume,
  callerAddress,
  windowStart,
  createMemoryRateLimitStore,
  PER_ADDRESS_PER_HOUR,
  GLOBAL_PER_DAY,
  RATE_LIMITED_CODE,
} from "../src/thirdparty/rateLimit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { startThirdPartyDoorServer } from "../src/thirdparty/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const VALID = {
  requestingParty: "First National Bank",
  purpose: "Mortgage application",
  employmentReference: "AO4T9X",
  subjectName: "Amara Okafor",
  subjectDateOfBirth: "1988-04-12",
  returnAddress: "mortgages@first-national.example.com",
  message: "Please confirm this person's employment status and start date.",
};

async function door(overrides = {}) {
  const remote = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const server = await startThirdPartyDoorServer(
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      demoSubject: null,
      classify: async (input) => classifyRequestRuleBased(input),
      ...overrides,
    },
    0
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    submit: (body) =>
      fetch(`${base}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, retryAfter: r.headers.get("retry-after"), json: await r.json() })),
    page: () => fetch(`${base}/`).then((r) => r.status),
  };
}

// --- the counter itself ----------------------------------------------------

test("an address is allowed up to its limit and refused after it", async () => {
  const store = createMemoryRateLimitStore();
  const at = { store, address: "203.0.113.9", limits: { perAddressPerHour: 3, globalPerDay: 1000 } };
  assert.equal((await consume(at)).allowed, true);
  assert.equal((await consume(at)).allowed, true);
  assert.equal((await consume(at)).allowed, true);
  const refused = await consume(at);
  assert.equal(refused.allowed, false);
  assert.equal(refused.code, RATE_LIMITED_CODE);
  assert.ok(refused.retryAfterSeconds > 0);
});

test("one address cannot exhaust another's quota", async () => {
  const store = createMemoryRateLimitStore();
  const limits = { perAddressPerHour: 1, globalPerDay: 1000 };
  await consume({ store, address: "a", limits });
  assert.equal((await consume({ store, address: "a", limits })).allowed, false);
  assert.equal((await consume({ store, address: "b", limits })).allowed, true);
});

test("the global ceiling binds even when every request comes from a fresh address", async () => {
  // This is the one that actually bounds the bill. Per-address counting is a
  // speed bump — addresses rotate — so the test rotates them on purpose.
  const store = createMemoryRateLimitStore();
  const limits = { perAddressPerHour: 100, globalPerDay: 5 };
  for (let i = 0; i < 5; i++) {
    assert.equal((await consume({ store, address: `10.0.0.${i}`, limits })).allowed, true, `request ${i}`);
  }
  assert.equal((await consume({ store, address: "10.0.0.99", limits })).allowed, false);
});

test("a window rolls", async () => {
  const store = createMemoryRateLimitStore();
  const limits = { perAddressPerHour: 1, globalPerDay: 1000 };
  const t0 = Date.parse("2026-08-28T10:30:00Z");
  await consume({ store, address: "x", now: t0, limits });
  assert.equal((await consume({ store, address: "x", now: t0 + 60_000, limits })).allowed, false);
  assert.equal((await consume({ store, address: "x", now: t0 + 2 * 3600_000, limits })).allowed, true);
});

test("a broken counter refuses rather than allows", async () => {
  const broken = { kind: "broken", bump: async () => { throw new Error("connection terminated"); } };
  const verdict = await consume({ store: broken, address: "1.2.3.4" });
  assert.equal(verdict.allowed, false, "a limiter that cannot count must not wave traffic through");
  assert.equal(verdict.code, RATE_LIMITED_CODE);
  assert.equal(verdict.degraded, true);
});

test("the refusal never names the store, the error, or the subject", async () => {
  const broken = { kind: "broken", bump: async () => { throw new Error("password authentication failed for user postgres"); } };
  const blob = JSON.stringify(await consume({ store: broken, address: "1.2.3.4" }));
  for (const leak of ["password", "postgres", "authentication", "connection"]) {
    assert.doesNotMatch(blob, new RegExp(leak, "i"), `the refusal leaks "${leak}"`);
  }
});

// --- how the caller is identified -----------------------------------------

test("the platform-set header is preferred over the client-suppliable one", () => {
  assert.equal(
    callerAddress({ headers: { "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "1.1.1.1" } }),
    "198.51.100.7"
  );
  assert.equal(callerAddress({ headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" } }), "198.51.100.7");
  assert.equal(callerAddress({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
  assert.equal(callerAddress({ headers: {} }), "unknown");
});

test("window keys bucket to the boundary, not to the moment", () => {
  const a = windowStart(Date.parse("2026-08-28T10:01:00Z"), 3600_000);
  const b = windowStart(Date.parse("2026-08-28T10:59:00Z"), 3600_000);
  assert.equal(a, b);
  assert.notEqual(a, windowStart(Date.parse("2026-08-28T11:00:00Z"), 3600_000));
});

test("the shipped defaults are a real ceiling, not a placeholder", () => {
  assert.ok(PER_ADDRESS_PER_HOUR > 0 && PER_ADDRESS_PER_HOUR <= 30, "an address limit this high bounds nothing");
  assert.ok(GLOBAL_PER_DAY > 0 && GLOBAL_PER_DAY <= 2000, "a daily ceiling this high is not a cost bound");
});

// --- the door -------------------------------------------------------------

test("the door refuses over-quota submissions with 503 and Retry-After", async () => {
  const { server, submit } = await door({ rateLimits: { perAddressPerHour: 2, globalPerDay: 1000 } });
  try {
    await submit(VALID);
    await submit(VALID);
    const third = await submit(VALID);
    assert.equal(third.status, 503);
    assert.equal(third.json.code, RATE_LIMITED_CODE);
    assert.ok(Number(third.retryAfter) > 0, "a throttled caller is not told when to come back");
  } finally {
    server.close();
  }
});

test("throttling is byte-identical for a real subject and one that does not exist (VC-33)", async () => {
  // The whole risk of putting a limiter on THIS door. If the refusal differed
  // by so much as a field, it would answer "does this person work here?" —
  // which is the one question the door exists to refuse.
  const { server, submit } = await door({ rateLimits: { perAddressPerHour: 0, globalPerDay: 1000 } });
  try {
    const real = await submit(VALID);
    const absent = await submit({ ...VALID, employmentReference: "ZZ9Q9Z" });
    const nonsense = await submit({ ...VALID, employmentReference: "", subjectName: "" });
    assert.deepEqual(real.json, absent.json);
    assert.deepEqual(real.json, nonsense.json);
    assert.equal(real.status, absent.status);
    assert.equal(real.status, nonsense.status);
  } finally {
    server.close();
  }
});

test("GET is never throttled — a visitor who submitted nothing still gets the page", async () => {
  const { server, page } = await door({ rateLimits: { perAddressPerHour: 0, globalPerDay: 0 } });
  try {
    assert.equal(await page(), 200);
    assert.equal(await page(), 200);
  } finally {
    server.close();
  }
});

test("a broken store closes the door rather than opening it", async () => {
  const { server, submit } = await door({
    rateLimitStore: { kind: "broken", bump: async () => { throw new Error("down"); } },
  });
  try {
    assert.equal((await submit(VALID)).status, 503);
  } finally {
    server.close();
  }
});

// --- the property a rewrite would break -----------------------------------

test("concurrent submissions get distinct counts — no check-then-write race", async () => {
  // The durable store's guarantee is an atomic upsert. A read-then-write
  // implementation passes every other test in this file and fails this one,
  // which is the same race that once produced two audit_log rows 30us apart
  // and a duplicate letter to a real customer.
  const store = createMemoryRateLimitStore();
  const seen = await Promise.all(
    Array.from({ length: 50 }, () => store.bump("addr:same", "2026-08-28T10:00:00.000Z"))
  );
  assert.equal(new Set(seen).size, 50, "two concurrent callers were handed the same count");
  assert.equal(Math.max(...seen), 50);
});

test("under concurrency the limit still admits exactly its quota", async () => {
  const store = createMemoryRateLimitStore();
  const limits = { perAddressPerHour: 10, globalPerDay: 1000 };
  const verdicts = await Promise.all(
    Array.from({ length: 40 }, () => consume({ store, address: "burst", limits }))
  );
  assert.equal(verdicts.filter((v) => v.allowed).length, 10);
});
