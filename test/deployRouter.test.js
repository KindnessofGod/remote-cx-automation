// ---------------------------------------------------------------------------
// deployRouter.test.js  —  the Vercel deployment, without deploying anything
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS FOR
// deploy/cx-apis/ maps nine long-lived HTTP servers onto one serverless
// function. Two things in that mapping can silently be wrong in ways a green
// deploy would never reveal:
//
//   1. ROUTING. Vercel reports `READY` for a build that 404s every path —
//      deploy/remote-bridge's header comment records three deployments' worth
//      of exactly that. The router is pure, so it is checkable here instead.
//      UC-07 and UC-08 both serve `/api/dossiers`, so the prefix is not
//      cosmetic: getting it wrong sends a tax dossier request to the mobility
//      store and it would still answer 200.
//
//   2. STATE. A function keeps no memory between requests. The whole
//      deployment is worthless if an approval recorded on one invocation is
//      invisible to the next, so the test that matters most is the one below
//      that builds a SECOND handler with no shared memory and asks it the same
//      question. It passes only because the stores fall through to Postgres.
//
// Hermetic per CLAUDE.md §6: no network, no pool, no keys. Everything with an
// environment dependency is injected — which is also why createCxHandler takes
// its pool, env and verifier as parameters rather than reading them.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import {
  PORTAL,
  AUDIT_VIEW,
  THIRD_PARTY_DOOR,
  resolveRoute,
  resolveAllowedOrigin,
  isMemoryOnlyList,
  USE_CASES,
} from "../deploy/cx-apis/router.js";
import { createCxHandler, bodyShim } from "../deploy/cx-apis/handler.js";
import {
  unavailableRemote,
  readPosture,
  portalPosture,
  llmPosture,
  buildPortalHandler,
  buildAuditViewHandler,
  buildThirdPartyDoorHandler,
  PORTAL_BASE_PATH,
  AUDIT_BASE_PATH,
  THIRD_PARTY_BASE_PATH,
} from "../deploy/cx-apis/deps.js";
import { AuditReadStore } from "../src/auditview/readStore.js";
import { PORTAL_KEY_HEADER, PORTAL_KEY_ENV } from "../src/portal/access.js";
import { THIRD_PARTY_ACK_MESSAGE } from "../src/thirdparty/server.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { readJsonBody } from "../src/shared/httpBody.js";

// --- doubles ---------------------------------------------------------------

/** A response double with the surface the src/ handlers use. */
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    headersSent: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(payload) {
      this.headersSent = true;
      this.body = payload === undefined ? null : payload;
    },
  };
}

/** A request double. No body stream unless one is supplied. */
function fakeReq(method, url, { headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (body !== undefined) req.body = body;
  return req;
}

/**
 * A pg.Pool double that records every statement and answers from a table of
 * canned rows keyed by the table name appearing in the SQL.
 */
function fakePool(rowsByTable = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const table = Object.keys(rowsByTable).find((t) => sql.includes(t));
      return { rows: table ? rowsByTable[table] : [], rowCount: table ? rowsByTable[table].length : 0 };
    },
  };
}

/** One UC-06 amendment row as the SELECT aliases name it. */
function amendmentRow(overrides = {}) {
  return {
    id: "amend-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    employmentId: "emp_active_001",
    requester: "admin@acme.test",
    changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
    amendmentType: "SALARY_INCREASE",
    requestedEffectiveDate: "2026-09-01",
    decision: "dual_approval_required",
    reason: "gates_passed",
    flags: [],
    payload: null,
    cutoff: null,
    summary: "Salary increase.",
    faithfulness: null,
    externalRef: "3001",
    source: "zendesk",
    status: "pending_dual_approval",
    adminApproval: null,
    payrollApproval: null,
    deniedBy: null,
    executedAt: null,
    remoteResult: null,
    ...overrides,
  };
}

/** Environment with nothing set — the state a fresh Vercel project starts in. */
const BARE_ENV = {};

/**
 * A ZAF verifier double that accepts exactly one token.
 *
 * Needed by most read tests now that GETs are gated by the same signed
 * identity as writes (src/shared/approverAuth.js's resolveReader). Before that,
 * every GET route on this deployment answered with an employment id, the
 * requester's real email address and the full decision record to any caller
 * with no credential at all, over sequential integer ticket ids.
 */
const VERIFIER = {
  verify: (token) =>
    token === "good.token.sig"
      ? { ok: true, approver: "agent@your-subdomain.test" }
      : { ok: false, code: "invalid_signature", reason: "Token signature did not verify." },
};
const SIGNED = { authorization: "Bearer good.token.sig" };

/** Drive one request through a handler and return the parsed JSON body. */
async function call(handler, req, res = fakeRes()) {
  await handler(req, res);
  return { res, json: res.body ? JSON.parse(res.body) : null };
}

// --- 1. routing (pure) ------------------------------------------------------

// The index route reached production 404ing while /healthz and /__cx/health
// both worked. Nothing in router.js was wrong: `/:cxpath*` does not match the
// empty path, so `/` was never rewritten onto the function at all and Vercel
// answered with its own static 404 before any code here ran. That is why the
// test has to read vercel.json — the defect lived entirely in configuration,
// and every unit test of resolveRoute passed throughout.
test("vercel.json rewrites the bare root onto the function, not just deeper paths", () => {
  const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const sources = cfg.rewrites.map((r) => r.source);
  assert.ok(sources.includes("/"), "no rewrite matches the bare root path");

  // And the router must make sense of what that rewrite injects: an EMPTY
  // __cx_path, which is a different case from an absent one.
  const root = cfg.rewrites.find((r) => r.source === "/");
  assert.equal(resolveRoute(root.destination).route, "/");
});

test("resolveRoute reads the path the vercel.json rewrite injects", () => {
  const route = resolveRoute("/api?__cx_path=uc06/api/amendments/by-ticket/3001");
  assert.equal(route.kind, "usecase");
  assert.equal(route.prefix, "uc06");
  assert.equal(route.url, "/api/amendments/by-ticket/3001");
});

test("resolveRoute also works on the un-rewritten path, so a direct /api call is debuggable", () => {
  const route = resolveRoute("/api/uc04/api/authorizations/by-ticket/7");
  assert.equal(route.prefix, "uc04");
  assert.equal(route.url, "/api/authorizations/by-ticket/7");
});

