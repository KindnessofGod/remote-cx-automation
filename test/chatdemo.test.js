// ---------------------------------------------------------------------------
// chatdemo.test.js  —  The conversational UC-01 demo
// ---------------------------------------------------------------------------
// Same two concerns as playground.test.js / livedemo.test.js:
//   1. The browser asset compiles and never uses innerHTML — npm test never
//      imports app.js, so a syntax error would otherwise ship silently.
//   2. The HTTP API, driven through the real handler with no listening
//      socket, proves each chat message is a real ticket through the real
//      handleVerificationTicket() — the response the page would render is
//      byte-for-byte what calling the handler directly produces.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { createChatDemoHandler, DEMO_CONSENT } from "../src/chatdemo/server.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer } from "../src/remote/mockServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "chatdemo", "assets");
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

test("app.js does not re-derive the decision policy in the browser", () => {
  const source = read("app.js");
  assert.ok(source.includes("result.decision"), "the reply must read the decision from the API response");
  assert.ok(source.includes("result.reason"), "the reply must read the reason from the API response");
  assert.ok(
    !/\.decision\s*===\s*["'](auto_resolve|human_review|escalate)["']/.test(source),
    "app.js branches on the raw decision — that is a second copy of the policy"
  );
});

// ---------------------------------------------------------------------------
// The HTTP API — driven through the real handler, no port needed. Proves the
// chat demo is a thin router over handleVerificationTicket(), not a second
// implementation of it: the rendered response for a message must be exactly
// what calling the real handler directly would produce for the same input.
// ---------------------------------------------------------------------------

let remoteServer;
let remote;
let caseStore;
let audit;
let handler;

before(async () => {
  remoteServer = await startMockServer(4019); // chatdemo-test-only port
  remote = new RemoteClient({ baseUrl: "http://localhost:4019" });
});
after(() => remoteServer && remoteServer.close());

beforeEach(() => {
  caseStore = new CaseStore();
  audit = new AuditLogger();
  // classifyRequestRuleBased is injected so these tests never depend on
  // whether OPENAI_API_KEY happens to be set in the environment they run in
  // — never a real, billed OpenAI call from `npm test` (same discipline as
  // the existing uc01.test.js suite).
  handler = createChatDemoHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
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

/**
 * The acceptance criterion restated as a test: send one chat message through
 * the API, then call handleVerificationTicket() directly with the exact same
 * ticket, and assert the rendered response carries the same decision, letter,
 * flags and reason. (caseId and externalRef differ by construction — the
 * wrapper numbers its own tickets — so they are not part of the comparison.)
 */
/** Mirrors demoSession() in src/chatdemo/server.js — see the note above. */
async function demoSessionForTest(asEmploymentId, asRemoteSession) {
  if (!asEmploymentId) return null;
  if (asRemoteSession === true) return { authenticatedEmploymentId: asEmploymentId };
  const employment = await remote.getEmployment(asEmploymentId).catch(() => null);
  const email = employment?.email ?? null;
  return email ? { authenticatedEmail: String(email).trim().toLowerCase() } : null;
}

async function assertMessageMatchesDirectHandler({ text, hasAttachment, employmentId, asEmploymentId, asRemoteSession, consentOnRecord }) {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/messages",
    body: { text, hasAttachment, employmentId, asEmploymentId, asRemoteSession, consentOnRecord },
  });
  assert.equal(res.status, 200);

  // The direct call must build the session the SERVER builds, or this stops
  // being a parity test and becomes two different tickets that happen to share
  // some text. That is exactly what it caught when the server started deriving
  // the ticket-requester signal from the record: the API answered
  // `auto_resolve` and this call answered `deflected_to_self_service`, from the
  // "identical" ticket.
  const session = await demoSessionForTest(asEmploymentId, asRemoteSession);

  const direct = await handleVerificationTicket(
    {
      source: "zendesk",
      externalRef: "direct-call",
      text,
      hasAttachment: Boolean(hasAttachment),
      employmentId,
      session,
      // G-3/L-8: `consentOnRecord` is retired. The API call above ensures a
      // granted consent_records artifact via `ensureDemoConsentGranted()`,
      // keyed on DEMO_CONSENT — this direct call must name the SAME
      // (requestingParty, purpose) to find the SAME artifact through the
      // shared `caseStore`, or the two calls stop being the same ticket.
      //
      // AND, since 2026-08-28, the same ENQUIRY: consent is per-enquiry, so the
      // artifact the API seeded is scoped to the reference the API used. Naming
      // a different one here would make these two calls a matched pair of
      // DIFFERENT questions, and the parity assertion below would fail for a
      // reason that has nothing to do with parity.
      ...(consentOnRecord
        ? {
            requestingParty: DEMO_CONSENT.requestingParty,
            purpose: DEMO_CONSENT.purpose,
            doorReference: res.body.externalRef,
          }
        : {}),
    },
    { remote, audit, caseStore, classify: classifyRequestRuleBased }
  );

  for (const field of ["decision", "flags", "reason"]) {
    assert.deepEqual(res.body[field], direct[field], `rendered ${field} must match the real handler's`);
  }

  // `letterHtml` (when rendered) embeds a Reference row carrying each path's
  // own externalRef — `chatdemo-N` vs `direct-call`, different by
  // construction (see the comment above `assertMessageMatchesDirectHandler`).
  // Passing the SAME externalRef to both calls is not an option: they share
  // one `caseStore`, and `claimExternalRef()` would see the second call as a
  // redelivery of the first and short-circuit it to a duplicate decision with
  // no `letterHtml` at all. So normalise just the one cell that is expected
  // to differ before the byte-equality check, and assert separately that each
  // document actually carries its own reference — the row itself must never
  // be dropped from either side.
  const referenceCell = (ref) => `<tr><th>Reference</th><td>${ref}</td></tr>`;
  if (typeof res.body.letterHtml === "string" && typeof direct.letterHtml === "string") {
    assert.ok(
      res.body.letterHtml.includes(referenceCell(res.body.externalRef)),
      "the API path's letter must carry its own reference"
    );
    assert.ok(
      direct.letterHtml.includes(referenceCell("direct-call")),
      "the direct call's letter must carry its own reference"
    );
    assert.deepEqual(
      res.body.letterHtml.replace(referenceCell(res.body.externalRef), "REFERENCE_CELL"),
      direct.letterHtml.replace(referenceCell("direct-call"), "REFERENCE_CELL"),
      "rendered letterHtml must match the real handler's, aside from each path's own reference"
    );
  } else {
    assert.deepEqual(res.body.letterHtml, direct.letterHtml, "rendered letterHtml must match the real handler's");
  }

  assert.match(res.body.externalRef, /^chatdemo-/);
  return res.body;
}

test("a standard message auto-resolves and renders exactly the real handler's letter", async () => {
  const result = await assertMessageMatchesDirectHandler({
    text: "Please send me a standard employment verification letter.",
    employmentId: "emp_active_001",
    asEmploymentId: "emp_active_001",
  });
  assert.equal(result.decision, "auto_resolve");
  assert.match(result.letterHtml, /Employment Verification Letter/);
});

test("an attached-bank-form message routes to human_review, matching the direct call", async () => {
  const result = await assertMessageMatchesDirectHandler({
    text: "My bank sent this form, please complete it.",
    employmentId: "emp_active_001",
    asEmploymentId: "emp_active_001",
    hasAttachment: true,
  });
  assert.equal(result.decision, "human_review");
});

test("a message about a terminated employee escalates, matching the direct call", async () => {
  const result = await assertMessageMatchesDirectHandler({
    text: "I need a standard employment letter.",
    employmentId: "emp_terminated_002",
    asEmploymentId: "emp_terminated_002",
  });
  assert.equal(result.decision, "escalate");
});

test("every message lands as its own case + audit row, the same as any other ticket", async () => {
  await callApi(handler, {
    method: "POST",
    path: "/api/messages",
    body: { text: "Please send me a standard employment verification letter.", employmentId: "emp_active_001", asEmploymentId: "emp_active_001" },
  });
  await callApi(handler, {
    method: "POST",
    path: "/api/messages",
    body: { text: "My bank sent this form, please complete it.", employmentId: "emp_active_001", asEmploymentId: "emp_active_001", hasAttachment: true },
  });

  assert.equal(caseStore.cases.length, 2, "each chat message is a distinct case");
  assert.equal(audit.entries.length, 2, "each chat message is a distinct audited decision");
});

test("an unknown route is a 404, not a silent fallback", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/definitely-not-a-route" });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

// ---------------------------------------------------------------------------
// The page's default state must demonstrate the path the page describes.
// ---------------------------------------------------------------------------
// This page has no scenario buttons — unlike the playground, whose quick-fills
// set the identity for you. It just says "Say something like 'Please send me a
// standard employment verification letter.'". With "Not logged in" selected by
// default, that exact suggested message escalated `identity_not_verified`, so
// the demo's own onboarding instruction produced a refusal and a first-time
// viewer saw a system that appears to refuse everything.
//
// Nothing about the gate changes — identity still comes from the session, and
// selecting "Not logged in" still demonstrates the fail-closed path. This pins
// that the DEFAULT is the state the surrounding copy claims.
test("the default identity makes the page's own suggested message reach the path it advertises", async () => {
  const html = read("index.html");

  // The default is expressed in the markup, so read it there rather than
  // inferring it from behaviour.
  const loggedInSelect = html.slice(html.indexOf('id="logged-in-select"'));
  const firstSelected = loggedInSelect.slice(0, loggedInSelect.indexOf("</select>")).match(/<option value="([^"]*)"[^>]*\bselected\b/);
  assert.ok(firstSelected, "one option in #logged-in-select must be marked selected — otherwise the default is 'Not logged in'");
  assert.ok(firstSelected[1], "the default logged-in identity must not be the empty (not-logged-in) value");

  // And the message the page tells a first-time viewer to send must actually
  // reach the auto-resolve path under that default.
  const suggested = "Please send me a standard employment verification letter.";
  assert.ok(html.includes(suggested), "the onboarding copy this test pins must still be the page's suggestion");

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/messages",
    body: { text: suggested, asEmploymentId: firstSelected[1], employmentId: firstSelected[1] },
  });
  assert.equal(res.status, 200);
  assert.equal(
    res.body.decision,
    "auto_resolve",
    "the page's own suggested first message must demonstrate the automation working, not refuse"
  );
  assert.ok(res.body.letterHtml, "and it must come back with the letter, which is the thing the demo exists to show");
});

test("a signed-in Remote user is DEFLECTED, and the demo can show it", async () => {
  // G-2 / DRIFT-076. The chat demo's whole point is that each typed message runs
  // through the real handler, so the outcome an eligible employee ACTUALLY gets
  // has to be reachable from it. `asRemoteSession` is the opt-in, and this test
  // is what stops the deflection becoming a code path no demo can show.
  const result = await assertMessageMatchesDirectHandler({
    text: "Please send me a standard employment verification letter.",
    employmentId: "emp_active_001",
    asEmploymentId: "emp_active_001",
    asRemoteSession: true,
  });
  assert.equal(result.decision, "deflected_to_self_service");
  assert.equal(result.letterHtml, undefined);
});

test("a third-party message WITH the consent-on-record checkbox reaches human_review, matching the direct call (G-3/L-8)", () => {
  return assertMessageMatchesDirectHandler({
    text: "This is First Bank, please verify employment on behalf of the employee.",
    employmentId: "emp_active_001",
    consentOnRecord: true,
  }).then((result) => {
    assert.equal(result.decision, "human_review");
    assert.equal(result.reason, "third_party_request");
  });
});
