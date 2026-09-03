// ---------------------------------------------------------------------------
// payoutWorking.js  —  how the holiday settlement figure was arrived at
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A resigning employee filed a UC-05 request stating 18 days accrued, 5 taken,
// at 26.00 EUR an hour. The result panel printed:
//
//     PTO PAYOUT   2704.00 EUR — from the leave balances on record
//
// **Not one of the four numbers they had just typed was on the screen**, and
// the only sentence beside the figure attributed it to records nobody had read.
// A settlement figure with no working is a number a person can neither check
// nor challenge — and this is the last figure they see before an employment
// ends, on a report HR Ops is asked to sign.
//
// The arithmetic is not in doubt and never was: reconcilePtoPayout() does
// `(accrued − used) × hours-per-day × hourly rate`, in Remote's integer ×100
// form throughout. What was missing was any statement of it. This module turns
// one reconciled line into that statement, once, so the RESULT PANEL and the
// SIGNED-OFF REPORT say the same sentence rather than two that can drift.
//
// ---------------------------------------------------------------------------
// IT ADDS NOTHING AND ROUNDS NOTHING
// ---------------------------------------------------------------------------
// Every number below is read off `payout.inputs[i]`, which reconcilePtoPayout()
// echoes from the balance line it actually multiplied. Nothing here recomputes
// the total, and nothing here derives a missing input from the ones that are
// present — in particular the hourly rate is NEVER recovered by dividing the
// payout by the hours. That division is not exact (the payout is rounded to the
// cent) and a rate reconstructed from a rounded product is a figure nobody
// stated, printed as if the employee had stated it. Where an input is absent
// the working says so and stops; it does not fill the gap.
//
// PURE. A reconciliation in, strings out. No store, no clock, no network.
// ---------------------------------------------------------------------------

import { formatMoney, fromRemoteInteger } from "../shared/money.js";

