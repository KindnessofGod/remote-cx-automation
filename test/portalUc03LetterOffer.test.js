// ---------------------------------------------------------------------------
// portalUc03LetterOffer.test.js  —  the offer, on the screen it was made to
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST
//
// UC-03's auto-resolved answer carries a `letterOffer`: an employee who asked
// "is this business trip fine?", passed every gate and was answered
// informationally can accept the formal travel letter without describing the
// trip again (src/uc03/letterOffer.js). The mechanism was built, tested and
// proven end to end — answer → accept → drafted → specialist signs → issued.
//
// AND NO SURFACE RENDERED IT. That is the defect this file guards against
// coming back, and it is this repository's most persistent one: work that is
// complete, correct and reachable by nobody. It has already happened to
// citations, to a disclaimer and to this. A mechanism nobody can reach is
// indistinguishable, from where the customer stands, from one that was never
// built — so "the offer is on the wire" and "the offer is on a screen" are two
// claims, and only the second one is worth anything to the employee.
//
// THE PORTAL IS THE SURFACE THAT CAN ACCEPT IT. Accepting needs the
// TRAVELLER's own authenticated session (prime directive #3), and the portal is
// the one place in this repo that holds one — ./personas.js's map, server-owned
// and never a role named in a request body. The ZAF sidebar deliberately
// renders the same offer read-only; see test/zafUc03LetterOffer.test.js for
// that half and for why a button there would be a control that cannot work.
//
// EVERY LLM SEAM IS FAKED, the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom: this
// devcontainer carries a genuine but unreachable OPENAI_API_KEY, so a missed
// seam is a real, retried, slow network call (CLAUDE.md §6).
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { PERSONAS } from "../src/portal/personas.js";

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
import { OFFER_ACCEPTED } from "../src/uc03/letterOffer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// Allocated in src/shared/ports.js TEST_PORTS; test/ports.test.js checks that
// this file and that table agree in both directions.
const REMOTE_PORT = 4116;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

/** Chris Lee — the traveller the UC-03 quick-fills and this file both use. */
const CHRIS = PERSONAS.chris.employmentId;

/** A trip that clears every gate, so the answer carries an offer. */
const TRIP_TEXT =
  "I am travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?";
/** One the rule-based classifier routes to UC-04, so no offer exists. */
const WORKATION_TEXT =
  "I would like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?";

let remote;
let remoteServer;

function freshStores() {
  return {
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
}

/** Same in-process handler driver every other server suite in this repo uses. */
function callApi(h, { method, path, body = null, headers = {} }) {
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
    h(req, res).catch(reject);
  });
}

function buildPortal({ audit = new AuditLogger(), stores = freshStores() } = {}) {
  return { audit, stores, handler: createPortalHandler({ remote, audit, stores, llm: FAKE_LLM }) };
}

const ask = (h, body) => callApi(h, { method: "POST", path: "/api/requests/uc03", body });
const accept = (h, body) => callApi(h, { method: "POST", path: "/api/requests/uc03/request-letter", body });

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 1. The offer reaches the page, carrying the trip it is about
// ---------------------------------------------------------------------------

test("an auto-resolved answer carries the offer, and it names the trip the letter would certify", async () => {
  const { handler } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-offer-1" });

  assert.equal(answer.body.decision, "auto_resolve");
  const offer = answer.body.letterOffer;
  assert.ok(offer, "an auto-resolved travel answer must carry the letter offer");
  assert.equal(offer.offered, true);

  // THE FACTS, NOT JUST THE BUTTON. Accepting confirms a trip the person was
  // SHOWN; an offer with no trip on it is asking them to agree to a document
  // they have not read, which is the one thing letterOffer.js's `carries`
  // exists to prevent.
  assert.equal(offer.carries.destinationCountry, "ES");
  assert.equal(offer.carries.startDate, "2026-09-14");
  assert.equal(offer.carries.endDate, "2026-10-02");
  // And the code has a name beside it — the portal's own lookup, presentation
  // only. The code stays because it is what the gates compared and the audit
  // row carries.
  assert.equal(offer.carries.destinationName, "Spain");

  // WHAT HAPPENS AFTER THE CLICK IS STATED BEFORE IT, and this pair of
  // assertions inverted when the standard letter began issuing itself
  // (docs/use-cases/UC-03.md §23). They used to read `requiresSignoff, true`
  // and /signed it off/, which was true of every path when written. The rule
  // they enforce has not changed: whatever the click produces, the offer says
  // so first — an offer that reads as "get a letter" and then produces a queue
  // is worse than the second request it replaced, and so is one that reads as
  // "wait for a specialist" and then hands over a document.
  assert.equal(offer.requiresSignoff, false);
  assert.match(offer.signoffNote, /issued to you straight away/i);
  // …and the exception it does still name, which is the only thing left that
  // can send a standard letter to a person.
  assert.match(offer.signoffNote, /employing entity/i);
  // EVERY ROW THE LETTER WILL CARRY, including the one a person is most likely
  // to object to. With nobody in the path this is where the employee is told —
  // NAMED, but no longer promised flatly: the letter states an ANNUAL GROSS
  // SALARY, which Remote holds for an EOR employment and not for a contractor
  // (whose record carries a per-period rate of unestablished ×100 scale). See
  // src/uc03/letter.js's readAnnualGrossSalary() and
  // test/uc03LetterCompensation.test.js.
  assert.match(offer.produces, /annual gross salary/i);
});

