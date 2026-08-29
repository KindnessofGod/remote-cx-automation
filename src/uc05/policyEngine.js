// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-05's deterministic decision gates
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same role as src/uc01/policyEngine.js and src/uc06/policyEngine.js: this
// is the system's judgment, and it contains no AI. Ordered gates, first
// failure wins — "when in doubt, escalate" (the same principle every other
// use case's policy engine follows).
//
// The five gates:
//
//   1. identity      — is the requester authorized to file this resignation
//                       (the employee themselves, or an HR/admin with
//                       consent)?  Same "identity from a signal, never a
//                       claim" rule as UC-01/UC-06.
//   2. employment    — is this employee still active?  A resignation against
//                       an already-terminated record is a record-keeping
//                       problem, not a notice-period problem.
//   3. seniority     — does the record carry a start_date?  UC-05 cannot
//                       compute tenure without it.  UC-05.md §12 scenario 4:
//                       "Missing seniority date -> blocked".
//   4. country rule  — is the country in the 9-country table?  Anything
//                       else escalates (00-FOUNDATION.md §4 invariant 9).
//   5. discrepancy   — if a proposed end date is supplied, does it fall on
//                       or after the statutory end date?  An EARLIER
//                       proposed date is a discrepancy that must be flagged
//                       to the local HR/Legal desk (UC-05.md §8), not
//                       silently accepted.  Which desk that is comes from
//                       src/shared/escalationRouting.js and is named on the
//                       rung below, never typed here.
//   6. PTO payout    — could the accrued-PTO payout actually be computed
//                       from the supplied balances?  A balance carrying no
//                       usable hourly rate or accrual is a figure we do not
//                       have, and HR Ops must not sign off a report whose
//                       money column is silently absent or invented
//                       (finding F-28, n8n execution 4975).
//
// Routing (UC-05 is 🟡 per CLAUDE.md / UC-05.md §1, NOT the spec's
// four-tier ladder which includes a 🟢 "fully automated pass" — the spec's
// 🟢 tier relies on a Remote write endpoint the same spec itself says
// does not exist as confirmed; UC-05.md §3 and the ticket explicitly call
// this out. The pragmatic reduction: a calculated discrepancy report
// either matches statute (HITL-prepared, HR Ops signs off) or it doesn't
// (escalate to the local HR/Legal desk, UC-05.md §8).  The HITL "approved"
// outcome is therefore
// `prepared_for_signoff` and the escalation is `escalate_legal_review`).
//
//   all_gates_passed + no discrepancy        -> prepared_for_signoff (HR Ops approves)
//   discrepancy_earlier_than_statutory       -> escalate (UC-05's escalation
//                                                 team, per escalationRouting.js)
//   pto_balance_unusable                     -> escalate (HR Ops fixes the balance data)
//   discrepancy_no_proposed_date + within    -> prepared_for_signoff (HR Ops can
//                                                 still sign off; calculator
//                                                 already produced a statutory end)
//   any other gate failure                   -> escalate
// ---------------------------------------------------------------------------

import { computeNoticePeriod } from "./noticePeriodCalculator.js";
import { reconcilePtoPayout } from "./ptoPayout.js";
import { bindGateDescriptions } from "../shared/gateLadder.js";
// DESCRIPTION ONLY, AND NOTHING BELOW evaluate() READS IT. The gate ladder has
// to name the team a `statutory_discrepancy` is handed to, and a name typed
// here is a second source of truth for a fact src/shared/escalationRouting.js
// owns — which is exactly how this file came to say "Local HR Legal" while the
// routing sent every UC-05 escalation to HR Ops, a team the prose never
// mentioned and the only one that actually received the work. `evaluate()`
// does not consult it: routing is a consequence of a decision and can never be
// an input to one.
import { escalationTeamFor } from "../shared/escalationRouting.js";

/**
 * @param {object} args
 * @param {boolean} args.identityVerified   requester is the employee (or HR with consent)
 * @param {object|null} args.employment     normalized employment record
 * @param {string|null} args.proposedEndDate  "YYYY-MM-DD" — from the resignation letter
 * @param {object} args.timeOffBalances     array for reconcilePtoPayout()
 * @param {string} args.currency            single currency for the PTO payout
 * @param {string|number|Date} args.now     explicit now
 * @returns {{
 *   decision: "prepared_for_signoff" | "escalate",
 *   reason: string,
 *   flags: string[],
 *   notice: object,
 *   payout: object
 * }}
 */
