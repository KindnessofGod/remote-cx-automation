// ---------------------------------------------------------------------------
// employmentFacts.js — reading a fact off an employment record, once
// ---------------------------------------------------------------------------
// Two shapes reach every reader in this repo and they are not alike:
//
//   the LIVE shape  — `GET /v1/employments/{id}`, which nests money and hours
//                     under `contract_details` (`annual_gross_salary`,
//                     `compensation_currency_code`, `work_hours_per_week`,
//                     `contract_duration_type`, `contract_end_date`)
//   the MOCK shape  — src/remote/mockServer.js's flat fixtures, passed through
//                     by normalizeEmployment() as `base_salary`, `currency`,
//                     `weekly_hours`
//
// `readAnnualGrossSalary()` began life inside `src/uc03/letter.js`, where it was
// written to close a defect worth restating because it is the reason this file
// exists: UC-03's travel letter printed `employment.base_salary`, which
// normalizeEmployment() has NEVER produced for a live record — so the row
// rendered perfectly against fixtures and could not render at all in
// production, while a test asserting its presence passed for the project's
// whole life. A per-use-case copy of "how do I read a salary" is one fixture
// away from repeating that, so the readers live here and the callers import.
//
// EVERY READER IN THIS FILE RETURNS null RATHER THAN A GUESS. That is the same
// shape-assert-or-null discipline `pickAlpha2()` uses in the REST client and it
// is chosen for the same reason: a missing value gets investigated, a wrong one
// gets acted on. It matters more here than almost anywhere else, because these
// values are bound for a customer-facing letter that a bank, a landlord or an
// immigration officer will read.
// ---------------------------------------------------------------------------

import { parseRemoteMinorUnits } from "./money.js";

/**
 * The annual gross salary, in MINOR UNITS, with its currency — or null.
 *
 * THE SCALE IS SETTLED and is not a guess: `annual_gross_salary` is ×100.
 * [CONFIRMED] Remote types the same field on its cost calculator as *"The
 * annual gross salary in the region's local currency, in cents"*
 * (`developer.remote.com/reference/post_v1_cost-calculator_estimation.md`,
 * HTTP 200, fetched 2026-08-20), and the live contract-amendment captures agree.
 *
 * NOT `contract_details.payment_terms.compensation_gross_amount`. That is the
 * CONTRACTOR's per-period rate — a different fact whose scale remains [UNKNOWN]
 * because it appears in no public reference page. Nothing in `src/` reads it,
 * deliberately, and this function is not the place to start.
 *
 * NO CURRENCY DEFAULT. An earlier version fell back to `"USD"`. A salary
 * printed in the wrong currency is exactly as wrong as one printed at the wrong
 * scale, so an unusable currency code yields nothing at all.
 *
 * The live shape is tried FIRST, so a record carrying both is read the way
 * Remote describes it.
 *
 * @param {object|null} employment
 * @returns {{minorUnits: number, currency: string}|null}
 */
export function readAnnualGrossSalary(employment) {
  const contractDetails = employment?.contract_details ?? null;
  const candidates = [
    [contractDetails?.annual_gross_salary, contractDetails?.compensation_currency_code],
    [employment?.base_salary, employment?.currency],
  ];
  for (const [amount, currency] of candidates) {
    // Not `typeof === "number"`: this API sends money as a quoted string on at
    // least one endpoint, and parseRemoteMinorUnits() is the one place that
    // knows which strings are a number and which are an invention.
    const minorUnits = parseRemoteMinorUnits(amount);
    if (minorUnits === null) continue;
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) continue;
    return { minorUnits, currency: currency.toUpperCase() };
  }
  return null;
}

/**
 * Contracted hours per week, as a number — or null.
 *
 * A bare number and not a sentence, so the caller decides how to say it. Zero
 * is rejected along with everything else non-positive: a contracted week of no
 * hours is not a fact this repo is willing to put on a letter, and a record
 * carrying it is far likelier to be empty than to be true.
 *
 * @param {object|null} employment
 * @returns {number|null}
 */
export function readWeeklyHours(employment) {
  const candidates = [employment?.contract_details?.work_hours_per_week, employment?.weekly_hours];
  for (const raw of candidates) {
    const hours = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) continue;
    return hours;
  }
  return null;
}

/**
 * When the contract ends — and, just as usefully, that it does not.
 *
 * THREE ANSWERS, NOT TWO, and collapsing them is the whole risk here. "Ends
 * 2027-03-31", "does not end, it is indefinite" and "we do not know" are
 * different sentences, and only the third may ever be shown as an absence. A
 * letter that omits the row because the duration type was unreadable, sitting
 * beside a letter that omits it because the contract is permanent, teaches its
 * reader that omission means permanent — which is exactly the inference a
 * mortgage underwriter would draw and exactly the one this system must not
 * invite.
 *
 * @param {object|null} employment
 * @returns {{kind: "fixed", date: string} | {kind: "indefinite"} | null}
 */
export function readContractEnd(employment) {
  const details = employment?.contract_details ?? null;
  const date = details?.contract_end_date ?? employment?.contract_end_date ?? null;
  if (typeof date === "string" && date.trim() !== "") return { kind: "fixed", date: date.trim() };

  const duration = details?.contract_duration_type ?? employment?.contract_duration_type ?? null;
  // Only an explicit statement counts. An absent duration type with an absent
  // end date is silence, not permanence.
  if (typeof duration === "string" && /indefinite|permanent|open[_ -]?ended/i.test(duration)) {
    return { kind: "indefinite" };
  }
  return null;
}