test("UC-07 and UC-08 share /api/dossiers and are told apart only by the prefix", () => {
  assert.equal(resolveRoute("/api?__cx_path=uc07/api/dossiers/by-ticket/9").prefix, "uc07");
  assert.equal(resolveRoute("/api?__cx_path=uc08/api/dossiers/by-ticket/9").prefix, "uc08");
  // ...and both present the SAME inner path to their handler, which is exactly
  // why one host without a prefix could not serve them both.
  assert.equal(
    resolveRoute("/api?__cx_path=uc07/api/dossiers/by-ticket/9").url,
    resolveRoute("/api?__cx_path=uc08/api/dossiers/by-ticket/9").url
  );
});

test("the caller's query string survives; this deployment's routing artifacts do not", () => {
  const route = resolveRoute("/api?__cx_path=uc03/api/cases&cxpath=uc03/api/cases&limit=5&path=keepme");
  assert.equal(route.url, "/api/cases?limit=5&path=keepme");
});

test("/, /healthz and /__cx/health are the deployment's own routes", () => {
  assert.equal(resolveRoute("/api?__cx_path=").kind, "meta");
  assert.equal(resolveRoute("/api?__cx_path=healthz").route, "/healthz");
  assert.equal(resolveRoute("/api?__cx_path=__cx/health").route, "/__cx/health");
});

test("an unrecognised prefix is a routing answer, not a use-case 404", () => {
  const route = resolveRoute("/api?__cx_path=uc42/api/whatever");
  assert.equal(route.kind, "unknown");
  assert.equal(route.path, "/uc42/api/whatever");
});

test("every use case is reachable under its own prefix", () => {
  for (const uc of USE_CASES) {
    assert.equal(resolveRoute(`/api?__cx_path=${uc.prefix}/healthz`).prefix, uc.prefix);
  }
});

// --- 2. CORS ----------------------------------------------------------------

test("ZAF_ALLOWED_ORIGIN unset keeps the servers' own '*' default", () => {
  assert.equal(resolveAllowedOrigin(undefined, "https://x.zendesk.com"), "*");
  assert.equal(resolveAllowedOrigin("", null), "*");
});

test("a configured origin list reflects a match and refuses a mismatch visibly", () => {
  const list = "https://your-subdomain.zendesk.com, https://1234.apps.zdusercontent.com";
  assert.equal(resolveAllowedOrigin(list, "https://1234.apps.zdusercontent.com"), "https://1234.apps.zdusercontent.com");
  // A non-matching origin gets the first configured entry, so the browser
  // blocks it. Reflecting an unknown origin would defeat the setting.
  assert.equal(resolveAllowedOrigin(list, "https://evil.test"), "https://your-subdomain.zendesk.com");
});

// --- 3. state survives between invocations ---------------------------------

test("a case written by one invocation is readable by the NEXT — the whole point of attaching Supabase", async () => {
  const pool = fakePool({ uc06_amendments: [amendmentRow()] });
  const mk = () =>
    createCxHandler({ getPool: () => pool, env: BARE_ENV, buildVerifier: async () => VERIFIER });

  // Signed, because an attached pool is one of the two triggers that require a
  // signed identity — and reads honour that flag now, not just writes.
  // Two independently constructed handlers, sharing nothing but the pool —
  // the closest a test can get to two cold starts of the same function.
  const read = { headers: SIGNED };
  const first = await call(mk(), fakeReq("GET", "/api?__cx_path=uc06/api/amendments/by-ticket/3001", read));
  const second = await call(mk(), fakeReq("GET", "/api?__cx_path=uc06/api/amendments/by-ticket/3001", read));

  assert.equal(first.res.statusCode, 200);
  assert.equal(first.json.found, true);
  assert.equal(first.json.amendment.id, "amend-1");
  assert.deepEqual(second.json, first.json);
  // And it really came from the database, not from anything held in process.
  assert.ok(pool.calls.some((c) => c.sql.includes("uc06_amendments") && c.params?.[0] === "3001"));
});

test("with no pool attached the same read is empty rather than invented", async () => {
  const handler = createCxHandler({ getPool: () => null, env: BARE_ENV, buildVerifier: async () => null });
  const { res, json } = await call(handler, fakeReq("GET", "/api?__cx_path=uc06/api/amendments/by-ticket/3001"));
  assert.equal(res.statusCode, 404);
  assert.equal(json.found, false);
});

test("the prefix decides which table is read, so uc07 and uc08 cannot answer for each other", async () => {
  const pool = fakePool({ uc07_dossiers: [], uc08_dossiers: [] });
  const handler = createCxHandler({ getPool: () => pool, env: BARE_ENV, buildVerifier: async () => VERIFIER });

  await call(handler, fakeReq("GET", "/api?__cx_path=uc07/api/dossiers/by-ticket/9", { headers: SIGNED }));
  await call(handler, fakeReq("GET", "/api?__cx_path=uc08/api/dossiers/by-ticket/9", { headers: SIGNED }));

  assert.ok(pool.calls.some((c) => c.sql.includes("uc07_dossiers")));
  assert.ok(pool.calls.some((c) => c.sql.includes("uc08_dossiers")));
});

// --- 4. the deliberate gate -------------------------------------------------

test("with a durable store and no ZAF key, a write is refused — and the refusal explains itself", async () => {
  const pool = fakePool({ uc06_amendments: [amendmentRow()] });
  const handler = createCxHandler({ getPool: () => pool, env: BARE_ENV, buildVerifier: async () => null });

  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=uc06/api/amendments/amend-1/approve", {
      body: { role: "customer_admin", approver: "someone@acme.test" },
    })
  );

  assert.equal(res.statusCode, 401);
  // Same code the underlying gate uses — nothing new to learn, only explained.
  assert.equal(json.code, "signed_identity_not_configured");
  assert.ok(json.howToFix.some((s) => s.includes("ZAF_APP_PUBLIC_KEY_PEM")));
  // This assertion used to read `json.readsStillWork.includes("/uc06")`, and
  // that field was accurate: reads DID still work, because only writes were
  // gated. It was the refusal body cheerfully documenting the data-exposure
  // issue beside it. One variable now unblocks both, and the body says so.
  assert.ok(json.scope.includes("/uc06"));
  assert.match(json.scope, /reads and writes/);
  // And nothing was written while refusing.
  assert.ok(!pool.calls.some((c) => /^\s*(insert|update)/i.test(c.sql.trim())));
});

test("the refusal is a refusal — it never turns into an approval when a verifier IS present", async () => {
  // A verifier that refuses every token: the request must still fail, and
  // must fail INSIDE the real gate (401 signed_identity_required for a missing
  // token), never fall through to the header posture.
  const pool = fakePool({ uc06_amendments: [amendmentRow()] });
  const handler = createCxHandler({
    getPool: () => pool,
    env: BARE_ENV,
    buildVerifier: async () => ({ verify: () => ({ ok: false, code: "invalid_signature", reason: "no" }) }),
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=uc06/api/amendments/amend-1/approve", {
      headers: { "x-zaf-approver": "spoofed@evil.test" },
      body: { role: "customer_admin", approver: "spoofed@evil.test" },
    })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "signed_identity_required");
});

