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
import { draftSummaryTemplate } from "../src/uc04/requestParser.js";

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
  // --- THE SANCTIONS GATE'S PRECEDENCE, not just its membership -------------
  // Every restricted-jurisdiction row above uses a permission-granted
  // employment and well-formed factors, so BOTH copies reach the risk matrix
  // and agree there. That made the table blind to the thing that was actually
  // wrong: src/uc04/policyEngine.js screens the destination in its OWN gate,
  // third, before employer permission and before factor validation, while the
  // n8n port had no such gate at all and reached `sanctioned_region` only from
  // inside classifyRisk() — four gates later, and only on a request that had
  // already cleared the two gates below.
  //
  // Reproduced on 2026-08-31, before the port gained the gate:
  //
  //     destination IR + workation_permission:false
  //       src/uc04/policyEngine.js  -> blocked / sanctioned_region
  //       workflows/nodes-uc04/...  -> blocked / employer_permission_not_granted
  //
  // Same DECISION — so nothing went red, no alert fired, and the parity table
  // above passed — and a different REASON on the customer's ticket. A
  // specialist reading `employer_permission_not_granted` goes looking for a
  // permissions problem and never learns the destination was sanctioned. That
  // is finding F-13, which policyEngine.js's header records fixing "in the one
  // file that had not had it applied"; it was applied WITHIN src and never
  // BETWEEN the two copies, and the port stayed wrong for thirteen days.
  //
  // These two rows are the shape the table was missing: a sanctioned
  // destination paired with a LOWER gate that would also have fired. Relative
  // parity alone would not be enough (two copies that both lost the gate would
  // agree), so both carry an explicit `expect`.
  {
    name: "sanctions gate OUTRANKS employer permission (IR + permission not granted)",
    expect: { decision: "blocked", reason: "sanctioned_region", flags: ["sanctioned_region"] },
    employmentOver: { custom_fields: { workation_permission: false } },
    factors: {
      homeCountry: "NL",
      nationality: "NL",
      destination: { country: "IR" },
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  },
  {
    // The second lower gate, and the one where `risk` must stay NULL: the
    // factors are malformed, so nothing can score them, and both copies say so
    // rather than manufacturing an absence. `visaType` is not a member of
    // VALID_VISA_TYPES, which is exactly the shape the portal's own form has
    // produced (three of its options were not in the set).
    name: "sanctions gate OUTRANKS factor validation (IR + invalid factors, risk stays null)",
    expect: { decision: "blocked", reason: "sanctioned_region", flags: ["sanctioned_region"] },
    factors: {
      homeCountry: "NL",
      nationality: "NL",
      destination: { country: "IR" },
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      visaType: "not_a_real_visa_type",
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
  // WAS `/specialist's approval/` UNTIL 2026-08-31, and it was asserting the
  // defect. A `ready_for_approval` UC-04 request waits on the CUSTOMER'S OWN
  // MANAGER, in Remote's own product (UC-04.md §1a) — not on a Remote mobility
  // specialist, who `src/uc04/approvalPolicy.js` refuses and whose sidebar
  // panel offers no approve control. The DECISION vocabulary this file exists
  // to pin is untouched; only the prose moved. The corrected sentence and every
  // phrase that must never come back are pinned in
  // test/n8nUc04StageVocabulary.test.js.
  assert.match(a.summary, /the customer's own manager/);
});

test("blocked / escalated summaries name the cause and claim no approval path at all", () => {
  // REWRITTEN 2026-08-31. The previous version asserted
  // /Blocked by the risk matrix/ and /Mobility Legal Tier-2/ — it was PINNING
  // the two defects, in a test whose own name said it was guarding against a
  // false approval claim:
  //   - "Blocked by the risk matrix" is accurate for 5 of the 12 reachable
  //     blocked reasons and FALSE for `factors_invalid`, where `risk` is null.
  //   - "not open to 1-click approval here" implies a slower approval exists in
  //     Zendesk. None does, on any UC-04 decision, on any surface.
  //   - "Mobility Legal Tier-2" is not a group name; the live group is
  //     `Mobility & Legal (Tier-2)` (id 99900000000009).
  // The test name was right and its assertions were one abstraction too shallow
  // — it checked WHICH WORDS appeared rather than what they claimed.

  // Blocked, matrix on merit: the matrix really did run, so it may be named.
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
  assert.match(blocked.summary, /Blocked by the risk matrix \(/, "a real matrix refusal should still name the matrix");
  assert.match(blocked.summary, new RegExp(`\\(${blocked.reason}\\)`), "the summary must name the deciding reason");

  // Blocked, NOTHING SCORED. `visaType` is outside VALID_VISA_TYPES — the exact
  // shape the portal's own form has produced — so the request is refused on
  // completeness and `risk` is null. The summary must not claim the matrix ran.
  const incomplete = runWorkationGatesNode({
    request: requestFor({
      factors: {
        homeCountry: "NL",
        nationality: "NL",
        destination: { country: "PT" },
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        visaType: "not_a_real_visa_type",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
    }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(incomplete.decision, "blocked");
  assert.equal(incomplete.reason, "factors_invalid");
  assert.equal(incomplete.risk, null, "the matrix must not have run");
  assert.ok(
    !incomplete.summary.includes("Blocked by the risk matrix"),
    `the summary claims a computation that never happened: ${incomplete.summary}`
  );
  assert.match(incomplete.summary, /the risk matrix did not run on this request/);
  assert.match(incomplete.summary, /nothing was refused on its merits/);
  // The self-contradiction that was live: "Risk-matrix level: unknown." one
  // clause before "Blocked by the risk matrix."
  assert.match(incomplete.summary, /Risk-matrix level: unknown\./);

  // Escalated: names the real group, and claims no approval path of any speed.
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
  assert.match(escalated.summary, /Mobility & Legal \(Tier-2\)/, "must name the group as the account spells it");
  assert.match(escalated.summary, /no approve\/decline path here/);
  assert.ok(!escalated.summary.includes("1-click"), "must not imply a slower approval exists in Zendesk");

  // CROSS-COPY: src carries the identical branches and its own comment says
  // "If you edit one, edit both." For a day the port was fixed and src was not.
  for (const run of [blocked, incomplete, escalated]) {
    const src = draftSummaryTemplate({
      factors: run.factors,
      riskLevel: run.risk?.riskLevel ?? "unknown",
      tripDays: run.risk?.tripDays ?? null,
      approvalRoute: run.approvalRoute,
      reason: run.reason,
    });
    const clause = run.summary.slice(run.summary.lastIndexOf("Blocked") >= 0 ? run.summary.lastIndexOf("Blocked") : run.summary.lastIndexOf("Escalated"));
    assert.ok(src.includes(clause), `src and the n8n port disagree.\n  src : ${src}\n  n8n : ${run.summary}`);
  }
});

test("a sanctions block names the DESTINATION, in both copies, not the risk matrix", () => {
  // THE CROSS-COPY PIN, and it is a real one — unlike `assert.equal(a.summary,
  // b.summary)` above, which compares two runs of the SAME (n8n) body and so
  // only proves byte-stability. Here src's exported draftSummaryTemplate and
  // the n8n node's own emitted summary are compared against each other.
  //
  // WHAT WENT WRONG WITHOUT IT. src/uc04/requestParser.js has special-cased
  // `sanctioned_region` since the sanctions gate existed; the port never did,
  // so a sanctions block's stored summary said "Blocked by the risk matrix"
  // — naming a computation as the cause of a decision the matrix did not make.
  // Observed on a REAL execution (11038, unpinned): the note on the ticket read
  // "Risk-matrix level: blocked. Blocked by the risk matrix — not open to
  // approval here." for a destination refused on jurisdiction.
  const factors = {
    homeCountry: "NL",
    nationality: "NL",
    destination: { country: "IR" },
    startDate: "2026-10-01",
    endDate: "2026-10-10",
    visaType: "business_visa",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
  };
  const node = runWorkationGatesNode({
    request: requestFor({ factors }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(node.decision, "blocked");
  assert.equal(node.reason, "sanctioned_region");

  const src = draftSummaryTemplate({
    factors,
    riskLevel: node.risk?.riskLevel ?? "unknown",
    tripDays: node.risk?.tripDays ?? null,
    approvalRoute: node.approvalRoute,
    reason: node.reason,
  });

  // THE CLAUSE, in both copies. Matched on the invariant part rather than the
  // whole sentence, because the two templates DO differ on how they render a
  // country — and that difference is recorded below rather than smoothed over.
  const CLAUSE = /is a sanctioned\/restricted destination; not open to approval here\./;
  assert.match(src, CLAUSE, `src summary lacks the sanctions clause: ${src}`);
  assert.match(node.summary, CLAUSE, `n8n summary lacks the sanctions clause: ${node.summary}`);

  // And the phrase that must NOT be there. Asserted separately from the
  // positive: a copy could gain the right sentence and keep the wrong one.
  assert.ok(!src.includes("Blocked by the risk matrix"), "src still blames the risk matrix");
  assert.ok(!node.summary.includes("Blocked by the risk matrix"), "n8n still blames the risk matrix");

  // Each names the destination in its own vocabulary — the point of the fix is
  // that the DESTINATION is named at all, not which spelling of it.
  assert.match(src, /Blocked — Iran is/);
  assert.match(node.summary, /Blocked — IR is/);

  // The composed internal note interpolates the summary, so the ticket a real
  // customer receives carries the corrected clause too — this is the one that
  // was observed wrong in production (execution 11038).
  assert.match(node.internalNote, CLAUSE, "the composed note still carries the wrong cause");
});

test("KNOWN DIVERGENCE: the two summary templates do not render alike, and this records it", () => {
  // FOUND 2026-08-31 by the test above failing on its first, stricter form.
  // These two templates were ported from one another and have since drifted in
  // ways no test looked at, because test/n8nUc04Parity.test.js's scenario table
  // compares decision / reason / flags / riskLevel / factorIssues and NOT the
  // prose, and its one summary assertion (`assert.equal(a.summary, b.summary)`)
  // compares two runs of the n8n body against each other.
  //
  // TWO DIFFERENCES, both live today:
  //   1. src renders COUNTRY NAMES ("Netherlands", "Iran"); the port renders
  //      ISO CODES ("NL", "IR"). So the same request produces "Workation
  //      request from Netherlands to Iran" on the Node path and "from NL to IR"
  //      on the n8n path.
  //   2. src describes the visa and duties in prose — "The travel document the
  //      requester stated is X, and the work they describe doing there is Y" —
  //      where the port prints "Visa type: X; job duties: Y".
  //
  // NEITHER IS WRONG, which is why this is a recorded divergence and not a fix:
  // both are honest about the same facts, and picking a winner means editing a
  // live graph body or a live Node path for prose alone. It is filed so that a
  // future pass reconciling them starts from a measurement instead of a
  // surprise — and so the drift cannot QUIETLY widen: this test fails the
  // moment either copy changes shape.
  const factors = {
    homeCountry: "NL",
    nationality: "NL",
    destination: { country: "PT" },
    startDate: "2026-10-01",
    endDate: "2026-10-10",
    visaType: "business_visa",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
  };
  const node = runWorkationGatesNode({
    request: requestFor({ factors }),
    employmentResponse: employmentResponse(),
  });
  const src = draftSummaryTemplate({
    factors,
    riskLevel: node.risk?.riskLevel ?? "unknown",
    tripDays: node.risk?.tripDays ?? null,
    approvalRoute: node.approvalRoute,
    reason: node.reason,
  });

  assert.match(src, /from Netherlands to Portugal/, "src stopped rendering country names");
  assert.match(node.summary, /from NL to PT/, "the n8n port stopped rendering ISO codes");
  assert.match(src, /The travel document the requester stated is/, "src's visa prose changed");
  assert.match(node.summary, /Visa type: business_visa; job duties: engineering/, "the port's visa prose changed");

  // The one thing that must NOT diverge: the facts underneath. Same trip
  // length, same decision — the templates may word it differently, they may not
  // disagree about it.
  assert.match(src, /10 day\(s\)/);
  assert.match(node.summary, /10 day\(s\)/);
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

// ---------------------------------------------------------------------------
// THE IDENTITY DERIVATION, WHICH THE SCENARIO TABLE ABOVE CANNOT SEE
// ---------------------------------------------------------------------------
// The per-scenario comparison feeds policyEngine.evaluate() the identity the
// NODE derived, so that the gates are what is being compared. That is the right
// isolation and it is also a blind spot: a divergence in the identity rule
// itself passes every row above. UC-04 gained a second accepted relationship on
// 2026-08-30 — the employee who IS the subject may file their own request, per
// Remote's own object and docs/use-cases/UC-04.md §1 — and it had to be added
// to both copies. These rows drive the node's own derivation directly.
//
// (The node keeps a THIRD leg the Node path does not have: an
// `authenticatedEmail` matched against the record's email, which exists because
// this graph has a Zendesk intake and a ticket carries no Remote session. That
// asymmetry is deliberate and predates this; see the node's own comment.)

test("n8n identity: the employee who IS the subject verifies", () => {
  const out = runWorkationGatesNode({
    request: requestFor({ session: { authenticatedEmploymentId: "emp_active_001" } }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(out.decision, "ready_for_approval", `an employee's own request was refused: ${out.reason}`);
  assert.ok(!out.flags.includes("identity_not_verified"));
});

test("n8n identity: an employee session naming ANOTHER employment does not verify", () => {
  const out = runWorkationGatesNode({
    request: requestFor({ session: { authenticatedEmploymentId: "emp_active_003" } }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(out.decision, "escalate");
  assert.equal(out.reason, "identity_not_verified");
});

test("n8n identity: the session is matched against the RECORD's id, never the requested one", () => {
  // THE TRAP THIS NODE HAS AND src/ DOES NOT. Its `employment.id` deliberately
  // falls back to `request.employmentId` so a downstream node always has
  // something to name — so comparing the session against THAT would compare a
  // session's claim with a body's claim and call their agreement an identity.
  // Here the Remote read produced nothing at all: the two claims agree and
  // there is no record behind either.
  const out = runWorkationGatesNode({
    request: requestFor({ employmentId: "emp_missing", session: { authenticatedEmploymentId: "emp_missing" } }),
    employmentResponse: {},
  });
  assert.equal(out.reason, "identity_not_verified");
});

test("n8n identity: fails closed on absent and empty ids on either side", () => {
  const noneEither = runWorkationGatesNode({
    request: requestFor({ session: { authenticatedEmploymentId: null } }),
    employmentResponse: employmentResponse({ id: null, company_id: null }),
  });
  assert.equal(noneEither.reason, "identity_not_verified", "two absent ids verified an identity");

  const emptyEither = runWorkationGatesNode({
    request: requestFor({ session: { authenticatedEmploymentId: "   " } }),
    employmentResponse: employmentResponse({ id: "   ", company_id: null }),
  });
  assert.equal(emptyEither.reason, "identity_not_verified", "whitespace matched whitespace");
});

test("n8n identity: the company-admin leg is unchanged, including the company boundary", () => {
  const ok = runWorkationGatesNode({ request: requestFor(), employmentResponse: employmentResponse() });
  assert.equal(ok.decision, "ready_for_approval");

  const other = runWorkationGatesNode({
    request: requestFor({ session: { companyId: "co_other", authenticatedAdminId: "admin_jane" } }),
    employmentResponse: employmentResponse(),
  });
  assert.equal(other.reason, "identity_not_verified");
});

// ---------------------------------------------------------------------------
// THE STAGE SENTENCE, PINNED ACROSS BOTH COPIES (2026-08-31)
// ---------------------------------------------------------------------------
// The sentence naming WHO DECIDES A `ready_for_approval` REQUEST AND WHERE was
// wrong in both copies — "Awaiting one mobility specialist's approval" — on a
// request that waits on the CUSTOMER'S OWN MANAGER in Remote's own product. It
// survived the 2026-08-30 three-stage correction because it is PROSE: it changes
// no decision, so nothing in this file compared it.
//
// AND THE TEST ABOVE LOOKS LIKE IT WOULD HAVE CAUGHT IT AND DOES NOT.
// `assert.equal(a.summary, b.summary)` compares two runs of the n8n node against
// EACH OTHER — a byte-stability check. Neither side is src/. So for one day the
// port said "the customer's own manager" and requestParser.js still said
// "mobility specialist", and the whole suite was green.
//
// THE PIN IS THE SENTENCE, NOT THE SUMMARY. The two templates are deliberately
// different shapes (prose here, fields there), so asserting the whole strings
// equal would fail for a reason that is not a defect. What must never diverge
// is the actor and the surface.
test("the stage sentence agrees between src/uc04/requestParser.js and the n8n port", async () => {
  const { draftSummaryTemplate } = await import("../src/uc04/requestParser.js");
  const args = {
    factors: requestFor().factors,
    riskLevel: "low",
    tripDays: 12,
    approvalRoute: "specialist_approval",
    reason: "all_gates_passed",
  };
  const fromSrc = draftSummaryTemplate(args);
  const fromNode = runWorkationGatesNode({ request: requestFor(), employmentResponse: employmentResponse() }).summary;

  // Every phrase that carries the three-stage fact. Both copies must make all
  // of these claims; a copy that drops one has stopped saying who decides.
  for (const phrase of [
    "the customer's own manager",
    "Remote's own product",
    "no Zendesk agent can make it",
    "Remote's Mobility Team",
    "never sent to Remote",
  ]) {
    assert.ok(fromSrc.includes(phrase), `src/uc04/requestParser.js lost: ${phrase}`);
    assert.ok(fromNode.includes(phrase), `workflows/nodes-uc04/workationGates.js lost: ${phrase}`);
  }

  // And the phrase that must never come back, in either copy.
  for (const [where, text] of [["src", fromSrc], ["n8n", fromNode]]) {
    assert.doesNotMatch(text, /mobility specialist'?s? approval/i, `${where} reintroduced the wrong actor`);
  }
});
