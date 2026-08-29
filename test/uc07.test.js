// ---------------------------------------------------------------------------
// uc07.test.js  —  UC-07's §12 test plan (6 items) + the deterministic gates,
// plus the structural proof this 🔴 use case has NO execution path. Mirrors
// uc08.test.js's discipline throughout: hermetic, fake injection for every LLM
// seam, and the "assert by structure AND by behavior" no-execution proof.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AuditLogger } from "../src/shared/audit.js";
import { handleRelocationReview } from "../src/uc07/workflow.js";
import { parseRelocation, parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import {
  evaluateRelocationFeasibility,
  evaluateMOT,
  evaluateCoverageGap,
  evaluateTransitionSafety,
  evaluateSeniority,
  computeUncertaintyScore,
  explainUncertainty,
  reconcilePtoCashout,
  FLAG,
  SEVERITY,
} from "../src/uc07/transitionGate.js";
import { runCostCalculator } from "../src/uc07/costCalculator.js";
import {
  retrieveMobilityGuidance,
  MobilityRetriever,
  EMBEDDING_MATCH_THRESHOLD,
  cosineSimilarity,
} from "../src/uc07/mobilityRetriever.js";
import { DossierStore } from "../src/uc07/dossierStore.js";
import { draftNarrative } from "../src/uc07/dossierBuilder.js";
import { describeDossier } from "../src/uc07/dossierView.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Inject the deterministic template for prose so no test here ever makes a
// real, retried LLM call just because OPENAI_API_KEY happens to be set (the
// real hazard this repo's own devcontainer keeps tripping — see #31/#32).
const fakeDraftNarrative = async () => ({ narrative: "Dossier narrative (deterministic template).", source: "template" });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// A clean, month-end-aligned relocation plan that must PROCEED with zero flags.
const FEASIBLE_PLAN = {
  destinationSupported: true,
  destinationEntityActive: true,
  annualGrossSalaryRemoteInteger: 6500000, // 65,000 EUR per YEAR — above the statutory minimum below
  currency: "EUR",
  months: 12,
  minimumVisaSalaryRemoteInteger: 5500000,
  transferFeeRemoteInteger: 150000, // one-off fee from a quote, not computed
  creationDate: "2026-05-01",
  proposedStartDate: "2026-07-01",
  destinationStartDate: "2026-07-01",
  sourceTerminationDate: "2026-06-30",
  sourceLastWorkingDay: "2026-06-30",
  minimumOnboardingLeadTimeBusinessDays: 20,
  immigrationSupportRequired: false,
  immigrationConfirmed: true,
  rightToWorkConfirmed: true,
  destinationStartDateConfirmed: true,
  sourceExitPlanValidated: true,
  employerPresenceInDestination: true,
  taxTreatyNexusConfirmed: true,
  ptoTransferAllowed: true,
  sourcePtoDays: 12,
  seniorityPreservable: true,
};

function run(overrides = {}) {
  return handleRelocationReview(
    {
      text: "We're permanently relocating our engineer from Spain to the Netherlands. We'll need visa support.",
      employmentId: "emp_active_001",
      externalRef: "t-07",
      source: "test",
      plan: FEASIBLE_PLAN,
      ...overrides,
    },
    { audit: new AuditLogger(), classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
}

// ---------------------------------------------------------------------------
// §12 item 1 — feasible relocation -> complete dossier + cost estimate -> escalate
// ---------------------------------------------------------------------------

test("1. feasible relocation -> dossier with PROCEED + attached cost estimate, decision escalates", async () => {
  const r = await run();
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.verdict, "PROCEED");
  assert.equal(r.dossier.feasible, true);
  assert.deepEqual(r.dossier.flags, []);
  assert.equal(r.dossier.relocationType, "permanent_relocation");
  assert.equal(r.dossier.sourceCountry, "ES");
  assert.equal(r.dossier.destinationCountry, "NL");

  // §12 item 1 second half: the cost estimate is attached to the dossier.
  assert.equal(r.costEstimate.status, "CALCULATED");
  assert.equal(r.dossier.costEstimate.status, "CALCULATED");
  assert.ok(r.costEstimate.ref, "the estimate carries a reference for the audit trail");
  // EXACT FIGURES, PINNED. `annualGrossSalaryRemoteInteger` is the period
  // Remote's own `annual_gross_salary` uses ("in cents"), and every monthly
  // figure is derived from it here rather than passed in. Before this was
  // fixed the same 6,500,000 was read as a MONTHLY salary, so this assertion
  // read `monthlyFeeRemoteInteger === 780000` and called €7,800 a monthly fee
  // on a €65,000/yr package — the test agreeing with the code rather than with
  // the API, which is the exact failure mode CLAUDE.md §4 names.
  assert.equal(r.dossier.costEstimate.annualGrossSalaryRemoteInteger, 6500000, "65,000.00 EUR per year, ×100");
  assert.equal(r.dossier.costEstimate.monthlyGrossSalaryRemoteInteger, 541667, "65,000 / 12 = 5,416.67 EUR per month, ×100");
  assert.equal(r.dossier.costEstimate.annualFeeRemoteInteger, 780000, "12% of 65,000 EUR = 7,800.00 EUR per YEAR, ×100");
  assert.equal(r.dossier.costEstimate.monthlyFeeRemoteInteger, 65000, "7,800 / 12 = 650.00 EUR per month, ×100");
  assert.equal(
    r.dossier.costEstimate.lifetimeMonthlyFeesRemoteInteger,
    780000,
    "650.00/month over the plan's 12 months = 7,800.00 EUR — equal to the annual fee, as it must be"
  );

  // The mandatory mobility disclaimer is applied unconditionally.
  assert.match(r.dossier.customerFacingAcknowledgement, /preliminary feasibility summary, not a decision/);
  assert.match(r.dossier.framing, /RESEARCH SUPPORT ONLY/);
});

test("1b. cost estimate: a missing transfer/mobility fee is honestly QUOTE_REQUIRED, never invented", async () => {
  // Same plan minus the one-off fee — the module must not conjure a transfer
  // price from nowhere (Build Pack Part 32: "Remote Pricing / Quote should be
  // the source of truth").
  const { transferFeeRemoteInteger, ...noTransferFeePlan } = FEASIBLE_PLAN;
  const r = await run({ plan: noTransferFeePlan });
  const components = r.costEstimate.components;
  const transfer = components.find((c) => c.key === "eorTransferFee");
  assert.equal(transfer.status, "QUOTE_REQUIRED");
  assert.ok(r.costEstimate.pendingQuotes.includes("eorTransferFee"), "the pending quote is surfaced to the specialist");
});

// ---------------------------------------------------------------------------
// §12 item 2 — unsupported country -> flagged infeasible
// ---------------------------------------------------------------------------

test("2. unsupported destination country -> BLOCK, flagged infeasible, still escalates", async () => {
  const r = await run({
    plan: {
      ...FEASIBLE_PLAN,
      destinationSupported: false,
      destinationStartDate: "2026-06-30",
      sourceTerminationDate: "2026-06-15",
      sourceLastWorkingDay: "2026-06-12",
      rightToWorkConfirmed: false,
      employerPresenceInDestination: false,
      taxTreatyNexusConfirmed: false,
      ptoTransferAllowed: false,
      seniorityPreservable: null,
    },
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.verdict, "BLOCK");
  assert.equal(r.dossier.feasible, false);
  const codes = r.dossier.flags.map((f) => f.code);
  assert.ok(codes.includes(FLAG.DESTINATION_COUNTRY_UNSUPPORTED));
  assert.ok(codes.includes(FLAG.EMPLOYMENT_GAP), "a 17-day gap is flagged, not silently tolerated");
  assert.ok(codes.includes(FLAG.SOURCE_OFFBOARDING_NOT_AUTHORIZED));
  assert.equal(r.dossier.uncertainty, 1, "enough HIGH flags to saturate the uncertainty score");
});

// ---------------------------------------------------------------------------
// §12 item 3 — salary below visa minimum -> flagged
// ---------------------------------------------------------------------------

test("3. salary below the statutory visa minimum -> SALARY_BELOW_VISA_MINIMUM, shortfall reported", async () => {
  const r = await run({
    plan: { ...FEASIBLE_PLAN, annualGrossSalaryRemoteInteger: 4000000 }, // 40,000/yr < 55,000/yr minimum
  });
  assert.equal(r.dossier.verdict, "BLOCK");
  assert.ok(r.dossier.flags.some((f) => f.code === FLAG.SALARY_BELOW_VISA_MINIMUM));

  // Direct gate-level check: the shortfall is computed in ×100 units.
  const check = evaluateRelocationFeasibility({
    destinationSupported: true,
    annualGrossSalaryRemoteInteger: 4000000,
    minimumVisaSalaryRemoteInteger: 5500000,
  });
  const flag = check.flags.find((f) => f.code === FLAG.SALARY_BELOW_VISA_MINIMUM);
  assert.equal(flag.severity, SEVERITY.HIGH);
});

// ---------------------------------------------------------------------------
// §12 item 4 — async cost-calculator poll completes and attaches
// ---------------------------------------------------------------------------

test("4. cost-calculator lifecycle: create -> poll -> retrieve with an injectable poll delay", async () => {
  let delays = 0;
  const result = await runCostCalculator(
    {
      annualGrossSalaryRemoteInteger: 6500000,
      currency: "EUR",
      months: 12,
      managementFeeBasisPoints: 1200,
      transferFeeRemoteInteger: 150000,
    },
    { delay: async () => { delays += 1; } }
  );
  assert.equal(result.status, "CALCULATED");
  assert.ok(result.ref, "a reference is returned for audit linkage");
  assert.equal(result.attempts, 2, "one processing tick then ready — the poll loop actually polled");
  assert.equal(delays, 1, "the second poll waited on the injectable delay exactly once");
});

test("4b. the poll loop is bounded — it fails loudly rather than polling forever", async () => {
  // maxPollAttempts=1: the single poll sees "processing" and there is no next
  // poll, so the calculator must throw — never spin, never fake a CALCULATED
  // status it didn't reach.
  await assert.rejects(
    runCostCalculator(
      {
        annualGrossSalaryRemoteInteger: 6500000,
        currency: "EUR",
        months: 12,
        managementFeeBasisPoints: 1200,
        maxPollAttempts: 1,
      },
      { delay: async () => {} }
    ),
    /did not become ready after 1 polls/
  );
});

// ---------------------------------------------------------------------------
// §12 item 5 — citations present and relevant
// ---------------------------------------------------------------------------

test("5. mobility guidance citations are attached, each stating what it matched on", async () => {
  const r = await run(); // text mentions visa support
  assert.ok(r.dossier.citations.length > 0, "a relocation with visa context must retrieve guidance");
  const immigration = r.dossier.citations.find((c) => c.id === "mobility-immigration-guidance");
  assert.ok(immigration, "the immigration-separation guidance is the relevant passage");
  assert.ok(immigration.matchedOn.includes("visa"), "keyword path says the actual keyword that matched");
});

test("5b. keyword fallback (the hermetic default): relevant text matches, unrelated text returns nothing", async () => {
  const visa = await retrieveMobilityGuidance("We'll need visa support for the move.");
  assert.deepEqual(visa.map((c) => c.id), ["mobility-immigration-guidance"]);

  const pto = await retrieveMobilityGuidance("PTO won't transfer, so we'll liquidate the balance.");
  assert.ok(pto.some((c) => c.id === "mobility-pto-portability"));

  // The keyword half of the ticket-18 defect class. "reMOTe" contains "mot",
  // the corpus keyword for Minimum Onboarding Time — and "Remote" is the name
  // of the platform this whole system runs on, so a large share of real tickets
  // were being cited MOT guidance with `matchedOn: ["mot"]` as the stated
  // reason. A fabricated reason on a real citation is the same lie as a
  // fabricated jurisdiction, one field over.
  const platformName = await retrieveMobilityGuidance("Our employee wants to relocate; we use Remote as our EOR.");
  assert.deepEqual(platformName, [], "the word 'Remote' must not cite Minimum Onboarding Time guidance");

  // …while the real keyword, and the deliberate stems, still match.
  const mot = await retrieveMobilityGuidance("The MOT for this country is 20 business days.");
  assert.ok(mot.some((c) => c.id === "mobility-minimum-onboarding-time"));
  const stem = await retrieveMobilityGuidance("She will need immigration support for this move.");
  assert.ok(stem.some((c) => c.matchedOn.includes("immigrat")), "stem keywords must still match their inflections");

  const unrelated = await retrieveMobilityGuidance("Can you reset my password?");
  assert.deepEqual(unrelated, []);
});

// ---------------------------------------------------------------------------
// §12 item 6 — NO execution path: asserted structurally AND behaviorally
// ---------------------------------------------------------------------------

test("6a. STRUCTURAL: workflow.js imports no write-capable client and calls no write-shaped method", () => {
  const fullSource = readFileSync(join(__dirname, "..", "src", "uc07", "workflow.js"), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(!/from\s+["'].*(zendesk|remote)\/restClient\.js["']/.test(code), "workflow.js must not import either REST client");
  const forbiddenCalls = [
    "ZendeskClient", "RemoteClient", "createTicket", "updateTicket", "resolveWithLetter",
    "flagForReview", "createEmployment", "resignEmployment", "inviteEmployment",
    "patchEmploymentBasicInformation", "createContractAmendment",
  ];
  for (const name of forbiddenCalls) {
    assert.ok(!code.includes(name), `workflow.js's actual code must never reference ${name} — UC-07 has no execution path`);
  }
});

test("6b. STRUCTURAL: server.js advertises GET/OPTIONS only — no write verb is even offered", () => {
  const fullSource = readFileSync(join(__dirname, "..", "src", "uc07", "server.js"), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!code.includes('"POST"'), "server.js must contain no POST route — the API layer can never be an execution path");
  assert.ok(code.includes("GET, OPTIONS"), "CORS advertises exactly what exists: read + preflight");
});

test("6c. BEHAVIORAL: handleRelocationReview needs no remote/zendesk dependency at all, and always decides escalate", async () => {
  const scenarios = [
    { text: "We're permanently relocating an employee to Germany." },
    { text: "Relocation with visa and work permit needs." },
    { text: "Completely unrelated request about my payslip." },
    { text: "" },
  ];
  for (const s of scenarios) {
    // Only `audit` is passed — proving no write client is even needed, let
    // alone used, for this 🔴 use case to run to completion.
    const r = await handleRelocationReview(s, {
      audit: new AuditLogger(),
      classify: parseRelocationRuleBased,
      draftNarrative: fakeDraftNarrative,
      judge: fakeJudge,
    });
    assert.equal(r.decision, "escalate", `every UC-07 request must escalate, got ${r.decision} for "${s.text}"`);
  }
});

test("6d. the audit trail records an escalation with the dossier's key facts, never an execution", async () => {
  const audit = new AuditLogger();
  await handleRelocationReview(
    { text: "We're permanently relocating an employee to the Netherlands.", employmentId: "emp_1", externalRef: "t-9" },
    { audit, classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  const entries = audit.forUseCase("UC-07");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "escalate");
  assert.equal(entries[0].riskTier, "high");
  assert.equal(entries[0].details.disclaimerApplied, true);
  assert.ok(entries[0].details.costCalculatorRef, "the cost estimate reference is in the audit record (§10)");
  assert.ok(Array.isArray(entries[0].details.flagCodes));
});

// ---------------------------------------------------------------------------
// The deterministic gates, unit-level (hermetic, no workflow involved)
// ---------------------------------------------------------------------------

test("gates: MOT lead time is counted in business days, and a too-early start flags MOT_VIOLATION", () => {
  const mot = evaluateMOT({ creationDate: "2026-05-01", proposedStartDate: "2026-07-01", minimumLeadTimeBusinessDays: 20 });
  assert.equal(mot.code, "VALID");

  const tooEarly = evaluateRelocationFeasibility({
    destinationSupported: true,
    creationDate: "2026-06-30",
    proposedStartDate: "2026-07-01",
    minimumOnboardingLeadTimeBusinessDays: 20,
  });
  assert.ok(tooEarly.flags.some((f) => f.code === FLAG.MOT_VIOLATION));
});

test("gates: coverage reports a real gap and a real overlap, and clean sequencing passes", () => {
  const gap = evaluateCoverageGap({ sourceLastWorkingDay: "2026-06-12", sourceTerminationDate: "2026-06-15", destinationStartDate: "2026-06-30" });
  assert.equal(gap.status, "GAP");
  assert.equal(gap.gapDays, 17);

  const overlap = evaluateCoverageGap({ sourceLastWorkingDay: "2026-07-14", sourceTerminationDate: "2026-07-15", destinationStartDate: "2026-07-01" });
  assert.equal(overlap.status, "OVERLAP");
  assert.equal(overlap.overlapDays, 14);

  const clean = evaluateCoverageGap({ sourceLastWorkingDay: "2026-06-30", sourceTerminationDate: "2026-06-30", destinationStartDate: "2026-07-01" });
  assert.equal(clean.status, "CLEAN");
});

test("gates: month-end alignment is the duplicate-fee guard the spec calls for", () => {
  const aligned = evaluateRelocationFeasibility({ destinationSupported: true, sourceTerminationDate: "2026-06-30", destinationStartDate: "2026-07-01", sourceLastWorkingDay: "2026-06-30" });
  assert.ok(!aligned.flags.some((f) => f.code === FLAG.DUPLICATE_FEE_RISK));

  const misaligned = evaluateRelocationFeasibility({ destinationSupported: true, sourceTerminationDate: "2026-07-15", destinationStartDate: "2026-07-01", sourceLastWorkingDay: "2026-07-14" });
  assert.ok(misaligned.flags.some((f) => f.code === FLAG.DUPLICATE_FEE_RISK));
});

test("gates: THE transition-safety rule (Build Pack Part 9) — destination ready THEN source exit", () => {
  const notAuthorized = evaluateTransitionSafety({
    destinationContractActive: true, rightToWorkConfirmed: false,
    destinationStartDateConfirmed: true, sourceExitPlanValidated: true,
  });
  assert.equal(notAuthorized.sourceOffboardingAuthorized, false);
  assert.deepEqual(notAuthorized.missing, ["right_to_work_confirmed"]);

  const authorized = evaluateTransitionSafety({
    destinationContractActive: true, rightToWorkConfirmed: true,
    destinationStartDateConfirmed: true, sourceExitPlanValidated: true,
  });
  assert.equal(authorized.sourceOffboardingAuthorized, true);
});

test("gates: seniorityPreservable=UNKNOWN routes to legal review, never a silent reset to zero seniority (CLAUDE.md's honesty rule)", () => {
  // The unit-level function, direct: `preservable` omitted/null must be
  // REQUIRES_LEGAL_REVIEW, not RESET — "unknown" and "false" are different
  // facts and must never collapse into the same verdict.
  const unknown = evaluateSeniority({ originalHireDate: "2019-03-15", destinationStartDate: "2026-07-01", preservable: null });
  assert.equal(unknown.status, "REQUIRES_LEGAL_REVIEW");
  assert.equal(unknown.seniorityDate, null, "no seniority date is asserted while the fact is unresolved");

  const reset = evaluateSeniority({ originalHireDate: "2019-03-15", destinationStartDate: "2026-07-01", preservable: false });
  assert.equal(reset.status, "RESET");
  assert.equal(reset.seniorityDate, "2026-07-01");

  const preserved = evaluateSeniority({ originalHireDate: "2019-03-15", destinationStartDate: "2026-07-01", preservable: true });
  assert.equal(preserved.status, "PRESERVED");
  assert.equal(preserved.seniorityDate, "2019-03-15");
});

test("gates: seniorityPreservable=UNKNOWN raises SENIORITY_REVIEW_REQUIRED through the composed feasibility gate, and forces REVIEW/BLOCK never a silent PROCEED", () => {
  const unknown = evaluateRelocationFeasibility({
    destinationSupported: true,
    destinationStartDate: "2026-07-01",
    seniorityPreservable: null,
  });
  assert.ok(unknown.flags.some((f) => f.code === FLAG.SENIORITY_REVIEW_REQUIRED));
  assert.notEqual(unknown.verdict, "PROCEED", "an unresolved seniority fact must never be silently waved through as feasible");

  // Explicitly false ("resets") does NOT raise the review flag — it is a
  // resolved fact, not an unknown one. Confirms unknown and false are
  // genuinely distinguished, not just cosmetically different labels.
  const resolvedFalse = evaluateRelocationFeasibility({
    destinationSupported: true,
    destinationStartDate: "2026-07-01",
    seniorityPreservable: false,
  });
  assert.ok(!resolvedFalse.flags.some((f) => f.code === FLAG.SENIORITY_REVIEW_REQUIRED));
});

test("gates: originalHireDate flows through evaluateRelocationFeasibility into a PRESERVED seniority verdict's date (regression: was hardcoded null)", () => {
  const r = evaluateRelocationFeasibility({
    destinationSupported: true,
    destinationStartDate: "2026-07-01",
    seniorityPreservable: true,
    originalHireDate: "2019-03-15",
  });
  assert.equal(r.seniority.status, "PRESERVED");
  assert.equal(
    r.seniority.seniorityDate,
    "2019-03-15",
    "a PRESERVED verdict must carry the real hire date the specialist needs, not a hardcoded null"
  );
});

test("gates: uncertainty is deterministic from actual flags — never an LLM guess", () => {
  assert.equal(computeUncertaintyScore([]), 0);
  assert.equal(computeUncertaintyScore([{ severity: SEVERITY.HIGH }]), 0.5);
  assert.equal(computeUncertaintyScore([{ severity: SEVERITY.HIGH }, { severity: SEVERITY.LOW }]), 0.7);
  assert.equal(
    computeUncertaintyScore([{ severity: SEVERITY.HIGH }, { severity: SEVERITY.HIGH }, { severity: SEVERITY.HIGH }]),
    1,
    "capped at 1 — the score is a dossier aid, not a scaled rating to game"
  );
});

// ---------------------------------------------------------------------------
// F-29 — a PTO cashout that cannot be derived must escalate, not vanish.
//
// The same fail-open-into-silence class as UC-05's F-28. The cashout used to be
// four lines of arithmetic: an absent salary divided by 100 gave NaN,
// toRemoteInteger refused it — a THROW out of the gates, upstream of the audit
// write, so the request left no dossier row and no audit row at all. Every
// other refusal in this system is a durable, audited escalate.
//
// TWO INDEPENDENT FIXES ARE PINNED HERE AND NEITHER SUPERSEDES THE OTHER:
// F-29 is about what happens when the number CANNOT be derived (refuse, name
// the field, never coerce a zero); the period fix is about the number being
// twelve times wrong when it CAN (the salary is ANNUAL gross — Remote's own
// `annual_gross_salary`, in cents — so the daily rate is annual ÷ 12 ÷ 22, not
// annual ÷ 22). The parameter is named for its period precisely so the
// substitution that caused the 12× cannot be made silently again, and
// `unusable[]` names the field by that CURRENT name — an escalation naming
// `monthlySalaryRemoteInteger` would send a specialist looking for a field that
// no longer exists anywhere in this system.
// ---------------------------------------------------------------------------

test("F-29 a. an absent salary with days to liquidate is REFUSED, never coerced to a number", () => {
  const r = reconcilePtoCashout({ annualGrossSalaryRemoteInteger: undefined, liquidatedDays: 20 });
  assert.equal(r.computable, false, "an amount we cannot derive is not computable");
  assert.equal(r.totalRemoteInteger, null, "and its total is null — never 0, which reads as 'nothing is owed'");
  assert.deepEqual(
    r.unusable.map((u) => u.field),
    ["annualGrossSalaryRemoteInteger"],
    "the refusal names the field that was missing, BY ITS CURRENT NAME, so the escalation is actionable"
  );
});

test("F-29 b. a quoted salary is refused, not coerced — a string that looks like money is not money", () => {
  const r = reconcilePtoCashout({ annualGrossSalaryRemoteInteger: "6500000", liquidatedDays: 11 });
  assert.equal(r.computable, false, '"6500000" must not be silently divided by 100');
  assert.equal(r.totalRemoteInteger, null);
  assert.equal(r.unusable[0].reason, "not_an_integer");
  assert.equal(r.unusable[0].field, "annualGrossSalaryRemoteInteger");
});

test("F-29 c. an unknown day count is refused too — 0 accrued days is a claim, not an absence", () => {
  // The days side had the same absorption UC-05's `(Number(x) || 0)` had: an
  // absent count fell through `!liquidatedDays` and returned a confident 0
  // payout on a balance nobody had counted.
  const r = reconcilePtoCashout({ annualGrossSalaryRemoteInteger: 4400000, liquidatedDays: null });
  assert.equal(r.computable, false);
  assert.equal(r.totalRemoteInteger, null);
  assert.deepEqual(r.unusable.map((u) => u.field), ["liquidatedDays"]);

  // A REAL zero is still a real answer and stays computable.
  const zero = reconcilePtoCashout({ annualGrossSalaryRemoteInteger: 4400000, liquidatedDays: 0 });
  assert.equal(zero.computable, true);
  assert.equal(zero.totalRemoteInteger, 0);
});

test("F-29 d. the gate turns an underivable cashout into a flag on the dossier", () => {
  const f = evaluateRelocationFeasibility({
    destinationSupported: true,
    destinationEntityActive: true,
    ptoTransferAllowed: false,
    sourcePtoDays: 20,
    // annualGrossSalaryRemoteInteger deliberately absent — exactly what the
    // portal builds when the salary box is left blank.
  });
  assert.ok(
    f.flags.some((x) => x.code === FLAG.PTO_CASHOUT_NOT_COMPUTABLE),
    "an amount the dossier cannot state must be a flag, not a silent gap"
  );
  assert.equal(f.pto.cashout.computable, false);
  assert.equal(f.pto.cashout.totalRemoteInteger, null);

  // It must not be relabelled as, or outrank, a real statutory finding: a
  // below-minimum salary is still reported by the salary gate, and a HIGH flag
  // still BLOCKs.
  const blocked = evaluateRelocationFeasibility({
    destinationSupported: false, // HIGH
    destinationEntityActive: true,
    ptoTransferAllowed: false,
    sourcePtoDays: 20,
  });
  assert.equal(blocked.verdict, "BLOCK", "a data-quality flag must never soften an infeasibility verdict");
});

test("F-29 e. THE POINT: the request that used to vanish now lands a durable, audited escalate", async () => {
  const audit = new AuditLogger();
  const r = await handleRelocationReview(
    {
      text: "We're permanently relocating our engineer from Spain to the Netherlands.",
      employmentId: "emp_1",
      externalRef: "f29-uc07",
      source: "portal",
      plan: {
        destinationSupported: true,
        destinationEntityActive: true,
        managementFeeBasisPoints: 1200,
        ptoTransferAllowed: false,
        sourcePtoDays: 20,
        // no annualGrossSalaryRemoteInteger — the shape that threw
      },
    },
    { audit, classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );

  assert.equal(r.decision, "escalate");
  const entries = audit.forUseCase("UC-07");
  assert.equal(entries.length, 1, "the decision is DURABLE — pre-fix this threw and left zero rows");
  assert.ok(
    entries[0].details.flagCodes.includes(FLAG.PTO_CASHOUT_NOT_COMPUTABLE),
    "and the audit row names WHY, so the escalation is actionable"
  );

  // No invented money reaches the estimate: the cost calculator is honestly
  // INCOMPLETE rather than carrying a fabricated 0.00 PTO line.
  assert.equal(r.costEstimate.status, "INCOMPLETE");
  assert.ok(
    !(r.costEstimate.components ?? []).some((c) => c.key === "ptoCashout"),
    "a payout we could not derive must not appear as a line item at any value"
  );
});

test("gates: PTO cashout is derived from the ANNUAL gross salary, in ×100 integers", () => {
  // 26,400 EUR/YEAR ÷ 12 months ÷ 22 working days = 100.00/day exactly;
  // 11 days = 1,100.00 = 110000. Deliberately chosen to divide cleanly so the
  // pinned figure carries no rounding to argue about.
  //
  // THE FIGURE CHANGED WITH THE PERIOD FIX, THE INTENT DID NOT. This test used
  // to read 4,400,000 → 2,200,000 and describe it as "44,000 EUR/month ÷ 22
  // working days", which is the reading that made every cashout 12× too large.
  assert.equal(reconcilePtoCashout({ annualGrossSalaryRemoteInteger: 2640000, liquidatedDays: 11 }).totalRemoteInteger, 110000);
  // Liquidating a full month's working days equals one month's salary
  // (÷12 ÷22 ×22 collapses to annual/12).
  assert.equal(reconcilePtoCashout({ annualGrossSalaryRemoteInteger: 2640000, liquidatedDays: 22 }).totalRemoteInteger, 220000);

  // THE REGRESSION GUARD, with the real numbers from cli.js's seed 9003: a
  // €72,000/YEAR employee liquidating 15 days is owed €4,090.91. Reading that
  // annual figure as a monthly one — which is exactly what this function did
  // while its parameter was named `monthlySalaryRemoteInteger` — paid
  // €49,090.91, twelve times over, on a dossier a specialist settles against.
  assert.equal(reconcilePtoCashout({ annualGrossSalaryRemoteInteger: 7200000, liquidatedDays: 15 }).totalRemoteInteger, 409091);
  assert.notEqual(reconcilePtoCashout({ annualGrossSalaryRemoteInteger: 7200000, liquidatedDays: 15 }).totalRemoteInteger, 4909091);
});

// ---------------------------------------------------------------------------
// Relocation parsing (rule-based, always hermetic; and the LLM seam w/ retries)
// ---------------------------------------------------------------------------

test("parser: precedence distinguishes permanent relocation from workation/travel/address change (Build Pack Part 4)", () => {
  assert.equal(parseRelocationRuleBased({ text: "permanently relocating an employee from Spain to the Netherlands" }).relocationType, "permanent_relocation");
  assert.equal(parseRelocationRuleBased({ text: "she's working from Portugal for two weeks" }).relocationType, "temporary_workation");
  assert.equal(parseRelocationRuleBased({ text: "business trip to London for the conference" }).relocationType, "business_travel");
  assert.equal(parseRelocationRuleBased({ text: "moving to a new address in Madrid" }).relocationType, "address_change");
  assert.equal(parseRelocationRuleBased({ text: "what's my payslip balance?" }).relocationType, "other");
});

test("parser: countries and visa need are extracted from the text, source-tagged", () => {
  const r = parseRelocationRuleBased({ text: "We're permanently relocating our engineer from Spain to the Netherlands. We'll need visa support." });
  assert.equal(r.sourceCountry, "ES");
  assert.equal(r.destinationCountry, "NL");
  assert.equal(r.requiresVisa, true);
  assert.equal(r.relocationType, "permanent_relocation");
});

// ---------------------------------------------------------------------------
// The ticket-18 defect: substring country matching + dictionary-order slots.
// Reproduced live in n8n execution 4500 — the note posted to the real ticket
// read "Source country: DE; Destination country: FR" for a Portugal→Germany
// request, because "from" contains "fr" and "relocating" contains "ca", and the
// slots were filled by the order the dictionary literal happens to be typed in.
// A 🔴 dossier that states the wrong jurisdictions confidently is worse than
// one that says "not specified": the reviewer has no cue to doubt it.
// ---------------------------------------------------------------------------

test("parser: ticket 18 — 'relocating from Portugal to Germany' is PT → DE, and names no other country", () => {
  const r = parseRelocationRuleBased({ text: "Employee asks about permanently relocating from Portugal to Germany" });
  assert.equal(r.sourceCountry, "PT", "'from Portugal' is the source — dictionary order used to answer DE");
  assert.equal(r.destinationCountry, "DE", "'to Germany' is the destination — dictionary order used to answer FR");
});

test("parser: ordinary English words never conjure a country (fr/ca/de/pt/br as substrings)", () => {
  const r = parseRelocationRuleBased({
    text: "The request came from the team; we are relocating the desk of a resident contractor under the new policy.",
  });
  assert.equal(r.sourceCountry, null);
  assert.equal(r.destinationCountry, null);
  assert.deepEqual(r.mentionedCountries, [], "no country was named, so none may be reported");
});

test("parser: 'to Y from X' resolves the same route as 'from X to Y'", () => {
  const a = parseRelocationRuleBased({ text: "Permanent relocation from Brazil to Portugal next quarter." });
  const b = parseRelocationRuleBased({ text: "Permanent relocation to Portugal from Brazil next quarter." });
  assert.deepEqual([a.sourceCountry, a.destinationCountry], ["BR", "PT"]);
  assert.deepEqual([b.sourceCountry, b.destinationCountry], ["BR", "PT"]);
});

test("parser: an ambiguous pair yields null countries plus a stated reason, never a guess", () => {
  const r = parseRelocationRuleBased({ text: "Relocation question involving Portugal and Germany." });
  assert.equal(r.sourceCountry, null);
  assert.equal(r.destinationCountry, null);
  assert.equal(r.countryExtractionReason, "no_directional_cue");
  assert.deepEqual(r.mentionedCountries, ["PT", "DE"], "the reviewer still sees which countries were named");
});

test("gates: countries that could not be determined are a flag, not a silent null", () => {
  const withCountries = evaluateRelocationFeasibility({ sourceCountry: "PT", destinationCountry: "DE" });
  assert.ok(
    !withCountries.flags.some((f) => f.code === FLAG.COUNTRIES_NOT_DETERMINED),
    "a resolved route raises no country flag"
  );

  const without = evaluateRelocationFeasibility({ sourceCountry: null, destinationCountry: null });
  const flag = without.flags.find((f) => f.code === FLAG.COUNTRIES_NOT_DETERMINED);
  assert.ok(flag, "an unresolved route must be surfaced the same way a missing timeline is");
  assert.equal(flag.severity, SEVERITY.MEDIUM);
  assert.match(flag.message, /could not be determined/i);
});

test("workflow: an ambiguous request escalates with the country flag, and the narrative says so", async () => {
  const r = await run({ text: "We have a relocation question involving Portugal and Germany.", externalRef: "t-07-ambig" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.sourceCountry, null);
  assert.equal(r.dossier.destinationCountry, null);
  assert.ok(r.dossier.flags.some((f) => f.code === FLAG.COUNTRIES_NOT_DETERMINED));

  // What the specialist actually reads. "not identified" sends a reviewer to
  // look; a confident "DE" does not — which is the whole harm of the defect.
  //
  // The WORDING moved when the narrative was rewritten out of the gates'
  // vocabulary and into a reader's ("Source country not identified." became a
  // sentence naming both halves), and the LIMIT did not: both are still stated,
  // both are still attributed to the request rather than to this system, and
  // neither is softened. `test/dossierNarrativeProse.test.js` pins the three
  // partial cases — one country known, the other not, either way round — which
  // this test never covered.
  const { narrative } = await draftNarrative(
    { relocationType: "permanent_relocation", sourceCountry: null, destinationCountry: null, verdict: "REVIEW", flags: [], citations: [] },
    { isConfigured: () => false }
  );
  assert.match(narrative, /Neither the country the employee is moving from nor the destination country was identified in the request/);
  // And nothing invented one anyway.
  assert.doesNotMatch(narrative, /\bDE\b|\bPT\b|Germany|Portugal/);
});

test("parser: the LLM path validates shape, tags source 'llm', and promotes requiresVisa to immigrationSupportRequired", async () => {
  const r = await parseRelocation(
    { text: "permanent move to Germany" },
    {
      isConfigured: () => true,
      askJson: async () => ({ relocationType: "permanent_relocation", sourceCountry: "FR", destinationCountry: "DE", requiresVisa: true }),
    }
  );
  assert.equal(r.source, "llm");
  assert.equal(r.relocationType, "permanent_relocation");
  assert.equal(r.immigrationSupportRequired, true);
});

test("parser: an invalid LLM shape falls back to rules (source-tagged), never leaks the bad parse", async () => {
  const r = await parseRelocation(
    { text: "We're permanently relocating to Germany." },
    // backoff: async () => {} — an invalid shape retries 3x same as a thrown
    // error (§4 invariant 10), so without a fast fake this test pays
    // withRetry()'s real 200ms+400ms=600ms backoff for nothing. Same fix as
    // the sibling test below, which already injects one.
    { isConfigured: () => true, askJson: async () => ({ nonsense: true }), backoff: async () => {} }
  );
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(r.relocationType, "permanent_relocation");
});

test("parser: a failing LLM call is retried 3× with a trace step each, then falls back (invariants 7/10)", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const r = await parseRelocation(
    { text: "permanent relocation to the Netherlands" },
    {
      isConfigured: () => true,
      askJson: async () => { attempts += 1; throw new Error("connection refused"); },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(attempts, 3, "3 attempts before the fallback (§4 invariant 10)");
  const traces = audit.entries.filter((e) => e.call === "relocationParser.askJson");
  assert.equal(traces.length, 3, "every attempt is visible in the trace (§4 invariant 7)");
  assert.ok(traces.every((t) => t.ok === false));
});

// ---------------------------------------------------------------------------
// Embedding-similarity retrieval (issue #29's pattern, fake embed/vectors only)
// ---------------------------------------------------------------------------

const fakeStoredVectors = [
  { id: "mobility-transition-safety", title: "Country transfer", summary: "destination ready then exit", embedding: [1, 0, 0] },
  { id: "mobility-immigration-guidance", title: "Immigration vs employment", summary: "separate concepts", embedding: [0.6, 0.8, 0] },
  { id: "mobility-pe-risk", title: "PE exposure", summary: "corporate presence", embedding: [0, 0, 1] },
];

test("retriever: embedding similarity ranks passages and states the match plainly, never a percentage", async () => {
  const retriever = new MobilityRetriever({
    corpus: fakeStoredVectors,
    threshold: EMBEDDING_MATCH_THRESHOLD,
    embed: () => [1, 0, 0], // nearest to transition-safety (cos 1.0), immigration above threshold (cos 0.6)
  });
  const citations = await retriever.retrieveMobilityGuidance("safe to offboard the source employment?");
  assert.deepEqual(citations.map((c) => c.id), ["mobility-transition-safety", "mobility-immigration-guidance"]);
  assert.match(citations[0].matchedOn[0], /embedding similarity/);
  assert.match(citations[0].matchedOn[0], /ranked 1 of 2/);
  assert.ok(!citations[0].matchedOn[0].includes("%"), "never an invented precision score in the match reason");
});

test("retriever: below-threshold matches are dropped — no invented citations", async () => {
  const strict = new MobilityRetriever({
    corpus: fakeStoredVectors,
    threshold: 0.85,
    embed: () => [0.6, 0.8, 0], // only immigration (cos 1.0) clears 0.85
  });
  const citations = await strict.retrieveMobilityGuidance("immigration status vs employment status");
  assert.deepEqual(citations.map((c) => c.id), ["mobility-immigration-guidance"]);
});

test("retriever: stored vectors can come from a pgPool query (the documented table schema)", async () => {
  const queries = [];
  const pg = {
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: fakeStoredVectors.map(({ id, title, summary, embedding }) => ({
          id, title, summary, embedding: JSON.stringify(embedding),
        })),
      };
    },
  };
  const retriever = new MobilityRetriever({ pgPool: pg, embed: () => [1, 0, 0] });
  const citations = await retriever.retrieveMobilityGuidance("transition safety");
  assert.deepEqual(citations.map((c) => c.id), ["mobility-transition-safety", "mobility-immigration-guidance"]);
  assert.ok(queries.some((sql) => sql.includes("uc07_mobility_citation_vectors")), "retriever reads from the pgvector table");
});

test("retriever: an embed function with no stored vectors degrades to keyword fallback, never fails", async () => {
  const retriever = new MobilityRetriever({ embed: () => [1, 0, 0] }); // default corpus, no embeddings
  const citations = await retriever.retrieveMobilityGuidance("PTO will be liquidated on exit");
  assert.ok(citations.some((c) => c.id === "mobility-pto-portability"));
});

test("cosineSimilarity is pure and bounded", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(cosineSimilarity([0, 0, 0], [1, 0, 0]), 0);
});

// ---------------------------------------------------------------------------
// Dossier persistence — write-once, read-only lookup (never a mutation)
// ---------------------------------------------------------------------------

test("7. with no dossierStore, dossierId is null and nothing is persisted (the default, hermetic path)", async () => {
  const r = await run();
  assert.equal(r.dossierId, null);
});

test("7b. with a dossierStore, the dossier is persisted and findable by externalRef and id", async () => {
  const dossierStore = new DossierStore();
  const r = await handleRelocationReview(
    // Both ends of the route stated: an unstated SOURCE is now a real flag
    // (UC07_COUNTRIES_NOT_DETERMINED → REVIEW), and this test is about
    // persistence, not about a half-described relocation.
    { text: "We're permanently relocating an employee from Spain to the Netherlands.", externalRef: "t-42", plan: FEASIBLE_PLAN },
    { audit: new AuditLogger(), dossierStore, classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  assert.ok(r.dossierId);
  const found = await dossierStore.findByExternalRef("t-42");
  assert.equal(found.id, r.dossierId);
  assert.equal(found.relocationType, "permanent_relocation");
  assert.equal(found.dossier.verdict, "PROCEED");
});

test("7c. the store's write surface is exactly one method — no mutation could ever be added by mistake", () => {
  const store = new DossierStore();
  assert.equal(typeof store.createDossier, "function");
  for (const mutator of ["approve", "deny", "markExecuted", "updateStatus", "setReviewed"]) {
    assert.equal(typeof store[mutator], "undefined", `dossierStore must have no ${mutator} method — UC-07 is write-once`);
  }
});

// ---------------------------------------------------------------------------
// draftNarrative's retry wiring (invariants 7/10) — fake askJson only
// ---------------------------------------------------------------------------

test("draftNarrative retries a failing LLM call before falling back to the template", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const r = await draftNarrative(
    { relocationType: "permanent_relocation", sourceCountry: "ES", destinationCountry: "NL", verdict: "PROCEED", flags: [], citations: [] },
    {
      isConfigured: () => true,
      askJson: async () => { attempts += 1; throw new Error("connection refused"); },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "template");
  assert.equal(attempts, 3);
  const traces = audit.entries.filter((e) => e.call === "dossierBuilder.draftNarrative");
  assert.equal(traces.length, 3);
});

// ---------------------------------------------------------------------------
// F-37 — the cost estimate's headline was one month of a twelve-month term
// ---------------------------------------------------------------------------
// Found by reading the portal's own seeded "Portugal → Netherlands" scenario on
// screen: "COST ESTIMATE 7,800.00 EUR known over 12 months". 7,800 is one
// month's management fee on a 65,000 salary at 12%. The twelve-month figure —
// 93,600 — was already being computed as `lifetimeMonthlyFeesRemoteInteger` and
// then read by nothing at all, anywhere in the repository.
//
// UC-07's dossier is the whole deliverable and its reader is a Mobility Legal
// Tier-3 specialist deciding whether a relocation is affordable. Handing them a
// number twelve times too small, under the larger period's label, is the
// clearest possible version of the wrong-money failure this project forbids.

test("F-37: the term total covers the whole term, not one month of it", async () => {
  const r = await runCostCalculator(
    {
      // 65,000.00 ×100 — the same figure this test always used, now passed as
      // what it always was: an ANNUAL gross salary. The expected FIGURES below
      // moved with the period (a 12% fee on 65,000/yr is 650.00 a month, not
      // 7,800.00 a month); the INTENT — a term total that is not one month of
      // the term — is unchanged and is what the last assertion still pins.
      annualGrossSalaryRemoteInteger: 6500000,
      currency: "EUR",
      months: 12,
      managementFeeBasisPoints: 1200, // 12%
    },
    { delay: async () => {} }
  );
  const e = r.estimate;
  assert.equal(e.annualFeeRemoteInteger, 780000, "12% of 65,000.00/yr is 7,800.00 a YEAR");
  assert.equal(e.monthlyFeeRemoteInteger, 65000, "7,800.00 / 12 = 650.00 a month");
  assert.equal(e.knownTotalRemoteInteger, 65000, "the per-month view is unchanged and still offered");
  assert.equal(e.lifetimeMonthlyFeesRemoteInteger, 780000, "650.00 × 12 = 7,800.00");
  assert.equal(
    e.knownTermTotalRemoteInteger,
    780000,
    "the term total is the number a specialist is actually asking for"
  );
  assert.equal(e.knownTermTotalDisplay, "7,800.00 EUR");
  assert.notEqual(
    e.knownTermTotalRemoteInteger,
    e.knownTotalRemoteInteger,
    "if these were equal the mislabel would be invisible again"
  );
});

test("F-37: one-off components are counted ONCE in the term total, recurring ones every month", async () => {
  // The distinction that makes the term total correct rather than merely
  // bigger: multiplying a one-off transfer fee by the contract length would be
  // the same class of error in the opposite direction.
  const r = await runCostCalculator(
    {
      // 120,000.00/yr at 10% = 12,000.00/yr = 1,000.00/month — deliberately the
      // same monthly fee this test used before the period fix, so the expected
      // term total below is unchanged and only the input's period moved.
      annualGrossSalaryRemoteInteger: 12000000,
      currency: "EUR",
      months: 10,
      managementFeeBasisPoints: 1000, // 10% -> 1,000.00/month
      transferFeeRemoteInteger: 250000, // 2,500.00 one-off, from a quote
      ptoCashoutRemoteInteger: 100000, // 1,000.00 one-off
    },
    { delay: async () => {} }
  );
  const e = r.estimate;
  // 1,000.00 × 10 months = 10,000.00, plus 2,500.00 + 1,000.00 one-offs.
  assert.equal(e.knownTermTotalRemoteInteger, 1000000 + 250000 + 100000);
  assert.deepEqual(e.pendingQuotes, ["mobilityFee"], "the transfer fee was quoted; only mobility is still pending");
});

test("F-37: an INCOMPLETE estimate reports no total at all, never 0.00", async () => {
  // These two fields used to hold `0` and the string "0.00 USD" on the
  // no-salary branch. Printed beside status INCOMPLETE that reads as a
  // relocation costing nothing, and the currency suffix made it look derived
  // rather than placeholder. Inventing money is the one thing forbidden
  // outright, and a sum of nothing known is not zero money — it is no answer.
  const r = await runCostCalculator(
    { annualGrossSalaryRemoteInteger: null, currency: "EUR", months: 12, managementFeeBasisPoints: 1200 },
    { delay: async () => {} }
  );
  assert.equal(r.estimate.status, "INCOMPLETE");
  assert.equal(r.estimate.knownTotalRemoteInteger, null);
  assert.equal(r.estimate.knownTotalDisplay, null);
  assert.equal(r.estimate.knownTermTotalRemoteInteger, null);
  assert.equal(r.estimate.knownTermTotalDisplay, null);
  // …and every component is still named as pending input, so the absence is
  // itemised rather than merely blank.
  assert.deepEqual(r.estimate.pendingQuotes, ["monthlyManagementFee", "eorTransferFee", "mobilityFee"]);
});

test("F-37: an absent quote stays QUOTE_REQUIRED and contributes nothing to either total", async () => {
  // The honesty marker the spec names. A missing quote is excluded from the
  // totals AND labelled, so the number cannot be mistaken for the whole cost.
  const r = await runCostCalculator(
    {
      annualGrossSalaryRemoteInteger: 6500000,
      currency: "EUR",
      months: 1,
      managementFeeBasisPoints: 1200,
    },
    { delay: async () => {} }
  );
  const quoted = r.estimate.components.filter((c) => c.status === "QUOTE_REQUIRED");
  assert.deepEqual(quoted.map((c) => c.key), ["eorTransferFee", "mobilityFee"]);
  assert.equal(
    r.estimate.knownTermTotalRemoteInteger,
    65000,
    "one month, one month's fee (650.00 on a 65,000/yr salary) — the quoted components add nothing"
  );
});

// ---------------------------------------------------------------------------
// F-38 — the no-execution-path guarantee was asserted by BLOCKLIST
// ---------------------------------------------------------------------------
// UC-07.md §160 claims "no POST/PUT/PATCH/DELETE anywhere in the file" and
// "DossierStore was independently enumerated … no mutation method exists at
// all". Neither claim was tested. The server test asserted only the absence of
// the literal `"POST"`, so a PATCH or DELETE route would have passed every
// test; the store test named five forbidden mutators, so a sixth — `linkTicket`
// is the obvious one, src/portal/ticketing.js's header worries about exactly
// that method by name — would have passed too.
//
// A structural guarantee is only worth what its assertion covers. These two
// close it to an ALLOW-LIST: the surface must be exactly what is enumerated,
// so anything new fails until someone deliberately widens the list.

test("F-38: dossierStore's method surface is exactly the enumerated read/write set", () => {
  const store = new DossierStore();
  const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(store))
    .filter((n) => n !== "constructor")
    .sort();
  assert.deepEqual(
    surface,
    // `listByOwner` was ADDED HERE DELIBERATELY, which is the whole point of an
    // allow-list: the portal's "My requests" needed to find a requester's own
    // dossiers from the durable store, and this test refused to let that ship
    // silently. It is a READ — no id to act on, no mutation, no new
    // write-capable dependency — so the "one write method, zero mutations"
    // guarantee is unchanged; see the method's own header for the full
    // argument. The next method to appear here has to earn the same sentence.
    ["createDossier", "findByExternalRef", "findById", "flush", "list", "listByOwner"],
    "UC-07's store is write-once: ONE write method, the rest reads. A new method here " +
      "is either a mutation (which must not exist) or a read (which must be added to " +
      "this list deliberately, not discovered later)."
  );
});

test("F-38: uc07/server.js offers no write verb of ANY kind, not merely no POST", () => {
  const fullSource = readFileSync(join(__dirname, "..", "src", "uc07", "server.js"), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(
      !new RegExp(`["'\`]${verb}["'\`]`).test(code),
      `server.js must contain no ${verb} route — the API layer can never become an execution path`
    );
  }
  assert.ok(code.includes("GET, OPTIONS"), "CORS advertises exactly what exists: read + preflight");
});

test("F-38: handleRelocationReview's own parameter list admits no write-capable client", () => {
  // The strongest form of the guarantee is that there is no PARAMETER through
  // which a RemoteClient or ZendeskClient could arrive — not a runtime refusal
  // that could be bypassed by a bug. Asserted against the real signature rather
  // than a comment claiming it.
  const fullSource = readFileSync(join(__dirname, "..", "src", "uc07", "workflow.js"), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const signature = /export async function handleRelocationReview\s*\(([\s\S]*?)\n\)/.exec(code);
  assert.ok(signature, "the workflow's signature must be readable — if this fails, re-read the file, do not delete the test");
  for (const forbidden of ["remote", "zendesk"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`, "i").test(signature[1]),
      `handleRelocationReview must take no ${forbidden} dependency — found it in the parameter list`
    );
  }
});

// ---------------------------------------------------------------------------
// F-39 — a dossier nobody could find
// ---------------------------------------------------------------------------

test("F-39: list() reads the durable store, so a dossier is findable without knowing its id", async () => {
  // UC-07 raises no Zendesk ticket by design (src/portal/ticketing.js), so
  // `by-ticket` cannot be used, and `findById` needs an id only the submitter
  // ever saw. `list()` was the last remaining route to a dossier and it read
  // this process's memory only — which on a serverless deployment lasts exactly
  // one request. The dossier was compiled, audited, durably stored, and
  // unreachable by the specialist it was compiled for.
  const rows = [];
  const fakePool = {
    query: async (sql, params) => {
      if (/^\s*insert/i.test(sql)) return { rows: [] };
      assert.match(sql, /order by created_at desc/i, "the queue is newest-first");
      assert.deepEqual(params, [200], "and bounded, so a growing table is not an unbounded response");
      return { rows };
    },
  };
  const store = new DossierStore({ pgPool: fakePool });
  rows.push({
    id: "d-from-postgres",
    createdAt: "2026-08-19T00:00:00.000Z",
    externalRef: "7001",
    relocationType: "permanent_relocation",
    sourceCountry: "PT",
    destinationCountry: "NL",
    dossier: JSON.stringify({ verdict: "PROCEED" }),
  });

  const listed = await store.list();
  assert.equal(listed.length, 1, "a row this process never created is still listed");
  assert.equal(listed[0].id, "d-from-postgres");
  assert.deepEqual(listed[0].dossier, { verdict: "PROCEED" }, "jsonb handed back as a string is still coerced");
});

test("F-39: with no pool attached list() still returns this process's own rows, newest first", async () => {
  // A credential-free clone must keep working — the same in-memory-first
  // pattern every other store in this repo uses.
  const store = new DossierStore();
  store.createDossier({ externalRef: "a", relocationType: "permanent_relocation", sourceCountry: "PT", destinationCountry: "NL", dossier: {} });
  store.createDossier({ externalRef: "b", relocationType: "permanent_relocation", sourceCountry: "PT", destinationCountry: "DE", dossier: {} });
  const listed = await store.list();
  assert.deepEqual(listed.map((d) => d.externalRef), ["b", "a"]);
});

// ---------------------------------------------------------------------------
// F-40 — "PRESERVED" with no date to preserve from
// ---------------------------------------------------------------------------
// evaluateSeniority() was already fixed once to thread `originalHireDate` through
// "so a PRESERVED verdict can report an actual date rather than null". No caller
// ever supplied it: UC07_PLAN_DEFAULTS did not carry it, the portal form had no
// box for it, and the n8n port passes a hardcoded null. So every PROCEED dossier
// said `seniority: {status: "PRESERVED", seniorityDate: null}` and the portal
// printed the status alone — the specialist read "PRESERVED" and had no way to
// see the date was missing.
//
// It matters because the date IS the verdict's substance: statutory notice,
// severance and vesting are all counted from it. Preserved-from-nothing is not
// an answer a Mobility Legal specialist can act on.

test("F-40 POSITIVE: a supplied hire date reaches the dossier and IS the preserved seniority date", async () => {
  const audit = new AuditLogger();
  const r = await handleRelocationReview(
    { text: "Permanent relocation from Portugal to the Netherlands.", plan: { seniorityPreservable: true, originalHireDate: "2019-06-03" } },
    { audit, classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  assert.equal(r.dossier.seniority.status, "PRESERVED");
  assert.equal(r.dossier.seniority.seniorityDate, "2019-06-03", "the real date, threaded end to end");
});

test("F-40: PRESERVED with no hire date says so in words instead of a silent null", () => {
  const withDate = evaluateSeniority({ originalHireDate: "2019-06-03", destinationStartDate: "2026-07-01", preservable: true });
  assert.equal(withDate.seniorityDate, "2019-06-03");

  const without = evaluateSeniority({ originalHireDate: undefined, destinationStartDate: "2026-07-01", preservable: true });
  assert.equal(without.status, "PRESERVED", "the legal verdict is unchanged — it is what the caller told us");
  assert.equal(without.seniorityDate, null);
  assert.match(
    without.reason,
    /original hire date was not supplied/i,
    "the gap has to be legible in the dossier, not inferable from a null nobody prints"
  );
});

test("F-40: the other two seniority verdicts are untouched", () => {
  const reset = evaluateSeniority({ originalHireDate: "2019-06-03", destinationStartDate: "2026-07-01", preservable: false });
  assert.equal(reset.status, "RESET");
  assert.equal(reset.seniorityDate, "2026-07-01");

  const unknown = evaluateSeniority({ originalHireDate: "2019-06-03", destinationStartDate: "2026-07-01", preservable: null });
  assert.equal(unknown.status, "REQUIRES_LEGAL_REVIEW", "unknown routes to review, never to 'resets'");
  assert.equal(unknown.seniorityDate, null);
});

// ---------------------------------------------------------------------------
// THE DOSSIER AS THE PRODUCT — ranked for the reader, and its holes named
// ---------------------------------------------------------------------------
// Reader: a Mobility Legal Tier-3 specialist. Decision: is this relocation safe
// to attempt, and what must be settled first. UC-07 has no execution path, so
// the dossier IS the deliverable.
//
// What was missing was never a FACT — it was an ORDER and a list of absences.
// Sixteen sections, flat; a bare `uncertainty: 0.6`; and every hole recorded
// under a different key with a different spelling of "we could not establish
// this", so a specialist had to go looking for absences. Nobody does.
// ---------------------------------------------------------------------------

test("explainUncertainty takes the score apart instead of reporting a bare number", () => {
  const flags = [
    { code: "A", severity: SEVERITY.HIGH },
    { code: "B", severity: SEVERITY.MEDIUM },
    { code: "C", severity: SEVERITY.LOW },
  ];
  const explained = explainUncertainty(flags);

  assert.equal(explained.score, computeUncertaintyScore(flags), "the explanation must never disagree with the score");
  assert.equal(explained.rawTotal, 1);
  assert.equal(explained.capped, false);
  assert.deepEqual(explained.weights, { HIGH: 0.5, MEDIUM: 0.3, LOW: 0.2 });
  assert.deepEqual(
    explained.contributions.map((c) => [c.code, c.weight]),
    [["A", 0.5], ["B", 0.3], ["C", 0.2]]
  );
});

test("a capped uncertainty score says it is a floor, not a ceiling", () => {
  // Once the raw total passes 1 the score stops moving, so two plans reading
  // 1.0 can be a long way apart. A specialist reading 1.0 as "the maximum"
  // rather than "at least the maximum" is reading a floor as a ceiling.
  const flags = [
    { code: "A", severity: SEVERITY.HIGH },
    { code: "B", severity: SEVERITY.HIGH },
    { code: "C", severity: SEVERITY.HIGH },
  ];
  const explained = explainUncertainty(flags);
  assert.equal(explained.score, 1);
  assert.equal(explained.rawTotal, 1.5);
  assert.equal(explained.capped, true);
});

test("an unrecognised severity contributes the LOW weight, never zero", () => {
  // A flag nobody classified must not read as a flag that costs nothing —
  // that is the direction that quietly lowers an uncertainty score.
  const explained = explainUncertainty([{ code: "X", severity: "WHO_KNOWS" }]);
  assert.equal(explained.contributions[0].weight, 0.2);
  assert.equal(explained.score, 0.2);
});

test("POSITIVE: a clean plan produces a dossier view that says PROCEED is not an approval", async () => {
  // The positive half, deliberately: a 🔴 use case that structurally cannot
  // produce a complete dossier is indistinguishable from one being cautious.
  const result = await run();
  const view = describeDossier({
    sourceCountry: "PT",
    destinationCountry: "NL",
    dossier: result.dossier,
  });

  assert.equal(view.verdictSummary.verdict, "PROCEED");
  assert.equal(view.verdictSummary.blockerCount, 0);
  assert.equal(view.verdictSummary.reviewItemCount, 0);
  // NAMES, NOT CODES — the route a specialist orients by. The codes are still
  // on the row and on `routeKey`; this is the sentence they read.
  assert.match(view.verdictSummary.statement, /Portugal → Netherlands/);
  assert.ok(!/\bPT → NL\b/.test(view.verdictSummary.statement), "the route must not be printed as bare alpha-2 codes");
  assert.match(view.verdictSummary.statement, /NOT an approval/);
  assert.equal(view.uncertaintyBreakdown.score, 0);
});

test("blockers are separated from review items, by the severity the flags already carried", async () => {
  const result = await run({
    plan: {
      ...FEASIBLE_PLAN,
      destinationSupported: false, // HIGH
      taxTreatyNexusConfirmed: false, // MEDIUM
    },
  });
  const view = describeDossier({ dossier: result.dossier });

  assert.equal(view.verdictSummary.verdict, "BLOCK");
  assert.ok(view.blockers.length >= 1);
  assert.ok(view.blockers.every((f) => f.severity === "HIGH"));
  assert.ok(view.reviewItems.every((f) => f.severity !== "HIGH"));
  assert.ok(
    view.blockers.some((f) => f.code === FLAG.DESTINATION_COUNTRY_UNSUPPORTED),
    "the thing that stops the plan must be in the list titled 'what stops the plan'"
  );
  assert.match(view.verdictSummary.statement, /AS PROPOSED/);
});

test("an underivable PTO payout becomes a ranked open question that NAMES the missing field", async () => {
  // reconcilePtoCashout()'s `unusable[]` already names the field by its current
  // name — "an escalation naming a field that no longer exists sends a
  // specialist looking for nothing". It was recorded four levels deep in the
  // dossier and surfaced nowhere.
  const result = await run({
    plan: { ...FEASIBLE_PLAN, annualGrossSalaryRemoteInteger: undefined, ptoTransferAllowed: false, sourcePtoDays: 15 },
  });
  const view = describeDossier({ dossier: result.dossier });

  const question = view.openQuestions.find((q) => q.code === "pto_cashout_not_computable");
  assert.ok(question, "an underivable settlement figure is the first thing a specialist must chase");
  assert.equal(question.priority, 1);
  // The FIELD is named, as it always was — in the reader's words rather than in
  // this system's. A question a specialist skips is a question nobody answers.
  assert.match(question.question, /annual gross salary/);
  assert.match(question.question, /not supplied/);
  assert.ok(
    !/annualGrossSalaryRemoteInteger|not_an_integer/.test(question.question),
    "the missing input must be named in words, not by its identifier"
  );
  assert.equal(
    view.openQuestions[0].priority,
    1,
    "open questions are ranked by what the decision turns on, not by where they sit in the record"
  );
});

test("PRESERVED seniority with no date it is preserved FROM is an open question, not a quiet null", async () => {
  const result = await run({
    plan: { ...FEASIBLE_PLAN, seniorityPreservable: true, originalHireDate: undefined },
  });
  const view = describeDossier({ dossier: result.dossier });
  const question = view.openQuestions.find((q) => q.code === "seniority_date_missing");
  assert.ok(question, "statutory notice, severance and vesting are all counted from that date");
  assert.match(question.question, /notice, severance and vesting/);
});

test("an unauthorised offboarding sequence names every condition still outstanding", async () => {
  const result = await run({
    plan: { ...FEASIBLE_PLAN, sourceExitPlanValidated: false, rightToWorkConfirmed: false },
  });
  const view = describeDossier({ dossier: result.dossier });
  const question = view.openQuestions.find((q) => q.code === "source_offboarding_not_authorized");

  assert.ok(question);
  assert.equal(question.priority, 1);
  assert.match(question.question, /right to work in the destination is confirmed/);
  assert.match(question.question, /source exit plan has been validated/);
  assert.ok(
    !/right_to_work_confirmed|source_exit_plan_validated/.test(question.question),
    "each outstanding condition must be stated, not named by its flag"
  );
});

test("a partial cost estimate says what is still unquoted rather than letting the total read as complete", async () => {
  const result = await run(); // FEASIBLE_PLAN quotes the transfer fee but not the mobility fee
  const view = describeDossier({ dossier: result.dossier });
  const question = view.openQuestions.find((q) => q.code === "cost_quotes_pending");

  assert.ok(question, "a total that excludes an unquoted component must say so");
  // The estimate already carries a label for every component; the question uses
  // it rather than the key it is stored under.
  assert.match(question.question, /Mobility \/ visa support/);
  assert.ok(!/mobilityFee/.test(question.question), "an unquoted fee is named by its label, not its key");
  assert.match(question.question, /rather than counted as zero/);
});

// ---------------------------------------------------------------------------
// THE 🔴 GUARANTEE, RE-VERIFIED AGAINST THE NEW FILE
// ---------------------------------------------------------------------------

test("F-38 (extended): dossierView.js takes no write-capable dependency either", () => {
  // The allow-list discipline of the store test, applied to the new module: a
  // view that accepted a `remote` client would BE the execution path this tier
  // forbids, and no existing test looked at this file.
  const source = readFileSync(join(__dirname, "..", "src", "uc07", "dossierView.js"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["RemoteClient", "ZendeskClient", "createEmployment", "updateTicket", "post(", "patch("]) {
    assert.ok(!code.includes(forbidden), `dossierView.js must never reference ${forbidden}`);
  }
  assert.ok(!/\bimport\b[^\n]*\b(remote|zendesk)\b/i.test(code), "dossierView.js must import no client");
});

test("the dossier view is a pure read — a frozen row goes through it untouched", () => {
  const row = Object.freeze({
    sourceCountry: "PT",
    destinationCountry: "NL",
    dossier: Object.freeze({
      verdict: "REVIEW",
      flags: Object.freeze([Object.freeze({ code: "X", severity: "MEDIUM", message: "m" })]),
      requiredActions: Object.freeze([]),
      dateChecks: Object.freeze({}),
      transitionSafety: Object.freeze({}),
      pto: Object.freeze({}),
      costEstimate: Object.freeze({}),
      citations: Object.freeze([]),
    }),
  });
  const first = JSON.stringify(describeDossier(row));
  const second = JSON.stringify(describeDossier(row));
  assert.equal(first, second);
  assert.equal(describeDossier(row).reviewItems.length, 1);
});