export function evaluate({
  identityVerified,
  employment,
  proposedEndDate = null,
  timeOffBalances = [],
  currency = "USD",
  now,
}) {
  // Gate 1 — identity
  if (!identityVerified) {
    return {
      decision: "escalate",
      reason: "identity_not_verified",
      flags: ["identity_not_verified"],
      notice: null,
      payout: null,
    };
  }

  // Gate 2 — employment status
  if (!employment || employment.status !== "active") {
    return {
      decision: "escalate",
      reason: "employee_not_active",
      flags: ["employee_not_active"],
      notice: null,
      payout: null,
    };
  }

  // Gate 3 — seniority date (UC-05.md §12 scenario 4)
  if (!employment.start_date) {
    return {
      decision: "escalate",
      reason: "missing_seniority_date",
      flags: ["missing_seniority_date"],
      notice: null,
      payout: null,
    };
  }

  // Calculate the statutory notice period regardless of any proposed date —
  // HR Ops needs the statutory number visible even when the discrepancy
  // branch is going to escalate the case.
  const notice = computeNoticePeriod({
    countryCode: employment.country_code,
    startDate: employment.start_date,
    // BOTH NAMES, deliberately. `probation_end_date` is the normalized name
    // (RemoteClient.normalizeEmployment, and the n8n Normalize node);
    // `probation_period_end_date` is what the Remote API itself returns
    // top-level [CONFIRMED against the Sandbox, 2026-08-19]. Reading only the
    // normalized name is what made every probation bracket in the table dead
    // code — see the note on that field in src/remote/restClient.js. Accepting
    // the raw name too means a record that reaches this gate unnormalized
    // (a mock passthrough, a hand-built plan) still gets the right rule rather
    // than silently the full-tenure one.
    probationEndDate: employment.probation_end_date ?? employment.probation_period_end_date ?? null,
    proposedEndDate,
    now,
  });

  // Gate 4 — no statutory end date could be produced. TWO different reasons
  // land here and they are NOT the same escalation.
  //
  // This gate used to be a single `if (!notice.noticeEndDate)` reporting
  // `unsupported_country`, and it was wrong for a whole class of employee that
  // driving the portal turned up in one click. Emma Thompson is a UK employee;
  // filed five days into her employment the panel returned:
  //
  //     escalate · unsupported_country · [unsupported_country] [country_GB]
  //     RULE APPLIED   Employment Rights Act 1996 §86 (sliding scale)
  //
  // It names the UK statute it just looked up and, one line above, says the UK
  // is not a country we cover. The country IS in the table; §86 simply grants
  // no notice below one month's service, so no bracket matched. Reachable the
  // same way for anyone still inside a probation period that runs past their
  // country's probation bracket (PT permits 240 days; the bracket caps at 5
  // months).
  //
  // Why it matters beyond the wording: `unsupported_country` + `country_GB` is
  // a claim about Remote's coverage, written durably to uc05_resignations and
  // to audit_log, and ranked by the metrics dashboard's exception table. Read
  // back later it says "the UK is out of scope for UC-05", which is false and
  // is precisely the kind of statement §7's status tables are load-bearing
  // about. It also sends the case to the wrong desk: nobody can "add the UK to
  // the table" — the case needs someone to confirm that a sub-one-month leaver
  // owes no statutory notice.
  //
  // `noticeRuleFound` is the calculator's own answer to "did the table have a
  // rule for this country at all", which is the only thing that separates the
  // two, and it is decided where the lookup happens rather than re-derived here.
  //
  // A THIRD REASON JOINED THEM 2026-08-20, and it is the one that is a statement
  // ABOUT THE LAW rather than about this table. `statutoryMinimumExists === false`
  // is the calculator reporting a SOURCED finding that no statutory minimum binds
  // a resigning employee in this country — the United States today. Before it
  // existed, every American resignation escalated as `unsupported_country`,
  // which is a durable, false claim that the US is outside Remote's coverage,
  // written to uc05_resignations, to audit_log and into the metrics exception
  // ranking. The three now go to three different work orders:
  //
  //   unsupported_country          -> extend the table; we hold no rule
  //   no_statutory_notice_period   -> read the contract; the statute is silent
  //   no_matching_notice_bracket   -> extend the table's low end for this tenure
  //
  // WHY THIS STILL ESCALATES rather than passing to prepared_for_signoff — the
  // argument, in full, is in docs/use-cases/UC-05.md §7a. In short: what a
  // resigning American owes comes from their CONTRACT, this system does not hold
  // contracts, and a sign-off form whose notice section is blank invites exactly
  // the reading gate 6 below refuses for a null payout — "nothing is owed" —
  // when the truth is "we cannot see what is owed". The evidence is also the
  // weakest in the table: D-06 is `[INFERRED — argument from scope]`, so it is
  // allowed to change what the record SAYS and not to advance a case toward a
  // human signing a figure off.
  //
  // Placed FIRST among the three because it is the most specific: the other two
  // are both true of it in a trivial sense (there is no bracket, and there is no
  // computed end date), and whichever branch runs first owns the recorded reason.
  if (!notice.noticeEndDate) {
    if (notice.statutoryMinimumExists === false) {
      return {
        decision: "escalate",
        reason: "no_statutory_notice_period",
        flags: [
          "no_statutory_notice_period",
          `country_${notice.countryCode || "unknown"}`,
          // The flag a human acts on. It names the document that WOULD answer
          // the question, which no other escalation in this engine can do —
          // every other one names something missing from OUR side.
          "contractual_notice_not_held",
        ],
        notice,
        payout: null,
      };
    }
    const ruleFound = notice.noticeRuleFound === true;
    return {
      decision: "escalate",
      reason: ruleFound ? "no_matching_notice_bracket" : "unsupported_country",
      flags: ruleFound
        ? ["no_matching_notice_bracket", `country_${notice.countryCode || "unknown"}`, `tenure_months_${notice.tenureMonths ?? "unknown"}`]
        : ["unsupported_country", `country_${notice.countryCode || "unknown"}`],
      notice,
      payout: null,
    };
  }

  // PTO payout reconciliation is computed whether or not the discrepancy
  // gate fires — it is part of the HR Ops view. The discrepancy is a SEPARATE
  // question from the payout amount.
  const payout = reconcilePtoPayout({
    balances: timeOffBalances,
    currency,
    reportedBalanceInRemoteInteger: null, // no employee claim in this entry point
  });

  // Gate 5 — discrepancy check (UC-05.md §8: "Statutory discrepancy ->
  // escalate to Local HR/Legal with highlighted delta")
  // Flagged before the discrepancy branch returns, so an unusable balance is
  // recorded even when an EARLIER gate owns the decision (see gate 6 below).
  const flags = [];
  if (payout && payout.computable === false) {
    flags.push("pto_balance_unusable");
    for (const line of payout.unusableLines ?? []) {
      for (const field of line.missing ?? []) {
        const flag = `pto_missing_${field}`;
        if (!flags.includes(flag)) flags.push(flag);
      }
    }
  }
  if (notice.discrepancy === "earlier_than_statutory") {
    flags.push("discrepancy_earlier_than_statutory", `discrepancy_days_${notice.discrepancyDays}`);
    return {
      decision: "escalate",
      reason: "statutory_discrepancy",
      flags,
      notice,
      payout,
    };
  }
  if (notice.anchorAdjusted) flags.push("anchor_rule_applied");
  if (payout.hasDiscrepancy) flags.push("pto_discrepancy");

  // Gate 6 — is the PTO payout actually computable?  (finding F-28)
  //
  // This sits AFTER the discrepancy gate on purpose. "Ordered gates, first
  // failure wins" is the rule the whole engine is built on, and the statutory
  // discrepancy is the substantive answer ABOUT THE REQUEST, while an unusable
  // balance is an input-quality problem with the data we were handed. Both
  // escalate, so the routing is identical either way and only the RECORDED
  // REASON differs — and relabelling a real legal discrepancy as a data problem
  // would send the case to the wrong desk. The unusable balance is pushed onto
  // `flags` above the return in every branch, so it is never invisible: the
  // discrepancy escalation still carries `pto_balance_unusable` in its flags.
  //
  // On the previously-passing path it is decisive. A report reaching HR Ops for
  // sign-off with `totalInRemoteInteger: null` invites exactly the reading the
  // ×100 invariant exists to prevent — "no payout due" — when the truth is
  // "we could not work it out". Refusing names the cause and the missing field.
  // `flags` already carries pto_balance_unusable + pto_missing_<field> from the
  // block above the discrepancy branch — appending them again here is what the
  // parity test caught when this was first written, and duplicate flags would
  // double-count in the metrics dashboard's exception ranking.
  if (payout && payout.computable === false) {
    return {
      decision: "escalate",
      reason: "pto_balance_unusable",
      flags,
      notice,
      payout,
    };
  }

  // All gates passed; report is ready for HR Ops sign-off.
  return {
    decision: "prepared_for_signoff",
    reason: "all_gates_passed",
    flags,
    notice,
    payout,
  };
}

