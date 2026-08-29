// ---------------------------------------------------------------------------
// uc01OutOfScopeTrace.test.js — VC-31 / L-18 / DRIFT-121
// ---------------------------------------------------------------------------
// "An out-of-scope refusal leaves a trace and nothing else."
//
// READ THE VALIDATOR'S AMENDMENT 1 BEFORE CHANGING ANYTHING HERE. Its
// requirement is not merely that a trace row exists — it is that the assertion
// reads the DESTINATION, never `AuditLogger.entries`:
//
//   "An assertion against the in-memory array passes on today's code, which
//    writes nothing, and would certify the exact blindness this criterion
//    exists to remove."
//
// That is not hypothetical. `logTraceStep({parentId: null})` pushes to
// `pendingTraces`, whose only drain is the `audit_log` write path — and this
// path deliberately writes no `audit_log` row, so the entry would have sat in
// memory until the process exited. `entries` would have contained it the whole
// time. Every assertion below therefore reads the JSON-lines file, which is the
// destination when no pgPool is attached.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket, OUT_OF_SCOPE_EXCERPT_CHARS } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

let server;
let remote;
let dir;

before(async () => {
  server = await startMockServer(4124);
  remote = new RemoteClient({ baseUrl: "http://localhost:4124" });
  dir = mkdtempSync(join(tmpdir(), "uc01-oos-"));
});
after(() => {
  server && server.close();
  dir && rmSync(dir, { recursive: true, force: true });
});

/** Run one out-of-scope ticket, and return what reached the DESTINATION file. */
async function runOutOfScope(text, name = "t") {
  const filePath = join(dir, `${name}-${Math.random().toString(36).slice(2)}.jsonl`);
  const audit = new AuditLogger(filePath);
  const caseStore = new CaseStore();
  const result = await handleVerificationTicket(
    { text, employmentId: "emp_active_001", session: { authenticatedEmail: "amara@acme.test" }, source: "zendesk", externalRef: "oos-1" },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );
  await audit.flush();
  const lines = existsSync(filePath)
    ? readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { result, lines, caseStore, audit };
}

const OUT_OF_SCOPE_TEXT = "Where is the office coffee machine? Also can I get a parking permit?";

test("VC-31: exactly ONE row reaches the trace destination, and it is the out-of-scope trace", async () => {
  const { result, lines } = await runOutOfScope(OUT_OF_SCOPE_TEXT);
  assert.equal(result.decision, "out_of_scope");

  // THE DESTINATION, not the buffer. Before L-18 this file was EMPTY on this
  // path — that emptiness is what the criterion exists to remove.
  assert.equal(lines.length, 1, `expected exactly one persisted row, got ${lines.length}`);
  assert.equal(lines[0].call, "uc01.out_of_scope");
  assert.equal(lines[0].parentId, null, "a parentless trace is the point: it belongs to no decision row");
});

test("VC-31: zero rows in cases, review_queue, documents AND audit_log", async () => {
  // VC-11 unchanged. `audit_trace` is a different table, and reading D3's
  // "trace everything" as licence to write an audit_log row here would break
  // the invariant in the act of satisfying the other one.
  const { lines, caseStore } = await runOutOfScope(OUT_OF_SCOPE_TEXT);
  assert.equal(caseStore.cases.length, 0, "no case row");
  assert.equal(caseStore.reviewQueue.length, 0, "no review_queue row");
  assert.equal(caseStore.documents.length, 0, "no documents row");
  // The file carries BOTH tables' rows, so an audit_log row would appear here.
  // A trace row has a `call`; an audit_log row has a `useCase` and an `action`.
  const auditLogRows = lines.filter((l) => l.useCase !== undefined || l.action !== undefined);
  assert.deepEqual(auditLogRows, [], "no audit_log row may be written for an out-of-scope refusal");
});

test("VC-31: the trace carries the confidence, so the out-of-scope RATE is computable from it alone", async () => {
  const { lines } = await runOutOfScope(OUT_OF_SCOPE_TEXT);
  const d = lines[0].details;
  assert.equal(typeof d.confidence, "number");
  // `classificationSource` is CARRIED, and is null here on purpose: this test
  // injects `classifyRequestRuleBased` directly, and that function's own shape
  // is deliberately untagged — `classifyRequest()` adds the tag (pinned by
  // test 15 in uc01.test.js). So the trace faithfully reports "no tag was
  // supplied" rather than inventing one. On the production path, where
  // `classifyRequest()` answers, it is "llm" or "rule_based_fallback".
  //
  // Worth knowing, and NOT fixed here: the raw function being untagged means
  // `classification.source` is undefined on every surface that injects it —
  // the playground and the chat demo among them — which is issue #25's own
  // principle ("a reference implementation should never be less observable
  // than its own copy") pointing the other way from test 15. Changing it is a
  // reviewed unit of work with its own tests, not a line inside this one.
  assert.ok("classificationSource" in d, "the field must be carried even when the classifier supplied none");
  assert.equal(d.externalRef, "oos-1", "without this the row cannot be tied to the request that caused it");
});

