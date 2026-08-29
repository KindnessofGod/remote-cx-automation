// ---------------------------------------------------------------------------
// thirdPartyLetterCollect.test.js — the approved letter reaches the party it
//                                   was approved for, and nothing else does
// ---------------------------------------------------------------------------
// OWNER DECISION 2026-08-28: "no matter the process we follow, the letter must
// show up on the third party page."
//
// That is a deliberate, stated narrowing of VC-33, and these tests pin exactly
// how far it goes. What is given up: an enquirer holding their reference can
// now tell "a specialist approved this disclosure to me" from everything else.
// What is NOT given up, and is asserted here one case at a time:
//
//   - pending consent            -> the constant
//   - consent refused / declined -> the constant
//   - a reference naming nothing -> the constant
//   - a malformed reference      -> the constant
//   - a store that throws        -> the constant
//
// So "declined" and "does not exist" remain indistinguishable, which was always
// the load-bearing half of the invariant. The ONLY thing that opens the door is
// the existence of an `employment_verification_letter` document, and one of
// those exists only where a named specialist approved in the ZAF sidebar
// (src/review/service.js) — no policy path, no classifier, and no consent grant
// on its own can produce one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { CaseStore } from "../src/shared/caseStore.js";
import {
  startThirdPartyDoorServer,
  NO_LETTER_YET_MESSAGE,
  thirdPartyConsentGranted,
} from "../src/thirdparty/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";

const LETTER = "<!doctype html><html><body>Employment Verification Letter — Amara Okafor</body></html>";

async function doorWith(caseStore) {
  const remote = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const server = await startThirdPartyDoorServer(
    { remote, audit: new AuditLogger(), caseStore, demoSubject: null },
    0
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, collect: (ref) => fetch(`${base}/api/requests/${encodeURIComponent(ref)}/letter`).then((r) => r.json()) };
}

/** A third-party case, optionally already relinked to a ticket and/or approved. */
function seed({ relinkedTo = null, withLetter = false } = {}) {
  const store = new CaseStore();
  const reference = "f0227efb-61e4-413b-b425-e4b44b3f35fb";
  const row = store.createCase({
    useCase: "UC-01",
    source: "third_party_door",
    externalRef: reference,
    employmentId: "emp_active_001",
    requester: "unauthenticated",
    classification: { requestingParty: "First National Bank", purpose: "Mortgage", doorReference: reference },
    decision: "awaiting_employee_consent",
    reason: "awaiting_employee_consent",
    flags: [],
    status: "pending",
  });
  if (withLetter) store.createDocument({ caseId: row.id, type: "employment_verification_letter", content: LETTER });
  if (relinkedTo) store.linkTicket(row.id, relinkedTo);
  return { store, reference, row };
}

// ---------------------------------------------------------------------------
// 1. The thing the owner asked for
// ---------------------------------------------------------------------------

test("an approved letter is returned to the holder of the reference", async () => {
  const { store, reference } = seed({ withLetter: true });
  const { server, collect } = await doorWith(store);
  try {
    const res = await collect(reference);
    assert.equal(res.ready, true);
    assert.match(res.letterHtml, /Employment Verification Letter/);
    assert.ok(res.contentHash, "no hash travelled with the letter — a forwarded copy cannot be checked");
  } finally {
    server.close();
  }
});

