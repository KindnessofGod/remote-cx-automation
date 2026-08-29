// ---------------------------------------------------------------------------
// n8nInternalNoteParity.test.js — the n8n internal-note Code node and
// src/uc01/policyEngine.js must agree on what a reason MEANS and what FACTS
// it carries
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// F-7 (rca-1rx): the live n8n graph's `human_review` internal note used to be
// three fields and a raw slug. The fix (workflows/nodes/composeInternalNote.js)
// ports `describeDecidingGate()`'s `means` sentence and `describeDecisionFacts()`
// verbatim from src/uc01/policyEngine.js, because an n8n Code node has no
// module resolution and cannot import the original. Same risk as
// workflows/nodes/gates.js and workflows/nodes/assignRouting.js: two copies of
// the same prose, and the usual failure mode is one gets edited and the other
// quietly doesn't.
//
// This test executes the ACTUAL node body in a node:vm sandbox — not a
// reimplementation — and asserts its `means` sentence and fact bundle are
// byte-identical to what policyEngine.js's own describers produce, for every
// `human_review` reason (the ones `Flag for Specialist Review` reads) and for
// the `escalate` reasons this composer was wired to feed `Escalate Ticket`
// as of `85dfcb8`.
//
// E4-F14 (rca-0nm) added the ESCALATE_SCENARIOS block below: the composer's
// subjectLine is unconditional on `identity_not_verified`, so ticket #109 (an
// unauthenticated stranger quoting a real employee's employment id) reached
// `escalate`/`identity_not_verified` with an internal note that opened
// "Regarding Chris Lee (Data Scientist) — status: active…" — the exact fact
// `e188ce8` had just stopped the ZAF sidebar and the signed API body from
// disclosing on the same reason. The fix guards subjectLine in the composer
// itself; these tests pin both halves — withheld on identity_not_verified,
// still shown on every other escalate reason — so a future edit cannot regress
// either direction unnoticed.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { describeDecidingGate, describeDecisionFacts } from "../src/uc01/policyEngine.js";
import { formatFactsForNote } from "../src/shared/decisionFacts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOTE_PATH = join(__dirname, "..", "workflows", "nodes", "composeInternalNote.js");
const noteSource = readFileSync(NOTE_PATH, "utf8");

/** Run the n8n Code node body with n8n's `$json` global mocked. */
function runComposeInternalNote(ctx) {
  const sandbox = { $json: ctx };
  const wrapped = `(function () {\n${noteSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const EMPLOYMENT = {
  id: "emp_active_001",
  full_name: "Ada Lovelace",
  job_title: "Staff Engineer",
  status: "active",
  contract_type: "full_time",
  country_code: "PT",
};

function ctxFor({ decision = "human_review", reason, classification = {}, identity = null, flags = [], employment = EMPLOYMENT }) {
  return {
    decision,
    reason,
    flags,
    employment,
    classification,
    identity,
    routingNote: "Assigned to HR Ops (Zendesk group 6168404929823), tagged queue_hr_ops.",
  };
}

/** full_name and contract_type present; start_date absent — a genuinely incomplete record. */
const INCOMPLETE_EMPLOYMENT = { ...EMPLOYMENT, start_date: null };

// Every reason `evaluate()` can actually return as `human_review` — the only
// decision this node's output (`internalNote`) is ever read for
// (workflows/nodes/routeByDecisionSpec.js's RULES: only `human_review` reaches
// `Flag for Specialist Review`).
const HUMAN_REVIEW_SCENARIOS = [
  {
    name: "third_party_request",
    reason: "third_party_request",
    classification: { requesterType: "third_party", source: "llm" },
    identity: { reason: "third_party_with_consent", consentRecordId: "cr_1" },
  },
  {
    name: "artifact_present",
    reason: "artifact_present",
    classification: { hasAttachment: true, hasExternalUrl: false, intent: "standard_letter" },
    flags: ["has_attachment"],
  },
  {
    name: "non_standard_request",
    reason: "non_standard_request",
    classification: { intent: "reference_letter", source: "llm", confidence: 0.9 },
  },
  {
    name: "over_scope_undetermined",
    reason: "over_scope_undetermined",
    classification: { source: "rule_based_fallback" },
  },
  {
    name: "over_scope_request",
    reason: "over_scope_request",
    classification: { requestedFields: ["full_name", "compensation_gross_amount"], source: "llm" },
  },
  {
    name: "confidence_unknown",
    reason: "confidence_unknown",
    classification: { source: "llm", intent: "standard_letter" },
  },
  {
    name: "low_confidence",
    reason: "low_confidence",
    classification: { confidence: 0.4, source: "llm", intent: "standard_letter" },
  },
  {
    name: "incomplete_employment_record",
    reason: "incomplete_employment_record",
    classification: {},
    employment: INCOMPLETE_EMPLOYMENT,
  },
];

// Every reason `evaluate()` can return as `escalate` (`src/uc01/policyEngine.js`
// / `workflows/nodes/gates.js`) — the branch `85dfcb8` wired to this same
// composer, feeding `Escalate Ticket`.
const ESCALATE_SCENARIOS = [
  {
    name: "identity_not_verified",
    decision: "escalate",
    reason: "identity_not_verified",
    classification: { requesterType: "employee" },
    identity: { method: "none", reason: "session_employment_mismatch" },
  },
  {
    name: "employee_not_active",
    decision: "escalate",
    reason: "employee_not_active",
    classification: {},
    employment: { ...EMPLOYMENT, status: "terminated" },
  },
  {
    name: "engagement_offboarding",
    decision: "escalate",
    reason: "engagement_offboarding",
    classification: {},
  },
];

for (const scenario of [...HUMAN_REVIEW_SCENARIOS, ...ESCALATE_SCENARIOS]) {
  test(`internal note "means"/facts match policyEngine.js — ${scenario.name}`, () => {
    const ctx = ctxFor(scenario);
    const composed = runComposeInternalNote(ctx);

    const decidedBy = describeDecidingGate(scenario.reason);
    const facts = describeDecisionFacts({
      reason: scenario.reason,
      employment: scenario.employment ?? EMPLOYMENT,
      classification: scenario.classification,
      identity: scenario.identity ?? null,
    });

    assert.ok(decidedBy, `policyEngine.js has no GATE_SEQUENCE row for ${scenario.reason} — fixture is stale`);
    assert.ok(
      composed.internalNote.includes(decidedBy.means),
      `note is missing policyEngine.js's exact "means" sentence for ${scenario.reason}`
    );
    assert.ok(
      composed.internalNote.includes(`gate ${decidedBy.position} of ${decidedBy.total} (${decidedBy.gate})`),
      "note is missing the gate position/total/name"
    );

    const expectedFacts = formatFactsForNote(facts).trim();
    // formatFactsForNote() leads with a space (it is designed to be
    // concatenated after a sentence); trim both sides for the comparison.
    assert.ok(
      composed.internalNote.includes(expectedFacts),
      `note's fact bundle differs from policyEngine.js's describeDecisionFacts() for ${scenario.reason}`
    );
  });
}

