// ---------------------------------------------------------------------------
// uc03LetterOffer.test.js  —  the answer that offers the letter, and the line
//                             the offer is not allowed to cross
// ---------------------------------------------------------------------------
// WHY THE HEADLINE TEST IS A POSITIVE ONE, AGAIN
//
// Production held three `travel_informational_response` documents and ZERO
// `travel_support_letter` documents: nobody had ever got a letter out of this
// system, and the chain answer -> letter -> signature -> issued document had
// never run end to end anywhere. This repository's most expensive recurring
// defect is that a path which structurally cannot succeed looks exactly like
// one being appropriately cautious, and only a test that MUST SUCCEED tells
// them apart. So the first test here walks the whole chain and asserts the
// document hash that comes out of it.
//
// Beside it, the line that must not move: an accepted offer produces a DRAFT
// and a queue entry, never an issued letter. Every negative here is about that
// line, or about the two ways an offer could be reached from a reading nobody
// trusted.
//
// Hermetic: the real Remote mock server on a registered test port, the real
// workflow, the real gates, the rule-based classifier, in-memory audit/case
// stores, and a Zendesk double that records rather than calls.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import {
  acceptTravelLetterOffer,
  handleTravelInquiry,
  submitTravelLetterSignoff,
} from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { createUc03Handler } from "../src/uc03/server.js";
import { describeLetterOffer, evaluateLetterOffer, letterClaimRef, OFFER_ACCEPTED } from "../src/uc03/letterOffer.js";

const TEST_PORT = 4115; // test band — registered in src/shared/ports.js's TEST_PORTS

const EMPLOYEE = "emp_active_001";
const EMPLOYEE_SESSION = { authenticatedEmploymentId: EMPLOYEE };
const SPECIALIST = "travel.specialist@remote.test";

/** The request the project owner actually typed, near enough. */
const INQUIRY =
  "I'm travelling to Spain for a client meeting from 2026-09-14 to 2026-10-02, can you confirm business travel is fine?";

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

/** A real inquiry through the real workflow — never a hand-built row. */
function ask(text, overrides = {}, deps = {}) {
  return handleTravelInquiry(
    { text, employmentId: EMPLOYEE, session: EMPLOYEE_SESSION, ...overrides },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased, ...deps }
  );
}

const accept = (caseId, args = {}, deps = {}) =>
  acceptTravelLetterOffer({ caseId, session: EMPLOYEE_SESSION, ...args }, { remote, audit, caseStore, ...deps });

const caseRowFor = (id) => caseStore.cases.find((c) => c.id === id) ?? null;
const reviewRowFor = (id) => caseStore.reviewQueue.find((r) => r.caseId === id) ?? null;
const docsFor = (id) => caseStore.documents.filter((d) => d.caseId === id);
const auditActions = () => audit.forUseCase("UC-03").map((e) => e.action);

/** Drive the real HTTP handler with no listening socket (same double as uc03Signoff.test.js). */
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
// 1. THE CHAIN THAT HAD NEVER RUN
// ---------------------------------------------------------------------------

