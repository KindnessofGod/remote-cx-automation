// ---------------------------------------------------------------------------
// auditViewLookup.test.js — the viewer's one lookup box, and what an empty
// answer is allowed to mean
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS. On 2026-08-19 a request went through the portal, was
// decided, and was recorded. The portal reported `uc04-20260819205605-2hnba`
// and told the requester, in bold, that it was "the id that ties every record
// of this request together". They pasted it into this viewer and got nothing.
// The decision was in `audit_log` the whole time, under `externalRef "50"` —
// the ticket the UC-03 travel request had been handed on from.
//
// An empty result read as "the decision was never recorded". The truth was
// "recorded under a different key". Those are opposite conclusions and the
// page presented the alarming one silently.
//
// THE FIXTURE IS THE REAL CHAIN, id for id. Every value below was read out of
// production Supabase (project your-project-ref) on 2026-08-19 with the
// Supabase MCP, not invented and not copied from the code that writes it —
// this repo's signature defect is fixtures agreeing with code while neither
// matches the store (BUILD-LOG §3.30), and a lookup test built from the
// writer's own vocabulary would reproduce exactly that.
//
// The counts each identifier really returns against production, verified with
// the same predicates the store generates:
//
//   "50"                                    3 audit_log · 1 claim
//   "uc03-20260819205307-1psu2"             1 audit_log · 1 claim
//   "7379b68f-…" (uc03CaseId)               3 audit_log   ← the whole hand-off
//   "a8904da0-…" (authorizationId)          2 audit_log
//   "8ab12460-…" (employmentId)            40 audit_log   ← a PERSON, not a request
//   "6e5b0269-…" (the audit row's own id)   1 audit_log
//   "uc04-20260819205605-2hnba"             0 everywhere  ← the id shown on screen
//
// The last line is the whole point: the id the requester was handed reaches
// nothing, and the viewer must say what that does and does not prove.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";

import { AuditReadStore } from "../src/auditview/readStore.js";
import { createAuditViewHandler } from "../src/auditview/server.js";
import { identifierVerdict } from "../src/auditview/identifierVerdict.js";
import {
  AUDIT_LOG_DETAIL_KEYS,
  AUDIT_TRACE_DETAIL_KEYS,
  IDENTIFIER_TARGETS,
  NOT_SEARCHABLE_HERE,
  SAFE_JSON_KEY,
  classifyIdentifier,
  searchedLabels,
} from "../src/auditview/identifiers.js";
import { portalAccessPosture, PORTAL_KEY_HEADER, PORTAL_KEY_ENV, OPEN_ACCESS } from "../src/portal/access.js";

// --- the real chain, as it sits in production --------------------------------

const REAL = {
  ticketRef: "50",
  uc03PortalRef: "uc03-20260819205307-1psu2",
  portalRefShownToTheUser: "uc04-20260819205605-2hnba",
  uc03CaseId: "7379b68f-8609-4ff3-b9dd-96f5e4d365c9",
  authorizationId: "a8904da0-71d7-4321-b5d1-de2a68d298c7",
  employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
  uc03RowId: "4775ba1c-00ef-40d0-8720-4a5ec95aa9ee",
  uc03LinkRowId: "9f5cc708-0ccd-4e19-ab2e-4884a2bae52e",
  uc04BlockedRowId: "6e5b0269-e074-4ec4-b2d2-b18d5d63683e",
  uc04LinkRowId: "a564562a-2f8c-4952-a4d0-e642ba8e6bba",
  traceRowId: "44444444-4444-4444-8444-444444444401",
  executionId: "4973",
  workflowId: "WORKFLOW_UC04_ID",
  alertId: "55555555-5555-4555-8555-555555555501",
};