// ---------------------------------------------------------------------------
// GATE_SEQUENCE  —  what each reason MEANS, and where in the order it sits
// ---------------------------------------------------------------------------
// Derived by reading evaluate() above top to bottom. One row per REASON, in
// the order evaluate() can produce them; `checks` is the PASSING condition and
// `means` is what it is to a person when that reason is the one that decided.
// The raw slug stays visible beside the prose — it is the string in
// `audit_log`, the metrics exception ranking and the n8n port.
//
// Worth knowing while reading this ladder: the header comment above lists a
// "discrepancy_no_proposed_date" outcome, but evaluate() never returns it.
// `no_proposed_date` is a value of `notice.discrepancy` (see
// noticePeriodCalculator.js), not a decision reason — a resignation with no
// proposed end date simply passes gate 5 and lands on `all_gates_passed`.
// There is no rung for it here because there is no decision by that name.
// ---------------------------------------------------------------------------
/**
 * The team a UC-05 escalation is addressed to, read from the routing table.
 *
 * NOT A STRING LITERAL, ON PURPOSE — see the import note at the top of the
 * file. If the table's answer ever changes, this rung's prose changes with it;
 * if the table has no answer, the rung says so rather than naming a team that
 * does not exist.
 *
 * THE FALLBACK NAMES THE ABSENCE WITHOUT NAMING A FILE. `means` is read by the
 * employee who filed the resignation (the portal's "What happened" row) as well
 * as by the specialist who picks it up, and "src/shared/escalationRouting.js"
 * was a path only somebody with this checkout could open — see
 * docs/UI-AUDIENCES.md. The CLAIM is what mattered and it survives verbatim:
 * nobody is named because nothing names them, and that is itself the finding.
 * The file that would have to change is in this comment, where the person who
 * would change it is already reading.
 */
