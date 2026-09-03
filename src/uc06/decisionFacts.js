// ---------------------------------------------------------------------------
// decisionFacts.js  —  What each of UC-06's TWO approvers is deciding on
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// C-27 / pattern P7 (docs/CORRECTIONS-LOG.md), generalised to the medium tier.
// UC-06's API view carried `{amendment, tier, actionable, actionableReason}` and
// nothing else — no deciding gate, no ladder, and none of the figures the
// decision was made from. `cutoff_lock_passed` was the entire message about a
// payroll lock whose exact instant, whose cycle, and whose distance from the
// requested effective date were all sitting on the row. Same defect as "above
// the policy cap" with the amount withheld, in the one use case where the cost
// of getting it wrong is somebody's pay.
//
// THE THING THAT MAKES UC-06 DIFFERENT FROM UC-04 AND UC-05: THERE ARE TWO
// DECIDERS AND THEY ARE NOT DECIDING THE SAME THING.
//
//   The CUSTOMER ADMIN is deciding about the CONTRACT: is this the right change,
//   to the right person, from the right old value to the right new one, taking
//   effect on the right day? Their facts are the diff, the delta, the effective
//   date, and whether the country's own amendment form can express it.
//
//   The REMOTE PAYROLL SPECIALIST is deciding about EXECUTION: can payroll carry
//   this on that date, and if not, what happens instead? Their facts are the
//   governing cycle, its period, its lock instant, how long is left before it,
//   and — when the calendar is ambiguous — which cycles disagree and by how much.
//
// Handing both people one undifferentiated blob is a different failure from
// handing them nothing, but it is a failure: each has to find their own half,
// and the half that is not theirs reads as noise. So `roles` names each decider,
// what they are deciding, and the ordered facts THAT decision turns on. Nothing
// is duplicated — the facts live once in `change` / `schema` / `payroll`, and
// each role's entry points at them.
//
// PURE, AND IT DECIDES NOTHING. Same contract as describeDecidingGate() /
// describeGateLadder() beside it, and as UC-04's and UC-05's decisionFacts.js:
// it describes a decision already made and already stored. No gate reads it, and
// dualApprovalPolicy.js does not consult it — whether either slot may be filled
// is still evaluateAmendmentActionability()'s answer alone.
//
// MONEY LEAVES HERE FORMATTED, NEVER RAW. `changes.salary.oldAmount` and
// `.newAmount` are HUMAN units (72000 means seventy-two thousand); the payload
// this system sends carries the same figure x100 (7200000). Both appear on the
// row, one field apart, and printing either without saying which is a 100x error
// in front of a person authorising a pay change. Every figure here goes through
// formatMoney() against the amount's own currency, and the payload's scaled form
// is reported as what will be SENT rather than as a second opinion about the
// amount.
//
// THE PERCENTAGE IS GUARDED, exactly as describeCapComparison() guards its own.
// An old salary of zero makes the ratio undefined — not 0%, not Infinity. The
// caller gets `percent: null` and a sentence that states the change in money
// only. Fabricating a percentage here would be the same manufactured value this
// repository has already paid for more than once.
// ---------------------------------------------------------------------------

import { formatMoney, toRemoteInteger } from "../shared/money.js";

/**
 * The two humans, and the DIFFERENT questions they answer.
 *
 * The order is the order UC-06.md §5 states ("Customer Admin approve → Payroll
 * specialist approve") and is not a ranking: neither slot alone executes
 * anything, and the store accepts them in either order.
 */
export const DECIDERS = Object.freeze([
  Object.freeze({
    role: "customer_admin",
    // THE LABEL IS THE EMPLOYER'S SIGNATORY; THE ROLE ID IS NOT RENAMED. See
    // src/remoteui/amendmentStatus.js's SLOTS note — `customer_admin` is a live
    // entitlement key and stays; the word a reader sees is the person meant.
    label: "Employer's signatory",
    decides:
      "whether this is the right change to this person's contract — the right old and new values, on the right effective date.",
  }),
  Object.freeze({
    role: "payroll_specialist",
    label: "Remote payroll specialist",
    decides:
      "whether payroll can actually carry this change on the date it is meant to take effect, and what the consequence is if the run's lock is close or past.",
  }),
]);

const isRealNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * A human amount rendered with its currency, or null.
 *
 * Goes the long way round on purpose: `formatMoney()` takes Remote's x100
 * integer, and these values are human units, so the conversion is explicit and
 * in one place rather than a `toFixed(2)` that quietly disagrees with every
 * other money string in the system. Anything that is not a finite number returns
 * null — this is a describer, and a value we cannot render is stated as absent,
 * never coerced.
 */
function money(humanAmount, currency) {
  if (!isRealNumber(humanAmount)) return null;
  return formatMoney(toRemoteInteger(humanAmount), currency || "USD");
}

/** "3 days 4 hours", "5 hours", "27 minutes" — a duration a person reads at a glance. */
function humanDuration(hours) {
  if (!isRealNumber(hours)) return null;
  const abs = Math.abs(hours);
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (abs < 1) return plural(Math.round(abs * 60), "minute");
  const days = Math.floor(abs / 24);
  const rem = Math.round(abs % 24);
  if (days === 0) return plural(Math.round(abs), "hour");
  return rem === 0 ? plural(days, "day") : `${plural(days, "day")} ${plural(rem, "hour")}`;
}

/**
 * The contract diff, field by field, with the delta on the money row.
 *
 * WHAT THE ADMIN COULD NOT SEE BEFORE. `amendmentType: "SALARY_DECREASE"` was on
 * the row and the two amounts were beside it, unrendered — so the person
 * approving a pay cut was told its DIRECTION and not its SIZE. The delta and the
 * percentage are both derived here from figures the row already holds; neither
 * is stored, because a derived figure persisted beside its inputs is a figure
 * that can disagree with them later.
 *
 * `writesAs` names the field on the country's own form that this change actually
 * lands in — `annual_gross_salary`, `job_title`, `work_hours_per_week`. It is
 * read out of the built payload rather than guessed, so it can never claim a
 * field the payload does not carry, and it is the one thing that connects "I
 * asked to change salary" to "the form Remote will receive says this".
 */
function changeBasis(row) {
  const changes = row.changes ?? {};
  const payload = row.payload ?? {};
  const fields = [];

  if (changes.salary) {
    const currency = changes.salary.currency ?? null;
    const from = changes.salary.oldAmount;
    const to = changes.salary.newAmount;
    const both = isRealNumber(from) && isRealNumber(to);
    const delta = both ? to - from : null;
    // GUARDED. A zero old salary makes the ratio undefined, not 0% and not
    // Infinity — see this file's header.
    const percent = both && from !== 0 ? Math.round((delta / from) * 1000) / 10 : null;
    const writesAs = ["annual_gross_salary", "base_salary"].find((k) => k in payload) ?? null;
    fields.push({
      field: "salary",
      label: "Annual salary",
      from: money(from, currency),
      to: money(to, currency),
      delta: delta === null ? null : `${delta >= 0 ? "+" : "-"}${money(Math.abs(delta), currency)}`,
      percent,
      currency,
      writesAs,
      // The x100 form that will actually be SENT, stated as such. A reader who
      // sees only 7200000 elsewhere in the record has no way to know it is not a
      // different, hundredfold number.
      writesValue: writesAs && isRealNumber(payload[writesAs]) ? payload[writesAs] : null,
      sentence: !both
        ? "A salary change was requested but at least one of the two amounts is not a usable number, so no comparison is stated."
        : `${money(from, currency)} to ${money(to, currency)}` +
          ` — ${delta >= 0 ? "an increase" : "a decrease"} of ${money(Math.abs(delta), currency)}` +
          (percent === null
            ? " (the current salary is zero, so a percentage is undefined)."
            : ` (${Math.abs(percent)}%).`),
    });
  }

  if (changes.jobTitle) {
    const from = changes.jobTitle.oldValue ?? null;
    const to = changes.jobTitle.newValue ?? null;
    fields.push({
      field: "jobTitle",
      label: "Job title",
      from,
      to,
      delta: null,
      percent: null,
      currency: null,
      writesAs: "job_title" in payload ? "job_title" : null,
      writesValue: "job_title" in payload ? payload.job_title : null,
      sentence: to ? `"${from ?? "not stated"}" to "${to}".` : "A job-title change was requested with no new title stated.",
    });
  }

  if (changes.weeklyHours) {
    const from = changes.weeklyHours.oldValue;
    const to = changes.weeklyHours.newValue;
    const both = isRealNumber(Number(from)) && isRealNumber(Number(to));
    const delta = both ? Number(to) - Number(from) : null;
    const writesAs = ["work_hours_per_week", "weekly_hours"].find((k) => k in payload) ?? null;
    fields.push({
      field: "weeklyHours",
      label: "Weekly hours",
      from: from ?? null,
      to: to ?? null,
      delta,
      percent: null,
      currency: null,
      writesAs,
      writesValue: writesAs ? payload[writesAs] ?? null : null,
      sentence: both
        ? `${from} to ${to} hours a week — ${delta >= 0 ? "an increase" : "a reduction"} of ${Math.abs(delta)}.`
        : "An hours change was requested but at least one of the two values is not a usable number.",
    });
  }

  return {
    amendmentType: row.amendmentType ?? null,
    requestedEffectiveDate: row.requestedEffectiveDate ?? null,
    fields,
    // No recognised change at all is worth saying out loud rather than rendering
    // an empty list somebody reads as "nothing much changed".
    sentence: fields.length
      ? fields.map((f) => f.sentence).join(" ")
      : "No recognised contract change is recorded on this amendment.",
  };
}

