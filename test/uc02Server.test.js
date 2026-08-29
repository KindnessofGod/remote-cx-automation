// ---------------------------------------------------------------------------
// uc02Server.test.js  —  The UC-02 expense intake + review API
// ---------------------------------------------------------------------------
// Same request/response-double pattern as uc06Server.test.js: drives the real
// handler with no listening socket, so these prove the API wraps
// workflow.js/policyEngine.js correctly without adding a second copy of any
// gate. The `submit` seam is used to force the classifier's rule-based branch
// (see uc02.test.js for why) — the API itself is unchanged.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { createUc02Handler, UC02_IDENTITY_CLAIM_PATHS } from "../src/uc02/server.js";
import { createZafVerifier } from "../src/review/zafAuth.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";

let server;
let remote;

before(async () => {
  server = await startMockServer(4029); // test-only port, distinct from uc02.test.js's 4028
  remote = new RemoteClient({ baseUrl: "http://localhost:4029" });
});
after(() => server && server.close());

// ---------------------------------------------------------------------------
// Signed identity (finding F-08). One RSA keypair for this suite signs fixture
// tokens exactly the way src/review/zafAuth.js verifies them — the SAME
// mechanism the review API uses, not a second one. The only difference is the
// claim read: this endpoint needs the submitter's employment id, so the
// verifier is built with UC02_IDENTITY_CLAIM_PATHS.
// ---------------------------------------------------------------------------

const keypair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function signToken(claims) {
  const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const headerB64 = b64url({ alg: "RS256", typ: "JWT" });
  const payloadB64 = b64url(claims);
  const signer = createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  return `${headerB64}.${payloadB64}.${signer.sign(keypair.privateKey).toString("base64url")}`;
}

/** A signed token asserting the caller IS this employment. */
function tokenFor(employmentId) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ employmentId, iat: now, exp: now + 300 });
}

const identityVerifier = createZafVerifier({
  publicKeyPem: keypair.publicKey,
  identityClaimPaths: UC02_IDENTITY_CLAIM_PATHS,
});

let audit;
let expenseStore;
let handler; // the DEFAULT, secure handler: a signed token is required
let demoHandler; // the opt-in local-demo handler: body session trusted

beforeEach(() => {
  audit = new AuditLogger();
  expenseStore = new ExpenseStore();
  // The only reason a `submit` override exists here is to inject the
  // deterministic classifier — never a real, retried LLM call from a test.
  const submit = (sub, deps) => handleExpenseSubmission(sub, { ...deps, classify: classifyExpenseRuleBased });
  handler = createUc02Handler({ expenseStore, audit, remote, submit, identityVerifier });
  demoHandler = createUc02Handler({ expenseStore, audit, remote, submit, allowUnauthenticatedDemo: true });
});

