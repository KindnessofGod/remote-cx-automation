// ---------------------------------------------------------------------------
// uc04.test.js  —  The 5 UC-04 scenarios from docs/use-cases/UC-04.md §12,
// plus the structural + behavioral checks for the risk matrix, the LLM
// seam's retry wiring, and the narrative-faithfulness judge (same
// discipline as uc06.test.js / uc08.test.js).
//
// No LLM call ever happens here — requestParser.draftSummary() falls back
// to its deterministic template whenever OPENAI_API_KEY isn't set, exactly
// like UC-06's draftSummary, so `npm test` stays hermetic regardless of
// environment. The hermetic-test hazard this devcontainer's own .env
// exposes (a real, broken OPENAI_API_KEY) is handled by injecting a fake
// `isConfigured: () => false` everywhere draftSummary would otherwise run
// (see §4 invariant 10, issue #32) — the same idiom every other test file
// in this repo uses.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient, normalizeEmployment } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest, submitWorkationApproval } from "../src/uc04/workflow.js";
import { evaluate as evaluatePolicy } from "../src/uc04/policyEngine.js";
import { evaluate as evaluateTravel } from "../src/uc03/policyEngine.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { classifyRisk as classifyRiskMatrix, computeCumulativeDays, schengenPeakDays, travelHistoryProblems, tripDurationDays, VISA_TYPES, JOB_DUTY_CATEGORIES, KNOWN_DESTINATIONS, RESTRICTED_JURISDICTIONS, SCHENGEN_LIMIT_DAYS, SCHENGEN_WINDOW_DAYS } from "../src/uc04/riskMatrix.js";
import { LIVE_COUNTRY_ROWS } from "./fixtures/remoteCountries.js";
import { normalizeCountryCode, isWellFormedCountryCode, normalizeCountrySet } from "../src/shared/countryCodes.js";
import { evaluateApprovalAction } from "../src/uc04/approvalPolicy.js";

let server;
let remote;

before(async () => {
  // 4065 — was 4024, which collided with remoteui.test.js's REMOTE_PORT and
  // uc05Server.test.js's own (also-4024) port under node --test's default
  // parallel-file execution.
  server = await startMockServer(4065);
  remote = new RemoteClient({ baseUrl: "http://localhost:4065" });
});
after(() => server && server.close());

let audit;
let authorizationStore;

beforeEach(() => {
  audit = new AuditLogger();
  authorizationStore = new AuthorizationStore();
  // A PATCH mutates the mock's request in place, so an approve in one test
  // leaves the request `approved_by_manager` for the next — and the next test's
  // lookup then finds no PENDING request and reports "no Remote counterpart".
  // That reads as the feature not working rather than as leaked state, which is
  // the exact reading failure this file's subject matter is about.
  resetWorkAuthorizations();
});

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

// This suite's own scenarios are about the gates, not draft prose — inject
// the deterministic template directly so no test here ever makes a real,
// retried LLM call just because OPENAI_API_KEY happens to be set in its
// environment. Runs the REAL draftSummary() forced into its unconfigured
// (template) branch, rather than hand-duplicating the template's exact
// wording — guarantees identical output to production's own fallback,
// never a hand-maintained string that could silently drift from it.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
// Same reasoning as fakeDraftSummary above — never a real, unretried LLM
// call for the faithfulness judge either (issue #27).
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function submit(overrides = {}) {
  return handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: VISA_TYPES.schengen_short_stay,
        jobDuties: JOB_DUTY_CATEGORIES.engineering,
        hasContractSigningAuthority: false,
      },
      travelHistory: [],
      now: "2026-08-15",
      ...overrides,
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

// ---------------------------------------------------------------------------
// 1. Low-risk short trip, permission present -> ready_for_approval, 1-click
// ---------------------------------------------------------------------------

test("1. low-risk short Schengen trip with permission -> ready_for_approval, then one approve executes the PATCH", async () => {
  const r = await submit();
  assert.equal(r.decision, "ready_for_approval");
  assert.equal(r.riskLevel, "low");
  assert.equal(r.tripDays, 14);
  // THE POSITIVE THIS FILE EXISTS FOR. `workAuthorizationId` is now RESOLVED,
  // not created — there is no `POST /v1/work-authorization-requests` (see
  // src/uc04/requestLink.js). The employee raised this request in Remote's
  // Request Hub; the mock carries it as a checked-in fixture, pending, to Spain,
  // for this employment. A suite of refusals would never notice if resolution
  // stopped working, because a request that cannot be linked and one correctly
  // refused look identical from outside.
  assert.equal(
    r.workAuthorizationId,
    "3f2c5b90-9a41-4d0e-8b7d-2f1a6c0e4d21",
    "the pending Remote work-authorization request for this employee and destination"
  );
  assert.equal(r.remoteRequest.linked, true);
  assert.equal(r.remoteRequest.state, "linked");
  assert.equal(r.remoteRequest.status, "pending");

  const first = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(first.ok, true);
  assert.equal(first.code, "executed");

  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.status, "executed");
  assert.equal(row.approver, "mobility_sam");
  assert.ok(row.executedAt);

  // The real write landed — the work authorization's status flipped.
  const wa = await remote.getWorkAuthorization(r.workAuthorizationId);
  // Remote's OWN enum member for an employer-manager approval. NOT
  // `approved_by_remote`, which is Remote's own compliance verdict on a
  // request it has evaluated — see src/uc04/workflow.js's payload comment
  // and docs/REMOTE-VOCABULARY.md §5.4.
  assert.equal(wa.status, "approved_by_manager");
  // `additionalProperties: false` on BOTH of Remote's update schemas: the
  // three fields we used to send are not properties of either. Asserted
  // against the PAYLOAD (recorded in the audit row) rather than against the
  // record read back — the mock's own fixture carries `approved_by: null`
  // whether or not we send it, so reading the record would pass either way.
  const executed = audit.entries.find((e) => e.action === "workation_executed");
  assert.deepEqual(Object.keys(executed.details.payload).sort(), ["status"]);
  assert.equal(executed.details.payload.status, "approved_by_manager");
  // Remote sets the approver itself and reads it back as `employer_approver`.
  // `approved_by` is not a property of `WorkAuthorizationRequest` AT ALL — the
  // mock's fixture is transcribed from Remote's own schema, so the field is
  // simply absent rather than present-and-null. Asserting on the served record
  // as well as on the payload is what proves the mock stopped agreeing with us:
  // it would have accepted, stored and echoed `approved_by` before this pass.
  assert.equal("approved_by" in wa, false, "`approved_by` is not a field on Remote's object");
  assert.equal("employer_approver" in wa, true, "`employer_approver` is");
});

// ---------------------------------------------------------------------------
// 2. Cumulative days push over 30 (or any matrix escalation) -> escalated
// ---------------------------------------------------------------------------

test("2. cumulative presence + this trip would push trailing-365 over 183 days -> escalated, not approval-ready", async () => {
  // DE -> ES: 200 days already in the trailing 365 days. Adding 14 more
  // would push far over the 183-day tax-residency threshold. The matrix
  // pushes this to "medium" via tax_residency_watch (no PE flags here),
  // but the policy engine's escalation rule kicks in once a high PE risk
  // is present too — pick sales + signing power to combine both.
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "US" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.sales,
      hasContractSigningAuthority: true,
    },
    travelHistory: [
      { country: "US", startDate: "2026-01-01", endDate: "2026-07-19" }, // 200 days
    ],
  });
  // This case has BOTH pe_risk_dape (sales + signing) AND us_requires_work_permit
  // (visaType=business_visa, not work_permit) — matrix returns blocked, not
  // escalated, because the US-without-work-permit rule is hard. Switching
  // visa to work_permit below would escalate instead.
  assert.equal(r.decision, "blocked");
  assert.ok(r.flags.includes("us_requires_work_permit"));
});

test("2b. long cumulative presence + PE-risk role without a hard visa block -> escalated by tax-residency watch + PE risk", async () => {
  // Use AE (not Schengen, not US/CA, not in the non-treaty set) to avoid the
  // hard 90/180 Schengen overstay block; sales + signing -> pe_risk_dape;
  // 200 days prior presence -> tax_residency_watch. Combined: escalate.
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "AE" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.sales,
      hasContractSigningAuthority: true,
    },
    travelHistory: [
      { country: "AE", startDate: "2026-01-01", endDate: "2026-07-19" }, // 200 days
    ],
  });
  assert.equal(r.decision, "escalate");
  assert.ok(r.flags.includes("pe_risk_dape"));
  assert.ok(r.flags.includes("tax_residency_watch"));
});

// ---------------------------------------------------------------------------
// 3. High-risk country pair -> escalated
// ---------------------------------------------------------------------------

test("3. executive with contract-signing authority abroad -> escalated, no 1-click approval path", async () => {
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "GB" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.executive,
      hasContractSigningAuthority: true,
    },
  });
  assert.equal(r.decision, "escalate");
  assert.ok(r.flags.includes("pe_risk_dape"));
  assert.equal(r.reason, "high_risk_pair");

  // An attempted approve is refused — escalated rows have no approval path.
  const attempt = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, "not_awaiting_approval");
});

// ---------------------------------------------------------------------------
// 4. Missing employer permission -> blocked
// ---------------------------------------------------------------------------

test("4. employer has not granted the workation custom-field permission -> blocked, no PATCH ever offered", async () => {
  // emp_active_003 is the fixture with workation_permission: false.
  const r = await submit({ employmentId: "emp_active_003" });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "employer_permission_not_granted");
  assert.ok(r.flags.includes("employer_permission_not_granted"));
  assert.equal(r.workAuthorizationId, null, "no work authorization created for a blocked case");

  // And the API would refuse an approve if one were attempted.
  const attempt = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, "not_awaiting_approval");
});

// ---------------------------------------------------------------------------
// 4b. Sanctioned/restricted destination -> HARD blocked, no Remote write
// ---------------------------------------------------------------------------
// Regression coverage for the defect CLAUDE.md records: before this gate
// existed, a sanctioned destination fell straight through to the risk
// matrix like any other pair — the matrix has no notion of sanctions, so a
// sanctioned destination with an otherwise clean profile (no signing
// authority, no PE-risk role, no hard visa/Schengen rule) landed on
// "ready_for_approval" exactly like an ordinary low-risk trip, and
// workflow.js acted on that decision against Remote — it POSTed a create that
// (as of 2026-08-19) turned out not to exist, and now RESOLVES the request an
// employee already raised, either way reaching Remote's work-authorization
// resource for a sanctioned destination, one click away from a specialist's
// approve. Iran and Montenegro were
// indistinguishable. These tests fail on the pre-fix policyEngine.js: a
// destination like "IR" or "CU" with no signing authority and a plain visa
// type reached "ready_for_approval", not "blocked".

test("4b. sanctioned destination (Iran) -> blocked/sanctioned_region, and Remote is not touched at all", async () => {
  // NOTHING IS COUNTED THAT COULD NOT HAPPEN. This test used to count calls to
  // `remote.createWorkAuthorization()`; that method no longer exists, because
  // the endpoint it POSTed to never did. What is counted now is every remaining
  // work-authorization call — the two READS resolution would make and the one
  // WRITE an approval would make. A blocked request must make none of them: the
  // sanctions gate is first, and resolution is skipped for `blocked` entirely,
  // so a sanctioned destination reaches Remote's work-authorization resource in
  // no way at all.
  const calls = [];
  const realGet = remote.getWorkAuthorization.bind(remote);
  const realList = remote.listWorkAuthorizations.bind(remote);
  const realPatch = remote.patchWorkAuthorization.bind(remote);
  remote.getWorkAuthorization = async (...a) => (calls.push("get"), realGet(...a));
  remote.listWorkAuthorizations = async (...a) => (calls.push("list"), realList(...a));
  remote.patchWorkAuthorization = async (...a) => (calls.push("patch"), realPatch(...a));
  try {
    const r = await submit({
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "IR" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: VISA_TYPES.business_visa,
        jobDuties: JOB_DUTY_CATEGORIES.engineering,
        hasContractSigningAuthority: false,
      },
    });
    assert.equal(r.decision, "blocked");
    assert.equal(r.reason, "sanctioned_region");
    assert.ok(r.flags.includes("sanctioned_region"));
    assert.equal(r.workAuthorizationId, null, "no work authorization linked for a sanctioned destination");
    assert.deepEqual(calls, [], "a sanctioned destination must not reach Remote's work-authorization resource at all");

    // The drafted summary must name the true cause (sanctions), not the
    // generic "blocked by the risk matrix" line — the risk matrix never ran
    // for this case, so that phrasing would misstate what happened.
    assert.ok(r.summary.includes("sanctioned"), `summary should name the sanctions block: ${r.summary}`);
    assert.ok(!r.summary.includes("risk matrix"), `summary must not claim the risk matrix decided this: ${r.summary}`);

    // And the API would refuse an approve if one were attempted — a
    // "blocked" row has no approval path, same as every other blocked reason.
    const attempt = await submitWorkationApproval(
      { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
      { remote, audit, authorizationStore }
    );
    assert.equal(attempt.ok, false);
    assert.equal(attempt.code, "not_awaiting_approval");
  } finally {
    remote.getWorkAuthorization = realGet;
    remote.listWorkAuthorizations = realList;
    remote.patchWorkAuthorization = realPatch;
  }
});

