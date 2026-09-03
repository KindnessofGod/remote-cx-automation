// ---------------------------------------------------------------------------
// workflow.js  —  UC-05 end to end: resignation request -> calc -> HR Ops signoff
// ---------------------------------------------------------------------------
// WHY THIS FILE LOOKS THE WAY IT DOES
// Same role as src/uc01/workflow.js and src/uc06/workflow.js: this is the
// single entry point that wires the pure pieces (letterExtractor, policyEngine,
// noticePeriodCalculator, signoffPolicy) to I/O (Remote, AuditLogger,
// ResignationStore). Each dependency is injectable for hermetic tests, the
// real ones are used in production, and every LLM call site has its own
// `askJson`/`isConfigured`/`audit`/`backoff` seam (issue #32 / §4 invariant
// 10) so no test that exercises this workflow ever makes a real, retried
// LLM call just because OPENAI_API_KEY happens to be set in its environment.
//
// WRITE ORDERING ON SIGN-OFF IS DELIBERATE
// Same as UC-01's resolveWithLetter and UC-06's submitAmendmentApproval:
//   policy gate -> AUDIT (durable) -> state move
// The HR Ops sign-off audit row is written BEFORE the row is moved to
// `signed_off`. If the process dies in between, history says "HR Ops
// signed off this report" while the row still reads `pending_signoff` —
// visible, safely retryable (the next sign-off call just hits the
// "already decided" refusal code), and never the other way around: a
// signed-off report with no record of who signed it.
//
// THERE IS NO EXECUTION WRITE
// UC-05.md §3 and the ticket itself both note that no Remote write
// endpoint (PUT /v1/resignations/{id}/validate, or similar) is confirmed
// to exist. The "execution" here is the HR Ops sign-off itself — it
// produces a validated, audit-logged discrepancy report; downstream
// systems (not this one) act on it. workflow.js therefore never calls
// remote.patchEmploymentBasicInformation() or any equivalent — there is
// no execution path to invoke. The store has no markExecuted() method
// for the same reason (see resignationStore.js's header).
// ---------------------------------------------------------------------------

import { normalizeDecisionAction } from "../shared/declineVocabulary.js";
import { verifyRequester } from "../shared/identity.js";
import { evaluate as evaluatePolicy } from "./policyEngine.js";
import { payoutCurrencyFor } from "./ptoPayout.js";
import { describeSignoffBasis } from "./decisionFacts.js";
import { extractFromLetter } from "./letterExtractor.js";
import { evaluateSignoffAction } from "./signoffPolicy.js";
import { classifyRisk } from "../shared/riskEngine.js";

import { claimExternalRef } from "../shared/workflowClaims.js";
import { remoteFor } from "../shared/remoteWorld.js";
import { normalizeLeaveBalances, LEAVE_BALANCE_SOURCE } from "../remote/leaveBalances.js";

/**
 * Where the PTO days in a decision came from. Recorded on every audit row and
 * returned to the caller, because "the employee typed 20" and "Remote says
 * 13.75" are the same number in the report and completely different claims.
 */
export const PTO_SOURCE_CALLER = "caller_supplied";
export const PTO_SOURCE_REMOTE = LEAVE_BALANCE_SOURCE;
export const PTO_SOURCE_UNREAD = "not_read";
export const PTO_SOURCE_UNREADABLE = "remote_leave_policy_summary_unreadable";

