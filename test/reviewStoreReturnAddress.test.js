// ---------------------------------------------------------------------------
// reviewStoreReturnAddress.test.js — D-13 (rca-kfg2)
// ---------------------------------------------------------------------------
// "THREE PANELS ON ONE SCREEN DISAGREE ABOUT THE RETURN ADDRESS."
//
// `cases.return_address` was written on every third-party-door case
// (src/shared/caseStore.js `createCase()`) and never selected back by
// PostgresReviewStore.findCaseByExternalRef() — `CASE_COLUMNS` in
// src/review/store.js simply omitted the column. Ticket #114 recorded a
// decision naming a real return address while the sidebar's CASE panel, one
// query away from the same row, read the column as absent and printed "No
// return address on file" underneath it.
//
// POSITIVE TEST LEADS (C-16): this asserts the store actually RETURNS the
// address that was stored, not merely that some string no longer appears —
// a negative-only assertion here would have passed on the broken code too,
// since the broken code never THREW, it just quietly dropped the field.
//
// The fake pgPool below is deliberately not a black-box stub: it inspects the
// SQL text for the exact column the real Postgres schema carries
// (`return_address`) and refuses to answer a query that doesn't ask for it —
// so a future regression that re-drops the column from CASE_COLUMNS fails
// this test on the SELECT itself, not only on the eventual field being
// missing from the response.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresReviewStore } from "../src/review/store.js";
import { getReviewView } from "../src/review/service.js";

function fakePgWithCase(row) {
  return {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (/from review_queue/i.test(normalized)) return { rows: [] };
      if (/from documents/i.test(normalized)) return { rows: [] };
      assert.match(
        normalized,
        /from cases/i,
        `fake pg does not know this statement: ${normalized}`
      );
      assert.match(
        normalized,
        /return_address\s+as\s+"returnAddress"/i,
        "the case SELECT must alias return_address — see D-13"
      );
      return { rows: [row] };
    },
  };
}

test("D-13: PostgresReviewStore returns the third-party return address that was stored on the case row", async () => {
  const row = {
    id: "case-114",
    createdAt: new Date("2026-08-22T12:00:00Z"),
    updatedAt: new Date("2026-08-22T12:00:00Z"),
    useCase: "UC-01",
    source: "third_party_door",
    externalRef: "114",
    employmentId: "emp_active_001",
    requester: "third_party_door",
    classification: JSON.stringify({ requestingParty: "Ravensworth Building Society", purpose: "mortgage underwriting" }),
    decision: "human_review",
    reason: "third_party_request",
    flags: [],
    status: "pending_review",
    returnAddress: "underwriting@ravensworth-bs.example.com",
  };

  const store = new PostgresReviewStore(fakePgWithCase(row));
  const found = await store.findCaseByExternalRef("114");

  assert.equal(
    found.returnAddress,
    "underwriting@ravensworth-bs.example.com",
    "the store must surface the same return address caseStore.js persisted, not drop it"
  );
});

test("D-13: the decision reason for a return address on file and the sidebar's own case panel no longer disagree", async () => {
  const row = {
    id: "case-114",
    createdAt: new Date("2026-08-22T12:00:00Z"),
    updatedAt: new Date("2026-08-22T12:00:00Z"),
    useCase: "UC-01",
    source: "third_party_door",
    externalRef: "114",
    employmentId: "emp_active_001",
    requester: "third_party_door",
    classification: JSON.stringify({}),
    decision: "human_review",
    reason: "third_party_request",
    flags: [],
    status: "pending_review",
    returnAddress: "underwriting@ravensworth-bs.example.com",
  };

  const store = new PostgresReviewStore(fakePgWithCase(row));
  const view = await getReviewView({ ticketId: "114" }, { store });

  // findReviewEntryByCaseId/findDocumentsByCaseId run against the SAME fake
  // pool object (answering empty for review_queue/documents) — so this
  // exercises the exact round trip getReviewView() makes in production
  // against a real Supabase pool.
  assert.equal(view.found, true);
  assert.equal(
    view.case.returnAddress,
    "underwriting@ravensworth-bs.example.com",
    "the sidebar's CASE panel reads view.case.returnAddress directly (zaf-app/assets/panels.js) — it must carry the same value the decision note promised"
  );
});

test("a case with no captured return address still comes back as null, not a missing key", async () => {
  const row = {
    id: "case-1",
    createdAt: new Date("2026-08-22T12:00:00Z"),
    updatedAt: new Date("2026-08-22T12:00:00Z"),
    useCase: "UC-01",
    source: "zendesk",
    externalRef: "1001",
    employmentId: "emp_active_001",
    requester: "emp_active_001",
    classification: JSON.stringify({}),
    decision: "auto_resolve",
    reason: "all_gates_passed",
    flags: [],
    status: "resolved",
    returnAddress: null,
  };

  const store = new PostgresReviewStore(fakePgWithCase(row));
  const found = await store.findCaseByExternalRef("1001");

  assert.equal("returnAddress" in found, true, "the key must be present so the sidebar's show() fallback runs deliberately, not on an absent property");
  assert.equal(found.returnAddress, null);
});
