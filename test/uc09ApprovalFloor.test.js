// ---------------------------------------------------------------------------
// uc09ApprovalFloor.test.js — the approval requirement may only ever go UP
// ---------------------------------------------------------------------------
// UC-09 is the one use case in this repository that executes a real
// payment-affecting write (`remote.createIncentive()`), and the only thing
// standing in front of that write is a count of humans. So the property this
// file exists to pin is not "the gate is correct" — it is the far narrower and
// far more checkable claim that **no change to this gate has reduced the number
// of signatures any input requires**.
//
// WHY IT NEEDS ITS OWN FILE. The three defects this file was written alongside
// were all in the same shape: a control that looked like it was working.
//
//   1. The high-value threshold was CURRENCY-BLIND. `adjustment.amount >
//      1000000` with no currency check anywhere, so one line meant "10,000 of
//      whatever unit arrived": 10,000 JPY (~USD 65) and 10,000 USD summoned the
//      same number of signatures. It always produced an answer, and the answer
//      was meaningless for every employee not paid in the one currency nobody
//      had ever written down. The fix denominates the line and refuses to
//      compare across currencies — and a fix to a money control is exactly the
//      kind of change that can quietly loosen the control it is fixing.
//
//   2. `riskBasis` was computed, audited and never persisted to the row the
//      approval screen reads.
//
//   3. `claimForExecution()` and `releaseExecutionClaim()` were each defined
//      TWICE in `AdjustmentStore`. JavaScript takes the later definition
//      silently. The bodies were identical, so nothing was broken — what was
//      broken was that a fix applied to the first copy would have done nothing
//      while reading as done, on the compare-and-set that is the only thing
//      between two concurrent approvals and two real payments.
//
// The tests below are deliberately PROPERTIES over a grid of inputs rather than
// worked examples. A worked example proves one input behaves; a property proves
// no input regressed, which is the claim actually being made.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  evaluate,
  assessRisk,
  INCENTIVE_REQUIRED_FIELDS,
  HIGH_AMOUNT_THRESHOLD_CURRENCY,
  HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
  HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY,
  HIGH_TAX_COMPLEXITY_COUNTRIES,
  highAmountThresholdFor,
  normalizeCurrencyCode,
} from "../src/uc09/policyEngine.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Both LLM seams switched off rather than mocked away — the real functions run
// their real unconfigured branch, so nothing here can reach OpenAI. UC-09 has
// bitten this repository before: `judge()` with no injected fake made every
// test in this use case ~750-830ms of doomed network call.
const fakeJudge = (args) => judgeNarrative(args, { isConfigured: () => false });

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------
// Every combination of the four things that can move the signature count, plus
// currencies on both sides of the line's denomination. 4 currencies × 5 amounts
// × 4 countries × 2 tax flags × 2 types = 320 inputs per property.

const CURRENCIES = [
  HIGH_AMOUNT_THRESHOLD_CURRENCY, // the one the line is stated in
  "EUR", // no stated policy figure — and worth ~more than USD
  "JPY", // no stated policy figure — and worth ~1% of USD, the case that made
  //        the currency-blind comparison absurd rather than merely wrong
  "usd", // the same currency, lower-cased: a normalisation slip must not
  //        silently become an "unknown currency" and vice versa
];
const AMOUNTS = [
  1, // 0.01
  100_000, // 1,000.00 — comfortably under
  HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER, // exactly on the line (NOT over: `>`)
  HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER + 1, // one unit over
  99_999_999, // absurdly over
];
const COUNTRIES = [HIGH_TAX_COMPLEXITY_COUNTRIES[0], "US", "PL", null];
const TAX_FLAGS = [false, true];
const TYPES = ["bonus", "allowance"];

function* grid() {
  for (const currency of CURRENCIES)
    for (const amount of AMOUNTS)
      for (const country_code of COUNTRIES)
        for (const taxAdjustment of TAX_FLAGS)
          for (const type of TYPES)
            yield {
              adjustment: { type, amount, currency, amountTaxType: "gross", taxAdjustment },
              employment: { id: "emp_grid", status: "active", company_id: "co_test", country_code },
            };
}

/**
 * The gate EXACTLY AS IT WAS BEFORE THE CURRENCY FIX — the reference every
 * property below is measured against.
 *
 * Restated here rather than imported, on purpose: the whole point is to compare
 * today's behaviour with yesterday's, and yesterday's no longer exists in
 * `src/`. It is six lines, it is the diff of this change, and it is the only
 * honest way to assert "nothing got cheaper" rather than merely asserting that
 * today's numbers are today's numbers.
 */
