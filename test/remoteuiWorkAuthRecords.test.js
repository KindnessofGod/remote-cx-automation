// ---------------------------------------------------------------------------
// remoteuiWorkAuthRecords.test.js  —  the requests filed HERE, on the employer's
//                                     screen, and the employer's decision on one
// ---------------------------------------------------------------------------
// THE DEFECT THESE PIN. A UC-04 work-authorization request filed through /portal
// (or through the UC-03 -> UC-04 continuation) reached `ready_for_approval`,
// wrote a durable `uc04_authorizations` row and raised a Zendesk ticket — and
// never appeared at /remoteui/work-authorizations, because the scope resolver
// read Remote's list endpoint and the rung-3 stand-in and nothing else. The
// customer's own manager is the only person Remote's API lets decide a work
// authorization, and they could not see the request that had just been filed.
//
// WHAT IS PINNED, AND WHY EACH ONE:
//
//   1. A FILED REQUEST APPEARS FOR ITS OWN COMPANY, at the TOP of the list. Not
//      "the array is non-empty" — the owner's requirement was that it reflect
//      INSTANTLY, and position nine of a fixture-ordered list is not that.
//   2. IT DOES NOT APPEAR FOR ANOTHER COMPANY'S SESSION, and the response says
//      so as a probe result rather than as an empty array. "Nothing was filed"
//      and "we never looked" must never render the same way — the same rule
//      `remoteProbe` already enforces one source over.
//   3. THE ROLE GATE IS UNMOVED. Adding a third source must not add a third way
//      in: an employee and an employer session still get 403 on both routes.
//   4. A REAL REMOTE ROW IS NEVER DISPLACED BY OURS. Proved by making one of our
//      records carry the SAME id as a live Remote request and checking which
//      survives — a collision that never happens by luck proves nothing.
//   5. THE DURABLE ROW IS WRITTEN BEFORE THE OUTWARD ACT. Proved by making the
//      outward act FAIL: the audit row and the store row must both still be
//      there, and the response must say the decision stands. An ordering test
//      that only ever runs the happy path cannot tell "first" from "at some
//      point".
//   6. `approved_by_remote` IS NEVER WRITTEN ON ANY PATH. Stage 3 is Remote's
//      own compliance verdict, has no endpoint at all, and this repository has
//      already shipped the defect of writing it once (src/uc04/workflow.js's
//      header). Asserted over the WHOLE payload of every write — the store row,
//      every Zendesk call and the response body — because a status string can
//      leak through any of them.
//
// HERMETIC WITH NO SOCKETS. The Remote client dispatches straight into
// src/remote/mockServer.js through createInProcessFetch(); the store is
// in-memory (no pgPool); the Zendesk client is a recording double. Nothing here
// binds a port or reaches the network.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createInProcessFetch, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import {
  AuthorizationStore,
  EMPLOYER_DECIDABLE_STATUS,
  EMPLOYER_DECISION_STATUSES,
} from "../src/uc04/authorizationStore.js";
import { createRemoteUiHandler } from "../src/remoteui/server.js";
import { createWorkAuthorizationStandin } from "../src/remoteui/workAuthStandin.js";
import { EMPLOYER_VERBS, REMOTE_ONLY_STATUSES } from "../src/remoteui/workAuthPolicy.js";
import {
  RECORD_HEADER,
  RECORD_ORIGIN,
  RECORD_ROW_KEY,
  partialCountry,
  toWorkAuthorizationShape,
} from "../src/remoteui/workAuthRecords.js";
import { resolveEmployerScope } from "../src/remoteui/workAuthScope.js";
import { UC04_AWAITING_EMPLOYER_TAG, ticketTags } from "../src/portal/ticketing.js";

const ADMIN = { "x-remoteui-session": "admin" };
const EMPLOYEE = { "x-remoteui-session": "employee" };
const EMPLOYER = { "x-remoteui-session": "employer" };