const ESCALATION_TEAM =
  escalationTeamFor("UC-05") ??
  "The team that owns escalations for this kind of request (none is named for it in the escalation routing table, which is itself the finding)";

export const GATE_SEQUENCE = Object.freeze([
  {
    position: 1,
    reason: "identity_not_verified",
    gate: "identity",
    checks:
      "the person filing the resignation is the employee it is about, or HR acting with their consent",
    means:
      "We could not confirm the person filing this resignation is the employee it concerns (or HR acting for them), so no notice period was calculated. This is a failure to VERIFY — it is not a finding that the filing is fraudulent.",
  },
  {
    position: 2,
    reason: "employee_not_active",
    gate: "employment_status",
    checks: "the employment record exists and is active",
    means:
      "The employment record is missing or has already ended. A resignation against a record that is no longer active is a record-keeping question for HR, not a notice-period calculation.",
  },
  {
    position: 3,
    reason: "missing_seniority_date",
    gate: "seniority_date",
    checks: "the employment record carries a start date",
    means:
      "The employment record has no start date, so length of service — which every statutory notice period is calculated from — cannot be worked out. The record has to be corrected before any notice period can be produced. Nothing here says the notice would have been short or long.",
  },
  {
    position: 4,
    reason: "unsupported_country",
    gate: "country_rule",
    checks: "the employment's country is one this system holds statutory notice rules for",
    means:
      "This employee's country is not one of the countries whose statutory notice rules this system holds, so no notice period was calculated. That is a gap in our own table — it says nothing about what that country's law actually requires, which is exactly why it goes to a person rather than being guessed.",
  },
  {
    position: 5,
    reason: "no_statutory_notice_period",
    gate: "country_rule",
    checks:
      "the employee's country sets a statutory minimum notice period that a resigning employee must serve",
    means:
      "This country sets NO statutory minimum notice on a resigning employee — that is a sourced finding about the law, not a gap in our table, and it is the opposite of \"unsupported country\". What notice is owed comes from the employee's CONTRACT, and this system does not hold contracts and has not read one. Nobody should read this as \"no notice is owed\": the statute is silent, the contract may not be. Somebody has to open the contract.",
  },
  {
    position: 6,
    reason: "no_matching_notice_bracket",
    gate: "notice_rule",
    checks: "the country's notice table reaches a bracket covering this employee's tenure",
    means:
      "We DO hold statutory notice rules for this country — none of its brackets covers this employee's tenure. That is the opposite of \"unsupported country\", and the two used to be reported identically: a UK employee three weeks in was told the United Kingdom is unsupported, on a panel citing the UK statute one line above. Someone has to extend the table's low end, not add the country.",
  },
  {
    position: 7,
    reason: "statutory_discrepancy",
    gate: "discrepancy",
    checks: "any end date proposed in the resignation falls on or after the statutory notice end date",
    means:
      // THE PROVENANCE SURVIVES; THE FILE PATH DOES NOT. This sentence is the
      // most consequential one this system shows a resigning employee, and it
      // ended on "(src/uc05/decisionSources.js)" — a path in a source tree,
      // cited to somebody who has just handed in their notice and cannot open
      // it. What it was there to say is a LIMIT, and limits stay
      // (docs/UI-AUDIENCES.md §5): we have the country's own statute for some
      // countries and not others, and which of the two this is changes what the
      // case can show. That claim is now made in words. The module that holds
      // those statutes is src/uc05/decisionSources.js, named here in the
      // comment, where the only reader who can use it is already looking.
      `The end date proposed in the resignation is EARLIER than the statutory minimum notice allows. ${ESCALATION_TEAM} has to decide how the shortfall is handled — the flags on the case carry how many days short it is, and where a source for that country's own notice statute has been read into this system, the case also carries what the statute itself says about serving short notice. This is not an arithmetic error; it is a real conflict between what was proposed and what the law requires.`,
  },
  {
    position: 8,
    reason: "pto_balance_unusable",
    gate: "pto_computable",
    checks: "the PTO balance can actually be turned into a payout figure",
    means:
      "The PTO payout could not be worked out from the balance we were handed. It sits AFTER the statutory check deliberately: a legal discrepancy is a finding about the REQUEST, this is a problem with the DATA, and both escalate — so only the recorded reason differs, and mislabelling one as the other sends the case to the wrong desk. Signing off a report that simply left the figure blank would invite exactly the reading the money rules exist to prevent: \"nothing is owed\", when the truth is \"we could not work it out\".",
  },
  {
    position: 9,
    reason: "all_gates_passed",
    gate: "outcome",
    checks: "every gate above passed",
    means:
      // WHAT HAPPENS NEXT, NOT HOW WE ARE BUILT. This ended on "UC-05 has no
      // write path to Remote at all" — true, and a statement about our own
      // architecture on the screen of somebody who wants to know what has
      // become of their resignation. The half that answers their question is
      // the half that stays: nothing has been filed on their behalf, signing
      // off is not the thing that ends the employment, and a named team has it.
      // The architectural fact is unchanged and is stated where it belongs:
      // docs/use-cases/UC-05.md's endpoint note, which records live-verified
      // against developer.remote.com that no resignation write path exists on
      // Remote's API at all.
      "Every check passed, so a notice-period and PTO-payout report has been prepared for HR Ops to sign off. Nothing has been filed with Remote on anyone's behalf: signing off records the report — it does not end the employment, and no part of this system does.",
  },
]);

const descriptions = bindGateDescriptions(GATE_SEQUENCE);

/**
 * Which gate decided this outcome, and what that means in plain words.
 * Returns null for a reason with no row — see shared/gateLadder.js.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeDecidingGate = descriptions.describeDecidingGate;

/**
 * The whole ordered ladder, each rung marked passed / decided / not_reached.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeGateLadder = descriptions.describeGateLadder;
