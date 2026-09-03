// ---------------------------------------------------------------------------
// portalStatus.test.js  —  "My requests": what happened to what I filed
// ---------------------------------------------------------------------------
// THE QUESTION THIS SUITE EXISTS FOR
// Someone submitted an over-cap expense through the portal, was told
// `human_review / over_policy_cap`, and asked where a human would actually
// review it — and, once that was built, where they would ever SEE the outcome.
// A human gate whose result the requester cannot observe is only half a gate.
//
// The load-bearing test is the round trip: file a claim that must go to a
// human, see the portal report it as awaiting review, have a Finance Ops
// specialist decide it through the REAL UC-02 review path, and see the portal
// report the outcome with the decider's name. Everything else here guards the
// boundary that makes that safe — the portal reads, and never decides.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startMockServer, EXPENSES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { describeStatus, STATES, NO_DECISION_PATH_TYPES } from "../src/portal/requestStatus.js";
import { submitExpenseReview } from "../src/uc02/workflow.js";
import { describeSettled } from "../src/uc02/reviewPolicy.js";
import { ownerScopeFor } from "../src/portal/ownership.js";
import { matchesOwner } from "../src/shared/ownerScope.js";
import { PERSONAS } from "../src/portal/personas.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore, EMPLOYER_DECISION_STATUSES } from "../src/uc04/authorizationStore.js";
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

const REMOTE_PORT = 4104; // allocated in src/shared/ports.js TEST_PORTS (was 4093, which uc03.test.js binds)

// Never a real, retried OpenAI call from a suite that does not care what the
// classifier says (CLAUDE.md §6 — this devcontainer carries a live-looking key).
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

let remote;
let remoteServer;
let audit;
let stores;
let handler;

// See test/uc02Review.test.js's identical block: a real PATCH mutates the
// shared fixture object, so a suite that approves one must put it back.
const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);

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
  handler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
});

function callApi({ method, path, body = null, headers = {} }) {
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

const myRequests = (persona) =>
  callApi({ method: "GET", path: "/api/my-requests?persona=" + encodeURIComponent(persona) });

/**
 * Chris Lee owns `exp_sandbox_over_cap_402` — the over-cap claim, which is the
 * exact submission that raised the question this whole pass answers.
 */
function fileOverCapExpense(externalRef = "portal-status-1") {
  return callApi({
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_over_cap_402", externalRef },
  });
}

// ---------------------------------------------------------------------------
// 1 — THE ROUND TRIP. Read the file header before changing this.
// ---------------------------------------------------------------------------

test("POSITIVE: an over-cap claim shows as awaiting review, then reflects the Finance Ops decision", async () => {
  const filed = await fileOverCapExpense();
  assert.equal(filed.status, 200);
  assert.equal(filed.body.decision, "human_review");
  assert.equal(filed.body.reason, "over_policy_cap");

  // --- BEFORE: the portal says a human has it, and names the role.
  const before = await myRequests("chris");
  assert.equal(before.status, 200);
  assert.equal(before.body.requests.length, 1);
  const pending = before.body.requests[0];
  assert.equal(pending.useCase, "UC-02");
  assert.equal(pending.status.state, STATES.AWAITING_REVIEW);
  assert.equal(pending.status.awaitingRole, "Finance Ops");
  assert.equal(pending.status.decidedBy, null);
  assert.match(pending.status.detail, /approve, decline or hold/i);

  // --- The decision itself happens OUTSIDE the portal, through UC-02's own
  // review path — exactly as it would from the ZAF sidebar. The portal has no
  // route that could have done this.
  await submitExpenseReview(
    {
      storeId: filed.body.recordId,
      action: "decline",
      reviewer: "fin.ops@remote.com",
      note: "Department dinner is outside the meals policy.",
    },
    { remote, audit, expenseStore: stores.uc02 }
  );

  // --- AFTER: the portal reflects it, with who decided and what they said.
  const after = await myRequests("chris");
  const decided = after.body.requests[0];
  assert.equal(decided.status.state, STATES.DECLINED);
  assert.equal(decided.status.label, "Declined");
  assert.equal(decided.status.decidedBy, "fin.ops@remote.com");
  assert.equal(decided.status.note, "Department dinner is outside the meals policy.");
  assert.equal(typeof decided.status.decidedAt, "string");
  // The store's own word is shown verbatim beside the translation, so nothing
  // is hidden behind it.
  assert.equal(decided.status.storeStatus, "declined");
});

test("POSITIVE: an approved claim reads as approved, and a held one as on hold", async () => {
  const filed = await fileOverCapExpense("portal-status-hold");

  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "hold", reviewer: "fin.ops@remote.com", note: "chasing the attendee list" },
    { remote, audit, expenseStore: stores.uc02 }
  );
  let view = (await myRequests("chris")).body.requests[0];
  assert.equal(view.status.state, STATES.ON_HOLD);
  assert.equal(view.status.decidedBy, "fin.ops@remote.com");
  // A hold is not a verdict: the claim is still sitting with Finance Ops.
  assert.equal(view.status.awaitingRole, "Finance Ops");

  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "approve", reviewer: "fin.ops@remote.com", note: "list received" },
    { remote, audit, expenseStore: stores.uc02 }
  );
  view = (await myRequests("chris")).body.requests[0];
  assert.equal(view.status.state, STATES.APPROVED);
  assert.equal(view.status.label, "Approved");
});

