// ---------------------------------------------------------------------------
// zafSpecialistVocabulary.test.js — the specialist screens, read for whose
// vocabulary they are written in
// ---------------------------------------------------------------------------
// THE STANDING REQUIREMENT, in the project owner's own words, said three times
// about three different screens:
//
//   "Correct me if I am wrong, but the sidebar is meant to provide the
//    specialist with relevant info to make a decision… All your Zendesk bars
//    are made for the person building, not the person using it."
//
// The people reading these surfaces are mobility, tax, HR and payroll experts
// deciding a real case about a real person. They are domain experts and they
// are not engineers, and nothing about their job requires them to know that
// this system stores an approval role as `payment_releaser`, a relocation
// verdict as `PROCEED`, or a missing salary as `annualGrossSalaryRemoteInteger
// (not_an_integer)`.
//
// WHY A SCANNER AND NOT A LIST OF SENTENCES. Equality assertions on prose pin
// the four strings somebody thought of and say nothing about the fifth. This
// walks everything these five modules actually emit for a reader and fails on a
// CLASS of value: an identifier in backticks, a path into this repository, a
// source filename, a `functionName()`, a snake_case slug, a SCREAMING_SNAKE
// constant, a camelCase field name. A row added next month is covered by the
// same net, which is the only version of this test that keeps working.
//
// WHAT IS DELIBERATELY NOT SCANNED, each with its reason — an exclusion nobody
// can see is an exclusion that quietly grows:
//
//   · MACHINE FIELDS. `code`, `key`, `state`, `status`, `roleId`, `axis` and
//     their kind are what the sidebar branches on and what an API reader keys
//     by. They are SUPPOSED to be stable identifiers. The rule this file
//     enforces is the one src/shared/countryNames.js states for country codes:
//     codes decide, names are read. Only the strings a person reads are scanned.
//   · `whatItWouldTake`. main.js stopped rendering it on 2026-08-19 with its
//     own note — "a column to add to a table, which is engineering backlog
//     above a decision". It is addressed to engineers by design, and it is the
//     one place in these files where a table name is the honest answer.
//   · THE CITATION MAP (`sources`, `uncited`, and the `sources` list inside a
//     basis block). Those come from each use case's decisionSources.js, which
//     this pass does not own, and they have a different contract: `finding`
//     there is the finding's KEY rather than prose, and the instruments they
//     cite are quoted with their publisher and locator on purpose. UC-07's
//     `uncited[].why` does still carry a path into docs/knowledge/ — a real
//     offence of the same class, in a file outside this scan's reach, and it is
//     reported rather than silently covered by an exclusion that hides it.
//
// NON-VACUITY, MEASURED RATHER THAN ASSUMED. Run against the pre-change modules
// extracted from HEAD (with their relative imports rewritten so they load in
// place), this exact scan reports 34 offences across the four server-side
// modules: `payment_releaser` in UC-09's signature sentence, UC-07's
// "annualGrossSalaryRemoteInteger (not_an_integer)" and
// "right_to_work_confirmed" and "mobilityFee" and "not_faithful",
// docs/knowledge/DOWNLOAD-MANIFEST.md inside UC-08's coverage sentence, and
// `esta_usa`, "UC-04.md §7" and "`uc04_authorizations`" in UC-04's basis.
//
// Two things the net cannot see, which is why the explicit assertions below
// exist beside it: a BARE COUNTRY CODE ("DE → NL") is indistinguishable from an
// abbreviation to any pattern that does not know the ISO list, and a STUTTER —
// the same fact stated twice in one paragraph — is a property of two sentences
// together, not of either one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describeAdjustment, describeApprovalProgress } from "../src/uc09/approvalView.js";
import { describeDossier as describeRelocationDossier } from "../src/uc07/dossierView.js";
import { describeJurisdictionCoverage } from "../src/uc08/jurisdictionKnowledge.js";
import { describeDecisionBasis, VISA_TYPE_WORDS, JOB_DUTY_WORDS } from "../src/uc04/decisionFacts.js";
import { VALID_VISA_TYPES, VALID_JOB_DUTIES } from "../src/uc04/policyEngine.js";

// ---------------------------------------------------------------------------
// The net
// ---------------------------------------------------------------------------

