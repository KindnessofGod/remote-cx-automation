// ---------------------------------------------------------------------------
// auditview.test.js — the execution & audit trail viewer
// ---------------------------------------------------------------------------
// Four disciplines under test, each one a repo-wide rule applied to a new
// surface:
//   1. READS THROW (§9). A store error must surface as an error the page
//      renders, never be swallowed into an empty list that reads as "nothing
//      happened".
//   2. NO POST ROUTE EXISTS — behaviourally (a POST 404s no_such_route) and
//      structurally (the server source, stripped of comments, never mentions
//      the method), the same pair of assertions test/uc08.test.js pins for
//      the other read-only surface.
//   3. VERDICTS ARE SERVER-SIDE. The duplicate-call flag on a drill-down is
//      findRedundantCalls()'s output (the metrics layer's own detector),
//      asserted here against the seeded dataset's one genuine duplicate and
//      one clean retry sequence — both directions, because a detector that
//      flags everything passes every "it flags" test.
//   4. BROWSER ASSETS COMPILE under node:vm and hold the no-innerHTML /
//      relative-paths rules — a syntax error in app.js must fail `npm test`
//      (CLAUDE.md §6).
// All hermetic: fake pools, seeded stores, no sockets, no network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";

import {
  AuditReadStore,
  NoDurableStoreError,
  ALERT_WINDOW_MS,
  DECISION_ACTIONS,
  EXECUTION_ACTIONS,
  correlationOf,
  decisionReachesOutcome,
  classifyActor,
} from "../src/auditview/readStore.js";
import { buildDemoDataset } from "../src/auditview/demoSeed.js";
import { createAuditViewHandler, withBaseHref, formatCursor, parseCursor } from "../src/auditview/server.js";
import { traceVerdict } from "../src/auditview/traceVerdict.js";
import { refVerdict } from "../src/auditview/refVerdict.js";
import { portalAccessPosture, PORTAL_KEY_HEADER, PORTAL_KEY_ENV, OPEN_ACCESS } from "../src/portal/access.js";

// --- doubles (same shapes as test/deployRouter.test.js) ----------------------

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

/** A pg.Pool double answering from canned rows keyed by table name in the SQL. */
function fakePool(rowsByTable = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const table = Object.keys(rowsByTable).find((t) => sql.includes(t));
      return { rows: table ? rowsByTable[table] : [], rowCount: table ? rowsByTable[table].length : 0 };
    },
  };
}

const NOW = Date.parse("2026-08-18T12:00:00.000Z");

function seededStore() {
  return new AuditReadStore({ seeded: true, now: () => NOW });
}

function seededHandler(overrides = {}) {
  return createAuditViewHandler({ store: seededStore(), access: OPEN_ACCESS, ...overrides });
}

// --- 1. the store: seeded mode ------------------------------------------------

/** The feed now returns a PAGE; most assertions here only want the rows. */
async function rowsOf(store, filters) {
  return (await store.listDecisions(filters)).decisions;
}

test("seeded mode serves the demo dataset newest-first, and says which mode it is", async () => {
  const store = seededStore();
  assert.equal(store.mode(), "seeded");
  const decisions = await rowsOf(store);
  assert.ok(decisions.length >= 6);
  for (let i = 1; i < decisions.length; i++) {
    assert.ok(decisions[i - 1].at >= decisions[i].at, "must be newest first");
  }
  // The feed's summary shape: what a row renders from, nothing invented. The
  // wide columns (employmentId/source/flags/traceCount) and the two derived
  // ones (kind, correlation) are part of that contract now — the feed is what
  // tells a reader which row to click, so it has to carry enough to decide.
  const row = decisions[0];
  for (const key of [
    "id",
    "at",
    "useCase",
    "action",
    "actor",
    "riskTier",
    "externalRef",
    "reason",
    "employmentId",
    "source",
    "priorDecision",
    "flags",
    "correlationField",
    "correlationKey",
    "traceCount",
    "kind",
    "actorKind",
  ]) {
    assert.ok(key in row, `summary row must carry ${key}`);
  }
});

test("filters: use case and action are exact, q greps actor/ref/reason, since is strictly-newer", async () => {
  const store = seededStore();

  const uc01 = await rowsOf(store, { useCase: "UC-01" });
  assert.ok(uc01.length >= 3 && uc01.every((d) => d.useCase === "UC-01"));

  const escalations = await rowsOf(store, { action: "escalate" });
  assert.ok(escalations.every((d) => d.action === "escalate"));

  const byReason = await rowsOf(store, { q: "noMatchingCycle" });
  assert.equal(byReason.length, 1);
  assert.equal(byReason[0].useCase, "UC-06");

  const byActor = await rowsOf(store, { q: "TREMBLAY" }); // case-insensitive
  assert.ok(byActor.length >= 1 && byActor.every((d) => d.actor.includes("tremblay")));

  // The tailing cursor: rows strictly newer than the given timestamp only.
  const all = await rowsOf(store);
  const newer = await rowsOf(store, { since: all[1].at });
  assert.deepEqual(
    newer.map((d) => d.id),
    [all[0].id],
    "since must return only rows strictly newer than the cursor"
  );
});

// ---------------------------------------------------------------------------
// R7-33 (rca-e6zk) — `actor` is written from three different vocabularies
// with nothing distinguishing them: an email, the literal "unauthenticated",
// and (on paths with no logged-in session) the row's own employmentId reused
// as the actor. classifyActor() names which one a given row carries; these
// tests pin all four shapes plus the "no actor at all" case.
// ---------------------------------------------------------------------------

test("classifyActor: an email address", () => {
  assert.deepEqual(classifyActor("alex.morgan@example.com", null), {
    code: "email",
    label: "an email address",
  });
});

test("classifyActor: the literal string unauthenticated", () => {
  assert.equal(classifyActor("unauthenticated", null).code, "unauthenticated");
});

test("classifyActor: a UUID equal to this row's own employmentId is a self-reference, not a separate identity", () => {
  const id = "3537d9ee-2017-4a53-952e-9d3b042aeab5";
  const result = classifyActor(id, id);
  assert.equal(result.code, "employment_id_self");
});

test("classifyActor: a UUID that differs from this row's employmentId is still just an id", () => {
  const actorId = "3537d9ee-2017-4a53-952e-9d3b042aeab5";
  const otherEmploymentId = "09b65526-643b-4956-959b-916e6429bd23";
  assert.equal(classifyActor(actorId, otherEmploymentId).code, "uuid");
  // No employmentId to compare against at all — still just an id, never
  // mistaken for a self-reference by accident of a missing second argument.
  assert.equal(classifyActor(actorId, null).code, "uuid");
});

test("classifyActor: free text (a reviewer name, a role label, 'unknown') falls to name", () => {
  assert.equal(classifyActor("hr.ops", null).code, "name");
  assert.equal(classifyActor("unknown", null).code, "name");
});

test("classifyActor: no actor at all is null, not a fifth kind of value", () => {
  assert.equal(classifyActor(null, null), null);
  assert.equal(classifyActor(undefined, null), null);
  assert.equal(classifyActor("", null), null);
});

test("actorKind flows through the seeded store end to end — email and unauthenticated rows", async () => {
  const store = seededStore();
  const all = await rowsOf(store);
  const emailRow = all.find((d) => typeof d.actor === "string" && d.actor.includes("@"));
  assert.ok(emailRow, "the demo dataset must have at least one email-actor row to exercise this");
  assert.equal(emailRow.actorKind.code, "email");

  const unauthRow = all.find((d) => d.actor === "unauthenticated");
  assert.ok(unauthRow, "the demo dataset must have at least one unauthenticated row to exercise this");
  assert.equal(unauthRow.actorKind.code, "unauthenticated");
});

test("actorKind flows through the Postgres path — a portal row whose actor IS its own employmentId", async () => {
  const employmentId = "e818418e-1db7-431d-a663-9f477addb8bd";
  const pool = fakePool({
    audit_log: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        at: new Date("2026-08-20T00:00:00Z"),
        useCase: "UC-01",
        action: "auto_resolve",
        actor: employmentId,
        riskTier: "low",
        externalRef: null,
        reason: null,
        employmentId,
        source: null,
        priorDecision: null,
        flags: null,
        note: null,
        role: null,
        aiDecision: null,
        hasRemoteResult: false,
      },
    ],
  });
  const store = new AuditReadStore({ pgPool: pool });
  const [row] = await rowsOf(store);
  assert.equal(row.actorKind.code, "employment_id_self");
});

test("getDecision returns the full record plus its trace, oldest attempt first", async () => {
  const store = seededStore();
  const [feedTop] = await rowsOf(store, { useCase: "UC-01", q: "6" });
  const found = await store.getDecision(feedTop.id);
  assert.ok(found);
  assert.equal(found.decision.details.classification.source, "llm");
  assert.ok(found.trace.length >= 3);
  for (let i = 1; i < found.trace.length; i++) {
    assert.ok(found.trace[i - 1].at <= found.trace[i].at, "trace must be in the order it happened");
  }
  assert.equal(await store.getDecision("no-such-id"), null);
});

test("lookupRef: ticket #5 shows one claim, TWO decision rows, and the nearby alert", async () => {
  const store = seededStore();
  const result = await store.lookupRef("5");

  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].useCase, "UC-01");

  // The pre-claim-ledger double delivery: two audit rows under one ref.
  assert.equal(result.decisions.length, 2);
  assert.ok(result.decisions.every((d) => d.useCase === "UC-01"));

  // The UC-01 alert sits 2 minutes from the duplicate rows — inside ±15 min.
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].auditDurable, true);
  assert.ok(result.alertWindow, "activity must produce a search window");
});

test("lookupRef on an unknown ref answers empty, with no window and no alerts", async () => {
  const result = await seededStore().lookupRef("never-seen");
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.alerts, []);
  assert.equal(result.alertWindow, null);
});

test("the alert window is ±15 minutes around the ref's own activity", () => {
  assert.equal(ALERT_WINDOW_MS, 15 * 60 * 1000);
});

// --- 1a-bis. WHAT THE REFERENCE ACTUALLY TRACES ------------------------------
//
// The reference is the only id a requester is ever handed, so "can I trace
// this?" is answered by this lookup or by nothing. These pin the four answers
// apart, and the second one is the one that matters: a request that WAS
// processed, whose reference the exactly-once ledger holds, and whose decision
// row does not carry the reference. That state is real and live — on
// 2026-08-19 thirteen portal submissions sat in it, every one with a claim row
// naming its verdict and not one `audit_log` row findable by the reference.
// Rendered as an empty table it reads as a lost request; it is not one.

test("VERDICT: claimed but not audited — the request WAS processed, and says so", () => {
  const verdict = refVerdict({
    externalRef: "uc02-20260819104528-11aomw",
    claims: [{ useCase: "UC-02", externalRef: "uc02-20260819104528-11aomw", decision: "human_review" }],
    decisions: [],
    alerts: [],
  });
  assert.equal(verdict.code, "claimed_not_audited");
  assert.equal(verdict.tone, "warn");
  // The verdict it reached is IN the claim row — the reader must be given it,
  // not left to infer that nothing happened from an empty decisions panel.
  assert.match(verdict.detail, /UC-02 → human_review/);
  // And the blame must land on the writer, not on the person who typed the ref.
  assert.match(verdict.detail, /gap in the WRITER/);
  assert.match(verdict.headline, /WAS processed/);
  // It must never read as "not found" — that is the whole defect.
  assert.doesNotMatch(verdict.headline + verdict.detail, /never (?:submitted|used|processed)/i);
  // …and it must say what to do instead, or it is a diagnosis with no exit.
  assert.ok(
    verdict.notes.some((n) => /record id/i.test(n)),
    "must name the identifier that DOES group the rows"
  );
});

test("VERDICT: nothing anywhere carries the reference — and that is a different answer", () => {
  const verdict = refVerdict({ externalRef: "typo-9", claims: [], decisions: [], alerts: [] });
  assert.equal(verdict.code, "not_found");
  assert.match(verdict.detail, /typo-9/);
  // Matched exactly, not by prefix — a reader who pasted half a reference
  // needs to know that before concluding their request vanished.
  assert.match(verdict.detail, /exactly/i);
});

test("VERDICT: audited but never claimed is ordinary, and names both ordinary causes", () => {
  const verdict = refVerdict({
    externalRef: "ticket-2006",
    claims: [],
    decisions: [{ useCase: "UC-02", action: "duplicate_request_ignored" }],
    alerts: [],
  });
  assert.equal(verdict.code, "audited_not_claimed");
  assert.match(verdict.detail, /duplicate gate/);
  assert.match(verdict.detail, /predates/);
});

test("VERDICT: a complete trace says so, and counts what it holds", () => {
  const verdict = refVerdict({
    externalRef: "5",
    claims: [{ useCase: "UC-01", decision: "auto_resolve" }],
    decisions: [{ useCase: "UC-01", action: "auto_resolve" }, { useCase: "UC-01", action: "auto_resolve" }],
    alerts: [{ useCase: "UC-01" }],
  });
  assert.equal(verdict.code, "traced");
  assert.match(verdict.detail, /1 claim row and 2 decision rows/);
  assert.match(verdict.detail, /1 ops alert/);
});

