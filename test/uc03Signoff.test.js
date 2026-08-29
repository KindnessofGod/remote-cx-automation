// ---------------------------------------------------------------------------
// uc03Signoff.test.js  —  the one thing UC-03 needs a human for, and the four
//                         things it must never offer one
// ---------------------------------------------------------------------------
// WHY THIS FILE IS SHAPED AROUND A POSITIVE TEST
//
// `docs/APPROVAL-QUEUE.md` §0 measured UC-03 cases as `no_approval_surface` —
// "something must be signed and nothing can sign it". Building a surface for
// that is only half the job, and the cheaper half. This repository's most
// expensive recurring defect is that a use case which STRUCTURALLY CANNOT
// SUCCEED is indistinguishable, from outside, from one being appropriately
// cautious: UC-03's own supported-countries gate spent weeks refusing every
// destination on earth while every fail-closed assertion passed. So the
// headline assertions here are the ones that MUST SUCCEED —
//
//   * a drafted travel letter is signable end to end, and the signature issues
//     the letter, moves both rows and lands in `audit_log` with the document's
//     own hash on it;
//   * an ENTITLED specialist can still sign when the roster is enforced (a
//     typo'd roster refuses everybody and passes every refusal test).
//
// — and beside each one, its twin: a case that needs no signature has NO
// control at all, refused by name, with nothing changed by the attempt.
//
// Hermetic: the real Remote mock server on a registered test port, the
// rule-based classifier, an in-memory AuditLogger/CaseStore, and a Zendesk
// double that records rather than calls. Nothing reaches OpenAI or a network.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry, submitTravelLetterSignoff } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { createUc03Handler } from "../src/uc03/server.js";
import {
  evaluateLetterActionability,
  SIGNABLE_DECISION,
  SIGNABLE_REASON,
} from "../src/uc03/signoffPolicy.js";
import { createEntitlementChecker, USE_CASE_ROLES, UC03_ROLE } from "../src/review/approverEntitlement.js";

const TEST_PORT = 4114; // test band — registered in src/shared/ports.js's TEST_PORTS

const SPECIALIST = "travel.specialist@remote.test";
const EMPLOYEE_SESSION = { authenticatedEmploymentId: "emp_active_001" };

/** The four request shapes that reach UC-03's four outcomes, by their own text. */
const REQUESTS = {
  letter:
    "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
  autoResolve: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
  routeToUc04: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
  escalate: "I need a travel support letter for a trip to Russia from 2026-09-20 to 2026-09-26.",
};

let remoteServer;
let remote;
let audit;
let caseStore;
let zendeskCalls;
let zendesk;

before(async () => {
  remoteServer = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});

after(() => remoteServer?.close());

beforeEach(() => {
  audit = new AuditLogger();
  caseStore = new CaseStore();
  zendeskCalls = [];
  zendesk = {
    updateTicket: async (ref, payload) => zendeskCalls.push({ kind: "updateTicket", ref, payload }),
    flagForReview: async (ref, payload) => zendeskCalls.push({ kind: "flagForReview", ref, payload }),
    resolveWithLetter: async (ref, html) => zendeskCalls.push({ kind: "resolveWithLetter", ref, html }),
  };
});

/**
 * Run a real inquiry through the real workflow — never a hand-built row.
 *
 * `letterAutoIssue: false` IS THIS FILE'S SUBJECT, NOT A CONVENIENCE. On the
 * default posture a standard letter for a trip that cleared every gate is
 * written and issued by the gate itself, with nobody in the path — so on the
 * default posture NOTHING REACHES THIS SURFACE except a letter request whose
 * employing entity could not be read, on which nothing is drafted and every
 * verb here is correctly refused. This file tests the OTHER posture: a
 * deployment that has chosen to require a specialist's signature on every
 * travel letter. That posture is what `policyEngine.js`'s `letterAutoIssue`
 * parameter exists for, and it is the reason this whole module still has a
 * reachable success path rather than only a backlog of pre-change rows.
 *
 * `test/uc03AutoIssue.test.js` holds the mirror of this file: the same request,
 * on the default posture, issuing without a signature — and the same four
 * refusals re-asserted there so neither posture's guarantees rest on the
 * other's tests.
 */
function createCase(text, overrides = {}, deps = {}) {
  return handleTravelInquiry(
    { text, employmentId: "emp_active_001", session: EMPLOYEE_SESSION, ...overrides },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased, letterAutoIssue: false, ...deps }
  );
}

