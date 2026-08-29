// ---------------------------------------------------------------------------
// n8nUc07Parity.test.js — the n8n "Relocation Gates" Code node and
// relocationParser/transitionGate/costCalculator/mobilityRetriever/dossierBuilder
// must agree — on the WHOLE dossier, not just the verdict
// ---------------------------------------------------------------------------
// Same reasoning as n8nParity.test.js / n8nUc06Parity.test.js / n8nUc08Parity.
// test.js: UC-07's deterministic pieces exist twice, once as the real Node
// functions and once as the "Relocation Gates" Code node in the UC-07 graph.
// This executes the ACTUAL node body (workflows/nodes-uc07/relocationGates.js)
// in a sandbox and compares it with the real functions.
//
// WHY THIS FILE GREW. Its earlier version compared `verdict`, `feasible` and
// the flag codes/severities — and those had never diverged. Everything else
// had. The node built a dossier of a different SHAPE (flat `mot`/`coverage`/
// `alignment`/`transition` where buildDossier() nests `dateChecks` and
// `transitionSafety`), carried its own five-entry mobility corpus with ids no
// citation in src/ has ever had, its own disclaimer and narrative wording, and
// a hand-rolled cost estimate with NO `QUOTE_REQUIRED` markers at all — the one
// mechanism that keeps an unquoted transfer fee from reading as a settled zero.
// The old assertions passed throughout. So the comparison is now the whole
// object: `assert.deepEqual(fromN8n.dossier, expectedDossier)`.
//
// TWO FIELDS ARE EXCLUDED FROM THE DEEP COMPARE, both clock-derived and
// neither a fact a specialist reads: `costEstimate.ref` (a `cc_<base36 now>`
// audit handle) and the poll `attempts` count. They are asserted on separately
// by shape, not by value.
//
// PARITY IS NOT CORRECTNESS. Two copies can agree perfectly and both be wrong —
// which is exactly what happened with the country extractor (both read
// "Portugal → Germany" as DE → FR) and, in the other direction, with the PTO
// cashout (the copies disagreed 100× on a value nothing read). So the scenarios
// below carry an `expect` block of ABSOLUTE expectations alongside the parity
// compare: the route the text actually names, the flag that must be raised, the
// figure that must come out. Parity proves the copies agree; `expect` proves
// they are right.
//
// POSITIVE TESTS, DELIBERATELY. A 🔴 use case that structurally cannot produce
// a complete dossier is indistinguishable from one being appropriately
// cautious — both just escalate. So these tests assert what the dossier MUST
// CONTAIN (every required section, the QUOTE_REQUIRED markers, real citation
// ids, a non-empty narrative) as well as that the decision never becomes
// anything but "escalate".
//
// node:vm results are cross-realm, so every result is JSON round-tripped before
// assert.deepEqual — prototype identity, not content, is what would fail.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { evaluateRelocationFeasibility } from "../src/uc07/transitionGate.js";
import { runCostCalculator } from "../src/uc07/costCalculator.js";
import { retrieveMobilityGuidance } from "../src/uc07/mobilityRetriever.js";
import { buildDossier, draftNarrative } from "../src/uc07/dossierBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc07", "relocationGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

/** Run the "Relocation Gates" Code node body with n8n's globals mocked. */
function runRelocationGatesNode({ ticket }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Relocation Request") return { first: () => ({ json: ticket }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  // node:vm results are cross-realm, so JSON round-trip before comparing
  return JSON.parse(JSON.stringify(result[0].json));
}

/**
 * The dossier the REAL functions produce for the same ticket — the same call
 * order handleRelocationReview() uses, with its two LLM seams on the exact
 * paths a Code node can reach: draftNarrative() unconfigured (the deterministic
 * template, which is what the node ports) and the judge's `not_evaluated`
 * sentinel (a Code node has no LLM client, and inventing a verdict either way
 * is the one thing narrativeJudge.js refuses).
 */
