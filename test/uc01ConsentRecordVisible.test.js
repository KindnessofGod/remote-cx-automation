// ---------------------------------------------------------------------------
// uc01ConsentRecordVisible.test.js — D-11 (rca-kfg2), §16 item 11
// ---------------------------------------------------------------------------
// "THE CONSENT ARTIFACT IS REFERENCED AND CANNOT BE PRODUCED."
//
// The internal Zendesk note on a third-party-door case names a consent_records
// row by id ("Consent record: <id> — open it to see who granted it, to whom
// and for what purpose"), and until this fix there was nothing in the app
// frame that could resolve that id: `getReviewView()` deliberately never
// computes `decisionFacts` for third_party_request/awaiting_employee_consent/
// consent_refused (they need `identity`, which a `cases` row does not carry),
// and a Zendesk search for the id finds only the ticket that printed it.
//
// POSITIVE TEST LEADS (C-16): this asserts the specialist CAN open the
// record and read who granted what to whom, not merely that a string no
// longer appears somewhere.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewHandler } from "../src/review/server.js";
import { AuditLogger } from "../src/shared/audit.js";

const THIRD_PARTY_CASE = {
  id: "case-114",
  useCase: "UC-01",
  externalRef: "114",
  employmentId: "emp_active_001",
  source: "third_party_door",
  decision: "human_review",
  reason: "third_party_request",
  flags: ["third_party_request"],
  status: "pending_review",
  returnAddress: "underwriting@ravensworth-bs.example.com",
  classification: {
    intent: "standard_letter",
    confidence: 0.9,
    requestingParty: "Ravensworth Building Society",
    purpose: "mortgage underwriting",
  },
};

function storeFor(caseRow) {
  return {
    async findCaseByExternalRef() { return caseRow; },
    async findReviewEntryByCaseId() { return { id: "rq-1", caseId: caseRow.id, status: "pending" }; },
    async findDocumentsByCaseId() { return []; },
  };
}

async function viewWith({ caseRow = THIRD_PARTY_CASE, findConsentArtifact } = {}) {
  const handler = createReviewHandler({
    store: storeFor(caseRow),
    caseStore: findConsentArtifact ? { findConsentArtifact } : {},
    audit: new AuditLogger(),
    remote: { async getEmployment() { return { id: "emp_active_001", full_name: "Amara Okafor", status: "active" }; } },
  });
  let body;
  const res = {
    statusCode: undefined,
    setHeader() {},
    end(payload) { body = payload ? JSON.parse(payload) : null; },
  };
  await handler({ method: "GET", url: `/api/review/ticket/${caseRow.externalRef}`, headers: {} }, res);
  return { status: res.statusCode, body };
}

test("D-11: a granted consent record is resolved and readable in the view — who granted it, to whom, for what", async () => {
  let calledWith = null;
  const { body } = await viewWith({
    findConsentArtifact: async (args) => {
      calledWith = args;
      return {
        id: "b9957cdc-6510-44d1-87cb-4e7b330c04f5",
        status: "granted",
        requestingParty: "Ravensworth Building Society",
        purpose: "mortgage underwriting",
        grantedByEmploymentId: "emp_active_001",
        grantedAt: "2026-08-20T09:00:00Z",
        createdAt: "2026-08-18T09:00:00Z",
      };
    },
  });

  // Resolved by the SAME triple the original decision used — never a
  // second, browser-side re-derivation.
  assert.deepEqual(calledWith, {
    employmentId: "emp_active_001",
    requestingParty: "Ravensworth Building Society",
    purpose: "mortgage underwriting",
  });

  assert.ok(body.consentRecord, "the view must carry the resolved consent record");
  assert.equal(body.consentRecord.status, "granted");
  assert.equal(body.consentRecord.requestingParty, "Ravensworth Building Society");
  assert.equal(body.consentRecord.purpose, "mortgage underwriting");
  assert.equal(body.consentRecord.grantedByEmploymentId, "emp_active_001");
  assert.equal(body.consentRecord.grantedAt, "2026-08-20T09:00:00Z");
});

test("D-11: a pending (awaiting_employee_consent) record is visible too, not only a granted one", async () => {
  const { body } = await viewWith({
    caseRow: { ...THIRD_PARTY_CASE, decision: "awaiting_employee_consent", reason: "awaiting_employee_consent" },
    findConsentArtifact: async () => ({
      id: "pending-1",
      status: "pending",
      requestingParty: "Ravensworth Building Society",
      purpose: "mortgage underwriting",
      grantedByEmploymentId: null,
      grantedAt: null,
      createdAt: "2026-08-22T09:00:00Z",
    }),
  });
  assert.equal(body.consentRecord.status, "pending");
  assert.equal(body.consentRecord.grantedByEmploymentId, null);
});

test("D-11: no matching row says so explicitly (null), never a silently absent key", async () => {
  const { body } = await viewWith({ findConsentArtifact: async () => null });
  assert.equal("consentRecord" in body, true, "the key must be present so the panel can render an explicit not-found row");
  assert.equal(body.consentRecord, null);
});

test("D-11: a Zendesk-sourced (non-third-party) case never triggers a consent lookup at all", async () => {
  let called = false;
  const { body } = await viewWith({
    caseRow: { ...THIRD_PARTY_CASE, source: "zendesk", externalRef: "1001" },
    findConsentArtifact: async () => { called = true; return null; },
  });
  assert.equal(called, false, "a case with no third-party disclosure in play must not query consent_records at all");
  assert.equal("consentRecord" in body, false);
});

test("D-11: a store without findConsentArtifact degrades safely — no crash, no consentRecord key", async () => {
  const { status, body } = await viewWith({ findConsentArtifact: undefined });
  assert.equal(status, 200);
  assert.equal("consentRecord" in body, false);
});
