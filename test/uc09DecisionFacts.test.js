// ---------------------------------------------------------------------------
// uc09DecisionFacts.test.js
//   Does the person authorising a real payment get the facts it turns on?
// ---------------------------------------------------------------------------
// SAME DISCIPLINE AS test/mediumTierDecisionFacts.test.js, applied to the one
// use case that actually moves money. docs/CORRECTIONS-LOG.md pattern P7 —
// "said less than it knew" — cannot be caught by asserting the decision, because
// the decision was right and the sentence describing it was true. So every
// assertion here is either
//
//   (a) the figure the decision was made from is present, and it is the right
//       figure — the only shape that fails when a surface is truthful and
//       incomplete; or
//   (b) an absent figure is reported as absent, never defaulted — a 0 that means
//       "we never counted" is worse than a blank, because a blank gets
//       investigated and a number gets acted on.
//
// THE FIXTURES ARE THE REAL ENGINE'S OUTPUT, not hand-written rows. A hand-built
// `flags` array would let this file agree with itself while disagreeing with
// policyEngine.js, which is exactly the fixtures-agree-with-the-code failure
// CLAUDE.md §4 names as the reason so many defects here were invisible. Every
// row below comes out of handleAdjustmentRequest() against a fake Remote.
//
// HERMETIC AND FAST. handleAdjustmentRequest() calls judge() on every run and
// the parser reaches an LLM on the free-text branch; both are injected as
// non-configured fakes, which is why this file runs in milliseconds rather than
// the ~750-830ms per test UC-09 has cost this repo before.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeAdjustmentBasis, DECIDERS } from "../src/uc09/decisionFacts.js";
import {
  GATE_SEQUENCE,
  HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
  HIGH_TAX_COMPLEXITY_HEURISTIC,
  INCENTIVE_REQUIRED_FIELDS,
} from "../src/uc09/policyEngine.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPANY = "co_test";
const SESSION = { companyId: COMPANY, authenticatedAdminId: "admin_test" };

/** country_code is the one field the jurisdiction dimension turns on. */
function fakeRemote(countryCode = "US") {
  return {
    getEmployment: async (id) =>
      id === "emp_gone"
        ? null
        : { id, status: id === "emp_inactive" ? "terminated" : "active", company_id: COMPANY, country_code: countryCode },
    createIncentive: async (payload) => ({ success: true, incentiveId: "inc_test", ...payload }),
  };
}

// The two LLM seams, both switched off rather than mocked away — the real
// functions run their real fallback path, so nothing here can reach OpenAI.
const fakeJudge = (args) => judgeNarrative(args, { isConfigured: () => false });

/** Run the REAL workflow and hand back the stored row. */
async function row({ adjustmentRequest, countryCode = "US", employmentId = "emp_1", ref = "t-1" }) {
  const store = new AdjustmentStore();
  const audit = new AuditLogger();
  await handleAdjustmentRequest(
    { employmentId, session: SESSION, adjustmentRequest, externalRef: ref, now: "2026-06-20T09:00:00.000Z" },
    { remote: fakeRemote(countryCode), audit, adjustmentStore: store, judge: fakeJudge }
  );
  return store.list()[0];
}

const STANDARD = {
  type: "bonus",
  amount: 500_000, // 5,000.00 — under the high-value line
  currency: "USD",
  amountTaxType: "gross",
  description: "Annual performance bonus",
};

const dim = (basis, key) => basis.dimensions.find((d) => d.key === key);

// ---------------------------------------------------------------------------
// Structural — a describer that could decide is a gate nobody reviewed
// ---------------------------------------------------------------------------

test("UC-09 basis: the describer takes no client, store or logger — it cannot change an outcome", () => {
  const source = readFileSync(new URL("../src/uc09/decisionFacts.js", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    ""
  );
  for (const forbidden of ["remote.", "zendesk.", "audit.", "pgPool", "Date.now(", "new Date("]) {
    assert.equal(source.includes(forbidden), false, `decisionFacts.js must not reference ${forbidden}`);
  }
});

test("UC-09 basis: no row yields null, never an empty shell that reads like an account", () => {
  assert.equal(describeAdjustmentBasis({ adjustmentRow: null }), null);
  assert.equal(describeAdjustmentBasis({}), null);
});

// ---------------------------------------------------------------------------
// The deciders
// ---------------------------------------------------------------------------

test("UC-09 basis: a two-signature adjustment does NOT list a payment releaser as a decider", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  assert.deepEqual(
    basis.roles.map((r) => r.role),
    ["requester", "approver"]
  );
  // A person told they have a decision when they have none is a person who
  // waits for a signature nobody is coming to give.
  assert.equal(
    basis.roles.some((r) => r.role === "payment_releaser"),
    false
  );
});

