// ---------------------------------------------------------------------------
// settledDecision.test.js
// ---------------------------------------------------------------------------
// WHAT THIS PINS, AND WHY IT IS ONE FILE RATHER THAN FOUR ADDITIONS
//
// docs/BUILD-LOG.md §3.53 fixed one sentence in one use case: UC-02's
// "This claim has already been released or declined" — a refusal enumerating
// two possibilities on a row that named which, who, when, the note, and whether
// the Remote write landed. The identical sentence was still sitting in four
// other approval policies, on rows carrying the identical facts. This file
// pins the fix across all four at once, because the defect is one pattern and a
// fifth approval policy should be able to read one file to learn the rule.
//
// EVERY ASSERTION COMES IN A PAIR, on purpose:
//   1. the SPECIFIC content is present (which outcome, who, when, whether the
//      downstream write landed), and
//   2. the GENERIC fallback is NOT what got rendered.
//
// The second half is the one that matters. A test that only checks for a
// substring passes just as happily when the generic string happens to contain
// it, which is exactly how "true but weaker" survives a green suite. The
// generic strings themselves stay in each REFUSALS map and are pinned here as
// the honest fallback for a row that genuinely cannot say which outcome it got
// — an honest "we cannot say" beats a confident guess. They should be rare.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import { attribution, noteClause, remoteWriteClause, gateClause } from "../src/shared/settledDecision.js";

import {
  REFUSALS as UC04_REFUSALS,
  describeSettled as uc04Settled,
  describeNoApprovalPath as uc04NoPath,
  evaluateAuthorizationActionability,
} from "../src/uc04/approvalPolicy.js";
import {
  REFUSALS as UC05_REFUSALS,
  describeSettled as uc05Settled,
  describeNoSignoffPath as uc05NoPath,
  evaluateResignationActionability,
} from "../src/uc05/signoffPolicy.js";
import {
  REFUSALS as UC06_REFUSALS,
  describeSettled as uc06Settled,
  evaluateAmendmentActionability,
} from "../src/uc06/dualApprovalPolicy.js";
import {
  REFUSALS as UC09_REFUSALS,
  describeSettled as uc09Settled,
  describeNoApprovalPath as uc09NoPath,
  evaluateAdjustmentActionability,
} from "../src/uc09/multiApprovalPolicy.js";

// ---------------------------------------------------------------------------
// The shared clauses
// ---------------------------------------------------------------------------

test("attribution: every combination of who/when reads as a sentence, and an absent one invents nobody", () => {
  // THE MOMENT IS FORMATTED FOR A PERSON, and that is not cosmetic: `pg` hands
  // back a `Date` object for a `timestamptz` column, so a settled decision read
  // out of Postgres opened "on Wed Aug 19 2026 22:25:07 GMT+0000 (Coordinated
  // Universal Time)" while the same decision read out of memory carried a clean
  // ISO string. Both go through humanTime() now.
  assert.equal(attribution("Dana", "2026-08-19T05:02:11Z"), " by Dana on 19 Aug 2026 at 05:02 UTC");
  assert.equal(attribution("Dana", null), " by Dana");
  assert.equal(attribution(null, "2026-08-19T05:02:11Z"), " on 19 Aug 2026 at 05:02 UTC");
  // An unsigned action is itself worth seeing — no placeholder name is minted.
  assert.equal(attribution(null, null), "");
  assert.equal(attribution("   ", "  "), "");
});

test("noteClause: an expected-but-missing reason is reported, an optional one is silent", () => {
  assert.equal(noteClause("valid"), " Note left: “valid”.");
  assert.equal(noteClause(""), "");
  const missing = noteClause("", { expected: true, missing: "No reason was recorded, which a denial is supposed to carry." });
  assert.match(missing, /No reason was recorded/);
});

test("remoteWriteClause: a human saying yes and the write landing are told apart", () => {
  const landed = remoteWriteClause({ id: "wa_1" }, { landed: "The work authorization was created at Remote.", artifact: "the work authorization" });
  assert.equal(landed, " The work authorization was created at Remote.");

  // The whole point: no result recorded must NOT read as a completed write.
  const unknown = remoteWriteClause(null, { landed: "The work authorization was created at Remote.", artifact: "the work authorization" });
  assert.match(unknown, /may not have reached Remote/);
  assert.match(unknown, /check the audit trail/);
  assert.doesNotMatch(unknown, /was created at Remote\./);
});