function slotsRequiredUnderTheOldCurrencyBlindRule({ adjustment, employment }) {
  let min = 2;
  if (adjustment.amount > 1000000) min = 3; // no currency check anywhere
  if (adjustment.taxAdjustment) min = 3;
  if (HIGH_TAX_COMPLEXITY_COUNTRIES.includes(employment.country_code)) min = 3;
  return Math.max(2, min);
}

// ---------------------------------------------------------------------------
// THE HEADLINE PROPERTY
// ---------------------------------------------------------------------------

test("INVARIANT: no input requires FEWER signatures than it did before the currency fix", () => {
  // The one direction a money control may never move. Stated as a property over
  // every input in the grid, because "I reasoned about it" is not a check and a
  // reduction on one currency in one corner of the matrix is exactly the shape
  // that would survive a reviewer reading the diff.
  let checked = 0;
  for (const input of grid()) {
    const before = slotsRequiredUnderTheOldCurrencyBlindRule(input);
    const after = evaluate({
      identityVerified: true,
      employment: input.employment,
      incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
      adjustment: input.adjustment,
      now: "2026-06-20T09:00:00.000Z",
    }).approvalSlotsRequired;

    assert.ok(
      after >= before,
      `approval requirement DROPPED from ${before} to ${after} for ` +
        `${JSON.stringify({ ...input.adjustment, country: input.employment.country_code })}`
    );
    checked += 1;
  }
  assert.equal(checked, 320, "the grid must actually be walked — a property over nothing proves nothing");
});

test("INVARIANT: the floor of two holds for every input in the grid, whatever the risk", () => {
  // policyEngine.js's `Math.max(2, …)`, asserted rather than read. The AI never
  // executes alone; two named humans do, at minimum, always.
  for (const input of grid()) {
    const risk = assessRisk(input.adjustment, input.employment);
    assert.ok(risk.minApprovalSlots >= 2, `assessRisk returned ${risk.minApprovalSlots}`);

    const result = evaluate({
      identityVerified: true,
      employment: input.employment,
      incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
      adjustment: input.adjustment,
      now: "2026-06-20T09:00:00.000Z",
    });
    assert.ok(result.approvalSlotsRequired >= 2, `evaluate returned ${result.approvalSlotsRequired}`);
    assert.ok(result.approvalSlotsRequired <= 3, "three is the ceiling; a fourth role does not exist");
  }
});

// ---------------------------------------------------------------------------
// The threshold table itself
// ---------------------------------------------------------------------------

test("INVARIANT: no per-currency threshold may sit ABOVE the base line", () => {
  // THE STRUCTURAL FORM OF "NEVER LOWER", and the guard that keeps the property
  // above true for rows nobody has added yet. A currency whose stated line is
  // HIGHER than the base one would let an amount that used to need three
  // signatures need only two — a reduction, arriving as a policy addition that
  // looks entirely reasonable in a diff. Adding such a row fails here.
  const entries = Object.entries(HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY);
  assert.ok(entries.length >= 1);
  for (const [currency, threshold] of entries) {
    assert.ok(Number.isInteger(threshold) && threshold > 0, `${currency}: ${threshold} is not a usable ×100 integer`);
    assert.ok(
      threshold <= HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
      `${currency}'s line (${threshold}) is above the base line (${HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER}), which would ` +
        "make some amount need FEWER signatures than it does today"
    );
  }
});

test("the table holds exactly the currencies a POLICY FIGURE exists for — one", () => {
  // Pinned so that adding a currency is a deliberate act with a test to update,
  // not a passing thought in a diff. A row here is only ever a STATED POLICY
  // FIGURE for that currency. It is NEVER an exchange-rate conversion of the
  // base line, and never the same numeral copied across currencies — which is
  // an exchange rate of 1.0 wearing a policy figure's clothes. An FX rate has a
  // source, a timestamp and a spread; this repository has none of those and
  // must not manufacture one on the path that POSTs money.
  assert.deepEqual(Object.keys(HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY), ["USD"]);
  assert.equal(HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY.USD, HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER);
  assert.equal(HIGH_AMOUNT_THRESHOLD_CURRENCY, "USD");
});

test("the threshold table cannot hand back an inherited Object.prototype member as a line", () => {
  // `src/uc02/policyCaps.js`'s lesson, one use case over: an object literal
  // inherits from Object.prototype, so `TABLE["constructor"]` returns a
  // FUNCTION that a `?? null` lookup happily treats as a threshold.
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    assert.equal(highAmountThresholdFor(key), null, `${key} must not resolve to a threshold`);
  }
});

