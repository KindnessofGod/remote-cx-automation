// ---------------------------------------------------------------------------
// uc05TenureMeasuredDates.test.js — "86 months" must say from when to when
// ---------------------------------------------------------------------------
// An employment-law reviewer named this as the one thing between the panel and
// a signature: every case printed "Start date 2023-06-26 — read from Remote
// just now" beside "on 86 months of service", and 2023-06-26 to 2026-09-02 is
// 38. The arithmetic was right; the screen was unsignable because it never
// said what the tenure was measured between, and the record it re-read was
// not the record the calculation used.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluate } from "../src/uc05/policyEngine.js";
import { describeSignoffBasis } from "../src/uc05/decisionFacts.js";

const employment = { id: "emp_pt", status: "active", country_code: "PT", start_date: "2019-06-03", contract_type: "employee" };
const run = () => evaluate({ identityVerified: true, employment, proposedEndDate: "2026-12-31", timeOffBalances: [], currency: "EUR", now: "2026-09-02" });

test("the notice carries the dates tenure was measured between", () => {
  const r = run();
  assert.equal(r.notice.tenureMeasuredFrom, "2019-06-03");
  assert.equal(r.notice.tenureMeasuredTo, "2026-09-02");
  assert.equal(r.notice.tenureMonths, 86);
});

test("the basis sentence says it, beside the month count", () => {
  const r = run();
  const basis = describeSignoffBasis({ resignationRow: { notice: r.notice, payout: r.payout } });
  assert.match(basis.notice.sentence, /on 86 months of service \(measured from 2019-06-03 to 2026-09-02\)/);
  assert.equal(basis.notice.tenureMeasuredFrom, "2019-06-03");
  assert.equal(basis.notice.startDateDisagreement, undefined, "no live read, no comparison");
});

test("when the record read now disagrees with the date the calculation used, the signer is told — and it is an unknown", () => {
  const r = run();
  const basis = describeSignoffBasis({ resignationRow: { notice: r.notice, payout: r.payout }, employeeNow: { start_date: "2023-06-26" } });
  assert.ok(basis.notice.startDateDisagreement);
  assert.equal(basis.notice.startDateDisagreement.calculationUsed, "2019-06-03");
  assert.equal(basis.notice.startDateDisagreement.recordReadNow, "2023-06-26");
  assert.match(basis.notice.sentence, /read just now gives a start date of 2023-06-26; the calculation measured tenure from 2019-06-03/);
  assert.ok(basis.unknowns.some((u) => /Which start date is right/.test(u.what)));
});

test("when they agree, nothing is said — and an unreadable live record produces no false disagreement", () => {
  const r = run();
  const same = describeSignoffBasis({ resignationRow: { notice: r.notice, payout: r.payout }, employeeNow: { start_date: "2019-06-03" } });
  assert.equal(same.notice.startDateDisagreement, undefined);
  const junk = describeSignoffBasis({ resignationRow: { notice: r.notice, payout: r.payout }, employeeNow: { start_date: "unknown" } });
  assert.equal(junk.notice.startDateDisagreement, undefined);
});
