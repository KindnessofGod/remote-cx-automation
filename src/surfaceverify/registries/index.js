// ---------------------------------------------------------------------------
// registries/ — one file of FACTS ABOUT A USE CASE, no logic.
// ---------------------------------------------------------------------------
// The whole compounding argument of the master plan rests on this directory
// being thin. UC-01 took five evaluation rounds and half of its fixes landed in
// surfaces all nine share — the sidebar bundle, the review API, the audit feed,
// src/shared/. The runner's fact loop is written against those shared surfaces,
// so what a second use case needs is not a second runner. It is a list of which
// reasons it must be able to produce, and what its own tags are called.
//
// EVERY REASON BELOW WAS MEASURED, NOT INVENTED. Each list was read out of the
// deployed audit log on 2026-08-22 with the correct `use_case=` filter, and the
// observed count is recorded next to it. A registry naming a reason production
// has never emitted would fail the run for the wrong cause and teach its reader
// to distrust the runner — the exact failure verify-surfaces exists to prevent.
//
// THE PARAMETER TRAP, recorded because it nearly poisoned this file: querying
// `?useCase=UC-02` returns sixty rows of UC-01 data. The server reads
// `use_case`; an unrecognised parameter is silently ignored and a complete,
// plausible, WRONG result comes back. The first draft of this table showed all
// nine use cases with identical reasons and looked entirely credible.
// ---------------------------------------------------------------------------

/**
 * UC-01 — employment verification. The reference registry: five evaluation
 * rounds, 12/12 on §16, and the source of every cross-UC fact in facts.js.
 */
export const UC01 = {
  // Observed: ticket 113's public reply is Zendesk's own re-wrapped
  // `<div class="zd-comment">…<table>`. The signal is genuine tag structure,
  // not a bare <html> tag, which Zendesk strips.
  positiveArtifact: { reason: "all_gates_passed", surface: "zendeskPublicReply",
    what: "the rendered verification letter", markup: true, mustMatch: /<(table|h1|strong)[ >]/i },
  useCase: "UC-01",
  tier: "green",
  requiredReasons: [
    { reason: "all_gates_passed", label: "clean auto-resolve — the positive lead", required: true,
      why: "§16 1/2/5 — without it this run cannot tell 'refuses correctly' from 'cannot succeed' (C-16)." },
    { reason: "identity_not_verified", label: "unauthenticated requester quoting a real employment id", required: true,
      why: "E3-F12 / E4-F14 — the subject-withholding fact, on every surface." },
    { reason: "third_party_request", label: "a bank/landlord/vendor disclosure request", required: true,
      why: "§16 11/12 — the refusal path alone proves nothing." },
    { reason: "employee_not_active", label: "an eligibility refusal", required: false,
      why: "F-11/F-13 — the escalate/blocked branches' note and tagging." },
  ],
  autoResolveTags: ["uc01_auto_resolved", "queue_hr_ops"],
  sidebarOffersApproveOn: ["human_review"],
  reachesZendesk: true,
};

/**
 * UC-02 — expense & receipt validation.
 *
 * CORRECTION, 2026-08-22. An earlier revision of this comment said "UC-02
 * reaches no Zendesk ticket in production". THAT WAS FALSE, and the owner
 * caught it: they had tested UC-02 end to end, and the ZAF app exists in part
 * because of it. Ten real tickets tagged `uc02` are live right now — #42-#47
 * and more, carrying `queue_finance_ops` and `uc02_finance_ops_review`.
 *
 * What I had actually measured was narrower and I over-stated it: no UC-02
 * decision row carries a NUMERIC external reference. The true finding is worse
 * than the false one, and it is a traceability defect rather than a missing
 * hand-off:
 *
 *   42 of 60 UC-02 decisions carry `externalRef: null`
 *   the rest carry portal ids such as `uc02-20260819111719-29776`
 *   ZERO carry the id of the ticket the hand-off actually created
 *
 * So the tickets exist and nothing points at them. `external_ref` is both the
 * idempotency key and the join key: a null one means the `/audit` reference
 * lookup cannot resolve the row, the sidebar's `by-ticket/:id` cannot find it,
 * and `workflow_claims` has nothing to claim. `src/portal/ticketing.js`'s
 * `linkTicket()` is supposed to repoint the record's ref at the ticket id once
 * it is raised; on these rows it did not.
 *
 * `reachesZendesk` therefore stays FALSE — not because UC-02 has no Zendesk
 * surface, but because no decision row can be joined to one, which is what the
 * runner needs in order to read a note or a tag. That distinction is now stated
 * in the flag's own name below rather than left to be misread again.
 */