test("UC-02's submit route is refused without a key too, and demo mode is never enabled here", async () => {
  const handler = createCxHandler({ getPool: () => fakePool(), env: BARE_ENV, buildVerifier: async () => null });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=uc02/api/expenses", { body: { expenseId: "e1", employmentId: "emp_1" } })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "signed_identity_not_configured");
});

// THE BREACH, INVERTED. This test used to be called "read-only routes are
// unaffected by the missing key — day-one usefulness" and asserted 200. It was
// passing, and it was pinning the defect: a durable store attached, no ZAF key,
// and a GET returning an employment id and the requester's real email address
// to a caller with no credential. Day-one usefulness is worth a lot, and it is
// not worth that. The same missing variable now refuses both verbs, and the
// refusal explains itself rather than arriving as a bare 401.
test("with a durable store and no ZAF key, a READ is refused too — and says why", async () => {
  const pool = fakePool({ uc06_amendments: [amendmentRow()] });
  const handler = createCxHandler({ getPool: () => pool, env: BARE_ENV, buildVerifier: async () => null });
  const { res, json } = await call(handler, fakeReq("GET", "/api?__cx_path=uc06/api/amendments/by-ticket/3001"));

  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "signed_identity_not_configured");
  assert.match(json.reason, /disclose customer-case data/);
  assert.match(json.why, /sequential integer/);
  assert.ok(json.howToFix.some((s) => s.includes("ZAF_SHARED_SECRET")));
  // And it never leaked the row on the way to refusing.
  assert.doesNotMatch(res.body, /emp_active_001/);
});

test("a signed read is served once a verifier exists", async () => {
  const pool = fakePool({ uc06_amendments: [amendmentRow()] });
  const handler = createCxHandler({ getPool: () => pool, env: BARE_ENV, buildVerifier: async () => VERIFIER });
  const { res, json } = await call(
    handler,
    fakeReq("GET", "/api?__cx_path=uc06/api/amendments/by-ticket/3001", { headers: SIGNED })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(json.found, true);
});

// Every prefix, not the one that happened to be convenient: the read-only use
// cases (uc07/uc08 — and uc03 until its travel-letter sign-off landed) have no
// POST route at all, which is exactly why they were the easiest to overlook.
// "It cannot be written to" was never a reason its records were safe to publish.
test("an unauthenticated GET is refused on ALL NINE prefixes, read-only ones included", async () => {
  const handler = createCxHandler({
    getPool: () => fakePool(),
    env: BARE_ENV,
    buildVerifier: async () => VERIFIER,
  });
  for (const uc of USE_CASES) {
    const { res, json } = await call(handler, fakeReq("GET", `/api?__cx_path=${uc.prefix}/api/anything/by-ticket/11`));
    assert.equal(res.statusCode, 401, `${uc.prefix} served an unauthenticated read`);
    assert.equal(json.code, "signed_identity_required", uc.prefix);
  }
});

// The meta routes carry no customer data and are how an operator diagnoses a
// deployment that is refusing everything else. Gating them would make the
// refusal undiagnosable from outside.
test("meta routes stay open with no credentials, so a refusing deployment is still diagnosable", async () => {
  const handler = createCxHandler({
    getPool: () => fakePool(),
    env: { ...BARE_ENV, VERCEL: "1" },
    buildVerifier: async () => VERIFIER,
  });
  for (const path of ["", "healthz", "__cx/health", "__cx/routes"]) {
    const { res } = await call(handler, fakeReq("GET", `/api?__cx_path=${path}`));
    assert.equal(res.statusCode, 200, `/${path} is not reachable without a credential`);
  }
  // ...and so is each use case's own liveness probe.
  const { res } = await call(handler, fakeReq("GET", "/api?__cx_path=uc06/healthz"));
  assert.equal(res.statusCode, 200, "/uc06/healthz is gated; a liveness probe must not need a token");
});

// The local, credential-free posture is how a fresh clone and
// docs/WALKTHROUGH.md are explored. No pool and not on Vercel means no
// requirement, and reads must still answer.
test("with no pool and not on Vercel, reads need no token at all", async () => {
  const handler = createCxHandler({ getPool: () => null, env: BARE_ENV, buildVerifier: async () => null });
  const { res } = await call(handler, fakeReq("GET", "/api?__cx_path=uc06/api/amendments/by-ticket/3001"));
  assert.equal(res.statusCode, 404); // no row — but reached the handler, not the gate
  assert.equal(readPosture(BARE_ENV, { pgPool: null }).signedIdentityRequired, false);
});

// --- 5. posture is legible without reading a log ---------------------------

test("/__cx/health states plainly that writes are refused by design, and echoes the caller's origin", async () => {
  const handler = createCxHandler({
    getPool: () => fakePool(),
    env: BARE_ENV,
    buildVerifier: async () => null,
  });
  const { json } = await call(
    handler,
    fakeReq("GET", "/api?__cx_path=__cx/health", { headers: { origin: "https://1234.apps.zdusercontent.com" } })
  );
  // `reads` used to read "WORKING" here — a pool is attached, so there are
  // rows — while those reads were being served to anyone. The field answered
  // "is there data?" and was taken for "may anyone have it?". It now answers
  // the second question first, and there is a flag for it that needs no prose
  // parsing.
  assert.match(json.reads, /^REFUSED BY DESIGN/);
  assert.equal(json.readsRequireSignedIdentity, true);
  assert.match(json.writes, /^REFUSED BY DESIGN/);
  assert.equal(json.posture.zafVerifierBuilt, false);
  assert.equal(json.posture.signedIdentityRequired, true);
  // The one value nobody can guess reliably, handed back so it can be pasted
  // into ZAF_ALLOWED_ORIGIN.
  assert.equal(json.yourOrigin, "https://1234.apps.zdusercontent.com");
});

// The live Vercel deployment is exactly this shape — public, no SUPABASE_DB_URL
// — and the health body used to hard-code "(a durable store is attached)" as
// its reason, which was flatly false here. A reader chasing that sentence would
// go looking at the database when the trigger was the public URL. The refusal
// was always right; only its stated reason was wrong, which is the failure mode
// a health endpoint exists to prevent.
test("/__cx/health names the reason writes are refused — public reachability, not a store that isn't there", async () => {
  const handler = createCxHandler({
    getPool: () => null, // no SUPABASE_DB_URL
    env: { ...BARE_ENV, VERCEL: "1" },
    buildVerifier: async () => null,
  });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));

  assert.equal(json.posture.supabaseAttached, false);
  assert.equal(json.posture.publiclyReachable, true);
  assert.equal(json.posture.signedIdentityRequired, true);
  assert.match(json.writes, /publicly reachable/);
  assert.doesNotMatch(json.writes, /durable store is attached/);
});