test("the status is RE-READ, not remembered — a decision made after the page loaded still shows", async () => {
  const filed = await fileOverCapExpense("portal-status-fresh");

  // Read once (this is where a cache would be populated), decide, read again.
  const first = await myRequests("chris");
  assert.equal(first.body.requests[0].status.state, STATES.AWAITING_REVIEW);

  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "approve", reviewer: "someone@remote.com" },
    { remote, audit, expenseStore: stores.uc02 }
  );

  const second = await myRequests("chris");
  assert.equal(second.body.requests[0].status.state, STATES.APPROVED);
  assert.equal(second.body.requests[0].status.decidedBy, "someone@remote.com");
});

// ---------------------------------------------------------------------------
// 1b — THE SERVERLESS CASE, WHICH IS THE ONLY CASE A REAL USER EVER HITS
// ---------------------------------------------------------------------------
// The defect this section exists for: "My requests" used to read a
// process-local array pushed to at submission time. On Vercel a fresh handler
// is built per request, so that array is ALWAYS empty there — and the
// deployment is the only place a requester ever touches this page. The route's
// own header said so honestly, and an honest comment is not a working feature:
// a user filed a claim, a Finance Ops specialist released it, and the portal
// showed them nothing at all.
//
// A NEW HANDLER OVER THE SAME STORES IS EXACTLY THAT SITUATION. The submission
// handler is discarded; nothing of it survives but the durable rows. If the
// list is derived from process memory in any form, these tests fail. Note they
// are POSITIVE tests — "this MUST be listed" — because a list that is empty
// for a good reason and a list that CANNOT be non-empty are indistinguishable
// from any assertion that only checks a refusal (CLAUDE.md §4/§5).
// ---------------------------------------------------------------------------

/** A second portal over the same stores — a different process, in effect. */
function freshHandler() {
  return createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
}

function myRequestsVia(otherHandler, persona) {
  const previous = handler;
  handler = otherHandler;
  return myRequests(persona).finally(() => {
    handler = previous;
  });
}

test("POSITIVE: a request is listed by a handler that never saw it submitted — no in-memory ledger anywhere", async () => {
  const filed = await fileOverCapExpense("portal-status-serverless");
  assert.equal(filed.status, 200);

  const cold = await myRequestsVia(freshHandler(), "chris");
  assert.equal(cold.status, 200);
  assert.equal(cold.body.requests.length, 1, "the record is durable, so a fresh handler must still find it");
  const view = cold.body.requests[0];
  assert.equal(view.recordId, filed.body.recordId);
  assert.equal(view.useCase, "UC-02");
  assert.equal(view.status.state, STATES.AWAITING_REVIEW);
});