// ---------------------------------------------------------------------------
// E4-F14 (rca-0nm) — subjectLine must be withheld on `identity_not_verified`
// and ONLY on that reason. `e188ce8`'s guard on the review API scoped
// itself to exactly this reason; this composer must match it byte-for-byte,
// because §14 forbids two surfaces disagreeing about the same case.
// ---------------------------------------------------------------------------

test("E4-F14: identity_not_verified withholds the subject — no name, job title, status, contract or country", () => {
  const composed = runComposeInternalNote(
    ctxFor({
      reason: "identity_not_verified",
      classification: { requesterType: "employee" },
      identity: { method: "none", reason: "session_employment_mismatch" },
    })
  );
  assert.doesNotMatch(composed.internalNote, /Ada Lovelace/);
  assert.doesNotMatch(composed.internalNote, /Staff Engineer/);
  assert.doesNotMatch(composed.internalNote, /status: active/);
  assert.doesNotMatch(composed.internalNote, /contract: full_time/);
  assert.doesNotMatch(composed.internalNote, /country: PT/);
  assert.match(composed.internalNote, /subject details withheld: identity could not be verified/);
});

test("E4-F14: identity_not_verified still carries the plain-words gate meaning, flags and identity facts — only the subject is withheld", () => {
  const composed = runComposeInternalNote(
    ctxFor({
      reason: "identity_not_verified",
      classification: { requesterType: "employee" },
      identity: { method: "none", reason: "session_employment_mismatch" },
      flags: ["identity_requester_employment_mismatch"],
    })
  );
  assert.match(composed.internalNote, /identity_requester_employment_mismatch/);
  assert.match(composed.internalNote, /We could not confirm who is asking/);
  assert.match(composed.internalNote, /Identity signal used: none/);
  assert.match(composed.internalNote, /What was missing: session_employment_mismatch/);
});

test("E4-F14 positive: every OTHER escalate reason still shows the full subject — the guard is scoped to identity_not_verified alone", () => {
  for (const reason of ["employee_not_active", "engagement_offboarding"]) {
    const composed = runComposeInternalNote(ctxFor({ reason, classification: {} }));
    assert.match(composed.internalNote, /Ada Lovelace/, `${reason} must still show the subject`);
    assert.match(composed.internalNote, /Staff Engineer/, `${reason} must still show the subject`);
    assert.match(composed.internalNote, /country: PT/, `${reason} must still show the subject`);
  }
});

test("the note carries who this is about: name, job title, status, contract, country", () => {
  const composed = runComposeInternalNote(ctxFor({ reason: "over_scope_request", classification: { requestedFields: ["full_name"] } }));
  assert.match(composed.internalNote, /Ada Lovelace/);
  assert.match(composed.internalNote, /Staff Engineer/);
  assert.match(composed.internalNote, /status: active/);
  assert.match(composed.internalNote, /contract: full_time/);
  assert.match(composed.internalNote, /country: PT/);
});

