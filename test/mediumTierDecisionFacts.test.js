// ---------------------------------------------------------------------------
// mediumTierDecisionFacts.test.js
//   Does each 🟡 approver actually get the facts their decision turns on?
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR, AND WHY IT IS SHAPED UNUSUALLY
//
// docs/CORRECTIONS-LOG.md pattern P7 — "said less than it knew" — is the one
// defect class this repository has no test idiom for, and C-27 says why: *the
// sentence that was printed was TRUE.* "Above the policy cap" is not wrong.
// Every assertion about the output passed while a Finance Ops specialist was
// being asked to authorise an amount the ticket never named.
//
// So the assertions here are deliberately not "the decision is X". They are
// **the figure the decision was made from is present, and it is the right
// figure** — the only shape of assertion that can fail when a surface is
// truthful and incomplete. Each one is written so that removing the
// corresponding line from the describer turns it red; the mutations are
// recorded in the commit message rather than only claimed here.
//
// The other half of the file is the mirror-image discipline, and it matters as
// much: **an absent figure must be reported as absent, never defaulted.** A 0
// that means "we never counted" is worse than a blank, because a blank gets
// investigated and a number gets acted on (CLAUDE.md §9). Several tests below
// exist only to fail if a `?? 0` or a `?? "none"` ever creeps back in.
//
// Hermetic: every describer is a pure function over a stored row. No LLM seam
// exists in any of them — which is itself asserted, because a describer that
// could call out is a describer that could be slow, non-deterministic, and a
// fifth gate nobody reviewed.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeDecisionBasis, DECIDER as UC04_DECIDER } from "../src/uc04/decisionFacts.js";
import { describeSignoffBasis, DECIDER as UC05_DECIDER } from "../src/uc05/decisionFacts.js";
import { describeAmendmentBasis, DECIDERS as UC06_DECIDERS } from "../src/uc06/decisionFacts.js";
import { evaluate as evaluateUc04 } from "../src/uc04/policyEngine.js";
import { evaluate as evaluateUc05 } from "../src/uc05/policyEngine.js";
import { DNV_COUNTRIES, DNV_COUNTRIES_PROVENANCE, SCHENGEN } from "../src/uc04/riskMatrix.js";

// ---------------------------------------------------------------------------
// Fixtures — built by running the REAL policy engines, not by hand
// ---------------------------------------------------------------------------
// A hand-written `risk` object would let this file agree with itself while
// disagreeing with the matrix, which is exactly the fixtures-agree-with-the-code
// failure CLAUDE.md §4 names as the reason so many defects were invisible. Every
// UC-04 and UC-05 row below is the real engine's own output, reshaped into the
// store's column names.
// ---------------------------------------------------------------------------

const ACTIVE_EMPLOYMENT = {
  status: "active",
  company_id: "company-1",
  custom_fields: { workation_permission: true },
};

function uc04Row({ factors, travelHistory = [], now = "2026-08-01" }) {
  const result = evaluateUc04({
    identityVerified: true,
    employment: ACTIVE_EMPLOYMENT,
    factors,
    now,
    travelHistory,
  });
  return {
    row: {
      factors,
      risk: result.risk,
      tripDays: result.risk?.tripDays ?? null,
      cumulativeDays: result.risk?.cumulativeDays ?? null,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
    },
    result,
  };
}

const BASE_FACTORS = {
  homeCountry: "DE",
  nationality: "DE",
  visaType: "work_permit",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  startDate: "2026-09-01",
  endDate: "2026-09-10",
};

// ===========================================================================
// UC-04 — the mobility specialist, and the four dimensions the spec forbids
//         collapsing into one score
// ===========================================================================

test("UC-04: the decider and their question are named, not left for the reader to infer", () => {
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } } });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.equal(basis.decider.role, "mobility_specialist");
  assert.match(basis.decider.decides, /work from this destination/);
});

test("UC-04: all four gating dimensions are reported, in UC-04.md §5's order", () => {
  // §7: "4 independent gating dimensions (§5), never collapsed into a single
  // composite score". A panel that shows three of them is showing a composite
  // with a name.
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } } });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.deepEqual(
    basis.dimensions.map((d) => d.key),
    ["treaty_coverage", "role_pe_sensitivity", "cumulative_presence", "immigration_document"]
  );
  assert.deepEqual(
    basis.dimensions.map((d) => d.position),
    [1, 2, 3, 4]
  );
  // Every one carries a finding sentence a person can act on, not just a state.
  for (const d of basis.dimensions) {
    assert.ok(d.finding.length > 40, `${d.key} has no usable finding`);
    assert.ok(d.question.endsWith("?"), `${d.key} does not state the question it answers`);
  }
});

test("UC-04: the composite risk level survives, but says out loud that it is not the assessment", () => {
  // Hiding it would make the recorded decision unexplainable — policyEngine.js
  // routes on it. Showing it unqualified is the thing §6 forbids.
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } } });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.equal(basis.riskLevel.value, row.risk.riskLevel);
  assert.match(basis.riskLevel.note, /never be collapsed into a single score/);
});

test("UC-04: treaty coverage reports UNKNOWN, and says why absence is not evidence", () => {
  // The matrix holds a list of pairs known to LACK an agreement. DE→MX is not
  // on it, and that is not a record of coverage. Reading it as "covered" is the
  // failure UC-04.md §9 names: "never guess a country isn't covered".
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } } });
  const treaty = describeDecisionBasis({ authorizationRow: row }).dimensions[0];
  assert.equal(treaty.state, "unknown");
  assert.match(treaty.finding, /Germany → Mexico/);
  assert.match(treaty.finding, /not a record of coverage/);
  assert.ok(treaty.whatItWouldTake, "an unknown with no route to knowing is a shrug");
});

