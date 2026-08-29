// ---------------------------------------------------------------------------
// decisionFacts.js  —  What the people signing a real payment are deciding on
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// C-27 / pattern P7 (docs/CORRECTIONS-LOG.md), generalised to the one use case
// in this repository where money actually leaves an account. UC-09's API view
// already carried `decidedBy` and `gateLadder` — WHERE the decision stopped —
// and carried no account at all of WHAT it rests on. It was the only 🟡/🔴
// approval screen with a gate ladder and no basis panel, which is the wrong way
// round: UC-04 escalates a trip, UC-05 signs a report, and UC-09 posts an
// incentive to Remote.
//
// WHAT MAKES UC-09 DIFFERENT FROM UC-04, UC-05 AND UC-06, and why it needed its
// own file rather than a fourth call to one of theirs:
//
//   1. THE OUTCOME IS A NUMBER OF HUMANS. UC-04 produces a risk level, UC-05 a
//      date, UC-06 a payroll cycle. UC-09 produces "two signatures" or "three",
//      and the whole safety property of the use case is that the first of those
//      is a FLOOR — `Math.max(2, …)` in policyEngine.js, which no risk score can
//      push below two. A person being asked for the third signature is entitled
//      to know why they were summoned, and a person seeing "two" is entitled to
//      know that two is the floor and not a reduction.
//
//   2. ONE OF THE THREE REASONS FOR A THIRD SIGNATURE IS AN UNSOURCED LIST.
//      `HIGH_TAX_COMPLEXITY_HEURISTIC` (policyEngine.js) is three country codes
//      somebody chose — `docs/KNOWLEDGE-SOURCES.md` §1 Test B names it as this
//      repository's clearest case of "if this were wrong, nothing would catch
//      it". It raises the signature count on the money path. So the dimension
//      it drives reports its own provenance, in both directions, and a country
//      that is NOT on the list reports `unknown` rather than `cleared`: nothing
//      assessed it, and an absence from an invented list is not a finding.
//
//   3. THE AMOUNT IS SCALED. Every figure on the row is Remote's ×100 integer
//      (`src/shared/money.js`), and the ZAF panel's own summary row prints it
//      raw. A screen that asks a human to authorise a payment has to say the
//      figure once, unambiguously, in human units with its currency AND with
//      the gross/net reading that decides how much the company actually pays.
//
// PURE, AND IT DECIDES NOTHING. Same contract as describeDecidingGate() /
// describeGateLadder() beside it and as UC-04/05/06's decisionFacts.js: it
// describes a decision already made and already stored. It takes no client, no
// store and no logger, so it is structurally incapable of changing an outcome —
// `evaluateApprovalAction()` and `isFullyApproved()` remain the only things that
// gate a signature or an execution, and neither reads this file.
//
// IT DERIVES, IT DOES NOT RE-DECIDE. The figures come from approvalView.js,
// which already computes the amount/threshold/overage comparison and the
// signature progress from the same row. Recomputing them here would be a second
// copy of a threshold comparison on the money path, and a wrong explanation of a
// right refusal reads exactly like a right one.
//
// TWO PRESENTATION DECISIONS WORTH RECORDING, both forced by the shell:
//
//   - THE JURISDICTION HEURISTIC'S PROVENANCE IS RENDERED AS EVIDENCE ROWS, NOT
//     AS A `basis` BLOCK. The sidebar's renderProvenance() is headed "The basis
//     for excusing it:" — written for UC-04, where an uncited list SUPPRESSES a
//     check. Here the same kind of uncited list does the opposite: it REQUIRES
//     an extra human. Borrowing that block would print a heading that describes
//     the reverse of what happened, which is worse than rendering the identical
//     facts (authority, standing, version, review date) as labelled evidence.
//
//   - `employment_freshness` REPORTS `unavailable` WHILE A ROW IS PENDING. The
//     shell has no "not yet, by design" state, and of the states it does have
//     this is the only one whose rendered word ("Not held") is true of a re-read
//     that has not happened. The finding sentence above it says exactly when the
//     check runs, because the state word alone cannot.
// ---------------------------------------------------------------------------

import { formatMoney } from "../shared/money.js";
import {
  HIGH_AMOUNT_THRESHOLD_CURRENCY,
  HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
  HIGH_TAX_COMPLEXITY_HEURISTIC,
  INCENTIVE_REQUIRED_FIELDS,
  normalizeCurrencyCode,
} from "./policyEngine.js";
import { describeAdjustment, ROLE_LABEL } from "./approvalView.js";

/**
 * The people this file is written for, and the DIFFERENT questions they answer.
 *
 * The third exists only above the floor. A payment releaser who is never
 * summoned has no decision to describe, so they are not listed on a
 * two-signature adjustment — see `describeAdjustmentBasis()`'s `roles`.
 */
export const DECIDERS = Object.freeze([
  Object.freeze({
    role: "requester",
    label: "Requester (customer admin)",
    decides:
      "whether this is the adjustment they meant to ask for — the right person, the right figure, and the right gross/net reading of it.",
  }),
  Object.freeze({
    role: "approver",
    label: "Remote payroll specialist",
    decides:
      "whether this should be paid at all, and whether the record that would be sent to Remote is complete enough to be written.",
  }),
  Object.freeze({
    role: "payment_releaser",
    label: "Payment releaser",
    decides:
      "whether to release a payment that a risk dimension flagged — and, before signing, which dimension that was and on what basis it fired.",
  }),
]);