test("POSITIVE: a claim approved after the filing handler died still shows as resolved, naming the reviewer", async () => {
  const filed = await fileOverCapExpense("portal-status-serverless-decided");

  // The specialist decides through UC-02's own review path — the portal has no
  // route that could have done this, and a different process would be doing it
  // in production anyway (the ZAF sidebar).
  await submitExpenseReview(
    {
      storeId: filed.body.recordId,
      action: "approve",
      reviewer: "fin.ops@remote.com",
      note: "Attendee list received; within policy after all.",
    },
    { remote, audit, expenseStore: stores.uc02 }
  );

  // A handler that never saw the submission AND never saw the decision.
  const cold = await myRequestsVia(freshHandler(), "chris");
  const view = cold.body.requests[0];

  // Asserted on the RENDERED VIEW, not on a store call: the question is what
  // the requester is shown, and a store that holds the right row while the
  // page shows nothing is the exact defect being fixed.
  assert.equal(view.status.state, STATES.APPROVED);
  assert.equal(view.status.label, "Approved");
  assert.equal(view.status.decidedBy, "fin.ops@remote.com");
  assert.equal(typeof view.status.decidedAt, "string");
  assert.equal(view.status.note, "Attendee list received; within policy after all.");

  // And the settled-claim sentence, in UC-02's own review vocabulary rather
  // than a paraphrase — it names the verb, the person, and whether the write
  // to Remote actually landed, which is a different fact from "a human said
  // yes" and the one a requester chasing a reimbursement needs.
  assert.match(view.resolution, /APPROVED/);
  assert.match(view.resolution, /fin\.ops@remote\.com/);
  assert.equal(view.resolution, describeSettled(await stores.uc02.findById(filed.body.recordId)));
});

test("an open claim carries no resolution sentence — a hold is not a verdict", async () => {
  const filed = await fileOverCapExpense("portal-status-open");
  let view = (await myRequests("chris")).body.requests[0];
  assert.equal(view.resolution, null, "nothing has been settled yet");

  await submitExpenseReview(
    { storeId: filed.body.recordId, action: "hold", reviewer: "fin.ops@remote.com", note: "chasing" },
    { remote, audit, expenseStore: stores.uc02 }
  );
  view = (await myRequests("chris")).body.requests[0];
  assert.equal(view.status.state, STATES.ON_HOLD);
  assert.equal(view.resolution, null, "a held claim can still be released or declined — it is not settled");
});

// ---------------------------------------------------------------------------
// 2 — THE BOUNDARY. The portal reads; it never decides.
// ---------------------------------------------------------------------------

test("the portal exposes NO route that could approve, deny, release, decline or hold anything", async () => {
  const filed = await fileOverCapExpense("portal-status-boundary");
  const id = filed.body.recordId;

  const attempts = [
    `/api/my-requests/${id}/approve`,
    `/api/my-requests/${id}/decline`,
    `/api/my-requests/${id}/hold`,
    `/api/my-requests/${id}/approve`,
    `/api/requests/uc02/${id}/approve`,
    `/api/expenses/${id}/approve`,
  ];
  for (const path of attempts) {
    const res = await callApi({ method: "POST", path, body: { approver: "attacker@evil.test" } });
    assert.equal(res.status, 404, `${path} must not be a route on the portal`);
  }

  // And nothing moved.
  const row = await stores.uc02.findById(id);
  assert.equal(row.status, "flagged");
  assert.equal(row.reviewer, null);
});

