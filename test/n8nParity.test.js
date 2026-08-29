// ---------------------------------------------------------------------------
// n8nParity.test.js — the n8n Code node and policyEngine.js must agree
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-01's decision logic exists twice: once as src/uc01/policyEngine.js (used
// by the tests, the demo and the Node workflow) and once as the "Identity +
// Policy Gates" Code node in the n8n workflow. Two copies of the most
// safety-critical code in the system is a real risk — the usual outcome is
// that one gets fixed and the other quietly doesn't.
//
// Rather than pretend the duplication isn't there, this test executes the
// ACTUAL n8n node body (workflows/nodes/gates.js) in a sandbox and asserts it
// reaches the same decision, reason and flags as policyEngine.evaluate() for
// every scenario. If someone edits one and not the other, this fails.
//
// It also catches the bug class that bit this workflow once already: the first
// deployed version had `/https?:\/\//` collapse into `/https?:///`, which
// JavaScript parses as a regex followed by a comment. The node still "ran",
// but a boolean had silently become a RegExp object. Executing the real source
// here means a syntax or semantics break shows up as a failing test rather
// than as wrong decisions in production.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate } from "../src/uc01/policyEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes", "gates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

/**
 * Run the n8n Code node body with n8n's globals mocked.
 *
 * The node ends in a bare `return`, which is only legal inside a function, so
 * the source is wrapped in one — exactly what n8n itself does.
 */