test("4c. sanctioned destination that would otherwise look ordinary-low-risk (no signing authority, no PE role, no hard visa rule) is STILL blocked, not escalated or approved", async () => {
  // This is the exact "Iran and Montenegro were indistinguishable" case:
  // Cuba, with a profile that clears every other gate cleanly (engineering,
  // no signing authority, a business visa, short trip) and would otherwise
  // land on riskLevel "low" -> decision "ready_for_approval".
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "CU" },
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.support,
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "sanctioned_region");
  assert.equal(r.workAuthorizationId, null);
});

test("4d. an UNsanctioned destination with the identical low-risk profile still reaches ready_for_approval (Iran and Poland are now distinguishable)", async () => {
  // Same profile as 4c above, destination swapped to Poland (PL) — not in
  // SANCTIONED_OR_RESTRICTED, AND (unlike the first attempt at this test,
  // which used Montenegro) genuinely inside the risk matrix's own curated
  // scope (00-FOUNDATION.md §4.8's nine countries + US). Montenegro isn't
  // sanctioned but ALSO isn't in that curated list, so it correctly reached
  // `escalate`/`destination_out_of_scope` — a real, separate, working gate,
  // not a bug. This test needs a destination that clears BOTH screens to
  // isolate what it's actually testing: that the sanctions gate fires only
  // on the imported sanctions list, nothing broader.
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "PL" },
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.support,
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(r.decision, "ready_for_approval");
  assert.equal(r.reason, "all_gates_passed");
});

test("4e. sanctioned destination is blocked BEFORE the employer-permission gate — a granted blanket permission does not override a sanctions block", async () => {
  // emp_active_003 has workation_permission: false in the fixtures (used by
  // test 4 above). Use emp_active_001 (permission: true) with a sanctioned
  // destination to prove the sanctions check does not depend on — and is
  // not shadowed by — the permission gate either way.
  const r = await submit({
    employmentId: "emp_active_001", // workation_permission: true
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "KP" },
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "sanctioned_region");
});

test("policyEngine.evaluate(): sanctionedRegions is overridable (tests can exercise the gate without depending on the real list's contents)", () => {
  const r = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", custom_fields: { workation_permission: true } },
    factors: {
      homeCountry: "DE", nationality: "DE", destination: { country: "ZZ" },
      startDate: "2026-09-01", endDate: "2026-09-05", visaType: "business_visa",
      jobDuties: "engineering", hasContractSigningAuthority: false,
    },
    now: "2026-08-15",
    sanctionedRegions: new Set(["ZZ"]),
  });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "sanctioned_region");
  assert.ok(r.flags.includes("sanctioned_region"));
});

// ---------------------------------------------------------------------------
// 5. Split itinerary day-count accuracy
// ---------------------------------------------------------------------------

test("5. cumulative days over the trailing 365-day window sum correctly across multiple periods (matrix's day-counter math)", () => {
  const periods = [
    { country: "ES", startDate: "2026-01-01", endDate: "2026-01-10" }, // 10 days
    { country: "ES", startDate: "2026-06-25", endDate: "2026-07-05" }, // 11 days
    { country: "FR", startDate: "2026-02-01", endDate: "2026-02-28" }, // different country, ignored
  ];
  const r = computeCumulativeDays({ travelHistory: periods, country: "ES", windowStart: "2026-01-01", windowEnd: "2026-12-31" });
  assert.equal(r.days, 21);
  assert.equal(r.periodsCounted, 2);
});

test("5b. tripDurationDays is inclusive on both ends, and refuses what it cannot read", () => {
  assert.equal(tripDurationDays("2026-09-01", "2026-09-01"), 1);
  assert.equal(tripDurationDays("2026-09-01", "2026-09-14"), 14);
  // These two used to be pinned at 0 — the defect this test was written
  // against its own behaviour rather than against the truth. See the F-32
  // block at the end of this file for what 0 cost.
  assert.equal(tripDurationDays("2026-09-14", "2026-09-01"), null);
  assert.equal(tripDurationDays("invalid", "2026-09-01"), null);
});

test("5c. the matrix's per-window calculator ignores periods that don't overlap the window", () => {
  const periods = [
    { country: "ES", startDate: "2025-12-25", endDate: "2025-12-31" }, // entirely before window
    { country: "ES", startDate: "2026-02-01", endDate: "2026-02-10" }, // entirely inside
    { country: "ES", startDate: "2026-06-25", endDate: "2026-08-15" }, // straddles window end -> clipped
  ];
  const r = computeCumulativeDays({ travelHistory: periods, country: "ES", windowStart: "2026-01-01", windowEnd: "2026-07-01" });
  // Feb 1-10 = 10 days; Jun 25 - Jul 1 = 7 days (clipped at window end).
  assert.equal(r.days, 17);
  assert.equal(r.periodsCounted, 2);
});

// ---------------------------------------------------------------------------
// Edge cases beyond the 5 documented scenarios
// ---------------------------------------------------------------------------

test("identity: no session -> escalate, identity_not_verified", async () => {
  const r = await submit({ session: null });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("identity: session company does not match employment's company -> escalate", async () => {
  const r = await submit({ session: { companyId: "co_other", authenticatedAdminId: "admin_jane" } });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("employment: terminated employee -> escalate, employee_not_active", async () => {
  const r = await submit({ employmentId: "emp_terminated_002" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
});

test("factors: missing required factor (e.g. no destination) -> blocked, factors_invalid", () => {
  const r = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", custom_fields: { workation_permission: true } },
    factors: { homeCountry: "DE", nationality: "DE", startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay", jobDuties: "engineering", hasContractSigningAuthority: false }, // no destination
    now: "2026-08-15",
  });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "factors_invalid");
  assert.ok(r.flags.includes("missing_destination_country"));
});

test("factors: unknown visa type -> blocked, factors_invalid", () => {
  const r = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", custom_fields: { workation_permission: true } },
    factors: { homeCountry: "DE", nationality: "DE", destination: { country: "ES" }, startDate: "2026-09-01", endDate: "2026-09-14", visaType: "mystery_visa", jobDuties: "engineering", hasContractSigningAuthority: false },
    now: "2026-08-15",
  });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "factors_invalid");
  assert.ok(r.flags.includes("invalid_visa_type"));
});

test("matrix: ESTA/tourist visa + active work -> blocked regardless of other factors", () => {
  // The matrix's headline rule: visitor visas do not permit active remote
  // work in the US (ESTA) or any tourist-only country. This is the case the
  // spec specifically wants the matrix to BLOCK, not escalate — a 1-click
  // approval of "yes, you can work on a tourist visa" would be the worst
  // possible outcome.
  const r = classifyRiskMatrix({
    homeCountry: "US",
    destinationCountry: "MX",
    nationality: "US",
    visaType: "esta_usa",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    now: "2026-08-15",
    travelHistory: [],
  });
  assert.equal(r.riskLevel, "blocked");
  assert.ok(r.flags.includes("visitor_visa_blocks_remote_work"));
});

test("matrix: same-country workation -> blocked (not a workation, a remote-work day)", () => {
  const r = classifyRiskMatrix({
    homeCountry: "DE",
    destinationCountry: "DE",
    nationality: "DE",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    now: "2026-08-15",
  });
  assert.equal(r.riskLevel, "blocked");
  assert.ok(r.flags.includes("same_country"));
});

test("matrix: Schengen 90/180 overstay (175 days of prior presence in the trailing 180) -> blocked", () => {
  const r = classifyRiskMatrix({
    homeCountry: "DE",
    nationality: "DE",
    destinationCountry: "ES",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-14", // 14 more days
    now: "2026-08-15",
    travelHistory: [
      { country: "ES", startDate: "2026-04-01", endDate: "2026-08-15" }, // 137 days
      { country: "ES", startDate: "2026-02-15", endDate: "2026-03-15" }, // 29 days, partially in window
    ],
  });
  assert.equal(r.riskLevel, "blocked");
  assert.ok(r.flags.includes("schengen_overstay"));
});

// ---------------------------------------------------------------------------
// F-13 — country-code case must never decide whether a hard block applies.
//
// Every one of these ran green BEFORE the fix with the lowercase destination
// reaching ready_for_approval (and, end to end, a real PATCH) while the
// uppercase one was correctly blocked. They are written as "the two spellings
// reach the SAME verdict", not "lowercase is blocked", so they keep holding if
// a rule's verdict legitimately changes later — what must never change is that
// the spelling is not what decides it.
// ---------------------------------------------------------------------------

const CASE_VARIANTS = ["us", "Us", " us ", "\tUS\n"];

for (const variant of CASE_VARIANTS) {
  test(`F-13 matrix: destination "${JSON.stringify(variant)}" is blocked exactly like "US" (work-permit gate is case-insensitive)`, () => {
    const factors = {
      homeCountry: "DE",
      nationality: "DE",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false,
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      now: "2026-08-15",
    };
    const canonical = classifyRiskMatrix({ ...factors, destinationCountry: "US" });
    const variantResult = classifyRiskMatrix({ ...factors, destinationCountry: variant });

    assert.equal(canonical.riskLevel, "blocked", "baseline: 'US' without a work permit is blocked");
    assert.equal(variantResult.riskLevel, "blocked", `'${variant}' must not bypass the US work-permit block`);
    assert.deepEqual(variantResult.reasons, canonical.reasons);
    assert.deepEqual(variantResult.flags, canonical.flags);
    assert.equal(variantResult.normalized.destinationCountry, "US");
  });
}

test("F-13 matrix: lowercase 'ca' is blocked exactly like 'CA'", () => {
  const factors = {
    homeCountry: "DE",
    nationality: "DE",
    visaType: VISA_TYPES.business_visa,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    now: "2026-08-15",
  };
  const canonical = classifyRiskMatrix({ ...factors, destinationCountry: "CA" });
  const lower = classifyRiskMatrix({ ...factors, destinationCountry: "ca" });
  assert.equal(canonical.riskLevel, "blocked");
  assert.equal(lower.riskLevel, "blocked");
  assert.ok(lower.flags.includes("ca_requires_work_permit"));
});

test("F-13 matrix: a Schengen 90/180 overstay is blocked for 'es' as for 'ES', including a lowercase travel history", () => {
  const base = {
    homeCountry: "DE",
    nationality: "DE",
    visaType: VISA_TYPES.schengen_short_stay,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    now: "2026-08-15",
  };
  const history = [
    { country: "ES", startDate: "2026-04-01", endDate: "2026-08-15" }, // 137 days
    { country: "ES", startDate: "2026-02-15", endDate: "2026-03-15" },
  ];
  const canonical = classifyRiskMatrix({ ...base, destinationCountry: "ES", travelHistory: history });
  const lowerDestination = classifyRiskMatrix({ ...base, destinationCountry: "es", travelHistory: history });
  // The history's own spelling must not be an escape hatch either — a
  // presence period recorded as "es" still counts towards the ES window.
  const lowerHistory = classifyRiskMatrix({
    ...base,
    destinationCountry: "ES",
    travelHistory: history.map((p) => ({ ...p, country: p.country.toLowerCase() })),
  });

  assert.equal(canonical.riskLevel, "blocked");
  assert.ok(canonical.flags.includes("schengen_overstay"));
  assert.equal(lowerDestination.riskLevel, "blocked", "'es' must not bypass the Schengen overstay block");
  assert.ok(lowerDestination.flags.includes("schengen_overstay"));
  assert.equal(lowerHistory.riskLevel, "blocked", "a lowercase travel history must still count towards the window");
  assert.ok(lowerHistory.flags.includes("schengen_overstay"));
});

test("F-13 end to end: a lowercase 'us' destination never reaches ready_for_approval or a work-authorization record", async () => {
  const factors = {
    homeCountry: "DE",
    nationality: "DE",
    destination: { country: "us" },
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    visaType: VISA_TYPES.business_visa,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
  };
  const r = await submit({ factors });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "us_requires_work_permit");
  assert.equal(r.workAuthorizationId, null, "a blocked case never creates a work-authorization record to PATCH");
});