function signoff(caseId, args = {}, deps = {}) {
  return submitTravelLetterSignoff(
    { caseId, action: "signoff", approver: SPECIALIST, note: "", ...args },
    { remote, audit, caseStore, ...deps }
  );
}

const reviewRowFor = (caseId) => caseStore.reviewQueue.find((r) => r.caseId === caseId) ?? null;
const caseRowFor = (caseId) => caseStore.cases.find((c) => c.id === caseId) ?? null;
const auditActions = () => audit.forUseCase("UC-03").map((e) => e.action);

/** Drive the real HTTP handler with no listening socket (same double as uc03Server.test.js). */
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

// ---------------------------------------------------------------------------
// 1. THE POSITIVE CASE — a drafted letter is signable, end to end
// ---------------------------------------------------------------------------

test("POSITIVE: a drafted travel letter is signed off end to end, and the signature ISSUES it", async () => {
  const created = await createCase(REQUESTS.letter, { source: "zendesk", externalRef: "sign-1" });
  assert.equal(created.decision, SIGNABLE_DECISION);
  assert.equal(created.reason, SIGNABLE_REASON);
  const letterDoc = caseStore.documents.find((d) => d.type === "travel_support_letter");
  assert.ok(letterDoc, "the workflow drafted a letter for a specialist to sign");

  const result = await signoff(created.caseId, { note: "Dates and destination check out." }, { zendesk });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.code, "signed_off");
  assert.equal(result.letterIssued, true);
  assert.equal(result.letterContentHash, letterDoc.contentHash);

  // The mutable rows moved, in the vocabulary src/metrics/compute.js counts.
  assert.equal(reviewRowFor(created.caseId).status, "approved");
  assert.equal(reviewRowFor(created.caseId).assignee, SPECIALIST);
  assert.equal(caseRowFor(created.caseId).status, "resolved");

  // THE AUDIT ROW, WHICH IS THE FIRST IN THIS PROJECT'S HISTORY THAT CAN SAY
  // `letterIssued: true` FOR UC-03. handleTravelInquiry() writes false on every
  // decision it makes, correctly — the automation never issues one.
  const signedRow = audit.forUseCase("UC-03").find((e) => e.action === "travel_letter_signed_off");
  assert.ok(signedRow, "the sign-off is in the audit log under its own action name");
  assert.equal(signedRow.actor, SPECIALIST);
  assert.equal(signedRow.details.letterIssued, true);
  assert.equal(signedRow.details.externalRef, "sign-1");
  // WHAT WAS SIGNED, not just that something was. A signature that does not
  // name its document is a signature on whatever the store holds later.
  assert.equal(signedRow.details.letterContentHash, letterDoc.contentHash);
  assert.equal(signedRow.details.letterDocumentId, letterDoc.id);
  // The AI's own recommendation beside the human's verdict, in one row — the
  // pairing that makes "did the specialist agree?" a measurement.
  assert.equal(signedRow.details.aiDecision, "human_review");
  assert.equal(signedRow.details.aiReason, "formal_letter_requested");

  // AND THE LETTER ACTUALLY REACHED THE EMPLOYEE. A sign-off that records a
  // signature and delivers nothing is the control existing without the effect.
  const delivery = zendeskCalls.filter((c) => c.kind === "resolveWithLetter");
  assert.equal(delivery.length, 1);
  assert.equal(delivery[0].ref, "sign-1");
  assert.equal(delivery[0].html, letterDoc.content, "the bytes that were signed are the bytes that were sent");
  assert.match(delivery[0].html, /Travel Letter/);
});

test("POSITIVE: declining records the refusal, changes the case, and issues nothing", async () => {
  const created = await createCase(REQUESTS.letter, { source: "zendesk", externalRef: "sign-2" });

  const result = await signoff(
    created.caseId,
    { action: "decline", note: "The conference dates do not match the invitation." },
    { zendesk }
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, "declined");
  assert.equal(result.letterIssued, false);
  assert.equal(reviewRowFor(created.caseId).status, "rejected");
  assert.equal(caseRowFor(created.caseId).status, "declined");

  const row = audit.forUseCase("UC-03").find((e) => e.action === "travel_letter_declined");
  assert.equal(row.details.letterIssued, false);
  assert.match(row.details.note, /do not match/);

  assert.equal(zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length, 0, "a declined letter is never sent");
  const note = zendeskCalls.find((c) => c.kind === "flagForReview");
  assert.deepEqual(note.payload.tags, ["uc03_letter_declined"]);
});