test("UC-09 basis: a three-signature adjustment lists the payment releaser, with their OWN question", async () => {
  const basis = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, amount: 1_500_000 } }),
  });
  const releaser = basis.roles.find((r) => r.role === "payment_releaser");
  assert.ok(releaser, "the third role must be named once it is required");
  const questions = new Set(basis.roles.map((r) => r.decides));
  assert.equal(questions.size, basis.roles.length, "each role decides a DIFFERENT question, not one shared blob");
  assert.match(releaser.decides, /which dimension/i);
  assert.deepEqual(
    DECIDERS.map((d) => d.role),
    ["requester", "approver", "payment_releaser"]
  );
});

// ---------------------------------------------------------------------------
// The money — the figure, its currency, its gross/net reading, its scaling
// ---------------------------------------------------------------------------

test("UC-09 basis: the amount is stated in human units with its currency, never as the ×100 integer alone", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  const amount = dim(basis, "payment_amount");
  assert.equal(amount.state, "cleared");
  const value = amount.evidence.find((e) => e.label === "Amount").value;
  assert.equal(value, "5,000.00 USD");
  assert.equal(value.includes("500000"), false, "the scaled integer must never be the headline figure");
});

test("UC-09 basis: the ×100 form is shown as WHAT WILL BE SENT, joined to the human figure", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  const sent = dim(basis, "payment_amount").evidence.find((e) => e.label === "Sent to Remote as").value;
  // Both numbers in one row is the whole point: a reader who meets 500000 in
  // one place and 5,000.00 in another, with nothing joining them, is one glance
  // from a hundredfold error.
  assert.match(sent, /500000/);
  assert.match(sent, /5,000\.00 USD/);
  assert.match(sent, /×100/);
});

test("UC-09 basis: gross and net are stated as what they cost the COMPANY, not as a label", async () => {
  const gross = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  assert.match(dim(gross, "payment_amount").finding, /before tax/i);

  const net = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, amountTaxType: "net" }, ref: "t-net" }),
  });
  // Remote grosses a `net` amount up, so the company pays MORE than the figure
  // on the screen. Saying only "net" leaves that to be known rather than read.
  assert.match(dim(net, "payment_amount").finding, /company pays MORE/i);
});

test("UC-09 basis: an amount that could not be read is UNKNOWN, never a figure under the line", async () => {
  const stored = await row({
    adjustmentRequest: { ...STANDARD, amount: "500000" }, // a JSON payload that quoted its number
    ref: "t-bad-amount",
  });
  const basis = describeAdjustmentBasis({ adjustmentRow: stored });
  const amount = dim(basis, "payment_amount");
  assert.equal(amount.state, "unknown");
  assert.ok(amount.whatItWouldTake, "an unknown with no next step is a shrug");

  // And the threshold row must not manufacture a comparison out of it.
  const threshold = basis.measurements.find((m) => m.key === "high_value_threshold");
  if (threshold) {
    assert.equal(threshold.measured, null);
    assert.equal(threshold.state, "unknown");
  }
  assert.ok(
    basis.unknowns.some((u) => /amount/i.test(u.what)),
    "a missing amount is collected as an unknown rather than left to be noticed"
  );
});

// ---------------------------------------------------------------------------
// The approval floor — the headline safety property of this use case
// ---------------------------------------------------------------------------

test("UC-09 basis: the floor of 2 is stated as a floor, and as unlowerable, not just as a count", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  const floor = dim(basis, "approval_floor");
  assert.equal(floor.state, "attention");
  assert.match(floor.finding, /floor is 2/i);
  assert.match(floor.finding, /risk can only ever raise it/i);
  const floorRow = floor.evidence.find((e) => e.label === "Floor").value;
  // THE GUARANTEE SURVIVES; THE EXPRESSION THAT IMPLEMENTS IT DOES NOT. This
  // row used to read "guaranteed by `Math.max(2, …)` in the policy engine",
  // which asks a payment approver to take reassurance from a line of source
  // code they cannot see. What they need is the property: two is a floor, and
  // nothing on the risk side can ever produce fewer.
  assert.match(floorRow, /floor/i);
  assert.match(floorRow, /never|cannot|can ever produce fewer/i);
  assert.equal(/Math\.max/.test(floorRow), false, "an approver must not be shown the implementation");
  assert.equal(/policy engine/i.test(floorRow), false, "nor the name of the module that holds it");
  assert.equal(floor.evidence.find((e) => e.label === "Signatures required").value, "2");
});

test("UC-09 basis: a three-signature case says WHICH dimensions raised it above the floor", async () => {
  const basis = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, amount: 1_500_000 }, ref: "t-high" }),
  });
  const why = dim(basis, "approval_floor").evidence.find((e) => e.label === "Why this number").value;
  assert.match(why, /above the floor/i);
  assert.match(why, /adjustment value/i);
});

