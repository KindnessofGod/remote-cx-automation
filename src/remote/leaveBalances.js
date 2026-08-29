// ---------------------------------------------------------------------------
// leaveBalances.js  —  Remote's Time Off API, mapped onto UC-05's payout input
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `docs/use-cases/UC-05.md` §7 promises "accrued PTO payout reconciliation
// from Time Off API". Until this file, nothing in `src/` called a time-off
// endpoint at all — `grep -rn "leave-policies\|timeoff-balances" src/` returned
// no consumer — so the days that reached `reconcilePtoPayout()` were whatever
// the requester typed into a form, on a document an employee signs at the end
// of their employment. That is the same defect class as F-27 and F-33 rotated
// once more: not a wrong value, a value with no source.
//
// THE ENDPOINT
//   GET /v1/leave-policies/summary/{employment_id}
// Remote's index calls it *"List all the data related to time off for a given
// employment"*. `GET /v1/timeoff-balances/{employment_id}` returns the same
// numbers under different names and is marked **deprecated since February 2025
// in favour of** this one, so this is the endpoint to build on. Both were read
// live on 2026-08-19 and agree field for field (see the arithmetic note below).
//
// THE REAL PAYLOAD, [CONFIRMED] live 2026-08-19 against
// gateway.remote-sandbox.com. The array sits DIRECTLY under `data` — there is
// no `leave_policies` key, no `summary` key:
//
//   {"data": [{
//      "leave_policy": {"name": "Paid time off", "unit": "days",
//                       "description": null, "leave_type": "paid_time_off"},
//      "annual_entitlement":  {"type": "limited", "hours": 0, "days": 30},
//      "current_entitlement": {"type": "limited", "hours": 6, "days": 18},
//      "used":                {"type": "limited", "hours": 0, "days": 5},
//      "taken":               {"type": "limited", "hours": 0, "days": 5},
//      "balance":             {"type": "limited", "hours": 6, "days": 13},
//      "annual_balance":      {"type": "limited", "hours": 0, "days": 25},
//      "booked":              {"type": "limited", "hours": 0, "days": 0},
//      "pending_approval":    {"type": "limited", "hours": 0, "days": 0},
//      "upcoming_requested":  {"type": "limited", "hours": 0, "days": 0},
//      "upcoming_approved":   {"type": "limited", "hours": 0, "days": 0},
//      "working_hours_per_day": 8
//   }]}
//
// TWO THINGS IN THAT PAYLOAD ARE EASY TO GET WRONG, AND BOTH COST MONEY.
//
// 1. `balance` IS NOT `annual_entitlement − used`. A handoff note into this
//    work asserted that it was, and that feeding it to `daysAccrued` would send
//    a negative into the reconciler. Checked against every leave policy on all
//    112 Sandbox employments rather than inherited: the figure equal to
//    `annual_entitlement − used` is **`annual_balance`** (116 of 117 policies;
//    the exception is the unlimited record, where the subtraction is not
//    defined). `balance` is the ACCRUED-TO-DATE remaining figure —
//    `current_entitlement − used` on 108 of 117, and larger still on the other
//    9 (a carried-over balance the API does not decompose). The record quoted
//    above is the whole argument in one row: annual entitlement 30, used 5, `annual_balance` 25 —
//    and `balance` 13d 6h, because only 18d 6h has accrued so far this year.
//    The deprecated endpoint corroborates it under the name `remaining`.
//
//    A final settlement pays the accrued and untaken balance, not the full
//    year's entitlement, so `balance` is the figure — and it is READ, never
//    recomputed here. Re-deriving it as `annual_entitlement − used` would have
//    paid that employee 25 days instead of 13.75: an 11.25-day overpayment
//    produced by arithmetic that looks like a reconciliation.
//
// 2. `days` AND `hours` ARE COMPONENTS OF ONE QUANTITY, NOT ALTERNATIVES.
//    `{days: 13, hours: 6}` is thirteen days AND six hours, i.e. 13.75 days at
//    the `working_hours_per_day: 8` the same row supplies. Reading `days` alone
//    silently discards the remainder and underpays — and it underpays quietly,
//    because 13 is a perfectly plausible number. `working_hours_per_day` comes
//    from Remote, so the conversion invents nothing; where it is absent AND an
//    hours remainder exists, the line is refused rather than truncated. Live,
//    24 of the 117 policies carry a non-zero `hours` remainder on `balance`,
//    and all 112 employments report `working_hours_per_day: 8` — which is
//    exactly why it must not be hard-coded to 8: a value that has never varied
//    in the data you happen to hold is the easiest wrong constant to adopt.
//
// 3. `leave_policy.unit` IS NOT ALWAYS `"days"`. Live it reads `"hours"` on 4
//    policies (the Italian `ex_festivita` and `rol` entitlements). It changes
//    nothing here — those rows still express `balance` as a `{days, hours}`
//    pair, e.g. `{days: 1, hours: 5}` = 1.625 days at 8 hours a day — but a
//    consumer that branched on `unit` would find two shapes where there is
//    one. It is carried through as `unit` for display; nothing keys off it.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PRODUCE: A RATE.
// There is no hourly (or daily) rate anywhere in this payload, and none in any
// other Remote endpoint this repo has found. `contract_details` carries
// `annual_gross_salary`, and turning that into a rate needs a weeks-per-year
// and a working-days-per-year figure Remote does not state — plus a
// jurisdictional rule about which base a leave payout is computed on. So a line
// leaves this file with days and NO `hourlyRateInRemoteInteger`, and
// `reconcilePtoPayout()` refuses it by name. That refusal is the honest answer
// and it is the whole point: an assumed 40-hour week would produce a confident
// money figure on a document an employee signs, derived from a number nobody
// supplied. See `unavailable`/`whyNoRate` below for the words the specialist
// actually reads.
//
// Live per-country evidence for that, gathered rather than assumed
// (2026-08-19): `work_hours_per_week` is `40` (a number) on the NL record, the
// STRING `"40"` on the CA record, ABSENT on the US record, and the PT
// contractor's `contract_details` is `{}` entirely. Three shapes and an absence
// for one field, across four countries — which is exactly why deriving a rate
// from it would be a per-country guess wearing a formula.
// ---------------------------------------------------------------------------

