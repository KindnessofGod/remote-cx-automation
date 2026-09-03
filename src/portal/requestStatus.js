// ---------------------------------------------------------------------------
// requestStatus.js  —  "What happened to my request?", in one vocabulary
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The portal submits into seven different workflows, each of which owns its own
// store, its own status column and its own vocabulary for the same idea. A
// flagged expense is `flagged`; a workation awaiting its specialist is
// `pending_specialist_approval`; a resignation awaiting HR Ops is
// `pending_signoff`; an adjustment awaiting its approval floor is
// `pending_approval`. Those are the right names inside their own use cases and
// they are useless to the person who filed the request, who is asking one
// question: has a human looked at this yet, and what did they say?
//
// So this file translates each store's own row into ONE small vocabulary, in
// one place. It is pure — a row in, a description out, no I/O, no store, no
// http — for the same reason every policy module in this repo is
// (CLAUDE.md §9), and because the alternative is seven copies of this mapping
// scattered through the page and the server.
//
// WHAT IT MUST NOT DO, AND THE FAILURE IT IS GUARDING AGAINST
// It must never invent a status. Two use cases genuinely cannot answer the
// question — UC-07 and UC-08 are 🔴 with no execution path at all, so there is
// no human decision for their dossiers to be waiting on and never will be
// (`handleRelocationReview()`/`handleTaxInquiry()` take no write-capable
// client; their stores have one write method and zero mutations). Reporting
// those as "awaiting review" would be a lie the portal tells in the direction
// that looks reassuring, and it would eventually be believed. They report
// `no_decision_path` and say why.
//
// A row this file does not recognise likewise reports `unknown` rather than
// falling through to a plausible default. "We do not know" and "nothing has
// happened yet" are different facts and only one of them is safe to act on —
// the same rule src/portal/server.js's UC-05 adapter already applies to a
// missing PTO rate (finding F-30).
//
// THIS FILE HOLDS NO POLICY. Nothing here decides whether an action is
// permitted; that lives in each use case's own policy module and is enforced
// server-side (src/uc02/reviewPolicy.js, src/uc04/approvalPolicy.js, …).
// `awaitingRole` below is a LABEL for the reader, exactly as
// requestTypes.js's `tier` is. If this file were deleted, no gate anywhere
// would behave differently.
// ---------------------------------------------------------------------------

/**
 * The portal's own small vocabulary. Ordered roughly from "finished on its own"
 * through "a human owns it" to "we cannot say".
 */
export const STATES = Object.freeze({
  AUTO_RESOLVED: "auto_resolved",
  AWAITING_REVIEW: "awaiting_review",
  ON_HOLD: "on_hold",
  APPROVED: "approved",
  DECLINED: "declined",
  EXECUTED: "executed",
  BLOCKED: "blocked",
  ESCALATED: "escalated",
  NO_DECISION_PATH: "no_decision_path",
  UNKNOWN: "unknown",
});

/**
 * @typedef {object} RequestStatus
 * @property {string} state       one of STATES
 * @property {string} label       one short phrase for a badge
 * @property {string} detail      one plain-English sentence: what this means
 * @property {string|null} decidedBy   the human who decided, when one has
 * @property {string|null} decidedAt   ISO timestamp of that decision
 * @property {string|null} note        their note/reason, when they left one
 * @property {string|null} awaitingRole  who it is sitting with (a LABEL)
 * @property {string|null} storeStatus   the use case's own raw status, shown
 *   verbatim so nothing is hidden behind the translation
 */

/**
 * Describe one stored record in the portal's vocabulary.
 *
 * @param {string} typeId  the portal's route segment: "uc02" … "uc09"
 * @param {object|null} row  the record as its own store returns it
 * @returns {RequestStatus}
 */
export function describeStatus(typeId, row) {
  if (!row) {
    return unknown("The record could not be read back. It may have been decided in another process.");
  }
  const describe = DESCRIBERS[typeId];
  if (!describe) {
    return unknown(`No status reader exists for ${typeId}.`);
  }
  return describe(row);
}