/** Strings at these keys are read by a person. Everything else is machinery. */
const READER_KEYS = new Set([
  "statement",
  "finding",
  "detail",
  "question",
  "sentence",
  "summary",
  "label",
  "value",
  "note",
  "why",
  "decides",
  "hint",
  "message",
]);

const OFFENCES = [
  ["an identifier in backticks", /`[^`\s]{2,}`/],
  ["a path into this repository", /\b(?:src|docs|test|tests|workflows|scripts|deploy|zaf-app)\/[\w./-]+/],
  ["a source filename", /\b[A-Za-z0-9_-]+\.(?:js|mjs|cjs|md|html|json|sql)\b/],
  ["a function call", /\b[A-Za-z_$][\w$]*\(\)/],
  ["a snake_case slug", /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/],
  ["a SCREAMING_SNAKE constant", /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/],
  ["a camelCase field name", /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/],
];

/**
 * Every reader-facing string in a value, with the path it was found at, so a
 * failure names the field rather than only the sentence.
 */
function readerStrings(value, path = "", found = []) {
  if (typeof value === "string") {
    const key = path.split(".").pop().replace(/\[\d+\]$/, "");
    if (READER_KEYS.has(key)) found.push({ path, text: value });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => readerStrings(v, `${path}[${i}]`, found));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      // See the header: engineering backlog, and not rendered to anybody.
      if (k === "whatItWouldTake") continue;
      // See the header: the citation map belongs to decisionSources.js.
      if (k === "sources" || k === "uncited") continue;
      readerStrings(v, path ? `${path}.${k}` : k, found);
    }
  }
  return found;
}

function offencesIn(value, label) {
  const problems = [];
  for (const { path, text } of readerStrings(value)) {
    for (const [name, pattern] of OFFENCES) {
      const hit = text.match(pattern);
      if (hit) problems.push(`${label} · ${path}: ${name} — "${hit[0]}" in: ${text.slice(0, 160)}`);
    }
  }
  return problems;
}

const assertClean = (value, label) => {
  const problems = offencesIn(value, label);
  assert.equal(problems.length, 0, `the reader is being shown this system's own vocabulary:\n  ${problems.join("\n  ")}`);
};

// ---------------------------------------------------------------------------
// UC-09 — the payment screen
// ---------------------------------------------------------------------------

const ADJUSTMENT_ROW = {
  adjustment: { amount: 1500000, currency: "USD", amountTaxType: "gross", type: "retroactive_pay" },
  flags: ["high_amount_risk", "high_tax_compliance_risk"],
  approvalSlotsRequired: 3,
  riskBasis: [{ dimension: "jurisdiction_tax_complexity", observedCountryCode: "DE" }],
  requesterApproval: { approver: "Bob Smith", at: "2026-08-01T09:00:00.000Z", note: null },
};

test("UC-09: nobody signing a payment is shown a role in the store's vocabulary", () => {
  const progress = describeApprovalProgress(ADJUSTMENT_ROW);
  assertClean(progress, "UC-09 approval progress");

  // The named defect, pinned in both directions: the roles that HAVE signed and
  // the role still outstanding both reach the sentence as a person says them.
  assert.match(progress.statement, /Requester: Bob Smith/);
  assert.match(progress.statement, /Still outstanding: Approver, Payment releaser\./);
  // …and the machine field is untouched, because the API and the sidebar branch
  // on it. Names are read; codes decide.
  assert.deepEqual(progress.outstandingRoles, ["approver", "payment_releaser"]);
});

test("UC-09: the whole approval view is free of the codebase's vocabulary, in every branch", () => {
  for (const row of [
    ADJUSTMENT_ROW,
    { ...ADJUSTMENT_ROW, approvalSlotsRequired: 2, flags: [], riskBasis: [] },
    { ...ADJUSTMENT_ROW, adjustment: { amount: 1000, currency: "EUR" }, flags: [] },
    { adjustment: {}, flags: [], approvalSlotsRequired: 0 },
  ]) {
    assertClean(describeAdjustment(row), "UC-09 adjustment view");
  }
});

