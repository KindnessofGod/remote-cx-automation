// ---------------------------------------------------------------------------
// uc03AutoIssue.test.js — the standard travel letter, issued with no signature
// ---------------------------------------------------------------------------
// THE DECISION THIS FILE PINS, IN THE PROJECT OWNER'S OWN WORDS
//
//   "For a short business trip where the user is qualified, that should be
//    fully automated — no need for anybody to sign. It is only when it is a
//    higher level, where things are a bit complex and the legal risk is high,
//    or when the user is not qualified by normal standards, that the expert
//    gets to review it."
//
// That is prime directive 2's tier model applied to a DOCUMENT rather than to a
// use case, and it is a change of policy rather than a discovery: `1e14f46`
// checked Remote's own `TravelLetterRequest` and found generation conditioned on
// a second human approval that no API client can even set. That evidence is
// about Remote's Request Hub flow and this system does not call that endpoint —
// it renders its own letter from the employment record it read — so there is no
// platform to be more permissive than. `docs/use-cases/UC-03.md` §23 carries the
// full argument, including why the earlier finding is recorded rather than
// dropped.
//
// ---------------------------------------------------------------------------
// WHY THE POSITIVE TEST LEADS, AND WHY IT ASSERTS THE ARTEFACT RATHER THAN THE
// DECISION STRING
// ---------------------------------------------------------------------------
// This repository's most expensive recurring defect is that a path which
// STRUCTURALLY CANNOT SUCCEED is indistinguishable, from outside, from one being
// appropriately cautious — UC-03's own supported-countries gate spent weeks
// refusing every destination on earth while every fail-closed assertion passed.
// A `reason: "standard_letter_issued"` with no document behind it would be that
// defect wearing this feature's clothes, so the headline test walks the whole
// chain: the rendered HTML, its sha256, the audit row that says what stood in
// for a signer, the delivery to the ticket, and the route the traveller collects
// it from.
//
// Then the four things that must still stop, each with the letter unissued and a
// person holding it — a non-standard ask, a reading the router does not trust, an
// outcome that is not `auto_resolve / all_gates_passed`, and an unreadable
// letterhead.
//
// HERMETIC, AND WITHOUT CLAIMING A PORT. `createInProcessFetch()` dispatches the
// real mock server's handler in process, so this file binds no socket and cannot
// collide with a concurrently-running test file over `TEST_BAND` — the
// `EADDRINUSE` failure that has been misread as a logic failure more than once
// (CLAUDE.md §6). Nothing here reaches OpenAI or a network.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry, submitTravelLetterSignoff } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { renderTravelLetterHtml } from "../src/uc03/letter.js";
import { createUc03Handler } from "../src/uc03/server.js";
import { evaluateLetterDelivery } from "../src/uc03/letterDelivery.js";
import { GATE_SEQUENCE, describeDecisionFacts, describeDecidingGate } from "../src/uc03/policyEngine.js";

const EMPLOYEE = "emp_active_001";
const SESSION = { authenticatedEmploymentId: EMPLOYEE };
const SPECIALIST = "travel.specialist@remote.test";

/** The request that must succeed. Short, business, standard, nothing unusual. */
const STANDARD_LETTER_REQUEST =
  "I need a travel letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.";

let remote;
let audit;
let caseStore;
let zendeskCalls;
let zendesk;

beforeEach(() => {
  remote = new RemoteClient({ baseUrl: "http://mock.invalid", fetchImpl: createInProcessFetch() });
  audit = new AuditLogger();
  caseStore = new CaseStore();
  zendeskCalls = [];
  zendesk = {
    updateTicket: async (ref, payload) => zendeskCalls.push({ kind: "updateTicket", ref, payload }),
    flagForReview: async (ref, payload) => zendeskCalls.push({ kind: "flagForReview", ref, payload }),
    resolveWithLetter: async (ref, html) => zendeskCalls.push({ kind: "resolveWithLetter", ref, html }),
  };
});

const ask = (text, overrides = {}, deps = {}) =>
  handleTravelInquiry(
    { text, employmentId: EMPLOYEE, session: SESSION, ...overrides },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased, ...deps }
  );

const docsFor = (id) => caseStore.documents.filter((d) => d.caseId === id);
const uc03Audit = () => audit.forUseCase("UC-03");

/** Drive the real HTTP handler with no listening socket. */
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
// 1. THE POSITIVE CASE — the whole chain, artefact first
// ---------------------------------------------------------------------------

