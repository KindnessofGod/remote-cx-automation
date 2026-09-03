// ---------------------------------------------------------------------------
// requesterFeedback.test.js  —  the requester is told what a person decided
// ---------------------------------------------------------------------------
// THE QUESTION THIS SUITE EXISTS FOR, in the words it was asked in:
//
//   "in real life when a client makes a request, they expect feedback. So the
//    approved — especially ones that require human review — or declined,
//    should not just remain on Zendesk but sent back to my own Remote UI."
//
// That is the other half of every human gate in this system. The gate runs, a
// specialist decides in the ZAF sidebar, and the person who filed the request
// is told nothing — so the only way to find out whether a human has answered
// is to ask a human. A gate whose outcome the requester cannot observe is only
// half a gate.
//
// Two requester surfaces, two halves of this file:
//   * src/portal/     — the eight request types with no Remote event API.
//   * src/remoteui/   — the Remote-product stand-in where a company admin
//                       requests a contract amendment (UC-06).
//
// THE TWO ASSERTIONS THAT MATTER, both POSITIVE, and both stated on the view
// the requester is actually served rather than on a store call:
//   1. a request decided by a named person MUST show as decided, naming them —
//      and must do so from a handler with NO memory of the submission, because
//      a serverless deployment builds a fresh handler per request and that is
//      the only environment a real requester ever touches;
//   2. one requester must NOT see another's.
//
// A negative-only suite could not tell these features apart from features that
// structurally cannot succeed — the most expensive recurring defect in this
// repo (CLAUDE.md §4/§5).
//
// AND THE BOUNDARY THAT MAKES IT SAFE: neither surface offers a control that
// could decide anything. Showing status is reading; deciding is not, and a
// second place to decide would be a second, unaudited one — on UC-06, with one
// signature where dual control requires two different people.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer, EXPENSES } from "../src/remote/mockServer.js";
import { startMockServer as startZendeskMock } from "../src/zendesk/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";

import { createPortalHandler } from "../src/portal/server.js";
import { STATES } from "../src/portal/requestStatus.js";
import { submitExpenseReview } from "../src/uc02/workflow.js";
import { OPEN_STATUSES } from "../src/uc02/reviewPolicy.js";

import { createRemoteUiHandler } from "../src/remoteui/server.js";
import { evaluateAmendmentVisibility } from "../src/remoteui/roles.js";
import { describeAmendmentStatus, STATES as AMENDMENT_STATES } from "../src/remoteui/amendmentStatus.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { submitAmendmentApproval } from "../src/uc06/workflow.js";
import { draftSummary } from "../src/uc06/changeParser.js";
import { REMOTE_UI_EMPLOYEES } from "../src/remoteui/employees.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftNarrative as draftRelocationNarrative } from "../src/uc07/dossierBuilder.js";
import { draftNarrative as draftTaxNarrative } from "../src/uc08/dossierBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// EPHEMERAL PORTS, and this file learned why the hard way. The test band
// (src/shared/ports.js's TEST_BAND, 4090-4099) is saturated: two files already
// share 4094, and the two literals first written here collided with
// escalationRouting.test.js and portal.test.js. `node --test` runs files in
// PARALLEL, so a collision does not fail loudly — sixteen unrelated UC-02
// tests came back `cancelled` with "the event loop has already resolved",
// which reads like a hang in code that was never touched. Binding 0 lets the
// OS pick, so this file can never take a port another file wants, and adds no
// literal for test/ports.test.js to police.
const EPHEMERAL = 0;
const EMPLOYMENT_ID_FIELD_ID = "360000000002";

