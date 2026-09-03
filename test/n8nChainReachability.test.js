// ---------------------------------------------------------------------------
// n8nChainReachability.test.js — can the automation still automate anything?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// test/n8nParity.test.js runs the gates node against policyEngine.evaluate()
// and proves they agree. It feeds BOTH of them the same hand-built
// classification object — one that always includes `requestedFields`.
//
// On 2026-08-16 that turned out to prove less than it looked like. The gates
// node was synced to require `requestedFields` (fail closed: an absent answer
// is not "no"). The two nodes UPSTREAM of it — which build the LLM prompt and
// validate the reply — were not synced, and neither of them produced that key.
// So every real ticket failed closed to `over_scope_undetermined`, and UC-01
// could not auto-resolve at all. Proven on live ticket #15.
//
// Every individual node was correct. The parity test passed. The suite was
// green. The automation was dead, because the parity test supplied by hand the
// exact field the real chain had stopped producing.
//
// This file closes that seam: it runs the THREE real node bodies in sequence,
// the way n8n does, with only a simulated Zendesk ticket and a simulated
// OpenAI response as input — and asserts that a plain, well-formed request can
// still reach `auto_resolve`.
//
// A system whose happy path is unreachable is not "safe", it is broken. Failing
// closed everywhere is indistinguishable from being switched off, and nothing
// else in this suite can tell those two apart.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeSource = (name) =>
  readFileSync(join(__dirname, "..", "workflows", "nodes", `${name}.js`), "utf8");

const NORMALIZE = nodeSource("normalizeTicket");
const VALIDATE = nodeSource("validateClassification");
const GATES = nodeSource("gates");

/** n8n wraps a Code node body in a function; a bare `return` needs one. */
const run = (source, sandbox) =>
  JSON.parse(JSON.stringify(vm.runInNewContext(`(function () {\n${source}\n})()`, sandbox, { timeout: 5000 })));

/**
 * Drive the real chain: Normalize Ticket → (OpenAI) → Validate Classification
 * → (Remote) → Identity + Policy Gates.
 *
 * `llmContent` stands in for the model's reply. Passing `null` simulates the
 * HTTP node erroring, which is exactly when the rule-based fallback must fire.
 */
function runChain({ ticket, employmentResponse, llmContent }) {
  const normalized = run(NORMALIZE, {
    $input: { first: () => ({ json: { body: { ticket } } }) },
  })[0].json;

  const openAiResponse = llmContent === null
    ? {}
    : { choices: [{ message: { content: JSON.stringify(llmContent) } }] };

  const validated = run(VALIDATE, {
    $: (n) => {
      if (n !== "Normalize Ticket") throw new Error(`unexpected $(${n})`);
      return { first: () => ({ json: normalized }) };
    },
    $input: { first: () => ({ json: openAiResponse }) },
  })[0].json;

  const gated = run(GATES, {
    $: (n) => {
      if (n !== "Validate Classification") throw new Error(`unexpected $(${n})`);
      return { first: () => ({ json: validated }) };
    },
    $input: { first: () => ({ json: employmentResponse }) },
  })[0].json;

  return { normalized, validated, gated };
}

// The employment id field id is account-specific and lives in the node source.
const FIELD_ID = Number(/EMPLOYMENT_FIELD_ID = (\d+)/.exec(NORMALIZE)[1]);

const ticketFor = (text, over = {}) => ({
  id: 4242,
  subject: text,
  description: "",
  requester: { email: "ada.lovelace@example.com" },
  custom_fields: [{ id: FIELD_ID, value: "emp_001" }],
  ...over,
});

const activeEmployment = {
  data: {
    employment: {
      id: "emp_001",
      status: "active",
      employment_model: "full_time",
      basic_information: {
        name: "Ada Lovelace",
        email: "ada.lovelace@example.com",
        provisional_start_date: "2023-01-15",
      },
    },
  },
};

const goodLlmReply = {
  intent: "standard_letter",
  hasExternalUrl: false,
  requesterType: "self",
  confidence: 0.95,
  requestedFields: [],
};

test("1. auto_resolve is REACHABLE through the real node chain", () => {
  const { gated } = runChain({
    ticket: ticketFor("Please send me a standard employment verification letter."),
    employmentResponse: activeEmployment,
    llmContent: goodLlmReply,
  });

  assert.equal(
    gated.decision,
    "auto_resolve",
    `The happy path must survive end to end. Got ${gated.decision} / ${gated.reason}. ` +
      `If this is over_scope_undetermined, the prompt and validator have stopped ` +
      `producing a field the gates require — the exact live failure of 2026-08-16.`
  );
  assert.equal(gated.reason, "all_gates_passed");
  assert.deepEqual(gated.flags, []);
});

test("2. the chain still auto_resolves when the LLM is unreachable", () => {
  // The rule-based fallback must produce every field the gates need, or an
  // OpenAI outage silently disables the automation instead of degrading it.
  const { validated, gated } = runChain({
    ticket: ticketFor("Please send me a standard employment verification letter."),
    employmentResponse: activeEmployment,
    llmContent: null,
  });

  assert.equal(validated.classification.source, "rule_based_fallback");
  assert.ok(
    Array.isArray(validated.classification.requestedFields),
    "the fallback must answer the over-scope question, not omit it"
  );
  assert.equal(gated.decision, "auto_resolve", "an LLM outage must degrade, not disable");
});

test("3. a model reply missing requestedFields falls back rather than auto-resolving on an unanswered question", () => {
  const { validated, gated } = runChain({
    ticket: ticketFor("Please send me a standard employment verification letter."),
    employmentResponse: activeEmployment,
    llmContent: { intent: "standard_letter", hasExternalUrl: false, requesterType: "self", confidence: 0.95 },
  });

  // The key point: the validator REJECTS the shape and the deterministic
  // fallback answers instead — so the decision rests on something that actually
  // examined the text, not on a missing key read as "nothing was asked for".
  assert.equal(validated.classification.source, "rule_based_fallback");
  assert.equal(gated.decision, "auto_resolve");
});

test("4. an over-scope request still reaches a human through the real chain", () => {
  // The gate this whole seam exists to protect. Asking for salary must route to
  // a human whether the model flags it or the fallback detects it.
  for (const llmContent of [
    { ...goodLlmReply, requestedFields: ["salary"] },
    null, // fallback path: detectRequestedFields() must catch the word itself
  ]) {
    const { gated } = runChain({
      ticket: ticketFor("Please send a verification letter and include my salary."),
      employmentResponse: activeEmployment,
      llmContent,
    });
    assert.equal(gated.decision, "human_review");
    assert.equal(gated.reason, "over_scope_request");
    assert.ok(gated.flags.includes("over_scope_disclosure_requested"));
  }
});

test("5. the node chain agrees with the deployed employment-id field", () => {
  // A custom-field id does not survive a Zendesk account change, and this file
  // held the RETIRED id while the deployed node held the live one. A ticket
  // carrying the live field must normalize, not throw.
  assert.equal(FIELD_ID, 9990000000001, "field id must match the live your-subdomainhelp account");

  assert.throws(
    () => runChain({
      ticket: ticketFor("letter please", { custom_fields: [{ id: 999, value: "x" }] }),
      employmentResponse: activeEmployment,
      llmContent: goodLlmReply,
    }),
    /no Remote employment id/,
    "an unidentifiable ticket must throw, never guess which employee it is about"
  );
});