test("POSITIVE: `deny` is still accepted and normalised — the installed ZAF bundle keeps working", async () => {
  const created = await createCase(REQUESTS.letter, { externalRef: "sign-3" });
  const result = await signoff(created.caseId, { action: "deny", note: "Not supported." });
  assert.equal(result.ok, true);
  assert.equal(result.code, "declined");
  assert.equal(reviewRowFor(created.caseId).status, "rejected");
});

test("POSITIVE: an ENTITLED specialist can still sign when the roster is enforced", async () => {
  // THE TEST THAT DETECTS A DEAD GATE. A typo in the roster refuses everybody
  // and passes every refusal test in this file — "blocks everything" and
  // "correctly cautious" are indistinguishable without this one.
  const entitlement = createEntitlementChecker({ grants: `${SPECIALIST}=uc03:${UC03_ROLE}` });
  const created = await createCase(REQUESTS.letter, { externalRef: "sign-4" });

  const result = await signoff(created.caseId, { note: "Checked." }, { entitlement });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "signed_off");
  assert.equal(reviewRowFor(created.caseId).status, "approved");
});

test("an approver who is not on the roster is refused, and the letter is untouched", async () => {
  const entitlement = createEntitlementChecker({ grants: `someone.else@remote.test=uc03:${UC03_ROLE}` });
  const created = await createCase(REQUESTS.letter, { externalRef: "sign-5" });

  const result = await signoff(created.caseId, { note: "Checked." }, { entitlement });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "approver_not_entitled");
  assert.equal(reviewRowFor(created.caseId).status, "pending", "a refused sign-off leaves the queue entry alone");
  assert.ok(auditActions().includes("travel_letter_signoff_refused"), "the refused attempt is itself audited");
});

test("UC-03's role is declared in the shared vocabulary, not invented locally", async () => {
  // A role known to a policy and not to src/review/approverEntitlement.js is
  // refused for being unknown — a dead gate wearing a plausible reason. The
  // sidebar's role names and the operator's grant strings come from that one
  // table, so this is what stops them drifting apart.
  assert.deepEqual(USE_CASE_ROLES["UC-03"], [UC03_ROLE]);
});

// ---------------------------------------------------------------------------
// 2. THE NEGATIVE TWINS — outcomes that need no signature have NO control
// ---------------------------------------------------------------------------

test("route_to_uc04 has NO sign-off, and the refusal names the outreach that IS owed", async () => {
  // These are the rows docs/APPROVAL-QUEUE.md §0 actually measured as stuck:
  // every UC-03 `review_queue` row waiting on a person in production was
  // `route_to_uc04`. None of them is signable, and an approve button here would
  // be a 🟢 router minting a 🟡 work authorization by click.
  const created = await createCase(REQUESTS.routeToUc04, { externalRef: "route-1" });
  assert.equal(created.decision, "route_to_uc04");

  const result = await signoff(created.caseId, { note: "Looks fine to me." });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "no_signoff_path");
  assert.match(result.reason, /Request Hub/, "the refusal says what the human actually has to do");
  assert.match(result.reason, /nothing to sign/i);

  assert.equal(reviewRowFor(created.caseId).status, "pending", "nothing moved");
  assert.equal(caseRowFor(created.caseId).status, "routed");
  assert.ok(!auditActions().includes("travel_letter_signed_off"));
});

test("an auto-resolved inquiry has NO sign-off — there is no artifact and never was", async () => {
  const created = await createCase(REQUESTS.autoResolve, { externalRef: "auto-1" });
  assert.equal(created.decision, "auto_resolve");
  assert.equal(caseStore.reviewQueue.length, 0, "an auto-resolved case is in no queue at all");

  const result = await signoff(created.caseId, { note: "ok" });
  assert.equal(result.status, 403);
  assert.equal(result.code, "no_signoff_path");
  assert.match(result.reason, /no formal letter/);
});