test("UC-04: a KNOWN treaty gap is reported as a gap, with the pair named", () => {
  // The positive-direction case. IN→US is in NON_TREATY_PAIRS, so this is the
  // one state that is a finding rather than an absence — and it must read
  // differently from the unknown above, or the two collapse.
  const { row } = uc04Row({
    factors: { ...BASE_FACTORS, homeCountry: "IN", nationality: "IN", destination: { country: "US" } },
  });
  const treaty = describeDecisionBasis({ authorizationRow: row }).dimensions[0];
  assert.equal(treaty.state, "attention");
  assert.match(treaty.finding, /India → United States/);
  assert.match(treaty.finding, /both countries/);
});

test("UC-04: PE sensitivity names WHICH trigger fired, not just that one did", () => {
  const { row } = uc04Row({
    factors: {
      ...BASE_FACTORS,
      destination: { country: "MX" },
      jobDuties: "executive",
      hasContractSigningAuthority: true,
    },
  });
  const role = describeDecisionBasis({ authorizationRow: row }).dimensions[1];
  assert.equal(role.state, "attention");
  assert.match(role.finding, /authority to sign contracts/);
  assert.match(role.finding, /executive role/);
  // The evidence carries both raw values, so the specialist can check the
  // sentence rather than take it.
  const labels = role.evidence.map((e) => e.label);
  assert.ok(labels.includes("Job duties, as stated on the request"));
  assert.ok(labels.includes("Contract-signing authority"));
});

test("UC-04: an empty travel history is UNKNOWN, never 'zero days, well under the limit'", () => {
  // THE MANUFACTURED-ZERO TEST. computeCumulativeDays() returns a COUNTED zero
  // over zero periods for an empty history — deliberately not UC-08's
  // NOT_EVALUATED, because a workation request with no prior stays is the
  // ordinary case rather than an evidence gap. Reporting that zero as a
  // MEASUREMENT is the defect src/portal/server.js already fixed in its own
  // copy, and it is what UC-04.md §9 routes on ("Incomplete trip history →
  // escalate"). The status is asserted beside the number so a future change
  // from COUNTED to NOT_EVALUATED cannot slip past this test unnoticed.
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } }, travelHistory: [] });
  assert.deepEqual(row.cumulativeDays, { days: 0, periodsCounted: 0, status: "COUNTED", problems: [] });

  const basis = describeDecisionBasis({ authorizationRow: row });
  const presence = basis.dimensions[2];
  assert.equal(presence.state, "unknown");
  assert.match(presence.finding, /floor, not a measurement/);
  assert.ok(presence.whatItWouldTake);
  // And no threshold row is emitted at all — a measured-vs-limit row built on
  // an uncounted zero is exactly the "threshold with no measured value" the
  // brief names.
  assert.equal(
    basis.measurements.find((m) => m.key === "tax_residency_183"),
    undefined
  );
});

test("UC-04: with real prior trips, the 183-day line carries the measured total AND the headroom", () => {
  // The positive direction of the same rule: when the count IS a count, both
  // sides of the comparison are stated. A threshold with no measured value
  // against it fails the "…and then what?" test; so does a measured value with
  // no threshold.
  const { row } = uc04Row({
    factors: { ...BASE_FACTORS, destination: { country: "MX" }, startDate: "2026-09-01", endDate: "2026-09-10" },
    travelHistory: [{ country: "MX", startDate: "2026-01-01", endDate: "2026-02-09" }],
  });
  const basis = describeDecisionBasis({ authorizationRow: row });
  const residency = basis.measurements.find((m) => m.key === "tax_residency_183");
  assert.ok(residency, "no residency measurement was emitted for a real trip history");
  assert.equal(residency.limit, 183);
  assert.equal(residency.measured, row.cumulativeDays.days + row.tripDays);
  assert.equal(residency.headroom, 183 - residency.measured);
  assert.equal(residency.breached, false);
  // The window is stated, not implied — §10 asks the audit for "cumulative day
  // count + window", and a count without its window is not checkable.
  assert.equal(residency.window.spanDays, 365);
  assert.equal(residency.window.to, "2026-09-01");
});

test("UC-04: the immigration document is reported as NEVER CONFIRMED, and the visa type as a claim", () => {
  // UC-04.md §5/§9: the document must never be inferred. What the request holds
  // is a type the requester SELECTED. Rendering that as a verified document is
  // the one thing the spec forbids by name.
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } } });
  const doc = describeDecisionBasis({ authorizationRow: row }).dimensions[3];
  assert.equal(doc.state, "unavailable");
  assert.match(doc.finding, /a type the requester selected, not a document/);
  // WHAT THIS ASSERTION USED TO SAY, AND WHY IT MOVED (2026-08-31). It read
  // `/No immigration document was read from Remote/` and checked an evidence
  // row hard-coded to the string "none" — both of which were true of the code
  // and describe a defect: the panel asserted an absence on a record it had
  // already fetched, having never looked at the documented `files[]` array.
  // The dimension now reads it (src/uc04/identityDocuments.js). The claim being
  // pinned here is unchanged and is the one §5/§9 actually make — the visa type
  // is a CLAIM and nothing confirms entitlement at the DESTINATION — so it is
  // asserted directly instead of via a sentence that happened to imply it.
  assert.match(doc.finding, /Obtain the destination's authorization before approving/);
  // "NEVER INFERRED" IS NOW PINNED STRUCTURALLY RATHER THAN AS A SENTENCE
  // (W-5b). It used to be asserted by matching the finding's closing clause,
  // which was 96 characters of the panel explaining its own reasoning to a
  // specialist who wanted a fact. The clause is gone; the guarantee is not, and
  // it is stronger stated this way — no value of `identityDocuments` and no
  // destination can reach a `cleared` state on this dimension, which is what
  // UC-04.md §9 forbids by name. test/uc04ImmigrationDocuments.test.js sweeps
  // every document state for the same property.
  assert.notEqual(doc.state, "cleared");
  // No employment record is passed on this path, and that is its own state:
  // "nobody looked" must never render as "the employee has none".
  assert.equal(
    doc.evidence.find((e) => e.label === "Identity documents on the employment record").value,
    "not read"
  );
  assert.match(doc.whatItWouldTake, /travel_document_number/);
});

