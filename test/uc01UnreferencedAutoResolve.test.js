// ---------------------------------------------------------------------------
// uc01UnreferencedAutoResolve.test.js — rca-fawf / R7-26 / K3
// ---------------------------------------------------------------------------
// THE RULE THIS PINS
// "An `auto_resolve` that carries no `externalRef` is REFUSED, on BOTH
// execution paths." Owner ruling, 2026-08-23, recorded in
// qa/HUMAN-DECISIONS-REQUIRED.md §K3. The declined alternative was to let such
// a decision stand and attribute it with `source` + `caseId`.
//
// WHY IT IS A RULE. Round 7 observed three live `auto_resolve` rows with
// `externalRef: null` — a letter stating somebody's employment, with nothing
// naming the request that asked for it. The second consequence is the sharper
// one: `src/uc01/workflow.js`'s idempotency claim runs only when there IS a
// reference (there is nothing else to key a claim on), so an unreferenced
// decision skipped the exactly-once ledger entirely and a redelivery would
// have issued a second letter unopposed — the defect real Zendesk ticket #5
// already caused once.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT REFUSES TO ASSERT
// Only OBSERVABLE OUTPUT: the returned result, the rows that reach the case
// store, the lines that reach the audit destination FILE, and the calls that
// reach the Zendesk client. Never an internal branch, never a flag the test
// itself injected. Every negative is paired with a POSITIVE CONTROL that
// differs only in the presence of the reference — without that pair, a
// refusal caused by a broken fixture and a refusal caused by this guard are
// indistinguishable, which is the failure shape this project has paid for
// before (a "confident zero" from a half-broken detector).
//
// NO PORT IS BOUND. The Remote client is a local fake, so this file appears in
// neither `TEST_PORTS` nor the reserved band — see `test/ports.test.js`'s
// "every port a test file claims is declared" check.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixtures — one record that passes every gate, so the ONLY thing separating
// the two halves of each pair below is the reference.
// ---------------------------------------------------------------------------

const CLEAN_EMPLOYMENT = {
  id: "emp_unref_001",
  status: "active",
  contract_type: "employee",
  email: "ada.lovelace@example.com",
  full_name: "Ada Lovelace",
  start_date: "2023-01-15",
  job_title: "Principal Engineer",
  legal_entity_id: "le_1",
  company_id: "co_1",
};

/** A RemoteClient stand-in — no socket, so this file claims no port. */
function fakeRemote(employment = CLEAN_EMPLOYMENT) {
  return {
    async getEmployment() {
      return employment;
    },
    async getLegalEntity() {
      return { name: "Acme Inc.", country_code: "US" };
    },
  };
}

/**
 * The requester is identified by EMAIL, not by an authenticated Remote
 * session id: G-2 deflects an authenticated Remote session to self-service
 * (`deflected_to_self_service`), so an email session is the only shape that
 * actually reaches `auto_resolve`. Getting this wrong would make every
 * "positive control" below silently prove nothing.
 */
const EMAIL_SESSION = { authenticatedEmail: CLEAN_EMPLOYMENT.email };

const STANDARD_TEXT = "Please send me a standard employment verification letter.";

/** Records every call, so "no customer-facing act happened" is checkable. */
function zendeskSpy() {
  const calls = [];
  const record = (name) => async (...args) => {
    calls.push({ name, args });
    return { ok: true };
  };
  return {
    calls,
    resolveWithLetter: record("resolveWithLetter"),
    replyAndSolve: record("replyAndSolve"),
    flagForReview: record("flagForReview"),
    addNote: record("addNote"),
    escalate: record("escalate"),
  };
}

/**
 * One run, with the audit destination pointed at a real file so the assertion
 * is about what was PERSISTED rather than about an in-memory array a
 * background write may never have reached.
 */