// Named rather than discovered: a fixture that silently disappears must fail a
// test, not quietly reduce what is covered.
const CHRIS_LEE = "8ab12460-b568-4c1e-af9d-09b1fabd8f46"; // co_amend_01
const LARS = "673a1884-86fb-4101-83d3-b6c544d93bca"; // co_northwind_02 — the boundary
const REMOTE_PENDING = "6b8e1d47-0c53-4a92-bf10-77d4c2e8a5f3"; // the mock's own pending request

let auditRows;
let zendeskCalls;

/** An audit logger that records the ORDER things happened in. */
function recordingAudit() {
  return {
    logDurable: async (row) => {
      auditRows.push({ durable: true, ...row });
      return row;
    },
    log: async (row) => {
      auditRows.push({ durable: false, ...row });
      return row;
    },
    logTraceStep: async () => {},
  };
}

/**
 * A Zendesk double that records every call WITH the number of audit rows that
 * existed when it was made. That count is what makes the ordering assertion an
 * ordering assertion rather than a presence one.
 */
function recordingZendesk({ fails = false } = {}) {
  const fail = () => {
    throw new Error("simulated 502 from Zendesk");
  };
  return {
    listGroups: async () => [{ id: 99001, name: "Mobility Specialists" }],
    flagForReview: async (id, patch) => {
      zendeskCalls.push({ kind: "flagForReview", id, patch, auditRowsBefore: auditRows.length });
      if (fails) fail();
      return { id };
    },
    createTicket: async (fields) => {
      zendeskCalls.push({ kind: "createTicket", fields, auditRowsBefore: auditRows.length });
      if (fails) fail();
      return { id: 4242 };
    },
    updateTicket: async () => ({}),
  };
}

/**
 * Seed one UC-04 request exactly as the portal's own adapter does — through
 * `createAuthorization()`, with the factor shape src/portal/server.js builds.
 * Written through the real store rather than as a literal, so a change to the
 * row shape breaks this test instead of silently drifting past it.
 */
function seedRequest(store, { employmentId = CHRIS_LEE, decision = "ready_for_approval", externalRef = "36", overrides = {} } = {}) {
  return store.createAuthorization({
    employmentId,
    requester: "co_admin_01",
    factors: {
      homeCountry: "US",
      nationality: "US",
      destination: { country: "PT" },
      startDate: "2026-09-14",
      endDate: "2026-09-21",
      visaType: "none",
      jobDuties: "Software engineering",
      hasContractSigningAuthority: false,
    },
    risk: { level: "low" },
    tripDays: 8,
    cumulativeDays: null,
    decision,
    reason: "all_gates_passed",
    flags: [],
    summary: "Eight days in Portugal, no contract-signing authority.",
    externalRef,
    source: "portal",
    ...overrides,
  });
}

function buildHandler({ store, zendesk, adminCompanyId, remote } = {}) {
  const client =
    remote ?? new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createRemoteUiHandler({
    remote: client,
    remoteWorkAuth: client,
    audit: recordingAudit(),
    amendmentStore: new AmendmentStore(),
    zendesk: zendesk ?? recordingZendesk(),
    employees: [],
    employmentIdFieldId: "1",
    workAuthStandin: createWorkAuthorizationStandin(),
    authorizationStore: store,
    ...(adminCompanyId ? { adminCompanyId } : {}),
  });
}

/** Drive the real handler with a real request/response pair. No socket. */
function call(h, { method = "GET", path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    req.method = method;
    req.url = path;
    req.headers = headers;
    const chunks = [];
    const res = {
      statusCode: 200,
      _headers: {},
      setHeader(k, v) {
        this._headers[k] = v;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          /* an asset, not JSON */
        }
        resolve({ status: this.statusCode, headers: this._headers, raw, json });
      },
    };
    Promise.resolve(h(req, res)).catch(reject);
  });
}

beforeEach(() => {
  auditRows = [];
  zendeskCalls = [];
  // A PATCH mutates the mock's request in place, so without this the first test
  // to approve leaves it approved for every test after it — and that failure
  // presents as an ABSENCE, indistinguishable from the feature not working.
  resetWorkAuthorizations();
});

