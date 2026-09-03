// ---------------------------------------------------------------------------
// portalUnknownBodyShape.test.js — a 200 that filed the wrong thing is worse
// than a 400 that filed nothing
// ---------------------------------------------------------------------------
// 2026-09-02: three evaluating agents posted `{"persona","fields":{"uc05-…"}}`
// — a plausible reading of the form's own input ids. The intake read only
// top-level keys, defaulted every value, answered 200, prepared a resignation
// with no date, no balances and no rate for sign-off, and raised six real
// Zendesk tickets on nothing.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { fakeZendesk } from "./portalNoteHelpers.js";

const unconfigured = { isConfigured: () => false };
function portal() {
  const stores = buildPortalStores();
  const zendesk = fakeZendesk();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({ remote, audit: new AuditLogger(), stores, zendesk, llm: { extract: (a) => extractFromLetter(a, unconfigured) } });
  return { handler, stores, zendesk };
}
function call(handler, { path, body }) {
  return new Promise((resolve, reject) => {
    const req = { method: "POST", url: path, headers: {}, on(ev, cb) { if (ev === "data") cb(Buffer.from(JSON.stringify(body))); if (ev === "end") setImmediate(cb); return req; } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h ?? {}); }, end(p) { try { resolve({ status: this.statusCode, body: p ? JSON.parse(p) : null }); } catch (e) { reject(e); } } };
    handler(req, res);
  });
}

test("values nested under `fields` are refused by name — nothing filed, no ticket raised", async () => {
  const { handler, stores, zendesk } = portal();
  const res = await call(handler, { path: "/api/requests/uc05", body: { persona: "joao", fields: { "uc05-proposedEndDate": "2026-11-30", "uc05-ptoDaysAccrued": "18" } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unrecognised_body_shape");
  assert.match(res.body.reason, /top-level keys/);
  assert.equal(zendesk.created.length, 0, "a ticket was raised on a request that was refused");
  assert.equal((await stores.uc05.list?.())?.length ?? 0, 0);
});

test("the same request with top-level keys is accepted — the refusal is about shape, not content", async () => {
  const { handler } = portal();
  const res = await call(handler, { path: "/api/requests/uc05", body: { persona: "joao", proposedEndDate: "2026-11-30", ptoDaysAccrued: "18", ptoDaysUsed: "5", ptoHourlyRate: "26.00" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff");
});
