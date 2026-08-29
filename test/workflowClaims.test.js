// ---------------------------------------------------------------------------
// workflowClaims.test.js — exactly-once, and the honesty about when it isn't
// ---------------------------------------------------------------------------
// The value of this module is a guarantee, so these tests are about the
// guarantee's EDGES rather than its happy path: what it does when the ledger is
// missing, when it is broken, and when two use cases share one ticket.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { claimExternalRef, findClaimDecision } from "../src/shared/workflowClaims.js";

/** A fake pool with a real (use_case, external_ref) uniqueness constraint. */
function fakePool() {
  const rows = new Set();
  return {
    rows,
    queries: 0,
    async query(_sql, [useCase, ref]) {
      this.queries++;
      const key = `${useCase}:${ref}`;
      if (rows.has(key)) return { rowCount: 0 };
      rows.add(key);
      return { rowCount: 1 };
    },
  };
}

test("1. the first caller wins and every later one loses", async () => {
  const pgPool = fakePool();
  const args = { pgPool, useCase: "UC-04", externalRef: "1234" };

  assert.equal((await claimExternalRef(args)).claimed, true);
  assert.equal((await claimExternalRef(args)).claimed, false);
  assert.equal((await claimExternalRef(args)).claimed, false);
});

test("2. concurrent callers produce exactly one winner", async () => {
  // The bug this module exists to prevent was a RACE — three near-simultaneous
  // deliveries of one ticket. Sequential calls would pass even with a
  // check-then-act implementation, so fire them together.
  const pgPool = fakePool();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      claimExternalRef({ pgPool, useCase: "UC-06", externalRef: "race-1" })
    )
  );
  assert.equal(results.filter((r) => r.claimed).length, 1, "exactly one caller may proceed");
});

test("3. the same ticket may be claimed once per use case", async () => {
  // UC-03 routes an inquiry on to UC-04. Keying on the ref alone would make the
  // handoff look like a duplicate and silently drop it — a worse failure than
  // the duplicate it prevents, because a dropped request looks like nothing
  // happened at all.
  const pgPool = fakePool();
  assert.equal((await claimExternalRef({ pgPool, useCase: "UC-03", externalRef: "77" })).claimed, true);
  assert.equal((await claimExternalRef({ pgPool, useCase: "UC-04", externalRef: "77" })).claimed, true);
  assert.equal((await claimExternalRef({ pgPool, useCase: "UC-03", externalRef: "77" })).claimed, false);
});

test("4. a numeric ref and its string form are the same claim", async () => {
  // Zendesk ids arrive as a number from one path and a string from another.
  const pgPool = fakePool();
  assert.equal((await claimExternalRef({ pgPool, useCase: "UC-05", externalRef: 42 })).claimed, true);
  assert.equal((await claimExternalRef({ pgPool, useCase: "UC-05", externalRef: "42" })).claimed, false);
});

test("5. an absent ref is processed, never dropped", async () => {
  // A request with no external reference cannot be a duplicate DELIVERY of
  // anything. Refusing it would turn a missing optional field into a lost
  // customer request.
  const pgPool = fakePool();
  for (const externalRef of [null, undefined, ""]) {
    const r = await claimExternalRef({ pgPool, useCase: "UC-02", externalRef });
    assert.equal(r.claimed, true, `ref ${JSON.stringify(externalRef)} must proceed`);
  }
  assert.equal(pgPool.queries, 0, "no ref means no ledger round-trip at all");
});

test("6. with no ledger the request proceeds AND says the guarantee did not apply", async () => {
  // The honesty that matters: a caller must be able to tell "claimed because
  // nothing was contending" from "claimed because nothing was checking".
  const first = await claimExternalRef({ pgPool: null, useCase: "UC-02", externalRef: "same" });
  const second = await claimExternalRef({ pgPool: null, useCase: "UC-02", externalRef: "same" });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, true, "an unconfigured store must not silently dedupe");
  assert.equal(first.ledgerUnavailable, true);
  assert.equal(second.ledgerUnavailable, true);
});

