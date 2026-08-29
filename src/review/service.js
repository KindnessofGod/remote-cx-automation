// ---------------------------------------------------------------------------
// service.js  —  What actually happens when a specialist clicks Approve/Deny
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// reviewPolicy.js decides whether an action is permitted; store.js reads rows.
// This file is the only place that does both plus the writes, and it is the
// 🟡 HITL half of the architecture made real: "AI prepares + risk-scores →
// human approves → execute".
//
// THE ORDER OF WRITES IS A DESIGN DECISION, NOT AN ACCIDENT
//
//   policy gate → freshness re-check → render → AUDIT → state → Zendesk
//
// The audit row is written BEFORE the state changes, and durably (it throws on
// failure). If the process dies between the two, history says "a human
// authorised this" while the case still reads `pending_review` — visibly
// inconsistent, detectable, and safely retryable, because the review row is
// still pending so a second click simply re-runs and appends a second audit
// row. Two attempts honestly recorded is the correct content of an append-only
// log. The other ordering fails in the direction that matters: a state change
// with no record of who authorised it, which is precisely the thing an audit
// log exists to make impossible.
//
// THE FRESHNESS RE-CHECK IS NOT A DUPLICATED GATE
// policyEngine.js already checked `employment.status === "active"` — when the
// ticket arrived. Approval happens later, sometimes days later, and an employee
// can be terminated in between. Re-reading the record at execution time asks a
// different question ("is this still true?") than the original gate asked ("was
// this true?"). Note it re-reads rather than re-deciding: it does not re-run
// the policy engine, so there is no second copy of the gates to drift.
// ---------------------------------------------------------------------------

import { describeRiskPosture } from "../shared/riskEngine.js";
import { evaluateCaseActionability, evaluateReviewAction, refuse } from "./reviewPolicy.js";
import { renderLetterHtml } from "../uc01/letter.js";
import { authorisableDisclosures, approvalMayDisclose } from "../uc01/disclosureFields.js";
import {
  describeDecidingGate,
  describeGateLadder,
  describeDecisionFacts,
  overScopeFieldsRequested,
} from "../uc01/policyEngine.js";

/**
 * Reasons `describeDecisionFacts()` can answer from `classification` alone.
 *
 * E3-F10. The rest of the switch in `describeDecisionFacts()` also reads
 * `employment` (`employee_not_active`, `incomplete_employment_record`,
 * `identity_not_verified`'s presence check) or `identity`
 * (`identity_not_verified`, `third_party_request`,
 * `awaiting_employee_consent`, `consent_refused`) — neither of which a
 * `cases` row carries (see the comment this replaces, still true of those
 * reasons: a `cases` row has no employment record and no identity object,
 * and passing `employment: null`/`identity: null` for THOSE reasons would
 * report facts a record was never checked against, e.g. every required
 * letter field as "missing" from a record that was simply never read).
 * `classification` IS on the row (`caseStore.js`'s `CASE_SELECT_COLUMNS`),
 * so the reasons below are safe: reading their case in
 * `describeDecisionFacts()` shows every fact they return comes from `c`
 * (the classification) alone, never `employment` or `identity`.
 */
const CLASSIFICATION_ONLY_FACT_REASONS = new Set([
  "artifact_present",
  "non_standard_request",
  "over_scope_undetermined",
  "over_scope_request",
  "confidence_unknown",
  "low_confidence",
]);

/**
 * Everything the sidebar needs to render one ticket, in one round trip.
 * @param {object} args
 * @param {string} args.ticketId  the Zendesk ticket id
 * @param {object} deps
 * @param {import("./store.js").PostgresReviewStore|import("./store.js").InMemoryReviewStore} deps.store
 * @returns {Promise<{found:boolean, case?:object, review?:object, documents?:object[]}>}
 */
