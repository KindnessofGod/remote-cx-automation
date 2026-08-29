// ---------------------------------------------------------------------------
// uc04RefusalWords.test.js  —  a refusal that names its reason, and the words
// it names it in
// ---------------------------------------------------------------------------
// WHAT THIS IS PROTECTING
//
// The project owner filed a UC-04 request for Portugal and was told only that
// it "was refused outright" and that "nothing is waiting on anybody". His whole
// reply was: "why was this refused tell the user."
//
// evaluate() returns three materially different hard blocks and the reader was
// shown one sentence for all three:
//
//   sanctioned_region                nobody can change it
//   employer_permission_not_granted  the EMPLOYER can change it
//   factors_invalid                  the REQUESTER can change it, on the form
//
// This file covers the two halves that live under src/uc04/: the WORDS a field
// name is given back in (FACTOR_ISSUE_WORDS / factorIssueWords), and the
// GATE_SEQUENCE prose a requester reads directly as the "What happened"
// paragraph. The sentence assembly itself is pinned in
// test/portalPlainAnswer.test.js, beside every other thing that module may
// never say.
//
// NOTHING HERE ASSERTS A DECISION. Every gate, threshold and returned
// decision/reason/flags triple is untouched by the change these tests cover —
// they are assertions about what a person READS about a refusal that already
// happened, which is why they are all string properties and not one of them is
// an expected `decision`.
//
// HERMETIC: pure functions and frozen tables. No network, no port, no store.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluate, GATE_SEQUENCE, describeDecidingGate } from "../src/uc04/policyEngine.js";
import {
  FACTOR_ISSUE_WORDS,
  factorIssueWords,
  describeDecisionBasis,
} from "../src/uc04/decisionFacts.js";

// An employment that clears gates 1, 2 and 4, so a factor problem is the thing
// that decides. Written out rather than imported: this file is about the WORDS
// on a refusal, and a fixture shared with a behavioural suite would drag its
// expectations along with it.
const PERMITTED = Object.freeze({
  id: "emp-1",
  status: "active",
  custom_fields: { workation_permission: true },
});

const refuse = (factors) =>
  evaluate({ identityVerified: true, employment: PERMITTED, factors, now: "2026-08-15" });

// ---------------------------------------------------------------------------
// 1. EVERY ISSUE THE ENGINE CAN RAISE HAS WORDS
// ---------------------------------------------------------------------------
// Derived by RUNNING evaluate(), never by restating factorValidationIssues():
// a list written out here would agree with a gate that had changed, which is
// the failure mode docs/BUILD-LOG.md keeps recording (fixtures written to agree
// with the code, and the code with the fixtures).

test("every factor issue evaluate() can return has a readable field name", () => {
  const raised = new Set();
  for (const factors of [undefined, null, "not an object", {}, { destination: {} }]) {
    const out = refuse(factors);
    assert.equal(out.decision, "blocked");
    assert.equal(out.reason, "factors_invalid");
    for (const issue of out.factorIssues) raised.add(issue);
  }
  assert.ok(raised.size >= 8, `only ${raised.size} distinct factor issues were exercised`);

  for (const issue of raised) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(FACTOR_ISSUE_WORDS, issue),
      `${issue} reaches a requester as a slug — FACTOR_ISSUE_WORDS has no words for it`
    );
    assert.ok(FACTOR_ISSUE_WORDS[issue].length > 2, `${issue}'s words are empty`);
    assert.ok(
      !FACTOR_ISSUE_WORDS[issue].includes("_"),
      `${issue}'s words are still a slug: ${FACTOR_ISSUE_WORDS[issue]}`
    );
  }
});

test("the words are the form's own labels, so the reader can find the box", () => {
  // Read off src/portal/assets/index.html's UC-04 card. Restated here rather
  // than parsed out of the HTML on purpose: this asserts the CHOICE of
  // vocabulary, and a test that re-derived the labels from the page could only
  // ever agree with whatever the page currently says.
  assert.equal(FACTOR_ISSUE_WORDS.missing_home_country, "Home country");
  assert.equal(FACTOR_ISSUE_WORDS.missing_nationality, "Nationality");
  assert.equal(FACTOR_ISSUE_WORDS.missing_destination_country, "Destination country");
  assert.equal(FACTOR_ISSUE_WORDS.invalid_visa_type, "Visa / permit");
  assert.equal(FACTOR_ISSUE_WORDS.invalid_job_duties, "Duties while abroad");
  // Two that are not one box, and say so rather than picking one.
  assert.match(FACTOR_ISSUE_WORDS.missing_dates, /Start date and End date/);
  assert.match(FACTOR_ISSUE_WORDS.factors_missing, /none of the trip details/i);
});

// ---------------------------------------------------------------------------
// 2. MEMBERSHIP, NEVER PARSING
// ---------------------------------------------------------------------------
// The whole reason the reason/flags may be read at all (src/portal/
// plainAnswer.js's rule 3) is that they are read against a NAMED SET. A
// prefix match or a substring test would let an unrelated matrix flag be
// printed to a requester as a field on their form.

test("a flag the table does not name never becomes a field name", () => {
  const words = factorIssueWords([
    "factors_invalid",
    "missing_home_country",
    "pe_risk_dape",
    "tax_residency_watch",
    "missing_invented_field",
    "schengen_overstay",
  ]);
  assert.deepEqual(words, ["Home country"]);
});

