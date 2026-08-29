// ---------------------------------------------------------------------------
// uc03LetterCompensation.test.js — the one money row, against the shape
// production actually reads
// ---------------------------------------------------------------------------
// THE DEFECT THIS FILE EXISTS TO CLOSE, AND WHY NO EXISTING TEST SAW IT.
// `renderTravelLetterHtml()` printed base compensation from
// `employment.base_salary`. `normalizeEmployment()` (src/remote/restClient.js)
// produces NO `base_salary` and NO `currency` key for a real API response — its
// own comment says so and calls it a handoff item — and only the mock server's
// FLAT fixtures carry those names. So the row rendered offline, could not
// render in production, and `test/uc03AutoIssue.test.js` asserted its presence
// against the mock and passed. A fixture agreeing with the code while neither
// agrees with Remote is this repository's most expensive recurring failure
// (CLAUDE.md §4), and it was sitting on the single most sensitive row of a
// document that is now issued to a consulate with nobody in the path.
//
// So every test here is driven from the LIVE-SHAPED envelope — the nested
// `data.employment` form production takes — put through the real normalizer,
// not from a flat fixture.
//
// ---------------------------------------------------------------------------
// WHAT WAS ESTABLISHED ABOUT THE FIGURE, AND WHAT WAS NOT
// ---------------------------------------------------------------------------
// Remote holds the money under TWO NAMES that are TWO DIFFERENT FACTS:
//
//   EOR employee : contract_details.annual_gross_salary
//                  + contract_details.compensation_currency_code   — an ANNUAL
//                  salary, and its scale is **[CONFIRMED] ×100 minor units**:
//                  Remote's own cost-calculator reference types the same field
//                  as *"The annual gross salary in the region's local currency,
//                  IN CENTS"* (developer.remote.com/reference/
//                  post_v1_cost-calculator_estimation.md, HTTP 200, fetched
//                  2026-08-20). The live contract-amendment captures agree
//                  independently: `src/remote/fixtures/contractAmendmentSchemas.js`
//                  records 7199999 as *"one cent below the CURRENT salary of
//                  the employment (7200000)"*, and the same employment's bound
//                  appears as 6158130 GBP / 8342855 USD / 31127687 PLN /
//                  7199999 EUR — a set that is one ~£61.5k salary in minor
//                  units and an implausible ~£6.1M in major ones.
//
//   Contractor   : contract_details.payment_terms.compensation_gross_amount
//                  + compensation_currency_code, with period_unit "monthly" —
//                  a RATE, not a salary, and its ×100 scale is **[UNKNOWN]**.
//                  The committed live capture carries 25000, which is $250.00
//                  or $25,000.00 a month depending on an answer no public
//                  Remote reference states (`compensation_gross_amount` appears
//                  in no reference page; it lives inside the per-country
//                  `contractor_contract_details` form, which needs a live token
//                  this container does not hold).
//
// THE RULE THAT FALLS OUT OF THAT: the letter states the figure it can vouch
// for and states NOTHING where it cannot. Printing a rate under a salary's
// label, or a figure that might be 100× wrong, on a document a consular officer
// weighs as means of subsistence, is worse than a letter one row shorter.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderTravelLetterHtml } from "../src/uc03/letter.js";
import { normalizeEmployment } from "../src/remote/restClient.js";
import { describeLetterOffer, OFFERABLE_DECISION, OFFERABLE_REASON } from "../src/uc03/letterOffer.js";
import { LIVE_EMPLOYMENT_SHOW_ENVELOPE } from "./fixtures/sandboxCapture.js";

const LEGAL_ENTITY = { name: "Remote Netherlands B.V.", country_name: "Netherlands", country_code: "NL" };

const TRIP = {
  legalEntity: LEGAL_ENTITY,
  destinationCountry: "DE",
  startDate: "2026-09-20",
  endDate: "2026-09-26",
};

