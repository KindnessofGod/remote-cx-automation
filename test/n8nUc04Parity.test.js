// ---------------------------------------------------------------------------
// n8nUc04Parity.test.js — the n8n "Workation Gates" Code node and
// policyEngine.js/riskMatrix.js must agree
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same reasoning as test/n8nParity.test.js (UC-01) and n8nUc06Parity.test.js:
// UC-04's decision logic exists twice — once as src/uc04/{policyEngine,
// riskMatrix,requestParser}.js (used by the tests, the demo, and the Node
// workflow) and once as the "Workation Gates" Code node in
// workflows/nodes-uc04/workationGates.js. This test executes the ACTUAL
// node body in a node:vm sandbox and asserts it reaches the same
// decision/reason/flags/riskLevel as policyEngine.evaluate() for every
// scenario in docs/use-cases/UC-04.md §12, plus the edge cases already
// pinned by test/uc04.test.js, so the two copies cannot drift apart
// unnoticed.
//
// It also catches the bug class that bit UC-01's first deploy: a
// template-literal escape collapsing `/https?:\/\//` into `/https?:////`
// (a regex followed by a line comment, so a boolean silently became a
// RegExp object). workationGates.js is a real .js file rather than a
// string inside the builder, which structurally avoids that class — but
// a syntax or semantics break here still fails a test instead of failing
// a real workation request.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate } from "../src/uc04/policyEngine.js";
import { RESTRICTED_JURISDICTIONS } from "../src/uc04/riskMatrix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc04", "workationGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

/**
 * Run the n8n "Workation Gates" Code node body with n8n's globals mocked.
 * Mirrors runAmendmentGatesNode() / runGatesNode() in the other parity tests.
 *
 * `$('Normalize Workation Request')` returns the ticket-shaped request.
 * `$input.first().json` is the immediate predecessor's output — the "Fetch
 * Employment (Remote)" HTTP node, which carries the Remote API response
 * (nested under data.employment, matching the real API; the mock returns
 * the same envelope).
 */
function runWorkationGatesNode({ request, employmentResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName !== "Normalize Workation Request") {
        throw new Error(`Unexpected $() lookup for "${nodeName}"`);
      }
      return { first: () => ({ json: request }) };
    },
    $input: { first: () => ({ json: employmentResponse }) },
  };

  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  // Round-trip through JSON — same cross-realm reasoning as every other
  // parity test in this repo. assert.deepEqual would otherwise fail on
  // prototype identity, not content.
  return JSON.parse(JSON.stringify(result[0].json));
}

/** The real Remote API shape (nested), so the normalization path is exercised. */
const employmentResponse = (over = {}) => ({
  data: {
    employment: {
      id: "emp_active_001",
      status: "active",
      company_id: "co_amend_01",
      custom_fields: { workation_permission: true },
      ...over,
    },
  },
});

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

const baseRequest = {
  employmentId: "emp_active_001",
  session,
  externalRef: "4001",
  source: "webhook",
  now: "2026-08-15",
  travelHistory: [],
  factors: {
    homeCountry: "DE",
    nationality: "DE",
    destination: { country: "ES" },
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
  },
};

const requestFor = (over = {}) => ({ ...baseRequest, ...over, factors: { ...baseRequest.factors, ...(over.factors ?? {}) } });

// ---------------------------------------------------------------------------
// §12 scenarios from docs/use-cases/UC-04.md + the edge cases from
// test/uc04.test.js. Same shape as n8nUc06Parity.test.js: a single
// scenario table, then per-scenario assertions that the n8n node matches
// policyEngine.evaluate() exactly.
// ---------------------------------------------------------------------------