test("UC-09 basis: an escalated row reports NO approval path — never 'zero signatures required'", async () => {
  const stored = await row({ adjustmentRequest: STANDARD, employmentId: "emp_inactive", ref: "t-inactive" });
  const basis = describeAdjustmentBasis({ adjustmentRow: stored });
  const floor = dim(basis, "approval_floor");
  assert.equal(floor.state, "not_assessed");
  // The two facts are opposite and only one of them is reassuring.
  assert.match(floor.finding, /never reached/i);
  assert.equal(floor.evidence.find((e) => e.label === "Signatures required").value, "none offered");
});

test("UC-09 basis: the segregation-of-duties constraint is stated BEFORE it refuses anyone", async () => {
  const store = new AdjustmentStore();
  const audit = new AuditLogger();
  await handleAdjustmentRequest(
    { employmentId: "emp_1", session: SESSION, adjustmentRequest: STANDARD, externalRef: "t-sod", now: "2026-06-20T09:00:00.000Z" },
    { remote: fakeRemote(), audit, adjustmentStore: store, judge: fakeJudge }
  );
  const created = store.list()[0];
  await store.recordApproval(created.id, "requester", "Bob Smith", "1/2");

  const basis = describeAdjustmentBasis({ adjustmentRow: await store.findById(created.id) });
  const floor = dim(basis, "approval_floor");
  assert.match(floor.evidence.find((e) => e.label === "Already signed").value, /Requester: Bob Smith/);
  assert.match(floor.evidence.find((e) => e.label === "Still outstanding").value, /Approver/);
  assert.match(
    floor.evidence.find((e) => e.label === "May not sign again").value,
    /Bob Smith.*segregation of duties/is
  );
});

// ---------------------------------------------------------------------------
// The risk drivers, kept apart — three reasons, three answers, three bases
// ---------------------------------------------------------------------------

test("UC-09 basis: the value threshold carries BOTH sides and the overage, not just a flag", async () => {
  const basis = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, amount: 1_500_000 }, ref: "t-over" }),
  });
  const value = dim(basis, "value_threshold");
  assert.equal(value.state, "attention");
  assert.equal(value.evidence.find((e) => e.label === "This adjustment").value, "15,000.00 USD");
  assert.equal(
    value.evidence.find((e) => e.label === "High-value line").value,
    `${(HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`
  );
  assert.equal(value.evidence.find((e) => e.label === "Over the line by").value, "5,000.00 USD");

  const m = basis.measurements.find((x) => x.key === "high_value_threshold");
  assert.equal(m.state, "breached");
  assert.equal(m.measuredRemoteInteger, 1_500_000);
  assert.equal(m.limitRemoteInteger, HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER);
  // Money in the RENDERED fields is formatted; the scaled integers travel in
  // their own keys. The renderer prints `limit + unit` verbatim.
  assert.equal(m.limit, "10,000.00 USD");
});

test("UC-09 basis: the value threshold names its own basis — a repo value, not a statutory one", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  const basisRow = dim(basis, "value_threshold").evidence.find((e) => e.label === "Basis for the line").value;
  // "defined in this repository" told the approver where the number LIVES.
  // What they need is who stands behind it: an internal policy figure, with no
  // external authority publishing it. That second half is the honest limit and
  // is asserted unchanged.
  assert.match(basisRow, /internal policy figure/i);
  assert.match(basisRow, /no external authority/i);
  assert.equal(/repository/i.test(basisRow), false);
});

test("UC-09 basis: the high-value line prints in ITS currency, and a request in another is NOT COMPARED", async () => {
  // THIS TEST USED TO PIN THE DEFECT. It asserted the line rendered as
  // "10,000.00 EUR" for a euro request, with a sentence underneath admitting
  // the comparison was currency-blind — a figure claiming a denomination the
  // gate had never checked, on the screen a payment releaser signs, with the
  // apology in smaller print below it. The gate is no longer blind, so the
  // rendering states the real denomination instead of apologising for a wrong
  // one, and a euro request is reported as unmeasured rather than as small.
  const basis = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, currency: "EUR" }, ref: "t-eur" }),
  });
  const value = dim(basis, "value_threshold");
  assert.equal(value.evidence.find((e) => e.label === "High-value line").value, "10,000.00 USD");
  assert.equal(
    value.evidence.find((e) => e.label === "Comparable with this request").value,
    "no — the request is stated in EUR and no policy figure exists for it"
  );

  // NOT `cleared`. A €5,000.00 request is under 10,000 as a bare integer, and
  // the old gate said so; nothing about its size was ever established.
  assert.equal(value.state, "attention");
  assert.match(value.finding, /NOT COMPARED/);
  assert.match(value.finding, /not a finding that the amount is large/i);
  assert.match(value.whatItWouldTake, /stated policy figure for EUR/);
  assert.match(value.whatItWouldTake, /exchange rate of 1\.0 in disguise/);

  const basisRow = value.evidence.find((e) => e.label === "Basis for the line").value;
  assert.match(basisRow, /denominated in USD/);
  assert.match(basisRow, /must not invent on a payment gate/);
});