// ROLE_LABEL is imported, not declared. It used to be a second copy of the same
// three labels, and the copy that was NOT here — approvalView.js's signature
// sentence — was the one printing `payment_releaser` at a payment approver.
// One map, in the file that already owns UC-09's role vocabulary.

/** The floor, restated from policyEngine.js's `Math.max(2, …)` rather than re-chosen. */
const APPROVAL_FLOOR = 2;

// ---------------------------------------------------------------------------
// THE READER'S VOCABULARY, NOT THE SYSTEM'S
// ---------------------------------------------------------------------------
// Every string this file emits is read by a payroll specialist or a payment
// releaser deciding whether real money leaves a real account. Three kinds of
// value used to reach them in the system's own words rather than in theirs:
// Remote's API field names (`amount_tax_type`), this store's row statuses
// (`pending_approval`), and the incentive type as it is persisted
// (`retroactive_pay`). Each was accurate and none was readable, and on a
// payment screen an unreadable fact is a fact that gets skipped — which is the
// same outcome as not printing it.
//
// EVERY MAP DEGRADES TO WORDS, NEVER BACK TO THE SLUG. An unmapped value has
// its underscores opened out rather than being printed raw, so a field or a
// status added later reads as clumsy English instead of as code. The defect
// cannot return by somebody forgetting to add a row here.
//
// THE HONESTY IS NOT VOCABULARY AND IS NOT TOUCHED. "This list is unsourced",
// "nothing here confirms the employee is still active", "the amount could not
// be compared" are the most valuable sentences on this panel; what goes is the
// codebase's names for its own parts, not the limits of what is known.
// ---------------------------------------------------------------------------

/** An identifier from the API or the store, opened out into readable words. */
const inWords = (value) => String(value).replace(/[_-]+/g, " ").trim();

/** Remote's own field names for the incentive write, in the reader's words. */
const FIELD_WORDS = {
  employment_id: "the employee it is paid to",
  type: "the kind of payment",
  amount: "the amount",
  amount_tax_type: "whether the amount is gross or net",
  effective_date: "the date it takes effect",
  note: "the note explaining it",
  period_start: "the start of the period it covers",
  period_end: "the end of the period it covers",
};
const fieldWords = (name) => FIELD_WORDS[name] ?? inWords(name);
const fieldList = (names) => names.map(fieldWords).join(", ");

/**
 * What this adjustment is doing right now, as a state of affairs rather than
 * as the word the store happens to keep. `pending_approval` on a payment
 * screen is the system describing its own table; "waiting for its signatures"
 * is the same fact addressed to the person who has to supply one.
 */
const STATUS_WORDS = {
  // Terse on purpose: these words are read both on their own, as the current
  // status, and inside a sentence that supplies the consequence ("…so no
  // payment will be attempted"). A status carrying its own consequence would
  // say it twice there.
  pending_approval: "waiting for its signatures",
  escalated: "escalated to a specialist",
  executing: "mid-payment, with its outcome not yet reconciled",
  executed: "paid — the incentive was filed with Remote",
  denied: "declined",
};
const statusWords = (status) => (status ? (STATUS_WORDS[status] ?? inWords(status)) : null);

const isRealNumber = (v) => typeof v === "number" && Number.isFinite(v);

/** A ×100 integer as money a person reads, or null. Never a bare integer. */
function money(remoteInteger, currency) {
  if (!Number.isInteger(remoteInteger)) return null;
  return currency ? formatMoney(remoteInteger, currency) : formatMoney(remoteInteger, "").trim();
}

/**
 * Did the risk sizing run at all?
 *
 * `assessRisk()` is reached only after identity, employment status, request
 * structure and the payload schema have all passed, and its result is what
 * produces a `…_approval_required` decision. So the decision string is the
 * honest test: anything else means the three risk dimensions below never
 * evaluated this adjustment, in either direction.
 */
function sizingRan(row) {
  return typeof row.decision === "string" && row.decision.includes("approval_required");
}

// ---------------------------------------------------------------------------
// The dimensions
// ---------------------------------------------------------------------------
// Each returns {position, key, label, question, state, finding, evidence[],
// whatItWouldTake?} — the shape UC-04's decisionFacts.js established and the ZAF
// shell renders. `state` is never two-valued:
//
//   "cleared"      — checked, and nothing was found against it.
//   "attention"    — checked, and something was found a person must weigh.
//   "blocking"     — checked, and what was found no approval can override.
//   "unknown"      — the check ran and cannot answer, so it is evidence in
//                    NEITHER direction.
//   "unavailable"  — nothing has been consulted, so nothing here confirms it.
//   "not_assessed" — the check never ran, because an earlier gate decided.
//
// The separation is the point, and it is the same one describeGateLadder()
// draws between `passed` and `not_reached`: a check that never ran approved of
// nothing.
// ---------------------------------------------------------------------------

/**
 * Dimension 1 — the figure itself, said once and unambiguously.
 *
 * THREE FACTS, NOT ONE. The integer, its currency, and whether it is gross or
 * net. Remote's own definition: `net` means Remote grosses the amount UP so the
 * employee receives it intact, so the company pays MORE than the number on the
 * screen. validateAdjustment() refuses to default that field and calls it "the
 * only gate in this file whose absence would have been silently paid for in
 * cash" — and then the surface a human signs on did not print it.
 *
 * THE ×100 FORM IS STATED AS WHAT WILL BE SENT, never as a second opinion about
 * the amount. A reader who meets 500000 in one place and $5,000.00 in another,
 * with nothing joining them, is one glance away from a hundredfold error.
 */