async function expectedDossierFor(ticket) {
  const ruleBased = parseRelocationRuleBased({ text: ticket.text });
  const parsed = { ...ruleBased, immigrationSupportRequired: ruleBased.requiresVisa, source: "rule_based_fallback" };
  const plan = ticket.plan || {};

  // The route, composed exactly as src/uc07/workflow.js composes it: a
  // structured fact from the plan wins over the classifier's reading.
  const sourceCountry = plan.sourceCountry ?? parsed.sourceCountry ?? null;
  const destinationCountry = plan.destinationCountry ?? parsed.destinationCountry ?? null;

  const feasibility = evaluateRelocationFeasibility({
    relocationType: parsed.relocationType,
    ...plan,
    immigrationSupportRequired: plan.immigrationSupportRequired ?? parsed.immigrationSupportRequired,
    sourceCountry,
    destinationCountry,
  });

  // Taken from the gate that derived it, never recomputed here (F-29).
  const ptoCashoutRemoteInteger = feasibility.pto.cashout.totalRemoteInteger;

  const costEstimate = await runCostCalculator({
    annualGrossSalaryRemoteInteger: plan.annualGrossSalaryRemoteInteger,
    currency: plan.currency ?? "USD",
    months: plan.months ?? 12,
    managementFeeBasisPoints: plan.managementFeeBasisPoints ?? 1200,
    transferFeeRemoteInteger: plan.transferFeeRemoteInteger ?? null,
    mobilityFeeRemoteInteger: plan.mobilityFeeRemoteInteger ?? null,
    ptoCashoutRemoteInteger,
  });

  const citations = await retrieveMobilityGuidance([ticket.text, parsed.relocationType].join(" "));

  const { narrative } = await draftNarrative(
    {
      relocationType: parsed.relocationType,
      sourceCountry,
      destinationCountry,
      verdict: feasibility.verdict,
      flags: feasibility.flags,
      citations,
    },
    { isConfigured: () => false } // the template path — the one a Code node has
  );

  return {
    feasibility,
    citations,
    narrative,
    dossier: buildDossier({
      relocationType: parsed.relocationType,
      sourceCountry,
      destinationCountry,
      parseSource: parsed.source,
      verdict: feasibility.verdict,
      feasible: feasibility.feasible,
      flags: feasibility.flags,
      requiredActions: feasibility.requiredActions,
      mot: feasibility.mot,
      coverage: feasibility.coverage,
      alignment: feasibility.alignment,
      transition: feasibility.transition,
      pto: feasibility.pto,
      seniority: feasibility.seniority,
      uncertainty: feasibility.uncertainty,
      costEstimate: costEstimate.estimate,
      citations,
      narrative,
      faithfulness: { verdict: "not_evaluated", reason: null },
    }),
  };
}

/** Strip the two clock-derived fields so the deep compare is deterministic. */
function withoutRef(dossier) {
  const copy = JSON.parse(JSON.stringify(dossier));
  if (copy.costEstimate) delete copy.costEstimate.ref;
  return copy;
}

const ticketFor = (text, over = {}) => ({
  text,
  employmentId: "emp_active_001",
  externalRef: "8001",
  source: "webhook",
  plan: {}, // Structured plan data (availability, dates, salary, etc.)
  ...over,
});

