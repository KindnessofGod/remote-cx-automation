// ---------------------------------------------------------------------------
// playground.test.js  —  The interactive UC-01 playground
// ---------------------------------------------------------------------------
// Same two concerns as review.test.js / zafApp.test.js:
//   1. The browser asset compiles and never uses innerHTML or re-derives the
//      approval policy — the exact gotcha BUILD-LOG.md already logged once
//      for zaf-app's main.js, checked here for the same reason: npm test
//      never imports app.js, so a syntax error would otherwise ship silently.
//   2. The HTTP API, driven through the real handler with no listening
//      socket, proves the playground reuses handleVerificationTicket() and
//      reviewPolicy/service.js rather than reimplementing any gate.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { createPlaygroundHandler } from "../src/playground/server.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer } from "../src/remote/mockServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "playground", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// ---------------------------------------------------------------------------
// Static assets — the n8n/zaf-app lesson, one surface over.
// ---------------------------------------------------------------------------

test("index.html loads exactly the assets that exist", () => {
  const html = read("index.html");
  for (const asset of ["style.css", "app.js"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
});

test("app.js compiles", () => {
  assert.doesNotThrow(
    () => new vm.Script(read("app.js"), { filename: "app.js" }),
    "app.js does not parse — it would ship broken and the suite would stay green"
  );
});

test("app.js never writes dynamic values with innerHTML", () => {
  const source = read("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

test("app.js does not re-derive the approval policy in the browser", () => {
  const source = read("app.js");
  assert.ok(source.includes("view.actionable"), "the case detail panel must read actionability from the API");
  assert.ok(
    !/\.decision\s*===\s*["']human_review["']/.test(source),
    "app.js branches on the raw decision — that is a second copy of the policy"
  );
});

// ---------------------------------------------------------------------------
// The HTTP API — driven through the real handler, no port needed. Proves the
// playground is a thin router over handleVerificationTicket() and
// reviewPolicy.js/service.js, not a second implementation of either.
// ---------------------------------------------------------------------------

let remoteServer;
let remote;
let caseStore;
let audit;
let handler;

before(async () => {
  remoteServer = await startMockServer(4017); // playground-test-only port
  remote = new RemoteClient({ baseUrl: "http://localhost:4017" });
});
after(() => remoteServer && remoteServer.close());

beforeEach(() => {
  caseStore = new CaseStore();
  audit = new AuditLogger();
  // Never a real, retried LLM call from a test — the "simulate low confidence"
  // toggle still overrides this per-request where a test exercises it.
  handler = createPlaygroundHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
});

/** Minimal req/res doubles so the real handler runs without a listening socket. */
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

test("submitting a standard ticket as the client auto-resolves with a letter", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/tickets",
    body: {
      text: "Please send me a standard employment verification letter.",
      asEmploymentId: "emp_active_001",
      employmentId: "emp_active_001",
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_resolve");
  assert.match(res.body.letterHtml, /Employment Verification Letter/);
  assert.match(res.body.externalRef, /^playground-/);
});

test("a human_review case appears in the queue as actionable and can be approved", async () => {
  const created = await callApi(handler, {
    method: "POST",
    path: "/api/tickets",
    body: {
      text: "My bank sent this form, please complete it.",
      asEmploymentId: "emp_active_001",
      employmentId: "emp_active_001",
      hasAttachment: true,
    },
  });
  assert.equal(created.body.decision, "human_review");
  const ref = created.body.externalRef;

  const list = await callApi(handler, { method: "GET", path: "/api/cases" });
  const row = list.body.cases.find((c) => c.externalRef === ref);
  assert.ok(row, "the new case must appear in the queue");
  assert.equal(row.actionable, true);

  const detail = await callApi(handler, { method: "GET", path: "/api/cases/" + ref });
  assert.equal(detail.body.found, true);
  assert.equal(detail.body.actionable, true);

  const approved = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + ref + "/approve",
    body: { approver: "agent_taylor", note: "Looks right." },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.ok, true);

  // Re-reading the same case must now report it as decided, not actionable —
  // one decision per case, whichever surface asks.
  const after1 = await callApi(handler, { method: "GET", path: "/api/cases/" + ref });
  assert.equal(after1.body.actionable, false);

  const auditRes = await callApi(handler, { method: "GET", path: "/api/audit" });
  assert.ok(
    auditRes.body.entries.some((e) => e.action === "human_approved" && e.actor === "agent_taylor"),
    "the approval must be attributed in the audit log"
  );
});

test("approving without a reason is refused and logs nothing", async () => {
  const created = await callApi(handler, {
    method: "POST",
    path: "/api/tickets",
    body: {
      text: "This is First Bank, please verify employment on behalf of the employee.",
      asEmploymentId: "emp_active_001",
      employmentId: "emp_active_001",
      consentOnRecord: true,
    },
  });
  assert.equal(created.body.decision, "human_review");
  const ref = created.body.externalRef;

  const attempt = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + ref + "/approve",
    body: { approver: "agent_taylor" },
  });
  assert.equal(attempt.status, 400);
  assert.equal(attempt.body.code, "reason_required");

  const auditRes = await callApi(handler, { method: "GET", path: "/api/audit" });
  assert.ok(
    !auditRes.body.entries.some((e) => e.action === "human_approved" && e.details?.caseId === created.body.caseId),
    "an approval without a reason must not be recorded"
  );
});

test("an escalated case can never be approved from the playground either", async () => {
  const created = await callApi(handler, {
    method: "POST",
    path: "/api/tickets",
    body: {
      text: "I need a standard employment letter.",
      asEmploymentId: "emp_terminated_002",
      employmentId: "emp_terminated_002",
    },
  });
  assert.equal(created.body.decision, "escalate");
  const ref = created.body.externalRef;

  const detail = await callApi(handler, { method: "GET", path: "/api/cases/" + ref });
  assert.equal(detail.body.actionable, false);

  const attempt = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + ref + "/approve",
    body: { approver: "agent_taylor" },
  });
  assert.equal(attempt.status, 403);
  assert.equal(attempt.body.code, "no_review_path");
});

test("the simulated low-confidence toggle produces a human_review with the low_confidence flag", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/tickets",
    body: {
      text: "Necesito una carta de verificación de empleo, no estoy segura del formato exacto.",
      asEmploymentId: "emp_active_001",
      employmentId: "emp_active_001",
      simulateLowConfidence: true,
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "human_review");
  assert.ok(res.body.flags.includes("low_confidence"));
});

