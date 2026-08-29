// ---------------------------------------------------------------------------
// readAuth.test.js  —  Reads are gated by the same signed identity as writes
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS
// The signed-identity mechanism (src/shared/approverAuth.js, src/review/
// zafAuth.js) was applied to POST only. `deploy/cx-apis/handler.js` built its
// verifier under `req.method === "POST"` and consulted it under the same
// condition, so on the public deployment every GET route was unauthenticated.
//
//   GET /uc01/api/review/ticket/11
//
// returned — to anyone, with no credential — the employment id, the requester's
// real email address, the decision, the reason, the flags, the classification
// and the full review state. Ticket ids are sequential integers and there are
// nine prefixes, so that is not a lookup, it is an enumerable export of the
// whole corpus.
//
// WHAT IS ASSERTED, AND WHY IN THIS SHAPE
//   1. The gate is ON in all nine servers, not eight — a per-use-case loop, so
//      a tenth use case added without it fails here rather than in production.
//   2. It refuses BEFORE routing, so an unauthenticated caller cannot even map
//      the route surface by reading 404s.
//   3. It fails CLOSED on a missing verifier, an unsigned request and a bad
//      signature alike. A gate that degrades under misconfiguration is not one.
//   4. The local demo posture (the flag off) still reads with no credentials —
//      `npm run ucNN-api` on a fresh clone is how this repo is explored, and
//      docs/WALKTHROUGH.md depends on it.
//   5. Liveness (`/healthz`) is exempt on purpose: no customer data, and it is
//      how an operator establishes the service is answering at all.
//
// Hermetic: no network, no pool, no keys, no real verifier — the verifier is a
// double, which is the same dependency-injection discipline every other suite
// here uses.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveReader, resolveApprover } from "../src/shared/approverAuth.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { InMemoryReviewStore } from "../src/review/store.js";
import { createReviewHandler } from "../src/review/server.js";
import { createUc02Handler } from "../src/uc02/server.js";
import { createUc03Handler } from "../src/uc03/server.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { createUc05Handler } from "../src/uc05/server.js";
import { createUc06Handler } from "../src/uc06/server.js";
import { createUc07Handler } from "../src/uc07/server.js";
import { createUc08Handler } from "../src/uc08/server.js";
import { createUc09Handler } from "../src/uc09/server.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { DossierStore as Uc07DossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as Uc08DossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

// --- doubles ---------------------------------------------------------------

/** Accepts exactly one token string, refuses everything else. */
const VERIFIER = {
  verify: (token) =>
    token === "good.token.sig"
      ? { ok: true, approver: "agent@your-subdomain.test" }
      : { ok: false, code: "invalid_signature", reason: "Token signature did not verify." },
};

const SIGNED = { authorization: "Bearer good.token.sig" };