test("/__cx/health names BOTH reasons when both triggers are live", async () => {
  const handler = createCxHandler({
    getPool: () => fakePool(),
    env: { ...BARE_ENV, VERCEL: "1" },
    buildVerifier: async () => null,
  });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  assert.match(json.writes, /durable store is attached and this deployment is publicly reachable/);
});

// The 401 body and the health body are two different functions that answer the
// same question, written on different days. The health one was fixed to derive
// its reason; this one kept asserting "a durable Supabase store is attached"
// and was reachable on a deployment where that was false. A refusal that
// misnames its own cause sends the reader to fix the wrong thing, and this is
// the body a person actually meets — health is where you go afterwards.
test("the 401 refusal names the same reason as /__cx/health, derived not asserted", async () => {
  const handler = createCxHandler({
    getPool: () => null, // no SUPABASE_DB_URL — public reachability is the only trigger
    env: { ...BARE_ENV, VERCEL: "1" },
    buildVerifier: async () => null,
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=uc06/api/amendments/amend-1/approve", { body: { role: "admin" } })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "signed_identity_not_configured");
  assert.match(json.why, /publicly reachable/);
  assert.doesNotMatch(json.why, /durable Supabase store is attached/);
});

test("/__cx/health flips to WORKING once a verifier exists", async () => {
  const handler = createCxHandler({
    getPool: () => fakePool(),
    env: BARE_ENV,
    buildVerifier: async () => ({ verify: () => ({ ok: true, approver: "a@b.test" }) }),
  });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  assert.match(json.writes, /^WORKING/);
  assert.equal(json.posture.zafVerifierBuilt, true);
});

// rca-pb8a: /__cx/health used to report `writes: "WORKING"` and
// `approverEntitlementSource: "APPROVER_ROLES"` in a state where production
// was refusing every UC-01 approval — a non-empty, correctly-sourced roster
// that happened to grant nobody the UC-01 role. Neither of those fields could
// ever have shown that, and this is the NEGATIVE CONTROL the bead requires:
// hit health in both postures and confirm they actually differ, not just that
// one of them looks healthy.
test("/__cx/health's approverEntitlementCoverage tells apart a roster that covers UC-01 from one that does not", async () => {
  const healthWith = async (approverRoles) => {
    const handler = createCxHandler({
      getPool: () => fakePool(),
      env: { ...BARE_ENV, APPROVER_ROLES: approverRoles },
      buildVerifier: async () => ({ verify: () => ({ ok: true, approver: "a@b.test" }) }),
    });
    return (await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"))).json;
  };

  // The K10-fallout shape: correctly sourced, non-empty, and STILL zero for
  // UC-01 — the exact case a health reader must be able to catch.
  const scopedToUc05 = await healthWith("hr.jane@remote.test=uc05:hr_ops");
  assert.equal(scopedToUc05.posture.approverEntitlementSource, "APPROVER_ROLES");
  assert.match(scopedToUc05.writes, /^WORKING/);
  assert.equal(scopedToUc05.posture.approverEntitlementCoverage["UC-01"], 0);
  assert.equal(scopedToUc05.posture.approverEntitlementCoverage["UC-05"], 1);

  // Same source, same "WORKING" writes line, genuinely different coverage —
  // this is the pair that must NOT read identically.
  const bareHrOps = await healthWith("hr.jane@remote.test=hr_ops");
  assert.equal(bareHrOps.posture.approverEntitlementSource, "APPROVER_ROLES");
  assert.match(bareHrOps.writes, /^WORKING/);
  assert.equal(bareHrOps.posture.approverEntitlementCoverage["UC-01"], 1);
  assert.equal(bareHrOps.posture.approverEntitlementCoverage["UC-05"], 1);

  assert.notDeepEqual(scopedToUc05.posture.approverEntitlementCoverage, bareHrOps.posture.approverEntitlementCoverage);

  // Unconfigured roster: still enforced (persistent store attached), coverage
  // reads zero everywhere rather than being omitted.
  const unconfigured = await healthWith(undefined);
  assert.equal(unconfigured.posture.approverEntitlementCoverage["UC-01"], 0);
  assert.equal(unconfigured.posture.approverEntitlementCoverage["UC-09"], 0);
});

test("/__cx/health's approverEntitlementCoverage is null, not a lie, when entitlement is not enforced at all", async () => {
  // The seeded in-memory demo posture: no pool, no VERCEL. There is no
  // checker to ask, so this must not silently report zeros that would read
  // as "nobody can approve anything" about a posture where entitlement is
  // simply not consulted.
  const handler = createCxHandler({
    getPool: () => null,
    env: BARE_ENV,
    buildVerifier: async () => null,
  });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  assert.equal(json.posture.approverEntitlementEnforced, false);
  assert.equal(json.posture.approverEntitlementCoverage, null);
});

test("readPosture treats an attached pool as the production posture", () => {
  assert.equal(readPosture({}, { pgPool: {} }).signedIdentityRequired, true);
  assert.equal(readPosture({}, { pgPool: null }).signedIdentityRequired, false);
  // ...and the deliberate, greppable override still wins.
  assert.equal(readPosture({ ZAF_ALLOW_UNSIGNED_IDENTITY: "true" }, { pgPool: {} }).signedIdentityRequired, false);
});

// --- 6. the serverless-shaped hazards --------------------------------------

test("a list route backed by process memory says so instead of answering an empty array", async () => {
  const handler = createCxHandler({ getPool: () => fakePool(), env: BARE_ENV, buildVerifier: async () => null });
  const { res, json } = await call(handler, fakeReq("GET", "/api?__cx_path=uc06/api/amendments"));
  assert.equal(res.statusCode, 501);
  assert.equal(json.code, "list_not_available_serverless");
  assert.ok(json.useThisInstead.some((s) => s.includes("by-ticket")));
});

test("the Postgres-backed list routes are NOT intercepted", () => {
  assert.equal(isMemoryOnlyList(resolveRoute("/api?__cx_path=uc01/api/review/tickets"), "GET"), false);
  assert.equal(isMemoryOnlyList(resolveRoute("/api?__cx_path=uc03/api/cases"), "GET"), false);
  // ...and a by-ticket read under a memory-only use case is not intercepted either.
  assert.equal(isMemoryOnlyList(resolveRoute("/api?__cx_path=uc06/api/amendments/by-ticket/1"), "GET"), false);
});

test("bodyShim hands a pre-parsed body back as a readable stream the src/ servers can read", async () => {
  const req = fakeReq("POST", "/anything", { body: { role: "customer_admin", note: "ok" } });
  const shim = bodyShim(req, "/api/amendments/x/approve");
  assert.equal(shim.url, "/api/amendments/x/approve");
  assert.equal(shim.method, "POST");
  assert.deepEqual(await readJsonBody(shim), { role: "customer_admin", note: "ok" });
});

test("bodyShim leaves an intact stream alone, only rewriting the url", () => {
  const req = fakeReq("POST", "/uc06/api/amendments/x/approve");
  const shim = bodyShim(req, "/api/amendments/x/approve");
  assert.equal(shim, req);
  assert.equal(req.url, "/api/amendments/x/approve");
});

test("an unconfigured Remote client fails with an instruction, not a hung connection", () => {
  const remote = unavailableRemote();
  assert.throws(() => remote.getEmployment("emp_1"), /remote_api_not_configured/);
  assert.throws(() => remote.anythingAtAll(), /REMOTE_API_TOKEN/);
  // Must never be mistaken for a promise by an `await`.
  assert.equal(remote.then, undefined);
});

test("an unknown prefix answers with the prefixes that do exist", async () => {
  const handler = createCxHandler({ getPool: () => fakePool(), env: BARE_ENV, buildVerifier: async () => null });
  const { res, json } = await call(handler, fakeReq("GET", "/api?__cx_path=review/tickets"));
  assert.equal(res.statusCode, 404);
  assert.equal(json.code, "no_such_use_case");
  assert.ok(json.knownPrefixes.includes("/uc01"));
});

test("a CORS preflight to a deployment route is answered without touching a use case", async () => {
  const handler = createCxHandler({ getPool: () => fakePool(), env: BARE_ENV, buildVerifier: async () => null });
  const res = fakeRes();
  await handler(fakeReq("OPTIONS", "/api?__cx_path=__cx/health"), res);
  assert.equal(res.statusCode, 204);
  // Authorization is on the list because that is where the sidebar puts its
  // signed token — `Authorization: Bearer {{jwt.token}}`, ZAF's own documented
  // shape. Omitting it means the browser drops the header on a cross-origin
  // POST and the server sees an unauthenticated request it must refuse.
  assert.equal(
    res.headers["access-control-allow-headers"],
    "Content-Type, Authorization, X-ZAF-Approver, X-ZAF-Token"
  );
});

// ---------------------------------------------------------------------------
// Public reachability requires signed identity, independently of durability
// ---------------------------------------------------------------------------
// The shared rule in approverAuth.js asks "will this decision outlive the
// process?". On a public URL the sharper question is "who can reach this?".
// They diverge in exactly the state a first deploy lands in — no SUPABASE_DB_URL
// yet — where the shared rule would permit the header posture on an endpoint the
// whole internet can POST to.

test("on Vercel, signed identity is required even with no durable store", () => {
  const posture = readPosture({ VERCEL: "1" }, { pgPool: null });
  assert.equal(posture.publiclyReachable, true);
  assert.equal(
    posture.signedIdentityRequired,
    true,
    "a public endpoint must never accept an approval named only by a request header"
  );
});

test("the platform check can only ADD the requirement, never remove it", () => {
  // Off-platform with a durable store: the shared rule already requires it, and
  // the absence of VERCEL must not undo that.
  const durable = readPosture({}, { pgPool: {} });
  assert.equal(durable.signedIdentityRequired, true);
  assert.equal(durable.publiclyReachable, false);
});

test("an explicit unsigned-identity override cannot reopen a public deployment", () => {
  // ZAF_ALLOW_UNSIGNED_IDENTITY is the documented escape hatch for local demos.
  // It must not be a way to turn a public URL back into a header-trust endpoint.
  const posture = readPosture({ VERCEL: "1", ZAF_ALLOW_UNSIGNED_IDENTITY: "true" }, { pgPool: null });
  assert.equal(posture.signedIdentityRequired, true);
});

// --- 8. the request portal, mounted at /portal -------------------------------
//
// A tenth surface on the same host, gated by a DIFFERENT credential. Both
// halves matter: it must be refused without a key (it writes), and it must
// still work with one (a gate that refuses everything passes every fail-closed
// assertion — docs/BUILD-LOG.md §3.30).

/** The portal's LLM seams, forced down their deterministic branch. */
const PORTAL_LLM = { classifyTravel: classifyTravelInquiryRuleBased };
const PORTAL_KEY = "deployment-portal-key";

/** The E2E plan's Phase 2 row 3 — the submission that must succeed. */
const SPAIN_TRIP = {
  persona: "chris",
  text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
  externalRef: "deploy-portal-3001",
};

test("the portal is routed by prefix, and is not a tenth use case", () => {
  assert.equal(resolveRoute("/api?__cx_path=portal").kind, "portal");
  assert.equal(resolveRoute("/api?__cx_path=portal/api/context").url, "/api/context");
  assert.equal(resolveRoute("/api?__cx_path=portal/app.js").url, "/app.js");
  // Not in USE_CASES on purpose: every gate that iterates that list applies the
  // ZAF-signed identity rule, which the portal cannot satisfy and must not
  // cause anyone to relax. See router.js's PORTAL comment.
  assert.ok(!USE_CASES.some((u) => u.prefix === PORTAL.prefix));
  assert.equal(PORTAL_BASE_PATH, "/" + PORTAL.prefix);
});

test("/__cx/health answers \"is the portal mounted, and is it gated?\" without a request", async () => {
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1" },
    buildVerifier: () => null,
  });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));

  assert.equal(json.portal.mounted, true);
  assert.equal(json.portal.prefix, "/portal");
  assert.equal(json.portal.accessKeyRequired, true, "a public deployment must gate the intake surface");
  assert.equal(json.portal.accessKeyConfigured, false);
  assert.equal(json.portal.keyHeader, PORTAL_KEY_HEADER);
  assert.ok(json.portal.status.includes("REFUSED BY DESIGN"));
  assert.ok(json.portal.whyRequired.join(" ").includes("publicly reachable"));
});