function callApi(handler, { method, path, body = null, rawBody = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = rawBody !== null ? rawBody : body !== null ? Buffer.from(JSON.stringify(body)) : null;
    const req = {
      method,
      url: path,
      headers,
      on(event, cb) {
        if (event === "data" && payload) cb(payload);
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

const session = { authenticatedEmploymentId: "emp_active_001" };
/** Headers for an authenticated submission as emp_active_001. */
const authed = () => ({ "x-zaf-token": tokenFor("emp_active_001") });

test("POST /api/expenses missing required fields -> 400 missing_fields", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/expenses", headers: authed(), body: { employmentId: "emp_active_001" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "missing_fields");
  assert.deepEqual(res.body.missing, ["expenseId"]);
});

test("POST /api/expenses compliant claim -> auto_approve, readable back as non-actionable", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: authed(),
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.authMode, "signed_identity");
  assert.equal(res.body.decision, "auto_approve");
  assert.equal(res.body.tier, "low");

  // An AUTO-APPROVED claim is still non-actionable — but for the real reason
  // now, not because the field was hard-coded. §6's Finance Ops decision exists
  // (see test/uc02Review.test.js) and applies to the `human_review` branch
  // only: a claim the gates cleared was never routed to a human, so there is
  // nothing for a human to decide about it.
  const view = await callApi(handler, { method: "GET", path: "/api/expenses/" + res.body.storeId });
  assert.equal(view.status, 200);
  assert.equal(view.body.found, true);
  assert.equal(view.body.actionable, false);
  // Specific, not a list of three: the row knows which of auto-approve /
  // block / escalate it got, so the refusal names it and says what it meant.
  assert.match(view.body.actionableReason, /AUTO-APPROVED/);
  assert.equal(view.body.expense.decision, "auto_approve");
});

test("POST /api/expenses over-cap claim -> human_review, findable by Zendesk ticket", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: authed(),
    body: { expenseId: "exp_srv_overcap_302", employmentId: "emp_active_001", externalRef: "ticket-987" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "human_review");
  assert.equal(res.body.reason, "over_policy_cap");
  assert.equal(res.body.tier, "medium");

  // by-ticket lookup for the ZAF Finance Ops panel, opened on the ticket.
  //
  // THIS ASSERTION USED TO READ `actionable, false` — and that was the defect,
  // pinned. A flagged claim is exactly the case UC-02.md §6 routes to Finance
  // Ops, so it MUST be actionable; the old expectation locked in a sidebar that
  // could show the exception and never resolve it. The verbs and the refusals
  // are proven in test/uc02Review.test.js.
  const byTicket = await callApi(handler, { method: "GET", path: "/api/expenses/by-ticket/ticket-987" });
  assert.equal(byTicket.status, 200);
  assert.equal(byTicket.body.expense.decision, "human_review");
  assert.equal(byTicket.body.actionable, true);
  assert.match(byTicket.body.actionableReason, /approve, decline .* or hold/);

  const missing = await callApi(handler, { method: "GET", path: "/api/expenses/by-ticket/ticket-unknown" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.found, false);
});

test("POST /api/expenses same receipt hash twice -> second submission blocked", async () => {
  const first = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: authed(),
    body: { expenseId: "exp_srv_dup_a_303", employmentId: "emp_active_001", receiptHash: "hash-srv-1" },
  });
  assert.equal(first.body.decision, "auto_approve");

  const second = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: authed(),
    body: { expenseId: "exp_srv_dup_b_304", employmentId: "emp_active_001", receiptHash: "hash-srv-1" },
  });
  assert.equal(second.body.decision, "blocked");
  assert.equal(second.body.reason, "duplicate_submission");
});

test("GET /api/expenses lists processed submissions newest first", async () => {
  await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: authed(),
    body: { expenseId: "exp_srv_overcap_302", employmentId: "emp_active_001" },
  });
  const res = await callApi(handler, { method: "GET", path: "/api/expenses" });
  assert.equal(res.status, 200);
  assert.ok(res.body.expenses.length >= 1);
  assert.equal(res.body.expenses[0].expenseId, "exp_srv_overcap_302"); // newest first
});

test("GET /api/expenses/:id for an unknown id -> 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/expenses/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("OPTIONS returns 204 with CORS headers", async () => {
  const res = await callApi(handler, { method: "OPTIONS", path: "/api/expenses" });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  assert.equal(res.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
});

test("GET /healthz is alive", async () => {
  const res = await callApi(handler, { method: "GET", path: "/healthz" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("unknown route -> 404 no_such_route", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/nope", body: {} });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

// ---------------------------------------------------------------------------
// F-08 (CRITICAL) — the write path had no authentication at all. These pin the
// fix: identity comes from a verified signature, never from the request body.
// ---------------------------------------------------------------------------

test("F-08. POST with NO token -> 401, and nothing is decided, stored or written", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001", session },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "signed_identity_required");
  // Fails CLOSED: no decision row, no audit entry, no PATCH — the request
  // never reached the workflow at all.
  assert.equal(expenseStore.list().length, 0);
  assert.equal(audit.entries.length, 0);
});

test("F-08b. a body-supplied session is NOT a credential — it alone still 401s", async () => {
  // This is the defect verbatim: `session: body.session ?? null` used to be
  // the whole of the identity check, so this exact request approved a claim.
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001", session },
  });
  assert.equal(res.status, 401);
  assert.equal(expenseStore.list().length, 0);
});

test("F-08c. with a valid token, a spoofed body session is ignored — the token wins", async () => {
  // The token says emp_active_003; the body claims to be emp_active_001, who
  // owns exp_srv_auto_301. If the body were trusted this would auto-approve.
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: { "x-zaf-token": tokenFor("emp_active_003") },
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001", session },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.authMode, "signed_identity");
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "identity_not_verified");
});

test("F-08d. a tampered token is refused with the verifier's own reason", async () => {
  const token = tokenFor("emp_active_001");
  const [header, , signature] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ employmentId: "emp_active_001" })).toString("base64url");
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: { "x-zaf-token": `${header}.${forgedPayload}.${signature}` },
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "invalid_signature");
  assert.equal(expenseStore.list().length, 0);
});