export async function getReviewView({ ticketId }, { store }) {
  const caseRow = await store.findCaseByExternalRef(ticketId);
  if (!caseRow) return { found: false };

  const [reviewRow, documents] = await Promise.all([
    store.findReviewEntryByCaseId(caseRow.id),
    store.findDocumentsByCaseId(caseRow.id),
  ]);

  // Tell the sidebar what it may offer, rather than letting the UI re-derive
  // it from the case fields. A button that appears and then 403s is a worse
  // experience than one that never appears, and duplicating the rule in
  // browser JavaScript would be a second copy of the policy — the exact
  // mistake docs/BUILD-LOG.md records for the n8n gates. Note this asks only
  // "is the case actionable"; whether THIS agent may act is re-checked on
  // submit, so a stale or tampered-with UI can never widen what is permitted.
  const actionability = evaluateCaseActionability({ caseRow, reviewRow });

  return {
    found: true,
    case: caseRow,
    review: reviewRow,
    documents,
    // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. `tier` here has
    // always been the ESCALATED case risk — evaluateCaseActionability() gets it
    // from classifyRisk(), which raises a flagged 🟢 case to medium — and the
    // sidebar's rail copy was written for the use case's own tier. One field,
    // two meanings; on UC-04 that combination printed the 🔴 "no execution path
    // exists" guarantee above a working Approve button. See
    // src/shared/riskEngine.js's header. `tier` stays as the legacy alias for
    // `caseRisk`; nothing new should read it.
    ...describeRiskPosture(caseRow.useCase, caseRow.flags ?? []),
    tier: actionability.tier ?? null,
    actionable: actionability.allowed,
    actionableReason: actionability.reason,
    ...describeDecision(caseRow),
  };
}

/**
 * The reason slug in plain words, plus where it sits in the gate order.
 *
 * UC-01 WAS THE ONE USE CASE WHOSE VIEW SENT NEITHER, and it is the flagship:
 * `src/uc01/policyEngine.js` has exported both describers since the shared gate
 * ladder landed, six other servers already send them, and the sidebar rendered
 * `low_confidence` on its own here while the sentence explaining it sat one
 * import away. The slug is not replaced — it stays on the row as the exact
 * string in `audit_log`, in the metrics exception ranking and in the n8n port.
 *
 * SCOPED TO UC-01 DELIBERATELY. `cases` is a shared table and reason slugs are
 * not globally unique (`identity_not_verified` is a rung in several use cases'
 * sequences), so applying UC-01's GATE_SEQUENCE to another use case's row would
 * print a real-looking position from the wrong ladder. The Postgres store
 * already scopes its lookup to UC-01; this holds even if a caller does not.
 *
 * `decisionFacts` IS NOW SENT, but only for the reasons in
 * `CLASSIFICATION_ONLY_FACT_REASONS` (E3-F10). `describeDecisionFacts()`
 * derives its figures from the employment record, the classification and the
 * identity result, and this view holds only the second of the three — a
 * `cases` row carries no employment record and no identity object. Passing
 * `employment: null`/`identity: null` for a reason that needs either would
 * make e.g. the `incomplete_employment_record` bundle report all three
 * required letter fields as missing from a record it never read. A
 * fabricated fact list is worse than none, so this sends `decisionFacts`
 * only for the reasons whose whole bundle is built from `classification`
 * alone, and `null` for every other reason — same as before this fix.
 *
 * Both `decidedBy`/`gateLadder` degrade to null/[] for a reason with no row —
 * see src/shared/gateLadder.js.
 */
function describeDecision(caseRow) {
  if (!caseRow || caseRow.useCase !== "UC-01") return { decidedBy: null, gateLadder: [], decisionFacts: null };
  return {
    decidedBy: describeDecidingGate(caseRow.reason),
    gateLadder: describeGateLadder(caseRow.reason),
    decisionFacts: CLASSIFICATION_ONLY_FACT_REASONS.has(caseRow.reason)
      ? describeDecisionFacts({ reason: caseRow.reason, classification: caseRow.classification })
      : null,
  };
}

