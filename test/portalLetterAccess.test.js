// ---------------------------------------------------------------------------
// portalLetterAccess.test.js  —  the letter exists, and now it can be reached
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST
//
// The project owner, reading "My requests" with a UC-03 letter request in it:
//
//   "This should not end here. A travel letter was requested. It should be
//    recorded, and the user should be able to download the letter. The question
//    now is: from where?"
//
// The letter was real the whole time — rendered, hashed, stored as a
// `travel_support_letter` in `documents`, its sha256 on the decision's audit
// row. The history row showed a status and a sentence, with no sign a document
// existed and no way to get it. **A decision that is correct, durable, audited
// and reaches nobody** is the failure shape `CLAUDE.md` §7's honest-gaps list
// now names five times over, and an ISSUED document nobody can fetch is its
// worst version, because the audit row records a delivery.
//
// THREE STATES, AND THE TEST IS MOSTLY ABOUT TELLING THEM APART. `issued` gets a
// route. `drafted` gets a sentence naming who holds it and NO control — a
// download there would promise a document the sign-off gate exists to withhold.
// `none` gets whichever of the four "no letter" situations this is. Reporting
// any of them as another is the defect this file exists to catch.
//
// AND THE TRAVELLER MAY FETCH THEIR OWN AND NOBODY ELSE'S. The gate is
// src/uc03/letterDelivery.js's `evaluateLetterDelivery()` — not restated here
// and not restated in the portal either; §3 pins that the badge on the row and
// the fetch route are computed from the SAME verdict, which is what stops the
// page offering a save on something the route would refuse.
//
// HERMETIC: mock Remote dispatched in-process, the rule-based classifier passed
// explicitly, no port bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { describeLetterForRequester, LETTER_STATES } from "../src/portal/letterAccess.js";
import { LETTER_DOCUMENT_TYPE, ISSUED_REASON } from "../src/uc03/letterDelivery.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

const TRIP = "I am travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?";
const LETTER_ASK =
  "Could you send me a formal travel support letter for my trip to Germany from 2026-09-10 to 2026-09-20 for a visa appointment?";

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

function portal() {
  const stores = buildPortalStores();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores,
    llm: { classifyTravel: classifyTravelInquiryRuleBased },
  });
  return { handler, stores };
}

const listFor = (handler, persona) => call(handler, { method: "GET", path: `/api/my-requests?persona=${persona}` });
const rowOf = (list, reason) => list.body.requests.find((r) => r.reason === reason);

// ---------------------------------------------------------------------------
// 1. AN ISSUED LETTER IS ON THE ROW, AND THE ROW SAYS WHERE TO GET IT
// ---------------------------------------------------------------------------

test("a letter request that issued shows as ready, and names the route that hands it over", async () => {
  const { handler } = portal();
  const filed = await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text: LETTER_ASK, externalRef: "letter-access-1" },
  });
  assert.equal(filed.body.ok, true);
  assert.equal(filed.body.reason, ISSUED_REASON, "the standard letter no longer issues — re-point this test");

  const list = await listFor(handler, "chris");
  const row = rowOf(list, ISSUED_REASON);
  assert.ok(row, "the issued letter request is not in My requests at all");
  assert.equal(row.document.state, LETTER_STATES.ISSUED);
  assert.ok(row.document.collect, "an issued letter with nowhere to collect it is the defect this closes");
  assert.equal(row.document.collect.method, "POST");
  // RELATIVE, no leading slash — see the last test in this file. This
  // assertion pinned the absolute form and so pinned the outage.
  assert.equal(row.document.collect.path, "api/requests/uc03/letter");
});