/**
 * Read the employee's leave balances from Remote — the read UC-05.md §7 has
 * promised since the spec was written and which, until now, nothing made.
 *
 * WHY THIS MATTERS MORE HERE THAN ANYWHERE ELSE IN THE REPO. The number it
 * replaces was **whatever the requester typed into a form**, and it is
 * multiplied by a pay rate and printed on a resignation settlement the employee
 * signs. Every other unsourced figure in this system escalates to a human who
 * can check it; this one had a signature line under it.
 *
 * ORDER OF PRECEDENCE, and each rung is a different fact:
 *   1. Balances the caller supplied      -> used unchanged (`caller_supplied`).
 *      The portal form and the tests genuinely hold their own numbers, and a
 *      read that silently overrode them would make the form a lie.
 *   2. Remote's leave-policy summary     -> `remote_leave_policy_summary`.
 *   3. A client with no such method      -> `not_read`, and behaviour identical
 *      to before this function existed. Every hand-built fake `remote` in the
 *      suite lands here, which is why wiring the read broke nothing.
 *   4. A read that FAILED                -> `..._unreadable`, and one balance
 *      line carrying no figure, so gate 6 refuses. This is the only rung that
 *      changes an outcome, and it changes it in the fail-closed direction: we
 *      asked Remote about this employee's accrued leave and did not get an
 *      answer, which is not the same fact as "no balances were mentioned" and
 *      must not settle quietly at nothing.
 *
 * IT NEVER THROWS. The read sits upstream of the audit write, and a throw here
 * loses a resignation with no record that anyone filed one — finding F-28's
 * exact shape, and the reason `reconcilePtoPayout()` classifies before it
 * multiplies.
 *
 * @param {object} args
 * @param {object} args.remote
 * @param {string} args.employmentId
 * @param {Array<object>} args.supplied              balances the ticket carried
 * @param {number|null} args.hourlyRateInRemoteInteger  the rate to attach to
 *   Remote-read lines. Remote publishes none — see leaveBalances.js's header —
 *   so without one the lines are refused by name rather than rated by guess.
 * @returns {Promise<{balances: object[], ptoSource: string, upstreamFailure: object|null}>}
 */
async function readTimeOffBalances({ remote, employmentId, supplied, hourlyRateInRemoteInteger }) {
  if (Array.isArray(supplied) && supplied.length > 0) {
    return { balances: supplied, ptoSource: PTO_SOURCE_CALLER, upstreamFailure: null };
  }
  if (!remote || typeof remote.listLeavePolicySummary !== "function") {
    return { balances: [], ptoSource: PTO_SOURCE_UNREAD, upstreamFailure: null };
  }

  let raw = null;
  let thrown = null;
  try {
    raw = await remote.listLeavePolicySummary(employmentId);
  } catch (err) {
    raw = null;
    thrown = err;
  }

  const balances = raw === null ? null : normalizeLeaveBalances(raw, { hourlyRateInRemoteInteger });
  if (balances === null) {
    return {
      // A LINE WITH NO FIGURE, NOT AN EMPTY LIST. An empty list reads downstream
      // as "nothing was mentioned" and lets the report reach sign-off with its
      // money column quietly absent. One unusable line reads as "there is a
      // balance here and we could not read it", which is the truth and which
      // gate 6 escalates on.
      balances: [
        {
          timeOffType: "unknown",
          daysAvailable: null,
          unavailable: PTO_SOURCE_UNREADABLE,
          source: LEAVE_BALANCE_SOURCE,
        },
      ],
      ptoSource: PTO_SOURCE_UNREADABLE,
      upstreamFailure: {
        call: "leave_policy_summary",
        // 404 is the only status this client can observe here: listLeavePolicySummary()
        // maps it to null, and any other HTTP failure arrives as the throw caught
        // above. Recorded as unreachable in that case, because a 403 or a 503
        // says nothing whatever about this employee's leave.
        status: thrown === null ? 404 : null,
        kind: thrown === null ? "not_found" : "unreachable",
        message:
          thrown === null
            ? "Remote returned no readable leave-policy summary for this employment"
            : `the leave-policy summary read failed: ${String(thrown?.message ?? thrown).slice(0, 160)}`,
      },
    };
  }
  return { balances, ptoSource: PTO_SOURCE_REMOTE, upstreamFailure: null };
}

