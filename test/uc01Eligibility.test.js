// ---------------------------------------------------------------------------
// uc01Eligibility.test.js — G-1 (engagement eligibility) and G-2 (deflection)
// ---------------------------------------------------------------------------
// Covers VC-02, VC-03, VC-04, VC-05 and VC-25 from the frozen validation
// contract (qa/handoffs/UC-01/0001-builder-to-validator.md §5).
//
// THE METHODOLOGICAL COMMITMENT OF THIS FILE, stated once here rather than on
// each test: EVERY GATE GETS A POSITIVE CASE, not only a refusal. Three dead
// gates in this repository's history were invisible to a fully green negative
// suite — UC-03's sanctions set that no country name could resolve to, UC-03's
// alpha-3 comparison, UC-06's payroll cutoff against a calendar that had
// stopped — because a gate that CANNOT succeed and a gate being appropriately
// cautious are indistinguishable from outside. Only an assertion that a
// specific input MUST succeed tells them apart.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEngagement } from "../src/uc01/engagementEligibility.js";
import { evaluate, GATE_SEQUENCE } from "../src/uc01/policyEngine.js";
import {
  UPSTREAM_NOT_FOUND,
  UPSTREAM_UNREACHABLE,
  REASON_UPSTREAM_UNAVAILABLE,
  REASON_UPSTREAM_NOT_FOUND,
} from "../src/shared/upstreamFailure.js";

const ACTIVE_EOR = {
  id: "emp_1",
  status: "active",
  contract_type: "eor",
  full_name: "Ada Lovelace",
  start_date: "2022-03-01",
  email: "ada@example.com",
};
const CLEAN = { intent: "standard_letter", requesterType: "self", requestedFields: [], confidence: 0.99 };
const VERIFIED = { verified: true, method: "session", reason: "authenticated_session" };

const decide = (over = {}, extra = {}) =>
  evaluate({ employment: { ...ACTIVE_EOR, ...over }, classification: CLEAN, identity: VERIFIED, ...extra });

// --- VC-02 / VC-03: Remote is not the legal employer -----------------------

test("VC-02: an independent contractor is refused, by its OWN reason", () => {
  const r = decide({ contract_type: "contractor" });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "engagement_not_eor_contractor");
});

test("VC-03: a global-payroll / direct employee is refused, by a DIFFERENT reason", () => {
  // Four classes, four reasons, per DRIFT-074's disposition. A single
  // `not_eligible` would tell the specialist nothing and would make these two
  // rows indistinguishable — and they need opposite advice: a contractor is
  // pointed at an invoice history, a direct employee at their own employer.
  for (const model of ["global_payroll", "global_payroll_employee", "direct_employee", "hris_employee"]) {
    const r = decide({ contract_type: model });
    assert.equal(r.decision, "blocked", model);
    assert.equal(r.reason, "engagement_not_eor_direct", model);
  }
  assert.notEqual(
    decide({ contract_type: "contractor" }).reason,
    decide({ contract_type: "global_payroll" }).reason
  );
});

test("VC-04: onboarding not finalised is refused", () => {
  for (const status of ["created", "initiated", "pending", "invited", "onboarding", "pre_hire"]) {
    const r = decide({ status });
    assert.equal(r.decision, "blocked", status);
    assert.equal(r.reason, "engagement_onboarding_incomplete", status);
  }
});

test("VC-05: serving notice / offboarding ESCALATES — it is never automated", () => {
  // The one class of the four that reaches a human rather than being refused
  // outright: there may be an active severance or a dispute behind it.
  for (const status of ["offboarding", "notice", "serving_notice", "leaving", "termination_pending"]) {
    const r = decide({ status });
    assert.equal(r.decision, "escalate", status);
    assert.equal(r.reason, "engagement_offboarding", status);
  }
});

test("an unreadable engagement fails CLOSED, and an ABSENT one is distinguishable from an UNRECOGNISED one", () => {
  for (const value of [null, undefined, "", "   ", "unknown"]) {
    const r = decide({ contract_type: value });
    assert.equal(r.decision, "blocked", String(value));
    assert.equal(r.reason, "eor_status_unknown", String(value));
    assert.deepEqual(r.flags, ["engagement_unreadable"], String(value));
  }
  // A value Remote has started returning that our list has not caught up with.
  // Same refusal, different flag — so the audit row says which fix is needed.
  const novel = decide({ contract_type: "apprentice_scheme" });
  assert.equal(novel.reason, "eor_status_unknown");
  assert.deepEqual(novel.flags, ["engagement_unrecognised_apprentice_scheme"]);
});