test("POSITIVE: a short qualified standard business trip gets its letter with no signature", async () => {
  const result = await ask(STANDARD_LETTER_REQUEST, { source: "zendesk", externalRef: "issue-1" }, { zendesk });

  // --- the decision -------------------------------------------------------
  assert.equal(result.decision, "auto_resolve");
  assert.equal(result.reason, "standard_letter_issued");
  assert.equal(result.durationDays, 7, "a seven-day trip, well inside the 30-day cap");
  assert.deepEqual(result.flags, [], "the routine outcome raises no escalation flag");
  assert.equal(result.letterDraft.issued, true);

  // --- the document, which is the thing that must actually exist ----------
  const doc = docsFor(result.caseId).find((d) => d.type === "travel_support_letter");
  assert.ok(doc, "a decision that says a letter was issued must have issued one");
  assert.equal(doc.content, result.letterHtml);
  assert.match(doc.content, /Travel Letter/);
  assert.match(doc.content, /Amara Okafor/, "it names the employee from the Remote record");
  assert.match(doc.content, /Remote Nigeria EOR Ltd/, "on the employing entity's letterhead");
  assert.match(doc.content, /Germany/);
  assert.match(doc.content, /2026-09-20 to 2026-09-26/);
  assert.match(doc.content, /does not constitute legal or immigration advice/, "the mandatory disclaimer is on it");

  // --- its sha256 ---------------------------------------------------------
  const expectedHash = createHash("sha256").update(result.letterHtml).digest("hex");
  assert.equal(doc.contentHash, expectedHash);
  assert.equal(result.letterDraft.contentHash, expectedHash);

  // --- the audit row, and what stood in for a signer ----------------------
  const row = uc03Audit().find((e) => e.details.caseId === result.caseId);
  assert.equal(row.action, "auto_resolve");
  assert.equal(row.details.reason, "standard_letter_issued");
  assert.equal(row.details.letterIssued, true, "the field that had only ever been able to say false");
  assert.equal(row.details.letterDrafted, true);
  assert.equal(row.details.letterContentHash, expectedHash);

  const stoodIn = row.details.autoIssue;
  assert.equal(stoodIn.issuedWithoutSignature, true);
  assert.equal(stoodIn.letterContentHash, expectedHash);
  assert.equal(stoodIn.letterDocumentId, doc.id);
  // WHICH GATES PASSED, NAMED ONE BY ONE. "All gates passed" is a claim; the
  // ladder is the evidence, and it is the only account of why this document
  // exists at all.
  // DERIVED, NOT RESTATED (2026-09-03). This read `12, "of the 14 in the
  // ladder"` and both numbers moved when the engagement gate added five rungs.
  // A hard-coded position tests the ladder's LENGTH, which no reader of this
  // test cares about; what it means is "every rung above the issuing one", so
  // that is what it now computes.
  const issuingRung = GATE_SEQUENCE.find((r) => r.reason === "standard_letter_issued");
  assert.equal(stoodIn.gatesPassed.length, issuingRung.position - 1, "every rung above the issuing one");
  assert.deepEqual(
    stoodIn.gatesPassed.map((g) => g.position),
    Array.from({ length: issuingRung.position - 1 }, (_, i) => i + 1),
    "an unbroken 1..N-1 run — no rung skipped on the way to the letter"
  );
  assert.equal(stoodIn.decidedAt.position, issuingRung.position);
  assert.equal(stoodIn.decidedAt.of, GATE_SEQUENCE.length);
  assert.equal(stoodIn.letterScope.standard, true, "the scope verdict, in the positive");
  assert.ok(stoodIn.letterScope.checked.includes("non_standard_asks_scan"));
  assert.ok(stoodIn.basis.length > 40, "and a sentence a person can read");

  // --- nobody was asked, and nobody is waiting ----------------------------
  assert.equal(caseStore.reviewQueue.length, 0, "no queue row: nothing is owed to anybody");
  assert.ok(
    !uc03Audit().some((e) => e.action === "travel_letter_signed_off"),
    "no signature was recorded, because none was taken"
  );

  // --- and it reached the customer ---------------------------------------
  const delivered = zendeskCalls.filter((c) => c.kind === "resolveWithLetter");
  assert.equal(delivered.length, 1, "issued exactly once");
  assert.equal(delivered[0].ref, "issue-1");
  assert.equal(delivered[0].html, doc.content, "the bytes recorded are the bytes sent");
});