test("the offer's accept path is the PORTAL's own route, not UC-03's API path", async () => {
  // describeLetterOffer() answers with `/api/cases/:id/request-letter` on the
  // UC-03 API — the truthful answer for the surface that asked it, and not this
  // one. A page that assembled its own URL would be a second place to keep
  // right; a page handed the wrong one would 404 with a working mechanism
  // underneath it.
  const { handler } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-offer-2" });
  assert.deepEqual(answer.body.letterOffer.accept, {
    method: "POST",
    path: "api/requests/uc03/request-letter",
  });
});

test("a decision that is not an auto-resolve carries no offer at all", async () => {
  const { handler } = buildPortal();
  const routed = await ask(handler, { persona: "chris", text: WORKATION_TEXT, externalRef: "letter-offer-3" });
  assert.notEqual(routed.body.decision, "auto_resolve");
  // `null`, not `{offered:false}` — the workflow's own shape, passed through
  // rather than normalised here, so the page has one thing to read.
  assert.equal(routed.body.letterOffer, null);
});

// ---------------------------------------------------------------------------
// 2. Accepting: a second decision, a drafted letter, and nothing issued
// ---------------------------------------------------------------------------

// TITLE AND ASSERTIONS MOVED TOGETHER. This was "…with the letter DRAFTED and
// nothing issued" and asserted `human_review / formal_letter_requested`. The
// standard letter now issues on the 🟢 path; what has NOT changed, and is still
// the point of the test, is that accepting produces a SECOND case and leaves the
// answered one exactly as it was.
test("accepting the offer records a second decision, and the letter is ISSUED", async () => {
  const { handler, stores } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-accept-1" });
  const answeredId = answer.body.recordId;

  const taken = await accept(handler, { persona: "chris", caseId: answeredId });
  assert.equal(taken.status, 200);
  assert.equal(taken.body.ok, true);
  assert.equal(taken.body.code, "letter_issued");
  assert.equal(taken.body.decision, "auto_resolve");
  assert.equal(taken.body.decisionReason, "standard_letter_issued");
  assert.equal(taken.body.letterDrafted, true);
  assert.equal(taken.body.letterIssued, true);
  assert.equal(taken.body.awaitingSignoff, false);
  assert.ok(taken.body.letterContentHash, "the response names the exact document by its hash");

  // A NEW CASE, and the answered one untouched. Rewriting the first case's
  // decision would destroy the record of the answer the customer already has —
  // see src/uc03/letterOffer.js's header for the five reasons.
  assert.notEqual(taken.body.caseId, answeredId);
  assert.equal(taken.body.fromCaseId, answeredId);
  const answered = await stores.uc03.findById(answeredId);
  assert.equal(answered.decision, "auto_resolve");

  // The flag on the letter case says a PERSON set it, not a model. That
  // distinction is the whole of `formalLetterRequestedVia`.
  const letterCase = await stores.uc03.findById(taken.body.caseId);
  assert.equal(letterCase.classification.formalLetterRequestedVia, OFFER_ACCEPTED);
  // …AND THE LETTER REALLY EXISTS, on its own case rather than on the answer's.
  assert.equal(letterCase.reason, "standard_letter_issued");
  assert.notEqual(letterCase.id, answeredId);
});

