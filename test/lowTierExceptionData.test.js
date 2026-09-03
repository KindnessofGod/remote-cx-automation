// ---------------------------------------------------------------------------
// lowTierExceptionData.test.js  —  What a reviewer of a 🟢 exception is given
// ---------------------------------------------------------------------------
// WHY THIS SUITE EXISTS, AND WHY IT IS ONE FILE ACROSS THREE USE CASES
//
// UC-01, UC-02 and UC-03 auto-resolve the clean cases, so the only part of them
// a person ever sees is an EXCEPTION — and it is seen by someone who, by
// definition, has the hard case. The exception surface is therefore the entire
// human-facing product of a 🟢 use case, and it is the one part of these three
// that nothing was asserting anything about.
//
// The defect this suite pins is P7 in `docs/CORRECTIONS-LOG.md`: *the system
// held a specific fact and reported a weaker one that was still true.* C-22 (a
// bare reason slug) and C-27 (four figures the decision was made from, none of
// them printed) are the two recorded instances, both fixed for UC-02's cap gate
// only. Every assertion in this file is of the form "the surface names the
// figure the gate compared", because that is the only shape of assertion that
// can catch a true-but-incomplete sentence — no test of the DECISION can, and
// 2,191 of them passed while all of this was missing.
//
// The other half is P9 (C-31), which is P7 rotated 180°: the surface asserting
// something the system never did. Adding detail is exactly the opportunity to
// commit it, so two tests here guard the direction of travel rather than its
// volume — the UC-04 handoff bundle must say `no` to "dispatched", and no UC-01
// fact bundle may ever carry a compensation value.
//
// Hermetic: the real Remote mock on a dedicated test port, rule-based
// classifiers injected everywhere, in-memory stores. No test may reach OpenAI.
// ---------------------------------------------------------------------------

import { shortReference } from "../src/shared/publicReference.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { startMockServer, EMPLOYMENTS } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";

import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import * as uc01Policy from "../src/uc01/policyEngine.js";

import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import * as uc02Policy from "../src/uc02/policyEngine.js";
import { createUc02Handler } from "../src/uc02/server.js";

import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import * as uc03Policy from "../src/uc03/policyEngine.js";

import { fact, unknownFact, formatFactsForNote } from "../src/shared/decisionFacts.js";

const TEST_PORT = 4106; // allocated in src/shared/ports.js TEST_PORTS (was 4094, which three other files bind)

let server;
let remote;

before(async () => {
  server = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});
after(() => server?.close());

/** Every fact's label+value+note as one lowercase string, for "does it name X". */
function textOf(bundle) {
  if (!bundle) return "";
  return [bundle.sentence, ...bundle.facts.map((f) => `${f.label} ${f.value ?? ""} ${f.note ?? ""}`)]
    .join(" | ")
    .toLowerCase();
}

/** A Zendesk double that records the internal note instead of posting one. */
function noteCapturingZendesk() {
  const notes = [];
  return {
    notes,
    async flagForReview(_ref, { note }) {
      notes.push(note);
    },
    async resolveWithLetter() {},
    async updateTicket() {},
  };
}

// ---------------------------------------------------------------------------
// SHARED — the never-invent, never-default discipline the rest of this rests on
// ---------------------------------------------------------------------------

test("shared: a zero is a measurement and survives; a null becomes an explicit unknown", () => {
  // 0 is a real reading (no receipts attached) and must not be swallowed by a
  // falsy check — this is the exact shape of the manufactured zero this repo
  // has paid for three times.
  assert.equal(fact("Receipts", 0).value, "0");
  assert.equal(fact("Receipts", 0).known, true);

  // null is not a reading. It becomes an unknown with a reason, never "0" and
  // never the string "null".
  const missing = fact("Receipts", null);
  assert.equal(missing.value, null);
  assert.equal(missing.known, false);
  assert.ok(missing.note, "an unknown with no note is a shrug, not a next step");
});

test("shared: a Zendesk note prints unknowns rather than omitting them", () => {
  // A silently absent row is indistinguishable from a figure nobody thought to
  // include, which is how C-27's four numbers went missing in the first place.
  const line = formatFactsForNote({
    sentence: "Something was refused.",
    facts: [fact("Amount", "10.00 USD"), unknownFact("Rate used", "Not on the record.")],
  });
  assert.match(line, /Amount: 10\.00 USD/);
  assert.match(line, /Rate used: NOT AVAILABLE — Not on the record\./);
});