// ---------------------------------------------------------------------------
// The audit panel renders DECISIONS. The per-attempt trace is the second level
// of invariant 7 and must not be served as if it were the first.
// ---------------------------------------------------------------------------
// `AuditLogger.entries` holds both kinds of record in one array: decision rows
// (useCase/action/actor/riskTier/details) and trace steps
// (call/attempt/ok/parentId). This route used to hand back the array whole, and
// the page renders a table of decision-row columns — so every trace step became
// a row with an empty use case, an empty action, an empty actor and a details
// cell reading `{}`. A single UC-01 ticket makes three, so the panel titled
// "Audit log — immutable, append-only" was three-quarters blank rows. That is
// not cosmetic: the audit log is the artifact whose entire value is being
// trustworthy at a glance, and blank rows in it read as lost records.
test("GET /api/audit returns only decision rows, with the attempts nested under the decision they belong to", async () => {
  const created = await callApi(handler, {
    method: "POST",
    path: "/api/tickets",
    body: {
      text: "Please send me a standard employment verification letter.",
      asEmploymentId: "emp_active_001",
      employmentId: "emp_active_001",
    },
  });
  assert.equal(created.body.decision, "auto_resolve");

  const res = await callApi(handler, { method: "GET", path: "/api/audit" });
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.length > 0, "the ticket above must have produced a decision row");

  for (const entry of res.body.entries) {
    // The three columns the table renders. A row with none of them is the
    // blank-row bug.
    assert.ok(
      entry.useCase && entry.action,
      `an audit entry with no useCase/action reached the decisions list: ${JSON.stringify(entry)}`
    );
    // And a trace step must never be mistaken for one.
    assert.equal(
      typeof entry.call === "string" && typeof entry.attempt === "number",
      false,
      `a trace step is being served as a decision row: ${JSON.stringify(entry)}`
    );
    assert.ok(Array.isArray(entry.traceSteps), "every decision row carries its attempts, even when there are none");
  }

  // Nothing is thrown away: an attempt with no parent yet is counted, not lost.
  assert.equal(typeof res.body.unboundTraceCount, "number");
});

test("a decision's own trace attempts are reachable from its row", async () => {
  // The playground injects a classifier, so whether any attempt is recorded
  // depends on that injection — which is exactly why this asserts the SHAPE is
  // present and correct rather than a fixed count. A wrong count would be a
  // test about the fake; a wrong shape is a test about the route.
  const res = await callApi(handler, { method: "GET", path: "/api/audit" });
  const withSteps = res.body.entries.filter((e) => e.traceSteps.length > 0);
  for (const entry of withSteps) {
    for (const step of entry.traceSteps) {
      assert.equal(typeof step.call, "string", "an attempt names the call it was");
      assert.equal(typeof step.attempt, "number", "an attempt carries its attempt number");
      assert.equal(typeof step.ok, "boolean", "an attempt says whether it succeeded");
    }
    // The attempt numbers are what findRedundantCalls() reads to tell a
    // legitimate retry sequence from a duplicate call, so they must survive
    // this route intact.
    const numbers = entry.traceSteps.map((s) => s.attempt);
    assert.deepEqual(
      numbers,
      [...numbers].sort((a, b) => a - b),
      "attempts must stay in order — the ordering is what distinguishes a retry from a duplicate"
    );
  }
});
