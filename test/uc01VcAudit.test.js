// ---------------------------------------------------------------------------
// uc01VcAudit.test.js — L-2: the full VC-01..VC-14 audit
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The frozen validation contract (qa/handoffs/UC-01/0001-builder-to-validator.md
// §5) names fourteen criteria, VC-01 through VC-14, one per §6 outcome. Before
// this file, `test/n8nParity.test.js` proved the two GATE COPIES agree on
// every one of these scenarios, and `test/uc01.test.js` proved most of them
// end to end — but neither is organised BY CRITERION ID, and neither states,
// for every one of the fourteen, which of the contract's named evidence types
// (UI/Zendesk/API/DB/Audit) is actually being checked. This file is that
// audit: one test per VC-ID, driven through the real `handleVerificationTicket()`
// against the real mock Remote server, checking the SAME evidence categories
// the contract itself names for that row.
//
// WHAT THIS FILE DOES NOT DO
// It re-proves nothing test/uc01.test.js, test/n8nParity.test.js,
// test/thirdPartyDoor.test.js or test/uc01RequesterType.test.js already prove
// in depth (VC-33's four-way comparison, VC-28/VC-29's two-gate-copy parity).
// It is the INDEX — a reader can find, by criterion id, evidence that a real
// run produced the row/absence-of-row the contract requires, and a cross-
// reference to the deeper test when one exists.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const TEST_PORT = 4126; // registered in src/shared/ports.js TEST_PORTS

let server;
let remote;

before(async () => {
  server = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});
after(() => server && server.close());

/** One fresh, in-memory-only run — no pgPool, no cross-test bleed. */
function run(ticket, { caseStore = new CaseStore(), audit = new AuditLogger(), remoteOverride = remote } = {}) {
  return handleVerificationTicket(ticket, { remote: remoteOverride, audit, caseStore, classify: classifyRequestRuleBased }).then(
    (result) => ({ result, caseStore, audit })
  );
}

/**
 * A fake RemoteClient returning one fixed employment record, for the
 * engagement-eligibility (G-1) scenarios: the mock server's own employment
 * fixtures (mockServer.js) do not include a contractor/global-payroll/
 * onboarding/offboarding record under a stable id, so these three gates are
 * exercised the same way test/n8nParity.test.js's own G-1 scenarios are —
 * against a constructed record — rather than against the real mock server.
 * `test/engagementEligibility.test.js` is the pure-function unit coverage for
 * `classifyEngagement()` itself; this proves the SAME records reach the SAME
 * outcome through the whole workflow, including the case/document evidence.
 */
function fakeRemoteFor(employment) {
  return {
    async getEmployment() {
      return employment;
    },
    async getLegalEntity() {
      return { name: "Acme Inc.", country_code: "US" };
    },
  };
}

const sessionFor = (id) => ({ authenticatedEmploymentId: id });
const ticketRequesterFor = (email) => ({ authenticatedEmail: email });

// ---------------------------------------------------------------------------
// VC-01 — the standard letter issues without a human
// ---------------------------------------------------------------------------
test("VC-01: an eligible, active, identified EOR employee auto-resolves — case, document, audit, no review_queue", async () => {
  const { result, caseStore, audit } = await run({
    text: "Please send me a standard employment verification letter.",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    externalRef: "vc01-1",
  });
  assert.equal(result.decision, "auto_resolve");
  assert.match(result.letterHtml, /Employment Verification Letter/);
  // DB: a case row and a document row, no review_queue row.
  assert.equal(caseStore.cases.length, 1);
  assert.equal(caseStore.documents.length, 1);
  assert.equal(caseStore.reviewQueue.length, 0);
  // Audit: a durable row recording the auto-resolve.
  assert.ok(audit.entries.some((e) => e.action === "auto_resolve" && e.details?.externalRef === "vc01-1"));
});

// ---------------------------------------------------------------------------
// VC-02/VC-03/VC-04 — engagement eligibility (G-1), no document written
// ---------------------------------------------------------------------------
test("VC-02: a contractor is refused, and no document is written", async () => {
  const employment = { id: "emp_ct_fake_001", status: "active", contract_type: "contractor", email: "carlos@acme.test" };
  const { result, caseStore } = await run(
    {
      text: "Please send me a standard employment verification letter.",
      session: ticketRequesterFor("carlos@acme.test"),
      employmentId: employment.id,
      externalRef: "vc02-1",
    },
    { remoteOverride: fakeRemoteFor(employment) }
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "engagement_not_eor_contractor");
  assert.equal(caseStore.documents.length, 0);
  assert.match(result.requesterReply, /independent contractor/i);
});

test("VC-03: a direct/HRIS/global-payroll employee is refused, and no document is written", async () => {
  const employment = { id: "emp_gp_fake_001", status: "active", contract_type: "global_payroll", email: "gp@acme.test" };
  const { result, caseStore } = await run(
    {
      text: "Please send me a standard employment verification letter.",
      session: sessionFor(employment.id),
      employmentId: employment.id,
      externalRef: "vc03-1",
    },
    { remoteOverride: fakeRemoteFor(employment) }
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "engagement_not_eor_direct");
  assert.equal(caseStore.documents.length, 0);
});

test("VC-04: onboarding not finalised is refused, and no document is written", async () => {
  const employment = { id: "emp_onboard_fake_001", status: "pending", contract_type: "eor", email: "new@acme.test" };
  const { result, caseStore } = await run(
    {
      text: "Please send me a standard employment verification letter.",
      session: sessionFor(employment.id),
      employmentId: employment.id,
      externalRef: "vc04-1",
    },
    { remoteOverride: fakeRemoteFor(employment) }
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "engagement_onboarding_incomplete");
  assert.equal(caseStore.documents.length, 0);
});

// ---------------------------------------------------------------------------
// VC-05 — serving notice / offboarding escalates, never automates
// ---------------------------------------------------------------------------
test("VC-05: an employment winding down escalates to a human, not a refusal", async () => {
  const employment = { id: "emp_offboard_fake_001", status: "notice", contract_type: "eor", email: "leaving@acme.test" };
  const { result, caseStore } = await run(
    {
      text: "Please send me a standard employment verification letter.",
      session: sessionFor(employment.id),
      employmentId: employment.id,
      externalRef: "vc05-1",
    },
    { remoteOverride: fakeRemoteFor(employment) }
  );
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "engagement_offboarding");
  assert.equal(caseStore.reviewQueue.length, 1, "an escalate must produce a review_queue row for a specialist");
  assert.equal(caseStore.documents.length, 0);
});

