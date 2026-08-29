// ---------------------------------------------------------------------------
// uc07Server.test.js  —  The UC-07 read-only dossier HTTP API
// ---------------------------------------------------------------------------
// Same request/response-double pattern as uc08Server.test.js: drives the real
// handler with no listening socket. The headline assertion is the absence of
// any write route — see server.js's header for why that's the point.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuditLogger } from "../src/shared/audit.js";
import { DossierStore } from "../src/uc07/dossierStore.js";
import { handleRelocationReview } from "../src/uc07/workflow.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { createUc07Handler } from "../src/uc07/server.js";

const FEASIBLE_PLAN = {
  destinationSupported: true,
  destinationEntityActive: true,
  annualGrossSalaryRemoteInteger: 6500000,
  currency: "EUR",
  months: 12,
  minimumVisaSalaryRemoteInteger: 5500000,
  transferFeeRemoteInteger: 150000,
  creationDate: "2026-05-01",
  proposedStartDate: "2026-07-01",
  destinationStartDate: "2026-07-01",
  sourceTerminationDate: "2026-06-30",
  sourceLastWorkingDay: "2026-06-30",
  minimumOnboardingLeadTimeBusinessDays: 20,
  immigrationSupportRequired: false,
  immigrationConfirmed: true,
  rightToWorkConfirmed: true,
  destinationStartDateConfirmed: true,
  sourceExitPlanValidated: true,
  employerPresenceInDestination: true,
  taxTreatyNexusConfirmed: true,
  ptoTransferAllowed: true,
  sourcePtoDays: 12,
  seniorityPreservable: true,
};

let audit;
let dossierStore;
let handler;

beforeEach(() => {
  audit = new AuditLogger();
  dossierStore = new DossierStore();
  handler = createUc07Handler({ dossierStore });
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
// is set (see test/uc07.test.js's identical fake for why).
const fakeDraftNarrative = async () => ({ narrative: "Dossier narrative (deterministic template).", source: "template" });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function createDossier(overrides = {}) {
  return handleRelocationReview(
    { text: "We're permanently relocating our engineer from Spain to the Netherlands.", employmentId: "emp_active_001", ...overrides },
    { audit, dossierStore, classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
}

test("GET /api/dossiers lists every dossier built, newest first — the dashboard's queue", async () => {
  const first = await createDossier({ externalRef: "list-7001", plan: FEASIBLE_PLAN });
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  const second = await createDossier({ externalRef: "list-7002", plan: FEASIBLE_PLAN });

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
  const created = await createDossier({ externalRef: "7001", plan: FEASIBLE_PLAN });
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers/" + created.dossierId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.dossierRow.relocationType, "permanent_relocation");
  assert.match(res.body.dossierRow.dossier.framing, /RESEARCH SUPPORT ONLY/);
  assert.equal(res.body.tier, "high");
  assert.equal(res.body.actionable, false, "UC-07 must never be actionable — no execution path exists");
});

test("GET /api/dossiers/by-ticket/:externalRef finds the dossier tied to a ticket", async () => {
  await createDossier({ externalRef: "7002", plan: FEASIBLE_PLAN });
  const res = await callApi(handler, { method: "GET", path: "/api/dossiers/by-ticket/7002" });
  assert.equal(res.status, 200);
  assert.equal(res.body.dossierRow.externalRef, "7002");
  assert.equal(res.body.dossierRow.dossier.verdict, "PROCEED");
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
  const created = await createDossier({ externalRef: "7003", plan: FEASIBLE_PLAN });
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