test("an unreadable currency is null, and null means CANNOT COMPARE — never 'no line to clear'", () => {
  for (const junk of [null, undefined, "", "   ", 42, {}, [], "ZZZ", "eur"]) {
    const resolved = highAmountThresholdFor(junk);
    assert.equal(resolved, null, `${JSON.stringify(junk)} resolved to ${resolved}`);
  }
  // …and case/whitespace slips are normalised rather than treated as unknowns,
  // so a lower-cased "usd" is still compared instead of collecting a third
  // signature for a formatting difference.
  assert.equal(highAmountThresholdFor(" usd "), HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER);
  assert.equal(normalizeCurrencyCode(" usd "), "USD");
});

// ---------------------------------------------------------------------------
// What the currency fix actually changed, in both directions
// ---------------------------------------------------------------------------

const baseAdjustment = { type: "allowance", amountTaxType: "gross" };
const usEmployment = { id: "emp_us", status: "active", company_id: "co_test", country_code: "US" };

function decide(adjustment, employment = usEmployment) {
  return evaluate({
    identityVerified: true,
    employment,
    incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
    adjustment: { ...baseAdjustment, ...adjustment },
    now: "2026-06-20T09:00:00.000Z",
  });
}

test("POSITIVE: a request in the line's own currency still reaches TWO signatures", () => {
  // The test that would have failed if the fix had been implemented as "refuse
  // everything". A gate that structurally cannot succeed is indistinguishable
  // from one being appropriately cautious, and only a positive test tells them
  // apart — the lesson this repository has paid for more than once.
  const r = decide({ amount: 500_000, currency: "USD" });
  assert.equal(r.decision, "dual_approval_required");
  assert.equal(r.approvalSlotsRequired, 2);
  assert.ok(!r.flags.includes("high_amount_risk"));
  assert.ok(!r.flags.includes("high_amount_threshold_not_comparable"));
});

test("a currency with no stated policy figure is NOT COMPARED, and costs a third signature", () => {
  // 10,000 JPY is about USD 65. Under the old rule it was measured against the
  // same bare 1000000 as 10,000 USD and came out identical — the comparison ran,
  // produced an answer, and the answer was meaningless.
  const r = decide({ amount: 500_000, currency: "JPY" });
  assert.equal(r.approvalSlotsRequired, 3);
  assert.equal(r.decision, "triple_approval_required");
  assert.ok(r.flags.includes("high_amount_threshold_not_comparable"));
  assert.ok(
    !r.flags.includes("high_amount_risk"),
    "the amount was never found to be large — it was never measured, and the flags must not claim otherwise"
  );

  const value = r.riskBasis.find((b) => b.dimension === "adjustment_value");
  assert.equal(value.comparable, false);
  assert.equal(value.thresholdCurrency, "USD");
  assert.equal(value.statedCurrency, "JPY");
  assert.equal(value.thresholdRemoteInteger, null, "no line was applied, so none may be recorded as applied");
  assert.match(value.note, /NOT COMPARED/);
  assert.match(value.note, /must not invent/);
});

test("a missing currency is unable to be compared too — it does not fall back to the line's own", () => {
  // `validateAdjustment()` refuses a currency-less request at an earlier gate,
  // so this exercises assessRisk() directly. A default of "assume USD" here
  // would be the whole defect rebuilt one layer down.
  const risk = assessRisk({ type: "bonus", amount: 500_000, amountTaxType: "gross" }, usEmployment);
  assert.equal(risk.minApprovalSlots, 3);
  assert.ok(risk.flags.includes("high_amount_threshold_not_comparable"));
});

test("the line is exclusive: exactly on it needs two, one unit over needs three", () => {
  assert.equal(decide({ amount: HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER, currency: "USD" }).approvalSlotsRequired, 2);
  const over = decide({ amount: HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER + 1, currency: "USD" });
  assert.equal(over.approvalSlotsRequired, 3);
  assert.ok(over.flags.includes("high_amount_risk"));
});

test("an incomparable currency never LOWERS a requirement another dimension already raised", () => {
  // Both dimensions fire. The ceiling is three either way, and the not-comparable
  // branch must not overwrite `minApprovalSlots` downward on its way past.
  const r = decide(
    { amount: 5_000_000, currency: "EUR", taxAdjustment: true },
    { ...usEmployment, country_code: HIGH_TAX_COMPLEXITY_COUNTRIES[0] }
  );
  assert.equal(r.approvalSlotsRequired, 3);
  assert.ok(r.flags.includes("high_amount_threshold_not_comparable"));
  assert.ok(r.flags.includes("manual_tax_adjustment"));
  assert.ok(r.flags.includes("high_tax_compliance_risk"));
});