test("the traveller collects the bytes, the hash that names them, and a filename they will recognise", async () => {
  const { handler } = portal();
  await call(handler, { path: "/api/requests/uc03", body: { persona: "chris", text: LETTER_ASK, externalRef: "letter-access-2" } });
  const row = rowOf(await listFor(handler, "chris"), ISSUED_REASON);

  const got = await call(handler, {
    path: row.document.collect.path,
    body: { persona: "chris", caseId: row.recordId },
  });
  assert.equal(got.status, 200);
  assert.equal(got.body.ok, true);
  assert.equal(got.body.code, "letter_available");

  // THE DOCUMENT ITSELF, not a promise of one.
  assert.match(got.body.content, /^<!doctype html>/i);
  assert.ok(got.body.content.length > 500, "the letter came back empty");
  assert.equal(got.body.contentType, "text/html");

  // THE HASH TRAVELS WITH THE CONTENT, never instead of it — it is what the
  // audit row records, so a reader holding the letter can check that what they
  // were handed is what history says was issued.
  assert.match(got.body.contentHash, /^[0-9a-f]{64}$/);

  // A NAME A PERSON RECOGNISES IN A DOWNLOADS FOLDER, and one that does not
  // name the employee: a filename ends up in shared folders and mail clients.
  assert.equal(got.body.filename, `travel-letter-${row.recordId}.html`);
  assert.ok(!/chris|lee/i.test(got.body.filename), "the filename names the employee");

  // WHO SIGNED IT, stated rather than inferred from the absence of a name.
  assert.equal(got.body.issuedWithoutSignature, true);
});

// ---------------------------------------------------------------------------
// 2. THE TRAVELLER'S OWN, AND NOBODY ELSE'S
// ---------------------------------------------------------------------------
// Prime directive #3 — identity comes from an authenticated signal, never a
// claim. The persona is a KEY resolved against the server's own map; the
// session behind it is never in the body, and the letter names one person,
// their job title and their base compensation.

test("another employee cannot collect a letter that is not theirs, and an unauthenticated caller cannot either", async () => {
  const { handler } = portal();
  await call(handler, { path: "/api/requests/uc03", body: { persona: "chris", text: LETTER_ASK, externalRef: "letter-access-3" } });
  const row = rowOf(await listFor(handler, "chris"), ISSUED_REASON);

  const someoneElse = await call(handler, { path: "/api/requests/uc03/letter", body: { persona: "emma", caseId: row.recordId } });
  assert.equal(someoneElse.status, 403);
  assert.equal(someoneElse.body.code, "not_the_traveller");
  assert.ok(!someoneElse.body.content, "a refusal handed over the document");

  const anonymous = await call(handler, { path: "/api/requests/uc03/letter", body: { caseId: row.recordId } });
  assert.equal(anonymous.status, 401);
  assert.ok(!anonymous.body.content);

  // AND THE LISTING AGREES. Emma's own history must not carry Chris's letter —
  // and must not carry a row for it at all.
  const hers = await listFor(handler, "emma");
  assert.ok(
    !hers.body.requests.some((r) => r.recordId === row.recordId),
    "another employee's history lists a case that is not theirs"
  );
});

test("a case id from another use case reads as no such case, not as a missing letter", async () => {
  const { handler } = portal();
  const expense = await call(handler, {
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_taxi_lisbon", externalRef: "letter-access-4" },
  });
  assert.equal(expense.body.ok, true);

  const got = await call(handler, {
    path: "/api/requests/uc03/letter",
    body: { persona: "chris", caseId: expense.body.recordId },
  });
  assert.equal(got.status, 404);
  assert.equal(got.body.code, "case_not_found");
});

// ---------------------------------------------------------------------------
// 3. THE ROW AND THE ROUTE ARE THE SAME VERDICT
// ---------------------------------------------------------------------------
// The property that makes the button safe. If the badge were computed from
// anything other than `evaluateLetterDelivery()`, the page could offer a save
// on a letter the fetch refuses — which is the same class of defect as an
// approve button on a case nobody can approve.