export const UC02 = {
  // NOT a letter. UC-02's success is a WRITE to Remote, and production shows
  // it as its own row: `expense_approved_write` / `expense_auto_approved`
  // following an `auto_approve`. It reaches no Zendesk ticket, so the audit row
  // is the only surface that can carry it — which is exactly why rca-v07y (the
  // broken ticket join) had to be fixed before this could be asserted at all.
  positiveArtifact: { reason: "all_gates_passed", surface: "audit.decisionRow",
    what: "an approved-expense write", mustMatch: /expense_(approved_write|auto_approved)|auto_approve/i },
  useCase: "UC-02",
  tier: "green",
  requiredReasons: [
    { reason: "all_gates_passed", label: "clean auto-approve — the positive lead", required: true,
      why: "7 observed live (action auto_approve). C-16: a use case that cannot succeed and one being careful look identical." },
    { reason: "over_policy_cap", label: "an expense above the policy cap — human review", required: true,
      why: "11 observed live; UC-02's most common human hand-off and C-22's 'say the amount, the cap, by how much'." },
    { reason: "expense_employment_mismatch", label: "the claimant is not the employment on the expense", required: false,
      why: "5 observed live — UC-02's identity refusal, the analogue of UC-01's identity_not_verified." },
  ],
  autoResolveTags: ["uc02_auto_approved", "queue_finance_ops"],
  sidebarOffersApproveOn: ["human_review"],
  // NOT "has no Zendesk surface" — it has ten live tickets. This means no
  // decision row can be JOINED to one, which is what the runner needs.
  reachesZendesk: false,
  zendeskJoinBroken: true,
};

/**
 * UC-03 — travel support letter / workation router.
 *
 * MEASURED 2026-08-22: unlike UC-02, UC-03 DOES reach Zendesk — and crucially
 * it has ticketed `identity_not_verified` decisions (3 observed, 2 ticketed),
 * so the subject-withholding fact that cost UC-01 two full rounds (E3-F12 then
 * E4-F14 on a second surface) is checkable here on day one rather than
 * rediscovered.
 *
 * `sanctioned_region` is listed because UC-03 is where the restricted-set
 * jurisdiction screen lives, and §7 item 2 records that this gate was DEAD for
 * weeks while every safety assertion passed — the alpha-3/alpha-2 comparison.
 * A live decision carrying it is the only evidence the gate can still fire.
 */
export const UC03 = {
  positiveArtifact: { reason: "all_gates_passed", surface: "zendeskPublicReply",
    what: "the travel support letter", markup: true, mustMatch: /<(table|h1|strong)[ >]/i },
  useCase: "UC-03",
  tier: "green",
  requiredReasons: [
    { reason: "all_gates_passed", label: "clean auto-resolve — the positive lead", required: true,
      why: "10 observed live. C-16 was UC-03's OWN defect: it could not say yes to any input, ever, and every fail-closed assertion passed." },
    { reason: "identity_not_verified", label: "requester does not match the employment", required: true,
      why: "3 observed, 2 ticketed — the cross-UC subject-withholding fact, checkable here without waiting for a round." },
    { reason: "work_authorization_requested", label: "routed on to UC-04", required: false,
      why: "11 observed — the hand-off UC-03's signoff policy deliberately refuses to let anyone sign." },
    { reason: "sanctioned_region", label: "a restricted destination, hard-blocked", required: false,
      why: "2 observed — the jurisdiction screen that was structurally dead for weeks (§7 item 2)." },
  ],
  autoResolveTags: ["uc03_auto_resolved", "queue_travel_mobility_support"],
  sidebarOffersApproveOn: ["human_review"],
  reachesZendesk: true,
};

