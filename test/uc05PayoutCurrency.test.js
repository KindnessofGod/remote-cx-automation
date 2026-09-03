// ---------------------------------------------------------------------------
// uc05PayoutCurrency.test.js — a currency is part of a money figure
// ---------------------------------------------------------------------------
// MEASURED ON THE LIVE DEPLOYMENT, 2026-09-02, by filing a real resignation.
// A PORTUGUESE employee typed an hourly rate of 26.00 meaning euros, and the
// settlement panel rendered:
//
//     "2704.00 USD — vacation: 18 days accrued − 5 taken = 13 days × 8 hours
//      per day × 26.00 USD per hour = 2,704.00 USD"
//
// `src/portal/server.js` passed `body.currency || "USD"` and the portal form has
// no currency box at all — so EVERY portal-filed resignation was denominated in
// dollars whatever the country. `reconcilePtoPayout()` had the same fallback in
// four more places. The figure becomes someone's final payment, on a document
// HR Ops signs.
//
// THE SUITE WAS BLIND TO IT. Restoring the `?? "USD"` default with this file
// absent leaves all 5,520 tests green — measured, not assumed. Every existing
// payout test passes a currency, so no test ever exercised the fallback that
// production took on every single request.
//
// THE RULE, and it is this file's whole subject: money is never fabricated, and
// a denomination nobody stated is fabricated money with the digits left intact.
// An absent currency refuses the line exactly as an absent hourly rate does —
// both are "we cannot see what is owed".
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { reconcilePtoPayout, payoutCurrencyFor } from "../src/uc05/ptoPayout.js";
import { evaluate } from "../src/uc05/policyEngine.js";

const LINE = [{ timeOffType: "vacation", daysAccrued: 18, daysUsed: 5, hourlyRateInRemoteInteger: 2600 }];

test("no currency REFUSES the line — it does not quietly become dollars", () => {
  for (const absent of [null, undefined, "", "   "]) {
    const r = reconcilePtoPayout({ balances: LINE, currency: absent });
    assert.equal(r.currency, null, `currency ${JSON.stringify(absent)} was substituted with ${r.currency}`);
    assert.equal(r.totalInRemoteInteger, null, "a total was computed with no currency to denominate it in");
    assert.ok(
      r.unusableLines.some((l) => (l.missing ?? []).includes("currency")),
      "the refusal does not name the currency as the missing field"
    );
  }
});

test("USD is never substituted — asserted as ANY substitution, not as one spelling", () => {
  // CLAUDE.md §7 item 22 records a guard that named one spelling and let the bug
  // through. This asserts the absence of ANY denomination rather than the
  // absence of the string "USD", so a future default of "EUR" fails it too.
  const r = reconcilePtoPayout({ balances: LINE, currency: null });
  const serialised = JSON.stringify(r);
  assert.doesNotMatch(
    serialised,
    /"currency":"[A-Za-z]{2,}"/,
    `a currency was invented somewhere in the result: ${serialised.slice(0, 200)}`
  );
});

test("a STATED currency is honoured and still computes — the fix refuses absence, not everything", () => {
  // The control. Without it this file would pass equally against a function that
  // refused every payout, which is failing closed by never working.
  const r = reconcilePtoPayout({ balances: LINE, currency: "EUR" });
  assert.equal(r.currency, "EUR");
  assert.equal(r.totalInRemoteInteger, 270400, "13 days × 8 hours × 26.00");
  assert.deepEqual(r.unusableLines, []);
  // Normalised, not validated against a list: an unrecognised code is the
  // caller's to explain, and this function must never substitute one.
  assert.equal(reconcilePtoPayout({ balances: LINE, currency: "eur" }).currency, "EUR");
});

