// ---------------------------------------------------------------------------
// uc02PolicyCapCoverage.test.js — the corpus, its limits, and its two copies
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. On 2026-08-29 every one of the twelve pending USD claims in
// the Sandbox was classified and checked against the cap corpus. NOT ONE could
// reach `auto_approve`: each was either over the single $150 cap that applied
// to it, or in one of the 24 live categories the corpus did not cover at all.
//
// So UC-02's 🟢 auto-approve path had never fired against a real account and
// could not. A low-risk use case whose low-risk path is unreachable is not
// low-risk automation, it is an expensive human-review router — and nothing
// said so, because "no cap defined" and "cap not exceeded" both look like the
// gate working.
//
// The corpus was extended from 8 to 26 of the 32 selectable USA leaves. These
// tests pin what must survive that, and what must survive the NEXT extension:
//
//   1. The fail-closed contract is unchanged. Unknown still means unknown.
//   2. Six categories stay uncapped ON PURPOSE, and they are named. If a later
//      edit caps them to make something pass, this fails and says which.
//   3. Both copies hold identical figures — the src table and the ported n8n
//      one. A cap that differed between the two execution paths would approve
//      on one and refuse on the other, for the same claim.
//   4. Every cap is a positive integer of MINOR units. A float here is the
//      100x class of error the whole money discipline exists to prevent.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { POLICY_CAPS, POLICY_CAP_CURRENCY, getPolicyCap } from "../src/uc02/policyCaps.js";

/**
 * Categories that MUST NOT acquire a cap.
 *
 * Each is a case where the amount is not the interesting question, so no
 * ceiling would make approving it without a person safe. Stated here as an
 * executable assertion rather than only as a comment, because a comment cannot
 * stop the edit it warns about.
 */
const MUST_STAY_UNCAPPED = [
  "relocation_and_mobility.relocation_and_mobility",
  "business_travel.visa_or_immigration_fees",
  "home_office_and_co_working.office_rental",
  "car_rental_long_term_lease.car_rental_long_term_lease",
  "tech_and_work_equipment.equipment_shipping_and_customs",
  "business_travel.additional_travel_services",
];

test("the six deliberately-uncapped categories are still uncapped", () => {
  for (const code of MUST_STAY_UNCAPPED) {
    assert.equal(
      getPolicyCap(code),
      null,
      `${code} has acquired a cap — it is on the list of categories that must always reach a person, ` +
        "so if this is intentional the list and its reasoning have to change with it"
    );
  }
});

test("an unknown category is UNKNOWN, never unlimited — the fail-closed contract", () => {
  // F-12. The whole corpus is safe only because this holds.
  for (const unknown of ["", "not_a_category", "made.up.code", "constructor", "toString", "__proto__"]) {
    assert.equal(getPolicyCap(unknown), null, `${JSON.stringify(unknown)} resolved to a cap`);
  }
  assert.equal(getPolicyCap(null), null);
  assert.equal(getPolicyCap(undefined), null);
});

test("every cap is a positive integer of MINOR units", () => {
  // A float here means someone wrote major units, and the comparison would be
  // wrong by 100x in the direction that approves things.
  for (const [code, cap] of Object.entries(POLICY_CAPS)) {
    assert.ok(Number.isInteger(cap), `${code} has a non-integer cap ${cap} — minor units, not dollars`);
    assert.ok(cap > 0, `${code} has a non-positive cap ${cap}`);
    assert.ok(cap >= 1000, `${code} caps at ${cap} minor units ($${(cap / 100).toFixed(2)}) — suspiciously low, likely major units`);
  }
});

test("coverage is recorded, so a shrinking corpus is visible", () => {
  // Not an arbitrary number: 26 of the 32 selectable leaves the live USA
  // account offers, with 6 uncapped on purpose. If a category is added, this
  // moves deliberately rather than silently.
  assert.equal(Object.keys(POLICY_CAPS).length, 26);
  assert.equal(POLICY_CAP_CURRENCY, "USD");
});

test("the src corpus and the ported n8n corpus hold identical figures", () => {
  // Two execution paths, one policy. A divergence here approves a claim on one
  // path and refuses it on the other, which is the worst possible way for a
  // cap to be wrong.
  const node = readFileSync(new URL("../workflows/nodes-uc02/expenseGates.js", import.meta.url), "utf8");
  const start = node.indexOf("const POLICY_CAPS = {");
  assert.ok(start > 0, "the ported corpus is gone from the n8n node");
  const block = node.slice(start, node.indexOf("};", start));
  const ported = {};
  for (const m of block.matchAll(/"([\w.]+)":\s*(\d+)/g)) ported[m[1]] = Number(m[2]);
  assert.deepEqual(ported, { ...POLICY_CAPS }, "the two cap corpora have drifted");
});

test("the n8n copy has not quietly capped one of the six either", () => {
  const node = readFileSync(new URL("../workflows/nodes-uc02/expenseGates.js", import.meta.url), "utf8");
  const block = node.slice(node.indexOf("const POLICY_CAPS = {"), node.indexOf("};", node.indexOf("const POLICY_CAPS = {")));
  for (const code of MUST_STAY_UNCAPPED) {
    assert.ok(!block.includes(`"${code}"`), `${code} is capped in the n8n copy but not in src`);
  }
});