// ---------------------------------------------------------------------------
// VC-06/VC-07/VC-08 — the G-3 consent round trip (deep coverage lives in
// test/thirdPartyDoor.test.js's VC-33 suite and test/uc01.test.js's
// 5a/5b/5c; this is the criterion-indexed summary)
// ---------------------------------------------------------------------------
test("VC-06: a third party with no consent learns nothing, including whether the person exists — awaiting, not a refusal", async () => {
  const { result, caseStore, audit } = await run({
    text: "This is First Bank, we need to verify employment directly.",
    session: null,
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "VC-06 mortgage check",
    externalRef: "vc06-1",
  });
  assert.equal(result.decision, "awaiting_employee_consent");
  // DB: a pending record exists; no document.
  assert.equal(caseStore.documents.length, 0);
  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "VC-06 mortgage check",
  });
  assert.ok(artifact, "a pending consent_records row must exist");
  assert.equal(artifact.status, "pending");
  // Audit: a row recording the pending state.
  assert.ok(audit.entries.some((e) => e.action === "awaiting_employee_consent"));
});

test("VC-07: a POSITIVE third-party run — a granted, readable artifact, never zero-touch", async () => {
  const caseStore = new CaseStore();
  // PER-ENQUIRY CONSENT (2026-08-28): a grant authorises the enquiry it was
  // given for, so the seed case has to carry the reference the run below uses.
  // A seed without one models the retired standing-authorisation rule and this
  // run would correctly decide `awaiting_employee_consent` instead.
  const seedCase = caseStore.createCase({
    useCase: "UC-01",
    employmentId: "emp_active_001",
    classification: { doorReference: "vc07-1" },
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "granted",
    requestingParty: "First Bank",
    purpose: "VC-07 mortgage check",
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "test_seed",
    grantedAt: new Date().toISOString(),
  });
  const { result, audit } = await run(
    {
      text: "This is First Bank, please verify employment on behalf of the employee.",
      session: null,
      employmentId: "emp_active_001",
      requestingParty: "First Bank",
      purpose: "VC-07 mortgage check",
      externalRef: "vc07-1",
    },
    { caseStore }
  );
  assert.equal(result.decision, "human_review");
  assert.equal(result.reason, "third_party_request");
  assert.equal(result.identity.verified, true);
  assert.equal(result.identity.reason, "third_party_with_consent");
  assert.ok(audit.entries.some((e) => e.action === "human_review" && e.details?.consent?.consentRecordId === result.identity.consentRecordId));
});