// THE HEADLINE MOVED FROM "…and a signature issues it" TO "…and it is ISSUED".
// Every assertion this test used to make about a signature was true when it was
// written: nothing in this repository could issue a UC-03 letter without one.
// The project owner drew the line differently (docs/use-cases/UC-03.md §23), so
// what the accept now produces is the finished document. The signature half of
// the old chain is not deleted — it is re-asserted, in this same file, under the
// posture that still requires it.
test("POSITIVE: an answered inquiry offers the letter, and accepting ISSUES it with no signature", async () => {
  // --- the answer, with the offer on it -----------------------------------
  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "offer-1" }, { zendesk });
  assert.equal(answered.decision, "auto_resolve");
  assert.equal(answered.reason, "all_gates_passed");
  assert.equal(answered.letterOffer.offered, true, "an answered inquiry carries the offer");
  assert.equal(answered.letterOffer.requiresSignoff, false, "and says BEFORE the click that no signature is needed");
  // WHAT THE LETTER WILL CONTAIN, NAMED BEFORE THE CLICK — including the row a
  // person is most likely to object to. With nobody in the path this is the only
  // place the employee is told, and `letterScope.js`'s `omission_requested`
  // marker only fires on an ask nobody makes about a row they never saw.
  //
  // NAMED, NOT PROMISED, and the change is deliberate: the letter states an
  // ANNUAL GROSS SALARY, which Remote holds for an EOR employment and does not
  // hold for a contractor (whose record carries a per-period rate of
  // unestablished ×100 scale). The old wording promised the row flatly to
  // everyone, including everyone whose document could never carry it.
  // test/uc03LetterCompensation.test.js pins both halves.
  assert.match(answered.letterOffer.produces, /annual gross salary/i);
  assert.match(answered.letterOffer.produces, /\b(if|where)\b/i);

  // THE FACTS THE OFFER CARRIES ARE THE FACTS THE EMPLOYEE WAS SHOWN. This is
  // what makes accepting it something other than agreeing to an unseen letter.
  assert.equal(answered.letterOffer.carries.destinationCountry, "ES");
  assert.equal(answered.letterOffer.carries.startDate, "2026-09-14");
  assert.equal(answered.letterOffer.carries.endDate, "2026-10-02");
  assert.match(answered.informationalAnswer, /without describing the trip again/);
  assert.equal(docsFor(answered.caseId)[0].type, "travel_informational_response");

  // --- accepting it: one click, no retyping, no re-classification ----------
  const accepted = await accept(answered.caseId, {}, { zendesk });
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(accepted.code, "letter_issued");
  assert.equal(accepted.decision, "auto_resolve");
  assert.equal(accepted.decisionReason, "standard_letter_issued");
  assert.equal(accepted.letterIssued, true);
  assert.equal(accepted.awaitingSignoff, false, "nobody is waiting — the document is already the employee's");
  assert.notEqual(accepted.caseId, answered.caseId, "a second decision is a second case");
  // WHERE THE EMPLOYEE FETCHES IT, stated by the producer so no surface guesses.
  assert.deepEqual(accepted.letter, { method: "POST", path: `/api/cases/${accepted.caseId}/letter` });

  const letterCase = caseRowFor(accepted.caseId);
  assert.equal(letterCase.status, "resolved");
  assert.equal(letterCase.externalRef, "offer-1", "the ticket id follows the conversation, not the claim");
  assert.equal(reviewRowFor(letterCase.id), null, "no queue row: there is nothing for anyone to decide");

  // THE CLASSIFICATION WAS CARRIED, NOT RE-READ — and the field a PERSON set is
  // marked as such, so a reviewer never mistakes a button for a model.
  assert.equal(letterCase.classification.destinationCountry, "ES");
  assert.equal(letterCase.classification.startDate, "2026-09-14");
  assert.equal(letterCase.classification.formalLetterRequested, true);
  assert.equal(letterCase.classification.formalLetterRequestedVia, OFFER_ACCEPTED);

  const letter = docsFor(letterCase.id).find((d) => d.type === "travel_support_letter");
  assert.ok(letter, "the letter exists");
  assert.match(letter.content, /Travel Letter/);
  assert.match(letter.content, /Spain/);
  // The formal letter is the one UC-03 artifact that carries pay, and the mock
  // employee's is 5,000,000 ×100 — proof the letterhead read really happened.
  assert.match(letter.content, /Remote Nigeria EOR Ltd/);
  // The label is `Annual gross salary`, not `Base compensation`: the row states
  // an annual figure and now says so, because the other field Remote holds is a
  // contractor's per-period rate. See src/uc03/letter.js's readAnnualGrossSalary().
  assert.match(letter.content, /Annual gross salary/);

  // …AND IT REALLY WENT OUT. This assertion is the exact inverse of the one it
  // replaces, which read "accepting an offer never delivers a letter" and
  // asserted ZERO deliveries. Both are load-bearing in their own posture, which
  // is why the old one is re-asserted below rather than deleted.
  const delivery = zendeskCalls.filter((c) => c.kind === "resolveWithLetter");
  assert.equal(delivery.length, 1, "issued exactly once, by the gate");
  assert.equal(delivery[0].ref, "offer-1");
  assert.equal(delivery[0].html, letter.content, "the bytes recorded are the bytes that were sent");

  const decisionRow = audit.forUseCase("UC-03").find((e) => e.details.caseId === letterCase.id);
  assert.equal(decisionRow.details.letterIssued, true);
  assert.equal(decisionRow.details.letterDrafted, true);
  assert.equal(decisionRow.details.letterContentHash, letter.contentHash);
  assert.equal(decisionRow.details.autoIssue.issuedWithoutSignature, true);
  assert.equal(decisionRow.details.offerAcceptedFrom, answered.caseId, "the two decisions join from history alone");
  assert.ok(!auditActions().includes("travel_letter_signed_off"), "nobody signed anything");
});