test("F-13: the CANONICAL destination code is what a Remote request is matched on, not the requester's spelling", async () => {
  // F-13 USED TO BE ABOUT A WRITE THAT NO LONGER HAPPENS. This test asserted
  // that the `destination_country` POSTed to Remote was the code the gates
  // judged rather than the raw one typed. There is no POST — the endpoint does
  // not exist — but the concern survives one step over and is now load-bearing
  // in a different way: the same normalisation decides WHICH Remote request this
  // decision is matched to. Drop it and " es " stops matching a record that says
  // "ES", so a perfectly ordinary request silently reports having no Remote
  // counterpart. The failure would look like an absence, not a bug.
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: " es " }, // padded + lowercase, still ES
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: VISA_TYPES.schengen_short_stay,
      jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(r.decision, "ready_for_approval");
  assert.equal(
    r.workAuthorizationId,
    "3f2c5b90-9a41-4d0e-8b7d-2f1a6c0e4d21",
    "\" es \" must resolve the same pending Remote request that \"ES\" does"
  );
  const wa = await remote.getWorkAuthorization(r.workAuthorizationId);
  // And the comparison is made against Remote's own field. `destination_country`
  // is a full `Country` OBJECT on the real API — never the bare string this
  // repo's old fixtures served — so a matcher reading it as a string would find
  // nothing to compare and quietly match nothing, forever.
  assert.equal(typeof wa.destination_country, "object");
  assert.equal(wa.destination_country.alpha_2_code, "ES");
  assert.equal(wa.destination_country.code, "ESP", "alpha-3 lives on `code`, and is NOT what we compare");
});

test("a request whose Remote record is for a DIFFERENT destination is never linked, and never one-click approvable", async () => {
  // THE DANGEROUS CASE, and the reason employment alone may not identify a
  // request: PATCHing a request we did not identify records an employer verdict
  // against a trip nobody assessed. Here the gates judge Portugal while the only
  // pending request Remote holds for this employee is for Spain.
  const r = await submit({ factors: workationTo("PT", { visaType: VISA_TYPES.digital_nomad_visa }) });
  assert.equal(r.workAuthorizationId, null, "a non-matching destination must not be linked");
  assert.equal(r.remoteRequest.linked, false);
  assert.equal(r.remoteRequest.reason, "no_matching_work_authorization_request");
});

test("F-13: normalizeCountryCode is the single boundary, and survives hostile non-string input", () => {
  assert.equal(normalizeCountryCode("us"), "US");
  assert.equal(normalizeCountryCode(" Es\n"), "ES");
  assert.equal(normalizeCountryCode("US"), "US");
  // Hostile input the simulator actually generates — none of it may throw.
  for (const bad of [null, undefined, 123, {}, [], true]) {
    assert.equal(normalizeCountryCode(bad), "", `${String(bad)} normalises to ""`);
  }
  assert.equal(isWellFormedCountryCode("us"), true);
  assert.equal(isWellFormedCountryCode("United States"), false);
  assert.equal(isWellFormedCountryCode("1"), false);
  assert.deepEqual([...normalizeCountrySet(["ru", " ir ", null, "KP"])], ["RU", "IR", "KP"]);
});

// ---------------------------------------------------------------------------
// F-14 — an unrecognised destination escalates by default (UC-04.md §3).
// ---------------------------------------------------------------------------

// RU, IR and KP used to sit in this list. They still must never reach the
// 1-click path — but as of 2026-08-18 they no longer arrive here as
// "unevaluated": the jurisdiction screen blocks them by name, which is a
// stronger and truer verdict than "the matrix has no rules for this country".
// They are re-pinned in their own loop directly below, so removing them from
// here loses no coverage.
const UNEVALUATED_DESTINATIONS = ["ZZ", "TH", "United States", "1", "中国"];

for (const destination of UNEVALUATED_DESTINATIONS) {
  test(`F-14: destination "${destination}" escalates rather than reaching the 1-click approval path`, async () => {
    const r = await submit({
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: destination },
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        visaType: VISA_TYPES.business_visa,
        jobDuties: JOB_DUTY_CATEGORIES.engineering,
        hasContractSigningAuthority: false,
      },
    });
    assert.equal(r.decision, "escalate", `${destination} must not be ready_for_approval`);
    assert.equal(r.reason, "destination_out_of_scope");
    assert.equal(r.riskLevel, "high", "unevaluated is not low risk");
    assert.ok(r.flags.includes("destination_out_of_scope"));

    // And the escalated row is genuinely not approvable — the specialist's
    // 1-click path is refused server-side, not merely hidden.
    const attempt = await submitWorkationApproval(
      { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
      { remote, audit, authorizationStore }
    );
    assert.equal(attempt.ok, false);
    assert.equal(attempt.code, "not_awaiting_approval");
  });
}

for (const destination of ["RU", "IR", "KP"]) {
  test(`F-14/jurisdiction: destination "${destination}" is blocked outright and is still refused server-side`, async () => {
    const r = await submit({
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: destination },
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        visaType: VISA_TYPES.business_visa,
        jobDuties: JOB_DUTY_CATEGORIES.engineering,
        hasContractSigningAuthority: false,
      },
    });
    assert.equal(r.decision, "blocked", `${destination} is restricted, not merely unevaluated`);
    assert.equal(r.reason, "sanctioned_region");
    assert.equal(r.workAuthorizationId, null, "and no Remote record is created for it");

    const attempt = await submitWorkationApproval(
      { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
      { remote, audit, authorizationStore }
    );
    assert.equal(attempt.ok, false);
    assert.equal(attempt.code, "not_awaiting_approval");
  });
}

test("F-14: every curated-scope country IS evaluated — the escalate-by-default rule is not a blanket refusal", () => {
  for (const known of ["GB", "IE", "DE", "PL", "IN", "PH", "MX", "CA", "PT", "US", "ES", "FR"]) {
    assert.ok(KNOWN_DESTINATIONS.has(known), `${known} must be in scope`);
  }
  const r = classifyRiskMatrix({
    homeCountry: "DE",
    nationality: "DE",
    destinationCountry: "MX",
    visaType: VISA_TYPES.work_permit,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    now: "2026-08-15",
  });
  assert.equal(r.riskLevel, "low");
  assert.deepEqual(r.flags, [], "a fully-evaluated in-scope trip still raises no flags");
});

test("F-14: an unknown destination in lowercase escalates too — the two fixes compose", () => {
  const r = classifyRiskMatrix({
    homeCountry: "DE",
    nationality: "DE",
    destinationCountry: "zz",
    visaType: VISA_TYPES.business_visa,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    now: "2026-08-15",
  });
  assert.equal(r.riskLevel, "high");
  assert.ok(r.flags.includes("destination_out_of_scope"));
});

test("audit log carries the decision at the base tier (medium) when the matrix returns no flags", async () => {
  // DE -> MX, work_permit, engineering, no signing. None of the matrix's
  // soft rules fire (MX is not Schengen, not US/CA, not in NON_TREATY_PAIRS,
  // not EU/EEA so no a1_certificate_recommended). So flags=[] -> the risk
  // engine returns UC-04's base tier ("medium"), not the escalated one.
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "MX" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: VISA_TYPES.work_permit,
      jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(r.decision, "ready_for_approval");
  assert.deepEqual(r.flags, [], "no matrix flags -> base-tier audit row");
  const entries = audit.forUseCase("UC-04");
  assert.ok(entries.some((e) => e.action === "ready_for_approval"));
  assert.equal(entries[0].riskTier, "medium");
});

test("a flagged risk-matrix case elevates the audit tier (medium -> high)", async () => {
  // Sales + signing -> matrix returns high -> policy engine escalates.
  // The audit row records the escalation's tier as "high" because at
  // least one flag was raised (see src/shared/riskEngine.js).
  await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "GB" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: VISA_TYPES.business_visa,
      jobDuties: JOB_DUTY_CATEGORIES.sales,
      hasContractSigningAuthority: true,
    },
  });
  const entries = audit.forUseCase("UC-04");
  assert.equal(entries[0].action, "escalate");
  assert.equal(entries[0].riskTier, "high");
});

test("approval policy: a decided case cannot be approved again", async () => {
  const r = await submit();
  await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  const second = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_jane" },
    { remote, audit, authorizationStore }
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "already_decided");
});

test("approval policy: an approver identity is required", async () => {
  const r = await submit();
  const denied = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "" },
    { remote, audit, authorizationStore }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "approver_required");
  assert.equal(denied.status, 401);
});

test("approval policy: an unknown action is refused", async () => {
  const r = await submit();
  const denied = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "maybe", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "unknown_action");
});

test("decline records the verdict AND transmits it to Remote as declined_by_manager", async () => {
  // A DECLINE THAT REACHES NOBODY IS THE SAME HALF-BUILT SHAPE AS THE CREATE
  // THIS PASS REMOVED. Before 2026-08-19 this path made no Remote call at all,
  // so the employee's request sat `pending` — "awaiting manager review" — for
  // ever after the employer had said no. Remote provides the branch for exactly
  // this (`DeclinedWorkAuthozation`, `reason` REQUIRED), and the request is the
  // employee's, so the answer belongs on it.
  const r = await submit();
  const before = await remote.getWorkAuthorization(r.workAuthorizationId);
  assert.equal(before.status, "pending");

  const declined = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "decline", approver: "mobility_sam", note: "outside policy" },
    { remote, audit, authorizationStore }
  );
  assert.equal(declined.ok, true);
  assert.equal(declined.code, "declined");

  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.status, "declined");
  assert.equal(row.declinedBy.approver, "mobility_sam");

  // The audit action moved with the verb, and its new name must be the one
  // recorded — a rename that leaves the old name on the row would make the
  // vocabulary a claim rather than a fact.
  const actions = audit.entries.map((e) => e.action);
  assert.ok(actions.includes("workation_declined"), "the new audit action name must be what is written");
  assert.ok(!actions.includes("workation_denied"), "the old name must no longer be produced");

  // The employee's own request now carries the answer.
  const after = await remote.getWorkAuthorization(r.workAuthorizationId);
  assert.equal(after.status, "declined_by_manager", "the employer's refusal must reach the request the employee raised");

  // The BODY, asserted from the audit row rather than from the record read
  // back — the mock echoes only what it stored, so reading the record cannot
  // prove which fields were sent. Remote's decline branch is exactly
  // `{status, reason}` (+ optional `employer_special_instructions`), and
  // `reason` is REQUIRED, which is the API stating a refusal must carry one.
  const executed = audit.entries.find((e) => e.action === "workation_executed");
  assert.deepEqual(Object.keys(executed.details.payload).sort(), ["reason", "status"]);
  assert.equal(executed.details.payload.status, "declined_by_manager");
  assert.equal(executed.details.payload.reason, "outside policy", "the specialist's own words, not a template");
});

// POSITIVE, AND THE ONE THAT MATTERS MOST FOR THIS RENAME. The ZAF app is a
// bundle installed in a live Zendesk account; between deploying this API and
// re-uploading that bundle, the sidebar keeps posting `deny`. It MUST still
// work, and it must record the canonical word everywhere — the alias exists at
// the entry point only (src/shared/declineVocabulary.js), so nothing
// downstream should ever learn it was used.
test("the LEGACY `deny` verb still declines, and records `declined` everywhere", async () => {
  const r = await submit();

  const declined = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "deny", approver: "mobility_sam", note: "legacy bundle" },
    { remote, audit, authorizationStore }
  );
  assert.equal(declined.ok, true, "an installed ZAF bundle posting /deny must not 400");
  assert.equal(declined.code, "declined", "the response code is the canonical verb, never the alias");

  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.status, "declined");
  assert.equal(row.declinedBy.approver, "mobility_sam");
  assert.ok(audit.entries.some((e) => e.action === "workation_declined"));
});

// The alias must not make the normaliser permissive: an unknown verb is still
// unknown. This is the property that stops "helpfully" resolving garbage.
test("an unrecognised verb is still refused, alias map notwithstanding", async () => {
  const r = await submit();
  const refused = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "denyish", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "unknown_action");
});


