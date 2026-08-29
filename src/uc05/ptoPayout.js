// ---------------------------------------------------------------------------
// ptoPayout.js  —  Accrued-PTO payout reconciliation (deterministic, no LLM)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-05.md §7 calls for "Accrued PTO payout reconciliation from Time Off
// API" and "Money ×100" on payout figures. This is a PURE reconciliation
// over a structured time-off balance — never a guess, never a model call,
// never something a free-text resignation letter is the source of.
//
// WHAT IT TAKES IN
// An array of time-off balances. Two accepted shapes, and which one a line
// uses is decided by whether it carries a `daysAvailable` key:
//
//   {timeOffType, daysAvailable, workingHoursPerDay, hourlyRateInRemoteInteger}
//     Remote's own netted remaining balance, as produced by
//     `src/remote/leaveBalances.js` from
//     `GET /v1/leave-policies/summary/{employment_id}`. This is the production
//     shape and the payout base is READ, never recomputed — read that file's
//     header for the live evidence that recomputing it from
//     `annual_entitlement − used` overpays.
//
//   {timeOffType, daysAccrued, daysUsed, hourlyRateInRemoteInteger}
//     the components, for a caller that genuinely has them (the portal form,
//     the tests, a hand-built plan). Unchanged.
//
// hourlyRateInRemoteInteger is the EMPLOYEE's gross hourly rate in Remote's
// integer ×100 form, and IT DOES NOT COME FROM REMOTE. No Remote endpoint this
// repo has found publishes an hourly or daily rate; `contract_details` carries
// `annual_gross_salary`, and converting that needs a weeks-per-year and a
// working-days-per-year figure Remote never states, plus a jurisdictional rule
// about which base a leave payout is computed on. So the rate stays a
// caller-supplied input, and a line without one is REFUSED by name rather than
// settled against an assumed 40-hour week — an assumption that would put an
// invented number on a document an employee signs. `decisionFacts.js` turns
// that refusal into the sentence HR Ops actually reads.
//
// WHAT IT RETURNS
// A reconciliation:
//   - the per-type days available (accrued - used)
//   - the per-type payout in Remote's integer money form (×100 already done)
//   - a total in the same form
//   - a `breakdown` array for the audit row / ZAF sidebar
//   - a `discrepancy` field when the reported "remaining balance" supplied
//     alongside the balances disagrees with the accrued-minus-used total
//     (UC-05 V2 research §"agrees_to_pto_amount") — flagged, never
//     silently fixed
//
// If the input is empty / missing, the function returns a zero payout
// honestly tagged as `source: "no_time_off_records"` rather than guessing
// a positive number.
//
// AND IF A BALANCE IS PRESENT BUT UNUSABLE, IT REFUSES — finding F-28.
// n8n execution 4975 (2026-08-18) delivered
// `timeOffBalances: [{type: "vacation", balanceDays: 8}]`: a plausible-looking
// Time Off shape carrying NONE of the four fields this function multiplies.
// `fromRemoteInteger(undefined)` threw a TypeError straight out of the gates,
// and because the gates run BEFORE the audit write, the request vanished —
// no case row, no audit row, no human told. That is the one outcome the
// architecture exists to prevent: every other gate failure here fails closed
// to a durable, audited escalate; this one failed open into silence.
//
// The fix is NOT to treat a missing rate as zero. Look at what the old code
// already did on the days side: `(Number(b.daysAccrued) || 0)` turns an absent
// or garbage accrual into 0, so execution 4975's balance would have produced a
// confident **0.00 EUR payout** on 8 genuinely accrued days even if the rate
// had been present. A zero payout on a real balance is an underpayment a human
// signs off on; a refusal is a question a human answers. Prime directive 1 and
// the money ×100 invariant say the same thing: a figure we cannot derive must
// be refused, never invented.
//
// So each line is classified before any arithmetic runs. A line is usable only
// when `hourlyRateInRemoteInteger` is a real integer (a quoted "5000" is
// REFUSED, not coerced — silently accepting it is how a 100x scaling error gets
// in, the same reasoning as UC-09 finding F-05) and `daysAccrued`/`daysUsed`
// are finite numbers. If ANY line is unusable the TOTAL is `null`, not a
// partial sum: a partial sum presented as a total is a wrong number, which is
// worse than a missing one (§9 — "a wrong number gets acted on while a missing
// one gets investigated"). The usable lines are still returned so HR Ops can
// see what was derivable, and `unusableLines` names exactly which field was
// missing on which line so the escalation is actionable rather than just loud.
//
// AND A NEGATIVE DAY COUNT IS UNREADABLE, NOT ZERO — finding F-33.
// F-28 taught this function to refuse a figure it cannot derive. It still
// accepted one it cannot trust: `Math.max(0, accrued - used)` turned a stated
// -8 accrued days into a computable 0.00 payout with no flag anywhere. See
// unusableFields() below for why the refusal belongs there and why the clamp
// itself stays.
// ---------------------------------------------------------------------------