test("REGRESSION GUARD: an anonymous submission through the deployment is refused", async () => {
  // The defect this guards against is the one closed on this deployment the
  // same week: a surface published next to nine freshly-gated ones, reachable
  // by anyone. The portal WRITES, so leaving it open would be strictly worse
  // than the read exposure that prompted the fix.
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=portal/api/requests/uc03", { body: SPAIN_TRIP })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "portal_access_key_required");
});

test("with no key configured at all, the deployment's portal fails closed and says what to set", async () => {
  const handler = createCxHandler({ getPool: () => null, env: { VERCEL: "1" }, buildVerifier: () => null });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=portal/api/requests/uc03", { body: SPAIN_TRIP })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "portal_access_key_not_configured");
  assert.ok(json.howToFix.join(" ").includes(PORTAL_KEY_ENV));
});

test("POSITIVE: with the key, a submission through the deployment reaches the right decision", async () => {
  const env = { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY };
  const handler = createCxHandler({
    getPool: () => null,
    env,
    buildVerifier: () => null,
    // Only the LLM seams are injected — the store wiring, the mock-Remote
    // transport and the access posture are the deployment's real ones.
    buildPortal: (ctx) => buildPortalHandler({ ...ctx, llm: PORTAL_LLM }),
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=portal/api/requests/uc03", {
      body: SPAIN_TRIP,
      headers: { [PORTAL_KEY_HEADER]: PORTAL_KEY },
    })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(json.ok, true);
  assert.equal(json.decision, "auto_resolve");
});