test("POSITIVE: the traveller can collect the issued letter over HTTP, and nobody else can", async () => {
  const result = await ask(STANDARD_LETTER_REQUEST, { externalRef: "issue-collect" });
  const doc = docsFor(result.caseId).find((d) => d.type === "travel_support_letter");
  const handler = createUc03Handler({ caseStore, audit, remote });

  // THE ROUTE THE VIEW ITSELF NAMES. A surface that assembled its own URL would
  // be a second place to keep right.
  const view = await callApi(handler, { method: "GET", path: `/api/cases/${result.caseId}` });
  assert.equal(view.body.letter.collect.path, `/api/cases/${result.caseId}/letter`);
  assert.equal(view.body.letter.contentHash, doc.contentHash);
  assert.equal(view.body.letter.content, undefined, "the sidebar's view carries the hash, never the pay");

  const mine = await callApi(handler, {
    method: "POST",
    path: view.body.letter.collect.path,
    body: { session: SESSION },
  });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.ok, true);
  assert.equal(mine.body.contentType, "text/html");
  assert.equal(mine.body.filename, `travel-letter-${result.caseId}.html`);
  assert.equal(mine.body.contentHash, doc.contentHash);
  assert.equal(mine.body.content, doc.content);
  assert.equal(mine.body.issuedWithoutSignature, true);

  // …AND NOBODY ELSE. The document names an employee, their job title, their
  // employer and their annual gross salary.
  const other = await callApi(handler, {
    method: "POST",
    path: view.body.letter.collect.path,
    body: { session: { authenticatedEmploymentId: "emp_someone_else" } },
  });
  assert.equal(other.status, 403);
  assert.equal(other.body.code, "not_the_traveller");
  assert.ok(!JSON.stringify(other.body).includes("Annual gross salary"));

  const anonymous = await callApi(handler, {
    method: "POST",
    path: view.body.letter.collect.path,
    body: {},
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "session_required");

  // ORDER: a caller who is not the traveller is refused BEFORE being told
  // whether a letter exists at all — "no letter on that case" is itself a fact
  // about somebody else's request.
  const unknownCase = evaluateLetterDelivery({
    caseRow: { id: "x", employmentId: EMPLOYEE, reason: "standard_letter_issued" },
    session: { authenticatedEmploymentId: "someone_else" },
    letterDocument: null,
  });
  assert.equal(unknownCase.code, "not_the_traveller", "identity is answered before the artefact's existence");
});

// ---------------------------------------------------------------------------
// 2. THE COMPENSATION ROW — decided, argued in UC-03.md §23.4, pinned here
// ---------------------------------------------------------------------------

test("the auto-issued letter carries the salary row, and it is the SAME document the signed path produces", async () => {
  // WHY THIS IS PINNED IN BOTH DIRECTIONS. Auto-issue means the letter's
  // contents are decided entirely by code, and the row a person is most likely
  // to object to is their own pay. The decision was to keep it: it is the row
  // that answers the Visa Code Handbook's MEANS OF SUBSISTENCE head (§5.2.2(d)),
  // the signature was never a control over it (a specialist had no gate, field
  // or prompt asking them to weigh it), and a body that changed with the issue
  // path would be two documents wearing one name — a consulate holding both
  // could not tell which it had, and the shorter one would be the silently
  // truncated document `letterScope.js` exists to prevent.
  //
  // WHAT THIS TEST CANNOT PROVE, AND WHERE THAT PROOF LIVES. It drives the MOCK
  // server, whose fixtures are flat (`base_salary`/`currency`) — a shape the
  // real API never returns. For the project's whole life the row was read from
  // that flat field alone, so this assertion passed while the row COULD NOT
  // RENDER in production at all: `normalizeEmployment()` produces neither key
  // for a live response. A positive test on a fixture that does not match
  // production is the exact defect it looks like a guard against, so the
  // live-shaped proof is `test/uc03LetterCompensation.test.js`, driven from the
  // committed `data.employment` capture through the real normalizer. This one
  // now pins the offline path only, and says so.
  const issued = await ask(STANDARD_LETTER_REQUEST, { externalRef: "comp-1" });
  assert.match(issued.letterHtml, /Annual gross salary/);
  // 5,000,000 on the record is 50,000.00 in the currency's own units — the ×100
  // scaling invariant, applied by the shared middleware on the way out. A letter
  // printing the raw integer to a consulate would overstate the salary a
  // hundredfold, which is why this asserts the SCALED figure and not merely that
  // some money appears.
  assert.match(issued.letterHtml, /50,000\.00 USD/);
  assert.ok(!issued.letterHtml.includes("5,000,000"), "never the raw ×100 integer");

  // THE SAME BYTES THE RENDERER PRODUCES FOR THESE INPUTS. There is no second
  // renderer and no path-dependent content; if one ever appears, this fails.
  const employment = await remote.getEmployment(EMPLOYEE);
  const legalEntity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);
  const direct = renderTravelLetterHtml({
    employment,
    legalEntity,
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
    reference: "comp-1",
  });
  assert.equal(issued.letterHtml, direct, "the issued letter is exactly what letter.js renders — no second template");

  // …and the signature-required posture produces the identical document, so the
  // two paths differ only in WHO RELEASES IT.
  audit = new AuditLogger();
  caseStore = new CaseStore();
  const drafted = await ask(STANDARD_LETTER_REQUEST, { externalRef: "comp-1" }, { letterAutoIssue: false });
  assert.equal(drafted.reason, "formal_letter_requested");
  assert.equal(drafted.letterHtml, issued.letterHtml, "one letter, one body, whoever releases it");
});