test("the portal does not re-introduce the default one layer up", () => {
  // Both halves were defaulting independently, so fixing the reconciler alone
  // would have left production unchanged.
  const server = readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");
  const stripped = server
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(
    stripped,
    /currency:\s*body\.currency\s*\|\|\s*["'][A-Z]{3}["']/,
    "the portal is substituting a currency the requester never stated"
  );
  assert.match(stripped, /currency:\s*body\.currency\s*\|\|\s*null/);
});

test("THE FORM does not answer the currency question on the requester's behalf", () => {
  // THE SERVER-SIDE FIX WAS BYPASSED BY THE ONLY PATH A HUMAN USES.
  //
  // `src/portal/server.js` stopped substituting "USD" and this file's other
  // tests pin that. But `src/portal/assets/index.html` shipped
  // `<input id="uc05-currency" value="USD">`, so the box arrived FILLED and
  // every hand-filled resignation submitted USD explicitly — which is not a
  // default the server can refuse, because the requester appears to have stated
  // it.
  //
  // Measured on the live deployment 2026-09-02, ON THE BUILD THAT ALREADY
  // CARRIED THE SERVER FIX: a British employee's settlement rendered
  // `1920.00 USD` and a Portuguese one `2704.00 USD`. Clearing the box by hand
  // produced the correct `1920.00 GBP` — so the server derives it properly and
  // the form was overriding it. The digits are identical either way, which is
  // why nothing looked wrong.
  //
  // The lesson is the one this repo keeps paying for: a fix verified at the
  // layer it was written in is not a fix verified where a person touches it.
  const html = readFileSync(new URL("../src/portal/assets/index.html", import.meta.url), "utf8");

  const field = html.slice(html.indexOf('id="uc05-currency"') - 400, html.indexOf('id="uc05-currency"') + 200);
  const tag = field.slice(field.indexOf("<input"));
  assert.doesNotMatch(
    tag,
    /value\s*=/,
    "the currency box ships a value again — a prefilled currency is one the requester never stated"
  );

  // ANY currency, not the string "USD" — a default of "EUR" tomorrow is the
  // same defect (CLAUDE.md §7 item 22).
  assert.doesNotMatch(html, /id="uc05-currency"[^>]*value=/);

  // A placeholder is fine and is what UC-07's equivalent box has always used:
  // it shows the reader what shape of answer is wanted without submitting one.
  assert.match(tag, /placeholder=/, "the box should still tell the reader what belongs in it");
});

test("no persona blurb still describes the UK notice as a tenure bracket", () => {
  // Emma Thompson's note read "~5.5 years' service puts her in the five-week
  // bracket" — served live from /portal/api/context and rendered in the left
  // rail, BESIDE a result saying 7 days and a citation saying the ladder is the
  // employer's. Three statements on one screen, one of them the defect that had
  // just been removed. Found 2026-09-02 by re-driving the fixed deployment.
  //
  // Asserted as a CLASS: any persona describing a UK notice bracket, not the
  // one phrase that happened to be there.
  const personas = readFileSync(new URL("../src/portal/personas.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    personas,
    /(five|four|three|two|six|seven|eight|nine|ten|twelve)[- ]week bracket/i,
    "a persona note describes a tenure-scaled UK notice — ERA 1996 s.86(2) is one week, flat"
  );
  assert.doesNotMatch(personas, /puts (her|him|them) in the .{0,20}bracket/i);
});

// ---------------------------------------------------------------------------
// 2026-09-02 — THE SECOND EXECUTION PATH. The fix above stopped the portal; it
// never reached a ticket-filed resignation, because workflow.js still ended
// its precedence in `?? "USD"`, evaluate() defaulted `currency = "USD"`, the
// n8n normalize node filled an absent currency with 'USD' and the gates body
// did it again. One rule now, in one exported function, read by both paths
// and by the parity harness.
// ---------------------------------------------------------------------------

test("payoutCurrencyFor: stated wins, then Remote's compensation_currency_code, then nothing — never USD", () => {
  const emp = { contract_details: { compensation_currency_code: "eur" }, currency: "CAD" };
  assert.equal(payoutCurrencyFor({ stated: " gbp ", employment: emp }), "GBP");
  assert.equal(payoutCurrencyFor({ stated: "", employment: emp }), "EUR");
  assert.equal(payoutCurrencyFor({ stated: null, employment: { currency: "cad" } }), "CAD");
  assert.equal(payoutCurrencyFor({ stated: null, employment: {} }), null);
  assert.equal(payoutCurrencyFor({}), null);
  assert.equal(payoutCurrencyFor(), null);
});

test("evaluate() with no currency refuses the payout line — it no longer defaults to dollars", () => {
  const r = evaluate({
    identityVerified: true,
    employment: { id: "emp_uk_001", status: "active", country_code: "GB", start_date: "2023-01-10" },
    proposedEndDate: "2026-09-30",
    timeOffBalances: LINE,
    now: "2026-08-16",
  });
  assert.equal(r.payout.computable, false);
  assert.equal(r.payout.currency, null);
  assert.ok(r.payout.unusableLines[0].missing.includes("currency"));
});

test("STRUCTURAL: no UC-05 source on either execution path carries a USD fallback", () => {
  // The four files that each held one, plus the reconciler. Comments stripped
  // first — the normalize node names 'USD' in a comment saying it never uses it.
  const files = [
    "src/uc05/ptoPayout.js",
    "src/uc05/policyEngine.js",
    "src/uc05/workflow.js",
    "workflows/nodes-uc05/noticePeriodGates.js",
    "workflows/nodes-uc05/normalizeResignationRequest.js",
  ];
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const f of files) {
    const code = strip(readFileSync(new URL("../" + f, import.meta.url), "utf8"));
    const hits = code.match(/(\?\?|\|\||:)\s*["']USD["']/g) || [];
    assert.deepEqual(hits, [], f + " still falls back to USD: " + hits.join(", "));
  }
});