// ---------------------------------------------------------------------------
// UC-01 — the use case that had no ladder and no facts at all
// ---------------------------------------------------------------------------

test("UC-01: every reason evaluate() can return has a GATE_SEQUENCE row", () => {
  // Drift guard, the same one test/uc02Review.test.js runs: a gate added
  // without a row reports "unknown" forever without erroring, which is a
  // silent regression to exactly the bare-slug surface this closed.
  const src = uc01Policy.evaluate.toString();
  const reasons = new Set([...src.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 10, `expected to scrape UC-01's reasons, found ${reasons.size}`);
  for (const reason of reasons) {
    assert.ok(
      uc01Policy.describeDecidingGate(reason),
      `reason "${reason}" has no GATE_SEQUENCE row, so it renders as a bare slug`
    );
  }
});

test("UC-01: the over-scope facts name the same fields evaluate() refused on", () => {
  // `evaluate()` puts `overScopeFields` on its outcome and the workflow used to
  // throw it away. The describer RECOMPUTES it rather than being handed it, so
  // a caller holding only a stored classification gets the same list — this
  // pins the two against each other so they cannot drift apart.
  const classification = {
    intent: "standard_letter",
    requesterType: "self",
    hasAttachment: false,
    hasExternalUrl: false,
    confidence: 0.95,
    requestedFields: ["salary", "manager_name", "full_name"],
    source: "llm",
  };
  const outcome = uc01Policy.evaluate({
    employment: EMPLOYMENTS.emp_active_001,
    classification,
    identity: { verified: true, method: "session", reason: "authenticated_session" },
  });
  assert.equal(outcome.reason, "over_scope_request");

  const bundle = uc01Policy.describeDecisionFacts({ reason: outcome.reason, classification });
  const named = bundle.facts.find((f) => f.label === "Asked for beyond the standard letter");
  assert.equal(named.value, outcome.overScopeFields.join(", "));
  assert.match(bundle.sentence, /salary/);
  assert.match(bundle.sentence, /manager_name/);
});

test("UC-01: the incomplete-record facts name the same missing fields evaluate() refused on", () => {
  // `contract_type` is NOT blanked here any more. Since G-1 it is read by gate 1
  // (engagement eligibility) as well as gate 12 (record completeness), so a
  // blank one refuses as `eor_status_unknown` and never reaches the gate this
  // test is about. That routing is asserted directly at the end of this test
  // rather than left implicit.
  const employment = { ...EMPLOYMENTS.emp_active_001, start_date: null };
  const classification = {
    intent: "standard_letter",
    requesterType: "self",
    hasAttachment: false,
    hasExternalUrl: false,
    confidence: 0.95,
    requestedFields: [],
    source: "llm",
  };
  const outcome = uc01Policy.evaluate({
    employment,
    classification,
    identity: { verified: true, method: "session", reason: "authenticated_session" },
  });
  assert.equal(outcome.reason, "incomplete_employment_record");

  const bundle = uc01Policy.describeDecisionFacts({ reason: outcome.reason, employment, classification });
  const missing = bundle.facts.find((f) => f.label === "Missing from the record");
  assert.equal(missing.value, outcome.missingFields.join(", "));
  assert.match(missing.value, /start_date/);

  // And the other half: a blank engagement type refuses EARLIER, at gate 1, with
  // a reason that names the actual problem. If gate 1 ever stops catching it the
  // case falls back to gate 12 and this fails.
  const noEngagement = uc01Policy.evaluate({
    employment: { ...EMPLOYMENTS.emp_active_001, contract_type: "" },
    classification,
    identity: { verified: true, method: "session", reason: "authenticated_session" },
  });
  assert.equal(noEngagement.decision, "blocked");
  assert.equal(noEngagement.reason, "eor_status_unknown");
});

test("UC-01: NO fact bundle, for ANY reason, may carry a compensation value", () => {
  // THE LIVE CONSTRAINT. `over_scope_request` fires precisely because somebody
  // asked for salary, so the "helpful" move is to show the reviewer the figure —
  // which would put compensation into the exception surface of the one use case
  // whose entire safety property is that its letter does not carry it. The
  // reviewer panel and the letter are different artifacts and only one of them
  // is safe to enrich, so the FIELD NAME travels and the value never does.
  const employment = {
    ...EMPLOYMENTS.emp_active_001,
    base_salary: 5000000,
    compensation_gross_amount: 25000,
    salary: 987654,
    compensation: { amount: 424242 },
  };
  const forbidden = ["5000000", "50000.00", "25000", "987654", "424242"];
  const identity = { verified: false, method: "none", reason: "unauthenticated_requires_stepup" };
  const classification = {
    intent: "non_standard",
    requesterType: "self",
    hasAttachment: true,
    hasExternalUrl: true,
    confidence: 0.4,
    requestedFields: ["salary"],
    source: "llm",
  };

  for (const row of uc01Policy.GATE_SEQUENCE) {
    const bundle = uc01Policy.describeDecisionFacts({
      reason: row.reason,
      employment,
      classification,
      identity,
    });
    const serialized = JSON.stringify(bundle ?? {});
    for (const value of forbidden) {
      assert.ok(
        !serialized.includes(value),
        `the "${row.reason}" fact bundle leaks a compensation value (${value})`
      );
    }
  }
});

test("UC-01: the Zendesk note a specialist receives names the confidence AND the threshold", async () => {
  // Before this, the whole note was:
  //   "AI summary — decision: human_review (low_confidence). Flags: low_confidence."
  // — true, and it left the specialist unable to tell 0.84 from 0.05.
  const zendesk = noteCapturingZendesk();
  const result = await handleVerificationTicket(
    {
      text: "hmm about my employment situation",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      source: "zendesk",
      externalRef: "9001",
    },
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      zendesk,
      // A classifier that reports a real, low confidence — the figure under test.
      classify: async () => ({
        intent: "standard_letter",
        requesterType: "self",
        hasAttachment: false,
        hasExternalUrl: false,
        confidence: 0.42,
        requestedFields: [],
        source: "rule_based_fallback",
      }),
    }
  );

  assert.equal(result.reason, "low_confidence");
  assert.equal(zendesk.notes.length, 1);
  const note = zendesk.notes[0];
  assert.match(note, /low_confidence/, "the slug stays — it is what audit_log and the metrics ranking key on");
  assert.match(note, /0\.42/, "the confidence the decision was made on");
  assert.match(note, /0\.85/, "the threshold it was compared against");
  assert.match(note, /rule_based_fallback/, "which reader produced the reading");
  // 11 of 13, not 10 of 12: G-1 inserted engagement eligibility as gate 1 and
  // G-2 added a second outcome to the terminal gate, so every rung below
  // engagement moved down one and the ladder grew by one rung. Both numbers are
  // asserted literally rather than computed from GATE_SEQUENCE — a test that
  // derives the expected position from the same table the code reads would
  // agree with any renumbering, including a wrong one.
  assert.match(note, /gate 11 of 13/, "where in the order this stopped");
});