/**
 * UC-04 — work authorization / workation. 🟡, single specialist approval.
 *
 * MEASURED 2026-08-22. Its positive lead is `ready_for_approval /
 * all_gates_passed` (6 observed) — note the ACTION is not `auto_resolve`:
 * a 🟡 use case's success is a case PREPARED for a human, not one closed
 * without one. A registry that demanded `auto_resolve` here would fail every
 * run for a reason that is the tier working correctly.
 *
 * `blocked / visitor_visa_active_work_forbidden` and `blocked /
 * employer_permission_not_granted` are both live, which makes UC-04 the first
 * use case where `blockedBranchHasGroup` — dead on UC-01 and UC-03 for want of
 * any blocked scenario at all — can finally execute.
 */
export const UC04 = {
  // 🟡: success ends AT a human. The artifact is a case a specialist can act
  // on — the internal note naming who decides and with what verbs. There is no
  // customer-visible document; §15 was corrected on exactly this point
  // (DRIFT-093): neither Remote object carries a file or URL field, so UC-04's
  // outcome is a STATUS, not an authorisation document.
  positiveArtifact: { reason: "all_gates_passed", surface: "zendeskInternalNote",
    what: "a specialist-actionable hand-off", mustMatch: /Decided at gate|Routing —|Assigned to/i },
  useCase: "UC-04",
  tier: "amber",
  requiredReasons: [
    { reason: "all_gates_passed", label: "cleared to a specialist — the positive lead", required: true,
      why: "6 observed live (action ready_for_approval). For a 🟡 tier the positive path ends AT a human, not past one." },
    { reason: "identity_not_verified", label: "requester does not match the employment", required: true,
      why: "3 observed, 1 ticketed — the cross-UC subject-withholding fact." },
    { reason: "employer_permission_not_granted", label: "a hard block, employer has not consented", required: false,
      why: "3 observed, 2 ticketed — exercises blockedBranchHasGroup, which has never run on UC-01 or UC-03." },
    { reason: "visitor_visa_active_work_forbidden", label: "visa status forbids the work", required: false,
      why: "1 observed, 1 ticketed — the jurisdiction hard block W-1 loosened for business visas (corpus C-26)." },
  ],
  autoResolveTags: ["uc04_ready_for_approval", "queue_mobility_specialists"],
  sidebarOffersApproveOn: ["ready_for_approval", "human_review"],
  reachesZendesk: true,
};

/**
 * UC-05 — resignation notice calculation. 🟡, single HR Ops sign-off.
 *
 * MEASURED 2026-08-22. Positive lead is `prepared_for_signoff /
 * all_gates_passed` (7 observed) — again a 🟡 ending at a human. There is no
 * real write endpoint (spec-confirmed), so the signed-off report IS the durable
 * artifact and no customer-facing letter is expected; a note/reply fact reading
 * `na` here is correct rather than a gap.
 *
 * `statutory_discrepancy` is listed because it is UC-05's whole product after
 * DRIFT-063: Remote's own `days_of_notice` blends contract and statute without
 * saying which prevails, so the DISAGREEMENT with an independent statutory
 * figure is the value. One observed live — thin, and worth watching.
 */
export const UC05 = {
  // 🟡 and the sharpest case: UC-05 has NO write endpoint (spec-confirmed), so
  // the signed-off report IS the durable artifact. Demanding a customer letter
  // here would fail a use case that is working exactly as specified.
  positiveArtifact: { reason: "all_gates_passed", surface: "zendeskInternalNote",
    what: "the notice-period report prepared for sign-off", mustMatch: /Decided at gate|notice|Routing —/i },
  useCase: "UC-05",
  tier: "amber",
  requiredReasons: [
    { reason: "all_gates_passed", label: "notice computed, prepared for sign-off — the positive lead", required: true,
      why: "7 observed live (action prepared_for_signoff). No write endpoint exists, so the signed report is the artifact." },
    { reason: "identity_not_verified", label: "requester does not match the employment", required: true,
      why: "4 observed, 2 ticketed — the cross-UC subject-withholding fact." },
    { reason: "statutory_discrepancy", label: "our statutory figure disagrees with Remote's days_of_notice", required: false,
      why: "1 observed. This IS UC-05's product (DRIFT-063) and one live example is thin evidence that it can still fire." },
    { reason: "unsupported_country", label: "no statutory table for this country", required: false,
      why: "2 observed — the honest refusal, distinct from 'no statutory minimum' since 43ae3c7." },
  ],
  autoResolveTags: ["uc05_prepared_for_signoff", "queue_hr_ops"],
  sidebarOffersApproveOn: ["prepared_for_signoff", "human_review"],
  reachesZendesk: true,
};

