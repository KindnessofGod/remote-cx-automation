// ---------------------------------------------------------------------------
// review.test.js  —  The ZAF sidebar's backend: policy gates, the approve/deny
// service, and the HTTP API. Hermetic — the only network is a local mock
// Remote/Zendesk on loopback. Run with:  npm test
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { generateKeyPairSync, createSign, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateCaseActionability, evaluateReviewAction, REFUSALS } from "../src/review/reviewPolicy.js";
import { InMemoryReviewStore } from "../src/review/store.js";
import { getReviewView, submitReviewDecision } from "../src/review/service.js";
import { createReviewHandler } from "../src/review/server.js";
import { createZafVerifier } from "../src/review/zafAuth.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { formatMoney } from "../src/shared/money.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { startMockServer as startRemoteMock } from "../src/remote/mockServer.js";
import { startMockServer as startZendeskMock, TICKETS } from "../src/zendesk/mockServer.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { computeMetrics } from "../src/metrics/compute.js";

const APPROVER = "specialist@remote.example";

// ---------------------------------------------------------------------------
// Pure policy — object literals only, no infrastructure. Same style as the
// policyEngine tests: the interesting judgement is testable without a database.
// ---------------------------------------------------------------------------

function caseRow(overrides = {}) {
  return {
    id: "case-1",
    useCase: "UC-01",
    externalRef: "2001",
    employmentId: "emp_active_001",
    requester: "unauthenticated",
    decision: "human_review",
    reason: "third_party_request",
    flags: ["third_party_request"],
    status: "pending_review",
    ...overrides,
  };
}

const pendingReview = { id: "rq-1", caseId: "case-1", status: "pending" };

test("policy: a pending human_review case may be approved and denied", () => {
  for (const action of ["approve", "deny"]) {
    const verdict = evaluateReviewAction({
      caseRow: caseRow(),
      reviewRow: pendingReview,
      action,
      approver: APPROVER,
      note: "Standard verification requested.",
    });
    assert.equal(verdict.allowed, true, `${action} should be permitted`);
    assert.equal(verdict.status, 200);
  }
});

test("policy: approve maps to review status 'approved', decline to 'rejected'", () => {
  // These exact strings are what src/metrics/compute.js counts for the accept
  // rate — a rename here silently zeroes that metric, so pin them. `rejected`
  // deliberately did NOT move with the `deny` -> `decline` rename for exactly
  // that reason; see REVIEW_ACTIONS' comment in src/review/reviewPolicy.js.
  const approved = evaluateReviewAction({
    caseRow: caseRow(),
    reviewRow: pendingReview,
    action: "approve",
    approver: APPROVER,
    note: "Approved after consent check.",
  });
  const declined = evaluateReviewAction({
    caseRow: caseRow(),
    reviewRow: pendingReview,
    action: "decline",
    approver: APPROVER,
    note: "Declined: no consent on file.",
  });
  assert.equal(approved.nextReviewStatus, "approved");
  assert.equal(approved.auditAction, "human_approved");
  assert.equal(declined.nextReviewStatus, "rejected");
  assert.equal(declined.auditAction, "human_declined");
  assert.equal(declined.nextCaseStatus, "declined");
});

// POSITIVE — the ZAF app installed in the live Zendesk account (installation
// 9990001) posts `deny` until the bundle is re-uploaded. It must keep working,
// and it must canonicalise: nothing downstream should learn the alias was used.
test("policy: the LEGACY `deny` verb still decides, recording the canonical words", () => {
  const declined = evaluateReviewAction({
    caseRow: caseRow(),
    reviewRow: pendingReview,
    action: "deny",
    approver: APPROVER,
    note: "Declined: no consent on file.",
  });
  assert.equal(declined.allowed, true, "an installed ZAF bundle posting deny must not 400");
  assert.equal(declined.code, "decline", "the verdict code is the canonical verb, never the alias");
  assert.equal(declined.auditAction, "human_declined");
  assert.equal(declined.nextCaseStatus, "declined");
  assert.equal(declined.nextReviewStatus, "rejected");
});

// The alias must not make the lookup permissive. `constructor` is the original
// prototype-walk defect (finding F-21) and `denyish` is the alias-map version
// of the same question: an unknown verb stays unknown.
test("policy: an unrecognised verb is still unknown_action, alias map notwithstanding", () => {
  for (const action of ["denyish", "constructor", "release"]) {
    const verdict = evaluateReviewAction({
      caseRow: caseRow(),
      reviewRow: pendingReview,
      action,
      approver: APPROVER,
      note: "n/a",
    });
    assert.equal(verdict.allowed, false, `${action} must not be permitted`);
    assert.equal(verdict.code, "unknown_action");
  }
});

test("policy: an ESCALATED case is never actionable from the sidebar", () => {
  // The safe path must not double as a dismiss button.
  const escalated = caseRow({ decision: "escalate", status: "escalated", flags: ["employment_status_terminated"] });
  for (const action of ["approve", "deny"]) {
    const verdict = evaluateReviewAction({ caseRow: escalated, reviewRow: pendingReview, action, approver: APPROVER });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.code, "no_review_path");
    assert.equal(verdict.status, 403);
  }
});

test("policy: a HIGH-TIER case has no execution path, whatever its decision says", () => {
  // UC-07/08/09 are specified to have no execution path at all. If one ever
  // reaches the review queue with an approvable decision that is an upstream
  // bug, and this gate is the backstop that stops it becoming a state change.
  const highTier = caseRow({ useCase: "UC-08", decision: "human_review" });
  const verdict = evaluateReviewAction({ caseRow: highTier, reviewRow: pendingReview, action: "approve", approver: APPROVER });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "high_tier_no_execution");
  assert.equal(verdict.tier, "high");
});

test("policy: an auto_resolved case was never awaiting a human", () => {
  const auto = caseRow({ decision: "auto_resolve", status: "resolved", flags: [] });
  const verdict = evaluateReviewAction({ caseRow: auto, reviewRow: null, action: "approve", approver: APPROVER });
  assert.equal(verdict.code, "not_awaiting_review");
});