function realChainStore() {
  return new AuditReadStore({
    seedData: {
      auditLog: [
        {
          id: REAL.uc03RowId,
          at: "2026-08-19T20:53:08.711Z",
          useCase: "UC-03",
          action: "route_to_uc04",
          actor: REAL.employmentId,
          riskTier: "low",
          details: {
            externalRef: REAL.uc03PortalRef,
            caseId: REAL.uc03CaseId,
            employmentId: REAL.employmentId,
            reason: "route_to_uc04",
          },
        },
        {
          id: REAL.uc03LinkRowId,
          at: "2026-08-19T20:54:00.659Z",
          useCase: "UC-03",
          action: "uc03_continuation_requested",
          actor: REAL.employmentId,
          riskTier: "low",
          details: { externalRef: REAL.ticketRef, uc03CaseId: REAL.uc03CaseId },
        },
        {
          id: REAL.uc04BlockedRowId,
          at: "2026-08-19T20:56:07.462Z",
          useCase: "UC-04",
          action: "blocked",
          actor: "admin_jane",
          riskTier: "high",
          details: {
            externalRef: REAL.ticketRef,
            employmentId: REAL.employmentId,
            authorizationId: REAL.authorizationId,
            reason: "factors_invalid",
            source: "portal",
            uc04Reason: "factors_invalid",
          },
        },
        {
          id: REAL.uc04LinkRowId,
          at: "2026-08-19T20:56:07.463Z",
          useCase: "UC-04",
          action: "uc03_continuation_linked",
          actor: "admin_jane",
          riskTier: "medium",
          details: {
            externalRef: REAL.ticketRef,
            employmentId: REAL.employmentId,
            uc03CaseId: REAL.uc03CaseId,
            uc04AuthorizationId: REAL.authorizationId,
            reason: "uc03_continuation_linked",
          },
        },
      ],
      auditTrace: [
        {
          id: REAL.traceRowId,
          at: "2026-08-19T20:56:07.100Z",
          parentId: REAL.uc04BlockedRowId,
          call: "remote.employment",
          attempt: 1,
          ok: true,
          error: null,
          details: {
            externalRef: REAL.ticketRef,
            executionId: REAL.executionId,
            workflowId: REAL.workflowId,
            source: "n8n",
          },
        },
      ],
      workflowClaims: [
        { useCase: "UC-03", externalRef: REAL.uc03PortalRef, claimedAt: "2026-08-19T20:53:07.900Z", decision: "route_to_uc04", note: null },
        { useCase: "UC-04", externalRef: REAL.ticketRef, claimedAt: "2026-08-19T20:56:07.405Z", decision: "blocked", note: null },
      ],
      opsAlerts: [
        {
          id: REAL.alertId,
          at: "2026-08-19T20:56:10.000Z",
          useCase: "UC-04",
          workflowName: "UC-04 — Work Authorization",
          workflowId: REAL.workflowId,
          executionId: REAL.executionId,
          executionUrl: "https://n8n.example.invalid/execution/" + REAL.executionId,
          failedNode: "Update Ticket",
          riskTier: "high",
          errorMessage: "Zendesk update failed",
          auditDurable: true,
          acknowledged: false,
        },
      ],
    },
  });
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(payload) {
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

async function call(handler, req) {
  const res = fakeRes();
  await handler(req, res);
  return { res, json: res.body ? JSON.parse(res.body) : null };
}

/** A pg.Pool double that records SQL and answers nothing. */
function recordingPool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

// --- 1. THE HEADLINE: every id the request carries reaches it -----------------

test("CRITICAL: the row is findable by EVERY identifier it carries, not just the reference", async () => {
  const store = realChainStore();

  // Each entry: the id a person could plausibly be holding → the field the
  // viewer must match it on. Before this lookup existed, only the first two
  // reached anything at all, and only through /api/refs.
  const cases = [
    [REAL.ticketRef, "externalRef", REAL.uc04BlockedRowId],
    [REAL.uc03PortalRef, "externalRef", REAL.uc03RowId],
    [REAL.uc03CaseId, "caseId", REAL.uc03RowId],
    [REAL.authorizationId, "authorizationId", REAL.uc04BlockedRowId],
    [REAL.employmentId, "employmentId", REAL.uc04BlockedRowId],
    [REAL.uc04BlockedRowId, "id", REAL.uc04BlockedRowId],
  ];

  for (const [value, expectedField, mustReach] of cases) {
    const found = await store.lookupIdentifier(value);
    const ids = found.decisions.map((d) => d.id);
    assert.ok(ids.includes(mustReach), `${value} must reach audit_log row ${mustReach}`);
    const fields = found.decisions.flatMap((d) => d.matchedOn);
    assert.ok(fields.includes(expectedField), `${value} must report matching on ${expectedField}`);
    assert.equal(identifierVerdict(found).code, "found", `${value} must be a found verdict`);
  }
});

test("the hand-off id reaches BOTH use cases — the one identifier that spans the whole request", async () => {
  // Live, this is the single most useful id for this request and the one
  // nothing in the viewer could search: UC-03 carries it as `caseId`, UC-04's
  // continuation row carries it as `uc03CaseId`, and the ticket reference
  // reaches only the UC-04 half.
  const found = await realChainStore().lookupIdentifier(REAL.uc03CaseId);
  assert.deepEqual([...new Set(found.decisions.map((d) => d.useCase))].sort(), ["UC-03", "UC-04"]);
  assert.deepEqual(
    [...new Set(found.decisions.flatMap((d) => d.matchedOn))].sort(),
    ["caseId", "uc03CaseId"],
    "and it says which field carried it on each side"
  );
});

test("a trace attempt, a claim and an ops alert are reachable by their own ids too", async () => {
  const store = realChainStore();

  const byExecution = await store.lookupIdentifier(REAL.executionId);
  assert.equal(byExecution.traces.length, 1, "an n8n execution id reaches the attempts it produced");
  assert.equal(byExecution.alerts.length, 1, "…and the ops alert raised for that run");
  assert.deepEqual(byExecution.traces[0].matchedOn, ["executionId"]);

  const byParent = await store.lookupIdentifier(REAL.uc04BlockedRowId);
  assert.deepEqual(byParent.traces[0].matchedOn, ["parent_id"], "a decision id reaches its own attempts");

  const byRef = await store.lookupIdentifier(REAL.ticketRef);
  assert.equal(byRef.claims.length, 1, "the exactly-once ledger is searched by the same box");
});

// --- 2. THE ID THE USER WAS ACTUALLY SHOWN ------------------------------------

test("CRITICAL: the reference the portal displayed reaches nothing — and the answer says so honestly", async () => {
  // Verified against production 2026-08-19: this string appears in no table.
  // The write side owns whether it ever will; the read side owns never letting
  // its absence read as "the decision was never recorded".
  const found = await realChainStore().lookupIdentifier(REAL.portalRefShownToTheUser);
  const verdict = identifierVerdict(found);

  assert.equal(verdict.code, "not_found");
  assert.equal(found.shape.code, "portal_reference", "the shape is recognised even though nothing carries it");

  const whole = `${verdict.headline} ${verdict.detail} ${verdict.notes.join(" ")}`;
  assert.ok(
    /handed on|originating|DIFFERENT reference/i.test(verdict.detail),
    "it must name the hand-off reading — the one that actually happened here"
  );
  assert.ok(
    /gap in the writer|not evidence that nothing happened/i.test(whole),
    "and must say plainly that this is not evidence the request was not processed"
  );
  assert.ok(
    !/never (recorded|processed|happened)\.|no such request/i.test(whole),
    "it must never assert the request does not exist"
  );
  assert.ok(
    verdict.nextSteps.some((s) => /ORIGINAL request|ticket id/i.test(s)),
    "and must point at the id that WOULD reach it"
  );
});

test("an empty answer names what it searched AND what it cannot see — the two must not be confused", async () => {
  const found = await realChainStore().lookupIdentifier("something-nobody-ever-wrote");
  const verdict = identifierVerdict(found);

  assert.equal(verdict.code, "not_found");
  assert.equal(found.shape.code, "unknown");
  assert.ok(
    /CANNOT TELL/i.test(verdict.detail),
    "for an unrecognised shape the honest answer is that the viewer cannot tell which kind of miss this is"
  );
  assert.ok(verdict.searchedCount > 15, "it must be able to say how many places it looked");
  assert.equal(found.searched.length, verdict.searchedCount);
  assert.ok(found.notSearchableHere.length >= 3, "and must name the places it structurally cannot look");
  for (const item of found.notSearchableHere) {
    assert.ok(item.what && item.why && item.where, "each boundary names what, why, and where to look instead");
  }
});

test("the searched list is GENERATED from the same registry the queries are, never restated", () => {
  // The failure this stops is a viewer that claims to have searched somewhere
  // it does not — which is worse than not searching there, because the reader
  // then trusts the miss.
  const pool = recordingPool();
  const labels = searchedLabels(REAL.uc03CaseId);
  assert.equal(labels.length, IDENTIFIER_TARGETS.length, "a uuid is tried against every target");
  assert.ok(
    searchedLabels("50").length < IDENTIFIER_TARGETS.length,
    "a non-uuid skips the uuid-only columns, and says so by omitting them"
  );
  return new AuditReadStore({ pgPool: pool })
    .lookupIdentifier(REAL.uc03CaseId)
    .then((result) => {
      const sql = pool.calls.map((c) => c.sql).join("\n");
      for (const target of result.searched) {
        const [, , key] = target.target.split(".");
        if (key) assert.ok(sql.includes(`'${key}'`), `claimed to search ${target.target}; SQL must contain it`);
      }
    });
});

// --- 3. found, but not necessarily THIS request -------------------------------

test("an employment-id-only match is labelled as a PERSON's history, not one request's", async () => {
  const store = new AuditReadStore({
    seedData: {
      auditLog: [
        {
          id: REAL.uc04BlockedRowId,
          at: "2026-08-19T20:56:07.462Z",
          useCase: "UC-04",
          action: "blocked",
          actor: "admin_jane",
          riskTier: "high",
          details: { employmentId: REAL.employmentId, reason: "factors_invalid" },
        },
      ],
      auditTrace: [],
      workflowClaims: [],
      opsAlerts: [],
    },
  });
  const verdict = identifierVerdict(await store.lookupIdentifier(REAL.employmentId));
  assert.equal(verdict.code, "found");
  assert.ok(
    verdict.notes.some((n) => /identifies a person rather than a request/i.test(n)),
    "40 rows for an employee is not a trace of one request, and the page must not let it read as one"
  );
});

test("every row says WHICH field matched — 'found' without 'found where' is not an answer", async () => {
  const found = await realChainStore().lookupIdentifier(REAL.employmentId);
  for (const row of found.decisions) {
    assert.ok(Array.isArray(row.matchedOn) && row.matchedOn.length > 0, `${row.id} must name its matched field`);
  }
});

// --- 4. the exhaustive pass, and why it is rare -------------------------------

test("a value under an UNREGISTERED key is found and reported as exactly that", async () => {
  // `uc04Reason` is a real key on a real UC-04 row and is deliberately not an
  // identifier, so nothing in the registry searches it. The exhaustive pass
  // must still find the value and must NOT claim it is this request's id.
  const found = await realChainStore().lookupIdentifier("factors_invalid");
  assert.equal(found.exhaustiveScanRan, true, "the fallback runs only because the registry missed");
  const keys = found.unregistered.map((u) => u.key).sort();
  assert.ok(keys.includes("uc04Reason"), "the key is named");
  assert.ok(keys.includes("reason"), "so is every other key holding that value");

  const verdict = identifierVerdict(found);
  assert.equal(verdict.code, "found_under_unregistered_key");
  assert.ok(!/this is your request|is your record/i.test(verdict.detail), "it reports a value, never asserts a record");
  assert.ok(/row count/i.test(verdict.detail), "and hands the reader what they need to judge it");
});

// rca-nr4i / D-24. "An entry states the case continues as ticket 117; tracing
// 117 returns ⚠ This value IS in the trail — but under a key this viewer does
// not index as an identifier." `ticketId` — the field
// src/portal/server.js's recordTicketRelink() writes on a `portal_reference_
// relinked` row (rca-v07y) — IS in AUDIT_LOG_DETAIL_KEYS, so the ordinary
// (registered) path must find a ticket id, not fall through to the
// exhaustive per-key scan and report it as unindexed.
test("D-24: a relink row's ticketId is found by the ORDINARY path, not the unregistered-key fallback", async () => {
  const relinkRowId = "d24-relink-row-0001";
  const store = new AuditReadStore({
    seedData: {
      auditLog: [
        {
          id: relinkRowId,
          at: "2026-08-22T18:33:15.000Z",
          useCase: "UC-03",
          action: "portal_reference_relinked",
          actor: REAL.employmentId,
          riskTier: "low",
          details: {
            note: "This request was submitted under reference uc03-20260822183304-17ytb and handed to a human as Zendesk ticket 117.",
            reason: "portal_reference_relinked",
            source: "portal",
            typeId: "uc03",
            recordId: "5e346d7c-6aab-4cfd-9b08-99a59941297b",
            ticketId: "117",
            externalRef: "uc03-20260822183304-17ytb",
            recordedRef: "117",
          },
        },
      ],
      auditTrace: [],
      workflowClaims: [],
      opsAlerts: [],
    },
  });

  const found = await store.lookupIdentifier("117");
  assert.equal(found.exhaustiveScanRan, false, "ticketId is a registered key — the ordinary probes must hit it");
  assert.ok(
    found.decisions.some((d) => d.id === relinkRowId),
    "the relink row must come back from the ordinary lookup"
  );
  const row = found.decisions.find((d) => d.id === relinkRowId);
  assert.ok(row.matchedOn.includes("ticketId"), `expected "ticketId" in matchedOn, got ${JSON.stringify(row.matchedOn)}`);

  const verdict = identifierVerdict(found);
  assert.equal(verdict.code, "found", "a registered-key hit is an ordinary find, not a reported gap");
});

test("the exhaustive scan runs ONLY on a miss — the cost is paid where it buys something", async () => {
  const store = realChainStore();
  assert.equal((await store.lookupIdentifier(REAL.ticketRef)).exhaustiveScanRan, false, "a hit never pays for it");
  assert.equal((await store.lookupIdentifier("nothing-here")).exhaustiveScanRan, true, "a miss does");

  // The same rule on the SQL path, where it actually costs: five statements on
  // a miss, four on a hit.
  const pool = recordingPool();
  await new AuditReadStore({ pgPool: pool }).lookupIdentifier("nothing-here");
  assert.equal(pool.calls.length, 5, "four registry probes plus the one fallback");
  assert.ok(
    pool.calls[4].sql.includes("jsonb_each_text"),
    "and the fallback is the last statement, not one of the four"
  );
});

// --- 5. injection, and the shape of the SQL ------------------------------------

test("CRITICAL: the searched value is a PARAMETER — it never appears in the SQL text", async () => {
  const pool = recordingPool();
  const nasty = "'; drop table audit_log; --";
  await new AuditReadStore({ pgPool: pool }).lookupIdentifier(nasty);
  assert.ok(pool.calls.length >= 4);
  for (const c of pool.calls) {
    assert.ok(!c.sql.includes(nasty), "the value must not be interpolated into any statement");
    assert.ok(!c.sql.includes("drop table"), "…in any form");
    assert.equal(c.params[0], nasty, "it travels as $1");
  }
});

test("every JSON key placed in SQL is a constant of a shape that cannot be anything else", () => {
  // The keys are module constants, never input — but a constant that LOOKS
  // like input is a habit worth not having on a public surface reading a table
  // whose whole value is being untampered-with.
  for (const k of [...AUDIT_LOG_DETAIL_KEYS, ...AUDIT_TRACE_DETAIL_KEYS]) {
    assert.match(k.key, SAFE_JSON_KEY, `${k.key} must be a bare identifier`);
    assert.ok(k.label && typeof k.rows === "number", `${k.key} must carry its label and its live row count`);
  }
});

test("a non-uuid value never reaches a uuid column — a cast error is not an answer", async () => {
  const pool = recordingPool();
  await new AuditReadStore({ pgPool: pool }).lookupIdentifier("50");
  for (const c of pool.calls) {
    if (c.params.length >= 2 && c.sql.includes("::uuid")) {
      assert.equal(c.params[1], null, "the uuid parameter is null, so the predicate is simply false");
    }
  }
});

// --- 6. the HTTP surface, and the two rules it must not break ------------------

test("GET /api/lookup/:value answers, and carries the verdict the page renders verbatim", async () => {
  const handler = createAuditViewHandler({ store: realChainStore(), access: OPEN_ACCESS });
  const { res, json } = await call(handler, fakeReq("GET", `/api/lookup/${REAL.uc03CaseId}`));
  assert.equal(res.statusCode, 200);
  assert.equal(json.identifierVerdict.code, "found");
  assert.equal(json.decisions.length, 3);
  assert.ok(json.searched.length > 0 && json.notSearchableHere.length > 0);
});

test("a value that IS an external reference gets the reference view composed in beside it", async () => {
  const handler = createAuditViewHandler({ store: realChainStore(), access: OPEN_ACCESS });
  const { json } = await call(handler, fakeReq("GET", `/api/lookup/${REAL.ticketRef}`));
  assert.ok(json.reference, "the claims/timeline/alert-window view still renders for a reference");
  assert.equal(json.reference.refVerdict.code, "traced");
  assert.equal(json.reference.claims.length, 1);

  // And it is the SAME payload /api/refs builds — one composition, so the two
  // routes cannot come to disagree about one reference.
  const direct = await call(handler, fakeReq("GET", `/api/refs/${REAL.ticketRef}`));
  assert.deepEqual(json.reference.refVerdict, direct.json.refVerdict);
  assert.deepEqual(json.reference.duplicateDeliveries, direct.json.duplicateDeliveries);
});

test("a value that is NOT a reference carries no reference view — nothing is fabricated to fill the panel", async () => {
  const handler = createAuditViewHandler({ store: realChainStore(), access: OPEN_ACCESS });
  const { json } = await call(handler, fakeReq("GET", `/api/lookup/${REAL.authorizationId}`));
  assert.equal(json.reference, null, "an empty reference view is not rendered as a plausible-looking shell");
  assert.equal(json.identifierVerdict.code, "found");
});

test("STRUCTURAL: the lookup adds a read, not a write — every write-shaped request still 404s", async () => {
  const handler = createAuditViewHandler({ store: realChainStore(), access: OPEN_ACCESS });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const { res, json } = await call(handler, fakeReq(method, "/api/lookup/50"));
    assert.equal(res.statusCode, 404, `${method} /api/lookup`);
    assert.equal(json.code, "no_such_route");
  }
});

test("the lookup is behind the SAME shared-key gate as every other read", async () => {
  const KEY = "audit-viewer-test-key";
  const handler = createAuditViewHandler({
    store: realChainStore(),
    access: portalAccessPosture({ [PORTAL_KEY_ENV]: KEY }, { persistent: true }),
  });
  const refused = await call(handler, fakeReq("GET", "/api/lookup/50"));
  assert.equal(refused.res.statusCode, 401);
  assert.equal(refused.json.code, "portal_access_key_required");

  const allowed = await call(handler, fakeReq("GET", "/api/lookup/50", { headers: { [PORTAL_KEY_HEADER]: KEY } }));
  assert.equal(allowed.res.statusCode, 200, "a gate that refuses everything proves nothing");
});

test("a store failure on the lookup is a 500 that RENDERS — never a 200 with an empty result", async () => {
  // The failure mode this exists to stop is the exact one the whole fix is
  // about, one layer down: an outage rendering as "nothing carries this id".
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
  const { res, json } = await call(handler, fakeReq("GET", "/api/lookup/50"));
  assert.equal(res.statusCode, 500);
  assert.equal(json.code, "audit_read_failed");
  assert.ok(json.reason.includes("supabase is down"));
});

// --- 7. the advice the reference verdict gives is advice this page can honour --

test("the feed's free-text filter matches the RECORD id, because refVerdict tells readers it does", async () => {
  // `claimed_not_audited` sends a reader to the record id. Until the feed
  // matched it, that instruction pointed at something the page could not do —
  // and advice a surface cannot honour is worse than no advice.
  const rows = (await realChainStore().listDecisions({ q: REAL.uc03CaseId })).decisions;
  assert.ok(rows.length >= 1, "the record id must be reachable from the feed filter too");
  assert.ok(rows.every((r) => r.useCase === "UC-03" || r.useCase === "UC-04"));
});

// --- 8. the shape reading, and its limits -------------------------------------

test("shape classification informs the answer and never decides where to search", () => {
  assert.equal(classifyIdentifier(REAL.portalRefShownToTheUser).code, "portal_reference");
  assert.equal(classifyIdentifier(REAL.uc03CaseId).code, "uuid");
  assert.equal(classifyIdentifier("50").code, "ticket_number");
  assert.equal(classifyIdentifier("claim-proof-uc07-a").code, "unknown");
  assert.equal(classifyIdentifier("").code, "empty");

  // Live history really does hold free-form references like that one, so an
  // unrecognised shape must still be searched everywhere a recognised one is —
  // minus only the uuid columns, which cannot hold it.
  const free = searchedLabels("claim-proof-uc07-a").map((t) => t.target);
  const uuidish = searchedLabels(REAL.uc03CaseId).map((t) => t.target);
  assert.ok(free.length > 0);
  assert.deepEqual(
    uuidish.filter((t) => !free.includes(t)).sort(),
    ["audit_log.id", "audit_trace.id", "audit_trace.parent_id", "ops_alerts.id"],
    "the only difference is the columns a non-uuid cannot possibly be in"
  );
});

test("an empty needle costs no queries and says what to type", async () => {
  const pool = recordingPool();
  const result = await new AuditReadStore({ pgPool: pool }).lookupIdentifier("   ");
  assert.equal(pool.calls.length, 0, "`where actor = ''` is a real scan for a useless answer");
  assert.equal(identifierVerdict(result).code, "empty");
});

// --- 9. the page renders the server's words and derives none of its own --------

test("the page renders the verdict and re-derives nothing about it", () => {
  const app = readFileSync(new URL("../src/auditview/assets/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("identifierVerdict"), "the page renders the server's verdict field");
  assert.ok(app.includes("matchedOn"), "…and the server's per-row matched field");
  assert.ok(app.includes("notSearchableHere"), "…and the boundary of the search");
  // The same rule the rest of this surface follows: no second, drifting copy
  // of a judgement in the browser.
  assert.ok(!/not_found|found_under_unregistered_key/.test(app), "the page must not branch on verdict codes");
  assert.ok(!/\.innerHTML\s*=/.test(app), "audit values are text people typed");
});

test("the lookup box says it takes ANY id — a capability nothing announces may as well not exist", () => {
  const html = readFileSync(new URL("../src/auditview/assets/index.html", import.meta.url), "utf8");
  assert.ok(/Paste any id this request carries/i.test(html));
  assert.ok(/employment id/i.test(html) && /record id/i.test(html) && /execution id/i.test(html));
  assert.ok(html.includes('id="lookup-searched"'), "and it shows where it looked");
  assert.ok(html.includes('id="lookup-unsearchable"'), "and where it cannot");
});

test("NOT_SEARCHABLE_HERE names the use-case record tables the viewer deliberately does not read", () => {
  const text = NOT_SEARCHABLE_HERE.map((n) => `${n.what} ${n.why} ${n.where}`).join(" ");
  for (const table of ["uc02_expenses", "uc04_authorizations", "uc06_amendments", "uc09_adjustments"]) {
    assert.ok(text.includes(table), `${table} is a real place an id can live and this viewer does not read it`);
  }
});