/** The live show payload, exactly as `RemoteClient.getEmployment()` unwraps it. */
function liveEmployment(contractDetails = undefined) {
  const record = structuredClone(LIVE_EMPLOYMENT_SHOW_ENVELOPE.data.employment);
  if (contractDetails !== undefined) record.contract_details = contractDetails;
  return normalizeEmployment(record);
}

// ---------------------------------------------------------------------------
// 1. THE POSITIVE CASE — an EOR employment, live-shaped, renders the row
// ---------------------------------------------------------------------------

test("a live-shaped EOR employment renders its annual gross salary, scaled once", () => {
  // The `contract_details` block an EOR employment carries. Field names are
  // Remote's own, transcribed in normalizeEmployment()'s [CONFIRMED 2026-08-18]
  // note; the pair 7200000/EUR is the live-captured salary and currency const
  // of the Dutch employment behind src/remote/fixtures/contractAmendmentSchemas.js.
  const employment = liveEmployment({
    annual_gross_salary: 7200000,
    compensation_currency_code: "EUR",
    work_hours_per_week: 40,
  });

  // The normalizer is the thing production runs, and it still refuses to invent
  // a flat alias — the row must be reachable WITHOUT one.
  assert.equal(employment.base_salary, undefined, "the normalizer still mints no flat alias");
  assert.equal(employment.contract_details.annual_gross_salary, 7200000);

  const html = renderTravelLetterHtml({ employment, ...TRIP });
  assert.match(html, /Annual gross salary/, "the row production can actually reach");
  assert.match(html, /72,000\.00 EUR/, "×100 minor units, converted once by shared/money.js");
  assert.ok(!html.includes("7,200,000"), "never the raw minor-unit integer");
  assert.ok(!html.includes("720,000,000"), "and never scaled twice");
});

// ---------------------------------------------------------------------------
// 2. THE CASE THAT MUST STAY SILENT — a contractor rate of unestablished scale
// ---------------------------------------------------------------------------

test("the committed live capture is a contractor, and its rate is not printed", () => {
  // Verbatim, unedited: this is `GET /v1/employments/{id}` as
  // gateway.remote-sandbox.com answered on 2026-08-19.
  const employment = liveEmployment();
  assert.equal(employment.contract_details.payment_terms.compensation_gross_amount, 25000);
  assert.equal(employment.contract_details.payment_terms.period_unit, "monthly");
  assert.equal(employment.contract_details.annual_gross_salary, undefined);

  const html = renderTravelLetterHtml({ employment, ...TRIP });
  assert.ok(!/Annual gross salary/.test(html), "no salary row: this record holds no salary");
  assert.ok(!/compensation/i.test(html), "and no other wording that reads as one");
  // Neither reading of the ambiguous scale may appear, in any formatting.
  for (const figure of ["250.00", "25,000.00", "25000"]) {
    assert.ok(!html.includes(figure), `the unestablished contractor rate leaked as ${figure}`);
  }
});

test("the renderer never names the contractor rate at all", () => {
  // Structural, because the behavioural test above only proves the field is
  // absent from ONE record. The decision is that this file does not read that
  // field until its scale is established from Remote; a future edit that adds
  // it — the one-line "fix" the field name invites — fails here and has to
  // argue with this file's header first.
  const source = readFileSync(new URL("../src/uc03/letter.js", import.meta.url), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const field of ["compensation_gross_amount", "payment_terms", "contractor_rate"]) {
    assert.ok(!source.includes(field), `letter.js reads ${field}, whose ×100 scale is not established`);
  }
});

// ---------------------------------------------------------------------------
// 3. NO FIGURE WITHOUT ITS CURRENCY
// ---------------------------------------------------------------------------