test("policy: a case already decided cannot be decided twice", () => {
  const verdict = evaluateReviewAction({
    caseRow: caseRow(),
    reviewRow: { ...pendingReview, status: "approved" },
    action: "approve",
    approver: APPROVER,
  });
  assert.equal(verdict.code, "already_decided");
  assert.equal(verdict.status, 409);
});

test("policy: an approver identity is required, and is checked before the case is named", () => {
  for (const approver of [null, "", "   "]) {
    const verdict = evaluateReviewAction({ caseRow: caseRow(), reviewRow: pendingReview, action: "approve", approver });
    assert.equal(verdict.code, "approver_required");
    assert.equal(verdict.status, 401);
  }
});

test("policy: a reason is required for approve/deny and is recorded in the audit log", () => {
  const withoutNote = evaluateReviewAction({
    caseRow: caseRow(),
    reviewRow: pendingReview,
    action: "approve",
    approver: APPROVER,
  });
  assert.equal(withoutNote.allowed, false);
  assert.equal(withoutNote.code, "reason_required");
  assert.equal(withoutNote.status, 400);

  const withNote = evaluateReviewAction({
    caseRow: caseRow(),
    reviewRow: pendingReview,
    action: "approve",
    approver: APPROVER,
    note: "Consent verified.",
  });
  assert.equal(withNote.allowed, true);
});

test("policy: an unknown action is refused", () => {
  const verdict = evaluateReviewAction({ caseRow: caseRow(), reviewRow: pendingReview, action: "delete", approver: APPROVER });
  assert.equal(verdict.code, "unknown_action");
});

test("policy: the requester of a case may not approve it", () => {
  const self = caseRow({ requester: APPROVER });
  const verdict = evaluateReviewAction({ caseRow: self, reviewRow: pendingReview, action: "approve", approver: APPROVER });
  assert.equal(verdict.code, "self_approval");
});

test("policy: a human_review case with no review-queue row is a data-integrity refusal", () => {
  const verdict = evaluateReviewAction({ caseRow: caseRow(), reviewRow: null, action: "approve", approver: APPROVER });
  assert.equal(verdict.code, "review_entry_missing");
});

test("policy: actionability is decidable without an approver identity", () => {
  // This is what the sidebar asks to know whether to render buttons at all.
  assert.equal(evaluateCaseActionability({ caseRow: caseRow(), reviewRow: pendingReview }).allowed, true);
  assert.equal(evaluateCaseActionability({ caseRow: null, reviewRow: null }).code, "case_not_found");
});

test("policy: every refusal code carries a status and a reason", () => {
  for (const [code, refusal] of Object.entries(REFUSALS)) {
    assert.equal(typeof refusal.status, "number", `${code} needs a status`);
    assert.ok(refusal.reason && refusal.reason.length > 10, `${code} needs a usable reason`);
  }
});

// ---------------------------------------------------------------------------
// The service — real workflow rows, real audit logger, mock Remote/Zendesk.
// ---------------------------------------------------------------------------

let remoteServer, zendeskServer, remote, zendesk;

before(async () => {
  remoteServer = await startRemoteMock(4096);
  zendeskServer = await startZendeskMock(4022);
  remote = new RemoteClient({ baseUrl: "http://localhost:4096" });
  zendesk = new ZendeskClient({ baseUrl: "http://localhost:4022", email: "agent@example.com", apiToken: "test" });
});

after(() => {
  remoteServer && remoteServer.close();
  zendeskServer && zendeskServer.close();
});

let caseStore, audit, store;

/**
 * Run a ticket through the REAL workflow so the rows under test are genuine.
 *
 * G-3/L-8: a ticket carrying `requestingParty`/`purpose` (every
 * `THIRD_PARTY_TICKET` variant below) needs a real, readable GRANTED
 * consent_records artifact to reach `human_review`/`third_party_request` at
 * all — the old `consentOnRecord: true` boolean is retired. Ensuring the
 * artifact exists here, once per (party, purpose) pair, keeps every one of
 * this file's ~20 existing call sites working unchanged rather than requiring
 * each to seed it by hand.
 */
