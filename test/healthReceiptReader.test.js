// ---------------------------------------------------------------------------
// healthReceiptReader.test.js — the machine-called route must say why it is off
// ---------------------------------------------------------------------------
// [E-1]. `POST /uc02/api/receipts/read-from-ticket` is the only route on this
// deployment whose caller is a MACHINE — the UC-02 n8n graph, unattended. So
// its refusal is seen by nobody. It answered 503
// `receipt_reader_not_configured` for the whole of 2026-08-29 and the only way
// to learn WHICH of its three dependencies was missing was to POST at the live
// endpoint and then read deps.js to map the code back to a variable name.
//
// That is the same defect this endpoint has already had to learn twice, in
// different clothes: the third-party door's intake window (a control that
// existed in code while an env override silently made it cosmetic) and the
// approver-entitlement row ("built" and "provisioned" are two claims). The
// remedy each time was the same — report the EFFECTIVE state, per dependency,
// rather than one boolean that collapses several different failures.
//
// WHAT IS PINNED HERE, and why each one could plausibly be broken by a later
// edit that looks harmless:
//
//   1. The three preconditions are reported SEPARATELY. Collapsing them into
//      one `configured` boolean is the exact regression this file prevents.
//   2. The token is reported as a BOOLEAN. A future edit that echoes the value
//      "to make debugging easier" would publish the webhook secret on an
//      unauthenticated endpoint — the same secret nine Zendesk webhooks send.
//   3. The status names the FIRST unmet precondition, because that is the one
//      the caller actually hits. Reporting a later one sends whoever is
//      debugging after the wrong fix.
//   4. A missing dependency DOWNSTREAM of the auth gate does not read as a
//      refusal. The 503/401 distinction is load-bearing: 503 means this
//      deployment is not set up, 401 means the caller's token did not match.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { receiptReaderHealth } from "../deploy/cx-apis/handler.js";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const ready = {
  env: { N8N_WEBHOOK_TOKEN: SECRET },
  posture: { zendeskConfigured: true },
  llm: { configured: true, model: "gpt-5-nano" },
};

/** Build one health block, overriding whichever leg the case is about. */
function block({ env = ready.env, posture = ready.posture, llm = ready.llm } = {}) {
  return receiptReaderHealth(env, posture, llm);
}

test("the three preconditions are reported separately, not collapsed into one boolean", () => {
  const b = block();
  for (const key of ["sharedSecretConfigured", "zendeskConfigured", "extractionModelConfigured"]) {
    assert.equal(typeof b[key], "boolean", `${key} is not reported as its own boolean`);
  }
  // The collapse this test exists to prevent: a single `configured` field that
  // is true only when all three are, hiding which one is missing.
  assert.equal(b.configured, undefined, "the three preconditions have been collapsed back into one flag");
});

test("the shared secret is reported as a boolean and its VALUE never appears", () => {
  // /__cx/health is unauthenticated. This is the same secret the nine Zendesk
  // webhooks send and the n8n credential checks — echoing it here would be a
  // disclosure, not a convenience.
  const serialised = JSON.stringify(block());
  assert.ok(!serialised.includes(SECRET), "the webhook secret is echoed on an unauthenticated endpoint");
  assert.equal(block().sharedSecretConfigured, true);
});

test("an unset token is reported, and the status names THAT and not a later leg", () => {
  const b = block({ env: {} });
  assert.equal(b.sharedSecretConfigured, false);
  assert.match(b.status, /^NOT CONFIGURED/);
  assert.match(b.status, /N8N_WEBHOOK_TOKEN/, "the status does not name the variable to set");
});

test("the status names the FIRST unmet precondition when several are unmet", () => {
  // All three missing. The caller hits the auth gate and never reaches the
  // other two, so naming Zendesk or the model here would be a true statement
  // that sends the reader after the wrong fix.
  const b = block({ env: {}, posture: { zendeskConfigured: false }, llm: { configured: false, model: null } });
  assert.match(b.status, /N8N_WEBHOOK_TOKEN/);
  assert.doesNotMatch(b.status, /OPENAI_API_KEY/);
});

test("a dependency missing downstream of the gate does not read as a refused caller", () => {
  // The distinction the route itself makes and this block must not blur: with
  // the token set, a call IS accepted — it simply cannot find or read the
  // receipt, and returns 200 with a `reason`. Describing that as "not
  // configured" would send whoever reads it to check the wrong secret.
  const noZendesk = block({ posture: { zendeskConfigured: false } });
  assert.equal(noZendesk.sharedSecretConfigured, true);
  assert.doesNotMatch(noZendesk.status, /^NOT CONFIGURED/);
  assert.match(noZendesk.status, /zendesk_not_configured/);

  const noModel = block({ llm: { configured: false, model: null } });
  assert.doesNotMatch(noModel.status, /^NOT CONFIGURED/);
  assert.match(noModel.status, /extraction_not_configured/);
});

test("the 503/401 distinction is stated, because it is the one that wastes an evening", () => {
  // 503 = this deployment is not set up. 401 = your token did not match. They
  // are different problems with different owners, and the route deliberately
  // answers with different codes; the health block has to preserve that.
  assert.match(block({ env: {} }).status, /503/);
  assert.match(block({ env: {} }).status, /401/);
});

test("the fully-configured status names the model doing the reading", () => {
  const b = block();
  assert.match(b.status, /^WORKING/);
  assert.match(b.status, /gpt-5-nano/, "the status does not say which model reads the receipt");
});

test("it reports that the route decides nothing — the property no response reveals", () => {
  // Prime directive 1. The route returns a transcription; gate 8b compares it
  // and deterministic code decides. Nothing in an HTTP response says so.
  assert.equal(block().decidesNothing, true);
  assert.match(block().status, /never|compares|decides/);
});

test("the route path is reported, so it need not be guessed from source", () => {
  assert.equal(block().route, "POST /uc02/api/receipts/read-from-ticket");
  assert.equal(block().secretHeader, "X-YOUR-WEBHOOK-TOKEN");
});
