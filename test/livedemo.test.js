// ---------------------------------------------------------------------------
// livedemo.test.js  —  The real-Zendesk-ticket live demo
// ---------------------------------------------------------------------------
// Same two concerns as playground.test.js / zafApp.test.js:
//   1. The browser asset compiles and never uses innerHTML — npm test never
//      imports app.js, so a syntax error would otherwise ship silently.
//   2. The HTTP API, driven through the real handler with a FAKE Zendesk
//      client (never the network) — this repo's hermetic-testing rule means
//      npm test can never actually create a real ticket. The fake records
//      what it was called with, so we can assert the right shape is sent.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { createLiveDemoHandler } from "../src/livedemo/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "livedemo", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// A HERMETIC FIXTURE — this test never reaches the network, so the id here is
// only ever compared against itself. It still carries the CURRENT Sandbox id
// (re-verified live 2026-08-19), because the previous value
// `fde4007b-…` is a dead id and a reader copying it out of this file to debug
// something live gets a 404 that reads like a credential problem (CLAUDE.md §6).
const EMPLOYEE = { id: "3537d9ee-2017-4a53-952e-9d3b042aeab5", name: "Alexandre Tremblay", email: "alexandre@example.com" };

function fakeZendesk({ ticket = null, comments = [] } = {}) {
  const calls = [];
  return {
    calls,
    async createTicket(fields) {
      calls.push(["createTicket", fields]);
      return { id: 555, requester_id: 1, ...ticket };
    },
    async getTicket(id) {
      calls.push(["getTicket", id]);
      return ticket ?? { id: Number(id), status: "open", tags: ["uc01_test"], requester_id: 1 };
    },
    async getTicketComments(id) {
      calls.push(["getTicketComments", id]);
      return comments;
    },
  };
}

function callApi(handler, { method, path, body = null }) {
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
        resolve({ status: this.statusCode, headers: this.headers, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

test("index.html loads exactly the assets that exist", () => {
  const html = read("index.html");
  for (const asset of ["style.css", "app.js"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
});

test("app.js compiles", () => {
  assert.doesNotThrow(() => new vm.Script(read("app.js"), { filename: "app.js" }));
});

test("app.js never writes dynamic values with innerHTML", () => {
  const source = read("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

// ---------------------------------------------------------------------------
// The HTTP API — driven through the real handler with a fake Zendesk client.
// No test here can reach the real network, per this repo's hermetic-testing
// rule — that's the whole reason the fake exists instead of the real client.
// ---------------------------------------------------------------------------

test("GET /api/employees returns the configured employee list without leaking extra fields", async () => {
  const zendesk = fakeZendesk();
  const handler = createLiveDemoHandler({ zendesk, employmentIdFieldId: "12345", employees: [EMPLOYEE] });
  const res = await callApi(handler, { method: "GET", path: "/api/employees" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.employees, [{ id: EMPLOYEE.id, name: EMPLOYEE.name, email: EMPLOYEE.email }]);
});

test("POST /api/submit creates a real-shaped ticket tagged for the live trigger", async () => {
  const zendesk = fakeZendesk();
  const handler = createLiveDemoHandler({ zendesk, employmentIdFieldId: "12345", employees: [EMPLOYEE] });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/submit",
    body: { employmentId: EMPLOYEE.id, text: "Please send me a standard employment verification letter." },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ticketId, 555);

  const [, fields] = zendesk.calls.find(([name]) => name === "createTicket");
  assert.deepEqual(fields.tags, ["uc01_test"]);
  assert.deepEqual(fields.custom_fields, [{ id: 12345, value: EMPLOYEE.id }]);
  assert.equal(fields.requester.email, EMPLOYEE.email);
  assert.equal(fields.comment.public, true);
});

test("POST /api/submit rejects an unknown employee rather than guessing", async () => {
  const zendesk = fakeZendesk();
  const handler = createLiveDemoHandler({ zendesk, employmentIdFieldId: "12345", employees: [EMPLOYEE] });
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: { employmentId: "not_a_real_id" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_employee");
});

test("GET /api/status surfaces the agent's public reply but never the requester's own comment", async () => {
  const ticket = { id: 555, status: "solved", tags: ["uc01_test", "uc01_auto_resolved"], requester_id: 1 };
  const comments = [
    { author_id: 1, public: true, html_body: "<p>Please send me a letter.</p>" }, // the requester's own message
    { author_id: 999, public: true, html_body: "<h1>Employment Verification Letter</h1>" }, // the automation's reply
  ];
  const zendesk = fakeZendesk({ ticket, comments });
  const handler = createLiveDemoHandler({ zendesk, employmentIdFieldId: "12345", employees: [EMPLOYEE] });
  const res = await callApi(handler, { method: "GET", path: "/api/status/555" });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "solved");
  assert.match(res.body.publicReplyHtml, /Employment Verification Letter/);
});

test("GET /api/status on a missing ticket returns 404, not a guess", async () => {
  const zendesk = { getTicket: async () => null, getTicketComments: async () => [], createTicket: async () => ({}) };
  const handler = createLiveDemoHandler({ zendesk, employmentIdFieldId: "12345", employees: [EMPLOYEE] });
  const res = await callApi(handler, { method: "GET", path: "/api/status/999999" });
  assert.equal(res.status, 404);
});