async function seedTicket(ticket) {
  let consentSeedCaseId = null;
  if (ticket.requestingParty && ticket.purpose) {
    // PER-ENQUIRY CONSENT (2026-08-28). A granted consent no longer authorises
    // any future request from the same party for the same purpose — it is
    // scoped to the enquiry, through the owning case's `doorReference`. So the
    // seed has to hang off a case carrying THIS ticket's reference; a seed case
    // without one models the old standing-authorisation behaviour and the
    // enquiry it is meant to unblock now decides `awaiting_employee_consent`.
    const enquiryReference = String(ticket.externalRef ?? "");
    const existing = await caseStore.findConsentArtifact({
      employmentId: ticket.employmentId,
      requestingParty: ticket.requestingParty,
      purpose: ticket.purpose,
      enquiryReference,
    });
    if (!existing) {
      const seedCase = caseStore.createCase({
        useCase: "UC-01",
        source: "third_party_door",
        externalRef: enquiryReference,
        employmentId: ticket.employmentId,
        classification: { doorReference: enquiryReference },
        decision: "awaiting_employee_consent",
        status: "awaiting_consent",
      });
      consentSeedCaseId = seedCase.id;
      caseStore.createConsentRecord({
        caseId: seedCase.id,
        consentType: "third_party_verification",
        status: "granted",
        source: "test_seed",
        requestingParty: ticket.requestingParty,
        purpose: ticket.purpose,
        grantedByEmploymentId: ticket.employmentId,
        grantedBySignal: "test_seed",
        grantedAt: new Date().toISOString(),
      });
    }
  }
  const result = await handleVerificationTicket(
    { source: "zendesk", ...ticket },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  // REMOVE THE SEED CASE, NOW THAT THE LOOKUP ABOVE HAS ALREADY RUN.
  //
  // Many assertions throughout this file read `caseStore.cases[0]` /
  // `caseStore.reviewQueue[0]` as "the case this test just seeded" — a
  // seed case created first (purely to be the consent artifact's FK target)
  // would silently become that `[0]`, and every one of those assertions would
  // then read the WRONG row without any of them changing. Removing it here,
  // once the real ticket's own case/review rows exist, keeps `[0]` meaning
  // what every existing test already assumes it means.
  if (consentSeedCaseId) {
    caseStore.cases = caseStore.cases.filter((c) => c.id !== consentSeedCaseId);
  }
  return result;
}

const THIRD_PARTY_TICKET = {
  externalRef: "1001",
  text: "This is First Bank, we need to verify this employee's employment.",
  session: null,
  employmentId: "emp_active_001",
  requestingParty: "First Bank",
  purpose: "Employment verification",
};

const ESCALATED_TICKET = {
  externalRef: "3003",
  text: "I need a standard employment letter.",
  session: { authenticatedEmploymentId: "emp_terminated_002" },
  employmentId: "emp_terminated_002",
};

beforeEach(() => {
  caseStore = new CaseStore();
  audit = new AuditLogger();
  store = new InMemoryReviewStore(caseStore);
  TICKETS["1001"] = {
    id: 1001,
    subject: "Employment verification",
    description: "Verify employment.",
    status: "open",
    tags: [],
    custom_fields: [{ id: 360000000001, value: "emp_active_001" }],
    comments: [],
  };
});

function deps() {
  return { store, caseStore, audit, remote, zendesk };
}

test("service: the sidebar view carries the decision, flags and actionability", async () => {
  const seeded = await seedTicket(THIRD_PARTY_TICKET);
  assert.equal(seeded.decision, "human_review"); // guard: the fixture must actually need a human

  const view = await getReviewView({ ticketId: "1001" }, { store });
  assert.equal(view.found, true);
  assert.equal(view.case.decision, "human_review");
  assert.deepEqual(view.case.flags, ["third_party_request"]);
  assert.equal(view.tier, "medium"); // low base + a flag → medium
  assert.equal(view.actionable, true);
  assert.equal(view.review.status, "pending");
});

test("service: a missing ticket is reported as not found, not as an empty case", async () => {
  const view = await getReviewView({ ticketId: "does-not-exist" }, { store });
  assert.equal(view.found, false);
});

test("service: APPROVE writes to audit_log — the thing that makes HITL real", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const before = audit.entries.length;

  const result = await submitReviewDecision(
    { ticketId: "1001", action: "approve", approver: APPROVER, note: "Consent verified by phone." },
    deps()
  );

  assert.equal(result.ok, true);
  assert.equal(result.letterIssued, true);

  const approvals = audit.entries.filter((e) => e.action === "human_approved");
  assert.equal(approvals.length, 1, "exactly one audit row for one approval");
  assert.equal(audit.entries.length, before + 1);

  const entry = approvals[0];
  assert.equal(entry.actor, APPROVER, "the audit row attributes the decision to a human");
  assert.equal(entry.useCase, "UC-01");
  assert.equal(entry.riskTier, "medium");
  assert.equal(entry.details.decidedVia, "zaf_sidebar");
  assert.equal(entry.details.note, "Consent verified by phone.");
  assert.equal(entry.details.letterIssued, true);
  // The AI's recommendation is stored beside the human's verdict, which is what
  // makes "did the specialist agree?" answerable from history alone.
  assert.equal(entry.details.aiDecision, "human_review");
  assert.deepEqual(entry.details.flags, ["third_party_request"]);
  assert.equal(entry.details.previousCaseStatus, "pending_review");
  assert.equal(entry.details.newCaseStatus, "resolved");
});

test("service: APPROVE moves the case and review rows, and issues the letter", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "ok" }, deps());

  assert.equal(caseStore.cases[0].status, "resolved");
  assert.equal(caseStore.reviewQueue[0].status, "approved");
  assert.equal(caseStore.reviewQueue[0].assignee, APPROVER);
  assert.equal(caseStore.reviewQueue[0].notes, "ok");

  const letters = caseStore.documents.filter((d) => d.type === "employment_verification_letter");
  assert.equal(letters.length, 1);
  // The whitelist that protects the auto path protects the approved path too:
  // a specialist cannot approve a wider disclosure than the automation may make.
  assert.ok(!/salary/i.test(letters[0].content), "an approved letter still discloses no salary");

  // E4-F17 (rca-0nm): THIRD_PARTY_TICKET was First Bank asking, with the
  // employee's consent — the letter must say so, not that the employee asked.
  assert.match(
    letters[0].content,
    /issued upon a request from <strong>First Bank<\/strong>, with the employee's consent/,
    "a third-party-requested letter must name who actually asked, not the employee"
  );
  assert.ok(
    !letters[0].content.includes("issued upon the employee's request"),
    "the employee's-own-request sentence must not appear on a letter First Bank asked for"
  );

  // rca-tlb2 (R7-20): a specialist-approved letter must carry the same
  // reference the requester was shown, exactly like the auto path.
  assert.match(letters[0].content, /<th>Reference<\/th><td>1001<\/td>/);
});

test("service: rca-5vdx / GROUND 1 — the human-approved letter's audit row is corroborated by a real documents row, independently hashed", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const result = await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "ok" }, deps());
  assert.equal(result.ok, true);

  const entry = audit.entries.find((e) => e.action === "human_approved");
  assert.ok(entry, "the approval was audited");
  assert.equal(entry.details.letterIssued, true);
  assert.ok(entry.details.letterDocumentId, "a document id is named on the row");
  assert.ok(entry.details.letterContentHash, "a content hash is named on the row");

  const documentRow = caseStore.documents.find((d) => d.id === entry.details.letterDocumentId);
  assert.ok(documentRow, "the named document id resolves to a real documents row");
  assert.equal(documentRow.caseId, entry.details.caseId);
  assert.equal(documentRow.type, "employment_verification_letter");

  // Hashed independently here, from the letter actually posted to the mock
  // Zendesk ticket — not compared against a value the code under test also
  // produced, per this bead's own "do not inject a hash and assert it comes
  // back" instruction.
  const posted = TICKETS["1001"].comments.at(-1).html_body;
  const independentHash = createHash("sha256").update(posted).digest("hex");
  assert.equal(entry.details.letterContentHash, independentHash);
  assert.equal(documentRow.contentHash, independentHash);
  assert.equal(documentRow.content, posted);
});