test("UC-01: a pending consent case says WHICH signal was missing, and the two situations differ (G-3)", async () => {
  // G-3 changes what BOTH of these scenarios mean, and the change is the
  // point rather than a regression: since requesterType is now DERIVED
  // (L-10, deriveRequesterType) rather than declared, EVERY session mismatch
  // — no session at all, or a session naming a DIFFERENT employment — lands
  // on the third-party regime, never on a bare "self" identity refusal.
  // `identity_not_verified` for a mismatched "self" session is consequently
  // UNREACHABLE from the full workflow now (see src/shared/identity.js's own
  // comment on `session_employment_mismatch`: reachable only by a direct call
  // that bypasses derivation). This test asserted `identity_not_verified` for
  // both until 2026-08-21; the scenarios are unchanged, the outcome they
  // reach and the assertion are what moved.
  const run = (session) =>
    handleVerificationTicket(
      {
        text: "Please send a standard employment verification letter.",
        employmentId: "emp_active_001",
        session,
      },
      { remote, audit: new AuditLogger(), caseStore: new CaseStore(), classify: classifyRequestRuleBased }
    );

  const noSession = await run(null);
  const wrongPerson = await run({ authenticatedEmploymentId: "emp_active_003" });

  // Same outer reason (VC-06: neither is a refusal), opposite situations: one
  // is an ordinary third party with nobody signed in, the other is somebody
  // signed in as a DIFFERENT employee — worth a second look at who is signed
  // in, per identity.js's own reasoning. A reviewer cannot act on
  // "awaiting_employee_consent" without being told which.
  assert.equal(noSession.reason, "awaiting_employee_consent");
  assert.equal(wrongPerson.reason, "awaiting_employee_consent");
  assert.equal(noSession.identity.reason, "awaiting_employee_consent");
  assert.equal(wrongPerson.identity.reason, "awaiting_employee_consent_other_employee_signed_in");
  // The two flag lists differ, which is what a reviewer working these two
  // apart from the audit trail actually reads.
  assert.notDeepEqual(noSession.flags, wrongPerson.flags);
  // And the decision-facts bundle carries the diagnostic difference even
  // though the two share the same lead sentence (VC-33 requires the THIRD
  // PARTY see identical wording either way — this is the SPECIALIST'S view,
  // a different reader, and it may say more).
  assert.doesNotMatch(textOf(noSession.decisionFacts), /worth a second look/i);
  assert.match(textOf(wrongPerson.decisionFacts), /worth a second look/i);
  assert.match(textOf(wrongPerson.decisionFacts), /different employee/i);
});

