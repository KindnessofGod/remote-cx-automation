// ---------------------------------------------------------------------------
// gateLadder.test.js  —  the shared ladder walker, and the drift guard that
//                        keeps each use case's GATE_SEQUENCE honest.
// ---------------------------------------------------------------------------
// WHY THE DRIFT GUARD IS SHAPED THIS WAY
// A gate added without a matching row would report "unknown" forever without
// ever erroring — the failure mode is silence, which is the one this repo pays
// for again and again. So the guard does not compare the sequence against a
// list written by hand here: a restated list would share any omission and
// compare equal. It scrapes the reasons out of the policy engine's OWN
// `evaluate()` source, via `evaluate.toString()` — the function object itself,
// so there is no chance of slicing the wrong region of the file and no way for
// GATE_SEQUENCE (which is full of `reason:` lines) to be scraped as if it were
// the gates.
//
// UC-04 is scraped twice, from evaluate() AND from riskMatrix.js's
// classifyRisk(), because UC-04's deciding reason is frequently not a literal
// in its policy engine at all: gate 5 returns `risk.reasons[0]`. Scraping only
// evaluate() would have produced a four-rung ladder that silently loses every
// hard block the matrix makes — which is most of the blocks UC-04 has.
//
// Hermetic: pure imports, no server, no network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeDecidingGate as describeDecidingGateFor,
  describeGateLadder as describeGateLadderFor,
  bindGateDescriptions,
} from "../src/shared/gateLadder.js";

import * as uc03 from "../src/uc03/policyEngine.js";
import * as uc04 from "../src/uc04/policyEngine.js";
import * as uc05 from "../src/uc05/policyEngine.js";
import * as uc06 from "../src/uc06/policyEngine.js";
import * as uc09 from "../src/uc09/policyEngine.js";
import { classifyRisk } from "../src/uc04/riskMatrix.js";

// --- the scrapers ----------------------------------------------------------