// THE OTHER POSTURE, ON THE SAME CHAIN. `letterAutoIssue: false` is what a
// deployment sets to require a signature on every travel letter, and it restores
// the accept → draft → signature → issue chain exactly as it was. Kept as a real
// test rather than a sentence in a doc, because a posture nothing exercises is a
// posture nobody can be told works.
test("POSITIVE: with signatures required, accepting drafts the letter and a signature issues it", async () => {
  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "offer-1b" }, { zendesk });
  const accepted = await accept(answered.caseId, {}, { zendesk, letterAutoIssue: false });

  assert.equal(accepted.code, "letter_drafted");
  assert.equal(accepted.decision, "human_review");
  assert.equal(accepted.decisionReason, "formal_letter_requested");
  assert.equal(accepted.awaitingSignoff, true);
  assert.equal(accepted.letterIssued, false);

  const letterCase = caseRowFor(accepted.caseId);
  assert.equal(letterCase.status, "pending_review");
  assert.equal(reviewRowFor(letterCase.id).status, "pending", "somebody is now waiting on a signature");
  const draft = docsFor(letterCase.id).find((d) => d.type === "travel_support_letter");
  assert.ok(draft, "the letter is drafted");

  assert.equal(
    zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length,
    0,
    "on this posture, accepting an offer never delivers a letter"
  );
  const decisionRow = audit.forUseCase("UC-03").find((e) => e.details.caseId === letterCase.id);
  assert.equal(decisionRow.details.letterIssued, false);
  assert.equal(decisionRow.details.letterDrafted, true);

  const signed = await submitTravelLetterSignoff(
    { caseId: letterCase.id, action: "signoff", approver: SPECIALIST, note: "Dates and destination check out." },
    { remote, audit, caseStore, zendesk }
  );
  assert.equal(signed.ok, true, signed.reason);
  assert.equal(signed.code, "signed_off");
  assert.equal(signed.letterIssued, true);
  assert.equal(signed.letterContentHash, draft.contentHash);
  assert.equal(reviewRowFor(letterCase.id).status, "approved");
  assert.equal(caseRowFor(letterCase.id).status, "resolved");

  const delivery = zendeskCalls.filter((c) => c.kind === "resolveWithLetter");
  assert.equal(delivery.length, 1, "issued exactly once, by the signature");
  assert.equal(delivery[0].html, draft.content, "the bytes that were signed are the bytes that were sent");
});

test("POSITIVE: the offer survives the process — it is answered from the stored row over HTTP", async () => {
  // The employee finds out they need the letter days later, from a different
  // process holding nothing but a ticket id. If the offer only existed in the
  // workflow's return value it would be gone by then.
  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "offer-2" });
  const handler = createUc03Handler({ caseStore, audit, remote, zendesk });

  const view = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/offer-2" });
  assert.equal(view.status, 200);
  assert.equal(view.body.letterOffer.offered, true);
  assert.equal(view.body.letterOffer.accept.path, `/api/cases/${answered.caseId}/request-letter`);
  assert.equal(view.body.actionable, false, "the SPECIALIST still has nothing to do here — different person");

  const posted = await callApi(handler, {
    method: "POST",
    path: view.body.letterOffer.accept.path,
    body: { session: EMPLOYEE_SESSION },
  });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.code, "letter_issued");
  assert.equal(posted.body.awaitingSignoff, false);

  // And the same ticket now reads as the issued letter, with the offer spent.
  const after = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/offer-2" });
  assert.equal(after.body.caseRow.reason, "standard_letter_issued");
  // THIS ASSERTION FLIPPED, and the flip is the point: it read `actionable,
  // true, "NOW there is a signature to collect"`. There is no signature to
  // collect any more, and `actionable` is the SPECIALIST's question — so `false`
  // here is the correct answer to "is a human owed something?", not a missing
  // control. The employee's own question is answered one field over.
  assert.equal(after.body.actionable, false, "nobody is owed a decision — the letter has gone");
  assert.match(after.body.actionableReason, /ALREADY BEEN ISSUED/);
  assert.equal(after.body.letterOffer.offered, false);
  assert.match(after.body.letterOffer.reason, /IS the letter request/);
  assert.match(after.body.letterOffer.reason, /already been\s+written and issued/);

  // WHERE THE TRAVELLER COLLECTS IT, from the stored row, days later, in a
  // different process — which is the whole premise of this test.
  assert.equal(after.body.letter.issued, true);
  assert.equal(after.body.letter.issuedWithoutSignature, true);
  assert.equal(after.body.letter.collect.path, `/api/cases/${posted.body.caseId}/letter`);
  assert.ok(after.body.letter.contentHash, "the hash travels on the view; the bytes deliberately do not");
});