const SCENARIOS = [
  {
    name: "feasible relocation, curated countries",
    text: "We are permanently relocating Ana from our Madrid team to the Netherlands. Proposed start date is 2026-06-01, with termination in Spain on 2026-05-31. Salary is 65000 EUR per year. Right to work confirmed, destination entity active, all dates align properly.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      annualGrossSalaryRemoteInteger: 6500000, // 65,000 EUR per YEAR, Remote ×100
      minimumVisaSalaryRemoteInteger: 3500000,
      currency: "EUR",
      months: 12,
      transferFeeRemoteInteger: 150000,
      creationDate: "2026-04-01",
      proposedStartDate: "2026-06-01",
      destinationStartDate: "2026-06-01",
      sourceTerminationDate: "2026-05-31",
      sourceLastWorkingDay: "2026-05-31",
      minimumOnboardingLeadTimeBusinessDays: 20,
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
      employerPresenceInDestination: true,
      taxTreatyNexusConfirmed: true,
      ptoTransferAllowed: true,
      sourcePtoDays: 15,
      seniorityPreservable: true,
      sourceCountry: "ES",
      destinationCountry: "NL",
    },
  },
  {
    name: "destination outside curated list",
    text: "Please arrange relocation for John from Canada to Russia. He needs full immigration support.",
    plan: {
      destinationSupported: false, // Not in curated list
      destinationEntityActive: true,
    },
  },
  {
    name: "MOT violation",
    text: "We need to relocate Maria from Portugal to Germany urgently. She should start in Germany on 2026-04-15, with offboarding in Portugal on 2026-04-10. The normal MOT is 30 business days.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      creationDate: "2026-04-01",
      proposedStartDate: "2026-04-15",
      minimumOnboardingLeadTimeBusinessDays: 30, // Requires 30 business days
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
    },
  },
  {
    name: "salary below visa minimum",
    text: "Relocate David from US to Germany. Start date is 2026-08-01. Salary will be €25000 annually.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      annualGrossSalaryRemoteInteger: 2500000, // €25,000/yr × 100
      minimumVisaSalaryRemoteInteger: 4500000, // €45,000/yr × 100 required
      currency: "EUR",
      creationDate: "2026-06-01",
      proposedStartDate: "2026-08-01",
      minimumOnboardingLeadTimeBusinessDays: 22,
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
    },
  },
  {
    name: "employment gap",
    text: "Move Sarah from UK to Netherlands. Terminate UK employment on 2026-06-15, start NL employment on 2026-06-25 (10-day gap).",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      destinationStartDate: "2026-06-25",
      sourceTerminationDate: "2026-06-15",
      sourceLastWorkingDay: "2026-06-15",
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
    },
    expect: { sourceCountry: "GB", destinationCountry: "NL" },
  },
  {
    name: "duplicate fee risk due to poor alignment",
    text: "Relocate Tom from France to Italy. Terminate France on 2026-06-15, start Italy on 2026-06-16 (consecutive days but misaligned).",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      destinationStartDate: "2026-06-16",
      sourceTerminationDate: "2026-06-15",
      sourceLastWorkingDay: "2026-06-15",
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
    },
  },
  {
    name: "transition not safe - early offboarding",
    text: "Setup relocation for Lisa from Brazil to Canada. Start Canada on 2026-07-01, but terminate Brazil on 2026-06-15 (before destination is ready).",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      destinationStartDate: "2026-07-01", // Not confirmed yet
      sourceTerminationDate: "2026-06-15",
      sourceLastWorkingDay: "2026-06-15",
      destinationStartDateConfirmed: false, // Key: not confirmed ready
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      sourceExitPlanValidated: true,
    },
    expect: { sourceCountry: "BR", destinationCountry: "CA" },
  },
  {
    name: "PTO liquidation — the cashout is a real money figure in the dossier",
    text: "Relocating our product manager from France to Germany permanently. PTO will not transfer.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      annualGrossSalaryRemoteInteger: 7200000, // €72,000/yr
      minimumVisaSalaryRemoteInteger: 5800000,
      currency: "EUR",
      months: 12,
      creationDate: "2026-06-01",
      proposedStartDate: "2026-08-03",
      destinationStartDate: "2026-08-01",
      sourceTerminationDate: "2026-07-31",
      sourceLastWorkingDay: "2026-07-31",
      minimumOnboardingLeadTimeBusinessDays: 20,
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
      employerPresenceInDestination: true,
      taxTreatyNexusConfirmed: true,
      ptoTransferAllowed: false,
      sourcePtoDays: 15,
      seniorityPreservable: true,
    },
    // €72,000/yr ÷ 12 ÷ 22 × 15 days = €4,090.91. Read as a MONTHLY salary —
    // which is what both copies did before 2026-08-19 — it was €49,090.91.
    expect: { sourceCountry: "FR", destinationCountry: "DE", ptoCashoutRemoteInteger: 409091 },
  },
  {
    name: "no plan at all — the dossier is still complete, honestly INCOMPLETE on cost",
    text: "We would like to move someone abroad permanently, details to follow.",
    plan: {},
  },
];