// Never a real, retried OpenAI call: this devcontainer carries a genuine but
// unreachable OPENAI_API_KEY, so an un-injected LLM seam turns a 1ms test into
// a multi-second network failure (CLAUDE.md §6).
const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: (args) => classifyExpenseRuleBased(args),
  classifyTravel: (args) => classifyTravelInquiryRuleBased(args),
  parseRelocation: (args) => parseRelocationRuleBased(args),
  parseInquiry: (args) => parseInquiryRuleBased(args),
  draftRelocationNarrative: (args) => draftRelocationNarrative(args, unconfigured),
  draftTaxNarrative: (args) => draftTaxNarrative(args, unconfigured),
  judge: async () => ({ verdict: "not_evaluated", reason: null }),
};
const fakeDraftSummary = (args) => draftSummary(args, unconfigured);
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

let remote;
let remoteServer;
let zendesk;
let zendeskServer;
let audit;
let stores;
let portal;

// A real PATCH mutates the shared fixture object, so a suite that approves one
// has to put it back (test/uc02Review.test.js's identical block).
const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);

before(async () => {
  remoteServer = await startMockServer(EPHEMERAL);
  zendeskServer = await startZendeskMock(EPHEMERAL);
  remote = new RemoteClient({ baseUrl: `http://localhost:${remoteServer.address().port}` });
  zendesk = new ZendeskClient({
    baseUrl: `http://localhost:${zendeskServer.address().port}`,
    email: "test@example.com",
    apiToken: "test-token",
  });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
  await new Promise((resolve) => zendeskServer.close(resolve));
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
  portal = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
});

/**
 * Source with comments removed — test/uc08.test.js's idiom for a structural
 * check. Every assertion below is about what the CODE does; a comment naming a
 * function this file must not call is documentation, not a call site.
 */
const codeOf = (...parts) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

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

/** A second portal over the same durable stores — a different process, in effect. */
const freshPortal = () => createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });

const myRequests = (handler, persona) =>
  callApi(handler, { method: "GET", path: "/api/my-requests?persona=" + encodeURIComponent(persona) });

/** Chris Lee owns `exp_sandbox_over_cap_402` — the claim that must reach a human. */
const fileOverCapExpense = (externalRef) =>
  callApi(portal, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_over_cap_402", externalRef },
  });

// ---------------------------------------------------------------------------
// 1 — THE PORTAL: a decision a person took is unmissable on the page they
//     filed from, and it survives the process that took the submission.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE TWO-CHARACTER BUG THAT MADE EVERY REQUESTER'S HISTORY UNREADABLE
// ---------------------------------------------------------------------------
// Found in Vercel's runtime logs after a user reported: "the approve was done,
// at least I saw something in the live feed, but saw nothing in the request
// page." The whole route was answering 500:
//
//   [portal] GET /api/my-requests failed:
//     error: operator does not exist: text = integer
//       at async ResignationStore.listByOwner (src/uc05/resignationStore.js)
//
// Three stores built their SQL with `${params.length}` where `$${params.length}`
// was meant, so Postgres received `employment_id = 1` — a text column compared
// to an integer literal. caseStore.js had it right; the three that were copied
// from it did not.
//
// It was invisible to the suite because every test drives the in-memory branch,
// which never builds SQL at all. `listByOwner()` checks `this.pgPool` first and
// returns a filtered array — so the entire Postgres path, the only one the
// deployment uses, was untested.

test("listByOwner builds numbered placeholders, not bare numbers", async () => {
  // A fake pool that records the SQL rather than running it — the assertion is
  // about the string we hand Postgres, which is where the defect lived.
  const seen = [];
  const pgPool = {
    query(text, params) {
      seen.push({ text, params });
      return Promise.resolve({ rows: [] });
    },
  };

  const { ResignationStore } = await import("../src/uc05/resignationStore.js");
  const { AuthorizationStore } = await import("../src/uc04/authorizationStore.js");
  const { AdjustmentStore } = await import("../src/uc09/adjustmentStore.js");

  for (const Store of [ResignationStore, AuthorizationStore, AdjustmentStore]) {
    seen.length = 0;
    const store = new Store({ pgPool });
    await store.listByOwner({ employmentId: "emp_x", source: "portal", limit: 25 });
    assert.equal(seen.length, 1, `${Store.name} did not query`);
    const { text } = seen[0];

    // Every parameter reference is `$n`. A bare `= 1` is the defect.
    assert.doesNotMatch(text, /=\s*\d/, `${Store.name} compares a column to a bare number: ${text}`);
    assert.doesNotMatch(text, /limit\s+\d+\s*$/, `${Store.name} inlines its limit: ${text}`);
    assert.match(text, /=\s*\$\d/, `${Store.name} has no numbered placeholder: ${text}`);
    assert.match(text, /limit \$\d/, `${Store.name} does not parameterise its limit: ${text}`);
  }
});