// ---------------------------------------------------------------------------
// 1. IT APPEARS — the defect, closed
// ---------------------------------------------------------------------------

test("a request filed through the portal appears on the employer's screen", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const res = await call(buildHandler({ store }), { path: "/api/work-authorizations", headers: ADMIN });

  assert.equal(res.status, 200);
  const mine = res.json.requests.find((r) => r.id === row.id);
  assert.ok(mine, "the request filed on the portal must be on the employer's screen");
  assert.equal(mine.origin, RECORD_ORIGIN);
  assert.equal(mine.employmentId, CHRIS_LEE);
  assert.equal(mine.employeeName, "Chris Lee");
  assert.equal(mine.decidable, true);
  // The company is read off the EMPLOYMENT RECORD, never asserted by the row.
  assert.equal(mine.observedCompanyId, "co_amend_01");
});

test("it is at the TOP of the list — 'instantly' means first, not merely present", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const res = await call(buildHandler({ store }), { path: "/api/work-authorizations", headers: ADMIN });

  // Every stand-in fixture and the mock's own pending request carry 2026-08
  // submission dates; this row was created now. Newest first must put it first.
  assert.equal(res.json.requests[0].id, row.id);
});

test("the request object uses Remote's own field names, and omits what we do not hold", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const res = await call(buildHandler({ store }), { path: "/api/work-authorizations", headers: ADMIN });
  const entry = res.json.requests.find((r) => r.id === row.id);

  assert.equal(entry.request.status, "pending");
  assert.equal(entry.request.travel_date_start, "2026-09-14");
  assert.equal(entry.request.travel_date_end, "2026-09-21");
  assert.deepEqual(entry.request.destination_country, { alpha_2_code: "PT" });
  assert.equal(entry.request.will_negotiate_or_sign_contracts, false);

  // NOT FABRICATED. The portal's UC-04 intake collects none of these, so they
  // are absent rather than filled with plausible text nobody wrote.
  for (const absent of ["reason", "additional_information", "travel_document_number", "user", "work_location"]) {
    assert.ok(!(absent in entry.request), `${absent} must be omitted, never invented`);
  }

  // And the facts Remote's schema cannot express are OUTSIDE the request, so
  // nothing here teaches a field the real API has never returned.
  assert.equal(entry.offSchemaFactors.nationality, "US");
  assert.equal(entry.offSchemaFactors.jobDuties, "Software engineering");
  for (const invented of ["nationality", "jobDuties", "homeCountry", "visaType"]) {
    assert.ok(!(invented in entry.request), `${invented} is not a WorkAuthorizationRequest property`);
  }
});

test("a record of ours is self-identifying in three independent places", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const res = await call(buildHandler({ store }), { path: "/api/work-authorizations", headers: ADMIN });
  const entry = res.json.requests.find((r) => r.id === row.id);

  // 1. the origin discriminator, 2. a marker block on the record itself, and
  // 3. a response header naming the ids — so no single rendering decision can
  // hide that this is ours rather than Remote's.
  assert.equal(entry.origin, RECORD_ORIGIN);
  assert.ok(entry.request[RECORD_ROW_KEY], "the record must carry its own marker block");
  assert.equal(entry.request[RECORD_ROW_KEY].remoteRequestCreated, false);
  assert.match(entry.request[RECORD_ROW_KEY].note, /never sent to Remote/);
  assert.ok(res.headers[RECORD_HEADER].split(",").includes(row.id));
  // A DIFFERENT marker from the stand-in's: "we invented this trip" and
  // "somebody really filed this" are different claims.
  assert.ok(!entry.request._standin, "our record must not wear the stand-in's marker");
});

