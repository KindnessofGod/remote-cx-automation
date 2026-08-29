// ---------------------------------------------------------------------------
// portalUc01LetterAccess.test.js  —  round-6 D-01: the letter the employee
// asked for, in the employee's own hands
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST
//
// UC-01's self-service letter (src/uc01/selfServiceLetter.js, L-14) writes and
// issues the standard employment verification letter in ONE call, with nobody
// in the path — and until this pass, the employee who asked for it could never
// actually reach it. The initial response discarded the letter after returning
// it (the browser never read `letterHtml`), and the record it wrote to `cases`
// had no ownership rule at all: `GET /api/my-requests` answered
// `"reason":"No ownership rule exists for uc01."` for every employee, always.
// Round 6 evidenced this live (`qa/evidence/UC-01/2026-08-22-uc01-e2e-6/
// OPEN-DEFECTS.md` D-01, D-03) — a letter that is correct, durable, audited,
// and reaches nobody, which is this repository's most expensive recurring
// shape (CLAUDE.md §7's honest-gaps list).
//
// This file pins the fix the same way test/portalLetterAccess.test.js pins
// UC-03's: the letter is on the SUBMISSION response, it is on the "My
// requests" row, the row and the fetch route agree on the same verdict, and
// only the employee it is about may ever collect it.
//
// HERMETIC: mock Remote dispatched in-process, no port bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { describeUc01LetterForRequester, LETTER_STATES } from "../src/portal/letterAccess.js";
import { LETTER_DOCUMENT_TYPE } from "../src/uc01/letterDelivery.js";
import { describeStatus, STATES } from "../src/portal/requestStatus.js";
import { ownerScopeFor } from "../src/portal/ownership.js";
import { PERSONAS } from "../src/portal/personas.js";

function call(handler, { method = "POST", path, body = null }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {},
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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

function portal({ renderPdf = undefined } = {}) {
  const stores = buildPortalStores();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({ remote, audit: new AuditLogger(), stores, llm: {}, renderPdf });
  return { handler, stores };
}

const listFor = (handler, persona) => call(handler, { method: "GET", path: `/api/my-requests?persona=${persona}` });
const issue = (handler, persona, externalRef) =>
  call(handler, { path: "/api/requests/uc01", body: { persona, externalRef } });

// ---------------------------------------------------------------------------
// 1. THE OWNERSHIP RULE — "My requests" must list it at all
// ---------------------------------------------------------------------------

test("ownerScopeFor scopes uc01 as self-service — the rule round 6 found missing", () => {
  const scope = ownerScopeFor(PERSONAS.chris, "uc01");
  assert.equal(scope.scoped, true, `'No ownership rule exists for uc01' must not be reachable — got: ${scope.reason}`);
  assert.equal(scope.query.employmentId, PERSONAS.chris.employmentId);
  assert.equal(scope.query.useCase, "UC-01", "cases is shared with UC-03 — the scope must name which use case's rows these are");

  // An admin cannot file one, so an admin session owns none — same shape as
  // every other self-service type, refused for the same reason.
  const adminScope = ownerScopeFor(PERSONAS.admin, "uc01");
  assert.equal(adminScope.scoped, false);
  assert.match(adminScope.reason, /employee/i);
});

test("the issued letter appears in My requests, with a real status and no more 'No ownership rule' refusal", async () => {
  const { handler } = portal();
  const filed = await issue(handler, "chris", "uc01-letter-access-1");
  assert.equal(filed.body.ok, true);
  assert.equal(filed.body.decision, "auto_resolve");

  const list = await listFor(handler, "chris");
  assert.equal(list.status, 200);
  const row = list.body.requests.find((r) => r.useCase === "UC-01");
  assert.ok(row, "the issued letter is not in My requests at all — the round-6 D-01 defect");
  assert.equal(list.body.notListed.some((n) => n.type === "uc01"), false, "uc01 must not appear in notListed any more");

  assert.equal(row.status.state, STATES.AUTO_RESOLVED);
  assert.equal(row.status.label, "Issued");
});

test("a self-service case never leaks into the shared UC-03 listing, or vice versa", async () => {
  const { handler } = portal();
  await issue(handler, "chris", "uc01-shared-table-1");
  await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text: "Can I work from Spain for two weeks in September?", externalRef: "uc01-shared-table-2" },
  });

  const list = await listFor(handler, "chris");
  const uc01Rows = list.body.requests.filter((r) => r.type === "uc01");
  const uc03Rows = list.body.requests.filter((r) => r.type === "uc03");
  assert.equal(uc01Rows.length, 1);
  assert.equal(uc03Rows.length, 1);
  // Each row must read in ITS OWN vocabulary, not the other's — the exact
  // failure CaseStore.listByOwner()'s own header warns about.
  assert.notEqual(uc01Rows[0].status.state, STATES.UNKNOWN);
  assert.notEqual(uc03Rows[0].status.state, STATES.UNKNOWN);
});