function callApi(handler, { method = "GET", path, headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
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
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

/**
 * Every use case, built twice: once with the read gate on and once off.
 *
 * `gate` names the two dependencies that carry the posture. UC-02 is the one
 * exception and it is deliberate: its `requireSignedIdentity` already names
 * the WRITE gate, defaults to true, and is bound to a verifier built with the
 * employment-id claim list — so its read gate has its own pair of names rather
 * than overloading one flag with two meanings.
 */
function buildAll({ on }) {
  const audit = new AuditLogger();
  const remote = {}; // no GET route touches Remote
  const g = on ? { requireSignedIdentity: true, zafVerifier: VERIFIER } : {};
  const g02 = on ? { requireSignedReads: true, readVerifier: VERIFIER } : {};
  const caseStore = new CaseStore();

  return [
    {
      prefix: "uc01",
      read: "/api/review/ticket/11",
      handler: createReviewHandler({
        store: new InMemoryReviewStore(caseStore),
        caseStore,
        audit,
        remote,
        ...g,
      }),
    },
    {
      prefix: "uc02",
      read: "/api/expenses/by-ticket/11",
      handler: createUc02Handler({ expenseStore: new ExpenseStore(), audit, remote, ...g02 }),
    },
    { prefix: "uc03", read: "/api/cases/by-ticket/11", handler: createUc03Handler({ caseStore, ...g }) },
    {
      prefix: "uc04",
      read: "/api/authorizations/by-ticket/11",
      handler: createUc04Handler({ authorizationStore: new AuthorizationStore(), audit, remote, ...g }),
    },
    {
      prefix: "uc05",
      read: "/api/resignations/by-ticket/11",
      handler: createUc05Handler({ resignationStore: new ResignationStore(), audit, remote, ...g }),
    },
    {
      prefix: "uc06",
      read: "/api/amendments/by-ticket/11",
      handler: createUc06Handler({ amendmentStore: new AmendmentStore(), audit, remote, ...g }),
    },
    {
      prefix: "uc07",
      read: "/api/dossiers/by-ticket/11",
      handler: createUc07Handler({ dossierStore: new Uc07DossierStore(), ...g }),
    },
    {
      prefix: "uc08",
      read: "/api/dossiers/by-ticket/11",
      handler: createUc08Handler({ dossierStore: new Uc08DossierStore(), ...g }),
    },
    {
      prefix: "uc09",
      read: "/api/adjustments/by-ticket/11",
      handler: createUc09Handler({ adjustmentStore: new AdjustmentStore(), audit, remote, ...g }),
    },
  ];
}

// --- 1. the regression guard ------------------------------------------------

// THIS IS THE BREACH TEST. Before the fix every one of these nine answered a
// credential-free GET with case data (or an honest 404 for a ticket that does
// not exist — either way, no 401). All nine must refuse.
test("a GET with NO credentials is refused by every use case when signed identity is required", async () => {
  for (const uc of buildAll({ on: true })) {
    const res = await callApi(uc.handler, { path: uc.read });
    assert.equal(res.status, 401, `${uc.prefix} served an unauthenticated read of ${uc.read}`);
    assert.equal(res.body.code, "signed_identity_required", uc.prefix);
    // The refusal has to say what is missing and where it goes, or the next
    // person to meet it "fixes" it by taking the gate back off.
    assert.match(res.body.reason, /Authorization: Bearer|X-ZAF-Token/, uc.prefix);
  }
});

test("a forged or unverifiable token is refused too — a signature is checked, not merely present", async () => {
  for (const uc of buildAll({ on: true })) {
    const res = await callApi(uc.handler, { path: uc.read, headers: { authorization: "Bearer forged" } });
    assert.equal(res.status, 401, uc.prefix);
    assert.equal(res.body.code, "invalid_signature", uc.prefix);
  }
});

// A gate that refuses only the routes it knows about leaks the route map: an
// unauthenticated caller walks paths and reads 404-vs-401 as a directory. It
// runs before routing, so an unknown path refuses identically.
test("the gate runs before routing, so an unauthenticated caller cannot map the route surface", async () => {
  for (const uc of buildAll({ on: true })) {
    const res = await callApi(uc.handler, { path: "/api/no-such-thing/12345" });
    assert.equal(res.status, 401, uc.prefix);
    assert.equal(res.body.code, "signed_identity_required", uc.prefix);
  }
});

// The verifier being absent is the state a half-configured deployment sits in,
// and it must refuse rather than fall back to serving the data.
test("no verifier configured refuses every read rather than degrading to open", async () => {
  const audit = new AuditLogger();
  const handler = createUc06Handler({
    amendmentStore: new AmendmentStore(),
    audit,
    remote: {},
    requireSignedIdentity: true,
    zafVerifier: null,
  });
  const res = await callApi(handler, {
    path: "/api/amendments/by-ticket/11",
    headers: { authorization: "Bearer good.token.sig" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_not_configured");
  assert.match(res.body.reason, /ZAF_SHARED_SECRET/);
});

// --- 2. the gate does not break the thing it protects ----------------------

test("a signed read is served, in all nine", async () => {
  for (const uc of buildAll({ on: true })) {
    const res = await callApi(uc.handler, { path: uc.read, headers: SIGNED });
    // 404 `{found:false}` is the right answer for ticket 11 in an empty store.
    // What matters is that it is NOT a 401 — the token got the caller through.
    assert.equal(res.status, 404, uc.prefix);
    assert.equal(res.body.found, false, uc.prefix);
  }
});

test("X-ZAF-Token carries the same token as Authorization: Bearer", async () => {
  const [uc01] = buildAll({ on: true });
  const res = await callApi(uc01.handler, { path: uc01.read, headers: { "x-zaf-token": "good.token.sig" } });
  assert.notEqual(res.status, 401);
});

// Requirement of this repo's own "clone and run in one command" trade: a
// credential-free `npm run ucNN-api` is the demo posture and must still read.
test("the local demo posture still reads with no credentials at all", async () => {
  for (const uc of buildAll({ on: false })) {
    const res = await callApi(uc.handler, { path: uc.read });
    assert.notEqual(res.status, 401, `${uc.prefix} refuses the credential-free local posture`);
  }
});

// Liveness carries no customer data and is how an operator learns the process
// is answering at all — gating it turns a diagnosable outage into a mystery.
test("/healthz stays open in every use case even with the gate on", async () => {
  for (const uc of buildAll({ on: true })) {
    const res = await callApi(uc.handler, { path: "/healthz" });
    assert.equal(res.status, 200, uc.prefix);
    assert.equal(res.body.ok, true, uc.prefix);
  }
});

// The ZAF iframe issues a cross-origin GET, so the preflight has to allow the
// header the token rides in — otherwise the browser drops the request before
// the server ever sees it and the sidebar reports "unreachable" for what is
// really a CORS mistake.
test("every server allow-lists the token headers on a preflight, so a signed GET survives CORS", async () => {
  for (const uc of buildAll({ on: true })) {
    const res = await callApi(uc.handler, { method: "OPTIONS", path: uc.read });
    const allowed = res.headers["access-control-allow-headers"] || "";
    assert.match(allowed, /Authorization/, uc.prefix);
    assert.match(allowed, /X-ZAF-Token/, uc.prefix);
  }
});

// --- 3. the shared rule, directly -------------------------------------------

test("resolveReader is off by default and returns no identity when off", () => {
  const verdict = resolveReader({ req: { headers: {} } });
  assert.deepEqual(verdict, { ok: true, reader: null, verified: false });
});

test("resolveReader and resolveApprover share one signature check", () => {
  const req = { headers: { authorization: "Bearer good.token.sig" } };
  const read = resolveReader({ req, requireSignedIdentity: true, zafVerifier: VERIFIER });
  const write = resolveApprover({ req, requireSignedIdentity: true, zafVerifier: VERIFIER });
  assert.equal(read.reader, "agent@your-subdomain.test");
  assert.equal(write.approver, "agent@your-subdomain.test");
  assert.equal(read.verified, true);

  // ...and they agree about the failure codes, so an operator debugging a 401
  // does not have to learn a second vocabulary depending on the verb used.
  const bare = { headers: {} };
  assert.equal(
    resolveReader({ req: bare, requireSignedIdentity: true, zafVerifier: VERIFIER }).code,
    resolveApprover({ req: bare, requireSignedIdentity: true, zafVerifier: VERIFIER }).code
  );
});

// A read gate must never become a way to act as somebody. It returns who the
// token names, and nothing in the repo attributes a decision to it.
test("resolveReader never yields an identity from an unverified header", () => {
  const req = { headers: { "x-zaf-approver": "spoofed@evil.test" } };
  const verdict = resolveReader({ req, requireSignedIdentity: true, zafVerifier: VERIFIER });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 401);
});