/**
 * Whether the country's own amendment form can carry this change, and what it
 * said if not.
 *
 * The three refusals this reports are routinely mistaken for each other, and
 * they need three different people: `change_not_expressible` is a form that has
 * no field for what was asked (nobody can fix that by filling something in);
 * `schema_invalid` is a field the form requires and the record does not supply
 * (somebody can); `change_value_underivable` is the requester having stated no
 * usable value (the requester can). The flags already encode which fields are
 * involved — `missing_<f>`, `unexpressible_<key>`, `underivable_<f>` — and they
 * are decoded here rather than shown as slugs.
 */
function schemaBasis(row) {
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const decode = (prefix) =>
    flags.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));

  const missing = decode("missing_");
  const unexpressible = decode("unexpressible_");
  const underivable = decode("underivable_").map((f) => f.replace("_", "."));
  const unavailable = flags.includes("country_schema_unavailable");

  // THE CHECK THAT NEVER RAN MUST NOT READ AS THE CHECK THAT PASSED — the same
  // `not_reached` / `passed` distinction describeGateLadder() draws, at the
  // level of the facts rather than the gates. evaluate() returns no `payload`
  // at all until it reaches the form gate, so identity and employment-status
  // refusals (and the upstream-read failures ahead of them) arrive here with
  // nothing built. Falling through to the success sentence would have told the
  // admin the country's form was satisfied by a payload that was never
  // constructed, about a record that was never fetched.
  if (!row.payload) {
    return {
      state: "not_assessed",
      formRead: false,
      missingFields: [],
      unexpressibleChanges: [],
      underivableValues: [],
      payloadFields: [],
      sentence:
        "The country's amendment form was never consulted — an earlier gate decided this amendment before any payload was built. Nothing here says the change is valid or invalid.",
    };
  }

  let sentence;
  if (unavailable) {
    sentence =
      "The country's amendment form could not be read at all, so nothing was validated. An unread form is NOT an empty one — treating it as having no requirements would let any payload through.";
  } else if (unexpressible.length) {
    sentence = `This country's amendment form has no field for: ${unexpressible.join(", ")}. The change cannot be submitted through this form at all — it is not a matter of supplying more detail.`;
  } else if (underivable.length) {
    sentence = `No usable value was stated for: ${underivable.join(", ")}. The requester has to supply it before anything can be validated.`;
  } else if (missing.length) {
    sentence = `The record this amendment would produce is missing ${missing.length} field${missing.length === 1 ? "" : "s"} the country's form requires: ${missing.join(", ")}.`;
  } else {
    sentence =
      "The complete next-state record satisfies everything the country's form requires, including the conditional rules that apply to this particular payload.";
  }

  return {
    state: unavailable
      ? "form_unavailable"
      : unexpressible.length
        ? "not_expressible"
        : underivable.length
          ? "value_missing"
          : missing.length
            ? "invalid"
            : "valid",
    formRead: !unavailable,
    missingFields: missing,
    unexpressibleChanges: unexpressible,
    underivableValues: underivable,
    // The keys actually written, so a reader can see the shape that would be
    // sent rather than take it on trust. Values are deliberately NOT dumped —
    // the money ones are scaled and belong on the change rows above, where they
    // are labelled.
    payloadFields: row.payload && typeof row.payload === "object" ? Object.keys(row.payload).sort() : [],
    sentence,
  };
}