test("the portal page loads with no ZAF verifier configured — its gate is not the sidebar's", async () => {
  // The nine refuse every GET with signed_identity_not_configured in this
  // state. The portal must not: nothing can mint it a ZAF token, so applying
  // that rule to it would make it permanently unusable, and "make the nine
  // weaker until the portal fits" is the repair that must never look tempting.
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
  });
  // Driven directly rather than through call(): the response is HTML, and the
  // helper parses JSON.
  const res = fakeRes();
  await handler(fakeReq("GET", "/api?__cx_path=portal"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.body).includes("<base href=\"/portal/\" />"), "the mounted page needs its base tag");
  assert.ok(!String(res.body).includes("signed_identity_not_configured"));
});

test("the deployment sends the portal no CORS header — its only client is its own page", async () => {
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
  });
  const res = fakeRes();
  await handler(fakeReq("GET", "/api?__cx_path=portal", { headers: { origin: "https://evil.test" } }), res);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("the portal posture is computed from the same two inputs as the nine", () => {
  assert.equal(portalPosture({}, { pgPool: null }).required, false);
  assert.equal(portalPosture({}, { pgPool: {} }).required, true);
  assert.equal(portalPosture({ VERCEL: "1" }, { pgPool: null }).required, true);
});

// --- 9. the audit trail viewer, mounted at /audit ----------------------------
//
// An eleventh surface, read-only by construction, gated by the SAME shared key
// as the portal — one key, two surfaces, one posture function. Both directions
// again: refused without the key, working with it.

const AUDIT_SEEDED = new AuditReadStore({ seeded: true });

test("the audit viewer is routed by prefix, and is not a use case either", () => {
  assert.equal(resolveRoute("/api?__cx_path=audit").kind, "audit");
  assert.equal(resolveRoute("/api?__cx_path=audit/api/decisions").url, "/api/decisions");
  assert.equal(resolveRoute("/api?__cx_path=audit/app.js").url, "/app.js");
  // The routing artifacts are stripped, the caller's own params survive.
  assert.equal(
    resolveRoute("/api?__cx_path=audit/api/decisions&use_case=UC-06").url,
    "/api/decisions?use_case=UC-06"
  );
  assert.ok(!USE_CASES.some((u) => u.prefix === AUDIT_VIEW.prefix));
  assert.equal(AUDIT_BASE_PATH, "/" + AUDIT_VIEW.prefix);
  assert.equal(AUDIT_VIEW.writes, false);
});

test("/__cx/health answers \"is the audit viewer mounted, gated, and does it have data?\"", async () => {
  const handler = createCxHandler({ getPool: () => null, env: { VERCEL: "1" }, buildVerifier: () => null });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  assert.equal(json.auditView.mounted, true);
  assert.equal(json.auditView.prefix, "/audit");
  assert.equal(json.auditView.readOnly, true);
  assert.equal(json.auditView.durableStoreAttached, false);
  assert.equal(json.auditView.accessKeyRequired, true, "a public deployment must gate the audit rows");
  assert.equal(json.auditView.keyHeader, PORTAL_KEY_HEADER);
  assert.ok(json.auditView.status.includes("REFUSED BY DESIGN"));
});

test("REGRESSION GUARD: an anonymous read of the deployed audit rows is refused", async () => {
  // The viewer serves employment ids, actors and full decision records — the
  // exact material whose open exposure was closed on the nine (§3.32). A new
  // surface must not reopen it.
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
  });
  const { res, json } = await call(handler, fakeReq("GET", "/api?__cx_path=audit/api/decisions"));
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "portal_access_key_required");
});

test("with no key configured at all, the deployed audit viewer fails closed too", async () => {
  const handler = createCxHandler({ getPool: () => null, env: { VERCEL: "1" }, buildVerifier: () => null });
  const { res, json } = await call(handler, fakeReq("GET", "/api?__cx_path=audit/api/decisions"));
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "portal_access_key_not_configured");
});

test("POSITIVE: with the key, a read through the deployment reaches the store", async () => {
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
    // Only the store is injected — the access posture is the deployment's own.
    buildAudit: (ctx) => buildAuditViewHandler({ ...ctx, store: AUDIT_SEEDED }),
  });
  const { res, json } = await call(
    handler,
    fakeReq("GET", "/api?__cx_path=audit/api/decisions", { headers: { [PORTAL_KEY_HEADER]: PORTAL_KEY } })
  );
  assert.equal(res.statusCode, 200);
  assert.ok(json.decisions.length > 0);
});

test("the deployed viewer with no pool answers 503 no_durable_store, never demo rows", async () => {
  // `npm run audit-ui` degrades to labelled demo rows; the DEPLOYMENT must
  // not — fabricated rows on a public URL read as production history.
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
  });
  const { res, json } = await call(
    handler,
    fakeReq("GET", "/api?__cx_path=audit/api/decisions", { headers: { [PORTAL_KEY_HEADER]: PORTAL_KEY } })
  );
  assert.equal(res.statusCode, 503);
  assert.equal(json.code, "no_durable_store");
});

test("the audit page loads with no ZAF verifier configured — its gate is the shared key, not the sidebar's", async () => {
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
  });
  const res = fakeRes();
  await handler(fakeReq("GET", "/api?__cx_path=audit"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.body).includes("<base href=\"/audit/\" />"), "the mounted page needs its base tag");
  assert.ok(!String(res.body).includes("signed_identity_not_configured"));
});