function amountDimension(row, view) {
  const base = {
    position: 1,
    key: "payment_amount",
    label: "The payment being authorised",
    question: "What exactly leaves the company, in what currency, and on what gross/net basis?",
  };
  const adjustment = row.adjustment ?? {};
  const m = view.money;
  const payload = row.payload ?? null;
  const type = adjustment.type ?? row.adjustmentType ?? null;
  // The occasion, in the requester's own words. `description` is what a person
  // typed to say why this payment is being made outside the ordinary run.
  const reasonGiven =
    typeof adjustment.description === "string" && adjustment.description.trim() ? adjustment.description.trim() : null;
  // OURS, not Remote's: the run the requester asked for. Kept off the payload
  // deliberately (prepareIncentivePayload has no such field), so it must never
  // read as the date the money moves.
  const requestedRun = row.processingDate ?? adjustment.processingDate ?? null;

  const evidence = [
    { label: "Amount", value: m.display ?? "not established" },
    { label: "Currency", value: m.currency ?? "not stated" },
    { label: "Gross or net", value: m.amountTaxType ?? "not stated" },
    { label: "Payment type", value: type ? inWords(type) : "not stated" },
    {
      // WHY THIS PAYMENT, AND WHY NOW — the approver's actual question, which
      // nothing on this panel answered. Every other row here describes the
      // MECHANICS of the payment; a specialist deciding "should this be paid
      // at all" was left to open the ticket and read the original request.
      // Attributed, never presented as this system's own finding: it is a
      // claim by the person asking for the money.
      label: "Reason given",
      value: reasonGiven ? `${reasonGiven} — as stated by the requester` : "none given on the request",
    },
    {
      // STATED OR DEFAULTED IS A DIFFERENT FACT, and Remote decides the payout
      // run from this field: "the incentive is not paid out on the effective
      // date, but during the next payroll cycle." prepareIncentivePayload()
      // falls back to the day the request was assessed when the requester named
      // none, which is a reasonable default and is still not something the
      // requester asked for. Printing the two identically would let a date
      // nobody chose read as a date somebody did.
      label: "Effective date",
      value: adjustment.effectiveDate
        ? String(adjustment.effectiveDate)
        : payload?.effective_date
          ? `${payload.effective_date} — DEFAULTED: the request named no effective date, so the day it was assessed was used`
          : "not stated",
    },
    {
      // The one row that joins the two numbers a reader will otherwise meet
      // separately. Absent rather than invented when no payload was built.
      label: "Sent to Remote as",
      value: payload && Number.isInteger(payload.amount)
        ? `${payload.amount} — Remote's ×100 integer form of ${m.display ?? "the figure above"}`
        : "no payment record was built for this request, so nothing would be sent",
    },
  ];

  // Only when the requester actually named one. An absent row says nothing; a
  // row saying "not stated" against a date that has no bearing on the payment
  // would invite a reader to go and supply one.
  if (requestedRun) {
    evidence.push({
      label: "Payroll run requested",
      value: `${requestedRun} — the run the requester asked for. Remote schedules the payout from the effective date above, not from this.`,
    });
  }

  if (!Number.isInteger(m.amountRemoteInteger)) {
    return {
      ...base,
      state: "unknown",
      finding: m.statement,
      evidence,
      whatItWouldTake:
        "The amount re-submitted as a number rather than as text, in Remote's ×100 integer form (500000 for 5,000.00), with its currency and whether it is gross or net. This system deliberately does not guess a figure that will be paid.",
    };
  }

  if (m.amountTaxType !== "gross" && m.amountTaxType !== "net") {
    return {
      ...base,
      state: "unknown",
      finding:
        `${m.display} is the figure on the record, and what the COMPANY pays cannot be stated from it: whether the amount is gross or net is not recorded on this request. ` +
        "Under NET, Remote grosses the amount up and the company pays more than this; under GROSS, the employee receives less. The two are not close.",
      evidence,
      whatItWouldTake:
        "The gross/net reading stated on the request — Remote requires it and there is no safe default, which is why nothing in this system supplies one.",
    };
  }

  return {
    ...base,
    state: "cleared",
    finding: m.statement,
    evidence,
  };
}

/**
 * Dimension 2 — could this be written to Remote at all?
 *
 * ASKED BEFORE ANY SIGNATURE IS COLLECTED, and that ordering is the finding.
 * policyEngine.js validates the drafted payload against Remote's own required
 * fields ahead of sizing the approval set, so that nobody is asked to sign a
 * request that would 422 at the end — the worst place to meet a schema error,
 * because the humans have gone and the row reads `executing`.
 *
 * The required list is `INCENTIVE_REQUIRED_FIELDS`, read from Remote's
 * `CreateOneTimeIncentiveParams.required` — NOT a country's employment form
 * (that is UC-06's different write), and not a list this file keeps a copy of.
 */