test("the entry carries what a dense one-line list needs", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store, { externalRef: "36" });
  const res = await call(buildHandler({ store }), { path: "/api/work-authorizations", headers: ADMIN });
  const entry = res.json.requests.find((r) => r.id === row.id);

  assert.match(entry.label, /Chris Lee/);
  assert.match(entry.label, /PT/);
  assert.match(entry.label, /2026-09-14/);
  assert.equal(entry.ticketId, "36");
  assert.equal(entry.filedVia, "portal");
  assert.equal(entry.assessment.decision, "ready_for_approval");
  assert.equal(entry.assessment.reason, "all_gates_passed");
  assert.equal(entry.outcome, null);
  // Every origin gets the same label/decidable fields, so the page renders ONE
  // list rather than three.
  for (const other of res.json.requests) {
    assert.equal(typeof other.label, "string");
    assert.equal(typeof other.decidable, "boolean");
  }
});

// ---------------------------------------------------------------------------
// 2. THE COMPANY BOUNDARY
// ---------------------------------------------------------------------------

test("a filed request does NOT appear for another company's session", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store); // Chris Lee, co_amend_01
  // The console now speaks for Northwind, where only Lars is employed.
  const res = await call(buildHandler({ store, adminCompanyId: "co_northwind_02" }), {
    path: "/api/work-authorizations",
    headers: ADMIN,
  });

  assert.equal(res.status, 200);
  assert.ok(!res.json.requests.some((r) => r.id === row.id), "Acme's request must not reach Northwind's admin");
  // And the absence is EXPLAINED: the store was asked, about Lars only.
  assert.equal(res.json.recordProbe.verdict, "answered");
  assert.equal(res.json.recordProbe.employmentsQueried, 1);
  assert.equal(res.json.recordProbe.rowsShown, 0);
});

test("the store is asked only about employments this session's company owns", async () => {
  const store = new AuthorizationStore();
  seedRequest(store, { employmentId: LARS });
  const asked = [];
  const spy = {
    listForEmployments: async (ids) => {
      asked.push([...ids]);
      return [];
    },
  };
  const client = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  await resolveEmployerScope({
    session: { companyId: "co_amend_01" },
    remote: client,
    standin: createWorkAuthorizationStandin(),
    authorizationStore: spy,
  });

  assert.equal(asked.length, 1);
  assert.ok(!asked[0].includes(LARS), "an employment at another company must never be asked about");
  assert.ok(asked[0].includes(CHRIS_LEE));
});

test("the employee and employer roles are still refused on both routes", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const h = buildHandler({ store });

  for (const headers of [EMPLOYEE, EMPLOYER]) {
    const listed = await call(h, { path: "/api/work-authorizations", headers });
    assert.equal(listed.status, 403);
    assert.equal(listed.json.code, "role_not_authorized");

    const decided = await call(h, {
      method: "POST",
      path: `/api/work-authorizations/${row.id}/decision`,
      body: { action: "approve" },
      headers,
    });
    assert.equal(decided.status, 403);
    assert.equal(decided.json.code, "role_not_authorized");
  }
  // Nothing was written by either refusal.
  assert.equal(auditRows.length, 0);
  assert.equal(zendeskCalls.length, 0);
});

test("quoting another company's record id is refused, not served", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store, { employmentId: LARS });
  const res = await call(buildHandler({ store }), {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });

  // 403 rather than 404: the record exists and is simply not this session's to
  // decide. Knowing an id entitles nobody to decide it.
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "not_your_company");
  assert.equal(auditRows.length, 0);
});

// ---------------------------------------------------------------------------
// 3. A REAL REMOTE ROW IS NEVER DISPLACED
// ---------------------------------------------------------------------------

