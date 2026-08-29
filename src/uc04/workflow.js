// ---------------------------------------------------------------------------
// workflow.js  —  UC-04 end to end: request -> gates -> specialist approval
//                  -> PATCH work authorization
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The single entry point that wires the pure pieces (policyEngine.js,
// riskMatrix.js, requestParser.js, approvalPolicy.js) to I/O (Remote,
// AuditLogger, AuthorizationStore) — same role src/uc01/workflow.js and
// src/uc06/workflow.js play for their UCs.
//
// WRITE ORDERING ON APPROVAL IS DELIBERATE, SAME AS review/service.js AND
// submitAmendmentApproval():
//   policy gate -> freshness re-check -> AUDIT (durable) -> state -> Remote PATCH
// The audit row for a human's approval is written BEFORE the PATCH fires. If
// the process dies in between, history says "approval recorded" while the
// authorization still reads pending — visible, safely retryable (submitting
// again just re-attempts the PATCH), and never the other way around: a real
// work-authorization write with no record of who authorized it.
//
// WHAT UC-04'S INPUT AND OUTPUT ACTUALLY ARE (corrected 2026-08-19)
// INPUT is a work-authorization request that ALREADY EXISTS in Remote — raised
// by the employee in Remote's own Request Hub, announced by the
// `work_authorization.requested` webhook, and identified by
// `ticket.workAuthorizationId`. OUTPUT is the employer manager's verdict,
// PATCHed back onto that request. Our `uc04_authorizations` row is the
// DECISION'S AUDIT TRAIL, never the request itself.
//
// This file used to call `remote.createWorkAuthorization()` on every
// `ready_for_approval` and every `escalate`, and swallow the failure with a
// `console.error`. There is no `POST /v1/work-authorization-requests`; UC-04.md
// §3 said so all along, tagged [CONFIRMED — live]. So the workflow could not
// tell a written record from an unwritten one, and every id it carried forward
// came from a mock implementing an endpoint Remote does not have. See
// `src/uc04/requestLink.js` for the resolution rules that replaced it,
// docs/REMOTE-VOCABULARY.md §13.1 for the evidence, and docs/BUILD-LOG.md.
//
// A REQUEST WITH NO REMOTE COUNTERPART IS CARRIED, NOT REFUSED — and says so.
// Portal intake has no Remote request behind it, and refusing there would make
// UC-04 a use case that can only ever be observed refusing, which is exactly
// the failure shape this project keeps paying for. The decision is recorded and
// the record states, in the response and in the audit row, that no Remote
// request was written to. Nothing is ever invented to stand in for one.
//
// THE "EXECUTE" QUESTION
// UC-04's execution is the PATCH to the work authorization itself, not a
// payroll or contract write. The spec's "issue authorization" step
// (UC-04.md §5) maps onto `RemoteClient.patchWorkAuthorization(id, {status,
// employer_special_instructions?})` — a one-shot call that moves the request
// to Remote's `approved_by_manager`, the status meaning "approved by the
// employer manager, awaiting Remote's review". It deliberately does NOT write
// `approved_by_remote`: that is Remote's own compliance verdict on a request
// it has evaluated, and our approver is the employer's mobility specialist.
// See the payload's own comment below and docs/REMOTE-VOCABULARY.md §5.4-§5.6.
// There is no separate "issue a letter" step in this UC; the authorization IS
// the artifact.
// ---------------------------------------------------------------------------

import { classifyRisk } from "../shared/riskEngine.js";
import { normalizeDecisionAction } from "../shared/declineVocabulary.js";
import { evaluate as evaluatePolicy } from "./policyEngine.js";
import { describeDecisionBasis } from "./decisionFacts.js";
import { draftSummary } from "./requestParser.js";
import { evaluateApprovalAction } from "./approvalPolicy.js";
import { judgeNarrative } from "../shared/narrativeJudge.js";

import { resolveWorkAuthorizationRequest, LINK_LINKED, LINK_UNRESOLVED } from "./requestLink.js";

import { claimExternalRef } from "../shared/workflowClaims.js";
import { remoteFor } from "../shared/remoteWorld.js";

/**
 * Submit a workation request. Runs every deterministic gate once and
 * records the outcome — this never executes anything by itself, even for a
 * "ready_for_approval" decision. Only submitWorkationApproval() below can
 * trigger the actual Remote PATCH, and only once the specialist's approval
 * has been recorded.
 *
 * @param {object} ticket
 * @param {string} ticket.employmentId
 * @param {string|null} [ticket.workAuthorizationId]
 *   the id carried by Remote's `work_authorization.requested` webhook — the
 *   request an employee raised in the Request Hub. Absent for intake that never
 *   came from Remote (the portal), in which case the decision is recorded with
 *   no Remote counterpart rather than against an invented one.
 * @param {object|null} ticket.session
 *   { companyId, authenticatedAdminId } — the authenticated requester.
 *   Fails closed: no session, or a mismatched company, means unverified —
 *   same "identity from a signal, never a claim" rule as UC-01/UC-06.
 * @param {object} ticket.factors
 *   the 5 structured factors (see policyEngine.js). These are the ONLY
 *   source of truth for the workation's facts; never derived from free text.
 * @param {Array<{country:string, startDate:string, endDate:string}>} [ticket.travelHistory]
 *   the employee's prior workation periods, used to compute cumulative
 *   presence days. Defaults to none.
 * @param {string} [ticket.reasonText]
 *   free-text context, surfaced in the LLM prompt (and only there).
 * @param {string} [ticket.externalRef]
 * @param {string} [ticket.source]
 * @param {string} [ticket.now]
 *   override for tests; defaults to real now
 *
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./authorizationStore.js").AuthorizationStore} deps.authorizationStore
 * @param {typeof draftSummary} [deps.draftSummary]  override for tests — defaults
 *   to the real draftSummary() so production is unaffected; injectable so a test
 *   that doesn't care about narrative content never makes a real, retried LLM
 *   call just because OPENAI_API_KEY happens to be set in its environment
 *   (real hazard: this exact repo's own devcontainer carries one — see #32).
 * @param {typeof judgeNarrative} [deps.judge]
 *   scoped faithfulness judge for the drafted summary. PURELY INFORMATIONAL:
 *   the verdict is attached to the authorization row for a specialist to see
 *   and is NEVER read by any policy/approval gate. Defaults to the real
 *   judgeNarrative() — same hermetic-test hazard as draftSummary above.
 */
export async function handleWorkationRequest(
  ticket,
  { remote, audit, authorizationStore, draftSummary: draftSummaryFn = draftSummary, judge = judgeNarrative } = {}
) {
  const {
    employmentId,
    session = null,
    factors,
    travelHistory = [],
    reasonText = "",
    externalRef = null,
    source = null,
    now = new Date().toISOString(),
    // WHERE THESE FACTORS CAME FROM, when they did not come from a form.
    // `src/uc04/textIntake.js` sets this when a request arrived as free text:
    // it names, per factor, whether the value was read out of prose by a model,
    // answered by the requester, or taken from the employment record. NULL for
    // every form/webhook submission, which is every existing caller — so the
    // stored row, the audit row and the drafted summary are byte-identical to
    // before unless a text intake actually happened.
    //
    // IT IS NOT A DECISION INPUT AND MUST NEVER BECOME ONE. No gate reads it,
    // it is computed before `evaluate()` runs, and it travels only to the
    // places a human reads. Its whole job is that an extracted value must never
    // be shown as though somebody had stated it.
    extraction = null,
  } = ticket;

  const employment = await remote.getEmployment(employmentId);
  // BOTH SIDES MUST BE PRESENT, not merely equal. `company_id` is normalised to
  // `null` for any record without one (restClient.js), and a session with no
  // companyId is the shape UC-09's own Zendesk intake emits — so `null === null`
  // verified an identity that had proved nothing, and `ready_for_approval` is
  // the decision that PATCHes a real work-authorization record at Remote.
  // UC-06 and UC-09 already guard this, and so does THIS use case's own n8n
  // twin (nodes-uc04/workationGates.js) — the Node path was the odd one out.
  const identityVerified = Boolean(
    session &&
      employment &&
      session.companyId &&
      employment.company_id &&
      session.companyId === employment.company_id
  );

  const result = evaluatePolicy({
    identityVerified,
    employment,
    factors,
    now,
    travelHistory,
  });

  // WHICH REMOTE REQUEST IS THIS DECISION ABOUT? (see requestLink.js)
  //
  // Resolved only for the two decisions that can ever carry a human verdict.
  // `blocked` is skipped deliberately and for the same reason the sanctions gate
  // sits first: a hard stop is never decided by anyone, so the question "which
  // Remote row does this correspond to" has no consumer, and asking it would put
  // an upstream call in front of the one gate that must be cheapest and most
  // certain. A blocked request therefore still touches Remote not at all.
  //
  // The destination handed in is the CANONICAL code the gates actually judged,
  // not the raw one the requester typed — comparing "us" against a Remote record
  // that says "US" would report a mismatch that is really a normalisation
  // difference (finding F-13's tail end, one layer over).
  let link = null;
  if (result.decision === "ready_for_approval" || result.decision === "escalate") {
    link = await resolveWorkAuthorizationRequest({
      remote,
      workAuthorizationId: ticket.workAuthorizationId ?? null,
      employmentId,
      destinationCountry: result.risk?.normalized?.destinationCountry || factors?.destination?.country || null,
    });
  }
  const workAuthorizationId = link?.state === LINK_LINKED ? link.id : null;

  // FAIL-CLOSED, AND ONLY IN ONE DIRECTION. An UNRESOLVED link means we could
  // not establish which Remote request this decision belongs to — the read
  // failed, the request is no longer pending, its destination is not the one we
  // judged, or two of them fit. None of those is something a one-click
  // specialist approval may be offered on top of, so an approval-ready request
  // is downgraded to `escalate`. It can never move the other way: an escalate
  // stays an escalate (first failure wins, so its own reason survives and the
  // link reason rides along as a flag), and a `blocked` was never resolved at
  // all. UNLINKED is NOT a failure — it is Remote answering that no such request
  // exists, which is the portal's ordinary case — so it changes no decision and
  // is reported instead through `remoteRequest` below.
  let decision = result.decision;
  let reason = result.reason;
  let flags = result.flags;
  if (link?.state === LINK_UNRESOLVED) {
    flags = [...flags, link.reason];
    if (decision === "ready_for_approval") {
      decision = "escalate";
      reason = link.reason;
    }
  }

  // THE PROVENANCE OF THE REMOTE SIDE, MADE VISIBLE INSTEAD OF SWALLOWED.
  // The `console.error` this replaces is the single reason the missing endpoint
  // survived: a failed write left the decision looking identical to a written
  // one. Carried on the response and in the append-only audit row, which is
  // where the audit viewer reads it. Surfacing it on the ZAF sidebar needs a
  // `remote_request` jsonb column on `uc04_authorizations` — a provisioning
  // step, recorded as an open item in docs/use-cases/UC-04.md rather than
  // half-done by adding a field the durable store would silently drop (the same
  // call already made for `reason_text` below).
  const remoteRequest = link
    ? {
        linked: link.state === LINK_LINKED,
        state: link.state,
        id: link.id,
        status: link.request?.status ?? null,
        reason: link.reason,
        detail: link.detail,
      }
    : {
        linked: false,
        state: "not_resolved_for_this_decision",
        id: null,
        status: null,
        reason: "decision_carries_no_remote_verdict",
        detail:
          "A blocked request is a hard stop that no one decides, so no Remote work-authorization request was looked up for it.",
      };

  const approvalRoute =
    decision === "ready_for_approval"
      ? "specialist_approval"
      : decision === "escalate"
        ? "escalate"
        : "blocked";

  // `?? null`, NEVER `?? 0` — finding F-32. `result.risk` is null whenever a
  // gate refused before the matrix ran (identity, employment status, employer
  // permission, malformed factors), and riskMatrix.tripDurationDays() itself
  // now returns null for dates it cannot read. A trip whose length was never
  // derived is not a trip of zero days: 0 is a real answer to a real question,
  // so nothing errors and nothing flags, and the row a specialist reads
  // asserts a figure nobody computed. The audit row here has always used
  // `?? null` while the stored row and the API response used `?? 0`, so the
  // two durable records of the same decision disagreed. They now agree.
  const tripDays = result.risk?.tripDays ?? null;

  const { summary } = await draftSummaryFn(
    // tripDays here is the F-32-fixed variable above (?? null, never ?? 0) —
    // NOT a fresh `result.risk?.tripDays ?? 0`, which would silently
    // reintroduce the exact bug that comment describes. `reason` is what
    // lets the summary name a sanctions block explicitly instead of a
    // generic "blocked by the risk matrix" line that never ran.
    { factors, riskLevel: result.risk?.riskLevel ?? "unknown", tripDays, approvalRoute, reason, reasonText, extraction },
    { audit }
  );

  const faithfulness = await judge({ narrative: summary, structuredInputs: { factors, riskLevel: result.risk?.riskLevel ?? "unknown", tripDays, approvalRoute } });

  const requester = session?.authenticatedAdminId ?? "unauthenticated";

  // DELIVERY-LEVEL IDEMPOTENCY. Duplicate delivery is normal — Zendesk retries
  // webhooks and a trigger can fire twice on rapid updates. UC-01's ticket #5
  // proved the cost: two audit rows 30µs apart and a duplicate customer-facing
  // action. The guarantee is the (use_case, external_ref) primary key, not this
  // code: a check-then-act in application code has exactly the race that caused
  // that bug. Taken here because everything below is a durable record or an
  // outward act.
  const claim = await claimExternalRef({
    pgPool: authorizationStore.pgPool ?? null,
    useCase: "UC-04",
    externalRef,
    decision,
  });
  if (!claim.claimed) {
    return {
      decision,
      reason,
      duplicate: true,
      duplicateOf: externalRef,
    };
  }

  const authorization = authorizationStore.createAuthorization({
    employmentId,
    requester,
    factors,
    risk: result.risk,
    tripDays,
    cumulativeDays: result.risk?.cumulativeDays ?? null,
    decision,
    reason,
    flags,
    summary,
    faithfulness,
    externalRef,
    source,
    workAuthorizationId,
  });

  const { tier } = classifyRisk("UC-04", flags);

  audit.log({
    useCase: "UC-04",
    action: decision,
    actor: requester,
    riskTier: tier,
    details: {
      authorizationId: authorization.id,
      // PROVENANCE — the reference the requester was shown, and the surface
      // they used. src/auditview/readStore.js searches
      // `details->>'externalRef'` BY NAME, so a decision row without it cannot
      // be found from the one id a human holds. Both are null when the caller
      // supplied none; never defaulted, because a fabricated reference returns
      // somebody else's trail.
      externalRef,
      source,
      employmentId,
      decision,
      reason,
      flags,
      riskLevel: result.risk?.riskLevel ?? null,
      tripDays,
      cumulativeDays: result.risk?.cumulativeDays ?? null,
      workAuthorizationId,
      remoteRequest,
      summary,
      faithfulness,
      // THE REQUESTER'S OWN WORDS, which this workflow used to consume and
      // discard. `reasonText` arrives from the intake form, is interpolated
      // into draftSummary()'s LLM prompt, and goes nowhere else: the store's
      // column list has no field for it, and — the part that makes it a real
      // loss rather than a stylistic one — `draftSummaryTemplate()`, the
      // deterministic fallback, never mentions it. So on every run without a
      // working LLM (every offline run, every demo, and every LLM failure in
      // production) the free text a person typed to explain their trip was
      // read once, by a model that was not there, and dropped.
      //
      // It is deliberately NOT a decision input and must never become one —
      // the form says so in its own label, and UC-04's verdict is derived
      // entirely from the structured factors. But the specialist this
      // escalates to is being asked for JUDGEMENT, and "two weeks alongside
      // the Madrid team" and "my family lives there" are different requests
      // wearing identical factors. Recorded here, in the append-only log the
      // audit viewer renders, because that needs no schema change; getting it
      // onto the ZAF sidebar needs a `reason_text` column on
      // `uc04_authorizations`, which is a provisioning step and is recorded as
      // an open item in docs/use-cases/UC-04.md rather than half-done by
      // adding a field the durable store would silently drop.
      reasonText: reasonText || null,
      // THE PROVENANCE OF THE FACTORS THEMSELVES. Null for a form submission.
      // Recorded in `audit_log.details` rather than in a `uc04_authorizations`
      // column for the same reason `reasonText` above is: the table has no such
      // column, adding one is a provisioning step, and half-doing it by writing
      // a field the durable store silently drops is worse than recording it
      // where the audit viewer already reads. Recorded as an open item in
      // docs/use-cases/UC-04.md.
      extraction,
    },
  });

  return {
    decision,
    reason,
    flags,
    authorizationId: authorization.id,
    riskLevel: result.risk?.riskLevel ?? null,
    tripDays,
    cumulativeDays: result.risk?.cumulativeDays ?? null,
    workAuthorizationId,
    remoteRequest,
    summary,
    faithfulness,
    // Null unless this request came in as free text — see the ticket field.
    extraction,
    // THE FOUR DIMENSIONS, on the response as well as on the API view. Derived
    // from the row that was just stored, so an intake surface reporting the
    // outcome shows the same basis a specialist opening the case later reads —
    // one derivation, never a second copy that can drift. Never persisted: it is
    // a description of the row, and storing a description beside the thing it
    // describes is how the two come to disagree. See decisionFacts.js's header.
    basis: describeDecisionBasis({ authorizationRow: authorization }),
  };
}

/**
 * A mobility specialist approves or declines a workation. Executes the
 * Remote PATCH only after the approval has been recorded durably.
 *
 * `deny` is still accepted as the action and normalised to `decline` at this
 * entry point — the ONE place it happens, so the audit action name, the stored
 * status and the response `code` never learn the alias existed. See
 * src/shared/declineVocabulary.js for why the installed ZAF bundle makes that
 * necessary.
 *
 * @param {object} args
 * @param {string} args.authorizationId
 * @param {"approve"|"decline"} args.action  (`deny` accepted, legacy)
 * @param {string} args.approver
 * @param {string} [args.note]
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./authorizationStore.js").AuthorizationStore} deps.authorizationStore
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js), threaded to the approval policy and
 *   consulted there AFTER every existing refusal. It can only ever refuse —
 *   there is no return value that means "approved" — so it never fills a slot,
 *   satisfies a floor, or relaxes a gate. `null` = not enforced in this posture.
 */
export async function submitWorkationApproval(
  { authorizationId, action: rawAction, approver, note = "" },
  { remote, audit, authorizationStore, entitlement = null }
) {
  const authorizationRow = await authorizationStore.findById(authorizationId);
  // Normalised ONCE, at the edge. normalizeDecisionAction() returns unknown
  // input unchanged, so a bogus verb still fails evaluateApprovalAction()'s
  // ACTIONS check rather than being rewritten into a valid one.
  const action = normalizeDecisionAction(rawAction);
  const verdict = evaluateApprovalAction({ authorizationRow, approver, action, entitlement });
  if (!verdict.allowed) {
    recordRefusal({ audit, authorizationRow, action, approver, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = approver.trim();
  const { tier } = classifyRisk("UC-04", authorizationRow.flags ?? []);

  // PROVENANCE COMES OFF THE ROW. This runs in a different process from the
  // request, days later, holding only an authorizationId — the reference and
  // the surface survive only because `uc04_authorizations` persists both.
  const externalRef = authorizationRow.externalRef ?? null;
  const source = authorizationRow.source ?? null;

  // EXECUTE IN THE WORLD THE DECISION WAS MADE IN. A record submitted through
  // the request portal was decided against this repo's mock Remote (a public
  // page must never write into a real account), so its ids belong to the mock,
  // not the Sandbox. Executing it against the real gateway 404s — found live
  // on UC-02, whose released claim addressed an `exp_*` fixture id the real
  // Sandbox has never heard of. Resolved from the row's own durable `source`,
  // never from the shape of an id: the portal's personas MIRROR real
  // employment ids, so an id heuristic would be wrong half the time and wrong
  // invisibly. See src/shared/remoteWorld.js.
  const remoteForRow = remoteFor(remote, authorizationRow.source);

  if (action === "decline") {
    // `workation_declined`, not `workation_denied` (2026-08-19). A NEW name
    // rather than a reused one: `workation_declined` was checked against every
    // audit action this repository writes and collides with none, which is the
    // check UC-02's rename found the hard way when the templated
    // `expense_${status}_write` collided with the auto-approve path's own row.
    // History is NOT rewritten — src/auditview/humanDecision.js carries both
    // spellings permanently, because audit_log is append-only.
    await audit.logDurable({
      useCase: "UC-04",
      action: "workation_declined",
      actor,
      riskTier: tier,
      details: {
        authorizationId,
        externalRef,
        source,
        note: note || null,
        aiDecision: authorizationRow.decision,
      },
    });

    // A DECLINE IS TRANSMITTED, NOT JUST FILED (added 2026-08-19).
    //
    // Before this, the decline path made no Remote call at all. The employee
    // raised the request in Remote's Request Hub and it sits `pending` —
    // "Submitted and awaiting manager review". Recording the employer's refusal
    // only in our own store leaves that request pending forever: the employee
    // is never answered and Remote's own Mobility Team never learns the employer
    // said no. That is the same half-built shape as the create being removed in
    // this pass — a decision that reaches nobody — and Remote provides the exact
    // branch for it. `DeclinedWorkAuthozation` is
    // `{status: "declined_by_manager", reason}`, with `reason` REQUIRED, which
    // is the API stating that a refusal must carry one.
    //
    // The fallback text when no note was given states what happened and invents
    // no rationale: Remote requires the field, and filling a required field with
    // a plausible-sounding reason nobody gave would be fabricating the record.
    const declineWrite = await transmitVerdict({
      remote: remoteForRow,
      audit,
      tier,
      actor,
      authorizationId,
      authorizationRow,
      payload: {
        status: "declined_by_manager",
        reason: note && note.trim() ? note.trim() : "Declined by the employer's mobility specialist. No reason was recorded.",
      },
    });
    if (declineWrite.failed) return declineWrite.response;

    await authorizationStore.markDeclined(authorizationId, actor, note);
    return {
      ok: true,
      status: 200,
      code: "declined",
      reason: "Declined by mobility specialist.",
      authorizationId,
      remoteResult: declineWrite.remoteResult,
      remoteWrite: declineWrite.transmission,
    };
  }

  // --- approve: record the slot durably, then PATCH the work authorization.
  await audit.logDurable({
    useCase: "UC-04",
    action: "workation_approved",
    actor,
    riskTier: tier,
    details: { authorizationId, externalRef, source, note: note || null, aiDecision: authorizationRow.decision },
  });
  const afterApproval = await authorizationStore.recordApproval(authorizationId, actor, note);

  // --- Freshness re-check: is this still true? policyEngine.js already
  // checked "is this employee active?" when the authorization was created;
  // approval can happen days later. Same reasoning as
  // review/service.js's re-check before issuing UC-01's letter.
  const employment = await remoteForRow.getEmployment(authorizationRow.employmentId);
  if (!employment || employment.status !== "active") {
    const stale = { status: 409, code: "employment_no_longer_active", reason: "The employment record is no longer active." };
    await audit.log({
      useCase: "UC-04",
      action: "workation_execution_blocked",
      actor,
      riskTier: tier,
      details: { authorizationId, externalRef, source, observedStatus: employment?.status ?? "not_found" },
    });
    return { ok: false, ...stale, authorizationId };
  }

  // --- PATCH the work authorization. This is the "execute" step.
  // REMOTE'S OWN SCHEMA, NOT A SHAPE WE INVENTED (fixed 2026-08-19,
  // docs/REMOTE-VOCABULARY.md §5.4-§5.6).
  //
  // This payload used to send `{status: "approved_by_remote", approved_by,
  // approved_at, decision_reason}`. Every field of it was wrong:
  //
  //   - `approved_by_remote` is REMOTE'S OWN verdict. Remote glosses it
  //     "Fully approved by both the manager and Remote", reachable only AFTER
  //     a manager approval. Our approver is the EMPLOYER's mobility
  //     specialist, so writing it recorded that Remote had approved a work
  //     authorization Remote has never seen. `approved_by_manager` — "Approved
  //     by the employer manager, awaiting Remote's review" — is what actually
  //     happened here, and Remote's `ApprovedWorkAuthozation` schema admits
  //     only that one status member.
  //   - `approved_by`, `approved_at` and `decision_reason` are not fields.
  //     Both update schemas are `additionalProperties: false`; the approver is
  //     READ BACK as `employer_approver` and the timestamp is Remote's to set.
  //     The approver's own words belong in `employer_special_instructions`,
  //     which is the only other property the approve schema accepts.
  //
  // Sent only when there is something to say, because `additionalProperties:
  // false` punishes a manufactured empty string the same way it punishes a
  // manufactured field.
  const patchBody = { status: "approved_by_manager" };
  if (note && note.trim()) patchBody.employer_special_instructions = note.trim();

  const approveWrite = await transmitVerdict({
    remote: remoteForRow,
    audit,
    tier,
    actor,
    authorizationId,
    authorizationRow,
    payload: patchBody,
  });
  if (approveWrite.failed) return approveWrite.response;

  // The row is SETTLED either way, and that is deliberate. Leaving an approved
  // authorization at `pending_specialist_approval` because there was nothing at
  // Remote to write to would leave it open to a second approval — a
  // double-decision hole created by being honest about the first one. The
  // transmission record goes into `remote_result`, which is jsonb and needs no
  // migration, and `describeSettled()` in approvalPolicy.js reads
  // `transmitted: false` rather than treating any truthy value as "it landed".
  await authorizationStore.markExecuted(authorizationId, approveWrite.transmission);

  if (!approveWrite.transmission.transmitted) {
    return {
      ok: true,
      status: 200,
      code: "approved_no_remote_record",
      reason:
        "Approval recorded. It was NOT sent to Remote: this request has no Remote work-authorization request behind it, " +
        "so there is nothing there to approve. " +
        approveWrite.transmission.detail,
      authorizationId,
      remoteResult: null,
      remoteWrite: approveWrite.transmission,
    };
  }

  return {
    ok: true,
    status: 200,
    code: "executed",
    reason: "Approval recorded; work authorization issued.",
    authorizationId,
    remoteResult: approveWrite.remoteResult,
    remoteWrite: approveWrite.transmission,
  };
}

/**
 * Send one employer verdict to Remote, or record — loudly — that there was
 * nowhere to send it.
 *
 * THREE OUTCOMES, AND NONE OF THEM IS SILENT. That is the whole point: the
 * defect this replaces was a `console.error` that let an unwritten record look
 * exactly like a written one from every durable surface.
 *
 *   transmitted        the PATCH landed. `remoteResult` is Remote's own record.
 *   not transmitted    no linked Remote request exists. Recorded as a durable
 *                      `workation_not_transmitted` audit row naming why, and
 *                      the caller settles its own row and answers 200 — the
 *                      human's decision is real, only its Remote counterpart is
 *                      absent.
 *   failed             the PATCH was attempted and Remote refused it. A durable
 *                      `workation_execution_blocked` row, and a 502 to the
 *                      caller. The human's decision has already been audited by
 *                      this point, so nothing is lost and a retry is safe.
 *
 * @returns {Promise<{failed: boolean, response?: object, remoteResult: object|null, transmission: object}>}
 */
async function transmitVerdict({ remote, audit, tier, actor, authorizationId, authorizationRow, payload }) {
  const workAuthorizationId = authorizationRow.workAuthorizationId;
  // Same provenance the caller records, taken from the same row rather than
  // threaded through as two more parameters — one source of truth for both.
  const externalRef = authorizationRow.externalRef ?? null;
  const source = authorizationRow.source ?? null;

  if (!workAuthorizationId) {
    const transmission = {
      transmitted: false,
      reason: "no_remote_work_authorization_request",
      payload,
      // WRITTEN AS A CLAUSE, NOT A PARAGRAPH. This text is durable — it is
      // stored on the row and read back for the rest of that row's life — and
      // it is read INSIDE a sentence that already says the decision was not
      // sent. It used to restate that ("so no PATCH was made"), name an HTTP
      // verb at a specialist, and end in a full stop the reader's sentence then
      // added a second one to. Lower case, no trailing stop, one clause.
      detail:
        "no work-authorisation request is linked to it. The employee raises that request in " +
        "Remote's own Request Hub, and no API can create one",
    };
    await audit.logDurable({
      useCase: "UC-04",
      action: "workation_not_transmitted",
      actor,
      riskTier: tier,
      details: { authorizationId, externalRef, source, workAuthorizationId: null, ...transmission },
    });
    return { failed: false, remoteResult: null, transmission };
  }

  try {
    const remoteResult = await remote.patchWorkAuthorization(workAuthorizationId, payload);
    const transmission = { transmitted: true, reason: "work_authorization_patched", payload, detail: null };
    await audit.logDurable({
      useCase: "UC-04",
      action: "workation_executed",
      actor,
      riskTier: tier,
      details: { authorizationId, externalRef, source, workAuthorizationId, payload, remoteResult },
    });
    return { failed: false, remoteResult, transmission };
  } catch (err) {
    // Reaching the caller as a clean 502 rather than an unhandled throw the API
    // renders as `internal_error`: "Remote refused this write" is a different
    // fact from "this service is broken", and a specialist reading the second
    // when the first is true goes looking in the wrong place.
    await audit.logDurable({
      useCase: "UC-04",
      action: "workation_execution_blocked",
      actor,
      riskTier: tier,
      details: {
        authorizationId,
        externalRef,
        source,
        workAuthorizationId,
        payload,
        error: String(err.message).slice(0, 300),
      },
    });
    return {
      failed: true,
      remoteResult: null,
      transmission: { transmitted: false, reason: "remote_write_failed", payload, detail: String(err.message).slice(0, 300) },
      response: {
        ok: false,
        status: 502,
        code: "remote_write_failed",
        reason: `Remote refused the work-authorization update: ${err.message}`,
        authorizationId,
      },
    };
  }
}

/**
 * Refusals with no identified actor are not audited — same reasoning as
 * recordRefusal() in uc06/workflow.js and src/review/service.js: an
 * unattributed row in an append-only log is worse than no row.
 */
const UNATTRIBUTED_REFUSALS = new Set(["approver_required", "unknown_action", "authorization_not_found"]);

function recordRefusal({ audit, authorizationRow, action, approver, verdict }) {
  if (!authorizationRow || UNATTRIBUTED_REFUSALS.has(verdict.code)) return;
  const { tier } = classifyRisk("UC-04", authorizationRow.flags ?? []);
  audit.log({
    useCase: "UC-04",
    action: `workation_${action}_refused`,
    actor: typeof approver === "string" && approver.trim() ? approver.trim() : "unknown",
    riskTier: tier,
    details: {
      authorizationId: authorizationRow.id,
      externalRef: authorizationRow.externalRef ?? null,
      source: authorizationRow.source ?? null,
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
    },
  });
}
