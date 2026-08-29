// ---------------------------------------------------------------------------
// uc09RequesterCannotApprove.test.js — you cannot sign off your own payment
// ---------------------------------------------------------------------------
// DRIFT-050. UC-09 is the only use case in this repository that moves real
// money (`submitAdjustmentApproval()` -> `remote.createIncentive()`), and until
// 2026-08-29 its segregation of duties had a hole the size of the person who
// asked.
//
// WHAT WAS WRONG. `evaluateApprovalAction()` compared the incoming approver
// against the three APPROVAL SLOTS — requesterApproval, approverApproval,
// paymentReleaserApproval — and never against `adjustmentRow.requester`, the
// column recording who FILED the adjustment. So the filer could approve their
// own request as `approver` or `payment_releaser`, and every existing control
// still reported satisfied: the floor of two held, two distinct names appeared,
// `isSameApprover()` found no collision. Two signatures, one of them belonging
// to the person the money was going to.
//
// It is the exact failure the four-eyes principle names, and it survived
// because the guard was reading the wrong noun. `docs/adr/0005-dual-control-
// segregation-of-duties.md` describes the intended rule; the code implemented
// the half of it that was easy to see.
//
// WHAT THE RULE IS. The filer may fill the `requester` slot — that slot IS
// their signature, confirming "this is the adjustment I meant to ask for" — and
// no other slot. Anyone else may fill any slot they are entitled to.
//
// The refusal has its own code on purpose. `same_person_cannot_fill_multiple_
// roles` means "you already signed a different slot" and is fixed by finding a
// second person; `requester_cannot_approve_own_adjustment` means "you asked for
// this money" and is fixed by finding a DIFFERENT second person. Collapsing
// them sends whoever reads the audit row after the wrong remedy.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateApprovalAction } from "../src/uc09/multiApprovalPolicy.js";

/** An adjustment sitting in `awaiting_approval` with no slot filled yet. */
function pending({ requester = "dana.okoro@example.com", ...rest } = {}) {
  return {
    id: "adj-1",
    // The two fields evaluateAdjustmentActionability() gates on: the decision
    // must NAME an approval path, and the row must still be pending one.
    status: "pending_approval",
    decision: "multi_approval_required",
    requester,
    employmentId: "emp-1",
    adjustment: { amount: 50_000, currency: "USD" },
    approvalSlotsRequired: 2,
    requesterApproval: null,
    approverApproval: null,
    paymentReleaserApproval: null,
    ...rest,
  };
}

const FILER = "dana.okoro@example.com";
const SOMEONE_ELSE = "sam.reeve@example.com";

test("the filer CANNOT take the approver slot on their own adjustment", () => {
  const out = evaluateApprovalAction({
    adjustmentRow: pending(),
    role: "approver",
    approver: FILER,
    action: "approve",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, "requester_cannot_approve_own_adjustment");
});

test("the filer CANNOT take the payment_releaser slot either — that is the one that pays", () => {
  const out = evaluateApprovalAction({
    adjustmentRow: pending(),
    role: "payment_releaser",
    approver: FILER,
    action: "approve",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, "requester_cannot_approve_own_adjustment");
});

test("the filer MAY sign the requester slot — that slot is their own signature", () => {
  const out = evaluateApprovalAction({
    adjustmentRow: pending(),
    role: "requester",
    approver: FILER,
    action: "approve",
  });
  assert.equal(out.allowed, true, "the fix has over-reached and broken the legitimate path");
});

test("somebody else is unaffected in every slot", () => {
  for (const role of ["requester", "approver", "payment_releaser"]) {
    const out = evaluateApprovalAction({
      adjustmentRow: pending(),
      role,
      approver: SOMEONE_ELSE,
      action: "approve",
    });
    assert.equal(out.allowed, true, `a third party was refused the ${role} slot`);
  }
});

test("identity is compared as a PERSON, not as bytes", () => {
  // The same defence the slot-collision loop already had. A pen test filled
  // three slots as "Bob Smith" / "bob smith" / "BOB SMITH"; a filer who retypes
  // their own address in a different case is the identical bypass.
  for (const spelling of ["Dana.Okoro@Example.com", "  dana.okoro@example.com  ", "DANA.OKORO@EXAMPLE.COM"]) {
    const out = evaluateApprovalAction({
      adjustmentRow: pending(),
      role: "approver",
      approver: spelling,
      action: "approve",
    });
    assert.equal(out.allowed, false, `bypassed by respelling as ${JSON.stringify(spelling)}`);
    assert.equal(out.code, "requester_cannot_approve_own_adjustment");
  }
});

test("the refusal is distinct from the slot-collision refusal", () => {
  // Two different problems with two different remedies. If these ever collapse
  // into one code, whoever reads the audit row is sent after the wrong fix.
  const ownRequest = evaluateApprovalAction({
    adjustmentRow: pending(),
    role: "approver",
    approver: FILER,
    action: "approve",
  });
  const alreadySigned = evaluateApprovalAction({
    adjustmentRow: pending({
      requester: "someone.who.left@example.com",
      requesterApproval: { approver: SOMEONE_ELSE, at: "2026-08-29T00:00:00Z" },
    }),
    role: "approver",
    approver: SOMEONE_ELSE,
    action: "approve",
  });
  assert.equal(ownRequest.code, "requester_cannot_approve_own_adjustment");
  assert.equal(alreadySigned.code, "same_person_cannot_fill_multiple_roles");
  assert.notEqual(ownRequest.code, alreadySigned.code);
});

test("the check runs AFTER the refusals that are more specific about state", () => {
  // Ordering matters for the same reason entitlement is consulted last: a
  // more specific refusal must not be masked by this one. An adjustment that
  // is already settled should say so, not talk about who filed it.
  const settled = evaluateApprovalAction({
    adjustmentRow: pending({ status: "approved" }),
    role: "approver",
    approver: FILER,
    action: "approve",
  });
  assert.equal(settled.allowed, false);
  assert.notEqual(
    settled.code,
    "requester_cannot_approve_own_adjustment",
    "a state refusal was masked by the segregation check"
  );
});

test("it can only ever refuse — there is no input that makes it GRANT anything", () => {
  // The same property the entitlement checker is held to. This block has no
  // branch that fills a slot, counts as an approval, or lowers the floor, so no
  // future call site can be written that uses it to let something through.
  const src = evaluateApprovalAction.toString();
  const idx = src.indexOf("requester_cannot_approve_own_adjustment");
  assert.ok(idx > 0, "the guard has been removed");
  const block = src.slice(Math.max(0, idx - 400), idx + 200);
  assert.doesNotMatch(block, /allowed:\s*true/, "the guard now has a path that returns allowed");
  assert.doesNotMatch(block, /approvalSlotsRequired\s*=/, "the guard now writes the floor");
});

test("the filer MAY deny their own adjustment — that is a withdrawal, not a self-approval", () => {
  // The exclusion is deliberately scoped to `approve`. Denying your own request
  // moves no money and needs nobody else's permission: it is the requester
  // withdrawing what they asked for, and refusing it would strand the row
  // waiting on two people for something only one of them wants.
  //
  // This is the opposite scoping from the ENTITLEMENT check further down the
  // same function, which deliberately covers deny as well — and the difference
  // is the point. Claiming a role you do not hold is a lie whichever verb
  // follows it; asking for money and then changing your mind is not.
  const out = evaluateApprovalAction({
    adjustmentRow: pending(),
    role: "approver",
    approver: FILER,
    action: "deny",
  });
  assert.equal(out.allowed, true, "the filer can no longer withdraw their own request");
  assert.equal(out.code, "deny");
});