test("gateClause: a reason with no gate row yields nothing rather than a fabricated position", () => {
  const describe = (reason) => (reason === "known" ? { position: 4, gate: "Ownership", means: "It is not theirs." } : null);
  assert.deepEqual(gateClause(describe, "known"), { at: " at gate 4 (Ownership)", means: " It is not theirs." });
  assert.deepEqual(gateClause(describe, "unheard_of"), { at: "", means: "" });
});

// ---------------------------------------------------------------------------
// UC-04 — work authorization
// ---------------------------------------------------------------------------

test("UC-04 already_decided names which, who, when and whether the Remote record exists", () => {
  const row = {
    decision: "ready_for_approval",
    status: "executed",
    approver: "Dana",
    approvedAt: "2026-08-19T05:02:11Z",
    approvalNote: "documents checked",
    remoteResult: { id: "wa_1" },
    workAuthorizationId: "wa_1",
  };
  const verdict = evaluateAuthorizationActionability({ authorizationRow: row });
  assert.equal(verdict.code, "already_decided"); // the machine-readable slug survives
  // FACTS, NOT A PARAGRAPH — see settledFacts(). Each is asserted where it
  // now lives rather than as one run-on sentence.
  assert.match(verdict.reason, /^Approved\./m);
  assert.match(verdict.reason, /^Approved by: Dana$/m);
  assert.match(verdict.reason, /^Approved on: 19 Aug 2026 at 05:02 UTC$/m);
  // "UPDATED at Remote", not "created" — nothing in this system creates a work
  // authorization. The request is raised by the employee in Remote's Request
  // Hub; there is no `POST /v1/work-authorization-requests` to create one with.
  assert.match(verdict.reason, /updated at Remote \(reference wa_1\)/);
  assert.match(verdict.reason, /documents checked/);
  assert.notEqual(verdict.reason, UC04_REFUSALS.already_decided.reason);
});

test("UC-04 an approval that was never TRANSMITTED says so, rather than reading as a landed write", () => {
  // THE CASE A TRUTHY CHECK GETS WRONG. An approval with no linked Remote
  // request settles its row with a transmission record — which is an object, so
  // truthy, so `remoteWriteClause()` alone would announce that the write landed.
  // That is precisely the overstatement these sentences exist to remove.
  const settled = uc04Settled({
    status: "executed",
    approver: "Dana",
    approvedAt: "2026-08-19T05:02:11Z",
    remoteResult: {
      transmitted: false,
      reason: "no_remote_work_authorization_request",
      detail: "no Remote work-authorization request is linked to this decision",
    },
  });
  assert.match(settled, /^Sent to Remote: No — /m);
  assert.doesNotMatch(settled, /updated at Remote/);
  // THE HONESTY STATEMENT IS LOAD-BEARING and must survive every rewrite of
  // this copy: a human said yes and Remote holds nothing.
  assert.match(settled, /The approval is real and recorded; the Remote request it would have updated does not exist\./);
});

test("UC-04 an approval with no Remote result says the authorization may not exist", () => {
  const settled = uc04Settled({ status: "executed", approver: "Dana", approvedAt: "2026-08-19T05:02:11Z" });
  assert.match(settled, /may not have reached Remote/);
  assert.notEqual(settled, UC04_REFUSALS.already_decided.reason);
});

test("UC-04 a decline with no reason recorded is called out rather than left blank", () => {
  const settled = uc04Settled({ status: "declined", declinedBy: { approver: "Ana", at: "2026-08-19T06:00:00Z", note: null } });
  assert.match(settled, /^Declined\./m);
  assert.match(settled, /^Declined by: Ana$/m);
  assert.match(settled, /^Declined on: 19 Aug 2026 at 06:00 UTC$/m);
  assert.match(settled, /which a decline is supposed to carry/);
});

