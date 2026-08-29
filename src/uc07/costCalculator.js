// ---------------------------------------------------------------------------
// costCalculator.js  —  UC-07 employer cost estimate
// ---------------------------------------------------------------------------
// WHAT THE REAL ENDPOINT ACTUALLY IS — verified 2026-08-19 against Remote's own
// OpenAPI (`docs/REMOTE-API-INDEX.txt` → `https://developer.remote.com/reference/
// post_v1_cost-calculator_estimation.md`), because two things this file and
// docs/use-cases/UC-07.md §3 asserted as [CONFIRMED] were not:
//
//   [CONFIRMED] the path is `POST /v1/cost-calculator/estimation`. There is no
//     `/v1/cost-calculator/employment` anywhere in Remote's llms.txt — the
//     Cost Calculator tag lists exactly `estimation`, `estimation-csv`,
//     `estimation-pdf`, `countries` and `regions/{slug}/fields`.
//   [CONFIRMED] it is SYNCHRONOUS. Its only success response is `200`
//     (`CostCalculatorEstimateResponse`); there is no `202`, no job id, and no
//     retrieve endpoint to poll. The "async create → poll → retrieve" the spec
//     described was never Remote's shape. The lifecycle below is kept as a
//     LOCAL simulation seam only (see the `delay` note) and is no longer
//     described as the endpoint's behaviour.
//   [CONFIRMED] the salary input is `annual_gross_salary` — "The annual gross
//     salary in the region's local currency, IN CENTS", i.e. an ANNUAL figure
//     already ×100 (money.js). The response mirrors it back as
//     `annual_gross_salary` alongside a derived `monthly_gross_salary`
//     (12000000 → 1000000 in Remote's own example: monthly = annual / 12).
//
// THE DEFECT THAT FOUND: this module used to take `monthlySalaryRemoteInteger`
// and was fed `plan.salaryRemoteInteger` — the SAME value the visa-minimum gate
// compares against an annual statutory threshold, and the same value every
// fixture in this repo authors as an annual salary ("65000 EUR per year" ->
// 6500000). Reading an annual salary as a monthly one made every derived figure
// 12× too large: a €65,000/yr relocation reported a €7,800 *monthly* management
// fee, and a €72,000/yr employee's 15 liquidated PTO days came out at €49,090.91
// instead of €4,090.91. Both are numbers a Mobility specialist reads and acts
// on. The parameter is now named for its period, so a monthly figure cannot be
// passed silently: it is `annualGrossSalaryRemoteInteger`, matching Remote's own
// field name.
//
// WHAT IS STILL A SIMULATION, STATED PLAINLY: no live call is made. The real
// endpoint RETURNS `annual_management_fee` / `monthly_management_fee` computed
// by Remote; here the management fee is derived from a basis-point rate the
// CALLER supplies, because a rate this repo invented would be a fabricated
// number. The `delay` seam makes a poll latency injectable (a no-op keeps
// `npm test` instant) — retained because a future wiring may need to retry a
// slow call, not because Remote polls.
//
// HONESTY ABOUT THE NUMBERS (Build Pack Part 32): "Do not hard-code the exact
// transfer price. Remote Pricing / Quote should be the source of truth." So
// the one-off transfer fee is NEVER computed here — it arrives as an input
// (from a quote) and is reported `QUOTE_REQUIRED` when absent. The only values
// this module derives are (a) the monthly management fee at a given basis-point
// rate, and (b) the liquidated-PTO cashout passed in from transitionGate — both
// explicitly parameterised, never invented as legal/statutory fact.
// ---------------------------------------------------------------------------

import { fromRemoteInteger, formatMoney, toRemoteInteger } from "../shared/money.js";

const CALC = {
  RUNNING: "processing",
  READY: "ready",
};

async function noopDelay() {}

/**
 * Build the employer cost estimate. Returns the completed estimate plus the
 * number of attempts the (local, simulated) poll loop took.
 *
 * @param {object} args
 * @param {number} args.annualGrossSalaryRemoteInteger  ×100 (money.js) — the destination
 *   ANNUAL gross salary, the same period and scaling as Remote's own
 *   `annual_gross_salary` ("in cents"). Monthly figures below are DERIVED from
 *   it (÷12), never passed in; see this file's header for the 12× defect that
 *   naming this parameter for its period closed.
 * @param {string} args.currency                     e.g. "EUR"
 * @param {number} args.months                       destination contract length in months
 * @param {number} args.managementFeeBasisPoints     monthly fee as %×100 of salary (e.g. 1200 = 12%)
 * @param {number} [args.transferFeeRemoteInteger]   one-off EOR transfer fee — from a QUOTE, never computed. Absent => QUOTE_REQUIRED.
 * @param {number} [args.mobilityFeeRemoteInteger]   optional mobility/visa support fee from a quote. Absent => QUOTE_REQUIRED.
 * @param {number} [args.ptoCashoutRemoteInteger]    liquidated PTO payout from transitionGate, ×100
 * @param {number} [args.maxPollAttempts]            safety cap on the poll loop, default 10
 * @param {object} [opts]                            test-only seams
 * @param {() => Promise<void>} [opts.delay]         per-poll-interval wait; default no-op for hermetic tests
 * @returns {Promise<{status:"CALCULATED", ref:string, attempts:number, estimate:object}>}
 */
