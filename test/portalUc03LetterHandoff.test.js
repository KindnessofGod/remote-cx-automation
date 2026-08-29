// ---------------------------------------------------------------------------
// portalUc03LetterHandoff.test.js  —  the accepted letter reaching a specialist
// ---------------------------------------------------------------------------
// THE DEFECT, IN THE PROJECT OWNER'S OWN WORDS
//
//   "I went to Zendesk as the specialist, and I did not see anywhere to approve
//    the letter to be sent to that individual."
//
// They accepted a travel-letter offer on the portal. The letter drafted
// correctly. Then nobody could sign it. Measured against production:
//
//   c2df9893…  UC-03  human_review  formal_letter_requested  pending_review
//              external_ref = "uc03-20260820095458-18k04"   ← a PORTAL reference
//
// The accept route called `acceptTravelLetterOffer()` and returned. It never
// reached `raiseTicketIfNeeded()`, so no Zendesk ticket existed — and the ZAF
// sidebar finds a case BY TICKET ID. The specialist was not missing a button.
// They were missing the whole case.
//
// WHY THE HEADLINE TESTS HERE ARE THE POSITIVE ONES. This repository's most
// expensive recurring defect is that a path which STRUCTURALLY CANNOT SUCCEED
// is indistinguishable, from outside, from one being appropriately cautious
// (CLAUDE.md §4/§5). Every refusal below already passed before this change: an
// unauthenticated accept wrote nothing, a second accept was refused, a
// non-traveller was turned away. What nothing asserted was that an accepted
// letter ever reaches anybody. So the load-bearing tests are the chain —
//
//     answer → accept → a ticket exists, tagged and assigned to
//     Travel & Mobility Support → the sidebar's by-ticket lookup finds the
//     LETTER case → an entitled specialist signs → `letterIssued: true` with
//     the document's own hash on the audit row
//
// — and each refusal is asserted to raise NO ticket, because a hand-off on a
// decision that was never made is a duplicate arriving in a real support queue.
//
// Hermetic: the real Remote mock on a registered test port, the rule-based
// classifier, in-memory stores, and a Zendesk double that records rather than
// calls. Nothing here reaches OpenAI or a network.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { PERSONAS } from "../src/portal/personas.js";
import { MARKER_TAG, letterTicketPlan } from "../src/portal/ticketing.js";
import { createUc03Handler } from "../src/uc03/server.js";
import { submitTravelLetterSignoff } from "../src/uc03/workflow.js";
import { createEntitlementChecker, UC03_ROLE } from "../src/review/approverEntitlement.js";
import { groupIdFor } from "../src/shared/escalationGroupIds.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const REMOTE_PORT = 4120; // registered in src/shared/ports.js TEST_PORTS

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

const SPECIALIST = "travel.specialist@remote.test";
/** A trip that clears every gate, so the answer carries an offer. */
const TRIP_TEXT =
  "I am travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?";

let remote;
let remoteServer;
let audit;
let stores;

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});
after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

beforeEach(() => {
  audit = new AuditLogger();
  stores = {
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
});

/** A Zendesk double that records what it was asked to create and to update. */
function fakeZendesk() {
  let next = 700;
  const created = [];
  const updated = [];
  return {
    created,
    updated,
    async createTicket(payload) {
      next += 1;
      created.push(payload);
      return { id: next };
    },
    async updateTicket(id, patch) {
      updated.push({ id, patch });
      return { ticket: { id } };
    },
  };
}

/** A Zendesk client that always fails — the ordering proof. */
function throwingZendesk(message = "Zendesk is down") {
  return {
    async createTicket() {
      throw new Error(message);
    },
  };
}

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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

const portal = (zendesk) => createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk });
const ask = (h, externalRef) =>
  callApi(h, { method: "POST", path: "/api/requests/uc03", body: { persona: "chris", text: TRIP_TEXT, externalRef } });
const accept = (h, body) => callApi(h, { method: "POST", path: "/api/requests/uc03/request-letter", body });