// ---------------------------------------------------------------------------
// F-29 — the underivable PTO cashout. The Node copy THREW here (NaN into
// money.js, upstream of the audit write, so the request vanished); this copy
// silently produced NaN and discarded it, and the two disagreed by 100× on
// every value they did compute. Both are now one refusal, and parity is what
// keeps them one.
//
// The salary key is `annualGrossSalaryRemoteInteger` — its period, named. The
// gate reads an ANNUAL figure and derives the monthly rate internally; a key
// still called `monthlySalary*` carrying an annual value is the substitution
// that produced a 12× cashout, so the refusal must name the field a specialist
// can actually go and look for.
// ---------------------------------------------------------------------------
SCENARIOS.push(
  {
    name: "F-29 — PTO to liquidate but no salary: the shape that used to vanish",
    text: "We are permanently relocating our engineer from Spain to the Netherlands.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      ptoTransferAllowed: false,
      sourcePtoDays: 20,
      // annualGrossSalaryRemoteInteger absent — what the portal builds with a blank box
    },
    expect: {
      sourceCountry: "ES",
      destinationCountry: "NL",
      flag: "UC07_PTO_CASHOUT_NOT_COMPUTABLE",
      unusableFields: ["annualGrossSalaryRemoteInteger"],
    },
  },
  {
    name: "F-29 — a derivable cashout raises no flag and agrees to the cent",
    text: "Permanently relocating from Spain to the Netherlands.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      ptoTransferAllowed: false,
      sourcePtoDays: 11,
      // 26,400/YEAR ÷ 12 ÷ 22 = 100.00/day × 11 = 1,100.00. Trunk's version of
      // this scenario used 4,400,000 and expected 2,200,000, reading it as
      // 44,000 A MONTH — the figure, not the intent, had to change with the
      // period fix. The intent ("a derivable cashout raises no flag and agrees
      // to the cent") is unchanged, and the number still divides exactly so it
      // carries no rounding to argue about.
      annualGrossSalaryRemoteInteger: 2640000,
    },
    expect: { sourceCountry: "ES", destinationCountry: "NL", ptoCashoutRemoteInteger: 110000 },
  }
);

// ---------------------------------------------------------------------------
// F-29's quoted-number half is proven as its own test, not as a scenario,
// because a quoted salary trips TWO guards and a full-dossier scenario can only
// show the first one to fail. Both are deliberate and both must hold on both
// copies:
//   1. reconcilePtoCashout() CLASSIFIES it — `"6500000"` divides by 100
//      perfectly well in JavaScript, which is exactly how a 100× scaling error
//      gets in, so Number.isInteger refuses it and the payout is null with the
//      field named.
//   2. runCostCalculator() THROWS on it — that guard is documented as the
//      invariant that stops a bad ×100 value slipping through disguised as an
//      honest absence, and it must stay a throw rather than degrade quietly.
// The two are not in tension: a quoted string is a programming error, not a
// form value. src/portal/server.js coerces with Number() before it ever builds
// a plan, so this shape is unreachable from the portal — which is why the
// throw is still the right behaviour for it, and why it is pinned here on both
// copies rather than softened.
// ---------------------------------------------------------------------------
test("F-29 — a quoted salary is refused, identically, by both copies", async () => {
  const quotedPlan = {
    destinationSupported: true,
    destinationEntityActive: true,
    ptoTransferAllowed: false,
    sourcePtoDays: 11,
    annualGrossSalaryRemoteInteger: "6500000",
  };

  // 1. The gate classifies rather than coerces — asserted on the real function
  //    and on the node's own embedded copy, which must agree field for field.
  const realGate = evaluateRelocationFeasibility({ relocationType: "permanent_relocation", ...quotedPlan });
  assert.equal(realGate.pto.cashout.computable, false);
  assert.equal(realGate.pto.cashout.totalRemoteInteger, null, "a quoted number must never be coerced into a payout");
  assert.deepEqual(realGate.pto.cashout.unusable.map((u) => u.field), ["annualGrossSalaryRemoteInteger"]);
  assert.deepEqual(realGate.pto.cashout.unusable.map((u) => u.reason), ["not_an_integer"]);
  assert.ok(realGate.flags.some((f) => f.code === "UC07_PTO_CASHOUT_NOT_COMPUTABLE"));

  // 2. The cost calculator's ×100 invariant guard throws — on both copies, with
  //    the same message. The node reaches it through its own embedded port.
  await assert.rejects(
    () => runCostCalculator({ annualGrossSalaryRemoteInteger: "6500000", currency: "EUR", months: 12, managementFeeBasisPoints: 1200 }),
    /expects an ×100 annual gross salary integer/,
    "the real cost calculator must refuse a quoted salary loudly"
  );
  assert.throws(
    () => runRelocationGatesNode({ ticket: ticketFor("Permanently relocating from Spain to the Netherlands.", { plan: quotedPlan }) }),
    /expects an ×100 annual gross salary integer/,
    "the n8n copy must refuse it the same way — a guard that exists on one copy only is not a guard"
  );
});