/**
 * Handle a resignation request. Runs every deterministic gate once and
 * records the outcome. This never executes anything by itself, even for a
 * `prepared_for_signoff` decision. Only submitResignationApproval() below
 * can mark the report as signed-off.
 *
 * @param {object} ticket
 * @param {string} ticket.employmentId
 * @param {object|null} ticket.session          {authenticatedEmploymentId} — the
 *   authenticated requester, matched against the employment's own id. Fails
 *   closed: no session, or a mismatched id, means unverified — same
 *   "identity from a signal, never a claim" rule as UC-01.
 * @param {string} [ticket.letterText]          free-text resignation letter body, if any.
 *   The LLM extracts the stated departure date + reason from it; the result
 *   is logged + attached to the report but never re-parsed into a decision
 *   (00-FOUNDATION.md invariant #1).
 * @param {Array<object>} [ticket.timeOffBalances]  structured time-off records; passed
 *   straight into ptoPayout.js
 * @param {string} [ticket.currency]            single currency for the PTO payout
 * @param {string} [ticket.proposedEndDate]     "YYYY-MM-DD" — explicit, when the
 *   caller already knows the date (e.g. a structured form submission that
 *   never went through the LLM extractor). Overrides any LLM extraction.
 * @param {string} [ticket.reason]              explicit, when the caller already knows
 *   the reason. Overrides any LLM extraction.
 * @param {number} [ticket.remoteDaysOfNotice]  Remote's own `days_of_notice` off
 *   the resignation record, when the caller read one. Held against the statutory
 *   figure; absent, the case says so rather than presenting one figure as agreed.
 * @param {object} [ticket.remoteResignation]  the whole resignation record, when the
 *   caller has it — `days_of_notice` and `offboarding_request_id` are read off it
 * @param {string} [ticket.offboardingRequestId]  the id the resignation family is
 *   addressed by. NOT an employment id and NOT a resignation id
 * @param {string} [ticket.externalRef]
 * @param {string} [ticket.source]
 * @param {string|number|Date} [ticket.now]     override for tests; defaults to real now
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./resignationStore.js").ResignationStore} deps.resignationStore
 * @param {typeof extractFromLetter} [deps.extract]   override for tests — defaults to the
 *   real extractFromLetter() so production is unaffected; injectable so a test
 *   that doesn't care about letter-extraction never makes a real, retried
 *   LLM call just because OPENAI_API_KEY happens to be set in its environment.
 */