test("service: an ORDINARY (employee-originated) approval still says the employee asked", async () => {
  // Guards the default direction of E4-F17's fix: a case with no
  // requestingParty must render the ORIGINAL sentence unchanged. Reaches
  // human_review naturally (over_scope_request — the employee asked for their
  // own salary on the letter, same fixture shape as test/uc01.test.js's "7b"),
  // rather than forcing case fields by hand.
  TICKETS["3003"] = {
    id: 3003,
    subject: "Employment verification",
    description: "salary on the letter",
    status: "open",
    tags: [],
    custom_fields: [{ id: 360000000001, value: "emp_active_001" }],
    comments: [],
  };
  const seeded = await seedTicket({
    externalRef: "3003",
    text: "Please send me a standard employment verification letter, and can you also confirm my salary on it?",
    session: { authenticatedEmail: "amara@acme.test" },
    employmentId: "emp_active_001",
  });
  assert.equal(seeded.decision, "human_review"); // guard
  assert.equal(seeded.reason, "over_scope_request"); // guard: no requestingParty on this reason

  await submitReviewDecision({ ticketId: "3003", action: "approve", approver: APPROVER, note: "ok" }, deps());

  // EITHER TYPE. This fixture asks for salary, so since 2026-08-28 the approval
  // issues a CUSTOMIZED letter (`customized_employment_verification_letter`) —
  // a different `documents.type`, deliberately, so "which letters carried a
  // salary?" is answerable from the column alone. The provenance sentence this
  // test is actually about is identical on both documents, so the filter is
  // widened rather than the assertion weakened.
  const letter = caseStore.documents
    .filter((d) => d.type.endsWith("employment_verification_letter"))
    .at(-1);
  assert.match(letter.content, /issued upon the employee's request/);
  assert.ok(!letter.content.includes("with the employee's consent"), "no third party to name here");
});

test("service: approving a salary request issues a CUSTOMIZED letter that states it", async () => {
  // THE BEHAVIOUR THE OWNER ASKED FOR ON 2026-08-28, end to end through the
  // real service: an employee asks for their salary on the letter, a
  // specialist approves, and the document that goes out actually says it.
  //
  // Before this, "approve" meant "issue the STANDARD letter anyway" — the
  // requester got a salary-free document indistinguishable from a
  // self-service click, and nothing on the ticket said the extra field had
  // been dropped.
  TICKETS["3004"] = {
    id: 3004,
    subject: "Employment verification",
    description: "salary on the letter",
    status: "open",
    tags: [],
    custom_fields: [{ id: 360000000001, value: "emp_active_001" }],
    comments: [],
  };
  const seeded = await seedTicket({
    externalRef: "3004",
    text: "Please send me an employment verification letter and make sure it states my gross annual salary.",
    session: { authenticatedEmail: "amara@acme.test" },
    employmentId: "emp_active_001",
  });
  assert.equal(seeded.reason, "over_scope_request"); // guard

  await submitReviewDecision({ ticketId: "3004", action: "approve", approver: APPROVER, note: "ok" }, deps());

  const letter = caseStore.documents
    .filter((d) => d.type === "customized_employment_verification_letter")
    .at(-1);
  assert.ok(letter, "approving a salary request still produced only the standard letter");
  assert.match(letter.content, /Customized Employment Verification Letter/);
  assert.match(letter.content, /Annual gross salary/);

  // THE FIGURE IS THE RECORD'S OWN, not a number this test wrote down. Read
  // from the same fixture the gates ran on, so the assertion cannot pass
  // against a hard-coded value that has drifted from the record.
  const employment = await remote.getEmployment("emp_active_001");
  const expected = formatMoney(employment.base_salary, employment.currency);
  assert.ok(
    letter.content.includes(expected),
    `the letter states no figure matching the record's own salary (${expected})`
  );
  // ANNUAL, SAID OUT LOUD. A bare figure on a letter invites a monthly
  // reading, which is a 12x error on a document a mortgage underwriter reads.
  assert.match(letter.content, /per year/);

  // AND IT SAYS THE STANDARD LETTER'S CLOSING SENTENCE IS NO LONGER TRUE OF
  // IT. "Financial details ... are not disclosed in this letter" printed above
  // a salary row would be the document contradicting itself.
  assert.ok(
    !letter.content.includes("Financial details and other confidential employment terms are not"),
    "the customized letter still claims to disclose no financial details, above a salary row"
  );
  assert.match(letter.content, new RegExp(`authorised by ${APPROVER}`));
});

test("service: a THIRD PARTY asking for salary gets a letter without one — the sidebar never showed it", async () => {
  // THE DEFECT THIS PINS, reproduced before it was fixed and worth stating in
  // full because the whole design rests on the control it bypassed.
  //
  // `evaluate()` returns at the first gate that fires. `third_party_request` is
  // gate 4; `over_scope_request` is gate 9. So a bank that asks for employment
  // AND salary, with consent on record, stops at gate 4 — and the classifier
  // still records `requestedFields: ["compensation"]`.
  //
  // The first version of the customized-letter change gated the SIDEBAR on
  // `reason === "over_scope_request"` and gated the LETTER on nothing. The
  // specialist opened this ticket, saw consent facts and no salary row, pressed
  // Approve — and the letter went out to a bank stating the salary. The one
  // control the design rests on, a named human who saw the figure, never ran.
  //
  // Driven through the real service rather than asserted against the predicate,
  // because the predicate was never the thing that was wrong.
  TICKETS["1002"] = {
    id: 1002,
    subject: "Employment verification",
    description: "bank asking, wants salary",
    status: "open",
    tags: [],
    custom_fields: [{ id: 360000000001, value: "emp_active_001" }],
    comments: [],
  };
  const seeded = await seedTicket({
    externalRef: "1002",
    text: "This is First Bank. Please confirm this employee's employment and their annual gross salary for a mortgage application.",
    session: null,
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Employment verification",
  });
  assert.equal(seeded.reason, "third_party_request", "guard: this must stop at gate 4, not the over-scope gate");

  await submitReviewDecision({ ticketId: "1002", action: "approve", approver: APPROVER, note: "consent verified" }, deps());

  const letter = caseStore.documents
    .filter((d) => d.type.endsWith("employment_verification_letter"))
    .at(-1);
  assert.ok(letter, "no letter was issued at all");

  // THE ASSERTION, driven from the record's own salary so it cannot pass
  // against a fixture that has changed underneath it.
  const employment = await remote.getEmployment("emp_active_001");
  const figure = formatMoney(employment.base_salary, employment.currency);
  assert.ok(
    !letter.content.includes(figure),
    `a third party was sent a letter stating ${figure}, on a screen that never showed it`
  );
  assert.equal(
    letter.type,
    "employment_verification_letter",
    "a third-party approval minted a CUSTOMIZED letter, which no specialist authorised field by field"
  );
  assert.doesNotMatch(letter.content, /Customized Employment Verification Letter/);
});

test("service: APPROVE posts the letter to Zendesk and solves the ticket", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "Consent verified by phone." }, deps());

  assert.equal(TICKETS["1001"].status, "solved");
  const posted = TICKETS["1001"].comments.at(-1);
  assert.equal(posted.public, true);
  assert.match(posted.html_body, /verification/i);
});