function schemaDimension(row) {
  const base = {
    position: 2,
    key: "payload_schema",
    label: "The record Remote would receive",
    question: "Does the payment record carry every field Remote requires, so it could actually be written?",
  };
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const payload = row.payload ?? null;
  // Read from Remote's own required list and the drafted record, then said in
  // the reader's words. The names themselves are Remote's API vocabulary; a
  // person asked to sign a payment should not have to translate
  // `amount_tax_type` into "gross or net" to find out what is missing.
  const missing = flags
    .filter((f) => f.startsWith("missing_"))
    .map((f) => f.slice("missing_".length))
    .map(fieldWords);

  const evidence = [
    { label: "Fields Remote requires", value: fieldList(INCENTIVE_REQUIRED_FIELDS) },
    {
      label: "What the drafted record carries",
      value:
        payload && typeof payload === "object" ? fieldList(Object.keys(payload).sort()) : "none — no record was drafted",
    },
  ];

  if (flags.includes("schema_invalid")) {
    return {
      ...base,
      state: "blocking",
      finding:
        `The payment record that would be sent to Remote is missing ${missing.length ? `: ${missing.join(", ")}` : "a required field"}. ` +
        "No approval slot was opened, on purpose: signing it would not make it payable, and collecting two or three signatures for a request that cannot be written wastes the signers and hides the real problem.",
      evidence: [...evidence, { label: "Missing", value: missing.length ? missing.join(", ") : "not itemised on this request" }],
      whatItWouldTake:
        "The missing detail supplied on the request and the adjustment re-submitted. Nothing about approving this changes it.",
    };
  }

  if (!payload) {
    return {
      ...base,
      state: "not_assessed",
      finding:
        "No payment record was drafted — an earlier gate decided this request before one could be built. Nothing here says the request is valid or invalid.",
      evidence,
    };
  }

  return {
    ...base,
    state: "cleared",
    finding:
      "The drafted payment record carries every field Remote requires for a one-time incentive, so it can be written once the signatures are in.",
    evidence,
  };
}

/**
 * Dimension 3 — how many separate people must sign, and who is still missing.
 *
 * THE FLOOR IS THE HEADLINE, and it is a property of the code rather than of
 * this adjustment: `Math.max(2, …)` means no risk score, no country list and no
 * amount can ever produce a one-signature payment. A reader shown "2 required"
 * with no further word cannot tell a floor from a reduction, and those are
 * opposite facts.
 *
 * NO APPROVAL PATH IS NOT A LOWERED FLOOR. An escalated row carries
 * `approvalSlotsRequired: 0`, and rendering that as "0 signatures required"
 * beside a promise of a floor of two says the floor was removed. What actually
 * happened is that the request never reached the point where a signature could
 * be offered.
 *
 * DISTINCT HUMANS, NOT FILLED SLOTS — the same question isFullyApproved() asks,
 * taken from the same canonicalised count in approvalView.js so the two cannot
 * come to disagree about whether "Bob Smith" and "bob smith" are one person.
 */
function approvalFloorDimension(row, view) {
  const base = {
    position: 3,
    key: "approval_floor",
    label: "Signatures required before any money moves",
    question: "How many separate people must sign this, why that number, and who has not signed yet?",
  };
  const requirement = view.approvalRequirement;
  const progress = view.approvalProgress;
  const required = requirement.slotsRequired;

  if (!requirement.approvalPathOpen) {
    return {
      ...base,
      state: "not_assessed",
      finding:
        "No approval path was opened for this adjustment — it was refused at a gate before any signature could be collected. " +
        `The floor of ${APPROVAL_FLOOR} was not lowered here; it was never reached, and there is no route from this state to a payment.`,
      evidence: [
        { label: "Signatures required", value: "none offered" },
        { label: "Floor", value: `${APPROVAL_FLOOR} signatures, and nothing can lower it — see the note below` },
      ],
    };
  }

  const signed = progress.slots
    .filter((s) => s.filled)
    .map((s) => `${ROLE_LABEL[s.role] ?? s.role}: ${s.approver ?? "unnamed"}`);
  const outstanding = progress.outstandingRoles.map((r) => ROLE_LABEL[r] ?? r);
  const triggered = requirement.dimensions.filter((d) => d.triggered);

  const evidence = [
    { label: "Signatures required", value: `${required}` },
    {
      // THE GUARANTEE IS STATED AS A PROPERTY OF THE PROCESS, NOT AS THE
      // EXPRESSION THAT IMPLEMENTS IT. This row read "guaranteed by
      // `Math.max(2, …)` in the policy engine" — a line of source code shown
      // to somebody authorising a payment, which is an appeal to evidence they
      // cannot see. The reassurance survives whole: two is a floor, and no
      // risk score, amount or country can ever produce fewer.
      label: "Floor",
      value: `${APPROVAL_FLOOR} signatures — a floor, not a target. No risk score, amount or country can ever produce fewer; risk can only ever raise it.`,
    },
    {
      label: "Why this number",
      value:
        required > APPROVAL_FLOOR
          ? `${triggered.length} risk dimension(s) raised it above the floor: ${triggered.map((d) => d.label).join("; ")}`
          : "the floor alone — no risk dimension raised it",
    },
    { label: "Distinct people recorded", value: `${progress.distinctApproverCount} of ${required}` },
    { label: "Already signed", value: signed.length ? signed.join("; ") : "nobody yet" },
    { label: "Still outstanding", value: outstanding.length ? outstanding.join(", ") : "none" },
    {
      label: "May not sign again",
      value: progress.blockedApprovers.length
        ? `${progress.blockedApprovers.join("; ")} — segregation of duties: nobody already on this adjustment may fill a second role`
        : "nobody has signed this adjustment yet",
    },
  ];

  if (outstanding.length === 0) {
    return {
      ...base,
      state: "cleared",
      finding: `All ${required} required signatures are recorded, from ${progress.distinctApproverCount} distinct people.`,
      evidence,
    };
  }

  return {
    ...base,
    state: "attention",
    finding:
      `${required} separate people must sign before any money moves; ${progress.distinctApproverCount} have. ` +
      `Still outstanding: ${outstanding.join(", ")}. ` +
      `The floor is ${APPROVAL_FLOOR} and risk can only ever raise it — nothing in this system can produce a payment signed by one person.`,
    evidence,
  };
}