test("freshness re-check: employment goes inactive between create and approve -> execution blocked", async () => {
  // PATCH the employment's status to terminated before the approve.
  // emp_active_001 is shared, so this would leak — use emp_active_003
  // (which has workation_permission off, but we'll toggle it on via a
  // direct mock assignment would be intrusive; instead, use emp_active_001
  // and restore the status after — or, better, trust the test order
  // independence by doing the PATCH on a fresh fixture. The mock server's
  // emp_active_001 is shared across many tests, so we must RESTORE.
  const r = await submit(); // emp_active_001
  await remote.patchEmploymentBasicInformation("emp_active_001", { status: "terminated" });
  try {
    const second = await submitWorkationApproval(
      { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
      { remote, audit, authorizationStore }
    );
    assert.equal(second.ok, false);
    assert.equal(second.code, "employment_no_longer_active");
    const row = await authorizationStore.findById(r.authorizationId);
    assert.equal(row.status, "pending_specialist_approval"); // never marked executed
  } finally {
    // Restore for subsequent tests in the same process.
    await remote.patchEmploymentBasicInformation("emp_active_001", { status: "active" });
  }
});

test("evaluateApprovalAction is pure and refuses on every missing signal", () => {
  const row = { decision: "ready_for_approval", status: "pending_specialist_approval" };
  assert.equal(evaluateApprovalAction({ authorizationRow: row, approver: "x", action: "approve" }).allowed, true);
  assert.equal(evaluateApprovalAction({ authorizationRow: row, approver: null, action: "approve" }).code, "approver_required");
  assert.equal(evaluateApprovalAction({ authorizationRow: row, approver: "x", action: "maybe" }).code, "unknown_action");
  assert.equal(evaluateApprovalAction({ authorizationRow: null, approver: "x", action: "approve" }).code, "authorization_not_found");
  assert.equal(evaluateApprovalAction({ authorizationRow: { decision: "escalate", status: "escalated" }, approver: "x", action: "approve" }).code, "not_awaiting_approval");
});

// ---------------------------------------------------------------------------
// draftSummary()'s retry wiring (issue #32, §4 invariant 10) — same
// discipline as classifier.js's classifyRequest() and
// changeParser.draftSummary(). Fake askJson/isConfigured/backoff, never a
// real network call.
// ---------------------------------------------------------------------------

test("draftSummary retries a failing LLM call before falling back to the template", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const factors = { homeCountry: "DE", nationality: "DE", destination: { country: "ES" }, startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay", jobDuties: "engineering", hasContractSigningAuthority: false };
  const r = await draftSummary(
    { factors, riskLevel: "low", tripDays: 14, approvalRoute: "specialist_approval" },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        throw new Error("connection refused");
      },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "template");
  assert.equal(attempts, 3, "3 attempts (§4 invariant 10) before the template fallback");
  const traces = audit.entries.filter((e) => e.call === "requestParser.draftSummary");
  assert.equal(traces.length, 3, "one trace entry per attempt, a retry is visible in the record");
  assert.ok(traces.every((t) => t.ok === false));
});

test("draftSummary succeeds on a retry and tags source 'llm', with a 2-attempt trace", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const factors = { homeCountry: "DE", nationality: "DE", destination: { country: "ES" }, startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay", jobDuties: "engineering", hasContractSigningAuthority: false };
  const r = await draftSummary(
    { factors, riskLevel: "low", tripDays: 14, approvalRoute: "specialist_approval" },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        if (attempts < 2) throw new Error("transient");
        return { summary: "DE to ES, 14 days, Schengen short-stay, engineering, awaiting specialist approval." };
      },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "llm");
  assert.match(r.summary, /DE to ES/);
  const traces = audit.entries.filter((e) => e.call === "requestParser.draftSummary");
  assert.equal(traces.length, 2, "a 2-attempt success produces 2 trace entries, not a hidden single one");
  assert.equal(traces[0].ok, false);
  assert.equal(traces[1].ok, true);
});

// ---------------------------------------------------------------------------
// Narrative-faithfulness judge (issue #27) — purely informational verdict
// attached to the authorization record for the specialist to see. Same
// discipline as uc06.test.js / uc08.test.js.
// ---------------------------------------------------------------------------

import { judgeNarrative } from "../src/shared/narrativeJudge.js";

function judgedAuthorization(fakeAsk, overrides = {}) {
  const judge = (args) => judgeNarrative(args, { askJson: fakeAsk, isConfigured: () => true });
  return handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
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
      now: "2026-08-15",
      ...overrides,
    },
    { remote, audit: new AuditLogger(), authorizationStore: new AuthorizationStore(), draftSummary: fakeDraftSummary, judge }
  );
}

test("narrative judge: a 'faithful' verdict is attached to the authorization and changes no decision", async () => {
  const fakeAsk = async () => ({ verdict: "faithful", reason: "no drift" });
  // Use a fresh store so the row lives somewhere the test can look it up —
  // judgedAuthorization() owns its own store, and the test reads back from it
  // directly rather than the suite's outer store.
  const store = new AuthorizationStore();
  const judge = (args) => judgeNarrative(args, { askJson: fakeAsk, isConfigured: () => true });
  const r = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "MX" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: VISA_TYPES.work_permit,
        jobDuties: JOB_DUTY_CATEGORIES.engineering,
        hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
    },
    { remote, audit: new AuditLogger(), authorizationStore: store, draftSummary: fakeDraftSummary, judge }
  );
  assert.equal(r.decision, "ready_for_approval", "faithfulness verdict never changes the decision");
  assert.equal(r.faithfulness.verdict, "faithful");
  assert.equal(r.faithfulness.reason, "no drift");

  const row = await store.findById(r.authorizationId);
  assert.equal(row.faithfulness.verdict, "faithful", "verdict is attached to the stored authorization row");
});

test("narrative judge: unconfigured (the hermetic default) attaches an explicit 'not_evaluated' state, never blocks and never fabricates", async () => {
  // Explicitly forced unconfigured — never relies on ambient .env state.
  const judge = (args) => judgeNarrative(args, { isConfigured: () => false });
  const r = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
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
      now: "2026-08-15",
    },
    { remote, audit: new AuditLogger(), authorizationStore: new AuthorizationStore(), draftSummary: fakeDraftSummary, judge }
  );
  assert.equal(r.faithfulness.verdict, "not_evaluated");
  assert.equal(r.faithfulness.reason, null);
});

// ---------------------------------------------------------------------------
// The destination-jurisdiction screen (2026-08-18)
// ---------------------------------------------------------------------------
// WHY THESE EXIST
// UC-04 had no jurisdiction screen at all. A workation request to North Korea
// and a workation request to Montenegro came back with the SAME decision, the
// SAME reason (`destination_out_of_scope`) and the same consequence: an
// `escalate`, which is one of the two decisions workflow.js creates a real
// Remote work-authorization record for. So the platform recorded a pending
// mobility request whose destination Remote's own API cannot even represent —
// `destination_country` on a work authorization is typed as the `Country`
// schema, "A supported country on Remote", and every code in
// RESTRICTED_JURISDICTIONS is absent from that registry (verified live
// 2026-08-18: 224 rows, none of the ten present).
//
// The pair below is the point, and it is deliberately a POSITIVE test next to
// a negative one. This project's most expensive lesson is that "refuses
// correctly" and "structurally cannot succeed" look identical from outside
// (CLAUDE.md §5): every fail-closed assertion passed while UC-03 could never
// auto-resolve at all. A screen that blocks Iran is only worth having if
// Montenegro still gets through it — so both directions are pinned, and the
// Montenegro case fails immediately if anyone "tightens" the screen to
// `eor_onboarding: true`, which is the wrong flag for this question (it says
// whether Remote can EMPLOY someone there, not whether an already-employed
// person may work from there for a fortnight).
// ---------------------------------------------------------------------------

/** Counts what actually reaches Remote's work-authorization resource, so
 *  "nothing was touched" is proved by the absence of a CALL, not merely by a
 *  null id in the return value.
 *
 *  IT USED TO COUNT `createWorkAuthorization`, AND WAS THEREFORE VACUOUS ONCE
 *  THAT METHOD WAS REMOVED — a counter for a call nobody can make asserts zero
 *  forever, green, proving nothing. That is the same failure this whole area of
 *  the codebase is about, so the counter now names the three calls that DO
 *  exist and would each be a real reach into Remote. It also no longer proxies
 *  `updateWorkAuthorization`, which was never a method on this client at all. */
function countingRemote(inner) {
  const calls = [];
  const count = (name, fn) => (...a) => {
    calls.push(name);
    return fn(...a);
  };
  return {
    calls,
    proxy: {
      getEmployment: (...a) => inner.getEmployment(...a),
      getWorkAuthorization: count("getWorkAuthorization", inner.getWorkAuthorization.bind(inner)),
      listWorkAuthorizations: count("listWorkAuthorizations", inner.listWorkAuthorizations.bind(inner)),
      patchWorkAuthorization: count("patchWorkAuthorization", inner.patchWorkAuthorization.bind(inner)),
    },
  };
}

const workationTo = (country, over = {}) => ({
  homeCountry: "DE",
  nationality: "DE",
  destination: { country },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: VISA_TYPES.business_visa,
  jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
  ...over,
});

test("NEGATIVE: a restricted destination is BLOCKED by name, and no Remote work-authorization record is ever created for it", async () => {
  const { calls, proxy } = countingRemote(remote);
  const r = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: workationTo("KP"),
      travelHistory: [],
      now: "2026-08-15",
    },
    { remote: proxy, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );

  assert.equal(r.decision, "blocked", "a restricted jurisdiction is not a case a specialist may approve");
  assert.equal(r.reason, "sanctioned_region", "the specialist reads WHY, not 'the matrix has no rules for this'");
  assert.ok(r.flags.includes("sanctioned_region"));
  assert.equal(r.workAuthorizationId, null);
  assert.deepEqual(calls, [], "a destination Remote's own registry excludes must not reach its work-authorization resource");
});

test("NEGATIVE: the jurisdiction screen is case-normalised on both sides — 'ir' blocks exactly like 'IR'", () => {
  for (const spelling of ["IR", "ir", "iR"]) {
    const risk = classifyRiskMatrix({
      ...workationTo(spelling),
      destinationCountry: spelling,
      homeCountry: "DE",
      nationality: "DE",
      now: "2026-08-15",
    });
    assert.equal(risk.riskLevel, "blocked", `${spelling}: a lowercase code must not walk past the screen (F-13's defect class)`);
    assert.ok(risk.reasons.includes("sanctioned_region"), `${spelling}: reasons`);
  }
});

test("NEGATIVE: every member of RESTRICTED_JURISDICTIONS blocks, and each one is genuinely absent from Remote's live registry", () => {
  const liveCodes = new Set(LIVE_COUNTRY_ROWS.map((row) => row.alpha_2_code));
  for (const code of RESTRICTED_JURISDICTIONS) {
    const decision = evaluatePolicy({
      identityVerified: true,
      employment: { status: "active", company_id: "co_amend_01", custom_fields: { workation_permission: true } },
      factors: workationTo(code),
      now: "2026-08-15",
    });
    assert.equal(decision.decision, "blocked", `${code} must be blocked`);
    assert.equal(decision.reason, "sanctioned_region", `${code}: reason`);
    // The fixture is a subset of the live 224, so this proves non-membership
    // only for the rows it holds — which is the honest claim to make from it.
    assert.equal(liveCodes.has(code), false, `${code} appears in the live-registry fixture; the two lists disagree and one of them is wrong`);
  }
});

test("POSITIVE: a LISTED, non-EOR destination (Montenegro) passes the jurisdiction screen — the predicate is registry membership, never eor_onboarding", async () => {
  // Guard the guard: if the live row ever flips to `eor_onboarding: true` this
  // test stops proving anything about the distinction it exists to protect.
  const me = LIVE_COUNTRY_ROWS.find((row) => row.alpha_2_code === "ME");
  assert.ok(me, "the Montenegro fixture row must exist");
  assert.equal(me.eor_onboarding, false, "if this is ever true, this test proves nothing");
  assert.equal(RESTRICTED_JURISDICTIONS.has("ME"), false);

  const r = await submit({ factors: workationTo("ME") });

  // NOT blocked. UC-04 still escalates it — Montenegro is outside the curated
  // risk matrix, and an unevaluated country is not a cleared one — but it
  // escalates for the reason that is TRUE, and a specialist can act on the
  // difference between "we have no rules for this pair" and "we cannot support
  // this jurisdiction".
  assert.notEqual(r.decision, "blocked", "a country in Remote's registry is not a restricted jurisdiction");
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "destination_out_of_scope");
  assert.equal(r.flags.includes("sanctioned_region"), false);
});

test("POSITIVE: the success path is still reachable — an in-scope destination reaches ready_for_approval with no jurisdiction flag", async () => {
  const r = await submit({ factors: workationTo("PT", { visaType: VISA_TYPES.digital_nomad_visa }) });
  assert.equal(r.decision, "ready_for_approval", "the screen must not have made every workation unapprovable");
  assert.equal(r.reason, "all_gates_passed");
  assert.equal(r.flags.includes("sanctioned_region"), false);
  // Remote holds no PENDING request for this employee to Portugal, so this one
  // has no Remote counterpart — and that is an ANSWER, not a failure. It does
  // not change the decision: a specialist may still approve, and the record
  // states plainly that the approval will not be transmitted anywhere.
  assert.equal(r.workAuthorizationId, null);
  assert.equal(r.remoteRequest.linked, false);
  assert.equal(r.remoteRequest.state, "unlinked");
});