// ---------------------------------------------------------------------------
// round-6 D-06 — a gate's REASON, in words a requester can read
// ---------------------------------------------------------------------------
// Every describer below used to interpolate `row.reason` straight into a
// sentence — `over_policy_cap`, `destination_unknown`, `letter_scope_exceeded`
// — this project's own gate vocabulary, read raw off a page otherwise written
// for the person who filed the request. `reasonLabel()` is the one place that
// stops, for every reason code any of the seven stores can ever write, not
// only the handful that happened to be caught: REASON_LABELS carries a plain
// phrase for every code this repository's policy engines are known to return
// (see the label beside each), and `humanize()` is the fallback for any code
// this table has not been told about yet — a mechanical transform, never a
// meaning, so a future reason still reaches the page as words rather than as
// a slug nobody added a translation for.
//
// USED BOTH HERE (inside the sentences below) and by src/portal/server.js's
// myRequestView(), which reads it to give "My requests" a `reasonLabel` field
// distinct from the raw `reason` — the raw code still travels on the record
// and in `audit_log`, where a specialist searches by it; it is only the
// requester-facing SENTENCE and TABLE CELL that never print it bare.
const REASON_LABELS = {
  all_gates_passed: "every check passed",
  self_service_all_gates_passed: "every check passed automatically",
  over_policy_cap: "the amount is over the policy cap",
  expense_employment_mismatch: "the expense does not match this employment",
  expense_not_found: "the expense record could not be found",
  expense_not_pending: "the expense was already decided",
  expense_date_invalid: "the expense date is invalid",
  category_unverified: "the expense category could not be confirmed",
  missing_receipt_evidence: "no receipt was on file",
  duplicate_submission: "this looks like a repeat of an earlier submission",
  destination_unknown: "the destination could not be determined from what was asked",
  letter_scope_exceeded: "this asks for more than the standard letter can say",
  work_authorization_requested: "this was really a work-authorization question",
  standard_letter_issued: "the standard letter was issued",
  formal_letter_requested: "a formal, non-standard letter was asked for",
  low_confidence: "the request could not be read confidently enough to answer automatically",
  non_standard_request: "this is not a standard request this system can answer on its own",
  out_of_scope: "this is outside what this system can decide",
  over_scope_request: "more was asked for than the standard answer covers",
  over_scope_undetermined: "whether extra information was asked for could not be determined",
  travel_history_unreadable: "the travel history could not be read",
  same_country_workation: "the trip does not cross a border",
  sanctioned_region: "the destination is a sanctioned region",
  destination_out_of_scope: "the destination is outside what this system covers",
  destination_jurisdiction_excluded: "the destination is excluded from this coverage",
  employer_permission_not_granted: "the employer has not granted permission for this",
  ca_requires_work_permit: "a work permit is required for Canada",
  us_requires_work_permit: "a work permit is required for the United States",
  visitor_visa_active_work_forbidden: "a visitor visa does not permit this work",
  risk_matrix_blocked: "this route is blocked outright",
  duration_over_cap: "the trip is longer than this system can clear automatically",
  duration_unknown: "the length of the trip could not be determined",
  unparseable_date: "a date on this request could not be read",
  start_in_past: "the start date is in the past",
  end_before_start: "the end date is before the start date",
  employee_not_active: "the employment record is not active",
  employment_not_active: "the employment record is not active",
  identity_not_verified: "the requester's identity could not be verified",
  third_party_request: "this is a disclosure request from an outside party",
  awaiting_employee_consent: "waiting on the employee to say whether this may be disclosed",
  consent_refused: "the employee declined to consent to this disclosure",
  unsupported_country: "this system has no rule on file for that country",
  no_statutory_notice_period: "that country sets no statutory minimum notice",
  no_matching_notice_bracket: "no matching notice bracket was found",
  // NOT "the contract and the statute disagree on the notice owed", which is
  // what this said and which alleges an unlawful contract term nobody checked.
  // NO CONTRACT IS READ ANYWHERE IN THIS SYSTEM and it says so itself in three
  // places — src/uc05/decisionFacts.js ("this system does not hold contracts and
  // has not read one"), src/uc05/policyEngine.js's gate 5 `means`, and the
  // report this use case issues. What the gate actually compares is the
  // employee's own PROPOSED last working day against the statutory end date
  // (src/uc05/policyEngine.js: `notice.discrepancy === "earlier_than_statutory"`),
  // and the shortfall in days is on the case as a flag. That is a fact about
  // one date somebody typed; the old phrasing turned it into an accusation
  // about the employer's paperwork, printed to the resigning employee.
  statutory_discrepancy: "the leaving date proposed is earlier than the statutory notice period allows",
  missing_seniority_date: "the record has no seniority date to calculate from",
  pto_balance_unusable: "the recorded time-off balance cannot be used",
  no_remote_work_authorization_request: "no matching work-authorization request exists at Remote",
  cutoff_lock_passed: "the payroll cutoff for this cycle has already passed",
  cutoff_date_unknown: "the payroll cutoff date could not be determined",
  no_matching_payroll_cycle: "no payroll cycle covers this date",
  ambiguous_payroll_cycle: "more than one payroll cycle could match this date",
  amendment_contract_unavailable: "the contract record needed for this amendment is unavailable",
  change_not_expressible: "this change cannot be expressed in the record's own fields",
  change_value_underivable: "the new value could not be derived",
  country_schema_unavailable: "this country's form could not be read",
  currency_conversion_unverified: "the currency conversion could not be confirmed",
  policy_cap_currency_mismatch: "the policy cap is in a different currency than the amount",
  policy_cap_unknown: "no policy cap is on file for this",
  confidence_unknown: "how confident this reading is could not be determined",
  schema_invalid: "the submission does not match this country's required form",
  invalid_date: "a date on this request is invalid",
  invalid_amount: "the amount on this request is invalid",
  factors_invalid: "one or more required details were invalid",
  invalid_adjustment_structure: "the adjustment is not structured correctly",
  adjustment_needs_approval: "this adjustment needs approval before it can be paid",
  standard_adjustment_needs_dual_approval: "this needs two approvals before it can be paid",
  high_risk_adjustment_needs_triple_approval: "this needs three approvals before it can be paid",
  high_risk_pair: "this combination is treated as higher risk",
  tax_exceeds_amount: "the tax withheld would exceed the amount",
  eor_status_unknown: "this employment's EOR status could not be determined",
  engagement_not_eor_contractor: "this engagement is not an EOR contractor engagement",
  engagement_not_eor_direct: "this engagement is not a direct EOR engagement",
  engagement_offboarding: "this employment is already in offboarding",
  engagement_onboarding_incomplete: "this employment's onboarding is not yet complete",
  incomplete_employment_record: "the employment record is missing information this needs",
  upstream_record_not_found: "Remote has no matching record for this",
  upstream_unavailable: "Remote could not be reached to answer this",
  remote_write_failed: "the write to Remote did not succeed",
  work_authorization_patched: "the work-authorization record was updated",
  decision_carries_no_remote_verdict: "this decision carries no verdict from Remote",
  artifact_present: "something was attached to this request",
  conversion_identity_mismatch: "the identity on the conversion did not match",
  self_service_available: "this can be handled without a specialist",
};

