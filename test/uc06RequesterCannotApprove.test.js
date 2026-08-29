// ---------------------------------------------------------------------------
// uc06RequesterCannotApprove.test.js — you cannot sign off your own amendment
// ---------------------------------------------------------------------------
// DRIFT-098 `[A-1]`. UC-06 changes an employee's contract — pay, hours, title —
// and its whole claim to an execution path is the dual-control gate. Until
// 2026-08-29 that gate had a hole the size of the person who asked for the
// change.
//
// WHAT WAS WRONG. `evaluateApprovalAction()` compared the incoming approver
// against the two APPROVAL SLOTS — `adminApproval` and `payrollApproval` — and
// never against `amendmentRow.requester`, the column recording who FILED the
// amendment (`src/uc06/workflow.js` captures it, `src/uc06/amendmentStore.js`
// gives it its own column). So the admin who typed the new salary could sign
// the slot confirming they typed it, and every existing control still reported
// satisfied: two roles, two names, `isSameApprover()` finding no collision.
// Four-eyes degraded to two-eyes plus a reviewer, and slot 1 could never
// disagree with its own author.
//
// The exemption was deliberate and argued in a code comment
// (`dualApprovalPolicy.js`, the old "TWO ROLES, NOT ONE" block), and nowhere in
// `docs/adr/0005-dual-control-segregation-of-duties.md`, which exists to argue
// exactly this and requires "two independent people". UC-01 holds
// `self_approval`; UC-09 holds requester ≠ approver ≠ payment_releaser. UC-06
// was the only one of the three that exempted itself.
//
// WHAT THE RULE IS, AND WHERE IT DIFFERS FROM UC-09. UC-09's filer owns a slot
// named `requester` — that slot IS their signature — so there the exclusion
// covers every slot except their own. **UC-06's filer owns no slot at all.**
// Slot 1 is the EMPLOYER'S SIGNATURE (Remote's own
// `awaiting_employer_signature` / `employer_signed_at`), filled by the
// company's signing representative, whom `src/remoteui/roles.js` already models
// as "distinct from the admin USER who operates the console"; slot 2 is a
// Remote-side payroll specialist. `docs/use-cases/UC-06.md` §8: "two people on
// two sides of the relationship, and **neither of them the person who filed the
// request**". So the filer is refused from BOTH slots, and the tests below pin
// that rather than the UC-09 shape.
//
// The refusal has its own code on purpose, and the name is pinned by
// `qa/contracts/UC-06-acceptance.md` §6/§7 (`[A-1]`).
// `same_person_cannot_fill_both_roles` means "you already signed the other
// slot" and is fixed by finding a second person; `requester_cannot_approve`
// means "you asked for this change" and is fixed by finding a DIFFERENT second
// person. Collapsing them sends whoever triages the audit row after the wrong
// remedy.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateApprovalAction, REFUSALS, ROLES } from "../src/uc06/dualApprovalPolicy.js";
import { UNAUTHENTICATED } from "../src/shared/requesterSubject.js";

/** An amendment sitting in dual approval with neither slot filled yet. */
function pending({ requester = "dana.okoro@acme.example", ...rest } = {}) {
  return {
    id: "amd-1",
    // The two fields evaluateAmendmentActionability() gates on: the decision
    // must be the dual-approval path, and the row must still be pending it.
    decision: "dual_approval_required",
    status: "pending_dual_approval",
    requester,
    employmentId: "emp-1",
    changes: { annual_gross_salary: 90_000 },
    adminApproval: null,
    payrollApproval: null,
    ...rest,
  };
}

const FILER = "dana.okoro@acme.example";
const SIGNATORY = "priya.raman@acme.example"; // the employer's signing representative
const SPECIALIST = "raj.mehta@remote.com"; // Remote-side payroll specialist