// ---------------------------------------------------------------------------
// 3. THE FOUR THINGS THAT MUST STILL STOP
// ---------------------------------------------------------------------------

test("REFUSAL 1: a non-standard ask is not issued, and nothing is drafted", async () => {
  const result = await ask(
    "I need a travel letter for a conference in Germany from 2026-09-20 to 2026-09-26. Please address it to the " +
      "German Consulate General in Lagos and state my passport number.",
    { source: "zendesk", externalRef: "refuse-scope" },
    { zendesk }
  );

  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "letter_scope_exceeded");
  assert.equal(docsFor(result.caseId).length, 0, "refusing to ISSUE a bad document still leaves it written");
  assert.equal(uc03Audit().find((e) => e.details.caseId === result.caseId).details.letterIssued, false);
  assert.equal(caseStore.reviewQueue.length, 1, "a person is holding it");
  assert.equal(zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length, 0);
});

test("REFUSAL 2: a reading the router does not trust never reaches the letter rung at all", async () => {
  // `c295ef1` found a formal letter being drafted from a 0.05-confidence
  // extraction and handed to a specialist to sign. Auto-issue must not turn that
  // into a document sent to a consulate with nobody in the path — and the reason
  // it cannot is structural: the confidence gate is rung 3, eight rungs above
  // the one that issues.
  for (const confidence of [0.05, undefined]) {
    audit = new AuditLogger();
    caseStore = new CaseStore();
    const result = await ask(
      STANDARD_LETTER_REQUEST,
      { source: "zendesk", externalRef: `refuse-conf-${confidence}` },
      {
        zendesk,
        classify: async (input) => ({ ...(await classifyTravelInquiryRuleBased(input)), confidence }),
      }
    );
    assert.equal(result.decision, "human_review");
    assert.ok(["low_confidence", "confidence_unknown"].includes(result.reason), result.reason);
    assert.equal(docsFor(result.caseId).length, 0, "nothing is drafted from a reading nobody trusts");
    assert.equal(uc03Audit().find((e) => e.details.caseId === result.caseId).details.letterIssued, false);
    assert.equal(zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length, 0);
  }
});

test("REFUSAL 3: an outcome that is not a clean auto-resolve issues nothing", async () => {
  // Sanctioned destination, work-authorisation intent, over-cap duration and a
  // terminated employee are four different rungs, and not one of them may reach
  // a document. Driven together because the guarantee is about the SET.
  const scenarios = [
    ["I need a travel letter for a trip to Russia from 2026-09-20 to 2026-09-26.", "escalate"],
    ["I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?", "route_to_uc04"],
    ["I need a travel letter for a conference in Germany from 2026-09-20 to 2026-12-20.", "escalate"],
  ];
  for (const [text, decision] of scenarios) {
    audit = new AuditLogger();
    caseStore = new CaseStore();
    const result = await ask(text, { source: "zendesk", externalRef: "refuse-outcome" }, { zendesk });
    assert.equal(result.decision, decision, text);
    assert.equal(docsFor(result.caseId).filter((d) => d.type === "travel_support_letter").length, 0, text);
    assert.equal(uc03Audit().find((e) => e.details.caseId === result.caseId).details.letterIssued, false, text);
  }
  assert.equal(zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length, 0);

  // …and the terminated employee, whose record the gate re-reads.
  audit = new AuditLogger();
  caseStore = new CaseStore();
  const terminated = {
    getEmployment: async (id) => ({ ...(await remote.getEmployment(id)), status: "terminated" }),
    listCountries: (...a) => remote.listCountries(...a),
    getLegalEntity: (...a) => remote.getLegalEntity(...a),
  };
  const gone = await ask(STANDARD_LETTER_REQUEST, { externalRef: "refuse-terminated" }, { remote: terminated });
  assert.equal(gone.decision, "escalate");
  assert.equal(gone.reason, "employee_not_active");
  assert.equal(docsFor(gone.caseId).length, 0);
});