test("the my-requests route is GET-only and says so in its own payload", async () => {
  const posted = await callApi({ method: "POST", path: "/api/my-requests", body: {} });
  assert.equal(posted.status, 404);

  const got = await myRequests("chris");
  assert.equal(got.body.readOnly, true);
  assert.match(got.body.note, /never offers a control/i);
  // The scope note used to state an honest LIMIT — "this process only, so a
  // serverless deployment sees nothing". It now states a GUARANTEE, because
  // the list comes from the durable stores and the serverless case is the one
  // it was built for. Asserted so the wording cannot quietly regress to the
  // apology while the behaviour is fine, or vice versa.
  assert.match(got.body.scope, /durable store/i);
  assert.match(got.body.scope, /serverless/i);
  assert.equal(got.body.ledgerScope, undefined, "the process-local scope note is gone, not merely reworded");
});

// D-08, round-7 re-check (rca-l9rg): the note used to name "the ZAF sidebar
// and each use case's own approval endpoint" — two surfaces the employee
// reading this payload has never seen and cannot open. It must say WHO
// decides, not WHERE the software does it.
test("the my-requests note tells the reader who decides, not our internal surfaces", async () => {
  const got = await myRequests("chris");
  assert.match(got.body.note, /specialist/i);
  assert.doesNotMatch(got.body.note, /ZAF/i);
  assert.doesNotMatch(got.body.note, /approval endpoint/i);
});

test("source contains no approve/deny handler for the status surface", () => {
  const source = readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");
  // Structural, in UC-08's sense: the route does not exist in the file, rather
  // than existing and refusing. A refusing route is one bug away from allowing.
  assert.doesNotMatch(source, /my-requests[^\n]*approve/i);
  assert.doesNotMatch(source, /submitExpenseReview|submitWorkationApproval|submitAmendmentApproval/);
});

// ---------------------------------------------------------------------------
// 3 — one persona's requests are one persona's
// ---------------------------------------------------------------------------

test("a persona sees only what that persona filed", async () => {
  await fileOverCapExpense("portal-status-mine");
  await callApi({
    method: "POST",
    path: "/api/requests/uc03",
    body: { persona: "emma", text: "Can I work from Spain for two weeks in September?" },
  });

  const chris = await myRequests("chris");
  assert.equal(chris.body.requests.length, 1);
  assert.equal(chris.body.requests[0].useCase, "UC-02");

  const emma = await myRequests("emma");
  assert.equal(emma.body.requests.length, 1);
  assert.equal(emma.body.requests[0].useCase, "UC-03");
});

test("a persona who has filed nothing gets an explicit empty list, not an error", async () => {
  const res = await myRequests("joao");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.requests, []);
});

test("an unknown or absent persona is REFUSED, never defaulted to 'everyone'", async () => {
  // The dangerous default. Deriving the list from the stores means the query
  // needs an owner, and the natural "no persona filter" fallback is the one
  // that hands every requester's requests to anyone holding the shared access
  // key. Both shapes must fail closed.
  for (const path of ["/api/my-requests", "/api/my-requests?persona=", "/api/my-requests?persona=constructor"]) {
    const res = await callApi({ method: "GET", path });
    assert.equal(res.status, 401, `${path} must not be answered with a list`);
    assert.equal(res.body.code, "unknown_persona");
    assert.equal(res.body.requests, undefined);
  }
});

test("the scope is built from the SERVER's persona map, never from the query string", async () => {
  await fileOverCapExpense("portal-status-scope-source");

  // The employment the scope uses is the one PERSONAS says chris is. Nothing
  // in the request can name a different one — proven by asking the pure
  // function directly, which is the only thing the route consults.
  const scope = ownerScopeFor(PERSONAS.chris, "uc02");
  assert.equal(scope.scoped, true);
  assert.equal(scope.query.employmentId, PERSONAS.chris.employmentId);
  assert.equal(scope.query.requester, undefined);

  // And an emma-shaped row is not chris's, at the predicate level.
  const rows = await stores.uc02.listByOwner({ employmentId: PERSONAS.emma.employmentId, source: "portal" });
  assert.deepEqual(rows, []);
});