test("an escalation is visible and never closable from here", async () => {
  const created = await createCase(REQUESTS.escalate, { externalRef: "esc-1" });
  assert.equal(created.decision, "escalate");

  const result = await signoff(created.caseId, { note: "Fine." });
  assert.equal(result.status, 403);
  assert.equal(result.code, "no_signoff_path");
  assert.match(result.reason, /ESCALATED/);
  assert.match(result.reason, /never\s+closed from a sidebar/);
  assert.equal(caseRowFor(created.caseId).status, "escalated");
});

test("a low-confidence human_review drafts NO letter, and refuses the signature by its own name", async () => {
  // THE DEFECT THIS FOUND, AND THE REASON THE REFUSAL IS A SEPARATE CODE.
  // `human_review` is reached three ways. Two of them mean the router did not
  // trust its own reading of the request — and workflow.js used to branch on
  // the DECISION, so all three drafted a formal Travel Letter on the legal
  // entity's letterhead carrying base compensation. Driven at 0.05 confidence
  // it produced a letter reading "business travel to null" beside a real
  // salary, for a request that never asked for a letter. That document is
  // exactly what a naive sign-off surface would have put a signature on.
  const lowConfidence = async () => ({
    intent: "business_travel",
    destinationCountry: null,
    startDate: null,
    endDate: null,
    formalLetterRequested: false,
    confidence: 0.05,
    source: "rule_based_fallback",
  });
  const created = await handleTravelInquiry(
    { text: "uhh, something about a trip maybe?", employmentId: "emp_active_001", session: EMPLOYEE_SESSION, externalRef: "lowconf-1" },
    { remote, audit, caseStore, classify: lowConfidence }
  );
  assert.equal(created.decision, "human_review");
  assert.equal(created.reason, "low_confidence");

  assert.equal(created.letterHtml, undefined, "no letter is drafted from an extraction the router refused to trust");
  assert.equal(
    caseStore.documents.filter((d) => d.type === "travel_support_letter").length,
    0,
    "and none is written to the document store either — refusing to ISSUE a bad document still leaves it written"
  );

  const result = await signoff(created.caseId, { note: "Sure." });
  assert.equal(result.status, 403);
  assert.equal(result.code, "classification_unconfirmed", "distinct from 'no letter in this request'");
  assert.match(result.reason, /reading of the request, not a signature/);
  assert.equal(reviewRowFor(created.caseId).status, "pending");
});

test("a letter case whose drafted document is missing refuses rather than issuing an unseen one", async () => {
  // Reachable for real: the n8n graph writes the case row and no document.
  const created = await createCase(REQUESTS.letter, { externalRef: "nodoc-1" });
  caseStore.documents = caseStore.documents.filter((d) => d.type !== "travel_support_letter");

  const result = await signoff(created.caseId, { note: "Fine." });
  assert.equal(result.status, 409);
  assert.equal(result.code, "letter_missing");
  assert.equal(reviewRowFor(created.caseId).status, "pending");
});

// ---------------------------------------------------------------------------
// 3. The refusals that hold on a signable case
// ---------------------------------------------------------------------------

test("a signed-off letter cannot be signed off twice, and the refusal says who decided it and when", async () => {
  const created = await createCase(REQUESTS.letter, { externalRef: "twice-1" });
  await signoff(created.caseId, { note: "First pass." });

  const second = await signoff(created.caseId, { approver: "other.specialist@remote.test", note: "Me too." });
  assert.equal(second.status, 409);
  assert.equal(second.code, "already_decided");
  assert.match(second.reason, /Already SIGNED OFF by travel\.specialist@remote\.test/);
  assert.match(second.reason, /First pass/, "the note the first decider left is part of the answer");
});

test("the employee a letter is about may not sign it off", async () => {
  const created = await createCase(REQUESTS.letter, { externalRef: "self-1" });
  const result = await signoff(created.caseId, { approver: "emp_active_001", note: "Approving my own." });
  assert.equal(result.status, 403);
  assert.equal(result.code, "self_signoff");
  assert.equal(reviewRowFor(created.caseId).status, "pending");
});

test("a decline must carry a reason; a sign-off need not", async () => {
  const a = await createCase(REQUESTS.letter, { externalRef: "reason-1" });
  const declined = await signoff(a.caseId, { action: "decline", note: "   " });
  assert.equal(declined.status, 400);
  assert.equal(declined.code, "reason_required");
  assert.equal(reviewRowFor(a.caseId).status, "pending");

  // The asymmetry is deliberate: the drafted letter IS the statement a sign-off
  // agrees with, and demanding prose beside it produces notes reading "ok".
  const b = await createCase(REQUESTS.letter, { externalRef: "reason-2" });
  const signed = await signoff(b.caseId, { note: "" });
  assert.equal(signed.ok, true);
});