// BACKWARD COMPATIBILITY, AS A MUST-SUCCEED TEST. Rows written before the
// 2026-08-19 `deny` -> `decline` rename carry `status: "denied"` and the slot
// under `deniedBy`. They are real decisions and must keep describing
// themselves; falling through to the generic "already been approved or
// declined" sentence would turn a recorded verdict into "we cannot say".
test("UC-04 a LEGACY `denied` row still describes itself, naming who and why", () => {
  const settled = uc04Settled({
    status: "denied",
    deniedBy: { approver: "Ana", at: "2026-08-19T06:00:00Z", note: "outside policy" },
  });
  assert.match(settled, /^Declined by: Ana$/m);
  assert.match(settled, /^Declined on: 19 Aug 2026 at 06:00 UTC$/m);
  assert.match(settled, /outside policy/);
  assert.notEqual(settled, UC04_REFUSALS.already_decided.reason);
});

test("UC-05 a LEGACY `denied` row still describes itself", () => {
  const settled = uc05Settled({
    status: "denied",
    deniedBy: { approver: "hr_ops_jane", at: "2026-08-19T06:00:00Z", note: "recalculate" },
  });
  assert.match(settled, /Already DECLINED by hr_ops_jane/);
  assert.match(settled, /recalculate/);
});

test("UC-06 a LEGACY `denied` row still describes itself, naming the role", () => {
  const settled = uc06Settled({
    status: "denied",
    deniedBy: { role: "payroll_specialist", approver: "pay_pat", at: "2026-08-19T06:00:00Z", note: "after cutoff" },
  });
  assert.match(settled, /Already DECLINED by pay_pat \(payroll_specialist\)/);
  assert.match(settled, /after cutoff/);
});

test("UC-04 not_awaiting_approval names the gate and what it meant, not 'escalation or block'", () => {
  const blocked = evaluateAuthorizationActionability({
    authorizationRow: { decision: "blocked", status: "blocked", reason: "sanctioned_region" },
  });
  assert.equal(blocked.code, "not_awaiting_approval");
  assert.match(blocked.reason, /BLOCKED at gate 3 \(sanctions\)/);
  assert.match(blocked.reason, /sanctioned or restricted list/);
  assert.notEqual(blocked.reason, UC04_REFUSALS.not_awaiting_approval.reason);

  const escalated = uc04NoPath({ decision: "escalate", reason: "destination_out_of_scope" });
  assert.match(escalated, /ESCALATED at gate \d+/);
  assert.notEqual(escalated, UC04_REFUSALS.not_awaiting_approval.reason);
});

test("UC-04 falls back to the honest generic when the row cannot say which outcome it got", () => {
  assert.equal(uc04Settled({ status: "something_else" }), UC04_REFUSALS.already_decided.reason);
  assert.equal(uc04NoPath({ decision: "something_else" }), UC04_REFUSALS.not_awaiting_approval.reason);
});

// ---------------------------------------------------------------------------
// UC-05 — resignation notice
// ---------------------------------------------------------------------------

test("UC-05 already_decided names the sign-off and does NOT invent a Remote write", () => {
  const row = {
    decision: "prepared_for_signoff",
    status: "signed_off",
    signedOffBy: { approver: "HR Ops", at: "2026-08-19T07:00:00Z", note: "checked against PL statute" },
  };
  const verdict = evaluateResignationActionability({ resignationRow: row });
  assert.equal(verdict.code, "already_decided");
  assert.match(verdict.reason, /Already SIGNED OFF by HR Ops on 19 Aug 2026 at 07:00 UTC/);
  assert.match(verdict.reason, /checked against PL statute/);
  // UC-05 has no execution endpoint at all, so there is no second fact about a
  // write to doubt. Borrowing UC-04's clause would invent a doubt about
  // something never attempted.
  assert.doesNotMatch(verdict.reason, /may not have reached Remote/);
  assert.notEqual(verdict.reason, UC05_REFUSALS.already_decided.reason);
});

test("UC-05 not_awaiting_signoff names the gate that escalated it", () => {
  const reason = uc05NoPath({ decision: "escalate", reason: "statutory_discrepancy" });
  assert.match(reason, /ESCALATED at gate \d+/);
  assert.notEqual(reason, UC05_REFUSALS.not_awaiting_signoff.reason);
});

test("UC-05 falls back to the honest generic for a row it cannot read", () => {
  assert.equal(uc05Settled({ status: "something_else" }), UC05_REFUSALS.already_decided.reason);
  assert.equal(uc05NoPath({ decision: "something_else" }), UC05_REFUSALS.not_awaiting_signoff.reason);
});