test("a record of ours never displaces a real Remote row with the same id", async () => {
  // The collision is MANUFACTURED. A collision that never happens by luck
  // proves nothing about the rule that would stop it.
  const collide = {
    listForEmployments: async () => [
      {
        id: REMOTE_PENDING,
        createdAt: "2030-01-01T00:00:00Z", // newer than everything, so it would win on sort
        employmentId: CHRIS_LEE,
        status: EMPLOYER_DECIDABLE_STATUS,
        decision: "ready_for_approval",
        reason: "all_gates_passed",
        flags: [],
        factors: { destination: { country: "XX" } },
        source: "portal",
      },
    ],
  };
  const res = await call(buildHandler({ store: collide }), { path: "/api/work-authorizations", headers: ADMIN });

  const matches = res.json.requests.filter((r) => r.id === REMOTE_PENDING);
  assert.equal(matches.length, 1, "one id, one row");
  assert.equal(matches[0].origin, "remote_api", "Remote's row must survive, not ours");
  // Madrid, from the mock's real record — not the XX our colliding row claimed.
  assert.equal(matches[0].request.work_location, "Madrid");
  // And the displacement is REPORTED rather than silent.
  assert.deepEqual(res.json.recordProbe.displacedByRemote, [REMOTE_PENDING]);
});

// ---------------------------------------------------------------------------
// 4. EXCLUSIONS ARE VISIBLE, AND AN UNREAD STORE IS NOT AN EMPTY ONE
// ---------------------------------------------------------------------------

test("an escalated or blocked request is excluded from the screen and SAID", async () => {
  const store = new AuthorizationStore();
  const escalated = seedRequest(store, { decision: "escalate" });
  const blocked = seedRequest(store, { decision: "blocked" });
  const res = await call(buildHandler({ store }), { path: "/api/work-authorizations", headers: ADMIN });

  assert.ok(!res.json.requests.some((r) => r.id === escalated.id));
  assert.ok(!res.json.requests.some((r) => r.id === blocked.id));
  const excluded = res.json.scope.recordsNotForEmployer;
  assert.equal(excluded.length, 2);
  assert.match(excluded.find((e) => e.id === escalated.id).reason, /specialist team owns it/);
  assert.match(excluded.find((e) => e.id === blocked.id).reason, /hard gate/);
});

test("a store that cannot be read reports `unavailable`, never an empty screen", async () => {
  const broken = {
    listForEmployments: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  };
  const res = await call(buildHandler({ store: broken }), { path: "/api/work-authorizations", headers: ADMIN });

  assert.equal(res.json.recordProbe.verdict, "unavailable");
  assert.match(res.json.recordProbe.detail, /nothing is known about what it holds/);
});

test("no store at all reports `unavailable` rather than looking like nothing was filed", async () => {
  // `authorizationStore: undefined` falls through to the handler's own default,
  // so this asks the scope resolver directly — the one place the absence can be
  // expressed at all.
  const client = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const scope = await resolveEmployerScope({
    session: { companyId: "co_amend_01" },
    remote: client,
    standin: createWorkAuthorizationStandin(),
    authorizationStore: null,
  });
  assert.equal(scope.recordProbe.verdict, "unavailable");
  assert.equal(scope.recordProbe.asked, false);
});

// ---------------------------------------------------------------------------
// 5. THE EMPLOYER'S DECISION
// ---------------------------------------------------------------------------

