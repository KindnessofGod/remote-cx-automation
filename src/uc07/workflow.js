// ---------------------------------------------------------------------------
// workflow.js  —  UC-07 end to end: relocation request -> feasibility dossier
//                 -> escalate. NOTHING ELSE.
// ---------------------------------------------------------------------------
// WHY THIS FILE LOOKS DIFFERENT FROM UC-01'S AND UC-06'S
// This is the 🔴 high-tier use case, and CLAUDE.md's prime directive #2 is
// explicit: "No execution path may exist — assert this with a test." UC-01 and
// UC-06 take a `remote`/`zendesk` dependency because they eventually WRITE
// somewhere. This function takes NEITHER. There is no import of ZendeskClient
// or RemoteClient anywhere in this module, and no parameter through which one
// could be passed in. That is deliberate and is the strongest version of "no
// execution path": not a runtime check that might have a bug, but the absence
// of any write-capable object this code could ever call, even by accident.
// test/uc07.test.js asserts BOTH — the runtime behavior (decision is always
// "escalate") AND the static fact (grep the source for the absence of any
// write-shaped method name).
//
// SCOPE BOUNDARY, STATED HONESTLY. The Build Pack describes a full execution
// orchestrator (a Saga, a two-level state machine, webhook ingestion, UC-05
// offboarding handoffs). None of that exists here — and none of it should. A
// 🔴 use case has exactly one job in this architecture: compile the research
// dossier a Mobility Legal Tier-3 specialist needs, and stop. The post-review
// execution (create destination employment, offboard source) would be the
// execution path this project's own invariant forbids, so building it would be
// building the bug. What this file owns is the pre-execution feasibility
// review: request understanding (relocationParser), deterministic gates
// (transitionGate), the async cost estimate (costCalculator), cross-referenced
// mobility guidance (mobilityRetriever), and the LLM-drafted narrative
// (dossierBuilder). Every fact is computed or retrieved by deterministic code
// or a validated classifier; the one LLM-authored piece is display prose
// restating already-decided facts, never a source of new ones.
//
// `dossierStore` (optional) does NOT weaken the no-execution-path guarantee:
// it's a plain record of what was already decided and audited, the same
// relationship AuditLogger has to this workflow. dossierStore.js itself has
// exactly one write method and zero mutation methods — there is nothing to
// call on it that could ever change a real record anywhere.
// ---------------------------------------------------------------------------

import { classifyRisk } from "../shared/riskEngine.js";
import { parseRelocation } from "./relocationParser.js";
import { evaluateRelocationFeasibility } from "./transitionGate.js";
import { runCostCalculator } from "./costCalculator.js";
import { retrieveMobilityGuidance } from "./mobilityRetriever.js";
import { draftNarrative, buildDossier } from "./dossierBuilder.js";
import { judgeNarrative } from "../shared/narrativeJudge.js";

import { claimExternalRef } from "../shared/workflowClaims.js";

/**
 * @param {object} ticket
 * @param {string} ticket.text                     the relocation request text
 * @param {string} [ticket.employmentId]
 * @param {string} [ticket.externalRef]
 * @param {string} [ticket.source]
 * @param {object} [ticket.plan]                   the structured relocation plan the gates
 *   evaluate (availability, entity, salary, dates, right-to-work, PTO, seniority).
 *   These are facts already resolved from Remote reads / the request, kept as
 *   structured input exactly like UC-08's presencePeriods.
 * @param {object} deps
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./dossierStore.js").DossierStore} [deps.dossierStore]  optional — persists
 *   the dossier for later lookup, never for execution
 * @param {Function} [deps.classify]  override for tests — defaults to the real parseRelocation()
 * @param {object} [deps.mobilityRetriever]  optional — a configured MobilityRetriever (e.g.
 *   one with a real pgPool + embed); defaults to the module-level retrieveMobilityGuidance(),
 *   which is keyword fallback until configured
 * @param {typeof runCostCalculator} [deps.costCalculator]  override for tests — defaults to
 *   the real runCostCalculator() with its no-op poll delay
 * @param {typeof draftNarrative} [deps.draftNarrative]  override for tests — defaults to the
 *   real draftNarrative() so production is unaffected; injectable so a test never makes a
 *   real, retried LLM call just because OPENAI_API_KEY happens to be set
 * @param {typeof judgeNarrative} [deps.judge]  scoped faithfulness judge for the drafted
 *   narrative. PURELY INFORMATIONAL: the verdict is attached to the dossier for a Mobility
 *   specialist to see and is NEVER read by any gate, route, or policy. Defaults to the real
 *   judgeNarrative() — inject a fake in tests that don't care about it.
 * @returns {Promise<{decision:"escalate", dossier:object, costEstimate:object, dossierId:string|null}>}
 */