test("REFUSAL 4: an unreadable letterhead issues nothing, drafts nothing, and reaches a person", async () => {
  // `cc551b4` closed this: a letter with a blank entity name must never be
  // written, let alone sent. Auto-issue must not undo it, and the gate — not a
  // later line — is what decides, so the recorded reason names the rung that
  // really stopped it.
  const noEntity = {
    getEmployment: (...a) => remote.getEmployment(...a),
    listCountries: (...a) => remote.listCountries(...a),
    getLegalEntity: async () => null, // RemoteClient's documented 404 convention
  };
  const result = await ask(
    STANDARD_LETTER_REQUEST,
    { source: "zendesk", externalRef: "refuse-letterhead" },
    { remote: noEntity, zendesk }
  );

  assert.equal(result.decision, "human_review");
  assert.equal(result.reason, "formal_letter_requested");
  assert.ok(result.flags.includes("letterhead_unavailable"), "the flag names the cause");
  assert.equal(result.letterHtml, undefined, "nothing was rendered");
  assert.equal(docsFor(result.caseId).length, 0, "and nothing was stored");
  assert.equal(result.letterDraft.drafted, false);
  assert.equal(result.letterDraft.issued, false);
  assert.match(result.letterDraft.blocked.detail, /no usable legal entity|names no legal entity/);

  // A PERSON IS HOLDING IT, and the note tells them what the job actually is —
  // a record fix, not a signature on a document that does not exist.
  const queued = caseStore.reviewQueue.find((r) => r.caseId === result.caseId);
  assert.ok(queued, "somebody has it");
  assert.match(queued.notes, /NO LETTER WAS DRAFTED/);
  assert.match(queued.notes, /Fix the employing-entity record/);
  assert.equal(zendeskCalls.filter((c) => c.kind === "resolveWithLetter").length, 0);

  // …and the sign-off route refuses it by its own name rather than issuing an
  // unseen document.
  const refused = await submitTravelLetterSignoff(
    { caseId: result.caseId, action: "signoff", approver: SPECIALIST },
    { remote: noEntity, audit, caseStore }
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "letter_missing");
});

// ---------------------------------------------------------------------------
// 4. STRUCTURAL — the guarantees that must not depend on a scenario
// ---------------------------------------------------------------------------

test("an omitted letterhead is the SIGNATURE path, never the issuing one — the default fails closed", () => {
  // `evaluate()`'s `letterheadAvailable` defaults to false, so a caller that has
  // established nothing gets the cautious outcome. A letter is never issued by
  // omission, and this is asserted on the DEFAULT rather than through the
  // workflow, because the workflow is only one of `evaluate()`'s callers — the
  // n8n port is another, and its own graph may have no legal-entity node at all.
  const source = readFileSync(new URL("../src/uc03/policyEngine.js", import.meta.url), "utf8");
  assert.match(source, /letterheadAvailable = false/, "the cautious value is the default, in the signature itself");
  assert.match(source, /letterAutoIssue = true/, "and the policy default is the owner's decision, stated once");
});

test("the issuing rung's decision facts are a SUCCESS bundle, and name what authorised the document", () => {
  // Every other bundle this function returns explains a refusal, and
  // `all_gates_passed` returns null because nothing was refused. This one is
  // different on purpose: the outcome is an ACT, and the figures that authorised
  // it are the only account of why a document left the building.
  const facts = describeDecisionFacts({
    reason: "standard_letter_issued",
    classification: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", confidence: 0.9 },
  });
  assert.ok(facts, "an issued letter must not be the one outcome with nothing to show");
  const labels = facts.facts.map((f) => f.label);
  assert.ok(labels.includes("Letter issued"));
  assert.ok(labels.includes("What stood in for a signer"));
  assert.ok(labels.includes("Letter scope"));
  assert.ok(labels.includes("Trip length"));
  assert.equal(facts.facts.find((f) => f.label === "Letter issued").value, "yes");
});