// ---------------------------------------------------------------------------
// 1. THE CHAIN. Read the file header before changing anything in this section.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WHAT THESE THREE TESTS USED TO ASSERT, AND WHY THEY NOW ASSERT THE OPPOSITE
// ---------------------------------------------------------------------------
// They were "accepting the offer raises a ticket", "the ticketed letter is
// signed off end to end", and "the relink is recorded". Every one was correct
// when written, and the chain they pinned — accept -> ticket -> queue ->
// signature -> issue — was built to close a defect the project owner reported in
// their own words: *"I went to Zendesk as the specialist, and I did not see
// anywhere to approve the letter to be sent to that individual."*
//
// The owner has since drawn the line one step earlier (docs/use-cases/UC-03.md
// §23): a STANDARD letter, for a traveller every gate has qualified, on a trip
// inside the duration cap, is written and issued by the gate with nobody in the
// path. So accepting the offer no longer produces something for a specialist to
// do — and `src/portal/ticketing.js` is UNCHANGED and still correct, because
// `letterTicketPlan()` already refuses to raise a ticket for a decision that
// needs no human (`no_human_needed`). Raising one would put a finished request
// into a real support queue.
//
// THE DEFECT THE OLD CHAIN CLOSED IS NOT REOPENED, IT MOVED. "The letter reaches
// nobody" was answered by a ticket; it is now answered by a route the traveller
// collects the document from — `POST /api/cases/:id/letter`
// (src/uc03/letterDelivery.js), asserted below. A letter that issues and cannot
// be fetched would be the same defect wearing new clothes, which is why the
// collect assertions are the headline here rather than an afterthought.
// ---------------------------------------------------------------------------

test("POSITIVE: accepting the offer ISSUES the letter, and raises no ticket because nobody is owed anything", async () => {
  const zendesk = fakeZendesk();
  const handler = portal(zendesk);

  const answer = await ask(handler, "letter-handoff-1");
  assert.equal(answer.body.decision, "auto_resolve");
  assert.equal(answer.body.ticketCreated, false);
  assert.equal(zendesk.created.length, 0);

  const taken = await accept(handler, { persona: "chris", caseId: answer.body.recordId });
  assert.equal(taken.status, 200);
  assert.equal(taken.body.code, "letter_issued");
  assert.equal(taken.body.letterIssued, true);
  assert.equal(taken.body.awaitingSignoff, false);

  // NO TICKET, AND THE REASON IS NAMED RATHER THAN LEFT AS AN ABSENCE. This
  // assertion is the exact inverse of the one it replaces, and it is checked
  // through `letterTicketPlan()`'s own code — nothing in src/portal changed.
  assert.equal(taken.body.ticketCreated, false);
  assert.equal(taken.body.ticketHandoff, "no_human_needed");
  assert.equal(zendesk.created.length, 0, "a finished request must not arrive in a real support queue");

  // …AND THE LETTER REALLY EXISTS, on its own case.
  const letterCase = await stores.uc03.findById(taken.body.caseId);
  assert.equal(letterCase.reason, "standard_letter_issued");
  assert.equal(letterCase.status, "resolved");
  const letterDoc = stores.uc03.documents.find(
    (d) => d.caseId === taken.body.caseId && d.type === "travel_support_letter"
  );
  assert.ok(letterDoc, "the accept wrote the letter");
  assert.equal(taken.body.letterContentHash, letterDoc.contentHash);

  // THE SIDEBAR STILL RESOLVES IT, and correctly reports that no specialist is
  // owed a decision. `actionable: false` here is the right answer to the
  // SPECIALIST's question, not the reported defect returning: the reason names
  // the state instead of saying "not actionable".
  const uc03 = createUc03Handler({ caseStore: stores.uc03, audit, remote });
  const view = await callApi(uc03, { method: "GET", path: `/api/cases/${taken.body.caseId}` });
  assert.equal(view.status, 200);
  assert.equal(view.body.caseRow.reason, "standard_letter_issued");
  assert.equal(view.body.actionable, false);
  assert.match(view.body.actionableReason, /ALREADY BEEN ISSUED/);
  assert.equal(view.body.letter.issued, true);
  assert.equal(view.body.letter.contentHash, letterDoc.contentHash);
  assert.equal(view.body.letter.collect.path, `/api/cases/${taken.body.caseId}/letter`);
});