test("F-08e. an expired token is refused", async () => {
  const past = Math.floor(Date.now() / 1000) - 10_000;
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: { "x-zaf-token": signToken({ employmentId: "emp_active_001", iat: past, exp: past + 60 }) },
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "token_expired");
});

test("F-08f. an unsigned 'alg: none' token is refused before anything else is read", async () => {
  const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const none = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ employmentId: "emp_active_001" })}.`;
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: { "x-zaf-token": none },
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "unsupported_algorithm");
});

test("F-08g. requireSignedIdentity: true with NO verifier configured refuses — never degrades to the body", async () => {
  const unconfigured = createUc02Handler({
    expenseStore,
    audit,
    remote,
    submit: (sub, deps) => handleExpenseSubmission(sub, { ...deps, classify: classifyExpenseRuleBased }),
  });
  const res = await callApi(unconfigured, {
    method: "POST",
    path: "/api/expenses",
    headers: { "x-zaf-token": tokenFor("emp_active_001") },
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001", session },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_not_configured");
});

test("F-08h. turning requireSignedIdentity OFF is not a way to turn authentication off", async () => {
  // A config flag that quietly restores the vulnerability would be the same
  // defect wearing a different hat: only the explicit demo flag opts out.
  const off = createUc02Handler({
    expenseStore,
    audit,
    remote,
    submit: (sub, deps) => handleExpenseSubmission(sub, { ...deps, classify: classifyExpenseRuleBased }),
    requireSignedIdentity: false,
  });
  const res = await callApi(off, {
    method: "POST",
    path: "/api/expenses",
    body: { expenseId: "exp_srv_auto_301", employmentId: "emp_active_001", session },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_required");
  assert.equal(expenseStore.list().length, 0);
});

test("F-08i. the local demo flag keeps the seeded demo usable, and labels every response", async () => {
  const res = await callApi(demoHandler, {
    method: "POST",
    path: "/api/expenses",
    body: { expenseId: "exp_srv_demo_305", employmentId: "emp_active_001", session },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_approve");
  assert.equal(res.body.authMode, "unauthenticated_demo", "an unauthenticated decision must say so in its own response");
});

test("F-08j. the read routes stay open (read-only queue view), and the CORS preflight allows the token header", async () => {
  await callApi(demoHandler, {
    method: "POST",
    path: "/api/expenses",
    body: { expenseId: "exp_srv_overcap_302", employmentId: "emp_active_001", session },
  });
  const list = await callApi(handler, { method: "GET", path: "/api/expenses" });
  assert.equal(list.status, 200);
  assert.equal(list.body.expenses.length, 1);

  const preflight = await callApi(handler, { method: "OPTIONS", path: "/api/expenses" });
  assert.match(preflight.headers["access-control-allow-headers"], /X-ZAF-Token/);
});

// ---------------------------------------------------------------------------
// F-24 (MEDIUM) — idempotency, at the API layer this time.
// ---------------------------------------------------------------------------

test("F-24. POSTing the same expense twice decides it once", async () => {
  const body = { expenseId: "exp_srv_idem_306", employmentId: "emp_active_001" };
  const first = await callApi(handler, { method: "POST", path: "/api/expenses", headers: authed(), body });
  assert.equal(first.body.decision, "auto_approve");
  assert.notEqual(first.body.idempotent, true);

  const second = await callApi(handler, { method: "POST", path: "/api/expenses", headers: authed(), body });
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.storeId, first.body.storeId);
  assert.equal(expenseStore.list().length, 1, "a redelivered webhook must not mint a second decision");
});

test("malformed JSON body -> 500 internal_error, never a silent empty submission", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/expenses",
    headers: authed(),
    rawBody: Buffer.from("{not json"),
  });
  assert.equal(res.status, 500);
  assert.equal(res.body.code, "internal_error");
});