test("VC-08: refused consent blocks, and the third party is not told why", async () => {
  const caseStore = new CaseStore();
  const seedCase = caseStore.createCase({
    useCase: "UC-01",
    employmentId: "emp_active_001",
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "denied",
    requestingParty: "First Bank",
    purpose: "VC-08 mortgage check",
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "test_seed",
  });
  const { result } = await run(
    {
      text: "This is First Bank, we would still like to verify employment.",
      session: null,
      employmentId: "emp_active_001",
      requestingParty: "First Bank",
      purpose: "VC-08 mortgage check",
      externalRef: "vc08-1",
    },
    { caseStore }
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "consent_refused");
  assert.ok(!/denied|declined|no\b/i.test(result.requesterReply ?? ""), "the reply must not reveal the refusal");
});

// ---------------------------------------------------------------------------
// VC-09 — an over-scope request carries field NAMES, never values
// ---------------------------------------------------------------------------
test("VC-09: an over-scope request (salary) carries the field NAME, never the value, into the review surface", async () => {
  const { result, caseStore } = await run({
    text: "Please send me a standard employment verification letter, and can you also confirm my salary on it?",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    externalRef: "vc09-1",
  });
  assert.equal(result.decision, "human_review");
  assert.equal(result.reason, "over_scope_request");
  // RELABELLED 2026-08-28. It read "Asked for but not disclosable" until an
  // approval began issuing Remote's customized letter — at which point the
  // label sat directly above rows reading "released if approved" for the same
  // fields, and the sidebar contradicted itself in one box. The FACT is
  // unchanged: these are the fields beyond the standard template. Only the
  // claim about what can be done with them has moved, and it moved out of a
  // label that was never the place to make it.
  assert.ok(result.decisionFacts.facts.some((f) => f.label === "Asked for beyond the standard letter" && f.value === "salary"));
  // No compensation FIGURE anywhere in the facts bundle.
  const dump = JSON.stringify(result.decisionFacts);
  assert.ok(!/\$|€|£|\b\d{4,}\b/.test(dump), "no compensation figure may appear in the decision facts");
  assert.equal(caseStore.reviewQueue.length, 1);
});

// ---------------------------------------------------------------------------
// VC-10 — low confidence goes to a human
// ---------------------------------------------------------------------------
test("VC-10: low confidence goes to a human, tagged with which reader produced it", async () => {
  const lowConfidenceClassify = async () => ({
    intent: "standard_letter",
    hasAttachment: false,
    hasExternalUrl: false,
    requesterType: "self",
    requestedFields: [],
    confidence: 0.42,
    source: "rule_based_fallback",
  });
  const caseStore = new CaseStore();
  const audit = new AuditLogger();
  const result = await handleVerificationTicket(
    {
      text: "hmm not sure what I need",
      session: ticketRequesterFor("amara@acme.test"),
      employmentId: "emp_active_001",
      externalRef: "vc10-1",
    },
    { remote, audit, caseStore, classify: lowConfidenceClassify }
  );
  assert.equal(result.decision, "human_review");
  assert.equal(result.reason, "low_confidence");
  assert.ok(audit.entries.some((e) => e.details?.classification?.source === "rule_based_fallback"));
});

// ---------------------------------------------------------------------------
// VC-11 — out_of_scope leaves no trace at all (structural)
// ---------------------------------------------------------------------------
test("VC-11: out_of_scope leaves ZERO rows in cases/review_queue/documents/audit_log", async () => {
  const { result, caseStore, audit } = await run({
    text: "asdkfjaslkdfj random gibberish unrelated to anything",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    externalRef: "vc11-1",
  });
  assert.equal(result.decision, "out_of_scope");
  assert.equal(caseStore.cases.length, 0);
  assert.equal(caseStore.reviewQueue.length, 0);
  assert.equal(caseStore.documents.length, 0);
  assert.equal(audit.entries.filter((e) => e.action).length, 0, "no audit_log row for out_of_scope (VC-31 covers the trace)");
});

