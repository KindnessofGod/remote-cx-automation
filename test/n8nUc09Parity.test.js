// ---------------------------------------------------------------------------
// n8nUc09Parity.test.js — the n8n "Adjustment Gates" Code node and
// policyEngine.js/adjustmentParser.js must agree
// ---------------------------------------------------------------------------
// Same reasoning as n8nUc06Parity.test.js: UC-09's decision logic exists
// twice — once as src/uc09/{policyEngine,adjustmentParser}.js and once as
// the "Adjustment Gates" Code node in workflows/nodes-uc09/. This test
// executes the ACTUAL node body (workflows/nodes-uc09/adjustmentGates.js) in
// a sandbox and asserts it reaches the same decision/reason/flags/
// approvalSlotsRequired as the real evaluate(), for every scenario —
// including the floor-of-2 invariant, which must hold in the n8n copy
// exactly as it does in the real one.
//
// The sandbox mocks TWO node references — "Normalize Adjustment Request"
// (the webhook-shaped ticket, no employment) and "Fetch Employment (Remote)"
// (a Remote employment read, same {data: {employment: {...}}} response shape
// every other UC's n8n graph uses) — because the real graph fetches
// employment as its own HTTP node, same as UC-03/UC-06, rather than bundling
// a pre-fetched employment into the normalized ticket.
//
// The incentive schema is NOT passed in via the ticket/mock at all: the node
// (like the real workflow.js, post the incentive-schema fix — see
// adjustmentGates.js's own header) validates against its own hardcoded
// INCENTIVE_REQUIRED_FIELDS list, so there is no "Fetch Country Schema"
// node to mock here.
//
// Everything here is hermetic: nothing touches the network, OpenAI, or any
// live service. The node body is run inside a `node:vm` sandbox with `$()`
// mocked; both sides are JSON-round-tripped before comparison because
// node:vm results are cross-realm (a real bug the project hit once already).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate, INCENTIVE_REQUIRED_FIELDS } from "../src/uc09/policyEngine.js";
import { describeUpstreamError } from "../src/shared/upstreamFailure.js";
import { normalizeEmployment } from "../src/remote/restClient.js";
import {
  LIVE_EMPLOYMENT_DE,
  LIVE_EMPLOYMENT_CA,
  liveEmploymentEnvelope,
  withoutAlpha2,
} from "./fixtures/remoteEmployment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc09", "adjustmentGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

/**
 * Run the n8n "Adjustment Gates" Code node body with n8n's globals mocked.
 * `employmentItem` overrides the whole "Fetch Employment (Remote)" item, for
 * the tests that need a failed read rather than a record.
 */
function runAdjustmentGatesNode(ticket, employment, employmentItem = undefined) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Adjustment Request") return { first: () => ({ json: ticket }) };
      if (nodeName === "Fetch Employment (Remote)") {
        return { first: () => ({ json: employmentItem === undefined ? { data: { employment } } : employmentItem }) };
      }
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };

  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  // Round-trip through JSON — node:vm results are cross-realm, so
  // assert.deepEqual fails on prototype identity even when content matches.
  return JSON.parse(JSON.stringify(result[0].json));
}

const activeEmployment = (over = {}) => ({
  id: "emp_test_1",
  status: "active",
  company_id: "co_test",
  country_code: "US",
  ...over,
});

const ticketFor = (adjustmentRequest, over = {}) => ({
  employmentId: "emp_test_1",
  session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
  adjustmentRequest,
  requestText: "",
  reasonText: "",
  externalRef: "ext_1",
  source: "webhook",
  now: "2026-08-03T00:00:00.000Z",
  ...over,
});

test("parity: standard bonus -> dual_approval_required, floor of 2", () => {
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" });

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());
  const realResult = JSON.parse(
    JSON.stringify(
      evaluate({
        identityVerified: true,
        employment: activeEmployment(),
        incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
        adjustment: { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
        now: ticket.now,
      })
    )
  );

  assert.equal(nodeResult.decision, realResult.decision);
  assert.equal(nodeResult.decision, "dual_approval_required");
  assert.equal(nodeResult.approvalSlotsRequired, 2);
  assert.equal(nodeResult.reason, realResult.reason);
});

test("parity: high-amount + manual tax adjustment -> triple_approval_required", () => {
  const adjustment = { type: "bonus", amount: 1500000, currency: "USD", amountTaxType: "gross", taxAdjustment: true };
  const ticket = ticketFor(adjustment);

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());
  const realResult = JSON.parse(
    JSON.stringify(
      evaluate({
        identityVerified: true,
        employment: activeEmployment(),
        incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
        adjustment,
        now: ticket.now,
      })
    )
  );

  assert.equal(nodeResult.decision, realResult.decision);
  assert.equal(nodeResult.decision, "triple_approval_required");
  assert.equal(nodeResult.approvalSlotsRequired, 3);
  assert.deepEqual(nodeResult.flags.sort(), realResult.flags.sort());
});