// rca-8mmd / R7-30: "Fully traceable" fired whenever a claim row and a
// decision row both existed under the reference, whatever that decision
// WAS. A third-party door reference whose only decision was `human_review`
// — the request still sitting in review, its eventual approval recorded
// under the Zendesk ticket id issued at the hand-off, a different reference
// entirely — got the same "Fully traceable" headline as a fully resolved
// one. These pin the fix: the verdict must be computed against whether the
// most recent decision under THIS reference settled the request.

test("VERDICT: a hand-off decision is traced but not stamped Fully traceable", () => {
  const verdict = refVerdict({
    externalRef: "530b3977-48bd-40f6-abc0-8dbc2ad7c43d",
    claims: [{ useCase: "UC-01", externalRef: "530b3977-48bd-40f6-abc0-8dbc2ad7c43d", decision: "human_review" }],
    decisions: [
      { useCase: "UC-01", action: "human_review" },
      { useCase: "UC-01", action: "third_party_handoff_ticket_created" },
    ],
    alerts: [],
  });
  assert.equal(verdict.code, "traced_pending");
  assert.equal(verdict.tone, "warn");
  assert.doesNotMatch(verdict.headline, /Fully traceable/);
  assert.match(verdict.headline, /human_review/);
  assert.match(verdict.headline, /not the request's answer/);
  assert.match(verdict.detail, /DIFFERENT reference/);
});

test("VERDICT: the SETTLING decision wins when a reference outlives an earlier hand-off", () => {
  // A request that escalated and was later approved under the SAME
  // reference genuinely did reach its outcome — the most recent decision
  // row is what must be judged, not the first one.
  const verdict = refVerdict({
    externalRef: "9010",
    claims: [{ useCase: "UC-04", externalRef: "9010", decision: "escalate" }],
    decisions: [
      { useCase: "UC-04", action: "escalate" },
      { useCase: "UC-04", action: "workation_approved" },
    ],
    alerts: [],
  });
  assert.equal(verdict.code, "traced");
  assert.match(verdict.headline, /Fully traceable/);
});

test("decisionReachesOutcome: terminal, hand-off, and not-a-decision are three different answers", () => {
  // Terminal — nothing further is expected.
  for (const action of ["auto_resolve", "auto_approve", "blocked", "out_of_scope", "duplicate_request_ignored", "human_approved"]) {
    assert.equal(decisionReachesOutcome(action), true, `${action} should settle the request`);
  }
  // Hand-offs — DECISION_ACTIONS recognises them, but they await a further
  // step: an escalation, a slot in a multi-signature approval, or a defer.
  for (const action of ["human_review", "escalate", "route_to_uc04", "ready_for_approval", "amendment_approved", "expense_review_hold"]) {
    assert.equal(decisionReachesOutcome(action), false, `${action} should be a hand-off, not settled`);
  }
  // Not a decision at all — the question does not apply.
  assert.equal(decisionReachesOutcome("expense_approved_write"), null);
  assert.equal(decisionReachesOutcome("third_party_handoff_ticket_created"), null);
});

test("VERDICT: one reference under two use cases is a HAND-OFF, not a repeat", () => {
  // workflow_claims is keyed (use_case, external_ref) precisely so UC-03 can
  // route on to UC-04 under one reference. A reader seeing two claim rows must
  // not read that as the duplicate delivery the ledger exists to prevent —
  // that is two rows under ONE pair, which the duplicate banner reports.
  const verdict = refVerdict({
    externalRef: "9001",
    claims: [
      { useCase: "UC-03", decision: "route_to_uc04" },
      { useCase: "UC-04", decision: "escalate" },
    ],
    decisions: [{ useCase: "UC-03", action: "route_to_uc04" }],
    alerts: [],
  });
  assert.deepEqual(verdict.useCases, ["UC-03", "UC-04"]);
  const note = verdict.notes.join(" ");
  assert.match(note, /hand-off/i);
  assert.match(note, /UC-03 routing on to UC-04/);
});

test("VERDICT: a single-use-case lookup carries no hand-off note to explain away", () => {
  const verdict = refVerdict({
    externalRef: "5",
    claims: [{ useCase: "UC-01", decision: "auto_resolve" }],
    decisions: [{ useCase: "UC-01", action: "auto_resolve" }],
    alerts: [],
  });
  assert.deepEqual(verdict.notes, []);
});

test("GET /api/refs/:ref carries the verdict — the page is never left to derive it", async () => {
  const { json } = await call(seededHandler(), fakeReq("GET", "/api/refs/never-seen"), fakeRes());
  assert.ok(json.refVerdict, "the ref lookup must answer WHAT this reference can trace");
  assert.equal(json.refVerdict.code, "not_found");

  const found = await call(seededHandler(), fakeReq("GET", "/api/refs/5"), fakeRes());
  assert.equal(found.json.refVerdict.code, "traced");
});

// --- 1b. pagination: keyset on (at, id), and the TIEBREAK is the point --------

test("paging walks the whole feed once — no row skipped, no row repeated", async () => {
  const store = seededStore();
  const everything = await rowsOf(store, { limit: 200 });

  const walked = [];
  let cursor = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await store.listDecisions({ limit: 2, before: cursor });
    walked.push(...page.decisions.map((d) => d.id));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }

  assert.deepEqual(walked, everything.map((d) => d.id), "paging must reproduce the single-page order exactly");
  assert.equal(new Set(walked).size, walked.length, "no id may appear on two pages");
});