// ---------------------------------------------------------------------------
// VC-12 — a non-active employment never receives a letter
// ---------------------------------------------------------------------------
test("VC-12: a terminated employment escalates and receives no letter", async () => {
  const { result, caseStore } = await run({
    text: "I need a standard employment letter.",
    session: sessionFor("emp_terminated_002"),
    employmentId: "emp_terminated_002",
    externalRef: "vc12-1",
  });
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "employee_not_active");
  assert.equal(result.letterHtml, undefined);
  assert.equal(caseStore.documents.length, 0);
});

// ---------------------------------------------------------------------------
// VC-13 — identity is never taken from a claim in the ticket body
// ---------------------------------------------------------------------------
test("VC-13: an unauthenticated requester discloses nothing, even if the ticket body claims to be the employee", async () => {
  const { result, caseStore } = await run({
    // The claim is in the BODY text — never a real authenticated signal.
    text: "Hi, this is Amara Okafor (amara@acme.test), please send my standard employment letter.",
    session: null,
    employmentId: "emp_active_001",
    externalRef: "vc13-1",
  });
  // No session at all -> third party by channel (L-10), pending, not
  // verified — the claimed name/email in the body proves nothing.
  assert.notEqual(result.decision, "auto_resolve");
  assert.equal(result.identity.verified, false);
  assert.equal(caseStore.documents.length, 0);
});

