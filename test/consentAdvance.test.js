// ---------------------------------------------------------------------------
// consentAdvance.test.js — the employee says yes, and the request moves
// ---------------------------------------------------------------------------
// OWNER REPORT 2026-08-28: "I made a third party request. I consented. And I
// went to Zendesk expecting to see a ticket... I do not see that."
//
// The audit trail on production said it exactly:
//     13:36:22  awaiting_employee_consent
//     13:37:12  consent_granted
//               (nothing further)
//
// The grant is the event that changes the answer, so the grant is what must
// advance the case. These tests pin that, and pin the four things it must
// refuse to advance — because "moves a disclosure forward" is precisely the
// capability you do not want to be loose.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { CaseStore } from "../src/shared/caseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { advanceOnConsentGrant } from "../src/uc01/consentAdvance.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const remote = () => new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });

/** Drive a real third-party enquiry to `awaiting_employee_consent`. */
async function pendingEnquiry() {
  const caseStore = new CaseStore();
  const audit = new AuditLogger();
  const tickets = [];
  const zendesk = {
    createTicket: async (t) => {
      tickets.push(t);
      return { id: 5100 + tickets.length };
    },
    flagForReview: async () => ({}),
    listGroups: async () => [],
  };
  const doorReference = "ad5e1fb7-e0cb-47e3-bb73-db3ea4ee8266";
  const out = await handleVerificationTicket(
    {
      text: "We are referencing a prospective tenant and need their employment status and start date.",
      session: null,
      employmentId: "emp_active_001",
      requestingParty: "Kestrel Building Society",
      purpose: "Tenancy affordability check",
      subjectName: "Amara Okafor",
      subjectDateOfBirth: "1990-05-04",
      returnAddress: "refs@kestrel.example.com",
      source: "third_party_door",
      externalRef: doorReference,
    },
    { remote: remote(), audit, caseStore, zendesk, classify: classifyRequestRuleBased }
  );
  assert.equal(out.decision, "awaiting_employee_consent", "fixture did not reach the state under test");
  assert.equal(tickets.length, 0, "a ticket was raised before anyone consented");
  const consent = caseStore.consentRecords.find((r) => r.status === "pending");
  assert.ok(consent, "no pending consent record");
  return { caseStore, audit, zendesk, tickets, consent, doorReference };
}

async function grant(caseStore, consent) {
  const owning = caseStore.cases.find((c) => c.id === consent.caseId);
  await caseStore.updateConsentDecision(consent.id, {
    status: "granted",
    grantedByEmploymentId: owning?.employmentId ?? null,
    grantedBySignal: "portal_persona_session",
  });
}

// ---------------------------------------------------------------------------
// 1. The reported bug
// ---------------------------------------------------------------------------

test("granting consent raises the specialist ticket — no second request from the third party", async () => {
  const { caseStore, audit, zendesk, tickets, consent } = await pendingEnquiry();
  await grant(caseStore, consent);

  const res = await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });
  assert.equal(res.advanced, true, `the grant did not advance the enquiry (${res.reason})`);
  assert.equal(res.decision, "human_review");
  assert.equal(tickets.length, 1, "the employee consented and no ticket reached a specialist");
  assert.match(tickets[0].subject, /third-party disclosure request awaiting specialist review/);
});

test("the enquirer's own reference still resolves to the advanced case", async () => {
  // Otherwise the letter is issued against a case the enquirer cannot reach,
  // and collecting it on the door returns the "nothing yet" constant forever.
  const { caseStore, audit, zendesk, consent, doorReference } = await pendingEnquiry();
  await grant(caseStore, consent);
  await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });

  const found = await caseStore.findByDoorReference(doorReference);
  assert.ok(found, "the enquirer's reference no longer resolves after the advance");
  assert.equal(found.decision, "human_review", "it resolves to the stale pending case, not the advanced one");
});

test("the specialist's note still carries the claims the enquirer made", async () => {
  // The re-decide runs from the RECORD, not from the original request object.
  // Before `claimedSubjectName` was persisted the note said "not recorded"
  // about a name the enquirer had actually given.
  const { caseStore, audit, zendesk, tickets, consent } = await pendingEnquiry();
  await grant(caseStore, consent);
  await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });
  const note = tickets[0].comment.html_body;
  assert.match(note, /Amara Okafor/, "the enquirer's claimed name was lost in the re-decide");
  assert.match(note, /1990-05-04/, "the claimed date of birth was lost");
  assert.match(note, /THEIR CLAIM/, "the claims are no longer labelled as claims");
});

// ---------------------------------------------------------------------------
// 2. What it must refuse to advance
// ---------------------------------------------------------------------------

test("a DENIED consent advances nothing and reaches no specialist", async () => {
  const { caseStore, audit, zendesk, tickets, consent } = await pendingEnquiry();
  await caseStore.updateConsentDecision(consent.id, {
    status: "denied",
    grantedByEmploymentId: null,
    grantedBySignal: "portal_persona_session",
  });
  const res = await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });
  assert.equal(res.advanced, false);
  assert.equal(res.reason, "consent_not_granted");
  assert.equal(tickets.length, 0, "a refusal was handed to a specialist to look at again");
});

test("a case that is not awaiting consent is never re-run", async () => {
  const { caseStore, audit, zendesk, tickets, consent } = await pendingEnquiry();
  await grant(caseStore, consent);
  const caseRow = caseStore.cases.find((c) => c.id === consent.caseId);
  caseRow.decision = "blocked";
  const res = await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });
  assert.equal(res.advanced, false);
  assert.equal(res.reason, "case_not_awaiting_consent");
  assert.equal(tickets.length, 0);
});

test("advancing twice does not raise two tickets", async () => {
  // A double-click on Grant, or a retry, must not produce two hand-offs for one
  // disclosure. The second call finds the case no longer awaiting consent.
  const { caseStore, audit, zendesk, tickets, consent } = await pendingEnquiry();
  await grant(caseStore, consent);
  await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });
  const second = await advanceOnConsentGrant({ caseStore, audit, remote: remote(), zendesk, consentRecordId: consent.id });
  assert.equal(second.advanced, false, "a repeated grant advanced the same enquiry twice");
  assert.equal(tickets.length, 1, "one disclosure produced two specialist tickets");
});

test("it never throws — the employee's grant is already durable when this runs", async () => {
  const { caseStore, audit, consent } = await pendingEnquiry();
  await grant(caseStore, consent);
  const exploding = {
    createTicket: async () => {
      throw new Error("zendesk on fire");
    },
    flagForReview: async () => ({}),
    listGroups: async () => [],
  };
  const res = await advanceOnConsentGrant({
    caseStore,
    audit,
    remote: remote(),
    zendesk: exploding,
    consentRecordId: consent.id,
  });
  assert.equal(typeof res.advanced, "boolean", "a hand-off failure propagated to the caller");
});

test("an unknown consent id is a reason, not an exception", async () => {
  const { caseStore, audit, zendesk } = await pendingEnquiry();
  const res = await advanceOnConsentGrant({
    caseStore,
    audit,
    remote: remote(),
    zendesk,
    consentRecordId: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(res.advanced, false);
  assert.equal(res.reason, "no_such_consent_record");
});