test("a refused request still opens NO approval path — an unknown currency cannot open one", () => {
  // The other direction of "never lower": the not-comparable branch raises a
  // requirement, and must never resurrect an approval path that an earlier gate
  // closed. `approvalSlotsRequired: 0` is "no path was opened", not "zero
  // signatures needed".
  const r = evaluate({
    identityVerified: false,
    employment: usEmployment,
    incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
    adjustment: { ...baseAdjustment, amount: 500_000, currency: "JPY" },
    now: "2026-06-20T09:00:00.000Z",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.approvalSlotsRequired, 0);
});

// ---------------------------------------------------------------------------
// riskBasis reaches the row the approval screen actually reads
// ---------------------------------------------------------------------------

const fakeRemote = {
  getEmployment: (id) => ({ id, status: "active", company_id: "co_test", country_code: "DE" }),
  getCountrySchema: () => ({ required: [] }),
  createIncentive: async () => ({ success: true }),
};
const fakeAudit = { log: () => {}, logDurable: () => {}, logTraceStep: () => {} };

test("riskBasis is persisted ON THE ADJUSTMENT ROW, not only in audit_log", () => {
  // It was computed, returned, written to the audit row — and then dropped,
  // because `createAdjustment()` neither accepted it nor had a column. So
  // `approvalView.js`'s and `decisionFacts.js`'s `row.riskBasis` lookups were
  // dead on every row that had ever existed, and the approval screen reported
  // the country as "not recorded" about a value the system was holding.
  const store = new AdjustmentStore();
  return handleAdjustmentRequest(
    {
      employmentId: "emp_de",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross", description: "x" },
      externalRef: "floor-riskbasis-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore: store, judge: fakeJudge }
  ).then(() => {
    const row = store.list()[0];
    assert.ok(Array.isArray(row.riskBasis), "the row must carry the decision's own risk basis");
    const jurisdiction = row.riskBasis.find((b) => b.dimension === "jurisdiction_tax_complexity");
    assert.equal(jurisdiction.observedCountryCode, "DE", "and it must name the country the gate actually compared");
  });
});

test("the INSERT names risk_basis, so a configured store really writes the column", () => {
  // The in-memory assertion above passes whether or not the SQL was updated —
  // the two backings are written by different code. A fake pool captures the
  // statement so the persisted path is checked rather than assumed.
  const statements = [];
  const pgPool = {
    query: (text, params) => {
      statements.push({ text, params });
      return Promise.resolve({ rows: [], rowCount: 1 });
    },
  };
  const store = new AdjustmentStore({ pgPool });
  const riskBasis = [{ dimension: "adjustment_value", comparable: false }];
  store.createAdjustment({
    employmentId: "emp_1",
    requester: "admin@acme.test",
    adjustment: { type: "bonus", amount: 1, currency: "USD" },
    adjustmentType: "bonus",
    processingDate: null,
    decision: "dual_approval_required",
    reason: "standard_adjustment_needs_dual_approval",
    flags: [],
    riskBasis,
  });

  const insert = statements.find((s) => /insert into uc09_adjustments/.test(s.text));
  assert.ok(insert, "createAdjustment must issue an INSERT when a pool is configured");
  assert.match(insert.text, /risk_basis/);
  assert.ok(
    insert.params.includes(JSON.stringify(riskBasis)),
    "the basis must be sent as a parameter, not dropped between the column list and the values"
  );
  // The column count and the placeholder count have to agree — the failure mode
  // of hand-editing a positional INSERT is an off-by-one that only shows up
  // against a real database.
  const columns = insert.text.match(/\(([^)]*)\)\s*\n?\s*values/i)[1].split(",").length;
  const placeholders = insert.text.match(/values\s*\(([^)]*)\)/i)[1].split(",").length;
  assert.equal(columns, placeholders);
  assert.equal(columns, insert.params.length);
});

test("the SELECT reads risk_basis back, so a row fetched from Postgres carries it too", () => {
  const source = readFileSync(join(__dirname, "..", "src", "uc09", "adjustmentStore.js"), "utf8");
  assert.match(source, /risk_basis\s+as\s+"riskBasis"/, "an unselected column is a column the approval screen never sees");
  assert.match(source, /riskBasis: coerceJson\(row\.riskBasis, null\)/, "jsonb may arrive as a string; it is coerced like every sibling column");
});

// ---------------------------------------------------------------------------
// The duplicate-definition guard
// ---------------------------------------------------------------------------