test("a POST through the deployment to the audit viewer 404s — no write route exists to reach", async () => {
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", [PORTAL_KEY_ENV]: PORTAL_KEY },
    buildVerifier: () => null,
    buildAudit: (ctx) => buildAuditViewHandler({ ...ctx, store: AUDIT_SEEDED }),
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=audit/api/decisions", { headers: { [PORTAL_KEY_HEADER]: PORTAL_KEY }, body: {} })
  );
  assert.equal(res.statusCode, 404);
  assert.equal(json.code, "no_such_route");
});

test("vercel.json's function bundle includes the viewer's assets — readFileSync needs them on disk", () => {
  // The config has been the bug before (the root-rewrite 404), so the test
  // reads the config: the assets are served with readFileSync at runtime, and
  // a bundle that omitted them would 500 on a fully-green test suite.
  const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const include = cfg.functions["api/index.js"].includeFiles;
  assert.equal(include, "src/**", "src/** must ship whole — src/auditview/assets/* is read at request time");
});

// --- 10. the third-party consent door, mounted at /thirdparty --------------
//
// A TWELFTH surface, and the only one on this deployment with the OPPOSITE
// gate from the portal/audit/queue trio above: no shared key, no ZAF token.
// F5 (this suite's own reason for existing): the door was built and tested
// (test/thirdPartyDoor.test.js) but never mounted on deploy/cx-apis/, so
// VC-06/VC-07/VC-08/VC-33 (qa/contracts/UC-01-acceptance.md §16) had no door
// to knock on from outside this container. These tests prove it is mounted,
// reachable with ZERO credentials even while every other surface on the same
// deployment is fully locked down, and that mounting it did not accidentally
// carry a gate over from its neighbours.

/** A Remote client that always fails — VC-33's "fourth case" (Amendment 3). */
const FAILING_REMOTE = {
  getEmployment: async () => {
    throw new Error("simulated_remote_failure");
  },
};

const THIRD_PARTY_VALID_BODY = {
  requestingParty: "First National Bank",
  purpose: "Mortgage underwriting",
  employmentReference: "emp_whoever",
  subjectName: "A Named Person",
  subjectDateOfBirth: "1990-05-04",
  message: "Please confirm this person is currently employed.",
  returnAddress: "underwriting@firstnational.example",
};

test("the third-party door is routed by prefix, and is not a tenth use case", () => {
  assert.equal(resolveRoute("/api?__cx_path=thirdparty").kind, "thirdparty");
  assert.equal(resolveRoute("/api?__cx_path=thirdparty/api/requests").url, "/api/requests");
  assert.equal(resolveRoute("/api?__cx_path=thirdparty/app.js").url, "/app.js");
  assert.ok(!USE_CASES.some((u) => u.prefix === THIRD_PARTY_DOOR.prefix));
  assert.equal(THIRD_PARTY_BASE_PATH, "/" + THIRD_PARTY_DOOR.prefix);
});

test("/__cx/health reports the door mounted and OPEN BY DESIGN, not gated", async () => {
  const handler = createCxHandler({ getPool: () => null, env: { VERCEL: "1" }, buildVerifier: () => null });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  assert.equal(json.thirdPartyDoor.mounted, true);
  assert.equal(json.thirdPartyDoor.prefix, "/thirdparty");
  assert.equal(json.thirdPartyDoor.gated, false);
  assert.ok(!("accessKeyRequired" in json.thirdPartyDoor), "this surface must not report a key it does not have");
});

test("the index page lists the door as a mounted surface", async () => {
  const handler = createCxHandler({ getPool: () => null, env: BARE_ENV, buildVerifier: async () => null });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path="));
  assert.ok(json.surfaces.some((s) => s.prefix === THIRD_PARTY_BASE_PATH));
});

test("POSITIVE, PROVED FROM OUTSIDE: a submission reaches the door with ZERO credentials, on a fully locked-down deployment", async () => {
  // Every other write route on this deployment refuses in this exact
  // environment — VERCEL set, no ZAF verifier, no portal key configured. The
  // door must be the one exception, by construction, not by an omitted check.
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1" }, // no ZAF_SHARED_SECRET, no PORTAL_ACCESS_KEY
    buildVerifier: async () => null,
    buildThirdPartyDoor: (ctx) => buildThirdPartyDoorHandler({ ...ctx, remote: FAILING_REMOTE }),
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=thirdparty/api/requests", { body: THIRD_PARTY_VALID_BODY })
  );
  assert.equal(res.statusCode, 200);
  // D-25 (rca-87ee): the response now also carries a `reference` the
  // submitter can quote later — a property of THIS submission, not of the
  // decision, so its shape is checked rather than pinned to one value.
  assert.equal(json.ok, true);
  assert.equal(json.message, THIRD_PARTY_ACK_MESSAGE);
  assert.match(json.reference, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(json).sort(), ["message", "ok", "reference"]);
});

test("REGRESSION GUARD: a same-shaped POST to a real use case is still refused in that environment", async () => {
  // Companion to the test above — proves the door's openness is a deliberate
  // property of THAT route, not evidence the write gate broke deployment-wide.
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1" },
    buildVerifier: async () => null,
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=uc06/api/amendments/amend-1/approve", { body: { role: "admin" } })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(json.code, "signed_identity_not_configured");
});

test("form validation still runs — the door is delegated whole, not stubbed out", async () => {
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1" },
    buildVerifier: async () => null,
    buildThirdPartyDoor: (ctx) => buildThirdPartyDoorHandler({ ...ctx, remote: FAILING_REMOTE }),
  });
  const { res, json } = await call(
    handler,
    fakeReq("POST", "/api?__cx_path=thirdparty/api/requests", { body: { ...THIRD_PARTY_VALID_BODY, message: "" } })
  );
  assert.equal(res.statusCode, 400);
  assert.equal(json.code, "all_fields_required");
});