test("it still resolves AFTER the case has been relinked to a Zendesk ticket", async () => {
  // The relink is what made this hard: `linkTicket()` overwrites `external_ref`
  // with the ticket id, so the reference the enquirer actually holds stops
  // being the case's reference at exactly the moment a letter can exist. If
  // this regresses, the letter is issued and the enquirer can never collect it.
  const { store, reference } = seed({ relinkedTo: "168", withLetter: true });
  const { server, collect } = await doorWith(store);
  try {
    assert.equal((await collect(reference)).ready, true);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Everything that must stay indistinguishable
// ---------------------------------------------------------------------------

test("a request still awaiting consent gets the constant, not a status", async () => {
  const { store, reference } = seed({ withLetter: false });
  const { server, collect } = await doorWith(store);
  try {
    const res = await collect(reference);
    assert.equal(res.ready, false);
    assert.equal(res.message, NO_LETTER_YET_MESSAGE);
    assert.equal(res.letterHtml, undefined, "a letter body reached a case with no approved letter");
  } finally {
    server.close();
  }
});

test("a reference that names nothing is answered identically to one that does", async () => {
  // The load-bearing half. "Declined" and "this person does not exist" must
  // remain one answer, and the only way to be sure is to compare the bytes.
  const { store, reference } = seed({ withLetter: false });
  const { server, collect } = await doorWith(store);
  try {
    const real = await collect(reference);
    const invented = await collect("11111111-2222-3333-4444-555555555555");
    assert.deepEqual(real, invented, "a real pending reference is distinguishable from an invented one");
  } finally {
    server.close();
  }
});

test("a malformed reference never reaches the store at all, and answers the same", async () => {
  const { store } = seed({ withLetter: true });
  let touched = false;
  store.findByDoorReference = async () => {
    touched = true;
    return null;
  };
  const { server, collect } = await doorWith(store);
  try {
    const res = await collect("not-a-uuid");
    assert.equal(res.ready, false);
    assert.equal(res.message, NO_LETTER_YET_MESSAGE);
    assert.equal(touched, false, "an unshaped reference was used as a lookup key");
  } finally {
    server.close();
  }
});

test("a store that throws is indistinguishable from one that found nothing", async () => {
  // Otherwise an unreachable database becomes a side channel: throw for real
  // references, return cleanly for invented ones, and the difference leaks.
  const { store, reference } = seed({ withLetter: true });
  store.findByDoorReference = async () => {
    throw new Error("database on fire");
  };
  const { server, collect } = await doorWith(store);
  try {
    const res = await collect(reference);
    assert.equal(res.ready, false);
    assert.equal(res.message, NO_LETTER_YET_MESSAGE);
  } finally {
    server.close();
  }
});

test("a case that is NOT a third-party-door case is unreachable through this route", async () => {
  // The route answers an unauthenticated stranger. If it resolved any
  // external_ref, a guessable Zendesk ticket id would be as good as the
  // unguessable capability the door mints.
  const store = new CaseStore();
  const ref = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const row = store.createCase({
    useCase: "UC-01",
    source: "zendesk",
    externalRef: ref,
    employmentId: "emp_active_001",
    requester: "someone@example.test",
    classification: {},
    decision: "human_review",
    reason: "over_scope_request",
    flags: [],
    status: "pending",
  });
  store.createDocument({ caseId: row.id, type: "employment_verification_letter", content: LETTER });
  const { server, collect } = await doorWith(store);
  try {
    const res = await collect(ref);
    assert.equal(res.ready, false, "a Zendesk-originated case leaked its letter through the third-party door");
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 3. A granted consent reopens a joined enquiry
// ---------------------------------------------------------------------------
// Found while driving the real flow on the deployment: submit -> employee
// grants -> submit again produced NOTHING, because the intake window (one
// wall-clock hour, D-26) joined the second submission to the first and
// re-decided nothing. The grant itself raises no ticket by design
// (uc01/workflow.js STEP 8 excludes `awaiting_employee_consent` — the employee
// owns that state, not a specialist), and the follow-up route re-decides
// nothing either. So a granted consent sat stranded for up to an hour with
// nothing able to advance it.

import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const ENQUIRY = {
  requestingParty: "Harborline Mortgage",
  purpose: "Home loan affordability review",
  subjectName: "Amara Okafor",
  subjectDateOfBirth: "1990-05-04",
  employmentReference: "AO4T9X",
  returnAddress: "loans@harborline.example.com",
  message: "We are reviewing a home loan application and need this applicants employment status and start date.",
};

async function liveDoor() {
  const caseStore = new CaseStore();
  const remote = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const tickets = [];
  const zendesk = {
    createTicket: async (t) => {
      tickets.push(t);
      return { id: 4200 + tickets.length };
    },
    flagForReview: async () => ({}),
    listGroups: async () => [],
  };
  const server = await startThirdPartyDoorServer(
    { remote, audit: new AuditLogger(), caseStore, zendesk, classify: classifyRequestRuleBased, demoSubject: null },
    0
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    caseStore,
    tickets,
    submit: () =>
      fetch(`${base}/api/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ENQUIRY),
      }).then((r) => r.json()),
  };
}

// NOTE ON WHAT IS AND IS NOT EXERCISED HERE. The intake-window JOIN only
// engages when a durable claim ledger exists (`claimExternalRef()` keys on the
// `workflow_claims` PRIMARY KEY; with no pgPool every submission claims
// cleanly). So an in-memory door re-decides a resubmission anyway, and an
// "integration" test of the reopen would pass without the reopen existing at
// all — passing for the wrong reason, which is worse than not testing it.
//
// The DECISION is therefore tested directly, on the predicate the join branch
// consults. That predicate is the whole of the new behaviour; the branch around
// it is three lines.

test("a granted consent reopens a joined enquiry", async () => {
  const { store, reference } = seed({ withLetter: false });
  const row = store.cases[0];
  const consent = store.createConsentRecord({
    caseId: row.id,
    consentType: "third_party_verification",
    status: "pending",
    source: "third_party_door",
    requestingParty: "First National Bank",
    purpose: "Mortgage",
  });
  assert.equal(
    await thirdPartyConsentGranted({ caseStore: store, reference }),
    false,
    "a pending consent reopened the enquiry"
  );

  await store.updateConsentDecision(consent.id, {
    status: "granted",
    grantedByEmploymentId: row.employmentId,
    grantedBySignal: "portal_persona_session",
  });
  assert.equal(await thirdPartyConsentGranted({ caseStore: store, reference }), true);
});

test("a DENIED consent does not reopen it — only a grant does", async () => {
  const { store, reference } = seed({ withLetter: false });
  const row = store.cases[0];
  const consent = store.createConsentRecord({
    caseId: row.id,
    consentType: "third_party_verification",
    status: "pending",
    source: "third_party_door",
    requestingParty: "First National Bank",
    purpose: "Mortgage",
  });
  await store.updateConsentDecision(consent.id, {
    status: "denied",
    grantedByEmploymentId: null,
    grantedBySignal: "portal_persona_session",
  });
  assert.equal(
    await thirdPartyConsentGranted({ caseStore: store, reference }),
    false,
    "a refusal reopened the enquiry — a declined disclosure would reach a specialist"
  );
});

test("only an enquiry that STOPPED for consent can be reopened by consent", async () => {
  // A case decided for any other reason must not be re-run by a grant that
  // happens to match its party and purpose.
  const { store, reference } = seed({ withLetter: false });
  const row = store.cases[0];
  row.decision = "blocked";
  const consent = store.createConsentRecord({
    caseId: row.id,
    consentType: "third_party_verification",
    status: "granted",
    source: "third_party_door",
    requestingParty: "First National Bank",
    purpose: "Mortgage",
  });
  assert.ok(consent);
  assert.equal(await thirdPartyConsentGranted({ caseStore: store, reference }), false);
});

test("it fails CLOSED to joining when the store throws", async () => {
  // The safe direction: a wrongly-joined request is visible and recoverable
  // (the enquirer asks again), a wrongly re-run one duplicates a decision.
  const { store, reference } = seed({ withLetter: false });
  store.findByDoorReference = async () => {
    throw new Error("database on fire");
  };
  assert.equal(await thirdPartyConsentGranted({ caseStore: store, reference }), false);
});

// ---------------------------------------------------------------------------
// 4. The re-decide must actually WRITE — the failure that shipped once
// ---------------------------------------------------------------------------

test("a reopened enquiry claims a FRESH workflow ref, so the re-decide is not refused as a duplicate", async () => {
  // OBSERVED ON THE DEPLOYMENT: the reopen fired, returned the enquirer's own
  // reference, and produced no decision and no ticket. `handleVerificationTicket()`
  // claims its externalRef before the first durable write (exactly-once), the
  // first run had already claimed that reference, and the second was correctly
  // refused as a redelivery — writing nothing, silently.
  //
  // Asserted on the SOURCE because the join branch needs a durable claim ledger
  // to reach at all (see the note above), and the property is structural: the
  // workflow must never be handed the reference the first run already claimed.
  const source = readFileSync(new URL("../src/thirdparty/server.js", import.meta.url), "utf8");
  assert.match(source, /workflowRef = randomUUID\(\);/, "a reopened run no longer takes a fresh workflow ref");
  assert.match(source, /externalRef: workflowRef,/, "the workflow is handed something other than workflowRef");
  assert.match(source, /doorReference: reference,/, "the enquirer's own reference is no longer carried through");
});

test("the case records the enquirer's reference even when its externalRef differs", async () => {
  // The consequence that matters: after a re-decide the case's external_ref is
  // NOT what the enquirer holds, so `doorReference` is the only thing that can
  // still resolve their collection request.
  const store = new CaseStore();
  const enquirerRef = "ade920ab-3159-43cb-9761-c8d856688f40";
  const row = store.createCase({
    useCase: "UC-01",
    source: "third_party_door",
    externalRef: "a-different-workflow-ref",
    employmentId: "emp_active_001",
    requester: "unauthenticated",
    classification: { requestingParty: "Harborline", purpose: "Loan", doorReference: enquirerRef },
    decision: "human_review",
    reason: "third_party_request",
    flags: [],
    status: "pending",
  });
  store.createDocument({ caseId: row.id, type: "employment_verification_letter", content: LETTER });

  const found = await store.findByDoorReference(enquirerRef);
  assert.equal(found?.id, row.id, "the enquirer's reference no longer resolves after a re-decide");
});

// ---------------------------------------------------------------------------
// 5. What the letter tells the bank to quote
// ---------------------------------------------------------------------------

test("the letter carries the ENQUIRER's reference, never the Zendesk ticket id", async () => {
  // REPORTED 2026-08-28 from a real approved letter: it printed
  // "Reference: 174". `caseStore.linkTicket()` repoints `external_ref` at the
  // ticket id the moment a specialist can act, and the letter was rendered from
  // that field — so a document going to a bank quoted this account's internal
  // ticket numbering, and quoted a number the bank could not trace from their
  // side, since what they hold is the door's UUID.
  const { submitReviewDecision } = await import("../src/review/service.js");
  const { InMemoryReviewStore } = await import("../src/review/store.js");
  const { AuditLogger } = await import("../src/shared/audit.js");
  const { RemoteClient } = await import("../src/remote/restClient.js");

  const doorReference = "35dcef7a-2699-4ff1-8140-dd03c4f7aa3b";
  const caseStore = new CaseStore();
  const row = caseStore.createCase({
    useCase: "UC-01",
    source: "third_party_door",
    externalRef: doorReference,
    employmentId: "emp_active_001",
    requester: "unauthenticated",
    classification: { requestingParty: "First National Bank", purpose: "Mortgage", doorReference },
    decision: "human_review",
    reason: "third_party_request",
    flags: [],
    status: "pending",
  });
  caseStore.createReviewQueueEntry({ caseId: row.id });
  // THE RELINK — the step that introduced the defect.
  await caseStore.linkTicket(row.id, "174");

  const remote = new RemoteClient({ baseUrl: "http://mock.local", token: "t", fetchImpl: createInProcessFetch() });
  const res = await submitReviewDecision(
    { ticketId: "174", action: "approve", approver: "hr.ops@example.test", note: "ok" },
    { store: new InMemoryReviewStore(caseStore), caseStore, audit: new AuditLogger(), remote, zendesk: null }
  );
  assert.equal(res.ok, true, `approve failed: ${res.code} ${res.reason}`);

  const letter = await caseStore.findLetterForCase(row.id);
  assert.ok(letter?.content, "no letter was issued");
  assert.match(letter.content, new RegExp(doorReference), "the letter does not carry the enquirer's own reference");
  assert.doesNotMatch(
    letter.content,
    />\s*174\s*</,
    "the letter prints the internal Zendesk ticket id to an outside party"
  );
});