async function run(ticketOver, { employment = CLEAN_EMPLOYMENT, zendesk = null, caseStore = new CaseStore() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "uc01-unref-"));
  const filePath = join(dir, "audit.jsonl");
  const audit = new AuditLogger(filePath);
  try {
    const result = await handleVerificationTicket(
      { text: STANDARD_TEXT, employmentId: employment.id, session: EMAIL_SESSION, source: "zendesk", ...ticketOver },
      { remote: fakeRemote(employment), audit, caseStore, classify: classifyRequestRuleBased, zendesk }
    );
    await audit.flush();
    const lines = existsSync(filePath)
      ? readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return { result, lines, caseStore };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A persisted decision row has a `useCase` + `action`; a trace row has a `call`. */
const decisionRows = (lines) => lines.filter((l) => l.action && l.useCase);
const traceRows = (lines) => lines.filter((l) => l.call);

// ---------------------------------------------------------------------------
// THE NODE PATH — src/uc01/workflow.js STEP 5b
// ---------------------------------------------------------------------------

test("POSITIVE CONTROL: with a reference, this exact ticket auto-resolves and issues a letter", async () => {
  const { result, lines, caseStore } = await run({ externalRef: "unref-control-1" });

  assert.equal(result.decision, "auto_resolve");
  assert.equal(result.reason, "all_gates_passed");
  assert.match(result.letterHtml, /Employment Verification Letter/);
  assert.equal(caseStore.cases.length, 1);
  assert.equal(caseStore.documents.length, 1);
  assert.ok(
    decisionRows(lines).some((l) => l.action === "auto_resolve" && l.details?.externalRef === "unref-control-1"),
    "the control must really reach the auto-resolve row, or the refusal below proves nothing"
  );
});

test("K3: the SAME ticket with no reference is REFUSED — no letter, and the decision names the delivery", async () => {
  const { result } = await run({ externalRef: undefined });

  assert.equal(result.decision, "refused");
  assert.equal(result.reason, "unreferenced_request");
  assert.equal(result.letterHtml, undefined, "a refusal must not render the artifact it refused to issue");
  assert.ok(result.flags.includes("unreferenced_request"));
  // The refusal is its OWN decision, not one of the existing ones: `blocked`
  // is G-1's engagement refusal and `out_of_scope` is the classifier's, and
  // folding a delivery failure into either would corrupt the rate of both.
  assert.notEqual(result.decision, "blocked");
  assert.notEqual(result.decision, "out_of_scope");
});

test("K3: a refused request writes NO decision row and NO case, review or document row", async () => {
  const { lines, caseStore, result } = await run({ externalRef: null });

  assert.equal(result.decision, "refused");
  // The whole point of the ruling: refuse RATHER THAN write a decision
  // nothing can be traced to. An `audit_log` row here would be the very thing
  // being refused.
  assert.deepEqual(decisionRows(lines), [], "no audit_log decision row may be written for a refused request");
  assert.equal(caseStore.cases.length, 0);
  assert.equal(caseStore.reviewQueue.length, 0);
  assert.equal(caseStore.documents.length, 0);
});

test("K3: the refusal is still TRACED — exactly one parentless trace row, marked not-ok", async () => {
  const { lines } = await run({ externalRef: null });

  const traces = traceRows(lines);
  assert.equal(traces.length, 1, "a refusal nobody can count is a refusal nobody can see going up");
  assert.equal(traces[0].call, "uc01.unreferenced_auto_resolve");
  assert.equal(traces[0].ok, false);
  assert.equal(traces[0].parentId, null, "there is no decision row for it to belong to — that is the point");
  assert.equal(traces[0].details.externalRef, null);
  // The row says what was WITHHELD, so a reader learns which outcome was
  // refused rather than only that something was.
  assert.equal(traces[0].details.withheldDecision, "auto_resolve");
  assert.equal(traces[0].details.reason, "unreferenced_request");
});

test("K3: nothing customer-facing happens — the Zendesk client is never called", async () => {
  const zendesk = zendeskSpy();
  const { result } = await run({ externalRef: null }, { zendesk });

  assert.equal(result.decision, "refused");
  assert.deepEqual(zendesk.calls, [], "a refused request must not reach the customer at all");
});

test("K3 (the second consequence): a redelivery cannot produce a second letter — refusal is idempotent", async () => {
  // The defect this closes: the idempotency claim keys on the reference, so an
  // unreferenced decision skipped the exactly-once ledger and a redelivery had
  // nothing in its way. Driving the same unreferenced request twice through
  // ONE shared store is the observable form of that — real ticket #5 produced
  // two audit_log rows and two public letters exactly this way.
  const caseStore = new CaseStore();
  const first = await run({ externalRef: null }, { caseStore });
  const second = await run({ externalRef: null }, { caseStore });

  assert.equal(first.result.decision, "refused");
  assert.equal(second.result.decision, "refused");
  assert.equal(first.result.letterHtml, undefined);
  assert.equal(second.result.letterHtml, undefined);
  assert.equal(caseStore.cases.length, 0, "two deliveries, zero rows — nothing to duplicate");
  assert.equal(caseStore.documents.length, 0, "two deliveries, zero letters");
});

test("K3 is NARROW: an unreferenced request that would NOT auto-resolve is unaffected", async () => {
  // Only `auto_resolve` was ruled on. Every other outcome either hands the
  // request to a named human or refuses it outright, and widening this guard
  // would refuse work nobody has ruled on. A contractor is `blocked` by G-1
  // long before the delivery is considered.
  const contractor = { ...CLEAN_EMPLOYMENT, id: "emp_unref_ct", contract_type: "contractor" };
  const { result, caseStore, lines } = await run({ externalRef: null }, { employment: contractor });

  assert.equal(result.decision, "blocked");
  assert.equal(result.reason, "engagement_not_eor_contractor");
  assert.equal(caseStore.cases.length, 1, "a non-auto_resolve outcome still records its decision");
  assert.ok(decisionRows(lines).some((l) => l.action === "blocked"));
});

test("K3 is NARROW: an unreferenced human_review still records and still queues", async () => {
  const { result, caseStore } = await run({
    externalRef: null,
    text: "Please confirm my employment and include my exact gross salary and bank details.",
  });

  assert.equal(result.decision, "human_review");
  assert.equal(caseStore.cases.length, 1);
  assert.equal(caseStore.reviewQueue.length, 1, "a specialist still owns it — the guard did not swallow it");
});

// ---------------------------------------------------------------------------
// THE n8n PATH — workflows/nodes/gates.js, the "Identity + Policy Gates" node
// on the live graph WORKFLOW_UC01_ID
// ---------------------------------------------------------------------------
//
// The SAME rule has to hold on the deployed graph, and a fix on one path only
// is not this bead. This executes the real node body — the bytes that are
// deployed — in a sandbox, exactly as test/n8nParity.test.js does.
//
// The refusal there is a THROW rather than a returned decision, and that is
// forced by the graph rather than chosen: this node is the last one before
// "Claim Ticket (Idempotency)", and every decision value except `out_of_scope`
// flows on through "Persist Case" and "Append Audit Log", writing the very row
// the ruling refuses. A throw stops the run before any of it, and
// `RCX OPS · Error Alerts` still records the refusal durably.

const gatesSource = readFileSync(join(__dirname, "..", "workflows", "nodes", "gates.js"), "utf8");

function runGatesNode({ ctx, employment = CLEAN_EMPLOYMENT }) {
  const employmentResponse = { data: { employment } };
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Validate Classification") return { first: () => ({ json: ctx }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      if (nodeName === "Lookup Consent Records") throw new Error(`No node named "${nodeName}" was found`);
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    $input: { first: () => ({ json: employmentResponse }) },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const gatesCtx = (over = {}) => ({
  source: "zendesk",
  externalRef: "1001",
  employmentId: CLEAN_EMPLOYMENT.id,
  text: STANDARD_TEXT,
  session: { authenticatedEmail: CLEAN_EMPLOYMENT.email },
  consentRecord: null,
  classification: {
    intent: "standard_letter",
    confidence: 0.95,
    requestedFields: ["full_name", "start_date"],
    hasAttachment: false,
    hasExternalUrl: false,
    requesterType: "self",
  },
  ...over,
});

test("POSITIVE CONTROL (n8n): with a reference, the deployed gate body reaches auto_resolve", () => {
  const out = runGatesNode({ ctx: gatesCtx() });
  assert.equal(out.decision, "auto_resolve");
  assert.equal(out.reason, "all_gates_passed");
});

test("K3 (n8n): the SAME context with no reference REFUSES — the node throws before any durable write", () => {
  assert.throws(
    () => runGatesNode({ ctx: gatesCtx({ externalRef: null }) }),
    /uc01_unreferenced_auto_resolve/,
    "the n8n half of the ruling: a fix on the Node path alone is not this bead"
  );
  // An absent key must fail the same way a null one does — "not supplied" and
  // "supplied as nothing" are the same delivery.
  const noKey = gatesCtx();
  delete noKey.externalRef;
  assert.throws(() => runGatesNode({ ctx: noKey }), /uc01_unreferenced_auto_resolve/);
  assert.throws(() => runGatesNode({ ctx: gatesCtx({ externalRef: "" }) }), /uc01_unreferenced_auto_resolve/);
});

test("K3 is NARROW (n8n): an unreferenced non-auto_resolve outcome still flows", () => {
  const contractor = { ...CLEAN_EMPLOYMENT, contract_type: "contractor" };
  const out = runGatesNode({ ctx: gatesCtx({ externalRef: null }), employment: contractor });
  assert.equal(out.decision, "blocked");
  assert.equal(out.reason, "engagement_not_eor_contractor");
});
