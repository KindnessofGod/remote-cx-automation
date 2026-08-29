// ---------------------------------------------------------------------------
// zendeskCustomFieldHeal.test.js — rca-7rkh: Zendesk was observed silently
// dropping `custom_fields` set on the SAME POST /api/v2/tickets call that
// creates the ticket (live ticket #120: the create returned 200 with the
// value already read back as null; a follow-up PUT with the identical
// payload DID stick). Every use case's trigger gates on one of these fields
// being present, so a dropped field means the automation never fires.
//
// ZendeskClient#createTicket (src/zendesk/restClient.js) now detects a
// requested custom-field value that didn't take in the create response and
// re-applies just that field via a follow-up PUT — the exact workaround
// verified live. This uses a small scripted HTTP server (the same pattern as
// test/restClientRetry.test.js) so both the "drops it" and "keeps it" shapes
// of a real Zendesk account can be exercised hermetically.
// ---------------------------------------------------------------------------

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ZendeskClient } from "../src/zendesk/restClient.js";

const PORT = 4134;

/**
 * A scripted stand-in for the exact live shape observed on ticket #120:
 * POST creates the ticket but reports every custom field value as null;
 * PUT actually applies whatever custom_fields it's given. Also tracks call
 * counts per method+path so a test can assert exactly one healing PUT fired
 * (never more, and never for a field that already stuck).
 */
function startDroppingMockServer() {
  const tickets = new Map();
  let nextId = 9000;
  const calls = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const key = `${req.method} ${url.pathname}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    res.setHeader("Content-Type", "application/json");

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};

      if (req.method === "POST" && parts.join("/") === "api/v2/tickets") {
        const fields = parsed.ticket ?? {};
        const id = nextId++;
        // THE BUG: the create response reports every custom field as
        // dropped (value null), exactly as observed live on ticket #120 —
        // whatever was sent, the readback says nothing stuck.
        const ticket = {
          id,
          subject: fields.subject ?? "",
          tags: fields.tags ?? [],
          custom_fields: (fields.custom_fields ?? []).map((f) => ({ id: f.id, value: null })),
        };
        tickets.set(id, ticket);
        res.statusCode = 201;
        return res.end(JSON.stringify({ ticket }));
      }

      if (req.method === "PUT" && parts[0] === "api" && parts[1] === "v2" && parts[2] === "tickets" && parts[3]) {
        const id = Number(parts[3]);
        const ticket = tickets.get(id);
        if (!ticket) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: "RecordNotFound" }));
        }
        const patch = parsed.ticket ?? {};
        // PUT genuinely applies custom_fields — the verified-live workaround.
        if (Array.isArray(patch.custom_fields)) {
          const byId = new Map(ticket.custom_fields.map((f) => [f.id, f]));
          for (const f of patch.custom_fields) byId.set(f.id, { id: f.id, value: f.value });
          ticket.custom_fields = [...byId.values()];
        }
        res.statusCode = 200;
        return res.end(JSON.stringify({ ticket }));
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "no_such_route", path: url.pathname }));
    });
  });

  return {
    server,
    listen: (port) => new Promise((resolve) => server.listen(port, resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
    callCount: (method, path) => calls.get(`${method} ${path}`) ?? 0,
  };
}

let mock;

test("ZendeskClient#createTicket heals a custom field the create call silently dropped", async () => {
  mock = startDroppingMockServer();
  await mock.listen(PORT);
  const zendesk = new ZendeskClient({ baseUrl: `http://localhost:${PORT}`, email: "agent@example.com", apiToken: "test" });

  const ticket = await zendesk.createTicket({
    subject: "Employment verification letter request",
    comment: { body: "x", public: true },
    custom_fields: [{ id: 9990000000001, value: "2f7f8210-91fc-47db-803c-77a1cc625781" }],
  });

  // The create response itself reported the field as dropped (null); the
  // client must have followed up with a PUT so the value the CALLER sees —
  // and the value now on the ticket — is the one that was actually asked for.
  assert.equal(ticket.custom_fields[0].value, "2f7f8210-91fc-47db-803c-77a1cc625781");
  assert.equal(mock.callCount("POST", "/api/v2/tickets"), 1);
  assert.equal(mock.callCount("PUT", `/api/v2/tickets/${ticket.id}`), 1);

  await mock.close();
});

test("ZendeskClient#createTicket does NOT issue a healing PUT when every field already stuck", async () => {
  // A server whose create call genuinely applies custom_fields — the
  // ordinary, non-buggy shape. No healing PUT must ever fire against a
  // ticket that already came back correct.
  const calls = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const key = `${req.method} ${url.pathname}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    res.setHeader("Content-Type", "application/json");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const fields = (body ? JSON.parse(body) : {}).ticket ?? {};
      res.statusCode = 201;
      res.end(JSON.stringify({ ticket: { id: 9500, subject: fields.subject ?? "", tags: [], custom_fields: fields.custom_fields ?? [] } }));
    });
  });
  await new Promise((resolve) => server.listen(4135, resolve));

  const zendesk = new ZendeskClient({ baseUrl: "http://localhost:4135", email: "agent@example.com", apiToken: "test" });
  const ticket = await zendesk.createTicket({
    subject: "Employment verification letter request",
    comment: { body: "x", public: true },
    custom_fields: [{ id: 9990000000001, value: "emp_active_001" }],
  });

  assert.equal(ticket.custom_fields[0].value, "emp_active_001");
  assert.equal(calls.get("PUT /api/v2/tickets/9500") ?? 0, 0);

  await new Promise((resolve) => server.close(resolve));
});

test("ZendeskClient#createTicket with no custom_fields never issues a healing PUT", async () => {
  mock = startDroppingMockServer();
  await mock.listen(4136);
  const zendesk = new ZendeskClient({ baseUrl: "http://localhost:4136", email: "agent@example.com", apiToken: "test" });

  const ticket = await zendesk.createTicket({ subject: "Employment verification letter request", comment: { body: "x", public: true } });

  assert.ok(ticket.id);
  assert.equal(mock.callCount("PUT", `/api/v2/tickets/${ticket.id}`), 0);
  await mock.close();
});