test("7. an unreachable ledger fails OPEN, and flags that it did", async () => {
  // Deliberate: a duplicate is visible in the audit log afterwards, whereas a
  // dropped request is not — nobody knows to go looking for it. Both outcomes
  // are bad; only one is detectable.
  const brokenPool = {
    async query() {
      throw new Error("connection terminated unexpectedly");
    },
  };
  const r = await claimExternalRef({ pgPool: brokenPool, useCase: "UC-09", externalRef: "5" });
  assert.equal(r.claimed, true, "a broken ledger must not stop a legitimate request");
  assert.equal(r.ledgerUnavailable, true);
  assert.match(r.error, /connection terminated/);
});

test("8. the claim is one statement, not a read followed by a write", async () => {
  // The implementation detail that IS the guarantee. A check-then-insert has a
  // gap a concurrent caller slips through; ON CONFLICT DO NOTHING has none.
  // Asserted by counting round-trips: two would mean a gap exists.
  const pgPool = fakePool();
  await claimExternalRef({ pgPool, useCase: "UC-04", externalRef: "one-shot" });
  assert.equal(pgPool.queries, 1, "a second query would be a read-then-write race");
});

// ---------------------------------------------------------------------------
// findClaimDecision() — D-26: recovering what a WINNING claim recorded, so a
// caller who just lost a claim can be told which existing identity it names
// instead of minting one that resolves to nothing. src/thirdparty/server.js
// and src/uc01/selfServiceLetter.js are its two callers.
// ---------------------------------------------------------------------------

/** A fake pool that actually stores `decision`, unlike fakePool() above. */
function fakePoolWithDecisions() {
  const rows = new Map(); // "useCase:ref" -> decision
  return {
    rows,
    async query(sql, params) {
      const q = sql.replace(/\s+/g, " ").trim();
      if (/^insert into workflow_claims/i.test(q)) {
        const [useCase, ref, decision] = params;
        const key = `${useCase}:${ref}`;
        if (rows.has(key)) return { rows: [], rowCount: 0 };
        rows.set(key, decision);
        return { rows: [{ external_ref: ref }], rowCount: 1 };
      }
      if (/^select decision from workflow_claims/i.test(q)) {
        const [useCase, ref] = params;
        const key = `${useCase}:${ref}`;
        return rows.has(key) ? { rows: [{ decision: rows.get(key) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query in fakePoolWithDecisions: ${q}`);
    },
  };
}

test("9. findClaimDecision recovers exactly what the winning claim recorded", async () => {
  const pgPool = fakePoolWithDecisions();
  await claimExternalRef({ pgPool, useCase: "UC-01", externalRef: "intake:abc:1", decision: "ref-first-submission" });

  const found = await findClaimDecision({ pgPool, useCase: "UC-01", externalRef: "intake:abc:1" });
  assert.equal(found, "ref-first-submission");
});

test("10. findClaimDecision returns null for a claim that was never made", async () => {
  const pgPool = fakePoolWithDecisions();
  const found = await findClaimDecision({ pgPool, useCase: "UC-01", externalRef: "intake:never-claimed:1" });
  assert.equal(found, null);
});

test("11. findClaimDecision degrades to null with no pgPool, never throws", async () => {
  const found = await findClaimDecision({ pgPool: null, useCase: "UC-01", externalRef: "anything" });
  assert.equal(found, null);
});

test("12. findClaimDecision degrades to null (not a throw) when the ledger itself is unreachable", async () => {
  const brokenPool = {
    async query() {
      throw new Error("connection terminated unexpectedly");
    },
  };
  const found = await findClaimDecision({ pgPool: brokenPool, useCase: "UC-01", externalRef: "anything" });
  assert.equal(found, null);
});