test("one store that cannot be read does not erase the other six", async () => {
  // The second defect, and the one that turned a two-character slip into a
  // blank page. The throw escaped to the route's catch, which answers 500 for
  // EVERYTHING — so a UC-02 claim approved minutes earlier was invisible
  // because UC-05's query was malformed.
  const server = readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");

  // The listing is guarded per store, and the failure is reported beside the
  // requests that COULD be read rather than replacing them.
  assert.match(server, /rows = await store\.listByOwner\(/);
  assert.match(server, /could not be listed/);
  assert.match(server, /failed: true/);
  // And it says the record itself is unchanged — a reader must not conclude
  // their request was lost because a page could not render it.
  assert.match(server, /nothing about this one has changed/);
});

test("POSITIVE: a claim decided by a specialist reads as DECIDED to the requester, naming them — from a handler that never saw the submission", async () => {
  const filed = await fileOverCapExpense("feedback-decided");
  assert.equal(filed.status, 200);

  // The specialist decides through UC-02's own review path. The portal has no
  // route that could have done this, and in production a different process
  // (the ZAF sidebar) is what does it.
  await submitExpenseReview(
    {
      storeId: filed.body.recordId,
      action: "release",
      reviewer: "fin.ops@remote.com",
      note: "Attendee list received; within policy after all.",
    },
    { remote, audit, expenseStore: stores.uc02 }
  );

  // A handler that saw neither the submission nor the decision — which is
  // every handler on a serverless deployment, the only place a real requester
  // ever touches this page.
  const cold = await myRequests(freshPortal(), "chris");
  assert.equal(cold.status, 200);
  const view = cold.body.requests[0];

  // Asserted on the view the requester is SERVED, not on a store call: a store
  // holding the right row while the page shows nothing is the whole defect.
  assert.equal(view.settled, true, "the page must be able to see that a person has finished with this");
  assert.equal(view.status.decidedBy, "fin.ops@remote.com");
  assert.equal(typeof view.status.decidedAt, "string");
  assert.equal(view.status.note, "Attendee list received; within policy after all.");

  // The settled sentence in UC-02's own vocabulary, including the clause a
  // paraphrase always loses: whether the write to Remote actually landed,
  // which is a different fact from whether a human said yes.
  assert.match(view.resolution, /fin\.ops@remote\.com/);
  assert.match(view.resolution, /Remote/);

  // And it is announced above the list rather than left to be scrolled to.
  assert.equal(cold.body.decided.count, 1);
  assert.equal(cold.body.decided.total, 1);
  assert.match(cold.body.decided.summary, /decided by a person/i);
  assert.match(cold.body.decided.summary, /UC-02/);
});

test("a request still with a human is NOT reported as settled, and the banner says nothing", async () => {
  await fileOverCapExpense("feedback-open");
  const listed = await myRequests(portal, "chris");
  const view = listed.body.requests[0];

  assert.equal(view.status.state, STATES.AWAITING_REVIEW);
  assert.equal(view.settled, false);
  assert.equal(view.resolution, null);
  assert.equal(listed.body.decided.count, 0);
  assert.equal(listed.body.decided.summary, "", "an empty banner is hidden, never rendered as a heading for nothing");
});

test("a HOLD is not a verdict: the requester is not told their claim was decided", async () => {
  const filed = await fileOverCapExpense("feedback-held");
  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "hold", reviewer: "fin.ops@remote.com", note: "chasing the attendee list" },
    { remote, audit, expenseStore: stores.uc02 }
  );

  const view = (await myRequests(freshPortal(), "chris")).body.requests[0];
  assert.equal(view.status.state, STATES.ON_HOLD);
  assert.equal(view.settled, false, "a held claim can still be released or declined — nothing has been settled");
  assert.equal(view.resolution, null);
  // The facts are still shown; it is the "decided" claim that is withheld.
  assert.equal(view.status.decidedBy, "fin.ops@remote.com");
});