/**
 * The payroll calendar, in the terms the specialist actually decides on.
 *
 * EVERY STATE HERE USED TO BE A BARE SLUG. "cutoff_lock_passed" does not say
 * which cycle, when it locked, how long ago, or what the requested effective
 * date was — and every one of those is on `row.cutoff`. "ambiguous_payroll_cycle"
 * is worse: it says two cycles disagree without naming them or their locks, so
 * the one person who could settle it is told only that it needs settling.
 *
 * `hoursUntilCutoff` is a signed float; it is rendered as a direction and a
 * duration, never as a raw number, because "-137.4" is not a fact anybody acts
 * on. It is `null` whenever the lock could not be read, and that stays null —
 * an unreadable lock is the one case where a confident-looking runway would be
 * derived from no information at all.
 */
function payrollBasis(row) {
  const cutoff = row.cutoff ?? null;
  const effective = row.requestedEffectiveDate ?? null;

  if (!cutoff) {
    return {
      state: "not_assessed",
      cycle: null,
      hoursUntilCutoff: null,
      timeToLock: null,
      requestedEffectiveDate: effective,
      candidates: [],
      sentence:
        "The payroll calendar was never consulted — an earlier gate decided this amendment before it got that far.",
    };
  }

  const c = cutoff.cycle ?? null;
  const cycle = c
    ? {
        id: c.id ?? null,
        type: c.type ?? null,
        status: c.status ?? null,
        periodStart: c.period_start ?? null,
        periodEnd: c.period_end ?? null,
        cutoffAt: c.cutoff_date ?? null,
        payDate: c.pay_date ?? null,
        // A projected cycle is not a real one. The stand-in mints ids beginning
        // `standin-` when the Sandbox's calendar has stopped; saying so is the
        // difference between a specialist checking a real lock and checking a
        // continuation of an observed cadence.
        projected: typeof c.id === "string" && c.id.startsWith("standin-"),
      }
    : null;

  const hours = isRealNumber(cutoff.hoursUntilCutoff) ? cutoff.hoursUntilCutoff : null;
  const timeToLock = humanDuration(hours);
  // THE LOCK INSTANT, STATED. Remote's `cutoff_date` is a calendar day; the
  // engine reads it as 00:00 UTC at the START of that day — the conservative
  // reading, since every hour of the cutoff day is then already past the lock.
  // No screen said which reading was taken (2026-09-02, expert review D5); the
  // sentence below does whenever the lock is date-only.
  const lockIsDateOnly = typeof cycle?.cutoffAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cycle.cutoffAt);
  const lockReading = lockIsDateOnly
    ? " The lock is read as 00:00 UTC at the start of that day — the whole cutoff day counts as after the lock."
    : "";
  const candidates = Array.isArray(cutoff.ambiguousCycles)
    ? cutoff.ambiguousCycles.map((a) => ({
        id: a.id ?? null,
        type: a.type ?? null,
        status: a.status ?? null,
        cutoffAt: a.cutoff_date ?? null,
      }))
    : [];

  if (candidates.length) {
    const locks = [...new Set(candidates.map((a) => a.cutoffAt ?? "unreadable"))];
    return {
      state: "ambiguous",
      cycle: null,
      hoursUntilCutoff: null,
      timeToLock: null,
      requestedEffectiveDate: effective,
      candidates,
      sentence:
        `${candidates.length} payroll cycles cover ${effective ?? "the requested effective date"} and they lock at different times (${locks.join(" vs ")}). ` +
        "No cycle is recorded on this amendment on purpose — writing down one of them would put a coin-flip lock into the audit trail. Which of these governs a mid-period change has to be settled by a person.",
    };
  }

  if (cutoff.noMatchingCycle) {
    return {
      state: "no_cycle",
      cycle: null,
      hoursUntilCutoff: null,
      timeToLock: null,
      requestedEffectiveDate: effective,
      candidates: [],
      sentence: `No payroll cycle on record covers ${effective ?? "the requested effective date"}, so there is no run for this change to land in. Commonly this means the date is beyond the last published cycle rather than that the change itself is wrong.`,
    };
  }

  if (cutoff.cutoffUnknown) {
    return {
      state: "lock_unreadable",
      cycle,
      hoursUntilCutoff: null,
      timeToLock: null,
      requestedEffectiveDate: effective,
      candidates: [],
      sentence: `The cycle covering ${effective ?? "the requested effective date"}${cycle?.id ? ` (${cycle.id})` : ""} states a lock time that could not be read, so nothing can be said about whether this change makes the run. No runway is shown, because there is none to compute.`,
    };
  }

  if (cutoff.cutoffAlreadyPassed) {
    return {
      state: "locked",
      cycle,
      hoursUntilCutoff: hours,
      timeToLock,
      requestedEffectiveDate: effective,
      candidates: [],
      sentence:
        `The lock for the cycle covering ${effective ?? "the requested effective date"}${cycle?.id ? ` (${cycle.id})` : ""} closed at ${cycle?.cutoffAt ?? "an unstated time"}` +
        (timeToLock ? ` — ${timeToLock} ago` : "") +
        `. Applying the change now would be a retroactive correction against a period that has already been processed${cycle?.payDate ? `, paid on ${cycle.payDate}` : ""}.` +
        lockReading,
    };
  }

  const urgent = cutoff.urgentWithin48h === true;
  return {
    state: urgent ? "urgent" : "clear",
    cycle,
    hoursUntilCutoff: hours,
    timeToLock,
    requestedEffectiveDate: effective,
    candidates: [],
    sentence:
      `The cycle covering ${effective ?? "the requested effective date"}${cycle?.id ? ` (${cycle.id})` : ""} runs ${cycle?.periodStart ?? "?"} to ${cycle?.periodEnd ?? "?"} and locks at ${cycle?.cutoffAt ?? "an unstated time"}` +
      (timeToLock ? ` — ${timeToLock} from the moment this was assessed` : "") +
      (urgent
        ? ". That is inside the 48-hour urgent window, so both approvals have to be in before the lock or the change misses this run."
        : ".") +
      (cycle?.payDate ? ` Pay date ${cycle.payDate}.` : "") +
      lockReading +
      (cycle?.projected
        ? " NOTE: this cycle id begins `standin-`, meaning it is a PROJECTED continuation of the observed cadence rather than a cycle Remote published. Confirm it against the real calendar before relying on the lock time."
        : ""),
  };
}