test("UC-09 basis: a request in the line's OWN currency is compared, and says so", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, ref: "t-usd-cmp" }) });
  const value = dim(basis, "value_threshold");
  assert.equal(value.state, "cleared");
  assert.equal(
    value.evidence.find((e) => e.label === "Comparable with this request").value,
    "yes — the request is stated in USD, the same currency as the line"
  );
});

test("UC-09 basis: an effective date nobody asked for is labelled DEFAULTED, not printed as a choice", async () => {
  const stated = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, effectiveDate: "2026-07-01" }, ref: "t-eff" }),
  });
  assert.equal(
    dim(stated, "payment_amount").evidence.find((e) => e.label === "Effective date").value,
    "2026-07-01"
  );

  // Remote decides which payroll run pays this from `effective_date`, and
  // prepareIncentivePayload() falls back to the day of assessment when the
  // request names none. A date nobody chose must not read as a date somebody
  // did.
  const defaulted = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, ref: "t-noeff" }) });
  assert.match(
    dim(defaulted, "payment_amount").evidence.find((e) => e.label === "Effective date").value,
    /DEFAULTED: the request named no effective date/
  );
});

test("UC-09 basis: a manual tax adjustment is reported as stated by the requester, not inferred", async () => {
  const on = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, taxAdjustment: true }, ref: "t-tax" }),
  });
  const d = dim(on, "manual_tax_adjustment");
  assert.equal(d.state, "attention");
  assert.match(d.evidence.find((e) => e.label === "Basis").value, /the requester stated, not an inference/i);

  const off = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, ref: "t-notax" }) });
  assert.equal(dim(off, "manual_tax_adjustment").state, "cleared");
});

// ---------------------------------------------------------------------------
// THE ONE THAT MATTERS MOST — the unsourced three-country list
// ---------------------------------------------------------------------------

test("UC-09 basis: a DE adjustment says the third signature rests on an UNSOURCED list", async () => {
  const stored = await row({ adjustmentRequest: STANDARD, countryCode: "DE", ref: "t-de" });
  // Precondition: nothing else raised it. The only reason for three signatures
  // here is a list somebody invented.
  assert.equal(stored.approvalSlotsRequired, 3);
  assert.equal(stored.flags.includes("high_amount_risk"), false);
  assert.equal(stored.flags.includes("manual_tax_adjustment"), false);

  const basis = describeAdjustmentBasis({ adjustmentRow: stored });
  const j = dim(basis, "jurisdiction_tax_complexity");
  assert.equal(j.state, "attention");
  assert.match(j.finding, /UNSOURCED/);
  assert.match(j.finding, /invented three-country list \(DE, FR, IT\)/);
  assert.match(j.finding, /not a researched statement/i);
  assert.equal(j.evidence.find((e) => e.label === "Publishing authority").value, "none named");
  assert.equal(j.evidence.find((e) => e.label === "Version").value, "none");
  assert.ok(j.whatItWouldTake, "a list with no authority must carry what a real one would need");
  for (const requirement of HIGH_TAX_COMPLEXITY_HEURISTIC.requiredForARealVersion) {
    assert.ok(j.whatItWouldTake.includes(requirement), `whatItWouldTake must carry: ${requirement}`);
  }
});

test("UC-09 basis: the unsourced list is what the payment releaser is TOLD they were summoned by", async () => {
  const basis = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: STANDARD, countryCode: "FR", ref: "t-fr" }),
  });
  // `deciding` is lifted out so nobody has to scan seven dimensions to find it,
  // and the releaser's own headline points at the same finding.
  assert.equal(basis.deciding.key, "jurisdiction_tax_complexity");
  assert.match(basis.deciding.finding, /UNSOURCED/);
  const releaser = basis.roles.find((r) => r.role === "payment_releaser");
  assert.match(releaser.headline, /UNSOURCED/);
});

test("UC-09 basis: a country NOT on the list reports UNKNOWN — absence from an invented list is not a pass", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, countryCode: "US" }) });
  const j = dim(basis, "jurisdiction_tax_complexity");
  // The mutation this exists to catch: `cleared` here would tell an approver a
  // jurisdiction was assessed and found simple. Nothing assessed it.
  assert.equal(j.state, "unknown");
  assert.equal(j.state === "cleared", false);
  assert.match(j.finding, /NOT a finding that its payroll tax is straightforward/i);
  assert.match(j.finding, /nobody looked/i);
  // The direction of the harm, stated: a complex jurisdiction outside the three
  // gets two signatures, silently.
  assert.match(j.finding, /two signatures rather than three/i);
});