// ---------------------------------------------------------------------------
// The ticket-18 scenarios. This node body is what actually ran in production
// (execution 4500) and published "Source country: DE; Destination country: FR"
// for a Portugal→Germany request, so the fix has to be proven HERE, not only in
// src/. Parity alone would not have caught it: both copies were wrong in
// exactly the same way, and agreed perfectly.
// ---------------------------------------------------------------------------
SCENARIOS.push(
  {
    name: "ticket 18 — Portugal to Germany, the exact live text",
    text: "Employee asks about permanently relocating from Portugal to Germany",
    plan: { destinationSupported: true, destinationEntityActive: true },
    expect: { sourceCountry: "PT", destinationCountry: "DE" },
  },
  {
    name: "ticket 18 reversed — 'to Germany from Portugal' reads the same route",
    text: "Permanently relocating to Germany from Portugal, starting in June.",
    plan: { destinationSupported: true, destinationEntityActive: true },
    expect: { sourceCountry: "PT", destinationCountry: "DE" },
  },
  {
    name: "ambiguous route — two countries, no direction word",
    text: "We have a permanent relocation question involving Portugal and Germany.",
    plan: { destinationSupported: true, destinationEntityActive: true },
    expect: { sourceCountry: null, destinationCountry: null, flag: "UC07_COUNTRIES_NOT_DETERMINED" },
  },
  {
    name: "no country named — English words that merely contain country codes",
    text: "The request came from the team about relocating a resident contractor under the new policy.",
    plan: { destinationSupported: true, destinationEntityActive: true },
    expect: { sourceCountry: null, destinationCountry: null, flag: "UC07_COUNTRIES_NOT_DETERMINED" },
  }
);