// THIS TEST'S SUBJECT SPLIT IN TWO, because the answer to "should the ticket go
// back in front of a human?" now depends on whether a human is owed anything.
// The old single assertion — always reopen — would now reopen a conversation
// that was finished by delivering the document into it.
test("an ISSUED letter leaves the ticket closed, with the document in the conversation", async () => {
  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "offer-3" }, { zendesk });
  assert.equal(zendeskCalls.at(-1).payload.status, "solved", "the informational answer solved the ticket");

  await accept(answered.caseId, {}, { zendesk });

  const delivered = zendeskCalls.filter((c) => c.kind === "resolveWithLetter");
  assert.equal(delivered.length, 1, "the letter is posted to the ticket the conversation lives on");
  const reopened = zendeskCalls.filter((c) => c.kind === "updateTicket" && c.payload.status === "open");
  assert.equal(reopened.length, 0, "nothing is owed, so nothing is reopened");
});

test("a letter waiting on a signature DOES put the ticket back in front of a human", async () => {
  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "offer-3b" }, { zendesk });
  assert.equal(zendeskCalls.at(-1).payload.status, "solved", "the informational answer solved the ticket");

  await accept(answered.caseId, {}, { zendesk, letterAutoIssue: false });

  const note = zendeskCalls.find((c) => c.kind === "flagForReview");
  assert.deepEqual(note.payload.tags, ["uc03_formal_letter_review"]);
  assert.match(note.payload.note, /drafted but NOT issued/);
  const reopened = zendeskCalls.filter((c) => c.kind === "updateTicket" && c.payload.status === "open");
  assert.equal(reopened.length, 1, "a letter waiting on a signature does not sit inside a solved conversation");
});

// ---------------------------------------------------------------------------
// 2. THE OFFER IS NOT THE LETTER
// ---------------------------------------------------------------------------

// THE TITLE AND THE BEHAVIOURAL HALF MOVED; THE STRUCTURAL HALF DID NOT, AND IT
// IS THE HALF THAT MATTERED. This was "an accepted offer can NEVER issue a
// letter without a signature", and it asserted a drafted-and-waiting letter plus
// a source scrape proving `letterOffer.js` names no delivery primitive. The
// first half is now false by decision (docs/use-cases/UC-03.md §23) and is
// re-asserted, inverted, in the positive chain above. The second half is
// unchanged and still load-bearing: the OFFER module renders nothing and
// delivers nothing, so the decision about issuing lives in exactly one place —
// the gate — and cannot grow a second home here.
test("the offer module itself still renders nothing and delivers nothing", async () => {
  const answered = await ask(INQUIRY, { externalRef: "noissue-1" }, { zendesk });
  const accepted = await accept(answered.caseId, {}, { zendesk, letterAutoIssue: false });

  assert.equal(accepted.letterDrafted, true);
  assert.equal(reviewRowFor(accepted.caseId).status, "pending");
  assert.equal(caseRowFor(accepted.caseId).status, "pending_review");
  assert.ok(!auditActions().includes("travel_letter_signed_off"), "no signature was recorded");
  assert.equal(
    audit.forUseCase("UC-03").every((e) => e.details.letterIssued !== true),
    true,
    "not one row in this history says a letter was issued"
  );

  // STRUCTURAL, not just behavioural: the acceptance path holds no reference to
  // the primitive that delivers a letter, so it cannot grow one by accident.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/uc03/letterOffer.js", import.meta.url), "utf8").replace(
    /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    ""
  );
  assert.ok(!source.includes("resolveWithLetter"), "the offer module names no delivery primitive");
  assert.ok(!source.includes("renderTravelLetterHtml"), "and it renders nothing");
});