test("UC-01: the result carries the classification the decision was made on", async () => {
  const r = await handleVerificationTicket(
    {
      text: "My bank sent this form, please complete it.",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      hasAttachment: true,
    },
    { remote, audit: new AuditLogger(), caseStore: new CaseStore(), classify: classifyRequestRuleBased }
  );
  assert.equal(r.reason, "artifact_present");
  assert.ok(r.classification, "five gates read this object and no caller could see it");
  assert.ok(r.identity, "a passing identity check left no trace on the result at all");
  assert.equal(r.decidedBy.gate, "no_artifacts");
  // WHICH artifact: an attached form and a portal link are different jobs.
  assert.match(textOf(r.decisionFacts), /attachment on the ticket yes/);
});

test("UC-01: an auto-resolved decision carries no fact bundle", () => {
  // null, not an empty bundle — an empty panel reads like missing data, and
  // nothing was refused, so there are no figures behind a refusal to show.
  assert.equal(
    uc01Policy.describeDecisionFacts({ reason: "all_gates_passed", employment: EMPLOYMENTS.emp_active_001 }),
    null
  );
});

// ---------------------------------------------------------------------------
// UC-02 — the reasons C-27's fix never reached
// ---------------------------------------------------------------------------

async function submit(expenseId, opts = {}) {
  const expenseStore = new ExpenseStore();
  const result = await handleExpenseSubmission(
    {
      expenseId,
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      source: "test",
      ...opts,
    },
    { remote, audit: new AuditLogger(), expenseStore, classify: classifyExpenseRuleBased }
  );
  return { result, expenseStore };
}

test("UC-02: a duplicate refusal names the expense it duplicates", async () => {
  // The brief's own example of a fact that fails "…and then what?": a duplicate
  // flag with no pointer to the original leaves the reviewer searching for a row
  // they hold no key for, and the alternative to finding it is paying twice.
  const expenseStore = new ExpenseStore();
  const deps = { remote, audit: new AuditLogger(), expenseStore, classify: classifyExpenseRuleBased };
  const session = { authenticatedEmploymentId: "emp_active_001" };

  const first = await handleExpenseSubmission(
    { expenseId: "exp_dup_a_102", employmentId: "emp_active_001", session, source: "test", externalRef: "t-dup-1" },
    deps
  );
  const second = await handleExpenseSubmission(
    { expenseId: "exp_dup_b_103", employmentId: "emp_active_001", session, source: "test", externalRef: "t-dup-2" },
    deps
  );

  assert.equal(second.reason, "duplicate_submission");
  const text = textOf(second.decisionFacts);
  assert.match(text, /exp_dup_a_102/, "the earlier expense id — the pointer to the original");
  assert.match(text, /t-dup-1/, "its ticket, so the reviewer can open it");
  // SHORTENED, NOT DROPPED (2026-08-31). This asserted the FULL store-row UUID
  // appeared in the text. It is a customer-facing panel, so the reference is now
  // rendered as its first block — a PREFIX of the real id, which still resolves
  // by prefix search, so the pointer does exactly the job this assertion is
  // about: the reviewer can open the earlier record instead of searching for a
  // row they have no key for. See test/zafNoDeveloperArtifacts.test.js.
  assert.ok(
    text.includes(shortReference(first.storeId)),
    "its store row reference, for the audit viewer"
  );
  assert.ok(!text.includes(first.storeId), "the full UUID is back on a customer-facing panel");
});