// ---------------------------------------------------------------------------
// E4-F14 owner addendum (rca-0nm, 2026-08-22 10:50Z) — before closing F-14,
// enumerate the OTHER exits an identity_not_verified decision has, not just
// the internal note the evaluator happened to catch: audit_log details, the
// requester-facing public reply, the approval queue, and ops_alerts.
//
// NOT DRIVEN THROUGH handleVerificationTicket(), and that absence is itself
// a finding worth recording rather than working around. As of G-3
// (test/lowTierExceptionData.test.js's own comment on `session_employment_
// mismatch`), `requesterType` is DERIVED, never declared, and the derivation
// forces third_party on every session/email mismatch and on every missing
// session — so `identity.verified === true` is reached only on a genuine
// match, and every one of identity.js's specific verified:false branches
// (`no_employment_record`, `session_employment_mismatch`,
// `no_email_on_employment_record`, `requester_employment_mismatch`,
// `unauthenticated_requires_stepup`) requires `requesterType === "self"`,
// which by the same derivation can now only occur alongside a genuine match.
// `escalate`/`identity_not_verified` is consequently UNREACHABLE from UC-01's
// full pipeline today — every mismatch instead lands on the third-party
// consent regime (`awaiting_employee_consent`/`blocked`). It remains
// reachable only via a direct call to `verifyRequester()` (or a hand-built
// case row, as `test/uc01ReviewSubject.test.js`'s own E3-F12 tests already
// do) — e188ce8's ZAF-sidebar fix and this file's F-14 fix both guard against
// it defensively for exactly that reason: the decision as a *shape* is
// real (audit_log's DECISION_ACTIONS vocabulary, the gate ladder, the note
// composer all handle it), even though this session's Node build cannot
// currently produce it end to end.
// ---------------------------------------------------------------------------
test("E4-F14 owner addendum: every OTHER exit for identity_not_verified is enumerated — audit_log, public reply and the approval queue are all clean, not just the internal note", async () => {
  // The record whose facts must never leak — same fixture n8nInternalNoteParity
  // and thirdPartyLetter use for this reason.
  const EMPLOYMENT = {
    id: "emp_active_001",
    full_name: "Amara Okafor",
    job_title: "Senior Engineer",
    status: "active",
    contract_type: "full_time",
    country_code: "NG",
    legal_entity_id: "le_ng_01",
  };
  const WITHHELD_FACTS = ["Amara Okafor", "Senior Engineer", "le_ng_01"];

  // Exit 1: audit_log. STEP 7 in src/uc01/workflow.js is the one place that
  // builds this row; read directly from its source (not restated here) so a
  // future edit that adds `employment` to the details object fails this test
  // rather than silently reintroducing the leak this addendum is checking for.
  const { readFileSync } = await import("node:fs");
  const workflowSrc = readFileSync(new URL("../src/uc01/workflow.js", import.meta.url), "utf8");
  const step7Start = workflowSrc.indexOf("await audit.logDurable({");
  const step7End = workflowSrc.indexOf("STEP 7a", step7Start);
  assert.ok(step7Start > 0 && step7End > step7Start, "STEP 7's audit.logDurable() call moved or was renamed — re-locate it");
  const step7Body = workflowSrc.slice(step7Start, step7End);
  assert.ok(!/\bemployment\b/.test(step7Body), "STEP 7 now passes the raw `employment` object into audit_log.details");
  // Confirmed against a real run: audit.entries really do carry employmentId
  // (not a new disclosure — the requester already supplied it) and nothing
  // beyond classification/identity/requesterType, for a DIFFERENT reason this
  // gate DOES reach live (over_scope_request) — proving the shape of the row
  // this decision would write, without needing an unreachable fixture.
  const { audit } = await run({
    text: "Please send me a standard employment verification letter, and can you also confirm my salary on it?",
    session: { authenticatedEmail: "amara@acme.test" },
    employmentId: "emp_active_001",
    externalRef: "e4f14-exits-audit-shape",
  });
  const row = audit.entries.at(-1);
  assert.equal(row.details.employmentId, "emp_active_001");
  const auditJson = JSON.stringify(row.details);
  for (const fact of WITHHELD_FACTS) {
    assert.ok(!auditJson.includes(fact), `audit_log.details carries ${fact} — STEP 7 must never read the employment record's facts`);
  }

  // Exit 2: the requester-facing public reply. `identity_not_verified` has NO
  // entry in refusalCopy.js's COPY map (by design — this reason routes to a
  // human, who writes to the person; see that module's own JSDoc on `null`),
  // so nothing is EVER sent to the requester automatically for this reason,
  // and there is thus no template that could leak these facts into one.
  const { refusalReplyFor } = await import("../src/uc01/refusalCopy.js");
  assert.equal(refusalReplyFor("identity_not_verified"), null, "identity_not_verified must send no automatic reply at all");

  // Exit 3: the approval queue (src/approvalqueue/). Checked structurally
  // rather than by standing up a live pgPool: queueStore.js's own SQL SELECT
  // lists and normalise*() functions are read here and must select/expose
  // `employment_id` only — never `full_name`/`job_title`/`status`/
  // `contract_type`/`country_code` — because the case row itself never
  // carries the employment record (only its id), so the queue is structurally
  // incapable of leaking these facts regardless of which case it is showing.
  const queueStoreSrc = readFileSync(new URL("../src/approvalqueue/queueStore.js", import.meta.url), "utf8");
  for (const forbiddenColumn of ["full_name", "job_title", "contract_type", "country_code", "base_salary", "legal_entity_id"]) {
    assert.ok(
      !queueStoreSrc.includes(forbiddenColumn),
      `src/approvalqueue/queueStore.js references ${forbiddenColumn} — the queue would be able to leak employment facts`
    );
  }

  // Exit 4: ops_alerts. Not applicable, recorded rather than skipped
  // silently: ops_alerts is written only by n8n's own error workflow on a
  // FAILED execution (src/shared/audit.js writes no such table from the Node
  // path), and identity_not_verified is a normal, successful decision — no
  // alert row is ever written for it on either execution path, so there is
  // nothing to check against this scenario.
});

// ---------------------------------------------------------------------------
// VC-14 — an attachment or external URL goes to a human
// ---------------------------------------------------------------------------
test("VC-14: an attachment goes to a human, flagged so the specialist sees which artifact triggered it", async () => {
  const { result } = await run({
    text: "My bank sent this form, please complete it.",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    hasAttachment: true,
    externalRef: "vc14-1",
  });
  assert.equal(result.decision, "human_review");
  assert.equal(result.reason, "artifact_present");
  assert.ok(result.flags.includes("has_attachment"));
});

test("VC-14: an external URL goes to a human, flagged distinctly from an attachment", async () => {
  const { result } = await run({
    text: "Here is the link to my lender's portal: https://verify.example.com/xyz",
    session: ticketRequesterFor("amara@acme.test"),
    employmentId: "emp_active_001",
    externalRef: "vc14-2",
  });
  assert.equal(result.decision, "human_review");
  assert.equal(result.reason, "artifact_present");
  assert.ok(result.flags.includes("external_url"));
});