test("an unauthenticated caller cannot sign, and the attempt is NOT written to the audit log", async () => {
  const created = await createCase(REQUESTS.letter, { externalRef: "anon-1" });
  const result = await signoff(created.caseId, { approver: "  " });
  assert.equal(result.status, 401);
  assert.equal(result.code, "approver_required");
  // An unattributed refusal must not be appendable to an append-only table by
  // anyone who can reach the endpoint — same rule as src/review/service.js.
  assert.deepEqual(auditActions().filter((a) => a.startsWith("travel_letter_")), []);
});

test("an unknown verb is refused by the policy, never rewritten into a valid one", async () => {
  const created = await createCase(REQUESTS.letter, { externalRef: "verb-1" });
  for (const action of ["approve", "constructor", "issue", ""]) {
    const result = await signoff(created.caseId, { action, note: "x" });
    assert.equal(result.code, "unknown_action", `"${action}" must not be accepted`);
  }
  assert.equal(reviewRowFor(created.caseId).status, "pending");
});

test("the letter is not issued if the employment is no longer active at sign-off time", async () => {
  // The gate asked "was this true?" when the ticket arrived. A travel letter
  // asserts to a destination authority that this person is employed TODAY.
  const created = await createCase(REQUESTS.letter, { externalRef: "stale-1" });
  const staleRemote = { getEmployment: async () => ({ id: "emp_active_001", status: "terminated" }) };

  const result = await signoff(created.caseId, { note: "Fine." }, { remote: staleRemote, zendesk });
  assert.equal(result.status, 409);
  assert.equal(result.code, "employment_no_longer_active");
  assert.equal(reviewRowFor(created.caseId).status, "pending");
  assert.equal(zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length, 0);
  const refused = audit.forUseCase("UC-03").find((e) => e.action === "travel_letter_signoff_refused");
  assert.equal(refused.details.observedStatus, "terminated");
});

test("a case belonging to another use case is not signable through UC-03's route", async () => {
  // `cases` is shared with UC-01, so an id alone proves nothing about ownership.
  // Reported as not found rather than refused: "that is not yours" is itself a
  // disclosure about a case the caller named blindly.
  const uc01Case = caseStore.createCase({
    useCase: "UC-01",
    source: "zendesk",
    externalRef: "foreign-1",
    employmentId: "emp_active_001",
    requester: "emp_active_001",
    classification: {},
    decision: "human_review",
    reason: "over_scope_request",
    flags: [],
    status: "pending_review",
  });
  caseStore.createReviewQueueEntry({ caseId: uc01Case.id });

  const result = await signoff(uc01Case.id, { note: "Fine." });
  assert.equal(result.status, 404);
  assert.equal(result.code, "case_not_found");
  assert.equal(reviewRowFor(uc01Case.id).status, "pending");
});

// ---------------------------------------------------------------------------
// 4. The API surface — the server answers `actionable`, the panel renders it
// ---------------------------------------------------------------------------

test("the by-ticket view says a drafted letter IS actionable, and a POST then signs it", async () => {
  const handler = createUc03Handler({ caseStore, audit, remote });
  const created = await createCase(REQUESTS.letter, { externalRef: "api-1" });

  const view = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/api-1" });
  assert.equal(view.status, 200);
  assert.equal(view.body.actionable, true);
  assert.match(view.body.actionableReason, /awaiting Travel & Mobility Support/);
  assert.equal(view.body.settled, null, "nothing is settled while the case is open");
  // The use case's own tier and this request's risk, named apart — the two
  // facts every other server sends.
  assert.equal(view.body.useCaseTier, "low");
  assert.equal(view.body.executionModel, "automatic");

  const posted = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + created.caseId + "/signoff",
    headers: { "x-zaf-approver": SPECIALIST },
    body: { note: "Verified against the invitation." },
  });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.code, "signed_off");
  assert.equal(posted.body.letterIssued, true);

  const after = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/api-1" });
  assert.equal(after.body.actionable, false);
  assert.equal(after.body.settled.headline, "Travel letter signed off and issued.");
  assert.ok(after.body.settled.facts.some((f) => f.label === "Signed off by" && f.value === SPECIALIST));
  assert.ok(after.body.settled.facts.some((f) => f.label === "Letter signed (sha256)"));
});