test("CRITICAL: rows sharing one millisecond survive a page edge between them", async () => {
  // The seeded portal submission writes its decision and its pre-write intent
  // with an IDENTICAL `at`. A cursor of `at` alone drops or repeats them here
  // depending on whether it compares with < or <=; the (at, id) composite is
  // what makes the boundary land between two specific rows instead of inside a
  // timestamp.
  const store = seededStore();
  // Grouped by RECORD, not merely by "has a storeId": the seed carries a second
  // UC-02 record (the human-review trio) on its own storeId, and lumping the two
  // together would test a group that never existed.
  const byRecord = new Map();
  for (const row of (await rowsOf(store, { limit: 200 })).filter(
    (d) => d.useCase === "UC-02" && d.correlationField === "storeId" && d.correlationKey
  )) {
    byRecord.set(row.correlationKey, [...(byRecord.get(row.correlationKey) ?? []), row]);
  }
  const group = [...byRecord.values()].find((rows) => rows.length === 4);
  assert.ok(group, "the demo dataset must carry the twice-submitted expense, all four rows on one storeId");
  const byAt = new Map();
  for (const d of group) byAt.set(d.at, [...(byAt.get(d.at) ?? []), d]);
  const sameMs = [...byAt.values()].sort((a, b) => b.length - a.length)[0];
  assert.ok(sameMs.length >= 2, "at least two rows must share one timestamp for this test to test anything");

  // Page size 1, walked from the row before the trio: every page edge falls
  // inside the shared millisecond.
  const walked = [];
  let cursor = null;
  for (let guard = 0; guard < 60; guard++) {
    const page = await store.listDecisions({ limit: 1, before: cursor });
    walked.push(...page.decisions.map((d) => d.id));
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  const trio = walked.filter((id) => sameMs.some((d) => d.id === id));
  assert.deepEqual(trio, sameMs.map((d) => d.id), "every row of that millisecond, once each, in order");
});

test("hasMore is a fact from the store, not a guess from a full page", async () => {
  const store = seededStore();
  const total = (await rowsOf(store, { limit: 200 })).length;

  const exactlyFull = await store.listDecisions({ limit: total });
  assert.equal(exactlyFull.decisions.length, total);
  assert.equal(exactlyFull.hasMore, false, "a page that happens to be full is not a page with more after it");
  assert.equal(exactlyFull.nextCursor, null);

  const partial = await store.listDecisions({ limit: total - 1 });
  assert.equal(partial.hasMore, true);
  assert.ok(partial.nextCursor.at && partial.nextCursor.id);
});

test("the live tail tiebreaks too — a row sharing the newest millisecond is delivered exactly once", async () => {
  const store = seededStore();
  const all = await rowsOf(store, { limit: 200 });
  const trio = all.filter((d) => d.correlationField === "storeId");
  // Tail from the NEWEST of the three: the two older ones share its timestamp
  // and must NOT come back, and nothing newer may be missed.
  const newestOfTrio = trio[0];
  const tail = await rowsOf(store, { since: newestOfTrio.at, sinceId: newestOfTrio.id });
  assert.ok(!tail.some((d) => trio.some((t) => t.id === d.id)), "no same-millisecond row is re-delivered");
  const expected = all.slice(0, all.indexOf(newestOfTrio));
  assert.deepEqual(tail.map((d) => d.id), expected.map((d) => d.id));
});

test("the page cursor is one readable string, and a malformed one is refused rather than ignored", async () => {
  assert.equal(formatCursor({ at: "2026-08-18T21:15:15.205Z", id: "11111111-1111-4111-8111-111111111121" }),
    "2026-08-18T21:15:15.205Z~11111111-1111-4111-8111-111111111121");
  assert.deepEqual(parseCursor("2026-08-18T21:15:15.205Z~11111111-1111-4111-8111-111111111121"), {
    at: "2026-08-18T21:15:15.205Z",
    id: "11111111-1111-4111-8111-111111111121",
  });
  assert.equal(parseCursor(null), null);
  assert.equal(parseCursor(""), null);
  assert.throws(() => parseCursor("just-a-timestamp"), /not a page cursor/);
  assert.throws(() => parseCursor("nonsense~11111111-1111-4111-8111-111111111121"), /unparseable timestamp/);

  // Over HTTP: a 400 that names the problem. Silently serving page 1 again
  // would be indistinguishable from paging having stopped working.
  const { res, json } = await call(seededHandler(), fakeReq("GET", "/api/decisions?before=garbage"));
  assert.equal(res.statusCode, 400);
  assert.equal(json.code, "bad_cursor");
});

test("GET /api/decisions reports the page it served, with an already-encoded next cursor", async () => {
  const handler = seededHandler();
  const first = await call(handler, fakeReq("GET", "/api/decisions?limit=2"));
  assert.equal(first.json.decisions.length, 2);
  assert.equal(first.json.page.size, 2);
  assert.equal(first.json.page.returned, 2);
  assert.equal(first.json.page.hasMore, true);
  assert.match(first.json.page.nextCursor, /~[0-9a-f-]{36}$/);

  const second = await call(
    handler,
    fakeReq("GET", `/api/decisions?limit=2&before=${encodeURIComponent(first.json.page.nextCursor)}`)
  );
  const overlap = second.json.decisions.filter((d) => first.json.decisions.some((f) => f.id === d.id));
  assert.deepEqual(overlap, [], "page 2 must not repeat page 1");
});

// --- 1c. decision vs. follow-up event, and the correlation that groups them ---

test("the feed labels each row's KIND — decision, execution, or follow-up event", async () => {
  const rows = await rowsOf(seededStore(), { useCase: "UC-02", limit: 200 });
  const byAction = Object.fromEntries(rows.map((r) => [r.action, r.kind]));
  assert.equal(byAction.auto_approve, "decision");
  assert.equal(byAction.human_review, "decision");
  // Written durably BEFORE the PATCH fires, so it records an intent and not a
  // result — the row exists whether or not the write ever landed.
  assert.equal(byAction.expense_auto_approved, "event");
  // Written AFTER remote.patchExpenseStatus() returned, carrying its response.
  // This is the row proving the reimbursement was really approved, and calling
  // it a generic follow-up buried it.
  assert.equal(byAction.expense_approved_write, "execution");
  // The safe direction, unchanged: an action neither vocabulary knows reads as
  // an event, which under-claims. Over-claiming would tell a reader money moved
  // when it did not.
  assert.ok(!DECISION_ACTIONS.has("expense_approved_write"));
  assert.ok(!EXECUTION_ACTIONS.has("expense_auto_approved"));
});

// THE ROW THAT IS A SECOND SUBMISSION, NOT A FOLLOW-UP OF THE FIRST.
// Live, 2026-08-18/19: one expense submitted twice, four rows under one
// storeId, and the fourth (`duplicate_request_ignored`) landed two hours after
// the third. src/uc02/workflow.js writes it and RETURNS — so it is the whole of
// that second request, and nothing else records it anywhere. Classified as an
// event it would claim to follow a decision made two hours and one submission
// earlier, which is false in both halves.
test("a replay row carries the decision it replayed, so the feed shows an outcome", async () => {
  // WHY. `duplicate_request_ignored` is written INSTEAD of a decision row, so
  // on its own it names a refusal and no verdict. A tester submitted the same
  // expense repeatedly and reported that the live feed showed nothing but
  // "duplicate_request_ignored" — true, and unreadable: the thing every one of
  // those rows handed back was invisible.
  const store = seededStore();
  const rows = await rowsOf(store);
  const replay = rows.find((r) => r.action === "duplicate_request_ignored");
  assert.ok(replay, "the seed must contain a replay row for this to mean anything");
  assert.ok(replay.priorDecision, "a replay must name the decision it returned");

  // And the browser prints it rather than deriving it — same rule the whole
  // viewer follows.
  const app = readFileSync(new URL("../src/auditview/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /decision\.priorDecision/);
  assert.match(app, /replayed:/);
});

test("duplicate_request_ignored is a DECISION — it is the whole of a second submission", async () => {
  assert.ok(
    DECISION_ACTIONS.has("duplicate_request_ignored"),
    "a second submission's only row must not read as a follow-up of the first submission's decision"
  );
  assert.ok(!EXECUTION_ACTIONS.has("duplicate_request_ignored"), "nothing was written — it is a refusal to act again");

  // Checked against the writer, not restated: the audit row must be the last
  // thing that branch does before returning, i.e. no other action follows it.
  const { readFileSync } = await import("node:fs");
  const uc02 = readFileSync(new URL("../src/uc02/workflow.js", import.meta.url), "utf8");
  const idx = uc02.indexOf('action: "duplicate_request_ignored"');
  assert.ok(idx > 0, "src/uc02/workflow.js no longer writes this row — re-derive the vocabulary");
  const after = uc02.slice(idx, idx + 1200);
  assert.ok(/\n    return \{/.test(after), "the gate must return immediately — if it fell through, this row is not the whole request");
  assert.ok(!/action: "/.test(after.slice(40)), "no second audit row may follow it in that branch");
});

// The claim-ledger duplicate is the OTHER kind, and it writes nothing here.
// Worth pinning: someone looking for "where are the other duplicate rows"
// should find the answer in a test rather than concluding they are missing.
test("a delivery-level duplicate writes NO audit_log row at all — only workflow_claims", async () => {
  const { readFileSync } = await import("node:fs");
  const claims = readFileSync(new URL("../src/shared/workflowClaims.js", import.meta.url), "utf8");
  assert.ok(!/action:\s*"/.test(claims), "claimExternalRef must not write an audit_log row");

  for (const uc of ["uc01", "uc02", "uc03", "uc04", "uc05", "uc06", "uc07", "uc08", "uc09"]) {
    const src = readFileSync(new URL(`../src/${uc}/workflow.js`, import.meta.url), "utf8");
    const idx = src.indexOf("if (!claim.claimed)");
    if (idx < 0) continue;
    const branch = src.slice(idx, src.indexOf("}", src.indexOf("return", idx)));
    assert.ok(!/audit\.log|logDurable/.test(branch), `${uc}'s duplicate-delivery branch writes an audit row — the viewer's vocabulary must learn about it`);
  }
});

// The vocabulary is a claim ABOUT THE WRITERS, so it is checked against them
// rather than against itself. Every entry must be an action some workflow
// really appends after a remote.* call resolves; the two-part assertion below
// is what a wrong entry fails on — it would name an outward act that no code
// performs, which is exactly the error direction the comment forbids.
test("every EXECUTION action is one a workflow really writes after a Remote call returns", async () => {
  const { readFileSync } = await import("node:fs");
  const sources = ["uc02", "uc04", "uc06", "uc09"].map((uc) =>
    readFileSync(new URL(`../src/${uc}/workflow.js`, import.meta.url), "utf8")
  );
  const all = sources.join("\n");

  // TWO OF THE SIX ARE NEVER SPELLED OUT IN THE SOURCE. UC-02's human review
  // path writes `action: \`expense_${status}_write\``, so grepping for the
  // literal string finds nothing and the naive check would call a real
  // execution fictional. The names are derived from the same function the
  // writer uses, which is also what makes this test follow the `release` ->
  // `approve` rename landing on another branch: if statusForAction() starts
  // producing a different status, the derived name changes with it and the
  // assertion below names the string the vocabulary is missing.
  // UC-02'S TWO REVIEW-WRITE NAMES ARE NOT LITERALS AT THE CALL SITE, so
  // grepping the source finds nothing and a naive check would call two real
  // executions fictional. They are read from the map the writer itself uses.
  //
  // This derivation used to read `statusForAction()` and rebuild
  // `expense_${status}_write`, which is what the writer did at the time. The
  // release -> approve rename ended that: the template would have emitted
  // `expense_approved_write`, ALREADY TAKEN by the auto-approve path, leaving
  // the log unable to say whether a claim was approved by the automation or by
  // a person — the exact pairing the Finance Ops accept rate is computed from.
  // So the writer moved to an explicit frozen map, and this follows it there.
  // The test failing on that rename is this check working: it named what had
  // changed instead of silently returning two executions to "Follow-up event".
  const templateBuilt = new Map();
  try {
    const { REVIEW_WRITE_ACTIONS } = await import("../src/uc02/workflow.js");
    assert.ok(REVIEW_WRITE_ACTIONS, "no map exported");
    // `hold` is absent from the map by construction, not by exclusion here:
    // that branch returns before any Remote call, so no held-write row exists.
    for (const [status, action] of Object.entries(REVIEW_WRITE_ACTIONS)) {
      templateBuilt.set(action, status);
    }
  } catch (err) {
    assert.fail(
      "src/uc02/workflow.js no longer exports REVIEW_WRITE_ACTIONS — re-derive the audit viewer's " +
        `EXECUTION vocabulary from whatever names submitExpenseReview() now writes (${err.message})`
    );
  }
  const writeSite = all.indexOf("REVIEW_WRITE_ACTIONS[status]");
  assert.ok(writeSite > 0, "src/uc02/workflow.js no longer names its review-write action from that map");
  assert.ok(
    /remoteResult/.test(all.slice(writeSite - 300, writeSite + 600)),
    "UC-02's review write no longer records the Remote response — is it still an execution?"
  );

  /* NAMES NO WRITER PRODUCES ANY MORE, AND MUST STAY ANYWAY.
     `audit_log` is append-only, so a renamed action's old rows never stop being
     real — `expense_released_write` sits in the live table under the spelling
     the system used on 2026-08-19, and dropping it from the vocabulary would
     send those rows back to reading "Follow-up event" while looking like a
     tidy-up. They are listed here explicitly rather than the loop being
     loosened: an action that is neither written today NOR a known legacy name
     is still a mistake, and this check still catches it. */
  const RETIRED_BUT_RENDERED = new Set(["expense_released_write", "expense_declined_write"]);

  for (const action of EXECUTION_ACTIONS) {
    if (templateBuilt.has(action)) continue; // verified at the write site above
    if (RETIRED_BUT_RENDERED.has(action)) continue;
    assert.ok(all.includes(`action: "${action}"`), `no workflow writes an audit row with action "${action}"`);
    // The response of the call it followed is on the row. That is the property
    // that separates an execution from an approval slot recorded beforehand.
    const idx = all.indexOf(`action: "${action}"`);
    const window = all.slice(idx, idx + 600);
    assert.ok(/remoteResult/.test(window), `"${action}" does not record the Remote response — is it really an execution?`);
  }

  // …and every name that template really produces is IN the vocabulary. This is
  // the half that fails loudly the day the rename lands, rather than letting a
  // human's authorised payment quietly go back to reading "Follow-up event".
  for (const [action, verb] of templateBuilt) {
    assert.ok(
      EXECUTION_ACTIONS.has(action),
      `submitExpenseReview("${verb}") writes "${action}" after remote.patchExpenseStatus() returns — ` +
        "add it to EXECUTION_ACTIONS in src/auditview/readStore.js"
    );
  }

  // The two sets must not overlap: a word cannot be both the decision and what
  // followed it, and withKind() resolving an ambiguity silently would hide it.
  for (const action of EXECUTION_ACTIONS) {
    assert.ok(!DECISION_ACTIONS.has(action), `"${action}" is in both vocabularies`);
  }
});

// The nearest misses, each a row that looks like an execution and is not.
// Pinned because the tempting shortcut — classify on the `_write`/`_executed`
// suffix — gets most of them wrong.
test("rows that only LOOK like executions stay executions-free", () => {
  for (const action of [
    "expense_auto_approved", // written BEFORE the PATCH: an intent
    "amendment_approved", // one of two approval slots; the write may never happen
    "amendment_execution_blocked", // carries "execution" and means the opposite
    "adjustment_execution_not_claimed", // ditto — another caller won the CAS
    "resignation_signed_off", // UC-05 has no Remote write endpoint at all
    "human_approved", // audited before the Zendesk action, not after
    "expense_review_release", // logged durably BEFORE the freshness re-read
    "expense_review_hold", // no Remote status exists for a hold at all
  ]) {
    assert.ok(!EXECUTION_ACTIONS.has(action), `"${action}" must not be classified as an execution`);
  }
});

// …and the correction to the line that used to sit inside that test.
//
// Four of the actions above are NOT executions and ARE decisions, and asserting
// they were neither is what left a specialist authorising a reimbursement
// rendering as "Follow-up event". They pass DECISION_ACTIONS' own test — a
// verdict on a request, written INSTEAD of a second automated decision row —
// which is the same test `duplicate_request_ignored` was admitted on. Being a
// verdict and being an outward act are different claims; the list above makes
// only the second, and this one makes only the first.
test("a human's verdict is a DECISION, even when it is not an execution", () => {
  for (const action of [
    "amendment_approved", // one role's signature on a payroll change
    "resignation_signed_off", // HR Ops' sign-off; no Remote write exists to make
    "human_approved", // the ZAF sidebar's own verdict
    "expense_review_release", // a person authorising money — the defect's origin
    "expense_review_hold", // a deferral is still a person's answer
  ]) {
    assert.ok(
      DECISION_ACTIONS.has(action),
      `"${action}" is a person's verdict and the only row recording it — it cannot read as a follow-up event`
    );
    assert.ok(!EXECUTION_ACTIONS.has(action), `"${action}" is a verdict, not an outward act`);
  }
});

// --- 1b. the human's decision, and what the reason means ----------------------
//
// THE DEFECT THESE PIN. Live, 2026-08-19, a Finance Ops specialist released a
// real reimbursement and both rows rendered as "Follow-up event":
//
//   04:50:48.103  UC-02  expense_review_release
//   04:50:48.453  UC-02  expense_released_write
//
// The tests below are deliberately POSITIVE — "this MUST classify as a
// decision", "this MUST render plain words" — because the failure mode here is
// silence: a vocabulary that has simply never heard of an action behaves
// identically to one correctly declining to classify it, and no amount of
// negative assertion tells the two apart (CLAUDE.md §5's most expensive lesson,
// applied to a viewer rather than a gate).

test("a human's verdict row classifies as a decision and says WHO and WHAT", async () => {
  const rows = await rowsOf(seededStore(), { limit: 200 });
  const release = rows.find((r) => r.action === "expense_review_release");
  assert.ok(release, "the seed must carry a specialist's release for this to test anything");

  assert.equal(release.kind, "decision", "a person authorising money must not read as a follow-up event");
  assert.ok(release.humanVerdict, "the row must carry the server's verdict, so the page derives none");
  assert.equal(release.humanVerdict.word, "released for payment");
  assert.equal(release.humanVerdict.shape, "settles");

  // WHO, and WHAT THEY SAID. A verdict with no attributable person and no note
  // is a row saying only that something happened.
  assert.ok(release.actor && release.actor.includes("@"), "the deciding human must be named");
  assert.match(release.note, /pre-approved/, "the specialist's note travels with the verdict");
  assert.equal(release.aiDecision, "human_review", "the AI's recommendation sits beside the human's verdict");

  // And the write it authorised is an execution, not a follow-up.
  const write = rows.find((r) => r.action === "expense_released_write");
  assert.ok(write, "the seed must carry the write that followed");
  assert.equal(write.kind, "execution");
  assert.equal(write.hasRemoteResult, true, "an execution carries Remote's own response — that is what makes it one");
});

test("every use case's human verdicts are classified — the sweep, not just UC-02", async () => {
  // Read off the writers rather than restated: every `action:` string an
  // approval handler appends must be a decision, an execution, or deliberately
  // neither (a refusal, a slot recorded before a write, a blocked execution).
  // The one this list must never miss is a person's verdict.
  const perUseCase = {
    "UC-02": ["expense_review_release", "expense_review_decline", "expense_review_hold"],
    "UC-04": ["workation_approved", "workation_declined", "workation_denied"],
    "UC-05": ["resignation_signed_off", "resignation_declined", "resignation_denied"],
    "UC-06": ["amendment_approved", "amendment_declined", "amendment_denied"],
    "UC-09": ["adjustment_approved", "adjustment_denied"],
    "ZAF sidebar": ["human_approved", "human_declined", "human_denied"],
  };
  const { humanVerdictOf } = await import("../src/auditview/humanDecision.js");
  for (const [where, actions] of Object.entries(perUseCase)) {
    for (const action of actions) {
      assert.ok(DECISION_ACTIONS.has(action), `${where}: "${action}" is a person's verdict and must be a decision`);
      assert.ok(humanVerdictOf(action), `${where}: "${action}" must carry a plain word for what was decided`);
    }
  }

  // The safety direction holds: a refusal is NOT a verdict. Nobody's decision
  // was recorded on these rows — the system declined to accept an attempt.
  for (const action of [
    "expense_review_release_refused",
    "workation_approve_refused",
    "human_approve_refused",
    "amendment_execution_blocked",
    "resignation_signoff_blocked",
    "amendment_employee_consented",
  ]) {
    assert.ok(!DECISION_ACTIONS.has(action), `"${action}" records no verdict — it must stay an event`);
    assert.ok(!humanVerdictOf(action));
  }
});

test("BOTH spellings of UC-02's review verb classify — the rename must not un-classify live history", async () => {
  const { humanVerdictOf } = await import("../src/auditview/humanDecision.js");
  // `release` is what the rows already in audit_log say, forever; `approve` is
  // what the rename produces. An append-only log means the old spelling never
  // stops being real, so dropping it would un-classify history the day the
  // rename shipped.
  for (const action of ["expense_review_release", "expense_review_approve"]) {
    assert.equal(DECISION_ACTIONS.has(action), true, `"${action}" must classify as a decision`);
    assert.ok(humanVerdictOf(action).word.includes("payment"), "both spell out that money was authorised");
  }
});

test("BOTH spellings of the negative verb classify — history is not rewritten", async () => {
  const { humanVerdictOf } = await import("../src/auditview/humanDecision.js");
  // 2026-08-19: `deny` -> `decline` across UC-01's review, UC-04, UC-05, UC-06.
  // `audit_log` is APPEND-ONLY and was not migrated, so both names describe
  // real rows a specialist can search, forever. Dropping the old one would turn
  // a recorded human verdict into an unrecognised event the day of the rename.
  const pairs = [
    ["human_denied", "human_declined"],
    ["workation_denied", "workation_declined"],
    ["resignation_denied", "resignation_declined"],
    ["amendment_denied", "amendment_declined"],
  ];
  for (const [old, current] of pairs) {
    for (const action of [old, current]) {
      assert.equal(DECISION_ACTIONS.has(action), true, `"${action}" must classify as a decision`);
      assert.ok(humanVerdictOf(action), `"${action}" must carry a plain word`);
    }
  }
  // The two spellings are not collapsed into one word, either: an old row still
  // reads back as what the system called it at the time.
  assert.equal(humanVerdictOf("human_denied").word, "denied");
  assert.equal(humanVerdictOf("human_declined").word, "declined");

  // UC-09 has NO `*_declined` twin, and that is the honest state: its files
  // were owned by another change when the verb moved. A twin here would claim
  // a rename that has not happened.
  assert.ok(humanVerdictOf("adjustment_denied"));
  assert.equal(humanVerdictOf("adjustment_declined"), null);
});

test("the drill-down answers whether the approved write actually reached Remote", async () => {
  const store = seededStore();
  const handler = createAuditViewHandler({ store, access: OPEN_ACCESS });

  const release = (await rowsOf(store, { limit: 200 })).find((r) => r.action === "expense_review_release");
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${release.id}`));
  assert.equal(json.writeOutcome.code, "remote_confirmed", "its sibling write carries remoteResult");
  assert.match(json.writeOutcome.detail, /remoteResult|Remote's own response/);

  // …and the case that must NOT be painted as a failure: UC-05 has no Remote
  // write endpoint at all, so a sign-off correctly produces no execution row.
  const signoff = (await rowsOf(store, { limit: 200 })).find((r) => r.action === "resignation_signed_off");
  const second = await call(handler, fakeReq("GET", `/api/decisions/${signoff.id}`));
  assert.equal(second.json.writeOutcome.code, "no_write_recorded");
  assert.match(second.json.writeOutcome.detail, /UC-05 has none/, "both readings are named; neither is chosen");
  // rca-8qzr / R7-46: a person's own verdict is never an n8n execution, so it
  // can never produce an ops_alerts row ("RCX OPS · Error Alerts" only writes
  // one on a FAILED n8n run). The tiebreak must not be offered here — it
  // would be advice this reader can never act on.
  assert.doesNotMatch(second.json.writeOutcome.detail, /ops alert/i, "a human verdict can never be explained by an n8n failure");

  // An automated row is not a human verdict, but it IS a decision, and this
  // check now runs on it too (R7-32 / rca-ltja: it used to run only on human
  // verdicts, so a fully automated `auto_resolve` row carrying
  // `letterIssued: true` and three attempts — none of which is an outward
  // write — showed no warning at all). This seeded row has no siblings, so
  // nothing on the trail carries Remote's response.
  const auto = (await rowsOf(store, { limit: 200 })).find((r) => r.action === "auto_resolve");
  const third = await call(handler, fakeReq("GET", `/api/decisions/${auto.id}`));
  assert.equal(third.json.writeOutcome.code, "no_write_recorded");
  // An automated decision COULD have run through the n8n graph, so the
  // tiebreak stays offered here — this is the control that proves the guard
  // above is scoping the suggestion rather than deleting it outright.
  assert.match(third.json.writeOutcome.detail, /ops alert/i, "the tiebreak still applies to a row an n8n execution could explain");
});

test("writeOutcome reports what the trail holds — it never predicts what should have happened", async () => {
  const { writeOutcome } = await import("../src/auditview/humanDecision.js");
  const decision = { action: "amendment_approved", at: "2026-08-19T10:00:00.000Z" };

  // A write with Remote's answer on it.
  assert.equal(
    writeOutcome({
      decision,
      siblings: [{ at: "2026-08-19T10:00:01.000Z", action: "amendment_executed", kind: "execution", hasRemoteResult: true }],
    }).code,
    "remote_confirmed"
  );
  // A write WITHOUT it — unconfirmed, and said so rather than counted as done.
  assert.equal(
    writeOutcome({
      decision,
      siblings: [{ at: "2026-08-19T10:00:01.000Z", action: "amendment_executed", kind: "execution", hasRemoteResult: false }],
    }).code,
    "execution_without_response"
  );
  // Stopped after the verdict: the decision stands, nothing left the system.
  assert.equal(
    writeOutcome({
      decision,
      siblings: [{ at: "2026-08-19T10:00:01.000Z", action: "amendment_execution_blocked", kind: "event" }],
    }).code,
    "execution_stopped"
  );
  // An execution recorded BEFORE this verdict belongs to something else.
  assert.equal(
    writeOutcome({
      decision,
      siblings: [{ at: "2026-08-19T09:00:00.000Z", action: "amendment_executed", kind: "execution", hasRemoteResult: true }],
    }).code,
    "no_write_recorded"
  );
});

test("a reason renders in the words its own policy engine holds — seven use cases, one registry", async () => {
  const { gateMeaning, USE_CASES_WITH_LADDERS } = await import("../src/auditview/gateMeanings.js");
  assert.deepEqual(
    [...USE_CASES_WITH_LADDERS].sort(),
    ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-09"]
  );

  // One real slug per ladder, each checked against the engine's OWN sentence
  // rather than against a copy pasted here — a copy is how the two would drift.
  const cases = [
    ["UC-01", "all_gates_passed", await import("../src/uc01/policyEngine.js")],
    ["UC-02", "over_policy_cap", await import("../src/uc02/policyEngine.js")],
    ["UC-03", "duration_over_cap", await import("../src/uc03/policyEngine.js")],
    ["UC-04", "sanctioned_region", await import("../src/uc04/policyEngine.js")],
    ["UC-05", "no_matching_notice_bracket", await import("../src/uc05/policyEngine.js")],
    ["UC-06", "country_schema_unavailable", await import("../src/uc06/policyEngine.js")],
    ["UC-09", "high_risk_adjustment_needs_triple_approval", await import("../src/uc09/policyEngine.js")],
  ];
  for (const [useCase, reason, engine] of cases) {
    const expected = engine.describeDecidingGate(reason);
    assert.ok(expected && expected.means, `${useCase}'s ladder has no rung for "${reason}" — pick a live slug`);
    const got = gateMeaning(useCase, reason);
    assert.ok(got, `${useCase}/${reason} must resolve to plain words`);
    assert.equal(got.means, expected.means, "the viewer must quote the engine, never paraphrase it");
    assert.ok(got.means.length > 40, "a `means` is a sentence for a person, not a second slug");
  }

  // rca-nr4i / D-20: UC-01's SELF-SERVICE door (a distinct, shorter ladder —
  // see src/uc01/policyEngine.js's SELF_SERVICE_GATE_SEQUENCE) resolves
  // through the SAME "UC-01" registry entry, via its own reason vocabulary.
  const uc01 = await import("../src/uc01/policyEngine.js");
  const expectedSelfService = uc01.describeSelfServiceDecidingGate("self_service_all_gates_passed");
  assert.ok(expectedSelfService && expectedSelfService.means);
  const gotSelfService = gateMeaning("UC-01", "self_service_all_gates_passed");
  assert.ok(gotSelfService, "UC-01's self-service terminal reason must resolve to plain words too");
  assert.equal(gotSelfService.means, expectedSelfService.means);
  // And the total is the SELF-SERVICE ladder's own length (5), never the
  // ticket-driven ladder's (13) — a borrowed total would claim this door ran
  // checks (over-scope disclosure, classifier confidence) it never runs.
  assert.equal(gotSelfService.total, expectedSelfService.total);
  assert.notEqual(
    gotSelfService.total,
    gateMeaning("UC-01", "all_gates_passed").total,
    "the two UC-01 doors run chains of different lengths and must report different totals"
  );
});

test("R7-37 / rca-x0i6: a portal row's gate meaning says it was checked against the fixture, not Remote", async () => {
  const { gateMeaning } = await import("../src/auditview/gateMeanings.js");
  const uc01 = await import("../src/uc01/policyEngine.js");
  const plain = uc01.describeSelfServiceDecidingGate("self_service_all_gates_passed").means;

  // No context (or a non-portal source) renders the engine's sentence
  // verbatim — this is the ticket-driven, real-Remote-read case, and it must
  // stay exactly what the policy engine wrote, unannotated.
  assert.equal(gateMeaning("UC-01", "self_service_all_gates_passed").means, plain);
  assert.equal(gateMeaning("UC-01", "self_service_all_gates_passed", {}).means, plain);
  assert.equal(gateMeaning("UC-01", "self_service_all_gates_passed", { source: "zendesk" }).means, plain);
  assert.equal(gateMeaning("UC-01", "self_service_all_gates_passed", { source: null }).means, plain);

  // `source: "portal"` — the marker traceVerdict.js already uses to disclose
  // that this submission's Remote reads went to the mock fixtures — gets the
  // same fact folded into the gate's own sentence, so "Remote is the legal
  // employer, the employment is active" cannot be read as a claim about a
  // live Remote record on this row.
  const fromPortal = gateMeaning("UC-01", "self_service_all_gates_passed", { source: "portal" });
  assert.ok(fromPortal.means.startsWith(plain), "the engine's own sentence is never replaced, only extended");
  assert.match(fromPortal.means, /mock fixture record, not a live read of Remote/);
  assert.notEqual(fromPortal.means, plain);
  // Nothing else about the row changes shape.
  assert.equal(fromPortal.gate, gateMeaning("UC-01", "self_service_all_gates_passed").gate);
  assert.equal(fromPortal.position, gateMeaning("UC-01", "self_service_all_gates_passed").position);
  assert.equal(fromPortal.total, gateMeaning("UC-01", "self_service_all_gates_passed").total);
});

test("R7-37 / rca-x0i6: the caveat reaches the actual feed, not just the direct gateMeaning() call", async () => {
  const rows = await rowsOf(seededStore(), { limit: 200 });
  const uc02Portal = rows.find(
    (r) => r.useCase === "UC-02" && r.reason === "all_gates_passed" && r.source === "portal"
  );
  assert.ok(uc02Portal, "the seed must carry a portal-sourced UC-02 auto_approve row to exercise this on");
  assert.ok(uc02Portal.reasonMeaning, "this reason has a rung on UC-02's ladder");
  assert.match(uc02Portal.reasonMeaning.means, /mock fixture record, not a live read of Remote/);

  // A ticket-driven UC-01 row citing the SAME shape of reason, but with no
  // portal source on it, must not pick up the caveat — it really was read
  // against a live Remote record (this repo's own "REAL, verified against
  // Sandbox" claim for UC-01's Remote reads).
  const uc01Ticket = rows.find((r) => r.useCase === "UC-01" && r.reason === "all_gates_passed");
  assert.ok(uc01Ticket, "the seed must carry a ticket-driven UC-01 row");
  assert.notEqual(uc01Ticket.source, "portal");
  assert.ok(uc01Ticket.reasonMeaning, "UC-01's ticket ladder has a rung for this reason");
  assert.doesNotMatch(uc01Ticket.reasonMeaning.means, /mock fixture record/);
});

test("a use case with no gate ladder, and an unknown reason, render exactly as before", async () => {
  const { gateMeaning } = await import("../src/auditview/gateMeanings.js");
  // UC-07/UC-08 are the no-execution-path dossier builds and publish no
  // GATE_SEQUENCE. No entry, no prose, no placeholder — the slug alone, as
  // always.
  for (const useCase of ["UC-07", "UC-08", "UC-42", null, undefined]) {
    assert.equal(gateMeaning(useCase, "all_gates_passed"), null, `${useCase} has no ladder to consult`);
  }
  // An unrecognised reason on a use case that HAS a ladder. Both ladder shapes
  // already answer honestly — UC-01/03/04/05/06/09's helper returns null,
  // UC-02's returns a row whose `means` is "" — and neither is papered over.
  assert.equal(gateMeaning("UC-05", "no_such_reason_anywhere"), null);
  assert.equal(gateMeaning("UC-02", "no_such_reason_anywhere"), null);
  assert.equal(gateMeaning("UC-01", "no_such_reason_anywhere"), null, "neither of UC-01's two doors knows this reason");
  assert.equal(gateMeaning("UC-05", ""), null);
  assert.equal(gateMeaning("UC-05", null), null);
});

test("a UC-01 row now carries the SAME plain words its policy engine holds — the slug is never replaced", async () => {
  const rows = await rowsOf(seededStore(), { limit: 200, useCase: "UC-01" });
  assert.ok(rows.length, "the seed must carry UC-01 rows");
  const { describeDecidingGate } = await import("../src/uc01/policyEngine.js");
  for (const row of rows) {
    assert.equal(row.humanVerdict, null, "UC-01's rows are automated: no person's verdict to show");
    assert.equal(row.reason, "all_gates_passed", "the slug is exactly what it always was");
    // rca-nr4i / D-20: this used to assert `reasonMeaning === null` — true
    // only because UC-01 was missing from the registry, not because UC-01
    // has no ladder to consult. Now it must carry the SAME sentence
    // describeDecidingGate() itself holds, quoted rather than paraphrased.
    const expected = describeDecidingGate("all_gates_passed");
    assert.ok(row.reasonMeaning, "a registered use case's reason must resolve to plain words");
    assert.equal(row.reasonMeaning.means, expected.means);
  }
});

// THE READ-ONLY GUARANTEE, EXTENDED TO WHAT THE REGISTRY DRAGS IN.
// gateMeanings.js imports seven policy engines. Policy engines are pure by
// design, but "pure by design" is a claim, and importing one that had grown a
// store or a REST client would put a write path inside a viewer whose
// read-only-ness is structural. So the import graph is walked, not trusted.
test("the gate-meaning registry imports no write path — the whole transitive graph", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");

  const seen = new Set();
  const queue = [fileURLToPath(new URL("../src/auditview/gateMeanings.js", import.meta.url))];
  const forbidden =
    /\b(restClient|zendeskClient|RemoteClient|ZendeskClient|pgPool|expenseStore|amendmentStore|adjustmentStore|authorizationStore|resignationStore|caseStore|dossierStore|AuditLogger)\b/;

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(
      !forbidden.test(code),
      `${file} reaches a write-capable dependency — the audit viewer must not import one`
    );
    for (const match of code.matchAll(/from\s+"(\.[^"]+)"/g)) {
      queue.push(resolve(dirname(file), match[1]));
    }
  }
  assert.ok(seen.size >= 8, "the walk must actually have followed the imports");
});

test("correlation comes from a record id in details — never from timestamps", () => {
  assert.deepEqual(correlationOf({ storeId: "s1", expenseId: "e1" }), { field: "storeId", key: "s1" },
    "storeId wins over expenseId: only the first identifies THIS submission");
  assert.deepEqual(correlationOf({ caseId: "c1", reviewId: "r1" }), { field: "caseId", key: "c1" });
  assert.deepEqual(correlationOf({ amendmentId: "a1" }), { field: "amendmentId", key: "a1" });
  // A row with no key on the list is honestly uncorrelatable, not guessed at.
  assert.deepEqual(correlationOf({ externalRef: "5", at: "2026-08-18T00:00:00Z" }), { field: null, key: null });
  assert.deepEqual(correlationOf(null), { field: null, key: null });
});

test("drill-down returns the siblings sharing one RECORD — including a later, separate submission", async () => {
  const store = seededStore();
  const rows = await rowsOf(store, { useCase: "UC-02", limit: 200 });
  const write = rows.find((r) => r.action === "expense_approved_write");

  const found = await store.getDecision(write.id);
  assert.equal(found.correlation.field, "storeId");
  // Three siblings, not two: the decision, the pre-write intent, AND the
  // refusal of a SECOND submission of the same claim half an hour later. All
  // four rows are genuinely one expense record, so grouping them is right —
  // what would be wrong is calling them one submission, which is why the
  // panel's heading and prose say "record".
  assert.equal(found.siblings.length, 3);
  assert.ok(found.siblings.some((s) => s.action === "auto_approve" && s.kind === "decision"));
  const later = found.siblings.find((s) => s.action === "duplicate_request_ignored");
  assert.equal(later.kind, "decision", "a second submission's outcome is a decision, not a follow-up of the first");
  assert.ok(later.at > write.at, "and it was recorded after the execution it shares a group with");

  // Ticket #5's two rows share an externalRef but NO record id, so they are
  // honestly uncorrelatable — the viewer says that rather than grouping them
  // on the 1ms between them, which would be exactly the guess to avoid.
  const ticketFive = await store.lookupRef("5");
  assert.equal(ticketFive.decisions.length, 2);
  const dup = await store.getDecision(ticketFive.decisions[0].id);
  assert.equal(dup.correlation.field, null);
  assert.deepEqual(dup.siblings, []);
});

// --- 1d. the trace verdict: why is this Attempts table empty? -----------------

// PROSE AND BADGE MUST NOT DISAGREE. The badge on this row reads "Execution";
// before the third kind existed the verdict beneath it opened with "This row is
// a follow-up event", so one screen said two things. The assertion covers both
// halves at once, because either alone passes while the pair is wrong.
test("VERDICT: an execution row is called an execution, and pointed at the decision row", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-02&limit=200"));
  const write = feed.json.decisions.find((d) => d.action === "expense_approved_write");
  assert.equal(write.kind, "execution", "the badge's own value");

  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${write.id}`));
  assert.equal(json.trace.length, 0);
  assert.equal(json.traceVerdict.code, "execution_row");
  assert.equal(json.decision.kind, "execution");
  assert.match(json.traceVerdict.headline, /outward act/);
  assert.ok(
    !/follow-up event/i.test(json.traceVerdict.headline + json.traceVerdict.detail),
    "prose must not call an execution row a follow-up event while the badge says Execution"
  );
  // The actionable half is unchanged: there is still a row to open.
  assert.ok(json.traceVerdict.relatedDecisionId, "the reader gets a row to open");
  const target = feed.json.decisions.find((d) => d.id === json.traceVerdict.relatedDecisionId);
  assert.equal(target.action, "auto_approve", "and it is the decision row of the same submission");
});

// A GROUP CAN NOW HOLD TWO DECISION ROWS, so "the decision this row follows"
// stopped being "the first decision in the group". Live the later decision
// arrived last and `find()` was right by luck; here it is placed FIRST in the
// array, which is what a store returning a different order — or a resubmission
// that beat the write into the table — would produce.
test("VERDICT: the decision a row is said to follow is the one recorded BEFORE it", () => {
  const verdict = traceVerdict({
    decision: {
      id: "write",
      at: "2026-08-19T11:15:00.841Z",
      kind: "execution",
      action: "expense_approved_write",
      details: { storeId: "s-1" },
    },
    trace: [],
    siblings: [
      // The second submission's decision, recorded AFTER the execution.
      { id: "later", action: "duplicate_request_ignored", kind: "decision", traceCount: 0, at: "2026-08-19T11:46:00.000Z" },
      // The decision this write actually followed.
      { id: "earlier", action: "auto_approve", kind: "decision", traceCount: 0, at: "2026-08-19T11:15:00.000Z" },
    ],
    correlation: { field: "storeId", key: "s-1" },
    earliestTraceAt: "2026-08-19T00:00:00.000Z",
  });
  assert.equal(verdict.code, "execution_row");
  assert.equal(verdict.relatedDecisionId, "earlier", "a write cannot follow a decision made after it");
  assert.match(verdict.detail, /auto_approve/);
  assert.ok(!verdict.detail.includes("duplicate_request_ignored"));
});

test("VERDICT: no decision precedes this row — nothing is pointed at rather than pointing at a later one", () => {
  const verdict = traceVerdict({
    decision: { id: "write", at: "2026-08-19T11:00:00.000Z", kind: "execution", action: "amendment_executed", details: { amendmentId: "a-1" } },
    trace: [],
    siblings: [{ id: "later", action: "escalate", kind: "decision", traceCount: 3, at: "2026-08-19T12:00:00.000Z" }],
    correlation: { field: "amendmentId", key: "a-1" },
    earliestTraceAt: "2026-08-19T00:00:00.000Z",
  });
  // The sibling HAS attempts, so branch 1 still names it — that branch is about
  // "where are the attempts", which is a true statement whichever way time runs.
  assert.equal(verdict.code, "sibling_has_trace");
  const prose = verdict.headline + " " + verdict.detail;
  assert.match(prose, /same record|on one record/, "and it says record, never submission");
  assert.ok(!/submission/i.test(prose), "a group is a record, and one record can carry more than one submission");
});

test("VERDICT: an execution row with no identifiable decision is still explained, not 'unexplained'", () => {
  const verdict = traceVerdict({
    decision: { id: "x", at: "2026-08-18T12:00:00.000Z", kind: "execution", action: "adjustment_executed", details: {} },
    trace: [],
    siblings: [],
    correlation: { field: null, key: null },
    earliestTraceAt: "2026-08-18T00:00:00.000Z", // older, so NOT predates_tracing
  });
  assert.equal(verdict.code, "execution_row");
  assert.equal(verdict.relatedDecisionId, null, "nothing to point at, and it says so rather than inventing one");
  assert.match(verdict.detail, /no decision row recorded before it shares this row's record id/);
});

test("VERDICT: a follow-up event is told it is one, and pointed at the decision row", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-02&limit=200"));
  // The row written BEFORE the PATCH — an intent, still an ordinary event.
  const pre = feed.json.decisions.find((d) => d.action === "expense_auto_approved");
  assert.equal(pre.kind, "event");

  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${pre.id}`));
  assert.equal(json.trace.length, 0);
  assert.equal(json.traceVerdict.code, "follow_up_event");
  assert.ok(json.traceVerdict.relatedDecisionId, "the reader gets a row to open");
  const target = feed.json.decisions.find((d) => d.id === json.traceVerdict.relatedDecisionId);
  assert.equal(target.action, "auto_approve", "and it is the decision row of the same submission");
});

