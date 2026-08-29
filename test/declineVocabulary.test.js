// ---------------------------------------------------------------------------
// declineVocabulary.test.js  —  `deny` -> `decline`, and the two ways a rename
//                               of a persisted, on-the-wire verb goes wrong
// ---------------------------------------------------------------------------
// WHAT THIS PINS, AND WHY IT IS A SEPARATE FILE
// The verb rename itself is exercised end to end in test/uc04.test.js,
// test/uc05.test.js, test/uc06.test.js and test/review.test.js — each of those
// asserts that a decline still performs the real write and that the LEGACY
// verb still works. This file pins the two properties those tests depend on
// but none of them owns:
//
//   1. The alias maps INPUT and READS only, and returns anything it does not
//      recognise UNCHANGED. A normaliser that "helpfully" resolves an
//      unrecognised verb is a gate that has stopped gating — the same shape as
//      the prototype-walk defect (finding F-21) where `constructor` resolved to
//      a truthy spec and answered 200.
//   2. The stored-status alias is applied where a Postgres row becomes an
//      in-memory row, in every store that has a `status` column that took
//      `denied`. That is what makes the data migration OPTIONAL: backward
//      compatibility that depends on a human executing SQL is not backward
//      compatibility, and this file is what proves it does not.
//
// The four stores are exercised through a FAKE pgPool rather than a live one,
// which is what keeps the suite hermetic — same idiom as
// test/uc02Review.test.js's legacy-`released` row.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_ALIASES,
  STATUS_ALIASES,
  normalizeDecisionAction,
  canonicalDecisionStatus,
} from "../src/shared/declineVocabulary.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { CaseStore } from "../src/shared/caseStore.js";

test("the maps are exactly the two the rename needs, and nothing else", () => {
  assert.deepEqual(ACTION_ALIASES, { deny: "decline" });
  assert.deepEqual(STATUS_ALIASES, { denied: "declined" });
});

test("`deny` normalises to `decline` — the installed ZAF bundle's verb", () => {
  assert.equal(normalizeDecisionAction("deny"), "decline");
  assert.equal(canonicalDecisionStatus("denied"), "declined");
});

test("anything NOT an alias comes back untouched, so an unknown verb stays unknown", () => {
  // The property that keeps every caller's own ACTIONS check load-bearing.
  for (const input of ["decline", "approve", "signoff", "hold", "denyish", "DENY", "", "constructor", "__proto__"]) {
    assert.equal(normalizeDecisionAction(input), input, `${JSON.stringify(input)} must pass through`);
  }
  for (const input of ["declined", "escalated", "executed", "pending", "Denied", ""]) {
    assert.equal(canonicalDecisionStatus(input), input, `${JSON.stringify(input)} must pass through`);
  }
});

test("a non-string is returned as-is rather than coerced into a valid verb", () => {
  // A JSON body can supply an object or a number. Coercing here would hand the
  // caller's ACTIONS check a string it never sent.
  for (const input of [null, undefined, 42, {}, [], true]) {
    assert.equal(normalizeDecisionAction(input), input);
    assert.equal(canonicalDecisionStatus(input), input);
  }
});

test("the map is frozen, so no caller can teach the vocabulary a new word at runtime", () => {
  assert.throws(() => {
    "use strict";
    ACTION_ALIASES.reject = "decline";
  });
  assert.equal(normalizeDecisionAction("reject"), "reject");
});

// ---------------------------------------------------------------------------
// The read side, store by store. A row written before the rename still says
// `denied` in Postgres; it must read back as a real decision.
// ---------------------------------------------------------------------------

/** A pgPool that answers every query with one legacy row. */
function poolReturning(row) {
  return {
    async query() {
      return { rows: [row], rowCount: 1 };
    },
  };
}

test("UC-04: a legacy `denied` row is canonicalised on the way out of Postgres", async () => {
  const store = new AuthorizationStore({
    pgPool: poolReturning({
      id: "auth-legacy-1",
      status: "denied",
      declinedBy: '{"approver":"mobility_sam","note":"outside policy","at":"2026-08-01T09:00:00Z"}',
      factors: "{}",
      flags: "[]",
      approver: null,
    }),
  });

  const row = await store.findById("auth-legacy-1");
  assert.equal(row.status, "declined", "the stored `denied` is canonicalised on read");
  assert.equal(row.declinedBy.approver, "mobility_sam", "and the slot still names who decided");
  assert.equal(row.declinedBy.note, "outside policy");
});

test("UC-05: a legacy `denied` row is canonicalised on the way out of Postgres", async () => {
  const store = new ResignationStore({
    pgPool: poolReturning({
      id: "res-legacy-1",
      status: "denied",
      declinedBy: '{"approver":"hr_ops_jane","note":"recalculate","at":"2026-08-01T09:00:00Z"}',
      flags: "[]",
      signedOffBy: null,
    }),
  });

  const row = await store.findById("res-legacy-1");
  assert.equal(row.status, "declined");
  assert.equal(row.declinedBy.approver, "hr_ops_jane");
});

test("UC-06: a legacy `denied` row is canonicalised on the way out of Postgres", async () => {
  const store = new AmendmentStore({
    pgPool: poolReturning({
      id: "amd-legacy-1",
      status: "denied",
      declinedBy: '{"role":"payroll_specialist","approver":"payroll_sam","at":"2026-08-01T09:00:00Z"}',
      flags: "[]",
      adminApproval: null,
      payrollApproval: null,
    }),
  });

  const row = await store.findById("amd-legacy-1");
  assert.equal(row.status, "declined");
  assert.equal(row.declinedBy.role, "payroll_specialist");
});

test("the shared `cases` table: a legacy `denied` case status is canonicalised too", async () => {
  // UC-01's ZAF review writes `cases.status`, and this is the one status column
  // that is NOT owned by a per-use-case store.
  const store = new CaseStore({
    pgPool: poolReturning({
      id: "case-legacy-1",
      status: "denied",
      classification: null,
      flags: "[]",
      externalRef: "1001",
    }),
  });

  const row = await store.findById("case-legacy-1");
  assert.equal(row.status, "declined");
});

test("a status the vocabulary does not know passes through the stores untouched", async () => {
  // The map must not round an unrecognised status to the nearest known one —
  // exactly the same under-claiming rule the audit viewer's vocabulary follows.
  const store = new AuthorizationStore({
    pgPool: poolReturning({ id: "x", status: "escalated", factors: "{}", flags: "[]" }),
  });
  const row = await store.findById("x");
  assert.equal(row.status, "escalated");
});