test("the settled flag reads the PORTAL's state, so a use case renaming its own verb cannot silence a decision", async () => {
  const filed = await fileOverCapExpense("feedback-spelling");
  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "release", reviewer: "fin.ops@remote.com" },
    { remote, audit, expenseStore: stores.uc02 }
  );
  const row = await stores.uc02.findById(filed.body.recordId);

  // The row's own status is UC-02's business and may be renamed there
  // (release -> approve). What this surface must never do is compare against
  // that spelling in a second file: the failure mode is an ABSENCE — a decided
  // claim showing no decision — which is the kind nobody reports.
  assert.ok(!OPEN_STATUSES.has(row.status), "a settled claim is no longer in an open status, whatever it is called");
  const view = (await myRequests(freshPortal(), "chris")).body.requests[0];
  assert.equal(view.settled, true);
  assert.match(String(view.status.state), /^(approved|declined|executed)$/);

  assert.ok(
    !/["']released["']/.test(codeOf("src", "portal", "server.js")),
    "src/portal/server.js must not hard-code UC-02's own verb — read the portal's state instead"
  );
});

test("a requester sees only their own decided requests", async () => {
  const filed = await fileOverCapExpense("feedback-scope");
  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "release", reviewer: "fin.ops@remote.com" },
    { remote, audit, expenseStore: stores.uc02 }
  );

  const mine = await myRequests(freshPortal(), "chris");
  assert.equal(mine.body.requests.length, 1);
  assert.equal(mine.body.decided.count, 1);

  // Emma is a different employee persona over the SAME stores.
  const theirs = await myRequests(freshPortal(), "emma");
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.requests.length, 0, "another persona's decided claim must not be listed");
  assert.equal(theirs.body.decided.count, 0);
});

test("the browser page renders the decision from the server's own fields, and adds no control that could decide", () => {
  const app = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

  // The page reads the flag the server sends rather than deciding for itself
  // what "decided" means — the same rule the badge class already follows.
  assert.ok(/request\.settled/.test(app), "the page must read the server's settled flag");
  // A HUMAN DECISION IS NOT ONE ROW AMONG IDENTIFIERS. That was the rule when
  // this listing was a column of cards, and it survives the move to a table —
  // only the mechanism changed. The card hoisted the decision out of a
  // label/value grid under its own heading; the table gives who, when and what
  // they wrote three DEDICATED COLUMNS (asserted on the markup below), placed
  // ahead of every identifier, and marks the whole row as settled. What is
  // being pinned either way is that a reader scanning for "did a person look at
  // this?" never has to read plumbing to find out.
  assert.ok(
    /is-decided/.test(app),
    "a settled request must be marked as such on the row, not left to be spotted"
  );
  assert.ok(/decided\.summary/.test(app), "the server's banner sentence must be rendered");
  // Rendered verbatim: no decision sentence composed in the browser.
  assert.ok(!/\.innerHTML\s*=/.test(app), "app.js assigns innerHTML");

  const html = readFileSync(join(__dirname, "..", "src", "portal", "assets", "index.html"), "utf8");
  assert.ok(html.includes('id="my-requests-decided"'), "the banner needs somewhere to render");
  // The three columns that carry the human decision, and their position: all
  // three come before the record id, the reference and the raw store status.
  // A "Decided by" column filed after the plumbing would satisfy the letter of
  // the rule above and none of its point.
  for (const heading of ["Decided at", "Decided by", "Their note"]) {
    assert.ok(html.includes(`<th scope="col">${heading}</th>`), `the table needs a ${heading} column`);
    assert.ok(
      html.indexOf(`<th scope="col">${heading}</th>`) < html.indexOf('<th scope="col">Reference</th>'),
      `${heading} must come before the identifiers, not after them`
    );
  }
  // The page must say it POLLS rather than implying a push (an existing rule
  // in this codebase) — the decision happens in another process entirely.
  assert.match(html, /not a live push/i);
});