test("UC-02: a currency refusal names BOTH currencies", async () => {
  // The brief's second example. "This system cannot verify the rate that was
  // used" is true and names neither side of the conversion it is about.
  const { result } = await submit("exp_cross_currency_107");
  assert.equal(result.reason, "currency_conversion_unverified");
  const text = textOf(result.decisionFacts);
  assert.match(text, /filed in eur/);
  assert.match(text, /converted to usd/);
  assert.match(text, /200\.00 eur/, "the amount as filed");
  assert.match(text, /220\.00 usd/, "the amount as converted");
});

test("UC-02: the four cap figures survive onto the STORED row and out of the API", async () => {
  // C-27 was fixed on the submission response and the note built from it. The
  // Finance Ops specialist opens the sidebar the next morning, which reads the
  // stored row — and that row held no figures at all, so the same four numbers
  // were missing again one surface over.
  const { result, expenseStore } = await submit("exp_over_cap_201");
  assert.equal(result.reason, "over_policy_cap");

  const row = await expenseStore.findById(result.storeId);
  assert.ok(row.decisionEvidence, "the row must carry the figures the gate compared");
  assert.equal(row.decisionEvidence.convertedAmount, 75000);
  assert.equal(row.decisionEvidence.policyCap, 50000);

  // …and out through the read surface a reviewer actually uses.
  const handler = createUc02Handler({
    expenseStore,
    audit: new AuditLogger(),
    remote,
    requireSignedIdentity: false,
    allowUnauthenticatedDemo: true,
  });
  const view = await callGet(handler, `/api/expenses/${result.storeId}`);
  const text = textOf(view.decisionFacts);
  assert.match(text, /750\.00 usd/, "claimed");
  assert.match(text, /500\.00 usd/, "cap");
  assert.match(text, /250\.00 usd/, "over by");
  assert.match(text, /50%/, "percent over");
});

test("UC-02: a confidence refusal names the score and the threshold", () => {
  const evidence = uc02Policy.captureEvidence({
    classification: { categoryId: "meals", source: "llm", confidence: 0.5 },
  });
  const bundle = uc02Policy.describeDecisionFacts({ reason: "low_confidence", evidence });
  assert.match(bundle.sentence, /0\.5/);
  assert.match(bundle.sentence, /0\.85/);
  // …and says what the figure does NOT mean, because a confidence printed beside
  // a decision reads as causal (docs/GATES.md's own worked misreading).
  assert.match(textOf(bundle), /does not say/);
});

test("UC-02: an ownership refusal names BOTH employments", () => {
  const evidence = uc02Policy.captureEvidence({
    expense: { id: "exp_x", employment_id: "emp_other_999" },
    employmentId: "emp_active_001",
  });
  const bundle = uc02Policy.describeDecisionFacts({ reason: "expense_employment_mismatch", evidence });
  assert.match(bundle.sentence, /emp_other_999/);
  assert.match(bundle.sentence, /emp_active_001/);
});

test("UC-02: an invalid-amount refusal names the FIELD, and prints it unformatted", () => {
  // "One of the money fields is not a whole number of minor units" is true of
  // four fields and actionable about none. And the bad value must be printed as
  // stored: dividing a malformed value by 100 and rendering it as currency hides
  // the exact thing the reviewer has to see.
  const evidence = uc02Policy.captureEvidence({
    expense: { id: "exp_x", amount: 12.5, converted_amount: 1200, tax_amount: 0, converted_tax_amount: 0 },
  });
  const bundle = uc02Policy.describeDecisionFacts({ reason: "invalid_amount", evidence });
  assert.match(bundle.sentence, /^amount did not pass/);
  const raw = bundle.facts.find((f) => f.label === "amount");
  assert.equal(raw.value, "12.5", "printed as stored, not as 0.13 USD");
});