test("the filer CANNOT take the customer_admin slot — that slot is the EMPLOYER'S signature, not the console operator's", () => {
  const out = evaluateApprovalAction({
    amendmentRow: pending(),
    role: "customer_admin",
    approver: FILER,
    action: "approve",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, "requester_cannot_approve");
});

test("the filer CANNOT take the payroll_specialist slot either", () => {
  const out = evaluateApprovalAction({
    amendmentRow: pending(),
    role: "payroll_specialist",
    approver: FILER,
    action: "approve",
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, "requester_cannot_approve");
});

test("UC-06's filer owns NO slot — every role in ROLES refuses them", () => {
  // The load-bearing difference from UC-09, asserted over ROLES rather than
  // over a hand-written pair, so that adding a third slot (or renaming
  // customer_admin to `employer`, which `[A-2]` will do) cannot quietly
  // introduce one the filer is allowed to fill.
  for (const role of ROLES) {
    const out = evaluateApprovalAction({
      amendmentRow: pending(),
      role,
      approver: FILER,
      action: "approve",
    });
    assert.equal(out.allowed, false, `the filer was allowed into the ${role} slot`);
    assert.equal(out.code, "requester_cannot_approve", `wrong refusal for the ${role} slot`);
  }
});

test("two other people still execute the amendment — the fix has not made the path unreachable", () => {
  // A guard that refuses everybody is not a control, it is an outage. Both
  // directions, or it is a dead gate (qa/contracts/UC-06-acceptance.md §14).
  const first = evaluateApprovalAction({
    amendmentRow: pending(),
    role: "customer_admin",
    approver: SIGNATORY,
    action: "approve",
  });
  assert.equal(first.allowed, true, "the employer's signatory was refused their own slot");

  const second = evaluateApprovalAction({
    amendmentRow: pending({
      adminApproval: { approver: SIGNATORY, at: "2026-08-29T09:00:00Z" },
    }),
    role: "payroll_specialist",
    approver: SPECIALIST,
    action: "approve",
  });
  assert.equal(second.allowed, true, "the payroll specialist was refused after a valid first signature");
});

test("identity is compared as a PERSON, not as bytes", () => {
  // The same defence the slot-collision check already had. A pen test filled
  // both slots as one human using nothing more exotic than a trailing space and
  // a capital letter; a filer retyping their own address in a different case is
  // the identical bypass.
  for (const spelling of [
    "Dana.Okoro@Acme.Example",
    "  dana.okoro@acme.example  ",
    "DANA.OKORO@ACME.EXAMPLE",
  ]) {
    const out = evaluateApprovalAction({
      amendmentRow: pending(),
      role: "customer_admin",
      approver: spelling,
      action: "approve",
    });
    assert.equal(out.allowed, false, `bypassed by respelling as ${JSON.stringify(spelling)}`);
    assert.equal(out.code, "requester_cannot_approve");
  }
});

test("the refusal is DISTINCT from the slot-collision refusal", () => {
  // Two different problems with two different remedies. If these ever collapse
  // into one code, whoever reads the audit row is sent after the wrong fix.
  const ownAmendment = evaluateApprovalAction({
    amendmentRow: pending(),
    role: "customer_admin",
    approver: FILER,
    action: "approve",
  });
  const alreadySigned = evaluateApprovalAction({
    amendmentRow: pending({
      requester: "someone.who.left@acme.example",
      adminApproval: { approver: SIGNATORY, at: "2026-08-29T09:00:00Z" },
    }),
    role: "payroll_specialist",
    approver: SIGNATORY,
    action: "approve",
  });
  assert.equal(ownAmendment.code, "requester_cannot_approve");
  assert.equal(alreadySigned.code, "same_person_cannot_fill_both_roles");
  assert.notEqual(ownAmendment.code, alreadySigned.code);
});

test("the new code is REGISTERED, with a status and a human-readable reason", () => {
  // refuse() destructures REFUSALS[code], so an unregistered code throws rather
  // than producing a refusal with an undefined status — this asserts the
  // registry entry exists rather than relying on that crash to surface it.
  const entry = REFUSALS.requester_cannot_approve;
  assert.ok(entry, "the refusal is not in the REFUSALS registry");
  // 409 is what qa/contracts/UC-06-acceptance.md §6/§7 pins for this refusal.
  // (UC-09's twin uses 403; the contracts differ and this file follows UC-06's.)
  assert.equal(entry.status, 409);
  assert.match(entry.reason, /filed this amendment cannot approve it/);
});

test("the check runs AFTER the refusals that are more specific about state", () => {
  // Ordering matters for the same reason entitlement is consulted last: a more
  // specific refusal must not be masked by a vaguer one. Each of these rows is
  // in a state the reader needs told about, and the answer must be that state —
  // not a lecture about who filed it.
  const cases = [
    ["already settled", pending({ status: "executed", executedAt: "2026-08-28T10:00:00Z" }), "already_decided"],
    ["execution claimed", pending({ status: "executing" }), "execution_in_progress"],
    ["never opened an approval path", pending({ decision: "escalate" }), "not_awaiting_approval"],
    ["no such amendment", null, "amendment_not_found"],
  ];
  for (const [label, amendmentRow, expected] of cases) {
    const out = evaluateApprovalAction({
      amendmentRow,
      role: "customer_admin",
      approver: FILER,
      action: "approve",
    });
    assert.equal(out.allowed, false, `${label}: unexpectedly allowed`);
    assert.equal(out.code, expected, `${label}: a state refusal was masked by the segregation check`);
  }
});

test("it can only ever REFUSE — no input makes it grant anything", () => {
  // The same property the entitlement checker is held to. This block has no
  // branch that fills a slot, counts as an approval, or relaxes the pair
  // requirement, so no future call site can be written that uses it to let
  // something through.
  const src = evaluateApprovalAction.toString();
  const idx = src.indexOf("requester_cannot_approve");
  assert.ok(idx > 0, "the guard has been removed");
  const block = src.slice(Math.max(0, idx - 400), idx + 200);
  assert.doesNotMatch(block, /allowed:\s*true/, "the guard now has a path that returns allowed");
  assert.doesNotMatch(block, /Approval\s*=/, "the guard now writes an approval slot");
});

test("the filer MAY decline their own amendment — that is a withdrawal, not a self-approval", () => {
  // The exclusion is deliberately scoped to `approve`. Declining your own
  // request changes nobody's contract and needs nobody else's permission: it is
  // the requester withdrawing what they asked for, and refusing it would strand
  // the row waiting on two people for something only one of them wants.
  //
  // This is the opposite scoping from the ENTITLEMENT check further down the
  // same function, which deliberately covers decline as well — and the
  // difference is the point. Claiming a role you do not hold is a lie whichever
  // verb follows it; asking for a change and then changing your mind is not.
  for (const role of ROLES) {
    const out = evaluateApprovalAction({
      amendmentRow: pending(),
      role,
      approver: FILER,
      action: "decline",
    });
    assert.equal(out.allowed, true, `the filer can no longer withdraw via the ${role} slot`);
    assert.equal(out.code, "decline");
  }
});

test("the `unauthenticated` marker names nobody, so it excludes nobody", () => {
  // `unauthenticated` is a REAL recorded value with a real meaning — the
  // workflow writes that literal string when no session was present, which is
  // the EXPECTED state on the Zendesk intake path — but it identifies no human.
  // Treating it as one would refuse an approver whose free-text identity
  // happened to be that word while still excluding no actual person.
  const realApprover = evaluateApprovalAction({
    amendmentRow: pending({ requester: UNAUTHENTICATED }),
    role: "customer_admin",
    approver: SIGNATORY,
    action: "approve",
  });
  assert.equal(realApprover.allowed, true, "a real signatory was refused because nobody was recorded as the filer");

  const sameWord = evaluateApprovalAction({
    amendmentRow: pending({ requester: " Unauthenticated " }),
    role: "customer_admin",
    approver: "unauthenticated",
    action: "approve",
  });
  assert.notEqual(
    sameWord.code,
    "requester_cannot_approve",
    "the sentinel was matched as a person — canonicalisation of the marker has been dropped"
  );
});

test("a row that does not record who filed it cannot have this guard applied — and says nothing false about it", () => {
  // An honest gap, recorded rather than papered over. A missing `requester` is
  // a defect in the record (upstream: workflow.js always writes the column, or
  // the sentinel), not licence to refuse every approval on the row — failing
  // closed here would take the whole control down for hand-built and
  // partially-migrated rows, which is worse than the defect it would guard.
  for (const missing of [undefined, null, "", "   "]) {
    const out = evaluateApprovalAction({
      amendmentRow: pending({ requester: missing }),
      role: "customer_admin",
      approver: SIGNATORY,
      action: "approve",
    });
    assert.equal(out.allowed, true, `requester ${JSON.stringify(missing)} produced a refusal`);
  }
});