test("UC-04: a trip whose dates could not be read reports NO length, and says so", () => {
  // Finding F-32, one layer up. 0 is not a value a real trip can take (both
  // ends inclusive), so a 0 here would be a figure nobody derived.
  const { row } = uc04Row({
    factors: { ...BASE_FACTORS, destination: { country: "MX" }, startDate: "next Tuesday", endDate: "sometime" },
  });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.equal(basis.trip.tripDays, null);
  assert.match(basis.trip.tripDaysNote, /absence, not a zero/);
});

test("UC-04: gates that never ran report not_assessed, never cleared", () => {
  // An identity refusal leaves `risk` null. Four dimensions reading "cleared"
  // over a run that assessed nothing is the P9 half of C-27 — saying MORE than
  // was done — and it would put a fabricated all-clear on an escalation.
  const result = evaluateUc04({
    identityVerified: false,
    employment: ACTIVE_EMPLOYMENT,
    factors: { ...BASE_FACTORS, destination: { country: "MX" } },
    now: "2026-08-01",
  });
  const basis = describeDecisionBasis({
    authorizationRow: { factors: BASE_FACTORS, risk: result.risk, tripDays: null, cumulativeDays: null, flags: result.flags },
  });
  assert.equal(result.risk, null);
  for (const d of basis.dimensions.slice(0, 3)) {
    assert.equal(d.state, "not_assessed", `${d.key} claimed a verdict on a run that never assessed it`);
  }
  assert.deepEqual(basis.measurements, [], "thresholds were reported for a run that measured nothing");
  assert.equal(basis.deciding, null, "a dimension was named as deciding a case none of them decided");
});

test("UC-04: the fact that settled the case is lifted out rather than left to be hunted for", () => {
  const { row } = uc04Row({
    factors: { ...BASE_FACTORS, destination: { country: "MX" }, jobDuties: "executive" },
  });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.equal(basis.deciding.key, "role_pe_sensitivity");
  assert.match(basis.deciding.finding, /executive role/);
});

// ---------------------------------------------------------------------------
// The DNV suppression — an uncited table that REMOVES a control
// ---------------------------------------------------------------------------

test("UC-04: a DNV destination reaches approval AND the record says the Schengen check was suppressed", () => {
  // THE POSITIVE TEST, and it is the one that matters. A table that cannot make
  // a decision succeed is indistinguishable from one being appropriately
  // cautious (docs/BUILD-LOG.md §3.30), so asserting only the refusals would
  // leave the suppression untested in the direction it actually acts.
  assert.ok(SCHENGEN.has("PT") && DNV_COUNTRIES.has("PT"), "PT must be both, or this test proves nothing");

  const { row, result } = uc04Row({
    factors: {
      ...BASE_FACTORS,
      destination: { country: "PT" },
      visaType: "digital_nomad_visa",
      startDate: "2026-09-01",
      endDate: "2026-09-20",
    },
    // 175 days of prior Portuguese presence — enough to blow the 90/180 limit
    // several times over IF the limit were applied. It is not, and that is the
    // whole point: the suppression is load-bearing here, not incidental.
    travelHistory: [{ country: "PT", startDate: "2026-03-10", endDate: "2026-08-31" }],
  });
  assert.equal(result.decision, "ready_for_approval");

  const schengen = describeDecisionBasis({ authorizationRow: row }).measurements.find(
    (m) => m.key === "schengen_90_180"
  );
  assert.ok(schengen, "a Schengen destination produced no Schengen row at all");
  assert.equal(schengen.state, "suppressed");
  assert.equal(schengen.breached, false);
  assert.equal(schengen.measured, null, "a suppressed check must not report a measurement it never took");
  assert.match(schengen.note, /WOULD govern this trip — and it was NOT applied/);
  assert.match(schengen.note, /excused, which is a different fact/);
});

test("UC-04: the suppression states its own basis — an uncited five-entry list, with no authority or review date", () => {
  const { row } = uc04Row({
    factors: { ...BASE_FACTORS, destination: { country: "EE" }, visaType: "digital_nomad_visa" },
  });
  const schengen = describeDecisionBasis({ authorizationRow: row }).measurements.find(
    (m) => m.key === "schengen_90_180"
  );
  assert.equal(schengen.basis.table, "DNV_COUNTRIES");
  assert.match(schengen.basis.status, /no authority/i);
  // All three null ON PURPOSE. A placeholder date here would be the
  // manufactured value this whole discipline exists to refuse.
  assert.equal(schengen.basis.authority, null);
  assert.equal(schengen.basis.version, null);
  assert.equal(schengen.basis.reviewedOn, null);
  assert.match(schengen.basis.reference, /KNOWLEDGE-SOURCES/);
  assert.match(schengen.whatItWouldTake, /authority/i);
  assert.match(schengen.whatItWouldTake, /review date/i);
});

test("UC-04: the provenance record names what a real DNV table would need", () => {
  // The requirement is a recorded thing rather than a trailing `// curated`
  // comment nobody downstream ever sees.
  assert.equal(DNV_COUNTRIES_PROVENANCE.effect, "suppresses");
  assert.match(DNV_COUNTRIES_PROVENANCE.effectDetail, /fails open/);
  assert.ok(DNV_COUNTRIES_PROVENANCE.needsForAVersionedTable.length >= 3);
  const joined = DNV_COUNTRIES_PROVENANCE.needsForAVersionedTable.join(" ");
  assert.match(joined, /authority/i);
  assert.match(joined, /review date/i);
  assert.match(joined, /threshold/i);
});

