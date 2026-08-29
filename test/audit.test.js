// ---------------------------------------------------------------------------
// audit.test.js  —  AuditLogger.logTraceStep() — the per-step trace half of
// §4 invariant 7 — plus the UC-01 classifier wiring that proves it end to end.
// ---------------------------------------------------------------------------
// Same pattern as every other store test in this repo: a FAKE pg pool records
// the queries the logger would send to Supabase, and no real database is ever
// touched. The trace inserts are asserted alongside the parent audit_log
// insert so the FK-ordering rule (trace never lands before its parent) is
// pinned, not just the happy path.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequest, classifyRequestRuleBased } from "../src/uc01/classifier.js";

// A fake pg pool that records every query it receives and returns a benign
// result — the logger only ever awaits the call, never the row contents.
function fakePgPool() {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
}

// Pull the params array out of every insert for one table, in call order.
function insertsFor(queries, table) {
  return queries.filter((q) => q.sql.includes(`insert into ${table}`)).map((q) => q.params);
}

const decisionEvent = {
  useCase: "UC-01",
  action: "auto_resolve",
  actor: "emp_active_001",
  riskTier: "low",
  details: { caseId: "c-1", reason: "test" },
};

// ---------------------------------------------------------------------------
// logTraceStep with an explicit parentId
// ---------------------------------------------------------------------------

test("logTraceStep with a parentId records in memory and inserts into audit_trace", async () => {
  const pg = fakePgPool();
  const audit = new AuditLogger(null, { pgPool: pg });

  const parent = audit.log(decisionEvent);
  const trace = audit.logTraceStep({
    parentId: parent.id,
    call: "classify.askJson",
    attempt: 1,
    ok: true,
  });
  await audit.flush();

  assert.equal(trace.parentId, parent.id);
  assert.equal(trace.call, "classify.askJson");
  assert.equal(trace.ok, true);

  const traceRows = insertsFor(pg.queries, "audit_trace");
  assert.equal(traceRows.length, 1);
  assert.equal(traceRows[0][0], trace.id, "id is the first column");
  assert.equal(traceRows[0][2], parent.id, "parent_id is the third column");
  assert.equal(traceRows[0][3], "classify.askJson");
  assert.equal(traceRows[0][4], 1);
  assert.equal(traceRows[0][5], true);
  assert.equal(traceRows[0][6], null, "error is null on success");
});

test("a failed trace carries its error message", async () => {
  const pg = fakePgPool();
  const audit = new AuditLogger(null, { pgPool: pg });

  const parent = audit.log(decisionEvent);
  audit.logTraceStep({ parentId: parent.id, call: "classify.askJson", attempt: 1, ok: false, error: "connection refused" });
  await audit.flush();

  const traceRows = insertsFor(pg.queries, "audit_trace");
  assert.equal(traceRows[0][5], false);
  assert.equal(traceRows[0][6], "connection refused");
});

// ---------------------------------------------------------------------------
// The pending-trace path: recorded before the parent decision row exists,
// bound to the next audit-log row, inserted only after the parent lands
// ---------------------------------------------------------------------------

test("a trace recorded without a parentId is bound to the next decision row and inserted after it", async () => {
  const pg = fakePgPool();
  const audit = new AuditLogger(null, { pgPool: pg });

  // Simulate the UC-01 order: classifier runs (STEP 1), decision is audited
  // later (STEP 7). The trace has no parent yet at record time.
  audit.logTraceStep({ call: "classify.askJson", attempt: 1, ok: true });
  assert.equal(audit.pendingTraces.length, 1);

  const parent = audit.log(decisionEvent);
  await audit.flush();

  assert.equal(audit.pendingTraces.length, 0, "trace must be bound once the parent row exists");
  assert.equal(parent.details.caseId, "c-1", "the decision row itself is unchanged by the trace");

  const auditRows = insertsFor(pg.queries, "audit_log");
  const traceRows = insertsFor(pg.queries, "audit_trace");
  assert.equal(auditRows.length, 1);
  assert.equal(traceRows.length, 1);
  assert.equal(traceRows[0][2], parent.id, "bound trace must reference the decision row");

  // FK ordering: the trace insert must never be fired before the parent insert.
  const auditIdx = pg.queries.findIndex((q) => q.sql.includes("insert into audit_log"));
  const traceIdx = pg.queries.findIndex((q) => q.sql.includes("insert into audit_trace"));
  assert.ok(auditIdx >= 0);
  assert.ok(traceIdx > auditIdx, "audit_trace insert must come after its parent audit_log insert");

  // The in-memory record matches what was sent, including the resolved parent.
  const inMemoryTrace = audit.entries.find((e) => e.call === "classify.askJson");
  assert.equal(inMemoryTrace.parentId, parent.id);
});