test("the trip is re-decided on acceptance, not copied forward — a terminated employee gets no letter", async () => {
  // A letter certifies employment AS AT THE DAY IT IS WRITTEN. The answer may be
  // a week old; the record is read again and every gate runs again.
  const answered = await ask(INQUIRY, { externalRef: "stale-1" });
  assert.equal(answered.decision, "auto_resolve");

  const terminatedRemote = {
    getEmployment: async (id) => ({ ...(await remote.getEmployment(id)), status: "terminated" }),
    listCountries: (...args) => remote.listCountries(...args),
    getLegalEntity: (...args) => remote.getLegalEntity(...args),
  };
  const accepted = await acceptTravelLetterOffer(
    { caseId: answered.caseId, session: EMPLOYEE_SESSION },
    { remote: terminatedRemote, audit, caseStore }
  );

  assert.equal(accepted.ok, true, "the request is still recorded — it is the outcome that changed");
  assert.equal(accepted.code, "conditions_changed");
  assert.equal(accepted.decision, "escalate");
  assert.equal(accepted.decisionReason, "employee_not_active");
  assert.equal(accepted.letterDrafted, false);
  assert.equal(docsFor(accepted.caseId).length, 0, "nothing was drafted from a record that no longer supports it");
});

test("an unreadable letterhead drafts NOTHING, and says so instead of shipping a blank one", async () => {
  // The letter's DATA needs are a superset of the answer's: it goes out on the
  // employing entity's letterhead, which the auto path never reads. A null
  // legal entity used to reach `renderTravelLetterHtml()` and take the whole
  // run down with it — losing a decision that had already been made.
  const answered = await ask(INQUIRY, { externalRef: "letterhead-1" });
  const noEntity = {
    getEmployment: (...args) => remote.getEmployment(...args),
    listCountries: (...args) => remote.listCountries(...args),
    getLegalEntity: async () => null,
  };

  const accepted = await acceptTravelLetterOffer(
    { caseId: answered.caseId, session: EMPLOYEE_SESSION },
    { remote: noEntity, audit, caseStore }
  );

  assert.equal(accepted.ok, true);
  assert.equal(accepted.code, "letter_not_drafted");
  assert.equal(accepted.decision, "human_review");
  assert.equal(accepted.decisionReason, "formal_letter_requested", "the GATES still passed — the letterhead did not");
  assert.equal(accepted.letterDrafted, false);
  assert.equal(docsFor(accepted.caseId).length, 0, "no letter with a blank letterhead exists anywhere");

  // The specialist is told before they go looking for a document.
  assert.match(reviewRowFor(accepted.caseId).notes, /NO LETTER WAS DRAFTED/);
  assert.match(reviewRowFor(accepted.caseId).notes, /letterhead, not the permission/);
  const row = audit.forUseCase("UC-03").find((e) => e.details.caseId === accepted.caseId);
  assert.equal(row.details.letterDrafted, false);
  assert.equal(row.details.letterDraftBlocked.code, "letterhead_unavailable");

  // And the sign-off refuses it by the name it was written for, rather than
  // issuing an unseen document.
  const signed = await submitTravelLetterSignoff(
    { caseId: accepted.caseId, action: "signoff", approver: SPECIALIST },
    { remote: noEntity, audit, caseStore }
  );
  assert.equal(signed.ok, false);
  assert.equal(signed.code, "letter_missing");
});

// ---------------------------------------------------------------------------
// 3. WHO MAY ACCEPT, AND WHAT MAY BE ACCEPTED
// ---------------------------------------------------------------------------

test("a low-confidence case has no offer to accept, on both of the two guards", async () => {
  // GUARD 1 — the offer is only ever made on `auto_resolve / all_gates_passed`,
  // which sits below the confidence gate. A distrusted reading never gets one.
  const lowConfidence = async () => ({
    intent: "business_travel",
    destinationCountry: null,
    startDate: null,
    endDate: null,
    formalLetterRequested: false,
    confidence: 0.05,
    source: "rule_based_fallback",
  });
  const vague = await handleTravelInquiry(
    { text: "uhh, something about a trip maybe?", employmentId: EMPLOYEE, session: EMPLOYEE_SESSION, externalRef: "vague-1" },
    { remote, audit, caseStore, classify: lowConfidence }
  );
  assert.equal(vague.reason, "low_confidence");
  assert.equal(vague.letterOffer, null, "a human_review decision carries no offer at all");

  const accepted = await accept(vague.caseId);
  assert.equal(accepted.ok, false);
  assert.equal(accepted.status, 409);
  assert.equal(accepted.code, "no_offer_on_this_case");
  assert.match(accepted.reason, /could not trust its reading/);
  assert.equal(caseStore.documents.length, 0, "nothing was drafted, and nothing new was recorded");

  // GUARD 2 — even a forged auto-resolve row carrying a distrusted reading
  // cannot produce a letter: the confidence figure travels with the carried
  // classification, so the confidence gate decides again on the same number.
  const forged = caseStore.createCase({
    useCase: "UC-03",
    source: "zendesk",
    externalRef: "vague-2",
    employmentId: EMPLOYEE,
    requester: EMPLOYEE,
    classification: await lowConfidence(),
    ticketText: "uhh, something about a trip maybe?",
    decision: "auto_resolve",
    reason: "all_gates_passed",
    flags: [],
    status: "resolved",
  });
  const forgedAccept = await accept(forged.id);
  assert.equal(forgedAccept.ok, true, "it is recorded — as the refusal it is");
  assert.equal(forgedAccept.code, "conditions_changed");
  assert.equal(forgedAccept.decisionReason, "low_confidence");
  assert.equal(forgedAccept.letterDrafted, false);
  assert.equal(
    caseStore.documents.filter((d) => d.type === "travel_support_letter").length,
    0,
    "no letter exists anywhere in this store"
  );
});