test("POSITIVE: the traveller can collect the issued letter, and nobody else can", async () => {
  // THE DEFECT THIS FILE EXISTS FOR, ASKED AGAIN IN ITS NEW FORM. A decision
  // that is correct, durable, audited and reaches nobody is the failure shape
  // CLAUDE.md §7's honest-gaps list names four times over; an ISSUED letter
  // nobody can fetch would be the worst version of it, because the audit row
  // claims a delivery.
  const zendesk = fakeZendesk();
  const handler = portal(zendesk);
  const answer = await ask(handler, "letter-handoff-2");
  const taken = await accept(handler, { persona: "chris", caseId: answer.body.recordId });
  assert.equal(taken.body.letterIssued, true);

  const letterDoc = stores.uc03.documents.find(
    (d) => d.caseId === taken.body.caseId && d.type === "travel_support_letter"
  );
  const letterCase = await stores.uc03.findById(taken.body.caseId);
  const uc03 = createUc03Handler({ caseStore: stores.uc03, audit, remote });

  const collected = await callApi(uc03, {
    method: "POST",
    path: `/api/cases/${taken.body.caseId}/letter`,
    body: { session: { authenticatedEmploymentId: letterCase.employmentId } },
  });
  assert.equal(collected.status, 200);
  assert.equal(collected.body.ok, true);
  assert.equal(collected.body.contentType, "text/html");
  assert.equal(collected.body.contentHash, letterDoc.contentHash, "the bytes handed over are the bytes recorded");
  assert.equal(collected.body.content, letterDoc.content);
  assert.equal(collected.body.issuedWithoutSignature, true);
  assert.match(collected.body.content, /Travel Letter/);

  // AND NOBODY ELSE. The document names an employee, their job title, their
  // employer and their base compensation.
  const impostor = await callApi(uc03, {
    method: "POST",
    path: `/api/cases/${taken.body.caseId}/letter`,
    body: { session: { authenticatedEmploymentId: "emp_someone_else" } },
  });
  assert.equal(impostor.status, 403);
  assert.equal(impostor.body.code, "not_the_traveller");
  assert.ok(!JSON.stringify(impostor.body).includes("Base compensation"));

  const anonymous = await callApi(uc03, {
    method: "POST",
    path: `/api/cases/${taken.body.caseId}/letter`,
    body: {},
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "session_required");
});

test("with no ticket raised, the reference the requester holds is never repointed", async () => {
  // THE MIRROR OF THE RELINK TEST THIS REPLACES. `linkTicket()` used to replace
  // the letter case's reference with the ticket id, and an audit row had to
  // record the substitution or the requester's own reference stopped resolving.
  // No ticket is raised now, so no substitution happens — and the assertion
  // that matters is that the reference they were given still IS the reference
  // on the record.
  const zendesk = fakeZendesk();
  const handler = portal(zendesk);
  const answer = await ask(handler, "letter-handoff-relink");
  const taken = await accept(handler, { persona: "chris", caseId: answer.body.recordId });

  assert.equal(taken.body.ticketCreated, false);
  const letterCase = await stores.uc03.findById(taken.body.caseId);
  assert.equal(letterCase.externalRef, "letter-handoff-relink");
  const decisionRow = audit.forUseCase("UC-03").find((e) => e.details?.caseId === taken.body.caseId);
  assert.equal(decisionRow.details.externalRef, "letter-handoff-relink", "history keys on the reference they hold");
});

// ---------------------------------------------------------------------------
// 2. THE TICKET FOLLOWS THE TRIP — the design question, argued in UC-03.md §7.4
// ---------------------------------------------------------------------------

test("a trip that is ALREADY a ticket gets no second one, and is told which ticket it is", () => {
  // A Zendesk-sourced answer's `externalRef` IS its ticket id. The letter
  // request is a second decision on the same journey, so it belongs in the same
  // conversation: the specialist signing it needs what was asked and what was
  // answered, and `findByExternalRef` hands them the newest case on the ticket,
  // which is the letter.
  const plan = letterTicketPlan({
    answeredCase: { source: "zendesk", decision: "auto_resolve", externalRef: "57" },
    decision: "human_review",
  });
  assert.equal(plan.raise, false);
  assert.equal(plan.code, "ticket_follows_trip");
  assert.equal(plan.existingTicketId, "57");
  assert.match(plan.note, /#57/);
});

test("whether the trip already has a ticket is DERIVED from the deny-list, not from the source", () => {
  // NOT "portal means no ticket". That is a fact about today's
  // NO_TICKET_DECISIONS restated in a second place, free to drift the moment an
  // offer is made on an outcome that does raise one. A portal case whose own
  // decision needed a human was relinked to its ticket id at that moment, and
  // this reads that rather than assuming it.
  const relinked = letterTicketPlan({
    answeredCase: { source: "portal", decision: "escalate", externalRef: "61" },
    decision: "human_review",
  });
  assert.equal(relinked.raise, false);
  assert.equal(relinked.existingTicketId, "61");

  const untick = letterTicketPlan({
    answeredCase: { source: "portal", decision: "auto_resolve", externalRef: "uc03-20260820-abc" },
    decision: "human_review",
  });
  assert.equal(untick.raise, true, "an auto-resolved portal answer has no ticket, so the letter must raise one");

  // A missing answered case is SAID to be missing rather than treated as
  // ticketless — raising a ticket on a trip that may already have one is the
  // duplicate this whole rule exists to avoid.
  const missing = letterTicketPlan({ answeredCase: null, decision: "human_review" });
  assert.equal(missing.raise, false);
  assert.equal(missing.code, "no_answered_case");
});

// ---------------------------------------------------------------------------
// 3. THE FAILURE THAT MUST NOT BE SWALLOWED
// ---------------------------------------------------------------------------

test("a broken Zendesk cannot cost the letter, because no hand-off is attempted at all", async () => {
  // THE SUBJECT OF THIS TEST NARROWED WITH THE FEATURE. It used to prove the
  // ORDERING on a failed hand-off — the decision durable first, the ticket
  // failure recorded as `portal_ticket_creation_failed` and never swallowed —
  // because an accepted letter always needed a specialist and therefore always
  // needed a ticket. It does not need one now (`no_human_needed`), so the
  // strongest true statement is the one below: there is no hand-off left for a
  // broken Zendesk to lose. The ordering proof itself is unchanged and still
  // exercised by every portal decision that DOES need a person.
  const handler = portal(throwingZendesk("Zendesk is down"));
  const answer = await ask(handler, "letter-handoff-fail");
  const taken = await accept(handler, { persona: "chris", caseId: answer.body.recordId });

  assert.equal(taken.status, 200);
  assert.equal(taken.body.ok, true);
  assert.equal(taken.body.letterIssued, true);
  const letterCase = await stores.uc03.findById(taken.body.caseId);
  assert.equal(letterCase.decision, "auto_resolve");
  assert.equal(letterCase.reason, "standard_letter_issued");
  assert.ok(
    stores.uc03.documents.some((d) => d.caseId === taken.body.caseId && d.type === "travel_support_letter"),
    "the document exists regardless of what Zendesk is doing"
  );

  assert.equal(taken.body.ticketCreated, false);
  assert.equal(taken.body.ticketId, null);
  // NOT AN ERROR, AND THE DIFFERENCE IS THE POINT: `ticketError` would say the
  // hand-off was attempted and failed. Nothing was attempted.
  assert.equal(taken.body.ticketError ?? null, null);
  assert.equal(taken.body.ticketHandoff, "no_human_needed");
  assert.equal(
    audit.forUseCase("UC-03").filter((e) => e.action === "portal_ticket_creation_failed").length,
    0,
    "no hand-off was attempted, so none can have fallen on the floor"
  );
});

// ---------------------------------------------------------------------------
// 4. THE REFUSALS — every one of which must raise NOTHING
// ---------------------------------------------------------------------------

test("an unauthenticated accept writes nothing and raises no ticket", async () => {
  const zendesk = fakeZendesk();
  const handler = portal(zendesk);
  const answer = await ask(handler, "letter-handoff-anon");

  const before = (await stores.uc03.listByUseCase("UC-03")).length;
  const auditBefore = audit.entries.length;

  const denied = await accept(handler, { caseId: answer.body.recordId });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, "unauthenticated");

  assert.equal((await stores.uc03.listByUseCase("UC-03")).length, before);
  assert.equal(audit.entries.length, auditBefore);
  // THE NEW HALF. A refusal that still raised a ticket would let anyone holding
  // the access key mint tickets in a real support queue by POSTing case ids.
  assert.equal(zendesk.created.length, 0);
  assert.equal(denied.body.ticketCreated, undefined, "a refusal carries no hand-off envelope at all");
});

test("a second accept is refused and raises no second ticket", async () => {
  const zendesk = fakeZendesk();
  const handler = portal(zendesk);
  const answer = await ask(handler, "letter-handoff-twice");

  const first = await accept(handler, { persona: "chris", caseId: answer.body.recordId });
  assert.equal(first.body.letterIssued, true);
  assert.equal(first.body.ticketCreated, false, "an issued letter needs nobody, so it raises nothing");
  assert.equal(zendesk.created.length, 0);

  const second = await accept(handler, { persona: "chris", caseId: answer.body.recordId });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "offer_already_accepted");
  // Nothing new was decided, so nothing new is handed over. A ticket here would
  // be precisely the duplicate the exactly-once ledger exists to prevent,
  // arriving in a real queue.
  assert.equal(zendesk.created.length, 0);
  assert.equal(
    stores.uc03.documents.filter((d) => d.type === "travel_support_letter").length,
    1,
    "one accepted offer, one letter"
  );
});