test("VC-31 failure/recovery: the excerpt is BOUNDED — trace everything, disclose nothing extra", async () => {
  // The half that fails quietly. This text was written by somebody who reached
  // the wrong channel and may be about anything at all; a trace table is not a
  // place to keep a copy of it.
  const long = "PRIVATE ".repeat(200);
  const { lines } = await runOutOfScope(long, "long");
  assert.equal(lines[0].details.excerpt.length, OUT_OF_SCOPE_EXCERPT_CHARS);
  assert.equal(lines[0].details.excerptTruncated, true, "truncation must be visible, never silent");
  // And a short one is not padded or marked truncated.
  const { lines: shortLines } = await runOutOfScope(OUT_OF_SCOPE_TEXT, "short");
  assert.equal(shortLines[0].details.excerptTruncated, false);
});

test("DRIFT-121 regression: a parentless trace is PERSISTED, not parked in pendingTraces", async () => {
  // The defect itself, pinned directly. `logTraceStep({parentId: null})` holds
  // its entry in `pendingTraces` for a later audit_log row to adopt; on a path
  // with no such row it is never written. This asserts the standalone method
  // reaches the file AND leaves nothing waiting.
  const filePath = join(dir, `standalone-${Math.random().toString(36).slice(2)}.jsonl`);
  const audit = new AuditLogger(filePath);
  const entry = await audit.logStandaloneTraceStep({ call: "uc01.out_of_scope", details: { x: 1 } });

  assert.equal(entry.persisted, true);
  assert.equal(entry.persistError, null);
  assert.equal(audit.pendingTraces.length, 0, "nothing may be left waiting for a parent that never comes");
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].parentId, null);

  // The contrast, so this test cannot pass for the wrong reason: the ORDINARY
  // method with no parent still writes nothing and still parks the entry.
  const parked = new AuditLogger(join(dir, `parked-${Math.random().toString(36).slice(2)}.jsonl`));
  parked.logTraceStep({ call: "classify.askJson", attempt: 1, ok: true });
  assert.equal(parked.pendingTraces.length, 1);
  assert.equal(parked.entries.length, 1, "and `entries` HOLDS it — which is why asserting on entries proves nothing");
});

test("DRIFT-121 failure/recovery: an unpersistable trace and an absent one do not look alike", async () => {
  // The Validator's amendment: "if it cannot be persisted, that failure is
  // itself logged". A caller that cannot tell the difference will report a
  // silent loss as a clean run.
  const audit = new AuditLogger(null, {
    pgPool: { query: async () => { throw new Error("supabase unreachable"); } },
  });
  const entry = await audit.logStandaloneTraceStep({ call: "uc01.out_of_scope" });
  assert.equal(entry.persisted, false);
  assert.match(entry.persistError, /supabase unreachable/);

  // And with no destination configured at all, `persisted` is honestly false
  // rather than vacuously true — an in-memory run has nowhere to put it.
  const memoryOnly = new AuditLogger();
  const inMemory = await memoryOnly.logStandaloneTraceStep({ call: "uc01.out_of_scope" });
  assert.equal(inMemory.persisted, false);
  assert.equal(inMemory.persistError, null, "no destination is not an error — it is an absence");
});

test("the refusal the requester reads is unchanged, and carries no slug", async () => {
  const { result } = await runOutOfScope(OUT_OF_SCOPE_TEXT);
  assert.match(result.reply, /employment verification/i);
  assert.ok(!result.reply.includes("out_of_scope"));
});

test("the row that WOULD reach Supabase is an audit_trace insert with a NULL parent", async () => {
  // The database half of VC-31's evidence line, proved without writing to the
  // live Sandbox — this container has no credentials for it, and a Sandbox
  // write needs the owner's go-ahead in any case.
  //
  // What is checked live instead, and is the precondition this whole path rests
  // on: `audit_trace.parent_id` IS NULLABLE, with FK
  // `audit_trace_parent_id_fkey -> audit_log.id`, read from project
  // your-project-ref on 2026-08-21. A SQL foreign key permits NULL, so the
  // schema already allowed a parentless trace row and only the application
  // refused to write one. That is what makes DRIFT-121 a code fix rather than a
  // migration, unlike DRIFT-120.
  const queries = [];
  const audit = new AuditLogger(null, {
    pgPool: { query: async (sql, params) => { queries.push({ sql, params }); } },
  });
  const entry = await audit.logStandaloneTraceStep({
    call: "uc01.out_of_scope",
    details: { externalRef: "oos-db-1" },
  });

  assert.equal(entry.persisted, true);
  assert.equal(queries.length, 1, "exactly one insert, and it is not an audit_log one");
  assert.match(queries[0].sql, /insert into audit_trace/i);
  assert.ok(!/insert into audit_log/i.test(queries[0].sql));
  // parent_id is the third bound parameter in #writeTraceToDb's column order
  // (id, at, parent_id, call, attempt, ok, error, details).
  assert.equal(queries[0].params[2], null, "the parent id must go in as NULL, not as a string");
  assert.equal(queries[0].params[3], "uc01.out_of_scope");
});