test("a case that never auto-resolved cannot accept an offer it was never made", async () => {
  const routed = await ask(
    "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    { externalRef: "route-9" }
  );
  assert.equal(routed.decision, "route_to_uc04");
  assert.equal(routed.letterOffer, null);

  const accepted = await accept(routed.caseId);
  assert.equal(accepted.ok, false);
  assert.equal(accepted.code, "no_offer_on_this_case");
  assert.match(accepted.reason, /work-authorisation question/);
  assert.match(accepted.reason, /Request Hub/);

  // The escalated twin, which is the one a naive offer would have been worst on.
  const escalated = await ask("Can you confirm business travel to Russia from 2026-09-20 to 2026-09-26 is fine?", {
    externalRef: "esc-9",
  });
  assert.equal(escalated.decision, "escalate");
  const second = await accept(escalated.caseId);
  assert.equal(second.code, "no_offer_on_this_case");
  assert.match(second.reason, /not yet been able to confirm/);
});

test("only the traveller may accept, and an unauthenticated accept is refused before the case is even read", async () => {
  const answered = await ask(INQUIRY, { externalRef: "who-1" });

  const anonymous = await acceptTravelLetterOffer({ caseId: answered.caseId }, { remote, audit, caseStore });
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.code, "session_required");

  const someoneElse = await acceptTravelLetterOffer(
    { caseId: answered.caseId, session: { authenticatedEmploymentId: "emp_other_999" } },
    { remote, audit, caseStore }
  );
  assert.equal(someoneElse.ok, false);
  assert.equal(someoneElse.status, 403);
  assert.equal(someoneElse.code, "not_the_traveller");

  assert.equal(caseStore.cases.length, 1, "neither attempt wrote a case");
  assert.ok(auditActions().includes("travel_letter_offer_refused"), "the attributable refusal IS recorded");

  // A case id belonging to another use case is not found here, rather than
  // refused — "that is not yours" is itself a disclosure.
  const foreign = caseStore.createCase({
    useCase: "UC-01",
    employmentId: EMPLOYEE,
    decision: "auto_resolve",
    reason: "all_gates_passed",
    status: "resolved",
  });
  const wrongUseCase = await accept(foreign.id);
  assert.equal(wrongUseCase.status, 404);
  assert.equal(wrongUseCase.code, "case_not_found");
});

test("accepting twice produces one letter — the claim key is the trip's, not the ticket's", async () => {
  // The informational answer already claimed the ticket. `<ref>#letter` is a
  // different delivery of a different request, so the letter is recordable at
  // all — and a second accept is refused by the same primary key that protects
  // every other duplicate delivery.
  assert.equal(letterClaimRef({ externalRef: "twice-1" }), "twice-1#letter");
  assert.equal(letterClaimRef({ externalRef: null }), null);

  const claims = new Set();
  caseStore.pgPool = {
    query: async (sql, params) => {
      if (!sql.includes("workflow_claims")) return { rows: [], rowCount: 0 };
      const key = `${params[0]}|${params[1]}`;
      if (claims.has(key)) return { rows: [], rowCount: 0 };
      claims.add(key);
      return { rows: [{ external_ref: params[1] }], rowCount: 1 };
    },
  };

  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "twice-1" });
  assert.ok(claims.has("UC-03|twice-1"), "the answer claimed the ticket");

  const first = await accept(answered.caseId);
  assert.equal(first.code, "letter_issued", "the letter is NOT refused as a duplicate of the answer");
  assert.ok(claims.has("UC-03|twice-1#letter"), "it claimed the trip's letter, under its own key");

  const second = await accept(answered.caseId);
  assert.equal(second.ok, false);
  assert.equal(second.status, 409);
  assert.equal(second.code, "offer_already_accepted");
  assert.equal(
    caseStore.documents.filter((d) => d.type === "travel_support_letter").length,
    1,
    "one accepted offer, one letter"
  );
  caseStore.pgPool = null;
});