test("UC-04: a Schengen destination NOT in the DNV set still gets the real check", () => {
  // The contrast case. Without it, "suppressed everywhere" and "suppressed for
  // five countries" look the same from this file.
  assert.ok(SCHENGEN.has("ES") && !DNV_COUNTRIES.has("ES"));
  const { row, result } = uc04Row({
    factors: {
      ...BASE_FACTORS,
      destination: { country: "ES" },
      visaType: "schengen_short_stay",
      startDate: "2026-09-01",
      endDate: "2026-09-20",
    },
    travelHistory: [{ country: "ES", startDate: "2026-03-10", endDate: "2026-08-31" }],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "schengen_90_180_exceeded");

  const schengen = describeDecisionBasis({ authorizationRow: row }).measurements.find(
    (m) => m.key === "schengen_90_180"
  );
  assert.equal(schengen.state, "breached");
  assert.equal(schengen.breached, true);
});

test("UC-04: a non-Schengen destination produces no Schengen row at all", () => {
  // "Suppressed" and "never applicable" are different facts too. A Japan trip
  // reporting a waived Schengen limit would be noise pretending to be a finding.
  const { row } = uc04Row({ factors: { ...BASE_FACTORS, destination: { country: "MX" } } });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.equal(
    basis.measurements.find((m) => m.key === "schengen_90_180"),
    undefined
  );
});

// ===========================================================================
// UC-05 — HR Ops, signing a calculation rather than weighing a risk
// ===========================================================================

const UK_EMPLOYMENT = {
  status: "active",
  company_id: "company-1",
  country_code: "GB",
  start_date: "2020-01-01",
};

function uc05Row({ employment = UK_EMPLOYMENT, proposedEndDate = null, timeOffBalances = [], currency = "GBP", now = "2026-08-01" } = {}) {
  const result = evaluateUc05({
    identityVerified: true,
    employment,
    proposedEndDate,
    timeOffBalances,
    currency,
    now,
  });
  return {
    row: { notice: result.notice, payout: result.payout, decision: result.decision, reason: result.reason, flags: result.flags },
    result,
  };
}

test("UC-05: the decider is named, and told what signing does and does not do", () => {
  const { row } = uc05Row();
  const basis = describeSignoffBasis({ resignationRow: row });
  assert.equal(basis.decider.role, "hr_ops");
  assert.match(UC05_DECIDER.decides, /files nothing with Remote/);
});

test("UC-05: the notice figure carries the statute, the tenure and both dates — not just the end date", () => {
  // "Prepared for sign-off" with a bare date is a number to take on trust. The
  // rule it came from, the length of service it was computed over and the day
  // it starts running are all on the row and are what make it checkable.
  const { row } = uc05Row({ proposedEndDate: "2026-09-30" });
  const notice = describeSignoffBasis({ resignationRow: row }).notice;
  assert.equal(notice.stated, true);
  assert.equal(notice.country, "GB");
  assert.match(notice.rule, /Employment Rights Act 1996/);
  assert.equal(notice.noticeDays, row.notice.noticeDays);
  assert.equal(notice.noticeStartDate, row.notice.noticeStartDate);
  assert.equal(notice.noticeEndDate, row.notice.noticeEndDate);
  assert.equal(notice.tenureMonths, row.notice.tenureMonths);
  assert.match(notice.sentence, /Employment Rights Act 1996/);
  assert.match(notice.sentence, /months of service/);
});

test("UC-05: a statutory discrepancy names BOTH dates and the shortfall in days", () => {
  // THE C-27 SHAPE ITSELF. `statutory_discrepancy` was the whole message while
  // the proposed date, the statutory date and the gap between them all sat on
  // `notice`.
  // 2026-08-04, NOT 2026-09-01 (changed 2026-09-02). This fixture is a UK
  // employment, and the UK notice fell from a service-scaled 21+ days to ERA
  // 1996 s.86(2)'s flat ONE WEEK — so a proposed date in September is now LATER
  // than the statutory end and the case passes every gate instead of showing a
  // shortfall. The subject of this test is the SHAPE of a discrepancy, not the
  // size of the UK notice period, so the proposed date moves inside the window.
  const { row, result } = uc05Row({ proposedEndDate: "2026-08-04" });
  assert.equal(result.reason, "statutory_discrepancy");

  const d = describeSignoffBasis({ resignationRow: row }).discrepancy;
  assert.equal(d.direction, "earlier_than_statutory");
  assert.equal(d.proposedEndDate, "2026-08-04");
  assert.equal(d.statutoryEndDate, row.notice.noticeEndDate);
  assert.equal(d.deltaDays, row.notice.discrepancyDays);
  assert.match(d.sentence, /2026-08-04/);
  assert.match(d.sentence, new RegExp(row.notice.noticeEndDate));
  assert.match(d.sentence, new RegExp(`${Math.abs(row.notice.discrepancyDays)} days SHORT`));
});

test("UC-05: a resignation with no proposed date says there is nothing to compare, not that it matches", () => {
  const { row } = uc05Row({ proposedEndDate: null });
  const d = describeSignoffBasis({ resignationRow: row }).discrepancy;
  assert.equal(d.direction, "no_proposed_date");
  assert.equal(d.deltaDays, null);
  assert.match(d.sentence, /names no last working day/);
});

test("UC-05: money is rendered in human units with its currency, never as the ×100 integer", () => {
  // A raw 307200 in front of somebody authorising a final payment is a 100×
  // error in the one direction nobody catches by eye.
  const { row } = uc05Row({
    proposedEndDate: "2026-09-30",
    timeOffBalances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 4800 }],
  });
  const payout = describeSignoffBasis({ resignationRow: row }).payout;
  assert.equal(payout.stated, true);
  assert.equal(payout.total, "3,072.00 GBP");
  assert.equal(payout.figure, "stated");
  assert.equal(payout.shortLabel, "3,072.00 GBP", "the one-cell rendering IS the figure when there is one");
  assert.equal(payout.lines[0].payout, "3,072.00 GBP");
  assert.equal(payout.lines[0].daysAvailable, 8);
  // The scaled integer must not appear anywhere a person reads.
  assert.ok(!payout.total.includes("307200"));
  assert.ok(!payout.sentence.includes("307200"));
});

