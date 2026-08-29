// ---------------------------------------------------------------------------
// reviewGateLadder.test.js  —  UC-01's review view publishes its gate ladder
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `src/uc01/policyEngine.js` has exported describeDecidingGate() and
// describeGateLadder() since the shared ladder landed (src/shared/gateLadder.js),
// and six of the nine servers already put both on their by-ticket response. The
// flagship's own review API sent neither — so the ZAF sidebar printed
// `low_confidence` on its own, while the sentence explaining it, and the whole
// ordered account of how far the run got, sat one import away in the same repo.
//
// The two assertions that matter are about the DEGRADATIONS, because those are
// the ones a renderer cannot detect:
//   · a reason with no row returns null/[] rather than a guessed position, and
//   · a row from another use case gets NO ladder at all, because `cases` is a
//     shared table and reason slugs are not globally unique — printing UC-01's
//     gate 1 of 12 over a UC-03 case would be a real-looking citation to the
//     wrong order.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { getReviewView } from "../src/review/service.js";
import { GATE_SEQUENCE } from "../src/uc01/policyEngine.js";

/** The smallest store the view needs: one case, no review row, no documents. */
function storeFor(caseRow) {
  return {
    async findCaseByExternalRef() {
      return caseRow;
    },
    async findReviewEntryByCaseId() {
      return null;
    },
    async findDocumentsByCaseId() {
      return [];
    },
  };
}

const CASE = {
  id: "case_1",
  useCase: "UC-01",
  externalRef: "1001",
  employmentId: "emp_active_001",
  decision: "human_review",
  reason: "low_confidence",
  flags: ["low_confidence"],
  status: "pending_review",
  classification: { intent: "standard_letter", confidence: 0.4 },
};

test("the review view names the gate that decided, in the engine's own words", async () => {
  const view = await getReviewView({ ticketId: "1001" }, { store: storeFor(CASE) });

  assert.equal(view.found, true);
  assert.ok(view.decidedBy, "the view sends no deciding gate at all");
  assert.equal(view.decidedBy.reason, "low_confidence");
  assert.ok(view.decidedBy.means, "the gate row must carry the sentence a person reads");
  // RUNGS, not rows. Since G-1 one gate refuses five ways and the terminal gate
  // has two outcomes, so GATE_SEQUENCE has 18 rows describing 13 rungs. The
  // sentence a specialist reads is "decided at gate 11 of 13", and `total` has
  // to be the number that makes that true — `sequence.length` had it saying
  // "of 18", counting table rows in a sentence about gates.
  assert.equal(view.decidedBy.total, new Set(GATE_SEQUENCE.map((r) => r.position)).size);

  // The slug is not replaced by the prose — it is the exact string in
  // audit_log, in the metrics exception ranking and in the n8n port.
  assert.equal(view.case.reason, "low_confidence");
});

test("the ladder marks every rung, and `not_reached` is not `passed`", async () => {
  const view = await getReviewView({ ticketId: "1001" }, { store: storeFor(CASE) });

  assert.equal(view.gateLadder.length, GATE_SEQUENCE.length);
  const decided = view.gateLadder.filter((rung) => rung.status === "decided");
  assert.equal(decided.length, 1, "exactly one rung decides — first refusal wins");
  assert.equal(decided[0].reason, "low_confidence");

  // Every rung above it passed and every rung below it never ran. A ladder that
  // reported the second group as `passed` would turn unevaluated gates into
  // endorsements — docs/GATES.md rule 2.
  const statuses = new Set(view.gateLadder.map((rung) => rung.status));
  assert.ok(statuses.has("passed"));
  assert.ok(statuses.has("not_reached"));
  for (const rung of view.gateLadder) {
    assert.ok(["passed", "decided", "not_reached"].includes(rung.status), `unknown rung status ${rung.status}`);
    if (rung.position < decided[0].position) assert.equal(rung.status, "passed");
    if (rung.position > decided[0].position) assert.equal(rung.status, "not_reached");
  }
});

test("a reason with no row degrades to null and [], never to a guessed position", async () => {
  const view = await getReviewView(
    { ticketId: "1001" },
    { store: storeFor({ ...CASE, reason: "a_reason_no_gate_publishes" }) }
  );
  assert.equal(view.decidedBy, null);
  assert.deepEqual(view.gateLadder, []);
});

test("a row from another use case gets no ladder — slugs are not globally unique", async () => {
  // `identity_not_verified` is a rung in several use cases' sequences. `cases`
  // is a shared table (UC-03 writes rows to it too), so an unscoped describer
  // would print UC-01's position and UC-01's wording over another engine's
  // decision — a citation that looks exact and is to the wrong document.
  const view = await getReviewView(
    { ticketId: "1001" },
    { store: storeFor({ ...CASE, useCase: "UC-03", reason: "identity_not_verified" }) }
  );
  assert.equal(view.decidedBy, null);
  assert.deepEqual(view.gateLadder, []);

  // ...and the same slug on a UC-01 row DOES resolve, so the guard above is
  // scoping rather than a blanket refusal.
  const uc01 = await getReviewView(
    { ticketId: "1001" },
    { store: storeFor({ ...CASE, reason: "identity_not_verified" }) }
  );
  assert.ok(uc01.decidedBy, "a UC-01 row with a published reason must still resolve");
});