test("a persona who is not the traveller is refused and raises no ticket", async () => {
  const zendesk = fakeZendesk();
  const handler = portal(zendesk);
  const answer = await ask(handler, "letter-handoff-other");

  const denied = await accept(handler, { persona: "emma", caseId: answer.body.recordId });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "not_the_traveller");
  assert.equal(zendesk.created.length, 0);
  assert.equal(PERSONAS.chris.employmentId !== PERSONAS.emma.employmentId, true);
});

test("with no Zendesk client at all the accept still succeeds and says why there is no ticket", async () => {
  // A fresh clone with no credentials must still demonstrate the whole flow,
  // and must not claim a hand-off it did not make.
  const handler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  const answer = await ask(handler, "letter-handoff-nozd");
  const taken = await accept(handler, { persona: "chris", caseId: answer.body.recordId });

  assert.equal(taken.body.ok, true);
  assert.equal(taken.body.letterIssued, true, "a credential-free clone still produces the whole document");
  assert.equal(taken.body.awaitingSignoff, false);
  assert.equal(taken.body.ticketCreated, false);
  // THE NOTE NAMES THE REAL REASON, and it is no longer the missing client. On
  // the default posture there is nothing to hand off, so that is what it says —
  // claiming "no Zendesk configured" would blame the environment for a decision
  // the policy made.
  assert.equal(taken.body.ticketHandoff, "no_human_needed");
  assert.match(taken.body.ticketNote, /needs no human/i);
});

// ---------------------------------------------------------------------------
// 5. The page — never imported by npm test, so asserted on its source
// ---------------------------------------------------------------------------

test("the accept panel prints the hand-off in the server's words, with textContent", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const app = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "portal", "assets", "app.js"),
    "utf8"
  );
  const block = app.slice(app.indexOf("function acceptLetterOffer("), app.indexOf("/** Ask the server for the continuation"));

  // "Requested." on its own is the sentence that hid the defect for as long as
  // it lived. Where it went is now on the screen.
  assert.match(block, /body\.ticketNote/);
  assert.match(block, /body\.ticketId/);
  assert.match(block, /body\.ticketError/);
  assert.ok(!/innerHTML/.test(block), "a ticket note is untrusted text — textContent only");
  // No decision string is compared here: the page renders what it was given.
  assert.ok(!/formal_letter_requested/.test(block), "the page must not re-derive the decision");
});