// rca-iih7 / D-30: a decided ticket used to stay tagged `uc01_human_review`
// forever, so a queue built from that tag kept showing cases already decided.
test("service: APPROVE removes the uc01_human_review tag and leaves the owning-team tag alone", async () => {
  TICKETS["1001"].tags = ["uc01_human_review", "queue_hr_ops", "escalated_by_ultimate"];
  await seedTicket(THIRD_PARTY_TICKET);
  await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "Consent verified by phone." }, deps());

  assert.ok(!TICKETS["1001"].tags.includes("uc01_human_review"), "the decided ticket must drop out of the review queue's own tag");
  assert.ok(TICKETS["1001"].tags.includes("queue_hr_ops"), "ownership must survive the decision");
  assert.ok(TICKETS["1001"].tags.includes("escalated_by_ultimate"), "a tag this workflow never applied must not be clobbered");
});

test("service: DECLINE removes the uc01_human_review tag too, and does not clobber existing tags", async () => {
  TICKETS["1001"].tags = ["uc01_human_review", "queue_hr_ops"];
  await seedTicket(THIRD_PARTY_TICKET);
  await submitReviewDecision({ ticketId: "1001", action: "decline", approver: APPROVER, note: "No consent on file." }, deps());

  assert.ok(!TICKETS["1001"].tags.includes("uc01_human_review"), "the decided ticket must drop out of the review queue's own tag");
  assert.ok(TICKETS["1001"].tags.includes("queue_hr_ops"), "the old full-replace write used to silently drop this");
  assert.ok(TICKETS["1001"].tags.includes("verification_declined"));
  assert.ok(TICKETS["1001"].tags.includes("verification_denied"));
});

test("service: DECLINE records the refusal and posts an internal note, without solving", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const result = await submitReviewDecision(
    { ticketId: "1001", action: "decline", approver: APPROVER, note: "No consent on file." },
    deps()
  );

  assert.equal(result.ok, true);
  assert.equal(result.letterIssued, false);

  const declines = audit.entries.filter((e) => e.action === "human_declined");
  assert.equal(declines.length, 1);
  assert.equal(declines[0].actor, APPROVER);
  assert.equal(declines[0].details.note, "No consent on file.");

  assert.equal(caseStore.cases[0].status, "declined");
  assert.equal(caseStore.reviewQueue[0].status, "rejected");

  assert.equal(TICKETS["1001"].status, "open", "a decline must not solve the ticket");
  const note = TICKETS["1001"].comments.at(-1);
  assert.equal(note.public, false, "the decline note is agent-only");
  assert.ok(TICKETS["1001"].tags.includes("verification_declined"));
  // The legacy tag is still applied for one release: a Zendesk view or trigger
  // in the live account may filter on it, and this repository cannot enumerate
  // the account's views from a coding session. See src/review/service.js.
  assert.ok(TICKETS["1001"].tags.includes("verification_denied"));
  assert.equal(caseStore.documents.length, 0, "no letter is issued on a decline");
});

// POSITIVE, over the service rather than the pure policy: the whole decline
// path must still run end to end when the legacy verb arrives, including the
// Zendesk write, and every record must carry the canonical word.
test("service: the LEGACY `deny` verb still declines, end to end", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const result = await submitReviewDecision(
    { ticketId: "1001", action: "deny", approver: APPROVER, note: "Legacy bundle." },
    deps()
  );

  assert.equal(result.ok, true, "an installed ZAF bundle posting deny must not 400");
  assert.equal(result.code, "human_declined");
  assert.equal(result.letterIssued, false);
  assert.equal(audit.entries.filter((e) => e.action === "human_declined").length, 1);
  assert.equal(audit.entries.filter((e) => e.action === "human_denied").length, 0);
  assert.equal(caseStore.cases[0].status, "declined");
  assert.equal(caseStore.reviewQueue[0].status, "rejected");
  assert.equal(TICKETS["1001"].status, "open");
  assert.ok(TICKETS["1001"].comments.at(-1).body.includes("declined"));
});