test("two simultaneous accepts are separated by the LEDGER, not by the lookup", async () => {
  // The check above refused the second accept from the stored follow-on case,
  // which is a DISPLAY answer: two clicks arriving together both read "not yet
  // accepted" and both pass it. What actually holds is `workflow_claims`'
  // primary key — the same guarantee, and the same reasoning, as ticket #5's
  // two audit rows 30µs apart. Driven concurrently so the lookup cannot be the
  // thing that saves it.
  const claims = new Set();
  caseStore.pgPool = {
    query: async (sql, params) => {
      if (!sql.includes("workflow_claims")) return { rows: [], rowCount: 0 };
      const key = `${params[0]}|${params[1]}`;
      if (claims.has(key)) return { rows: [], rowCount: 0 };
      claims.add(key);
      return { rows: [{ external_ref: params[1] }], rowCount: 1 };
    },
  };

  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "race-1" });
  const [a, b] = await Promise.all([accept(answered.caseId), accept(answered.caseId)]);

  const outcomes = [a, b].map((r) => r.code).sort();
  assert.deepEqual(outcomes, ["letter_issued", "offer_already_accepted"]);
  const refused = [a, b].find((r) => !r.ok);
  assert.match(refused.reason, /exactly-once ledger/, "the refusal names the mechanism that actually refused it");
  assert.equal(
    caseStore.documents.filter((d) => d.type === "travel_support_letter").length,
    1,
    "one letter, from two simultaneous clicks"
  );
  assert.equal(
    caseStore.cases.filter((c) => c.reason === "standard_letter_issued").length,
    1,
    "and one decision, not two"
  );
  caseStore.pgPool = null;
});

test("an offer already taken says which case it became, rather than inviting a second click", async () => {
  const answered = await ask(INQUIRY, { source: "zendesk", externalRef: "taken-1" });
  const accepted = await accept(answered.caseId);

  const followOnCase = await caseStore.findByExternalRef("taken-1", "UC-03");
  const offer = describeLetterOffer({ caseRow: caseRowFor(answered.caseId), followOnCase });
  assert.equal(offer.offered, false);
  assert.equal(offer.code, "offer_already_accepted");
  assert.match(offer.reason, new RegExp(accepted.caseId));
});

test("a case with no stored reading refuses rather than building a letter out of an empty object", async () => {
  // Reachable for real: a case written by the n8n graph and read back here by an
  // API process that never saw the run. Carrying nothing forward would mean
  // certifying a trip from facts nobody has.
  const row = caseStore.createCase({
    useCase: "UC-03",
    externalRef: "nocls-1",
    employmentId: EMPLOYEE,
    requester: EMPLOYEE,
    classification: null,
    decision: "auto_resolve",
    reason: "all_gates_passed",
    status: "resolved",
  });
  const accepted = await accept(row.id);
  assert.equal(accepted.ok, false);
  assert.equal(accepted.code, "classification_not_recorded");
  assert.match(accepted.reason, /fresh request/);
});

test("the pure gate decides nothing about identity when nobody is asking — a viewer is not an acceptor", async () => {
  // `describeLetterOffer()` is called by the read routes to RENDER the offer,
  // with no session in hand. It must not refuse for want of one, and it must
  // not thereby become the thing that authorises an acceptance either.
  const caseRow = {
    id: "c1",
    useCase: "UC-03",
    decision: "auto_resolve",
    reason: "all_gates_passed",
    employmentId: EMPLOYEE,
    classification: { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-10-02", confidence: 0.9 },
  };
  assert.equal(evaluateLetterOffer({ caseRow }).allowed, true);
  assert.equal(evaluateLetterOffer({ caseRow, session: { authenticatedEmploymentId: "someone_else" } }).code, "not_the_traveller");
});