test("VERDICT: a decision that made no traceable call SAYS so, naming the fields that prove it", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-02&limit=200"));
  const decision = feed.json.decisions.find((d) => d.action === "auto_approve");
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${decision.id}`));

  assert.equal(json.trace.length, 0);
  assert.equal(json.traceVerdict.code, "no_traceable_call");
  const fields = json.traceVerdict.evidence.map((e) => e.field + "=" + e.value);
  assert.ok(fields.includes("categorySource=rule_based_fallback"), "the rules answered — no LLM call to trace");
  assert.ok(fields.includes("source=portal"), "the portal reads mock fixtures — no upstream call to trace");
});

test("VERDICT: a decision older than the oldest trace row anywhere predates tracing", async () => {
  const handler = seededHandler();
  const ref = await call(handler, fakeReq("GET", "/api/refs/5"));
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${ref.json.decisions[0].id}`));
  assert.equal(json.traceVerdict.code, "predates_tracing");
  assert.match(json.traceVerdict.detail, /before the oldest audit_trace row/);
});

test("VERDICT: attempts present means nothing to explain", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-01&q=all_gates_passed"));
  const withRetry = feed.json.decisions.find((d) => d.externalRef === "6");
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${withRetry.id}`));
  assert.equal(json.traceVerdict.code, "traced");
});

test("VERDICT: 'we do not know' stays a distinct answer — it is the one that means investigate", () => {
  const verdict = traceVerdict({
    decision: { id: "x", at: "2026-08-18T12:00:00.000Z", kind: "decision", action: "escalate", details: {} },
    trace: [],
    siblings: [],
    earliestTraceAt: "2026-08-18T00:00:00.000Z", // older, so NOT predates_tracing
  });
  assert.equal(verdict.code, "unexplained");
  assert.deepEqual(verdict.evidence, []);
});

test("VERDICT: a sibling that actually HAS attempts is named, whichever kind this row is", () => {
  const verdict = traceVerdict({
    // `amendment_executed` really IS an execution, so the row is labelled the
    // way readStore.js would label it — a test fixture that mislabels its own
    // subject would be checking the wrong thing.
    decision: { id: "x", at: "2026-08-18T12:00:00.000Z", kind: "execution", action: "amendment_executed", details: {} },
    trace: [],
    siblings: [
      { id: "sib-1", action: "dual_approval_required", kind: "decision", traceCount: 4 },
      { id: "sib-2", action: "amendment_approved", kind: "event", traceCount: 0 },
    ],
    correlation: { field: "amendmentId", key: "am-9" },
  });
  assert.equal(verdict.code, "sibling_has_trace");
  assert.equal(verdict.relatedDecisionId, "sib-1");
  assert.match(verdict.detail, /amendmentId am-9/);
  // Even here — a different branch entirely — the prose names the row's real
  // kind rather than defaulting to "follow-up event".
  assert.match(verdict.detail, /execution row/);
});

// --- 2. the store: reads THROW (§9) -------------------------------------------

test("CRITICAL: a failing pool REJECTS the read — never an empty list", async () => {
  const store = new AuditReadStore({
    pgPool: {
      async query() {
        throw new Error("connection reset by peer");
      },
    },
  });
  // Every read path, not just one: a wrong number gets acted on, a missing one
  // gets investigated — so none of these may resolve to [].
  await assert.rejects(() => store.listDecisions(), /connection reset/);
  await assert.rejects(() => store.getDecision("11111111-1111-4111-8111-111111111101"), /connection reset/);
  await assert.rejects(() => store.listAlerts(), /connection reset/);
  await assert.rejects(() => store.lookupRef("5"), /connection reset/);
});

test("no pool and not seeded fails CLOSED with a typed error — the deployed pre-Supabase state", async () => {
  const store = new AuditReadStore({});
  assert.equal(store.mode(), "unavailable");
  await assert.rejects(() => store.listDecisions(), NoDurableStoreError);
  await assert.rejects(() => store.lookupRef("5"), (err) => err.code === "no_durable_store");
});

test("a non-UUID decision id is a not-found, answered without touching the pool", async () => {
  // Passing a non-uuid to a uuid column throws a pg cast error — which would
  // render as a store failure over what is really "that row cannot exist".
  const pool = fakePool({ audit_log: [] });
  const store = new AuditReadStore({ pgPool: pool });
  assert.equal(await store.getDecision("not-a-uuid"), null);
  assert.equal(pool.calls.length, 0, "the pool must not see a value its column type rejects");
});

test("the supabase read path queries the four real tables with the real column names", async () => {
  const pool = fakePool({ audit_log: [], audit_trace: [], workflow_claims: [], ops_alerts: [] });
  const store = new AuditReadStore({ pgPool: pool });
  assert.equal(store.mode(), "supabase");

  await store.listDecisions({ useCase: "UC-06", action: "escalate", q: "cycle", since: "2026-08-18T00:00:00Z", limit: 10 });
  await store.listAlerts();
  await store.lookupRef("3001");

  const sql = pool.calls.map((c) => c.sql).join("\n");
  // Column names verified against the live Supabase schema — the queries must
  // use them, not invented ones (the fixtures-agreeing-with-code defect class).
  for (const fragment of [
    "from audit_log",
    "from workflow_claims",
    "use_case",
    "external_ref",
    "claimed_at",
    "risk_tier",
    "details->>'externalRef'",
  ]) {
    assert.ok(sql.includes(fragment), `expected SQL to mention ${fragment}`);
  }
  // Filters travel as parameters, never interpolated. The trailing three are
  // the page cursor (null here — page 1) and a coarse limit: one row beyond
  // the page (so `hasMore` is a fact rather than a guess) plus TIE_SLACK extra
  // rows, fetched because the `since` boundary here is now deliberately
  // coarse (`at >= $3`) — the exact "strictly newer than (since, sinceId)"
  // decision is made afterwards in JS on the already-truncated rows (E4-F15,
  // rca-0nm: comparing a client-echoed, millisecond-truncated cursor against
  // Postgres's full microsecond-precision `at` in SQL made the same boundary
  // row match "greater than itself" forever).
  const [decisionCall] = pool.calls;
  assert.deepEqual(decisionCall.params, [
    "UC-06",
    "escalate",
    "2026-08-18T00:00:00Z",
    "%cycle%",
    null,
    null,
    31,
  ]);
});

// ---------------------------------------------------------------------------
// E4-F15 (rca-0nm) — the Live Feed re-appended its newest row on every poll.
// Root cause: `since`/`since_id` named the row the client already had, and
// the SQL boundary compared that (client-echoed, millisecond-truncated)
// cursor against Postgres's own full-microsecond-precision `at` column — so
// the real `at` was always >= the truncated cursor, and the same row matched
// "newer than itself" forever. Fixed by fetching coarsely (`at >= $3`,
// inclusive) and making the exact "strictly newer" decision in JS, on rows
// already through the SAME isoAt() truncation the client's copy went
// through — so both sides compare the identical representation and a tie can
// actually resolve.
//
// This fakePool does not execute SQL (see fakePool() above) — it stands in
// for "what Postgres already returned for a coarse `at >= $3` fetch", which
// is realistic: every row here genuinely has `at >= the since cursor`. What
// this test pins is the JS-side filter that runs on that result.
// ---------------------------------------------------------------------------
test("E4-F15: listDecisions() excludes its own since/since_id boundary row, includes a tied sibling with a larger id, excludes one with a smaller id, and always includes a genuinely later row", async () => {
  const at = (iso) => new Date(iso);
  const row = (id, iso, ref) => ({
    id,
    at: at(iso),
    useCase: "UC-01",
    action: "escalate",
    actor: "chris.lee.personal.r4@example.org",
    riskTier: "medium",
    externalRef: ref,
    reason: "identity_not_verified",
    employmentId: null,
    source: null,
    priorDecision: null,
    flags: null,
    note: null,
    role: null,
    aiDecision: null,
    hasRemoteResult: false,
    correlationField: null,
    correlationKey: null,
    traceCount: 0,
  });

  // (at desc, id desc) — the order a real `order by` clause would hand back.
  const CURSOR_AT = "2026-08-22T10:25:05.347Z";
  const laterRow = row("dddddddd-0000-4000-8000-000000000004", "2026-08-22T10:25:06.000Z", "110");
  const tiedLargerId = row("bbbbbbbb-0000-4000-8000-000000000002", CURSOR_AT, "109b");
  const cursorRow = row("aaaaaaaa-0000-4000-8000-000000000001", CURSOR_AT, "109");
  const tiedSmallerId = row("00000000-0000-4000-8000-000000000000", CURSOR_AT, "109c");

  let lastCall = null;
  const pool = {
    async query(sql, params) {
      lastCall = { sql, params };
      return { rows: [laterRow, tiedLargerId, cursorRow, tiedSmallerId], rowCount: 4 };
    },
  };
  const store = new AuditReadStore({ pgPool: pool });

  const page = await store.listDecisions({ since: CURSOR_AT, sinceId: cursorRow.id, limit: 50 });

  assert.deepEqual(
    page.decisions.map((d) => d.id),
    [laterRow.id, tiedLargerId.id],
    "the cursor's own row and an older-tiebreak sibling sharing its millisecond must not reappear; " +
      "a strictly-later row and a newer-tiebreak sibling sharing its millisecond must both come through"
  );

  assert.ok(
    lastCall.sql.includes("at >= $3::timestamptz"),
    "the since boundary must be a coarse, INCLUSIVE fetch — the exact decision belongs to the JS filter, not to comparing two different-precision timestamps in SQL"
  );
  assert.ok(
    !lastCall.sql.includes("at > $3::timestamptz"),
    "a strict SQL-side compare of a truncated client cursor against full-precision `at` is exactly what re-served ticket #109's row on every poll"
  );
});

test("E4-F15: a poll immediately after loading a page never re-serves that page's newest row", async () => {
  // The exact shape from the finding: the client's `newestAt`/`newestId` come
  // straight from the row it was just shown, and the very next poll — before
  // anything new has landed — must come back empty, not with that same row.
  const at = new Date("2026-08-22T10:25:05.347Z");
  const newest = {
    id: "7be1f147-0000-4000-8000-000000000000",
    at,
    useCase: "UC-01",
    action: "escalate",
    actor: "chris.lee.personal.r4@example.org",
    riskTier: "medium",
    externalRef: "109",
    reason: "identity_not_verified",
  };
  const pool = { async query() { return { rows: [newest], rowCount: 1 }; } };
  const store = new AuditReadStore({ pgPool: pool });

  const firstPage = await store.listDecisions({ limit: 50 });
  assert.equal(firstPage.decisions.length, 1);
  const [seen] = firstPage.decisions;

  const idlePoll = await store.listDecisions({ since: seen.at, sinceId: seen.id, limit: 50 });
  assert.deepEqual(idlePoll.decisions, [], "an idle poll must return nothing when the store's newest row is the poll's own cursor");
});

// --- 3. the server: routes and verdicts ---------------------------------------

test("the page, the app and the shared design system are served", async () => {
  const handler = seededHandler();
  for (const [path, marker] of [
    ["/", "<title>Audit trail viewer"],
    ["/app.js", "DECISION_DOT"],
    ["/style.css", "live-dot"],
    ["/remote-ui.css", ":root"],
  ]) {
    const res = fakeRes();
    await handler(fakeReq("GET", path), res);
    assert.equal(res.statusCode, 200, path);
    assert.ok(String(res.body).includes(marker), `${path} must contain ${marker}`);
  }
});

test("GET /api/meta reports the mode — the page's boot probe", async () => {
  const { json } = await call(seededHandler(), fakeReq("GET", "/api/meta"));
  assert.equal(json.mode, "seeded");
});

test("GET /api/decisions serves the feed with its mode, and honours query filters", async () => {
  const handler = seededHandler();
  const all = await call(handler, fakeReq("GET", "/api/decisions"));
  assert.equal(all.json.mode, "seeded");
  assert.ok(all.json.decisions.length >= 6);

  const filtered = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-04&action=blocked"));
  assert.equal(filtered.json.decisions.length, 1);
  assert.equal(filtered.json.decisions[0].reason, "sanctioned_region");
});

test("drill-down: a genuine duplicate call IS flagged, by the metrics layer's own detector", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-02"));
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${feed.json.decisions[0].id}`));

  assert.ok(json.trace.length >= 3);
  assert.equal(json.redundantCalls.length, 1);
  assert.equal(json.redundantCalls[0].kind, "redundant_call");
  assert.equal(json.redundantCalls[0].call, "openai.classify_expense");
  assert.deepEqual(json.redundantCalls[0].attempts, [1, 1], "two entries both claiming attempt 1");
});

