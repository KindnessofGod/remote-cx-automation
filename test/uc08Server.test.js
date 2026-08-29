// ---------------------------------------------------------------------------
// uc08Server.test.js  —  The UC-08 read-only dossier HTTP API
// ---------------------------------------------------------------------------
// Same request/response-double pattern as uc06Server.test.js: drives the real
// handler with no listening socket. The headline assertion is the absence of
// any write route — see server.js's header for why that's the point.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuditLogger } from "../src/shared/audit.js";
import { DossierStore } from "../src/uc08/dossierStore.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { createUc08Handler } from "../src/uc08/server.js";

let audit;
let dossierStore;
let handler;

beforeEach(() => {
  audit = new AuditLogger();
  dossierStore = new DossierStore();
  handler = createUc08Handler({ dossierStore });
});

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

// This suite is about the read-only HTTP surface, not draft prose — never a
// real, retried LLM call from a test that happens to run where OPENAI_API_KEY
// is set (see test/uc08.test.js's identical fake for why).
const fakeDraftNarrative = async ({ inquiryType }) => ({
  narrative: `Research summary for a ${inquiryType} inquiry.`,
  source: "template",
});
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function createDossier(overrides = {}) {
  return handleTaxInquiry(
    { text: "I think I'm a dual resident of Germany and Spain.", employmentId: "emp_active_001", ...overrides },
    { audit, dossierStore, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
}

test("GET /api/dossiers lists every dossier built, newest first — the dashboard's queue", async () => {
  const first = await createDossier({ externalRef: "list-7001" });
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  const second = await createDossier({ externalRef: "list-7002" });

  const res = await callApi(handler, { method: "GET", path: "/api/dossiers" });
  assert.equal(res.status, 200);
  assert.equal(res.body.dossiers.length, 2);
  assert.equal(res.body.dossiers[0].id, second.dossierId); // newest first
  assert.equal(res.body.dossiers[1].id, first.dossierId);
});

test("GET /api/dossiers returns an empty list, not an error, when none exist yet", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.dossiers, []);
});

test("GET /api/dossiers/:id returns the full dossier", async () => {
  const created = await createDossier({ externalRef: "7001" });
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers/" + created.dossierId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.dossierRow.inquiryType, "dual_residency");
  assert.match(res.body.dossierRow.dossier.framing, /RESEARCH SUPPORT ONLY/);
  assert.equal(res.body.tier, "high");
  assert.equal(res.body.actionable, false, "UC-08 must never be actionable — no execution path exists");
});

test("GET /api/dossiers/by-ticket/:externalRef finds the dossier tied to a ticket", async () => {
  await createDossier({ externalRef: "7002" });
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers/by-ticket/7002" });
  assert.equal(res.status, 200);
  assert.equal(res.body.dossierRow.externalRef, "7002");
});

test("GET /api/dossiers/:id for an unknown id returns 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("GET /api/dossiers/by-ticket/:externalRef for a ticket with no dossier returns 404", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers/by-ticket/no-such-ticket" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("there is no write route — a POST to any dossier path 404s as no_such_route", async () => {
  const created = await createDossier({ externalRef: "7003" });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/dossiers/" + created.dossierId + "/approve",
    body: { approver: "someone" },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

test("CORS only ever advertises GET/OPTIONS — no write verb is ever offered", async () => {
  const res = await callApi(handler, { method: "GET", path: "/healthz" });
  assert.equal(res.headers["access-control-allow-methods"], "GET, OPTIONS");
});