test("UC-05: an uncomputable payout names the missing fields — and shows no total at all", () => {
  // Finding F-28. A report reaching sign-off showing `null` invites the reading
  // "nothing is owed" when the truth is "we could not work it out", so the
  // refusal has to say which fields and on how many lines.
  const { row, result } = uc05Row({
    proposedEndDate: "2026-09-30",
    timeOffBalances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 0, hourlyRateInRemoteInteger: null }],
  });
  assert.equal(result.reason, "pto_balance_unusable");

  const payout = describeSignoffBasis({ resignationRow: row }).payout;
  assert.equal(payout.computable, false);
  assert.equal(payout.total, null);
  assert.equal(payout.figure, "not_worked_out");
  assert.equal(payout.shortLabel, "not worked out");
  assert.match(payout.sentence, /could NOT be worked out/);
  assert.match(payout.sentence, /hourlyRateInRemoteInteger/);
  assert.match(payout.sentence, /absence of a figure, not a figure of zero/);
});

test("UC-05: no time-off records supplied is reported as unknown, never as a payout of zero", () => {
  // reconcilePtoPayout() returns `totalInRemoteInteger: 0` for an empty list.
  // Arithmetically honest; as a statement about the employee, unknown. Nobody
  // read Remote's time-off records.
  const { row } = uc05Row({ proposedEndDate: "2026-09-30", timeOffBalances: [] });
  assert.equal(row.payout.totalInRemoteInteger, 0);

  const basis = describeSignoffBasis({ resignationRow: row });
  assert.equal(basis.payout.stated, false);
  assert.equal(basis.payout.total, null);
  // THE CELL, not just the sentence. The sidebar's row rendered this record's
  // arithmetic 0 as "0.00 EUR" for weeks while the sentence beneath it said
  // "not a finding that nothing is owed" — so the short form is pinned too.
  assert.equal(basis.payout.figure, "not_known");
  assert.equal(basis.payout.shortLabel, "not known");
  assert.match(basis.payout.sentence, /not a finding that nothing is owed/);
  assert.ok(basis.unknowns.some((u) => /accrued time-off balance/i.test(u.what)));
});

test("UC-05: the known-wrong `noticeDays: 0` is never rendered for a country with no rule", () => {
  // noticePeriodCalculator.js's own comment: "STILL 0, AND STILL WRONG ...
  // nothing RENDERS the number: every consumer keys off `noticeEndDate ===
  // null`." This file is a new consumer and keys off the same thing. "We hold
  // no rule for this country" is not "this employee owes no notice".
  const { row, result } = uc05Row({ employment: { ...UK_EMPLOYMENT, country_code: "BR" }, currency: "BRL" });
  assert.equal(result.reason, "unsupported_country");
  assert.equal(row.notice.noticeDays, 0);

  const notice = describeSignoffBasis({ resignationRow: row }).notice;
  assert.equal(notice.stated, false);
  assert.equal("noticeDays" in notice, false, "the known-wrong zero leaked onto the sign-off surface");
  assert.match(notice.why, /not one of the countries/);
  assert.match(notice.sentence, /No statutory notice end date/);
});