test("a pending trace bound to a logDurable row is also chained after the parent insert", async () => {
  const pg = fakePgPool();
  const audit = new AuditLogger(null, { pgPool: pg });

  audit.logTraceStep({ call: "classify.askJson", attempt: 1, ok: false, error: "timeout" });
  const parent = await audit.logDurable(decisionEvent);

  const auditIdx = pg.queries.findIndex((q) => q.sql.includes("insert into audit_log"));
  const traceIdx = pg.queries.findIndex((q) => q.sql.includes("insert into audit_trace"));
  assert.ok(auditIdx >= 0);
  assert.ok(traceIdx > auditIdx);
  assert.equal(pg.queries[traceIdx].params[2], parent.id);
});

test("with no pgPool, logTraceStep records in memory and never touches a database", () => {
  const audit = new AuditLogger();
  const trace = audit.logTraceStep({ call: "classify.askJson", attempt: 1, ok: true });
  const parent = audit.log(decisionEvent);

  assert.equal(trace.parentId, parent.id, "pending trace is still bound in memory");
  assert.equal(audit.entries.length, 2);
  assert.equal(audit.entries[0].call, "classify.askJson");
  assert.equal(audit.entries[1].action, "auto_resolve");
});

// ---------------------------------------------------------------------------
// The classifier call site (the one real wiring, per the ticket)
// ---------------------------------------------------------------------------

test("classifyRequest records a success trace when the LLM path succeeds", async () => {
  const audit = new AuditLogger();
  await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => ({
        intent: "standard_letter",
        hasExternalUrl: false,
        requesterType: "self",
        confidence: 0.95,
        // Required by isValidClassification(): a response without it is an
        // invalid shape, because the over-scope disclosure gate cannot fire on
        // a field the model never answered. See test 17 in uc01.test.js.
        requestedFields: [],
      }),
      audit,
    }
  );

  const traces = audit.entries.filter((e) => e.call === "classify.askJson");
  assert.equal(traces.length, 1);
  assert.equal(traces[0].ok, true);
  assert.equal(traces[0].attempt, 1);
  assert.equal(traces[0].parentId, null, "parent is resolved later by the workflow's STEP 7 audit");
});

test("classifyRequest records one failure trace per retry attempt, then falls back (§4 invariant 10)", async () => {
  const audit = new AuditLogger();
  const c = await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => {
        throw new Error("connection refused");
      },
      audit,
      backoff: async () => {}, // no-op: don't wait on real backoff delays in tests
    }
  );

  assert.equal(c.source, "rule_based_fallback");
  const traces = audit.entries.filter((e) => e.call === "classify.askJson");
  assert.equal(traces.length, 3, "3 attempts (§4 invariant 10), 3 trace entries — a retry is visible, not a hidden single failure");
  for (const [i, t] of traces.entries()) {
    assert.equal(t.ok, false);
    assert.equal(t.error, "connection refused");
    assert.equal(t.attempt, i + 1);
  }
});

test("classifyRequest records one failure trace per retry attempt when the LLM shape is invalid", async () => {
  const audit = new AuditLogger();
  await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => ({ intent: "not_a_real_intent" }),
      audit,
      backoff: async () => {},
    }
  );

  const traces = audit.entries.filter((e) => e.call === "classify.askJson");
  assert.equal(traces.length, 3);
  for (const t of traces) {
    assert.equal(t.ok, false);
    assert.match(t.error, /invalid classification shape/);
  }
});

test("classifyRequest records exactly one success trace when a retry succeeds on the 2nd attempt", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const c = await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        if (attempts < 2) throw new Error("transient network blip");
        return { intent: "standard_letter", hasExternalUrl: false, requesterType: "self", confidence: 0.95, requestedFields: [] };
      },
      audit,
      backoff: async () => {},
    }
  );

  assert.equal(c.source, "llm", "a retry that succeeds is a genuine LLM result, not a fallback");
  const traces = audit.entries.filter((e) => e.call === "classify.askJson");
  assert.equal(traces.length, 2, "a 2-attempt success produces 2 trace entries, not a hidden single one");
  assert.equal(traces[0].ok, false);
  assert.equal(traces[1].ok, true);
});