// ---------------------------------------------------------------------------
// 2. THE LETTER ITSELF — reachable from the moment it is issued
// ---------------------------------------------------------------------------

test("the submission response already carries a collect route — route 1's core defect", async () => {
  const { handler } = portal();
  const filed = await issue(handler, "chris", "uc01-immediate-1");
  assert.equal(filed.body.ok, true);
  assert.ok(filed.body.letter, "the initial response must say where to collect the letter it just issued");
  assert.equal(filed.body.letter.state, LETTER_STATES.ISSUED);
  assert.ok(filed.body.letter.collect, "an issued letter with nowhere to collect it is the defect this closes");
  assert.equal(filed.body.letter.collect.method, "POST");
  // RELATIVE, no leading slash — the exact production outage
  // test/portalLetterAccess.test.js's UC-03 tests already pin for that route.
  assert.equal(filed.body.letter.collect.path, "api/requests/uc01/letter");
});

test("the employee collects the bytes, the hash, and a filename that does not name them", async () => {
  const { handler } = portal();
  const filed = await issue(handler, "chris", "uc01-collect-1");

  const got = await call(handler, {
    path: filed.body.letter.collect.path,
    body: { persona: "chris", caseId: filed.body.recordId },
  });
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, true);
  assert.equal(got.body.code, "letter_available");
  assert.match(got.body.content, /Employment Verification Letter/);
  assert.equal(got.body.contentType, "text/html");
  assert.match(got.body.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(got.body.filename, `employment-verification-letter-${filed.body.recordId}.html`);
  assert.ok(!/chris|lee/i.test(got.body.filename), "the filename names the employee");
  assert.equal(got.body.issuedWithoutSignature, true);
});

test("the same collect route works from a cold history read too, not only right after issuance", async () => {
  const { handler } = portal();
  const filed = await issue(handler, "chris", "uc01-collect-cold");

  const row = (await listFor(handler, "chris")).body.requests.find((r) => r.useCase === "UC-01");
  assert.ok(row.document, "the my-requests row carries no document at all");
  assert.equal(row.document.state, LETTER_STATES.ISSUED);
  assert.ok(row.document.collect);

  const got = await call(handler, { path: row.document.collect.path, body: { persona: "chris", caseId: row.recordId } });
  assert.equal(got.status, 200);
  assert.ok(got.body.content);
  assert.equal(filed.body.recordId, row.recordId);
});

// ---------------------------------------------------------------------------
// 2b. THE PDF SIBLING — rca-cput (round-7 R7-21): "Save it" only ever offered
// the .html, and src/pdf/ already proves this exact letter renders to a real
// PDF. HERMETIC: `renderPdf` here is a fake that never launches Chromium —
// the real Playwright path is exercised only by `npm run pdf-demo`
// (CLAUDE.md §6's rule about heavyweight integrations and `npm test`).
// ---------------------------------------------------------------------------

test("the submission response also carries a collectPdf route", async () => {
  const { handler } = portal();
  const filed = await issue(handler, "chris", "uc01-pdf-route-1");
  assert.ok(filed.body.letter.collectPdf, "an issued letter should offer a PDF collection route alongside the HTML one");
  assert.equal(filed.body.letter.collectPdf.method, "POST");
  assert.equal(filed.body.letter.collectPdf.path, "api/requests/uc01/letter/pdf");
});

test("with no renderPdf configured, the PDF route refuses by its own name rather than failing silently", async () => {
  const { handler } = portal(); // no renderPdf
  const filed = await issue(handler, "chris", "uc01-pdf-unconfigured");

  const got = await call(handler, {
    path: filed.body.letter.collectPdf.path,
    body: { persona: "chris", caseId: filed.body.recordId },
  });
  assert.equal(got.status, 503);
  assert.equal(got.body.ok, false);
  assert.equal(got.body.code, "pdf_rendering_unavailable");
});

test("with renderPdf configured, the employee collects real PDF bytes under a .pdf filename", async () => {
  let calledWithHtml = null;
  const fakePdfBytes = Buffer.from("%PDF-1.4 fake");
  const renderPdf = async (html) => {
    calledWithHtml = html;
    return fakePdfBytes;
  };
  const { handler } = portal({ renderPdf });
  const filed = await issue(handler, "chris", "uc01-pdf-collect-1");

  const got = await call(handler, {
    path: filed.body.letter.collectPdf.path,
    body: { persona: "chris", caseId: filed.body.recordId },
  });
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, true);
  assert.equal(got.body.contentType, "application/pdf");
  assert.equal(got.body.encoding, "base64");
  assert.equal(got.body.filename, `employment-verification-letter-${filed.body.recordId}.pdf`);
  assert.equal(Buffer.from(got.body.content, "base64").toString("utf8"), fakePdfBytes.toString("utf8"));
  assert.match(calledWithHtml, /Employment Verification Letter/, "renderPdf should be handed the same HTML the .html route serves");
});