const SCENARIOS = [
  // §12.1 — UK destination with no single threshold applies -> escalate.
  {
    name: "§12.1 UK destination, sales + signing, no treaty path -> escalate (PE risk)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "GB" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "sales",
      hasContractSigningAuthority: true,
    },
  },
  // §12.2 — A1-covered EU/EEA pair, IC role, no flags -> ready_for_approval.
  {
    name: "§12.2 DE->ES, A1 covered, engineering, no flags -> ready_for_approval",
  },
  // §12.3 — IN/PH/MX with no US totalization -> non_treaty_pair -> medium -> ready_for_approval
  // (matrix is soft, not blocked; the policy engine's "all_gates_passed" wins).
  {
    name: "§12.3 IN->US, no totalization -> medium (non_treaty_pair) -> ready_for_approval",
    factors: {
      homeCountry: "IN",
      nationality: "IN",
      destination: { country: "US" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "work_permit",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  // §12.4 — Canada with work permit, no flags -> ready_for_approval.
  {
    name: "§12.4 DE->CA, work_permit, no flags -> ready_for_approval",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "CA" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "work_permit",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  // §12.5 — Portugal DNV on file: dimension 4 (immigration doc) is the
  // matrix's "destination is a DNV country" check, not a custom field here.
  // PT is in the DNV set, so the Schengen branch is skipped and no flags
  // fire -> ready_for_approval.
  {
    name: "§12.5 DE->PT, digital_nomad_visa, no flags -> ready_for_approval",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "PT" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "digital_nomad_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  // §12.6 — Sales/contract-signing role overrides everything else -> escalate.
  {
    name: "§12.6 sales + signing on any destination -> escalate (pe_risk_dape)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "PT" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "digital_nomad_visa",
      jobDuties: "sales",
      hasContractSigningAuthority: true,
    },
  },
  // §12.7 — Long cumulative history pushes trailing-365 over 183.
  // Use AE (non-Schengen, non-US/CA, not a non-treaty pair) to isolate the
  // tax-residency-watch path; sales + signing also fires pe_risk_dape, so
  // this is high (escalate), not medium.
  {
    name: "§12.7 long cumulative history -> tax_residency_watch + PE risk -> escalate",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "AE" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "sales",
      hasContractSigningAuthority: true,
    },
    travelHistory: [{ country: "AE", startDate: "2026-01-01", endDate: "2026-07-19" }],
  },
  // §12.8 — Country outside everything the matrix has a rule about. UC-04.md
  // §3: "Any other destination falls through to escalate-by-default, which is
  // correct behavior, not a gap." This scenario used to assert the opposite
  // (ready_for_approval at risk "low") — that was finding F-14, and both
  // implementations now escalate it with reason destination_out_of_scope.
  {
    name: "§12.8 country outside the curated scope -> escalate (destination_out_of_scope, escalate-by-default)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "AE" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  // F-13 — a lowercase destination must reach the SAME verdict as the
  // uppercase one in BOTH implementations, or the n8n path becomes the
  // bypass the Node path no longer is.
  {
    name: "F-13 lowercase 'us' -> blocked in both implementations, exactly as 'US'",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "us" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "F-13 padded lowercase ' es ' with a Schengen overstay -> blocked in both",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: " es " },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [
      { country: "es", startDate: "2026-04-01", endDate: "2026-08-15" },
      { country: "ES", startDate: "2026-02-15", endDate: "2026-03-15" },
    ],
  },
  {
    name: "F-14 unrecognised destination 'ZZ' -> escalate in both",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ZZ" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  // §12.9 — Missing immigration document. UC-04's factors gate has no
  // explicit "immigration document" field; the closest structural mapping is
  // missing hasContractSigningAuthority, which policyEngine.js catches as
  // "missing_signing_authority" -> blocked, factors_invalid.
  {
    name: "§12.9 missing required factor (signing authority) -> blocked, factors_invalid",
    factors: { hasContractSigningAuthority: undefined },
  },
  // --- edge cases already covered by test/uc04.test.js ---
  {
    name: "identity: no session -> escalate, identity_not_verified",
    requestOver: { session: null },
  },
  {
    name: "identity: company mismatch -> escalate, identity_not_verified",
    requestOver: { session: { companyId: "co_other", authenticatedAdminId: "admin_jane" } },
  },
  {
    name: "employment: terminated employee -> escalate, employee_not_active",
    employmentOver: { status: "terminated" },
  },
  {
    name: "employer permission not granted -> blocked, employer_permission_not_granted",
    employmentOver: { custom_fields: { workation_permission: false } },
  },
  {
    name: "matrix: ESTA + active work -> blocked (visitor_visa_blocks_remote_work)",
    factors: {
      homeCountry: "US",
      nationality: "US",
      destination: { country: "MX" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "esta_usa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "matrix: same-country workation -> blocked (same_country)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "DE" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "matrix: Schengen 90/180 overstay (175 days prior) -> blocked (schengen_overstay)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [
      { country: "ES", startDate: "2026-04-01", endDate: "2026-08-15" },
      { country: "ES", startDate: "2026-02-15", endDate: "2026-03-15" },
    ],
  },
  // --- THE DAY ARITHMETIC, ported 2026-08-20 -------------------------------
  // Three defects lived in computeCumulativeDays() and were copied verbatim
  // into this node. Parity alone would never have found them — both copies
  // agreed, and both were wrong. These rows exist so the FIX is compared, and
  // each carries an absolute `expect` so a rule going missing from both copies
  // at once is still caught.
  {
    name: "day arithmetic: an unreadable prior stay BLOCKS rather than silently clearing a 153-day stay",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" },
      { country: "ES", startDate: "2026-04-01", endDate: "" },
    ],
    expect: { decision: "blocked", reason: "travel_history_unreadable" },
  },
  {
    name: "day arithmetic: overlapping stays count distinct days, so a watch that should not fire does not",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "MX" },
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      visaType: "work_permit",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [
      { country: "MX", startDate: "2026-01-01", endDate: "2026-03-11" },
      { country: "MX", startDate: "2026-02-10", endDate: "2026-04-30" },
    ],
    expect: { decision: "ready_for_approval", reason: "all_gates_passed", flags: [] },
  },
  {
    name: "day arithmetic: the C-1 worked example — 120 of 90 per trip, 61 of 90 per day of stay, so it CLEARS",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-10-30",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [{ country: "ES", startDate: "2026-03-06", endDate: "2026-05-04" }],
    expect: { decision: "ready_for_approval", reason: "all_gates_passed", flags: ["a1_certificate_recommended"] },
  },
  {
    name: "day arithmetic: the same 60-day stay 30 days out instead of 120 is a real overstay, and still blocks",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-10-30",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [{ country: "ES", startDate: "2026-06-04", endDate: "2026-08-02" }],
    expect: { decision: "blocked", reason: "schengen_90_180_exceeded" },
  },
  {
    name: "matrix: US destination without work permit -> blocked (us_requires_work_permit)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "US" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "matrix: CA destination without work permit -> blocked (ca_requires_work_permit)",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "CA" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "factors: invalid visa type -> blocked, factors_invalid",
    factors: { visaType: "mystery_visa" },
  },
  // NOTE: "missing destination" / "missing required factor" cases are NOT
  // exercised by this parity test. requestParser.draftSummaryTemplate() —
  // the real function, ported verbatim into the node — reads
  // factors.destination.country unconditionally and would crash on a missing
  // destination. The real workflow never hits this because evaluate() returns
  // `factors_invalid` BEFORE the summary is drafted; the parity test matches
  // that ordering implicitly by not calling the node body for input shapes
  // where the real template would throw. The "missing destination" gate is
  // still pinned by test/uc04.test.js, which calls evaluate() directly
  // without going through draftSummary.
  {
    name: "matrix: non_treaty pair PH->US -> medium (non_treaty_pair)",
    factors: {
      homeCountry: "PH",
      nationality: "PH",
      destination: { country: "US" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "work_permit",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "matrix: a1_certificate_recommended for DE->FR, no other flags -> ready_for_approval",
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "FR" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },

  // -------------------------------------------------------------------------
  // The restricted-jurisdiction screen, in PAIRS.
  // -------------------------------------------------------------------------
  // These four rows replace a test that used to pin the *absence* of this
  // screen from the node ("KNOWN GAP: ..."), deliberately failing the moment
  // the node was brought up to date. It has been, so the gap is now covered by
  // ordinary scenarios — which is where a rule belongs once both copies have
  // it.
  //
  // They carry an explicit `expect`, unlike every row above, because relative
  // parity is not enough here. Parity says "both copies agree"; two copies
  // that had both lost the screen would agree perfectly. `expect` pins the
  // absolute answer, and the Montenegro row pins that the screen has not
  // over-reached — this repo has already paid for the lesson that "refuses
  // correctly" and "structurally cannot succeed" are indistinguishable from
  // the outside without a positive test.
  {
    name: "restricted destination (IR) -> blocked / sanctioned_region, NOT escalate",
    // WAS A `todo`, NOW A REAL ASSERTION. The divergence it described was
    // genuine: policyEngine.js's sanctions gate returned EARLY with
    // `risk: null`, while workationGates.js's n8n port has no early sanctions
    // gate at all — its restricted screen lives inside the matrix, so the port
    // always produced a full risk object. decision/reason/flags agreed; the
    // riskLevel and tripDays comparisons did not.
    //
    // It was not only a shape mismatch. `risk` is where workflow.js reads
    // `tripDays` and `cumulativeDays` from, so the null propagated into the
    // durable `uc04_authorizations` row and into the summary a specialist
    // reads, which said "an undetermined number of days" about a trip with two
    // readable dates. The Node engine now runs the matrix before returning the
    // block (only when the factors are well-formed enough for it to mean
    // anything), so both copies report the same level, the same day count and
    // the same flags — while the DECISION stays where the early placement puts
    // it, ahead of employer permission and factor validation.
    expect: { decision: "blocked", reason: "sanctioned_region", flags: ["sanctioned_region"] },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "IR" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    // Ordering, not just membership. The visitor-visa rule is a hard block
    // too, so both fire — and `reasons[0]` is what the specialist reads.
    // "That destination is restricted" must win over "that visa forbids
    // work", because only the first is the actual answer to the request.
    name: "restricted destination (KP) + a second hard block -> sanctioned_region wins reasons[0]",
    // The second half of the same divergence, and the sharper one: the n8n
    // port collects BOTH applicable flags (sanctioned_region AND
    // visitor_visa_blocks_remote_work, because it keeps evaluating after the
    // first hard block), while policyEngine.js's early return could only ever
    // emit the single flag it returned on. Both blocked on sanctioned_region
    // as reasons[0] throughout, so the decision was never wrong — but a
    // specialist reading the Node path's record could not see that the visa
    // was ALSO disqualifying, which is a fact about the request and not about
    // the destination. Now that the Node gate scores the matrix before
    // returning, both flags travel on both paths.
    expect: {
      decision: "blocked",
      reason: "sanctioned_region",
      flags: ["sanctioned_region", "visitor_visa_blocks_remote_work"],
    },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "KP" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "tourist_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    // The lookup key is normalised, not just the set. A lowercase "ir" that
    // matched nothing was finding F-13, and it is the same one-line mistake
    // in this file as it was in src/.
    name: "restricted destination in lower case ('ir') is still blocked",
    expect: { decision: "blocked", reason: "sanctioned_region", flags: ["sanctioned_region"] },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ir" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    // THE POSITIVE HALF. Montenegro is present in Remote's own
    // `GET /v1/countries` registry with `eor_onboarding: false` — it is not a
    // restricted jurisdiction, it is a country this matrix has no rules about.
    // It must therefore still reach `escalate / destination_out_of_scope`, the
    // decision that DOES create a work-authorization record for the mobility
    // team. This row fails if anyone ever re-points the screen at the EOR flag
    // or widens it to "absent from the curated matrix".
    name: "Montenegro (in the registry, eor_onboarding:false) is NOT blocked -> escalate / destination_out_of_scope",
    expect: { decision: "escalate", reason: "destination_out_of_scope", flags: ["destination_out_of_scope"] },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ME" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  // --- F-32: a length that cannot be derived is null in BOTH copies ---------
  // Against the pre-fix node body these rows fail on the tripDays comparison
  // added above (0 !== null) while decision/reason/flags all agree — which is
  // precisely why the comparison had to be widened rather than a scenario
  // merely added.
  {
    name: "F-32 unreadable dates -> blocked / invalid_date, and NO invented length in either copy",
    expect: { decision: "blocked", reason: "invalid_date", flags: ["invalid_dates"] },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "next Tuesday",
      endDate: "sometime in October",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "F-32 reversed dates -> blocked / end_before_start, length null in both copies",
    expect: { decision: "blocked", reason: "end_before_start", flags: ["invalid_dates"] },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-14",
      endDate: "2026-09-01",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    name: "F-32 NO dates at all -> blocked / factors_invalid, and the matrix never ran in either copy",
    expect: { decision: "blocked", reason: "factors_invalid" },
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      // Explicitly undefined, not omitted: requestFor() spreads the scenario's
      // factors OVER a fully-dated base, so an omitted key inherits the base's
      // dates and the row silently stops testing what it names.
      startDate: undefined,
      endDate: undefined,
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    // POSITIVE. Without it, every row above would still pass if someone
    // "fixed" this by making tripDurationDays return null unconditionally.
    name: "F-32 POSITIVE a fully dated trip computes the SAME real day count in both copies",
    expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
    expectTripDays: 14,
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
];

for (const scenario of SCENARIOS) {
  const testOptions = scenario.todo ? { todo: scenario.todo } : {};
  test(`n8n Workation Gates match policyEngine — ${scenario.name}`, testOptions, () => {
    const request = requestFor({ ...(scenario.requestOver ?? {}), factors: scenario.factors, travelHistory: scenario.travelHistory ?? [] });
    const empResponse = employmentResponse(scenario.employmentOver ?? {});

    const fromN8n = runWorkationGatesNode({ request, employmentResponse: empResponse });

    // Feed policyEngine.js the identity the n8n node derived, so the
    // comparison isolates the GATES. (The Node path and the n8n path reach
    // the same identity rule: session.companyId === employment.company_id.)
    const identityVerified = Boolean(
      request.session && fromN8n.employment && request.session.companyId === fromN8n.employment.company_id
    );

    const fromPolicyEngine = evaluate({
      identityVerified,
      employment: fromN8n.employment,
      factors: request.factors,
      now: request.now,
      travelHistory: request.travelHistory ?? [],
    });

    assert.equal(fromN8n.decision, fromPolicyEngine.decision, "decision differs");
    assert.equal(fromN8n.reason, fromPolicyEngine.reason, "reason differs");
    assert.deepEqual(fromN8n.flags, fromPolicyEngine.flags, "flags differ");
    assert.equal(fromN8n.risk?.riskLevel ?? null, fromPolicyEngine.risk?.riskLevel ?? null, "riskLevel differs");

    // tripDays was NOT compared here until F-32, and that is how a coerced
    // zero survived in both copies unnoticed — the same blind spot F-29 found
    // in UC-07's parity suite, where a 100x-wrong PTO figure was computed and
    // then discarded. A quantity that reaches a durable row (`trip_days` in
    // uc04_authorizations) and a specialist's summary has to be compared, not
    // just the verdict derived from it. `undefined` is normalised to null
    // because the JSON round-trip drops a null-valued key on neither side but
    // an absent `risk` object leaves the read undefined on both.
    assert.equal(
      fromN8n.risk?.tripDays ?? null,
      fromPolicyEngine.risk?.tripDays ?? null,
      "risk.tripDays differs"
    );
    assert.deepEqual(
      fromN8n.risk?.cumulativeDays ?? null,
      fromPolicyEngine.risk?.cumulativeDays ?? null,
      "risk.cumulativeDays differ"
    );
    // THE TWO FIELDS ADDED WITH THE DAY-ARITHMETIC FIX, compared for the same
    // reason tripDays is: both reach a durable row and a specialist's screen,
    // and a Schengen peak that disagrees between the two execution paths is a
    // different verdict wearing the same decision string. `schengen` in
    // particular is the figure the 90/180 refusal now rests on — a copy that
    // computed it per trip while the other computed it per day of stay would
    // agree on most inputs and diverge on exactly the multi-week workations
    // this use case exists for.
    assert.deepEqual(
      fromN8n.risk?.schengen ?? null,
      fromPolicyEngine.risk?.schengen ?? null,
      "risk.schengen differs"
    );
    assert.deepEqual(
      fromN8n.risk?.travelHistoryProblems ?? null,
      fromPolicyEngine.risk?.travelHistoryProblems ?? null,
      "risk.travelHistoryProblems differ"
    );

    // Absolute expectations, where a row supplies them. Parity alone cannot
    // see a rule that has gone missing from BOTH copies — it only sees them
    // disagree. Rows that pin a compliance outcome say what that outcome is.
    if (scenario.expect) {
      assert.equal(fromN8n.decision, scenario.expect.decision, "n8n decision is not the expected one");
      assert.equal(fromN8n.reason, scenario.expect.reason, "n8n reason is not the expected one");
      if (scenario.expect.flags) {
        assert.deepEqual(fromN8n.flags, scenario.expect.flags, "n8n flags are not the expected ones");
      }
    }
    if (Object.prototype.hasOwnProperty.call(scenario, "expectTripDays")) {
      assert.equal(fromN8n.risk?.tripDays ?? null, scenario.expectTripDays, "n8n tripDays is not the expected one");
      assert.equal(fromPolicyEngine.risk?.tripDays ?? null, scenario.expectTripDays, "src/ tripDays is not the expected one");
    }
  });
}

// ---------------------------------------------------------------------------
// Node-body shape checks — same discipline as every other parity test.
// ---------------------------------------------------------------------------

test("the n8n node body parses and returns n8n's item shape", () => {
  // DE -> ES produces a1_certificate_recommended (both countries are in
  // EU_EEA_FOR_A1) — a soft flag, not a risk-level-elevating one. Use a
  // zero-flags shape (DE -> MX, work_permit, engineering) to also assert
  // the base-tier riskTier is "medium" rather than "high".
  const out = runWorkationGatesNode({
    request: requestFor({
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "MX" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "work_permit",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
    }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(typeof out.decision, "string");
  assert.ok(Array.isArray(out.flags));
  assert.equal(out.decision, "ready_for_approval");
  assert.equal(out.reason, "all_gates_passed");
  assert.equal(out.approvalRoute, "specialist_approval");
  assert.deepEqual(out.flags, [], "DE->MX with work_permit + engineering raises no matrix flags");
  assert.equal(out.riskTier, "medium", "no flags -> UC-04's base tier is medium");
});

test("summary uses the deterministic template, never an LLM call", () => {
  // The LLM seam in this use case (requestParser.draftSummary) is display-
  // only prose — the n8n node body uses the template directly. The summary
  // must therefore be byte-stable across runs of the same input, with no
  // "source: 'llm'" / template-difference surprise.
  const a = runWorkationGatesNode({ request: requestFor(), employmentResponse: employmentResponse() });
  const b = runWorkationGatesNode({ request: requestFor(), employmentResponse: employmentResponse() });
  assert.equal(a.summary, b.summary);
  assert.match(a.summary, /Risk-matrix level: low/);
  assert.match(a.summary, /specialist's approval/);
});

test("blocked / escalated cases don't claim a 1-click approval path in the summary", () => {
  // Blocked: the matrix's "visitor visa blocks remote work" rule.
  const blocked = runWorkationGatesNode({
    request: requestFor({
      factors: {
        homeCountry: "US",
        nationality: "US",
        destination: { country: "MX" },
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        visaType: "esta_usa",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
    }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(blocked.decision, "blocked");
  assert.match(blocked.summary, /Blocked by the risk matrix/);

  // Escalated: the matrix's "high PE risk" path.
  const escalated = runWorkationGatesNode({
    request: requestFor({
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "GB" },
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        visaType: "business_visa",
        jobDuties: "executive",
        hasContractSigningAuthority: true,
      },
    }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(escalated.decision, "escalate");
  assert.match(escalated.summary, /Mobility Legal Tier-2/);
});

test("the n8n Code node body is syntactically valid", () => {
  // Same guard as the other parity tests' equivalent — a Code node body is
  // just a string to n8n, so a broken one deploys happily and only fails
  // mid-execution. Compiling it here turns that into a failing test.
  assert.doesNotThrow(() => new Function(gatesSource), "workationGates.js does not compile");
});

// ---------------------------------------------------------------------------
// The restricted-jurisdiction list exists twice. Prove the two are the same.
// ---------------------------------------------------------------------------
// src/uc04/riskMatrix.js does not own its restricted set — it IMPORTS UC-03's,
// because whether a jurisdiction is excluded is a property of the country and
// not of the question being asked about it. An n8n Code node cannot import, so
// the node body inlines the same ten codes. That is a copy, and this repo's
// standing rule for a copy is that a test holds it in place.
//
// Membership, not merely non-emptiness. A scenario row can only ever cover the
// countries someone thought to write a row for; if the node's list quietly lost
// RU while keeping IR, every scenario above would still pass and Russia would
// be a live sanctions gap. So this compares the two sets member for member.
// ---------------------------------------------------------------------------

/**
 * Pull the RESTRICTED_JURISDICTIONS literal back out of the node body and
 * evaluate just that expression. Deliberately extracted from the SOURCE rather
 * than exposed by the node: the node returns n8n items, and adding a debug
 * export to production code so a test can read it is how test-only surface
 * gets into a compliance path. Paren-matched rather than regex-terminated so a
 * reformat of the literal does not silently make this test vacuous.
 */
function nodeRestrictedJurisdictions() {
  const decl = "const RESTRICTED_JURISDICTIONS = ";
  const at = gatesSource.indexOf(decl);
  assert.notEqual(at, -1, "workationGates.js declares no RESTRICTED_JURISDICTIONS — the screen is gone");
  const exprStart = at + decl.length;
  let depth = 0;
  let i = exprStart;
  for (; i < gatesSource.length; i++) {
    const ch = gatesSource[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0 && i < gatesSource.length, "could not find the end of the RESTRICTED_JURISDICTIONS expression");
  // Cross-realm Set — compare as sorted arrays, same reasoning as every other
  // vm result in this file.
  return [...vm.runInNewContext(gatesSource.slice(exprStart, i + 1))].sort();
}

test("the n8n node's restricted-jurisdiction set is IDENTICAL to src/'s", () => {
  const fromNode = nodeRestrictedJurisdictions();
  const fromSrc = [...RESTRICTED_JURISDICTIONS].sort();

  assert.ok(fromSrc.length > 0, "src/'s restricted set is empty — the screen is vacuous on the Node path");
  assert.ok(fromNode.length > 0, "the node's restricted set is empty — the screen is vacuous in production");
  assert.deepEqual(
    fromNode,
    fromSrc,
    "the deployed node and src/uc04/riskMatrix.js block different jurisdictions. " +
      "Whichever list is shorter is a live sanctions gap; reconcile them before shipping."
  );
});