test("the deployment sends the door no CORS header — its only client is its own page", async () => {
  const handler = createCxHandler({ getPool: () => null, env: { VERCEL: "1" }, buildVerifier: async () => null });
  const res = fakeRes();
  await handler(fakeReq("GET", "/api?__cx_path=thirdparty", { headers: { origin: "https://evil.test" } }), res);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("an unknown prefix's listing now includes the door", async () => {
  const handler = createCxHandler({ getPool: () => fakePool(), env: BARE_ENV, buildVerifier: async () => null });
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=review/tickets"));
  assert.ok(json.knownPrefixes.includes(THIRD_PARTY_BASE_PATH));
});

// --- 9. is anything here read by a model? ----------------------------------
//
// WHY THESE TESTS EXIST. A user of the deployed system said: "I suspected that
// you were not using any form of LLM in this entire system and I was right. All
// the outputs were predetermined." They were wrong — the UC-03 classifier was
// calling OpenAI and tagging its result `source: "llm"` — but no surface a
// person can reach said so, and /__cx/health reported the posture of every
// other dependency while saying nothing about this one. Worse, the answer
// changes silently: with no key, portalLlmDefaults() substitutes four named
// keyword classifiers, and the same URL matches text instead of reading it.
//
// Both postures are exercised through an INJECTED llmPosture, because whether
// an OPENAI_API_KEY happens to sit in the ambient environment must not decide
// which branch a test sees — and no test may make a real OpenAI call (§6).

/** The four seams src/portal/wiring.js substitutes when no key is configured. */
const RULE_BASED_SEAMS = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  parseRelocation: parseRelocationRuleBased,
  parseInquiry: parseInquiryRuleBased,
};

/** A health handler whose LLM posture is stated rather than inherited. */
function healthHandlerWithLlm(llm) {
  return createCxHandler({ getPool: () => null, env: { VERCEL: "1" }, buildVerifier: () => null, llm });
}

test("/__cx/health says free text is read by a model, and names the model", async () => {
  const handler = healthHandlerWithLlm(() => llmPosture({ isConfigured: () => true, portalDefaults: () => ({}) }));
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));

  assert.equal(json.llm.configured, true);
  assert.equal(json.llm.model, "gpt-4o-mini");
  assert.equal(json.llm.freeTextInterpretedBy, "llm");
  // Empty because that is literally what portalLlmDefaults() returns when the
  // real path runs — the list is evidence, not a description of one.
  assert.deepEqual(json.llm.ruleBasedSeams, []);
  assert.match(json.llm.status, /^WORKING/);
  assert.ok(json.llm.status.includes("gpt-4o-mini"));
  // The sentence a non-engineer reads must not promise more than the
  // architecture allows: an LLM reads, deterministic code decides.
  assert.match(json.llm.status, /never decides|only reads/);
});

test("/__cx/health says outputs are keyword-driven when no key is configured, and names each substitute", async () => {
  const handler = healthHandlerWithLlm(() =>
    llmPosture({ isConfigured: () => false, portalDefaults: () => ({ ...RULE_BASED_SEAMS }) })
  );
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));

  assert.equal(json.llm.configured, false);
  // Null, not the default model name: printing "gpt-4o-mini" beside
  // `configured: false` is exactly the half-read that produces a confident
  // wrong answer in the opposite direction from the one that prompted this.
  assert.equal(json.llm.model, null);
  assert.equal(json.llm.freeTextInterpretedBy, "rule_based");
  assert.deepEqual(
    json.llm.ruleBasedSeams.map((s) => s.seam),
    ["classifyExpense", "classifyTravel", "parseInquiry", "parseRelocation"]
  );
  // The fallback names are read off each function's own `.name`, so they are
  // greppable in src/ rather than a literal that could drift.
  assert.deepEqual(
    json.llm.ruleBasedSeams.map((s) => s.fallback),
    [
      classifyExpenseRuleBased.name,
      classifyTravelInquiryRuleBased.name,
      parseInquiryRuleBased.name,
      parseRelocationRuleBased.name,
    ]
  );
  assert.match(json.llm.status, /^RULE-BASED/);
  assert.ok(json.llm.status.includes("OPENAI_API_KEY"));
  assert.ok(json.llm.status.includes(classifyTravelInquiryRuleBased.name));
});

test("the LLM block is derived from the runtime's own two functions, not re-derived", () => {
  // No injection at all: this calls isLlmConfigured() and portalLlmDefaults()
  // exactly as buildPortalHandler() does. Whichever way the ambient
  // environment happens to be set, the two must agree — a `configured: true`
  // beside a non-empty substitution list (or the reverse) would mean the
  // health endpoint and the portal handler had read different worlds, which is
  // the failure mode `npm run verify-deployed` exists to prevent.
  const posture = llmPosture();
  assert.equal(
    posture.configured,
    posture.ruleBasedSeams.length === 0,
    "portalLlmDefaults() substitutes seams if and only if isLlmConfigured() is false"
  );
  assert.equal(posture.freeTextInterpretedBy, posture.configured ? "llm" : "rule_based");
  assert.equal(posture.model === null, !posture.configured);
});

test("the health payload never carries a secret VALUE — only whether one is configured", async () => {
  // The existing posture block models this correctly
  // (`zafSharedSecretConfigured: true`), and the LLM block must not be the
  // exception: an endpoint written to answer "are you really using a model?"
  // is exactly where somebody would be tempted to prove it with a key prefix.
  const SENTINELS = {
    ZAF_SHARED_SECRET: "sentinel-zaf-secret-value",
    [PORTAL_KEY_ENV]: "sentinel-portal-key-value",
    ZAF_ALLOWED_ORIGIN: "https://sentinel.example",
  };
  const handler = createCxHandler({
    getPool: () => null,
    env: { VERCEL: "1", ...SENTINELS },
    buildVerifier: () => null,
    llm: () => llmPosture({ isConfigured: () => true, portalDefaults: () => ({}) }),
  });
  const { res } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  const body = String(res.body);

  assert.ok(!body.includes(SENTINELS.ZAF_SHARED_SECRET), "the ZAF signing secret must never be echoed");
  assert.ok(!body.includes(SENTINELS[PORTAL_KEY_ENV]), "the portal shared key must never be echoed");
  // ZAF_ALLOWED_ORIGIN is not a secret and IS echoed on purpose (it exists to
  // be read back), so it is named here to make the distinction deliberate.
  assert.ok(body.includes(SENTINELS.ZAF_ALLOWED_ORIGIN));
  // Nothing key-shaped, from any provider, anywhere in the payload.
  assert.doesNotMatch(body, /sk-[A-Za-z0-9_-]{8}/);
  // And if this machine happens to have a real key in its environment, it must
  // not appear either. Asserted WITHOUT printing it — the message names no value.
  const realKey = process.env.OPENAI_API_KEY;
  if (realKey) assert.ok(!body.includes(realKey), "the OpenAI key value must never reach the payload");

  // The block's surface is pinned, so adding a field is a deliberate act
  // rather than something that slips in beside a boolean.
  const { json } = await call(handler, fakeReq("GET", "/api?__cx_path=__cx/health"));
  assert.deepEqual(Object.keys(json.llm).sort(), [
    "configured",
    "freeTextInterpretedBy",
    "model",
    "ruleBasedSeams",
    "status",
  ]);
});