/**
 * UC-06 — contract amendment / payroll cutoff. 🟡, DUAL approval.
 *
 * MEASURED 2026-08-22, and this is the finding of the whole sweep:
 * **UC-06 HAS NEVER SUCCEEDED IN PRODUCTION.** All 26 decisions are
 * `escalate` — schema_invalid (9), identity_not_verified (8),
 * cutoff_lock_passed (4), change_value_underivable (2),
 * no_matching_payroll_cycle (1). Not one `all_gates_passed`. Ever.
 *
 * That is precisely C-16's shape, and CLAUDE.md predicts it: UC-06's positive
 * path exists only through the stand-in's PROJECTED payroll cycle, on NL and
 * CA alone — the Sandbox's last real cycle anywhere ended 2026-07-31, the USA
 * schema answers 500 for every employment, and PT publishes a form no PT
 * record satisfies. So a use case that can only ever be observed refusing.
 *
 * `all_gates_passed` is therefore marked required:true DELIBERATELY, so every
 * run FAILS until a real approval exists. Marking it optional would make the
 * runner green on a use case that has never worked, which is the exact
 * substitution — "refusing correctly" for "unable to succeed" — that this
 * project has paid for four times.
 */
export const UC06 = {
  // Never yet observed in production — all 26 decisions are escalate. Declared
  // anyway and required, so the run FAILS until a real approval exists. That
  // failure is the honest state, not a registry error.
  positiveArtifact: { reason: "all_gates_passed", surface: "zendeskInternalNote",
    what: "an amendment cleared to dual approval", mustMatch: /Decided at gate|Routing —|Assigned to/i },
  useCase: "UC-06",
  tier: "amber",
  requiredReasons: [
    { reason: "all_gates_passed", label: "an amendment cleared to dual approval — the positive lead", required: true,
      why: "ZERO observed in production across 26 decisions. Required on purpose: until one exists, this use case is unproven and the run must say so." },
    { reason: "identity_not_verified", label: "requester does not match the employment", required: true,
      why: "8 observed, 3 ticketed — the cross-UC subject-withholding fact." },
    { reason: "cutoff_lock_passed", label: "the payroll cutoff has already locked", required: false,
      why: "4 observed — the hard deterministic time gate, and the one refusal that is unambiguously correct." },
    { reason: "schema_invalid", label: "the country form rejected the payload", required: false,
      why: "9 observed, UC-06's most common refusal. DRIFT-101: PT publishes a form no PT record satisfies and the USA answers 500 — a Remote-side defect, not ours." },
  ],
  autoResolveTags: ["uc06_dual_approval_required", "queue_payroll_ops"],
  sidebarOffersApproveOn: ["dual_approval_required", "human_review"],
  reachesZendesk: true,
};

/**
 * UC-07 / UC-08 — 🔴 relocation and cross-border tax. NO EXECUTION PATH, and
 * that is the specification rather than a gap.
 *
 * MEASURED: UC-07 is 21 decisions, ALL `escalate`, none carrying a reason.
 * UC-08 is 7, likewise. For a use case whose whole guarantee is that nothing
 * can be approved, `escalate` IS the success path — the dossier was compiled
 * and handed to a specialist. A registry demanding `all_gates_passed` here
 * would fail every run for a reason that is the tier working exactly as
 * designed, which is the same trap the 🟡 registries had to avoid one tier up.
 *
 * So the positive lead is `escalate` itself. The empty `reason` column is the
 * open question and it is NOT assumed benign: "correct by construction" and
 * "the field was never populated" are indistinguishable from outside, which is
 * this repository's oldest recurring defect. `reasonRequired: false` records
 * that we know the column is empty; it does not bless it.
 */