import { toRemoteInteger, fromRemoteInteger } from "../shared/money.js";

/**
 * @typedef {object} TimeOffBalance
 * @property {string}  timeOffType                e.g. "paid_time_off", "sick"
 * @property {number} [daysAvailable]             Remote's own remaining balance in days,
 *   already netted of days used. When this key is present it is the payout base
 *   and daysAccrued/daysUsed are ignored.
 * @property {number} [daysAccrued]               days earned in the period (component shape)
 * @property {number} [daysUsed]                  days taken (component shape)
 * @property {number} [workingHoursPerDay]        the policy row's own
 *   `working_hours_per_day`, preferred over the caller's `hoursPerDay` default
 * @property {string} [unavailable]               why `daysAvailable` is null, when it is
 * @property {string} [source]                    provenance of the days, e.g.
 *   "remote_leave_policy_summary"
 * @property {number}  hourlyRateInRemoteInteger  employee gross hourly rate in ×100
 *   (i.e. the integer form Remote stores — see src/shared/money.js). NOT a
 *   Remote-supplied figure; see the file header.
 */

/**
 * @typedef {object} PayoutLine
 * @property {string} timeOffType
 * @property {number} daysAvailable
 * @property {number} payoutInRemoteInteger    the line payout, already ×100
 * @property {string} currency
 */

/**
 * @typedef {object} PayoutReconciliation
 * @property {PayoutLine[]} lines
 * @property {number} totalInRemoteInteger      sum of line payouts, already ×100
 * @property {string} currency                  the single currency (assumed consistent; mixed
 *   currencies would be a separate problem, intentionally out of scope)
 * @property {boolean} hasDiscrepancy
 * @property {number|null} reportedBalanceInRemoteInteger
 * @property {number|null} computedBalanceInRemoteInteger
 * @property {boolean} computable              false when any balance line was unusable;
 *   the money fields are then null rather than a partial or invented figure
 * @property {UnusableLine[]} unusableLines    one entry per refused line, naming its fields
 * @property {string} source                   "time_off_records" | "no_time_off_records"
 *   | "unusable_time_off_records"
 */

/**
 * @typedef {object} UnusableLine
 * @property {number} index                    position in the supplied balances array
 * @property {string|null} timeOffType         whatever type label the line carried, if any
 * @property {string[]} missing                the field names that were absent or unusable
 */

/**
 * A time-off balance line is usable only if every number this function
 * multiplies is genuinely a number of the right kind. Returns the list of
 * offending field names — empty means usable.
 *
 * `hourlyRateInRemoteInteger` must be an INTEGER: it is already in Remote's
 * ×100 form, so a float there means someone passed a human amount and the
 * payout would be 100x wrong. A numeric string is deliberately not coerced.
 * `daysAccrued` must be present and finite; `daysUsed` may be absent (nothing
 * taken yet) but must be finite if supplied.
 *
 * NEITHER DAY COUNT MAY BE NEGATIVE — finding F-33.
 * A negative day count is not a fact about a balance; it is a balance we
 * cannot read, and it has to be refused HERE because the clamp downstream
 * cannot tell the two apart. `Math.max(0, -8 - 0)` turned a stated -8 accrued
 * days into a perfectly computable **0.00 payout** — `computable: true`,
 * source `time_off_records`, no flag raised, `prepared_for_signoff`. That is
 * the F-28/F-29/F-30 shape exactly: an unknown coerced into a real quantity,
 * so nothing errors and a human signs off a figure nobody derived. The portal
 * cannot fix it from its side either (F-30's own handoff note): it forwards a
 * stated accrual RAW precisely so this function can judge it, and forwarding a
 * negative into a clamp rebuilds the confident zero F-30 removed.
 *
 * `daysUsed` is refused on the same rule for a sharper reason: a negative USED
 * count does not underpay, it OVERPAYS. `Math.max(0, 10 - (-5))` yields 15
 * days available out of a 10-day accrual — 50% more than the accrual could
 * ever justify — and the clamp cannot see it, because the number it produces
 * is positive and plausible.
 *
 * The clamp itself is NOT the bug and is kept as it is. `accrued 4 / used 6`
 * is a legitimate situation (leave taken in advance) whose payout genuinely is
 * zero; refusing that would be the mirror-image defect, a gate that refuses
 * everything and therefore passes every fail-closed assertion
 * (docs/BUILD-LOG.md §3.30). A stated 0 is likewise an answer, not an absence.
 *
 * @param {any} balance
 * @returns {string[]} field names that make the line unusable
 */