test("a missing subject field is stated as not recorded, never blank or fabricated", () => {
  const composed = runComposeInternalNote({
    decision: "human_review",
    reason: "over_scope_request",
    flags: [],
    employment: {},
    classification: { requestedFields: [] },
    identity: null,
    routingNote: "ROUTING SKIPPED — this run could not determine its own use case.",
  });
  assert.match(composed.internalNote, /an employee not named on this record/);
  assert.match(composed.internalNote, /status: not recorded/);
  assert.match(composed.internalNote, /contract: not recorded/);
  assert.match(composed.internalNote, /country: not recorded/);
});

test("the raw slug never renders alone — the means sentence always sits beside it", () => {
  const composed = runComposeInternalNote(ctxFor({ reason: "over_scope_request", classification: { requestedFields: ["full_name", "salary"] } }));
  // §14 UX_ACCEPTANCE: "No internal language. `over_scope_request` never
  // renders alone." The slug is still present (audit vocabulary, kept
  // deliberately), but only ever immediately followed by the plain-words
  // decision line — never printed on its own with nothing around it.
  assert.match(composed.internalNote, /\(over_scope_request\)\. Flags:/);
});

test("the note names the owning team and how the decision is actioned, with verbs", () => {
  const composed = runComposeInternalNote(ctxFor({ reason: "low_confidence", classification: { confidence: 0.5 } }));
  assert.match(composed.internalNote, /Routing — Assigned to HR Ops/);
  assert.match(composed.internalNote, /Approving issues the standard verification letter and solves the ticket/);
  assert.match(composed.internalNote, /Declining records a required reason/);
});

// ---------------------------------------------------------------------------
// E5-F19 (rca-3fm) — an ESCALATE note must never instruct an approve the ZAF
// sidebar does not render. `src/review/reviewPolicy.js`'s
// `evaluateCaseActionability()` refuses `escalate` with `no_review_path`
// ("Escalated cases are worked by a specialist, not closed from the
// sidebar") before any approve/decline control could exist — only
// `human_review` renders one. This composer's `actionLine` used to be an
// unconditional const, so an escalate note ended with "Approving issues the
// standard verification letter..." on a case with zero buttons. The negative
// assertion is the one that actually catches a regression — a positive-only
// suite cannot tell "fixed" from "field deleted" (the lesson round 4 already
// paid for on subjectLine).
// ---------------------------------------------------------------------------

for (const scenario of ESCALATE_SCENARIOS) {
  test(`E5-F19: escalate note (${scenario.name}) never instructs an approve — no sidebar control exists`, () => {
    const composed = runComposeInternalNote(ctxFor(scenario));
    assert.doesNotMatch(composed.internalNote, /Approving issues/);
    assert.doesNotMatch(composed.internalNote, /Open this ticket's ZAF sidebar to decide/);
    assert.match(
      composed.internalNote,
      /Escalated cases are worked by a specialist, not closed from the sidebar/,
      "escalate note must say plainly that this case is worked directly, not via the sidebar"
    );
  });
}

test("E5-F19 positive: a human_review (actionable) note still tells the specialist to open the sidebar and approve/decline — the guard is scoped to escalate alone", () => {
  for (const scenario of HUMAN_REVIEW_SCENARIOS) {
    const composed = runComposeInternalNote(ctxFor(scenario));
    assert.match(composed.internalNote, /Open this ticket's ZAF sidebar to decide/, `${scenario.name} must still point at the sidebar`);
    // WHICH LETTER, since 2026-08-28. Approving an over-scope request issues
    // Remote's CUSTOMIZED letter — the one that states the fields that were
    // asked for — and every other human_review reason still issues the
    // standard one. The note must name the right document: a specialist told
    // "the standard letter, never salary" above a button that discloses a
    // salary has been told their click is safer than it is.
    assert.match(
      composed.internalNote,
      scenario.reason === "over_scope_request"
        ? /Approving issues a CUSTOMIZED verification letter and solves the ticket/
        : /Approving issues the standard verification letter and solves the ticket/,
      `${scenario.name} must still instruct approve, naming the letter it would actually issue`
    );
    if (scenario.reason === "over_scope_request") {
      assert.doesNotMatch(
        composed.internalNote,
        /never salary/,
        "the note promises no salary can be disclosed, above an Approve that discloses one"
      );
    }
    assert.match(composed.internalNote, /Declining records a required reason/, `${scenario.name} must still instruct decline`);
  }
});

test("a reason with no GATE_SEQUENCE row degrades to no means sentence, never a guess", () => {
  const composed = runComposeInternalNote({
    decision: "human_review",
    reason: "some_future_reason_this_table_does_not_know",
    flags: [],
    employment: EMPLOYMENT,
    classification: {},
    identity: null,
    routingNote: "Assigned to HR Ops (Zendesk group 6168404929823), tagged queue_hr_ops.",
  });
  assert.match(composed.internalNote, /decision: human_review \(some_future_reason_this_table_does_not_know\)/);
  assert.ok(!composed.internalNote.includes("Decided at gate"), "no row means no gate sentence — never a fabricated one");
});