// ---------------------------------------------------------------------------
// The listing's SHAPE, pinned deliberately.
//
// Twelve requests as twelve cards could not be scanned: nothing lined up, so
// no column could be compared down the page, and each card's identifier grid
// pushed the next request further out of sight. The fix is the same one the
// Execution & Audit Trail viewer's feed already uses — a wide table with a
// floor width, scrolling sideways inside its own card. Three things make that
// work, and each is a separate way to lose it: the wrapper that owns the
// overflow, the floor width that makes it engage instead of the browser
// crushing fourteen columns to fit, and timestamps rendered as real <time>
// elements carrying the raw value.
// ---------------------------------------------------------------------------
test("my requests renders as one horizontally scrolling table with real timestamps", () => {
  const html = readFileSync(join(__dirname, "..", "src", "portal", "assets", "index.html"), "utf8");
  const css = readFileSync(join(__dirname, "..", "src", "portal", "assets", "style.css"), "utf8");
  const app = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

  // The table sits inside the wrapper that owns `overflow-x` (shared sheet), so
  // THIS CARD scrolls sideways and the page body never does.
  assert.match(
    html,
    /<div class="r-table-wrap">\s*<table class="r-table my-requests-table">/,
    "the table must sit inside the overflow wrapper, or the page body scrolls instead"
  );
  assert.match(html, /<tbody id="my-requests-rows">/);

  // Without a floor width the browser honours `width: 100%` and the sideways
  // scroll never engages — fourteen columns get one word per line, which is
  // less readable than the cards this replaced.
  assert.match(css, /\.my-requests-table\s*\{[^}]*min-width:\s*\d{3,}px/);

  // A timestamp is a machine-readable value first: `datetime` carries what the
  // record holds, `title` keeps the raw ISO, and the formatted string is only
  // what is shown. A page that printed `toLocaleString()` alone would have
  // destroyed the value a requester needs to quote.
  assert.match(app, /el\("time"/);
  assert.match(app, /setAttribute\("datetime"/);
  assert.ok(/function timeAgo\(/.test(app), "the listing must say how long ago, not only when");
});

// ---------------------------------------------------------------------------
// 2 — THE REMOTE UI STAND-IN: the same half-gate, on the other requester
//     surface. An admin requested a contract amendment and was never told what
//     the two approvers did about it.
// ---------------------------------------------------------------------------

const ADMIN = { "x-remoteui-session": "admin" };
const EMPLOYEE = { "x-remoteui-session": "employee" };

const ORDINARY_AMENDMENT = {
  employmentId: "emp_nl_amend_001",
  changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "EUR" } },
  requestedEffectiveDate: "2026-07-15",
  now: "2026-06-20",
};

/** A stand-in over its own fresh amendment store, returned with the store. */
function makeRemoteUi(amendmentStore = new AmendmentStore()) {
  const handler = createRemoteUiHandler({
    remote,
    audit,
    amendmentStore,
    zendesk,
    employees: REMOTE_UI_EMPLOYEES,
    employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID,
    draftSummary: fakeDraftSummary,
    judge: fakeJudge,
  });
  return { handler, amendmentStore };
}

async function submitAmendment(handler) {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/submit",
    body: ORDINARY_AMENDMENT,
    headers: ADMIN,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.decision, "dual_approval_required");
  return res.body;
}

const trackAmendment = (handler, id, headers) =>
  callApi(handler, { method: "GET", path: `/api/amendments/${id}`, headers });