// ---------------------------------------------------------------------------
// UC-06 — contract amendment (dual control)
// ---------------------------------------------------------------------------

test("UC-06 already_decided names BOTH signatures — the thing dual control exists for", () => {
  const row = {
    decision: "dual_approval_required",
    status: "executed",
    executedAt: "2026-08-19T08:00:00Z",
    adminApproval: { approver: "admin@acme.test", at: "2026-08-19T07:50:00Z" },
    payrollApproval: { approver: "payroll@remote.test", at: "2026-08-19T07:59:00Z" },
    remoteResult: { ok: true },
  };
  const verdict = evaluateAmendmentActionability({ amendmentRow: row });
  assert.equal(verdict.code, "already_decided");
  assert.match(verdict.reason, /admin@acme\.test/);
  assert.match(verdict.reason, /payroll@remote\.test/);
  assert.match(verdict.reason, /applied at Remote/);
  assert.notEqual(verdict.reason, UC06_REFUSALS.already_decided.reason);
});

test("UC-06 an executed amendment with no Remote result does not claim the contract changed", () => {
  const settled = uc06Settled({
    status: "executed",
    executedAt: "2026-08-19T08:00:00Z",
    adminApproval: { approver: "admin@acme.test", at: "t" },
    payrollApproval: { approver: "payroll@remote.test", at: "t" },
  });
  assert.match(settled, /may not have reached Remote/);
  assert.doesNotMatch(settled, /applied at Remote\./);
});

test("UC-06 falls back to the honest generic for a row it cannot read", () => {
  assert.equal(uc06Settled({ status: "something_else" }), UC06_REFUSALS.already_decided.reason);
});

// ---------------------------------------------------------------------------
// UC-09 — off-cycle payroll (the one that really moves money)
// ---------------------------------------------------------------------------

test("UC-09 already_decided names every signature and whether the payment reached Remote", () => {
  const row = {
    decision: "dual_approval_required",
    status: "executed",
    executedAt: "2026-08-19T09:00:00Z",
    approvalSlotsRequired: 2,
    requesterApproval: { approver: "admin@acme.test", at: "2026-08-19T08:50:00Z" },
    approverApproval: { approver: "payroll@remote.test", at: "2026-08-19T08:59:00Z" },
    remoteResult: { id: "inc_1" },
  };
  const verdict = evaluateAdjustmentActionability({ adjustmentRow: row });
  assert.equal(verdict.code, "already_decided");
  assert.match(verdict.reason, /requester admin@acme\.test/);
  assert.match(verdict.reason, /approver payroll@remote\.test/);
  assert.match(verdict.reason, /2 of 2 required/);
  assert.match(verdict.reason, /payment was created at Remote/);
  assert.notEqual(verdict.reason, UC09_REFUSALS.already_decided.reason);
});

test("UC-09 an executed adjustment with no Remote result must not read as a completed payment", () => {
  const settled = uc09Settled({
    status: "executed",
    executedAt: "2026-08-19T09:00:00Z",
    approvalSlotsRequired: 3,
    requesterApproval: { approver: "admin@acme.test", at: "t" },
  });
  assert.match(settled, /1 of 3 required/);
  assert.match(settled, /may not have reached Remote/);
  assert.doesNotMatch(settled, /payment was created at Remote/);
});

test("UC-09 not_awaiting_approval says no path was OPENED, not that the floor was lowered", () => {
  const verdict = evaluateAdjustmentActionability({
    adjustmentRow: { decision: "escalate", status: "escalated", reason: "employment_not_active" },
  });
  assert.equal(verdict.code, "not_awaiting_approval");
  assert.match(verdict.reason, /ESCALATED at gate 2 \(employment_status\)/);
  assert.match(verdict.reason, /no approval path was ever opened/);
  assert.match(verdict.reason, /never reached/);
  assert.notEqual(verdict.reason, UC09_REFUSALS.not_awaiting_approval.reason);
});

test("UC-09 falls back to the honest generic for a row it cannot read", () => {
  assert.equal(uc09Settled({ status: "something_else" }), UC09_REFUSALS.already_decided.reason);
  assert.equal(uc09NoPath({ decision: "something_else" }), UC09_REFUSALS.not_awaiting_approval.reason);
});