export const UC07 = {
  // 🔴: the escalation IS the success. A dossier that reaches a named
  // specialist is the whole outcome, and no execution path may exist.
  positiveArtifact: { action: "escalate", surface: "zendeskInternalNote",
    what: "a compiled relocation dossier reaching a specialist", mustMatch: /Routing —|Assigned to|dossier/i },
  useCase: "UC-07",
  tier: "red",
  noExecutionPath: true,
  requiredReasons: [
    { reason: null, action: "escalate", label: "a dossier compiled and escalated — the positive lead for a 🔴", required: true,
      why: "21 observed, 7 ticketed. For a use case with no execution path, reaching a specialist IS success." },
  ],
  autoResolveTags: ["uc07_dossier_compiled", "queue_mobility_legal_tier3"],
  sidebarOffersApproveOn: [],
  reachesZendesk: true,
};

export const UC08 = {
  positiveArtifact: { action: "escalate", surface: "zendeskInternalNote",
    what: "a compiled tax dossier reaching a specialist", mustMatch: /Routing —|Assigned to|dossier/i },
  useCase: "UC-08",
  tier: "red",
  noExecutionPath: true,
  requiredReasons: [
    { reason: null, action: "escalate", label: "a tax dossier compiled and escalated — the positive lead for a 🔴", required: true,
      why: "7 observed, 5 ticketed. Thinnest surface in the set; expect the runner's own STALE and coverage guards to fire first." },
  ],
  autoResolveTags: ["uc08_dossier_compiled", "queue_tax_advisory"],
  sidebarOffersApproveOn: [],
  reachesZendesk: true,
};

/**
 * UC-09 — off-cycle payroll adjustment. 🔴-framed, and the ONE red use case
 * WITH a real execution path. The money path.
 *
 * MEASURED: no `all_gates_passed`. Its success state is
 * `triple_approval_required / high_risk_adjustment_needs_triple_approval`
 * (2 observed) — reaching the approval gate, not passing it. `Math.max(2, …)`
 * guarantees the floor can never drop below two signatures regardless of risk
 * score, so "cleared to approval" is as far as an automated decision may get
 * and further would be the defect.
 */
export const UC09 = {
  // 🔴 with an execution path: success is REACHING the approval gate. Passing
  // it automatically would be the defect Math.max(2, …) exists to prevent.
  positiveArtifact: { reason: "high_risk_adjustment_needs_triple_approval", surface: "zendeskInternalNote",
    what: "an adjustment cleared to multi-role approval", mustMatch: /Decided at gate|Routing —|approval/i },
  useCase: "UC-09",
  tier: "red",
  requiredReasons: [
    { reason: "high_risk_adjustment_needs_triple_approval", label: "an adjustment cleared to multi-role approval — the positive lead", required: true,
      why: "2 observed. Reaching the approval gate IS success here; passing it automatically would be the defect." },
    { reason: "identity_not_verified", label: "requester does not match the employment", required: true,
      why: "2 observed — the cross-UC subject-withholding fact, on the money path where it matters most." },
    { reason: "amount_not_extracted", label: "the amount could not be read from the request", required: false,
      why: "3 observed, all 3 ticketed — UC-09's most common refusal and its most ticketed reason." },
    { reason: "upstream_record_not_found", label: "Remote returned 404 for the employment", required: false,
      why: "2 observed — upstreamFailure.js distinguishing an answer ABOUT the record from a request never evaluated." },
  ],
  autoResolveTags: ["uc09_approval_required", "queue_payroll_ops"],
  sidebarOffersApproveOn: ["triple_approval_required", "human_review"],
  reachesZendesk: true,
};

const ALL = { "UC-01": UC01, "UC-02": UC02, "UC-03": UC03, "UC-04": UC04, "UC-05": UC05,
              "UC-06": UC06, "UC-07": UC07, "UC-08": UC08, "UC-09": UC09 };

/** Registries that exist. The eight not here are unwritten, never "passing". */
export const REGISTERED = Object.keys(ALL);

export function getRegistry(useCase) {
  const r = ALL[useCase];
  if (!r) {
    throw new Error(
      `no surface registry for ${useCase}. Registered: ${REGISTERED.join(", ")}. ` +
        "A use case without a registry has NOT been verified — it is unwritten, and that is exit 2, not a pass."
    );
  }
  return r;
}