/**
 * Record and execute a specialist's decision on a case.
 *
 * @param {object} args
 * @param {string} args.ticketId   the Zendesk ticket the sidebar is open on
 * @param {string} args.action     "approve" | "decline" (`deny` accepted, legacy)
 * @param {string|null} args.approver  the Zendesk-authenticated agent
 * @param {string} [args.note]     free-text rationale, stored on review_queue
 * @param {object} deps
 * @param {import("./store.js").PostgresReviewStore|import("./store.js").InMemoryReviewStore} deps.store
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote  required for
 *   approve: the freshness re-check and the letter both read from it
 * @param {import("../zendesk/restClient.js").ZendeskClient|null} [deps.zendesk] when
 *   supplied, the outcome is posted back to the real ticket. Optional exactly as
 *   in workflow.js, so tests never reach a real Zendesk account by accident.
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST — see K10
 *   (qa/HUMAN-DECISIONS-REQUIRED.md, 2026-08-23).
 * @returns {Promise<{ok:boolean, status:number, code:string, reason:string, caseId?:string, letterIssued?:boolean}>}
 */
export async function submitReviewDecision(
  { ticketId, action, approver, note = "" },
  { store, caseStore, audit, remote, zendesk = null, entitlement = null }
) {
  const caseRow = await store.findCaseByExternalRef(ticketId);
  const reviewRow = caseRow ? await store.findReviewEntryByCaseId(caseRow.id) : null;

  const verdict = evaluateReviewAction({ caseRow, reviewRow, action, approver, note, entitlement });
  if (!verdict.allowed) {
    recordRefusal({ audit, caseRow, action, approver, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = approver.trim();

  // --- Approve only: is the underlying fact still true, and what gets issued?
  let letterHtml = null;
  let authorisedDisclosures = [];
  if (action === "approve") {
    const employment = await remote.getEmployment(caseRow.employmentId);
    if (!employment || employment.status !== "active") {
      const stale = refuse("employment_no_longer_active", { tier: verdict.tier });
      recordRefusal({
        audit,
        caseRow,
        action,
        approver: actor,
        verdict: stale,
        extraDetails: { observedStatus: employment?.status ?? "not_found" },
      });
      return { ok: false, status: stale.status, code: stale.code, reason: stale.reason };
    }
    // Reuses the SAME renderer as the auto path — but a human approval may now
    // reach further than the automation ever can, which is the point of there
    // being a human. Owner decision 2026-08-28.
    //
    // WHAT CHANGED, AND WHAT DID NOT. "Approve" used to mean *"issue the
    // STANDARD letter anyway"*: a requester asked for their salary, a
    // specialist pressed Approve, and the letter that went out was the same
    // salary-free document they would have got from a self-service click.
    // Nothing on the screen said so, and the reviewer surface deliberately
    // carried the field NAME and never the VALUE (rca-iih7 / D-16) — so the
    // specialist authorised a disclosure they could not see, and it had no
    // effect either way.
    //
    // Now an approval issues a CUSTOMIZED letter carrying the fields that were
    // asked for, which is Remote's own second document rather than an
    // extension of the first (docs/UC01-INTAKE-FIELDS.md §4). The standard
    // letter is untouched: `authorisedFields` is empty on every automatic
    // issuance and every self-service click, and renderLetterHtml() with an
    // empty list is byte-identical to what it has always produced.
    //
    // THE SET IS THE INTERSECTION OF THREE THINGS and this line cannot widen
    // it: what the classifier recorded the requester asking for, what
    // AUTHORISABLE_FIELDS will ever release, and what THIS record can actually
    // support. `note` is not consulted — a disclosure decided by prose is a
    // disclosure nobody can audit — and no value is typed by anyone: every one
    // is read from the employment record fetched three lines above.
    const legalEntity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);
    // E4-F17 (rca-0nm): the only path where the letter's requester is NOT the
    // employee — `third_party_request` reached this approve because a bank or
    // landlord asked, with the employee's consent on record (see
    // src/uc01/policyEngine.js's GATE_SEQUENCE). `requestingParty` was carried
    // onto `classification` at case-creation time (workflow.js STEP 6a); every
    // other reason leaves it null/absent and the letter's default sentence
    // ("issued upon the employee's request") is unchanged.
    // GATED ON THE SAME PREDICATE THE SIDEBAR USES, and that is the whole
    // point of it being a predicate. See DISCLOSURE_REASONS' own header: the
    // first version of this line was ungated, so a third-party request whose
    // sidebar showed no salary row at all could still put a salary on the
    // letter and post it as a public reply. The screen and the document must
    // answer the same question, and the only way to guarantee that is to ask
    // it once.
    authorisedDisclosures = approvalMayDisclose(caseRow.reason)
      ? authorisableDisclosures(employment, overScopeFieldsRequested(caseRow.classification))
      : [];
    letterHtml = renderLetterHtml(employment, legalEntity, {
      requestingParty: caseRow.classification?.requestingParty ?? null,
      authorisedFields: authorisedDisclosures,
      // NAMED ON THE DOCUMENT ITSELF. A letter that states a salary should say
      // on its face who released it — the audit row below records the same
      // person, but the audit row is not what the bank receives.
      authorisedBy: actor,
      // rca-tlb2 (R7-20): the letter must carry the same reference the
      // requester was shown, so it can be quoted by anyone it's forwarded to.
      //
      // AND FOR A THIRD-PARTY CASE THAT IS NOT `external_ref` (2026-08-28).
      // `caseStore.linkTicket()` repoints `external_ref` at the Zendesk ticket
      // id the moment a specialist can act, so this printed `Reference: 174` on
      // a letter going to a bank. Two things wrong with that: 174 is not the
      // reference the bank holds — they were given the door's UUID and would
      // quote a number nobody on their side can trace — and it hands an outside
      // party this account's internal ticket numbering, which is a small leak
      // but an entirely gratuitous one.
      //
      // `doorReference` is the enquirer's own reference and is absent on every
      // non-door case, so `external_ref` remains right for all of them.
      reference: caseRow.classification?.doorReference ?? caseRow.externalRef ?? null,
      // The addressee's own contact line, printed under their name. Absent on
      // every non-door case, where `requestingParty` is null and the letter
      // keeps its generic "To Whom It May Concern" form.
      returnAddress: caseRow.returnAddress ?? null,
    });
  }

  // rca-5vdx: the document is created BEFORE the decision is audited, so
  // `letterIssued` on the row below can be corroborated by a real
  // `documents` row id + sha256 rather than the bare `Boolean(letterHtml)`
  // this used to write — a rendered-but-not-yet-persisted string is not proof
  // a letter exists. Mirrors UC-01's workflow.js STEP 7a/7 and UC-03's
  // `letterDocument`/`letterContentHash` shape.
  const letterDocument = letterHtml
    ? caseStore.createDocument({
        caseId: caseRow.id,
        // A DIFFERENT TYPE FOR A DIFFERENT DOCUMENT. Anyone auditing "which
        // letters carried a salary?" must be able to answer it from
        // `documents.type` alone, without re-parsing HTML — and a customized
        // letter genuinely is not the standard one.
        type: authorisedDisclosures.length
          ? "customized_employment_verification_letter"
          : "employment_verification_letter",
        content: letterHtml,
      })
    : null;

  // --- 1. Audit FIRST, durably. See the header for why this ordering.
  await audit.logDurable({
    useCase: caseRow.useCase,
    action: verdict.auditAction,
    actor,
    riskTier: verdict.tier,
    details: {
      caseId: caseRow.id,
      externalRef: caseRow.externalRef,
      reviewId: reviewRow.id,
      employmentId: caseRow.employmentId,
      decidedVia: "zaf_sidebar",
      // The automation's original recommendation, kept alongside the human's
      // verdict in the same row. This pairing is what makes "did the specialist
      // agree with the AI?" answerable from history alone.
      aiDecision: caseRow.decision,
      aiReason: caseRow.reason,
      // rca-9pzo (R7-39): the structured identity block the automation computed
      // at case-creation time (workflow.js STEP 3/6a) — the same block a real
      // n8n-decided row carries as `identity.verified`/`identity.reason` — so
      // this human-decision row is witnessed by a field, not only by whatever
      // the approver typed into `note`. `null` when the case predates this
      // fix (older rows never persisted it onto `classification`), which is
      // itself an honest answer: "not recorded", not a fabricated one.
      identity: caseRow.classification?.identity ?? null,
      flags: caseRow.flags ?? [],
      previousCaseStatus: caseRow.status,
      newCaseStatus: verdict.nextCaseStatus,
      reviewStatus: verdict.nextReviewStatus,
      note: note || null,
      letterIssued: Boolean(letterDocument),
      // THE FIELD NAMES, NEVER THE VALUES. What was released is the auditable
      // fact; the figures themselves are on the letter, whose id and sha256 are
      // the two lines below. Writing a salary into `audit_log` would put it in
      // a table read by the metrics dashboard and the audit viewer, neither of
      // which is a place a compensation figure belongs.
      disclosedFields: authorisedDisclosures.map((d) => d.field),
      letterDocumentId: letterDocument?.id ?? null,
      letterContentHash: letterDocument?.contentHash ?? null,
    },
  });

  // --- 2. Move the mutable state. Awaited, and allowed to throw.
  await caseStore.updateReviewQueueStatus(caseRow.id, {
    status: verdict.nextReviewStatus,
    assignee: actor,
    notes: note || null,
  });
  await caseStore.updateCaseStatus(caseRow.id, verdict.nextCaseStatus);

  // --- 3. Close the loop on the real ticket. Not swallowed: this is the
  // customer-facing half, and the records above are already durable, so a
  // failure here should surface to the agent rather than be hidden. Same
  // reasoning as workflow.js step 8.
  if (zendesk && caseRow.externalRef) {
    // rca-iih7 / D-30. `uc01_human_review` is the tag a "needs review" queue
    // is built from (§16 item 2's own vocabulary); once a decision is
    // recorded here it is no longer true, and left on the ticket it means a
    // specialist filtering that queue keeps seeing cases already decided —
    // "I will have to open each one to find that out," in the specialist's
    // own words. Removed on BOTH outcomes via Zendesk's `remove_tags`, which
    // (unlike the `tags` field) does not require knowing or restating the
    // ticket's other tags — `queue_hr_ops` (whose work this still is) is left
    // untouched either way.
    const REVIEWED_TAG_REMOVAL = ["uc01_human_review"];
    if (letterHtml) {
      await zendesk.resolveWithLetter(caseRow.externalRef, letterHtml, { removeTags: REVIEWED_TAG_REMOVAL });
    } else {
      await zendesk.flagForReview(caseRow.externalRef, {
        note:
          `Verification request declined by ${actor} via the review sidebar.` +
          (note ? ` Reason: ${note}` : ""),
        // BOTH TAGS, for one release. The verb rename is ours; a Zendesk view
        // or trigger in the live account may filter on the old tag, and this
        // repository cannot enumerate the account's views from a coding
        // session. Two tags on a ticket cost nothing; a view that silently
        // stops matching costs a specialist their queue. Drop
        // `verification_denied` once the account's views are checked.
        //
        // ADDITIVE, not `tags` (full replace) — this used to overwrite the
        // ticket's entire tag set with just these two, silently dropping
        // `queue_hr_ops` and anything else already on it. `additionalTags`
        // adds without clobbering; `removeTags` above still removes exactly
        // the one tag meant to go.
        additionalTags: ["verification_declined", "verification_denied"],
        removeTags: REVIEWED_TAG_REMOVAL,
      });
    }
  }

  return {
    ok: true,
    status: 200,
    code: verdict.auditAction,
    reason: verdict.reason,
    caseId: caseRow.id,
    letterIssued: Boolean(letterHtml),
  };
}

/**
 * D-12 (rca-kfg2): record the outcome of the manual, out-of-band send an
 * approved third-party-door disclosure's internal note instructs a
 * specialist to perform — this system never performs the send itself (see
 * migrations/0003's header for why building one would be the wrong fix).
 *
 * Deliberately narrow about WHEN this may be recorded: only once a letter
 * has actually been issued on this case (an approve already happened — the
 * same `documents` row `submitReviewDecision()` creates), so this can never
 * be used to claim a send for a case that was never approved, or to record
 * an outcome ahead of the decision it depends on.
 *
 * @param {object} args
 * @param {string} args.ticketId
 * @param {string} args.status    "sent" | "could_not_send"
 * @param {string} args.approver
 * @param {string} [args.note]    required when status is "could_not_send"
 * @param {object} deps
 * @param {import("./store.js").PostgresReviewStore|import("./store.js").InMemoryReviewStore} deps.store
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../zendesk/restClient.js").ZendeskClient|null} [deps.zendesk] when
 *   supplied, a past-tense confirmation is posted back to the real ticket — see
 *   the note below on why the original note can never be edited into one.
 */
export async function submitManualSendRecord({ ticketId, status, approver, note = "" }, { store, caseStore, audit, zendesk = null }) {
  if (typeof approver !== "string" || !approver.trim()) {
    return { ok: false, status: 401, code: "approver_required", reason: "An identified approver is required to record this." };
  }
  if (status !== "sent" && status !== "could_not_send") {
    return { ok: false, status: 400, code: "invalid_manual_send_status", reason: 'status must be "sent" or "could_not_send".' };
  }
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (status === "could_not_send" && !trimmedNote) {
    return {
      ok: false,
      status: 400,
      code: "reason_required",
      reason: "A reason is required when recording that the letter could not be sent — it is recorded in the audit log.",
    };
  }

  const caseRow = await store.findCaseByExternalRef(ticketId);
  if (!caseRow) {
    return { ok: false, status: 404, code: "case_not_found", reason: "No case found for this ticket." };
  }
  if (caseRow.source !== "third_party_door") {
    return {
      ok: false,
      status: 409,
      code: "not_a_third_party_disclosure",
      reason: "Only a third-party-door case has an outward disclosure to record.",
    };
  }
  const documents = await store.findDocumentsByCaseId(caseRow.id);
  const letterIssued = documents.some((d) => d.type === "employment_verification_letter");
  if (!letterIssued) {
    return {
      ok: false,
      status: 409,
      code: "no_letter_issued",
      reason: "This case has not been approved yet — there is nothing to record a send for.",
    };
  }

  const actor = approver.trim();
  const at = new Date().toISOString();

  // Audit FIRST, durably — same ordering `submitReviewDecision()` uses, for
  // the same reason: this is a human's attested claim about what they did
  // outside this system, and losing the state change while keeping the
  // record would be a false claim (a real send with no attested outcome is
  // exactly D-12's original gap); losing the record while keeping the state
  // change would be an unattributed one.
  await audit.logDurable({
    useCase: caseRow.useCase,
    action: status === "sent" ? "third_party_manual_send_recorded" : "third_party_manual_send_failed",
    actor,
    riskTier: "medium",
    details: {
      caseId: caseRow.id,
      externalRef: caseRow.externalRef,
      employmentId: caseRow.employmentId,
      returnAddress: caseRow.returnAddress ?? null,
      note: trimmedNote || null,
    },
  });

  await caseStore.recordManualSend(caseRow.id, { status, by: actor, note: trimmedNote || null, at });

  // rca-fy79 (K1, mayor-ruled 2026-08-23): the ticket's own internal note —
  // written once, at hand-off time, in workflow.js — instructs the specialist
  // to "send the letter... yourself" and can never be edited into the past
  // tense afterwards; Zendesk comments are an append-only log, not a document.
  // So the completion this function just made durable stays invisible to
  // anyone reading the ticket transcript instead of the sidebar, and the
  // instruction reads as permanently outstanding even once it is not. This
  // posts the past-tense counterpart as a NEW internal note, the same
  // mechanism `submitReviewDecision()` already uses to close the loop on the
  // real ticket — not swallowed, for the same reason: the record above is
  // already durable, so a failure here should surface rather than hide.
  if (zendesk && caseRow.externalRef) {
    const confirmation =
      status === "sent"
        ? `Outward disclosure recorded — ${actor} recorded this as SENT on ${at}` +
          (caseRow.returnAddress ? `, to ${caseRow.returnAddress}` : "") +
          "." +
          (trimmedNote ? ` Note: ${trimmedNote}` : "")
        : `Outward disclosure recorded — ${actor} recorded that the letter COULD NOT BE SENT, on ${at}. ` +
          `Reason: ${trimmedNote}`;
    await zendesk.flagForReview(caseRow.externalRef, { note: confirmation });
  }

  return { ok: true, status: 200, code: status, manualSendStatus: status, manualSendAt: at, manualSendBy: actor };
}

/**
 * Refusals that are NOT written to the audit log, because there is no
 * identified actor to attribute them to. Writing them anyway would mean anyone
 * who can reach the endpoint could append unlimited rows to an append-only
 * table just by POSTing ticket ids with no credentials — turning the audit log
 * into an amplification target and burying the attributed rows that matter.
 *
 * Everything else IS recorded: once we know who tried, a refused attempt on a
 * real case is exactly the kind of event an audit log exists for.
 */
const UNATTRIBUTED_REFUSALS = new Set(["approver_required", "unknown_action", "case_not_found"]);

/**
 * Log an attempt that was refused.
 *
 * Best-effort (background log(), not logDurable()) on purpose: the refusal has
 * ALREADY prevented the state change, so this row is evidence rather than the
 * control itself — and making it durable would let a database blip turn a
 * correct 403 into a 500, which is a worse answer to give a specialist.
 */
function recordRefusal({ audit, caseRow, action, approver, verdict, extraDetails = {} }) {
  if (!caseRow || UNATTRIBUTED_REFUSALS.has(verdict.code)) return;
  audit.log({
    useCase: caseRow.useCase,
    action: `human_${action}_refused`,
    actor: typeof approver === "string" && approver.trim() ? approver.trim() : "unknown",
    riskTier: verdict.tier ?? null,
    details: {
      caseId: caseRow.id,
      externalRef: caseRow.externalRef,
      // rca-mhh3 (R7-38): the feed's EMPLOYMENT/FLAGS/SOURCE/REASON columns read
      // `details->>'employmentId'`, `details->'flags'`, `details->>'source'` and
      // `details->>'reason'` (readStore.js's DECISION_SUMMARY_COLUMNS) — none of
      // which this row carried, so a refusal was legible only by following its
      // caseId to a sibling row. `reason` is the slug (`verdict.code`), matching
      // every other row's convention ("THE SLUG, ALWAYS" — app.js's reasonCell);
      // `refusalCode`/`refusalReason` stay for the drill-down's own detail.
      employmentId: caseRow.employmentId,
      flags: caseRow.flags ?? [],
      source: caseRow.source ?? null,
      reason: verdict.code,
      decidedVia: "zaf_sidebar",
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
      aiDecision: caseRow.decision,
      caseStatus: caseRow.status,
      ...extraDetails,
    },
  });
}