test("POSITIVE: an approval with no Remote counterpart still completes — and says, everywhere, that nothing was sent", async () => {
  // THE OTHER HALF OF THE DESIGN DECISION. Refusing here would make every
  // portal-originated UC-04 request unapprovable, and UC-04 would become a use
  // case that can only ever be observed refusing — the failure shape this
  // repository has paid for repeatedly. So the human's decision is real and
  // final; what must never happen is the system implying a Remote record exists.
  const r = await submit({ factors: workationTo("PT", { visaType: VISA_TYPES.digital_nomad_visa }) });
  assert.equal(r.workAuthorizationId, null);

  const done = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.code, "approved_no_remote_record", "NOT `executed` — nothing was executed anywhere");
  assert.equal(done.remoteResult, null);
  assert.equal(done.remoteWrite.transmitted, false);
  assert.equal(done.remoteWrite.reason, "no_remote_work_authorization_request");

  // Durable, in the append-only log, with its own action name so the metrics
  // layer can count it. A `console.error` is what let the missing endpoint
  // survive for months; this is the same fact made impossible to miss.
  const notSent = audit.entries.find((e) => e.action === "workation_not_transmitted");
  assert.ok(notSent, "an untransmitted approval must leave its own durable row");
  assert.equal(notSent.details.transmitted, false);
  assert.equal(notSent.details.workAuthorizationId, null);
  assert.ok(!audit.entries.some((e) => e.action === "workation_executed"), "nothing was executed, so nothing may say so");

  // The row is SETTLED, so it cannot be approved a second time — being honest
  // about the missing Remote record must not open a double-decision hole.
  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.status, "executed");
  assert.equal(row.remoteResult.transmitted, false);
  const again = await submitWorkationApproval(
    { authorizationId: r.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote, audit, authorizationStore }
  );
  assert.equal(again.ok, false);
  assert.equal(again.code, "already_decided");
  // And what a second approver reads does not claim a write that never
  // happened — `remoteResult` is truthy here, which is exactly what the old
  // "any truthy value means it landed" clause would have mis-described. The
  // facts are labelled fields now rather than one paragraph, so the "sent to
  // Remote" answer is asserted where it lives.
  assert.match(again.reason, /^Sent to Remote: No — /m);
  assert.match(again.reason, /The approval is real and recorded; the Remote request it would have updated does not exist\./);
});

test("the screen is a jurisdiction screen, not an EOR-footprint screen — passing an EMPTY set is the only way to disable it", () => {
  const factors = workationTo("IR");
  const withDefault = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co_amend_01", custom_fields: { workation_permission: true } },
    factors,
    now: "2026-08-15",
  });
  assert.equal(withDefault.decision, "blocked");

  // Explicit, deliberate, and visible in the caller — never the default.
  // Two independent knobs now, not one: `sanctionedRegions` is the early
  // hard-block that actually produces `reason: "sanctioned_region"` (added
  // after this test was first written); `restrictedJurisdictions` feeds the
  // risk matrix's own later scoring. Disabling the SCREEN this test is named
  // for means clearing the one that actually gates the decision.
  const disabled = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co_amend_01", custom_fields: { workation_permission: true } },
    factors,
    now: "2026-08-15",
    sanctionedRegions: new Set(),
    restrictedJurisdictions: new Set(),
  });
  assert.notEqual(disabled.reason, "sanctioned_region", "an empty set disables the screen — pinned so nobody sets it by accident and calls it a default");
});

// ---------------------------------------------------------------------------
// One jurisdiction question, one answer — across two use cases with different
// questions
// ---------------------------------------------------------------------------
// UC-03 asks "may this person TRAVEL there?" and UC-04 asks "may they WORK
// from there?". Those are different questions and they get different answers:
// UC-03 auto-resolves Montenegro, UC-04 escalates it to a mobility specialist.
// What they must NEVER disagree about is the jurisdiction itself — whether the
// destination is one Remote's own registry excludes. That is a property of the
// country, not of the question being asked about it, and the two use cases now
// read it from a single set (src/uc04/riskMatrix.js imports UC-03's).
//
// This test is the positive half. Every row in the live-registry fixture is a
// real country from `GET /v1/countries`, EOR and non-EOR alike; each must clear
// UC-03's gate outright and must not be blocked as a restricted jurisdiction by
// UC-04. If anyone re-points either predicate at `eor_onboarding`, the non-EOR
// rows (ASM, MNE) fail here immediately.
// ---------------------------------------------------------------------------

test("POSITIVE cross-UC: every country in Remote's live registry clears UC-03's gate and is never a restricted jurisdiction in UC-04", () => {
  const registry = new Set(LIVE_COUNTRY_ROWS.map((row) => row.alpha_2_code));
  assert.ok(registry.size >= 8, "the fixture must actually hold rows");
  assert.ok(
    LIVE_COUNTRY_ROWS.some((row) => row.eor_onboarding === false),
    "and it must hold at least one NON-EOR row, or this proves nothing about which predicate is in force"
  );

  for (const row of LIVE_COUNTRY_ROWS) {
    const code = row.alpha_2_code;

    // UC-03 (🟢): a travel inquiry for a registry country auto-resolves.
    const travel = evaluateTravel({
      // `contract_type` is required to REACH the destination gate this loop is
      // about: UC-03's engagement gate sits ahead of it and fails closed on an
      // unreadable engagement.
      employment: { status: "active", contract_type: "full_time" },
      classification: {
        intent: "travel_letter",
        confidence: 0.9,
        destinationCountry: code,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        formalLetterRequested: false,
      },
      identity: { verified: true, reason: "requester_matches_employment" },
      supportedCountries: registry,
    });
    assert.equal(travel.decision, "auto_resolve", `${code} (${row.name}, eor_onboarding=${row.eor_onboarding}) must reach UC-03's success path`);

    // UC-04 (🟡): the same country may still escalate — it is a different
    // question — but never as a restricted jurisdiction.
    assert.equal(RESTRICTED_JURISDICTIONS.has(code), false, `${code} is in Remote's registry and must not be on the restricted list`);
    const work = evaluatePolicy({
      identityVerified: true,
      employment: { status: "active", company_id: "co_amend_01", custom_fields: { workation_permission: true } },
      factors: workationTo(code),
      now: "2026-08-15",
    });
    assert.notEqual(work.reason, "sanctioned_region", `${code} must not be refused by UC-04's jurisdiction screen`);
  }
});

// ---------------------------------------------------------------------------
// F-32 — an undated trip is not a 0-day trip
// ---------------------------------------------------------------------------
// Same defect class as F-28 (UC-05), F-29 (UC-07) and F-30 (the portal): a
// quantity that is UNKNOWN is coerced into a quantity that is ZERO. Zero is a
// real answer to a real question, so nothing errors, nothing flags, and the
// record a specialist reads asserts a figure nobody derived.
//
// It appeared twice on this path:
//
//   1. tripDurationDays() returned 0 for dates it could not read at all
//      ("next Tuesday"), and for a pair the wrong way round. Neither is a
//      length of zero days; both are "we cannot state a length".
//   2. workflow.js flattened `result.risk?.tripDays ?? 0` into the drafted
//      summary, the judge's inputs, the stored row and the API response —
//      while the audit row alone used `?? null`. So a request that never got
//      as far as computing a duration (identity refused, employee inactive,
//      permission absent, factors malformed) was still persisted with an
//      explicit `tripDays: 0`.
//
// The sharpest instance is the identity refusal below: the stored record
// states 2026-09-01 → 2026-09-14 AND a length of 0 days, in the same sentence.
// The dates are 14 days apart. The record contradicts itself and nothing
// anywhere reports a problem.
//
// WHY THE FIX IS AN HONEST `null` AND NOT A NEW ESCALATE GATE
// The routing was already right in every one of these cases. Missing dates are
// caught by factorValidationIssues() (`blocked / factors_invalid` +
// `missing_dates`); unreadable and reversed dates are caught by the matrix
// (`blocked / invalid_date`, `blocked / end_before_start`); the three
// risk-is-null cases each escalate or block under their own accurate reason.
// Every one is already durable and audited — unlike F-28/F-29, nothing here
// ever vanished. Adding a gate would therefore add no safety and would
// RELABEL a correctly-named refusal as a data problem, which is precisely the
// mistake F-28's own gate-ordering note warns against: the routing would be
// identical and only the recorded reason would get worse.
//
// So the decision is left exactly as it is, and only the NUMBER stops lying.
// `null` says "not derived"; 0 says "derived, and it came to zero". A reader
// investigates the first and acts on the second (CLAUDE.md §9).

test("F-32: tripDurationDays refuses a duration it cannot derive, instead of calling it zero", () => {
  // Unreadable input — no length can be stated.
  assert.equal(tripDurationDays(undefined, undefined), null);
  assert.equal(tripDurationDays("next Tuesday", "2026-09-14"), null);
  assert.equal(tripDurationDays("2026-09-01", "sometime in October"), null);
  // Reversed dates are not a zero-length trip either; they are a pair we
  // cannot read AS a trip. The matrix blocks them by their own name
  // (`end_before_start`) — this only stops the length being invented.
  assert.equal(tripDurationDays("2026-09-14", "2026-09-01"), null);
});

test("F-32 POSITIVE: a real trip still computes its real, inclusive day count", () => {
  // The half that a fail-closed assertion cannot see. A function that returned
  // null for everything would pass every refusal test above (§3.30).
  assert.equal(tripDurationDays("2026-09-01", "2026-09-01"), 1, "a same-day trip is 1 day, and has never been 0");
  assert.equal(tripDurationDays("2026-09-01", "2026-09-14"), 14);
  assert.equal(tripDurationDays("2026-12-28", "2027-01-03"), 7, "across a year boundary");
});

test("F-32: unreadable dates are blocked by name AND carry no invented length", async () => {
  const r = await submit({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "next Tuesday",
      endDate: "sometime in October",
      visaType: VISA_TYPES.schengen_short_stay,
      jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false,
    },
  });
  // The routing is unchanged — this was always correctly refused.
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "invalid_date");
  // The number is what changes.
  assert.equal(r.tripDays, null);
  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.tripDays, null, "the stored row must not assert a length");
  assert.equal(row.risk.tripDays, null, "nor may the risk object it was derived from");
  assert.ok(
    !/ 0 day\(s\)/.test(row.summary),
    `the drafted summary must not state a 0-day trip: ${row.summary}`
  );
});

test("F-32: a request with NO dates at all is blocked and stores no length", async () => {
  const factors = {
    homeCountry: "DE",
    nationality: "DE",
    destination: { country: "ES" },
    visaType: VISA_TYPES.schengen_short_stay,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
  };
  const r = await submit({ factors });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "factors_invalid");
  assert.ok(r.flags.includes("missing_dates"));
  assert.equal(r.tripDays, null);
  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.tripDays, null);
});

test("F-32: a record whose gates never ran does not claim a 0-day trip beside 14 days of dates", async () => {
  // The self-contradicting record. Identity is refused, so the matrix never
  // runs and `risk` is null — but the request's own dates are right there,
  // two weeks apart, in the same stored row and the same drafted sentence.
  const r = await submit({ session: null });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
  assert.equal(r.tripDays, null, "a duration that was never computed is not zero");

  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.tripDays, null);
  assert.match(row.summary, /2026-09-01 to 2026-09-14/, "the dates are still reported honestly");
  assert.ok(
    !/ 0 day\(s\)/.test(row.summary),
    `a 14-day span may never be summarised as 0 days: ${row.summary}`
  );
});

test("F-32: the audit row and the stored row now agree — one of them used to say 0 and the other null", async () => {
  const r = await submit({ session: null });
  const row = await authorizationStore.findById(r.authorizationId);
  const entry = audit.entries.find((e) => e.useCase === "UC-04");
  assert.equal(entry.details.tripDays, null);
  assert.equal(row.tripDays, entry.details.tripDays, "the durable record and the audit trail must state the same thing");
});

test("F-32 POSITIVE: a fully dated trip still reaches ready_for_approval with its real day count everywhere", async () => {
  // The control. If the fix had been implemented by making the gate refuse
  // anything it was unsure of, every assertion above would still pass and this
  // one would not.
  const r = await submit();
  assert.equal(r.decision, "ready_for_approval");
  assert.equal(r.reason, "all_gates_passed");
  assert.equal(r.tripDays, 14);

  const row = await authorizationStore.findById(r.authorizationId);
  assert.equal(row.tripDays, 14);
  assert.equal(row.risk.tripDays, 14);
  assert.match(row.summary, /for 14 day\(s\)/);
  const entry = audit.entries.find((e) => e.useCase === "UC-04");
  assert.equal(entry.details.tripDays, 14);
});