function runGatesNode({ ctx, employmentResponse, consentRows = null }) {
  const sandbox = {
    // $('Node Name').first().json — n8n's cross-node accessor
    $: (nodeName) => {
      if (nodeName === "Validate Classification") return { first: () => ({ json: ctx }) };
      // rca-wn30: the employment response is now read by NAME, because
      // "Lookup Consent Records" sits between the fetch and the gates and
      // therefore owns `$input`. gates.js still falls back to `$input`, so
      // this branch existing is what proves the PRIMARY read works rather
      // than the fallback quietly carrying every test.
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      // `consentRows: null` models the node NOT being on the graph — n8n's
      // `$()` throws for a node that does not exist or has not run, which is
      // exactly what the live graph did before this bead and what gates.js
      // must keep degrading safely from.
      if (nodeName === "Lookup Consent Records") {
        if (consentRows === null) throw new Error(`No node named "${nodeName}" was found`);
        return { all: () => consentRows.map((json) => ({ json })) };
      }
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    // $input.first().json — the incoming item (the Remote API response)
    $input: { first: () => ({ json: employmentResponse }) },
  };

  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  // Round-trip through JSON before returning. Objects built inside a vm context
  // belong to a different realm, so their Array/Object prototypes are not the
  // ones assert.deepEqual compares against and every comparison would fail on
  // prototype identity rather than on content. This also mirrors what n8n
  // actually does between nodes, so the test sees the same shape production does.
  return JSON.parse(JSON.stringify(result[0].json));
}

/** The real Remote API shape (nested), so normalizeEmployment() is exercised. */
const remoteResponse = (over = {}) => ({
  data: {
    employment: {
      id: "emp_active_001",
      status: "active",
      company_id: "co_1",
      engaged_by_legal_entity_id: "le_1",
      employment_model: "full_time",
      // REAL API SHAPE. This fixture used to carry `start_date`, a field the
      // Remote API does not return on any employment record — the date is
      // `provisional_start_date`. An invented fixture meant the gates node's
      // start-date mapping was never actually exercised against the shape it
      // receives in production, so it read null on every real record and the
      // letter printed a blank. A fixture that does not match the API proves
      // the two implementations agree about a world that does not exist.
      basic_information: {
        name: "Ada Lovelace",
        email: "ada.lovelace@example.com",
        provisional_start_date: "2023-01-15",
      },
      ...over,
    },
  },
});

const ctxFor = (classification, over = {}) => ({
  source: "zendesk",
  externalRef: "1001",
  employmentId: "emp_active_001",
  text: "Please send me a standard employment verification letter.",
  session: { authenticatedEmail: "ada.lovelace@example.com" },
  consentRecord: null,
  classification,
  ...over,
});

/** A consent_records row shaped as caseStore.js returns it (camelCase). */
const consentRow = (over = {}) => ({
  id: "cr_1",
  status: "granted",
  grantedByEmploymentId: "emp_active_001",
  requestingParty: "First Bank",
  purpose: "Mortgage application",
  grantedAt: "2026-08-21T12:00:00.000Z",
  ...over,
});

// requestedFields is present by default because BOTH copies now fail closed
// without it (F-17): the classifier is the thing that must always answer the
// over-scope question, and a classification that didn't is a human's call.
// The explicitly-absent case is its own scenario below.
const classify = (over = {}) => ({
  intent: "standard_letter",
  hasExternalUrl: false,
  requesterType: "self",
  confidence: 0.95,
  hasAttachment: false,
  requestedFields: [],
  ...over,
});

/**
 * Every scenario from docs/use-cases/UC-01.md §12, expressed so both
 * implementations receive equivalent inputs.
 */
const SCENARIOS = [
  // --- G-1: engagement eligibility. All FIVE outcomes, which is `L-4`'s own
  // --- done-criterion. Each has to reach its OWN reason in both copies: a
  // --- single `not_eligible` would let one copy refuse for the wrong cause and
  // --- still compare equal on the decision.
  {
    name: "G-1 independent contractor → blocked / engagement_not_eor_contractor",
    classification: classify(),
    employmentOver: { employment_model: "contractor" },
  },
  {
    name: "G-1 global payroll (non-EOR) → blocked / engagement_not_eor_direct",
    classification: classify(),
    employmentOver: { employment_model: "global_payroll" },
  },
  {
    name: "G-1 onboarding not finalised → blocked / engagement_onboarding_incomplete",
    classification: classify(),
    employmentOver: { status: "pending" },
  },
  {
    name: "G-1 offboarding in progress → escalate / engagement_offboarding",
    classification: classify(),
    employmentOver: { status: "offboarding" },
  },
  {
    name: "G-1 engagement type unreadable → blocked / eor_status_unknown (fails CLOSED)",
    classification: classify(),
    employmentOver: { employment_model: null, type: null },
  },
  {
    name: "G-1 an engagement type nobody has heard of → blocked, never assumed eligible",
    classification: classify(),
    employmentOver: { employment_model: "apprentice_scheme" },
  },
  // --- G-2: the deflection, and the POSITIVE proof auto-issue survives it.
  {
    name: "G-2 signed in to Remote → deflected_to_self_service",
    classification: classify(),
    // rca-43z: this MUST be the fixture's own employment id ("emp_active_001",
    // see `remoteResponse()` above), not an arbitrary placeholder. Before
    // gates.js derived requesterType, `authenticatedEmploymentId` was never
    // compared to `employment.id` on the n8n side at all — only
    // `authenticatedEmail` was — so a placeholder id like "emp_1" silently
    // exercised nothing. Now that both sides run deriveRequesterType(), a
    // mismatched authenticatedEmploymentId derives `third_party`
    // (`session_names_another_employment`) and the scenario would stop
    // reaching G-2 entirely — passing this test for the wrong reason (both
    // copies agreeing on an unrelated `awaiting_employee_consent`) rather than
    // exercising the deflection this scenario is named for.
    ctxOver: { session: { authenticatedEmploymentId: "emp_active_001", authenticatedEmail: "ada.lovelace@example.com" } },
  },
  {
    name: "§12.1 active employee, standard request → auto_resolve",
    classification: classify(),
  },
  {
    name: "§12.2 terminated employee → escalate",
    classification: classify(),
    employmentOver: { status: "terminated" },
  },
  {
    name: "§12.3 uploaded bank form → human_review",
    classification: classify({ hasAttachment: true }),
  },
  {
    name: "§12.4 external verification portal URL → human_review",
    classification: classify({ hasExternalUrl: true }),
  },
  {
    name: "§12.5a / VC-06 third party, nobody has answered yet → awaiting_employee_consent (NOT a refusal)",
    classification: classify({ requesterType: "third_party" }),
    ctxOver: { session: null, consentRecord: null },
  },
  {
    name: "§12.5b / VC-07 third party WITH a GRANTED, COMPLETE consent artifact → human_review, never zero-touch",
    classification: classify({ requesterType: "third_party" }),
    ctxOver: { session: null, consentRecord: consentRow() },
  },
  {
    name: "VC-08 third party whose consent was DENIED → blocked / consent_refused",
    classification: classify({ requesterType: "third_party" }),
    ctxOver: { session: null, consentRecord: consentRow({ status: "denied" }) },
  },
  {
    name: "VC-30 an INCOMPLETE 'granted' row (missing purpose) is treated as pending, never trusted",
    classification: classify({ requesterType: "third_party" }),
    ctxOver: { session: null, consentRecord: consentRow({ purpose: null }) },
  },
  {
    name: "VC-06 a third party signed in as a DIFFERENT employee, no consent → awaiting_employee_consent (still pending, more specific reason)",
    classification: classify({ requesterType: "third_party" }),
    ctxOver: { session: { authenticatedEmail: "someone.else@example.com" }, consentRecord: null },
  },
  {
    name: "§12.6 low confidence → human_review",
    classification: classify({ confidence: 0.6 }),
  },
  {
    name: "non-standard intent → human_review",
    classification: classify({ intent: "non_standard" }),
  },
  {
    // rca-43z: NOT `escalate` any more. `deriveRequesterType()` fails closed
    // to `third_party` on ANY absent authenticated signal (VC-29,
    // `no_authenticated_signal`) — that was already true on the Node path
    // (src/shared/identity.js) and is now ported to gates.js too, so an
    // unauthenticated ticket lands on the pending consent regime on BOTH
    // paths, not the old self-path's `no_authenticated_requester` refusal.
    // `expectDecision`/`expectReason` are asserted directly (not just
    // cross-copy agreement) so a future regression that made both copies
    // agree on the WRONG thing would still be caught.
    name: "unauthenticated requester → awaiting_employee_consent (fails closed to third-party, rca-43z)",
    classification: classify(),
    ctxOver: { session: null },
    expectDecision: "awaiting_employee_consent",
    expectReason: "awaiting_employee_consent",
  },
  {
    // rca-43z / the bug this bead exists for (ticket #109's exact shape): a
    // requester whose authenticated email does NOT match the employment
    // record's email now derives `third_party` (`requester_email_does_not_match`)
    // on BOTH paths, and identity.pending routes to `awaiting_employee_consent`
    // — never the old `escalate` / `identity_not_verified` gates.js used to
    // reach by trusting the classifier's raw (defaulted-to-self) opinion.
    name: "requester email does not match the record → awaiting_employee_consent (rca-43z, was wrongly `escalate`)",
    classification: classify(),
    ctxOver: { session: { authenticatedEmail: "someone.else@example.com" } },
    expectDecision: "awaiting_employee_consent",
    expectReason: "awaiting_employee_consent",
  },
  // The completeness gate, in both copies. Without these the gate would only
  // ever be exercised on its passing branch, so a divergence in the refusal
  // branch could ship undetected — which is the whole point of this file.
  {
    name: "no start date on the record → human_review, never a blank letter row",
    classification: classify(),
    employmentOver: { basic_information: { name: "Ada Lovelace", email: "ada.lovelace@example.com" } },
  },
  {
    name: "no name on the record → human_review",
    classification: classify(),
    employmentOver: {
      basic_information: { email: "ada.lovelace@example.com", provisional_start_date: "2023-01-15" },
    },
  },
  {
    name: "no contract type on the record → human_review",
    classification: classify(),
    employmentOver: { employment_model: null },
  },
  {
    name: "over-scope disclosure request (salary) → human_review",
    classification: classify({ requestedFields: ["salary"] }),
  },
  {
    name: "out-of-scope request → out_of_scope",
    classification: classify({ intent: "out_of_scope" }),
  },
  // --- THE CROSS-PRODUCT. Every fixture above sets ONE condition at a time,
  // and all three known parity divergences in this repo have been gate
  // ORDERING, which by definition needs two conditions true together. The
  // over-scope reorder landed in src/uc01/policyEngine.js and not in
  // workflows/nodes/gates.js, so the live graph recorded `non_standard_request`
  // for every over-scope ticket and this suite stayed green. A one-at-a-time
  // fixture table cannot see an ordering bug.
  {
    name: "ORDERING: non-standard intent AND an over-scope field → the SPECIFIC reason, not the generic one",
    classification: classify({ intent: "non_standard", requestedFields: ["compensation"] }),
  },
  {
    name: "ORDERING: non-standard intent AND requestedFields absent → over_scope_undetermined, not non_standard_request",
    classification: (() => {
      const c = classify({ intent: "non_standard" });
      delete c.requestedFields;
      return c;
    })(),
  },
  // --- F-17 / F-19: both copies must fail CLOSED on an unanswered question ---
  {
    name: "F-17 requestedFields absent → human_review (never a silent 'nothing was asked for')",
    classification: (() => {
      const c = classify();
      delete c.requestedFields;
      return c;
    })(),
  },
  {
    name: "F-17 requestedFields is not an array → human_review",
    classification: classify({ requestedFields: "salary" }),
  },
  {
    name: "F-17 requestedFields contains a non-string → human_review",
    classification: classify({ requestedFields: ["salary", 7] }),
  },
  {
    name: "F-17 an explicit empty array still auto_resolves — failing closed did not break the happy path",
    classification: classify({ requestedFields: [] }),
  },
  {
    name: "F-19 confidence absent → human_review (`undefined < 0.85` is false)",
    classification: (() => {
      const c = classify();
      delete c.confidence;
      return c;
    })(),
  },
  {
    name: "F-19 confidence NaN → human_review (`NaN < 0.85` is false)",
    classification: classify({ confidence: NaN }),
  },
  {
    name: "F-19 confidence is a numeric string → human_review",
    classification: classify({ confidence: "0.99" }),
  },
];

for (const scenario of SCENARIOS) {
  test(`n8n gates match policyEngine — ${scenario.name}`, () => {
    const ctx = ctxFor(scenario.classification, scenario.ctxOver ?? {});
    const response = remoteResponse(scenario.employmentOver ?? {});

    const fromN8n = runGatesNode({ ctx, employmentResponse: response });

    // Feed policyEngine.js the identity the n8n node derived, so THIS
    // comparison isolates the GATES specifically. The underlying SIGNAL each
    // channel carries still differs (the Node path may hold a Remote session,
    // the n8n path holds Zendesk's authenticated requester), but as of
    // rca-43z the DERIVATION RULE both run on that signal is the same ported
    // logic (deriveRequesterType(), src/uc01/requesterType.js) — gates.js no
    // longer trusts classification.requesterType directly. That derivation
    // step itself — not just "given an identity, do the gates agree" — is
    // covered separately in test/uc01RequesterType.test.js, which runs both
    // copies from the SAME raw session/employment/classifierOpinion inputs
    // rather than pre-feeding either one a decided answer.
    const fromPolicyEngine = evaluate({
      employment: fromN8n.employment,
      classification: scenario.classification,
      identity: fromN8n.identity,
      // `session` became a GATE INPUT when G-2 landed: the deflection fires only
      // on a positive signal that the requester can reach Remote's own flow. It
      // has to be fed to both copies from the one place the scenario defines it,
      // or the Node copy silently evaluates a different ticket — which is how
      // this harness would have certified the deflection as "in parity" while
      // only the n8n copy could ever reach it.
      session: ctx.session ?? null,
    });

    assert.equal(fromN8n.decision, fromPolicyEngine.decision, "decision differs");
    assert.equal(fromN8n.reason, fromPolicyEngine.reason, "reason differs");
    assert.deepEqual(fromN8n.flags, fromPolicyEngine.flags, "flags differ");

    // Cross-copy agreement alone is not sufficient: both copies could agree on
    // the WRONG outcome (this is exactly how rca-43z's derivation gap hid —
    // gates.js fed policyEngine its OWN identity, so the two always agreed
    // with each other regardless of whether that identity was itself
    // correct). Scenarios that pin down a specific outcome assert it directly.
    if (scenario.expectDecision) {
      assert.equal(fromN8n.decision, scenario.expectDecision, "n8n decision does not match the scenario's pinned expectation");
    }
    if (scenario.expectReason) {
      assert.equal(fromN8n.reason, scenario.expectReason, "n8n reason does not match the scenario's pinned expectation");
    }
  });
}

test("the n8n node body parses and returns n8n's item shape", () => {
  // A syntax error or a stray non-boolean would surface here first.
  const out = runGatesNode({
    ctx: ctxFor(classify()),
    employmentResponse: remoteResponse(),
  });
  assert.equal(typeof out.decision, "string");
  assert.ok(Array.isArray(out.flags));
  assert.equal(out.identity.verified, true);
});

test("identity fails closed when the employment record has no email", () => {
  // rca-43z: a record with no email CANNOT BE MATCHED against the
  // authenticated signal — that is neither evidence of self nor of third
  // party (requesterType.js's `no_email_on_employment_record` basis), so
  // deriveRequesterType() lands it on the stricter third-party regime, and
  // because a session IS present here (ctxFor()'s default
  // `authenticatedEmail`), the identity check reaches the MORE SPECIFIC
  // pending reason — "someone signed in and asked about a record that
  // doesn't match" — exactly the shape VC-28's parity test in
  // test/uc01RequesterType.test.js pins down between both copies. This used
  // to reach `escalate` / `no_email_on_employment_record` only because
  // gates.js trusted the classifier's raw (defaulted-to-self)
  // `requesterType` instead of deriving it.
  const out = runGatesNode({
    ctx: ctxFor(classify()),
    employmentResponse: remoteResponse({ basic_information: { name: "Ada Lovelace" } }),
  });
  assert.equal(out.identity.verified, false);
  assert.equal(out.identity.pending, true, "no email on record is a PENDING regime, not a refusal (VC-06)");
  assert.equal(out.identity.reason, "awaiting_employee_consent_other_employee_signed_in");
  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(out.requesterType.basis, "no_email_on_employment_record", "the DERIVATION's own reason is carried separately on requesterType, not lost");
});

// rca-dy0. Found live, not by a fixture: a real Sandbox employee (Alex Morgan)
// has a job title on record, and the deployed n8n letter printed no Job title
// row at all, because gates.js's manual employment reconstruction never read
// it — normalizeEmployment() (src/remote/restClient.js) already does, so only
// the n8n path was missing it. L-16 added the "Job title" row to
// renderLetter.js specifically to close this gap; without this line feeding
// it, that row was dead code on the live path, and the SCENARIOS loop above
// could never have caught it — it compares `decision`/`reason`/`flags`, never
// the extracted `employment` object itself.
test("job_title is extracted from the real API's basic_information, matching normalizeEmployment()", () => {
  const withTitle = runGatesNode({
    ctx: ctxFor(classify()),
    employmentResponse: remoteResponse({ basic_information: { name: "Ada Lovelace", email: "ada.lovelace@example.com", job_title: "Content Writer Wizard" } }),
  });
  assert.equal(withTitle.employment.job_title, "Content Writer Wizard");

  const withoutTitle = runGatesNode({
    ctx: ctxFor(classify()),
    employmentResponse: remoteResponse(),
  });
  assert.equal(withoutTitle.employment.job_title, null, "an absent job title must stay null, never a blank string");
});

// ---------------------------------------------------------------------------
// rca-1bk — VC-11 / D3: the deployed graph writes zero cases/audit_log rows on
// out_of_scope AND writes exactly one parentless audit_trace row. The gate node
// cannot write to Supabase itself (no imports, no network) — what it CAN do,
// and must, is emit the exact payload the graph's out-of-scope branch inserts
// verbatim. This is the one thing SCENARIOS above never checked: it compares
// decision/reason/flags, never this field, so gates.js could have silently
// stopped emitting outOfScopeTrace (or emitted the wrong shape) with every
// other test in this file still green.
// ---------------------------------------------------------------------------
test("rca-1bk: out_of_scope emits the outOfScopeTrace payload the graph's trace-write node consumes", () => {
  const out = runGatesNode({
    ctx: ctxFor(classify({ intent: "out_of_scope" }), {
      externalRef: "oos-9001",
      source: "zendesk",
      text: "Where is the office coffee machine? Also can I get a parking permit?",
    }),
    employmentResponse: remoteResponse(),
  });
  assert.equal(out.decision, "out_of_scope");
  assert.ok(out.outOfScopeTrace, "an out_of_scope decision must carry a trace payload");
  assert.equal(out.outOfScopeTrace.call, "uc01.out_of_scope");
  assert.equal(out.outOfScopeTrace.attempt, 1);
  assert.equal(out.outOfScopeTrace.ok, true);
  assert.equal(out.outOfScopeTrace.parent_id, null, "parentless — this belongs to no audit_log row (none is written)");
  assert.equal(out.outOfScopeTrace.details.externalRef, "oos-9001");
  assert.equal(out.outOfScopeTrace.details.source, "zendesk");
  assert.equal(out.outOfScopeTrace.details.intent, "out_of_scope");
  assert.equal(out.outOfScopeTrace.details.classificationSource, null, "classify() in this file supplies no `source`, and the trace must carry that faithfully (null) rather than inventing one");
  assert.equal(
    out.outOfScopeTrace.details.excerpt,
    "Where is the office coffee machine? Also can I get a parking permit?"
  );
  assert.equal(out.outOfScopeTrace.details.excerptTruncated, false);
});

test("rca-1bk: outOfScopeTrace is null on every decision that is not out_of_scope", () => {
  const out = runGatesNode({ ctx: ctxFor(classify()), employmentResponse: remoteResponse() });
  assert.notEqual(out.decision, "out_of_scope");
  assert.equal(out.outOfScopeTrace, null, "a branch that never fires must not carry a stale payload from a prior decision");
});

test("rca-1bk: the out-of-scope excerpt is bounded to 160 characters and marks truncation", () => {
  const long = "PRIVATE ".repeat(200);
  const out = runGatesNode({
    ctx: ctxFor(classify({ intent: "out_of_scope" }), { text: long }),
    employmentResponse: remoteResponse(),
  });
  assert.equal(out.outOfScopeTrace.details.excerpt.length, 160);
  assert.equal(out.outOfScopeTrace.details.excerptTruncated, true);
});

test("every n8n Code node body is syntactically valid", () => {
  // Cheap guard for the bug class that already bit this workflow once: a Code
  // node body is just a string to n8n, so a broken one deploys happily and
  // only fails at runtime, mid-ticket. Compiling each file here turns that
  // into a failing test instead. `new Function` is used rather than import
  // because these bodies end in a bare `return`, which is only legal inside a
  // function — exactly how n8n wraps them.
  const bodies = [
    "gates.js",
    "normalizeTicket.js",
    "validateClassification.js",
    "renderLetter.js",
    "prepareRefusalReply.js",
  ];
  for (const file of bodies) {
    const src = readFileSync(join(__dirname, "..", "workflows", "nodes", file), "utf8");
    assert.doesNotThrow(() => new Function(src), `${file} does not compile`);
  }
});

test("email comparison is case-insensitive on both sides", () => {
  const out = runGatesNode({
    ctx: ctxFor(classify(), { session: { authenticatedEmail: "ada.lovelace@example.com" } }),
    employmentResponse: remoteResponse({
      basic_information: { name: "Ada Lovelace", email: "Ada.Lovelace@EXAMPLE.com", provisional_start_date: "2023-01-15" },
    }),
  });
  assert.equal(out.identity.verified, true);
});

// ---------------------------------------------------------------------------
// F-17 — the LIVE path, not just the gate: the prompt must ask the question,
// and the validator must refuse an answer that doesn't contain it.
// ---------------------------------------------------------------------------
// The gate above could be perfect and still never fire in production, which is
// exactly what happened: the deployed system prompt in normalizeTicket.js
// listed four fields and no requestedFields, so `requested` was always [] on
// the live LLM path and "include my salary" auto-resolved on a real ticket.

/** Run the "Validate Classification" Code node body with n8n's globals mocked. */
function runValidateClassificationNode({ ticket, llmContent }) {
  const src = readFileSync(join(__dirname, "..", "workflows", "nodes", "validateClassification.js"), "utf8");
  const sandbox = {
    $: (nodeName) => {
      if (nodeName !== "Normalize Ticket") throw new Error(`Unexpected $() lookup for "${nodeName}"`);
      return { first: () => ({ json: ticket }) };
    },
    $input: { first: () => ({ json: { choices: [{ message: { content: llmContent } }] } }) },
  };
  const result = vm.runInNewContext(`(function () {\n${src}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const salaryTicket = {
  text: "Please send a standard verification letter and include my salary.",
  hasAttachment: false,
};

test("F-17: the deployed system prompt asks the model for requestedFields", () => {
  const src = readFileSync(join(__dirname, "..", "workflows", "nodes", "normalizeTicket.js"), "utf8");
  const promptLine = src.split("\n").find((l) => l.includes("const systemPrompt"));
  assert.ok(promptLine, "normalizeTicket.js must still build a systemPrompt");
  assert.match(promptLine, /requestedFields/, "the gate cannot fire on a field the model was never asked for");
  assert.match(promptLine, /salary/, "the prompt names the over-scope examples the gate exists for");
});

test("F-17: a model response WITHOUT requestedFields is rejected, and the rule-based fallback answers instead", () => {
  const out = runValidateClassificationNode({
    ticket: salaryTicket,
    llmContent: JSON.stringify({
      intent: "standard_letter",
      hasExternalUrl: false,
      requesterType: "self",
      confidence: 0.95,
    }),
  });
  assert.equal(out.classification.source, "rule_based_fallback", "an unanswered question is an invalid shape");
  assert.deepEqual(out.classification.requestedFields, ["salary"]);
});

test("F-17: end to end through both live Code nodes, 'include my salary' reaches human_review", () => {
  const validated = runValidateClassificationNode({
    ticket: salaryTicket,
    llmContent: JSON.stringify({
      intent: "standard_letter",
      hasExternalUrl: false,
      requesterType: "self",
      confidence: 0.95,
    }),
  });
  const out = runGatesNode({
    ctx: ctxFor(validated.classification),
    employmentResponse: remoteResponse(),
  });
  assert.equal(out.decision, "human_review", "the finding's exact proof case, on the deployed node bodies");
  assert.equal(out.reason, "over_scope_request");
  assert.ok(out.flags.includes("over_scope_disclosure_requested"));
});

test("F-17: a model that DOES answer is trusted, and a clean answer still auto-resolves", () => {
  const validated = runValidateClassificationNode({
    ticket: { text: "Standard verification letter please.", hasAttachment: false },
    llmContent: JSON.stringify({
      intent: "standard_letter",
      hasExternalUrl: false,
      requesterType: "self",
      confidence: 0.95,
      requestedFields: [],
    }),
  });
  assert.equal(validated.classification.source, "llm");
  const out = runGatesNode({ ctx: ctxFor(validated.classification), employmentResponse: remoteResponse() });
  assert.equal(out.decision, "auto_resolve");
});

// ---------------------------------------------------------------------------
// rca-wn30 / R7-18 — "Lookup Consent Records", the node K4 authorised
// ---------------------------------------------------------------------------
// 22 of 100 live feed rows carried `identity_awaiting_employee_consent` and
// NONE carried a `consentRecordId`, because no node on the graph ever read
// `consent_records` — `ctx.consentRecord` was undefined on every live run and
// gates.js's `consentRecord ? consentRecord.id : null` could only ever answer
// null. The reviewer was being told to "see the consent request's own age"
// against a field that could not be populated.
//
// Every assertion below is on gates.js's OWN RETURNED OUTPUT — the object the
// "Append Audit Log" node maps into `audit_log.details` — never on an internal
// branch and never on a value the test itself supplies as the answer. The rows
// fed in are `consent_records` rows in Supabase's own snake_case, i.e. the
// shape the live node actually emits.
// ---------------------------------------------------------------------------

/** A `consent_records` row in Supabase's snake_case, as the live node emits it. */
const supabaseConsentRow = (over = {}) => ({
  id: "cr_live_1",
  created_at: "2026-08-22T05:00:57.229Z",
  case_id: "case_1",
  consent_type: "third_party_verification",
  status: "pending",
  source: "third_party_door",
  evidence_reference: null,
  requesting_party: "First National Bank of Austin",
  purpose: "Mortgage application underwriting",
  granted_by_employment_id: null,
  granted_by_signal: null,
  granted_at: null,
  cases: { employment_id: "emp_active_001" },
  ...over,
});

/** A third-party ticket: the Zendesk requester is not the person on the record. */
const thirdPartyCtx = (over = {}) =>
  ctxFor(classify({ requesterType: "third_party" }), {
    session: { authenticatedEmail: "underwriting@firstnational.example" },
    ...over,
  });

test("R7-18 THE REGRESSION: with the lookup node absent, consentRecordId is null on a pending row (the live behaviour this bead fixes)", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx(),
    employmentResponse: remoteResponse(),
    consentRows: null, // node not on the graph — n8n's $() throws
  });
  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(out.identity.reason, "awaiting_employee_consent_other_employee_signed_in");
  assert.equal(out.identity.consentRecordId, null, "exactly what production emitted before this node existed");
});

test("R7-18 FIXED: the lookup's rows put a real consent_records id on the pending row", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx(),
    employmentResponse: remoteResponse(),
    consentRows: [supabaseConsentRow()],
  });
  assert.equal(out.decision, "awaiting_employee_consent", "still pending — a pointer is not a decision");
  assert.equal(out.identity.pending, true);
  assert.equal(out.identity.verified, false);
  assert.equal(out.identity.consentRecordId, "cr_live_1");
});

test("L-19: the OLDEST unanswered ask is the one named — the longest-waiting request is what gets nudged", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx(),
    employmentResponse: remoteResponse(),
    // The node orders created_at.asc, so this is the order it delivers.
    consentRows: [
      supabaseConsentRow({ id: "cr_oldest", created_at: "2026-08-20T05:00:00.000Z" }),
      supabaseConsentRow({ id: "cr_newer", created_at: "2026-08-22T05:00:00.000Z" }),
    ],
  });
  assert.equal(out.identity.consentRecordId, "cr_oldest");
});

test("VC-30: a GRANTED row for a different party+purpose neither verifies nor becomes the pointer", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx(),
    employmentResponse: remoteResponse(),
    consentRows: [
      supabaseConsentRow({
        id: "cr_other_bank",
        status: "granted",
        requesting_party: "Ravensworth Building Society",
        purpose: "Mortgage affordability check",
        granted_by_employment_id: "emp_active_001",
        granted_at: "2026-08-22T12:40:53.147Z",
      }),
    ],
  });
  assert.equal(out.identity.verified, false, "a grant to another party must never clear this enquiry");
  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(
    out.identity.consentRecordId,
    null,
    "and an answered row is not an unanswered ask — the pointer stays null rather than pointing at someone else's grant"
  );
});

test("VC-30: a scoped grant DOES verify — the party and purpose the request itself states", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx({
      requestingParty: "  first national bank of austin ",
      purpose: "Mortgage Application Underwriting",
    }),
    employmentResponse: remoteResponse(),
    consentRows: [
      supabaseConsentRow({
        id: "cr_scoped_grant",
        status: "granted",
        granted_by_employment_id: "emp_active_001",
        granted_at: "2026-08-22T05:30:00.000Z",
      }),
    ],
  });
  assert.equal(out.identity.verified, true, "trim + case-insensitive match, exactly caseStore's matchesParty()");
  assert.equal(out.identity.reason, "third_party_with_consent");
  assert.equal(out.identity.consentRecordId, "cr_scoped_grant");
});

test("VC-08: a scoped DENIAL blocks, and blocks terminally — never escalate", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx({
      requestingParty: "First National Bank of Austin",
      purpose: "Mortgage application underwriting",
    }),
    employmentResponse: remoteResponse(),
    consentRows: [supabaseConsentRow({ id: "cr_denied", status: "denied" })],
  });
  assert.equal(out.decision, "blocked");
  assert.equal(out.reason, "consent_refused");
  assert.equal(out.identity.consentRecordId, "cr_denied");
});

test("an INCOMPLETE granted row is pending, not granted — and still names itself so a human can see why", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx({
      requestingParty: "First National Bank of Austin",
      purpose: "Mortgage application underwriting",
    }),
    employmentResponse: remoteResponse(),
    // status says granted; granted_at/granted_by are null, so it is not usable
    consentRows: [supabaseConsentRow({ id: "cr_half", status: "granted" })],
  });
  assert.equal(out.identity.verified, false);
  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(out.identity.consentRecordId, "cr_half");
});

test("FAIL SAFE: alwaysOutputData's empty item is treated as no rows, and the gates still decide", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx(),
    employmentResponse: remoteResponse(),
    consentRows: [{}], // what the node emits when the filter matched nothing
  });
  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(out.identity.consentRecordId, null);
});

test("FAIL SAFE: onError's error item is treated as no rows — an unreachable Supabase can only ever cost a wait", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx({
      requestingParty: "First National Bank of Austin",
      purpose: "Mortgage application underwriting",
    }),
    employmentResponse: remoteResponse(),
    consentRows: [{ error: { message: "connect ETIMEDOUT", status: 503 } }],
  });
  assert.equal(out.identity.verified, false, "a failed lookup must never produce a disclosure");
  assert.equal(out.decision, "awaiting_employee_consent");
  assert.equal(out.identity.consentRecordId, null);
});

test("a SELF request never consults consent at all, however many rows the lookup returned", () => {
  const out = runGatesNode({
    ctx: ctxFor(classify()),
    employmentResponse: remoteResponse(),
    consentRows: [supabaseConsentRow({ id: "cr_irrelevant" })],
  });
  assert.equal(out.decision, "auto_resolve");
  assert.equal(out.identity.reason, "requester_matches_employment");
  assert.equal(out.identity.consentRecordId, undefined, "the self branch carries no consent field at all");
});

test("ctx.consentRecord still wins where a caller supplied the artifact outright (src/uc01/workflow.js's own seam)", () => {
  const out = runGatesNode({
    ctx: thirdPartyCtx({ consentRecord: consentRow({ id: "cr_from_ctx" }) }),
    employmentResponse: remoteResponse(),
    consentRows: [supabaseConsentRow({ id: "cr_from_lookup" })],
  });
  assert.equal(out.identity.verified, true);
  assert.equal(out.identity.consentRecordId, "cr_from_ctx", "the lookup fills the slot, it never overrides it");
});

test("the employment record is read by NODE NAME, not off $input — the read that makes the splice possible", () => {
  // $input carries the Supabase rows in production, not an employment. If
  // gates.js ever went back to reading $input, this employment would be
  // invisible and every field on it would come back null.
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Validate Classification") return { first: () => ({ json: ctxFor(classify()) }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: remoteResponse() }) };
      if (nodeName === "Lookup Consent Records") return { all: () => [{ json: supabaseConsentRow() }] };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    // exactly what the live node hands the gates: rows, no employment anywhere
    $input: { first: () => ({ json: supabaseConsentRow() }) },
  };
  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const out = JSON.parse(JSON.stringify(vm.runInNewContext(wrapped, sandbox, { timeout: 5000 })[0].json));
  assert.equal(out.employment.full_name, "Ada Lovelace");
  assert.equal(out.decision, "auto_resolve");
});