/**
 * Dimension 4 — the amount against the line that summons a third signature.
 *
 * The comparison itself is approvalView.js's (`describeAmountDimension`), so
 * this states it rather than recomputing it. `evaluated: false` is carried
 * through as `unknown` and never as "under the line": an amount that could not
 * be read was not compared with anything.
 */
function valueThresholdDimension(row, view, ran) {
  const base = {
    position: 4,
    key: "value_threshold",
    label: "Adjustment value against the high-value line",
    question: "Is this large enough, on its own, to require a third signature?",
  };
  // Either dimension may be the one approvalView.js produced: a request whose
  // currency has no stated policy figure yields the not-comparable dimension in
  // that slot instead of the comparison one. Both are answers to this
  // question — one of them being "we could not ask it".
  const dims = view.approvalRequirement.dimensions;
  const d =
    dims.find((x) => x.code === "high_amount_risk") ??
    dims.find((x) => x.code === "high_amount_threshold_not_comparable") ??
    {};
  const statedCurrency = normalizeCurrencyCode(row.adjustment?.currency) ?? null;
  const comparable = d.comparable !== false;

  const evidence = [
    {
      // THE LINE IS PRINTED IN ITS OWN CURRENCY, NEVER IN THE REQUEST'S. This
      // row used to render `money(threshold, theRequestsCurrency)`, so a euro
      // request was shown a "€10,000.00 high-value line" — a denomination the
      // gate had never checked, on the screen a payment releaser signs. The
      // caveat underneath admitted the comparison was currency-blind while the
      // figure above it implied the opposite; the gate is no longer blind, so
      // the rendering states the real denomination instead of apologising for
      // a wrong one.
      label: "High-value line",
      value: money(HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER, HIGH_AMOUNT_THRESHOLD_CURRENCY),
    },
    { label: "This adjustment", value: view.money.display ?? "not established" },
    {
      label: "Basis for the line",
      value:
        `an internal policy figure, denominated in ${HIGH_AMOUNT_THRESHOLD_CURRENCY} — set by this system's own policy, ` +
        "deterministic and auditable, published by no external authority. It is compared only against a request stated in " +
        "the same currency; a request in any other currency is NOT converted, because an exchange rate is a value with a " +
        "source and a timestamp that this system does not hold and must not invent on a payment gate.",
    },
    {
      label: "Comparable with this request",
      value: comparable
        ? `yes — the request is stated in ${statedCurrency ?? HIGH_AMOUNT_THRESHOLD_CURRENCY}, the same currency as the line`
        : `no — the request is stated in ${statedCurrency ?? "no currency at all"} and no policy figure exists for it`,
    },
  ];

  if (ran && !comparable) {
    return {
      ...base,
      // NOT `cleared` and NOT `unknown`: the dimension is the reason a third
      // signature was summoned, so it demands the reader's attention even
      // though nothing about the amount itself was found.
      state: "attention",
      finding:
        `${d.detail} Note what this is NOT: it is not a finding that the amount is large. Nothing about the amount ` +
        "was established at all — the requirement rose because the answer is unknown.",
      evidence,
      whatItWouldTake:
        `A stated policy figure for ${statedCurrency ?? "this request's currency"} added to the high-value threshold, ` +
        "set by whoever owns the policy. Not an exchange rate, and not the same numeral copied across currencies — " +
        "that is an exchange rate of 1.0 in disguise.",
    };
  }

  if (!ran) {
    return {
      ...base,
      state: "not_assessed",
      finding:
        "Not assessed — an earlier gate decided this request before the approval set was sized, so the amount was never compared with the high-value line.",
      evidence,
    };
  }

  if (d.evaluated === false) {
    return {
      ...base,
      state: "unknown",
      finding: d.detail ?? "No usable amount was established, so nothing was compared with the high-value line.",
      evidence,
      whatItWouldTake: "A usable amount on the request. An amount that could not be read is not an amount under the line.",
    };
  }

  if (d.triggered) {
    return {
      ...base,
      state: "attention",
      finding: `${d.detail} That alone requires a third signature.`,
      evidence: [
        ...evidence,
        { label: "Over the line by", value: money(d.overageRemoteInteger, statedCurrency ?? "") ?? "not stated" },
        { label: "As a share of the line", value: isRealNumber(d.percentOverThreshold) ? `${d.percentOverThreshold}% over` : "not stated" },
      ],
    };
  }

  return { ...base, state: "cleared", finding: d.detail ?? "At or below the high-value line.", evidence };
}