test("renderPdf throwing is reported as a render failure, never as a broken 200", async () => {
  const renderPdf = async () => {
    throw new Error("chromium exploded");
  };
  const { handler } = portal({ renderPdf });
  const filed = await issue(handler, "chris", "uc01-pdf-throws");

  const got = await call(handler, {
    path: filed.body.letter.collectPdf.path,
    body: { persona: "chris", caseId: filed.body.recordId },
  });
  assert.equal(got.status, 502);
  assert.equal(got.body.code, "pdf_render_failed");
});

test("the PDF route obeys the exact same access gate as the HTML route", async () => {
  const renderPdf = async () => Buffer.from("irrelevant");
  const { handler } = portal({ renderPdf });
  const filed = await issue(handler, "chris", "uc01-pdf-not-yours");

  const someoneElse = await call(handler, {
    path: "api/requests/uc01/letter/pdf",
    body: { persona: "emma", caseId: filed.body.recordId },
  });
  assert.equal(someoneElse.status, 403);
  assert.equal(someoneElse.body.code, "not_the_employee");
  assert.ok(!someoneElse.body.content);

  const anonymous = await call(handler, { path: "api/requests/uc01/letter/pdf", body: { caseId: filed.body.recordId } });
  assert.equal(anonymous.status, 401);
  assert.ok(!anonymous.body.content);
});

// ---------------------------------------------------------------------------
// 3. NOBODY ELSE'S — prime directive #3, applied to a self-service artifact
// ---------------------------------------------------------------------------

test("another employee cannot collect a letter that is not theirs, and an unauthenticated caller cannot either", async () => {
  const { handler } = portal();
  const filed = await issue(handler, "chris", "uc01-not-yours");

  const someoneElse = await call(handler, {
    path: "api/requests/uc01/letter",
    body: { persona: "emma", caseId: filed.body.recordId },
  });
  assert.equal(someoneElse.status, 403);
  assert.equal(someoneElse.body.code, "not_the_employee");
  assert.ok(!someoneElse.body.content, "a refusal handed over the document");

  const anonymous = await call(handler, { path: "api/requests/uc01/letter", body: { caseId: filed.body.recordId } });
  assert.equal(anonymous.status, 401);
  assert.ok(!anonymous.body.content);

  const hers = await listFor(handler, "emma");
  assert.ok(
    !hers.body.requests.some((r) => r.recordId === filed.body.recordId),
    "another employee's history lists a case that is not theirs"
  );
});

test("a case id from the shared UC-03 store reads as no such case, not as a missing letter", async () => {
  const { handler } = portal();
  const trip = await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text: "Can I work from Spain for two weeks in September?", externalRef: "uc01-cross-scope" },
  });
  assert.equal(trip.body.ok, true);

  const got = await call(handler, { path: "api/requests/uc01/letter", body: { persona: "chris", caseId: trip.body.recordId } });
  assert.equal(got.status, 404);
  assert.equal(got.body.code, "case_not_found");
});

// ---------------------------------------------------------------------------
// 4. THE PURE DESCRIBER, ON ITS OWN TERMS
// ---------------------------------------------------------------------------

test("describeUc01LetterForRequester: issued for the owner, refused for a stranger, never an absence for an access problem", () => {
  const caseRow = { id: "case-uc01-1", employmentId: "emp-1", decision: "auto_resolve", reason: "self_service_all_gates_passed", status: "resolved" };
  const letterDocument = { id: "doc-1", type: LETTER_DOCUMENT_TYPE, contentHash: "a".repeat(64) };

  const mine = describeUc01LetterForRequester({ caseRow, letterDocument, session: { authenticatedEmploymentId: "emp-1" } });
  assert.equal(mine.state, LETTER_STATES.ISSUED);
  assert.ok(mine.collect);
  assert.ok(mine.collectPdf, "an issued letter should offer a PDF collection route too (rca-cput)");
  assert.equal(mine.collectPdf.path, "api/requests/uc01/letter/pdf");

  const theirs = describeUc01LetterForRequester({ caseRow, letterDocument, session: { authenticatedEmploymentId: "emp-2" } });
  assert.equal(theirs.collect, null);
  assert.equal(theirs.collectPdf, undefined);
  assert.notEqual(theirs.label, "None", "an access refusal must not read as an absence of a letter");
  assert.match(theirs.detail, /only be collected by the employee it is about/);

  const noSession = describeUc01LetterForRequester({ caseRow, letterDocument, session: null });
  assert.equal(noSession.collect, null);
});

test("requestStatus's uc01 describer reports a resolved case as issued, and any other status as unknown rather than guessed", () => {
  const resolved = describeStatus("uc01", { status: "resolved" });
  assert.equal(resolved.state, STATES.AUTO_RESOLVED);
  assert.equal(resolved.label, "Issued");

  const unrecognised = describeStatus("uc01", { status: "something_new" });
  assert.equal(unrecognised.state, STATES.UNKNOWN);
  assert.equal(unrecognised.storeStatus, "something_new");
});