test("a second accept is refused and names the case the first one became", async () => {
  const { handler } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-accept-2" });
  const first = await accept(handler, { persona: "chris", caseId: answer.body.recordId });
  assert.equal(first.body.ok, true);

  const second = await accept(handler, { persona: "chris", caseId: answer.body.recordId });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "offer_already_accepted");
  assert.match(second.body.reason, new RegExp(first.body.caseId));
});

// ---------------------------------------------------------------------------
// 3. The refusals — and the one that must write nothing at all
// ---------------------------------------------------------------------------

test("an unauthenticated accept writes nothing — no case, no audit row", async () => {
  const { handler, stores, audit } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-anon-1" });

  const before = (await stores.uc03.listByUseCase("UC-03")).length;
  const auditBefore = audit.entries.length;

  const denied = await accept(handler, { caseId: answer.body.recordId });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.code, "unauthenticated");

  // THE POINT OF THIS TEST IS THE COUNTS, not the code. A refusal that still
  // wrote a case row would be an anonymous caller minting decisions by POSTing
  // case ids; a refusal that still wrote an audit row would be an anonymous
  // caller appending to an append-only table. Neither is recoverable.
  assert.equal((await stores.uc03.listByUseCase("UC-03")).length, before);
  assert.equal(audit.entries.length, auditBefore);
});

test("an admin cannot take up an offer made to an employee", async () => {
  const { handler } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-admin-1" });

  const denied = await accept(handler, { persona: "admin", caseId: answer.body.recordId });
  assert.equal(denied.status, 403);
  // BY NAME. An admin session carries a company and no employment, so the
  // offer's own identity check would land it on `session_required` — a refusal
  // whose words describe the wrong problem entirely.
  assert.equal(denied.body.code, "persona_cannot_request_letter");
});

test("another employee is refused as not the traveller", async () => {
  const { handler } = buildPortal();
  const answer = await ask(handler, { persona: "chris", text: TRIP_TEXT, externalRef: "letter-other-1" });

  const denied = await accept(handler, { persona: "emma", caseId: answer.body.recordId });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "not_the_traveller");

  // The case is Chris's, and it stays that way.
  assert.equal(answer.body.letterOffer.offered, true);
  assert.equal(PERSONAS.chris.employmentId, CHRIS);
});

test("a case nobody named, and a sub-path nobody serves, both answer honestly", async () => {
  const { handler } = buildPortal();
  const noId = await accept(handler, { persona: "chris" });
  assert.equal(noId.status, 400);
  assert.equal(noId.body.code, "letter_case_required");

  const unknown = await accept(handler, { persona: "chris", caseId: "no-such-case" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "case_not_found");

  // `isPath()` is a PREFIX match, so without the exact length check a
  // sub-resource that does not exist would be served by this route with the
  // trailing segments ignored — the same trap /continue documents.
  const deeper = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03/request-letter/extra",
    body: { persona: "chris" },
  });
  assert.equal(deeper.status, 404);
});

// ---------------------------------------------------------------------------
// 4. The page — never imported by npm test, so asserted on its source
// ---------------------------------------------------------------------------

test("the page renders the offer, and reads the path and the trip off the server", () => {
  const app = read("app.js");

  assert.match(app, /function letterOffer\(payload\)/, "no renderer for the offer");
  assert.match(app, /payload\.letterOffer/);
  // It renders only what the server said is open, and the accept path is the
  // server's own field rather than a URL assembled here.
  assert.match(app, /offer\.offered !== true/);
  assert.match(app, /offer\.accept\.path/);

  // THE TRIP IS ON THE SCREEN. A button with no facts beside it is the defect
  // the `carries` block exists to prevent.
  for (const field of ["destinationCountry", "startDate", "endDate"]) {
    assert.ok(app.includes("carries." + field), `the page never renders carries.${field}`);
  }
});

test("the page writes with textContent and posts a persona KEY, never a session", () => {
  const app = read("app.js");
  const offerBlock = app.slice(app.indexOf("function letterOffer(payload)"), app.indexOf("/** Ask the server for the continuation"));

  assert.ok(!/innerHTML/.test(offerBlock), "the offer block must not use innerHTML — a ticket's text is untrusted");
  // The session behind the persona is the SERVER's, from src/portal/personas.js.
  // A body that carried its own employment id would be a claim, and prime
  // directive #3 is that identity never comes from one.
  assert.match(offerBlock, /persona: byId\("persona"\)\.value/);
  assert.ok(
    !/authenticatedEmploymentId/.test(offerBlock),
    "the browser must never name the employment the letter is about"
  );
});
