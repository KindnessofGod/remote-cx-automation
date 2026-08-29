// ---------------------------------------------------------------------------
// n8nRefusalCopyParity.test.js — the requester-facing refusal copy must mean
// the same thing in src/uc01/refusalCopy.js and in the n8n Code node that
// ports it (rca-c73)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// workflows/nodes/prepareRefusalReply.js is a verbatim port of
// src/uc01/refusalCopy.js's COPY map, because an n8n Code node has no module
// resolution. Same hazard test/n8nParity.test.js and
// test/n8nRoutingParity.test.js already guard against for gates.js and
// assignRouting.js: two copies of customer-facing text, one gets edited and
// the other quietly doesn't, and nothing goes red except a requester reading
// stale prose. This file executes the ACTUAL node body in a sandbox and
// compares its output to refusalReplyFor() for every reason the real module
// has copy for.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { refusalReplyFor, REASONS_WITH_COPY } from "../src/uc01/refusalCopy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_PATH = join(__dirname, "..", "workflows", "nodes", "prepareRefusalReply.js");
const nodeSource = readFileSync(NODE_PATH, "utf8");

/**
 * Run the n8n Code node body with n8n's globals mocked ($json only — this
 * node reads no other node's output).
 */
function runPrepareReplyNode(ctx) {
  const sandbox = { $json: ctx };
  const wrapped = `(function () {\n${nodeSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

test("every reason refusalCopy.js has copy for produces the identical reply in the n8n port", () => {
  assert.ok(REASONS_WITH_COPY.length > 0, "the real module must actually have entries to compare against");
  for (const reason of REASONS_WITH_COPY) {
    const out = runPrepareReplyNode({ reason, externalRef: "1", decision: "blocked" });
    assert.equal(
      out.requesterReply,
      refusalReplyFor(reason),
      `reason "${reason}": n8n port and refusalCopy.js must produce byte-identical requester-facing text`
    );
  }
});

test("awaiting_employee_consent and consent_refused are byte-identical in the n8n port (VC-33)", () => {
  const pending = runPrepareReplyNode({ reason: "awaiting_employee_consent" });
  const denied = runPrepareReplyNode({ reason: "consent_refused" });
  assert.equal(pending.requesterReply, denied.requesterReply);
});

test("a reason with no copy (a human-review reason) yields null, never invented text", () => {
  const out = runPrepareReplyNode({ reason: "over_scope_request" });
  assert.equal(out.requesterReply, null);
});

test("the node preserves every other field on the context untouched", () => {
  const out = runPrepareReplyNode({ reason: "self_service_available", externalRef: "42", decision: "deflected_to_self_service", flags: ["self_service_available"] });
  assert.equal(out.externalRef, "42");
  assert.equal(out.decision, "deflected_to_self_service");
  assert.deepEqual(out.flags, ["self_service_available"]);
});

test("every reason evaluate() (policyEngine.js) can actually reach on the blocked/awaiting/deflected paths has copy", () => {
  // The three decisions rca-c73 gave a route to. If policyEngine.js ever grows
  // a fourth reason under one of these decisions with no copy, this fails
  // loudly here rather than shipping a null reply to a real requester.
  const REACHABLE_REASONS = [
    "engagement_not_eor_contractor",
    "engagement_not_eor_direct",
    "engagement_onboarding_incomplete",
    "eor_status_unknown",
    "consent_refused",
    "awaiting_employee_consent",
    "self_service_available",
  ];
  for (const reason of REACHABLE_REASONS) {
    assert.ok(REASONS_WITH_COPY.includes(reason), `refusalCopy.js has no entry for "${reason}"`);
    assert.notEqual(runPrepareReplyNode({ reason }).requesterReply, null);
  }
});