test("approving a filed request records the verdict, then hands it to Zendesk", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store, { externalRef: "36" });
  const res = await call(buildHandler({ store }), {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve", employerSpecialInstructions: "No client contracts to be signed." },
    headers: ADMIN,
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.status, EMPLOYER_VERBS.approve);
  assert.equal(res.json.origin, RECORD_ORIGIN);
  assert.equal(res.json.remoteWrite.transmitted, false, "Remote holds no such request and must not be told");

  // The row moved, in Remote's own vocabulary.
  const stored = await store.findById(row.id);
  assert.equal(stored.status, EMPLOYER_DECISION_STATUSES.approve);
  assert.equal(stored.approver, "admin_jane");
  assert.equal(stored.approvalNote, "No client contracts to be signed.");
  assert.ok(stored.approvedAt);

  // And the case reached the Mobility Team on the ticket the intake raised.
  const handoff = zendeskCalls.find((c) => c.kind === "flagForReview");
  assert.ok(handoff, "the existing ticket must be updated, not a second one raised");
  assert.equal(handoff.id, "36");
  assert.ok(handoff.patch.additionalTags.includes("uc04_employer_approved"));
  assert.ok(handoff.patch.additionalTags.includes("queue_mobility_specialists"));
  assert.equal(handoff.patch.groupId, 99001, "the group id comes from the account, never a literal");
  assert.match(handoff.patch.note, /APPROVED/);
  assert.equal(res.json.handoff.delivered, true);
  assert.equal(res.json.handoff.created, false);

  // AND THE TAG THAT HAS JUST STOPPED BEING TRUE COMES OFF.
  //
  // Intake writes `uc04_awaiting_employer_approval`; `flagForReview()` ADDS
  // tags without replacing, so until 2026-09-01 nothing ever removed it. Read
  // live that evening: ticket 127 still carried it thirty-five minutes after
  // admin_jane had approved AND Remote's mobility team had cleared it — the
  // ticket asserting it was waiting for a decision already made twice over.
  //
  // ASSERTED AGAINST THE IMPORTED CONSTANT, not a retyped string. A remover
  // naming a tag nothing writes removes nothing and reports success, so a
  // literal here would keep passing while the defect came back.
  assert.ok(
    (handoff.patch.removeTags ?? []).includes(UC04_AWAITING_EMPLOYER_TAG),
    "the employer's approval left the ticket claiming it was still awaiting the employer"
  );
  // The tag the intake actually wrote IS that constant — the two halves are
  // pinned together, so this pair cannot both pass while naming different
  // strings.
  assert.ok(
    ticketTags("uc04", "ready_for_approval").includes(UC04_AWAITING_EMPLOYER_TAG),
    "the constant no longer names a tag intake writes, so removing it is a no-op"
  );
  // `uc04_specialist_approval` STAYS. After the employer approves, a Remote
  // mobility specialist genuinely is the next reader.
  assert.ok(!(handoff.patch.removeTags ?? []).includes("uc04_specialist_approval"));
});

test("declining requires a reason, records it, and does not route the ticket as new work", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store, { externalRef: "36" });
  const h = buildHandler({ store });

  const noReason = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "decline" },
    headers: ADMIN,
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, "decline_reason_required");
  assert.equal((await store.findById(row.id)).status, EMPLOYER_DECIDABLE_STATUS, "a refused decline changes nothing");

  const declined = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "decline", reason: "The destination is out of policy for this quarter." },
    headers: ADMIN,
  });
  assert.equal(declined.status, 200);
  const stored = await store.findById(row.id);
  assert.equal(stored.status, EMPLOYER_DECISION_STATUSES.decline);
  assert.equal(stored.declinedBy.approver, "admin_jane");
  assert.match(stored.declinedBy.note, /out of policy/);

  const handoff = zendeskCalls.find((c) => c.kind === "flagForReview");
  assert.ok(handoff.patch.additionalTags.includes("uc04_employer_declined"));
  // A declined request is FINISHED — nobody downstream has anything to do — so
  // it is recorded on the ticket and deliberately not pushed into a queue.
  assert.equal(handoff.patch.groupId, undefined);
});

test("a decided request is no longer decidable, and a second delivery cannot overwrite the first", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const h = buildHandler({ store });

  await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  const again = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "decline", reason: "changed my mind" },
    headers: ADMIN,
  });

  // The policy stops it before the store does — but the store's own conditional
  // update is the belt to that braces, and is asserted directly below.
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "not_awaiting_manager");
  assert.equal((await store.findById(row.id)).status, EMPLOYER_DECISION_STATUSES.approve);

  const second = await store.recordEmployerDecision(row.id, { action: "decline", approver: "someone_else" });
  assert.equal(second, null, "the store itself must refuse to re-decide a settled row");
});

