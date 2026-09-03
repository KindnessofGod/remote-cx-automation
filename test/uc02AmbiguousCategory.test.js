// ---------------------------------------------------------------------------
// uc02AmbiguousCategory.test.js — a tie is not a winner
// ---------------------------------------------------------------------------
// Found live on 2026-08-29 while investigating why UC-02's green tier could not
// be demonstrated. The Sandbox expense "Office Chair" records the LEGACY PARENT
// category code `tech_equipment` ("Tech / Work Equipment"), so the text the
// rule-based classifier scores carries the tokens `tech`, `work` and
// `equipment` — all three of which appear in BOTH:
//
//   tech_and_work_equipment.equipment_shipping_and_customs
//   tech_and_work_equipment.work_equipment_employee_owned
//
// The scores were equal. `if (score > bestScore)` keeps whichever the category
// list yields first, so the winner was decided by ARRAY ORDER — and it was then
// reported at confidence 0.9, above policyEngine.js's 0.85 gate. A coin flip
// between "shipping and customs" and "the chair itself" passed as a confident
// answer, and a wrong category resolves a wrong cap.
//
// This is the same failure the classifier's own header already records for
// substring scoring. Ordering is not evidence.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";

/** The two real Remote categories that tie, plus one that cannot. */
const CATEGORIES = [
  { code: "tech_and_work_equipment.equipment_shipping_and_customs", title: "Equipment shipping and customs", description: "Shipping and customs charges for work equipment.", is_selectable: true, status: "active" },
  { code: "tech_and_work_equipment.work_equipment_employee_owned", title: "Work equipment (employee-owned)", description: "Work equipment the employee owns.", is_selectable: true, status: "active" },
  { code: "business_travel.accommodation", title: "Accommodation", description: "Hotel or other lodging during your trip.", is_selectable: true, status: "active" },
];

/** The live Sandbox shape: a legacy PARENT code as the recorded category. */
const officeChair = {
  title: "Office Chair",
  notes: null,
  expense_category: { code: "tech_equipment", title: "Tech / Work Equipment" },
};

test("a tie is reported BELOW the 0.85 confidence gate, not at 0.9", () => {
  const out = classifyExpenseRuleBased({ expense: officeChair, categoryList: CATEGORIES });
  assert.ok(out.confidence < 0.85, `tie reported at ${out.confidence}, which clears the gate`);
});

test("the tie is stated in the reason, not hidden", () => {
  // A human reading the audit row must be told the category was not decided by
  // evidence — otherwise the next reader trusts it.
  const out = classifyExpenseRuleBased({ expense: officeChair, categoryList: CATEGORIES });
  assert.match(out.reason, /tied|list order/i);
});

test("an UNAMBIGUOUS match is unaffected and still confident", () => {
  // The fix must not make every classification timid — that would push real
  // work to humans and quietly disable the green tier, which is the failure
  // mode the acceptance contract's §16.8 exists for.
  const hotel = { title: "Hotel Stay in Berlin", notes: null, expense_category: { code: "lodging", title: "Accommodation" } };
  const out = classifyExpenseRuleBased({ expense: hotel, categoryList: CATEGORIES });
  assert.equal(out.categoryId, "business_travel.accommodation");
  assert.ok(out.confidence >= 0.85, `an unambiguous match dropped to ${out.confidence}`);
});

test("no match at all is still the distinct 'unresolved' answer", () => {
  const vague = { title: "zzzz", notes: null, expense_category: null };
  const out = classifyExpenseRuleBased({ expense: vague, categoryList: CATEGORIES });
  assert.equal(out.categoryId, null);
  assert.match(out.reason, /No category could be resolved/);
});

test("ambiguity can only LOWER confidence, never raise it", () => {
  // Applied with Math.min after the other signals, so a text that is both
  // ambiguous AND low-confidence keeps the lower number.
  const both = {
    title: "Office Chair approximately, receipt missing",
    notes: null,
    expense_category: { code: "tech_equipment", title: "Tech / Work Equipment" },
  };
  const out = classifyExpenseRuleBased({ expense: both, categoryList: CATEGORIES });
  assert.ok(out.confidence <= 0.5, `expected the lower of the two signals, got ${out.confidence}`);
});

test("the n8n copy carries the identical guard", () => {
  // Both gate copies move together (builder brief). The parity test compares
  // decisions; this asserts the guard itself exists in the deployed body, since
  // a decision-level test cannot see a confidence cap that never fires.
  const src = readFileSync(new URL("../workflows/nodes-uc02/expenseGates.js", import.meta.url), "utf8");
  assert.match(src, /AMBIGUOUS_MATCH_CONFIDENCE/, "the n8n classifier lost the tie guard");
  assert.match(src, /tiedAtBest/, "the n8n classifier no longer counts ties");
});