test("UC-05: 'no rule for this country' and 'no bracket for this tenure' read differently, and route differently", () => {
  // These two used to be reported identically — a UK employee three weeks in
  // was told the United Kingdom is unsupported, on a panel citing the UK
  // statute one line above. Nobody can "add the UK to the table".
  const { row: newStarter, result } = uc05Row({
    employment: { ...UK_EMPLOYMENT, start_date: "2026-07-25" },
    now: "2026-08-01",
  });
  assert.equal(result.reason, "no_matching_notice_bracket");

  const basis = describeSignoffBasis({ resignationRow: newStarter });
  assert.equal(basis.notice.stated, false);
  assert.equal(basis.notice.ruleFound, true);
  assert.match(basis.notice.why, /does hold/);
  assert.match(basis.notice.why, /months of service/);
  const unknown = basis.unknowns.find((u) => /statutory notice end date/i.test(u.what));
  assert.match(unknown.whatItWouldTake, /Extending this country's notice table/);
});

test("UC-05: a date moved by a country's own termination rule says so, so nobody re-derives it and finds a mismatch", () => {
  // BGB §622 snaps to the 15th or month end. Without this line, an HR Ops
  // signer adds 28 days to the start date, gets a different answer, and files a
  // bug against a correct calculation.
  const { row } = uc05Row({
    employment: { ...UK_EMPLOYMENT, country_code: "DE" },
    currency: "EUR",
    proposedEndDate: "2026-12-31",
  });
  const notice = describeSignoffBasis({ resignationRow: row }).notice;
  assert.equal(notice.anchorAdjusted, row.notice.anchorAdjusted);
  if (notice.anchorAdjusted) {
    assert.match(notice.sentence, /not simply the start date plus the notice days/);
  }
});

// ===========================================================================
// UC-06 — TWO deciders, answering two different questions
// ===========================================================================

const LOCKED_CUTOFF = {
  cycle: {
    id: "pr-2026-09",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    cutoff_date: "2026-09-05T17:00:00",
    pay_date: "2026-09-28",
    type: "main",
    status: "processing",
  },
  noMatchingCycle: false,
  cutoffUnknown: false,
  cutoffAlreadyPassed: true,
  urgentWithin48h: false,
  retroactive: true,
  hoursUntilCutoff: -137.4,
};

const SALARY_CUT_ROW = {
  changes: { salary: { oldAmount: 72000, newAmount: 66000, currency: "EUR" } },
  payload: { annual_gross_salary: 6600000, job_title: "Engineer", currency: "EUR" },
  amendmentType: "SALARY_DECREASE",
  requestedEffectiveDate: "2026-09-15",
  decision: "escalate",
  reason: "cutoff_lock_passed",
  flags: ["cutoff_lock_passed", "retroactive_change"],
  cutoff: LOCKED_CUTOFF,
};

test("UC-06: both deciders are named, with DIFFERENT questions — not one shared blob", () => {
  const basis = describeAmendmentBasis({ amendmentRow: SALARY_CUT_ROW });
  assert.deepEqual(
    basis.roles.map((r) => r.role),
    ["customer_admin", "payroll_specialist"]
  );
  assert.notEqual(UC06_DECIDERS[0].decides, UC06_DECIDERS[1].decides);
  assert.match(basis.roles[0].decides, /right change to this person's contract/);
  assert.match(basis.roles[1].decides, /payroll can actually carry this change/);
  // Each points at the facts ITS decision turns on, deciding-factor first.
  assert.deepEqual(basis.roles[0].turnsOn, ["change", "schema"]);
  assert.deepEqual(basis.roles[1].turnsOn, ["payroll", "change"]);
  // And each headline is the fact that role acts on, not the same sentence twice.
  assert.notEqual(basis.roles[0].headline, basis.roles[1].headline);
});

test("UC-06: a pay cut states the size of the cut, not only its direction", () => {
  // `amendmentType: "SALARY_DECREASE"` told the admin the DIRECTION while both
  // amounts sat unrendered one field away. C-27, applied to somebody's salary.
  const change = describeAmendmentBasis({ amendmentRow: SALARY_CUT_ROW }).change;
  const salary = change.fields.find((f) => f.field === "salary");
  assert.equal(salary.from, "72,000.00 EUR");
  assert.equal(salary.to, "66,000.00 EUR");
  assert.equal(salary.delta, "-6,000.00 EUR");
  assert.equal(salary.percent, -8.3);
  assert.match(salary.sentence, /a decrease of 6,000.00 EUR/);
  assert.match(salary.sentence, /8.3%/);
});

test("UC-06: a zero current salary yields NO percentage rather than 0% or Infinity", () => {
  // describeCapComparison()'s guard, applied here. A fabricated percentage is
  // the same class of manufactured value this repo has already paid for.
  const basis = describeAmendmentBasis({
    amendmentRow: { ...SALARY_CUT_ROW, changes: { salary: { oldAmount: 0, newAmount: 50000, currency: "EUR" } } },
  });
  const salary = basis.change.fields.find((f) => f.field === "salary");
  assert.equal(salary.percent, null);
  assert.equal(salary.delta, "+50,000.00 EUR");
  assert.match(salary.sentence, /percentage is undefined/);
});

test("UC-06: the ×100 form is labelled as what will be SENT, beside the field name the form uses", () => {
  // Both scales are on the row one field apart. Printing either unlabelled is a
  // 100× ambiguity in front of a pay change.
  const salary = describeAmendmentBasis({ amendmentRow: SALARY_CUT_ROW }).change.fields.find(
    (f) => f.field === "salary"
  );
  assert.equal(salary.writesAs, "annual_gross_salary");
  assert.equal(salary.writesValue, 6600000);
  // The human-readable figures never carry the scaled number.
  assert.ok(!salary.from.includes("7200000"));
  assert.ok(!salary.to.includes("6600000"));
});

test("UC-06: a passed payroll lock names the cycle, the lock instant and how long ago it closed", () => {
  // `cutoff_lock_passed` was the whole message. Every one of these was on the
  // row, and the payroll specialist is the one person who could act on them.
  const payroll = describeAmendmentBasis({ amendmentRow: SALARY_CUT_ROW }).payroll;
  assert.equal(payroll.state, "locked");
  assert.equal(payroll.cycle.id, "pr-2026-09");
  assert.equal(payroll.cycle.cutoffAt, "2026-09-05T17:00:00");
  assert.equal(payroll.cycle.periodStart, "2026-09-01");
  assert.equal(payroll.cycle.payDate, "2026-09-28");
  assert.equal(payroll.requestedEffectiveDate, "2026-09-15");
  // A signed float is not a fact anybody acts on; a duration is.
  assert.equal(payroll.timeToLock, "5 days 17 hours");
  assert.match(payroll.sentence, /closed at 2026-09-05T17:00:00/);
  assert.match(payroll.sentence, /5 days 17 hours ago/);
});

test("UC-06: an approvable amendment states the runway before the lock, not just that it is clear", () => {
  // The positive direction. "Dual approval required" with no lock time tells
  // two people nothing about how long they have to fill their slots.
  const payroll = describeAmendmentBasis({
    amendmentRow: {
      ...SALARY_CUT_ROW,
      decision: "dual_approval_required",
      reason: "all_gates_passed",
      flags: ["urgent_cutoff"],
      cutoff: { ...LOCKED_CUTOFF, cutoffAlreadyPassed: false, retroactive: false, urgentWithin48h: true, hoursUntilCutoff: 30 },
    },
  }).payroll;
  assert.equal(payroll.state, "urgent");
  assert.equal(payroll.timeToLock, "1 day 6 hours");
  assert.match(payroll.sentence, /locks at 2026-09-05T17:00:00/);
  assert.match(payroll.sentence, /48-hour urgent window/);
  assert.match(payroll.sentence, /Pay date 2026-09-28/);
});

test("UC-06: an ambiguous calendar names the competing cycles and their differing locks", () => {
  // "ambiguous_payroll_cycle" told the one person who could settle it only that
  // it needed settling. Ten days of difference in a lock is the difference
  // between the change landing and not landing.
  const payroll = describeAmendmentBasis({
    amendmentRow: {
      ...SALARY_CUT_ROW,
      reason: "ambiguous_payroll_cycle",
      flags: ["ambiguous_payroll_cycle"],
      cutoff: {
        cycle: null,
        noMatchingCycle: false,
        cutoffUnknown: true,
        cutoffAlreadyPassed: false,
        urgentWithin48h: false,
        retroactive: false,
        hoursUntilCutoff: null,
        ambiguousCycles: [
          { id: "nl-main-06", type: "main", status: "processing", cutoff_date: "2026-06-20T00:00:00" },
          { id: "nl-oneoff-06", type: "one_off", status: "processing", cutoff_date: "2026-06-10T00:00:00" },
        ],
      },
    },
  }).payroll;
  assert.equal(payroll.state, "ambiguous");
  assert.equal(payroll.cycle, null, "a coin-flip cycle was recorded as the answer");
  assert.equal(payroll.candidates.length, 2);
  assert.match(payroll.sentence, /2026-06-20T00:00:00 vs 2026-06-10T00:00:00/);
  assert.match(payroll.sentence, /settled by a person/);
});

test("UC-06: an unreadable lock shows NO runway rather than a confident one", () => {
  // Finding F-26b's shape at the reporting layer. Every comparison against NaN
  // is false, which once produced "comfortably before the cutoff" from no
  // information at all.
  const payroll = describeAmendmentBasis({
    amendmentRow: {
      ...SALARY_CUT_ROW,
      reason: "cutoff_date_unknown",
      cutoff: { ...LOCKED_CUTOFF, cutoffUnknown: true, cutoffAlreadyPassed: false, hoursUntilCutoff: null },
    },
  }).payroll;
  assert.equal(payroll.state, "lock_unreadable");
  assert.equal(payroll.hoursUntilCutoff, null);
  assert.equal(payroll.timeToLock, null);
  assert.match(payroll.sentence, /No runway is shown/);
});

test("UC-06: a projected stand-in cycle is flagged as projected, not presented as Remote's own", () => {
  // `payrollProjection.js` mints `standin-` ids when the Sandbox calendar has
  // stopped. A specialist checking a lock has to know whether it is a published
  // one or a continuation of an observed cadence.
  const payroll = describeAmendmentBasis({
    amendmentRow: {
      ...SALARY_CUT_ROW,
      reason: "all_gates_passed",
      cutoff: {
        ...LOCKED_CUTOFF,
        cutoffAlreadyPassed: false,
        retroactive: false,
        hoursUntilCutoff: 300,
        cycle: { ...LOCKED_CUTOFF.cycle, id: "standin-nl-2026-09" },
      },
    },
  }).payroll;
  assert.equal(payroll.cycle.projected, true);
  assert.match(payroll.sentence, /PROJECTED continuation/);
});

test("UC-06: a form with no field for the change says exactly that, and names the change", () => {
  // Live, this is what a basic-information form says about a salary change: it
  // has no salary field. "schema_invalid" would send someone to fill in a field
  // that does not exist.
  const schema = describeAmendmentBasis({
    amendmentRow: {
      ...SALARY_CUT_ROW,
      reason: "change_not_expressible",
      flags: ["change_not_expressible", "unexpressible_salary"],
      payload: { job_title: "Engineer" },
    },
  }).schema;
  assert.equal(schema.state, "not_expressible");
  assert.deepEqual(schema.unexpressibleChanges, ["salary"]);
  assert.match(schema.sentence, /has no field for: salary/);
  assert.match(schema.sentence, /not a matter of supplying more detail/);
});

test("UC-06: a schema check that never ran says so, rather than reading as a form that was satisfied", () => {
  // THE `not_reached` VERSUS `passed` DISTINCTION, one layer down from the gate
  // ladder. evaluate() builds no payload before the form gate, so an identity
  // refusal arrives here with nothing constructed — and falling through to the
  // success sentence would tell the admin a form was satisfied by a payload
  // nobody built, about a record nobody fetched.
  const schema = describeAmendmentBasis({
    amendmentRow: {
      changes: { salary: { oldAmount: 72000, newAmount: 80000, currency: "EUR" } },
      payload: null,
      amendmentType: "SALARY_INCREASE",
      requestedEffectiveDate: "2026-09-15",
      decision: "escalate",
      reason: "identity_not_verified",
      flags: ["identity_not_verified"],
      cutoff: null,
    },
  }).schema;
  assert.equal(schema.state, "not_assessed");
  assert.match(schema.sentence, /never consulted/);
  assert.match(schema.sentence, /Nothing here says the change is valid or invalid/);
});

test("UC-06: a payroll calendar that was never consulted says so too", () => {
  const payroll = describeAmendmentBasis({
    amendmentRow: { ...SALARY_CUT_ROW, reason: "employee_not_active", cutoff: null },
  }).payroll;
  assert.equal(payroll.state, "not_assessed");
  assert.equal(payroll.cycle, null);
  assert.match(payroll.sentence, /never consulted/);
});

// ===========================================================================
// Cross-cutting: what all three describers must never be
// ===========================================================================

test("all three describers return null for a missing row rather than an empty-looking one", () => {
  // An object full of nulls reads as "we looked and found nothing". There was
  // no row to look at.
  assert.equal(describeDecisionBasis({ authorizationRow: null }), null);
  assert.equal(describeSignoffBasis({ resignationRow: null }), null);
  assert.equal(describeAmendmentBasis({ amendmentRow: null }), null);
  assert.equal(describeDecisionBasis(), null);
  assert.equal(describeSignoffBasis(), null);
  assert.equal(describeAmendmentBasis(), null);
});

test("STRUCTURAL: no describer imports a REST client, a store, an LLM or an audit logger", () => {
  // A describer that could call out is a describer that could be slow,
  // non-deterministic, and — the part that matters — a gate nobody reviewed.
  // The same structural argument UC-08 makes about its write path: removing the
  // import removes the bug's precondition, and only a check on the SOURCE can
  // prove the import is absent rather than merely unused.
  const forbidden = [/restClient/, /zendesk/i, /\/llm\.js/, /shared\/audit\.js/, /Store\.js/, /openai/i];
  for (const file of ["uc04", "uc05", "uc06"].map((uc) => `src/${uc}/decisionFacts.js`)) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const imports = source.split("\n").filter((l) => l.trimStart().startsWith("import "));
    for (const pattern of forbidden) {
      assert.ok(
        !imports.some((l) => pattern.test(l)),
        `${file} imports something matching ${pattern} — a describer must not be able to reach a service`
      );
    }
  }
});

test("STRUCTURAL: no policy engine or approval policy reads a describer", () => {
  // The other direction, and the one that keeps this a description rather than
  // a fifth gate. If a gate could consult these, the honest "unknown" states
  // above would start changing decisions.
  const gateFiles = [
    "src/uc04/policyEngine.js",
    "src/uc04/approvalPolicy.js",
    "src/uc05/policyEngine.js",
    "src/uc05/signoffPolicy.js",
    "src/uc06/policyEngine.js",
    "src/uc06/dualApprovalPolicy.js",
  ];
  for (const file of gateFiles) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/decisionFacts/.test(source), `${file} references decisionFacts — a gate must not read a describer`);
  }
});