test("the n8n port reaches the same three outcomes on the same inputs", async () => {
  // The gates exist twice (CLAUDE.md §6). `test/n8nUc03Parity.test.js` compares
  // the two engines scenario by scenario; this asserts the narrower thing that
  // file cannot, because its harness has no legal-entity node: that the PORT
  // carries all three arms of the split rung and the same fail-closed default.
  const port = readFileSync(new URL("../workflows/nodes-uc03/travelRouterGates.js", import.meta.url), "utf8");
  assert.match(port, /reason: 'standard_letter_issued'/, "the issuing arm exists in the port");
  assert.match(port, /letterhead_unavailable/, "so does the cause flag");
  assert.match(port, /readLetterheadAvailable/, "and the port establishes the letterhead itself");
  assert.match(
    port,
    /catch \{\s*return false;/,
    "a graph with no legal-entity node resolves to the signature path, not to an errored run"
  );
});

// ---------------------------------------------------------------------------
// 5. THE RECOMMENDATION — the second half of the owner's statement
// ---------------------------------------------------------------------------
// "Some parts of things that have some legal implications, the system can decide
//  and recommend an action to the expert, but submit for approval."
//
// Before this, a specialist opening a UC-03 letter case got a COMPILED CASE —
// decision slug, deciding rung, gate ladder, the figures each rung compared, the
// request's own words, the document — and no sentence saying what this system
// thought should happen. These tests pin the proposal and, more importantly, the
// three things that stop it becoming a decision.

test("a signable letter arrives with a stated recommendation, its reasons, and what the human must still check", async () => {
  const result = await ask(STANDARD_LETTER_REQUEST, { externalRef: "rec-1" }, { letterAutoIssue: false });
  assert.equal(result.reason, "formal_letter_requested");

  const handler = createUc03Handler({ caseStore, audit, remote });
  const view = await callApi(handler, { method: "GET", path: `/api/cases/${result.caseId}` });

  const rec = view.body.recommendation;
  assert.ok(rec, "a case waiting on a person must say what this system would do");
  assert.equal(rec.isRecommendation, true, "marked as a proposal, never as a fact");
  // THE VERB MATCHES THE ROUTE. Naming an action the API does not have is how a
  // recommendation becomes a dead button one release later.
  assert.equal(rec.action, "signoff");
  assert.ok(rec.because.length >= 2, "reasons to agree");
  assert.ok(rec.check.length >= 2, "…and what the reviewer is asked to confirm that this system could not");
  assert.ok(
    rec.check.some((c) => /consulate|destination authority/i.test(c)),
    "the first thing the gates cannot see is whether the document suits the authority that will read it"
  );
  assert.ok(
    rec.check.some((c) => /re-read/i.test(c)),
    "and the one refusal that arrives after the click is named before it"
  );
});

test("the recommendation never proposes a click the policy would refuse", async () => {
  // A letter case with no drafted document is the only way a NEW request reaches
  // a specialist on the default posture, and `signoffPolicy.js` refuses both
  // verbs on it. So the proposal must not be "sign it off" — it must name the
  // real job, which is a record fix.
  const noEntity = {
    getEmployment: (...a) => remote.getEmployment(...a),
    listCountries: (...a) => remote.listCountries(...a),
    getLegalEntity: async () => null,
  };
  const blocked = await ask(STANDARD_LETTER_REQUEST, { externalRef: "rec-2" }, { remote: noEntity });
  const handler = createUc03Handler({ caseStore, audit, remote: noEntity });
  const view = await callApi(handler, { method: "GET", path: `/api/cases/${blocked.caseId}` });

  assert.equal(view.body.actionable, false);
  const rec = view.body.recommendation;
  assert.ok(rec, "'not actionable' with no proposal leaves the specialist with nothing to do");
  assert.equal(rec.action, null, "there is no verb this route can take here");
  assert.match(rec.label, /fix the employing-entity record/i);
  assert.ok(rec.because.some((b) => /would have been issued/i.test(b)), "and it says the trip itself is fine");

  // …and an escalation, which nobody signs, proposes nothing at all rather than
  // an empty bundle that reads like missing data.
  const escalated = await ask(
    "I need a travel letter for a trip to Russia from 2026-09-20 to 2026-09-26.",
    { externalRef: "rec-3" }
  );
  const escView = await callApi(handler, { method: "GET", path: `/api/cases/${escalated.caseId}` });
  assert.equal(escView.body.recommendation, null);
});

test("the recommendation decides nothing — only the read view consults it", async () => {
  // STRUCTURAL, not behavioural. A proposal some code path can act on is not a
  // proposal. `recommendLetterAction` may be DEFINED in signoffPolicy.js and
  // READ by the GET view; anywhere else in src/uc03/ would be a gate consulting
  // its own advice.
  const { readdirSync, readFileSync: read } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "uc03");
  const callers = readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => read(join(dir, f), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "").includes("recommendLetterAction"));
  assert.deepEqual(callers.sort(), ["server.js", "signoffPolicy.js"]);

  // …and the workflow — which is where every decision and every write lives —
  // never mentions it at all.
  const workflow = read(join(dir, "workflow.js"), "utf8");
  assert.ok(!workflow.includes("recommendLetterAction"));
});