/**
 * Dimension 5 — is a human overriding the tax arithmetic?
 *
 * Read straight off the request's own `taxAdjustment` field: a fact the
 * requester stated, not an inference, and that is said out loud because it is
 * the one risk dimension here with no threshold, no list and nothing to
 * misread.
 */
function manualTaxDimension(row, view, ran) {
  const base = {
    position: 5,
    key: "manual_tax_adjustment",
    label: "Manual tax adjustment",
    question: "Is the statutory withholding on this payment being set by hand rather than computed?",
  };
  const d = view.approvalRequirement.dimensions.find((x) => x.code === "manual_tax_adjustment") ?? {};
  const evidence = [
    {
      label: "Stated on the request",
      value: row.adjustment?.taxAdjustment ? "yes — a manual tax adjustment" : "no",
    },
    { label: "Basis", value: "the request itself — a fact the requester stated, not an inference this system drew" },
  ];

  if (!ran) {
    return {
      ...base,
      state: "not_assessed",
      finding: "Not assessed — an earlier gate decided this request before the approval set was sized.",
      evidence,
    };
  }

  return {
    ...base,
    state: d.triggered ? "attention" : "cleared",
    finding: d.detail ?? "",
    evidence,
  };
}

/**
 * Dimension 6 — the employment's country, and the list it was checked against.
 *
 * THE DIMENSION THAT MUST NOT READ AS A COMPLIANCE DETERMINATION.
 * `high_tax_compliance_risk` is raised by an invented three-code list whose own
 * former comment read "Hypothetical", and it raises the signature requirement on
 * the one use case that moves real money. Until the basis travelled with the
 * flag, the only record of it was a source comment no approver will ever read.
 *
 * BOTH BRANCHES CARRY THE PROVENANCE, AND THE `false` BRANCH MATTERS MORE.
 * A country absent from an unsourced list has not been assessed and found
 * simple — nothing assessed it, and a genuinely complex jurisdiction outside the
 * three would collect two signatures rather than three, silently. So the
 * negative branch is `unknown` ("the check ran and its answer is evidence in
 * neither direction"), never `cleared`.
 *
 * WHERE THE COUNTRY CODE COMES FROM, AND WHY IT USED TO BE ABSENT.
 * `uc09_adjustments` has no country column. The policy engine's own
 * `riskBasis` — which records the code it actually compared — was computed,
 * returned and written to `audit_log`, and then dropped on the way into the
 * adjustment row, so this lookup was dead on every row that had ever existed
 * and the dimension reported `not recorded on this row` in production while
 * the value sat in the audit log. `createAdjustment()` now persists
 * `risk_basis` beside the flags, so rows written from here on name the country.
 *
 * ROWS WRITTEN BEFORE THAT, AND ROWS WRITTEN BY THE n8n GRAPH, STILL CARRY
 * NONE — the graph's own Supabase insert does not map the column. Those report
 * the code as unavailable rather than guessing at it, which is why the null
 * branch below stays exactly as it was.
 */
function observedCountryCode(row) {
  const recorded = (Array.isArray(row.riskBasis) ? row.riskBasis : []).find(
    (b) => b?.dimension === "jurisdiction_tax_complexity"
  );
  return recorded?.observedCountryCode ?? null;
}

function jurisdictionDimension(row, ran) {
  const base = {
    position: 6,
    key: "jurisdiction_tax_complexity",
    label: "Jurisdiction on the high-tax-complexity list",
    question: "Is the employment's country one that raises the signature requirement — and what is that list worth?",
  };
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const triggered = flags.includes("high_tax_compliance_risk");
  const list = HIGH_TAX_COMPLEXITY_HEURISTIC.countries.join(", ");
  const observed = observedCountryCode(row);

  // The provenance, as evidence rows rather than as the shell's provenance
  // block — see this file's header for why that block's heading would describe
  // the opposite of what happened here.
  const evidence = [
    { label: "Countries on the list", value: list },
    { label: "The employment's country", value: observed ?? "not recorded on this request" },
    { label: "Standing of the list", value: "illustrative only — proposed for demonstration, never sourced" },
    { label: "Publishing authority", value: HIGH_TAX_COMPLEXITY_HEURISTIC.authority ?? "none named" },
    { label: "Version", value: HIGH_TAX_COMPLEXITY_HEURISTIC.version ?? "none" },
    { label: "Retrieved on", value: HIGH_TAX_COMPLEXITY_HEURISTIC.retrievedOn ?? "never — nothing was retrieved from anywhere" },
    { label: "Review date", value: HIGH_TAX_COMPLEXITY_HEURISTIC.reviewDue ?? "none set" },
  ];
  const whatItWouldTake = HIGH_TAX_COMPLEXITY_HEURISTIC.requiredForARealVersion.join("; ") + ".";

  if (!ran) {
    return {
      ...base,
      state: "not_assessed",
      finding:
        "Not assessed — an earlier gate decided this request before the approval set was sized, so no jurisdiction rule was consulted.",
      evidence,
    };
  }

  if (triggered) {
    return {
      ...base,
      state: "attention",
      finding:
        `⚠ UNSOURCED BASIS. The employment's country is on an invented three-country list (${list}), and that alone raised the ` +
        `signature requirement to three${observed ? ` — the country is ${observed}` : ""}. ` +
        HIGH_TAX_COMPLEXITY_HEURISTIC.provenance +
        " Read this as an illustration of a jurisdiction risk dimension, not as a finding about that country's payroll tax.",
      evidence,
      whatItWouldTake,
    };
  }

  return {
    ...base,
    state: "unknown",
    finding:
      `The employment's country is not on the list (${list}) — which is NOT a finding that its payroll tax is straightforward. ` +
      "The list is unsourced and covers three countries, so a country's absence from it means only that nobody looked, and a " +
      "genuinely complex jurisdiction outside it would collect two signatures rather than three. " +
      HIGH_TAX_COMPLEXITY_HEURISTIC.provenance,
    evidence,
    whatItWouldTake,
  };
}

