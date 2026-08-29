// ---------------------------------------------------------------------------
// demoSeed.js  —  The audit viewer's zero-credential demo dataset
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `npm run audit-ui` must show something real-shaped on a fresh clone with no
// .env at all — the same rule as every other seeded surface in this repo. The
// rows here are FABRICATED and the page says so on a banner ("SEEDED DEMO
// DATA"); what is NOT fabricated is their shape (the exact columns the real
// tables carry, verified against Supabase) and their stories, each of which is
// a defect or behaviour this project actually hit:
//
//   - a clean retry sequence (attempts 1..2 under one call) — withRetry()'s
//     legitimate bookkeeping, which must NOT flag as a duplicate;
//   - a GENUINE duplicate call (two entries both claiming attempt 1) — the
//     thing findRedundantCalls() exists to catch (issue #33);
//   - ticket #5's double delivery: TWO audit rows under one external ref,
//     recorded before the claim ledger existed (BUILD-LOG §3.24), with the
//     claim row that now prevents it;
//   - one ops alert with audit_durable=true (only the Zendesk update was
//     lost) and one with audit_durable=false (the decision itself was lost) —
//     the distinction that column exists to make;
//   - ONE PORTAL EXPENSE, SUBMITTED TWICE, TWO HOURS APART — four audit_log
//     rows on one `storeId`, copied from the live shape the deployment
//     produced on 2026-08-18/19:
//
//       t         auto_approve               submission 1's decision
//       t         expense_auto_approved      its pre-write intent (same ms)
//       t+841ms   expense_approved_write     its EXECUTION, carrying Remote's
//                                            own {"status": "approved"}
//       t+31m*    duplicate_request_ignored  SUBMISSION 2, entire
//
//     (* live the gap was 2h08m; see portalAt below for why the seed shortens
//     it, and why nothing the fixture demonstrates depends on the length.)
//
//     This one story seeds nearly everything the viewer has to get right: all
//     THREE kinds side by side; the execution row that used to read as a mere
//     follow-up while being the only proof the reimbursement really happened;
//     a group holding TWO decision rows, which is why traceVerdict.js picks
//     the decision recorded BEFORE a row rather than the first in the group;
//     a group spanning hours, which is why the sibling panel says "same
//     record" and not "same submission"; the trace verdict's sibling and
//     no-traceable-call branches; and — because the first two rows share a
//     millisecond — the `(at, id)` page-edge tiebreak.
//
// Timestamps are relative to `now` so the feed looks alive; `now` is a
// parameter so tests are deterministic.
// ---------------------------------------------------------------------------

/**
 * @param {number} [now]  epoch ms the dataset is anchored to
 * @returns {{auditLog: object[], auditTrace: object[], workflowClaims: object[],
 *   opsAlerts: object[]}}
 */