test("a row never offers to collect a letter the fetch route would refuse", async () => {
  const { handler } = portal();
  await call(handler, { path: "/api/requests/uc03", body: { persona: "chris", text: LETTER_ASK, externalRef: "letter-access-5a" } });
  await call(handler, { path: "/api/requests/uc03", body: { persona: "chris", text: TRIP, externalRef: "letter-access-5b" } });

  const list = await listFor(handler, "chris");
  assert.equal(list.body.requests.length, 2);

  for (const row of list.body.requests) {
    const got = await call(handler, { path: "/api/requests/uc03/letter", body: { persona: "chris", caseId: row.recordId } });
    if (row.document.collect) {
      assert.equal(got.status, 200, `${row.reason} offered a collect the route refused (${got.body.code})`);
      assert.ok(got.body.content);
    } else {
      assert.notEqual(got.status, 200, `${row.reason} offered no collect and the route handed the letter over anyway`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. THE THREE STATES, TOLD APART
// ---------------------------------------------------------------------------

test("an informational answer says no letter was written, and why — with no control", async () => {
  const { handler } = portal();
  await call(handler, { path: "/api/requests/uc03", body: { persona: "chris", text: TRIP, externalRef: "letter-access-6" } });
  const row = rowOf(await listFor(handler, "chris"), "all_gates_passed");

  assert.equal(row.document.state, LETTER_STATES.NONE);
  assert.equal(row.document.collect, null, "a request with no letter offers a way to collect one");
  // "No letter" is four situations and this is the one that is not a problem:
  // nobody asked for one, and the offer is still open.
  assert.match(row.document.detail, /no travel letter was asked for/);
});

test("a drafted letter names who is holding it and offers nothing to download", () => {
  // CONSTRUCTED, and it has to be: on the current gates a standard letter
  // issues itself, so the only rows that hold a DRAFT are letter requests whose
  // trip qualifies but whose letterhead could not be read — the signed path. The
  // state must still be told apart from both of its neighbours, because a
  // download here would hand over a document the sign-off gate exists to hold.
  const drafted = describeLetterForRequester({
    caseRow: {
      id: "case-drafted",
      employmentId: "emp-1",
      decision: "human_review",
      reason: "formal_letter_requested",
      status: "awaiting_review",
    },
    letterDocument: { id: "doc-1", type: LETTER_DOCUMENT_TYPE, contentHash: "a".repeat(64) },
    session: { authenticatedEmploymentId: "emp-1" },
  });

  assert.equal(drafted.state, LETTER_STATES.DRAFTED);
  assert.equal(drafted.collect, null, "a drafted letter offered a download");
  assert.match(drafted.detail, /Travel & Mobility Support/, "a drafted letter does not say who is holding it");
});

test("a signed-off letter from the old path is still collectable, and a stranger's is not", () => {
  const signedOff = {
    id: "case-signed",
    employmentId: "emp-1",
    decision: "human_review",
    reason: "formal_letter_requested",
    status: "resolved",
  };
  const letter = { id: "doc-2", type: LETTER_DOCUMENT_TYPE, contentHash: "b".repeat(64) };

  const mine = describeLetterForRequester({
    caseRow: signedOff,
    letterDocument: letter,
    session: { authenticatedEmploymentId: "emp-1" },
  });
  assert.equal(mine.state, LETTER_STATES.ISSUED);
  assert.ok(mine.collect);

  // AN ACCESS PROBLEM MUST NOT READ AS AN ABSENCE. "You have no letter" is the
  // reassuring direction and it is the one that gets believed.
  const theirs = describeLetterForRequester({
    caseRow: signedOff,
    letterDocument: letter,
    session: { authenticatedEmploymentId: "emp-2" },
  });
  assert.equal(theirs.collect, null);
  assert.equal(theirs.label, "Not available");
  assert.match(theirs.detail, /only be collected by the employee it is about/);
});

// ---------------------------------------------------------------------------
// 5. THE PAGE CANNOT EXECUTE THE DOCUMENT IT DISPLAYS
// ---------------------------------------------------------------------------
// The letter is HTML this system rendered and it carries a person's name, job
// title and base pay. It is displayed in a frame that cannot run script and
// cannot reach this page's origin, and it is saved by a link that never
// navigates. Both are structural, and both are read out of the file.

test("the letter is shown in an empty-sandbox iframe and never as a blob URL in this origin", () => {
  const app = read("app.js");
  const region = app.slice(app.indexOf("function showLetter("), app.indexOf("function saveLetter("));
  const code = region.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // AN EMPTY SANDBOX ATTRIBUTE IS THE RESTRICTIVE ONE. No allow-scripts, so
  // nothing in the document runs; no allow-same-origin, so the frame holds an
  // opaque origin and could not reach this page even if it did.
  assert.match(code, /frame\.setAttribute\("sandbox", ""\)/);
  assert.ok(!/allow-scripts/.test(code), "the letter frame allows scripts");
  assert.ok(!/allow-same-origin/.test(code), "the letter frame shares this page's origin");
  assert.match(code, /frame\.setAttribute\("srcdoc"/, "the letter must be inlined, not loaded from a URL");

  // A `blob:` URL INHERITS THE CREATING PAGE'S ORIGIN, so navigating to one
  // would run the document AS this page. The viewer must never open one.
  assert.ok(!/createObjectURL/.test(code), "the viewer opens a blob URL, which inherits this page's origin");
  assert.ok(!/window\.open|location\s*=/.test(code), "the viewer navigates to the document");

  // Text only, and no policy: the page renders what it is given.
  assert.ok(!/innerHTML/.test(code));
  assert.ok(!/=== "(auto_resolve|human_review|escalate|blocked)"/.test(code), "the viewer compares a decision string");
});

test("saving the letter downloads it and never loads it", () => {
  const app = read("app.js");
  const region = app.slice(app.indexOf("function saveLetter("), app.indexOf("function saveLetter(") + 1600);
  const code = region.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // A download attribute means the browser writes the file and no document is
  // ever loaded, so the HTML cannot execute anywhere.
  assert.match(code, /link\.download = payload\.filename/, "the filename must be the server's");
  assert.match(code, /URL\.revokeObjectURL\(href\)/, "the object URL outlives the download");
  assert.ok(!/window\.open/.test(code), "saving opens a window");
});

test("the document cell offers a control only where the server sent a route", () => {
  const app = read("app.js");
  const region = app.slice(app.indexOf("function documentCell("), app.indexOf("function collectLetter("));
  const code = region.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // The one branch, and it is on the server's own field. No decision string, no
  // state word compared — a state this file does not recognise still renders
  // its badge and its sentence and gets no buttons.
  assert.match(code, /if \(!doc\.collect\) return td;/);
  assert.ok(!/"issued"|"drafted"|LETTER_STATES/.test(code), "the cell decides what a state means");
  assert.ok(!/innerHTML/.test(code));

  // And the table has a header for it, or the cells are shifted one column left
  // of their names for every row on the page.
  assert.match(read("index.html"), /<th scope="col">Document<\/th>/);
});

// ---------------------------------------------------------------------------
// EVERY PATH THIS MODULE HANDS THE PAGE MUST BE RELATIVE
// ---------------------------------------------------------------------------
// "Open the letter" answered `no_such_use_case` in production while every test
// here passed. The collect path was written "/api/requests/uc03/letter" with a
// leading slash; the page fetches it verbatim, and the portal is mounted under
// /portal on the deployment and at the root by `npm run portal`. A leading
// slash resolves against the domain ROOT, so the request missed the mount and
// the router refused a path it had never heard of — to a requester who had just
// been told their letter was ready.
//
// The tests could not have caught it and a stricter version of them still
// could not: they drive the handler in-process with basePath "", where "/api/x"
// and "api/x" address the same thing. The bug is only observable through a
// prefix. So this asserts the PROPERTY that survives both mountings — the path
// is relative — rather than that any particular URL resolves.
test("no path handed to the page is absolute, so it resolves under whatever prefix the portal is mounted at", async () => {
  const { handler } = portal();
  await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text: LETTER_ASK, externalRef: "letter-access-relative" },
  });
  // Also file the informational trip, so the drafted/absent branches are walked
  // too: a path added to one of those later must obey the same rule.
  await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text: TRIP, externalRef: "letter-access-relative-2" },
  });

  const paths = [];
  const collect = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.path === "string") paths.push(node.path);
    for (const value of Object.values(node)) collect(value);
  };
  // Both the owner and a stranger, because a refusal is also a rendered state.
  for (const persona of ["chris", "amara"]) {
    const list = await listFor(handler, persona);
    collect(list.body);
  }

  assert.ok(paths.length > 0, "no paths were found at all — this test has stopped testing anything");
  for (const path of paths) {
    assert.ok(
      !path.startsWith("/"),
      `"${path}" is absolute, so the page fetches it from the domain root and misses the portal's mount`
    );
  }
});