test("the API views actually serve the basis — a describer nothing renders is pattern P8", () => {
  // docs/CORRECTIONS-LOG.md P8: "a capability fully built and reachable by
  // nobody". `notListed` and `lookupRef()` were both complete, correct, tested,
  // and rendered by nothing. Wiring is part of done, and a source check is what
  // makes that claim verifiable rather than asserted.
  for (const [file, symbol] of [
    ["src/uc04/server.js", "describeDecisionBasis"],
    ["src/uc05/server.js", "describeSignoffBasis"],
    ["src/uc06/server.js", "describeAmendmentBasis"],
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`import \\{[^}]*${symbol}`), `${file} does not import ${symbol}`);
    assert.match(source, /basis:/, `${file} builds no \`basis\` field on its view`);
  }
  // UC-06 additionally had no gate ladder at all until this pass.
  const uc06 = readFileSync(new URL("../src/uc06/server.js", import.meta.url), "utf8");
  assert.match(uc06, /decidedBy: describeDecidingGate/);
  assert.match(uc06, /gateLadder: describeGateLadder/);
});

// ---------------------------------------------------------------------------
// NO MEASUREMENT, NO CLEARANCE — every early exit, not two of them
// ---------------------------------------------------------------------------
// Found 2026-09-02 by a global mobility specialist reading the reassembled
// UC-04 panel, who named it the one finding that would stop them signing a
// Schengen case.
//
// `classifyRisk()` returns early with `schengen: null` whenever ANY prior gate
// raised a reason. The describer's refusal test caught two of those causes —
// `travel_history_unreadable` and `NOT_EVALUATED` — so a visitor visa, a US/CA
// work permit, a same-country trip or an invalid date all fell through to the
// `within_limit` branch. On a decision taken seconds earlier the panel rendered,
// in green:
//
//     Schengen days across a rolling 180 days
//     not measured on this run      ✓ Within the limit
//
// The value and the state mark contradicting each other on one line, over a
// 180-day window synthesised across a period nothing was measured over, filed
// under the summary "Each of these ran and found nothing against the request.
// None of them is a gate that never ran."
//
// The test is now the ABSENCE OF A MEASUREMENT rather than a list of causes, so
// an early exit added tomorrow is covered by construction.
// ---------------------------------------------------------------------------