test("an admin's list is scoped by the admin id the record carries, not by an employment", async () => {
  await callApi({
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      persona: "admin",
      employmentId: PERSONAS.emma.employmentId,
      destinationCountry: "ES",
      startDate: "2026-09-01",
      endDate: "2026-09-10",
    },
  });

  const admin = await myRequests("admin");
  assert.equal(admin.status, 200);
  const uc04 = admin.body.requests.filter((r) => r.useCase === "UC-04");
  assert.equal(uc04.length, 1, "the admin filed it, so the admin sees it");

  // And the EMPLOYEE it is about does not see it in their own list: it is not
  // their request, and their session owns nothing on that row.
  const emma = await myRequests("emma");
  assert.deepEqual(emma.body.requests.filter((r) => r.useCase === "UC-04"), []);
});

test("an employee who files their OWN workation request can see it, and nobody else's", async () => {
  // The other half of the 2026-08-30 change: an employee may file a
  // work-authorization request about their own trip (src/uc04/
  // submissionIdentity.js), and a request you can file and then cannot find is
  // a request that vanished. Scoped on BOTH `requester` and `employment_id` —
  // filed by me, about me — which is deliberately the TIGHTER of the two
  // readings available; see ownership.js's SELF_OR_ON_BEHALF_OF header for why
  // "everything about me" was not taken.
  const filed = await callApi({
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      persona: "chris",
      employmentId: PERSONAS.chris.employmentId,
      homeCountry: "DE",
      nationality: "DE",
      destinationCountry: "ES",
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
      now: "2026-08-15",
    },
  });
  assert.equal(filed.status, 200, `the employee's own request was refused: ${filed.body.code ?? filed.body.reason}`);

  const chris = await myRequests("chris");
  const mine = chris.body.requests.filter((r) => r.useCase === "UC-04");
  assert.equal(mine.length, 1, "the employee filed it and cannot see it");

  // And it is not on anybody else's page.
  const emma = await myRequests("emma");
  assert.deepEqual(emma.body.requests.filter((r) => r.useCase === "UC-04"), []);
});

test("a pairing that cannot be scoped from the session is REPORTED, never silently empty", async () => {
  const admin = await myRequests("admin");
  const reasons = Object.fromEntries(admin.body.notListed.map((n) => [n.type, n.reason]));

  // Self-service types: an admin cannot file them, so there is nothing to own.
  for (const type of ["uc02", "uc03", "uc05"]) {
    assert.match(reasons[type], /employee/i, `${type} must say why an admin sees none`);
  }
  // The 🔴 dossiers: the row records the employment it is ABOUT and nothing
  // about who asked, so an admin session owns nothing on it — and the honest
  // answer is to say so rather than to scope on an employment id typed into a
  // form, which would be scoping on a claim in a request body.
  for (const type of ["uc07", "uc08"]) {
    assert.match(reasons[type], /nothing about who asked/i);
  }

  // The mirror image: an employee is told why the on-behalf-of type is not
  // theirs, rather than being shown an unexplained gap.
  //
  // UC-04 IS NO LONGER ONE OF THEM, and that is the point of the change on
  // 2026-08-30: a work-authorization request may be filed by the employee about
  // their own trip, so an employee session DOES own those rows and the type is
  // scoped rather than reported as unscopable. UC-09 — the 🔴-framed money path
  // — is untouched, and the assertion below is what stops that widening leaking
  // one type over.
  const chris = await myRequests("chris");
  const employeeReasons = Object.fromEntries(chris.body.notListed.map((n) => [n.type, n.reason]));
  assert.match(employeeReasons.uc09, /company admin/i);
  assert.equal(
    employeeReasons.uc04,
    undefined,
    "UC-04 is reported as unscopable for an employee, but an employee may now file one"
  );
});