export function buildDemoDataset(now = Date.now()) {
  const at = (minutesAgo, ms = 0) => new Date(now - minutesAgo * 60_000 - ms).toISOString();

  // Stable ids so a demo walkthrough can name them.
  const D = {
    uc01Auto: "11111111-1111-4111-8111-111111111101",
    uc02Dup: "11111111-1111-4111-8111-111111111102",
    uc06Escalate: "11111111-1111-4111-8111-111111111106",
    uc04Blocked: "11111111-1111-4111-8111-111111111104",
    uc09Pending: "11111111-1111-4111-8111-111111111109",
    uc01TicketFiveA: "11111111-1111-4111-8111-111111111105",
    uc01TicketFiveB: "11111111-1111-4111-8111-111111111150",
    // One portal expense, submitted twice → four rows on one storeId. Ids
    // ascend in the order the rows were written, so the feed's `(at, id)`
    // DESCENDING order puts the write above the decision — which is exactly
    // the presentation that misleads a reader without the kind labels.
    uc02PortalDecision: "11111111-1111-4111-8111-111111111121",
    uc02PortalApproved: "11111111-1111-4111-8111-111111111122",
    uc02PortalWrite: "11111111-1111-4111-8111-111111111123",
    uc02PortalResubmit: "11111111-1111-4111-8111-111111111124",
    // One flagged expense, one specialist, three rows on one storeId — see the
    // block beside them in auditLog below.
    uc02ReviewDecision: "11111111-1111-4111-8111-111111111131",
    uc02ReviewRelease: "11111111-1111-4111-8111-111111111132",
    uc02ReviewWrite: "11111111-1111-4111-8111-111111111133",
    // A human verdict with NO execution row, correctly.
    uc05Signoff: "11111111-1111-4111-8111-111111111135",
  };

  /** The uc02_expenses row the human-review trio share. */
  const REVIEW_STORE_ID = "b7c30d51-8e26-4f39-a05c-1d4e6f7b2a99";
  const reviewDecidedAt = at(58);
  const reviewReleasedAt = at(26);
  const reviewWroteAt = at(26, -350);

  /** The record id all FOUR rows carry — the ExpenseStore row, not a request. */
  const PORTAL_STORE_ID = "e2d41c88-0b4a-4a0e-9f21-6c2b7a5d31aa";
  /** Submission 2 is the RECENT one — the resubmission is what a reader sees
   *  arrive at the head of the feed, exactly as it did live. */
  const portalResubmitAt = at(14);
  /** Submission 1, half an hour earlier. Its decision and its pre-write intent
   *  are identical to the microsecond, on purpose — see the header.
   *
   *  THE GAP IS COMPRESSED, AND THAT IS THE ONE LIBERTY TAKEN WITH THE LIVE
   *  SHAPE. Live it was 2h08m; here it is 31 minutes, because anything longer
   *  pushes submission 1 behind the oldest seeded audit_trace row and the
   *  drill-down would answer `predates_tracing` — a true statement about a
   *  fabricated timeline, which would seed the wrong lesson. Nothing the gap
   *  demonstrates depends on its length: what matters is that a SECOND
   *  submission joined an existing group long after that group had closed. */
  const portalAt = at(45);
  /** The execution, 841ms after them — the live gap between the intent row and
   *  the row written once Remote answered. */
  const portalWriteAt = at(45, -841);

  const auditLog = [
    {
      id: D.uc01Auto,
      at: at(3),
      useCase: "UC-01",
      action: "auto_resolve",
      actor: "alexandre.tremblay@example.com",
      riskTier: "low",
      externalRef: "6",
      reason: "all_gates_passed",
      details: {
        caseId: "c0a80101-4f3b-4a29-9f77-2d5e9a13b001",
        externalRef: "6",
        employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
        decision: "auto_resolve",
        reason: "all_gates_passed",
        identity: "requester_matches_employment",
        classification: { type: "employment_verification", source: "llm" },
        flags: [],
        letterIssued: true,
      },
    },
    // -----------------------------------------------------------------------
    // ONE PORTAL EXPENSE SUBMISSION, THREE ROWS, ONE MILLISECOND.
    // The decision is the FIRST row written and the LAST one the feed shows,
    // because the feed orders by `(at, id)` descending and these three share
    // an `at`. All three carry `storeId`; only the decision row carries the
    // `categorySource`/`source` that explain why nothing was traced.
    // -----------------------------------------------------------------------
    {
      id: D.uc02PortalDecision,
      at: portalAt,
      useCase: "UC-02",
      action: "auto_approve",
      actor: "anna.muller@example.com",
      riskTier: "low",
      externalRef: "portal-exp-4471",
      reason: "all_gates_passed",
      details: {
        storeId: PORTAL_STORE_ID,
        expenseId: "exp_4471",
        employmentId: "09b65526-643b-4956-959b-916e6429bd23",
        externalRef: "portal-exp-4471",
        decision: "auto_approve",
        reason: "all_gates_passed",
        flags: [],
        categoryId: "cat_travel",
        // The rules answered, not the model — so there was no LLM call to
        // trace. This field is what turns the empty Attempts table from a
        // shrug into a verdict (issue #25's source tagging, put to work).
        categorySource: "rule_based_fallback",
        confidence: null,
        // The portal's Remote reads go to the mock fixtures, not the live API.
        source: "portal",
        // Money as the API carries it: integers in the currency's minor unit,
        // each paired with its own code. The viewer formats these; it never
        // guesses a currency that is not in the row.
        amount: 12500,
        currency: "USD",
        convertedAmount: 11450,
        convertedCurrency: "EUR",
        taxAmount: 0,
        receiptCount: 1,
        receiptHashSource: "derived",
        expenseStatus: "pending",
        upstreamFailures: [],
      },
    },
    {
      id: D.uc02PortalApproved,
      at: portalAt,
      useCase: "UC-02",
      action: "expense_auto_approved",
      actor: "anna.muller@example.com",
      riskTier: "low",
      externalRef: null,
      reason: null,
      details: {
        storeId: PORTAL_STORE_ID,
        expenseId: "exp_4471",
        employmentId: "09b65526-643b-4956-959b-916e6429bd23",
        amount: 12500,
        currency: "USD",
        convertedAmount: 11450,
        convertedCurrency: "EUR",
      },
    },
    {
      id: D.uc02PortalWrite,
      at: portalWriteAt,
      useCase: "UC-02",
      action: "expense_approved_write",
      actor: "anna.muller@example.com",
      riskTier: "low",
      externalRef: null,
      reason: null,
      details: {
        storeId: PORTAL_STORE_ID,
        expenseId: "exp_4471",
        // A genuinely nested value — the drill-down keeps it reachable behind
        // a collapsible raw view instead of dumping it over the whole record.
        remoteResult: {
          id: "exp_4471",
          status: "approved",
          approved_at: portalWriteAt, // Remote timestamps the approval, not the intent row
          amount: 12500,
          currency: { code: "USD" },
          reviewer: { id: "sys_automation", name: "CX automation" },
        },
      },
    },
    // SUBMISSION 2, in full. The same person filed the same expense again two
    // hours later, and UC-02's duplicate gate refused it — no second Remote
    // write, no second decision computed, just this row and an immediate
    // return (src/uc02/workflow.js). It is therefore a DECISION, not a
    // follow-up of the one it replays: it is everything that happened to a
    // separate request. Classified as an event it would assert that a row
    // recorded at t+2h followed a decision made at t, in the same submission,
    // which is false in both halves.
    //
    // `details` mirrors the writer exactly, `priorDecision`/`priorDecidedAt`
    // included — those two are what let a reader see that the refusal replayed
    // a real earlier verdict rather than inventing one.
    {
      id: D.uc02PortalResubmit,
      at: portalResubmitAt,
      useCase: "UC-02",
      action: "duplicate_request_ignored",
      actor: "anna.muller@example.com",
      riskTier: "low",
      externalRef: null,
      reason: "an expense decision already exists for this expense id — no second write was issued",
      details: {
        storeId: PORTAL_STORE_ID,
        expenseId: "exp_4471",
        employmentId: "09b65526-643b-4956-959b-916e6429bd23",
        priorDecision: "auto_approve",
        priorDecidedAt: portalAt,
        externalRef: null,
        source: "portal",
        reason: "an expense decision already exists for this expense id — no second write was issued",
      },
    },
    {
      id: D.uc02Dup,
      at: at(9),
      useCase: "UC-02",
      action: "human_review",
      actor: "anna.muller@example.com",
      riskTier: "low",
      externalRef: "8102",
      reason: "low_confidence",
      details: {
        externalRef: "8102",
        decision: "human_review",
        reason: "low_confidence",
        categoryId: "cat_meals",
        categorySource: "llm",
        flags: ["low_confidence_category"],
      },
    },
    // -----------------------------------------------------------------------
    // A PERSON AUTHORISING MONEY — the 🟡 tier's whole point, and the story
    // this dataset had no row for.
    //
    // Copied from the live shape, 2026-08-19: a flagged expense above its
    // category cap, a Finance Ops specialist releasing it in the ZAF sidebar,
    // and the write that followed 350ms later carrying Remote's own answer:
    //
    //   t          human_review             the automation's verdict: a person
    //                                       decides (over_policy_cap)
    //   t+…        expense_review_release    THE PERSON's verdict, logged
    //                                       durably BEFORE anything was acted
    //                                       on — actor, note and the AI's
    //                                       recommendation on the same row
    //   t+350ms    expense_released_write    the EXECUTION, carrying Remote's
    //                                       {"status": "approved"}
    //
    // Both of the last two rendered as "Follow-up event" until the vocabularies
    // learned about them, which made a reimbursement authorised by a named
    // human indistinguishable from a tag update. The three rows share one
    // `storeId`, so the drill-down's write-outcome verdict can answer the
    // question that matters after an approval: did Remote actually take it?
    // -----------------------------------------------------------------------
    {
      id: D.uc02ReviewDecision,
      at: reviewDecidedAt,
      useCase: "UC-02",
      action: "human_review",
      actor: "alex.morgan@example.com",
      riskTier: "medium",
      externalRef: "8140",
      reason: "over_policy_cap",
      details: {
        storeId: REVIEW_STORE_ID,
        expenseId: "exp_8140",
        employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
        externalRef: "8140",
        decision: "human_review",
        reason: "over_policy_cap",
        categoryId: "cat_travel",
        categorySource: "rule_based_fallback",
        amount: 48000,
        currency: "USD",
        flags: ["over_policy_cap"],
        source: "portal",
      },
    },
    {
      id: D.uc02ReviewRelease,
      at: reviewReleasedAt,
      useCase: "UC-02",
      action: "expense_review_release",
      actor: "b.person@example.com",
      riskTier: "medium",
      externalRef: null,
      reason: null,
      details: {
        storeId: REVIEW_STORE_ID,
        expenseId: "exp_8140",
        employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
        reviewAction: "release",
        note: "Client pre-approved the overage in writing; attached to the expense.",
        // The AI's recommendation, recorded BESIDE the human's verdict. Without
        // this pairing "did the specialist agree with the automation?" cannot be
        // answered from history, and the accept rate would restate its own
        // definition rather than measure anything.
        aiDecision: "human_review",
        aiReason: "over_policy_cap",
        aiFlags: ["over_policy_cap"],
      },
    },
    {
      id: D.uc02ReviewWrite,
      at: reviewWroteAt,
      useCase: "UC-02",
      action: "expense_released_write",
      actor: "b.person@example.com",
      riskTier: "medium",
      externalRef: null,
      reason: null,
      details: {
        storeId: REVIEW_STORE_ID,
        expenseId: "exp_8140",
        payload: { status: "approved" },
        remoteResult: {
          id: "exp_8140",
          status: "approved",
          approved_at: reviewWroteAt,
          amount: 48000,
          currency: { code: "USD" },
          reviewer: { id: "usr_finance_ops", name: "Finance Ops" },
        },
      },
    },
    // THE SAME MOMENT, ONE USE CASE OVER, AND WITHOUT THE SECOND HALF.
    // UC-05 has no Remote write endpoint at all (CLAUDE.md §4) — the signed-off
    // report IS the artifact — so this verdict correctly produces no execution
    // row. Seeded because it is the case the write-outcome verdict must NOT
    // paint red: "no write recorded" has two readings and this row is the
    // benign one, which is exactly why humanDecision.js reports both and
    // resolves neither.
    {
      id: D.uc05Signoff,
      at: at(63),
      useCase: "UC-05",
      action: "resignation_signed_off",
      actor: "hr.ops@example.com",
      riskTier: "medium",
      externalRef: null,
      reason: null,
      details: {
        resignationId: "7c1f0b64-2a3d-4c58-9d10-5b7e2a4f88c3",
        note: "Shortfall accepted; employee agreed to work the full statutory notice.",
        aiDecision: "prepared_for_signoff",
      },
    },
    {
      id: D.uc06Escalate,
      at: at(21),
      useCase: "UC-06",
      action: "escalate",
      actor: "unauthenticated",
      riskTier: "medium",
      externalRef: "3001",
      reason: "noMatchingCycle",
      details: {
        externalRef: "3001",
        decision: "escalate",
        reason: "noMatchingCycle",
        amendmentType: "SALARY_INCREASE",
        flags: ["no_payroll_cycle_covers_effective_date"],
      },
    },
    {
      id: D.uc04Blocked,
      at: at(34),
      useCase: "UC-04",
      action: "blocked",
      actor: "amanda.walker@example.com",
      riskTier: "medium",
      externalRef: "4207",
      reason: "sanctioned_region",
      details: {
        externalRef: "4207",
        decision: "blocked",
        reason: "sanctioned_region",
        destination: "IR",
        flags: ["sanctioned_region"],
      },
    },
    {
      id: D.uc09Pending,
      at: at(52),
      useCase: "UC-09",
      action: "triple_approval_required",
      actor: "alex.morgan@example.com",
      riskTier: "high",
      externalRef: "9005",
      reason: "high_risk_adjustment_needs_triple_approval",
      details: {
        externalRef: "9005",
        decision: "triple_approval_required",
        reason: "high_risk_adjustment_needs_triple_approval",
        approvalSlotsRequired: 3,
        flags: ["amount_above_threshold"],
      },
    },
    // Ticket #5's double delivery: two decision rows 30µs apart under ONE
    // external ref — the pre-claim-ledger failure the bug-audit tab exists to
    // make visible (both real gates passed; the DELIVERY was the duplicate).
    {
      id: D.uc01TicketFiveA,
      at: at(120),
      useCase: "UC-01",
      action: "auto_resolve",
      actor: "alexandre.tremblay@example.com",
      riskTier: "low",
      externalRef: "5",
      reason: "all_gates_passed",
      details: {
        externalRef: "5",
        decision: "auto_resolve",
        reason: "all_gates_passed",
        flags: [],
        letterIssued: true,
      },
    },
    {
      id: D.uc01TicketFiveB,
      at: at(120, -1), // 1ms later — the duplicate
      useCase: "UC-01",
      action: "auto_resolve",
      actor: "alexandre.tremblay@example.com",
      riskTier: "low",
      externalRef: "5",
      reason: "all_gates_passed",
      details: {
        externalRef: "5",
        decision: "auto_resolve",
        reason: "all_gates_passed",
        flags: [],
        letterIssued: true,
        note: "duplicate delivery — this row is why the workflow_claims ledger exists",
      },
    },
  ];

  const auditTrace = [
    // UC-01: a CLEAN retry sequence (1..2) plus a single-fire Remote read.
    // findRedundantCalls() must stay quiet about this group.
    {
      id: "22222222-2222-4222-8222-222222222201",
      at: at(3, 400),
      parentId: D.uc01Auto,
      call: "openai.classify",
      attempt: 1,
      ok: false,
      error: "timeout after 10s",
      details: { model: "gpt-4o-mini", source: "n8n", atSemantic: "trace_write" },
    },
    {
      id: "22222222-2222-4222-8222-222222222202",
      at: at(3, 300),
      parentId: D.uc01Auto,
      call: "openai.classify",
      attempt: 2,
      ok: true,
      error: null,
      details: { model: "gpt-4o-mini", source: "n8n", atSemantic: "trace_write", tokens: 151 },
    },
    {
      id: "22222222-2222-4222-8222-222222222203",
      at: at(3, 200),
      parentId: D.uc01Auto,
      call: "remote.employment",
      attempt: 1,
      ok: true,
      error: null,
      details: { status: 200, durationMs: 412, source: "n8n", atSemantic: "trace_write" },
    },
    // UC-02: a GENUINE duplicate — the same call fired twice, both claiming
    // attempt 1. Not a retry sequence; findRedundantCalls() must flag it.
    {
      id: "22222222-2222-4222-8222-222222222204",
      at: at(9, 500),
      parentId: D.uc02Dup,
      call: "openai.classify_expense",
      attempt: 1,
      ok: true,
      error: null,
      details: { model: "gpt-4o-mini", source: "n8n", atSemantic: "trace_write" },
    },
    {
      id: "22222222-2222-4222-8222-222222222205",
      at: at(9, 100),
      parentId: D.uc02Dup,
      call: "openai.classify_expense",
      attempt: 1,
      ok: true,
      error: null,
      details: { model: "gpt-4o-mini", source: "n8n", atSemantic: "trace_write", note: "same call issued twice — a genuine duplicate" },
    },
    {
      id: "22222222-2222-4222-8222-222222222206",
      at: at(9, 50),
      parentId: D.uc02Dup,
      call: "remote.expense",
      attempt: 1,
      ok: true,
      error: null,
      details: { status: 200, durationMs: 233, source: "n8n", atSemantic: "trace_write" },
    },
    // UC-06: two single-fire reads, the second finding no future payroll cycle.
    {
      id: "22222222-2222-4222-8222-222222222207",
      at: at(21, 300),
      parentId: D.uc06Escalate,
      call: "remote.employment",
      attempt: 1,
      ok: true,
      error: null,
      details: { status: 200, durationMs: 388, source: "n8n", atSemantic: "trace_write" },
    },
    {
      id: "22222222-2222-4222-8222-222222222208",
      at: at(21, 100),
      parentId: D.uc06Escalate,
      call: "remote.payroll_runs",
      attempt: 1,
      ok: true,
      error: null,
      details: { status: 200, cycles: 4, latestPeriodEnd: "2026-07-31", source: "n8n", atSemantic: "trace_write" },
    },
    // UC-04 and UC-09 each do one real Remote read. Seeded so that the ONLY
    // rows left with an empty Attempts table are the ones that mean something:
    // the portal submission (nothing traceable happened) and ticket #5 (older
    // than the oldest trace row that exists — per-attempt tracing came later).
    {
      id: "22222222-2222-4222-8222-222222222209",
      at: at(34, 200),
      parentId: D.uc04Blocked,
      call: "remote.employment",
      attempt: 1,
      ok: true,
      error: null,
      details: { status: 200, durationMs: 471, source: "n8n", atSemantic: "trace_write" },
    },
    {
      id: "22222222-2222-4222-8222-222222222210",
      at: at(52, 250),
      parentId: D.uc09Pending,
      call: "remote.employment",
      attempt: 1,
      ok: true,
      error: null,
      details: { status: 200, durationMs: 505, source: "n8n", atSemantic: "trace_write" },
    },
  ];

  const workflowClaims = [
    { useCase: "UC-01", externalRef: "6", claimedAt: at(3, 600), decision: "auto_resolve", note: null },
    { useCase: "UC-02", externalRef: "8102", claimedAt: at(9, 700), decision: "human_review", note: null },
    { useCase: "UC-06", externalRef: "3001", claimedAt: at(21, 500), decision: "escalate", note: null },
    { useCase: "UC-04", externalRef: "4207", claimedAt: at(34, 300), decision: "blocked", note: null },
    { useCase: "UC-09", externalRef: "9005", claimedAt: at(52, 400), decision: "triple_approval_required", note: null },
    // Ticket #5 has ONE claim row and TWO audit rows: the claim ledger was
    // provisioned after the double delivery, so the ledger shows what stops a
    // recurrence while the audit rows show the original defect.
    { useCase: "UC-01", externalRef: "5", claimedAt: at(90), decision: "auto_resolve", note: "claimed on re-drive, after the ledger existed" },
  ];

  const opsAlerts = [
    {
      id: "33333333-3333-4333-8333-333333333301",
      at: at(118),
      useCase: "UC-01",
      workflowName: "UC-01 — Employment Verification",
      workflowId: "WORKFLOW_UC01_ID",
      executionId: "3645",
      executionUrl: "https://n8n.example.invalid/execution/3645",
      failedNode: "Reply + Solve Ticket",
      riskTier: "low",
      errorMessage: "Zendesk update failed: 404 RecordNotFound",
      auditDurable: true, // the decision row landed; only the Zendesk update was lost
      acknowledged: true,
    },
    {
      id: "33333333-3333-4333-8333-333333333302",
      at: at(47),
      useCase: "UC-05",
      workflowName: "UC-05 — Resignation Notice",
      workflowId: "WORKFLOW_UC05_ID",
      executionId: "4325",
      executionUrl: "https://n8n.example.invalid/execution/4325",
      failedNode: "Money Arithmetic",
      riskTier: "medium",
      errorMessage: "TypeError upstream of the audit write — the request left no record",
      auditDurable: false, // the failure LOST the decision — this is the row to chase
      acknowledged: false,
    },
  ];

  return { auditLog, auditTrace, workflowClaims, opsAlerts };
}
