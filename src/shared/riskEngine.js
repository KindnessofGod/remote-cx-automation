// ---------------------------------------------------------------------------
// riskEngine.js  —  Risk tier classifier (decides how much automation is allowed)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The whole portfolio rests on one idea: not every request should be automated
// the same way. We sort every case into one of three tiers, and the tier
// decides the execution path:
//
//   low    -> zero-touch: validate then auto-execute
//   medium -> HITL: prepare + score, a human approves in the Zendesk sidebar
//   high   -> safe escalation: compile a dossier, never auto-execute
//
// The mapping below is deterministic and comes straight from the coherency map.
// This is intentionally simple and rule-based: risk classification must be
// predictable and explainable, not something an LLM guesses at.
// ---------------------------------------------------------------------------

/** Static base tier for each use case (from 01-COHERENCY-MAP.md). */
export const USE_CASE_TIERS = {
  "UC-01": "low",
  "UC-02": "low",
  "UC-03": "low",
  "UC-04": "medium",
  "UC-05": "medium",
  "UC-06": "medium",
  "UC-07": "high",
  "UC-08": "high",
  "UC-09": "high",
};

/**
 * Return the execution tier for a case. A use case has a base tier, but a
 * specific request can be *escalated* by conditions (e.g. an inactive employee,
 * an over-cap amount). Those per-UC conditions are passed in as `flags`.
 * @param {string} useCase e.g. "UC-01"
 * @param {string[]} [flags] escalation flags raised by that UC's policy engine
 * @returns {{tier: "low"|"medium"|"high", escalated: boolean, flags: string[]}}
 */
export function classifyRisk(useCase, flags = []) {
  const base = USE_CASE_TIERS[useCase];
  if (!base) throw new Error(`Unknown use case: ${useCase}`);

  // Any flag pushes the case at least to human handling. This is the
  // "when in doubt, involve a human" safety default.
  if (flags.length > 0) {
    const escalatedTier = base === "low" ? "medium" : "high";
    return { tier: escalatedTier, escalated: true, flags };
  }
  return { tier: base, escalated: false, flags };
}

// ---------------------------------------------------------------------------
// TWO THINGS CALLED "TIER", AND WHY THEY MUST NEVER SHARE A FIELD NAME AGAIN
// ---------------------------------------------------------------------------
// WHAT HAPPENED. The ZAF sidebar printed, in a red rail at the top of a
// Schengen-to-Schengen workation (DE→PT) that was `ready_for_approval`,
// `actionable` and carried a single advisory flag:
//
//     🔴 High risk — no execution path exists — this can only be escalated
//
// and, at the bottom of the same screen, a working Approve button. One screen,
// two contradictory claims, and the loud one was false. UC-04 is a 🟡 use case:
// a named human approving in ZAF IS its execution path (CLAUDE.md §3 directive
// 2). "No execution path exists" is the 🔴 architectural guarantee — the one
// UC-07 and UC-08 enforce structurally and assert by test — and printing it
// above a functioning control is exactly the overstatement CLAUDE.md §1 warns
// discredits everything else on the page.
//
// THE CAUSE was that two different facts were both called `tier`:
//
//   · The USE-CASE TIER — fixed, architectural, a property of the use case and
//     of nothing else. It answers "may an execution path exist at all?"
//     UC-01–03 low, UC-04–06 medium, UC-07–09 high. It never moves.
//
//   · The CASE RISK — what classifyRisk() computes for THIS request. Any flag
//     escalates it, so one advisory flag on a medium use case yields `high`.
//     It answers "how risky is this particular request?"
//
// classifyRisk() returns the second under the key `tier`, the API shipped that
// under the key `tier`, and the sidebar's copy was written for the first. Both
// facts are true and both are useful to a specialist; only their conflation is
// wrong. So they are now computed together and named apart, and the sentence a
// reader acts on is keyed to a THIRD fact that is a property of the use case
// alone — the execution model — rather than being inferred from either.
//
// UC-09 IS WHY THE EXECUTION MODEL CANNOT BE DERIVED FROM THE TIER. It is
// 🔴-framed and it deliberately HAS an execution path, behind a floor-of-2
// multi-role approval (src/uc09/multiApprovalPolicy.js). "high" therefore does
// not imply "no execution path" — for one of the three high use cases it is
// flatly untrue — which is precisely the inference the sidebar was making.
// ---------------------------------------------------------------------------

/**
 * How a decision on this use case is allowed to be executed, if at all.
 *
 * A PROPERTY OF THE USE CASE, NOT OF A CASE. Nothing a request does can change
 * it: a spotless UC-07 dossier still has nowhere to execute, and the riskiest
 * UC-04 workation is still approvable by one named specialist.
 *
 *   automatic            the automation writes on its own; a human is involved
 *                        only by exception (🟢, exception-gated)
 *   single_approval      one named human approves before anything is written
 *   dual_approval        two named humans in DIFFERENT roles must both approve
 *   multi_role_approval  at least two named humans in separate roles, floor of
 *                        two enforced by Math.max(2, …) (UC-09)
 *   none                 there is no execution path to reach — the only
 *                        outcome is an escalation to a human outside this
 *                        system. Asserted structurally AND behaviourally for
 *                        UC-07/UC-08 (no write dep, no POST route, no branch).
 *
 * `none` is the only value that licenses the sidebar's 🔴 guarantee sentence,
 * and exactly two use cases hold it.
 */
export const USE_CASE_EXECUTION_MODELS = {
  "UC-01": "automatic",
  "UC-02": "automatic",
  "UC-03": "automatic",
  "UC-04": "single_approval",
  "UC-05": "single_approval",
  "UC-06": "dual_approval",
  "UC-07": "none",
  "UC-08": "none",
  "UC-09": "multi_role_approval",
};

/** The fixed architectural tier of a use case. Never escalated, ever. */
export function useCaseTier(useCase) {
  const tier = USE_CASE_TIERS[useCase];
  if (!tier) throw new Error(`Unknown use case: ${useCase}`);
  return tier;
}

/** How this use case may execute a decision, if at all. See the table above. */
export function useCaseExecutionModel(useCase) {
  const model = USE_CASE_EXECUTION_MODELS[useCase];
  if (!model) throw new Error(`Unknown use case: ${useCase}`);
  return model;
}

/**
 * Both facts at once, each under a name that means only itself — the shape an
 * API sends to a UI that must state them separately without either sentence
 * contradicting the other.
 *
 * Computed here rather than in each server so the nine cannot drift, and so
 * the one sentence that makes an architectural promise ("no execution path
 * exists") has a single origin that can be pointed at in a test.
 *
 * @param {string} useCase e.g. "UC-04"
 * @param {string[]} [flags] escalation flags raised by that UC's policy engine
 * @returns {{useCaseTier: string, executionModel: string, caseRisk: string,
 *            caseRiskEscalated: boolean, escalatingFlagCount: number}}
 */
export function describeRiskPosture(useCase, flags = []) {
  const risk = classifyRisk(useCase, flags);
  return {
    useCaseTier: useCaseTier(useCase),
    executionModel: useCaseExecutionModel(useCase),
    caseRisk: risk.tier,
    caseRiskEscalated: risk.escalated,
    escalatingFlagCount: risk.flags.length,
  };
}