export async function handleRelocationReview(
  ticket,
  {
    audit,
    dossierStore = null,
    classify = parseRelocation,
    mobilityRetriever = null,
    costCalculator = runCostCalculator,
    draftNarrative: draftNarrativeFn = draftNarrative,
    judge = judgeNarrative,
  } = {}
) {
  const {
    text = "",
    employmentId = null,
    externalRef = null,
    source = null,
    plan = {},
  } = ticket;

  const parsed = await classify({ text });

  // Deterministic gates over the structured plan. `feasibility.verdict` is a
  // pre-execution assessment the specialist weighs — it is NOT an execution
  // decision, and nothing in this file (or the GET-only API in front of it)
  // can act on it even if a future bug tried.
  //
  // The parser's request-level `immigrationSupportRequired` feeds the gates
  // here (a "needs visa support" request must surface IMMIGRATION_REQUIRED),
  // but the plan's own structured field wins when present — a resolved fact
  // from the request is authoritative over the classifier's description of it.

  // The route, resolved ONCE and used everywhere below — the gate, the
  // narrative, the faithfulness check, the dossier, the audit row and the
  // stored record. Same precedence as immigration support: a structured fact
  // from the intake wins over the classifier's reading of the prose. When
  // neither resolves a route these stay null, the gate raises
  // UC07_COUNTRIES_NOT_DETERMINED, and the narrative prints "not identified" —
  // which is what sends a specialist to check, instead of a confident wrong
  // jurisdiction that gives them no reason to.
  const sourceCountry = plan.sourceCountry ?? parsed.sourceCountry ?? null;
  const destinationCountry = plan.destinationCountry ?? parsed.destinationCountry ?? null;

  const feasibility = evaluateRelocationFeasibility({
    relocationType: parsed.relocationType,
    ...plan,
    immigrationSupportRequired: plan.immigrationSupportRequired ?? parsed.immigrationSupportRequired,
    sourceCountry,
    destinationCountry,
  });

  // The cost estimate. The PTO cashout is taken from the gate's own
  // liquidation decision rather than recomputed here: this line used to run its
  // own copy of the arithmetic and, with an absent salary, threw NaN out of
  // money.js — ~90 lines BEFORE the audit.log() call below, so the whole
  // request vanished leaving no dossier and no audit row (F-29, the same class
  // as UC-05's F-28). It is now `null` when the gate could not derive it, which
  // runCostCalculator already handles honestly: `null > 0` is false, so no PTO
  // line is added at any value, and the estimate reports its components without
  // a fabricated 0.00.
  //
  // `plan.annualGrossSalaryRemoteInteger` is ANNUAL gross in ×100 integers,
  // named after Remote's own `annual_gross_salary` field. The cost calculator
  // below takes it in that period explicitly; it used to take a parameter named
  // `monthlySalaryRemoteInteger` fed from this same annual value, which made
  // every figure derived from it 12× too large (costCalculator.js's header has
  // the worked numbers). The two fixes are independent and both are live here:
  // the gate refuses to invent a cashout it cannot derive, and the figure it
  // DOES derive is now in the right period.
  const ptoCashoutRemoteInteger = feasibility.pto.cashout.totalRemoteInteger;
  const costEstimate = await costCalculator({
    annualGrossSalaryRemoteInteger: plan.annualGrossSalaryRemoteInteger,
    // NOT `?? "USD"`. A blank currency box used to become "USD" here, and
    // every total downstream then printed a denomination nobody supplied, as
    // though it had been derived. costCalculator.js's own header forbids
    // exactly this for the transfer fee — "the currency string made it read as
    // a derived figure rather than a placeholder" — and this line was doing it
    // one module earlier for every figure at once. Null, so the absence is
    // stated where it is rendered rather than invented here.
    currency: plan.currency ?? null,
    months: plan.months ?? 12,
    managementFeeBasisPoints: plan.managementFeeBasisPoints ?? 1200,
    transferFeeRemoteInteger: plan.transferFeeRemoteInteger ?? null,
    mobilityFeeRemoteInteger: plan.mobilityFeeRemoteInteger ?? null,
    ptoCashoutRemoteInteger,
  });

  const citations = await (mobilityRetriever
    ? mobilityRetriever.retrieveMobilityGuidance([text, parsed.relocationType].join(" "))
    : retrieveMobilityGuidance([text, parsed.relocationType].join(" ")));

  const { narrative } = await draftNarrativeFn(
    {
      relocationType: parsed.relocationType,
      sourceCountry,
      destinationCountry,
      verdict: feasibility.verdict,
      flags: feasibility.flags,
      citations,
    },
    { audit }
  );

  // Faithfulness of that drafted narrative to the structured facts it was
  // drafted from. Attached for the specialist to see — never consumed by any
  // gate, never alters the always-escalate decision. Returns
  // {verdict:"not_evaluated"} when unconfigured (the hermetic `npm test`
  // default — no OPENAI_API_KEY), so absence is an explicit state, never a
  // fabricated positive OR negative verdict.
  const faithfulness = await judge({
    narrative,
    structuredInputs: {
      relocationType: parsed.relocationType,
      sourceCountry,
      destinationCountry,
      verdict: feasibility.verdict,
      flags: feasibility.flags.map((f) => f.code),
      citations: citations.map((c) => ({ id: c.id, title: c.title })),
    },
  });

  const dossier = buildDossier({
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
    faithfulness,
  });

  const { tier } = classifyRisk("UC-07", []); // always "high" — no flag can lower it

  // The ONLY thing this workflow ever does with its outcome is log it,
  // optionally record it for later lookup, and return it. There is no branch,
  // anywhere in this file, that leads anywhere else — that is the point of a
  // 🔴 use case. Audit detail mirrors docs/use-cases/UC-07.md §10.
  // DELIVERY-LEVEL IDEMPOTENCY. This use case has NO execution path, so a
  // duplicate delivery cannot double-act on a customer — but it can write a
  // second audit row and a second dossier for one request, and the audit log is
  // the artifact this tier exists to produce. A clean record is the deliverable.
  const claim = await claimExternalRef({
    pgPool: dossierStore?.pgPool ?? null,
    useCase: "UC-07",
    externalRef,
    decision: "escalate",
  });
  if (!claim.claimed) {
    return { decision: "escalate", duplicate: true, duplicateOf: externalRef, dossierId: null };
  }

  audit.log({
    useCase: "UC-07",
    action: "escalate",
    actor: employmentId ?? "unauthenticated",
    riskTier: tier,
    details: {
      externalRef,
      source,
      relocationType: parsed.relocationType,
      sourceCountry,
      destinationCountry,
      parseSource: parsed.source,
      // HOW the route was reached, not just what it was: "directional_cues",
      // "no_directional_cue", "llm_extraction"… An audit row that records only
      // the answer cannot tell a reviewer whether it was read or guessed.
      countryExtractionReason: parsed.countryExtractionReason ?? null,
      mentionedCountries: parsed.mentionedCountries ?? [],
      verdict: feasibility.verdict,
      flagCodes: feasibility.flags.map((f) => f.code),
      uncertainty: feasibility.uncertainty,
      costCalculatorRef: costEstimate.ref,
      citationIds: citations.map((c) => c.id),
      disclaimerApplied: true,
    },
  });

  const dossierRow = dossierStore
    ? dossierStore.createDossier({
        employmentId,
        externalRef,
        source,
        relocationType: parsed.relocationType,
        sourceCountry,
        destinationCountry,
        dossier,
      })
    : null;

  return { decision: "escalate", dossier, costEstimate: costEstimate.estimate, dossierId: dossierRow?.id ?? null };
}