/** Comments stripped first, so a slug named in an explanation is not scraped. */
function stripComments(source) {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Every reason slug the given function can return, read out of its own source.
 * Matches `reason: <expr>` and `reason = <expr>` up to the next comma or
 * semicolon, then takes the string literals out of that expression — so
 * `reason: risk.reasons[0] ?? "risk_matrix_blocked"` is caught, while the
 * `decision: "escalate"` sitting on the same line is not.
 */
function reasonsReturnedBy(fn) {
  const code = stripComments(fn.toString());
  const found = new Set();
  // The newline clause is not decoration. UC-04's high-risk rung reads
  //
  //     reason: risk.flags.includes("destination_out_of_scope")
  //       ? "destination_out_of_scope"
  //       : "high_risk_pair",
  //
  // and a single-line expression stops at the first newline, capturing only
  // the string inside the CONDITION. `high_risk_pair` was then reported as a
  // stale row describing a gate that is gone — while it is in fact returned on
  // every high-risk pair the matrix does recognise. A scraper that under-reads
  // fails in the direction that deletes real rows, so it may cross a newline
  // when the next thing on the line is a ternary arm.
  for (const [, expression] of code.matchAll(/\breason\s*[:=]\s*((?:[^,;\n]|\n\s*[?:])+)/g)) {
    for (const [, single, double] of expression.matchAll(/'([a-z0-9_]+)'|"([a-z0-9_]+)"/g)) {
      found.add(single ?? double);
    }
  }
  return found;
}

/** Every slug pushed onto `reasons` inside the risk matrix's own source. */
function reasonsPushedBy(fn) {
  const code = stripComments(fn.toString());
  const found = new Set();
  for (const [, single, double] of code.matchAll(/reasons\.push\(\s*(?:'([a-z0-9_]+)'|"([a-z0-9_]+)")/g)) {
    found.add(single ?? double);
  }
  return found;
}

// --- the shared walker -----------------------------------------------------

const SAMPLE = Object.freeze([
  { position: 1, reason: "a_failed", gate: "first", checks: "a holds", means: "the first thing" },
  { position: 2, reason: "b_failed", gate: "second", checks: "b holds", means: "the second thing" },
  { position: 3, reason: "ok", gate: "outcome", checks: "everything held", means: "all good" },
]);

test("describeDecidingGate returns the deciding row plus how many rungs there are", () => {
  const decided = describeDecidingGateFor(SAMPLE, "b_failed");
  assert.equal(decided.position, 2);
  assert.equal(decided.gate, "second");
  assert.equal(decided.means, "the second thing");
  assert.equal(decided.total, 3);
});

test("an unrecognised reason yields null and an empty ladder, never a guessed position", () => {
  assert.equal(describeDecidingGateFor(SAMPLE, "invented_slug"), null);
  assert.deepEqual(describeGateLadderFor(SAMPLE, "invented_slug"), []);
});

test("the ladder marks earlier rungs passed, the deciding rung decided, later rungs not_reached", () => {
  const ladder = describeGateLadderFor(SAMPLE, "b_failed");
  assert.deepEqual(
    ladder.map((r) => [r.reason, r.status]),
    [
      ["a_failed", "passed"],
      ["b_failed", "decided"],
      ["ok", "not_reached"],
    ]
  );
});

test("a successful outcome marks every gate above it passed", () => {
  const ladder = describeGateLadderFor(SAMPLE, "ok");
  assert.deepEqual(ladder.map((r) => r.status), ["passed", "passed", "decided"]);
});

test("bindGateDescriptions produces the single-argument form each use case exports", () => {
  const bound = bindGateDescriptions(SAMPLE);
  assert.equal(bound.describeDecidingGate("a_failed").position, 1);
  assert.equal(bound.describeGateLadder("a_failed").length, 3);
});

// --- per-use-case sequences ------------------------------------------------

const CASES = [
  {
    name: "UC-03",
    module: uc03,
    // Reasons this use case can actually return, scraped from its own source.
    scraped: () => reasonsReturnedBy(uc03.evaluate),
  },
  {
    name: "UC-04",
    module: uc04,
    scraped: () => new Set([...reasonsReturnedBy(uc04.evaluate), ...reasonsPushedBy(classifyRisk)]),
  },
  {
    name: "UC-05",
    module: uc05,
    scraped: () => reasonsReturnedBy(uc05.evaluate),
  },
  {
    name: "UC-06",
    module: uc06,
    // The two upstream reasons this engine can also return come from
    // shared/upstreamFailure.js's upstreamVerdict(), spread into the result
    // rather than written as `reason:` literals here — so the scraper does not
    // see them and the ladder does not claim them. UC-09 is in the same shape
    // for the same reason, and both are deliberate: an upstream vocabulary
    // shared by nine use cases is not one use case's gate.
    scraped: () => reasonsReturnedBy(uc06.evaluate),
  },
  {
    name: "UC-09",
    module: uc09,
    scraped: () => reasonsReturnedBy(uc09.evaluate),
  },
];

for (const { name, module, scraped } of CASES) {
  test(`${name}: every reason its own source can return has a GATE_SEQUENCE row`, () => {
    const rows = new Set(module.GATE_SEQUENCE.map((r) => r.reason));
    const missing = [...scraped()].filter((reason) => !rows.has(reason));
    assert.deepEqual(
      missing,
      [],
      `${name} can return ${missing.join(", ")} but has no row for it — a gate was added without its plain-words meaning, and it will render as an unexplained slug forever without erroring.`
    );
  });

  test(`${name}: every GATE_SEQUENCE row corresponds to a reason the source can return`, () => {
    const reachable = scraped();
    const orphans = module.GATE_SEQUENCE.map((r) => r.reason).filter((reason) => !reachable.has(reason));
    assert.deepEqual(
      orphans,
      [],
      `${name} documents ${orphans.join(", ")} but no longer returns it — a stale row describes a gate that is gone.`
    );
  });

  test(`${name}: positions are a 1..N total order, one row per reason`, () => {
    const positions = module.GATE_SEQUENCE.map((r) => r.position);
    assert.deepEqual(
      positions,
      module.GATE_SEQUENCE.map((_, i) => i + 1),
      `${name}'s positions must be 1..N in evaluation order — the ladder's status walk depends on it`
    );
    const reasons = module.GATE_SEQUENCE.map((r) => r.reason);
    assert.equal(new Set(reasons).size, reasons.length, `${name} has a duplicate reason row`);
  });

  test(`${name}: every row says what it checks and what it means, without restating the slug`, () => {
    for (const row of module.GATE_SEQUENCE) {
      assert.ok(row.gate && row.gate.length > 0, `${name}/${row.reason} has no gate name`);
      assert.ok(row.checks && row.checks.length > 0, `${name}/${row.reason} has no 'checks'`);
      assert.ok(
        row.means && row.means.length > 20,
        `${name}/${row.reason} has no usable 'means' — a support specialist has to be able to read it`
      );
      assert.ok(
        !row.means.includes(row.reason),
        `${name}/${row.reason}'s 'means' restates the raw slug; the slug is already shown beside it`
      );
    }
  });

  test(`${name}: describeDecidingGate/describeGateLadder answer for every documented reason`, () => {
    for (const row of module.GATE_SEQUENCE) {
      const decided = module.describeDecidingGate(row.reason);
      assert.equal(decided.reason, row.reason);
      assert.equal(decided.total, module.GATE_SEQUENCE.length);

      const ladder = module.describeGateLadder(row.reason);
      assert.equal(ladder.length, module.GATE_SEQUENCE.length);
      assert.equal(ladder.filter((r) => r.status === "decided").length, 1);
      assert.equal(ladder[row.position - 1].status, "decided");
      assert.ok(ladder.slice(0, row.position - 1).every((r) => r.status === "passed"));
      assert.ok(ladder.slice(row.position).every((r) => r.status === "not_reached"));
    }
  });
}

// --- the orderings themselves, pinned against the real engines -------------
// These read as restatements, and they are — deliberately. The drift guard
// above proves the sequence is COMPLETE; it cannot prove the sequence is in the
// right ORDER, because order lives in control flow rather than in any string.
// Each assertion below is the one thing a reader would otherwise have to take
// on trust: that position N really is the Nth thing evaluate() checks.

test("UC-03's order: identity, employment, UC-04 routing, then destination, then time", () => {
  assert.deepEqual(
    uc03.GATE_SEQUENCE.map((r) => r.reason),
    [
      "identity_not_verified",
      "employee_not_active",
      // The confidence pair sits ahead of the routing gate: every decision
      // below acts ON the classified intent, so an intent nobody is confident
      // in must not be allowed to pick a pipeline.
      "confidence_unknown",
      "low_confidence",
      "work_authorization_requested",
      "destination_unknown",
      "sanctioned_region",
      // Named for what the gate can actually establish: the destination was
      // not CONFIRMED present in Remote's registry, which is a weaker and more
      // honest claim than "Remote does not support it".
      "destination_jurisdiction_excluded",
      "duration_unknown",
      "duration_over_cap",
      // The letter split, and the order within it matters: a letter the
      // template cannot express is refused BEFORE either rung that can produce
      // a document, so no path exists on which a non-standard request produces
      // one.
      "letter_scope_exceeded",
      // …and the signature rung sits BEFORE the issuing rung, which is the
      // second half of the same discipline. A standard letter is issued only
      // once both "may we issue automatically?" and "is there a letterhead?"
      // have been answered yes; either answered no leaves by this rung with a
      // person holding it.
      "formal_letter_requested",
      "standard_letter_issued",
      "all_gates_passed",
    ]
  );
});

test("UC-03 routes to UC-04 before it ever looks at the destination", () => {
  // Position 3 beating positions 4-8 is a real design choice, not an accident:
  // a request to WORK from abroad is UC-04's question whatever the destination
  // or duration, so UC-03 must not pre-judge it by escalating on its own gates.
  const routing = uc03.describeDecidingGate("work_authorization_requested");
  const sanctions = uc03.describeDecidingGate("sanctioned_region");
  assert.ok(routing.position < sanctions.position);
});

test("UC-04's order: the four local gates, then the risk matrix's own push order", () => {
  assert.deepEqual(
    uc04.GATE_SEQUENCE.map((r) => r.reason),
    [
      "identity_not_verified",
      "employee_not_active",
      // First of the substantive gates, and hard-blocking: no approval and no
      // extra information turns a sanctioned destination into a yes, so none
      // of the questions below is worth asking about one.
      "sanctioned_region",
      "employer_permission_not_granted",
      "factors_invalid",
      "same_country_workation",
      "visitor_visa_active_work_forbidden",
      "invalid_date",
      "end_before_start",
      // The prior stays the day counts are taken FROM, checked before either
      // count is attempted: an unreadable stay used to make both totals NaN,
      // and NaN loses the > 90 and the > 183 comparison alike, so an overstay
      // cleared in silence while the row read "not computed".
      "travel_history_unreadable",
      "start_in_past",
      "schengen_90_180_exceeded",
      "us_requires_work_permit",
      "ca_requires_work_permit",
      "risk_matrix_blocked",
      // Same rung, opposite investigations: the matrix has NO rules for this
      // destination (nothing was assessed) vs. it assessed the pair as high
      // risk. Reading the first as the second sends a specialist looking for a
      // finding nobody made.
      "destination_out_of_scope",
      "high_risk_pair",
      "all_gates_passed",
    ]
  );
});

test("UC-04's matrix rungs are in the order the matrix pushes them, which is what picks the winner", () => {
  // evaluate() returns risk.reasons[0], so the push order in riskMatrix.js is
  // literally which reason a caller is shown when several apply at once. Two
  // reasons at once is not hypothetical: a same-country trip on a tourist visa
  // pushes both, and the requester is told about the same-country mistake.
  const risk = classifyRisk({
    homeCountry: "ES",
    destinationCountry: "ES",
    nationality: "ES",
    visaType: "tourist_visa",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    now: "2026-08-01",
    travelHistory: [],
  });
  assert.equal(risk.riskLevel, "blocked");
  assert.ok(risk.reasons.length > 1, "this input is chosen because it trips more than one block");
  const winner = uc04.describeDecidingGate(risk.reasons[0]);
  const runnerUp = uc04.describeDecidingGate(risk.reasons[1]);
  assert.ok(
    winner.position < runnerUp.position,
    "the reason the matrix reports first must be the earlier rung, or the ladder is telling a different story from the code"
  );
});

test("UC-05's order: identity, employment, seniority date, country table, discrepancy", () => {
  assert.deepEqual(
    uc05.GATE_SEQUENCE.map((r) => r.reason),
    [
      "identity_not_verified",
      "employee_not_active",
      "missing_seniority_date",
      "unsupported_country",
      // THREE ADJACENT RUNGS, THREE DIFFERENT FACTS, AND ALL THREE PRODUCE NO
      // DATE — which is what made them collapsible. Reading down:
      //   unsupported_country         we hold no rule; the law may require anything
      //   no_statutory_notice_period  SOURCED: no statutory minimum binds a
      //                               resigning employee. The notice owed is
      //                               contractual and we do not hold contracts.
      //   no_matching_notice_bracket  we hold the rule; no bracket covers this tenure
      // The first pair was reported identically once, which told a UK employee
      // three weeks in that the United Kingdom is unsupported. The middle rung
      // was added 2026-08-20 for the same class of error one country over:
      // every American resignation escalated as `unsupported_country`, a
      // durable and false claim that the US is outside Remote's coverage.
      "no_statutory_notice_period",
      "no_matching_notice_bracket",
      "statutory_discrepancy",
      // Deliberately AFTER the discrepancy: that is a finding about the
      // request, this is a problem with the data we were handed. Both
      // escalate, so only the recorded reason differs — and mislabelling one
      // as the other sends the case to the wrong desk.
      "pto_balance_unusable",
      "all_gates_passed",
    ]
  );
});

test("UC-09's order ends in TWO successes and one unreachable placeholder", () => {
  assert.deepEqual(
    uc09.GATE_SEQUENCE.map((r) => r.reason),
    [
      "identity_not_verified",
      "employment_not_active",
      "invalid_adjustment_structure",
      "schema_invalid",
      "high_risk_adjustment_needs_triple_approval",
      "standard_adjustment_needs_dual_approval",
      "adjustment_needs_approval",
    ]
  );
});

test("UC-09's `adjustment_needs_approval` is unreachable by construction, and the ladder says so", () => {
  // The floor is Math.max(2, …), so approvalSlotsRequired is never below 2 and
  // one of the two branches always fires. The initial value of `reason` can
  // therefore never survive to the return. It keeps a rung anyway: a slug with
  // no explanation is exactly the problem this ladder exists to fix, and if it
  // ever DOES appear on a case that is a bug report, not a decision.
  const row = uc09.describeDecidingGate("adjustment_needs_approval");
  assert.ok(row, "the placeholder must still be documented");
  assert.match(row.means, /cannot actually produce|never see|out of date/i);
});

test("UC-09 has no `all_gates_passed`; its successes are the two approval sizes", () => {
  const reasons = uc09.GATE_SEQUENCE.map((r) => r.reason);
  assert.ok(!reasons.includes("all_gates_passed"));
  assert.ok(reasons.includes("standard_adjustment_needs_dual_approval"));
  assert.ok(reasons.includes("high_risk_adjustment_needs_triple_approval"));
});


test("UC-06's order: identity, employment, the country form, then the payroll calendar", () => {
  // The split is the point, and it is what the two approvers' panels hang off:
  // rungs 1-6 are questions about the CONTRACT and the form that carries it
  // (the customer admin's half), rungs 7-10 are questions about the payroll
  // CALENDAR (the payroll specialist's half). A rung reported from the wrong
  // half sends the case to the wrong desk — "the form has no salary field" is
  // not something a payroll specialist can act on, and "two cycles disagree
  // about the lock" is not something a customer admin can.
  assert.deepEqual(
    uc06.GATE_SEQUENCE.map((r) => r.reason),
    [
      "identity_not_verified",
      "employee_not_active",
      "country_schema_unavailable",
      // Value before vocabulary before validation, and the order is load-bearing:
      // "you did not give me a salary" is fixable by the requester, "this form
      // has no salary field" is fixable by nobody, and reporting the second
      // when the first is true sends someone to argue with Remote about a form.
      "change_value_underivable",
      "change_not_expressible",
      "schema_invalid",
      // Ambiguity is resolved BEFORE the cutoff engine runs, because that
      // engine returns one cycle and a recorded cycle reads as an answer.
      "ambiguous_payroll_cycle",
      "no_matching_payroll_cycle",
      "cutoff_date_unknown",
      "cutoff_lock_passed",
      "all_gates_passed",
    ]
  );
});

test("UC-06 asks whether the change is expressible before it asks whether it validates", () => {
  // Position 5 beating position 6 is the fix for a real defect: the payload
  // that reaches the validator no longer contains an unexpressible change, so
  // a `schema_valid` verdict on it would be a verdict about a different
  // amendment than the one that was requested.
  assert.ok(
    uc06.describeDecidingGate("change_not_expressible").position <
      uc06.describeDecidingGate("schema_invalid").position
  );
});

test("UC-06's ladder marks the payroll rungs not_reached when the form gate decided", () => {
  const ladder = uc06.describeGateLadder("change_not_expressible");
  const byReason = Object.fromEntries(ladder.map((r) => [r.reason, r.status]));
  assert.equal(byReason.country_schema_unavailable, "passed");
  assert.equal(byReason.change_not_expressible, "decided");
  // NOT "passed". Nothing about the payroll calendar was established.
  assert.equal(byReason.cutoff_lock_passed, "not_reached");
  assert.equal(byReason.all_gates_passed, "not_reached");
});

test("UC-06's upstream reasons degrade to null rather than to a guessed rung", () => {
  // They are real reasons this engine returns; they are simply not ITS gates.
  // Returning a fabricated position for them would put an upstream read failure
  // into a contract-gate sequence it never ran through.
  assert.equal(uc06.describeDecidingGate("upstream_record_not_found"), null);
  assert.deepEqual(uc06.describeGateLadder("upstream_unavailable"), []);
});