test("UC-04: a Schengen row whose count never ran is NOT_ASSESSED, whatever stopped it", () => {
  // A visitor visa blocks at the document gate, well before the day count. It
  // sets neither `travel_history_unreadable` nor `NOT_EVALUATED`, which is
  // exactly why it used to clear.
  const { row, result } = uc04Row({
    factors: {
      ...BASE_FACTORS,
      destination: { country: "ES" },
      visaType: "tourist_visa",
      startDate: "2026-09-01",
      endDate: "2026-09-20",
    },
  });
  assert.notEqual(result.decision, "ready_for_approval", "the fixture stopped blocking — pick another early exit");

  const schengen = describeDecisionBasis({ authorizationRow: row }).measurements.find(
    (m) => m.key === "schengen_90_180"
  );
  assert.ok(schengen, "a Schengen destination produced no Schengen row at all");

  assert.equal(schengen.state, "not_assessed", "an unmeasured allowance is being reported as cleared");
  assert.equal(schengen.measured, null);
  assert.equal(schengen.headroom, null, "headroom on a count that never ran is a manufactured number");
  assert.equal(schengen.breached, false);

  // NO WINDOW. `trailingWindow()` would compute a plausible one, and a window
  // nothing measured over is the same false statement in a smaller font.
  assert.equal(schengen.window, null, "a window was synthesised for a count that never happened");

  // And the sentence must not contain the clearing phrase in any form.
  assert.doesNotMatch(schengen.note, /within the (limit|allowance)/i);
  assert.doesNotMatch(schengen.note, /predates the matrix/i, "an early exit is being described as an old record");
  assert.match(schengen.note, /not cleared/i);
});

test("UC-04: a MEASURED within-limit case still clears — the fix must not refuse everything", () => {
  // The control. Without this the change above would pass just as well against
  // a describer that reported every Schengen row as unassessed, which is
  // failing closed by never working.
  const { row, result } = uc04Row({
    factors: {
      ...BASE_FACTORS,
      destination: { country: "ES" },
      visaType: "schengen_short_stay",
      startDate: "2026-09-01",
      endDate: "2026-09-20",
    },
    travelHistory: [],
  });
  assert.equal(result.decision, "ready_for_approval");

  const schengen = describeDecisionBasis({ authorizationRow: row }).measurements.find(
    (m) => m.key === "schengen_90_180"
  );
  assert.equal(schengen.state, "within_limit");
  assert.ok(Number.isFinite(schengen.measured), "a cleared row must carry the figure it cleared on");
  assert.ok(schengen.window, "a real measurement must name the window it measured over");
  assert.match(schengen.note, /Within the allowance/);
});