test("POSITIVE: the admin who requested an amendment can see it is still with two named approvers", async () => {
  const { handler, amendmentStore } = makeRemoteUi();
  const submitted = await submitAmendment(handler);

  // A handler that never saw the submission — the same serverless situation.
  const { handler: cold } = makeRemoteUi(amendmentStore);
  const tracked = await trackAmendment(cold, submitted.amendmentId, ADMIN);

  assert.equal(tracked.status, 200);
  assert.equal(tracked.body.status.state, AMENDMENT_STATES.AWAITING_APPROVAL);
  assert.equal(tracked.body.settled, false);
  assert.equal(tracked.body.status.signaturesCollected, 0);
  assert.equal(tracked.body.status.signaturesRequired, 2);
  assert.equal(tracked.body.openToApproval, true);
  // The ticket the submit raised — the same string the ZAF sidebar looks the
  // amendment up by, so requester and specialist quote one identifier.
  assert.equal(tracked.body.externalRef, String(submitted.ticketId));
  assert.equal(tracked.body.readOnly, true);
});

test("POSITIVE: one approval fills one slot, and the requester is shown WHICH — dual control is about two people", async () => {
  const { handler, amendmentStore } = makeRemoteUi();
  const submitted = await submitAmendment(handler);

  const approval = await submitAmendmentApproval(
    {
      amendmentId: submitted.amendmentId,
      role: "customer_admin",
      action: "approve",
      approver: "admin.jane@customer.com",
      note: "Board approved the raise.",
    },
    { remote, audit, amendmentStore }
  );
  assert.equal(approval.ok, true, JSON.stringify(approval));

  const tracked = await trackAmendment(makeRemoteUi(amendmentStore).handler, submitted.amendmentId, ADMIN);
  const signed = tracked.body.status.signatures.find((slot) => slot.signed);
  assert.equal(signed.role, "customer_admin");
  assert.equal(signed.approver, "admin.jane@customer.com");
  assert.equal(tracked.body.status.signaturesCollected, 1);
  assert.match(tracked.body.status.awaitingRole, /Remote payroll specialist/);
  assert.equal(tracked.body.settled, false, "one signature is not a decision when the control requires two");
});

test("POSITIVE: a declined amendment reads as DECLINED to its requester, naming who declined it and why", async () => {
  const { handler, amendmentStore } = makeRemoteUi();
  const submitted = await submitAmendment(handler);

  const denial = await submitAmendmentApproval(
    {
      amendmentId: submitted.amendmentId,
      role: "payroll_specialist",
      action: "decline",
      approver: "payroll.sam@remote.com",
      note: "Cutoff already locked for this cycle.",
    },
    { remote, audit, amendmentStore }
  );
  assert.equal(denial.ok, true, JSON.stringify(denial));

  const tracked = await trackAmendment(makeRemoteUi(amendmentStore).handler, submitted.amendmentId, ADMIN);
  assert.equal(tracked.body.status.state, AMENDMENT_STATES.DECLINED);
  assert.equal(tracked.body.settled, true);
  assert.equal(tracked.body.status.decidedBy, "payroll.sam@remote.com");
  assert.equal(tracked.body.status.note, "Cutoff already locked for this cycle.");
  // UC-06's own settled sentence, not a paraphrase of it.
  assert.match(tracked.body.resolution, /DECLINED/);
  assert.match(tracked.body.resolution, /payroll\.sam@remote\.com/);
  assert.equal(tracked.body.openToApproval, false);
});

test("an employee sees an amendment to their OWN contract, and nobody else's", async () => {
  const { handler, amendmentStore } = makeRemoteUi();
  const submitted = await submitAmendment(handler);

  // The demo employee session IS emp_nl_amend_001, so this one is theirs.
  const own = await trackAmendment(handler, submitted.amendmentId, EMPLOYEE);
  assert.equal(own.status, 200);
  assert.equal(own.body.employmentId, "emp_nl_amend_001");

  // Someone else's, proven on the pure rule rather than by inventing a second
  // demo session: the amendment belongs to another employment.
  const someoneElses = evaluateAmendmentVisibility({
    session: { role: "employee", companyId: "co_amend_01", employmentId: "emp_other_999" },
    amendment: await amendmentStore.findById(submitted.amendmentId),
    employment: null,
  });
  assert.equal(someoneElses.allowed, false);
  assert.equal(someoneElses.code, "not_your_amendment");
});