test("UC-09 basis: which country fired the gate is NAMED, because the row now persists riskBasis", async () => {
  // THIS TEST USED TO PIN THE DEFECT TOO, and honestly: the country was
  // reported as "not recorded on this row" because `createAdjustment()` had no
  // `risk_basis` column and dropped the policy engine's own basis on the way
  // in. The value was computed, returned and written to `audit_log` — so the
  // approval screen said "not recorded" about a fact the system was holding.
  // The column exists now and the workflow fills it.
  const stored = await row({ adjustmentRequest: STANDARD, countryCode: "IT", ref: "t-it" });
  assert.ok(Array.isArray(stored.riskBasis), "the stored row carries the decision's own risk basis");
  const basis = describeAdjustmentBasis({ adjustmentRow: stored });
  const country = dim(basis, "jurisdiction_tax_complexity").evidence.find((e) => e.label === "The employment's country");
  assert.equal(country.value, "IT");
  assert.equal(
    basis.unknowns.some((u) => /which country/i.test(u.what)),
    false,
    "a fact the row now carries must not still be listed as an unknown"
  );
});

test("UC-09 basis: a row with NO riskBasis still reports the country as not recorded, never inferred", async () => {
  // The n8n graph's Supabase insert does not map `risk_basis`, and rows written
  // before the column existed carry none. An honest blank beats an inferred
  // "IT" — the gap stays collected rather than left to be noticed by absence.
  const stored = await row({ adjustmentRequest: STANDARD, countryCode: "IT", ref: "t-it-legacy" });
  const legacy = { ...stored, riskBasis: null };
  const basis = describeAdjustmentBasis({ adjustmentRow: legacy });
  const country = dim(basis, "jurisdiction_tax_complexity").evidence.find((e) => e.label === "The employment's country");
  assert.equal(country.value, "not recorded on this request");
  const gap = basis.unknowns.find((u) => /which country/i.test(u.what));
  assert.ok(gap, "the gap is collected rather than left to be noticed by its absence");
  // The gap is stated in the reader's terms — WHAT is missing and what closing
  // it would take — rather than by naming the field and the insert that drops
  // it. The honest half is untouched: the country is not held, and is not
  // guessed at from anything else on the request.
  assert.match(gap.whatItWouldTake, /country recorded on the request/i);
  assert.equal(/riskBasis|risk_basis|uc09_adjustments|n8n/.test(gap.whatItWouldTake + gap.why), false);
  assert.match(gap.why, /not kept on this request/i);
});

test("UC-09 basis: a row that DOES carry riskBasis names the country instead of guessing", async () => {
  const stored = await row({ adjustmentRequest: STANDARD, countryCode: "DE", ref: "t-de2" });
  const withBasis = {
    ...stored,
    riskBasis: [{ dimension: "jurisdiction_tax_complexity", observedCountryCode: "DE" }],
  };
  const j = dim(describeAdjustmentBasis({ adjustmentRow: withBasis }), "jurisdiction_tax_complexity");
  assert.equal(j.evidence.find((e) => e.label === "The employment's country").value, "DE");
  assert.match(j.finding, /the country is DE/);
});

// ---------------------------------------------------------------------------
// The payload schema, and the ordering that makes it worth checking
// ---------------------------------------------------------------------------

test("UC-09 basis: the required fields are Remote's own list, said in the reader's words", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  const schema = dim(basis, "payload_schema");
  assert.equal(schema.state, "cleared");
  const required = schema.evidence.find((e) => e.label === "Fields Remote requires").value;

  // STILL REMOTE'S LIST, NOT A COPY: one entry per field, so a field added or
  // removed at Remote changes this row rather than leaving it stale.
  assert.equal(required.split(", ").length, INCENTIVE_REQUIRED_FIELDS.length);
  // AND NOT IN REMOTE'S VOCABULARY. `amount_tax_type` on a payment screen asks
  // the person signing to translate an API field name into the question it
  // actually stands for — which is the one that decides how much the company
  // pays.
  // Only the compound API names can be told apart from ordinary English —
  // "amount" is both a field name and the word for the thing. `amount_tax_type`
  // is the one that matters anyway: it is the field whose absence would have
  // been silently paid for in cash.
  for (const field of INCENTIVE_REQUIRED_FIELDS.filter((f) => f.includes("_"))) {
    assert.equal(required.includes(field), false, `the raw field name ${field} reached the reader`);
  }
  assert.match(required, /gross or net/i);
  assert.match(required, /the amount/i);

  const carried = schema.evidence.find((e) => e.label === "What the drafted record carries").value;
  assert.equal(/amount_tax_type|employment_id|effective_date/.test(carried), false);
});

test("UC-09 basis: a missing field is named as the thing it is, not as the field that holds it", async () => {
  // A payload short of a required field is the `schema_invalid` branch. What
  // the signer needs is WHAT is missing in terms they can act on — the fixture
  // is driven through the real engine so the flag shape is the engine's own.
  const stored = await row({
    adjustmentRequest: { ...STANDARD, amountTaxType: undefined },
    ref: "t-missing-field",
  });
  const schema = dim(describeAdjustmentBasis({ adjustmentRow: stored }), "payload_schema");
  const missingRow = schema.evidence.find((e) => e.label === "Missing");
  if (missingRow) assert.equal(/amount_tax_type/.test(missingRow.value), false);
  assert.equal(/amount_tax_type/.test(schema.finding), false);
});