test("parity: high-tax-compliance-risk country escalates required slots to 3", () => {
  const adjustment = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" };
  const ticket = ticketFor(adjustment);

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment({ country_code: "DE" }));
  const realResult = JSON.parse(
    JSON.stringify(
      evaluate({
        identityVerified: true,
        employment: activeEmployment({ country_code: "DE" }),
        incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
        adjustment,
        now: ticket.now,
      })
    )
  );

  assert.equal(nodeResult.decision, realResult.decision);
  assert.equal(nodeResult.approvalSlotsRequired, 3);
});

test("parity: unverified identity -> escalate, zero approval slots (no path to execute)", () => {
  const ticket = ticketFor(
    { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
    { session: null }
  );

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.equal(nodeResult.decision, "escalate");
  assert.equal(nodeResult.reason, "identity_not_verified");
  assert.equal(nodeResult.approvalSlotsRequired, 0);
});

test("parity: inactive employment -> escalate", () => {
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" });

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment({ status: "terminated" }));

  assert.equal(nodeResult.decision, "escalate");
  assert.equal(nodeResult.reason, "employment_not_active");
  assert.equal(nodeResult.approvalSlotsRequired, 0);
});

test("parity: schema-invalid payload -> escalate before any approval slot is offered", () => {
  // amount omitted -> prepareIncentivePayload's payload fails the required-field check
  const ticket = ticketFor({ type: "bonus", currency: "USD" });

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.equal(nodeResult.decision, "escalate");
  // `unparseable_amount` is workflow.js's money guard, which the node now
  // ports too: the guard runs AFTER evaluate() and overrides its reason for
  // any non-integer amount, exactly as handleAdjustmentRequest() does. All
  // three reasons are the same escalation with zero approval slots offered.
  assert.ok(
    ["invalid_adjustment_structure", "schema_invalid", "unparseable_amount"].includes(nodeResult.reason),
    `unexpected reason: ${nodeResult.reason}`
  );
  assert.equal(nodeResult.approvalSlotsRequired, 0);
});

test("parity: free-text request REFUSES to guess an amount and escalates (finding F-10)", () => {
  // The exact string the deleted regex fallback got wrong: it matched the "3"
  // in "Q3" and prepared a $3.00 payment for a $12,500.00 request.
  const ticket = ticketFor(null, { requestText: "Q3 2024 relocation top-up of $12,500.00" });

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.equal(nodeResult.parsedAdjustment.source, "refused_no_llm_parse");
  assert.equal(nodeResult.parsedAdjustment.amount, null);
  assert.equal(nodeResult.decision, "escalate");
  assert.equal(nodeResult.reason, "amount_not_extracted");
  assert.equal(nodeResult.approvalSlotsRequired, 0);
  assert.equal(nodeResult.payload, null);

  // The flag set is compared against the REFERENCE, not restated. This
  // assertion used to read `deepEqual(flags, ["amount_not_extracted",
  // "parser_llm_not_configured"])`, which pinned the port's own narrower
  // behaviour: its money guard REPLACED the policy engine's flags instead of
  // unioning them, so `invalid_structure` and friends were dropped from the
  // audit row that a specialist and the metrics exception table both read.
  // Deriving the expectation from evaluate() + workflow.js's guard means a
  // future divergence fails here instead of being frozen in.
  const refusedAdjustment = { ...nodeResult.parsedAdjustment };
  const fromPolicy = evaluate({
    identityVerified: true,
    employment: activeEmployment(),
    incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
    adjustment: refusedAdjustment,
    now: ticket.now,
    upstreamFailures: [],
  });
  const expectedFlags = [
    ...new Set([...(fromPolicy.flags ?? []), "amount_not_extracted", "parser_llm_not_configured"]),
  ];
  assert.deepEqual(nodeResult.flags, expectedFlags);
  assert.ok(nodeResult.flags.includes("invalid_structure"), "the earlier gate's own flags must survive the money guard");
});

test("the node body carries no amount-extraction regex at all", () => {
  // Structural, not behavioural: a regex that grabs the first number in the
  // text must not exist here to be reachable by some later edit.
  const withoutComments = gatesSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !/\[\\d,\]/.test(withoutComments),
    "adjustmentGates.js still contains a digit-scraping regex — it must refuse, never guess"
  );
  assert.ok(!/rule_based_fallback/.test(withoutComments));
});

test("both UC-09 n8n Code node bodies are syntactically valid", () => {
  for (const file of ["normalizeAdjustmentRequest.js", "adjustmentGates.js"]) {
    const src = readFileSync(join(__dirname, "..", "workflows", "nodes-uc09", file), "utf8");
    assert.doesNotThrow(() => new Function(src), `${file} does not compile`);
  }
});