test("an admin cannot read an amendment somebody else requested, and an unauthenticated caller reads nothing", async () => {
  const { handler, amendmentStore } = makeRemoteUi();
  const submitted = await submitAmendment(handler);
  const row = await amendmentStore.findById(submitted.amendmentId);

  const otherAdmin = evaluateAmendmentVisibility({
    session: { role: "company_admin", companyId: "co_amend_01", authenticatedAdminId: "admin_someone_else" },
    amendment: row,
    employment: null,
  });
  assert.equal(otherAdmin.allowed, false);
  assert.equal(otherAdmin.code, "not_your_amendment");

  // FAILS CLOSED on missing pieces. Two nulls are not a match — `null === null`
  // passing for a verified identity is a defect this repo has already paid for.
  const nullAdmin = evaluateAmendmentVisibility({
    session: { role: "company_admin", companyId: "co_amend_01", authenticatedAdminId: null },
    amendment: { ...row, requester: null },
    employment: null,
  });
  assert.equal(nullAdmin.allowed, false);

  const noSession = await trackAmendment(handler, submitted.amendmentId, {});
  assert.equal(noSession.status, 401);
  assert.equal(noSession.body.code, "unauthenticated");
});

test("the stand-in exposes NO route that could approve, decline or acknowledge an amendment", async () => {
  const { handler } = makeRemoteUi();
  const submitted = await submitAmendment(handler);

  for (const path of [
    `/api/amendments/${submitted.amendmentId}/approve`,
    `/api/amendments/${submitted.amendmentId}/deny`,
    `/api/amendments/${submitted.amendmentId}/decline`,
    `/api/amendments/${submitted.amendmentId}/acknowledge`,
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await callApi(handler, { method, path, headers: ADMIN });
      assert.equal(res.status, 404, `${method} ${path} must not exist`);
      assert.equal(res.body.code, "no_such_route");
    }
    // And the GET must not swallow a sub-resource either: isPath() matches a
    // prefix, so an exact-length check is what stops a read-only route
    // answering 200 to the shape of a decision route.
    const swallowed = await callApi(handler, { method: "GET", path, headers: ADMIN });
    assert.equal(swallowed.status, 404);
  }
});

test("the tracking page is read-only in the structural sense — no write verb reaches an approval function", () => {
  assert.ok(
    !/submitAmendmentApproval/.test(codeOf("src", "remoteui", "server.js")),
    "the stand-in must not import UC-06's approval function at all — a second place to decide is a second, unaudited one"
  );

  const app = readFileSync(join(__dirname, "..", "src", "remoteui", "assets", "app.js"), "utf8");
  assert.ok(!/\.innerHTML\s*=/.test(app), "app.js assigns innerHTML");
  assert.ok(/result\.settled/.test(app), "the page must read the server's settled flag rather than deciding");

  const html = readFileSync(join(__dirname, "..", "src", "remoteui", "assets", "index.html"), "utf8");
  assert.match(html, /not a live push/i, "the page must say it polls rather than implying a push");
});

test("the amendment describer invents no status, and reports an unrecognised one as unknown", () => {
  assert.equal(describeAmendmentStatus(null).state, AMENDMENT_STATES.UNKNOWN);
  assert.equal(describeAmendmentStatus({ status: "something_new" }).state, AMENDMENT_STATES.UNKNOWN);

  // An in-flight write is NOT reported as applied: two humans agreeing and
  // Remote accepting are different facts, and this is the rounding that cannot
  // be walked back once the requester has read it.
  const applying = describeAmendmentStatus({ status: "executing", adminApproval: {}, payrollApproval: {} });
  assert.equal(applying.state, AMENDMENT_STATES.APPLYING);
  assert.notEqual(applying.state, AMENDMENT_STATES.EXECUTED);
});