export async function handleResignationRequest(
  ticket,
  { remote, audit, resignationStore, extract = extractFromLetter } = {}
) {
  const {
    employmentId,
    session = null,
    letterText = "",
    timeOffBalances = [],
    hourlyRateInRemoteInteger = null,
    proposedEndDate: explicitProposedEndDate = null,
    reason: explicitReason = null,
    externalRef = null,
    source = null,
    now = new Date().toISOString(),
  } = ticket;

  // REMOTE'S OWN `days_of_notice`, WHEN THE CALLER HAS ONE (2026-09-02, `[N-5]`).
  //
  // It lives on `GET /v1/resignations/{offboarding_request_id}` — Remote's own
  // description: *"The number of calendar days of notice required based on the
  // contract terms and local labor laws"* — and until this pass nothing in this
  // repository read it. See noticeReconciliation.js for what is done with it.
  //
  // THIS FUNCTION DOES NOT FETCH IT, AND THAT IS A NAMED GAP RATHER THAN A
  // DESIGN. Three things are missing and none of them is code in this file: the
  // token holds no `resignation:read` scope; no `offboarding_request_id` exists
  // anywhere in this system (the resignation family is addressed by that id, not
  // by an employment id, and using the wrong one returns a 404 indistinguishable
  // from an absent route — DRIFT-063 records that mistake being made once
  // already); and `RemoteClient` has no method for the endpoint. So the value is
  // ACCEPTED from a caller that has read it, and its absence is reported as
  // `not_compared / remote_figure_absent` rather than quietly treated as
  // agreement. Both spellings are taken because both shapes are what a caller
  // holds: the bare figure, or the record it came off.
  const remoteResignation = ticket.remoteResignation ?? null;
  const remoteDaysOfNotice =
    ticket.remoteDaysOfNotice ?? remoteResignation?.days_of_notice ?? null;
  const remoteRecordRef =
    ticket.offboardingRequestId ?? remoteResignation?.offboarding_request_id ?? remoteResignation?.id ?? null;

  const employment = await remote.getEmployment(employmentId);

  // THE CURRENCY IS REMOTE'S WHEN REMOTE STATES ONE. `contract_details.
  // compensation_currency_code` is [CONFIRMED] live on the NL/US/CA records
  // ("EUR"/"USD"/"CAD"); the old default silently labelled every settlement USD,
  // and a Dutch employee's payout printed "1,100.00 USD" for a figure computed
  // in euros. Naming a currency is not arithmetic, so preferring Remote's costs
  // nothing and asserts nothing — and an explicit `ticket.currency` still wins,
  // because a caller that named one is stating a fact about its own numbers.
  // No trailing "USD": an absent currency now REFUSES the payout line in
  // reconcilePtoPayout() rather than denominating it in dollars. See
  // payoutCurrencyFor() for why the rule lives in one place.
  const currency = payoutCurrencyFor({ stated: ticket.currency, employment });

  // THE TIME OFF READ (UC-05.md §7). See readTimeOffBalances() above for the
  // precedence and for why a failed read produces a refused line rather than an
  // empty list.
  const { balances: resolvedBalances, ptoSource, upstreamFailure: ptoUpstreamFailure } = await readTimeOffBalances({
    remote,
    employmentId,
    supplied: timeOffBalances,
    hourlyRateInRemoteInteger,
  });

  // Same shape as UC-01's verifyRequester(): authenticated session is the
  // strong path; absent that, no third-party bypass for UC-05 (a third
  // party cannot file a resignation on someone's behalf — that's the
  // whole point of the rule).
  const identity = verifyRequester({ session, employment, requesterType: "self" });

  // Letter extraction (LLM seam). When the caller supplied an explicit
  // proposedEndDate / reason, we skip the LLM entirely — the structured
  // form-submission path is faster, cheaper, and not subject to drift.
  // The result is still tagged with source: "structured_input" so the
  // audit row is honest about which path produced it.
  //
  // A REASON ALONE DOES NOT SILENCE THE LETTER. This used to skip extraction
  // whenever EITHER a date OR a reason was typed, so a resignation that typed a
  // reason and stated its last day only in the letter — "My last working day
  // will be 30 November 2026" — was recorded as proposing no date at all, and
  // the screen said so. Found on the live deployment 2026-09-02 (ticket 227;
  // control 238 with no reason extracted 2026-11-30 at 0.9). Filed with a short
  // date in the letter plus a reason, a 62-day shortfall would have reached HR
  // Ops as prepared_for_signoff. The typed DATE is what makes extraction
  // unnecessary; a typed reason is merged with whatever the letter says.
  let extraction;
  if (explicitProposedEndDate) {
    extraction = { proposedEndDate: explicitProposedEndDate, reason: explicitReason, confidence: 1.0, source: "structured_input" };
  } else {
    const extracted = await extract({ text: letterText }, { audit });
    extraction = { ...extracted, reason: explicitReason ?? extracted?.reason ?? null };
  }

  // Pass the LLM/structured date through into the policy engine. The
  // calculator is the single source of truth for the statutory end date;
  // this is just the EMPLOYEE'S STATED date, never the source of any
  // decision by itself.
  // The notice calculator REJECTS a date it cannot trust rather than guessing —
  // including calendar rollovers like 2026-02-29, which JavaScript would
  // silently turn into 2026-03-01 and then compute a confident, wrong statutory
  // notice period from. That strictness is correct, but it must not reach the
  // caller as an unhandled throw: this ticket came from a real person resigning,
  // and a crash loses it before any audit row exists. Convert it into an
  // ordinary escalate — a human reads the letter and enters the date.
  let result;
  try {
    result = evaluatePolicy({
      identityVerified: identity.verified,
      employment,
      proposedEndDate: extraction.proposedEndDate,
      timeOffBalances: resolvedBalances,
      currency,
      now,
      remoteDaysOfNotice,
      remoteRecordRef,
    });
  } catch (err) {
    if (!(err instanceof RangeError)) throw err; // never swallow a genuine bug
    result = {
      decision: "escalate",
      reason: "unparseable_date",
      flags: ["date_not_a_valid_calendar_date"],
      notice: null,
      payout: null,
      riskTier: "medium",
      dateError: err.message,
    };
  }

  const requester = session?.authenticatedEmploymentId ?? "unauthenticated";

  // DELIVERY-LEVEL IDEMPOTENCY. Duplicate delivery is normal — Zendesk retries
  // webhooks and a trigger can fire twice on rapid updates. UC-01's ticket #5
  // proved the cost: two audit rows 30µs apart and a duplicate customer-facing
  // action. The guarantee is the (use_case, external_ref) primary key, not this
  // code: a check-then-act in application code has exactly the race that caused
  // that bug. Taken here because everything below is a durable record or an
  // outward act.
  const claim = await claimExternalRef({
    pgPool: resignationStore.pgPool ?? null,
    useCase: "UC-05",
    externalRef,
    decision: result.decision,
  });
  if (!claim.claimed) {
    return {
      decision: result.decision,
      reason: result.reason,
      duplicate: true,
      duplicateOf: externalRef,
    };
  }

  const row = resignationStore.createResignation({
    employmentId,
    requester,
    letterExtraction: extraction,
    notice: result.notice,
    payout: result.payout,
    decision: result.decision,
    reason: result.reason,
    flags: result.flags,
    externalRef,
    source,
  });

  const { tier } = classifyRisk("UC-05", result.flags);

  audit.log({
    useCase: "UC-05",
    action: result.decision,
    actor: requester,
    riskTier: tier,
    details: {
      resignationId: row.id,
      // PROVENANCE — the reference the requester holds and the surface they
      // used. src/auditview/readStore.js searches `details->>'externalRef'` BY
      // NAME; a row without it is a decision nobody can look up. Null when the
      // caller supplied none, never defaulted.
      externalRef,
      source,
      employmentId,
      extractionSource: extraction.source,
      proposedEndDate: extraction.proposedEndDate,
      extractionReason: extraction.reason,
      extractionConfidence: extraction.confidence,
      // WHERE THE PTO DAYS CAME FROM, and the read that failed if one did.
      // Without this the audit row records a settlement figure with no way to
      // tell a Remote-sourced balance from a typed one — which is the whole
      // defect the Time Off read closes, and it would have been closed
      // invisibly.
      ptoSource,
      ptoUpstreamFailure,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
      notice: result.notice,
      payout: result.payout,
    },
  });

  return {
    decision: result.decision,
    reason: result.reason,
    flags: result.flags,
    resignationId: row.id,
    notice: result.notice,
    payout: result.payout,
    extractionSource: extraction.source,
    ptoSource,
    // THE SAME DERIVATION THE API VIEW SERVES, from the row that was just
    // stored — so an intake surface reporting the outcome and HR Ops opening
    // the case a week later read one description, not two that can drift.
    // Never persisted: it describes the row, and a description stored beside
    // the thing it describes is how the two come to disagree.
    basis: describeSignoffBasis({ resignationRow: row }),
  };
}