test("UC-09: the high-tax jurisdiction dimension names countries, not ISO codes", () => {
  const { approvalRequirement } = describeAdjustment(ADJUSTMENT_ROW);
  const jurisdiction = approvalRequirement.dimensions.find((d) => d.code === "high_tax_compliance_risk");
  assert.match(jurisdiction.detail, /Germany, France, Italy/);
  assert.match(jurisdiction.detail, /The employment's country is Germany\./);
  // The codes stay where they are compared and quoted.
  assert.deepEqual(jurisdiction.countriesInScope, ["DE", "FR", "IT"]);
});

// ---------------------------------------------------------------------------
// UC-07 — the relocation dossier
// ---------------------------------------------------------------------------

const RELOCATION_ROW = {
  sourceCountry: "DE",
  destinationCountry: "NL",
  dossier: {
    verdict: "REVIEW",
    feasible: false,
    sourceCountry: "DE",
    destinationCountry: "NL",
    flags: [
      { code: "UC07_PE_RISK_REVIEW_REQUIRED", severity: "MEDIUM", message: "Potential permanent-establishment exposure." },
    ],
    requiredActions: ["PE_REVIEW"],
    transitionSafety: {
      sourceOffboardingAuthorized: false,
      missing: ["right_to_work_confirmed", "source_exit_plan_validated"],
    },
    pto: { cashout: { computable: false, unusable: [{ field: "annualGrossSalaryRemoteInteger", reason: "not_an_integer" }] } },
    costEstimate: {
      status: "CALCULATED",
      knownTermTotalDisplay: "9,300.00 EUR",
      pendingQuotes: ["mobilityFee"],
      components: [{ key: "mobilityFee", label: "Mobility / visa support", status: "QUOTE_REQUIRED" }],
    },
    dateChecks: { mot: { code: "NOT_EVALUATED" }, coverage: { status: "NOT_EVALUATED" }, alignment: { aligned: null } },
    seniority: { status: "REQUIRES_LEGAL_REVIEW" },
    citations: [],
    faithfulness: { verdict: "not_faithful", reason: null },
  },
};

test("UC-07: the dossier a Mobility Legal specialist reads carries no identifiers", () => {
  assertClean(describeRelocationDossier(RELOCATION_ROW), "UC-07 dossier view");
  assertClean(describeRelocationDossier({ dossier: { flags: [], verdict: "PROCEED" } }), "UC-07 empty dossier view");
});

test("UC-07: the route is two countries by name, and the codes stay on the row", () => {
  const view = describeRelocationDossier(RELOCATION_ROW);
  assert.equal(view.verdictSummary.route, "Germany → Netherlands");
  assert.ok(!/\bDE → NL\b/.test(view.verdictSummary.statement));
});

test("UC-07: an unanswerable question names the missing thing in words", () => {
  const view = describeRelocationDossier(RELOCATION_ROW);
  const byCode = Object.fromEntries(view.openQuestions.map((q) => [q.code, q.question]));
  assert.match(byCode.pto_cashout_not_computable, /annual gross salary the daily rate is derived from \(not a usable amount\)/);
  assert.match(byCode.source_offboarding_not_authorized, /the right to work in the destination is confirmed/);
  assert.match(byCode.cost_quotes_pending, /Mobility \/ visa support/);
  assert.match(byCode.narrative_flagged, /did NOT match the structured facts/);
});

// ---------------------------------------------------------------------------
// UC-08 — the jurisdiction statement that travels with a day count
// ---------------------------------------------------------------------------

test("UC-08: the jurisdiction statement names countries and points at no file", () => {
  const scenarios = [
    { jurisdictions: ["CA", "NL"], presenceCountry: "NL", presenceDays: { status: "COUNTED", days: 273 } },
    { jurisdictions: ["DE"], presenceCountry: "BR", presenceDays: { status: "COUNTED", days: 200 } },
    { jurisdictions: [], presenceCountry: null, presenceDays: { status: "COUNTED", days: 12 } },
    { jurisdictions: [], presenceCountry: "PT", presenceDays: null },
  ];
  for (const args of scenarios) {
    const coverage = describeJurisdictionCoverage(args);
    assertClean({ statement: coverage.statement, inPlay: coverage.inPlay.map((j) => ({ statement: j.statement })) }, "UC-08 coverage");
  }
});

test("UC-08: the coverage sentence does not stutter against the narrative that precedes it", () => {
  // dossierBuilder.js's template already opens "This request names Canada,
  // Netherlands." A second sentence restating the same list would be one fact
  // twice; what only this sentence can say is which countries are in play and
  // HOW each of them got there — the count's subject arrives as structured
  // input and may never have been named in the text at all.
  const coverage = describeJurisdictionCoverage({
    jurisdictions: ["CA", "NL"],
    presenceCountry: "NL",
    presenceDays: { status: "COUNTED", days: 273 },
  });
  assert.match(
    coverage.statement,
    /Jurisdictions in play: Canada \(named in the request\); the Netherlands \(named in the request, and the country the presence-day count was taken in\)\./
  );
  assert.ok(!/Jurisdictions named in the request/.test(coverage.statement), "the list must not be announced twice");
  assert.ok(!/\bCA\b|\bNL\b/.test(coverage.statement), "the jurisdictions must be named, never coded");
});

// ---------------------------------------------------------------------------
// UC-04 — the workation basis a mobility specialist weighs
// ---------------------------------------------------------------------------

const uc04Row = (over = {}) => ({
  // A REAL-SHAPED ID. Remote employment ids are UUIDs; the mock server's
  // `emp_active_001` is snake_case and would trip this scan as a slug while
  // being nothing of the kind. (What it did surface is worth recording: this
  // sentence interpolates the raw employment id — "about employment
  // 3537d9ee-…" — which is the UUID-in-prose problem one file over, in
  // src/shared/requesterSubject.js.)
  employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
  requester: "admin@example.com",
  decision: "escalate",
  flags: ["us_requires_work_permit"],
  factors: {
    homeCountry: "DE",
    destination: { country: "US" },
    nationality: "DE",
    visaType: "esta_usa",
    jobDuties: "sales",
    hasContractSigningAuthority: true,
    startDate: "2026-09-01",
    endDate: "2026-09-20",
  },
  risk: { riskLevel: "blocked", normalized: { destinationCountry: "US", nationality: "DE" } },
  ...over,
});

test("UC-04: the visa type and the duties reach the specialist as the requester chose them", () => {
  const basis = describeDecisionBasis({ authorizationRow: uc04Row() });
  const document = basis.dimensions.find((d) => d.key === "immigration_document");
  assert.match(document.finding, /US ESTA \/ visa waiver/);
  assert.ok(!/esta_usa/.test(document.finding), "the stored value must not be the one printed");
  assert.equal(
    document.evidence.find((e) => /Travel document type/.test(e.label)).value,
    "US ESTA / visa waiver"
  );

  const role = basis.dimensions.find((d) => d.key === "role_pe_sensitivity");
  assert.equal(role.evidence.find((e) => e.label === "Job duties, as stated on the request").value, "Sales");
});

test("UC-04: the whole decision basis is free of slugs, paths and field names", () => {
  for (const row of [
    uc04Row(),
    uc04Row({ flags: [], decision: "approve", risk: { riskLevel: "low", normalized: { destinationCountry: "ES", nationality: "DE" } } }),
    uc04Row({ factors: { destination: {} }, risk: null, flags: [] }),
  ]) {
    assertClean(describeDecisionBasis({ authorizationRow: row }), "UC-04 decision basis");
  }
});

// ---------------------------------------------------------------------------
// The sidebar panels themselves
// ---------------------------------------------------------------------------

function panelsModule() {
  const context = { window: {} };
  vm.createContext(context);
  for (const asset of ["countryNames.js", "country.js", "panels.js"]) {
    const source = readFileSync(new URL(`../zaf-app/assets/${asset}`, import.meta.url), "utf8");
    new vm.Script(source, { filename: asset }).runInContext(context);
  }
  return context.window;
}

const PANEL_VIEWS = {
  "UC-09": {
    employee: { displayName: "Carlos Silva" },
    case: {
      useCase: "UC-09",
      employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      requester: "admin@example.com",
      adjustment: { type: "retroactive_pay", amount: 1500000, currency: "USD" },
      approvalSlotsRequired: 3,
      createdAt: "2026-08-01T09:00:00.000Z",
    },
  },
  "UC-07": {
    case: {
      useCase: "UC-07",
      employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      relocationType: "permanent_relocation",
      sourceCountry: "FR",
      destinationCountry: "DE",
      dossier: {
        verdict: "REVIEW",
        feasible: false,
        uncertainty: 0.5,
        parseSource: "rule_based_fallback",
        flags: [{ code: "UC07_PE_RISK_REVIEW_REQUIRED", severity: "MEDIUM", message: "Potential permanent-establishment exposure." }],
        requiredActions: ["PE_REVIEW", "TAX_REVIEW"],
        transitionSafety: { sourceOffboardingAuthorized: false, missing: ["source_exit_plan_validated"] },
        dateChecks: { coverage: { status: "CLEAN" }, alignment: { aligned: true }, mot: { code: "VALID", requiredLeadTime: 20, requestedLeadTime: 43 } },
        pto: { decision: "LIQUIDATE", destinationOpeningBalance: 0, liquidatedDays: 15 },
        seniority: { status: "REQUIRES_LEGAL_REVIEW" },
        costEstimate: {
          status: "CALCULATED",
          currency: "EUR",
          months: 12,
          annualGrossSalaryRemoteInteger: 7200000,
          components: [{ key: "mobilityFee", label: "Mobility / visa support", status: "QUOTE_REQUIRED", remoteInteger: 0, currency: "EUR" }],
          pendingQuotes: ["mobilityFee"],
        },
        citations: [],
        faithfulness: { verdict: "not_evaluated", reason: null },
      },
      createdAt: "2026-07-30T10:00:00.000Z",
    },
  },
  "UC-08": {
    case: {
      useCase: "UC-08",
      employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      inquiryType: "treaty_interpretation",
      jurisdictions: ["CA", "NL"],
      dossier: { citations: [], narrative: "Research context." },
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    presenceDays: { days: 273, periodsCounted: 1 },
  },
};

test("the sidebar panels print no stored value a specialist never chose", () => {
  const win = panelsModule();
  for (const [useCase, view] of Object.entries(PANEL_VIEWS)) {
    const panel = win.CXPanelFor(useCase);
    assertClean(panel.rows(view), `${useCase} panel rows`);
    assertClean({ hint: panel.approveHint(view) }, `${useCase} approve hint`);
    if (panel.approvalRoles) assertClean(panel.approvalRoles(view), `${useCase} capacity card`);
  }
});

test("UC-09's card shows the person and the kind of payment, not a UUID and a slug", () => {
  const win = panelsModule();
  const rows = win.CXPanelFor("UC-09").rows(PANEL_VIEWS["UC-09"]);
  const valueOf = (label) => rows.find((r) => r.label === label).value;

  // The name is the SERVER's — src/uc09/server.js re-reads the employment when
  // the panel opens. Nothing here looks anybody up.
  assert.equal(valueOf("Employee"), "Carlos Silva");
  assert.equal(valueOf("Type"), "retroactive pay");
  // The id keeps its own row: main.js's header deliberately omits it and says
  // it can afford to because the case record carries it verbatim. These rows
  // are that record.
  assert.equal(valueOf("Employment ID"), "3537d9ee-2017-4a53-952e-9d3b042aeab5");

  // AND THE FALLBACK IS THE ID, NEVER A BLANK. A read that did not answer must
  // not leave the row empty — an empty row reads as "there is nobody".
  const withoutName = win.CXPanelFor("UC-09").rows({ ...PANEL_VIEWS["UC-09"], employee: null });
  assert.equal(withoutName.find((r) => r.label === "Employee").value, "3537d9ee-2017-4a53-952e-9d3b042aeab5");
});

test("UC-04: every value the gate accepts has a label, so none can arrive as a slug later", () => {
  // The fallback opens underscores out, so a new value never renders as
  // `digital_nomad_visa` — but "opened out" and "what the requester was
  // offered" are not the same sentence, and on a mobility case a travel
  // document described slightly wrong is worse than one described as a slug.
  // This is what makes adding a visa type to the policy a two-file change on
  // purpose.
  assert.deepEqual(Object.keys(VISA_TYPE_WORDS).sort(), [...VALID_VISA_TYPES].sort());
  assert.deepEqual(Object.keys(JOB_DUTY_WORDS).sort(), [...VALID_JOB_DUTIES].sort());
});