test("service: an escalated case cannot be approved, and the attempt is audited", async () => {
  const seeded = await seedTicket(ESCALATED_TICKET);
  assert.equal(seeded.decision, "escalate"); // guard: the fixture must really be an escalation

  const result = await submitReviewDecision({ ticketId: "3003", action: "approve", approver: APPROVER }, deps());

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "no_review_path");

  const refusals = audit.entries.filter((e) => e.action === "human_approve_refused");
  assert.equal(refusals.length, 1, "a refused attempt on a real case is still recorded");
  assert.equal(refusals[0].details.refusalCode, "no_review_path");
  assert.equal(refusals[0].actor, APPROVER);
  // rca-mhh3 (R7-38): the feed's EMPLOYMENT/FLAGS/SOURCE/REASON columns read
  // these exact keys off `details` — a refusal row missing them was legible
  // only by following its caseId to a sibling row.
  assert.equal(refusals[0].details.employmentId, ESCALATED_TICKET.employmentId);
  assert.deepEqual(refusals[0].details.flags, caseStore.cases[0].flags ?? []);
  assert.equal(refusals[0].details.reason, "no_review_path");

  assert.equal(caseStore.cases[0].status, "escalated", "nothing moved");
  assert.equal(caseStore.reviewQueue[0].status, "pending");
});

test("service: approving twice is refused the second time", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const first = await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "Looks correct." }, deps());
  const second = await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "Trying again." }, deps());

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, "already_decided");
  assert.equal(audit.entries.filter((e) => e.action === "human_approved").length, 1);
  assert.equal(caseStore.documents.length, 1, "no second letter");
});

test("service: an approval is refused if the employee is no longer active", async () => {
  // The freshness re-check. policyEngine checked this when the ticket arrived;
  // approval can happen days later, and the answer can have changed.
  await seedTicket(THIRD_PARTY_TICKET);

  const staleRemote = {
    getEmployment: async () => ({ id: "emp_active_001", status: "terminated" }),
    getLegalEntity: async () => {
      throw new Error("must not render a letter for a terminated employee");
    },
  };

  const result = await submitReviewDecision(
    { ticketId: "1001", action: "approve", approver: APPROVER, note: "Should fail freshness check." },
    { ...deps(), remote: staleRemote }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "employment_no_longer_active");
  assert.equal(result.status, 409);

  const refusals = audit.entries.filter((e) => e.action === "human_approve_refused");
  assert.equal(refusals[0].details.observedStatus, "terminated");
  assert.equal(caseStore.cases[0].status, "pending_review", "the case stays open for a specialist");
  assert.equal(caseStore.documents.length, 0);
});

test("service: an unidentified caller is refused and writes no audit row", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const result = await submitReviewDecision({ ticketId: "1001", action: "approve", approver: null }, deps());

  assert.equal(result.ok, false);
  assert.equal(result.code, "approver_required");
  // Anyone who can reach the endpoint could otherwise fill the audit log with
  // rows naming cases they never identified.
  assert.equal(audit.entries.filter((e) => e.action.includes("refused")).length, 0);
});

test("service: decisions work with no Zendesk client configured", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const result = await submitReviewDecision(
    { ticketId: "1001", action: "approve", approver: APPROVER, note: "Approved despite no Zendesk connection." },
    { ...deps(), zendesk: null }
  );

  assert.equal(result.ok, true);
  assert.equal(audit.entries.filter((e) => e.action === "human_approved").length, 1);
  assert.equal(TICKETS["1001"].status, "open", "no ticket was touched");
});

// ---------------------------------------------------------------------------
// The metric this whole feature exists to make real
// ---------------------------------------------------------------------------

test("metrics: approve/deny produce a real HITL accept rate", async () => {
  // Before any human decides, the accept rate is null — "unmeasured", which
  // compute.js deliberately distinguishes from "everyone rejected it".
  await seedTicket(THIRD_PARTY_TICKET);
  await seedTicket({ ...THIRD_PARTY_TICKET, externalRef: "1002" });

  const uc01 = (report) => report.byUseCase.find((u) => u.useCase === "UC-01");

  const unmeasured = computeMetrics({ cases: caseStore.cases, reviewQueue: caseStore.reviewQueue });
  assert.equal(uc01(unmeasured).review.acceptRate, null);
  assert.equal(uc01(unmeasured).review.pending, 2);

  await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "Approve first." }, deps());
  await submitReviewDecision({ ticketId: "1002", action: "deny", approver: APPROVER, note: "Deny second." }, deps());

  const measured = computeMetrics({ cases: caseStore.cases, reviewQueue: caseStore.reviewQueue });
  const review = uc01(measured).review;
  assert.equal(review.approved, 1);
  assert.equal(review.rejected, 1);
  assert.equal(review.acceptRate, 0.5);
});

// ---------------------------------------------------------------------------
// The HTTP API — driven through the real handler, no port needed.
// ---------------------------------------------------------------------------

/** Minimal req/res doubles so the real handler runs without a listening socket. */
function callApi(handler, { method, path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, headers: this.headers, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

test("api: GET returns the case view for a ticket, 404 for an unknown one", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler(deps());

  const found = await callApi(handler, { method: "GET", path: "/api/review/ticket/1001" });
  assert.equal(found.status, 200);
  assert.equal(found.body.case.decision, "human_review");
  assert.equal(found.body.actionable, true);

  const missing = await callApi(handler, { method: "GET", path: "/api/review/ticket/9999" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.found, false);
});

test("api: POST approve round-trips and writes the audit row", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler(deps());

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/approve",
    headers: { "x-zaf-approver": APPROVER },
    body: { note: "Verified." },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(audit.entries.filter((e) => e.action === "human_approved").length, 1);
});

test("api: the refusal's HTTP status comes from the policy, not the transport", async () => {
  await seedTicket(ESCALATED_TICKET);
  const handler = createReviewHandler(deps());

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/3003/approve",
    headers: { "x-zaf-approver": APPROVER },
  });

  assert.equal(res.status, REFUSALS.no_review_path.status);
  assert.equal(res.body.code, "no_review_path");
});