// ---------------------------------------------------------------------------
// 6. WHAT THE LADDER SAYS ABOUT ITSELF
// ---------------------------------------------------------------------------
// A requester asked for a travel letter for a visa application, the letter was
// correctly written and issued to them — and the page told them:
//
//   "Decided by gate 13 of 14 — standard_letter. That gate checks: the request
//    is informational and does not ask for a formal travel letter."
//
// The DECISION was right and the account of it was the exact opposite of what
// happened. That sentence is leftover wording from before `7061c40` split the
// letter path in two: it is the condition for rung 14, one rung further down.
// Nothing caught it, because every existing test on this rung asserts the
// decision, the document or the audit row — and `checks` is prose, which no
// assertion about behaviour can reach.
//
// So these tests are deliberately NOT a hand-written equality on one string. A
// pinned sentence proves that one sentence is the one somebody typed; it says
// nothing about the next rung somebody adds. What is pinned instead is the
// PROPERTY that failed: a rung must not describe itself as sitting on one side
// of a branch in `checks` and the other side in `means`.
// ---------------------------------------------------------------------------

/** Phrases that place a rung on the "a formal letter was asked for" branch. */
const ON_LETTER_BRANCH = [
  /ask(s|ed)? for (a|the) (standard|formal) travel letter/i,
  /letter was asked for/i,
  /a requested letter/i,
];

/** Phrases that place a rung on the "this is an informational inquiry" branch. */
const ON_INFORMATIONAL_BRANCH = [
  /does not ask for a formal travel letter/i,
  /the request is informational/i,
  /none was asked for/i,
];

const branchOf = (text) => ({
  letter: ON_LETTER_BRANCH.some((re) => re.test(text)),
  informational: ON_INFORMATIONAL_BRANCH.some((re) => re.test(text)),
});

test("the issuing rung's `checks` describes the letter branch it actually tests", () => {
  const rung = GATE_SEQUENCE.find((r) => r.reason === "standard_letter_issued");
  assert.match(
    rung.checks,
    /ask(s|ed)? for the standard travel letter/i,
    "this rung is reached only when a formal letter was asked for — that is its whole condition"
  );
  assert.doesNotMatch(
    rung.checks,
    /does not ask for a formal travel letter|the request is informational/i,
    "that is rung 14's condition, and it is what shipped here"
  );
  // Through the bound describer as well, because that — not the raw row — is
  // what `src/portal/server.js` and the ZAF sidebar render to a person.
  assert.equal(describeDecidingGate("standard_letter_issued").checks, rung.checks);
});

test("STRUCTURAL: no rung puts its `checks` on one branch and its `means` on the other", () => {
  for (const rung of GATE_SEQUENCE) {
    const checks = branchOf(rung.checks);
    const means = branchOf(rung.means);
    assert.ok(
      !(checks.informational && means.letter),
      `${rung.reason}: 'checks' says no letter was asked for while 'means' says one was — the requester is told the opposite of what happened`
    );
    assert.ok(
      !(checks.letter && means.informational),
      `${rung.reason}: 'checks' says a letter was asked for while 'means' says none was`
    );
  }
});