test("UC-02: a receipt refusal separates 'none attached' from 'none usable'", () => {
  // Two counts, because they differ and the difference is the whole finding: a
  // File row the schema would reject is present in the array and is not evidence.
  const none = uc02Policy.describeDecisionFacts({
    reason: "missing_receipt_evidence",
    evidence: uc02Policy.captureEvidence({ expense: { id: "e", receipts: [] } }),
  });
  const placeholder = uc02Policy.describeDecisionFacts({
    reason: "missing_receipt_evidence",
    evidence: uc02Policy.captureEvidence({ expense: { id: "e", receipts: [{ id: "r1" }, { id: "r2" }] } }),
  });
  assert.match(none.sentence, /No receipt is attached/);
  assert.match(placeholder.sentence, /2 receipt row\(s\) are attached and none of them is usable/);
});

test("UC-02: evidence records a null as a null, never as a zero", () => {
  // A `receiptCount: 0` means "the record carried no receipts". A `null` means
  // "there was no record to count". They are opposite facts about an expense
  // somebody is waiting to be paid for, and defaulting the second to the first
  // is the manufactured zero this repo has already paid for three times.
  const noRecord = uc02Policy.captureEvidence({ expense: null });
  assert.equal(noRecord.receiptCount, null);
  assert.equal(noRecord.usableReceiptCount, null);
  assert.equal(noRecord.amount, null);

  const emptyRecord = uc02Policy.captureEvidence({ expense: { id: "e", receipts: [] } });
  assert.equal(emptyRecord.receiptCount, 0);
});

test("UC-02: a row with no stored evidence yields no bundle rather than a bundle of blanks", () => {
  // Rows written before the column existed. The honest answer is that the
  // figures were not kept, not that the decision was made on missing data.
  assert.equal(uc02Policy.describeDecisionFacts({ reason: "over_policy_cap", evidence: null }), null);
});

// ---------------------------------------------------------------------------
// UC-03 — the twin of the cap gate, and the P9 guard
// ---------------------------------------------------------------------------

test("UC-03: an over-cap refusal names the trip length, the cap and the difference", async () => {
  // The exact twin of UC-02's `over_policy_cap` (C-27): this router computes the
  // day count, compares it against a cap, holds both figures at the instant it
  // refuses, and told the specialist only that the trip was "longer than the cap".
  const zendesk = noteCapturingZendesk();
  const result = await handleTravelInquiry(
    {
      text: "I want to work from Spain from 2026-09-01 to 2026-12-01",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      source: "zendesk",
      externalRef: "9101",
    },
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      zendesk,
      classify: async () => ({
        intent: "travel_letter",
        destinationCountry: "ES",
        startDate: "2026-09-01",
        endDate: "2026-12-01",
        formalLetterRequested: false,
        confidence: 0.9,
        source: "rule_based_fallback",
      }),
    }
  );

  assert.equal(result.reason, "duration_over_cap");
  assert.match(result.decisionFacts.sentence, /92 days against a 30-day cap — 62 days over/);
  // …and it reaches the specialist, not just the API caller.
  assert.match(zendesk.notes[0], /92 days/);
  assert.match(zendesk.notes[0], /30 days/);
  // P9 guard on the same bundle: over the cap is a risk signal, not a refusal,
  // and the surface must not imply the trip was disallowed.
  assert.match(textOf(result.decisionFacts), /does not mean.*that the trip is disallowed/);
});

test("UC-03: an unread country registry is an unknown, and an EMPTY one says so", () => {
  // Three different states that all produce the same refusal, and only the count
  // separates them. A zero here is a finding about our own read; a null is "not
  // recorded". Passing an empty Set for "we don't have it" would manufacture the
  // first from the second.
  const classification = { destinationCountry: "PT", startDate: "2026-09-01", endDate: "2026-09-10" };

  const notRecorded = uc03Policy.describeDecisionFacts({
    reason: "destination_jurisdiction_excluded",
    classification,
    supportedCountries: null,
  });
  const emptyRegistry = uc03Policy.describeDecisionFacts({
    reason: "destination_jurisdiction_excluded",
    classification,
    supportedCountries: new Set(),
  });
  const realRegistry = uc03Policy.describeDecisionFacts({
    reason: "destination_jurisdiction_excluded",
    classification,
    supportedCountries: new Set(["ES", "FR", "DE"]),
  });

  const count = (b) => b.facts.find((f) => f.label === "Countries in the registry on this run");
  assert.equal(count(notRecorded).known, false, "not recorded is an unknown, never a zero");
  assert.match(count(notRecorded).note, /supportedCountriesChecked/, "and it names where the real set is");
  assert.equal(count(emptyRegistry).value, "0");
  assert.match(emptyRegistry.sentence, /came back EMPTY/);
  assert.equal(count(realRegistry).value, "3");
  assert.match(realRegistry.sentence, /\(3 countries\)/);
});

