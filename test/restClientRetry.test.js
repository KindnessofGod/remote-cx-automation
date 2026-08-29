// ---------------------------------------------------------------------------
// restClientRetry.test.js — retry/backoff wired into RemoteClient and
// ZendeskClient (BUILD-LOG roadmap item: "retry/backoff on the Remote/
// Zendesk REST clients" — the three named LLM call sites already had
// withRetry(), src/shared/retry.js; this closes the REST-client half).
//
// Uses a small, controllable flaky HTTP server on localhost (node:http, the
// same pattern src/remote/mockServer.js and src/zendesk/mockServer.js use)
// so every test stays hermetic — no real network, ever. Every test injects a
// no-op `backoff` into the client under test, so a genuine 3-attempt retry
// sequence costs ~0ms of real wall-clock time, never the real 200ms/400ms
// backoff — that's what keeps this file, and `npm test` as a whole, fast.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { RemoteClient } from "../src/remote/restClient.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";

const noBackoff = async () => {};

/**
 * A tiny HTTP server whose behavior per path is scripted by `plan` — an
 * array of {status, body} responses consumed in order; once exhausted, the
 * last entry repeats forever. `calls` (keyed by "METHOD path") counts every
 * request actually received, so a test can assert exactly how many attempts
 * were made — the whole point of proving "retries twice then succeeds" and
 * "gives up after exactly 3."
 */
