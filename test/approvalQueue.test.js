// ---------------------------------------------------------------------------
// approvalQueue.test.js — the cross-use-case approval queue
// ---------------------------------------------------------------------------
// Five disciplines under test, each one a repo-wide rule applied to a surface
// whose whole job is to say what is broken:
//
//   1. NO POST ROUTE EXISTS — behaviourally (any write-shaped request 404s) and
//      structurally (the server source, stripped of comments, never mentions
//      the method). The same pair test/uc08.test.js and test/auditview.test.js
//      pin for the other two read-only surfaces. This one matters more, not
//      less: a page that reports on approvals must not become a second place to
//      make one.
//
//   2. UNKNOWN IS NEVER CLEARED. Three separate places where a two-way branch
//      would quietly turn "we could not tell" into "it is fine": an
//      unrecognised status, an unverified ticket, and the stuck rollup.
//      Asserted in BOTH directions everywhere — a classifier that says
//      "unknown" to everything passes every one-directional test.
//
//   3. THE TWO KINDS OF MISSING APPROVAL CONTROL STAY APART. UC-07/UC-08's
//      "nothing may approve this" and UC-03's "something must and nothing can"
//      render the same on any surface that stores one boolean. They are checked
//      against the real sources here, so a POST route added to either kind
//      fails a test rather than quietly making the table wrong.
//
//   4. READS THROW (§9); the HTTP layer SHOWS the failure. A store error must
//      never be swallowed into an empty queue — "nothing is waiting for anyone"
//      is the most dangerous sentence this page could print.
//
//   5. BROWSER ASSETS COMPILE under node:vm and hold the no-innerHTML rule.
//
// All hermetic: fake pools, fake Zendesk, seeded stores, no sockets, no network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";

import { ApprovalQueueStore, NoDurableStoreError } from "../src/approvalqueue/queueStore.js";
import { buildQueueDemoDataset, demoZendesk } from "../src/approvalqueue/demoSeed.js";
import { createApprovalQueueHandler, withBaseHref } from "../src/approvalqueue/server.js";
import { buildQueue } from "../src/approvalqueue/queue.js";
import { TicketFacts, DEFAULT_BUDGET, MAX_BUDGET, TICKET_CACHE_TTL_MS, readBudget } from "../src/approvalqueue/ticketFacts.js";
import { awaitingState, approvalProgress, waited } from "../src/approvalqueue/awaiting.js";
import { ticketVerdict, groupVerdict, looksLikeTicketId } from "../src/approvalqueue/ticketVerdict.js";
import { stuckVerdict, summarise, CATEGORY_ORDER } from "../src/approvalqueue/stuck.js";
import { APPROVAL_ROUTES, controlStateFor } from "../src/approvalqueue/approvalRoutes.js";
import { teamProvisioning, teamProvisioningSummary } from "../src/approvalqueue/teams.js";
import { groupIdFor } from "../src/shared/escalationGroupIds.js";
import { resolveRoute, QUEUE_VIEW } from "../deploy/cx-apis/router.js";
import { QUEUE_BASE_PATH } from "../deploy/cx-apis/deps.js";
import { PORTS } from "../src/shared/ports.js";
import { OPEN_ACCESS, portalAccessPosture, PORTAL_KEY_HEADER, PORTAL_KEY_ENV } from "../src/portal/access.js";
import { CONSENT_AGE_WARN_DAYS } from "../src/shared/consentPolicy.js";

// --- doubles ------------------------------------------------------------------

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    headersSent: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(payload) {
      this.headersSent = true;
      this.body = payload === undefined ? null : payload;
    },
  };
}

function fakeReq(method, url, { headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

async function call(handler, req, res = fakeRes()) {
  await handler(req, res);
  return { res, json: res.body ? JSON.parse(res.body) : null };
}

const NOW = Date.parse("2026-08-19T22:00:00.000Z");

function seededParts() {
  const seedData = buildQueueDemoDataset(NOW);
  return {
    store: new ApprovalQueueStore({ seedData }),
    ticketFacts: new TicketFacts({ zendesk: demoZendesk(seedData.tickets), subdomain: "demo-account", demo: true }),
  };
}

function seededHandler(overrides = {}) {
  const { store, ticketFacts } = seededParts();
  return createApprovalQueueHandler({ store, ticketFacts, access: OPEN_ACCESS, now: () => NOW, ...overrides });
}

// =============================================================================
// 1. no write path — behavioural and structural
// =============================================================================

test("ANY write-shaped request 404s as no_such_route — there is nothing there to refuse", async () => {
  const handler = seededHandler();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of ["/api/queue", "/api/meta", "/api/queue/uc04", "/api/anything"]) {
      const { res, json } = await call(handler, fakeReq(method, path));
      assert.equal(res.statusCode, 404, `${method} ${path}`);
      assert.equal(json.code, "no_such_route");
    }
  }
});

test("STRUCTURAL: the server source, stripped of comments, never mentions a write method", () => {
  const full = readFileSync(new URL("../src/approvalqueue/server.js", import.meta.url), "utf8");
  const code = full.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(!code.includes(`"${method}"`) && !code.includes(`'${method}'`), `server.js must not branch on ${method}`);
  }
});

test("STRUCTURAL: the store has no write statement — no insert/update/delete anywhere", () => {
  const full = readFileSync(new URL("../src/approvalqueue/queueStore.js", import.meta.url), "utf8");
  const code = full.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const verb of ["insert into", "update ", "delete from"]) {
    assert.ok(!code.toLowerCase().includes(verb), `queueStore.js must not contain "${verb}"`);
  }
});

