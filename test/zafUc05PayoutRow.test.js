// ---------------------------------------------------------------------------
// zafUc05PayoutRow.test.js — the sidebar's "PTO payout" cell may not invent money
// ---------------------------------------------------------------------------
// Found by reading the deployment, not the code: a Portuguese resignation
// filed with no time-off balances showed "not known" on the portal and
// "not a finding that nothing is owed" in the sidebar's basis card — and
// "0.00 EUR" in the sidebar's PTO payout row, directly above the Sign off
// button. Same record, three readings, and the one that signs was the one
// that lied. The record carries `totalInRemoteInteger: 0` for an empty list
// (ptoPayout.js: arithmetically honest, semantically unknown) and the row was
// formatting the number without asking what it meant.
//
// These tests drive the REAL panel (panels.js in a vm, as zafApp.test.js
// does) with the REAL server account (describeSignoffBasis over a real
// reconcilePtoPayout result), so the row is judged on what the deployment
// would show, not on a hand-written fixture that agrees with itself.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { reconcilePtoPayout } from "../src/uc05/ptoPayout.js";
import { describeSignoffBasis, PAYOUT_SHORT_LABELS, payoutState } from "../src/uc05/decisionFacts.js";
import { formatMoney } from "../src/shared/money.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANELS = join(__dirname, "..", "zaf-app", "assets", "panels.js");

function loadPanel() {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(readFileSync(PANELS, "utf8"), { filename: "panels.js" }).runInContext(context);
  return context.window.CXPanelFor("UC-05");
}

/** The row exactly as the sidebar would build it from the API's response. */
function ptoRow(payout, basisOverride) {
  const row = { useCase: "UC-05", employmentId: "emp_pt_001", requester: "emp_pt_001", payout, notice: null };
  const basis = basisOverride === undefined ? describeSignoffBasis({ resignationRow: row }) : basisOverride;
  const rows = loadPanel().rows({ case: row, basis });
  const cell = rows.find((r) => r.label === "PTO payout");
  assert.ok(cell, "the PTO payout row exists");
  return { cell: cell.value, basis };
}

test("no balances supplied: the record says 0, the row says 'not known' — and never 0.00", () => {
  const payout = reconcilePtoPayout({ balances: [], currency: "EUR" });
  assert.equal(payout.totalInRemoteInteger, 0, "the defect's precondition: the record really does carry a zero");
  assert.equal(payout.source, "no_time_off_records");

  const { cell, basis } = ptoRow(payout);
  assert.equal(payoutState(basis.payout), "not_known");
  assert.equal(cell, PAYOUT_SHORT_LABELS.not_known);
  assert.doesNotMatch(cell, /0\.00|EUR/, "a zero nobody worked out must not reach the signing screen");
});

test("a balance that could not be turned into money: 'not worked out', not a dash and not a zero", () => {
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 0, hourlyRateInRemoteInteger: null }],
    currency: "EUR",
  });
  assert.equal(payout.computable, false);
  const { cell } = ptoRow(payout);
  assert.equal(cell, PAYOUT_SHORT_LABELS.not_worked_out);
});

test("a stated figure renders as the SAME string the basis card prints — one figure, not two", () => {
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 4800 }],
    currency: "GBP",
  });
  const { cell, basis } = ptoRow(payout);
  assert.equal(cell, basis.payout.total);
  assert.equal(cell, formatMoney(payout.totalInRemoteInteger, "GBP"));
  assert.match(cell, /^3,072\.00 GBP$/);
});

test("refused before the calculation ran: 'not calculated'", () => {
  const { cell } = ptoRow(null);
  assert.equal(cell, PAYOUT_SHORT_LABELS.not_run);
});

test("no basis on the view, no figure — even when the record holds a real total", () => {
  // The browser may not vouch for a number the server has not. A view built
  // from the record alone (the shape every pre-basis fixture used) renders an
  // absence, never the raw integer and never a formatted guess.
  const { cell } = ptoRow({ totalInRemoteInteger: 120000, currency: "USD" }, null);
  assert.equal(cell, "—");
});

test("deploy-order safety: an API that marks the figure stated but predates shortLabel still renders it, through money()", () => {
  const { cell } = ptoRow({ totalInRemoteInteger: 120000, currency: "USD" }, { payout: { stated: true } });
  assert.equal(cell, "1,200.00 USD");
  // …and one that marks it UNSTATED without a label renders nothing, not 0.00.
  const unstated = ptoRow({ totalInRemoteInteger: 0, currency: "EUR" }, { payout: { stated: false } });
  assert.equal(unstated.cell, "—");
});

test("every payout state the server can produce has a label — none can render as an empty cell", () => {
  for (const state of ["not_run", "not_worked_out", "not_known", "not_stated"]) {
    assert.equal(typeof PAYOUT_SHORT_LABELS[state], "string");
    assert.ok(PAYOUT_SHORT_LABELS[state].length > 0, state);
  }
});