test("STRUCTURAL: only the informational outcome may claim the informational branch", () => {
  // Two rungs are terminal outcomes of the SAME branch point, so exactly one of
  // them can be the no-letter side. A second rung claiming it is either a copied
  // sentence or a rung in the wrong place; both were how this defect looked.
  const claiming = GATE_SEQUENCE.filter((r) => branchOf(r.checks).informational).map((r) => r.reason);
  assert.deepEqual(claiming, [], "no rung's condition is 'they did not ask for a letter' — rung 14's is 'every gate above passed'");

  const terminal = GATE_SEQUENCE.filter((r) => ["standard_letter_issued", "all_gates_passed"].includes(r.reason));
  assert.equal(terminal.length, 2);
  assert.ok(branchOf(terminal[0].means).letter, "the issuing rung's meaning is that a letter WAS asked for");
  assert.ok(branchOf(terminal[1].means).informational, "and the other's is that none was");
});

test("STRUCTURAL: every `checks` still reads as a clause after 'which checks that'", () => {
  // `src/portal/server.js` renders "gate N of M — <gate>, which checks that
  // <checks>", and the sidebar renders "That gate checks: <checks>". A rung
  // written as a question ("whether the request asks…") or as a sentence of its
  // own breaks one of the two and reads as a glitch in the other.
  for (const rung of GATE_SEQUENCE) {
    assert.match(rung.checks, /^[a-z]/, `${rung.reason}'s 'checks' must continue a sentence, not start one`);
    assert.doesNotMatch(rung.checks, /^whether\b/i, `${rung.reason}'s 'checks' reads as "checks that whether…"`);
    assert.doesNotMatch(rung.checks, /\.$/, `${rung.reason}'s 'checks' ends a sentence the caller is still writing`);
  }
});

test("nothing a requester or a specialist reads is written in this codebase's vocabulary", () => {
  // The standing instruction behind this: "all your Zendesk bars are made for
  // the person building, not the person using it." What must SURVIVE is honesty
  // about limits and provenance — "an illustrative demonstration set, NOT
  // Remote's authoritative compliance list" is a specialist being told how far
  // the evidence goes, and it stays. What must go is the vocabulary: file paths,
  // field names, table names, type names, data formats.
  //
  // Two identifiers are deliberately NOT banned, because in each case the reader
  // sees that exact token elsewhere on the same screen and needs it to find the
  // thing being named: the `letterhead_unavailable` FLAG (rendered beside the
  // decision) and `supportedCountriesChecked` (the name the country list is
  // recorded under in the decision's audit entry — pinned by
  // test/lowTierExceptionData.test.js, which asserts the note names where the
  // real set is).
  const BANNED = [
    /ISO alpha-2/i,
    /alpha-3/i,
    /audit_log/,
    /sha256/i,
    /\.js\b/,
    /src\//,
    /normalise[d]? to/i,
    /membership test/i,
    /EOR-capability/i,
    /auto-execute/i,
    /tier model/i,
    /\bdeployment\b/i,
    /\bendpoint\b/i,
    /\bpayload\b/i,
    /\bboolean\b/i,
    /\bAPI\b/,
  ];

  /** Every string this file puts in front of a person, for every outcome. */
  const surfaces = [];
  for (const rung of GATE_SEQUENCE) surfaces.push(rung.checks, rung.means);
  for (const rung of GATE_SEQUENCE) {
    const bundle = describeDecisionFacts({
      reason: rung.reason,
      employment: { id: EMPLOYEE, status: "active", country_code: "PT", legal_entity_id: "le_1" },
      identity: { verified: false, method: "session", reason: "session_employment_mismatch" },
      classification: {
        destinationCountry: "DE",
        startDate: "2026-09-20",
        endDate: "2026-09-26",
        confidence: 0.9,
        intent: "travel_support",
        source: "llm",
        formalLetterRequested: true,
      },
      supportedCountries: new Set(["DE", "PT"]),
      requestText: STANDARD_LETTER_REQUEST,
    });
    if (!bundle) continue;
    surfaces.push(bundle.sentence);
    for (const f of bundle.facts) surfaces.push(f.label, String(f.value ?? ""), String(f.note ?? ""));
  }

  for (const text of surfaces) {
    for (const banned of BANNED) {
      assert.doesNotMatch(text, banned, `a reader is shown this codebase's own vocabulary: "${text}"`);
    }
  }
});