/** Every line this file produces is tagged with where it came from. */
export const LEAVE_BALANCE_SOURCE = "remote_leave_policy_summary";

/**
 * Why a line has no `daysAvailable`. These strings reach the specialist through
 * `reconcilePtoPayout()`'s `unusableLines[].reason`, so they name a cause, not
 * a symptom.
 */
export const UNAVAILABLE_UNLIMITED = "unlimited_balance";
export const UNAVAILABLE_NO_DAYS = "balance_days_missing";
export const UNAVAILABLE_NO_HOURS_PER_DAY = "working_hours_per_day_missing";

/**
 * One Remote quantity object -> a day count, or a named refusal.
 *
 * `{type: "unlimited"}` WITH NO `days` KEY IS A SHAPE THIS HANDLES AND HAS
 * NEVER SEEN. All 46 live policies read `type: "limited"`, but the field would
 * not exist if `limited` were the only value it takes, and an unlimited policy
 * genuinely has no number to pay out. Handling the shape costs one branch;
 * inventing a fixture that exhibits it would be putting a payload into this
 * repo that Remote has never sent — the mistake the countries fixture was
 * rewritten to undo. So the branch exists and is tested with an explicit
 * literal, and no unlimited row is added to the mock.
 *
 * @param {unknown} quantity              a `{type, days, hours}` object
 * @param {unknown} workingHoursPerDay    the row's own `working_hours_per_day`
 * @returns {{days: number|null, unavailable: string|null}}
 */
export function quantityToDays(quantity, workingHoursPerDay) {
  if (!quantity || typeof quantity !== "object") {
    return { days: null, unavailable: UNAVAILABLE_NO_DAYS };
  }
  if (typeof quantity.type === "string" && quantity.type !== "limited") {
    // "unlimited" — and anything else Remote may add later. A quantity whose
    // own type says it is not a limited number is not a number we may total.
    return { days: null, unavailable: UNAVAILABLE_UNLIMITED };
  }

  const days = Number(quantity.days);
  if (quantity.days === null || quantity.days === undefined || !Number.isFinite(days)) {
    return { days: null, unavailable: UNAVAILABLE_NO_DAYS };
  }

  const hours = Number(quantity.hours);
  const hasHours = quantity.hours !== null && quantity.hours !== undefined && Number.isFinite(hours) && hours !== 0;
  if (!hasHours) return { days, unavailable: null };

  const hpd = Number(workingHoursPerDay);
  if (!Number.isFinite(hpd) || hpd <= 0) {
    // The remainder is real and unconvertible. Truncating to whole days here is
    // the silent underpayment this file exists to refuse.
    return { days: null, unavailable: UNAVAILABLE_NO_HOURS_PER_DAY };
  }
  return { days: days + hours / hpd, unavailable: null };
}