// --- the ORDER is the control, not just the outcome ------------------------

test("engagement eligibility runs BEFORE identity, so an ineligible request discloses nothing", () => {
  // Eligibility is a property of the RECORD; identity is a property of the
  // REQUESTER. If identity ran first, an unidentified request about a contractor
  // would come back `identity_not_verified` — which invites a step-up, a
  // second exchange and eventually a disclosure conversation about a person we
  // were never going to write about.
  const r = evaluate({
    employment: { ...ACTIVE_EOR, contract_type: "contractor" },
    classification: CLEAN,
    identity: { verified: false, method: "none", reason: "unauthenticated_requires_stepup" },
  });
  assert.equal(r.reason, "engagement_not_eor_contractor");
  assert.ok(!r.flags.some((f) => f.startsWith("identity_")), "no identity flag may be raised: identity never ran");
});

test("a contractor is refused ahead of the status check, so onboarding does not mask the engagement", () => {
  // An unfinished CONTRACTOR onboarding is still a contractor, and the
  // contractor sentence is the one that person needs — "your onboarding is
  // incomplete" would imply a letter is coming later, and it never is.
  const r = decide({ contract_type: "contractor", status: "pending" });
  assert.equal(r.reason, "engagement_not_eor_contractor");
});

// --- G-2 / VC-25: the deflection, and the fallback that must survive it -----

test("G-2: a requester signed in to Remote is deflected, not issued a second copy", () => {
  const r = decide({}, { session: { authenticatedEmploymentId: "emp_1" } });
  assert.equal(r.decision, "deflected_to_self_service");
  assert.equal(r.reason, "self_service_available");
});

test("VC-25 POSITIVE: auto-issue SURVIVES the deflection for everyone that flow cannot serve", () => {
  // THE SINGLE MOST IMPORTANT ASSERTION IN THE DEFLECTION WORK. Deflecting
  // everybody is indistinguishable from deflecting correctly, from outside, and
  // G-2's whole risk is that `auto_resolve` quietly becomes unreachable in
  // production while every negative test above stays green.
  for (const session of [null, { authenticatedEmail: "ada@example.com" }, {}]) {
    const r = decide({}, { session });
    assert.equal(r.decision, "auto_resolve", JSON.stringify(session));
    assert.equal(r.reason, "all_gates_passed", JSON.stringify(session));
  }
});

test("the deflection is the LAST gate — it never rescues a request another gate refused", () => {
  // A signed-in requester whose record is a contractor's is still refused, and a
  // signed-in requester with a low-confidence read still reaches a human. If the
  // deflection ran early it would answer "go and get it yourself" to people
  // Remote's own flow will refuse, which is worse than today's duplication.
  const session = { authenticatedEmploymentId: "emp_1" };
  assert.equal(decide({ contract_type: "contractor" }, { session }).decision, "blocked");
  assert.equal(
    evaluate({
      employment: ACTIVE_EOR,
      classification: { ...CLEAN, confidence: 0.2 },
      identity: VERIFIED,
      session,
    }).reason,
    "low_confidence"
  );
});

// --- the ladder describes what the engine actually does --------------------

test("every reason evaluate() can return has a rung, and the rung count is RUNGS not rows", () => {
  const reasons = new Set([
    "engagement_not_eor_contractor", "engagement_not_eor_direct", "engagement_onboarding_incomplete",
    "engagement_offboarding", "eor_status_unknown", "self_service_available", "all_gates_passed",
  ]);
  for (const reason of reasons) {
    assert.ok(GATE_SEQUENCE.some((r) => r.reason === reason), `no ladder rung for ${reason}`);
  }
  // Five reasons share rung 1 and two share the terminal rung, so the table has
  // more rows than the ladder has gates. A specialist reads "gate 11 of 13".
  const rungs = new Set(GATE_SEQUENCE.map((r) => r.position));
  assert.ok(GATE_SEQUENCE.length > rungs.size, "this test is vacuous if no rung has two reasons");
  assert.equal(rungs.size, 13);
});