test("UC-09 basis: gates that never ran report not_assessed — never cleared", async () => {
  const stored = await row({ adjustmentRequest: STANDARD, employmentId: "emp_inactive", ref: "t-notrun" });
  const basis = describeAdjustmentBasis({ adjustmentRow: stored });
  // A check that never ran approved of nothing. Collapsing any of these into
  // "cleared" is how an unevaluated dimension reaches a one-click approval.
  for (const key of ["value_threshold", "manual_tax_adjustment", "jurisdiction_tax_complexity"]) {
    assert.equal(dim(basis, key).state, "not_assessed", `${key} must not read as assessed`);
  }
  assert.deepEqual(basis.measurements, [], "no threshold row is emitted for a comparison that never happened");
});

// ---------------------------------------------------------------------------
// The freshness re-read — the gate that runs last
// ---------------------------------------------------------------------------

test("UC-09 basis: a pending row says plainly that nothing confirms the employee is still active", async () => {
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD }) });
  const fresh = dim(basis, "employment_freshness");
  assert.equal(fresh.state, "unavailable");
  assert.equal(fresh.state === "cleared", false);
  assert.match(fresh.finding, /Nothing here confirms the employee is still active today/i);
  assert.match(fresh.finding, /final signature/i);
  assert.ok(basis.unknowns.some((u) => /still active/i.test(u.what)));
});

test("UC-09 basis: an executed row reports the re-read as done, and whether Remote answered", async () => {
  const store = new AdjustmentStore();
  const audit = new AuditLogger();
  await handleAdjustmentRequest(
    { employmentId: "emp_1", session: SESSION, adjustmentRequest: STANDARD, externalRef: "t-exec", now: "2026-06-20T09:00:00.000Z" },
    { remote: fakeRemote(), audit, adjustmentStore: store, judge: fakeJudge }
  );
  const created = store.list()[0];
  await store.markExecuted(created.id, { success: true, incentiveId: "inc_test" });

  const fresh = dim(describeAdjustmentBasis({ adjustmentRow: await store.findById(created.id) }), "employment_freshness");
  assert.equal(fresh.state, "cleared");
  assert.match(fresh.finding, /re-read immediately before the payment/i);
});

test("UC-09 basis: a row left mid-execution is a FINDING, not progress", async () => {
  const store = new AdjustmentStore();
  const audit = new AuditLogger();
  await handleAdjustmentRequest(
    { employmentId: "emp_1", session: SESSION, adjustmentRequest: STANDARD, externalRef: "t-inflight", now: "2026-06-20T09:00:00.000Z" },
    { remote: fakeRemote(), audit, adjustmentStore: store, judge: fakeJudge }
  );
  const created = store.list()[0];
  await store.claimForExecution(created.id);

  const fresh = dim(describeAdjustmentBasis({ adjustmentRow: await store.findById(created.id) }), "employment_freshness");
  assert.equal(fresh.state, "attention");
  assert.match(fresh.finding, /may or may not have reached Remote/i);
});

// ---------------------------------------------------------------------------
// Shape — what the shell will actually render
// ---------------------------------------------------------------------------

test("UC-09 basis: every dimension carries a state the sidebar knows, and none is a bare boolean", async () => {
  const known = new Set(["cleared", "attention", "blocking", "unknown", "unavailable", "not_assessed"]);
  const rows = [
    await row({ adjustmentRequest: STANDARD, ref: "s-1" }),
    await row({ adjustmentRequest: { ...STANDARD, amount: 1_500_000 }, countryCode: "IT", ref: "s-2" }),
    await row({ adjustmentRequest: STANDARD, employmentId: "emp_inactive", ref: "s-3" }),
    await row({ adjustmentRequest: { ...STANDARD, amount: "x" }, ref: "s-4" }),
  ];
  for (const stored of rows) {
    const basis = describeAdjustmentBasis({ adjustmentRow: stored });
    assert.equal(basis.dimensions.length, 7);
    basis.dimensions.forEach((d, i) => {
      assert.equal(d.position, i + 1, "positions are the reading order, contiguous from 1");
      assert.ok(known.has(d.state), `unknown state ${d.state} on ${d.key}`);
      assert.ok(d.question && d.finding, `${d.key} must carry both its question and its finding`);
      assert.ok(Array.isArray(d.evidence));
    });
  }
});

test("UC-09 basis: `deciding` never points at the approval floor — that is the outcome, not the cause", async () => {
  for (const [amount, country, ref] of [
    [1_500_000, "US", "d-1"],
    [500_000, "DE", "d-2"],
    [500_000, "US", "d-3"],
  ]) {
    const basis = describeAdjustmentBasis({
      adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, amount }, countryCode: country, ref }),
    });
    assert.notEqual(basis.deciding?.key, "approval_floor");
  }
});

