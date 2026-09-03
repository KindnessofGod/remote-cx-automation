/**
 * THE FINDINGS ARE FOR THE SPECIALIST, NOT FOR THE SYSTEM'S AUTHOR (W-5b,
 * docs/UC04-DECISION-SURFACE.md).
 *
 * Every `finding` on this panel had grown into an essay explaining why the
 * system reports the way it does. The project owner quoted one back verbatim as
 * unreadable — a 293-character sentence about what "must never be inferred from
 * the destination, which is why it is reported as absent rather than assumed".
 * Nothing in it was false. It was written for a reader auditing the design, and
 * the reader in front of it is a mobility specialist with a decision to make.
 *
 * The shape a finding must have is three moves, in order: STATE THE FACT, say
 * WHAT IT BLOCKS, say WHAT WOULD CLEAR IT. That is at most three sentences, so
 * the sentence count is the rule and the character cap is the backstop.
 *
 * WHY A TEST AND NOT A STYLE NOTE. Prose has no compiler. Every one of these
 * strings was correct when written and grew a clause at a time, each clause
 * added by a real defect — so the register drifts in the direction of MORE
 * explanation, always for a good reason, and nothing pushes back. This is what
 * pushes back.
 *
 * `whatItWouldTake` IS DELIBERATELY NOT COVERED. The ZAF panel stopped
 * rendering it in 2026-08-19 precisely because it is engineering backlog rather
 * than something the approver reads (see renderDimension's header in
 * zaf-app/assets/main.js). It stays long, server-side, on the audit record.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { describeDecisionBasis, describeRequester } from "../src/uc04/decisionFacts.js";
import { classifyRisk } from "../src/uc04/riskMatrix.js";
import {
  DOCS_ON_FILE,
  DOCS_NONE_ON_FILE,
  DOCS_FIELD_ABSENT,
  DOCS_NOT_READ,
} from "../src/uc04/identityDocuments.js";

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

const MAX_CHARS = 300;
const MAX_SENTENCES = 3;

/**
 * Vocabulary that only ever appears when a finding has started explaining the
 * SYSTEM instead of the CASE. Each entry was lifted from a string this pass
 * removed, so none of them is hypothetical — and none of them can be written
 * about a trip, an employee or a document, which is what makes them safe to ban
 * outright rather than judge in context.
 */
const DESIGN_RATIONALE = [
  /\bthis system\b/i,
  /\bthis dimension\b/i,
  /\bthis panel\b/i,
  /\bwhich is why\b/i,
  /\bmust never be\b/i,
  /\brather than assumed\b/i,
  /\bnot a read that failed\b/i,
  /\bin another form\b/i,
  /\bthe check that produced this decision\b/i,
  /\bwas not decided from it\b/i,
  /\bis not the question here\b/i,
];