test("an amount with no readable currency renders no row rather than a default one", () => {
  // The old code defaulted to "USD". A salary printed in the wrong currency is
  // exactly as wrong as one printed at the wrong scale, and on this document it
  // is wrong in a direction a consular officer acts on.
  for (const currency of [undefined, null, "", "euros", 978]) {
    const html = renderTravelLetterHtml({
      employment: liveEmployment({ annual_gross_salary: 7200000, compensation_currency_code: currency }),
      ...TRIP,
    });
    assert.ok(!/Annual gross salary/.test(html), `rendered a figure with currency ${JSON.stringify(currency)}`);
    assert.ok(!html.includes("USD"), "and never fell back to a currency nobody stated");
  }
});

test("a fractional or unreadable amount renders no row", () => {
  // parseRemoteMinorUnits()'s refusals, applied here rather than re-implemented:
  // "" would coerce to a confident zero, "1.5" to a rounded invention.
  for (const amount of ["", " ", "1.5", 1.5, "1e3", null, "abc"]) {
    const html = renderTravelLetterHtml({
      employment: liveEmployment({ annual_gross_salary: amount, compensation_currency_code: "EUR" }),
      ...TRIP,
    });
    assert.ok(!/Annual gross salary/.test(html), `rendered a row for amount ${JSON.stringify(amount)}`);
  }
});

test("a quoted integer is read, because this API sends money as a quoted string elsewhere", () => {
  // `total_payroll_cost` is documented `integer` and returned as `"15103469"`
  // [CONFIRMED live 2026-08-19, src/shared/money.js's header]. Nothing says
  // annual_gross_salary cannot arrive the same way, and a TypeError from
  // fromRemoteInteger() would take out the whole letter.
  const html = renderTravelLetterHtml({
    employment: liveEmployment({ annual_gross_salary: "7200000", compensation_currency_code: "EUR" }),
    ...TRIP,
  });
  assert.match(html, /72,000\.00 EUR/);
});

// ---------------------------------------------------------------------------
// 4. THE MOCK'S FLAT SHAPE STILL RENDERS — the offline demo is not collateral
// ---------------------------------------------------------------------------

test("the mock server's flat base_salary is the same fact under an older name", () => {
  // `normalizeEmployment()` returns the mock's flat shape untouched, so it is a
  // real shape inside this system even though Remote never sends it — and
  // UC-06's payload builder already maps that field onto the amendment form's
  // `annual_gross_salary`, which is what makes them the same fact rather than
  // two. Dropping it would blank the row in the portal, the playground and
  // `npm run walkthrough` for no gain.
  const html = renderTravelLetterHtml({
    employment: {
      full_name: "Alexandre Tremblay",
      job_title: "Financial Manager",
      status: "active",
      contract_type: "contractor",
      start_date: "2023-06-26",
      base_salary: 5000000,
      currency: "USD",
    },
    ...TRIP,
  });
  assert.match(html, /Annual gross salary/);
  assert.match(html, /50,000\.00 USD/);
});

// ---------------------------------------------------------------------------
// 5. THE OFFER MAY NOT PROMISE WHAT THE DOCUMENT CANNOT CARRY
// ---------------------------------------------------------------------------

const OFFERABLE_CASE = {
  id: "case_offer_1",
  employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
  decision: OFFERABLE_DECISION,
  reason: OFFERABLE_REASON,
  classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26" },
};

test("the offer states the salary row conditionally, because a contractor's letter has none", () => {
  const offer = describeLetterOffer({ caseRow: OFFERABLE_CASE });
  assert.equal(offer.offered, true);

  // The promise it used to make, to everyone, including every contractor whose
  // letter could never carry it.
  assert.ok(
    !/and your base compensation/i.test(offer.produces),
    `the offer still promises a row the contractor path cannot render: ${offer.produces}`
  );

  // It must still NAME the row, though — `letterScope.js`'s `omission_requested`
  // marker routes "leave my salary out" to a human, and a marker only fires on
  // an ask. Nobody asks about a row they were never told was there.
  assert.match(offer.produces, /annual gross salary/i, "the row is no longer named before the click");
  assert.match(offer.produces, /\b(if|where)\b/i, "named, but not as an unconditional promise");
});