test("STRUCTURAL: no class member in src/uc09/ is declared twice", () => {
  // `claimForExecution()` and `releaseExecutionClaim()` were EACH defined twice
  // in AdjustmentStore. JavaScript takes the later definition silently — no
  // error, no warning, nothing in this repository's toolchain that notices. The
  // bodies were identical, so the defect was latent; what it was waiting to do
  // is make somebody's fix to the FIRST copy have no effect while reading, in
  // the diff and in review, as done. On a compare-and-set guarding a real
  // payment, "the edit you can see did nothing" is the most expensive shape a
  // latent defect takes.
  //
  // Matches methods declared at class-body indentation (two spaces), which is
  // this repository's uniform style, after comments and strings are stripped so
  // a method NAMED in a comment cannot be mistaken for a second declaration.
  const dir = join(__dirname, "..", "src", "uc09");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 8, "the guard must actually be looking at the use case");

  const duplicates = [];
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const seen = new Map();
    const method = /^ {2}(?:async\s+|static\s+|get\s+|set\s+)*(#?[A-Za-z_$][\w$]*)\s*\(/gm;
    let match;
    while ((match = method.exec(source)) !== null) {
      const name = match[1];
      if (["if", "for", "while", "switch", "catch", "return", "constructor"].includes(name)) continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    for (const [name, count] of seen) {
      if (count > 1) duplicates.push(`${file}: ${name}() declared ${count} times`);
    }
  }
  assert.deepEqual(duplicates, [], `a later declaration silently replaces an earlier one:\n${duplicates.join("\n")}`);
});

test("STRUCTURAL: the guard above actually catches a duplicate", () => {
  // A guard nobody has watched fail is a guard nobody knows works — the same
  // reason every gate in this repository has a positive test beside its
  // negative one. This re-runs the guard's own matcher against a source string
  // that deliberately declares a method twice.
  const source = `
export class Example {
  claimForExecution(id) {
    return id;
  }

  claimForExecution(id) {
    return id;
  }
}
`;
  const seen = new Map();
  const method = /^ {2}(?:async\s+|static\s+|get\s+|set\s+)*(#?[A-Za-z_$][\w$]*)\s*\(/gm;
  let match;
  while ((match = method.exec(source)) !== null) {
    seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
  }
  assert.equal(seen.get("claimForExecution"), 2);
});

// ---------------------------------------------------------------------------
// The n8n port carries the same line — checked over the WHOLE grid
// ---------------------------------------------------------------------------
// UC-09's gates exist twice: `src/uc09/policyEngine.js` and the "Adjustment
// Gates" Code node in `workflows/nodes-uc09/adjustmentGates.js`.
// `test/n8nUc09Parity.test.js` compares them scenario by scenario, and every
// one of its scenarios is stated in USD — so a currency fix applied to one copy
// and not the other would have passed the entire parity suite while the two
// execution paths disagreed about how many humans must sign a euro payment.
//
// This runs the ACTUAL deployed node body against the same 320-input grid the
// properties above use. Nothing here touches n8n, the network or any live
// service; the body is executed in a `node:vm` sandbox with `$()` mocked, and
// results are JSON round-tripped because vm results are cross-realm.
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc09", "adjustmentGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

function runGatesNode(adjustment, employment) {
  const ticket = {
    employmentId: employment.id,
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: adjustment,
    requestText: "",
    reasonText: "",
    externalRef: "ext_grid",
    source: "webhook",
    now: "2026-06-20T09:00:00.000Z",
  };
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Adjustment Request") return { first: () => ({ json: ticket }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: { data: { employment } } }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

test("PARITY: the n8n port sizes the signature set identically for all 320 inputs", () => {
  for (const input of grid()) {
    const real = evaluate({
      identityVerified: true,
      employment: input.employment,
      incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
      adjustment: input.adjustment,
      now: "2026-06-20T09:00:00.000Z",
    });
    const node = runGatesNode(input.adjustment, input.employment);
    const label = JSON.stringify({ ...input.adjustment, country: input.employment.country_code });

    assert.equal(node.approvalSlotsRequired, real.approvalSlotsRequired, `slots disagree for ${label}`);
    assert.equal(node.decision, real.decision, `decision disagrees for ${label}`);
    // `flags` is deep-equal-compared between the two paths, so the new flag has
    // to appear in BOTH copies or neither.
    assert.deepEqual([...node.flags].sort(), [...real.flags].sort(), `flags disagree for ${label}`);
    assert.ok(node.approvalSlotsRequired >= 2, `the n8n port must hold the floor too, for ${label}`);
  }
});