/**
 * Everything the two approvers' decisions turn on, from the persisted row alone.
 *
 * @param {object} args
 * @param {object|null} args.amendmentRow  a `uc06_amendments` row
 * @returns {{
 *   deciders: typeof DECIDERS,
 *   change: object,
 *   schema: object,
 *   payroll: object,
 *   roles: Array<{role:string, label:string, decides:string, turnsOn:string[], headline:string}>
 * }|null}  null when there is no row to describe
 */
export function describeAmendmentBasis({ amendmentRow } = {}) {
  const row = amendmentRow;
  if (!row) return null;

  const change = changeBasis(row);
  const schema = schemaBasis(row);
  const payroll = payrollBasis(row);

  // EACH ROLE'S OWN ORDERED SHORTLIST. `turnsOn` names the facts above that
  // THIS decision depends on, deciding-factor first — not a second copy of them.
  // Splitting the shortlist rather than the data is what keeps the two views
  // from drifting apart: there is one payroll paragraph, and the admin simply is
  // not pointed at it.
  const roles = [
    {
      ...DECIDERS[0],
      turnsOn: ["change", "schema"],
      headline: change.sentence,
    },
    {
      ...DECIDERS[1],
      turnsOn: ["payroll", "change"],
      headline: payroll.sentence,
    },
  ];

  return { deciders: DECIDERS, change, schema, payroll, roles };
}