test("a decided request still renders, with its outcome, rather than vanishing", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  const h = buildHandler({ store });
  await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve", employerSpecialInstructions: "Fine by me." },
    headers: ADMIN,
  });

  const listed = await call(h, { path: "/api/work-authorizations", headers: ADMIN });
  // Off the pending list — it is nobody's to decide now …
  assert.ok(!listed.json.requests.some((r) => r.id === row.id));
  // … and still in the company's full set, so quoting its id answers
  // "already decided" rather than "no such request".
  const decided = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(decided.json.code, "not_awaiting_manager");

  const shaped = toWorkAuthorizationShape(await store.findById(row.id));
  assert.equal(shaped.status, EMPLOYER_VERBS.approve);
  assert.equal(shaped.employer_special_instructions, "Fine by me.");
  assert.equal(shaped.employer_approver.id, "admin_jane");
});

// ---------------------------------------------------------------------------
// 6. ORDERING: THE DURABLE RECORD FIRST, THE OUTWARD ACT SECOND
// ---------------------------------------------------------------------------

test("the audit row is written BEFORE the Zendesk call", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store, { externalRef: "36" });
  await call(buildHandler({ store }), {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });

  const handoff = zendeskCalls.find((c) => c.kind === "flagForReview");
  assert.ok(handoff.auditRowsBefore >= 1, "Zendesk must not be called before anything was audited");
  const first = auditRows[0];
  assert.equal(first.durable, true, "the decision row must be logDurable(), not a fire-and-forget log()");
  assert.equal(first.action, "work_authorization_employer_approved");
  assert.equal(first.actor, "admin_jane");
  // src/auditview/readStore.js searches `details->>'externalRef'` BY NAME, so a
  // row without it cannot be found from the one id a human holds.
  assert.equal(first.details.workAuthorizationId, row.id);
  assert.equal(first.details.remoteReviewOutstanding, true);
});

test("a Zendesk failure loses the ACT, never the DECISION", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store, { externalRef: "36" });
  const res = await call(buildHandler({ store, zendesk: recordingZendesk({ fails: true }) }), {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });

  // The decision succeeded and is durable in both places …
  assert.equal(res.status, 200);
  assert.equal((await store.findById(row.id)).status, EMPLOYER_DECISION_STATUSES.approve);
  assert.ok(auditRows.some((r) => r.durable && r.action === "work_authorization_employer_approved"));
  // … and the failure is NAMED, not swallowed.
  assert.equal(res.json.handoff.delivered, false);
  assert.match(res.json.handoff.detail, /Zendesk was NOT updated/);
  const failure = auditRows.find((r) => r.action === "work_authorization_employer_handoff_failed");
  assert.ok(failure, "a hand-off that did not happen must leave a row saying so");
  assert.equal(failure.details.externalRef, "36");
});

