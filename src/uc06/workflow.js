// ---------------------------------------------------------------------------
// workflow.js  —  UC-06 end to end: request -> gates -> dual approval -> write
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The single entry point that wires the pure pieces (policyEngine.js,
// cutoffEngine.js, changeParser.js, dualApprovalPolicy.js) to I/O (Remote,
// AuditLogger, AmendmentStore) — same role src/uc01/workflow.js plays there.
//
// WRITE ORDERING ON APPROVAL IS DELIBERATE, SAME AS review/service.js:
//   policy gate -> freshness re-check -> AUDIT (durable) -> state -> Remote write
// The audit row for a human's approval is written BEFORE the write fires. If
// the process dies in between, history says "both approvals recorded" while
// the amendment still reads pending — visible, safely retryable (submitting
// again just re-attempts the write), and never the other way around: a real
// payroll write with no record of who authorized it.
// ---------------------------------------------------------------------------

import { normalizeDecisionAction } from "../shared/declineVocabulary.js";
import { classifyRisk } from "../shared/riskEngine.js";
import { evaluate as evaluatePolicy } from "./policyEngine.js";
import { describeAmendmentBasis } from "./decisionFacts.js";
import { draftSummary } from "./changeParser.js";
import { evaluateApprovalAction } from "./dualApprovalPolicy.js";
import { judgeNarrative } from "../shared/narrativeJudge.js";
import { notifyUrgentCutoff } from "./slackNotifier.js";

import { claimExternalRef } from "../shared/workflowClaims.js";
import { remoteFor } from "../shared/remoteWorld.js";
import { UPSTREAM_UNREACHABLE } from "../shared/upstreamFailure.js";

/**
 * Submit a proposed contract amendment. Runs every deterministic gate once
 * and records the outcome — this never executes anything by itself, even for
 * a "dual_approval_required" decision. Only submitAmendmentApproval() below
 * can trigger the actual Remote write, and only once both slots are filled.
 *
 * @param {object} ticket
 * @param {string} ticket.employmentId
 * @param {object|null} ticket.session   {companyId, authenticatedAdminId} — the
 *   authenticated requester's company, matched against the employment's own
 *   company_id. Fails closed: no session, or a mismatched company, means
 *   unverified — same "identity from a signal, never a claim" rule as UC-01.
 * @param {object} ticket.changes        structured proposed changes (see changeParser.js) — the
 *   ONLY source of truth for new values; never derived from free text.
 * @param {string} ticket.requestedEffectiveDate  "YYYY-MM-DD"
 * @param {string} [ticket.reasonText]   free-text context, summary-only (never a source of figures)
 * @param {string} [ticket.externalRef]
 * @param {string} [ticket.source]
 * @param {string} [ticket.now]          override for tests; defaults to real now
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./amendmentStore.js").AmendmentStore} deps.amendmentStore
 * @param {typeof draftSummary} [deps.draftSummary]  override for tests — defaults
 *   to the real draftSummary() so production is unaffected; injectable so a test
 *   that doesn't care about narrative content never makes a real, retried LLM
 *   call just because OPENAI_API_KEY happens to be set in its environment.
 * @param {typeof judgeNarrative} [deps.judge]  scoped faithfulness judge for the
 *   drafted summary. PURELY INFORMATIONAL: the verdict is attached to the
 *   amendment row for a specialist to see and is NEVER read by any policy/
 *   dual-approval gate (see narrativeJudge.js's own header). Defaults to the
 *   real judgeNarrative(), same hermetic-test hazard as draftSummary above —
 *   inject a fake in tests that don't care about it.
 * @param {typeof notifyUrgentCutoff} [deps.slack]  best-effort Slack alert for
 *   an `urgent_cutoff`-flagged amendment (see slackNotifier.js's own header).
 *   PURELY A SIDE CHANNEL: never awaited on the real decision path, never
 *   allowed to affect `decision`/`flags`, and a true no-op whenever
 *   SLACK_WEBHOOK_URL isn't set — which is what `npm test` always runs with.
 *   Defaults to the real, env-configured notifyUrgentCutoff(); inject a fake
 *   in tests that want to assert on the payload without a real webhook.
 */
export async function handleAmendmentRequest(
  ticket,
  {
    remote,
    audit,
    amendmentStore,
    draftSummary: draftSummaryFn = draftSummary,
    judge = judgeNarrative,
    slack = notifyUrgentCutoff,
  } = {}
) {
  const {
    employmentId,
    session = null,
    changes,
    requestedEffectiveDate,
    reasonText = "",
    externalRef = null,
    source = null,
    now = new Date().toISOString(),
  } = ticket;

  // Reads that FAILED rather than returned data (src/shared/upstreamFailure.js).
  // RemoteClient returns null on a 404 and THROWS on anything else, so the Node
  // path only ever observes `not_found`; the n8n path, whose HTTP nodes swallow
  // every status into an error item, also reports `unreachable`.
  const upstreamFailures = [];

  const employment = await remote.getEmployment(employmentId);
  if (!employment) {
    upstreamFailures.push({
      call: "employment",
      status: 404,
      kind: "not_found",
      message: "Remote returned 404 for this employment id",
    });
  }
  // BOTH sides must carry a real company id. `null === null` is not a match —
  // an identity control satisfied by two absent values is not a control, and
  // the n8n copy of this gate could be reached that way (see
  // workflows/nodes-uc06/amendmentGates.js's construction-site note).
  const identityVerified = Boolean(
    session && session.companyId && employment && employment.company_id && session.companyId === employment.company_id
  );

  // THE CONTRACT-AMENDMENT FORM, not `employment_basic_information`.
  // `getCountrySchema()` answers "what does this country's ONBOARDING basic
  // information need" — a form with no salary property and no hours property,
  // whose only write verb (`PUT .../basic-information`) does not accept an
  // `active` employment. UC-06 amends active contracts, so it asks the form
  // that can express one and whose write can run:
  // `GET /v1/contract-amendments/schema?employment_id=&country_code=`
  // [CONFIRMED live 2026-08-18 — see restClient.getContractAmendmentSchema()].
  //
  // THE FALLBACK IS FOR INJECTED CLIENTS, NOT FOR PRODUCTION. Several tests
  // and demos pass a hand-written `remote` double that only implements
  // `getCountrySchema`. Falling back keeps those working unchanged; a real
  // `RemoteClient` always has the new method, and so does the mock server, so
  // nothing that talks to either takes this path. It is a compatibility shim
  // with an explicit expiry condition (delete it when no double defines only
  // the old method), not a second supported behaviour.
  const fetchSchema = async () => {
    if (typeof remote.getContractAmendmentSchema === "function") {
      return remote.getContractAmendmentSchema(employment.id, employment.country_code);
    }
    return remote.getCountrySchema(employment.country_code);
  };
  const countrySchema = employment ? await fetchSchema() : { required: [] };
  if (employment && !countrySchema) {
    // THIS USED TO CLAIM A 404 IT HAD NOT OBSERVED, and that is a real
    // mis-attribution rather than a cosmetic one.
    //
    // `getContractAmendmentSchema()` returns null for FOUR different reasons —
    // an unresolvable country code, a 404, an unusable body, and (uniquely
    // among this client's reads) any THROWN status, because it wraps the call
    // in a try/catch so that a 500 cannot take down a decision. Live, NGA and
    // USA answer **500 for every employment**. Hard-coding `status: 404,
    // kind: "not_found"` therefore recorded "Remote says this record does not
    // exist" for what was actually "Remote's form service is erroring for this
    // country" — the precise distinction src/shared/upstreamFailure.js was
    // built to restore, re-lost at this one call site. A human triaging
    // `upstream_country_schema_404` goes looking for a bad employment id that
    // is perfectly fine.
    //
    // We genuinely cannot tell which of the four it was from a null, so we
    // record what we know and nothing more. `status: null` is exactly the case
    // upstreamFailure.js already legislates for: *"Only a 404 is an answer
    // ABOUT THE RECORD. Everything else — 403, 5xx, a socket error, an unknown
    // status — means the request was never truly evaluated."* An unknown
    // status is `unreachable`, which is the conservative and honest reading:
    // it claims nothing about the record. Making the client surface the real
    // status would be better still, and is the follow-up — but guessing the
    // most reassuring of four possibilities is worse than admitting ignorance.
    upstreamFailures.push({
      call: "country_schema",
      status: null,
      kind: UPSTREAM_UNREACHABLE,
      message:
        "Remote returned no usable contract-amendment schema for this employee's country " +
        "(the read 404'd, errored, or answered an unusable shape — the client cannot tell which)",
    });
  }
  // The payroll calendar read. `listPayrollRuns()` used to coerce its own 404
  // to `{payroll_runs: []}`, so this path could not tell an empty calendar from
  // a failed fetch and never reported a `payroll_runs` failure — leaving the
  // gate that exists for it in policyEngine.js reachable only from n8n, whose
  // HTTP node surfaces the status. It now returns null on a 404, the same
  // convention `getEmployment()`/`getCountrySchema()` use, and that null is
  // recorded here as an upstream failure rather than re-flattened into an empty
  // calendar one line later.
  //
  // `payrollCycles` is still [] on failure, deliberately: the gate above it
  // escalates before `evaluateCutoff()` ever runs, and passing anything else
  // would be inventing a calendar. The failure list, not the array, is what
  // carries the distinction.
  //
  // THE COUNTRY, NOT THE COMPANY, IS WHAT THIS READ NEEDS. `GET
  // /v1/payroll-runs` is already scoped to the company by the token and has no
  // `company_id` parameter at all (live: 422 "Unexpected field"), so the
  // company id passed here for months was never sent anywhere. What the
  // calendar DOES need narrowing by is the country: it is company-wide and
  // multi-country — live it spans five countries whose pay periods overlap —
  // and `evaluateCutoff()` below picks the first cycle covering the effective
  // date, so an unfiltered calendar would hand this employee whichever
  // country's cutoff happened to sort first. See RemoteClient.listPayrollRuns()
  // for the live evidence; a country the client cannot use yields null here,
  // which lands in `upstreamFailures` and escalates, rather than a confident
  // cutoff computed from the wrong jurisdiction.
  //
  // THE FAILURE IS NOW ATTRIBUTED RATHER THAN ASSUMED. This block used to
  // hard-code `status: 404, kind: "not_found"` for every absent calendar, which
  // was a guess in three of the four ways it can be absent: a 403 (the token
  // was refused), a 5xx (Remote was down), and "we hold no usable country code
  // for this employee, so the calendar was never requested" all arrived here
  // looking exactly like Remote answering that the calendar is not there. A
  // human reading `upstream_payroll_runs_404` then goes looking for a missing
  // calendar that exists. `listPayrollRunsResult()` reports which, in
  // src/shared/upstreamFailure.js's own vocabulary, and it does NOT throw for a
  // 403/5xx — a throw here propagates above the audit write below and loses the
  // amendment decision entirely (finding F-28's shape, one use case over).
  //
  // The capability check keeps every hand-built fake `remote` in the suite
  // working: a client without the newer method falls back to the older one and
  // to today's recorded reason, which is unchanged rather than newly wrong.
  const payroll = employment ? await readPayrollCalendar(remote, employment.country_code) : null;
  const payrollRuns = payroll?.payrollRuns ? { payroll_runs: payroll.payrollRuns } : null;
  if (employment && !payrollRuns) {
    upstreamFailures.push(
      payroll?.error ?? {
        call: "payroll_runs",
        status: 404,
        kind: "not_found",
        message: "Remote returned no usable payroll calendar for this employee's country",
      }
    );
  }

  const result = evaluatePolicy({
    identityVerified,
    employment,
    countrySchema,
    changes,
    requestedEffectiveDate,
    now,
    payrollCycles: payrollRuns?.payroll_runs ?? [],
    upstreamFailures,
  });

  const { summary } = await draftSummaryFn({ changes, requestedEffectiveDate, reasonText }, { audit });
  const requester = session?.authenticatedAdminId ?? "unauthenticated";

  // Faithfulness of that drafted summary to the structured facts it was
  // drafted from. Attached to the amendment record for a specialist to see
  // beside the prose — never consumed by any gate. `judge` returns
  // {verdict: "not_evaluated"} when unconfigured, which is exactly what
  // `npm test` (no OPENAI_API_KEY) hits, so the no-LLM path attaches an
  // explicit "not evaluated" state without ever blocking the flow.
  const faithfulness = await judge({ narrative: summary, structuredInputs: { changes, requestedEffectiveDate } });

  // DELIVERY-LEVEL IDEMPOTENCY. Duplicate delivery is normal — Zendesk retries
  // webhooks and a trigger can fire twice on rapid updates. UC-01's ticket #5
  // proved the cost: two audit rows 30µs apart and a duplicate customer-facing
  // action. The guarantee is the (use_case, external_ref) primary key, not this
  // code: a check-then-act in application code has exactly the race that caused
  // that bug. Taken here because everything below is a durable record or an
  // outward act.
  const claim = await claimExternalRef({
    pgPool: amendmentStore.pgPool ?? null,
    useCase: "UC-06",
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

  const amendment = amendmentStore.createAmendment({
    employmentId,
    requester,
    changes,
    amendmentType: result.amendmentType,
    requestedEffectiveDate,
    decision: result.decision,
    reason: result.reason,
    flags: result.flags,
    payload: result.payload ?? null,
    cutoff: result.cutoff ?? null,
    summary,
    faithfulness,
    externalRef,
    source,
  });

  const { tier } = classifyRisk("UC-06", result.flags);

  // Which payroll cycle this decision was checked against, and — critically —
  // whether that cycle is real Remote data or a demo continuation of it. The
  // Sandbox's own payroll calendar has a hard end date per country (see
  // src/remotebridge/payrollProjection.js, not owned by this use case); a
  // stand-in proxy may hand UC-06 a PROJECTED cycle carrying a `_standin`
  // marker so the approval path can be demonstrated past that date. Recording
  // only `cutoffCycle: id` left an auditor unable to tell the two apart
  // without knowing the undocumented `standin-` id-prefix convention — the
  // same "the fixture agreed with the code, never checked against the API"
  // failure shape CLAUDE.md's UC-03 postmortem describes, one layer up: here
  // it would be "the audit row agreed with the decision, never said which
  // calendar it came from." An explicit boolean plus the standin's own
  // `{projected, derivedFrom, cadence}` block (verbatim, never re-derived)
  // makes this answerable directly from `audit_log` without cross-referencing
  // anything.
  const cutoffCycle = result.cutoff?.cycle ?? null;
  const cutoffCycleStandin = cutoffCycle?._standin ?? null;

  audit.log({
    useCase: "UC-06",
    action: result.decision,
    actor: requester,
    riskTier: tier,
    details: {
      amendmentId: amendment.id,
      // PROVENANCE — the reference the requester was shown, and the surface
      // they used. src/auditview/readStore.js looks a decision up by
      // `details->>'externalRef'` BY NAME, so a row without it cannot be found
      // from the one id a human holds. Null when the caller supplied none;
      // never defaulted, because a fabricated reference returns the wrong trail.
      externalRef,
      source,
      employmentId,
      amendmentType: result.amendmentType,
      changes,
      reason: result.reason,
      flags: result.flags,
      requestedEffectiveDate,
      cutoffCycle: cutoffCycle?.id ?? null,
      cutoffCycleProjected: Boolean(cutoffCycleStandin),
      cutoffCycleStandin,
      summary,
      faithfulness,
      // WHICH read failed and WHAT it answered — the difference between a
      // triage that starts at the right service and one that hunts a phantom
      // identity bug. Empty on every healthy run.
      upstreamFailures,
    },
  });

  // Best-effort urgent-cutoff alert, AFTER both durable writes above
  // (amendmentStore.createAmendment() and audit.log()) — same "durable
  // record first, best-effort external notification second" ordering as the
  // n8n audit-before-Zendesk-action fix (CLAUDE.md's "Live resources"
  // entry). A Slack outage or missing config must never affect the decision
  // already recorded above, so this is fired without awaiting it and its
  // own promise never rejects (see slackNotifier.js) — the .catch() here is
  // belt-and-suspenders for whatever `slack` a caller/test injects.
  if (result.flags.includes("urgent_cutoff")) {
    Promise.resolve(
      slack({
        amendmentId: amendment.id,
        employmentId,
        amendmentType: result.amendmentType,
        requestedEffectiveDate,
        cutoff: result.cutoff,
        externalRef,
      })
    ).catch((err) => {
      console.error(`[uc06] urgent-cutoff Slack notification threw unexpectedly: ${err.message}`);
    });
  }

  return {
    decision: result.decision,
    reason: result.reason,
    flags: result.flags,
    amendmentId: amendment.id,
    amendmentType: result.amendmentType,
    summary,
    faithfulness,
    cutoff: result.cutoff ?? null,
    // THE SAME BASIS THE API VIEW SERVES, derived from the row that was just
    // stored — so the Remote UI stand-in reporting the outcome and the two
    // approvers opening the case later read one description rather than two
    // that can drift. Never persisted: it describes the row, and a description
    // stored beside the thing it describes is how the two come to disagree.
    basis: describeAmendmentBasis({ amendmentRow: amendment }),
  };
}

/**
 * A specialist (customer admin or payroll specialist) approves or declines an
 * amendment. Executes the Remote PATCH only once BOTH roles have approved.
 *
 * `deny` is still accepted and normalised to `decline` here — the one place it
 * happens, so nothing downstream learns the alias existed. See
 * src/shared/declineVocabulary.js.
 *
 * @param {object} args
 * @param {string} args.amendmentId
 * @param {"customer_admin"|"payroll_specialist"} args.role
 * @param {"approve"|"decline"} args.action  (`deny` accepted, legacy)
 * @param {string} args.approver
 * @param {string} [args.note]
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./amendmentStore.js").AmendmentStore} deps.amendmentStore
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js), threaded to the approval policy and
 *   consulted there AFTER every existing refusal. It can only ever refuse —
 *   there is no return value that means "approved" — so it never fills a slot,
 *   satisfies a floor, or relaxes a gate. `null` = not enforced in this posture.
 */
export async function submitAmendmentApproval(
  { amendmentId, role, action: rawAction, approver, note = "" },
  { remote, audit, amendmentStore, entitlement = null }
) {
  const amendmentRow = await amendmentStore.findById(amendmentId);
  // Normalised ONCE, at the edge; unknown input passes through unchanged so a
  // bogus verb still fails evaluateApprovalAction()'s ACTIONS check.
  const action = normalizeDecisionAction(rawAction);
  const verdict = evaluateApprovalAction({ amendmentRow, role, approver, action, entitlement });
  if (!verdict.allowed) {
    recordRefusal({ audit, amendmentRow, role, action, approver, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = approver.trim();
  const { tier } = classifyRisk("UC-06", amendmentRow.flags ?? []);

  // PROVENANCE COMES OFF THE ROW. Dual approval happens in a different process
  // from the request, often days later, holding only an amendmentId — the
  // reference and surface survive only because `uc06_amendments` persists
  // `external_ref` and `source`.
  const externalRef = amendmentRow.externalRef ?? null;
  const source = amendmentRow.source ?? null;

  // EXECUTE IN THE WORLD THE DECISION WAS MADE IN. A record submitted through
  // the request portal was decided against this repo's mock Remote (a public
  // page must never write into a real account), so its ids belong to the mock,
  // not the Sandbox. Executing it against the real gateway 404s — found live
  // on UC-02, whose released claim addressed an `exp_*` fixture id the real
  // Sandbox has never heard of. Resolved from the row's own durable `source`,
  // never from the shape of an id: the portal's personas MIRROR real
  // employment ids, so an id heuristic would be wrong half the time and wrong
  // invisibly. See src/shared/remoteWorld.js.
  const remoteForRow = remoteFor(remote, amendmentRow.source);

  if (action === "decline") {
    // `amendment_declined`, a NEW name, checked against every audit action this
    // repository writes — it collides with none. `amendment_denied` rows keep
    // their name forever; audit_log is append-only and
    // src/auditview/humanDecision.js reads both spellings.
    await audit.logDurable({
      useCase: "UC-06",
      action: "amendment_declined",
      actor,
      riskTier: tier,
      details: { amendmentId, externalRef, source, role, note: note || null, aiDecision: amendmentRow.decision },
    });
    await amendmentStore.markDeclined(amendmentId, role, actor, note);
    return { ok: true, status: 200, code: "declined", reason: `Declined by ${role}.`, amendmentId };
  }

  // --- approve: record this role's slot durably, THEN check if both are in.
  await audit.logDurable({
    useCase: "UC-06",
    action: "amendment_approved",
    actor,
    riskTier: tier,
    details: { amendmentId, externalRef, source, role, note: note || null, aiDecision: amendmentRow.decision },
  });
  const afterApproval = await amendmentStore.recordApproval(amendmentId, role, actor, note);

  if (!amendmentStore.isFullyApproved(afterApproval)) {
    return { ok: true, status: 200, code: "approved_awaiting_second", reason: `${role} approved; waiting on the other role.`, amendmentId };
  }

  // --- Both approvals are in. CLAIM THE ROW BEFORE DOING ANYTHING ELSE
  // (finding F-09). Two approvals landing together both saw "fully approved"
  // here and both ran on to the PATCH, double-writing real payroll. Every
  // statement between this point and the PATCH is an await, and every await
  // is a window for the second caller. The claim is a compare-and-set exactly
  // one caller can win — see amendmentStore.claimForExecution().
  const claimed = await amendmentStore.claimForExecution(amendmentId);
  if (!claimed) {
    await audit.log({
      useCase: "UC-06",
      action: "amendment_execution_not_claimed",
      actor,
      riskTier: tier,
      details: {
        amendmentId,
        externalRef,
        source,
        role,
        reason: "another approval is already executing this amendment",
      },
    });
    return {
      ok: true,
      status: 200,
      code: "execution_already_claimed",
      reason: "Both approvals are in and another request is already applying this amendment.",
      amendmentId,
    };
  }

  // --- Freshness re-check: is this still true?
  // policyEngine.js already checked "is this employee active?" when the
  // amendment was created; approval can happen days later — same reasoning
  // as review/service.js's re-check before issuing UC-01's letter.
  const employment = await remoteForRow.getEmployment(amendmentRow.employmentId);
  if (!employment || employment.status !== "active") {
    const stale = { status: 409, code: "employment_no_longer_active", reason: "The employment record is no longer active." };
    await audit.log({
      useCase: "UC-06",
      action: "amendment_execution_blocked",
      actor,
      riskTier: tier,
      details: { amendmentId, externalRef, source, observedStatus: employment?.status ?? "not_found" },
    });
    // Nothing was written to Remote, so the claim goes back and the amendment
    // returns to pending_dual_approval.
    await amendmentStore.releaseExecutionClaim(amendmentId);
    return { ok: false, ...stale, amendmentId };
  }

  // THE CONTRACT ID IS READ NOW, NOT STORED AT REQUEST TIME.
  // `POST /v1/contract-amendments` requires `amendment_contract_id` — *"the
  // contract ID of the contract that needs to be amended"* — and the value is
  // the employment's `active_contract_id`. Approval can be days after the
  // request, and the contract that was active then may not be the one active
  // now; a stale id would amend the wrong contract, or 404
  // `amended_contract_not_found`. So it comes off the record this function
  // just re-read for freshness, alongside the status re-check, rather than
  // from the amendment row.
  //
  // A record with no active contract is a REFUSAL, not a write with a null.
  // Same rule as every other absent value in this use case: escalate naming
  // the field, never invent one.
  const amendmentContractId = employment.active_contract_id ?? null;
  if (!amendmentContractId) {
    await audit.logDurable({
      useCase: "UC-06",
      action: "amendment_execution_blocked",
      actor,
      riskTier: tier,
      details: {
        amendmentId,
        externalRef,
        source,
        reason: "amendment_contract_unavailable",
        missingField: "active_contract_id",
      },
    });
    await amendmentStore.releaseExecutionClaim(amendmentId);
    return {
      ok: false,
      status: 409,
      code: "amendment_contract_unavailable",
      reason: "The employment record carries no active contract id, so there is nothing to amend against.",
      amendmentId,
    };
  }

  // Idempotency key = the amendment's own id (finding F-18): the same POST
  // retried by the REST client, or re-submitted by a human after a crash, is
  // recognisable to Remote as one logical write. No try/catch releasing the
  // claim here — see the twin comment in uc09/workflow.js on why an in-doubt
  // write must not hand the retry button back automatically.
  //
  // WHY THIS IS NO LONGER patchEmploymentBasicInformation(). That call was
  // three separate impossibilities at once, each verified live 2026-08-18:
  // the PATCH verb 404s on that path, the form it validates against has no
  // salary or hours property, and its documented status set
  // (created / job_title_review / created_reserve_paid /
  // created_awaiting_reserve) excludes `active` — the ONLY status this use
  // case's own gate 2 admits. See restClient.js for the captures.
  const remoteResult = await remoteForRow.createContractAmendment(
    {
      employmentId: amendmentRow.employmentId,
      amendmentContractId,
      contractAmendment: amendmentRow.payload,
    },
    { idempotencyKey: amendmentId }
  );

  await audit.logDurable({
    useCase: "UC-06",
    action: "amendment_executed",
    actor,
    riskTier: tier,
    details: { amendmentId, externalRef, source, payload: amendmentRow.payload, remoteResult },
  });
  await amendmentStore.markExecuted(amendmentId, remoteResult);

  return { ok: true, status: 200, code: "executed", reason: "Both approvals recorded; amendment applied.", amendmentId };
}

/**
 * Refusals with no identified actor are not audited — same reasoning as
 * review/service.js's recordRefusal(): an unattributed row in an append-only
 * log is worse than no row, since anyone reaching the endpoint could pad it.
 */
const UNATTRIBUTED_REFUSALS = new Set(["approver_required", "unknown_role", "unknown_action", "amendment_not_found"]);

function recordRefusal({ audit, amendmentRow, role, action, approver, verdict }) {
  if (!amendmentRow || UNATTRIBUTED_REFUSALS.has(verdict.code)) return;
  const { tier } = classifyRisk("UC-06", amendmentRow.flags ?? []);
  audit.log({
    useCase: "UC-06",
    action: `amendment_${action}_refused`,
    actor: typeof approver === "string" && approver.trim() ? approver.trim() : "unknown",
    riskTier: tier,
    details: {
      amendmentId: amendmentRow.id,
      externalRef: amendmentRow.externalRef ?? null,
      source: amendmentRow.source ?? null,
      role,
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
    },
  });
}

/**
 * The payroll-calendar read, through whichever interface this client offers.
 *
 * `listPayrollRunsResult()` is the one that can say WHY there is no calendar;
 * `listPayrollRuns()` is the older method that answers null for a 404 and
 * throws for anything else. Both are supported because the second is what every
 * hand-built fake `remote` in the test suite implements, and turning all of them
 * into upstream failures for a capability they were never asked to have would
 * be a change in what this workflow decides, dressed up as a change in how it
 * reports.
 *
 * @param {object} remote
 * @param {string|null} countryCode
 * @returns {Promise<{payrollRuns: object[]|null, error: object|null}>}
 */
async function readPayrollCalendar(remote, countryCode) {
  if (typeof remote?.listPayrollRunsResult === "function") {
    const result = await remote.listPayrollRunsResult({ countryCode });
    // The `thrown` field is an Error carried for listPayrollRuns()'s benefit.
    // It must not reach an audit row: it serialises to `{}` and would make the
    // failure look empty.
    if (result?.error) {
      const { thrown, ...failure } = result.error; // eslint-disable-line no-unused-vars
      return { payrollRuns: result.payrollRuns, error: failure };
    }
    return result;
  }
  const legacy = await remote.listPayrollRuns({ countryCode });
  return { payrollRuns: legacy?.payroll_runs ?? null, error: null };
}