test("api: an unauthenticated POST is refused with 401", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler(deps());

  const res = await callApi(handler, { method: "POST", path: "/api/review/ticket/1001/approve" });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "approver_required");
});

test("api: with signed identity required, an unsigned call fails closed", async () => {
  // The service must not look more trustworthy than it is — see the security
  // note in src/review/server.js.
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler({ ...deps(), requireSignedIdentity: true });

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/approve",
    headers: { "x-zaf-approver": APPROVER },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_required");
  assert.equal(audit.entries.filter((e) => e.action === "human_approved").length, 0);
});

test("api: with signed identity required but no verifier configured, a token is still refused", async () => {
  // requireSignedIdentity must never silently degrade to "no verifier means
  // trust it anyway" — see zafAuth.js and the security note in server.js.
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler({ ...deps(), requireSignedIdentity: true, zafVerifier: null });

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/approve",
    headers: { "x-zaf-token": "anything-at-all" },
    body: { note: "Should never reach the policy layer." },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_not_configured");
  assert.equal(audit.entries.filter((e) => e.action === "human_approved").length, 0);
});

// ---------------------------------------------------------------------------
// End-to-end signed-identity wiring: a real RSA keypair, generated once for
// this suite, signs fixture tokens exactly the way zafAuth.js expects to
// verify one (see test/zafAuth.test.js for the unit-level coverage of the
// verification logic itself; these tests cover only that server.js actually
// calls it, and uses ONLY its result).
// ---------------------------------------------------------------------------

const zafKeypair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function signZafToken(claims) {
  const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const headerB64 = b64url({ alg: "RS256", typ: "JWT" });
  const payloadB64 = b64url(claims);
  const signer = createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const signatureB64 = signer.sign(zafKeypair.privateKey).toString("base64url");
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

test("api: with signed identity required, a validly-signed token is accepted and its approver used", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const zafVerifier = createZafVerifier({ publicKeyPem: zafKeypair.publicKey });
  const handler = createReviewHandler({ ...deps(), requireSignedIdentity: true, zafVerifier });

  const token = signZafToken({ email: APPROVER, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 });

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/approve",
    headers: { "x-zaf-token": token },
    body: { note: "Verified via signed token." },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const approvals = audit.entries.filter((e) => e.action === "human_approved");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].actor, APPROVER, "the verified token claim, not any header, is what got attributed");
});

test("api: with signed identity required, the X-ZAF-Approver header is ignored even if present", async () => {
  // The whole point of the fix: a valid signature must not be pairable with a
  // spoofed name. The token names the real approver; the header claims someone
  // else entirely — the header must lose.
  await seedTicket(THIRD_PARTY_TICKET);
  const zafVerifier = createZafVerifier({ publicKeyPem: zafKeypair.publicKey });
  const handler = createReviewHandler({ ...deps(), requireSignedIdentity: true, zafVerifier });

  const token = signZafToken({ email: APPROVER, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 });

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/approve",
    headers: { "x-zaf-token": token, "x-zaf-approver": "someone-spoofed@evil.example" },
    body: { note: "Verified via signed token." },
  });

  assert.equal(res.status, 200);
  const approvals = audit.entries.filter((e) => e.action === "human_approved");
  assert.equal(approvals[0].actor, APPROVER);
});

test("api: with signed identity required, a tampered token is refused with the verifier's own reason", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const zafVerifier = createZafVerifier({ publicKeyPem: zafKeypair.publicKey });
  const handler = createReviewHandler({ ...deps(), requireSignedIdentity: true, zafVerifier });

  const token = signZafToken({ email: APPROVER, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 });
  const [header, payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ email: "attacker@evil.example" })).toString("base64url");
  const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/review/ticket/1001/approve",
    headers: { "x-zaf-token": tamperedToken },
    body: { note: "Should be rejected before reaching the policy layer." },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "invalid_signature");
  assert.equal(audit.entries.filter((e) => e.action === "human_approved").length, 0);
});

test("api: CORS preflight is answered for the ZAF iframe origin", async () => {
  const handler = createReviewHandler({ ...deps(), allowedOrigin: "https://your-subdomain.zendesk.com" });
  const res = await callApi(handler, { method: "OPTIONS", path: "/api/review/ticket/1001" });

  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "https://your-subdomain.zendesk.com");
  assert.match(res.headers["access-control-allow-headers"], /X-ZAF-Approver/);
});

