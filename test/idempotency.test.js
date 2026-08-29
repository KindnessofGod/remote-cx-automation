// ---------------------------------------------------------------------------
// idempotency.test.js  —  F-18 (HIGH): a retried write is not a second write
// ---------------------------------------------------------------------------
// RemoteClient retries 429/5xx/network failures up to 3 times with a
// byte-identical body. On `POST /v1/recurring-incentives` — the one call in
// this repo that moves real money — that means a gateway timing out AFTER the
// payment was created gets the same disbursement posted again. The finding's
// reproduction: a stub answering 504, 504, 200 received three identical
// payment bodies and the caller saw one success.
//
// The fix is a client-generated Idempotency-Key, computed once per logical
// write and reused by every attempt. These tests assert both halves: that the
// key is present, and — the part that actually matters — that all three
// attempts carry the SAME one. A per-attempt key would look correct in a
// header dump and fix nothing.
//
// Hermetic: a local node:http stub, no real network, no backoff delay.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { RemoteClient } from "../src/remote/restClient.js";

const noBackoff = async () => {};

let server;
let baseUrl;
/** Every request the stub received: {method, path, key, body}. */
let received;
/** Statuses to answer with, in order; the last repeats. */
let plan;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.push({
        method: req.method,
        path: req.url,
        key: req.headers["idempotency-key"] ?? null,
        body: raw,
      });
      const status = plan[Math.min(received.length - 1, plan.length - 1)];
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { id: "created_1" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server && server.close());

beforeEach(() => {
  received = [];
  plan = [200];
});

const client = () => new RemoteClient({ baseUrl, backoff: noBackoff });

test("F-18. the money POST is retried on 5xx — and all three attempts carry ONE idempotency key", async () => {
  plan = [504, 504, 200]; // exactly the finding's reproduction

  const result = await client().createIncentive({ employment_id: "emp_1", amount: 500_000, currency: "USD" });
  assert.deepEqual(result, { id: "created_1" });

  // The retry behaviour itself is unchanged — three deliveries really happen.
  assert.equal(received.length, 3);
  const bodies = new Set(received.map((r) => r.body));
  assert.equal(bodies.size, 1, "the retried body should be byte-identical, as before");

  // What changed: the server can now recognise the repeat.
  const keys = new Set(received.map((r) => r.key));
  assert.equal(keys.size, 1, `expected one idempotency key across all attempts, got ${[...keys].join(", ")}`);
  assert.ok([...keys][0], "no Idempotency-Key header was sent at all");
});

test("F-18. a caller-supplied key is used verbatim, so a retry ACROSS processes still dedupes", async () => {
  plan = [504, 200];
  await client().createIncentive({ amount: 500_000 }, { idempotencyKey: "adj_abc-123" });
  assert.equal(received.length, 2);
  assert.deepEqual([...new Set(received.map((r) => r.key))], ["adj_abc-123"]);
});

test("F-18. two SEPARATE calls with an identical body get different keys — no accidental dedupe", async () => {
  await client().createIncentive({ amount: 500_000, currency: "USD" });
  await client().createIncentive({ amount: 500_000, currency: "USD" });

  assert.equal(received.length, 2);
  assert.notEqual(
    received[0].key,
    received[1].key,
    "hashing the payload would make two genuinely distinct bonuses collide into one payment"
  );
});

test("F-18. every write method sends a key, not just the incentive POST", async () => {
  const c = client();
  await c.patchEmploymentBasicInformation("emp_1", { job_title: "Staff Engineer" });
  await c.patchExpenseStatus("exp_1", { status: "approved" });
  // `createWorkAuthorization()` used to be in this list. It is gone, with the
  // endpoint it POSTed to: there is no `POST /v1/work-authorization-requests`
  // (docs/REMOTE-VOCABULARY.md §13.1). The status here is Remote's own enum
  // member for an employer-manager approval — `approved_by_remote`, which this
  // line used to send, is Remote's verdict and not a caller's to set.
  await c.patchWorkAuthorization("wa_1", { status: "approved_by_manager" });
  await c.createIncentive({ amount: 1 });

  assert.equal(received.length, 4);
  for (const call of received) {
    assert.ok(call.key, `${call.method} ${call.path} sent no Idempotency-Key`);
  }
});

test("F-18. reads are untouched — a GET carries no idempotency key", async () => {
  await client().getEmployment("emp_1");
  assert.equal(received.length, 1);
  assert.equal(received[0].key, null);
});