export async function runCostCalculator(
  {
    annualGrossSalaryRemoteInteger,
    currency,
    months,
    managementFeeBasisPoints,
    transferFeeRemoteInteger = null,
    mobilityFeeRemoteInteger = null,
    ptoCashoutRemoteInteger = 0,
    maxPollAttempts = 10,
  },
  { delay = noopDelay } = {}
) {
  // Absent salary = "not yet resolved from the request", an honest INCOMPLETE
  // estimate (the 🔴 use case must still produce a dossier + escalate). A
  // PROVIDED but non-integer salary is a ×100-scaling bug and still throws —
  // the invariant guard exists precisely so a bad value can't silently slip
  // through as if it were an honest absence.
  if (annualGrossSalaryRemoteInteger != null && !Number.isInteger(annualGrossSalaryRemoteInteger)) {
    throw new TypeError(`runCostCalculator expects an ×100 annual gross salary integer, got ${annualGrossSalaryRemoteInteger}`);
  }
  if (managementFeeBasisPoints == null) {
    throw new TypeError("managementFeeBasisPoints is required (Remote's fee schedule is the source of truth for the rate)");
  }

  // create -> poll (async, with injectable latency) -> retrieve
  const ref = `cc_${Date.now().toString(36)}`;
  let status = CALC.RUNNING;
  let attempts = 0;
  do {
    attempts += 1;
    if (attempts > 1) await delay();
    status = attempts < 2 ? CALC.RUNNING : CALC.READY; // one processing tick, then ready
  } while (status !== CALC.READY && attempts < maxPollAttempts);
  if (status !== CALC.READY) throw new Error(`cost calculator did not become ready after ${maxPollAttempts} polls`);

  const knownComponents = [];
  const quotedComponents = [];
  if (Number.isInteger(annualGrossSalaryRemoteInteger)) {
    // Remote's own response carries BOTH periods (`annual_management_fee` and
    // `monthly_management_fee`), derived from the annual salary. Do the same:
    // compute the annual fee from the annual salary, then divide, rather than
    // computing a monthly fee from a "monthly salary" this API never accepts.
    const annualFeeRemoteInteger = toRemoteInteger(
      (fromRemoteInteger(annualGrossSalaryRemoteInteger) * managementFeeBasisPoints) / 10000
    );
    const monthlyFeeRemoteInteger = Math.round(annualFeeRemoteInteger / 12);
    const monthlyGrossSalaryRemoteInteger = Math.round(annualGrossSalaryRemoteInteger / 12);
    knownComponents.push({ key: "monthlyManagementFee", label: "Monthly EOR management fee", remoteInteger: monthlyFeeRemoteInteger, currency, status: "CALCULATED" });
    const lifetimeFee = toRemoteInteger(fromRemoteInteger(monthlyFeeRemoteInteger) * Math.max(1, months));
    if (ptoCashoutRemoteInteger > 0) {
      knownComponents.push({ key: "ptoCashout", label: "Liquidated PTO payout", remoteInteger: ptoCashoutRemoteInteger, currency, status: "CALCULATED" });
    }
    if (transferFeeRemoteInteger != null) {
      knownComponents.push({ key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: transferFeeRemoteInteger, currency, status: "CALCULATED" });
    } else {
      quotedComponents.push({ key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: 0, currency, status: "QUOTE_REQUIRED" });
    }
    if (mobilityFeeRemoteInteger != null) {
      knownComponents.push({ key: "mobilityFee", label: "Mobility / visa support", remoteInteger: mobilityFeeRemoteInteger, currency, status: "CALCULATED" });
    } else {
      quotedComponents.push({ key: "mobilityFee", label: "Mobility / visa support", remoteInteger: 0, currency, status: "QUOTE_REQUIRED" });
    }

    const knownTotal = knownComponents.reduce((sum, c) => sum + c.remoteInteger, 0);

    // THE TERM TOTAL — the figure a mobility specialist is actually asking for,
    // and until now the one figure nothing in the repo produced.
    //
    // `knownTotalRemoteInteger` sums the components as listed, and
    // `monthlyManagementFee` is listed at its MONTHLY value. So for the
    // portal's own "Portugal → Netherlands" scenario the known total came to
    // 7,800.00 EUR — one month of a twelve-month engagement — and the portal
    // rendered it as "7,800.00 EUR known over 12 months". The real twelve-month
    // management fee is 93,600.00, and it was already being computed one line
    // above as `lifetimeMonthlyFeesRemoteInteger`, whereupon nothing anywhere in
    // this repository ever read it (grep it: this file was its only mention).
    // A specialist weighing whether a relocation is affordable was being handed
    // a number twelve times too small, wearing the label of the larger one.
    //
    // So the term total is stated explicitly rather than left to a caller to
    // assemble: recurring fees multiplied by the term, plus the one-off
    // components once. `knownTotalRemoteInteger` is kept — the per-month view is
    // genuinely useful — but it is no longer the only total on offer, which is
    // what made mislabelling it so easy.
    const oneOffKnownTotal = knownComponents
      .filter((c) => c.key !== "monthlyManagementFee")
      .reduce((sum, c) => sum + c.remoteInteger, 0);
    const knownTermTotal = lifetimeFee + oneOffKnownTotal;

    return {
      status: "CALCULATED",
      ref,
      attempts,
      estimate: {
        status: "CALCULATED",
        ref,
        currency,
        months,
        annualGrossSalaryRemoteInteger,
        monthlyGrossSalaryRemoteInteger,
        annualFeeRemoteInteger,
        monthlyFeeRemoteInteger,
        lifetimeMonthlyFeesRemoteInteger: lifetimeFee,
        components: [...knownComponents, ...quotedComponents],
        knownTotalRemoteInteger: knownTotal,
        knownTotalDisplay: formatMoney(knownTotal, currency),
        // Recurring fees across the whole term + every one-off we actually
        // have a figure for. Still "known": the QUOTE_REQUIRED components are
        // excluded from it, and `pendingQuotes` names them so the number is
        // never mistaken for the whole cost.
        knownTermTotalRemoteInteger: knownTermTotal,
        knownTermTotalDisplay: formatMoney(knownTermTotal, currency),
        pendingQuotes: quotedComponents.map((c) => c.key),
      },
    };
  }

  // No salary to compute against — the estimate is honestly incomplete rather
  // than fabricated from nothing. Every monetary component is listed as
  // pending input, exactly like an unfilled quote.
  return {
    status: "INCOMPLETE",
    ref,
    attempts,
    estimate: {
      status: "INCOMPLETE",
      ref,
      reason: "salary not provided — an estimate requires the destination annual gross salary",
      currency: currency ?? "USD",
      months: months ?? 12,
      annualGrossSalaryRemoteInteger: null,
      monthlyGrossSalaryRemoteInteger: null,
      annualFeeRemoteInteger: null,
      monthlyFeeRemoteInteger: null,
      lifetimeMonthlyFeesRemoteInteger: null,
      components: [
        { key: "monthlyManagementFee", label: "Monthly EOR management fee", remoteInteger: 0, currency: currency ?? "USD", status: "INPUT_REQUIRED" },
        { key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: 0, currency: currency ?? "USD", status: "QUOTE_REQUIRED" },
        { key: "mobilityFee", label: "Mobility / visa support", remoteInteger: 0, currency: currency ?? "USD", status: "QUOTE_REQUIRED" },
      ],
      // NOT 0 / "0.00 USD" — which is what these two fields used to hold, and
      // it is the one thing this whole module is forbidden to do. On the
      // INCOMPLETE branch there is no salary, so not a single component has a
      // value; the sum of nothing known is not zero money, it is no answer.
      // "0.00 USD" printed beside status INCOMPLETE reads to a specialist as a
      // relocation that costs nothing, and the currency string made it read as
      // a derived figure rather than a placeholder. The header of this file
      // states the rule ("reported QUOTE_REQUIRED when absent") and these two
      // literals were the exception to it. `null` is what every other refusal
      // in this repo returns for a figure it cannot derive — UC-05's
      // reconcilePtoPayout, UC-07's own reconcilePtoCashout — and it is what
      // costLine() in src/portal/server.js now renders as an explicit absence.
      knownTotalRemoteInteger: null,
      knownTotalDisplay: null,
      knownTermTotalRemoteInteger: null,
      knownTermTotalDisplay: null,
      pendingQuotes: ["monthlyManagementFee", "eorTransferFee", "mobilityFee"],
    },
  };
}