function startFlakyServer() {
  const plans = new Map(); // "METHOD path" -> [{status, body}, ...]
  const calls = new Map(); // "METHOD path" -> count

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const key = `${req.method} ${url.pathname}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const plan = plans.get(key);
      if (!plan || plan.length === 0) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "unscripted_path", key }));
        return;
      }
      const idx = Math.min(calls.get(key) - 1, plan.length - 1);
      const step = plan[idx];
      res.statusCode = step.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(step.body ?? {}));
    });
  });

  return {
    server,
    listen: (port) => new Promise((resolve) => server.listen(port, resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
    /** Script what "METHOD path" returns, in order. */
    script(method, path, steps) {
      plans.set(`${method} ${path}`, steps);
    },
    /** How many requests actually landed on "METHOD path". */
    callCount(method, path) {
      return calls.get(`${method} ${path}`) ?? 0;
    },
    /**
     * Clear the call-count tally between tests. Needed because more than one
     * test in this file scripts the SAME path on the SAME long-lived server
     * (e.g. "POST /oauth/tokens" — every OAuth-mode test hits the one fixed
     * token endpoint the real client always calls) — without this, a later
     * test's callCount() assertion would include attempts made by an earlier
     * test, since `calls` is a single Map shared for the server's whole
     * lifetime. `plans` is deliberately left alone: each test re-scripts the
     * path it cares about before making any request.
     */
    resetCalls() {
      calls.clear();
    },
  };
}

// Every test gets a clean call tally on every server already started, so one
// test's request count never leaks into another's assertions — see
// resetCalls() above for why this matters specifically for "/oauth/tokens".
beforeEach(() => {
  remoteFlaky?.resetCalls();
  zendeskFlaky?.resetCalls();
});

// ---------------------------------------------------------------------------
// RemoteClient
// ---------------------------------------------------------------------------

let remoteFlaky;

before(async () => {
  remoteFlaky = startFlakyServer();
  await remoteFlaky.listen(4090);
});
after(() => remoteFlaky.close());

test("RemoteClient.getEmployment retries a transient 500 twice then succeeds on the 3rd attempt", async () => {
  remoteFlaky.script("GET", "/v1/employments/emp_flaky_1", [
    { status: 500, body: { error: "transient" } },
    { status: 500, body: { error: "transient" } },
    { status: 200, body: { data: { id: "emp_flaky_1", contract_type: "full_time", start_date: "2022-01-01", status: "active" } } },
  ]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff });
  const emp = await remote.getEmployment("emp_flaky_1");
  assert.equal(emp.id, "emp_flaky_1");
  assert.equal(remoteFlaky.callCount("GET", "/v1/employments/emp_flaky_1"), 3);
});

test("RemoteClient.getEmployment gives up and throws after exactly 3 attempts on a persistent 500", async () => {
  remoteFlaky.script("GET", "/v1/employments/emp_flaky_2", [{ status: 500, body: { error: "down" } }]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff });
  await assert.rejects(() => remote.getEmployment("emp_flaky_2"), /Remote API .* failed: 500/);
  assert.equal(remoteFlaky.callCount("GET", "/v1/employments/emp_flaky_2"), 3);
});

test("RemoteClient.getEmployment retries a transient 429 then succeeds", async () => {
  remoteFlaky.script("GET", "/v1/employments/emp_flaky_429", [
    { status: 429, body: { error: "rate_limited" } },
    { status: 200, body: { data: { id: "emp_flaky_429", contract_type: "full_time", start_date: "2022-01-01", status: "active" } } },
  ]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff });
  const emp = await remote.getEmployment("emp_flaky_429");
  assert.equal(emp.id, "emp_flaky_429");
  assert.equal(remoteFlaky.callCount("GET", "/v1/employments/emp_flaky_429"), 2);
});

test("RemoteClient.getEmployment does NOT retry a 404 — one attempt, returns null (preserves the existing convention)", async () => {
  remoteFlaky.script("GET", "/v1/employments/emp_missing", [{ status: 404, body: { error: "not_found" } }]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff });
  const emp = await remote.getEmployment("emp_missing");
  assert.equal(emp, null);
  assert.equal(remoteFlaky.callCount("GET", "/v1/employments/emp_missing"), 1, "a 404 must never be retried");
});

test("RemoteClient.getEmployment does NOT retry a 400 — one attempt, throws immediately", async () => {
  remoteFlaky.script("GET", "/v1/employments/emp_bad_request", [{ status: 400, body: { error: "bad_request" } }]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff });
  await assert.rejects(() => remote.getEmployment("emp_bad_request"), /Remote API .* failed: 400/);
  assert.equal(remoteFlaky.callCount("GET", "/v1/employments/emp_bad_request"), 1, "a 400 must never be retried — the request itself is wrong");
});

test("RemoteClient.patchEmploymentBasicInformation (a WRITE) also retries a transient 500 then succeeds", async () => {
  remoteFlaky.script("PATCH", "/v1/employments/emp_flaky_patch/basic-information", [
    { status: 503, body: { error: "unavailable" } },
    { status: 200, body: { data: { id: "emp_flaky_patch", job_title: "Engineer" } } },
  ]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff });
  const result = await remote.patchEmploymentBasicInformation("emp_flaky_patch", { job_title: "Engineer" });
  assert.equal(result.job_title, "Engineer");
  assert.equal(remoteFlaky.callCount("PATCH", "/v1/employments/emp_flaky_patch/basic-information"), 2);
});

test("RemoteClient retries on a genuine network error (connection refused), not just a bad HTTP status", async () => {
  // Nothing is listening on this port — every attempt is a real ECONNREFUSED,
  // proving fetch() throwing (not just a non-2xx response) is retried too.
  //
  // 4149 is RESERVED-UNBOUND in src/shared/ports.js TEST_PORTS: this test needs
  // the socket to stay dead, which is a claim on it exactly as a listen() is.
  // It was 4091 until that turned out to be uc02Categories.test.js's live mock
  // — so under `node --test`'s parallel execution this assertion could be
  // answered by a real HTTP server instead of a refusal, and would fail for a
  // reason that has nothing to do with retrying.
  const remote = new RemoteClient({ baseUrl: "http://localhost:4149", backoff: noBackoff });
  await assert.rejects(() => remote.getEmployment("anything"), /network error/);
});

test("RemoteClient honors a custom `retries` count (test-only seam) — fewer attempts, still no real delay", async () => {
  remoteFlaky.script("GET", "/v1/employments/emp_flaky_retries", [{ status: 500, body: { error: "down" } }]);
  const remote = new RemoteClient({ baseUrl: "http://localhost:4090", backoff: noBackoff, retries: 1 });
  await assert.rejects(() => remote.getEmployment("emp_flaky_retries"));
  assert.equal(remoteFlaky.callCount("GET", "/v1/employments/emp_flaky_retries"), 1);
});

// ---------------------------------------------------------------------------
// ZendeskClient
// ---------------------------------------------------------------------------

let zendeskFlaky;

before(async () => {
  zendeskFlaky = startFlakyServer();
  await zendeskFlaky.listen(4092);
});
after(() => zendeskFlaky.close());

test("ZendeskClient.getTicket (token auth) retries a transient 502 twice then succeeds", async () => {
  zendeskFlaky.script("GET", "/api/v2/tickets/5001", [
    { status: 502, body: { error: "bad_gateway" } },
    { status: 502, body: { error: "bad_gateway" } },
    { status: 200, body: { ticket: { id: 5001, status: "open" } } },
  ]);
  const zendesk = new ZendeskClient({
    baseUrl: "http://localhost:4092",
    email: "agent@example.com",
    apiToken: "test",
    backoff: noBackoff,
  });
  const ticket = await zendesk.getTicket(5001);
  assert.equal(ticket.id, 5001);
  assert.equal(zendeskFlaky.callCount("GET", "/api/v2/tickets/5001"), 3);
});

test("ZendeskClient.getTicket gives up and throws after exactly 3 attempts on a persistent 500", async () => {
  zendeskFlaky.script("GET", "/api/v2/tickets/5002", [{ status: 500, body: { error: "down" } }]);
  const zendesk = new ZendeskClient({
    baseUrl: "http://localhost:4092",
    email: "agent@example.com",
    apiToken: "test",
    backoff: noBackoff,
  });
  await assert.rejects(() => zendesk.getTicket(5002), /Zendesk API GET .* failed: 500/);
  assert.equal(zendeskFlaky.callCount("GET", "/api/v2/tickets/5002"), 3);
});

test("ZendeskClient.getTicket does NOT retry a 404 — one attempt, returns null", async () => {
  zendeskFlaky.script("GET", "/api/v2/tickets/5003", [{ status: 404, body: { error: "not_found" } }]);
  const zendesk = new ZendeskClient({
    baseUrl: "http://localhost:4092",
    email: "agent@example.com",
    apiToken: "test",
    backoff: noBackoff,
  });
  const ticket = await zendesk.getTicket(5003);
  assert.equal(ticket, null);
  assert.equal(zendeskFlaky.callCount("GET", "/api/v2/tickets/5003"), 1, "a 404 must never be retried");
});

test("ZendeskClient (OAuth mode): a transient failure fetching the token is retried WITHIN the same 3-attempt envelope as the resource call, not on top of it", async () => {
  // Token endpoint fails once (transient), then succeeds; once cached, the
  // ticket fetch succeeds first try. Total requests across BOTH endpoints
  // must fit inside 3 attempts of the outer #request() — proving there's no
  // separate, nested retry loop around the token fetch (the file header's
  // "9 attempts" trap this design deliberately avoids).
  zendeskFlaky.script("POST", "/oauth/tokens", [
    { status: 503, body: { error: "unavailable" } },
    { status: 200, body: { access_token: "tok_1", token_type: "bearer", expires_in: 1800 } },
  ]);
  zendeskFlaky.script("GET", "/api/v2/tickets/5004", [{ status: 200, body: { ticket: { id: 5004, status: "open" } } }]);
  const zendesk = new ZendeskClient({
    baseUrl: "http://localhost:4092",
    clientId: "cid",
    clientSecret: "secret",
    backoff: noBackoff,
  });
  const ticket = await zendesk.getTicket(5004);
  assert.equal(ticket.id, 5004);
  // 2 attempts: token fails once then succeeds on attempt 2, and the ticket
  // GET only fires once the header resolves (also attempt 2 of the outer loop).
  assert.equal(zendeskFlaky.callCount("POST", "/oauth/tokens"), 2);
  assert.equal(zendeskFlaky.callCount("GET", "/api/v2/tickets/5004"), 1);
});

test("ZendeskClient (OAuth mode) does NOT retry a genuine auth failure (400 bad client secret) — one attempt, immediate throw", async () => {
  zendeskFlaky.script("POST", "/oauth/tokens", [{ status: 400, body: { error: "unauthorized_client" } }]);
  const zendesk = new ZendeskClient({
    baseUrl: "http://localhost:4092",
    clientId: "cid",
    clientSecret: "wrong",
    backoff: noBackoff,
  });
  await assert.rejects(() => zendesk.getTicket(5005), /OAuth token request failed/);
  assert.equal(zendeskFlaky.callCount("POST", "/oauth/tokens"), 1, "a bad client secret must never be retried");
});

test("ZendeskClient.resolveWithLetter (a WRITE) also retries a transient 500 then succeeds", async () => {
  zendeskFlaky.script("PUT", "/api/v2/tickets/5006", [
    { status: 500, body: { error: "transient" } },
    { status: 200, body: { ticket: { id: 5006, status: "solved" } } },
  ]);
  const zendesk = new ZendeskClient({
    baseUrl: "http://localhost:4092",
    email: "agent@example.com",
    apiToken: "test",
    backoff: noBackoff,
  });
  const result = await zendesk.resolveWithLetter(5006, "<p>Letter</p>");
  assert.equal(result.ticket.status, "solved");
  assert.equal(zendeskFlaky.callCount("PUT", "/api/v2/tickets/5006"), 2);
});