test("the by-ticket view says a route_to_uc04 case is NOT actionable, and the POST agrees", async () => {
  const handler = createUc03Handler({ caseStore, audit, remote });
  const created = await createCase(REQUESTS.routeToUc04, { externalRef: "api-2" });

  const view = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/api-2" });
  assert.equal(view.body.actionable, false);
  assert.match(view.body.actionableReason, /Request Hub/);

  // THE UI AND THE API MUST NOT DISAGREE. A control that appears and then 403s
  // is worse than one that never appears; a route that 200s on something the
  // view called unactionable is worse than both.
  const posted = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + created.caseId + "/signoff",
    headers: { "x-zaf-approver": SPECIALIST },
    body: { note: "Fine." },
  });
  assert.equal(posted.status, 403);
  assert.equal(posted.body.code, "no_signoff_path");
});

test("the view publishes `approvalRoles` in the shape the sidebar already reads", async () => {
  // docs/SIDEBAR-APPROVAL-ROLES.md §3. The sidebar's loaders pass this through
  // untouched and prefer it over the panel's own descriptor, so publishing it
  // needs no sidebar change.
  const handler = createUc03Handler({ caseStore, audit, remote });
  await createCase(REQUESTS.letter, { externalRef: "roles-1" });

  const view = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/roles-1" });
  const roles = view.body.approvalRoles;
  assert.match(roles.summary, /One named Travel & Mobility Support specialist/);
  assert.equal(roles.roles.length, 1, "one signature, not two — UC-03 is not a dual-control use case");
  const [slot] = roles.roles;
  assert.equal(slot.roleId, `uc03:${UC03_ROLE}`, "the exact grant string an operator quotes");
  assert.equal(slot.label, "Travel & Mobility Support specialist");
  assert.equal(slot.filledBy, null);
  assert.equal(slot.filledAs, null);
  // `null`, NOT `false` and certainly not `true`: nothing checked entitlement in
  // this posture, and "not enforced here" is not "you hold this role".
  assert.equal(slot.youHold, null);
});

test("GET /api/cases/:id will not render another use case's case through UC-03's ladder", async () => {
  const handler = createUc03Handler({ caseStore, audit, remote });
  const uc01Case = caseStore.createCase({
    useCase: "UC-01",
    source: "zendesk",
    externalRef: "foreign-2",
    employmentId: "emp_active_001",
    requester: "emp_active_001",
    classification: {},
    decision: "human_review",
    reason: "over_scope_request",
    flags: [],
    status: "pending_review",
  });

  const res = await callApi(handler, { method: "GET", path: "/api/cases/" + uc01Case.id });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

// ---------------------------------------------------------------------------
// 5. The pure gate, asked directly
// ---------------------------------------------------------------------------

test("evaluateLetterActionability admits ONE decision+reason pair and refuses everything else by name", async () => {
  const reviewRow = { status: "pending" };
  const letter = { id: "d1", type: "travel_support_letter", contentHash: "abc" };

  const ok = evaluateLetterActionability({
    caseRow: { decision: "human_review", reason: "formal_letter_requested" },
    reviewRow,
    letterDocument: letter,
  });
  assert.equal(ok.allowed, true);

  // A NEW UC-03 OUTCOME IS REFUSED BY DEFAULT, not admitted by default. This is
  // the structural property that replaces a (here unreachable) high-tier
  // backstop: the signable decision is named, never inferred.
  for (const caseRow of [
    { decision: "auto_resolve", reason: "all_gates_passed" },
    { decision: "escalate", reason: "sanctioned_region" },
    { decision: "route_to_uc04", reason: "work_authorization_requested" },
    { decision: "some_future_outcome", reason: "whatever" },
  ]) {
    const verdict = evaluateLetterActionability({ caseRow, reviewRow, letterDocument: letter });
    assert.equal(verdict.allowed, false, `${caseRow.decision} must not be actionable`);
    assert.equal(verdict.code, "no_signoff_path");
  }

  for (const reason of ["low_confidence", "confidence_unknown", "something_else"]) {
    const verdict = evaluateLetterActionability({
      caseRow: { decision: "human_review", reason },
      reviewRow,
      letterDocument: letter,
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.code, "classification_unconfirmed");
  }
});