test("UC-03: the UC-04 handoff bundle asserts that nothing was dispatched", async () => {
  // P9 / C-31, guarded in the direction it actually failed. `uc04Intake.js`
  // records `dispatched: false` as a literal; this bundle must agree with it and
  // must never grow a sentence claiming a transfer.
  const result = await handleTravelInquiry(
    {
      text: "I am relocating to Portugal and will keep doing my job from there",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
    },
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      classify: async () => ({
        intent: "work_authorization",
        destinationCountry: "PT",
        startDate: "2026-09-01",
        endDate: "2026-10-01",
        formalLetterRequested: false,
        confidence: 0.9,
        source: "rule_based_fallback",
      }),
    }
  );

  assert.equal(result.reason, "work_authorization_requested");
  assert.equal(result.uc04Intake.dispatched, false, "the record's own literal");
  const dispatched = result.decisionFacts.facts.find((f) => f.label === "Dispatched to UC-04");
  assert.equal(dispatched.value, "no");
  const text = textOf(result.decisionFacts);
  assert.ok(!/has been handed/.test(text), "the exact false sentence C-31 was raised about");
  assert.ok(!/\bsent to uc-04\b/.test(text));
  // …and it names what the person must file instead, which is the actionable half.
  assert.match(text, /request hub/);
});

test("UC-03: a sanctions refusal names the destination and calls its list illustrative", async () => {
  const result = await handleTravelInquiry(
    {
      text: "Can I work from Iran for two weeks",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
    },
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      classify: async () => ({
        intent: "travel_letter",
        destinationCountry: "IR",
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        formalLetterRequested: false,
        confidence: 0.9,
        source: "rule_based_fallback",
      }),
    }
  );
  assert.equal(result.reason, "sanctioned_region");
  const text = textOf(result.decisionFacts);
  assert.match(text, /^ir is on the sanctioned/);
  assert.match(text, /illustrative demonstration set/, "never presented as Remote's authoritative list");
});

test("UC-03: the API view rebuilds the figures from the stored case row", async () => {
  // The reviewer furthest from the run — the one opening this days later — used
  // to get a slug, a gate name and no numbers. Most of the figures survive
  // because `cases.classification` is persisted, which is why the describer
  // derives the day count instead of being handed it.
  const { createUc03Handler } = await import("../src/uc03/server.js");
  const caseStore = new CaseStore();
  await handleTravelInquiry(
    {
      text: "Portugal for three months",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      externalRef: "9102",
    },
    {
      remote,
      audit: new AuditLogger(),
      caseStore,
      classify: async () => ({
        intent: "travel_letter",
        destinationCountry: "ES",
        startDate: "2026-09-01",
        endDate: "2026-12-01",
        formalLetterRequested: false,
        confidence: 0.9,
        source: "rule_based_fallback",
      }),
    }
  );

  const handler = createUc03Handler({ caseStore });
  const view = await callGet(handler, "/api/cases/by-ticket/9102");
  assert.equal(view.caseRow.reason, "duration_over_cap");
  assert.match(view.decisionFacts.sentence, /92 days against a 30-day cap/);
});

// ---------------------------------------------------------------------------
// A tiny in-process HTTP driver, so the API assertions above go through the
// real handler rather than around it.
// ---------------------------------------------------------------------------

function callGet(handler, path) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      statusCode: 200,
      setHeader() {},
      end(body) {
        if (body) chunks.push(body);
        try {
          resolve(JSON.parse(chunks.join("")));
        } catch (err) {
          reject(err);
        }
      },
    };
    Promise.resolve(handler({ method: "GET", url: path, headers: {} }, res)).catch(reject);
  });
}