/**
 * An HR Ops specialist signs off or denies a prepared report. This is
 * the entire "execution" of UC-05: the validated, signed-off discrepancy
 * report IS the durable artifact (UC-05.md §1). There is no downstream
 * Remote write to invoke — see the file header.
 *
 * @param {object} args
 * @param {string} args.resignationId
 * @param {"signoff"|"decline"} args.action  (`deny` accepted, legacy)
 * @param {string} args.approver
 * @param {string} [args.note]
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./resignationStore.js").ResignationStore} deps.resignationStore
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js), threaded to the approval policy and
 *   consulted there AFTER every existing refusal. It can only ever refuse —
 *   there is no return value that means "approved" — so it never fills a slot,
 *   satisfies a floor, or relaxes a gate. `null` = not enforced in this posture.
 */
export async function submitResignationApproval(
  { resignationId, action: rawAction, approver, note = "" },
  { remote, audit, resignationStore, entitlement = null }
) {
  const row = await resignationStore.findById(resignationId);
  // Normalised ONCE, at the edge: `deny` (what the installed ZAF bundle still
  // posts) becomes `decline`. Unknown input is returned unchanged, so a bogus
  // verb still fails evaluateSignoffAction()'s ACTIONS check.
  const action = normalizeDecisionAction(rawAction);
  const verdict = evaluateSignoffAction({ resignationRow: row, approver, action, entitlement });
  if (!verdict.allowed) {
    recordRefusal({ audit, row, action, approver, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = approver.trim();
  const { tier } = classifyRisk("UC-05", row.flags ?? []);

  // PROVENANCE COMES OFF THE ROW — sign-off runs in a different process from
  // the submission, days later, holding only a resignationId. Recoverable only
  // because `uc05_resignations` persists `external_ref` and `source`.
  const externalRef = row.externalRef ?? null;
  const source = row.source ?? null;

  // Freshness re-check: is the employment still active NOW?  policyEngine
  // already checked "is this employee active?" when the report was
  // prepared; sign-off can happen days later, by which point the employee
  // may already have been terminated through some other path. Same
  // discipline as UC-01's review/service.js and UC-06's
  // submitAmendmentApproval().
  if (action === "signoff") {
    // EXECUTE — here, READ — IN THE WORLD THE DECISION WAS MADE IN. UC-05
    // makes no Remote write (no such endpoint exists; the signed-off report is
    // the artifact), so the only cross-world call is this freshness re-read.
    // It still matters: a portal-originated report was prepared against the
    // mock, and re-reading the SAME employment from the real gateway can
    // answer with a different status — blocking a sign-off on a record the
    // decision never saw. Same resolver as UC-02/04/06/09.
    const employment = await remoteFor(remote, row.source).getEmployment(row.employmentId);
    if (!employment || employment.status !== "active") {
      const stale = { status: 409, code: "employment_no_longer_active", reason: "The employment record is no longer active." };
      audit.log({
        useCase: "UC-05",
        action: "resignation_signoff_blocked",
        actor,
        riskTier: tier,
        details: { resignationId, externalRef, source, observedStatus: employment?.status ?? "not_found" },
      });
      return { ok: false, ...stale, resignationId };
    }
  }

  if (action === "decline") {
    // `resignation_declined`, a NEW name checked against every audit action
    // this repository writes — it collides with none. History is not
    // rewritten: `resignation_denied` rows keep their name and
    // src/auditview/humanDecision.js keeps reading them, permanently.
    await audit.logDurable({
      useCase: "UC-05",
      action: "resignation_declined",
      actor,
      riskTier: tier,
      details: { resignationId, externalRef, source, note: note || null, aiDecision: row.decision },
    });
    await resignationStore.markDeclined(resignationId, actor, note);
    return { ok: true, status: 200, code: "declined", reason: `Declined by HR Ops.`, resignationId };
  }

  // --- signoff: audit BEFORE the state move (see file header)
  await audit.logDurable({
    useCase: "UC-05",
    action: "resignation_signed_off",
    actor,
    riskTier: tier,
    details: { resignationId, externalRef, source, note: note || null, aiDecision: row.decision },
  });
  await resignationStore.recordSignoff(resignationId, actor, note);
  return { ok: true, status: 200, code: "signed_off", reason: "HR Ops signed off the validated discrepancy report.", resignationId };
}

/**
 * Refusals with no identified actor are not audited — same reasoning as
 * UC-06's workflow.js's identical helper.
 */
const UNATTRIBUTED_REFUSALS = new Set(["approver_required", "unknown_action", "resignation_not_found"]);

function recordRefusal({ audit, row, action, approver, verdict }) {
  if (!row || UNATTRIBUTED_REFUSALS.has(verdict.code)) return;
  const { tier } = classifyRisk("UC-05", row.flags ?? []);
  audit.log({
    useCase: "UC-05",
    action: `resignation_${action}_refused`,
    actor: typeof approver === "string" && approver.trim() ? approver.trim() : "unknown",
    riskTier: tier,
    details: {
      resignationId: row.id,
      externalRef: row.externalRef ?? null,
      source: row.source ?? null,
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
    },
  });
}