/** Sentence-count that does not trip over "Regulation (EC) No 883/2004". */
const sentences = (text) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z(“"']|$)/u)
    .map((s) => s.trim())
    .filter(Boolean).length;

function assertReadable(finding, where) {
  assert.ok(typeof finding === "string" && finding.length > 0, `${where}: no finding`);
  assert.ok(
    finding.length <= MAX_CHARS,
    `${where}: ${finding.length} chars, cap ${MAX_CHARS}\n  ${finding}`
  );
  assert.ok(
    sentences(finding) <= MAX_SENTENCES,
    `${where}: ${sentences(finding)} sentences, cap ${MAX_SENTENCES}\n  ${finding}`
  );
  for (const banned of DESIGN_RATIONALE) {
    assert.ok(
      !banned.test(finding),
      `${where}: explains the system rather than the case (${banned})\n  ${finding}`
    );
  }
}

// ---------------------------------------------------------------------------
// Driving the real describer, never a fixture of its output
// ---------------------------------------------------------------------------

function rowFor({ homeCountry, nationality, destinationCountry, ...extra }) {
  const factors = {
    homeCountry,
    nationality,
    destination: { country: destinationCountry },
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    priorTravel: [],
    ...extra,
  };
  const risk = classifyRisk({
    sourceCountry: homeCountry,
    homeCountry,
    nationality,
    destinationCountry,
    startDate: factors.startDate,
    endDate: factors.endDate,
    visaType: factors.visaType,
    jobDuties: factors.jobDuties,
    hasContractSigningAuthority: factors.hasContractSigningAuthority,
    priorTravel: factors.priorTravel,
  });
  return { factors, risk, flags: (risk.flags ?? []).map((f) => f.code ?? f), tripDays: 14 };
}

/**
 * Routes chosen to reach every branch that returns a finding: both treaty
 * registers answering, EU coordination alone, neither, a PE trigger, a
 * blocking document type, an empty travel history and a populated one.
 */
const ROUTES = [
  { name: "US → NL, both registers answer", homeCountry: "US", nationality: "US", destinationCountry: "NL" },
  { name: "NL → PT, EU coordinated", homeCountry: "NL", nationality: "NL", destinationCountry: "PT" },
  { name: "US → IN, no register answers", homeCountry: "US", nationality: "US", destinationCountry: "IN" },
  {
    name: "PE trigger — executive with signing authority",
    homeCountry: "NL",
    nationality: "NL",
    destinationCountry: "PT",
    jobDuties: "executive",
    hasContractSigningAuthority: true,
  },
  {
    name: "blocking document type — visitor visa into the US",
    homeCountry: "NL",
    nationality: "NL",
    destinationCountry: "US",
    visaType: "visitor",
  },
  {
    name: "populated travel history",
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "NL",
    priorTravel: [{ country: "NL", startDate: "2026-02-01", endDate: "2026-03-01" }],
  },
];

for (const route of ROUTES) {
  test(`every UC-04 finding stays readable — ${route.name}`, () => {
    const basis = describeDecisionBasis({ authorizationRow: rowFor(route) });
    assert.ok(basis.dimensions.length > 0, "no dimensions");
    for (const dimension of basis.dimensions) {
      assertReadable(dimension.finding, `${route.name} / ${dimension.key} (${dimension.state})`);
    }
  });
}

test("the document dimension stays readable whatever the record holds", () => {
  // Every state summariseIdentityDocuments can return, including the ON_FILE
  // branch that no live Sandbox record reaches (zero `id` files across 112
  // employments) and that therefore only a fixture ever exercises.
  const employments = [
    { label: "documents on file", employment: { files: [{ type: "id", created_at: "2026-01-01T00:00:00Z" }] }, state: DOCS_ON_FILE },
    { label: "other files only", employment: { files: [{ type: "contract" }, { type: "payslip" }] }, state: DOCS_NONE_ON_FILE },
    { label: "no files at all", employment: { files: [] }, state: DOCS_NONE_ON_FILE },
    { label: "no files field", employment: { id: "emp-1" }, state: DOCS_FIELD_ABSENT },
    { label: "no record read", employment: null, state: DOCS_NOT_READ },
  ];
  for (const { label, employment, state } of employments) {
    const basis = describeDecisionBasis({
      authorizationRow: rowFor(ROUTES[0]),
      employment,
    });
    assert.equal(basis.identityDocuments.state, state, `${label}: unexpected document state`);
    const document = basis.dimensions.find((d) => d.key === "immigration_document");
    assertReadable(document.finding, `document dimension / ${label}`);
  }
});

test("the requester block's findings stay readable too", () => {
  for (const active of [true, false]) {
    const row = rowFor(ROUTES[0]);
    if (!active) row.flags = [...row.flags, "employee_not_active"];
    const requester = describeRequester({ authorizationRow: row });
    assertReadable(requester.subject.statedHomeCountry.finding, "statedHomeCountry");
    assertReadable(requester.subject.statedNationality.finding, "statedNationality");
    assertReadable(
      requester.subject.employmentRecord.finding,
      `employmentRecord (active=${active})`
    );
    assertReadable(requester.statedReason.finding, "statedReason");
  }
});

// ---------------------------------------------------------------------------
// The negative control — the guard has to fail on what it was written about
// ---------------------------------------------------------------------------

test("the rule rejects the exact string the owner objected to", () => {
  // Verbatim from src/uc04/decisionFacts.js before this pass, minus the
  // interpolation. If any of these three assertions stops holding, the rule has
  // been loosened past the defect it exists to catch.
  const before =
    "Schengen short stay is what the requester SELECTED on the form — a claim, not a document. " +
    "Remote's employment record was read and holds no identity document, though it does hold 1 file of other " +
    "kinds — so this is a document genuinely not filed, not a read that failed. Nothing here confirms this " +
    "person may work at the DESTINATION, and whether such a document exists must never be inferred from the " +
    "destination, which is why it is reported as absent rather than assumed.";

  assert.ok(before.length > MAX_CHARS, "control string is no longer over the cap");
  // AND IT IS EXACTLY THREE SENTENCES, which is why the sentence count cannot
  // be the only rule. The defect was not that it said too many things; it was
  // that two of the three things it said were about the system. The character
  // cap catches the length and the vocabulary catches the subject — neither
  // alone would have failed this string.
  assert.equal(sentences(before), MAX_SENTENCES, "control string's sentence count moved");
  assert.ok(
    DESIGN_RATIONALE.some((r) => r.test(before)),
    "control string no longer trips any design-rationale pattern"
  );
  assert.throws(() => assertReadable(before, "control"), /cap|explains the system/);
});

test("the rule accepts a finding of the shape it asks for", () => {
  // Fact, what it blocks, what would clear it. Nothing here is about the system.
  const good =
    "No prior trips to the Netherlands were supplied, so the count is 0 across 0 trips — a floor, not a " +
    "measurement. Nothing was read from Remote to confirm the employee has not been there. Treat an empty " +
    "history as a reason to escalate.";
  assertReadable(good, "positive control");
});
