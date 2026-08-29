// ---------------------------------------------------------------------------
// reviewDecisionFacts.test.js  —  UC-01's review view carries requestedFields
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// E3-F10 (evaluation #3, NOT rca-leg's F-10 — that one is "job_title is
// over-scope but the letter prints it", a different defect). This one is:
// `classification.requestedFields` was captured by the classifier and printed
// in the ticket's internal note, but no file under src/review/ or zaf-app/
// carried it, so the sidebar's over-scope panel never named the fields the
// requester actually asked for — only the generic "the letter never states
// salary" sentence.
//
// `describeDecisionFacts()` (src/uc01/policyEngine.js) already builds the
// right bundle for `over_scope_request` — "Asked for beyond the standard letter",
// "Everything the requester asked for", and an explicit `unknownFact()`
// saying the VALUES are deliberately not carried — service.js just never
// called it. It now does, for the reasons whose whole bundle is built from
// `classification` alone (see CLASSIFICATION_ONLY_FACT_REASONS in
// service.js); reasons that need `employment`/`identity` still get `null`,
// same as before this fix, because a `cases` row carries neither.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { getReviewView } from "../src/review/service.js";
import { describeDecisionFacts } from "../src/uc01/policyEngine.js";

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

const BASE_CASE = {
  id: "case_98",
  useCase: "UC-01",
  externalRef: "98",
  employmentId: "emp_active_001",
  decision: "human_review",
  reason: "over_scope_request",
  flags: ["over_scope_request"],
  status: "pending_review",
  classification: {
    intent: "standard_letter",
    confidence: 0.95,
    source: "llm",
    requestedFields: ["salary", "manager_name"],
  },
};

test("over_scope_request names the fields asked for, and never the values", async () => {
  const view = await getReviewView({ ticketId: "98" }, { store: storeFor(BASE_CASE) });

  assert.equal(view.found, true);
  assert.ok(view.decisionFacts, "the view sends no decisionFacts bundle at all");
  assert.equal(view.decisionFacts.reason, "over_scope_request");

  const byLabel = Object.fromEntries(view.decisionFacts.facts.map((f) => [f.label, f]));
  assert.ok(byLabel["Asked for beyond the standard letter"], "must name the over-scope fields");
  assert.match(byLabel["Asked for beyond the standard letter"].value, /salary/);
  assert.match(byLabel["Asked for beyond the standard letter"].value, /manager_name/);
  assert.match(byLabel["Everything the requester asked for"].value, /salary/);
  assert.match(byLabel["Everything the requester asked for"].value, /manager_name/);

  // NOT SHOWN BY THIS FUNCTION, and the reason changed on 2026-08-28 without
  // the behaviour here changing at all — which is worth pinning precisely.
  //
  // `getReviewView()` takes a store and nothing else: no Remote client, so no
  // employment record, so no values. That was always true. What changed is why
  // it MATTERS: the same bundle is written into the Zendesk internal note, a
  // durable comment every agent on the account can read, so
  // `describeDecisionFacts()` defaults `includeDisclosureValues` to false and
  // only the sidebar's own route (src/review/server.js) opts in after a live
  // read. This test guards the DEFAULT half of that.
  const valuesFact = byLabel["The values of those fields"];
  assert.ok(valuesFact, "must say something about the values rather than omitting the row");
  assert.equal(valuesFact.known, false);

  // rca-iih7 / D-16: a specialist reading this sidebar has no Remote access
  // (§14 — "a specialist must not need to open Remote to decide"), so the note
  // must never send them there. It used to, verbatim: "read the record in
  // Remote if a disclosure is authorised."
  assert.doesNotMatch(
    valuesFact.note,
    /open Remote|read the record in Remote/i,
    "must not instruct a specialist to consult Remote — this sidebar is their only surface"
  );

  // AND IT MUST NOT PROMISE THE OLD BEHAVIOUR. The retired sentence ended
  // "Approving here still only issues the standard letter, with no salary
  // figure", which is now false — an approval issues the customized letter.
  // A false reassurance in a durable ticket comment is worse than no sentence.
  assert.doesNotMatch(
    valuesFact.note,
    /only issues the standard letter/i,
    "the note still promises that approving cannot disclose anything, which stopped being true"
  );

  const serialized = JSON.stringify(view.decisionFacts);
  assert.doesNotMatch(serialized, /25000|10399748/, "no compensation figure may ever appear in the bundle");
});