test("the order is the table's, not the flag array's, so one request reads one way", () => {
  const forwards = factorIssueWords(["missing_home_country", "invalid_visa_type", "missing_dates"]);
  const backwards = factorIssueWords(["missing_dates", "invalid_visa_type", "missing_home_country"]);
  assert.deepEqual(forwards, backwards);
  assert.deepEqual(forwards, ["Home country", "Start date and End date", "Visa / permit"]);
});

test("nothing usable in, nothing out — and never a throw", () => {
  for (const input of [undefined, null, "missing_home_country", 7, {}, [null, 3, {}]]) {
    assert.deepEqual(factorIssueWords(input), []);
  }
});

// ---------------------------------------------------------------------------
// 3. THE PARAGRAPH THE REQUESTER READS UNDER THE ANSWER
// ---------------------------------------------------------------------------
// `describeDecidingGate(reason).means` is rendered to the requester as the
// "What happened" row (src/portal/server.js's gateNarration()). Two of these
// rungs pointed the reader at the case's FLAGS, which that page has not
// rendered since the pass that removed the chips — a pointer to something the
// reader cannot see is worse than silence, because they go looking.

test("no rung tells the requester the flags name a detail they need", () => {
  // NOT "never mentions flags". `all_gates_passed` says the risk flags are what
  // the SPECIALIST is being asked to weigh, which is a statement about their
  // job rather than an instruction to this reader. What is a dead pointer is a
  // rung claiming the flags CARRY the missing detail — that sends a requester
  // looking for chips this page stopped rendering, and it sent a specialist to
  // a flag that says only the bare reason.
  for (const row of GATE_SEQUENCE) {
    assert.ok(
      !/\bflags\b[^.]{0,40}\b(name|names|list|lists)\b/i.test(row.means),
      `${row.reason}'s "What happened" says the flags carry a detail they do not: ${row.means}`
    );
  }
});

test("the unreadable-history rung no longer claims the flag names the stay", () => {
  // riskMatrix.js pushes the bare `travel_history_unreadable` flag and carries
  // the offending row on `risk.travelHistoryProblems`. The rung used to say the
  // flags named it, which sent a reader to a chip that says only the reason.
  const means = describeDecidingGate("travel_history_unreadable").means;
  assert.ok(!/The flags name which stay/.test(means), "the false pointer is back");
  assert.match(means, /re-submitting with the offending stay/);
  // AND IT DOES NOT SWAP ONE WRONG VOCABULARY FOR ANOTHER. `means` is printed
  // to the requester as "What happened"; a property path is no more their
  // language than a slug is, so the correction lives in a comment beside the
  // row instead.
  assert.ok(!/travelHistoryProblems|risk\./.test(means), "a property path is on the requester's screen");
});

test("every hard block says what would change it, or that nothing would", () => {
  // The defect this sweeps for is a decision stated without the one fact that
  // tells the reader what to do about it (docs/UI-AUDIENCES.md). "Nothing" is a
  // complete answer and two of these give it; what is not an answer is silence.
  const RECOURSE = /re-submit|resubmit|corrected|correct|complete|filled in|fewer days|set the permission|nobody to|no approval|cannot be authorised|nothing here for/i;
  const blocks = [
    "sanctioned_region",
    "employer_permission_not_granted",
    "factors_invalid",
    "same_country_workation",
    "visitor_visa_active_work_forbidden",
    "invalid_date",
    "end_before_start",
    "travel_history_unreadable",
    "start_in_past",
    "schengen_90_180_exceeded",
    "us_requires_work_permit",
    "ca_requires_work_permit",
  ];
  for (const reason of blocks) {
    const row = describeDecidingGate(reason);
    assert.ok(row, `${reason} has no rung`);
    assert.match(row.means, RECOURSE, `${reason} states the refusal and not what follows from it`);
  }
});

test("the employer-permission rung is a precondition and never a promise", () => {
  const means = describeDecidingGate("employer_permission_not_granted").means;
  assert.match(means, /employer/i, "it does not name who can change it");
  assert.match(
    means,
    /assessable rather than approved/i,
    "setting the permission could be read as being granted the trip"
  );
});

test("the sanctioned rung keeps saying that nothing changes it", () => {
  const means = describeDecidingGate("sanctioned_region").means;
  assert.match(means, /no specialist approval and no additional information/i);
  assert.match(means, /nothing here for the requester or the employer to correct/i);
  // The reader of this paragraph is the requester. `BLOCKED, not escalated` was
  // this repository's own enum, printed at them.
  assert.ok(!/\bBLOCKED\b/.test(means), "the internal decision enum is on the requester's screen");
});

// ---------------------------------------------------------------------------
// 4. THE SPECIALIST'S PANEL PRINTS THE SAME VOCABULARY THE REQUESTER CHOSE FROM
// ---------------------------------------------------------------------------
// decisionFacts.js's own header says two dimensions used to print the STORED
// value of a dropdown at a specialist while the requester had picked a label.
// `trip.visaType` was still doing exactly that: zaf-app/assets/main.js prints
// it verbatim.

test("the trip block carries the travel document's label beside its stored code", () => {
  const basis = describeDecisionBasis({
    authorizationRow: {
      requester: "admin-1",
      employmentId: "emp-1",
      flags: [],
      factors: { visaType: "schengen_short_stay", startDate: "2026-09-01", endDate: "2026-09-14" },
      risk: null,
      tripDays: 14,
    },
  });
  assert.equal(basis.trip.visaType, "schengen_short_stay", "the stored code must survive for the audit trail");
  assert.equal(basis.trip.visaTypeLabel, "Schengen short stay");
});