// ---------------------------------------------------------------------------
// THE STAKEHOLDER PASS — is this written for the person who has to sign it?
// ---------------------------------------------------------------------------
// Everything below asks one question of the assembled panel: could the payroll
// specialist or payment releaser reading it act on what it says, without
// knowing anything about how this system is built. Equality assertions on
// individual sentences cannot answer that — they pin the sentence that exists,
// which is how `pending_approval` and `Math.max(2, …)` survived on a payment
// screen through a full test suite. The scan below is the assertion that
// generalises: it fails on a CLASS of string, so the next slug to reach a
// reader fails it too, whoever writes it and wherever they put it.
// ---------------------------------------------------------------------------

/** The keys a human actually reads. Machine keys (`key`, `role`, `state`) are
 *  the shell's wiring and are deliberately not scanned — renaming them would
 *  break the renderer without helping anyone. */
const READER_FACING_KEYS = new Set([
  "label",
  "value",
  "finding",
  "question",
  "decides",
  "headline",
  "note",
  "means",
  "checks",
  "statement",
  "summary",
  "what",
  "why",
  "whatItWouldTake",
  "detail",
  "provenance",
  "headroom",
  "limit",
  "measured",
]);

/** Strings that read as source code rather than as English. */
const CODE_SHAPED = [
  [/`[^`]+`/, "a backticked identifier"],
  [/\b[\w./-]+\.(?:js|mjs|json|md)\b/, "a file path"],
  [/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/, "a snake_case identifier or status slug"],
  [/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/, "a SCREAMING_SNAKE constant name"],
  [/\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(/, "a method call"],
  [/\b[A-Za-z_$][\w$]*\(\)/, "a function name"],
];

/** Walk an assembled panel and hand back every string a reader will meet. */
function readerStrings(node, path = "basis", out = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => readerStrings(item, `${path}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string") {
        if (READER_FACING_KEYS.has(k)) out.push([`${path}.${k}`, v]);
      } else {
        readerStrings(v, `${path}.${k}`, out);
      }
    }
  }
  return out;
}

function assertReadable(strings) {
  const offences = [];
  for (const [where, text] of strings) {
    for (const [pattern, what] of CODE_SHAPED) {
      const hit = text.match(pattern);
      if (hit) offences.push(`${where}: ${what} — "${hit[0]}" in: ${text.slice(0, 140)}`);
    }
  }
  assert.deepEqual(offences, [], `these strings are written for the person who built this, not the person using it:\n${offences.join("\n")}`);
}

test("UC-09 basis: nothing a signer reads is written in the codebase's own vocabulary", async () => {
  // Every branch this panel has, so the scan covers the rows a reader is most
  // likely to meet on a bad day as well as the happy one.
  const rows = [
    await row({ adjustmentRequest: STANDARD, ref: "v-standard" }),
    await row({ adjustmentRequest: { ...STANDARD, amount: 1_500_000 }, ref: "v-over" }),
    await row({ adjustmentRequest: { ...STANDARD, currency: "EUR" }, ref: "v-eur" }),
    await row({ adjustmentRequest: { ...STANDARD, taxAdjustment: true }, ref: "v-tax" }),
    await row({ adjustmentRequest: STANDARD, countryCode: "DE", ref: "v-de" }),
    await row({ adjustmentRequest: { ...STANDARD, type: "retroactive_pay" }, ref: "v-type" }),
    await row({ adjustmentRequest: { ...STANDARD, amount: "500000" }, ref: "v-badamount" }),
    await row({ adjustmentRequest: { ...STANDARD, amountTaxType: undefined }, ref: "v-notax" }),
    await row({ adjustmentRequest: STANDARD, employmentId: "emp_inactive", ref: "v-inactive" }),
  ];
  for (const stored of rows) {
    assertReadable(readerStrings(describeAdjustmentBasis({ adjustmentRow: stored })));
  }
});

test("UC-09 basis: the executed, mid-execution and declined rows read as plainly as the pending one", async () => {
  const build = async (ref) => {
    const store = new AdjustmentStore();
    const audit = new AuditLogger();
    await handleAdjustmentRequest(
      { employmentId: "emp_1", session: SESSION, adjustmentRequest: STANDARD, externalRef: ref, now: "2026-06-20T09:00:00.000Z" },
      { remote: fakeRemote(), audit, adjustmentStore: store, judge: fakeJudge }
    );
    return { store, id: store.list()[0].id };
  };

  const executed = await build("s-executed");
  await executed.store.markExecuted(executed.id, { success: true, incentiveId: "inc_test" });
  const inflight = await build("s-inflight");
  await inflight.store.claimForExecution(inflight.id);

  for (const { store, id } of [executed, inflight]) {
    assertReadable(readerStrings(describeAdjustmentBasis({ adjustmentRow: await store.findById(id) })));
  }
});