test("only requests filed HERE are listed — the stores are shared with the nine APIs and with n8n", async () => {
  // A row for the same employee, from a different intake surface entirely.
  stores.uc02.createExpense({
    expenseId: "exp_from_zendesk",
    employmentId: PERSONAS.chris.employmentId,
    decision: "human_review",
    reason: "over_policy_cap",
    flags: [],
    externalRef: "9001",
    source: "zendesk",
  });
  await fileOverCapExpense("portal-status-source-scope");

  const res = await myRequests("chris");
  assert.equal(res.body.requests.length, 1, "the Zendesk-originated claim is not something they filed through this portal");
  assert.notEqual(res.body.requests[0].externalRef, "9001");
});

test("the ownership predicate fails CLOSED on an empty scope — it matches nothing, not everything", () => {
  // The chain-of-ifs idiom this replaces answers `true` for {}, which is the
  // one answer that turns "who is this?" into "list everybody".
  const row = { employmentId: "emp_1", requester: "admin_jane", source: "portal" };
  assert.equal(matchesOwner(row, {}), false);
  assert.equal(matchesOwner(row, { employmentId: null, requester: null }), false);
  assert.equal(matchesOwner(row, { source: "portal" }), false, "a source alone names no owner");

  // And it ANDs rather than ORs: a matching employment with a wrong source is
  // still not a match.
  assert.equal(matchesOwner(row, { employmentId: "emp_1", source: "portal" }), true);
  assert.equal(matchesOwner(row, { employmentId: "emp_1", source: "zendesk" }), false);
  assert.equal(matchesOwner(row, { employmentId: "emp_2", requester: "admin_jane" }), false);
});

test("every store the portal lists from answers listByOwner, and every one fails closed unscoped", async () => {
  // Uniform on purpose: the route loops over REQUEST_TYPES and would silently
  // skip a store that lacked the method, which is a whole use case's history
  // vanishing with nothing failing.
  for (const [typeId, store] of Object.entries(stores)) {
    assert.equal(typeof store.listByOwner, "function", `${typeId}'s store must answer listByOwner`);
    assert.deepEqual(await store.listByOwner({}), [], `${typeId} must list nothing for an unscoped call`);
  }
});

// ---------------------------------------------------------------------------
// 4 — the two use cases that CANNOT answer, and say so
// ---------------------------------------------------------------------------

test("a 🔴 dossier reports no_decision_path — never a fake 'awaiting review'", async () => {
  await callApi({
    method: "POST",
    path: "/api/requests/uc08",
    body: {
      persona: "chris",
      text: "I spent 200 days in Portugal this year. Am I tax resident there?",
      targetCountry: "PT",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    },
  });

  const view = (await myRequests("chris")).body.requests[0];
  assert.equal(view.status.state, STATES.NO_DECISION_PATH);
  // The distinguishing claim: nothing is waiting on anybody INSIDE this system.
  assert.equal(view.status.awaitingRole, null);
  assert.match(view.status.detail, /no approve, decline or execute path/i);
  assert.match(view.status.detail, /outside this system/i);

  assert.deepEqual([...NO_DECISION_PATH_TYPES].sort(), ["uc07", "uc08"]);
});

// ---------------------------------------------------------------------------
// 5 — the pure describer, on its own terms
// ---------------------------------------------------------------------------

test("every use case's own status vocabulary is translated, and an unknown one is NOT guessed", () => {
  // A representative row per store, using each store's real status strings.
  assert.equal(describeStatus("uc02", { status: "auto_approved" }).state, STATES.AUTO_RESOLVED);
  assert.equal(describeStatus("uc03", { status: "pending_review" }).state, STATES.AWAITING_REVIEW);
  assert.equal(describeStatus("uc04", { status: "pending_specialist_approval" }).state, STATES.AWAITING_REVIEW);
  assert.equal(describeStatus("uc05", { status: "pending_signoff" }).state, STATES.AWAITING_REVIEW);
  assert.equal(describeStatus("uc09", { status: "pending_approval" }).state, STATES.AWAITING_REVIEW);

  // The one that matters most: a status nobody taught this file about must
  // read as "we do not know", never as a plausible default. "We don't know"
  // and "nothing has happened yet" are different facts.
  const guessed = describeStatus("uc04", { status: "some_new_status_added_later" });
  assert.equal(guessed.state, STATES.UNKNOWN);
  assert.equal(guessed.storeStatus, "some_new_status_added_later");

  // A missing row likewise.
  assert.equal(describeStatus("uc02", null).state, STATES.UNKNOWN);
  // And a use case with no reader at all.
  assert.equal(describeStatus("uc99", { status: "whatever" }).state, STATES.UNKNOWN);
});