test("parity: no Fetch Country Schema node needed — validates against the fixed INCENTIVE_REQUIRED_FIELDS list", () => {
  // A payload carrying every INCENTIVE_REQUIRED_FIELDS field but nothing
  // resembling UC-06's job_title/weekly_hours schema must still pass —
  // proving this node was NOT ported with the old (wrong) schema source.
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" });

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.notEqual(nodeResult.reason, "schema_invalid");
  assert.equal(nodeResult.decision, "dual_approval_required");
});

test("INVARIANT: no combination of inputs drives approvalSlotsRequired below 2 on any approval-eligible path", () => {
  const scenarios = [
    { type: "commission", amount: 100, currency: "USD", amountTaxType: "gross" },
    { type: "overtime", amount: 100, currency: "GBP", amountTaxType: "gross" },
    { type: "bonus", amount: 1, currency: "EUR", amountTaxType: "gross" },
  ];
  for (const adjustment of scenarios) {
    const ticket = ticketFor(adjustment);
    const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());
    if (nodeResult.decision !== "escalate") {
      assert.ok(
        nodeResult.approvalSlotsRequired >= 2,
        `approvalSlotsRequired dropped below 2 for ${JSON.stringify(adjustment)}: got ${nodeResult.approvalSlotsRequired}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// ORDERED GATES: first failure wins, and an EARLIER gate's reason must survive
// a later gate's refusal.
// ---------------------------------------------------------------------------
// MERGE NOTE (2026-08-19). This branch found this defect with a shaped probe
// (a 404 item plus a session whose companyId is null) after 18,432 generated
// cases with well-formed records showed ZERO divergence; trunk found the same
// defect from live execution 4238 and fixed it at the same construction site,
// then went further — see its own banner below. Trunk's node body is the one
// that survived the merge. These tests were kept because they approach the
// same gate from the other end: trunk's assert the swallowed-404 envelope,
// these assert the ORDERING property itself (an earlier gate's reason must
// not be displaced by a later gate's) and the must-succeed direction.
// ---------------------------------------------------------------------------
// These are regression tests for a real divergence found 2026-08-19. The node
// used to build its employment object as
//   { id: empRaw.id ?? ticket.employmentId, company_id: empRaw.company_id ?? null }
// and verify identity as
//   Boolean(session && employment.id && session.companyId === employment.company_id)
// so when the Remote read returned NO record (a 404, or a
// `continueRegularOutput` error item), `id` fell back to the requester's own
// claim and `company_id` was manufactured as null. A session whose own
// companyId was null then PASSED the identity gate by `null === null`, and the
// run was refused one gate later as `employment_not_active`.
//
// Two things were wrong with that, and only one of them is about the verdict:
//   1. The recorded reason named the wrong cause. An audit row saying "this
//      employee is not active" about a record that was never read is a false
//      statement about a real payroll request.
//   2. The identity control only failed closed because a LATER gate happened
//      to catch it. `status` defaults to 'unknown' when there is no record —
//      so the refusal was an accident of that default, not a decision.
// src/uc09/workflow.js has never had this: `remote.getEmployment()` returns
// null on a 404 and its identity expression carries an `employment &&` term.
// ---------------------------------------------------------------------------

/** identity exactly as src/uc09/workflow.js computes it (the reference). */
const realIdentityVerified = (session, employment) =>
  Boolean(session && employment && session.companyId === employment.company_id);

const realEvaluate = (session, employment, adjustment, now, upstreamFailures = []) =>
  JSON.parse(
    JSON.stringify(
      evaluate({
        identityVerified: realIdentityVerified(session, employment),
        employment,
        incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
        adjustment,
        now,
        upstreamFailures,
      })
    )
  );

test("ordered gates: a failed employment read is attributed upstream, NOT reported as employment_not_active", () => {
  // The exact shape a 404 / continueRegularOutput error item arrives in: a
  // successful n8n item carrying an error body and no `data`.
  //
  // MERGE NOTE: this branch expected `identity_not_verified` here, because on
  // its base that was the first gate a null record could reach. Trunk added a
  // gate 0 ahead of identity (upstreamFailure.js) that names the failed READ
  // instead — a strictly better answer to "why was this refused", and the one
  // src/uc09/policyEngine.js now gives too. What this test is really about is
  // unchanged and still holds: whatever the reason is, it must come from the
  // FIRST gate that refused, never from a later one that happened to catch the
  // run. `employment_not_active` is that later gate, and it must never appear.
  const session = { companyId: null, authenticatedAdminId: "admin_1" };
  const adjustment = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" };
  const ticket = ticketFor(adjustment, { session });

  const failedItem = { error: { message: '404 - "Employment not found"', status: 404, name: "AxiosError" } };
  const nodeResult = runAdjustmentGatesNode(ticket, null, failedItem);
  // src/uc09/workflow.js's reference: getEmployment() returns null on a 404 and
  // the failure reaches evaluate() as an upstream failure. Built with the SAME
  // shared describer the node body inlines, so the test cannot encode a failure
  // shape neither implementation actually produces.
  const realResult = realEvaluate(session, null, adjustment, ticket.now, [
    describeUpstreamError(failedItem, "employment"),
  ]);

  assert.equal(nodeResult.decision, realResult.decision);
  assert.equal(nodeResult.reason, realResult.reason, "the n8n copy must name the same cause as the real function");
  assert.equal(nodeResult.reason, "upstream_record_not_found");
  assert.notEqual(nodeResult.reason, "employment_not_active", "a later gate's reason must never displace an earlier gate's");
  assert.equal(nodeResult.approvalSlotsRequired, 0);
  assert.equal(nodeResult.employment, null, "no usable record must yield employment = null, as getEmployment() does");
});

test("ordered gates: identity is never satisfied by a company_id the node manufactured itself", () => {
  // A session that claims nothing (companyId null/absent) plus a read that
  // returned nothing must not agree with each other. The whole failure mode
  // was two nulls comparing equal.
  for (const session of [{ companyId: null, authenticatedAdminId: "a" }, { authenticatedAdminId: "a" }, null]) {
    const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" }, { session });
    const nodeResult = runAdjustmentGatesNode(ticket, null, {});
    assert.equal(
      nodeResult.reason,
      "identity_not_verified",
      `session ${JSON.stringify(session)} must not verify against an absent record`
    );
    assert.equal(nodeResult.approvalSlotsRequired, 0);
  }
});

test("ordered gates: with three gates failing at once, the FIRST one's reason is the recorded one", () => {
  // Unverified requester + terminated employment + structurally invalid
  // adjustment, all true simultaneously. policyEngine.js checks identity,
  // then status, then structure — so the answer is identity, in both copies.
  const session = null;
  const employment = activeEmployment({ status: "terminated" });
  const adjustment = { type: undefined, amount: 0, currency: undefined };
  const ticket = ticketFor(adjustment, { session });

  const nodeResult = runAdjustmentGatesNode(ticket, employment);
  const realResult = realEvaluate(session, employment, { ...adjustment, source: "structured_input" }, ticket.now);

  assert.equal(nodeResult.reason, realResult.reason);
  assert.equal(nodeResult.reason, "identity_not_verified");
  assert.deepEqual(nodeResult.flags, realResult.flags);
});

test("POSITIVE: a well-formed request with a real record MUST reach the approval path", () => {
  // The counterpart every refusal test needs. A gate that can never succeed is
  // indistinguishable from one refusing correctly, and only a test that
  // demands success can tell them apart — this is the check that would have
  // caught the identity fix above if it had been made too strict (e.g. by
  // requiring a field the real record does not carry).
  const adjustment = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" };
  const session = { companyId: "co_test", authenticatedAdminId: "admin_1" };
  const ticket = ticketFor(adjustment, { session });
  const employment = activeEmployment();

  const nodeResult = runAdjustmentGatesNode(ticket, employment);
  const realResult = realEvaluate(session, employment, { ...adjustment, source: "structured_input" }, ticket.now);

  assert.equal(nodeResult.decision, "dual_approval_required");
  assert.equal(nodeResult.decision, realResult.decision);
  assert.equal(nodeResult.reason, realResult.reason);
  assert.equal(nodeResult.approvalSlotsRequired, 2);
  assert.equal(nodeResult.payload.employment_id, "emp_test_1");
  assert.deepEqual(nodeResult.payload, realResult.payload);
});

test("the free-text path REFUSES rather than guessing an amount, and never reaches approval", () => {
  // MERGE NOTE: this branch asserted the opposite — that free text reaches
  // `dual_approval_required` — because on its base the node carried a
  // rule-based amount extractor. Trunk deleted it (finding F-10): the regex
  // took the FIRST number in the text, so "Q3 2024 relocation top-up of
  // $12,500.00" prepared a $3.00 payment, a 4,000x error every downstream gate
  // waves through because $3.00 is small and plausible. An n8n Code node has no
  // LLM, so refusing is the only honest option and the positive expectation
  // this branch wrote was asserting the bug back in. Kept, inverted, with the
  // money check that was always the point.
  const session = { companyId: "co_test", authenticatedAdminId: "admin_1" };
  const ticket = ticketFor(null, { session, requestText: "Q3 2024 relocation top-up of $12,500.00" });

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.equal(nodeResult.decision, "escalate", "no LLM means no parsed amount means no approval path");
  assert.equal(nodeResult.approvalSlotsRequired, 0);
  assert.equal(nodeResult.parsedAdjustment.amount, null, "never a guessed figure — least of all 3");
  assert.notEqual(nodeResult.parsedAdjustment.amount, 300, "the 4,000x error this refusal exists to prevent");
  assert.equal(nodeResult.parsedAdjustment.source, "refused_no_llm_parse");
});

// ---------------------------------------------------------------------------
// The money guard must not displace an EARLIER gate's reason either.
// ---------------------------------------------------------------------------
// workflow.js's unusable-amount guard runs after evaluate(), and the port used
// to overwrite the reason for every non-upstream refusal. Measured against the
// real function over 40,960 generated cases during the 2026-08-19 merge, that
// produced two wrong audit rows:
//
//   unverified requester + a quoted amount -> "unparseable_amount"
//   terminated employee  + a quoted amount -> "unparseable_amount"
//
// Both record a security- or status-relevant refusal as an integration bug, and
// `reason` is what the metrics dashboard ranks its exception table by — so the
// two execution paths would send a team to fix payload formatting for runs that
// were actually unauthenticated. The real guard only takes the reason when the
// amount is genuinely the first failure, and it UNIONS flags rather than
// replacing them. Both halves are pinned here.
// ---------------------------------------------------------------------------

const MONEY_GUARD_CASES = [
  {
    name: "unverified requester keeps identity_not_verified, with the amount as a flag",
    session: null,
    employmentOver: {},
    expectedReason: "identity_not_verified",
    expectedFlag: "unverified_requester",
  },
  {
    name: "terminated employee keeps employment_not_active, with the amount as a flag",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    employmentOver: { status: "terminated" },
    expectedReason: "employment_not_active",
    expectedFlag: "inactive_employment",
  },
];

for (const c of MONEY_GUARD_CASES) {
  test(`money guard: ${c.name}`, () => {
    // A quoted number is the realistic shape — an integration that JSON-encodes
    // its amounts as strings. It is not an integer, so the guard fires.
    const adjustment = { type: "bonus", amount: "500000", currency: "USD", amountTaxType: "gross" };
    const employment = activeEmployment(c.employmentOver);
    const ticket = ticketFor(adjustment, { session: c.session });

    const nodeResult = runAdjustmentGatesNode(ticket, employment);

    assert.equal(nodeResult.reason, c.expectedReason, "the FIRST failing gate names the refusal, not the money guard");
    assert.notEqual(nodeResult.reason, "unparseable_amount");
    assert.ok(nodeResult.flags.includes(c.expectedFlag), "the earlier gate's own flag must survive");
    assert.ok(nodeResult.flags.includes("amount_not_an_integer"), "and the amount problem must still be recorded, not hidden");
    assert.equal(nodeResult.approvalSlotsRequired, 0);
    assert.equal(nodeResult.payload, null, "an untrusted figure never reaches a payload");
  });
}

test("money guard: when the amount IS the first failure, it becomes the reason", () => {
  // The other direction — the guard must still work. A well-formed request
  // whose only problem is a quoted amount reports the amount.
  const adjustment = { type: "bonus", amount: "500000", currency: "USD", amountTaxType: "gross" };
  const ticket = ticketFor(adjustment);

  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.equal(nodeResult.reason, "unparseable_amount");
  assert.ok(nodeResult.flags.includes("amount_not_an_integer"));
  assert.equal(nodeResult.approvalSlotsRequired, 0);
});

test("money guard: an upstream failure keeps its reason AND records the amount flag", () => {
  // The port used to skip the guard entirely on an upstream reason. That kept
  // the reason right (which was the point) but dropped `amount_not_an_integer`
  // from the row, so a 404 that also carried a malformed payload recorded only
  // half of what went wrong. `amountIsFirstFailure` protects the reason on its
  // own, so the skip was redundant and lossy.
  const failedItem = { error: { message: '404 - "Employment not found"', status: 404, name: "AxiosError" } };
  const ticket = ticketFor({ type: "bonus", amount: "500000", currency: "USD", amountTaxType: "gross" });

  const nodeResult = runAdjustmentGatesNode(ticket, null, failedItem);

  assert.equal(nodeResult.reason, "upstream_record_not_found");
  assert.ok(nodeResult.flags.includes("amount_not_an_integer"));
});

// ---------------------------------------------------------------------------
// adjustment_type: the recorded type must be the PARSED type.
// ---------------------------------------------------------------------------
// Originally checked on this branch and reported REFUTED, correctly at the
// time: the node wrote `result.decision` into `adjustmentType` and so did
// src/uc09/workflow.js, so the two agreed and the parity rule said copy rather
// than correct. Trunk then fixed the real function — `adjustmentType` is now
// `parsedAdjustment.type` — and the port was left behind, still pinned to the
// defect by its own header comment justifying it as parity. That is the whole
// hazard of a second copy: it can be faithful on Monday and wrong on Tuesday
// without anybody touching it.
//
// What the wrong value costs: `adjustment_type` is a column. Every n8n-written
// row said its type was "dual_approval_required" — the decision, stored twice,
// in a column named after something else — while the portal and the escalation
// ticket printed "not classified" for requests the parser had classified fine.
// ---------------------------------------------------------------------------
test("adjustmentType records the PARSED type, never the decision and never undefined", () => {
  for (const adjustment of [
    { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
    { type: "commission", amount: 1500000, currency: "USD", amountTaxType: "gross", taxAdjustment: true },
    { type: "relocation_allowance", amount: 250000, currency: "EUR", amountTaxType: "gross" },
  ]) {
    const ticket = ticketFor(adjustment);
    const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

    assert.equal(nodeResult.adjustmentType, adjustment.type, "the column named for the type must hold the type");
    assert.notEqual(nodeResult.adjustmentType, nodeResult.decision, "the decision is already stored in `decision`");
    assert.notEqual(nodeResult.adjustmentType, undefined, "undefined reads as 'not classified' for something that was classified");
  }
});

test("adjustmentType is null — not undefined, not a decision — when nothing could be classified", () => {
  // The free-text path refuses to guess, so `type` comes back null. That is a
  // real answer and must survive as one; `undefined` would drop out of the JSON
  // entirely and the row would simply have no type at all.
  const ticket = ticketFor(null, { requestText: "Q3 2024 relocation top-up of $12,500.00" });
  const nodeResult = runAdjustmentGatesNode(ticket, activeEmployment());

  assert.equal(nodeResult.adjustmentType, null);
  assert.notEqual(nodeResult.adjustmentType, nodeResult.decision);
});

// ---------------------------------------------------------------------------
// SWALLOWED UPSTREAM FAILURES + THE IDENTITY CONSTRUCTION SITE
// ---------------------------------------------------------------------------
// "Fetch Employment (Remote)" carries `onError: continueRegularOutput`, so a
// failed fetch reports success and hands the gates an error item instead of the
// record. Live execution 4238 swallowed a 404 and recorded
// `identity_not_verified` / `unverified_requester` — on the one use case where
// money actually moves.
//
// The identity defect underneath it: the gates built a placeholder employment
// (`id` backfilled from the ticket, `company_id` defaulted to null). The
// Zendesk intake path's normalizer deliberately emits `session.companyId: null`
// so the company-match gate fails closed — but `null === null` passed it, and
// the backfilled id satisfied the `employment.id &&` guard, so the run got PAST
// identity and stopped one gate later on `employment_not_active`. Reproduced in
// a sandbox before the fix.
// ---------------------------------------------------------------------------

const LIVE_404_ITEM = {
  error: {
    message: '404 - "{\\"message\\":\\"Employment not found\\"}"',
    name: "AxiosError",
    stack: "AxiosError: Request failed with status code 404",
    code: "ERR_BAD_REQUEST",
    status: 404,
  },
};

/** The same sandbox, but with a raw employment ENVELOPE rather than a record. */
function runWithEnvelope(ticket, employmentEnvelope) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Adjustment Request") return { first: () => ({ json: ticket }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentEnvelope }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const wrapped = `(function () {\n${gatesSource}\n})()`;
  return JSON.parse(JSON.stringify(vm.runInNewContext(wrapped, sandbox, { timeout: 5000 })[0].json));
}

/** The Zendesk intake session: authenticated person, but NOT a company admin. */
const zendeskSession = () => ({
  authenticatedEmail: "alexandre@example.com",
  companyId: null,
  authenticatedAdminId: null,
});

test("parity: execution 4238's swallowed 404 reports the failed read, not an unverified requester", () => {
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" });
  const fromN8n = runWithEnvelope(ticket, LIVE_404_ITEM);

  assert.notEqual(fromN8n.reason, "identity_not_verified");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.deepEqual(fromN8n.flags, ["upstream_record_not_found", "upstream_employment_404"]);
  assert.deepEqual(fromN8n.upstreamFailures.map((f) => [f.call, f.status, f.kind]), [["employment", 404, "not_found"]]);

  // The money guarantee, stated as strongly as it can be: no approval path, no
  // payload, nothing for a human to sign off on.
  assert.equal(fromN8n.approvalSlotsRequired, 0);
  assert.equal(fromN8n.payload, null);
  assert.equal(fromN8n.employment, null);

  const real = evaluate({
    identityVerified: false,
    employment: null,
    incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
    adjustment: { ...ticket.adjustmentRequest, source: "structured_input" },
    now: ticket.now,
    upstreamFailures: fromN8n.upstreamFailures,
  });
  assert.equal(fromN8n.decision, real.decision);
  assert.equal(fromN8n.reason, real.reason);
  assert.deepEqual(fromN8n.flags, real.flags);
  assert.equal(fromN8n.approvalSlotsRequired, real.approvalSlotsRequired);
});

test("a null-vs-null company match must stop at the IDENTITY gate, not one gate later", () => {
  // Remote answered 200 with an empty envelope, so there is no error item and
  // the upstream fix is out of the picture: this isolates the identity defect.
  // Before the construction-site fix this returned `employment_not_active`,
  // proving it had got past identity.
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" }, { session: zendeskSession() });
  const fromN8n = runWithEnvelope(ticket, { data: {} });

  assert.equal(fromN8n.reason, "identity_not_verified");
  assert.deepEqual(fromN8n.flags, ["unverified_requester"]);
  assert.notEqual(fromN8n.reason, "employment_not_active", "identity must not be rescued by the status gate");
  assert.equal(fromN8n.approvalSlotsRequired, 0);
  assert.equal(fromN8n.payload, null);
  assert.equal(fromN8n.employment, null, "no usable record means null, never a placeholder from the request");
});

test("a real employment whose company_id is null still fails identity", () => {
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" }, { session: zendeskSession() });
  const fromN8n = runWithEnvelope(ticket, { data: { employment: activeEmployment({ company_id: null }) } });
  assert.equal(fromN8n.reason, "identity_not_verified");
  assert.equal(fromN8n.approvalSlotsRequired, 0);
});

test("an upstream failure outranks the money guard rather than being overwritten by it", () => {
  // Both are true at once: the employment read failed AND no trustworthy amount
  // was supplied. "Ordered gates, first failure wins" means the earlier gate is
  // recorded — otherwise the fix undoes itself, and a real API failure is filed
  // as a payload problem all over again.
  const ticket = ticketFor(null, { requestText: "please pay the Q3 relocation top-up of $12,500.00" });
  const fromN8n = runWithEnvelope(ticket, LIVE_404_ITEM);
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.equal(fromN8n.approvalSlotsRequired, 0);
  assert.equal(fromN8n.payload, null);
});

test("a healthy run records no upstream failures and still opens dual approval", () => {
  const ticket = ticketFor({ type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" });
  const fromN8n = runWithEnvelope(ticket, { data: { employment: activeEmployment() } });
  assert.deepEqual(fromN8n.upstreamFailures, []);
  assert.equal(fromN8n.decision, "dual_approval_required");
  assert.equal(fromN8n.approvalSlotsRequired, 2);
});

// ---------------------------------------------------------------------------
// THE ALPHA-3 DEFECT ON THE MONEY PATH (finding F-27)
// ---------------------------------------------------------------------------
// `assessRisk()` raises the approval floor from 2 to 3 for a high-tax-complexity
// country: `["DE","FR","IT"].includes(employment.country_code)`. The live API
// nests `country: {code: "DEU", name: "Germany", alpha_2_code: "DE"}` — `code`
// is the ALPHA-3 form, and there is no top-level `country_code` on the record at
// all. This node's old chain (`country_code ?? country.alpha_2_code ??
// country.code`) therefore had a written-down path that placed "DEU" into a
// field only ever compared against "DE".
//
// Nothing crashed. The comparison was simply false, so a German off-cycle
// payment went out on TWO approvals when policy demands THREE — and every
// fail-closed test in this file passed the whole time, because refusing is not
// what a dead gate does; a dead gate quietly approves at the lower floor. Only
// a POSITIVE test detects this class of defect, which is what the first test
// below is.
//
// Every fixture here is a REAL Sandbox record copied verbatim
// (test/fixtures/remoteEmployment.js), not a synthetic `{country_code: "DE"}`
// object — a fixture that agrees with the code instead of with the API cannot
// fail when the code is wrong about the API.
const HIGH_TAX_ADJUSTMENT = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" };

/** A ticket whose session matches the REAL record's real company_id. */
const ticketForLiveRecord = (record, adjustment = HIGH_TAX_ADJUSTMENT, over = {}) =>
  ticketFor(adjustment, {
    employmentId: record.id,
    session: { companyId: record.company_id, authenticatedAdminId: "admin_1" },
    ...over,
  });

test("POSITIVE: a real German employment reaches THREE approval slots — the control that had never once fired", () => {
  const record = LIVE_EMPLOYMENT_DE; // country: {code: "DEU", alpha_2_code: "DE"}
  assert.equal(record.country.code, "DEU", "fixture guard: the live record really does carry the alpha-3 form");
  assert.equal(record.country_code, undefined, "fixture guard: there is no top-level country_code on a live record");

  const ticket = ticketForLiveRecord(record);
  const fromN8n = runWithEnvelope(ticket, liveEmploymentEnvelope(record));

  // The load-bearing assertion: the alpha-2 code, never the alpha-3 one.
  assert.equal(fromN8n.employment.country_code, "DE");
  assert.notEqual(fromN8n.employment.country_code, "DEU");

  assert.ok(fromN8n.flags.includes("high_tax_compliance_risk"), "Germany must raise the tax-complexity flag");
  assert.equal(fromN8n.approvalSlotsRequired, 3, "the third approver must engage on a German adjustment");
  assert.equal(fromN8n.decision, "triple_approval_required");

  // Parity with the reference implementation fed the SAME real record through
  // the real normalizeEmployment() — the function whose fix this node now ports.
  const realResult = JSON.parse(
    JSON.stringify(
      evaluate({
        identityVerified: true,
        employment: normalizeEmployment(record),
        incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
        adjustment: HIGH_TAX_ADJUSTMENT,
        now: ticket.now,
      })
    )
  );
  assert.equal(fromN8n.decision, realResult.decision);
  assert.equal(fromN8n.approvalSlotsRequired, realResult.approvalSlotsRequired);
  assert.deepEqual(fromN8n.flags.sort(), realResult.flags.sort());
});

test("a real non-high-tax employment (Canada) stays at the floor of two — the flag is not universal", () => {
  // The mirror of the test above. If "DEU" -> null had merely been swapped for
  // "DEU" -> some other wrong-but-two-letter value, THIS is the test that fails.
  const record = LIVE_EMPLOYMENT_CA;
  const fromN8n = runWithEnvelope(ticketForLiveRecord(record), liveEmploymentEnvelope(record));
  assert.equal(fromN8n.employment.country_code, "CA");
  assert.ok(!fromN8n.flags.includes("high_tax_compliance_risk"));
  assert.equal(fromN8n.approvalSlotsRequired, 2);
  assert.equal(fromN8n.decision, "dual_approval_required");
});

test("FAIL CLOSED: an unusable country code is null, and null never lowers the floor below two", () => {
  // The same real German record with `country.alpha_2_code` deleted and nothing
  // else changed. All that is left is "DEU", which cannot be compared — so the
  // node must yield null rather than a wrong string. Null loses the third
  // approver (an honest under-claim: we could not confirm the country), but it
  // must NEVER drop the floor below the two the four-eyes rule guarantees.
  const record = withoutAlpha2(LIVE_EMPLOYMENT_DE);
  const fromN8n = runWithEnvelope(ticketForLiveRecord(record), liveEmploymentEnvelope(record));

  assert.equal(fromN8n.employment.country_code, null, "an alpha-3-only record must yield null, never 'DEU'");
  assert.ok(fromN8n.approvalSlotsRequired >= 2, "the floor of two is unconditional");
  assert.equal(fromN8n.approvalSlotsRequired, 2);
  assert.equal(fromN8n.decision, "dual_approval_required");

  // And the reference implementation answers identically for the same record.
  const realResult = JSON.parse(
    JSON.stringify(
      evaluate({
        identityVerified: true,
        employment: normalizeEmployment(record),
        incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
        adjustment: HIGH_TAX_ADJUSTMENT,
        now: "2026-08-03T00:00:00.000Z",
      })
    )
  );
  assert.equal(realResult.approvalSlotsRequired, 2);
  assert.equal(fromN8n.approvalSlotsRequired, realResult.approvalSlotsRequired);
});

test("a null country still cannot lower a floor that risk raised to three", () => {
  // Belt and braces on the money path: an unresolvable country must not be a
  // way to shed an approver that the AMOUNT or a manual tax adjustment demanded.
  const record = withoutAlpha2(LIVE_EMPLOYMENT_DE);
  const adjustment = { type: "bonus", amount: 1500000, currency: "USD", amountTaxType: "gross", taxAdjustment: true };
  const fromN8n = runWithEnvelope(
    ticketForLiveRecord(record, adjustment),
    liveEmploymentEnvelope(record)
  );
  assert.equal(fromN8n.employment.country_code, null);
  assert.equal(fromN8n.approvalSlotsRequired, 3);
  assert.equal(fromN8n.decision, "triple_approval_required");
});

test("a lowercase or padded alpha-2 code is canonicalised, not rejected", () => {
  // normalizeCountryCode() upper-cases and trims before the shape check, and
  // this port must too — otherwise " de " reaches the high-tax list as itself,
  // misses, and silently drops the third approver all over again.
  const record = { ...LIVE_EMPLOYMENT_DE, country: { ...LIVE_EMPLOYMENT_DE.country, alpha_2_code: " de " } };
  const fromN8n = runWithEnvelope(ticketForLiveRecord(record), liveEmploymentEnvelope(record));
  assert.equal(fromN8n.employment.country_code, "DE");
  assert.equal(fromN8n.approvalSlotsRequired, 3);
});