test("F-32 POSITIVE: the day count still drives the Schengen 90/180 arithmetic it is there for", async () => {
  // tripDays is not decoration — `cumulativeDays + tripDays > 90` is a
  // statutory comparison. A trip of 20 days on top of 75 prior days must
  // exceed the window; the same trip with no prior history must not. If the
  // refusal above had leaked a null into this sum it would read as 0 and the
  // overstay would silently clear.
  const overstaying = classifyRiskMatrix({
    homeCountry: "DE", destinationCountry: "ES", nationality: "DE",
    visaType: VISA_TYPES.schengen_short_stay, jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    startDate: "2026-09-01", endDate: "2026-09-20", now: "2026-08-15",
    travelHistory: [{ country: "ES", startDate: "2026-05-01", endDate: "2026-07-14" }], // 75 days
  });
  assert.equal(overstaying.tripDays, 20);
  assert.equal(overstaying.riskLevel, "blocked");
  assert.ok(overstaying.flags.includes("schengen_overstay"));

  const clear = classifyRiskMatrix({
    homeCountry: "DE", destinationCountry: "ES", nationality: "DE",
    visaType: VISA_TYPES.schengen_short_stay, jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    startDate: "2026-09-01", endDate: "2026-09-20", now: "2026-08-15",
    travelHistory: [],
  });
  assert.equal(clear.tripDays, 20);
  assert.equal(clear.riskLevel, "low");
});

test("F-32 STRUCTURAL: a null tripDays can never reach the matrix's day-count thresholds", () => {
  // Why the two `+ tripDays` sums above are NOT defensively guarded: every
  // input that yields a null length also pushes a `reasons` entry, and the
  // matrix returns `blocked` before either threshold is evaluated. Guarding an
  // unreachable path is how a codebase stops telling the truth about what can
  // happen (docs/BUILD-LOG.md §3.31) — so the invariant is asserted here
  // instead, and this test fails the day someone reorders those returns.
  const unreadable = [
    { startDate: undefined, endDate: undefined },
    { startDate: "next Tuesday", endDate: "2026-09-14" },
    { startDate: "2026-09-14", endDate: "2026-09-01" },
  ];
  for (const dates of unreadable) {
    const risk = classifyRiskMatrix({
      homeCountry: "DE", destinationCountry: "ES", nationality: "DE",
      visaType: VISA_TYPES.schengen_short_stay, jobDuties: JOB_DUTY_CATEGORIES.engineering,
      hasContractSigningAuthority: false, now: "2026-08-15", travelHistory: [],
      ...dates,
    });
    assert.equal(risk.tripDays, null, `${JSON.stringify(dates)} must not state a length`);
    assert.equal(risk.riskLevel, "blocked", `${JSON.stringify(dates)} must be blocked before any threshold reads the length`);
    assert.ok(risk.reasons.length > 0, "a null length always comes with a named reason");
  }
});

// ---------------------------------------------------------------------------
// The employer-permission gate reads a field the normalizer used to discard
// ---------------------------------------------------------------------------
// FOUND BY DRIVING THE LIVE STAND-IN, NOT BY READING CODE.
// `policyEngine.js`'s permission gate is `!employment.custom_fields ||
// employment.custom_fields.workation_permission !== true`. `normalizeEmployment()`
// builds its result from an allow-list, and `custom_fields` was not on it — so
// against the REAL API's nested employment shape the key was simply absent and
// the FIRST half of that test was true for every request UC-04 ever evaluated.
// Every workation filed through the Node path came back
// `blocked / employer_permission_not_granted`.
//
// It survived because of the early return at the top of normalizeEmployment():
// the mock's FLAT shape is handed back untouched, so `custom_fields` reached
// the gate in every offline test, in the portal, in the playground and in
// `npm run walkthrough`. Only the nested shape lost it, and only the nested
// shape is production — the same fixture-agrees-with-the-code mechanism as
// F-27, one field over.
//
// The cost is doubled by what it defeated: the real Sandbox employment object
// has NO `custom_fields` key at all [CONFIRMED live 2026-08-19 against
// gateway.remote-sandbox.com], which is exactly why src/remotebridge/
// enrichment.js injects the block and names it in `X-Standin-Enriched`. Driven
// through that stand-in — whose body genuinely carries
// `custom_fields: {workation_permission: true}` — the gate still answered
// `blocked`. The demo infrastructure built to unblock this use case was being
// thrown away one function later.
//
// The n8n port reads the raw HTTP body and never had the problem, so the two
// execution paths disagreed about the same employment. This is the POSITIVE
// half: the gate must be able to PASS, not only to refuse.
test("POSITIVE: a real-API-shaped employment carries custom_fields through to UC-04's permission gate", () => {
  // The nested shape `GET /v1/employments/{id}` returns, plus the
  // `custom_fields` block src/remotebridge/enrichment.js adds for demo
  // records. No `contract_type`/`start_date` at top level, so this takes the
  // FULL normalization path — the one production always takes.
  const nested = {
    id: "2f7f8210-91fc-47db-803c-77a1cc625781",
    status: "active",
    employment_model: "employee",
    company_id: "co_amend_01",
    basic_information: { provisional_start_date: "2023-06-26", job_title: "Engineer" },
    country: { code: "USA", alpha_2_code: "US" },
    custom_fields: { workation_permission: true, employer_permission_granted: true },
  };
  const normalized = normalizeEmployment(nested);
  assert.deepEqual(
    normalized.custom_fields,
    { workation_permission: true, employer_permission_granted: true },
    "normalizeEmployment() dropped custom_fields, so UC-04's permission gate can never pass in production"
  );

  const out = evaluatePolicy({
    identityVerified: true,
    employment: normalized,
    factors: {
      homeCountry: "US",
      nationality: "US",
      destination: { country: "PT" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "digital_nomad_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    now: "2026-08-19",
  });
  assert.equal(out.decision, "ready_for_approval");
  assert.equal(out.reason, "all_gates_passed");
});

test("a nested employment with NO custom_fields still blocks — the gate is unchanged, only reachable", () => {
  // The raw Sandbox record. Remote does not define this field, so the refusal
  // is correct and is what the stand-in exists to work around. Pinned so the
  // fix above cannot be mistaken for loosening the gate.
  const raw = normalizeEmployment({
    id: "emp_raw",
    status: "active",
    employment_model: "employee",
    company_id: "co_amend_01",
    basic_information: {},
    country: { code: "USA", alpha_2_code: "US" },
  });
  assert.equal(raw.custom_fields, null);
  const out = evaluatePolicy({
    identityVerified: true,
    employment: raw,
    factors: {
      homeCountry: "US", nationality: "US", destination: { country: "PT" },
      startDate: "2026-09-01", endDate: "2026-09-14",
      visaType: "digital_nomad_visa", jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    now: "2026-08-19",
  });
  assert.equal(out.decision, "blocked");
  assert.equal(out.reason, "employer_permission_not_granted");
});

// ---------------------------------------------------------------------------
// The sanctions gate has to be the gate that catches a sanctioned destination
// ---------------------------------------------------------------------------
// `sanctionedRegions.has(requestedDestination)` was case-sensitive on both
// sides, so a lowercase `"ir"` matched nothing here and the request carried on
// to the employer-permission gate, the factors gate, and finally the risk
// matrix's own jurisdiction screen — which DOES normalise, and so blocked it.
// The verdict was always `blocked`; the RECORDED REASON was whatever gate got
// there first. Found from the portal: `IR` and `ir`, identical in every other
// field, took different paths through evaluate().
//
// These are the cases that separate "this gate works" from "something
// downstream happens to catch it": each one is a request where a LATER gate
// would refuse for its own, different, plausible-looking reason.
test("a lowercase sanctioned destination is caught by the sanctions gate, not by a later one", () => {
  const factors = {
    homeCountry: "DE", nationality: "DE", destination: { country: "ir" },
    startDate: "2026-09-01", endDate: "2026-09-14",
    visaType: "business_visa", jobDuties: "engineering",
    hasContractSigningAuthority: false,
  };

  // (a) the employer has NOT granted permission — the next gate down would
  //     say `employer_permission_not_granted`, which is a fact about the
  //     employer and tells a specialist nothing about the destination.
  const noPermission = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co", custom_fields: { workation_permission: false } },
    factors,
    now: "2026-08-15",
  });
  assert.equal(noPermission.decision, "blocked");
  assert.equal(noPermission.reason, "sanctioned_region");

  // (b) the factors are malformed — the gate after that would say
  //     `factors_invalid`, a complaint about the form.
  const malformed = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co", custom_fields: { workation_permission: true } },
    factors: { ...factors, visaType: "not_a_visa_type" },
    now: "2026-08-15",
  });
  assert.equal(malformed.decision, "blocked");
  assert.equal(malformed.reason, "sanctioned_region");
  // Nothing scored it, so nothing claims a length — the honest absence.
  assert.equal(malformed.risk, null);
});

test("a sanctioned block on a well-formed request still reports the trip it blocked", () => {
  // The gate returned `risk: null`, and workflow.js reads tripDays,
  // cumulativeDays and riskLevel off `risk` — so the durable
  // `uc04_authorizations` row and the specialist's drafted summary said "an
  // undetermined number of days" about a trip with two readable dates. A
  // manufactured ABSENCE, the mirror of the manufactured zero F-32 removed,
  // and visible from the portal: `IR` reported no length while `ir` reported
  // 14 days for the same request. It was also both `test.todo()`s in
  // test/n8nUc04Parity.test.js — the n8n port has no early sanctions gate, so
  // it always produced the full object and the two copies could not be
  // compared on it.
  const out = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co", custom_fields: { workation_permission: true } },
    factors: {
      homeCountry: "DE", nationality: "DE", destination: { country: "IR" },
      startDate: "2026-09-01", endDate: "2026-09-14",
      visaType: "business_visa", jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    now: "2026-08-15",
  });
  assert.equal(out.decision, "blocked");
  assert.equal(out.reason, "sanctioned_region");
  assert.equal(out.risk?.riskLevel, "blocked");
  assert.equal(out.risk?.tripDays, 14, "the block must not erase a length it could compute");
  assert.deepEqual(out.flags, ["sanctioned_region"]);
});

test("a sanctioned destination that is ALSO a visitor visa reports both flags", () => {
  // The early return could only ever emit the one flag it returned on, so a
  // specialist could not see that the visa was independently disqualifying —
  // a fact about the request, not about the destination. `sanctioned_region`
  // still wins the REASON, because that is the answer to the request.
  const out = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co", custom_fields: { workation_permission: true } },
    factors: {
      homeCountry: "DE", nationality: "DE", destination: { country: "KP" },
      startDate: "2026-09-01", endDate: "2026-09-14",
      visaType: "tourist_visa", jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    now: "2026-08-15",
  });
  assert.equal(out.reason, "sanctioned_region");
  assert.deepEqual(out.flags, ["sanctioned_region", "visitor_visa_blocks_remote_work"]);
});

test("the sanctions gate does not depend on the risk matrix's own jurisdiction screen", () => {
  // A caller may pass an EMPTY `restrictedJurisdictions` to disable the
  // matrix's screen. This gate's whole claim is that it is independent of it,
  // so the block — and the flag — must survive that.
  const out = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", company_id: "co", custom_fields: { workation_permission: true } },
    factors: {
      homeCountry: "DE", nationality: "DE", destination: { country: "IR" },
      startDate: "2026-09-01", endDate: "2026-09-14",
      visaType: "business_visa", jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    now: "2026-08-15",
    restrictedJurisdictions: new Set(),
  });
  assert.equal(out.decision, "blocked");
  assert.equal(out.reason, "sanctioned_region");
  assert.ok(out.flags.includes("sanctioned_region"));
});

// ---------------------------------------------------------------------------
// The requester's stated reason has to survive somewhere a human can read it
// ---------------------------------------------------------------------------
// `reasonText` came in from the intake form, was interpolated into
// draftSummary()'s LLM PROMPT, and went nowhere else. The store has no column
// for it, and `draftSummaryTemplate()` — the deterministic fallback — never
// mentions it. So on every run without a working LLM the free text a person
// typed to explain their trip was read once, by a model that was not there,
// and discarded. UC-04 escalates to a human for JUDGEMENT, and two requests
// with identical factors can be very different requests.
//
// The fallback path is asserted specifically, because that is the one where
// the loss was total.
test("the requester's stated reason reaches the audit record even with no LLM", async () => {
  const store = new AuthorizationStore();
  const rows = [];
  const auditSpy = new AuditLogger();
  auditSpy.log = (r) => { rows.push(r); return Promise.resolve(); };

  const reasonText = "Two weeks alongside the Madrid team for the Q4 launch.";
  await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE", nationality: "DE", destination: { country: "ES" },
        startDate: "2026-09-01", endDate: "2026-09-14",
        visaType: "schengen_short_stay", jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      reasonText,
      externalRef: "reasontext-1",
      now: "2026-08-15",
    },
    {
      remote,
      audit: auditSpy,
      authorizationStore: store,
      // The REAL functions forced down their deterministic branches — the
      // path that discarded the text entirely.
      draftSummary: (args) => draftSummary(args, { isConfigured: () => false }),
      judge: (args) => judgeNarrative(args, { isConfigured: () => false }),
    }
  );

  const row = rows.find((r) => r.useCase === "UC-04");
  assert.ok(row, "no UC-04 audit row was written");
  assert.equal(
    row.details.reasonText,
    reasonText,
    "the requester's own words are nowhere durable — the specialist judging this request cannot read why it was made"
  );
  // And the deterministic summary genuinely does not carry it, which is why
  // the audit row has to. Pinned so nobody "fixes" this by assuming the
  // template covers it.
  const stored = store.authorizations[0];
  assert.ok(
    !String(stored.summary).includes("Madrid"),
    "draftSummaryTemplate() does not restate the reason — if it starts to, this test's premise changed"
  );
});