function unusableFields(balance) {
  const missing = [];
  if (!balance || typeof balance !== "object") return ["balance"];
  // NEGATIVE IS NOT MERELY AN INTEGER. Number.isInteger(-2500) is true, so a
  // negative rate produced a confident negative payout and passed every gate.
  // F-33 already refuses negative daysAccrued/daysUsed a few lines below; the
  // sibling check for the rate itself was never added.
  if (
    !Number.isInteger(balance.hourlyRateInRemoteInteger) ||
    balance.hourlyRateInRemoteInteger < 0
  ) {
    missing.push("hourlyRateInRemoteInteger");
  }

  // A LINE THAT CARRIES REMOTE'S OWN NETTED BALANCE IS JUDGED ON THAT FIGURE.
  //
  // `src/remote/leaveBalances.js` reads `balance` off
  // `GET /v1/leave-policies/summary/{id}` — the accrued-to-date remaining days,
  // which is what a final settlement pays. It is deliberately NOT expressed
  // here as an accrued/used pair, because it is not one: on the live record the
  // fixture copies, `annual_entitlement − used` is 25 days while `balance` is
  // 13.75, and re-deriving the base from the components would have overpaid by
  // the difference. So `daysAvailable` is a first-class input, and the only
  // thing this function has to decide about it is the same thing F-33 decided
  // about the components — a NEGATIVE figure is a balance we cannot read, not a
  // payout of zero, and it is refused rather than clamped.
  //
  // The key's PRESENCE selects the rule, not its value: a line that carries
  // `daysAvailable: null` (an unlimited policy, or an hours remainder with no
  // `working_hours_per_day` to fold it in) must be refused for its own missing
  // figure, never silently fall through to an accrued/used pair it does not
  // have either.
  if ("daysAvailable" in balance) {
    const available = Number(balance.daysAvailable);
    if (
      balance.daysAvailable === null ||
      balance.daysAvailable === undefined ||
      balance.daysAvailable === "" ||
      !Number.isFinite(available) ||
      available < 0
    ) {
      missing.push("daysAvailable");
    }
    return missing;
  }

  if (
    !Number.isFinite(Number(balance.daysAccrued)) ||
    balance.daysAccrued === null ||
    balance.daysAccrued === undefined ||
    balance.daysAccrued === "" ||
    Number(balance.daysAccrued) < 0
  ) {
    missing.push("daysAccrued");
  }
  const used = balance.daysUsed;
  if (used !== null && used !== undefined && (!Number.isFinite(Number(used)) || used === "" || Number(used) < 0)) {
    missing.push("daysUsed");
  }
  return missing;
}

/**
 * @param {object} args
 * @param {TimeOffBalance[]} args.balances
 * @param {string} args.currency            e.g. "USD" — a single currency across all lines
 * @param {number} [args.hoursPerDay]       default 8
 * @param {number|null} [args.reportedBalanceInRemoteInteger]  optional — the employee's claim of
 *   remaining balance (e.g. from the resignation letter). When supplied and
 *   not equal to the computed total, the reconciliation is flagged
 *   `hasDiscrepancy: true` so HR Ops can verify.
 * @returns {PayoutReconciliation}
 */