test("classifyEngagement leaves an ABSENT record to the identity gate, rather than claiming it", () => {
  // A 404 from Remote is "there was nothing to verify against", and identity
  // owns that sentence. Answering it here too would give one absence two
  // different reasons on two different paths — the divergence class this whole
  // build exists to close.
  assert.equal(classifyEngagement(null).eligible, true);
  assert.equal(classifyEngagement(undefined).eligible, true);
});

// --- rca-bdz: the SECOND Remote read, seeing an offboarding an `active` ----
// --- status alone cannot show -----------------------------------------------

test("rca-bdz: an ACTIVE employment with a real offboarding on file escalates — the exact NAMED ABSENCE this gate used to have", () => {
  // This is the scenario the bead exists for: employment.status === "active"
  // (so OFFBOARDING_STATUSES alone would say "nothing to see here"), and a
  // real Remote offboarding read says otherwise.
  const withOffboarding = { offboardings: [{ id: "off_1", type: "resignation", status: "in_review" }], error: null };
  const r = classifyEngagement({ status: "active", contract_type: "eor" }, withOffboarding);
  assert.equal(r.eligible, false);
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "engagement_offboarding");
  assert.equal(r.flag, "offboarding_record_found");
});

test("rca-bdz: a genuinely empty offboarding read does not refuse an otherwise-eligible active employee", () => {
  const empty = { offboardings: [], error: null };
  const r = classifyEngagement({ status: "active", contract_type: "eor" }, empty);
  assert.equal(r.eligible, true);
});

test("rca-bdz: no offboarding read at all (legacy call site) behaves exactly as before — status alone decides", () => {
  const r = classifyEngagement({ status: "active", contract_type: "eor" });
  assert.equal(r.eligible, true);
  const stillCaught = classifyEngagement({ status: "notice", contract_type: "eor" });
  assert.equal(stillCaught.reason, "engagement_offboarding");
  assert.equal(stillCaught.flag, "engagement_status_notice");
});

test("rca-bdz: the offboarding read failing is fail-closed, distinct from a genuine offboarding, and never a 404 on a live employment", () => {
  const unreachable = { offboardings: null, error: { call: "offboardings", status: 403, kind: UPSTREAM_UNREACHABLE, message: "Forbidden" } };
  const rUnreachable = classifyEngagement({ status: "active", contract_type: "eor" }, unreachable);
  assert.equal(rUnreachable.eligible, false);
  assert.equal(rUnreachable.decision, "escalate");
  assert.equal(rUnreachable.reason, REASON_UPSTREAM_UNAVAILABLE);
  assert.notEqual(rUnreachable.reason, "engagement_offboarding", "a failed read is not a finding of an offboarding");

  const notFound = { offboardings: null, error: { call: "offboardings", status: 404, kind: UPSTREAM_NOT_FOUND, message: "Not Found" } };
  const rNotFound = classifyEngagement({ status: "active", contract_type: "eor" }, notFound);
  assert.equal(rNotFound.reason, REASON_UPSTREAM_NOT_FOUND);
});

test("rca-bdz: evaluate() threads the offboarding read through to G-1", () => {
  const employment = { id: "emp_1", status: "active", contract_type: "eor", full_name: "Ada Lovelace", start_date: "2022-03-01" };
  const classification = { intent: "standard_letter", requesterType: "self", requestedFields: [], confidence: 0.99 };
  const identity = { verified: true, method: "session", reason: "authenticated_session" };

  const r = evaluate({
    employment,
    classification,
    identity,
    offboarding: { offboardings: [{ id: "off_1" }], error: null },
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "engagement_offboarding");
  assert.deepEqual(r.flags, ["offboarding_record_found"]);

  // And the ladder has a rung for both new upstream-failure reasons, so a
  // reviewer reading gate position never sees "unknown".
  assert.ok(GATE_SEQUENCE.some((row) => row.reason === REASON_UPSTREAM_UNAVAILABLE));
  assert.ok(GATE_SEQUENCE.some((row) => row.reason === REASON_UPSTREAM_NOT_FOUND));
});