// ===========================================================================
// THE DAY ARITHMETIC — three defects in one function, each pinned in BOTH
// directions
// ===========================================================================
// Every one of these was invisible to the suite that existed before them, and
// two were invisible in the way this repo keeps paying for: a gate that
// structurally cannot fire is indistinguishable from a gate that is
// appropriately quiet, and no amount of negative testing tells them apart. So
// every block below asserts a COMPLIANT input clearing as well as a
// non-compliant one being caught, and asserts the reported figure equals the
// computed one rather than merely that a verdict came back.
// ---------------------------------------------------------------------------

const DAY_BASE = {
  homeCountry: "DE",
  destinationCountry: "ES",
  nationality: "DE",
  visaType: VISA_TYPES.schengen_short_stay,
  jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
  now: "2026-01-01",
};

// ---------------------------------------------------------------------------
// DEFECT 1 — an unreadable date used to silently clear an overstay
// ---------------------------------------------------------------------------

test("D1 NEGATIVE: an unreadable prior stay BLOCKS, and the count is refused rather than returned as a number", () => {
  // The exact reproduction. 123 real Schengen days plus one row with a blank
  // end date used to come back riskLevel "low", reasons [], flags
  // ["a1_certificate_recommended"] — a 153-day stay cleared — because
  // `Math.max(NaN, winStart)` is NaN, `NaN < NaN` is false so the `end < start`
  // guard never tripped, and NaN loses BOTH `> 90` and `> 183`.
  const risk = classifyRiskMatrix({
    ...DAY_BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" }, // 123 days
      { country: "ES", startDate: "2026-04-01", endDate: "" },           // the poisoning row
    ],
  });

  assert.equal(risk.riskLevel, "blocked");
  assert.equal(risk.reasons[0], "travel_history_unreadable");
  assert.ok(risk.flags.includes("travel_history_unreadable"));
  // NAMED, not merely refused: "one of your prior stays is unreadable" without
  // saying which is a refusal nobody can act on.
  assert.match(risk.travelHistoryProblems.join(" "), /prior stay 2/);
});

test("D1: the refusal is NOT mistakable for 'no data' — the disguise was the worst part of this bug", () => {
  // NaN serialises to `null` through JSON, so the durable row and the API read
  // "not computed" rather than "computed wrong": the manufactured-zero pattern
  // rotated into a manufactured ABSENCE, wearing the costume of an honest one.
  // Meanwhile `periodsCounted` still said 2 — the record asserted it had looked
  // at two stays and produced nothing. A `days: null` on its own would repeat
  // exactly that, so three things have to be true at once.
  const refused = computeCumulativeDays({
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" },
      { country: "ES", startDate: "2026-04-01", endDate: "" },
    ],
    country: "ES",
    windowStart: "2026-03-05",
    windowEnd: "2026-09-01",
  });

  assert.equal(refused.days, null);
  // 1. It says WHICH state it is in, so "refused" and "nothing to count" are
  //    distinguishable without reading the caller's mind.
  assert.equal(refused.status, "NOT_EVALUATED");
  // 2. It says WHY, naming the row.
  assert.match(refused.problems.join(" "), /prior stay 2/);
  // 3. It does not claim to have counted anything. The old shape's
  //    `periodsCounted: 2` beside a null count was the record contradicting
  //    itself in a way no reader would notice.
  assert.equal(refused.periodsCounted, 0);

  // And the honest empty case is a DIFFERENT answer, or the distinction is
  // worthless: no prior stays is a counted zero, not a refusal.
  const empty = computeCumulativeDays({
    travelHistory: [],
    country: "ES",
    windowStart: "2026-03-05",
    windowEnd: "2026-09-01",
  });
  assert.equal(empty.status, "COUNTED");
  assert.equal(empty.days, 0);
  assert.deepEqual(empty.problems, []);
});

test("D1 POSITIVE: the same history with the date filled in is counted, and the overstay is caught with the right figure", () => {
  // The other direction of the same input, which is the only thing that proves
  // the block above is a working gate rather than a refusal of everything.
  const risk = classifyRiskMatrix({
    ...DAY_BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" }, // 123 days
      { country: "ES", startDate: "2026-04-01", endDate: "2026-04-30" }, // the row, now readable
    ],
  });

  assert.equal(risk.riskLevel, "blocked");
  assert.equal(risk.reasons[0], "schengen_90_180_exceeded");
  assert.deepEqual(risk.travelHistoryProblems, []);
  // THE REPORTED FIGURE IS THE COMPUTED ONE. Not "it is over" — the number.
  assert.equal(risk.schengen.status, "COUNTED");
  assert.equal(risk.schengen.limit, SCHENGEN_LIMIT_DAYS);
  assert.ok(risk.schengen.breached);
  assert.equal(
    risk.schengen.peakDays,
    schengenPeakDays({
      travelHistory: [
        { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" },
        { country: "ES", startDate: "2026-04-01", endDate: "2026-04-30" },
      ],
      country: "ES",
      tripStart: "2026-09-01",
      tripEnd: "2026-09-30",
    }).peakDays
  );
});

test("D1: every unreadable shape is named, and a readable history produces no problems at all", () => {
  assert.deepEqual(travelHistoryProblems([{ country: "ES", startDate: "2026-05-01", endDate: "2026-05-31" }]), []);
  assert.deepEqual(travelHistoryProblems([]), []);
  assert.deepEqual(travelHistoryProblems(undefined), []);

  const problems = travelHistoryProblems([
    { country: "ES", startDate: "2026-05-01", endDate: "" },          // blank end
    { country: "ES", startDate: "next Tuesday", endDate: "2026-06-01" }, // unparseable start
    { country: "", startDate: "2026-05-01", endDate: "2026-05-31" },  // no country
    { country: "ES", startDate: "2026-07-30", endDate: "2026-07-01" }, // backwards
  ]);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /prior stay 1/);
  assert.match(problems[1], /prior stay 2/);
  assert.match(problems[2], /prior stay 3: unreadable country/);
  // A backwards stay used to be `continue`d silently, which is the same
  // concealment as the NaN, only quieter: the count came back smaller and
  // looked exactly like a count.
  assert.match(problems[3], /prior stay 4: the stay ends \(2026-07-01\) before it starts/);
});

test("D1 STRUCTURAL: no unreadable history can reach either threshold, so neither comparison ever reads a null", () => {
  // The two thresholds read `schengen.breached` and `cumulativeDays.days +
  // tripDays > 183` with no null guard, on the stated grounds that the block
  // above makes a null unreachable. That is the claim, so it is asserted rather
  // than trusted — if anyone moves a threshold above the blocked return, this
  // fails instead of `null > 183` quietly clearing a year abroad.
  const unreadable = [
    [{ country: "ES", startDate: "2026-05-01", endDate: "" }],
    [{ country: "ES", startDate: "", endDate: "2026-05-01" }],
    [{ country: "", startDate: "2026-05-01", endDate: "2026-05-31" }],
    [{ country: "ES", startDate: "2026-07-30", endDate: "2026-07-01" }],
    [{ country: "ES", startDate: "not-a-date", endDate: "also-not" }],
  ];
  for (const travelHistory of unreadable) {
    for (const destinationCountry of ["ES", "MX", "PT"]) {
      const risk = classifyRiskMatrix({ ...DAY_BASE, destinationCountry, startDate: "2026-09-01", endDate: "2026-09-14", travelHistory });
      assert.equal(risk.riskLevel, "blocked", `${destinationCountry} + ${JSON.stringify(travelHistory)} did not block`);
      assert.equal(risk.cumulativeDays, null, "a blocked decision must report no count, not a null-shaped one");
      assert.equal(risk.schengen, null);
    }
  }
});

// ---------------------------------------------------------------------------
// DEFECT 2 — overlapping stays double-counted
// ---------------------------------------------------------------------------

test("D2: overlapping stays return the DISTINCT day count — 41, not 63", () => {
  // { ES, May 1–31 } is 31 days and { ES, May 10 – Jun 10 } is 32; the union is
  // May 1 – Jun 10, which is 41 calendar days. Summing them gave 63.
  // src/uc08/computePresenceDays() has deduped since it was written and says so
  // in its rule 1; this file's own comment claimed to be the "same shape" as it
  // and was not.
  const overlapping = [
    { country: "ES", startDate: "2026-05-01", endDate: "2026-05-31" },
    { country: "ES", startDate: "2026-05-10", endDate: "2026-06-10" },
  ];
  const r = computeCumulativeDays({ travelHistory: overlapping, country: "ES", windowStart: "2026-01-01", windowEnd: "2026-12-31" });
  assert.equal(r.days, 41);
  assert.equal(r.status, "COUNTED");
  // Both periods really did contribute — this is a union, not a "drop the
  // second one" that happens to produce a smaller number.
  assert.equal(r.periodsCounted, 2);
});