/** A number that can be shown to a person: finite, and actually a number. */
function real(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * "18 days accrued − 5 taken = 13 days" — or, where the balance arrived as
 * Remote's own already-netted figure, just "13.75 days available".
 *
 * THE TWO SHAPES ARE NOT THE SAME CLAIM and must not render identically.
 * `daysAvailable` off Remote's leave-policy summary is a balance Remote
 * computed; `accrued − used` is a subtraction this system performed on two
 * figures somebody supplied. A reader checking the maths needs to know which of
 * those they are looking at, because only the second has anything to check.
 */
function daysClause(input) {
  const available = real(input.daysAvailable) ? input.daysAvailable : null;
  if (available === null) return null;

  if (real(input.daysAccrued)) {
    const used = real(input.daysUsed) ? input.daysUsed : 0;
    return `${input.daysAccrued} days accrued − ${used} taken = ${available} days`;
  }
  return `${available} days available`;
}

/**
 * The whole derivation of ONE line, in the order a person would do it by hand.
 *
 * @param {object} input  one entry of `payout.inputs`
 * @param {string} [currency]  the reconciliation's currency, when the line
 *   carries none of its own. Never defaulted to a guess: an amount with no
 *   denomination says so rather than borrowing USD.
 * @returns {string|null} null when the line carries too little to state anything
 */
export function describePayoutLineWorking(input, currency = null) {
  if (!input || typeof input !== "object") return null;
  const money = input.currency ?? currency ?? null;
  const days = daysClause(input);
  if (!days) return null;

  const parts = [days];
  if (real(input.hoursPerDay)) parts.push(`× ${input.hoursPerDay} hours per day`);
  if (Number.isInteger(input.hourlyRateInRemoteInteger)) {
    // The RATE, in the units the employee typed it in — never the ×100 integer,
    // which is an internal storage form and reads as a hundredfold error to
    // anybody who has not been told about it.
    const rate = fromRemoteInteger(input.hourlyRateInRemoteInteger).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    parts.push(`× ${rate}${money ? ` ${money}` : ""} per hour`);
  }
  if (Number.isInteger(input.payoutInRemoteInteger)) {
    parts.push(`= ${money ? formatMoney(input.payoutInRemoteInteger, money) : fromRemoteInteger(input.payoutInRemoteInteger).toFixed(2)}`);
  }
  // A single clause is not a derivation — it is the same figure again with a
  // label. Say nothing rather than dress a restatement up as working.
  if (parts.length < 2) return null;

  const type = typeof input.timeOffType === "string" && input.timeOffType.trim() ? input.timeOffType.trim() : null;
  return `${type ? `${type}: ` : ""}${parts.join(" ")}`;
}

/**
 * Every line's working, in the order they were reconciled.
 * @param {object|null} payout  a reconcilePtoPayout() result
 * @returns {string[]}
 */
export function describePayoutWorking(payout) {
  const inputs = Array.isArray(payout?.inputs) ? payout.inputs : [];
  return inputs.map((input) => describePayoutLineWorking(input, payout?.currency ?? null)).filter((s) => s !== null);
}

/**
 * WHERE THE DAYS CAME FROM, in words a person can act on — and it is a
 * different fact from what the reconciler's own `source` tag says.
 *
 * `payout.source` distinguishes "some balances" from "no balances" and from
 * "unusable balances". It says NOTHING about provenance, and the portal used to
 * render `time_off_records` as **"from the leave balances on record"** — a
 * phrase every reader takes to mean Remote's records, on figures the employee
 * had typed into a form seconds earlier. `workflow.js`'s `ptoSource` is the
 * field that actually answers this, and it has always been on the result.
 *
 * @param {string|null|undefined} ptoSource  one of PTO_SOURCE_* in ../uc05/workflow.js
 * @returns {string|null} null when nothing said where the days came from
 */
export function describePayoutProvenance(ptoSource) {
  const key = String(ptoSource ?? "").trim();
  if (!key) return null;
  switch (key) {
    case "caller_supplied":
      return "worked out from the holiday figures given on this request, not from Remote's records";
    case "remote_leave_policy_summary":
      return "worked out from the leave balances Remote holds for this employment";
    case "not_read":
      return "no holiday figures were given on this request, and Remote's leave records were not read";
    case "remote_leave_policy_summary_unreadable":
      return "Remote's leave records were asked for and could not be read — this is a failed read, not a finding that no leave is owed";
    default:
      // An unrecognised tag is printed as it is rather than dropped: a new
      // provenance should look unfinished, never invisible.
      return key;
  }
}

/**
 * The same provenance, phrased for the case where there is NO balance at all.
 *
 * WHY IT CANNOT BE THE SAME SENTENCE. `describePayoutProvenance()` says how a
 * figure was arrived at, and every one of its phrasings presumes a figure —
 * "worked out from the leave balances Remote holds" reads as a contradiction
 * directly after "no figure is shown". The FACT being reported here is a
 * different one: not where the days came from, but which of the two silences
 * this is. Those are genuinely different, and only one of them is about the
 * employee:
 *
 *   - Remote's leave records were READ and hold nothing. A fact about the
 *     employment record — though still not a finding that no holiday is owed:
 *     an employment with no leave POLICY on file is not an employee with a
 *     zero BALANCE, and conflating the two is how `0.00 EUR` came to be printed.
 *   - Nothing was supplied and nothing was read. A fact about this request, and
 *     about nobody.
 *
 * @param {string|null|undefined} ptoSource
 * @returns {string|null}
 */
export function describeNoBalanceProvenance(ptoSource) {
  const key = String(ptoSource ?? "").trim();
  switch (key) {
    case "remote_leave_policy_summary":
      return "Remote's leave records were read for this employment and hold no leave balance to settle";
    case "caller_supplied":
    case "not_read":
      return "no holiday figures were given on this request, and no balance was read from Remote's leave records";
    case "":
      return null;
    default:
      return describePayoutProvenance(key);
  }
}

/**
 * The same question answered from the STORED reconciliation alone.
 *
 * WHY A SECOND ROUTE TO ONE FACT. `workflow.js` returns `ptoSource` on the
 * result and records it on the audit row, and that is the authoritative
 * statement — but it is not a column on `uc05_resignations`, so a surface
 * reading the row back days later (the signed-off report) does not have it. The
 * reconciler stamps `daysSource` on every usable line and `source` on every
 * refused one for exactly this reason: *"a settlement document that does not say
 * which is a document nobody can check"* (ptoPayout.js).
 *
 * IT IS DELIBERATELY NOT A GUESS. Only two answers are ever returned:
 * `remote_leave_policy_summary` when a line SAYS it came from Remote, and
 * `caller_supplied` when there are lines and none of them says so — which is
 * the only other way a line can exist, because `readTimeOffBalances()` tags
 * every Remote-read balance. An empty or unusable reconciliation returns null
 * rather than inventing a provenance for figures that do not exist.
 *
 * @param {object|null} payout
 * @returns {string|null} a PTO_SOURCE_* value, or null when nothing can be said
 */
export function payoutProvenanceFromPayout(payout) {
  const lines = Array.isArray(payout?.lines) ? payout.lines : [];
  const unusable = Array.isArray(payout?.unusableLines) ? payout.unusableLines : [];
  const stamped = [...lines.map((l) => l?.daysSource), ...unusable.map((l) => l?.source)].filter(
    (s) => typeof s === "string" && s.trim()
  );
  if (stamped.includes("remote_leave_policy_summary")) return "remote_leave_policy_summary";
  if (lines.length > 0 || unusable.length > 0) return "caller_supplied";
  return null;
}

/**
 * The refusal, said to the person whose settlement it is.
 *
 * `unusable_time_off_records: vacation — missing hourlyRateInRemoteInteger` was
 * rendered verbatim to a resigning employee. A database column name is not an
 * error message: it names no action, and the one action it hints at — go and
 * fetch this field from somewhere — is impossible, because Remote publishes no
 * hourly or daily rate on any endpoint (see ptoPayout.js's header). The
 * sentences below name the missing thing in the words the form asks for it in,
 * and say who supplies it.
 *
 * @param {Array<{timeOffType:string|null, missing:string[], reason:string|null}>} unusableLines
 * @returns {string[]} one sentence per refused line
 */
export function describeUnusablePayoutLines(unusableLines) {
  const lines = Array.isArray(unusableLines) ? unusableLines : [];
  return lines.map((line) => {
    const type = typeof line?.timeOffType === "string" && line.timeOffType.trim() ? line.timeOffType.trim() : "this balance";
    const missing = Array.isArray(line?.missing) ? line.missing : [];
    const said = missing.map(MISSING_FIELD_WORDS).filter(Boolean);
    if (said.length === 0) return `${type}: the balance could not be used, and nothing recorded which part of it was the problem.`;
    return `${type}: ${said.join("; ")}`;
  });
}

/**
 * One missing field, in the vocabulary of the form the figure is typed into.
 *
 * The names on the left are `unusableFields()`'s in ptoPayout.js. They are the
 * right names in an audit row and the wrong ones on a screen, so the mapping
 * lives here rather than the raw slug being printed anywhere a person reads.
 * A field this table has not been told about falls through to a mechanical
 * de-slugging — visibly unfinished, never silently dropped.
 */
function MISSING_FIELD_WORDS(field) {
  switch (field) {
    case "hourlyRateInRemoteInteger":
      return "no hourly rate was given, so there is nothing to multiply the days by. Remote does not publish a pay rate on any endpoint, so this has to come from the contract — it is not something a further look at Remote can answer";
    case "daysAccrued":
      return "the days accrued could not be read as a number of days";
    case "daysUsed":
      return "the days already taken could not be read as a number of days";
    case "daysAvailable":
      return "no usable remaining balance was available for this leave type";
    case "balance":
      return "the balance was not in a shape this system could read at all";
    default:
      return String(field ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim().toLowerCase() || null;
  }
}