test("UC-09 gate ladder: every rung is written for the person deciding, not the person debugging", () => {
  // `decidedBy.means` is the panel's OPENING SENTENCE (zaf-app/assets/main.js),
  // so a field name in it is the first thing a payment approver reads.
  assertReadable(
    GATE_SEQUENCE.flatMap((rung) => [
      [`GATE_SEQUENCE[${rung.position}].checks`, rung.checks],
      [`GATE_SEQUENCE[${rung.position}].means`, rung.means],
    ])
  );
});

test("UC-09 gate ladder: the triple-approval rung names the factors AND keeps both health warnings", () => {
  const rung = GATE_SEQUENCE.find((r) => r.reason === "high_risk_adjustment_needs_triple_approval");
  // WHERE TO LOOK, OR WHAT IT WAS — never the name of a payload field. This
  // sentence used to end "…is on `riskBasis`", which is a key in a response
  // body the approver never sees.
  assert.equal(/riskBasis/.test(rung.means), false);
  assert.match(rung.means, /manual tax adjustment/i);
  assert.match(rung.means, /high-value line/i);
  assert.match(rung.means, /high-tax-complexity list/i);

  // THE TWO HONESTY WARNINGS ARE THE MOST VALUABLE SENTENCES ON THE SCREEN and
  // are asserted verbatim in substance: an unsourced list with no publishing
  // authority, and an amount that could not be compared at all rather than one
  // found to be small.
  assert.match(rung.means, /UNSOURCED heuristic with no publishing authority/);
  assert.match(rung.means, /illustration rather than as a compliance determination/);
  assert.match(rung.means, /COULD NOT BE COMPARED/);
  assert.match(rung.means, /unmeasured/);
});

// ---------------------------------------------------------------------------
// What the approver needs that the panel did not carry
// ---------------------------------------------------------------------------

test("UC-09 basis: the reason the requester gave for the payment is on the panel", async () => {
  // The approver's own question is "should this be paid at all" (DECIDERS).
  // Every other row on this dimension describes the MECHANICS of the payment —
  // figure, currency, gross/net, dates — and the occasion for it was reachable
  // only by leaving the panel and reading the original ticket.
  const basis = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, ref: "r-why" }) });
  const reason = dim(basis, "payment_amount").evidence.find((e) => e.label === "Reason given");
  assert.ok(reason, "a payment with no stated occasion is a payment nobody can weigh");
  assert.match(reason.value, /Annual performance bonus/);
  // Attributed, never presented as this system's own finding.
  assert.match(reason.value, /stated by the requester/i);

  const none = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, description: undefined }, ref: "r-nowhy" }),
  });
  assert.match(
    dim(none, "payment_amount").evidence.find((e) => e.label === "Reason given").value,
    /none given/i,
    "an absent reason is reported as absent, never left off the panel"
  );
});

test("UC-09 basis: a payroll run the requester asked for is shown, and marked as not what pays it", async () => {
  const basis = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: { ...STANDARD, processingDate: "2026-07-31" }, ref: "r-run" }),
  });
  const runRow = dim(basis, "payment_amount").evidence.find((e) => e.label === "Payroll run requested");
  assert.ok(runRow);
  assert.match(runRow.value, /2026-07-31/);
  // Remote schedules the payout from the effective date; this field is ours and
  // is not sent. Printing it without that clause would let a reader believe
  // they had just approved a payment date.
  assert.match(runRow.value, /effective date/i);

  const without = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, ref: "r-norun" }) });
  assert.equal(
    dim(without, "payment_amount").evidence.some((e) => e.label === "Payroll run requested"),
    false,
    "a row saying 'not stated' would invite somebody to go and supply a date that changes nothing"
  );
});

test("UC-09 basis: the row's status reaches the reader as a state of affairs, not as a stored value", async () => {
  const pending = describeAdjustmentBasis({ adjustmentRow: await row({ adjustmentRequest: STANDARD, ref: "st-1" }) });
  const status = dim(pending, "employment_freshness").evidence.find((e) => e.label === "Current status");
  assert.ok(status, "the reader is told where this request has got to");
  assert.match(status.value, /waiting for its signatures/i);
  assert.equal(/pending_approval/.test(status.value), false);

  // And the escalated branch, whose finding used to interpolate the slug into a
  // sentence: "This adjustment is escalated, so no payment will be attempted".
  const escalated = describeAdjustmentBasis({
    adjustmentRow: await row({ adjustmentRequest: STANDARD, employmentId: "emp_inactive", ref: "st-2" }),
  });
  const fresh = dim(escalated, "employment_freshness");
  assert.equal(/escalated,/.test(fresh.finding), false);
  assert.match(fresh.finding, /no payment will be attempted/);
});