/**
 * Dimension 7 — is the employment still active at the moment of payment?
 *
 * THE GATE THAT RUNS LAST, NOT FIRST. policyEngine.js checked "is this employee
 * active?" when the request arrived; the signatures can land days later, so
 * submitAdjustmentApproval() re-reads the employment immediately before
 * `createIncentive()` and refuses if it is no longer active. Whether that has
 * happened is material to a signer and is visible nowhere else on the screen.
 *
 * `executing` IS REPORTED AS A FINDING, not as progress. A row left in that
 * state is the in-doubt case workflow.js deliberately does not clear: the
 * incentive POST was attempted and its outcome is unknown, so nobody should
 * press anything again without reconciling it.
 */
function freshnessDimension(row) {
  const base = {
    position: 7,
    key: "employment_freshness",
    label: "Employment status at the moment of payment",
    question: "Has the employment record been re-read since this request was assessed?",
  };
  const assessedAt = row.createdAt ?? null;
  const evidence = [
    { label: "Assessed as active on", value: assessedAt ?? "not recorded" },
    { label: "Re-read before payment", value: row.status === "executed" ? "yes" : "not yet" },
    // WHERE THIS REQUEST HAS GOT TO, IN WORDS. It printed the stored status
    // verbatim, so a payment screen said `pending_approval` to the person whose
    // signature it was waiting for. The state is the same; the sentence is now
    // addressed to them.
    { label: "Current status", value: statusWords(row.status) ?? "not recorded" },
  ];

  if (row.status === "executed") {
    return {
      ...base,
      state: "cleared",
      finding:
        `The employment was re-read immediately before the payment was created${row.executedAt ? ` on ${row.executedAt}` : ""} and was still active. ` +
        (row.remoteResult
          ? "Remote returned a result for the payment, and it is recorded against this adjustment."
          : "No result from Remote is recorded against this adjustment, so whether the payment landed cannot be stated from here."),
      evidence,
    };
  }

  if (row.status === "executing") {
    return {
      ...base,
      state: "attention",
      finding:
        "This adjustment is mid-payment, or a previous attempt is unresolved. The payment may or may not have reached Remote — that is precisely why it was not put back to waiting for signatures. Reconcile against Remote before anyone acts on it again.",
      evidence,
    };
  }

  if (row.status === "pending_approval") {
    return {
      ...base,
      state: "unavailable",
      finding:
        `Nothing here confirms the employee is still active today. The record was read once when this request was assessed${assessedAt ? ` on ${assessedAt}` : ""}, ` +
        "and it is read again only at the moment the final signature lands — the payment is refused there if the employment is no longer active. Between those two points this system holds no confirmation either way.",
      evidence,
    };
  }

  return {
    ...base,
    state: "not_assessed",
    finding:
      `This adjustment is ${statusWords(row.status) ?? "in a state with no payment ahead of it"}, so no payment will be attempted and the employment is never re-read.`,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// The one numeric threshold, with the measured value beside it — or neither
// ---------------------------------------------------------------------------
// A limit on its own tells a signer a rule exists, which they knew. This row
// carries BOTH sides, or says in words which side is missing and why. Money is
// formatted, never emitted as the ×100 integer the renderer would print raw
// beside a limit in the same units — the scaled figures travel as their own
// `…RemoteInteger` keys for anything reading this as data.
// ---------------------------------------------------------------------------
function measurements(row, view, ran) {
  if (!ran) return [];
  const d = view.approvalRequirement.dimensions.find((x) => x.code === "high_amount_risk") ?? {};
  const currency = row.adjustment?.currency ?? "";
  const limit = HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER;
  const amount = view.money.amountRemoteInteger;

  if (!Number.isInteger(amount)) {
    return [
      {
        key: "high_value_threshold",
        label: "Adjustment value against the high-value line",
        state: "unknown",
        limit: money(limit, currency),
        unit: null,
        measured: null,
        headroom: null,
        breached: false,
        limitRemoteInteger: limit,
        measuredRemoteInteger: null,
        note:
          "The line is known and the amount is not, so no comparison exists. This is an absence, not a figure under the line — nothing here says this adjustment is small.",
        whatItWouldTake: "The amount re-submitted as a number rather than as text, in Remote's ×100 integer form.",
      },
    ];
  }

  const over = amount - limit;
  return [
    {
      key: "high_value_threshold",
      label: "Adjustment value against the high-value line",
      state: over > 0 ? "breached" : "within_limit",
      limit: money(limit, currency),
      unit: null,
      measured: money(amount, currency),
      headroom:
        over > 0
          ? `none — ${money(over, currency)} over`
          : `${money(Math.abs(over), currency)} of headroom`,
      breached: over > 0,
      limitRemoteInteger: limit,
      measuredRemoteInteger: amount,
      overageRemoteInteger: over > 0 ? over : null,
      note:
        over > 0
          ? `${d.detail ?? `${money(amount, currency)} is over the line.`} Crossing it requires a third signature; it does not by itself refuse the payment.`
          : `${money(amount, currency)} against a ${money(limit, currency)} line. Below it, this dimension does not summon a third signature — the floor of ${APPROVAL_FLOOR} still applies.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// The fact that settled it
// ---------------------------------------------------------------------------
// A signer should not have to read seven dimensions to find the load-bearing
// one. `approval_floor` is deliberately NOT a candidate: it is the OUTCOME of
// the risk dimensions, not a cause, and lifting it out would answer "why three
// signatures?" with "because three signatures are required".
// ---------------------------------------------------------------------------
const DECIDING_CANDIDATES = new Set([
  "payment_amount",
  "payload_schema",
  "value_threshold",
  "manual_tax_adjustment",
  "jurisdiction_tax_complexity",
  "employment_freshness",
]);

function decidingFrom(dimensions) {
  const candidates = dimensions.filter((d) => DECIDING_CANDIDATES.has(d.key));
  const found =
    candidates.find((d) => d.state === "blocking") ??
    candidates.find((d) => d.state === "attention") ??
    candidates.find((d) => d.state === "unknown" && d.key === "payment_amount") ??
    null;
  return found ? { key: found.key, label: found.label, finding: found.finding } : null;
}

/**
 * Everything the two or three signatures turn on, from the persisted row alone.
 *
 * @param {object} args
 * @param {object|null} args.adjustmentRow  a `uc09_adjustments` row
 * @returns {{
 *   deciders: object[],
 *   roles: Array<{role:string, label:string, decides:string, turnsOn:string[], headline:string}>,
 *   deciding: {key:string, label:string, finding:string}|null,
 *   dimensions: object[],
 *   measurements: object[],
 *   unknowns: Array<{what:string, why:string, whatItWouldTake:string|null}>
 * }|null}  null when there is no row to describe
 */
export function describeAdjustmentBasis({ adjustmentRow } = {}) {
  const row = adjustmentRow;
  if (!row) return null;

  // ONE DERIVATION OF THE FIGURES, not a second copy. approvalView.js already
  // computes the amount/threshold comparison and the signature progress from
  // this same row; a second threshold comparison on the money path is a second
  // thing to drift.
  const view = describeAdjustment(row);
  const ran = sizingRan(row);

  const dimensions = [
    amountDimension(row, view),
    schemaDimension(row),
    approvalFloorDimension(row, view),
    valueThresholdDimension(row, view, ran),
    manualTaxDimension(row, view, ran),
    jurisdictionDimension(row, ran),
    freshnessDimension(row),
  ];

  const deciding = decidingFrom(dimensions);

  // ONLY THE ROLES THIS ADJUSTMENT ACTUALLY NEEDS. A payment releaser listed on
  // a two-signature adjustment is a person being told they have a decision to
  // make when they have none; `rolesInScope` is approvalView.js's own answer,
  // derived from the required count rather than from the risk flags.
  const inScope = new Set(view.approvalProgress.rolesInScope);
  const deciders = DECIDERS.filter((d) => inScope.has(d.role));
  const roles = deciders.map((d) => ({
    ...d,
    turnsOn:
      d.role === "requester"
        ? ["payment_amount", "payload_schema"]
        : d.role === "approver"
          ? ["approval_floor", "payment_amount", "payload_schema", "employment_freshness"]
          : ["jurisdiction_tax_complexity", "value_threshold", "manual_tax_adjustment", "approval_floor"],
    headline:
      d.role === "requester"
        ? view.money.statement
        : d.role === "approver"
          ? view.approvalRequirement.statement
          : deciding?.finding ?? view.approvalRequirement.statement,
  }));

  // WHAT IS MISSING, COLLECTED rather than left to be noticed by its absence.
  // An unknown a person has to deduce from a blank field is the same defect as
  // a fact withheld: they act on what they can see.
  const unknowns = [];
  if (!Number.isInteger(view.money.amountRemoteInteger)) {
    unknowns.push({
      what: "The amount to be paid",
      why: view.money.statement,
      whatItWouldTake:
        "The figure re-submitted as a number rather than as text, in Remote's ×100 integer form. This system refuses to guess an amount that will be paid.",
    });
  }
  if (ran && !observedCountryCode(row)) {
    unknowns.push({
      what: "Which country this employment is in",
      why:
        "The country the jurisdiction check compared is not kept on this request, so the check can say whether the list matched but not which country matched it. Requests raised through the main route now record it; this one is either older than that change, or came in through the route that still does not. Read the country off the employment record before treating the jurisdiction line as settled either way.",
      whatItWouldTake:
        "The country recorded on the request at the moment it is assessed, on both intake routes — the same value the check itself compared.",
    });
  }
  if (row.status === "pending_approval") {
    unknowns.push({
      what: "Whether the employee is still active right now",
      why:
        "The employment record is re-read only at the moment the final signature lands. Between assessment and that point this system holds no confirmation either way.",
      whatItWouldTake: null,
    });
  }

  return { deciders, roles, deciding, dimensions, measurements: measurements(row, view, ran), unknowns };
}