test("api: healthz answers without touching storage", async () => {
  const handler = createReviewHandler(deps());
  const res = await callApi(handler, { method: "GET", path: "/healthz" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

// ---------------------------------------------------------------------------
// GET /api/review/tickets — the dashboard's UC-01 queue: every case with a
// review_queue row, newest first. An auto_resolve case never had one, so it
// must not appear here.
// ---------------------------------------------------------------------------

test("store: list() returns every reviewable case, newest first, excluding auto_resolve", async () => {
  await seedTicket(THIRD_PARTY_TICKET); // human_review
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  await seedTicket({ ...THIRD_PARTY_TICKET, externalRef: "1002" }); // human_review, newer
  await seedTicket({
    externalRef: "1003",
    text: "Please send a standard employment verification letter.",
    session: { authenticatedEmploymentId: "emp_active_001" },
    employmentId: "emp_active_001",
  }); // auto_resolve — must be excluded

  const rows = await store.list();
  assert.deepEqual(
    rows.map((r) => r.externalRef),
    ["1002", "1001"],
    "newest first, and the auto_resolve case is absent"
  );
  assert.equal(rows[0].reviewStatus, "pending");
  assert.equal(rows[0].useCase, "UC-01");
});

test("api: GET /api/review/tickets lists the queue for the dashboard", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler(deps());

  const res = await callApi(handler, { method: "GET", path: "/api/review/tickets" });
  assert.equal(res.status, 200);
  assert.equal(res.body.tickets.length, 1);
  assert.equal(res.body.tickets[0].externalRef, "1001");
  assert.equal(res.body.tickets[0].decision, "human_review");
});

test("api: GET /api/review/tickets reflects a decision once approved", async () => {
  await seedTicket(THIRD_PARTY_TICKET);
  const handler = createReviewHandler(deps());
  await submitReviewDecision({ ticketId: "1001", action: "approve", approver: APPROVER, note: "ok" }, deps());

  const res = await callApi(handler, { method: "GET", path: "/api/review/tickets" });
  assert.equal(res.body.tickets[0].reviewStatus, "approved");
  assert.equal(res.body.tickets[0].status, "resolved");
});

// ---------------------------------------------------------------------------
// F-21 (HIGH) — a prototype property name is not a review action
// ---------------------------------------------------------------------------
// `REVIEW_ACTIONS[action]` on a plain object resolved through Object.prototype,
// and `action` is the raw URL segment. So
// POST /api/review/ticket/1001/constructor returned 200 and wrote
// `reviewStatus: undefined` — a case in a status no gate recognises,
// permanently unactionable, with an audit verb of `undefined`. REVIEW_ACTIONS
// is a Map now, which has no prototype chain to walk.
// ---------------------------------------------------------------------------

const PROTOTYPE_NAMES = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"];

test("F-21. every prototype property name is refused as an unknown action, over HTTP", async () => {
  for (const name of PROTOTYPE_NAMES) {
    await seedTicket(THIRD_PARTY_TICKET);
    const handler = createReviewHandler(deps());

    const res = await callApi(handler, {
      method: "POST",
      path: `/api/review/ticket/1001/${name}`,
      headers: { "x-zaf-approver": APPROVER },
      body: { note: "Verified." },
    });

    assert.equal(res.status, 400, `POST .../${name} answered ${res.status}`);
    assert.equal(res.body.code, "unknown_action");

    // And the case is untouched — still awaiting a real decision.
    const view = await callApi(handler, { method: "GET", path: "/api/review/ticket/1001" });
    assert.equal(view.body.actionable, true, `POST .../${name} left the case unactionable`);
    assert.equal(view.body.review.status, "pending");
  }
});

test("F-21. the pure policy refuses them too, so nothing depends on the transport catching it", () => {
  const caseRow = { useCase: "UC-01", decision: "human_review", flags: [], requester: null };
  const reviewRow = { status: "pending" };
  for (const name of PROTOTYPE_NAMES) {
    const verdict = evaluateReviewAction({ caseRow, reviewRow, action: name, approver: APPROVER, note: "n" });
    assert.equal(verdict.allowed, false, `${name} was allowed`);
    assert.equal(verdict.code, "unknown_action");
  }
  // A non-string action (a JSON body could supply one) is refused as well.
  assert.equal(
    evaluateReviewAction({ caseRow, reviewRow, action: { toString: () => "approve" }, approver: APPROVER, note: "n" }).code,
    "unknown_action"
  );
  // The two real actions still work.
  assert.equal(evaluateReviewAction({ caseRow, reviewRow, action: "approve", approver: APPROVER, note: "n" }).allowed, true);
  assert.equal(evaluateReviewAction({ caseRow, reviewRow, action: "deny", approver: APPROVER, note: "n" }).allowed, true);
});

test("F-21 (audit). the other user-controlled lookups in the repo reject prototype names too", async () => {
  const { canRoleSubmit } = await import("../src/remoteui/roles.js");
  const { resolvePersona } = await import("../src/portal/personas.js");
  const { countryName } = await import("../src/uc03/letter.js");

  for (const name of PROTOTYPE_NAMES) {
    assert.equal(canRoleSubmit(name, "submit_amendment_request"), false, `canRoleSubmit accepted ${name}`);
    assert.equal(resolvePersona(name), null, `resolvePersona accepted ${name}`);
    // countryName echoes an unknown code back rather than returning a function.
    assert.equal(typeof countryName(name), "string");
  }
});

// ---------------------------------------------------------------------------
// F-20, one service later: every approval CLI must ASK for the safe default,
// not re-implement the old flag.
// ---------------------------------------------------------------------------
// `signedIdentityRequired()` is the one place that answers "must an approver be
// signed here?", and its answer is "yes whenever a durable store is attached" —
// because a decision that outlives the process and names a human must have come
// from a signature. Commit 39a7e33 moved the approval APIs onto it.
//
// `src/review/cli.js` was missed. It kept reading
// `process.env.ZAF_REQUIRE_SIGNED_IDENTITY === "true"` directly, so
// `npm run review-api` against the live Supabase announced "Trusting the
// X-ZAF-Approver header" and did exactly that: the UC-01 approval API — the one
// the installed ZAF sidebar drives — accepted an approve or a deny from anyone
// who could set a header, and wrote it to the real `audit_log` under whatever
// name the header carried.
//
// Every unit test of the mechanism passed throughout, because the mechanism was
// never the defect: the defect was one caller not using it. Four services on a
// safe default and a fifth on the old flag is indistinguishable from five safe
// services unless something compares them. This is that something.
test("F-20: no approval CLI decides the signed-identity posture for itself", () => {
  const clis = [
    "../src/review/cli.js",
    "../src/uc04/cli.js",
    "../src/uc05/cli.js",
    "../src/uc06/cli.js",
    "../src/uc09/cli.js",
  ];

  for (const rel of clis) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    const source = readFileSync(path, "utf8")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    assert.ok(
      /signedIdentityRequired\s*\(/.test(source),
      `${rel} does not call signedIdentityRequired() — it is deciding its own auth posture, ` +
        `which is how the UC-01 review API ended up trusting a header against production Supabase.`
    );

    // Reading the env var to REPORT which cause is in force is fine; using it
    // as the decision is not. The assignment form is the one that matters.
    assert.ok(
      !/(const|let|var)\s+requireSignedIdentity\s*=\s*process\.env\.ZAF_REQUIRE_SIGNED_IDENTITY/.test(source),
      `${rel} sets requireSignedIdentity straight from the env var, bypassing the ` +
        `"a durable store is attached" default that makes the flag unnecessary in production.`
    );
  }
});