for (const scenario of SCENARIOS) {
  test(`n8n Relocation Gates matches the real dossier exactly — ${scenario.name}`, async () => {
    const ticket = ticketFor(scenario.text, { plan: scenario.plan });
    const fromN8n = runRelocationGatesNode({ ticket });
    const expected = await expectedDossierFor(ticket);

    // THE ASSERTION THAT MATTERS: the entire dossier, key for key, value for
    // value — shape, nesting, citations, cost components and their statuses,
    // narrative wording, framing and the mandatory disclaimer.
    assert.deepEqual(
      withoutRef(fromN8n.dossier),
      withoutRef(expected.dossier),
      "the n8n dossier differs from buildDossier()'s — a specialist would read a different document depending on which path ran"
    );

    // The `ref` is excluded above because it is clock-derived; it must still
    // EXIST, since the audit row links the estimate by it.
    assert.match(fromN8n.dossier.costEstimate.ref, /^cc_/, "the cost estimate must still carry an audit reference");

    // The intermediate values the graph's later nodes read, too.
    assert.deepEqual(fromN8n.feasibility, JSON.parse(JSON.stringify(expected.feasibility)), "feasibility differs");
    assert.deepEqual(fromN8n.citations, JSON.parse(JSON.stringify(expected.citations)), "citations differ");
    assert.equal(fromN8n.narrative, expected.narrative, "narrative text differs");

    // The PTO cashout, field by field. This is the money figure the two copies
    // had silently drifted 100× apart on, so "same verdict, same flags" was not
    // enough parity to catch it (F-29).
    assert.deepEqual(
      fromN8n.feasibility.pto.cashout,
      JSON.parse(JSON.stringify(expected.feasibility.pto.cashout)),
      "PTO cashout reconciliation differs between the copies"
    );

    // Absolute expectations where the scenario states them — parity proves the
    // two copies agree, and only this proves they are both RIGHT.
    if (scenario.expect) {
      assert.equal(fromN8n.sourceCountry, scenario.expect.sourceCountry, "sourceCountry is not the country the text names");
      assert.equal(fromN8n.destinationCountry, scenario.expect.destinationCountry, "destinationCountry is not the country the text names");
      if (scenario.expect.ptoCashoutRemoteInteger !== undefined) {
        assert.equal(
          fromN8n.feasibility.pto.cashout.totalRemoteInteger,
          scenario.expect.ptoCashoutRemoteInteger,
          "the cashout must be a Remote ×100 integer in the right period — this copy used to return a human amount, and both copies used to read the annual salary as monthly"
        );
      }
      if (scenario.expect.unusableFields) {
        assert.deepEqual(
          fromN8n.feasibility.pto.cashout.unusable.map((u) => u.field),
          scenario.expect.unusableFields,
          "the refusal must name the field by the name it currently has — an escalation naming a field that no longer exists sends a specialist looking for nothing"
        );
        assert.equal(fromN8n.feasibility.pto.cashout.computable, false);
        assert.equal(fromN8n.feasibility.pto.cashout.totalRemoteInteger, null, "an underivable payout is null, never a coerced 0");
      }
      if (scenario.expect.flag) {
        assert.ok(
          fromN8n.feasibility.flags.some((f) => f.code === scenario.expect.flag),
          `expected flag ${scenario.expect.flag} was not raised`
        );
      }
    }

    // 🔴 invariant: one decision, always, whatever the inputs.
    assert.equal(fromN8n.decision, "escalate", "UC-07 must always escalate - no execution path exists");
    assert.equal(fromN8n.riskTier, "high", "UC-07 risk tier must be high");

    // The ticket's own provenance is not overwritten by the parser's.
    assert.equal(fromN8n.source, "webhook", "the trigger source must survive; parser provenance is parseSource");
    assert.equal(fromN8n.parseSource, "rule_based_fallback");
  });
}

// ---------------------------------------------------------------------------
// POSITIVE tests: what the dossier must CONTAIN. A dossier that refuses
// correctly and a dossier that is structurally incapable of being complete
// look identical from outside — only these tell them apart.
// ---------------------------------------------------------------------------

const REQUIRED_DOSSIER_SECTIONS = [
  "relocationType",
  "sourceCountry",
  "destinationCountry",
  "parseSource",
  "verdict",
  "feasible",
  "flags",
  "requiredActions",
  "dateChecks",
  "transitionSafety",
  "pto",
  "seniority",
  "uncertainty",
  "costEstimate",
  "citations",
  "narrative",
  "faithfulness",
  "framing",
  "customerFacingAcknowledgement",
];

test("the n8n dossier carries every section buildDossier() defines — none silently dropped", () => {
  const ticket = ticketFor(SCENARIOS[0].text, { plan: SCENARIOS[0].plan });
  const fromN8n = runRelocationGatesNode({ ticket });

  for (const key of REQUIRED_DOSSIER_SECTIONS) {
    assert.ok(key in fromN8n.dossier, `the dossier is missing "${key}" — the specialist would go looking elsewhere for it`);
  }
  // The two nested sections are the ones the old port flattened.
  for (const key of ["mot", "coverage", "alignment"]) {
    assert.ok(key in fromN8n.dossier.dateChecks, `dateChecks.${key} is missing`);
  }
  assert.ok("sourceOffboardingAuthorized" in fromN8n.dossier.transitionSafety);
  // And the PTO section carries its own cashout reconciliation (F-29).
  assert.ok("cashout" in fromN8n.dossier.pto);
});