export function reconcilePtoPayout({ balances, currency, hoursPerDay = 8, reportedBalanceInRemoteInteger = null }) {
  if (!Array.isArray(balances) || balances.length === 0) {
    return {
      lines: [],
      totalInRemoteInteger: 0,
      currency: currency ?? "USD",
      hasDiscrepancy: false,
      reportedBalanceInRemoteInteger,
      computedBalanceInRemoteInteger: 0,
      computable: true,
      unusableLines: [],
      source: "no_time_off_records",
    };
  }

  // Classify BEFORE multiplying. The old code went straight to .map() and let
  // fromRemoteInteger() throw — see the file header for what that cost live.
  const unusableLines = [];
  const usable = [];
  balances.forEach((b, index) => {
    const missing = unusableFields(b);
    if (missing.length > 0) {
      unusableLines.push({
        index,
        timeOffType: b && typeof b === "object" && typeof b.timeOffType === "string" ? b.timeOffType : null,
        missing,
        // WHY, when the reader knows why. `missing` names the FIELD; a field
        // name alone sends a specialist looking for a value to type in, and for
        // an unlimited policy or an unpublished pay rate there is no such
        // value — the answer is a different action entirely. `reason` is that
        // sentence's raw form and is null whenever nothing upstream said.
        reason: b && typeof b === "object" && typeof b.unavailable === "string" ? b.unavailable : null,
        source: b && typeof b === "object" && typeof b.source === "string" ? b.source : null,
      });
    } else {
      usable.push(b);
    }
  });

  const lines = usable.map((b) => {
    // Remote's own netted balance when the line carries one, the accrued-minus-
    // used derivation when it does not. Never both: see unusableFields().
    const daysAvailable =
      "daysAvailable" in b
        ? Number(b.daysAvailable)
        : Math.max(0, (Number(b.daysAccrued) || 0) - (Number(b.daysUsed) || 0));
    // THE ROW'S OWN `working_hours_per_day`, WHEN REMOTE SENT ONE. The 8 in
    // this function's default is a convention; the figure on the leave-policy
    // row is a fact about that policy, and preferring the fact is what stops a
    // day-to-hour conversion being an assumption. All 46 live policies read 8,
    // which is exactly why this must not be hard-coded — a value that has never
    // varied in the data you have is the easiest wrong constant to adopt.
    const rowHoursPerDay = Number(b.workingHoursPerDay);
    const effectiveHoursPerDay = Number.isFinite(rowHoursPerDay) && rowHoursPerDay > 0 ? rowHoursPerDay : hoursPerDay;
    const hours = daysAvailable * effectiveHoursPerDay;
    // hourlyRate is already in Remote's integer (×100) form, so the product
    // is also in ×100 form. We re-toRemoteInteger() against the human-amount
    // view to defensively guard against caller bugs (e.g. someone passing a
    // human-amount figure by accident) — a wrong scale would produce a
    // 100x payout, exactly the failure mode 00-FOUNDATION.md invariant 1
    // exists to catch.
    const hourlyRateAsHuman = fromRemoteInteger(b.hourlyRateInRemoteInteger);
    const linePayoutHuman = hours * hourlyRateAsHuman;
    const linePayoutInteger = toRemoteInteger(linePayoutHuman);
    return {
      timeOffType: b.timeOffType,
      daysAvailable,
      payoutInRemoteInteger: linePayoutInteger,
      currency: currency ?? "USD",
      // WHERE THE DAYS CAME FROM, carried onto the line that is stored and
      // signed. Until the Time Off read existed, every figure here originated
      // in a form field; now some do and some do not, and a settlement document
      // that does not say which is a document nobody can check. Null when the
      // caller supplied a bare balance and said nothing about its origin.
      daysSource: typeof b.source === "string" ? b.source : null,
      hoursPerDay: effectiveHoursPerDay,
    };
  });

  // A partial sum is a wrong sum. If any line was refused there is no total to
  // report, and no discrepancy to assert either — comparing an employee's
  // claimed balance against an incomplete figure would manufacture a
  // "discrepancy" that is really just our own missing data.
  const computable = unusableLines.length === 0;
  const totalInRemoteInteger = computable ? lines.reduce((sum, l) => sum + l.payoutInRemoteInteger, 0) : null;
  const hasDiscrepancy =
    computable && reportedBalanceInRemoteInteger !== null && reportedBalanceInRemoteInteger !== totalInRemoteInteger;

  return {
    lines,
    totalInRemoteInteger,
    currency: currency ?? "USD",
    hasDiscrepancy,
    reportedBalanceInRemoteInteger,
    computedBalanceInRemoteInteger: totalInRemoteInteger,
    computable,
    unusableLines,
    source: computable ? "time_off_records" : "unusable_time_off_records",
  };
}
