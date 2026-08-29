// ---------------------------------------------------------------------------
// uc01OutOfScopeIdempotency.test.js — rca-bds: Node/n8n parity for the
// out_of_scope idempotency claim
// ---------------------------------------------------------------------------
// rca-qdc (commit 93884e7) moved the n8n graph's `Out of Scope?` branch
// downstream of `Claim Ticket (Idempotency)`, closing an unbounded-reply loop
// (F-3): a redelivered out-of-scope ticket used to re-run the whole gate
// chain and post a second customer-facing reply every time. The owner
// ratified that shape in rca-jsv, and DRIFT-003's final entry in
// qa/SPEC-DRIFT-INDEX.md records the reversal: out_of_scope now leaves ONE
// `workflow_claims` row, not zero.
//
// The Node path (src/uc01/workflow.js) had the identical structural defect —
// its out_of_scope early return sat BEFORE `claimExternalRef()` — flagged as
// a deliberate, out-of-scope gap in
// qa/handoffs/UC-01/0008-rca-qdc-out-of-scope-loop.md §7. This file proves
// the Node path now matches: a redelivered out-of-scope external ref claims
// exactly once and traces exactly once, with the second delivery answered as
// a duplicate rather than re-run from scratch.
//
// Unlike uc01OutOfScopeTrace.test.js (which asserts the single-delivery
// shape — one trace row, zero cases/review_queue/documents/audit_log rows —
// and is unchanged by this fix), this file is about what happens on
// RE-delivery of the SAME external ref.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

let server;
let remote;
let dir;

before(async () => {
  server = await startMockServer(4129); // uc01OutOfScopeIdempotency-test-only port; see src/shared/ports.js TEST_PORTS
  remote = new RemoteClient({ baseUrl: "http://localhost:4129" });
  dir = mkdtempSync(join(tmpdir(), "uc01-oos-idem-"));
});
after(() => {
  server && server.close();
  dir && rmSync(dir, { recursive: true, force: true });
});

const OUT_OF_SCOPE_TEXT = "Where is the office coffee machine? Also can I get a parking permit?";

test("rca-bds: a redelivered out_of_scope ticket claims exactly ONCE and traces exactly ONCE", async () => {
  const filePath = join(dir, `redelivery-${Math.random().toString(36).slice(2)}.jsonl`);
  const audit = new AuditLogger(filePath);
  const caseStore = new CaseStore();
  const ticket = {
    text: OUT_OF_SCOPE_TEXT,
    employmentId: "emp_active_001",
    session: { authenticatedEmail: "amara@acme.test" },
    source: "zendesk",
    externalRef: "oos-redelivery-1",
  };

  const first = await handleVerificationTicket(ticket, { remote, audit, caseStore, classify: classifyRequestRuleBased });
  const second = await handleVerificationTicket(ticket, { remote, audit, caseStore, classify: classifyRequestRuleBased });
  await audit.flush();

  assert.equal(first.decision, "out_of_scope");
  assert.equal(first.duplicate, undefined, "the first delivery is the real one, not a duplicate");

  // The redelivery must be answered as a duplicate, not re-run: re-running it
  // would re-execute the classifier/gates and write a SECOND trace row, the
  // exact loop shape F-3 found on the n8n path.
  assert.equal(second.duplicate, true, "a redelivered external ref must be recognised, not reprocessed");
  assert.equal(second.decision, "out_of_scope", "the duplicate response still reports what was decided");
  assert.equal(second.caseId, null, "out_of_scope creates no case row, so a duplicate of it references none");

  const lines = existsSync(filePath)
    ? readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  assert.equal(lines.length, 1, `expected exactly one persisted trace row across both deliveries, got ${lines.length}`);
  assert.equal(lines[0].call, "uc01.out_of_scope");
  assert.equal(lines[0].details.externalRef, "oos-redelivery-1");

  // And no cases/review_queue/documents row was created by either delivery —
  // the duplicate-claim shortcut must not become a backdoor into case
  // creation for a decision VC-11 says owns no queue entry.
  assert.equal(caseStore.cases.length, 0);
  assert.equal(caseStore.reviewQueue.length, 0);
  assert.equal(caseStore.documents.length, 0);
});

test("rca-bds: a THIRD delivery is still a duplicate, not a third trace row", async () => {
  // Guards against an off-by-one where only the SECOND call is special-cased.
  const filePath = join(dir, `triple-${Math.random().toString(36).slice(2)}.jsonl`);
  const audit = new AuditLogger(filePath);
  const caseStore = new CaseStore();
  const ticket = {
    text: OUT_OF_SCOPE_TEXT,
    employmentId: "emp_active_001",
    session: { authenticatedEmail: "amara@acme.test" },
    source: "zendesk",
    externalRef: "oos-redelivery-2",
  };

  const results = [];
  for (let i = 0; i < 3; i++) {
    results.push(await handleVerificationTicket(ticket, { remote, audit, caseStore, classify: classifyRequestRuleBased }));
  }
  await audit.flush();

  assert.equal(results[0].duplicate, undefined);
  assert.equal(results[1].duplicate, true);
  assert.equal(results[2].duplicate, true);

  const lines = existsSync(filePath)
    ? readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  assert.equal(lines.length, 1, "three deliveries of the same external ref must still leave exactly one trace row");
});

test("rca-bds: two DIFFERENT out_of_scope tickets each claim and trace independently", async () => {
  // The claim key is (use_case, external_ref) — a different ref must not be
  // blocked by an unrelated ticket's claim, and each gets its own trace row.
  const filePath = join(dir, `distinct-${Math.random().toString(36).slice(2)}.jsonl`);
  const audit = new AuditLogger(filePath);
  const caseStore = new CaseStore();

  const a = await handleVerificationTicket(
    { text: OUT_OF_SCOPE_TEXT, employmentId: "emp_active_001", session: { authenticatedEmail: "amara@acme.test" }, source: "zendesk", externalRef: "oos-a" },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  const b = await handleVerificationTicket(
    { text: OUT_OF_SCOPE_TEXT, employmentId: "emp_active_001", session: { authenticatedEmail: "amara@acme.test" }, source: "zendesk", externalRef: "oos-b" },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  await audit.flush();

  assert.equal(a.duplicate, undefined);
  assert.equal(b.duplicate, undefined);

  const lines = existsSync(filePath)
    ? readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  assert.equal(lines.length, 2, "distinct external refs must each produce their own trace row");
  const refs = lines.map((l) => l.details.externalRef).sort();
  assert.deepEqual(refs, ["oos-a", "oos-b"]);
});
