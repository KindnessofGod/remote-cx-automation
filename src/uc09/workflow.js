// ---------------------------------------------------------------------------
// workflow.js  —  UC-09 end to end: request -> gates -> multi approval -> incentive POST
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The single entry point that wires the pure pieces (policyEngine.js,
// adjustmentParser.js, multiApprovalPolicy.js) to I/O (Remote,
// AuditLogger, AdjustmentStore) — same role src/uc01/workflow.js plays there.
//
// WRITE ORDERING ON APPROVAL IS DELIBERATE, SAME AS review/service.js:
//   policy gate -> freshness re-check -> AUDIT (durable) -> state -> Remote POST
// The audit row for a human's approval is written BEFORE the POST fires. If
// the process dies in between, history says "approvals recorded" while
// the adjustment still reads pending — visible, safely retryable (submitting
// again just re-attempts the POST), and never the other way around: a real
// payroll write with no record of who authorized it.
// ---------------------------------------------------------------------------

import { classifyRisk } from "../shared/riskEngine.js";
import {
  evaluate as evaluatePolicy,
  INCENTIVE_REQUIRED_FIELDS,
  prepareIncentivePayload,
} from "./policyEngine.js";
import { parseAdjustmentRequest } from "./adjustmentParser.js";
// isFullyApproved is IMPORTED, not re-implemented. This file used to carry its
// own private copy that read `filledCount >= approvalSlotsRequired` — the
// pre-F-02/F-03 logic, counting signatures rather than signatories and
// treating a null requirement as satisfied. multiApprovalPolicy.js's version
// had already been hardened to count DISTINCT HUMANS and to floor the
// requirement at two, but the execution path never called it: the fixed
// function was dead code and the money still flowed through the broken twin.
// One definition of "enough approvals", in the file whose job that is.
import { evaluateApprovalAction, isFullyApproved } from "./multiApprovalPolicy.js";
import { judgeNarrative } from "../shared/narrativeJudge.js";
import { toRemoteInteger, fromRemoteInteger } from "../shared/money.js";

import { claimExternalRef } from "../shared/workflowClaims.js";
import { remoteFor } from "../shared/remoteWorld.js";
import { isUpstreamReason } from "../shared/upstreamFailure.js";

/**
 * Submit a proposed off-cycle payroll adjustment. Runs every deterministic gate once
 * and records the outcome — this never executes anything by itself, even for
 * an "approval_required" decision. Only submitAdjustmentApproval() below
 * can trigger the actual Remote write, and only once required slots are filled.
 *
 * @param {object} ticket
 * @param {string} ticket.employmentId
 * @param {object|null} ticket.session   {companyId, authenticatedAdminId} — the
 *   authenticated requester's company, matched against the employment's own
 *   company_id. Fails closed: no session, or a mismatched company, means
 *   unverified — same "identity from a signal, never a claim" rule as UC-01.
 * @param {object} ticket.adjustmentRequest        structured or free-text adjustment request
 * @param {string} [ticket.requestText]   free-text request (parsed by LLM)
 * @param {string} [ticket.reasonText]   free-text context, summary-only (never a source of figures)
 * @param {string} [ticket.externalRef]
 * @param {string} [ticket.source]
 * @param {string} [ticket.now]          override for tests; defaults to real now
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./adjustmentStore.js").AdjustmentStore} deps.adjustmentStore
 * @param {typeof parseAdjustmentRequest} [deps.parseAdjustment]  override for tests — defaults
 *   to the real parseAdjustment() so production is unaffected; injectable so a test
 *   that doesn't care about narrative content never makes a real, retried LLM
 *   call just because OPENAI_API_KEY happens to be set in its environment.
 * @param {typeof judgeNarrative} [deps.judge]  scoped faithfulness judge for the
 *   drafted summary. PURELY INFORMATIONAL: the verdict is attached to the
 *   adjustment row for a specialist to see and is NEVER read by any policy/
 *   multi-approval gate (see narrativeJudge.js's own header). Defaults to the
 *   real judgeNarrative(), same hermetic-test hazard as parseAdjustment above —
 *   inject a fake in tests that don't care about it.
 */
export async function handleAdjustmentRequest(
  ticket,
  { remote, audit, adjustmentStore, parseAdjustment: parseAdjustmentFn = parseAdjustmentRequest, judge = judgeNarrative } = {}
) {
  const {
    employmentId,
    session = null,
    adjustmentRequest,
    requestText = "",
    reasonText = "",
    externalRef = null,
    source = null,
    now = new Date().toISOString(),
  } = ticket;

  // Reads that FAILED rather than returned data (src/shared/upstreamFailure.js).
  // RemoteClient returns null on a 404 and THROWS on anything else, so the Node
  // path only ever observes `not_found`; the n8n path, whose HTTP node swallows
  // every status into an error item, also reports `unreachable`.
  const upstreamFailures = [];

  // Get employment record and validate identity
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
  // the Zendesk intake path deliberately emits `session.companyId: null` so this
  // gate fails closed, and an employment record with a null company_id used to
  // satisfy it anyway (see workflows/nodes-uc09/adjustmentGates.js's
  // construction-site note for the reproduction). Reproduced live: a request
  // with no company id on EITHER side used to reach `dual_approval_required`
  // instead of `escalate` / `identity_not_verified`.
  const identityVerified = Boolean(
    session && session.companyId && employment && employment.company_id && session.companyId === employment.company_id
  );

  // Parse the adjustment request if it's free text, otherwise use structured input
  let parsedAdjustment;
  if (requestText && requestText.trim()) {
    // Parse from free text using LLM. adjustmentParser.js's own prompt asks for
    // "amount: number (in human-readable format...)", so this path's amount is
    // ALWAYS human-scale — no ambiguity, no heuristic needed: always convert.
    // THE SEAM IS THE REAL ONE (finding F-10). This used to read
    // `{askJson: remote.askJson, isConfigured: remote.isLlmConfigured}` —
    // neither property exists on RemoteClient, so `isConfigured` was
    // `undefined` on every single request and the parser took its fallback
    // branch 100% of the time. The LLM path had never run. Passing no seam at
    // all is now correct AND safer: adjustmentParser.js defaults to
    // shared/llm.js's askJson/isLlmConfigured, which is the same one-adapter
    // rule every other use case follows, and tests inject `parseAdjustment`
    // (see deps above) so `npm test` still never reaches OpenAI.
    parsedAdjustment = await parseAdjustmentFn({ requestText, context: { employment } }, { audit });
    if (typeof parsedAdjustment.amount === "number") {
      parsedAdjustment.amount = toRemoteInteger(parsedAdjustment.amount);
    }
  } else {
    // Use structured input directly. Per every other use case's convention
    // (UC-02's expense amounts, UC-06's `changes` payload), structured/webhook
    // input arrives ALREADY in Remote's ×100 integer format — the caller's
    // responsibility, never re-derived here. A magnitude-based "does this look
    // human-scale?" heuristic used to run on this branch too and would
    // silently re-scale an already-correct Remote amount whenever it happened
    // to fall under 10,000,000 — a real 100x money bug on the one use case
    // where money actually moves. Removed: this branch trusts the caller,
    // exactly like every sibling use case does.
    parsedAdjustment = { ...adjustmentRequest, source: "structured_input" };
  }

  // Run policy evaluation. The incentive payload is validated against its
  // own fixed required-field list (INCENTIVE_REQUIRED_FIELDS), never
  // against remote.getCountrySchema() — that endpoint answers "what does
  // employment_basic_information need" (UC-06's PATCH), a different Remote
  // object than the incentive this workflow writes. See policyEngine.js's
  // own comment on INCENTIVE_REQUIRED_FIELDS for the bug this replaced.
  const result = evaluatePolicy({
    identityVerified,
    employment,
    incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
    adjustment: parsedAdjustment,
    now,
    upstreamFailures,
  });

  // GUARD THE MONEY MATH BEFORE IT RUNS. fromRemoteInteger() throws a TypeError
  // on anything that is not an integer — undefined, null, NaN, Infinity, or a
  // numeric STRING like "500000" (a JSON payload that quoted its numbers). That
  // throw used to escape this function, which meant a malformed webhook on the
  // one use case that moves real money died with an unhandled exception BEFORE
  // any audit row was written: the request vanished with no record that it had
  // ever arrived, and no human was told. Found by the brute-force simulator
  // (src/simulator/), which crashed 100% of malformed-amount interactions here.
  //
  // Refusing explicitly is strictly better than crashing: it produces a
  // decision, an audit trail, and a human-readable reason, and it keeps the
  // "never execute on a number we do not trust" rule visible in the code rather
  // than implicit in a helper's exception. Note it does NOT coerce the string
  // case — silently accepting "500000" is how a 100x scaling bug gets in.
  // A parser REFUSAL (finding F-10) is a distinct, expected outcome, not a
  // malformed payload: the request was fine, we simply have no trustworthy
  // figure for it. It is reported with its own reason and flag so the metrics
  // dashboard can count "how often did we refuse to guess" separately from
  // "how often did a sender post garbage" — the first is a working control,
  // the second is somebody's integration bug.
  //
  // ---------------------------------------------------------------------------
  // THREE THINGS THIS BLOCK USED TO GET WRONG (F-33, all found by driving the
  // portal rather than by reading it). It used to `return` here, before the
  // claim and before adjustmentStore.createAdjustment().
  // ---------------------------------------------------------------------------
  //  1. IT STILL CRASHED, on the one intersection it exempted itself from.
  //     The guard was skipped whenever gate 0 had already reported an upstream
  //     failure — and then fell straight through to fromRemoteInteger() below
  //     with the very non-integer it had just declined to guard. A request
  //     naming an employment id Remote cannot resolve, whose amount also could
  //     not be parsed, threw exactly the TypeError this comment says was fixed:
  //     no audit row, no record, no ticket, HTTP 500, request gone. Reproduced
  //     live through POST /api/requests/uc09.
  //     The exemption's INTENT was right — "ordered gates, first failure wins",
  //     an upstream failure is the earlier gate — but the way to honour that is
  //     to keep the earlier gate's REASON, not to skip the guard.
  //  2. IT OVERWROTE EVERY EARLIER GATE, not just the upstream one. An
  //     adjustment for an archived employee came back `amount_not_extracted`
  //     instead of `employment_not_active`: the status gate had already refused
  //     it, correctly, and this block relabelled the refusal as the parser's.
  //     With no LLM reachable that is EVERY request, so the identity and status
  //     gates became unobservable — the "structurally cannot succeed and
  //     appropriately cautious look identical from outside" failure this repo
  //     keeps paying for, one layer in.
  //  3. IT WROTE NO RECORD, alone among UC-09's refusals. Every other escalate
  //     path falls through to createAdjustment(); this one returned first. So
  //     the portal raised a Payroll Ops ticket for an adjustment that did not
  //     exist, "my requests" reported "the record could not be read back" (a
  //     database fault that had not happened), the ZAF sidebar's by-ticket
  //     lookup found nothing, and — because the return also jumped over
  //     claimExternalRef() — a redelivery of the same externalRef wrote a
  //     SECOND audit row and raised a SECOND ticket. Verified: two deliveries,
  //     one ref, two audit rows, `duplicate: false` on the second.
  //
  // So the amount problem no longer returns early. It adjusts the outcome and
  // rejoins the one path every other decision takes, which is also the only
  // path that claims the ref and records anything.
  const parseRefusal = typeof parsedAdjustment.refusal === "string" ? parsedAdjustment.refusal : null;
  const amountUsable = Number.isInteger(parsedAdjustment.amount);

  // `result` is the policy engine's verdict; `outcome` is what actually gets
  // recorded once the amount is taken into account. They differ only when the
  // amount is unusable.
  let outcome = result;
  if (!amountUsable) {
    // Which gate is really first? The policy engine runs identity, employment
    // status and schema BEFORE its own adjustment-structure check, so anything
    // it refused for a reason other than `invalid_adjustment_structure` refused
    // for a reason that PRECEDES the amount. That reason stands; the amount
    // problem rides along as a flag so nothing is hidden. Only when the amount
    // is genuinely the first thing wrong does it become the reason.
    const amountIsFirstFailure =
      result.decision !== "escalate" || result.reason === "invalid_adjustment_structure";

    const amountFlags = parseRefusal
      ? ["amount_not_extracted", `parser_${parseRefusal}`]
      : ["amount_not_an_integer"];

    outcome = {
      decision: "escalate",
      reason: amountIsFirstFailure
        ? parseRefusal
          ? "amount_not_extracted"
          : "unparseable_amount"
        : result.reason,
      // Deduplicated: on the `invalid_adjustment_structure` path the policy
      // engine has already flagged `invalid_amount`, and repeating a flag makes
      // the metrics dashboard's reason ranking count one problem twice.
      flags: [...new Set([...(result.flags ?? []), ...amountFlags])],
      // No trustworthy figure means no approval path, whatever the policy
      // engine computed. This is belt-and-braces: every branch that reaches
      // here already returns 0, but the one thing that must never be true of a
      // record with no amount is that somebody can start signing it.
      approvalSlotsRequired: 0,
      payload: null,
    };
  }

  // Draft summary from the parsed adjustment.
  // WITHOUT A USABLE AMOUNT THERE IS NO MONEY SENTENCE TO WRITE, and writing
  // one anyway is what fromRemoteInteger() throws to prevent. The summary is
  // also the only place the ORIGINAL REQUEST reaches a human: the parser's own
  // remedy for a refusal is "a human reads the request and supplies the figure
  // as structured input", and before this the request text appeared nowhere on
  // the record or the escalation ticket, so the human was handed a refusal with
  // no way to act on it.
  const displayAmount = amountUsable ? fromRemoteInteger(parsedAdjustment.amount) : null;
  // GROSS OR NET IS PART OF THE FIGURE, NOT A DETAIL BESIDE IT, and an absent
  // value must read as an absence — never as the four-character word "null".
  // Same wording as approvalView.js's taxClause, so the ticket and the
  // approval panel do not disagree about what an unstated basis means.
  const taxTypeText =
    parsedAdjustment.amountTaxType === "gross"
      ? "gross"
      : parsedAdjustment.amountTaxType === "net"
        ? "net"
        : "with no gross/net basis stated — do not sign without it";
  const summary = amountUsable
    // NO HARD-CODED CURRENCY SIGN. This was `$${displayAmount.toFixed(2)}
    // ${currency}`, so a euro adjustment was summarised as "$5000.00 EUR" — a
    // dollar sign beside a euro code, on the one use case that moves money, in
    // the sentence that goes on the approver's ticket. Found by the
    // faithfulness judge the moment it was given facts in the same units as the
    // prose (see below): its first honest verdict on real input was "the prose
    // incorrectly states the currency as dollars instead of euros", which is
    // exactly the drift it exists to catch and had been unable to report while
    // every verdict was already a false alarm about scaling.
    // GROSS OR NET IS PART OF THE FIGURE, NOT A DETAIL BESIDE IT. Remote's own
    // definition: `net` means Remote grosses the amount UP so the employee
    // receives it intact, so the company pays MORE than the number in this
    // sentence; `gross` means the employee receives less. The same integer moves
    // a different amount of money under each reading — validateAdjustment()
    // refuses to default the field for exactly that reason and calls it "the
    // only gate in this file whose absence would have been silently paid for in
    // cash" — and then the one sentence a human signs did not say which it was.
    // An approver cannot answer "should this be paid?" without it.
    // THE ORIGINAL REQUEST IS ECHOED HERE TOO, not only on the no-amount branch
    // below. An amount can parse while some OTHER gate still refuses (risk,
    // identity, status), and that escalation used to reach a human with no
    // trace of what was asked — the same "answer a question you cannot see"
    // failure the no-amount branch was built to avoid.
    ? `Off-cycle ${parsedAdjustment.type}: ${displayAmount.toFixed(2)} ${parsedAdjustment.currency} ${taxTypeText}.` +
      `${reasonText ? ` Reason given: ${reasonText}` : ""} ` +
      `Requested: "${String(requestText || "").slice(0, 300)}"`
    : `No amount could be established for this request, so no figure was carried forward. ` +
      `Requested: "${String(requestText || "").slice(0, 300)}"` +
      `${reasonText ? ` Reason given: ${reasonText}` : ""} ` +
      `A payroll specialist must read the request and re-submit it with the amount as structured input.`;

  // Faithfulness check of the summary to the structured facts.
  //
  // THE FACTS ARE PASSED IN THE UNITS THE PROSE USES. `parsedAdjustment.amount`
  // is Remote's ×100 integer by the time it reaches here, while the summary
  // above states major units — so handing the judge the raw record meant it
  // compared "$5000.00" against 500000 and returned `not_faithful` on every
  // correct adjustment this system has ever produced. That verdict is printed
  // on the portal panel and on the Payroll Ops ticket, so the one drift alarm
  // guarding the money path fired on 100% of good payments: it trains the
  // approver to ignore it, and a real drift would arrive looking identical.
  //
  // Skipped entirely when there is no amount: the summary is then a fixed
  // template restating that fact, with no LLM-authored figure that could have
  // drifted from anything. `not_evaluated` is narrativeJudge.js's own sentinel
  // for "the judge did not run" — never a fabricated verdict in either
  // direction.
  const faithfulness = amountUsable
    ? await judge({
        narrative: summary,
        // EXACTLY THE FACTS THE SUMMARY IS DRAFTED FROM — no more, no less.
        // narrativeJudge.js's prompt scores an input the prose does not mention
        // as a material omission, which is right for a caller that passes what
        // the prose covers and wrong for one that passes the whole record. This
        // used to hand it `parsedAdjustment` entire, so a correct one-line
        // headline was marked `not_faithful` for "omitting" taxCalculationMethod
        // and effectiveDate — fields the summary was never drafted to carry.
        //
        // "off-cycle" is stated because it is the one word in the summary that
        // comes from the use case rather than the request; without it the judge
        // reports a true fact as an invention. A judge that flags a true fact is
        // as useless as one that misses a real drift — both end with the
        // approver ignoring it, which on this use case is the failure that
        // matters.
        structuredInputs: {
          adjustmentCategory: "off-cycle",
          type: parsedAdjustment.type,
          // MAJOR UNITS, matching the prose. `parsedAdjustment.amount` is
          // Remote's ×100 integer by now; handing that over meant the judge
          // compared "5000.00" against 500000 and returned `not_faithful` on
          // every correct adjustment this system has ever produced.
          amount: Number(displayAmount.toFixed(2)),
          currency: parsedAdjustment.currency,
          // Passed because the summary now STATES it. This object is documented
          // above as exactly the facts the prose is drafted from, no more and no
          // less: a fact in the prose but not here is scored as an invention,
          // and a fact here but not in the prose as a material omission. Both
          // produce a false alarm on a correct adjustment, which is how a drift
          // alarm on the money path gets trained out of a reader.
          amountTaxType: parsedAdjustment.amountTaxType,
          reasonText: reasonText || null,
        },
      })
    : { verdict: "not_evaluated", reason: null };

  // Create adjustment record - use the properly scaled amount for the payload
  const requester = session?.authenticatedAdminId ?? "unauthenticated";

  // DELIVERY-LEVEL IDEMPOTENCY. Duplicate delivery is normal — Zendesk retries
  // webhooks and a trigger can fire twice on rapid updates. UC-01's ticket #5
  // proved the cost: two audit rows 30µs apart and a duplicate customer-facing
  // action. The guarantee is the (use_case, external_ref) primary key, not this
  // code: a check-then-act in application code has exactly the race that caused
  // that bug. Taken here because everything below is a durable record or an
  // outward act.
  const claim = await claimExternalRef({
    pgPool: adjustmentStore.pgPool ?? null,
    useCase: "UC-09",
    externalRef,
    decision: outcome.decision,
  });
  if (!claim.claimed) {
    return {
      decision: outcome.decision,
      reason: outcome.reason,
      duplicate: true,
      duplicateOf: externalRef,
    };
  }

  // WHAT KIND OF ADJUSTMENT THIS IS — bonus, commission, relocation_topup —
  // which is what a column called `adjustment_type` means to anyone reading it.
  // It used to be handed `result.decision`, so every row in the database said
  // its type was "dual_approval_required": the decision, stored twice, in a
  // column named after something else, while the real type sat in
  // `parsedAdjustment.type` and was thrown away. `result.adjustmentType` — read
  // back into the audit row and returned to the caller — never existed on the
  // policy engine's return at all, so the portal and the escalation ticket both
  // printed "Adjustment type: not classified" for adjustments the parser had
  // classified perfectly well, on the same screen as the summary that names the
  // type in plain English.
  const adjustmentType = typeof parsedAdjustment.type === "string" && parsedAdjustment.type.trim()
    ? parsedAdjustment.type
    : null;

  const adjustment = adjustmentStore.createAdjustment({
    employmentId,
    requester,
    adjustment: parsedAdjustment,
    adjustmentType,
    processingDate: parsedAdjustment.processingDate,
    decision: outcome.decision,
    reason: outcome.reason,
    flags: outcome.flags,
    payload: outcome.payload || prepareIncentivePayload(parsedAdjustment, employment),
    summary,
    faithfulness,
    externalRef,
    source,
    approvalSlotsRequired: outcome.approvalSlotsRequired,
    // ON THE OPERATIONAL ROW, not only in the audit row below. Taken from
    // `result` for the same reason the audit row is: the amount-guard rebuild
    // drops `outcome`'s payload, and how the risk was assessed is still worth
    // recording on a run that went on to be refused for an unusable amount.
    // Without this the approval screen's `row.riskBasis` lookup — the only
    // thing that can name WHICH country raised the signature count, or that
    // the value dimension could not be compared at all — was dead on every row
    // this system had ever written.
    riskBasis: result.riskBasis ?? null,
  });

  const { tier } = classifyRisk("UC-09", outcome.flags);

  audit.log({
    useCase: "UC-09",
    action: outcome.decision,
    actor: requester,
    riskTier: tier,
    details: {
      adjustmentId: adjustment.id,
      // PROVENANCE — the reference the requester was shown and the surface they
      // used. src/auditview/readStore.js searches `details->>'externalRef'` BY
      // NAME, so a row without it cannot be found from the one id a human
      // holds. Null when the caller supplied none; never defaulted.
      externalRef,
      source,
      employmentId,
      adjustmentType,
      adjustment: parsedAdjustment,
      reason: outcome.reason,
      flags: outcome.flags,
      approvalSlotsRequired: outcome.approvalSlotsRequired,
      // WHERE EACH RISK DIMENSION'S ANSWER CAME FROM (policyEngine.js's
      // `riskBasis`). The audit row is the decision record, and the one thing
      // it could not say was that the jurisdiction dimension is driven by an
      // UNSOURCED list — a reviewer reading `high_tax_compliance_risk` a year
      // from now had no way to learn that, because the only statement of the
      // basis was a source comment. Taken from `result`, not `outcome`: the
      // amount-guard rebuild below drops it along with the payload, and how the
      // risk was assessed is still worth recording on a run that went on to be
      // refused for an unusable amount.
      riskBasis: result.riskBasis ?? null,
      summary,
      faithfulness,
      // What the parser did with the free text, and what it handed back when it
      // refused to guess. Without these an `amount_not_extracted` row could not
      // be told apart from a sender that posted garbage.
      parseSource: parsedAdjustment.source ?? null,
      parseRefusal,
      receivedAmount: amountUsable ? undefined : describeAmount(parsedAdjustment.amount),
      // WHICH read failed and WHAT it answered. Empty on every healthy run.
      upstreamFailures,
    },
  });

  return {
    decision: outcome.decision,
    reason: outcome.reason,
    flags: outcome.flags,
    adjustmentId: adjustment.id,
    adjustmentType,
    summary,
    faithfulness,
    approvalSlotsRequired: outcome.approvalSlotsRequired,
    // Stated rather than inferred from `approvalSlotsRequired: 0`. A caller
    // rendering "approvals required before any money moves: 0" beside a
    // headline that promises a floor of two is telling a reader the floor was
    // lowered to none, when what actually happened is that no approval path
    // was opened at all. Two different facts; only one of them is reassuring,
    // and it is the wrong one.
    approvalPathOpen: outcome.approvalSlotsRequired > 0,
    // Did the run stop at the amount parser? Without this the portal and the
    // Payroll Ops ticket can only show flag strings, and "which gate actually
    // ran" is the first question anyone asks about a refusal.
    amountEstablished: amountUsable,
  };
}

/**
 * A specialist approves or denies an adjustment. Executes the Remote POST
 * only once required approval slots have been filled.
 *
 * @param {object} args
 * @param {string} args.adjustmentId
 * @param {"requester"|"approver"|"payment_releaser"} args.role
 * @param {"approve"|"deny"} args.action
 * @param {string} args.approver
 * @param {string} [args.note]
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("./adjustmentStore.js").AdjustmentStore} deps.adjustmentStore
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js), threaded to the approval policy and
 *   consulted there AFTER every existing refusal. It can only ever refuse —
 *   there is no return value that means "approved" — so it never fills a slot,
 *   satisfies a floor, or relaxes a gate. `null` = not enforced in this posture.
 */
export async function submitAdjustmentApproval(
  { adjustmentId, role, action, approver, note = "" },
  { remote, audit, adjustmentStore, entitlement = null }
) {
  const adjustmentRow = await adjustmentStore.findById(adjustmentId);
  const verdict = evaluateApprovalAction({ adjustmentRow, role, approver, action, entitlement });
  if (!verdict.allowed) {
    recordRefusal({ audit, adjustmentRow, role, action, approver, verdict });
    return { ok: false, status: verdict.status, code: verdict.code, reason: verdict.reason };
  }

  const actor = approver.trim();
  const { tier } = classifyRisk("UC-09", adjustmentRow.flags ?? []);

  // PROVENANCE COMES OFF THE ROW. Multi-role approval runs in a different
  // process from the request, often days later, holding only an adjustmentId —
  // the reference and surface survive only because `uc09_adjustments` persists
  // `external_ref` and `source`. These rows are the money path, so they are the
  // ones a reconciliation most needs to find by the requester's own reference.
  const externalRef = adjustmentRow.externalRef ?? null;
  const source = adjustmentRow.source ?? null;

  // EXECUTE IN THE WORLD THE DECISION WAS MADE IN. A record submitted through
  // the request portal was decided against this repo's mock Remote (a public
  // page must never write into a real account), so its ids belong to the mock,
  // not the Sandbox. Executing it against the real gateway 404s — found live
  // on UC-02, whose released claim addressed an `exp_*` fixture id the real
  // Sandbox has never heard of. Resolved from the row's own durable `source`,
  // never from the shape of an id: the portal's personas MIRROR real
  // employment ids, so an id heuristic would be wrong half the time and wrong
  // invisibly. See src/shared/remoteWorld.js.
  const remoteForRow = remoteFor(remote, adjustmentRow.source);

  if (action === "deny") {
    await audit.logDurable({
      useCase: "UC-09",
      action: "adjustment_denied",
      actor,
      riskTier: tier,
      details: { adjustmentId, externalRef, source, role, note: note || null, aiDecision: adjustmentRow.decision },
    });
    await adjustmentStore.markDenied(adjustmentId, role, actor, note);
    return { ok: true, status: 200, code: "denied", reason: `Denied by ${role}.`, adjustmentId };
  }

  // --- approve: record this role's slot durably, THEN check if enough approvals are in.
  await audit.logDurable({
    useCase: "UC-09",
    action: "adjustment_approved",
    actor,
    riskTier: tier,
    details: { adjustmentId, externalRef, source, role, note: note || null, aiDecision: adjustmentRow.decision },
  });
  const afterApproval = await adjustmentStore.recordApproval(adjustmentId, role, actor, note);

  if (!isFullyApproved(afterApproval)) {
    return {
      ok: true,
      status: 200,
      code: "approved_awaiting_more",
      reason: `${role} approved; waiting for ${adjustmentRow.approvalSlotsRequired} total approvals (${countFilledApprovals(afterApproval)}/${adjustmentRow.approvalSlotsRequired}).`,
      adjustmentId
    };
  }

  // --- Enough approvals are in. CLAIM THE ROW BEFORE DOING ANYTHING ELSE
  // (finding F-09). Everything between here and createIncentive() — the
  // freshness read especially — is an await, and every await is a window in
  // which a second approval that also saw "fully approved" can run the same
  // code. The claim is a compare-and-set that exactly one caller can win; the
  // losers stop here, having still recorded their approval and their audit
  // row. See adjustmentStore.claimForExecution() for why it is atomic.
  // Reproduced live before this fix: two approvals fired concurrently
  // (Promise.all), both passed isFullyApproved() above, and BOTH called
  // remote.createIncentive() — two real disbursements for one $5,000
  // adjustment.
  const claimed = await adjustmentStore.claimForExecution(adjustmentId);
  if (!claimed) {
    await audit.log({
      useCase: "UC-09",
      action: "adjustment_execution_not_claimed",
      actor,
      riskTier: tier,
      details: {
        adjustmentId,
        externalRef,
        source,
        role,
        reason: "another approval is already executing this adjustment",
      },
    });
    return {
      ok: true,
      status: 200,
      code: "execution_already_claimed",
      reason: "Required approvals are in and another request is already executing this adjustment.",
      adjustmentId,
    };
  }

  // --- Freshness re-check: is this still true?
  // policyEngine.js already checked "is this employee active?" when the
  // adjustment was created; approval can happen days later — same reasoning
  // as review/service.js's re-check before issuing UC-01's letter.
  const employment = await remoteForRow.getEmployment(adjustmentRow.employmentId);
  if (!employment || employment.status !== "active") {
    const stale = { status: 409, code: "employment_no_longer_active", reason: "The employment record is no longer active." };
    await audit.log({
      useCase: "UC-09",
      action: "adjustment_execution_blocked",
      actor,
      riskTier: tier,
      details: { adjustmentId, externalRef, source, observedStatus: employment?.status ?? "not_found" },
    });
    // Nothing was written to Remote, so the claim is safe to give back — the
    // adjustment returns to pending_approval and a later, valid attempt can
    // proceed. Contrast the createIncentive() path below, which deliberately
    // does NOT release the claim on failure.
    await adjustmentStore.releaseExecutionClaim(adjustmentId);
    return { ok: false, ...stale, adjustmentId };
  }

  // Execute the actual incentive creation with Remote API. The idempotency key
  // is the adjustment's own id (finding F-18): stable across this call's
  // internal retries AND across a manual re-submission after a crash, so the
  // one money-moving POST in this repo can never be delivered twice.
  //
  // NOTE the deliberate absence of a try/catch that releases the claim. If
  // this throws we do not know whether the disbursement happened — the
  // classic in-doubt transaction — so the row stays `executing` and a human
  // reconciles it. Releasing here would hand the "retry" button back to the
  // very situation where pressing it might pay twice.
  const remoteResult = await remoteForRow.createIncentive(adjustmentRow.payload, { idempotencyKey: adjustmentId });

  await audit.logDurable({
    useCase: "UC-09",
    action: "adjustment_executed",
    actor,
    riskTier: tier,
    details: { adjustmentId, externalRef, source, payload: adjustmentRow.payload, remoteResult },
  });
  await adjustmentStore.markExecuted(adjustmentId, remoteResult);

  return { ok: true, status: 200, code: "executed", reason: "Required approvals recorded; adjustment executed.", adjustmentId };
}

/**
 * Helper to count how many approval slots are filled
 */
function countFilledApprovals(adjustmentRow) {
  let count = 0;
  if (adjustmentRow.requesterApproval) count++;
  if (adjustmentRow.approverApproval) count++;
  if (adjustmentRow.paymentReleaserApproval) count++;
  return count;
}

// prepareIncentivePayload() USED TO EXIST TWICE — once here and once in
// policyEngine.js — and the two copies had already drifted: only this one
// carried the `Number.isInteger(amount)` manufactured-zero guard, and only
// this one defaulted `currency` to "USD". Whichever ran, the OTHER was the one
// the gate had validated. The comment justifying the duplication cited a
// circular dependency that does not exist (this file already imports
// `evaluate` and `INCENTIVE_REQUIRED_FIELDS` from policyEngine.js), so the
// copy is gone and the single definition is imported at the top of this file.
// Two builders for one wire format is the same shape of defect as a fixture
// that agrees with the code instead of the API: nothing can tell you which one
// is real until money moves.

/**
 * Refusals with no identified actor are not audited — same reasoning as
 * review/service.js's recordRefusal(): an unattributed row in an append-only
 * log is worse than no row, since anyone reaching the endpoint could pad it.
 */
const UNATTRIBUTED_REFUSALS = new Set(["approver_required", "unknown_role", "unknown_action", "adjustment_not_found"]);

function recordRefusal({ audit, adjustmentRow, role, action, approver, verdict }) {
  if (!adjustmentRow || UNATTRIBUTED_REFUSALS.has(verdict.code)) return;
  const { tier } = classifyRisk("UC-09", adjustmentRow.flags ?? []);
  audit.log({
    useCase: "UC-09",
    action: `adjustment_${action}_refused`,
    actor: typeof approver === "string" && approver.trim() ? approver.trim() : "unknown",
    riskTier: tier,
    details: {
      adjustmentId: adjustmentRow.id,
      externalRef: adjustmentRow.externalRef ?? null,
      source: adjustmentRow.source ?? null,
      role,
      refusalCode: verdict.code,
      refusalReason: verdict.reason,
    },
  });
}

/**
 * Describe a rejected amount for the audit trail WITHOUT letting it back into
 * any numeric path. `typeof` plus a bounded string is enough for a human to
 * diagnose the sender's bug; the value itself is never re-parsed.
 * @param {unknown} v
 * @returns {string}
 */
function describeAmount(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number") return Number.isNaN(v) ? "NaN" : String(v);
  return `${typeof v}:${String(v).slice(0, 40)}`;
}