test("the decision slot is read wherever a store keeps it — a column or a {approver,note,at} object", () => {
  // UC-04 keeps the approve side in columns and the deny side in a slot.
  const approved = describeStatus("uc04", {
    status: "executed",
    approver: "mobility@remote.com",
    approvedAt: "2026-08-19T10:00:00.000Z",
    approvalNote: "fine",
  });
  assert.equal(approved.decidedBy, "mobility@remote.com");
  assert.equal(approved.note, "fine");

  const declined = describeStatus("uc05", {
    status: "declined",
    declinedBy: { approver: "hr@remote.com", note: "recalculate", at: "2026-08-19T11:00:00.000Z" },
  });
  assert.equal(declined.decidedBy, "hr@remote.com");
  assert.equal(declined.decidedAt, "2026-08-19T11:00:00.000Z");
  assert.equal(declined.note, "recalculate");
});

// BACKWARD COMPATIBILITY, on the surface a REQUESTER sees. Rows written before
// the 2026-08-19 `deny` -> `decline` rename carry `status: "denied"` and the
// slot under `deniedBy`. "My requests" must still say what happened to them:
// an unrecognised status renders as "we cannot say", which for a request that
// WAS decided is a worse answer than the true one, and it is the requester —
// not an engineer — who reads it.
test("a LEGACY `denied` row still reports its outcome on My requests, for every use case that had one", () => {
  const legacySlot = { approver: "hr@remote.com", note: "recalculate", at: "2026-08-19T11:00:00.000Z" };

  for (const useCase of ["uc04", "uc05", "uc09"]) {
    const view = describeStatus(useCase, { status: "denied", deniedBy: legacySlot, deniedAt: legacySlot.at });
    assert.equal(view.state, STATES.DECLINED, `${useCase}: a legacy denied row must read as declined`);
    assert.notEqual(view.state, STATES.UNKNOWN, `${useCase}: it must not fall through to "we cannot say"`);
    assert.equal(view.decidedBy, "hr@remote.com", `${useCase}: the decider's name must survive the rename`);
    assert.equal(view.note, "recalculate", `${useCase}: so must their reason`);
  }

  // And the new spelling reads the same, from the new field name.
  for (const useCase of ["uc04", "uc05", "uc09"]) {
    const view = describeStatus(useCase, { status: "declined", declinedBy: legacySlot });
    assert.equal(view.state, STATES.DECLINED);
    assert.equal(view.decidedBy, "hr@remote.com");
  }
});

test("UC-09 reports how many of its approval slots are filled, and never fewer than two required", () => {
  const view = describeStatus("uc09", {
    status: "pending_approval",
    approvalSlotsRequired: 3,
    requesterApproval: { approver: "a" },
    approverApproval: null,
    paymentReleaserApproval: null,
  });
  assert.equal(view.state, STATES.AWAITING_REVIEW);
  assert.match(view.detail, /1 of 3/);
  assert.match(view.detail, /floor is two people/i);
});

test("the describer holds no policy — structurally, not by convention", () => {
  const source = readFileSync(new URL("../src/portal/requestStatus.js", import.meta.url), "utf8");
  // It imports NOTHING. A pure translation with no dependency on a policy or
  // workflow module cannot become a second place a gate's meaning is decided,
  // and cannot drift out of step with one — the same structural argument
  // UC-08's workflow makes by taking no write-capable parameter.
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /actionable/);
});