test("D2: non-overlapping stays still SUM — the fix deduplicates, it does not discount", () => {
  // The positive other side. A dedupe that quietly lost a period would pass the
  // test above and be a worse bug than the one it replaced, because it errs
  // toward clearing.
  const separate = [
    { country: "ES", startDate: "2026-01-01", endDate: "2026-01-10" }, // 10
    { country: "ES", startDate: "2026-06-25", endDate: "2026-07-05" }, // 11
  ];
  const r = computeCumulativeDays({ travelHistory: separate, country: "ES", windowStart: "2026-01-01", windowEnd: "2026-12-31" });
  assert.equal(r.days, 21);
  assert.equal(r.periodsCounted, 2);

  // Abutting is not overlapping: Jan 1–10 then Jan 11–20 is 20 distinct days.
  const abutting = computeCumulativeDays({
    travelHistory: [
      { country: "ES", startDate: "2026-01-01", endDate: "2026-01-10" },
      { country: "ES", startDate: "2026-01-11", endDate: "2026-01-20" },
    ],
    country: "ES",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(abutting.days, 20);

  // And an identical stay recorded twice — the shape two upstream sources
  // actually produce — is one stay's worth of days.
  const duplicated = computeCumulativeDays({
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-05-31" },
      { country: "ES", startDate: "2026-05-01", endDate: "2026-05-31" },
    ],
    country: "ES",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(duplicated.days, 31);
});

test("D2 IN THE GATE, both directions: the 183 watch fires on distinct days and not on double-counted ones", () => {
  // 100 real days recorded as two overlapping rows summing to 150. With a
  // 40-day trip: 100 + 40 = 140, under the watch line; the old sum would have
  // been 150 + 40 = 190 and would have raised a residency watch that is not
  // there. Errs toward refusal, which is the safer direction and still a wrong
  // number printed as precise.
  const overlapping = [
    { country: "MX", startDate: "2026-01-01", endDate: "2026-03-11" }, // 70 days
    { country: "MX", startDate: "2026-02-10", endDate: "2026-04-30" }, // 80 days, 50 of them shared
  ];
  const distinct = computeCumulativeDays({ travelHistory: overlapping, country: "MX", windowStart: "2025-09-01", windowEnd: "2026-09-01" });
  assert.equal(distinct.days, 120, "the fixture must be the union it claims to be, or this test proves nothing");

  const cleared = classifyRiskMatrix({
    ...DAY_BASE,
    destinationCountry: "MX",
    startDate: "2026-09-01",
    endDate: "2026-09-30", // 30 days -> 150 of 183
    travelHistory: overlapping,
  });
  assert.ok(!cleared.flags.includes("tax_residency_watch"), "150 distinct days is under the 183 line");
  assert.equal(cleared.cumulativeDays.days, 120);

  // The other direction: really being over still fires, and the figure the flag
  // rests on is the figure the record carries.
  const watched = classifyRiskMatrix({
    ...DAY_BASE,
    destinationCountry: "MX",
    startDate: "2026-09-01",
    endDate: "2026-11-29", // 90 days -> 210 of 183
    travelHistory: overlapping,
  });
  assert.ok(watched.flags.includes("tax_residency_watch"));
  assert.equal(watched.cumulativeDays.days + watched.tripDays, 210);
});

// ---------------------------------------------------------------------------
// DEFECT 3 — the window was per-trip; art. 6(1) is per-day-of-stay (C-1)
// ---------------------------------------------------------------------------

test("D3 THE WORKED EXAMPLE, both directions: 120 of 90 per trip, 61 of 90 per day of stay", () => {
  // docs/knowledge/layer-1-statutory/D-07 quotes Reg. (EU) 2016/399 art. 6(1)
  // verbatim: "no more than 90 days in any 180-day period, which entails
  // considering the 180-day period preceding each day of stay".
  //
  // Prior ES stay 2026-03-06 → 2026-05-04 is 60 days, ending exactly 120 days
  // before the trip starts. The trip is 2026-09-01 → 2026-10-30, 60 days.
  const priorStay = [{ country: "ES", startDate: "2026-03-06", endDate: "2026-05-04" }];
  const trip = { startDate: "2026-09-01", endDate: "2026-10-30" };

  // DIRECTION 1 — what the OLD computation said. Reconstructed here from the
  // same exported counter, so the comparison is a measurement and not a
  // remembered number: one trailing 180-day window anchored at the trip start,
  // plus the trip's whole length.
  const perTripPrior = computeCumulativeDays({
    travelHistory: priorStay,
    country: "ES",
    windowStart: "2026-03-05", // startDate - 180 days, as the old code computed it
    windowEnd: trip.startDate,
  });
  assert.equal(perTripPrior.days, 60);
  assert.equal(perTripPrior.days + tripDurationDays(trip.startDate, trip.endDate), 120);
  assert.ok(120 > SCHENGEN_LIMIT_DAYS, "the old arithmetic refused this trip by 30 days");

  // DIRECTION 2 — what art. 6(1) says. Every day of the stay measured against
  // its own trailing 180 days; the worst is 61.
  const peak = schengenPeakDays({ travelHistory: priorStay, country: "ES", tripStart: trip.startDate, tripEnd: trip.endDate });
  assert.equal(peak.status, "COUNTED");
  assert.equal(peak.peakDays, 61);
  assert.equal(peak.peakDate, "2026-09-01");
  assert.equal(peak.window.spanDays, SCHENGEN_WINDOW_DAYS);
  assert.equal(peak.window.to, "2026-09-01");
  assert.equal(peak.window.from, "2026-03-06");
  assert.equal(peak.breached, false);

  // And the gate agrees with the regulation, not with the old arithmetic: a
  // compliant multi-week workation that was refused by 59 days now clears.
  const risk = classifyRiskMatrix({ ...DAY_BASE, ...trip, travelHistory: priorStay });
  assert.notEqual(risk.riskLevel, "blocked");
  assert.ok(!risk.flags.includes("schengen_overstay"));
  assert.equal(risk.schengen.peakDays, 61);
  assert.equal(risk.schengen.limit, 90);
});

test("D3 NEGATIVE: a genuine overstay is still blocked, and the reported peak is the computed one", () => {
  // Move the same 60-day prior stay to end 30 days before the trip instead of
  // 120, so it sits inside the windows of the trip's own days. Peak 120 of 90.
  const priorStay = [{ country: "ES", startDate: "2026-06-04", endDate: "2026-08-02" }];
  const risk = classifyRiskMatrix({
    ...DAY_BASE,
    startDate: "2026-09-01",
    endDate: "2026-10-30",
    travelHistory: priorStay,
  });
  assert.equal(risk.riskLevel, "blocked");
  assert.equal(risk.reasons[0], "schengen_90_180_exceeded");
  assert.ok(risk.flags.includes("schengen_overstay"));
  assert.equal(risk.schengen.peakDays, 120);
  assert.equal(risk.schengen.peakDays - risk.schengen.limit, 30);
  // The verdict and the figure are the same fact, not two facts that could
  // disagree: `breached` is derived from the peak, not from a separate branch.
  assert.equal(risk.schengen.breached, risk.schengen.peakDays > SCHENGEN_LIMIT_DAYS);
});

test("D3: the window is 180 days ending ON the day of stay, and both endpoint days count (art. 6(2))", () => {
  // A 90-day trip with no history is exactly at the limit and clears; 91 does
  // not. That pins the inclusive-both-ends convention art. 6(2) states ("the
  // date of entry shall be considered as the first day of stay … the date of
  // exit … as the last day") and pins that the comparison is `> 90`, not `>= 90`.
  const atLimit = schengenPeakDays({ travelHistory: [], country: "ES", tripStart: "2026-09-01", tripEnd: "2026-11-29" });
  assert.equal(atLimit.peakDays, 90);
  assert.equal(atLimit.breached, false);

  const overByOne = schengenPeakDays({ travelHistory: [], country: "ES", tripStart: "2026-09-01", tripEnd: "2026-11-30" });
  assert.equal(overByOne.peakDays, 91);
  assert.equal(overByOne.breached, true);

  // A one-day trip is one day, not zero.
  assert.equal(schengenPeakDays({ travelHistory: [], country: "ES", tripStart: "2026-09-01", tripEnd: "2026-09-01" }).peakDays, 1);

  // The window really is 180 days wide and really does end on the peak day.
  const w = atLimit.window;
  assert.equal(Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1, SCHENGEN_WINDOW_DAYS);
});

test("D3: a stay that has aged fully out of every window contributes nothing, and one that has not still counts", () => {
  // The mechanism the per-day window exists for, isolated. Same 60-day prior
  // stay, two placements, one either side of the horizon.
  const trip = { tripStart: "2026-09-01", tripEnd: "2026-09-30" };

  // Ends 200 days before the trip starts — outside the window of every day of
  // this trip, so the peak is the trip itself.
  const agedOut = schengenPeakDays({
    travelHistory: [{ country: "ES", startDate: "2025-12-16", endDate: "2026-02-13" }],
    country: "ES",
    ...trip,
  });
  assert.equal(agedOut.peakDays, 30);

  // Ends 30 days before the trip starts — fully inside.
  const stillCounting = schengenPeakDays({
    travelHistory: [{ country: "ES", startDate: "2026-06-04", endDate: "2026-08-02" }],
    country: "ES",
    ...trip,
  });
  assert.equal(stillCounting.peakDays, 90);
});

test("D3: the peak dedupes a prior stay that overlaps the trip itself, rather than counting the days twice", () => {
  // A requester who restates the trip as a prior stay must not be charged for
  // it twice. This is defect 2's rule applied to the union the peak is taken
  // over, and it is the case a naive "history days + trip days" would get wrong.
  const peak = schengenPeakDays({
    travelHistory: [{ country: "ES", startDate: "2026-09-01", endDate: "2026-09-30" }],
    country: "ES",
    tripStart: "2026-09-01",
    tripEnd: "2026-09-30",
  });
  assert.equal(peak.peakDays, 30);
});

test("D3: other countries' stays never count toward a Schengen destination's own allowance", () => {
  // C-3 in docs/knowledge/layer-1-statutory/CONTRADICTIONS.md: art. 6(1a) makes
  // the 90 days a single pool across the states operating the EES and separate
  // for those that do not, and this count is taken per destination country —
  // which is the NON-EES behaviour. Unchanged by this pass and deliberately so;
  // pinned here because it is a real, dated divergence and a future reader
  // should find it asserted rather than infer it from an absence.
  const peak = schengenPeakDays({
    travelHistory: [{ country: "FR", startDate: "2026-06-04", endDate: "2026-08-02" }],
    country: "ES",
    tripStart: "2026-09-01",
    tripEnd: "2026-09-30",
  });
  assert.equal(peak.peakDays, 30, "60 French days counted toward a Spanish allowance, or none did");
});

test("D3: the DNV suppression is untouched — a Schengen destination in that list still skips the check entirely", () => {
  // Deliberately out of scope for this pass: DNV_COUNTRIES is a separately
  // tracked gap and changing it here would confound the window fix. Pinned so
  // that "the Schengen check was rewritten" cannot be read as "the suppression
  // was reviewed".
  const risk = classifyRiskMatrix({
    ...DAY_BASE,
    destinationCountry: "PT",
    visaType: VISA_TYPES.digital_nomad_visa,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    travelHistory: [{ country: "PT", startDate: "2026-03-10", endDate: "2026-08-31" }], // 175 days
  });
  assert.equal(risk.schengen, null, "a suppressed check must report no measurement, not a measurement nobody used");
  assert.ok(!risk.flags.includes("schengen_overstay"));
});

test("D3 DEMO GUARD: every Schengen figure scripts/demo-countries-matrix.mjs demonstrates is unchanged by the window fix", () => {
  // docs/DEMO-COUNTRIES.md records an outcome for each of these rows, and the
  // demo script's own comment says every date in it was chosen to be
  // insensitive to C-1. That was a hand verification made while C-1 was open;
  // this is the standing version of it. If a future change to the window moves
  // any of these, the demo write-up is wrong and this test says so before
  // anyone films it.
  //
  // The figures are the PEAK across the trip now, not a start-anchored total —
  // and they come to the same numbers, which is exactly what "insensitive" was
  // supposed to mean.
  const BASE = {
    startDate: "2026-09-07",
    endDate: "2026-09-27", // 21 days
    visaType: VISA_TYPES.schengen_short_stay,
    jobDuties: JOB_DUTY_CATEGORIES.engineering,
    hasContractSigningAuthority: false,
    now: "2026-08-19",
  };
  const nl = (travelHistory) =>
    classifyRiskMatrix({ ...BASE, homeCountry: "CA", nationality: "CA", destinationCountry: "NL", travelHistory });

  // UC04-CANL-1 — no history at all.
  assert.equal(nl([]).schengen.peakDays, 21);
  assert.equal(nl([]).schengen.breached, false);

  // UC04-CANL-2 / UC04-USNL-2 — 85 prior NL days. "blocked / schengen_90_180_exceeded".
  const canl2 = nl([{ country: "NL", startDate: "2026-06-01", endDate: "2026-08-24" }]);
  assert.equal(canl2.schengen.peakDays, 106);
  assert.equal(canl2.riskLevel, "blocked");
  assert.equal(canl2.reasons[0], "schengen_90_180_exceeded");

  // UC04-CANL-3 — "the 90/180 check MEASURES and clears (51 of 90)".
  const canl3 = nl([{ country: "NL", startDate: "2026-07-20", endDate: "2026-08-18" }]);
  assert.equal(canl3.schengen.peakDays, 51);
  assert.equal(canl3.schengen.breached, false);

  // UC04-CANL-4 — "66 of 90 Schengen days (inside) and 217 of 183 residency
  // days (past) — one history, two windows". The whole point of the row is that
  // the two answers disagree, so both are pinned.
  const canl4 = nl([
    { country: "NL", startDate: "2026-07-05", endDate: "2026-08-18" },
    { country: "NL", startDate: "2025-10-01", endDate: "2026-02-28" },
  ]);
  assert.equal(canl4.schengen.peakDays, 66);
  assert.equal(canl4.schengen.breached, false);
  assert.equal(canl4.cumulativeDays.days + canl4.tripDays, 217);
  assert.ok(canl4.flags.includes("tax_residency_watch"));

  // UC04-CACA-1 / -2 — non-Schengen, so no Schengen row at all, and the
  // residency watch measured on both sides of its own line (121 and 221).
  const ca = (travelHistory) =>
    classifyRiskMatrix({
      ...BASE,
      homeCountry: "GB",
      nationality: "GB",
      destinationCountry: "CA",
      visaType: VISA_TYPES.work_permit,
      travelHistory,
    });
  const caca1 = ca([{ country: "CA", startDate: "2026-01-05", endDate: "2026-04-14" }]);
  assert.equal(caca1.schengen, null);
  assert.equal(caca1.cumulativeDays.days + caca1.tripDays, 121);
  assert.ok(!caca1.flags.includes("tax_residency_watch"));
  const caca2 = ca([{ country: "CA", startDate: "2025-11-01", endDate: "2026-05-19" }]);
  assert.equal(caca2.cumulativeDays.days + caca2.tripDays, 221);
  assert.ok(caca2.flags.includes("tax_residency_watch"));

  // UC04-USPT-2 — "85 prior PT days would be 106 of 90, and the Schengen check
  // is skipped anyway". The suppression is what the row demonstrates, so the
  // absence of a measurement is the assertion.
  const uspt2 = classifyRiskMatrix({
    ...BASE,
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "PT",
    visaType: VISA_TYPES.digital_nomad_visa,
    travelHistory: [{ country: "PT", startDate: "2026-05-26", endDate: "2026-08-18" }],
  });
  assert.equal(uspt2.schengen, null);
  assert.equal(uspt2.cumulativeDays.days + uspt2.tripDays, 106, "the 106 the row's label names must still be 106");
  assert.ok(!uspt2.flags.includes("schengen_overstay"));
});