test("STRUCTURAL: no approval policy is re-implemented here", () => {
  // The point of the surface is that it REPORTS on approvals. If it imported an
  // approval policy it could start deciding, and there would be two answers to
  // "may this person approve" with nothing keeping them in step.
  const files = ["queue.js", "stuck.js", "awaiting.js", "approvalRoutes.js", "ticketVerdict.js", "server.js"];
  const forbidden = ["approvalPolicy", "dualApprovalPolicy", "multiApprovalPolicy", "signoffPolicy", "reviewPolicy"];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/approvalqueue/${file}`, import.meta.url), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const name of forbidden) {
      assert.ok(!code.includes(name), `${file} must not import ${name}`);
    }
  }
});

// =============================================================================
// 2. the two kinds of missing approval control, checked against the real code
// =============================================================================

test("UC-07 and UC-08 have no approval control BY DESIGN, and their servers really have no POST route", () => {
  for (const useCase of ["UC-07", "UC-08"]) {
    assert.equal(controlStateFor(useCase), "none_by_design");
  }
  for (const file of ["uc07", "uc08"]) {
    const source = readFileSync(new URL(`../src/${file}/server.js`, import.meta.url), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!code.includes('"POST"'), `${file}/server.js must have no POST route`);
  }
});

test("UC-03's absence was the OTHER kind, and it is now closed — the state survives with no members", () => {
  // THIS VIEW'S OWN RESULT. UC-03 was the only `none_missing` row: a formal
  // travel letter drafted, stored and queued, and no route anywhere to sign it.
  // The surface was built for exactly that one outcome (UC-03.md §15.2), so the
  // row is now `exists` — while the four `route_to_uc04` rows this queue counted
  // as stuck deliberately got NO control, because a handoff is not an approval.
  assert.equal(controlStateFor("UC-03"), "exists");
  const source = readFileSync(new URL("../src/uc03/server.js", import.meta.url), "utf8");
  assert.ok(source.includes('req.method === "POST"'), "uc03/server.js has the sign-off route this table now claims");

  // The STATE is not deleted along with its last member. An empty
  // `none_missing` is what a queue that has done its job looks like, and the
  // next use case to draft an artifact nobody can release has to land in it
  // rather than being rounded into `none_by_design`.
  assert.equal(
    Object.values(APPROVAL_ROUTES).filter((r) => r.control === "none_missing").length,
    0,
    "no use case is stuck without a surface today"
  );
  assert.ok(
    readFileSync(new URL("../src/approvalqueue/approvalRoutes.js", import.meta.url), "utf8").includes("none_missing"),
    "and the state itself is still defined, so a future one can be reported"
  );
});

test("the seven use cases that DO have a control really have a POST route", () => {
  const servers = {
    "UC-01": "review",
    "UC-02": "uc02",
    "UC-03": "uc03",
    "UC-04": "uc04",
    "UC-05": "uc05",
    "UC-06": "uc06",
    "UC-09": "uc09",
  };
  for (const [useCase, dir] of Object.entries(servers)) {
    assert.equal(APPROVAL_ROUTES[useCase].control, "exists", useCase);
    const source = readFileSync(new URL(`../src/${dir}/server.js`, import.meta.url), "utf8");
    assert.ok(source.includes('req.method === "POST"'), `${dir}/server.js must have the POST route this table claims`);
  }
});

test("the missing-control states are DIFFERENT values, not one boolean", () => {
  // The whole reason this file exists: `!hasControl` would have made UC-03 and
  // UC-07 the same item on the page, which is the one conflation this view must
  // not make. Asserted on the STATES rather than on two rows that happen to hold
  // them, so it keeps holding now that UC-03's row has moved to `exists`.
  const src = readFileSync(new URL("../src/approvalqueue/approvalRoutes.js", import.meta.url), "utf8");
  assert.ok(src.includes("none_missing") && src.includes("none_by_design"));
  assert.notEqual("none_missing", "none_by_design");
  assert.notEqual(controlStateFor("UC-03"), controlStateFor("UC-07"));
});

// =============================================================================
// 3. awaiting: unknown is never cleared
// =============================================================================

test("a recognised waiting status is awaiting, and a recognised settled status is settled", () => {
  assert.equal(awaitingState({ useCase: "UC-04", status: "pending_specialist_approval" }).state, "awaiting");
  assert.equal(awaitingState({ useCase: "UC-04", status: "executed" }).state, "settled");
  assert.equal(awaitingState({ useCase: "UC-06", status: "pending_dual_approval" }).state, "awaiting");
  assert.equal(awaitingState({ useCase: "UC-06", status: "declined" }).state, "settled");
});

test("an UNRECOGNISED status is 'unknown' — never quietly settled", () => {
  for (const status of ["on_hold_pending_legal", "", null, "brand_new_state"]) {
    const verdict = awaitingState({ useCase: "UC-05", status });
    assert.equal(verdict.state, "unknown", `status ${JSON.stringify(status)}`);
    assert.notEqual(verdict.state, "settled");
  }
});

test("a use case with no registered status vocabulary is 'unknown', not settled", () => {
  assert.equal(awaitingState({ useCase: "UC-99", status: "anything" }).state, "unknown");
});

test("review_queue drives UC-01/UC-03, and its three answers stay three", () => {
  assert.equal(awaitingState({ useCase: "UC-03", status: "routed", queueStatus: "pending" }).state, "awaiting");
  assert.equal(awaitingState({ useCase: "UC-03", status: "routed", queueStatus: "approved" }).state, "settled");
  assert.equal(awaitingState({ useCase: "UC-03", status: "routed", queueStatus: null }).state, "settled");
  assert.equal(awaitingState({ useCase: "UC-03", status: "routed", queueStatus: "parked" }).state, "unknown");
});

test("G-3/L-19: a pending consent request is awaiting the EMPLOYEE, even with no review_queue row at all", () => {
  // `awaiting_consent` deliberately creates NO review_queue entry — the
  // person waited on is the employee, not a specialist. Without the special
  // case in awaiting.js, `queueStatus: null` would fall through to "no
  // review-queue entry was created... settled", which is backwards for a
  // request that is, by construction, still waiting on a person.
  const verdict = awaitingState({ useCase: "UC-01", status: "awaiting_consent", queueStatus: null });
  assert.equal(verdict.state, "awaiting");
  assert.equal(verdict.waitingFor, "consent");
});

test("G-3/L-19: a consent request with NO ticket at all is reachable, not stuck — the third-party door raises none by design", () => {
  const awaiting = { state: "awaiting", waitingFor: "consent" };
  const verdict = stuckVerdict({
    awaiting,
    ticket: { state: "none" },
    control: "unknown",
    useCase: "UC-01",
    owningGroup: null,
  });
  assert.equal(verdict.stuck, false);
  assert.match(verdict.why, /employee/i);
  assert.match(verdict.why, /not a zendesk/i);
});

// -----------------------------------------------------------------------
// G-4/F3: L-19's policy figure, surfaced on THIS page — the operator
// surface VC-32 names — not only the portal (the employee's own surface).
// stuck.js:172 says "See the age (L-19): our own policy figure decides
// when this reads as waiting a while" without anywhere on this page ever
// printing that figure; these pin that it now does, sourced from the same
// ../shared/consentPolicy.js the portal reads (one figure, never two).
// -----------------------------------------------------------------------

function fakeQueueStore(records) {
  return {
    mode: () => "fake",
    async listRecords() {
      return records;
    },
    async ticketLinks() {
      return { byRecordId: new Map(), bySubmittedRef: new Map() };
    },
  };
}

test("G-4/F3: a waiting-long consent item carries the policy figure and the verdict, on the queue itself", async () => {
  const oldCreatedAt = new Date(NOW - (CONSENT_AGE_WARN_DAYS + 2) * 24 * 60 * 60 * 1000).toISOString();
  const store = fakeQueueStore([
    {
      useCase: "UC-01",
      recordId: "c1",
      createdAt: oldCreatedAt,
      employmentId: "emp1",
      requester: null,
      decision: "awaiting_employee_consent",
      reason: "third_party_request",
      status: "awaiting_consent",
      reference: null,
      source: "third_party_door",
      queueStatus: null,
      raw: {},
    },
  ]);
  const queue = await buildQueue({ store, ticketFacts: new TicketFacts(), now: NOW });
  const item = queue.items.find((i) => i.recordId === "c1");
  assert.ok(item, "the consent item must appear in the queue");
  assert.deepEqual(item.consentAgePolicy, { days: CONSENT_AGE_WARN_DAYS, waitingLong: true });
});

test("G-4/F3: a fresh consent item carries the same policy figure but waitingLong is false", async () => {
  const freshCreatedAt = new Date(NOW - 1 * 60 * 60 * 1000).toISOString();
  const store = fakeQueueStore([
    {
      useCase: "UC-01",
      recordId: "c2",
      createdAt: freshCreatedAt,
      employmentId: "emp1",
      requester: null,
      decision: "awaiting_employee_consent",
      reason: "third_party_request",
      status: "awaiting_consent",
      reference: null,
      source: "third_party_door",
      queueStatus: null,
      raw: {},
    },
  ]);
  const queue = await buildQueue({ store, ticketFacts: new TicketFacts(), now: NOW });
  const item = queue.items.find((i) => i.recordId === "c2");
  assert.deepEqual(item.consentAgePolicy, { days: CONSENT_AGE_WARN_DAYS, waitingLong: false });
});

test("G-4/F3: an item NOT waiting on consent carries no consent age policy at all", async () => {
  const store = fakeQueueStore([
    {
      useCase: "UC-02",
      recordId: "e1",
      createdAt: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
      employmentId: "emp1",
      requester: null,
      decision: null,
      reason: null,
      status: "flagged",
      reference: null,
      source: "portal",
      queueStatus: undefined,
      raw: {},
    },
  ]);
  const queue = await buildQueue({ store, ticketFacts: new TicketFacts(), now: NOW });
  const item = queue.items.find((i) => i.recordId === "e1");
  assert.equal(item.consentAgePolicy, null, "a non-consent item must not carry a consent policy figure");
});

test("a dossier is always awaiting a reader — it has no status column to settle", () => {
  for (const useCase of ["UC-07", "UC-08"]) {
    const verdict = awaitingState({ useCase, status: null });
    assert.equal(verdict.state, "awaiting");
    assert.equal(verdict.waitingFor, "reading");
  }
});

test("an unreadable timestamp yields a null age, not a zero one", () => {
  const bad = waited("not a date", NOW);
  assert.equal(bad.hours, null);
  assert.match(bad.label, /unknown/);
  assert.equal(waited("2026-08-19T20:00:00Z", NOW).hours, 2);
});

// =============================================================================
// 4. multi-approver progress
// =============================================================================

test("UC-06's two slots report filled, outstanding, and who may no longer sign", () => {
  const progress = approvalProgress({
    useCase: "UC-06",
    row: { admin_approval: { approver: "jane@acme.test", at: "2026-08-19T10:00:00Z" }, payroll_approval: null },
  });
  assert.equal(progress.applies, true);
  assert.equal(progress.required, 2);
  assert.equal(progress.filled, 1);
  assert.deepEqual(progress.outstanding, ["Payroll specialist"]);
  assert.deepEqual(progress.barred, ["jane@acme.test"]);
});

test("UC-09's floor of two survives a row that records fewer", () => {
  // The floor is Math.max(2, …) in the policy and this view must not present a
  // lower number as satisfiable — restating the floor, never recomputing risk.
  const progress = approvalProgress({
    useCase: "UC-09",
    row: { approval_slots_required: 1, requester_approval: null, approver_approval: null, payment_releaser_approval: null },
  });
  assert.equal(progress.required, 2);
  assert.match(progress.note, /floor/);
});

test("UC-09 with a third slot required reports all three", () => {
  const progress = approvalProgress({
    useCase: "UC-09",
    row: {
      approval_slots_required: 3,
      requester_approval: { approver: "a@x.test" },
      approver_approval: null,
      payment_releaser_approval: null,
    },
  });
  assert.equal(progress.required, 3);
  assert.equal(progress.slots.length, 3);
  assert.equal(progress.filled, 1);
});

test("a use case with one approver has no progress block at all", () => {
  assert.equal(approvalProgress({ useCase: "UC-04", row: {} }).applies, false);
});

// =============================================================================
// 5. ticket reachability: four answers, and the middle one is real
// =============================================================================

test("a reference that is not a ticket id means no ticket was ever raised", () => {
  const verdict = ticketVerdict({ reference: "f33-uc05-valid-a" });
  assert.equal(verdict.state, "none");
  assert.equal(verdict.url, null);
});

test("a ticket-shaped reference nobody checked is UNVERIFIED — not confirmed, not missing", () => {
  const verdict = ticketVerdict({ reference: "9002", lookup: null });
  assert.equal(verdict.state, "unverified");
  assert.notEqual(verdict.state, "confirmed");
  assert.notEqual(verdict.state, "not_found");
  // No link, because a link that would 404 must not be rendered.
  assert.equal(verdict.url, null);
});

test("a ticket-shaped reference that Zendesk does not have is NOT_FOUND", () => {
  // Live on 2026-08-19: references 9001/9002/2004/2007 all read as ticket ids
  // and none of them exists — they are mock-server ids. Shape is evidence, not
  // a verdict.
  const verdict = ticketVerdict({ reference: "9002", lookup: { checked: true, found: false } });
  assert.equal(verdict.state, "not_found");
  assert.equal(verdict.url, null);
});

test("only a CONFIRMED ticket gets a link", () => {
  const verdict = ticketVerdict({
    reference: "51",
    lookup: { checked: true, found: true, ticket: { id: 51, status: "open", group_id: 6168404929055 } },
    subdomain: "your-subdomain",
    owningGroup: "Finance Ops",
  });
  assert.equal(verdict.state, "confirmed");
  assert.equal(verdict.url, "https://your-subdomain.zendesk.com/agent/tickets/51");
});

test("a Zendesk read that FAILED is unknown, never missing", () => {
  const verdict = ticketVerdict({ reference: "51", lookup: { checked: false, reason: "the Zendesk read failed: boom" } });
  assert.equal(verdict.state, "unverified");
  assert.match(verdict.detail, /Zendesk read failed/);
});

test("looksLikeTicketId is shape only", () => {
  assert.equal(looksLikeTicketId("51"), true);
  assert.equal(looksLikeTicketId("uc04-20260819213107-17yir"), false);
  assert.equal(looksLikeTicketId(null), false);
});

test("a team with no group in this account is 'owner_absent', not 'elsewhere'", () => {
  // "Assigned to the wrong team" and "there is no such team" are different
  // problems with different fixes — re-assign the ticket, versus create the
  // group and re-sync — so they are different verdicts.
  //
  // THE FIXTURE IS A SYNTHETIC NAME ON PURPOSE. This used to name Mobility
  // Specialists, which was the live instance until the group was created on
  // 2026-08-20; the test then failed for the best possible reason, and pinning
  // it to whichever team happens to be missing this week would only queue up
  // the same failure. groupVerdict() takes the name as an argument, so a name
  // that will never be provisioned is the honest and durable fixture: what is
  // under test is the mechanism, and the mechanism is "this name resolves to no
  // id", not "this particular team is missing".
  const verdict = groupVerdict({ ticket: { group_id: 6151578998431 }, owningGroup: "A Team That Owns Work And Has No Queue" });
  assert.equal(verdict.state, "owner_absent");
  assert.equal(verdict.intendedId, null);
  // The detail must name the team it could not resolve — a reader who is told
  // only "owner absent" cannot act, and the fix is per-team.
  assert.match(verdict.detail, /A Team That Owns Work And Has No Queue/);
});

test("stuckVerdict maps an absent owner to its own category, and that mapping needs no account", () => {
  // The detector kept alive without a live gap to point it at. `queue_owner_absent`
  // has no members in production today and no seeded row can honestly reach it
  // (see the demo dataset's own note), so its rule is pinned here, on pure
  // inputs, where the state of the Zendesk account cannot make it pass or fail.
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "approval" },
    ticket: {
      state: "confirmed",
      group: { state: "owner_absent", intendedName: "A Team That Owns Work And Has No Queue" },
    },
    control: "exists",
    useCase: "UC-04",
    owningGroup: "A Team That Owns Work And Has No Queue",
  });
  assert.equal(verdict.stuck, true);
  assert.equal(verdict.category, "queue_owner_absent");
  // Not rounded into "queued elsewhere": the ticket is not in the wrong queue,
  // there was never a queue to put it in, and the why has to say so.
  assert.match(verdict.why, /has no group in this account/);
});

test("no routed team is unprovisioned today, and the check that says so is the same one that found the gap", () => {
  // A confirmation, deliberately kept beside the findings. `CONTRADICTIONS.md`
  // carries four `K-` confirmations next to its 27 findings for the same
  // reason: a check that can only ever report faults teaches its reader that
  // silence means "not run", and then a real green result is worth nothing.
  const summary = teamProvisioningSummary();
  assert.equal(summary.state, "all_provisioned");
  assert.deepEqual(summary.missing, []);
  assert.equal(summary.provisioned, summary.total);
  assert.ok(summary.total >= 9, "every team the routing table names is counted");
  // And it is a real comparison rather than a constant: give it a table with a
  // hole and it reports the hole, by name.
  const withGap = teamProvisioningSummary([
    { name: "Finance Ops", provisioned: true },
    { name: "A Team That Owns Work And Has No Queue", provisioned: false },
  ]);
  assert.equal(withGap.state, "gaps");
  assert.deepEqual(withGap.missing, ["A Team That Owns Work And Has No Queue"]);
  // An empty synced map is ONE problem with its own fix (run the sync), not N
  // missing groups — reporting it as N would send someone to create groups that
  // already exist.
  assert.equal(teamProvisioningSummary([{ name: "Finance Ops", provisioned: false }]).state, "none_provisioned");
  // And a routing table that names nobody is never cheerfully "all provisioned".
  assert.equal(teamProvisioningSummary([]).state, "no_teams_routed");
});

test("a ticket in the owning team's group is the only 'owning_team' answer", () => {
  assert.equal(groupVerdict({ ticket: { group_id: 6168404929055 }, owningGroup: "Finance Ops" }).state, "owning_team");
  assert.equal(groupVerdict({ ticket: { group_id: 6151578998431 }, owningGroup: "Finance Ops" }).state, "elsewhere");
  assert.equal(groupVerdict({ ticket: { group_id: null }, owningGroup: "Finance Ops" }).state, "unknown");
});

// =============================================================================
// 6. the stuck verdict itself
// =============================================================================

const reachableTicket = {
  state: "confirmed",
  group: { state: "owning_team", intendedName: "Finance Ops" },
};

test("a waiting item with a real ticket in the right queue and a control is NOT stuck", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "approval" },
    ticket: reachableTicket,
    control: "exists",
    useCase: "UC-02",
    owningGroup: "Finance Ops",
  });
  assert.equal(verdict.stuck, false);
});

test("a waiting item with no ticket is stuck under no_ticket", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "approval" },
    ticket: { state: "none", group: { state: "unknown", intendedName: null } },
    control: "exists",
    useCase: "UC-05",
    owningGroup: "HR Ops",
  });
  assert.equal(verdict.stuck, true);
  assert.equal(verdict.category, "no_ticket");
});

test("a 🔴 dossier that DID reach its team is not stuck, and says nothing may approve it", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "reading" },
    ticket: { state: "confirmed", group: { state: "owning_team", intendedName: "Mobility Legal (Tier-3)" } },
    control: "none_by_design",
    useCase: "UC-07",
    owningGroup: "Mobility Legal (Tier-3)",
  });
  assert.equal(verdict.stuck, false);
  assert.equal(verdict.byDesign, true);
  assert.match(verdict.why, /that is the design/);
});

test("a 🔴 dossier that reached NOBODY is stuck — and the why names the hand-off, not a control", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "reading" },
    ticket: { state: "none", group: { state: "unknown", intendedName: null } },
    control: "none_by_design",
    useCase: "UC-07",
    owningGroup: "Mobility Legal (Tier-3)",
  });
  assert.equal(verdict.stuck, true);
  assert.equal(verdict.category, "no_ticket");
  assert.match(verdict.why, /missing thing is the hand-off/);
});

test("a `none_missing` control is stuck even when its ticket is perfectly queued", () => {
  // UC-03 held this state and no longer does — its sign-off surface was built
  // (UC-03.md §15.2), which is the outcome this view existed to produce. The
  // CLASSIFIER's rule is what matters and it is asserted directly, so it keeps
  // being tested with no use case currently in the state: a ticket a specialist
  // can open and cannot act on is not a place to approve, however well queued.
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "approval" },
    ticket: { state: "confirmed", group: { state: "owning_team", intendedName: "Travel & Mobility Support" } },
    control: "none_missing",
    useCase: "UC-03",
    owningGroup: "Travel & Mobility Support",
  });
  assert.equal(verdict.stuck, true);
  assert.equal(verdict.category, "no_approval_surface");
});

test("an unverified ticket makes the item UNKNOWN — neither stuck nor reachable", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "approval" },
    ticket: { state: "unverified", group: { state: "unknown", intendedName: null } },
    control: "exists",
    useCase: "UC-02",
    owningGroup: "Finance Ops",
  });
  assert.equal(verdict.stuck, "unknown");
  assert.notEqual(verdict.stuck, false);
  assert.notEqual(verdict.stuck, true);
});

test("an item whose awaiting state is unknown is unknown here too", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "unknown", waitingFor: null },
    ticket: { state: "none", group: { state: "unknown", intendedName: null } },
    control: "exists",
    useCase: "UC-02",
    owningGroup: "Finance Ops",
  });
  assert.equal(verdict.stuck, "unknown");
});

test("a settled item is never stuck, whatever its ticket looks like", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "settled", waitingFor: null },
    ticket: { state: "not_found", group: { state: "unknown", intendedName: null } },
    control: "exists",
    useCase: "UC-02",
    owningGroup: "Finance Ops",
  });
  assert.equal(verdict.stuck, false);
});

test("more than one thing wrong reports the worst, and names the rest", () => {
  const verdict = stuckVerdict({
    awaiting: { state: "awaiting", waitingFor: "approval" },
    ticket: { state: "not_found", group: { state: "unknown", intendedName: null } },
    control: "none_missing",
    useCase: "UC-03",
    owningGroup: "Travel & Mobility Support",
  });
  assert.equal(verdict.category, "ticket_missing");
  assert.ok(verdict.also.length >= 1);
  assert.equal(CATEGORY_ORDER.indexOf("ticket_missing") < CATEGORY_ORDER.indexOf("no_approval_surface"), true);
});

test("the rollup keeps stuck, unknown and reachable as three separate counts", () => {
  const summary = summarise([
    { stuckVerdict: { stuck: true, category: "no_ticket" } },
    { stuckVerdict: { stuck: true, category: "no_ticket" } },
    { stuckVerdict: { stuck: "unknown", category: null } },
    { stuckVerdict: { stuck: false, category: null } },
  ]);
  assert.deepEqual(
    { total: summary.total, stuck: summary.stuck, unknown: summary.unknown, reachable: summary.reachable },
    { total: 4, stuck: 2, unknown: 1, reachable: 1 }
  );
  assert.deepEqual(summary.byCategory, [{ category: "no_ticket", label: "No ticket was ever raised", count: 2 }]);
});

// =============================================================================
// 7. the whole queue, end to end over the seeded dataset
// =============================================================================

test("the seeded queue separates waiting from settled and finds every stuck category", async () => {
  const { store, ticketFacts } = seededParts();
  const queue = await buildQueue({ store, ticketFacts, now: NOW });

  assert.equal(queue.mode, "seeded");
  assert.ok(queue.counts.waiting > 0);
  assert.ok(queue.counts.settled > 0, "the demo must contain a decided item too");

  const categories = queue.summary.byCategory.map((g) => g.category);
  for (const expected of ["no_ticket", "ticket_missing", "queued_elsewhere"]) {
    assert.ok(categories.includes(expected), `the demo dataset must exercise ${expected}`);
  }
  // TWO CATEGORIES ARE DELIBERATELY ABSENT, and each absence is a result rather
  // than a hole in the fixture. The dataset's rule is that every row is modelled
  // on a record found in production; a row seeded purely to keep this loop's
  // shape would make the demo assert something untrue about the system it is
  // demonstrating. Both categories' rules are pinned directly against
  // stuckVerdict() above, where no account state can reach them.
  //
  //   no_approval_surface — was the demo's UC-03 letter, until UC-03 got a
  //     sign-off surface.
  //   queue_owner_absent  — was the demo's UC-04 ticket #51, until the Mobility
  //     Specialists group was created on 2026-08-20. No routed team is
  //     unprovisioned now, so no honest row can reach it.
  for (const gone of ["no_approval_surface", "queue_owner_absent"]) {
    assert.ok(!categories.includes(gone), `nothing in the demo can honestly reach ${gone} any more`);
  }
  // BOTH DIRECTIONS: a classifier that called everything stuck would pass every
  // assertion above and be useless.
  assert.ok(queue.summary.reachable > 0, "some items must be reachable, or the classifier is just saying no");
});

test("items are ordered oldest first — the oldest thing nobody can act on is the point", async () => {
  const { store, ticketFacts } = seededParts();
  const queue = await buildQueue({ store, ticketFacts, now: NOW });
  const dates = queue.items.map((i) => i.createdAt);
  assert.deepEqual(dates, [...dates].sort());
});

test("the UC-04 demo item still reproduces ticket #51 — and #51 moved category without moving queue", async () => {
  // WHAT THIS ROW MEANT ON 2026-08-19: tagged `queue_mobility_specialists`,
  // sitting in the account's default Support group, and the account had no
  // Mobility Specialists group at all — `owner_absent`.
  //
  // WHAT IT MEANS NOW: the group was created on 2026-08-20 and the ticket did
  // not move, because creating a group does not re-queue tickets raised before
  // it existed. So the same fixture reads `elsewhere` — a real production
  // condition shared with the ten escalations #19–#33 that were raised before
  // assignment worked. The row is unchanged and still honest; the verdict it
  // draws is the one production gives today.
  //
  // It is still STUCK, which is the point: provisioning the group closed the
  // standing hole for every FUTURE UC-04 request and repaired nothing already
  // in flight.
  const { store, ticketFacts } = seededParts();
  const queue = await buildQueue({ store, ticketFacts, now: NOW });
  const item = queue.items.find((i) => i.reference === "51");
  assert.equal(item.ticket.state, "confirmed");
  assert.equal(item.ticket.group.state, "elsewhere");
  assert.equal(item.stuckVerdict.category, "queued_elsewhere");
  assert.equal(item.stuckVerdict.stuck, true);
  // The comparison is now a real one in both halves: the owning team resolves
  // to an id, and the ticket's group is a different id. Before 2026-08-20 the
  // intended id was null and only the actual side was known.
  assert.equal(item.ticket.group.intendedName, "Mobility Specialists");
  assert.ok(Number.isInteger(item.ticket.group.intendedId), "the owning team has a group id to compare against");
  assert.notEqual(String(item.ticket.group.actualId), String(item.ticket.group.intendedId));
  assert.equal(item.awaitingWho, "Mobility specialist");
});

test("with no Zendesk client every ticket-shaped reference is unverified, and nothing is called reachable on the strength of it", async () => {
  const seedData = buildQueueDemoDataset(NOW);
  const store = new ApprovalQueueStore({ seedData });
  const queue = await buildQueue({ store, ticketFacts: new TicketFacts(), now: NOW });

  assert.equal(queue.verification.state, "unverified");
  const ticketShaped = queue.items.filter((i) => looksLikeTicketId(i.reference));
  assert.ok(ticketShaped.length > 0);
  for (const item of ticketShaped) {
    assert.equal(item.ticket.state, "unverified", item.reference);
    assert.notEqual(item.stuckVerdict.stuck, false, "an unverified ticket must never read as reachable");
  }
});

test("the ticket lookup budget is spent, not silently exceeded", async () => {
  const seen = [];
  const facts = new TicketFacts({
    zendesk: {
      async getTicket(id) {
        seen.push(id);
        return { id: Number(id), status: "open", group_id: 1 };
      },
    },
    budget: 2,
  });
  const results = await facts.lookupMany(["1", "2", "3", "4"]);
  assert.equal(seen.length, 2);
  assert.equal(results.get("3").checked, false);
  assert.match(results.get("3").reason, /budget/);
});

// ---------------------------------------------------------------------------
// The lookup budget and the cross-invocation cache.
//
// One /queue render used to be worth up to 60 serial Zendesk reads plus a token
// fetch, with a PER-INSTANCE cache in front of them — and deploy/cx-apis/deps.js
// builds a fresh TicketFacts per invocation, so nothing was ever reused and the
// second load of the same page paid the full 60 again. Zendesk rate-limits per
// ACCOUNT, and that account is the one the live n8n pipeline runs on: a few
// impatient refreshes of a read-only viewer could 429 the automation that
// answers real customers, with nothing in this page's logs to connect the two.
//
// Four properties are pinned below, and the fourth is the one this repo keeps
// paying for: a truncated render must be distinguishable from a complete one.
// ---------------------------------------------------------------------------

test("the default lookup budget is small enough that a page render cannot threaten the shared Zendesk account", () => {
  // Not a restatement of the constant — a bound with a reason. Zendesk's
  // per-account limit is per MINUTE and is shared with the n8n pipeline, so one
  // render (budget + one OAuth token fetch) must stay a small fraction of the
  // most restrictive plan tier's 200/minute. 60 was up to 30% of it.
  assert.ok(DEFAULT_BUDGET <= 20, `one render may cost at most ${DEFAULT_BUDGET} Zendesk reads, which is too many to be safe`);
  assert.ok(DEFAULT_BUDGET >= 5, "a budget this small would report almost the whole page as unverified");
});

test("an unusable budget override falls back to the safe default rather than silently widening it", () => {
  // Same direction as rateLimit.js's readPositiveInt() and the door's
  // readIntakeWindowMs(): a typo must never become a bigger number.
  assert.equal(readBudget(undefined, 15), 15);
  assert.equal(readBudget("", 15), 15);
  assert.equal(readBudget("abc", 15), 15);
  assert.equal(readBudget("0", 15), 15);
  assert.equal(readBudget("-4", 15), 15);
  assert.equal(readBudget("7.5", 15), 15);
  assert.equal(readBudget("30", 15), 30, "a deliberate override is honoured");
  assert.equal(readBudget("100000", 15), MAX_BUDGET, "and clamped — no env var may turn this page into an account-wide outage");
});

test("the ticket cache survives across TicketFacts instances built over the same client", async () => {
  // THE DEPLOYMENT'S ACTUAL SHAPE: one long-lived Zendesk client, a fresh
  // wrapper per invocation (deps.js queueTicketFacts). Before this, the second
  // render re-read every id.
  const client = countingZendesk();
  await new TicketFacts({ zendesk: client }).lookupMany(["1", "2", "3"]);
  assert.deepEqual(client.calls, ["1", "2", "3"]);

  const second = new TicketFacts({ zendesk: client });
  const results = await second.lookupMany(["1", "2", "3"]);
  assert.deepEqual(client.calls, ["1", "2", "3"], "a second render must not re-read what the first one already read");
  assert.equal(results.get("2").checked, true, "and it still gets the answer");
  assert.equal(second.lookupReport().fromCache, 3);
  assert.equal(second.lookupReport().read, 0);
});

test("two different Zendesk clients never read each other's cached tickets", async () => {
  // The cache is keyed on the CLIENT object (a module-level WeakMap, the same
  // shape as rateLimit.js's ensuredPools) precisely so this cannot happen. A
  // cache keyed on the id alone would let the demo dataset — or a second
  // account — answer for the real one, which is a cross-account disclosure and
  // not merely a stale number.
  const accountA = countingZendesk((id) => ({ id: Number(id), status: "open", group_id: 111 }));
  const accountB = countingZendesk((id) => ({ id: Number(id), status: "solved", group_id: 222 }));

  await new TicketFacts({ zendesk: accountA }).lookupMany(["9"]);
  const fromB = await new TicketFacts({ zendesk: accountB }).lookupMany(["9"]);

  assert.deepEqual(accountB.calls, ["9"], "the second client must do its own read");
  assert.equal(fromB.get("9").ticket.group_id, 222, "and must get its OWN account's answer");
});

test("a cached ticket expires, so a ticket that was re-assigned is not shown as stale forever", async () => {
  // status/group_id/assignee_id are all mutable, and the reader of this page is
  // often the person who just changed one (§7 items 7-8 are a backlog of
  // wrongly-grouped tickets). An unexpiring cache would show them their own
  // repair as not yet done.
  const client = countingZendesk();
  let clock = 1_000_000;
  const facts = () => new TicketFacts({ zendesk: client, now: () => clock });

  await facts().lookupMany(["4"]);
  await facts().lookupMany(["4"]);
  assert.deepEqual(client.calls, ["4"], "within the TTL the read is reused");

  clock += TICKET_CACHE_TTL_MS + 1;
  await facts().lookupMany(["4"]);
  assert.deepEqual(client.calls, ["4", "4"], "past the TTL the ticket is read again");
});

test("a FAILED read is never cached — an unknown must not become sticky", async () => {
  // A failed lookup is "unknown, never missing" (this file's header). Caching
  // one would let a single transient 500 hold a healthy hand-off on the stuck
  // list for the whole TTL, across everybody's refreshes, with no read left to
  // correct it.
  let attempt = 0;
  const flaky = {
    async getTicket(id) {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return { id: Number(id), status: "open" };
    },
  };
  const first = await new TicketFacts({ zendesk: flaky }).lookupMany(["7"]);
  assert.equal(first.get("7").checked, false);

  const second = await new TicketFacts({ zendesk: flaky }).lookupMany(["7"]);
  assert.equal(second.get("7").checked, true, "the next render must retry rather than replay the failure");
  assert.equal(second.get("7").found, true);
});

test("a truncated refresh SAYS it is truncated — 'did not look' is never indistinguishable from 'clean'", async () => {
  const client = countingZendesk();
  const facts = new TicketFacts({ zendesk: client, budget: 2 });
  await facts.lookupMany(["1", "2", "3", "4"]);

  const report = facts.lookupReport();
  assert.equal(report.truncated, true);
  assert.equal(report.requested, 4);
  assert.equal(report.read, 2);
  assert.equal(report.unchecked, 2);
  // And in the prose the page actually renders, so a reader who never opens a
  // row still learns the render stopped looking.
  assert.match(facts.posture().detail, /2 of 4 ticket ids were NOT checked/);
  assert.equal(facts.posture().lastLookup.truncated, true);

  // The other direction, which is what makes the assertion above mean
  // anything: a render that checked everything must NOT claim truncation.
  const complete = new TicketFacts({ zendesk: countingZendesk(), budget: 10 });
  await complete.lookupMany(["1", "2"]);
  assert.equal(complete.lookupReport().truncated, false);
  assert.ok(!/NOT checked/.test(complete.posture().detail));
});

test("a posture read before any lookup reports null rather than claiming a complete refresh", async () => {
  // /api/meta calls posture() on an instance that never looked anything up.
  // "Nothing has been checked yet" and "everything checked out" are different
  // states and this page may not conflate them.
  const facts = new TicketFacts({ zendesk: countingZendesk() });
  assert.equal(facts.posture().lastLookup, null);
  await facts.lookupMany(["1"]);
  assert.equal(facts.posture().lastLookup.requested, 1);
});

/** A Zendesk double that records every id it was asked for. */
function countingZendesk(shape = (id) => ({ id: Number(id), status: "open", group_id: 1 })) {
  return {
    calls: [],
    async getTicket(id) {
      this.calls.push(String(id));
      return shape(id);
    },
  };
}

// =============================================================================
// 8. the store: modes, and reads that throw
// =============================================================================

test("with no pool and no seed the store refuses rather than serving demo rows", async () => {
  const store = new ApprovalQueueStore({});
  assert.equal(store.mode(), "unavailable");
  await assert.rejects(() => store.listRecords(), NoDurableStoreError);
});

test("the store reads all eight places, parameterised, when a pool is attached", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
  const store = new ApprovalQueueStore({ pgPool: pool });
  assert.equal(store.mode(), "supabase");
  await store.listRecords();

  for (const table of [
    "uc02_expenses",
    "uc04_authorizations",
    "uc05_resignations",
    "uc06_amendments",
    "uc09_adjustments",
    "uc07_dossiers",
    "uc08_dossiers",
    "review_queue",
  ]) {
    assert.ok(calls.some((c) => c.sql.includes(table)), `must read ${table}`);
  }
  // Every value that varies is bound, never interpolated.
  for (const c of calls) assert.ok(Array.isArray(c.params) && c.params.length > 0, c.sql);
});

test("uc02_expenses is NOT asked for a requester column — it does not have one", () => {
  // A 42703 against the live schema, caught before this view had ever rendered.
  const source = readFileSync(new URL("../src/approvalqueue/queueStore.js", import.meta.url), "utf8");
  const shared = source.slice(source.indexOf("select id, created_at"), source.indexOf("from ${table}"));
  assert.ok(!shared.includes("requester"), "the shared select must not assume a requester column");
});

// =============================================================================
// 9. the HTTP layer
// =============================================================================

test("GET /api/meta reports the mode, the verification posture, the nine routes and the teams", async () => {
  const { json } = await call(seededHandler(), fakeReq("GET", "/api/meta"));
  assert.equal(json.mode, "seeded");
  assert.equal(json.routes.length, 9);
  assert.ok(json.teams.length >= 9, "every routed team is listed, provisioned or not");
  assert.ok(json.categories.length > 0);

  // THE ENDPOINT MUST BE ABLE TO SAY "no gaps", not merely to list none. This
  // assertion used to require an unprovisioned team to be visible, which stopped
  // being satisfiable when the last missing group was created — an endpoint that
  // can only report faults is one whose silence a reader cannot interpret.
  assert.equal(json.teamProvisioning.state, "all_provisioned");
  assert.deepEqual(json.teamProvisioning.missing, []);
  assert.equal(json.teamProvisioning.total, json.teams.length);
  assert.match(json.teamProvisioning.headline, /have a Zendesk group in this account/);
  // And the table still carries the per-team fact, so a gap would be locatable
  // and not just countable.
  assert.ok(json.teams.every((t) => typeof t.provisioned === "boolean"));
});

test("GET /api/queue answers the whole payload", async () => {
  const { res, json } = await call(seededHandler(), fakeReq("GET", "/api/queue"));
  assert.equal(res.statusCode, 200);
  assert.ok(json.summary);
  assert.ok(Array.isArray(json.stuck));
  assert.ok(Array.isArray(json.unknown));
});

test("a store failure answers 500 queue_read_failed with the reason — never 200 with an empty queue", async () => {
  const handler = createApprovalQueueHandler({
    store: new ApprovalQueueStore({
      pgPool: {
        async query() {
          throw new Error("supabase is down");
        },
      },
    }),
    access: OPEN_ACCESS,
  });
  const { res, json } = await call(handler, fakeReq("GET", "/api/queue"));
  assert.equal(res.statusCode, 500);
  assert.equal(json.code, "queue_read_failed");
  assert.match(json.reason, /supabase is down/);
});

test("no durable store answers 503, not an empty list", async () => {
  const handler = createApprovalQueueHandler({ store: new ApprovalQueueStore({}), access: OPEN_ACCESS });
  const { res, json } = await call(handler, fakeReq("GET", "/api/queue"));
  assert.equal(res.statusCode, 503);
  assert.equal(json.code, "no_durable_store");
});

test("the API is gated by the portal's shared key; the page itself is not", async () => {
  const access = portalAccessPosture({ [PORTAL_KEY_ENV]: "s3cret" }, { persistent: true });
  const handler = seededHandler({ access });

  const pageRes = fakeRes();
  await handler(fakeReq("GET", "/"), pageRes);
  assert.equal(pageRes.statusCode, 200, "the shell is how an operator is told a key is needed");

  const refused = await call(handler, fakeReq("GET", "/api/queue"));
  assert.equal(refused.res.statusCode, 401);

  const allowed = await call(handler, fakeReq("GET", "/api/queue", { headers: { [PORTAL_KEY_HEADER]: "s3cret" } }));
  assert.equal(allowed.res.statusCode, 200);
});

test("a mounted page gets a <base> so its relative assets resolve", () => {
  assert.match(withBaseHref("<head>\n<title>x</title>", "/queue"), /<base href="\/queue\/" \/>/);
  assert.equal(withBaseHref("<head>", ""), "<head>");
});

// =============================================================================
// 10. ports and browser assets
// =============================================================================

test("the port comes from the registry, and no server file hard-codes one", () => {
  assert.equal(typeof PORTS.APPROVAL_QUEUE, "number");
  for (const file of ["server.js", "cli.js"]) {
    const source = readFileSync(new URL(`../src/approvalqueue/${file}`, import.meta.url), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\b40[0-9]{2}\b/.test(code), `${file} must not contain a port literal`);
  }
});

test("the browser assets compile, hold no innerHTML, and re-derive no verdict", () => {
  const app = readFileSync(new URL("../src/approvalqueue/assets/app.js", import.meta.url), "utf8");
  new vm.Script(app); // a syntax error here would otherwise ship silently
  assert.ok(!app.includes("innerHTML"), "every dynamic value goes through textContent");
  // The page must not decide whether something is stuck; it renders the word.
  assert.ok(!app.includes('stuckVerdict.stuck = '), "the page must not assign a verdict");
  assert.ok(!/=== "pending_/.test(app), "the page must not branch on a store's status vocabulary");
});

test("the page renders no control that could approve anything", () => {
  const html = readFileSync(new URL("../src/approvalqueue/assets/index.html", import.meta.url), "utf8");
  for (const word of ["Approve<", "Decline<", "Deny<", "Sign off<"]) {
    assert.ok(!html.includes(word), `the page must not offer ${word}`);
  }
  // The one form on the page is the access-key prompt, and it GETs afterwards.
  assert.equal((html.match(/<form/g) || []).length, 1);
});

test("every routing team is named by the provisioning table", () => {
  const teams = teamProvisioning();
  assert.ok(teams.length >= 8);
  assert.ok(teams.every((t) => Array.isArray(t.useCases) && t.useCases.length > 0));
  // Unprovisioned first — the page preserves the order it is given. Guarded,
  // because "there are none" is now the normal case and must not fail the sort
  // assertion.
  const firstProvisioned = teams.findIndex((t) => t.provisioned);
  const lastUnprovisioned = teams.map((t) => t.provisioned).lastIndexOf(false);
  if (firstProvisioned !== -1 && lastUnprovisioned !== -1) assert.ok(lastUnprovisioned < firstProvisioned);
  // Every routing name in the table resolves against the same map the n8n
  // graphs and the Node services assign from, so a team added to
  // escalationRouting.js without a group shows up here rather than in a silent
  // mis-assignment. The map is regenerated by `npm run sync-groups`, never by hand.
  for (const team of teams) {
    assert.equal(team.provisioned, groupIdFor(team.name) !== null, team.name);
    assert.equal(team.groupId, groupIdFor(team.name), team.name);
  }
});

// =============================================================================
// 11. the deployment mount
// =============================================================================

test("/queue resolves to its own route kind on the deployment, with the inner path preserved", () => {
  const route = resolveRoute("/api?__cx_path=queue/api/queue");
  assert.equal(route.kind, "queue");
  assert.equal(route.innerPath, "/api/queue");
  assert.equal(resolveRoute("/api?__cx_path=queue").kind, "queue");
  assert.equal(resolveRoute("/api?__cx_path=queue").innerPath, "/");
});

test("the mount is declared read-only, and that is a fact about the code", () => {
  assert.equal(QUEUE_VIEW.writes, false);
  assert.equal(QUEUE_BASE_PATH, "/queue");
});

test("mounting /queue did not swallow another prefix", () => {
  assert.equal(resolveRoute("/api?__cx_path=uc04/api/authorizations/by-ticket/51").kind, "usecase");
  assert.equal(resolveRoute("/api?__cx_path=portal/api/requests/uc04").kind, "portal");
  assert.equal(resolveRoute("/api?__cx_path=audit/api/decisions").kind, "audit");
  assert.equal(resolveRoute("/api?__cx_path=queueing/api").kind, "unknown");
});

test("a seeded run does not claim to have read Zendesk", () => {
  // The demo dataset's fake client answers exactly like the real one, so the
  // posture has to be told which it is. Reporting demo lookups as Zendesk reads
  // would be the page asserting an integration it does not have — the same lie
  // as serving demo rows unlabelled.
  const seedData = buildQueueDemoDataset(NOW);
  const demo = new TicketFacts({ zendesk: demoZendesk(seedData.tickets), demo: true });
  assert.equal(demo.posture().state, "demo");
  assert.ok(!demo.posture().detail.includes("read back from Zendesk"));
  assert.equal(new TicketFacts({ zendesk: demoZendesk(seedData.tickets) }).posture().state, "verifying");
});