test("the values appear ONLY when a caller explicitly asks, and only with a record to read", async () => {
  // THE OPT-IN, from both sides. This is the whole containment argument for
  // the 2026-08-28 reversal: the reviewer's screen may show a salary, and the
  // internal note, the audit trail and the n8n port may not. One flag
  // separates them, so one test asserts both directions of it.
  const employment = {
    full_name: "Amara Osei",
    status: "active",
    contract_type: "eor",
    start_date: "2023-01-09",
    base_salary: 5000000,
    currency: "USD",
    job_title: "Staff Engineer",
    weekly_hours: 40,
  };
  const classification = BASE_CASE.classification;

  const withheld = describeDecisionFacts({ reason: "over_scope_request", classification, employment });
  assert.doesNotMatch(
    JSON.stringify(withheld),
    /50,000\.00/,
    "a record was present and the figure leaked without anyone asking for it — the default must withhold"
  );

  const shown = describeDecisionFacts({
    reason: "over_scope_request",
    classification,
    employment,
    includeDisclosureValues: true,
  });
  const salaryRow = shown.facts.find((f) => /Annual gross salary/.test(f.label));
  assert.ok(salaryRow, "the reviewer's own screen still cannot see what it is being asked to authorise");
  assert.match(salaryRow.value, /50,000\.00 USD/);
  assert.match(salaryRow.value, /per year/);

  // A FIELD THIS SYSTEM WILL NEVER RELEASE says so IN THOSE WORDS, and must
  // never sit under the same "released if approved" heading as the salary —
  // that heading implies a choice, and on manager_name there is none.
  const managerRow = shown.facts.find((f) => /manager_name/i.test(f.label));
  assert.ok(managerRow, "an unauthorisable field vanished from the screen entirely");
  assert.match(managerRow.label, /never released/);
  assert.equal(managerRow.known, false);
  assert.ok(
    !shown.facts.some((f) => /manager_name/i.test(f.label) && /released if approved/.test(f.label)),
    "an unauthorisable field is offered under a heading that implies approving would release it"
  );
});

test("a field the record cannot support is shown as unavailable, not omitted", async () => {
  // The specialist must not approve expecting a salary row and discover
  // afterwards that the letter went out without one. An empty record yields an
  // explicit "cannot be stated", never a blank and never a missing row.
  const shown = describeDecisionFacts({
    reason: "over_scope_request",
    classification: BASE_CASE.classification,
    employment: { full_name: "Amara Osei", status: "active" },
    includeDisclosureValues: true,
  });
  const salaryRow = shown.facts.find((f) => /Annual gross salary/.test(f.label));
  assert.ok(salaryRow, "the row vanished, so the screen implies nothing was asked for");
  assert.equal(salaryRow.known, false);
  assert.match(salaryRow.note, /does not carry this/i);
});

test("over_scope_undetermined and other classification-only reasons also carry a bundle", async () => {
  const view = await getReviewView(
    { ticketId: "98" },
    {
      store: storeFor({
        ...BASE_CASE,
        reason: "over_scope_undetermined",
        classification: { intent: "standard_letter", source: "llm" },
      }),
    }
  );
  assert.ok(view.decisionFacts);
  assert.equal(view.decisionFacts.reason, "over_scope_undetermined");
});

test("a reason needing employment/identity gets no fabricated bundle", async () => {
  // `incomplete_employment_record` needs `employment`, which a `cases` row
  // never carries — sending `null` there would report every required letter
  // field as "missing" from a record that was simply never read.
  const view = await getReviewView(
    { ticketId: "98" },
    { store: storeFor({ ...BASE_CASE, reason: "incomplete_employment_record" }) }
  );
  assert.equal(view.decisionFacts, null);
});

test("all_gates_passed publishes no bundle — nothing was refused", async () => {
  const view = await getReviewView(
    { ticketId: "98" },
    { store: storeFor({ ...BASE_CASE, reason: "all_gates_passed" }) }
  );
  assert.equal(view.decisionFacts, null);
});

test("a row from another use case gets no bundle — reason slugs are not globally unique", async () => {
  const view = await getReviewView(
    { ticketId: "98" },
    { store: storeFor({ ...BASE_CASE, useCase: "UC-03" }) }
  );
  assert.equal(view.decisionFacts, null);
});