test("classifyRequest records NO trace when the LLM is unconfigured — no call, no trace", async () => {
  const audit = new AuditLogger();
  await classifyRequest(
    { text: "Please send me a standard employment verification letter." },
    {
      isConfigured: () => false,
      askJson: async () => {
        throw new Error("must never be called");
      },
      audit,
    }
  );

  assert.equal(audit.entries.length, 0, "no LLM attempt happened, so nothing to trace");
});

// ---------------------------------------------------------------------------
// End to end: the workflow hands the audit logger to the classifier, and the
// trace lands bound to the STEP 7 decision row — no real services involved.
// ---------------------------------------------------------------------------

let server;
let remote;

before(async () => {
  // 4062 — was 4016, which collided with zendesk.test.js's startRemoteMock(4016)
  // under node --test's default parallel-file execution (root cause of a
  // real, reproducible EADDRINUSE flake; see the token-usage/cost-model
  // session's write-up).
  //
  // 4062 is now ALLOCATED, in src/shared/ports.js TEST_PORTS, and this comment
  // is no longer what protects it. It used to be: the port appeared in no
  // registry, so a scratch server on it cancelled all twelve tests in this
  // file — and the report said "Promise resolution is still pending but the
  // event loop has already resolved", never the word port, because the
  // listen() this line awaits simply never settles. That is the same shape as
  // the comments the registry was built to replace: sincere, unverifiable, and
  // checked against the wrong set.
  server = await startMockServer(4062);
  remote = new RemoteClient({ baseUrl: "http://localhost:4062" });
});
after(() => server && server.close());

test("end to end: a real classifier run through the workflow yields a trace bound to the decision row", async () => {
  const pg = fakePgPool();
  const audit = new AuditLogger(null, { pgPool: pg });
  const classify = (input, opts) =>
    classifyRequest(input, {
      ...opts,
      isConfigured: () => true,
      askJson: async () => ({
        intent: "standard_letter",
        hasExternalUrl: false,
        requesterType: "self",
        confidence: 0.95,
        // Required by isValidClassification(): a response without it is an
        // invalid shape, because the over-scope disclosure gate cannot fire on
        // a field the model never answered. See test 17 in uc01.test.js.
        requestedFields: [],
      }),
    });

  const r = await handleVerificationTicket(
    {
      text: "Please send me a standard employment verification letter.",
      session: { authenticatedEmail: "amara@acme.test" },
      employmentId: "emp_active_001",
      // rca-fawf/K3: an `auto_resolve` now REFUSES without a reference, and
      // this test needs the auto-resolve decision row to bind its trace to.
      externalRef: "audit-trace-1",
    },
    { remote, audit, caseStore: new CaseStore(), classify }
  );
  await audit.flush();

  assert.equal(r.decision, "auto_resolve");

  const decisionRow = audit.entries.find((e) => e.action === r.decision);
  assert.ok(decisionRow, "the decision summary row exists as before");
  const trace = audit.entries.find((e) => e.call === "classify.askJson");
  assert.ok(trace, "the classifier's LLM attempt was traced");
  assert.equal(trace.parentId, decisionRow.id, "the trace is linked to the decision row's id");
  assert.equal(trace.ok, true);

  // Both rows reached the (fake) database, parent first.
  const auditIdx = pg.queries.findIndex((q) => q.sql.includes("insert into audit_log"));
  const traceIdx = pg.queries.findIndex((q) => q.sql.includes("insert into audit_trace"));
  assert.ok(auditIdx >= 0 && traceIdx > auditIdx);
  assert.equal(pg.queries[traceIdx].params[2], decisionRow.id);
});

test("end to end: the workflow passes the audit logger to the classifier", async () => {
  const audit = new AuditLogger();
  let passedToClassifier = null;
  const spyClassify = async (input, opts) => {
    passedToClassifier = opts?.audit ?? null;
    return classifyRequestRuleBased(input);
  };

  await handleVerificationTicket(
    {
      text: "My bank sent this form, please complete it.",
      session: { authenticatedEmail: "amara@acme.test" },
      employmentId: "emp_active_001",
      hasAttachment: true,
    },
    { remote, audit, caseStore: new CaseStore(), classify: spyClassify }
  );

  assert.equal(passedToClassifier, audit, "the workflow must hand the audit logger to the classifier");
});