test("drill-down: a clean 1..n retry sequence is NOT flagged — the other direction matters too", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-01&q=all_gates_passed"));
  const withRetry = feed.json.decisions.find((d) => d.externalRef === "6");
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${withRetry.id}`));

  const classifyAttempts = json.trace.filter((t) => t.call === "openai.classify");
  assert.equal(classifyAttempts.length, 2, "the retry wrapper's own bookkeeping is present");
  assert.deepEqual(json.redundantCalls, [], "attempts 1..2 must read as a retry, not a duplicate");
  assert.equal(json.hasMultiAttemptGroup, true, "a real 1..2 group exists — the clean-retry blurb applies");
});

// R7-35 (rca-2xsl): rows whose calls each fired once — no retry sequence to
// describe — must not be told they read as "one clean retry sequence". An
// empty `redundantCalls` alone cannot distinguish this from the case above;
// `hasMultiAttemptGroup` is what the page must gate the blurb on instead.
test("drill-down: distinct single-fire calls are not a retry sequence — nothing to call clean", async () => {
  const handler = seededHandler();
  const feed = await call(handler, fakeReq("GET", "/api/decisions?use_case=UC-06&action=escalate"));
  const noCycle = feed.json.decisions.find((d) => d.externalRef === "3001");
  const { json } = await call(handler, fakeReq("GET", `/api/decisions/${noCycle.id}`));

  const calls = json.trace.map((t) => t.call);
  assert.deepEqual(calls, ["remote.employment", "remote.payroll_runs"], "two DIFFERENT calls, each fired once");
  assert.deepEqual(json.redundantCalls, [], "no group ever had 2+ entries, so nothing was flagged");
  assert.equal(json.hasMultiAttemptGroup, false, "and nothing was flagged because there is no group to begin with");
});

test("an unknown decision id 404s as decision_not_found", async () => {
  const { res, json } = await call(seededHandler(), fakeReq("GET", "/api/decisions/nope"));
  assert.equal(res.statusCode, 404);
  assert.equal(json.code, "decision_not_found");
});

test("the bug audit route reports ticket #5's duplicate delivery as a server-side verdict", async () => {
  const { json } = await call(seededHandler(), fakeReq("GET", "/api/refs/5"));
  assert.equal(json.externalRef, "5");
  assert.equal(json.claims.length, 1);
  assert.equal(json.decisions.length, 2);
  assert.deepEqual(json.duplicateDeliveries, [{ useCase: "UC-01", externalRef: "5", decisionRows: 2 }]);
});

test("a singly-delivered ref carries no duplicate verdict", async () => {
  const { json } = await call(seededHandler(), fakeReq("GET", "/api/refs/3001"));
  assert.equal(json.decisions.length, 1);
  assert.deepEqual(json.duplicateDeliveries, []);
});

test("GET /api/alerts serves the ops ledger with auditDurable intact in both directions", async () => {
  const { json } = await call(seededHandler(), fakeReq("GET", "/api/alerts"));
  const durables = json.alerts.map((a) => a.auditDurable).sort();
  assert.deepEqual(durables, [false, true], "the demo must show both answers to 'did we lose a decision?'");
});

test("an unknown route 404s as no_such_route", async () => {
  const { res, json } = await call(seededHandler(), fakeReq("GET", "/api/nope"));
  assert.equal(res.statusCode, 404);
  assert.equal(json.code, "no_such_route");
});

// --- 4. no write path, structurally -------------------------------------------

test("ANY write-shaped request 404s as no_such_route — there is nothing there to refuse", async () => {
  const handler = seededHandler();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of ["/api/decisions", "/api/decisions/x", "/api/alerts", "/api/refs/5", "/api/meta", "/api/anything"]) {
      const { res, json } = await call(handler, fakeReq(method, path));
      assert.equal(res.statusCode, 404, `${method} ${path}`);
      assert.equal(json.code, "no_such_route");
    }
  }
});

test("STRUCTURAL: the server source, stripped of comments, never mentions a write method", () => {
  // Same proof shape as test/uc08.test.js: a route that refuses is one bug
  // away from accepting; a route that does not exist is not.
  const fullSource = readFileSync(new URL("../src/auditview/server.js", import.meta.url), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(!code.includes(`"${method}"`) && !code.includes(`'${method}'`), `server.js must not branch on ${method}`);
  }
});

test("STRUCTURAL: the store has no write method — no insert/update/delete anywhere", () => {
  const fullSource = readFileSync(new URL("../src/auditview/readStore.js", import.meta.url), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const verb of ["insert into", "update ", "delete from"]) {
    assert.ok(!code.toLowerCase().includes(verb), `readStore.js must not contain "${verb}"`);
  }
});

// --- 5. errors RENDER — the §9 rule at the HTTP layer --------------------------

test("a store failure answers 500 audit_read_failed with the reason — never 200 with []", async () => {
  const handler = createAuditViewHandler({
    store: new AuditReadStore({
      pgPool: {
        async query() {
          throw new Error("supabase is down");
        },
      },
    }),
    access: OPEN_ACCESS,
  });
  const { res, json } = await call(handler, fakeReq("GET", "/api/decisions"));
  assert.equal(res.statusCode, 500);
  assert.equal(json.code, "audit_read_failed");
  assert.ok(json.reason.includes("supabase is down"), "the page must be able to render WHAT failed");
});

test("the deployed pre-Supabase state answers 503 no_durable_store and names the fix", async () => {
  const handler = createAuditViewHandler({ store: new AuditReadStore({}), access: OPEN_ACCESS });
  const { res, json } = await call(handler, fakeReq("GET", "/api/decisions"));
  assert.equal(res.statusCode, 503);
  assert.equal(json.code, "no_durable_store");
  assert.ok(json.howToFix.join(" ").includes("SUPABASE_DB_URL"));
});

// --- 6. access: the portal's shared key, reused whole --------------------------

const KEY = "audit-viewer-test-key";
const GATED = portalAccessPosture({ [PORTAL_KEY_ENV]: KEY }, { persistent: true });

test("with a durable posture, every API read is refused without the key", async () => {
  const handler = createAuditViewHandler({ store: seededStore(), access: GATED });
  for (const path of ["/api/meta", "/api/decisions", "/api/alerts", "/api/refs/5"]) {
    const { res, json } = await call(handler, fakeReq("GET", path));
    assert.equal(res.statusCode, 401, path);
    assert.equal(json.code, "portal_access_key_required");
  }
});

test("with the key, the same reads answer — a gate that refuses everything proves nothing", async () => {
  const handler = createAuditViewHandler({ store: seededStore(), access: GATED });
  const { res, json } = await call(
    handler,
    fakeReq("GET", "/api/decisions", { headers: { [PORTAL_KEY_HEADER]: KEY } })
  );
  assert.equal(res.statusCode, 200);
  assert.ok(json.decisions.length > 0);
});

test("key required but not configured fails CLOSED with the portal's own code", async () => {
  const access = portalAccessPosture({}, { persistent: true });
  const handler = createAuditViewHandler({ store: seededStore(), access });
  const { res, json } = await call(handler, fakeReq("GET", "/api/decisions"));
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "portal_access_key_not_configured");
});

test("the page itself is served without a key — it is how you are TOLD a key is needed", async () => {
  const handler = createAuditViewHandler({ store: seededStore(), access: GATED });
  const res = fakeRes();
  await handler(fakeReq("GET", "/"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.body).includes("access-gate"), "the page carries the prompt the refusal will trigger");
});

// --- 7. the browser assets ------------------------------------------------------

function readAsset(name) {
  return readFileSync(new URL(`../src/auditview/assets/${name}`, import.meta.url), "utf8");
}

test("app.js compiles — a syntax error in a browser asset must fail npm test", () => {
  assert.doesNotThrow(() => new vm.Script(readAsset("app.js"), { filename: "app.js" }));
});

test("app.js writes no markup and re-derives no policy", () => {
  const app = readAsset("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(app), "app.js must not write markup — audit rows are text people typed");
  assert.ok(!app.includes("insertAdjacentHTML"), "no markup injection by any other name");
  // The duplicate verdicts come from the server; the page must not recompute
  // them from attempt numbers.
  assert.ok(!/attempts?\s*\[\s*i\s*\]\s*!==?\s*i/.test(app), "no client-side 1..n sequence check");
  assert.ok(app.includes("redundantCalls"), "the page renders the server's verdict field");
  assert.ok(app.includes("duplicateDeliveries"), "the page renders the server's duplicate-delivery field");
});

// E4-F15 (rca-0nm): the Live Feed re-appended its newest row on every idle
// poll — 52 -> 54 -> 55 DOM rows, ref 109 showing 3 -> 5 -> 6 times, on a
// table holding exactly one row for it. The server-side half of the fix is
// covered functionally in the readStore.js tests above (a fakePool can
// execute JS filters, but not SQL); pollFeed() runs only in a browser, so its
// half is pinned at the source level here, the same way the rest of this
// file already checks app.js — matching the finding's own instruction that
// EITHER fix alone leaves the other broken.
test("app.js dedupes the Live Feed by id — a repeated boundary row can never render twice", () => {
  const app = readAsset("app.js");
  const pollFeed = app.slice(app.indexOf("function pollFeed("), app.indexOf("function renderLiveToggle("));
  assert.ok(pollFeed.includes("seenIds"), "pollFeed must consult the set of ids already on screen");
  assert.ok(
    /seenIds\.has\(\s*d(ecisions\[i\])?\.id\s*\)/.test(pollFeed) || /!seenIds\.has/.test(pollFeed),
    "incoming rows must be checked against seenIds before being inserted"
  );
  assert.ok(/seenIds\.add\(/.test(pollFeed), "a row that is inserted must be recorded so it cannot be inserted again");
  // The filter must run BEFORE anything touches the DOM — insertBefore must
  // not appear ahead of the seenIds check in source order, or the guard is
  // decorative.
  assert.ok(pollFeed.indexOf("seenIds") < pollFeed.indexOf("insertBefore"), "the dedupe filter must run before any row is inserted");
});

// ---------------------------------------------------------------------------
// E4-F14/F15 owner addendum (rca-0nm, 2026-08-22 10:50Z) — "THE POSITIVE TEST
// LEADS — written and SEEN TO FAIL FIRST, not a negative-only suite... F-15:
// the positive test is a genuinely redelivered ref that STILL renders twice.
// A dedupe that swallows real duplicates is worse than the bug. Dedupe the
// poll artifact, not the event."
//
// This EXECUTES the real filter predicate pollFeed() runs — extracted from
// the live source by regex so it cannot silently drift from what ships — as
// an actual function, against BOTH directions: the artifact (the same row
// re-served by the "since" boundary) is dropped, and the event (two genuinely
// different audit_log rows sharing one externalRef — exactly ticket #5's
// shape: two ids 30µs apart) is NOT. `seenIds` is a Set of ids; an
// externalRef never enters the predicate at all, which is what makes the
// second direction possible regardless of how many rows share a ref.
// ---------------------------------------------------------------------------
test("E4-F15 owner addendum, POSITIVE CASE FIRST: a genuinely redelivered ref (two different ids) still renders twice — the dedupe keys on id, never on externalRef", () => {
  const app = readAsset("app.js");
  const pollFeed = app.slice(app.indexOf("function pollFeed("), app.indexOf("function renderLiveToggle("));
  const match = pollFeed.match(/var fresh = payload\.decisions\.filter\(function \(d\) \{\s*return (!seenIds\.has\(d\.id\));\s*\}\);/);
  assert.ok(match, "could not locate the exact dedupe filter in pollFeed() — extraction regex is stale");

  // Compile the REAL predicate (match[1] is its literal source) rather than
  // restating "!seenIds.has(d.id)" by hand, so this test executes the shipped
  // logic, not a description of it.
  const predicate = new Function("d", "seenIds", "return " + match[1] + ";");

  const seenIds = new Set();
  const boundaryRow = { id: "7be1f147-3d8c-4c95-82e5-d13632d45a85", externalRef: "109" };
  const genuineRedeliveryFirst = { id: "aaaaaaaa-0000-4000-8000-000000000001", externalRef: "5" };
  const genuineRedeliverySecond = { id: "bbbbbbbb-0000-4000-8000-000000000002", externalRef: "5" }; // same ref, DIFFERENT id — ticket #5's actual shape

  // NEGATIVE direction (the bug this fix closes): the same row polled twice
  // must be dropped the second time.
  assert.equal(predicate(boundaryRow, seenIds), true, "an unseen row must pass");
  seenIds.add(boundaryRow.id);
  assert.equal(predicate(boundaryRow, seenIds), false, "the SAME id must be dropped on a repeat poll");

  // POSITIVE direction, asserted FIRST in intent even though it must run
  // after seeding history above: two rows sharing one externalRef — a real
  // redelivery — must BOTH pass, because they carry different ids. A dedupe
  // that grouped by externalRef instead of id would wrongly swallow the
  // second one, hiding a genuine duplicate delivery from the one surface
  // built to show it.
  assert.equal(predicate(genuineRedeliveryFirst, seenIds), true, "the first of a genuine pair must render");
  seenIds.add(genuineRedeliveryFirst.id);
  assert.equal(
    predicate(genuineRedeliverySecond, seenIds),
    true,
    "a SECOND row with a DIFFERENT id but the SAME externalRef must still render — this is what 'dedupe the poll artifact, not the event' means"
  );
});

test("app.js rebuilds seenIds from whatever page is actually on screen, on every loadPage()", () => {
  // Without this, paging away from the newest page and back (or a filter
  // change) would leave seenIds holding ids for rows no longer rendered,
  // silently swallowing genuinely new rows that happen to reuse... — more to
  // the point, it must be resynced to the DOM every time the DOM is rebuilt,
  // not just once at boot.
  const app = readAsset("app.js");
  const loadPage = app.slice(app.indexOf("function loadPage("), app.indexOf("function reloadFeed("));
  assert.ok(loadPage.includes("seenIds = new Set()"), "loadPage() must rebuild seenIds from the page it just rendered");
});

// --- the reference is DISCOVERABLE, not merely supported ---------------------
//
// The machinery to trace a request by its reference has existed for a while.
// Nothing on the page said the reference was the thing to trace WITH, so for
// the person holding one it may as well not have existed — the same failure
// shape as a field the server sends and nothing renders.

test("the feed shows a reference WHOLE and makes it traceable in one click", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");

  // Not textCell (dead text) and not idCell (which elides past 12 characters —
  // a portal reference is ~26, so every one of them would render truncated,
  // and a truncated reference cannot be copied, quoted or pasted).
  assert.ok(app.includes("function refCell("), "the reference column needs a cell of its own");
  assert.ok(app.includes("tr.appendChild(refCell(decision.externalRef))"), "the feed must use it");
  const refCellBody = app.slice(app.indexOf("function refCell("), app.indexOf("function traceRef("));
  assert.ok(!/shortId/.test(refCellBody), "a reference must never be shortened — it exists to be copied");

  // Clicking it must trace, not open the drill-down the ROW's own handler owns.
  assert.ok(/event\.stopPropagation\(\)/.test(refCellBody), "the row's click must not swallow the trace");
  assert.ok(app.includes("function traceRef("), "one path from a reference to its lookup");

  // And the reader has to be told what to paste, on both surfaces.
  assert.ok(/Trace a reference/.test(html), "the nav must name what the tab takes");
  assert.ok(/request reference/i.test(html), "the search box must say a reference goes in it");
});

test("an empty feed search offers the lookup that reads the LEDGER too", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");
  // A feed search only ever matches a decision row that CARRIES the reference.
  // "No rows" is therefore not an answer to "where did my request go?", and
  // leaving it as the last word is how a processed request reads as a lost one.
  assert.ok(html.includes('id="feed-empty-trace"'), "the empty state needs the escape hatch");
  assert.ok(html.includes('id="feed-trace-q"'), "…and a control that acts on it");
  const body = app.slice(app.indexOf("function renderFeedEmptyState("));
  assert.ok(/exactly-once ledger/.test(body.slice(0, 1200)), "it must say WHY the feed alone can miss it");
});

test("the ref lookup renders the server's verdict and reaches none of its own", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");
  assert.ok(app.includes("function renderRefVerdict("), "the verdict is rendered");
  assert.ok(app.includes("renderRefVerdict(payload.refVerdict)"), "…from the server's field");
  assert.ok(html.includes('id="ref-verdict"'), "and it has somewhere to land");

  // The judgement stays server-side: the renderer may read `tone`, `headline`,
  // `detail` and `notes`, and must not decide from the rows themselves.
  const body = app.slice(app.indexOf("function renderRefVerdict("), app.indexOf("function alertRefRow("));
  assert.ok(!/claims\.length|decisions\.length|alerts\.length/.test(body), "the page must not re-derive the verdict");

  // Only tone classes the shared design system actually defines, or the banner
  // renders unstyled and the warning reads as ordinary text.
  const css = readFileSync(new URL("../src/shared/ui/remote-ui.css", import.meta.url), "utf8");
  for (const cls of [...body.matchAll(/"(r-banner-[a-z]+)"/g)].map((m) => m[1])) {
    assert.ok(css.includes("." + cls), `${cls} is not defined in the shared design system`);
  }
});

test("the details are a TABLE, not a JSON dump — and the raw JSON stays reachable", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");
  assert.ok(app.includes("function detailTable("), "details render as label/value rows");
  assert.ok(app.includes('th.setAttribute("scope", "row")'), "a label/value table's headers run down the SIDE");
  // The old presentation was the whole record stringified into the primary
  // slot. It may still exist — behind a collapsible, for debugging.
  assert.ok(!/byId\("drill-details"\)\.textContent = JSON\.stringify/.test(app), "details must not be a <pre> dump");
  assert.ok(app.includes('byId("drill-details-raw").textContent = JSON.stringify'), "raw JSON is still one click away");
  assert.ok(html.includes('id="drill-details-raw"') && html.includes("<details class=\"raw-block\">"));
});

test("money renders from the row's OWN currency field, and never from a guessed one", () => {
  const app = readAsset("app.js");
  // Every money field is declared with the field carrying ITS currency; the
  // formatter is only reached when that partner is present on the same object.
  assert.ok(/var MONEY_FIELDS = \{/.test(app));
  assert.ok(/convertedAmount: "convertedCurrency"/.test(app), "the converted figure uses the converted code");
  assert.ok(/if \(currency\) \{/.test(app), "no currency in the row means no currency on screen");
  // Comments stripped: a three-letter code may be NAMED in prose (the comment
  // explaining why one is never assumed), but must not exist in the code.
  const code = app.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"GET"/g, "");
  assert.ok(!/"[A-Z]{3}"/.test(code), "no default currency may be hard-coded anywhere in the page");
  assert.ok(/Number\(value\) \/ 100|Number\(minorUnits\) \/ 100/.test(app), "×100 scaling is undone for display");
});

test("arrays are chips and booleans are words — and empty stays different from absent", () => {
  const app = readAsset("app.js");
  assert.ok(app.includes("function chipList("), "arrays render as chips, not as JSON");
  assert.ok(/value \? "yes" : "no"/.test(app), "booleans render as words");
  // The portal's idiom: a present-but-empty value keeps its em dash, an empty
  // array says "none", and a key that is absent has no row at all.
  assert.ok(/el\("span", "r-none", "—"\)/.test(app));
  assert.ok(/el\("span", "r-none", "none"\)/.test(app));
});

test("the feed carries the columns that say which row to open, and scrolls rather than squeezing", () => {
  const html = readAsset("index.html");
  const css = readAsset("style.css");
  for (const column of ["Kind", "Group", "Attempts", "Flags", "Employment", "Source"]) {
    assert.ok(html.includes(`<th scope="col">${column}</th>`), `the feed must carry a ${column} column`);
  }
  // Wide content scrolls inside its own container; the page body never does.
  assert.ok(/\.feed-table \{[^}]*min-width/.test(css), "without a floor width the columns squeeze and never scroll");
  const feedTable = html.slice(html.indexOf('id="feed-rows"') - 1600, html.indexOf('id="feed-rows"'));
  assert.ok(feedTable.includes('class="r-table-wrap"'), "the wide feed sits inside the design system's scroll wrapper");
});

test("pagination controls exist, and the page holds no cursor arithmetic of its own", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");
  assert.ok(html.includes('id="page-older"') && html.includes('id="page-newer"') && html.includes('id="page-size"'));
  assert.ok(html.includes('id="pager-where"'), "the reader is told which page they are on");
  assert.ok(html.includes('id="pager-paused"'), "and told, on screen, when paging has paused the live tail");
  // "Newer" is a pop off the stack of cursors the SERVER issued — the page
  // never builds a cursor, so there is one encoding of `(at, id)` in the
  // system rather than two that can disagree.
  assert.ok(app.includes("cursorStack.push(nextCursor)") && app.includes("cursorStack.pop()"));
  assert.ok(!/params\.set\("before", .*\.at \+/.test(app), "the page must not assemble a cursor itself");
  assert.ok(app.includes("function tailRunning()"), "tail-vs-paging is one predicate, not a scattered flag");
});

test("the page renders a human's verdict — actor, what they decided, and whether Remote took it", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");

  // The verdict word comes from the server's field; the page spells it.
  assert.ok(app.includes("decision.humanVerdict"), "the feed must show a person's verdict beside the action");
  assert.ok(app.includes("function humanChip("), "one place decides how a verdict looks");
  assert.ok(app.includes("function renderHumanDecision("), "the drill-down must have a human-decision block");
  assert.ok(html.includes('id="drill-human"') && html.includes('id="drill-human-facts"'));

  // WHO, WHAT THEY SAID, AND WHAT THE AI HAD RECOMMENDED — the three facts that
  // turn "an action happened" into "a named person authorised this".
  assert.ok(/addFact\(facts, "Decided by"/.test(app));
  assert.ok(/addFact\(facts, "Note"/.test(app));
  assert.ok(/The automation had recommended/.test(app), "the AI's recommendation sits beside the human's verdict");
  // Absent is stated, not blanked — the portal's idiom, applied to a note.
  assert.ok(app.includes('"no note recorded"'));

  // And whether the write landed — rendered independently of the human-decision
  // block (R7-32 / rca-ltja: nesting it inside `drill-human` meant it only ever
  // ran on a human verdict, so a fully automated row was never checked). Every
  // word is the server's; the page must not decide that an absent remoteResult
  // means anything.
  assert.ok(html.includes('id="drill-write-headline"') && html.includes('id="drill-write-detail"'));
  assert.ok(app.includes("function renderWriteOutcome("), "write-outcome rendering is its own function, not nested in the human block");
  assert.ok(app.includes("payload.writeOutcome"), "the page renders the server's write verdict field");
  // Comments stripped: `remoteResult` may be NAMED in prose (the note about why
  // a nested value stays collapsible), but the page must never read it.
  const code = app.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!code.includes("remoteResult"), "the page must not inspect the Remote response itself");
  assert.ok(!code.includes("hasRemoteResult"), "whether a write landed is the server's judgement, not the page's");
});

test("R7-33: the Actor column labels what KIND of value it holds, everywhere actor renders", () => {
  const app = readAsset("app.js");
  const css = readAsset("style.css");

  // One function decides how the chip looks; every actor cell goes through it,
  // so the feed, the ref-lookup timeline and the id-lookup table cannot
  // disagree about the same row's actor.
  assert.ok(app.includes("function actorKindChip("), "one place decides how the actor-kind label looks");
  assert.ok(app.includes("function actorCell("), "one place wires the label onto an actor cell");
  const actorCellCalls = app.match(/actorCell\(/g) || [];
  // The function definition itself, plus every call site (feed, ref-lookup
  // timeline, id-lookup table) — a regression that quietly reverted one of
  // them back to a bare textCell(x.actor) must fail this count.
  assert.ok(actorCellCalls.length >= 4, "actorCell must be both defined and called at every actor rendering site");

  // The drill-down summary and the human-decision facts also say what kind of
  // value the actor is — not just the wide feed table.
  assert.ok(app.includes("actorKindChip(d.actorKind)"), "the drill-down summary must label the actor's kind too");
  assert.ok(app.includes("ACTOR_KIND_CHIP_TEXT[d.actorKind.code]"), "the human-decision facts must label the actor's kind too");

  assert.ok(css.includes(".actor-kind-chip"), "the label needs its own quiet styling, not a raw span");
});

test("the reason renders its plain words WITHOUT losing the slug", () => {
  const app = readAsset("app.js");
  const html = readAsset("index.html");
  const css = readAsset("style.css");

  assert.ok(app.includes("function reasonCell("), "one place decides how a reason looks");
  // The slug survives. It is the string in audit_log, in the metrics exception
  // ranking and in the n8n ports — what a person greps and what the filter
  // matches — so prose may accompany it and may never replace it.
  assert.ok(/el\("span", "reason-slug", String\(row\.reason\)\)/.test(app), "the raw slug is always rendered");
  assert.ok(app.includes("meaning.means"), "the engine's own sentence renders beside it");
  assert.ok(html.includes('id="drill-reason-slug"') && html.includes('id="drill-reason-means"'));
  // Nothing is invented when there is nothing to say.
  assert.ok(/if \(!d\.reason \|\| !meaning \|\| !meaning\.means\)/.test(app), "no meaning means no block, not a placeholder");
  // Long prose in a table row is clamped, not truncated server-side: the whole
  // sentence stays on the title and in the drill-down.
  assert.ok(/\.reason-means \{[^}]*line-clamp/.test(css), "the feed's prose is clamped so one row is not ten rows tall");

  // The page holds no reason vocabulary of its own — naming one slug here would
  // be a second, silently-drifting copy of a policy engine's GATE_SEQUENCE.
  for (const slug of ["over_policy_cap", "sanctioned_region", "no_matching_notice_bracket", "all_gates_passed"]) {
    assert.ok(!app.includes(slug), `app.js names "${slug}" — the meaning must come from the API, not the browser`);
  }
});

test("the three kinds are the SERVER's — the page spells them, it does not decide them", () => {
  const app = readAsset("app.js");
  // One map, kind -> word + class. Same division of labour as DECISION_DOT.
  assert.ok(/var KIND_LABEL = \{/.test(app), "the kind vocabulary is one map, not scattered ternaries");
  for (const word of ["Decision", "Execution", "Follow-up event"]) {
    assert.ok(app.includes(`"${word}"`), `the page must be able to render "${word}"`);
  }
  // Classification is the store's judgement about the writers. Naming an ACTION
  // here would be a second, silently-drifting copy of EXECUTION_ACTIONS.
  for (const action of ["expense_approved_write", "workation_executed", "amendment_executed", "adjustment_executed"]) {
    assert.ok(!app.includes(action), `app.js names "${action}" — the kind must come from the API, not from the browser`);
  }
  assert.ok(!/kind\s*===\s*"execution"/.test(app), "the page must not branch on a kind value");
});

test("the trace verdict is rendered, never re-derived", () => {
  const app = readAsset("app.js");
  assert.ok(app.includes("payload.traceVerdict"), "the page renders the server's verdict object");
  assert.ok(/verdict\.headline/.test(app) && /verdict\.detail/.test(app), "in the server's own words");
  // The page must not decide WHY a table is empty; that is a judgement.
  assert.ok(!/rule_based_fallback/.test(app), "no source-tag reasoning in the browser");
  assert.ok(!/predates/.test(app), "no tracing-era reasoning in the browser");
});

test("the assets are addressed relatively, so the page works under /audit on the deployment", () => {
  const html = readAsset("index.html");
  assert.ok(!/(?:src|href)="\/[^"]*"/.test(html), "index.html must not load assets by absolute path");
  assert.ok(html.includes('href="remote-ui.css"'), "the shared design system is linked relatively");
});

test("a mounted page gets a <base> tag, so those relative URLs resolve under the prefix", () => {
  const html = withBaseHref("<head></head>", "/audit");
  assert.ok(html.includes('<base href="/audit/" />'));
  assert.equal(withBaseHref("<head></head>", ""), "<head></head>", "unmounted pages are untouched");
});

test("the seeded dataset is deterministic for a fixed clock", () => {
  const a = buildDemoDataset(NOW);
  const b = buildDemoDataset(NOW);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// THE LEDGER KEY MOVED, AND THE BUG-AUDIT TAB SEARCHES BY THE NUMBER ON THE
// TICKET (2026-08-31). src/shared/claimRef.js qualifies a bare Zendesk ticket
// number with the account that minted it, because a bare number named two
// unrelated tickets after the second account move. Old rows keep the bare
// spelling. A human typing `93` means "the ticket in front of me", and on this
// screen an absent claim row is read as "the exactly-once ledger did not
// protect this ticket" — so answering with one spelling would be a confident
// wrong answer, not a near miss.
// ---------------------------------------------------------------------------
test("lookupRef finds a claim filed under the ACCOUNT-QUALIFIED key from the bare number", async () => {
  const store = seededStore();
  // Rewrite the seeded ticket-#5 claim to the shape a run today writes.
  const claim = store.demo.workflowClaims.find((c) => c.externalRef === "5");
  assert.ok(claim, "the seed must carry ticket #5's claim for this test to mean anything");
  claim.externalRef = "your-subdomainhelp:5";

  const result = await store.lookupRef("5");
  assert.equal(result.claims.length, 1, "the bare number a reader holds must still find the qualified row");
  assert.equal(result.claims[0].externalRef, "your-subdomainhelp:5");

  // And the qualified spelling works typed in directly — the reader may be
  // copying it out of the ledger rather than off the ticket.
  const direct = await store.lookupRef("your-subdomainhelp:5");
  assert.equal(direct.claims.length, 1);
});

test("lookupRef still finds a claim filed under the BARE key — old rows keep working", async () => {
  const result = await seededStore().lookupRef("5");
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].externalRef, "5");
});

test("widening the claim search does not widen the DECISION search", async () => {
  // Only the claim node's key changed. `audit_log.details.externalRef` still
  // carries the bare ticket number, and matching a qualified spelling there
  // would imply the audit trail had moved too — it has not.
  const decisions = (await seededStore().lookupRef("your-subdomainhelp:5")).decisions;
  assert.deepEqual(decisions, [], "no audit_log row is keyed by a qualified ref");
});