/**
 * A human phrase for a gate's reason code, or null for none. NEVER the raw
 * code — see the header directly above.
 *
 * @param {string|null|undefined} reason
 * @returns {string|null}
 */
export function reasonLabel(reason) {
  if (reason === null || reason === undefined || reason === "") return null;
  const known = REASON_LABELS[reason];
  if (known) return known;
  return humanize(reason);
}

/** The mechanical fallback — never a meaning, only a shape: no more underscores. */
function humanize(code) {
  const spaced = String(code).replace(/_/g, " ").trim();
  if (!spaced) return null;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Use cases whose records can never carry a human decision — see the header. */
export const NO_DECISION_PATH_TYPES = Object.freeze(["uc07", "uc08"]);

const DESCRIBERS = {
  // --- UC-01: the self-service letter. No human slot at all — a case only
  // ever exists here once issueSelfServiceLetter() has ALSO written and
  // issued the letter in the same call, so "resolved" is the only status this
  // store's rows are ever written with (src/uc01/selfServiceLetter.js). The
  // document itself is attached below, in src/portal/server.js's my-requests
  // route, the same way UC-03's is.
  uc01(row) {
    switch (row.status) {
      case "resolved":
        return state(STATES.AUTO_RESOLVED, "Issued", "Every gate passed, so your employment verification letter was issued immediately with nobody in the path. Open or save it below.", { storeStatus: row.status });
      default:
        return unknown(`UC-01 reported a status this page does not recognise: ${row.status}`, row.status);
    }
  },

  // --- UC-02, and the only one with a THREE-state human slot ---------------
  // `held` is the third: a Finance Ops specialist parked the expense without
  // writing anything to Remote, so it is neither decided nor untouched. A
  // vocabulary with only "waiting" and "decided" would have to round it to one
  // of those, and both roundings mislead the person waiting for their money.
  uc02(row) {
    const decided = { decidedBy: row.reviewer ?? null, decidedAt: row.reviewedAt ?? null, note: row.reviewNote ?? null };
    switch (row.status) {
      case "auto_approved":
        return state(STATES.AUTO_RESOLVED, "Approved automatically", "Every gate passed, so the expense was approved at Remote with no human involved.", { storeStatus: row.status });
      case "flagged":
        return state(STATES.AWAITING_REVIEW, "With Finance Ops", `Flagged for a human (${reasonLabel(row.reason) ?? "an exception"}). A Finance Ops specialist will approve, decline or hold it.`, { awaitingRole: "Finance Ops", storeStatus: row.status });
      case "held":
        return state(STATES.ON_HOLD, "On hold", "A Finance Ops specialist parked this pending more information. Nothing has been written to Remote; it can still be approved or declined.", { awaitingRole: "Finance Ops", storeStatus: row.status, ...decided });
      // `released` is the legacy spelling of `approved` and is still matched
      // here, deliberately. ExpenseStore.normalizeRow() canonicalises a row it
      // reads from Postgres, so in practice this arm catches a row that
      // reached this function WITHOUT passing through the store — a caller
      // holding a raw query result, or an in-memory row from a process that
      // predates the rename. Falling through to unknown() would tell an
      // employee their reimbursement's status could not be read, for an expense
      // that was approved; two such rows are live. See
      // src/uc02/reviewPolicy.js's STATUS_ALIASES.
      case "approved":
      case "released":
        return state(STATES.APPROVED, "Approved", "A Finance Ops specialist cleared the exception and the expense was approved at Remote.", { storeStatus: row.status, ...decided });
      case "declined":
        return state(STATES.DECLINED, "Declined", "A Finance Ops specialist declined the expense at Remote, with the reason shown.", { storeStatus: row.status, ...decided });
      case "blocked":
        return state(STATES.BLOCKED, "Blocked", `Refused by a hard gate (${reasonLabel(row.reason) ?? "see the decision"}) — this is not an exception awaiting a human.`, { storeStatus: row.status });
      case "escalated":
        return state(STATES.ESCALATED, "Escalated", `Escalated (${reasonLabel(row.reason) ?? "see the decision"}) rather than routed to the Finance Ops queue.`, { storeStatus: row.status });
      default:
        return unknown(`UC-02 reported a status this page does not recognise: ${row.status}`, row.status);
    }
  },

  // --- UC-03: a router. Its "human" state is a specialist issuing a letter,
  // which happens outside this system — there is no write route in
  // src/uc03/server.js at all, so nothing here can report who did it.
  uc03(row) {
    switch (row.status) {
      case "resolved":
        return state(STATES.AUTO_RESOLVED, "Answered", "The question was plainly safe to answer, so it was answered and closed with no human involved.", { storeStatus: row.status });
      case "pending_review":
        return state(STATES.AWAITING_REVIEW, "With a specialist", "A formal travel letter was drafted but is never sent without a specialist's sign-off.", { awaitingRole: "Travel specialist", storeStatus: row.status });
      case "routed":
        return state(STATES.ESCALATED, "Routed to UC-04", "This was really a work-authorisation question, so it was handed to the mobility flow rather than answered here.", { storeStatus: row.status });
      case "escalated":
        return state(STATES.ESCALATED, "Escalated", `Escalated (${reasonLabel(row.reason) ?? "see the decision"}) rather than answered.`, { storeStatus: row.status });
      default:
        return unknown(`UC-03 reported a status this page does not recognise: ${row.status}`, row.status);
    }
  },

  // --- UC-04: one named mobility specialist (not dual — UC-04.md §1/§8).
  uc04(row) {
    switch (row.status) {
      // THREE PARTIES DECIDE, AND THIS DESCRIBER CAN ONLY SEE TWO OF THEM
      // (corrected 2026-08-31). `uc04_authorizations` records stage 1 (the
      // employee files) and stage 2 (the customer's own manager approves or
      // declines — the only work-authorization decision Remote's API accepts).
      // Stage 3, Remote's own mobility review, has no column and lives in
      // `audit_log`; src/portal/server.js's "My requests" route reads it and
      // attaches it as `stages`. So every sentence here is scoped to the
      // employer's decision and says so, rather than describing the request as
      // finished when one stage is still outstanding.
      //
      // WHAT THESE SENTENCES USED TO SAY, and why both halves were wrong: "One
      // named mobility specialist approves or denies it in the ZAF sidebar" —
      // that was stage 2 attributed to stage 3's actor, the exact confusion the
      // 2026-08-30 correction unpicked; and "the work authorisation was issued
      // at Remote", which is true only when a Remote request was linked, and is
      // false for every request filed through this portal (there is no
      // `POST /v1/work-authorization-requests` to have created one).
      case "pending_specialist_approval":
        return state(STATES.AWAITING_REVIEW, "With your manager", "Risk-scored and prepared. Your employer's own manager approves or declines the trip in Remote's product — that is the only work-authorisation decision Remote's API accepts, and the AI never makes it.", { awaitingRole: "The customer's approving manager", storeStatus: row.status });
      case "approved_pending_execution":
        return state(STATES.APPROVED, "Approved by your manager", "Your employer's manager approved it; the decision is being recorded.", { storeStatus: row.status, decidedBy: row.approver ?? null, decidedAt: row.approvedAt ?? null, note: row.approvalNote ?? null });
      case "executed":
        return state(
          STATES.EXECUTED,
          "Approved by your manager",
          // READ OFF THE ROW, NOT ASSUMED. `remoteResult.transmitted` is what
          // src/uc04/workflow.js records, and it is false whenever no Remote
          // work-authorization request was linked — which is every portal-filed
          // request. Saying "issued at Remote" over that was a claim about a
          // system this decision never touched.
          row.remoteResult?.transmitted === true
            ? "Your employer's manager approved it and the work-authorisation request was updated at Remote. Remote's own mobility review is a separate stage — see below."
            : "Your employer's manager approved it, and the approval is recorded here. There was no Remote work-authorisation request behind this trip to update. Remote's own mobility review is a separate stage — see below.",
          { storeStatus: row.status, decidedBy: row.approver ?? null, decidedAt: row.approvedAt ?? null, note: row.approvalNote ?? null }
        );
      // THE EMPLOYER'S OWN VERDICT, AS /remoteui's SCREEN WRITES IT (stage 2).
      // `approved_by_manager` / `declined_by_manager` are Remote's own enum
      // members, stored VERBATIM by AuthorizationStore.recordEmployerDecision()
      // — EMPLOYER_DECISION_STATUSES' header argues why the strings are
      // Remote's and not ours, and canonicalDecisionStatus() leaves them alone
      // because only `denied` is an alias.
      //
      // THIS DESCRIBER KNEW `executed` AND NOT THESE, so every trip a manager
      // approved on that screen rendered "Unknown" in the one column the
      // requester reads — beside a `stages` block on the SAME ROW that named
      // the approver and the minute. Observed live on the deployment
      // 2026-09-01, on two real records: `state: "unknown"`, `decidedBy: null`,
      // next to `employer: {approved: true, approver: "admin_jane", at: …}`.
      // The decline half had the same hole and no row had reached it yet.
      //
      // WHY NOT FOLD THESE INTO `executed` AND `declined` BELOW. The `executed`
      // branch says "There was no Remote work-authorisation request behind this
      // trip to update" whenever `remoteResult.transmitted` is not true — a
      // claim ABOUT REMOTE, and one it is entitled to make because the
      // execution step ran and recorded what it found. recordEmployerDecision()
      // writes no `remoteResult` at all, so the identical test would silently
      // turn "this path never attempted an update" into "there was nothing to
      // update". Different facts, and the second is not one these rows carry.
      // Stage 3 is described by the `stages` block beside this, so the sentence
      // stops where the row's own evidence stops.
      case "approved_by_manager":
        return state(
          STATES.EXECUTED,
          "Approved by your manager",
          "Your employer's manager approved it, and the approval is recorded here. Remote's own mobility review is a separate stage — see below.",
          { storeStatus: row.status, decidedBy: row.approver ?? null, decidedAt: row.approvedAt ?? null, note: row.approvalNote ?? null }
        );
      case "declined_by_manager":
        // The decline slot, not the approval slot — recordEmployerDecision()
        // writes `denied_by`/`denied_at` for a decline and leaves `approver`
        // untouched, so reading the approval slot here would report nobody.
        return state(
          STATES.DECLINED,
          "Declined by your manager",
          "Your employer's manager declined this request.",
          { storeStatus: row.status, ...fromSlot(row.declinedBy ?? row.deniedBy, row.declinedAt ?? row.deniedAt) }
        );
      // BOTH SPELLINGS. The stored verb moved `denied` -> `declined` on
      // 2026-08-19 (src/shared/declineVocabulary.js). The stores canonicalise
      // on read, so `denied` should never reach here from Postgres — it is
      // matched anyway because this page also renders in-memory rows and rows
      // from a deployment that has not been redeployed, and an unrecognised
      // status renders as "we cannot say", which would be a worse answer than
      // the true one for a request that WAS decided.
      case "declined":
      case "denied":
        return state(STATES.DECLINED, "Declined", "Your employer's manager declined this request.", { storeStatus: row.status, ...fromSlot(row.declinedBy ?? row.deniedBy, row.declinedAt ?? row.deniedAt) });
      case "blocked":
        return state(STATES.BLOCKED, "Blocked", `Refused by a hard gate (${reasonLabel(row.reason) ?? "see the decision"}) — a sanctioned destination or a Schengen/US-CA block is never routed to a human.`, { storeStatus: row.status });
      case "escalated":
        return state(STATES.ESCALATED, "Escalated", `Escalated (${reasonLabel(row.reason) ?? "see the decision"}).`, { storeStatus: row.status });
      default:
        return unknown(`UC-04 reported a status this page does not recognise: ${row.status}`, row.status);
    }
  },

  // --- UC-05: one HR Ops sign-off, and it approves a REPORT, not a write.
  // No confirmed Remote termination endpoint exists, so "signed off" is the
  // end of the line here rather than a step before an execution.
  uc05(row) {
    switch (row.status) {
      case "pending_signoff":
        return state(STATES.AWAITING_REVIEW, "With HR Ops", "The statutory notice and PTO payout have been calculated. HR Ops confirms the report is correct — that signed-off report is the artifact; there is no Remote write behind it.", { awaitingRole: "HR Ops", storeStatus: row.status });
      case "signed_off":
        return state(STATES.APPROVED, "Signed off", "HR Ops confirmed the calculated notice period and payout.", { storeStatus: row.status, ...fromSlot(row.signedOffBy, row.signedOffAt) });
      case "declined":
      case "denied": // pre-2026-08-19 spelling; see the UC-04 note above
        return state(STATES.DECLINED, "Returned", "HR Ops did not sign the report off.", { storeStatus: row.status, ...fromSlot(row.declinedBy ?? row.deniedBy, null) });
      case "escalated":
        return state(STATES.ESCALATED, "Escalated", `Escalated (${reasonLabel(row.reason) ?? "see the decision"}) rather than prepared for sign-off.`, { storeStatus: row.status });
      default:
        return unknown(`UC-05 reported a status this page does not recognise: ${row.status}`, row.status);
    }
  },

  // --- UC-07 and UC-08: 🔴, no execution path. See the header. These do not
  // report "awaiting review", because nothing is waiting and nothing ever
  // will be: there is no approve route, no mutation method, and no
  // write-capable dependency in either workflow's signature.
  uc07: () => noDecisionPath("relocation feasibility dossier", "a Mobility Legal specialist"),
  uc08: () => noDecisionPath("cross-border tax dossier", "a tax specialist"),

  // --- UC-09: the one 🔴-framed use case that really can move money, behind a
  // floor-of-2 multi-role approval.
  uc09(row) {
    const filled = [row.requesterApproval, row.approverApproval, row.paymentReleaserApproval].filter(Boolean).length;
    const required = row.approvalSlotsRequired ?? 2;
    switch (row.status) {
      case "pending_approval":
        return state(STATES.AWAITING_REVIEW, "Awaiting approvals", `${filled} of ${required} required approvals are recorded. No money moves until every slot is filled — the floor is two people, always.`, { awaitingRole: "Payroll approvers", storeStatus: row.status });
      case "executing":
        return state(STATES.APPROVED, "Approved", `All ${required} approvals are recorded and the adjustment is being submitted to Remote.`, { storeStatus: row.status });
      case "executed":
        return state(STATES.EXECUTED, "Paid", `All ${required} approvals were recorded and the adjustment was created at Remote.`, { storeStatus: row.status });
      // UC-09 still writes `denied`: its files were owned by another change
      // when the verb moved. Both are matched so it renders correctly either
      // way, and the sentence is written in the neutral past tense.
      case "declined":
      case "denied":
        return state(STATES.DECLINED, "Declined", "An approver declined this adjustment; nothing was paid.", { storeStatus: row.status, ...fromSlot(row.declinedBy ?? row.deniedBy, null) });
      case "escalated":
        return state(STATES.ESCALATED, "Escalated", `Escalated (${reasonLabel(row.reason) ?? "see the decision"}) rather than opened for approval.`, { storeStatus: row.status });
      default:
        return unknown(`UC-09 reported a status this page does not recognise: ${row.status}`, row.status);
    }
  },
};

function state(stateName, label, detail, extra = {}) {
  return {
    state: stateName,
    label,
    detail,
    decidedBy: null,
    decidedAt: null,
    note: null,
    awaitingRole: null,
    storeStatus: null,
    ...extra,
  };
}

function unknown(detail, storeStatus = null) {
  return state(STATES.UNKNOWN, "Unknown", detail, { storeStatus });
}

/**
 * The 🔴 answer, and it is a real answer rather than an absence. Note what it
 * does NOT set: `awaitingRole` stays null, because nothing in this system is
 * waiting on anybody — the specialist works the dossier outside it.
 */
function noDecisionPath(what, who) {
  return state(
    STATES.NO_DECISION_PATH,
    "Compiled for review",
    `This is a ${what}, and it is where the automation stops by design: there is no approve, decline or execute path anywhere in this system for it, so no status here will ever change. ${capitalise(who)} reads the dossier and acts outside this system.`
  );
}

/**
 * Several stores record a decision as a `{approver, note, at}` SLOT rather than
 * as three columns (UC-05's signedOffBy/declinedBy, UC-04's declinedBy,
 * UC-09's deniedBy — still the old field name, see its case above). Read it in
 * one place so a shape change breaks once.
 */
function fromSlot(slot, fallbackAt) {
  if (!slot || typeof slot !== "object") {
    return { decidedBy: null, decidedAt: fallbackAt ?? null, note: null };
  }
  return {
    decidedBy: slot.approver ?? null,
    decidedAt: slot.at ?? fallbackAt ?? null,
    note: slot.note ?? null,
  };
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Where the answer to "so what happened to it?" will appear.
 *
 * WHY THIS EXISTS. A requester filed an over-cap expense, was told a Finance
 * Ops specialist would review it, and never saw the outcome. Nothing was
 * broken: the specialist approved it, the row read `status: approved` with the
 * reviewer recorded, and `listByOwner()` would have returned it. **"My
 * requests" is simply a separate nav item, and no submission result pointed at
 * it.** A gate whose outcome the requester cannot observe is only half a gate
 * (this file's own header makes that point about the store; this makes it
 * about the navigation).
 *
 * DECIDED HERE, NOT IN THE BROWSER, for the same reason every other sentence
 * on that page is: the page renders what it is given. It also means the
 * wording moves in one place when a use case renames one of its verbs.
 *
 * IT IS A POINTER, NEVER A CONTROL. The caller renders a link to the existing
 * "My requests" view — it does not duplicate status rendering into the result
 * panel, and it emphatically does not offer anything that could decide a
 * request. The portal is an intake surface; the human gate lives in the ZAF
 * sidebar and each use case's own approval endpoint.
 *
 * @param {object} args
 * @param {string|null} args.decision       the decision the workflow returned
 * @param {string} args.executionPath       requestTypes.js's `executionPath`
 * @param {string|null} args.recordId       the stored record's id, when there is one
 * @param {string} args.recordLabel         requestTypes.js's `recordLabel`
 * @returns {{show:boolean, awaitingHuman:boolean, label:string, sentence:string}}
 */
export function trackingHint({ decision, executionPath, recordId, recordLabel }) {
  // No record means nothing to look up — a refusal before the workflow ever
  // ran, for instance. Pointing at a list that will not contain it would be
  // worse than saying nothing.
  if (!recordId) {
    return { show: false, awaitingHuman: false, label: "My requests", sentence: "" };
  }

  const noun = String(recordLabel || "record").toLowerCase();

  // A 🔴 use case has no execution path at all, so nobody is "deciding" it
  // here — the dossier is the outcome, and it is still worth being able to
  // reopen.
  if (executionPath === "none") {
    return {
      show: true,
      awaitingHuman: false,
      label: "My requests",
      sentence: `Your ${noun} is saved. Open “My requests” to read it again at any time — it is the same record a specialist works from.`,
    };
  }

  // FINISHED AT SUBMISSION TIME vs. WAITING ON A PERSON. These three are the
  // outcomes that are over the moment they are returned: the automation
  // resolved it, or a hard gate stopped it. Everything else — every
  // `human_review`, every `*_approval_required`, every `escalate` — means
  // somebody still has to act, and that is the case the requester was left
  // with no route for.
  const finished = FINISHED_ON_SUBMISSION.has(String(decision));

  return {
    show: true,
    awaitingHuman: !finished,
    label: "My requests",
    sentence: finished
      ? `This is already final. Open “My requests” to see it, and anything else you have filed, in one place.`
      : // "A person now has to decide this" came off the front of this sentence
        // (2026-08-20). The plain answer at the top of the same panel now names
        // WHO has it and what they will do with it — src/portal/plainAnswer.js
        // — so this line restated it four sections later in weaker words. What
        // is left is the half only this pointer can carry: where the answer
        // turns up, and that nothing will come and tell them.
        //
        // round-6 D-07: this used to say "...is where THEIR answer will
        // appear... nothing else will notify YOU" — third person and second
        // person about the same reader in one sentence, because the sentence
        // was drafted once and read from outside. The reader of this panel is
        // always the person who filed the request it describes — there is no
        // "their" here that is not "your".
        `“My requests” is where your answer will appear — this page will not update by itself, and nothing else will notify you.`,
  };
}

/**
 * Decisions that are over the instant they are returned. Deliberately a small
 * explicit list rather than "anything that is not human_review": a use case
 * that adds a new waiting decision should default to SHOWING the requester
 * where to look, not to silently omitting it.
 */
const FINISHED_ON_SUBMISSION = new Set(["auto_resolve", "auto_approve", "blocked"]);

// ---------------------------------------------------------------------------
// round-6 D-08 — the Zendesk hand-off note, on the REQUESTER'S OWN screen
// ---------------------------------------------------------------------------
// src/portal/server.js's raiseTicketIfNeeded() and handOffLetterRequest()
// used to compose these seven sentences inline, and every one of them reaches
// the requester's own result panel VERBATIM — src/portal/assets/app.js renders
// `payload.ticketNote` with no filter, no transform, no allowlist between
// composition and the screen. Composed here instead, for the reason this
// file's header gives for the DESCRIBERS above: a leak is caught at
// composition, and a leak composed inline — never exported, never imported by
// a guard — is a leak nothing can see. This is what closes that gap: these
// seven are now real exports test/requesterVocabulary.test.js can drive
// directly, the same as reasonLabel() and trackingHint() above.
//
// THIS IS NOT THE SPECIALIST'S NOTE. buildTicketNote() (src/portal/server.js)
// is a different function, writing a different string, to a different reader
// — the internal Zendesk comment a specialist opens the ticket to read, which
// may correctly name a use case, a policy field, this project's own tooling.
// Nothing here is shared with it, and nothing here may borrow its register:
// nobody reading their own result page can open this repository, run a
// script, or find "the ZAF sidebar" — nor should they need to.
// ---------------------------------------------------------------------------

/** No new decision was made — a redelivery under a reference already handled. */
export function ticketHandoffAlreadyHandled() {
  return "This had already been handled, so nothing new was decided — there is nothing new to raise with anyone. Whatever your first submission raised still stands.";
}

/**
 * No ticket was needed, for one of two structurally different reasons.
 * @param {{ticketable: boolean}} args  whether this request type ever raises
 *   a ticket at all (`TICKETABLE_TYPES.includes(typeId)`) — false only for the
 *   🔴 use cases with no execution path and nobody deciding anything here.
 */
export function ticketHandoffNotNeeded({ ticketable }) {
  return ticketable
    ? "No Zendesk ticket: this decision needs no human, so there was nothing to raise for review."
    : "No Zendesk ticket: this use case has no execution path — the dossier itself is the hand-off, and a specialist reviews it directly.";
}

/** A human must review this, but no Zendesk integration is turned on here. */
export function ticketHandoffNoZendeskConfigured() {
  return "This needs a person to review it, and normally a ticket would be raised for that — but ticket creation is not turned on right now. Your submission and its record are saved either way.";
}

/**
 * @param {{ticketId: string, group: string, priority: string, dueAt: string|null}} args
 */
export function ticketHandoffAssigned({ ticketId, group, priority, dueAt }) {
  return `Raised Zendesk ticket #${ticketId} and assigned it to ${group} (priority ${priority}${dueAt ? `, due ${dueAt}` : ""}). Quote that ticket number if you follow up.`;
}

/**
 * The ticket was raised but nobody's queue owns it yet — `skippedReason` is
 * `raiseTicketIfNeeded()`'s own account of why, so it is passed through
 * rather than composed again here. The tag list is NOT repeated in THIS
 * sentence — it already travels on `ticketTags`, the structured field beside
 * it, the same ROUTED-NOT-DELETED split UC-02's category id uses.
 *
 * `skippedReason` ITSELF is not yet held to that same split: on one branch
 * (src/portal/server.js's `assignment` object, near the comment naming
 * `resolveGroupAssignment()` as "its own unit of work with its own tests") it
 * can still carry `handoff.tags.join(", ")` and `type.useCase` verbatim —
 * a real, live leak this file's own guard test now names rather than papering
 * over (test/requesterVocabulary.test.js's coverage of this function uses a
 * clean stand-in for exactly this reason). Fixing that composition site is
 * out of scope here: it is shared with the audit and queue viewers, which
 * DO need the team name and use-case code it carries.
 * @param {{ticketId: string, skippedReason: string}} args
 */
export function ticketHandoffUnassigned({ ticketId, skippedReason }) {
  return `Raised Zendesk ticket #${ticketId}, but it is UNASSIGNED. ${skippedReason}`;
}

/** The decision is durable; the Zendesk hand-off itself failed. */
export function ticketHandoffCreationFailed() {
  return "This decision needs a human, but the Zendesk ticket could not be created. The decision and its audit row ARE recorded — only the hand-off to a person failed, and that failure has been recorded too so it can be followed up.";
}

/**
 * Unreachable while requestTypes.js carries a uc03 row — a defensive fallback
 * for handOffLetterRequest(), kept in an audience-safe register anyway,
 * because "unreachable today" is not a promise it stays that way.
 */
export function ticketHandoffNoRequestType() {
  return "No Zendesk ticket could be raised for this. Your letter decision is still recorded.";
}

// ---------------------------------------------------------------------------
// THE BANNER ABOVE THE LIST — "has anything happened since I last looked?"
// ---------------------------------------------------------------------------

/**
 * The one sentence that sits above "My requests", composed here rather than in
 * the route or in the browser, for the same reason every other sentence on this
 * surface is: one derivation, and it can be tested without a server.
 *
 * ONE ENTRY PER OUTCOME, NOT ONE PER REQUEST — and that is the whole change.
 * This used to enumerate every settled request, so eighteen decisions rendered
 * as `UC-04 — approved by your manager` eight times in a row, then `UC-02 —
 * approved` five times, inside a banner that wrapped to four lines. Read live
 * on the deployment 2026-09-01, where it was the longest thing on the page and
 * said the least.
 *
 * A TALLY, NOT A TRUNCATION, and the difference is the point. Every distinct
 * outcome still appears and the counts are exact, so this is shorter without
 * being a smaller claim — `assertsEveryDecision` below is the invariant, and
 * it is asserted by test rather than intended. Capping the list at the first N
 * would have been the version that quietly stops mentioning outcomes, which on
 * a page whose whole job is "what happened to mine" is a worse answer than a
 * long one.
 *
 * ORDERED BY COUNT, THEN ALPHABETICALLY, so the same history renders the same
 * way twice. Insertion order here is submission order, which would reshuffle
 * the banner every time an old request was decided.
 *
 * @param {Array<object>} requests  every request the page is about to show
 */
export function describeDecided(requests) {
  const settled = requests.filter((request) => request.settled);

  const tally = new Map();
  for (const request of settled) {
    const label = String(request.status?.label ?? "decided").toLowerCase();
    const key = `${request.useCase} — ${label}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const outcomes = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([outcome, count]) => ({ outcome, count, text: count === 1 ? outcome : `${outcome} (×${count})` }));

  const requestWord = requests.length === 1 ? "request" : "requests";
  const haveWord = settled.length === 1 ? "has" : "have";

  return {
    count: settled.length,
    total: requests.length,
    useCases: settled.map((request) => request.useCase),
    outcomes,
    // Empty rather than a heading for nothing — a banner that renders "0 of 3"
    // makes an absence look like a result.
    summary: settled.length
      ? `${settled.length} of your ${requests.length} ${requestWord} ${haveWord} been decided by a person: ` +
        `${outcomes.map((entry) => entry.text).join("; ")}.`
      : "",
  };
}