test("a request with no ticket gets one raised, and the record is repointed at it", async () => {
  const store = new AuthorizationStore();
  // A portal reference, not a ticket id — the shape that names no ticket.
  const row = seedRequest(store, { externalRef: "uc04-20260831-abcde" });
  const res = await call(buildHandler({ store }), {
    method: "POST",
    path: `/api/work-authorizations/${row.id}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });

  const created = zendeskCalls.find((c) => c.kind === "createTicket");
  assert.ok(created, "a decision with nowhere to land must raise a ticket");
  assert.ok(created.fields.tags.includes("uc04_employer_approved"));
  assert.equal(created.fields.comment.public, false, "a stage-3 compliance review is internal");
  assert.deepEqual(created.fields.custom_fields, [{ id: 1, value: CHRIS_LEE }]);
  assert.equal(res.json.handoff.created, true);
  assert.equal(res.json.handoff.ticketId, "4242");
  // Repointed, so the ZAF sidebar's by-ticket lookup can find this case at all.
  assert.equal((await store.findById(row.id)).externalRef, "4242");
});

// ---------------------------------------------------------------------------
// 7. `approved_by_remote` IS NEVER WRITTEN, ON ANY PATH
// ---------------------------------------------------------------------------

test("no path writes a status only Remote can set", async () => {
  const store = new AuthorizationStore();
  const approve = seedRequest(store, { externalRef: "36" });
  const decline = seedRequest(store, { externalRef: "37" });
  const h = buildHandler({ store });

  const a = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${approve.id}/decision`,
    body: { action: "approve", employerSpecialInstructions: "ok" },
    headers: ADMIN,
  });
  const d = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${decline.id}/decision`,
    body: { action: "decline", reason: "no" },
    headers: ADMIN,
  });
  const listed = await call(h, { path: "/api/work-authorizations", headers: ADMIN });

  // EVERY VALUE that was written or returned — a store row, a Zendesk payload,
  // an audit detail, a response body — not just the field that seemed likeliest.
  //
  // MATCHED AS A WHOLE VALUE, NOT AS A SUBSTRING, and that is deliberate rather
  // than a weakening. A status leaks as a value; `approved_by_remote` also
  // appears legitimately INSIDE STAGE_3_NOTE, the paragraph this system posts to
  // say that only Remote can produce that status and that this decision is not
  // it. A substring guard would have to be switched off for the one sentence
  // whose whole job is honesty about this, and a guard with an exception for the
  // honest case is not a guard.
  const values = [];
  const walk = (v) => {
    if (typeof v === "string") values.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, val] of Object.entries(v)) (values.push(k), walk(val));
  };
  walk({
    stored: [await store.findById(approve.id), await store.findById(decline.id)],
    zendesk: zendeskCalls,
    audit: auditRows,
    responses: [a.json, d.json],
  });
  for (const forbidden of REMOTE_ONLY_STATUSES) {
    assert.ok(!values.includes(forbidden), `${forbidden} must never be written by this system`);
  }
  // The one place it does appear is prose that says we cannot set it — checked
  // positively, so the guard above cannot be passing because nothing was said.
  const note = zendeskCalls.find((c) => c.kind === "flagForReview").patch.note;
  assert.match(note, /approved_by_remote/);
  assert.match(note, /Remote publishes no endpoint for that stage/);
  // And the list response names them only as the things we do NOT write.
  assert.deepEqual(listed.json.remoteOnlyStatuses, REMOTE_ONLY_STATUSES);
});

test("the store's employer verdicts are exactly the screen's two verbs", async () => {
  // Two vocabularies for one transition is two things to drift, and this pair
  // decides what a manager's approval is recorded AS.
  assert.deepEqual({ ...EMPLOYER_DECISION_STATUSES }, { ...EMPLOYER_VERBS });
  for (const forbidden of REMOTE_ONLY_STATUSES) {
    assert.ok(!Object.values(EMPLOYER_DECISION_STATUSES).includes(forbidden));
  }
});

test("the store refuses an action it does not recognise, rather than inventing a status", async () => {
  const store = new AuthorizationStore();
  const row = seedRequest(store);
  // Including the prototype-chain spelling: `EMPLOYER_DECISION_STATUSES
  // ["constructor"]` would otherwise resolve to a truthy value that is not a
  // status (finding F-21's pattern).
  for (const action of ["approve_by_remote", "constructor", "toString", "", null]) {
    assert.equal(await store.recordEmployerDecision(row.id, { action, approver: "x" }), null);
  }
  assert.equal((await store.findById(row.id)).status, EMPLOYER_DECIDABLE_STATUS);
});

// ---------------------------------------------------------------------------
// 8. THE SMALL PURE PIECES
// ---------------------------------------------------------------------------

test("a country code is placed by SHAPE, never assumed to be alpha-2", async () => {
  // normalizeEmployment() shipped the mirror-image defect — a 3-letter code in a
  // field only ever compared against 2-letter values — and it took a shape check
  // to close it (CLAUDE.md §7 item 3).
  assert.deepEqual(partialCountry("pt"), { alpha_2_code: "PT" });
  assert.deepEqual(partialCountry("PRT"), { code: "PRT" });
  assert.equal(partialCountry("Portugal"), null);
  assert.equal(partialCountry(null), null);
});

test("a row whose status names no employer decision maps to nothing", async () => {
  for (const status of ["escalated", "blocked", "executed", "constructor", null]) {
    assert.equal(toWorkAuthorizationShape({ id: "x", status }), null);
  }
});
