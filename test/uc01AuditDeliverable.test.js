// ---------------------------------------------------------------------------
// uc01AuditDeliverable.test.js — K7 (rca-trg6): (b) WARN, DON'T BLOCK.
// ---------------------------------------------------------------------------
// auto_resolve still proceeds when the requester's address is undeliverable —
// that IS the point of (b) over (a) (qa/HUMAN-DECISIONS-REQUIRED.md K7). What
// this proves is the thing that changed: the `audit_log` row for that
// resolution now carries an explicit `deliverable: false` instead of silently
// implying the letter arrived.
//
// Asserts on OBSERVABLE OUTPUT — the actual `details.deliverable` on the
// written audit row — never on the detector's own inputs, matching the
// pattern test/outboxDeliverability.test.js already established. Reuses that
// same detector (`isUndeliverable`, src/outbox/server.js) rather than forking
// a second one, per the bead's own instruction.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

let server;
let remote;

before(async () => {
  server = await startMockServer(4101); // uc01AuditDeliverable-test-only port; TEST_PORTS
  remote = new RemoteClient({ baseUrl: "http://localhost:4101" });
});
after(() => server && server.close());

const ticketRequesterFor = (email) => ({ authenticatedEmail: email });

/** Delegates to the real client, overriding only the returned email — lets a
 * real Sandbox-shaped fixture (mockServer.js's `emp_active_001`) stand in for
 * a persona with a genuinely deliverable address, without forking a second
 * fixture set or touching the shared mock data every other suite reads. */
function withOverriddenEmail(baseRemote, email) {
  return {
    getEmployment: async (id) => {
      const emp = await baseRemote.getEmployment(id);
      return emp ? { ...emp, email } : emp;
    },
    getLegalEntity: (...args) => baseRemote.getLegalEntity(...args),
    listOffboardingsForEmployment: (...args) => baseRemote.listOffboardingsForEmployment(...args),
  };
}

test("K7: auto_resolve to a reserved-domain persona still PROCEEDS, and the audit row carries deliverable:false", async () => {
  // emp_active_001 / amara@acme.test — the same fixture and shape every other
  // UC-01 auto_resolve test already uses. `.test` is RFC 2606 reserved, the
  // exact shape of all 15 real `uc01_auto_resolved` tickets on the live desk.
  const audit = new AuditLogger();
  const r = await handleVerificationTicket(
    {
      text: "standard employment verification letter",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      externalRef: "uc01-deliverable-1",
    },
    { remote, audit, caseStore: new CaseStore(), classify: classifyRequestRuleBased }
  );

  // (b) WARN, DON'T BLOCK — not (a) refuse. This is the ruling itself, not a
  // side effect of the audit-row change: an undeliverable requester must not
  // become a new refusal path.
  assert.equal(r.decision, "auto_resolve");

  const row = audit.forUseCase("UC-01").find((e) => e.details?.externalRef === "uc01-deliverable-1");
  assert.ok(row, "the decision must be durably audited");
  assert.equal(row.action, "auto_resolve");
  assert.equal(row.details.deliverable, false, "a .test address must not be recorded as delivered");
});

test("K7 POSITIVE CONTROL: auto_resolve to a real-domain persona records deliverable:true", async () => {
  const audit = new AuditLogger();
  const realDomainRemote = withOverriddenEmail(remote, "someone@remote.com");
  const r = await handleVerificationTicket(
    {
      text: "standard employment verification letter",
      session: ticketRequesterFor("someone@remote.com"),
      employmentId: "emp_active_001",
      externalRef: "uc01-deliverable-2",
    },
    { remote: realDomainRemote, audit, caseStore: new CaseStore(), classify: classifyRequestRuleBased }
  );

  assert.equal(r.decision, "auto_resolve");

  const row = audit.forUseCase("UC-01").find((e) => e.details?.externalRef === "uc01-deliverable-2");
  assert.ok(row);
  assert.equal(row.action, "auto_resolve");
  assert.equal(row.details.deliverable, true, "a real domain is the positive control — a page/row that flagged everything would look identical to a working one");
});

test("deliverable is null on a decision with no letter — the field states nothing about a resolution that never happened", async () => {
  const audit = new AuditLogger();
  const r = await handleVerificationTicket(
    {
      text: "Please send me a standard employment verification letter, and can you also confirm my salary on it?",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      externalRef: "uc01-deliverable-3",
    },
    { remote, audit, caseStore: new CaseStore(), classify: classifyRequestRuleBased }
  );

  assert.equal(r.decision, "human_review");
  const row = audit.forUseCase("UC-01").find((e) => e.details?.externalRef === "uc01-deliverable-3");
  assert.ok(row);
  assert.equal(row.details.deliverable, null);
});
