// ---------------------------------------------------------------------------
// uc02ReadReceiptNodeSpec.test.js — the guard on the guard
// ---------------------------------------------------------------------------
// `readReceiptNodeIssues()` is what `npm run verify-deployed` uses to check the
// live "Read Receipt (API)" node, which has no jsCode and is therefore
// invisible to a body diff. It shipped with no test of its own, and that is
// precisely how it came to pass a node that had never authenticated once.
//
// WHAT HAPPENED, because it is the reason for every case below. The node was
// deployed carrying `X-YOUR-WEBHOOK-TOKEN: ={{ $env.N8N_WEBHOOK_TOKEN }}`. The
// guard asked "is the header present?" — it was — and reported the node clean.
// n8n blocks `$env` inside nodes by default and the variable was not set on the
// host either, so the header went out EMPTY and the endpoint answered 401 on
// every call.
//
// It was invisible because two individually-correct properties combine badly:
// `onError: continueRegularOutput` (property 3, which must not change — an
// outage of the receipt reader must never become an outage of UC-02) means the
// 401 does not fail the node. Live execution 10153 reported `success` with all
// 23 nodes green while no receipt had been read at all. The error was sitting
// inside the node's output where only somebody opening the execution would see
// it.
//
// So the rule the guard now enforces is not "a header is configured" but "the
// secret comes from a credential" — because a missing credential stops the node
// and says so, while an expression fails silently and forever.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  readReceiptNodeIssues,
  READ_RECEIPT_PATH,
  READ_RECEIPT_TOKEN_HEADER,
  READ_RECEIPT_CREDENTIAL_TYPE,
} from "../workflows/nodes-uc02/readReceiptNodeSpec.js";

/** The node exactly as it must be. Every case below mutates one thing. */
function goodNode(over = {}) {
  return {
    name: "Read Receipt (API)",
    type: "n8n-nodes-base.httpRequest",
    parameters: {
      method: "POST",
      url: "https://remote-cx-apis.vercel.app" + READ_RECEIPT_PATH,
      authentication: "genericCredentialType",
      genericAuthType: READ_RECEIPT_CREDENTIAL_TYPE,
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ ticketId: 1 }) }}",
      options: {},
      ...(over.parameters ?? {}),
    },
    credentials: over.credentials ?? { [READ_RECEIPT_CREDENTIAL_TYPE]: { id: "CRED_WEBHOOK_HEADER_AUTH", name: "n8n Secure Zendesk Comm" } },
    onError: "onError" in over ? over.onError : "continueRegularOutput",
    alwaysOutputData: true,
  };
}

test("the correctly-configured node reports no issues", () => {
  assert.deepEqual(readReceiptNodeIssues(goodNode()), []);
});

// --- the regression this file exists for ------------------------------------

test("NEGATIVE CONTROL: the $env-expression node that shipped is REJECTED", () => {
  // Byte-for-byte the configuration that was live on graph WORKFLOW_UC02_ID and
  // that the old guard called clean. If this ever passes again, the guard has
  // been loosened back to asking whether a header exists.
  const shipped = goodNode({
    parameters: {
      authentication: undefined,
      genericAuthType: undefined,
      sendHeaders: true,
      headerParameters: { parameter: [{ name: "X-YOUR-WEBHOOK-TOKEN", value: "={{ $env.N8N_WEBHOOK_TOKEN }}" }] },
    },
    credentials: {},
  });
  const issues = readReceiptNodeIssues(shipped);
  assert.ok(issues.length > 0, "the node that never authenticated once is reported clean");
  assert.match(issues.join(" | "), /credential/i);
});

test("a header whose name is right but which comes from no credential is not enough", () => {
  // The distinction the old guard could not draw: PRESENT is not AUTHENTICATED.
  const issues = readReceiptNodeIssues(goodNode({ parameters: { authentication: undefined, genericAuthType: undefined }, credentials: {} }));
  assert.ok(issues.some((i) => /credential/i.test(i)));
});

test("a credential of the right type but with no id is refused", () => {
  // n8n will serialise a credential slot with a name and no id; that is not an
  // attached credential and must not read as one.
  const issues = readReceiptNodeIssues(goodNode({ credentials: { [READ_RECEIPT_CREDENTIAL_TYPE]: { name: "looks right" } } }));
  assert.ok(issues.some((i) => /credential/i.test(i)));
});

test("a manual copy of the token header ALONGSIDE the credential is refused", () => {
  // Two sources for one header is either a secret sitting in workflow JSON that
  // the n8n API hands to any read key, or the empty-expression bug returning by
  // the side door.
  const issues = readReceiptNodeIssues(
    goodNode({ parameters: { sendHeaders: true, headerParameters: { parameter: [{ name: READ_RECEIPT_TOKEN_HEADER, value: "literal-secret" }] } } })
  );
  assert.ok(issues.some((i) => /ALSO set as a manual header/.test(i)), issues.join(" | "));
});

test("unrelated headers are left alone", () => {
  // The rule is about the TOKEN header, not about headers in general.
  assert.deepEqual(
    readReceiptNodeIssues(goodNode({ parameters: { sendHeaders: true, headerParameters: { parameter: [{ name: "X-Request-Id", value: "abc" }] } } })),
    []
  );
});

// --- the three properties the file has always claimed to pin -----------------

test("a repointed URL is refused — it would send a ticket id and a secret elsewhere", () => {
  const issues = readReceiptNodeIssues(goodNode({ parameters: { url: "https://someone-elses-host.example/collect" } }));
  assert.ok(issues.some((i) => /url is/.test(i)));
});

test("a non-POST method is refused", () => {
  assert.ok(readReceiptNodeIssues(goodNode({ parameters: { method: "GET" } })).some((i) => /method is/.test(i)));
});

test("onError must stay continueRegularOutput — the property that must NOT be tightened", () => {
  // Counter-intuitive and load-bearing. This is what makes a 401 silent, and it
  // is still correct: an outage of the receipt reader must degrade to "nobody
  // checked" rather than failing every UC-02 claim at a node that is not on the
  // money path. The remedy for the silence is this guard, not removing it.
  for (const bad of [undefined, "stopWorkflow", "continueErrorOutput"]) {
    assert.ok(
      readReceiptNodeIssues(goodNode({ onError: bad })).some((i) => /onError is/.test(i)),
      `onError ${JSON.stringify(bad)} was accepted`
    );
  }
});

test("it reports EVERY problem at once, not just the first", () => {
  // A guard that stops at the first issue makes fixing a node an N-round trip
  // against a live production workflow.
  const issues = readReceiptNodeIssues({ parameters: { method: "GET", url: "https://elsewhere.example/x" }, credentials: {} });
  assert.ok(issues.length >= 3, `expected several issues, got ${issues.length}: ${issues.join(" | ")}`);
});

test("a missing node is not silently clean", () => {
  assert.ok(readReceiptNodeIssues(undefined).length > 0, "an absent node reports no issues, so a deleted node would pass");
});