test("QUOTE_REQUIRED markers survive the port — an unquoted fee is never a settled zero", () => {
  // No transferFee and no mobilityFee in the plan: both must come back as
  // pending quotes, named, rather than omitted or invented (Build Pack Part 32).
  const { transferFeeRemoteInteger, ...planWithoutQuotes } = SCENARIOS[0].plan;
  const ticket = ticketFor(SCENARIOS[0].text, { plan: planWithoutQuotes });
  const fromN8n = runRelocationGatesNode({ ticket });
  const components = fromN8n.dossier.costEstimate.components;

  const transfer = components.find((c) => c.key === "eorTransferFee");
  const mobility = components.find((c) => c.key === "mobilityFee");
  assert.equal(transfer.status, "QUOTE_REQUIRED", "the one-off EOR transfer fee is quoted by Remote, never computed here");
  assert.equal(mobility.status, "QUOTE_REQUIRED", "mobility / visa support is quoted by Remote, never computed here");
  assert.deepEqual(fromN8n.dossier.costEstimate.pendingQuotes, ["eorTransferFee", "mobilityFee"]);

  // And the total is explicitly the KNOWN total, so a reader cannot mistake a
  // partial figure for the whole cost.
  assert.ok("knownTotalRemoteInteger" in fromN8n.dossier.costEstimate);
  assert.match(fromN8n.dossier.costEstimate.knownTotalDisplay, /EUR$/);
});

test("a plan with no salary yields an honest INCOMPLETE estimate, never a fabricated number", () => {
  const ticket = ticketFor("Permanent relocation, salary still being agreed.", { plan: { destinationSupported: true } });
  const fromN8n = runRelocationGatesNode({ ticket });
  const estimate = fromN8n.dossier.costEstimate;

  assert.equal(estimate.status, "INCOMPLETE");
  assert.equal(estimate.annualGrossSalaryRemoteInteger, null);
  assert.equal(estimate.monthlyFeeRemoteInteger, null, "no salary means no fee — not a zero that reads as free");
  assert.deepEqual(estimate.pendingQuotes, ["monthlyManagementFee", "eorTransferFee", "mobilityFee"]);
});

test("an underivable PTO cashout adds no line to the estimate at all — not a 0.00 one", () => {
  // F-29 meeting the cost estimate: `null > 0` is false, so the component is
  // absent rather than present-and-zero. A 0.00 line on a dossier reads as
  // "nothing is owed", which is the confident underpayment the refusal exists
  // to prevent.
  const ticket = ticketFor("Permanently relocating from Spain to the Netherlands.", {
    plan: { destinationSupported: true, ptoTransferAllowed: false, sourcePtoDays: 20, currency: "EUR" },
  });
  const fromN8n = runRelocationGatesNode({ ticket });

  assert.equal(fromN8n.dossier.pto.cashout.computable, false);
  assert.equal(fromN8n.dossier.pto.cashout.totalRemoteInteger, null);
  assert.equal(
    (fromN8n.dossier.costEstimate.components || []).find((c) => c.key === "ptoCashout"),
    undefined,
    "an underivable cashout must not appear as a zero-valued component"
  );
});

test("cost figures are derived from an ANNUAL gross salary, matching Remote's annual_gross_salary", () => {
  // €65,000/YEAR at 1200bp: €7,800/yr = €650/month. Read as a monthly salary —
  // which is what this node did before 2026-08-19 — the same input produced a
  // €7,800 MONTHLY fee, twelve times over, on a 🔴 relocation dossier.
  const ticket = ticketFor(SCENARIOS[0].text, { plan: SCENARIOS[0].plan });
  const estimate = runRelocationGatesNode({ ticket }).dossier.costEstimate;

  assert.equal(estimate.annualGrossSalaryRemoteInteger, 6500000);
  assert.equal(estimate.monthlyGrossSalaryRemoteInteger, 541667, "65,000 / 12 = 5,416.67");
  assert.equal(estimate.annualFeeRemoteInteger, 780000, "12% of 65,000 = 7,800.00 per year");
  assert.equal(estimate.monthlyFeeRemoteInteger, 65000, "650.00 per month");
});

