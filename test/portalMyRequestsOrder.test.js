// ---------------------------------------------------------------------------
// portalMyRequestsOrder.test.js — "My requests" is ONE history, newest first.
//
// FOUND IN PRODUCTION, 2026-08-30. A requester declined a UC-02 expense claim
// in the ZAF sidebar, went to "My requests" to see the effect, and reported
// seeing nothing. The decline had landed perfectly — `status: "declined"`,
// `reviewNote: "Sorry "`, written 06:13:42 — and the row was served by the API.
// It was row **44 of 68**. The list arrived grouped by request TYPE (25 UC-03,
// then 18 UC-01, then 25 UC-02), so the top of the page was a UC-03 from four
// days earlier and the thing that had just happened was two screens down.
//
// src/portal/server.js has sorted this list since fe00bc7 and the deployment
// runs that code. So the sort is not missing — it is INEFFECTIVE, and nothing
// in the suite could tell: every existing my-requests test reads
// `requests[0]` after filing exactly one request, where any order is the
// right order.
//
// This file states the property those tests cannot: with requests of several
// types filed at interleaved times, position 1 is the most recent thing that
// happened, whatever type it is.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPortalHandler } from "../src/portal/server.js";

/** A store that answers only what this route asks of it. */
function fakeStore(rows) {
  return {
    async listByOwner() {
      return rows;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

function call(handler, path) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: path,
      headers: {},
      on(event, cb) {
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

// Chris Lee's real Sandbox employment id — the same one the portal persona
// carries, so ownerScopeFor() scopes these rows to that session.
const EMP = "8ab12460-b568-4c1e-af9d-09b1fabd8f46";

const row = (id, createdAt, extra = {}) => ({
  id,
  employmentId: EMP,
  externalRef: id,
  createdAt,
  source: "portal",
  status: "pending_review",
  decision: "human_review",
  reason: "over_policy_cap",
  flags: [],
  ...extra,
});

/**
 * Deliberately INTERLEAVED across types and, within each type, NOT already in
 * order. A fixture that is accidentally sorted cannot fail.
 */
function interleavedStores() {
  return {
    uc02: fakeStore([
      row("uc02-newest", "2026-08-30T06:12:28.379Z"),
      row("uc02-oldest", "2026-08-01T09:00:00.000Z"),
    ]),
    uc03: fakeStore([
      row("uc03-middle", "2026-08-26T14:56:05.144Z", { decision: "auto_resolve", status: "resolved" }),
      row("uc03-second", "2026-08-27T19:23:54.021Z", { decision: "auto_resolve", status: "resolved" }),
    ]),
  };
}

const handlerFor = (stores) => createPortalHandler({ remote: null, audit: null, stores });

test("position 1 is the most recent request, whatever TYPE it is", async () => {
  const { body, status } = await call(handlerFor(interleavedStores()), "/api/my-requests?persona=chris");
  assert.equal(status, 200);
  const ids = body.requests.map((r) => r.recordId);
  assert.equal(
    ids[0],
    "uc02-newest",
    `expected the newest request first, got this order: ${ids.join(", ")}`
  );
});

test("the whole list is one history, not per-type queues concatenated", async () => {
  const { body } = await call(handlerFor(interleavedStores()), "/api/my-requests?persona=chris");
  const times = body.requests.map((r) => r.submittedAt);
  const sorted = [...times].sort().reverse();
  assert.deepEqual(times, sorted, `not newest-first: ${times.join(" | ")}`);
});

test("every row carries the submittedAt the order depends on", async () => {
  // The order is only as good as the field it sorts by. A row with a null here
  // sinks to the bottom silently, which is the same invisibility this file
  // exists to stop.
  const { body } = await call(handlerFor(interleavedStores()), "/api/my-requests?persona=chris");
  assert.ok(body.requests.length > 0);
  for (const request of body.requests) {
    assert.ok(request.submittedAt, `${request.recordId} has no submittedAt`);
  }
});

// ---------------------------------------------------------------------------
// THE COMPARATOR ITSELF.
//
// The three tests above assert the ORDER, and on this container they passed
// against the broken `localeCompare` version too — which is precisely why the
// defect reached production. An order test can only see the comparator through
// the runtime it happens to be running on. These test the comparator directly,
// so a return value of 0 for two different instants fails here regardless of
// which Node, which ICU build, or which locale is in play.
// ---------------------------------------------------------------------------
import { byNewestFirst } from "../src/portal/server.js";

const at = (submittedAt, recordId = "r") => ({ submittedAt, recordId });

test("the comparator never collapses two different instants to 0", () => {
  const older = at("2026-08-26T14:56:05.144Z", "a");
  const newer = at("2026-08-30T06:12:28.379Z", "b");
  assert.ok(byNewestFirst(newer, older) < 0, "the newer row must sort first");
  assert.ok(byNewestFirst(older, newer) > 0, "the older row must sort second");
  assert.notEqual(byNewestFirst(newer, older), 0, "a zero here is the production bug");
});

test("it is antisymmetric and total, so a re-read never reshuffles", () => {
  const rows = [
    at("2026-08-30T06:12:28.379Z", "b"),
    at("2026-08-26T14:56:05.144Z", "a"),
    at("2026-08-26T14:56:05.144Z", "c"), // identical instant, different record
  ];
  const once = [...rows].sort(byNewestFirst).map((r) => r.recordId);
  const twice = [...rows].reverse().sort(byNewestFirst).map((r) => r.recordId);
  assert.deepEqual(once, twice, "the same set must order the same way from any starting order");
  assert.deepEqual(once, ["b", "a", "c"]);
});

test("the same instant written with a different offset compares equal", () => {
  // What Date.parse buys over comparing strings: 06:12Z and 08:12+02:00 are
  // the same moment, and a string comparison would put them hours apart.
  assert.equal(byNewestFirst(at("2026-08-30T06:12:28.379Z", "x"), at("2026-08-30T08:12:28.379+02:00", "x")), 0);
});

test("an unreadable or missing timestamp SINKS — it never takes the top row", () => {
  const real = at("2026-08-30T06:12:28.379Z", "real");
  for (const bad of [null, undefined, "", "not a date"]) {
    const broken = at(bad, "broken");
    assert.ok(byNewestFirst(broken, real) > 0, `${String(bad)} must not outrank a real timestamp`);
    assert.equal([broken, real].sort(byNewestFirst)[0].recordId, "real");
  }
});