/**
 * The live `GET /v1/leave-policies/summary/{id}` body -> the balance lines
 * `reconcilePtoPayout()` consumes.
 *
 * NOT FILTERED BY LEAVE TYPE. Live the Sandbox serves `paid_time_off` and
 * `time_off` policies; which of a jurisdiction's leave types are payable on
 * termination is a statutory question this repo does not hold an answer to, and
 * silently dropping a policy would understate a settlement as confidently as
 * inventing one would overstate it. Every policy Remote returns is carried
 * through with its own name and type so the specialist decides.
 *
 * @param {unknown} raw  the array `#get()` yields after unwrapping `data`
 * @param {{hourlyRateInRemoteInteger?: number|null}} [options]
 *   `hourlyRateInRemoteInteger` is attached to every line when — and only when
 *   — a caller supplies one. It never originates here; see the file header.
 * @returns {Array<object>|null}  null when the payload could not be read at all
 *   (a 404 from the client, or a shape this endpoint does not send). Null is
 *   NOT an empty balance list: "this employee has no leave policies" and "we
 *   never read their leave policies" are opposite facts, and the second must
 *   not be reported as the first.
 */
export function normalizeLeaveBalances(raw, { hourlyRateInRemoteInteger = null } = {}) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.leave_policies) ? raw.leave_policies : null;
  if (!list) return null;

  return list.map((row) => {
    const policy = (row && row.leave_policy) || {};
    const hpdRaw = row ? row.working_hours_per_day : null;
    const workingHoursPerDay = Number.isFinite(Number(hpdRaw)) && Number(hpdRaw) > 0 ? Number(hpdRaw) : null;

    // AN UNLIMITED POLICY IS REFUSED ON ITS ENTITLEMENT, NOT ONLY ON ITS
    // BALANCE — and this is not a hypothetical. Live employment 7b769e51 is an
    // unlimited-PTO employee: `annual_entitlement` and `annual_balance` are
    // `{type: "unlimited"}` with NO `days` key, while `balance`, `used` and
    // `current_entitlement` are ordinary `limited` zeroes. Reading `balance`
    // alone therefore yields a perfectly computable **0.00 payout** on a policy
    // where "how many days are owed" is not a question the data answers — the
    // F-28/F-33 shape exactly, an unknown coerced into a real quantity so that
    // nothing errors and a human signs off a figure nobody derived. Whether an
    // unlimited scheme pays out on termination is a statutory question this
    // repo does not hold, which is precisely why it must be asked rather than
    // answered with a zero.
    const entitlement = quantityToDays(row ? row.annual_entitlement : null, hpdRaw);
    const balanceOnly = quantityToDays(row ? row.balance : null, hpdRaw);
    const balance =
      entitlement.unavailable === UNAVAILABLE_UNLIMITED
        ? { days: null, unavailable: UNAVAILABLE_UNLIMITED }
        : balanceOnly;

    /** Context figures. Reported, never used as the payout base — see header. */
    const reported = {
      balanceDays: readDays(row, "balance"),
      balanceHours: readHours(row, "balance"),
      usedDays: readDays(row, "used"),
      takenDays: readDays(row, "taken"),
      currentEntitlementDays: readDays(row, "current_entitlement"),
      annualEntitlementDays: readDays(row, "annual_entitlement"),
      annualBalanceDays: readDays(row, "annual_balance"),
    };

    const line = {
      // `leave_type` is the stable machine name (`paid_time_off`); `name` is the
      // display label and is localised live ("Congés N" on the French records),
      // so it must not be the identity of the line.
      timeOffType: typeof policy.leave_type === "string" && policy.leave_type ? policy.leave_type : "unknown",
      policyName: typeof policy.name === "string" ? policy.name : null,
      unit: typeof policy.unit === "string" ? policy.unit : null,
      balanceType: row && row.balance && typeof row.balance.type === "string" ? row.balance.type : null,
      workingHoursPerDay,
      // THE PAYOUT BASE, READ FROM REMOTE AND NOT RECOMPUTED. `daysAvailable`
      // is a first-class input to reconcilePtoPayout() precisely so this file
      // does not have to express Remote's own netted figure as a fake
      // accrued/used pair — which would have printed "used 0" beside a record
      // where Remote says 5.
      daysAvailable: balance.days,
      unavailable: balance.unavailable,
      reportedByRemote: reported,
      source: LEAVE_BALANCE_SOURCE,
    };

    if (Number.isInteger(hourlyRateInRemoteInteger)) {
      line.hourlyRateInRemoteInteger = hourlyRateInRemoteInteger;
    }
    return line;
  });
}

function readQuantity(row, key) {
  if (!row || typeof row !== "object") return null;
  const q = row[key];
  return q && typeof q === "object" ? q : null;
}

function readDays(row, key) {
  const q = readQuantity(row, key);
  const n = q ? Number(q.days) : NaN;
  return Number.isFinite(n) ? n : null;
}

function readHours(row, key) {
  const q = readQuantity(row, key);
  const n = q ? Number(q.hours) : NaN;
  return Number.isFinite(n) ? n : null;
}