test("the PTO cashout in the dossier is the ÷12÷22 daily rate, not the ÷22 one", () => {
  const scenario = SCENARIOS.find((s) => s.name.startsWith("PTO liquidation"));
  const ticket = ticketFor(scenario.text, { plan: scenario.plan });
  const fromN8n = runRelocationGatesNode({ ticket });
  const cashout = fromN8n.dossier.costEstimate.components.find((c) => c.key === "ptoCashout");

  assert.equal(fromN8n.dossier.pto.decision, "LIQUIDATE");
  assert.equal(fromN8n.dossier.pto.liquidatedDays, 15);
  assert.equal(cashout.remoteInteger, 409091, "€72,000/yr ÷ 12 ÷ 22 × 15 days = €4,090.91");
  assert.notEqual(cashout.remoteInteger, 4909091, "the old ÷22-of-an-annual-figure reading was €49,090.91");
});

test("citation ids are the real corpus's, so a specialist can look one up", () => {
  const ticket = ticketFor(
    "Terminate the source employment only once the destination contract is active — and PTO will be liquidated, plus we need a visa.",
    { plan: {} }
  );
  const fromN8n = runRelocationGatesNode({ ticket });
  const ids = fromN8n.citations.map((c) => c.id);

  assert.ok(ids.includes("mobility-transition-safety"));
  assert.ok(ids.includes("mobility-pto-portability"));
  assert.ok(ids.includes("mobility-immigration-guidance"));
  for (const citation of fromN8n.citations) {
    assert.ok(citation.matchedOn.length > 0, "every citation states which keyword matched it");
    assert.ok(citation.summary.length > 0);
  }
});

test("the mandatory mobility disclaimer is the shared one, verbatim", () => {
  const ticket = ticketFor(SCENARIOS[1].text, { plan: SCENARIOS[1].plan });
  const fromN8n = runRelocationGatesNode({ ticket });
  assert.match(
    fromN8n.dossier.customerFacingAcknowledgement,
    /preliminary feasibility summary, not a decision or legal advice/,
    "the node must use shared/disclaimer.js's 'mobility' text, not one of its own"
  );
  assert.match(fromN8n.dossier.framing, /RESEARCH SUPPORT ONLY/);
});

test("no input produces anything but escalate — including inputs that look approvable", () => {
  // The clean, fully-confirmed, zero-flag PROCEED case is the one an execution
  // path would fire on if any existed. It escalates like every other.
  const clean = runRelocationGatesNode({ ticket: ticketFor(SCENARIOS[0].text, { plan: SCENARIOS[0].plan }) });
  assert.equal(clean.dossier.verdict, "PROCEED");
  assert.equal(clean.dossier.feasible, true);
  assert.deepEqual(clean.dossier.flags, []);
  assert.equal(clean.decision, "escalate");

  assert.ok(!/\bdecision\s*=\s*['"](?!escalate)/.test(gatesSource), "the node assigns a decision other than escalate somewhere");
  const stripped = gatesSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const writeShaped of ["createEmployment", "createOffboarding", "updateEmployment", "deleteEmployment", "$http", "fetch("]) {
    assert.ok(!stripped.includes(writeShaped), `the node references a write-shaped call: ${writeShaped}`);
  }
});

test("both n8n Code node bodies are syntactically valid", () => {
  const bodyFiles = ["normalizeRelocationRequest.js", "relocationGates.js"];
  for (const file of bodyFiles) {
    const src = readFileSync(join(__dirname, "..", "workflows", "nodes-uc07", file), "utf8");
    assert.doesNotThrow(() => new Function(src), `${file} does not compile`);
  }
});