// ---------------------------------------------------------------------------
// THE EMPLOYER'S VERDICT, AS THE STORE ACTUALLY WRITES IT
// ---------------------------------------------------------------------------
// Found on the live deployment, 2026-09-01, by reading it rather than by
// reasoning: two real UC-04 records that a manager had approved reported
// `state: "unknown"`, `decidedBy: null`, label "Unknown" — beside a `stages`
// block ON THE SAME ROW naming the approver and the minute. describeStatus()
// knew `executed` and did not know `approved_by_manager`, which is what
// AuthorizationStore.recordEmployerDecision() writes. The decline half had the
// identical hole and no row had reached it yet.
//
// THE GUARD IS DERIVED, NOT RESTATED. It reads the store's own frozen map, so
// a third employer verdict added there fails here until this page learns the
// word. A literal list would have been a second copy of the vocabulary the
// original defect already proves nobody keeps in step.

test("every status the store can write for an employer verdict is one this page knows", () => {
  for (const [action, status] of Object.entries(EMPLOYER_DECISION_STATUSES)) {
    const described = describeStatus("uc04", { status });
    assert.notEqual(
      described.state,
      STATES.UNKNOWN,
      `recordEmployerDecision("${action}") writes "${status}", and "My requests" renders it as Unknown — `
        + "the requester is told nothing happened on a request a named human decided."
    );
    assert.equal(described.storeStatus, status, "the raw status must survive for anyone tracing the row");
  }
});

test("an approved work authorization names the manager, the minute and their note", () => {
  // All three come off the approval slot recordEmployerDecision() writes:
  // `approver`, `approved_at`, `approval_note`. Reporting the approval without
  // them is what the live rows did, and "approved" with no approver is the one
  // shape a requester cannot act on.
  const described = describeStatus("uc04", {
    status: "approved_by_manager",
    approver: "admin_jane",
    approvedAt: "2026-08-31T11:25:56.667Z",
    approvalNote: "Cleared — two weeks, no client-facing work.",
  });

  assert.equal(described.state, STATES.EXECUTED, "an employer verdict is settled, not still awaiting one");
  assert.equal(described.label, "Approved by your manager");
  assert.equal(described.decidedBy, "admin_jane");
  assert.equal(described.decidedAt, "2026-08-31T11:25:56.667Z");
  assert.equal(described.note, "Cleared — two weeks, no client-facing work.");
  assert.equal(described.awaitingRole, null, "it is not waiting on anybody");
});

test("an approved work authorization claims nothing about Remote", () => {
  // `executed` may say "there was no Remote work-authorisation request behind
  // this trip to update" because its execution step ran and recorded what it
  // found. recordEmployerDecision() writes no `remoteResult` at all, so the
  // same sentence here would report an absence nobody looked for.
  const detail = describeStatus("uc04", { status: "approved_by_manager", approver: "admin_jane" }).detail;
  assert.ok(!/no Remote work-authorisation request/i.test(detail), `it claimed Remote held nothing: ${detail}`);
  assert.ok(!/updated at Remote/i.test(detail), `it claimed a Remote update that never ran: ${detail}`);
  assert.match(detail, /mobility review is a separate stage/i, "stage 3 must still be pointed at");
});

test("a declined work authorization reads the decline slot, not the approval slot", () => {
  // recordEmployerDecision() writes `denied_by`/`denied_at` for a decline and
  // leaves `approver` untouched. Reading the approval slot would report the
  // decision as decided by nobody — or, worse, by whoever last approved.
  const described = describeStatus("uc04", {
    status: "declined_by_manager",
    declinedBy: { approver: "admin_jane", at: "2026-08-31T12:00:00.000Z", note: "Not this quarter." },
  });

  assert.equal(described.state, STATES.DECLINED);
  assert.equal(described.decidedBy, "admin_jane");
  assert.equal(described.note, "Not this quarter.");
});
