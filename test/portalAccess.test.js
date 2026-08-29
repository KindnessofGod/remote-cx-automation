// ---------------------------------------------------------------------------
// portalAccess.test.js  —  who may reach the request portal's API
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS FOR
// The portal is an INTAKE surface: every POST runs this repo's real gates and
// writes an audit row and a use-case record. Publishing it at a URL therefore
// puts a write path on the open internet, next to nine APIs whose own
// unauthenticated-read defect was closed the same week (deploy/cx-apis/README.md
// §3). The portal cannot use that fix's mechanism — a ZAF-signed identity is
// minted by Zendesk for an app inside Zendesk, and the portal is deliberately
// not inside Zendesk — so it has its own shared-key gate, and this file is the
// regression guard on it.
//
// BOTH DIRECTIONS ARE TESTED, and the positive half is the one that matters
// most. A gate that refuses EVERYTHING passes every fail-closed assertion ever
// written: "refuses correctly" and "cannot possibly succeed" are
// indistinguishable from outside, which is the lesson docs/BUILD-LOG.md §3.30
// paid the most for. So the key test here is not that an anonymous submission
// is refused — it is that an authenticated one still reaches `auto_resolve`.
//
// HERMETIC. No socket, no network, no pool, no key. The mock Remote is reached
// through createInProcessFetch() (src/remote/mockServer.js) — the real fixtures
// and the real RemoteClient, with the transport swapped — and every LLM seam is
// the real function forced down its deterministic branch, per CLAUDE.md §6.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  portalAccessRequired,
  portalAccessPosture,
  checkPortalAccess,
  PORTAL_KEY_HEADER,
  PORTAL_KEY_ENV,
  OPEN_ACCESS,
} from "../src/portal/access.js";
import { createPortalHandler, withBaseHref } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");

const KEY = "s3cret-portal-key-value";
const LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  parseRelocation: parseRelocationRuleBased,
  parseInquiry: parseInquiryRuleBased,
};

/** An audit logger that records nothing anywhere but remembers it was asked. */
function countingAudit() {
  const rows = [];
  const audit = new AuditLogger();
  const original = audit.log.bind(audit);
  audit.log = async (entry) => {
    rows.push(entry);
    return original(entry);
  };
  audit.rows = rows;
  return audit;
}

/** The real portal handler, with the mock Remote reached in-process. */
function portal({ access = OPEN_ACCESS, audit = countingAudit(), stores = buildPortalStores() } = {}) {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return { handler: createPortalHandler({ remote, audit, stores, llm: LLM, access }), audit, stores };
}

/** Same in-process driver every other server suite in this repo uses. */
function call(handler, { method = "GET", path, body = null, headers = {} }) {
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
        const text = payload === undefined || payload === null ? null : String(payload);
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null; // an asset, not JSON
        }
        resolve({ status: this.statusCode, headers: this.headers, text, body: parsed });
      },
    };
    handler(req, res).catch(reject);
  });
}

/** The E2E test plan's Phase 2 row 3 — the request that MUST succeed. */
const SPAIN_TRIP = {
  persona: "chris",
  text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
  externalRef: "portal-access-3001",
};

// ---------------------------------------------------------------------------
// 1. The rule, in isolation
// ---------------------------------------------------------------------------

test("a fresh clone with nothing configured is open, so `npm run portal` still works", () => {
  assert.equal(portalAccessRequired({}, { persistent: false }), false);
});

test("attaching a durable store requires a key — a submission now outlives the process", () => {
  assert.equal(portalAccessRequired({}, { persistent: true }), true);
});

test("a public deployment requires a key even with no store attached", () => {
  // This is the state a FIRST deploy lands in: VERCEL set, SUPABASE_DB_URL not
  // yet. The durability half alone would leave that window open, on a URL the
  // whole internet can reach. It is the same window readPosture() exists to
  // close for the nine APIs.
  assert.equal(portalAccessRequired({ VERCEL: "1" }, { persistent: false }), true);
});

test("no environment variable can open a publicly reachable deployment — the OR is one-way", () => {
  assert.equal(portalAccessRequired({ VERCEL: "1", PORTAL_ALLOW_OPEN_ACCESS: "true" }, { persistent: false }), true);
  assert.equal(portalAccessRequired({ VERCEL: "1", PORTAL_ALLOW_OPEN_ACCESS: "true" }, { persistent: true }), true);
  // ...while off a public URL the same flag DOES relax the durability half,
  // which is the only thing it is for.
  assert.equal(portalAccessRequired({ PORTAL_ALLOW_OPEN_ACCESS: "true" }, { persistent: true }), false);
});

test("the overrides compare the exact string \"true\", because every env value is a string", () => {
  assert.equal(portalAccessRequired({ PORTAL_ALLOW_OPEN_ACCESS: "TRUE" }, { persistent: true }), true);
  assert.equal(portalAccessRequired({ PORTAL_ALLOW_OPEN_ACCESS: "1" }, { persistent: true }), true);
  assert.equal(portalAccessRequired({ PORTAL_REQUIRE_ACCESS_KEY: "yes" }, { persistent: false }), false);
  assert.equal(portalAccessRequired({ PORTAL_REQUIRE_ACCESS_KEY: "true" }, { persistent: false }), true);
});

test("the posture names WHY it is demanding a key, and never reports the key itself", () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: true });
  assert.equal(posture.required, true);
  assert.equal(posture.keyConfigured, true);
  assert.equal(posture.reasons.length, 2, "both triggers are firing and both should be named");
  assert.ok(posture.reasons.join(" ").includes("durable store"));
  assert.ok(posture.reasons.join(" ").includes("publicly reachable"));
  // The value is held for the comparison; nothing else may echo it.
  assert.ok(!JSON.stringify(portalHealthShape(posture)).includes(KEY));
});

/** What handler.js publishes about the portal — the posture minus its secret. */
function portalHealthShape(posture) {
  const { key, ...rest } = posture;
  return rest;
}

// ---------------------------------------------------------------------------
// 2. The gate, through the real handler
// ---------------------------------------------------------------------------

test("REGRESSION GUARD: an unauthenticated submission is refused, and writes nothing", async () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const { handler, audit, stores } = portal({ access: posture });

  const res = await call(handler, { method: "POST", path: "/api/requests/uc03", body: SPAIN_TRIP });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "portal_access_key_required");
  assert.equal(res.body.ok, false);
  // Refused BEFORE the workflow, not by it: nothing was decided, nothing
  // recorded. A gate that let the request run and then hid the answer would
  // still have written the row.
  assert.equal(audit.rows.length, 0, "an unauthenticated request must not reach the audit log");
  assert.equal((await stores.uc03.listCases?.())?.length ?? 0, 0);
});

test("a read of the context route is refused too — it lists the personas and the expense corpus", async () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const { handler } = portal({ access: posture });
  const res = await call(handler, { path: "/api/context" });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "portal_access_key_required");
});

test("a wrong key is refused, and told apart from a missing one only so the page can re-prompt", async () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const { handler } = portal({ access: posture });
  const res = await call(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: SPAIN_TRIP,
    headers: { [PORTAL_KEY_HEADER]: "not-the-key" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "portal_access_key_invalid");
  // Nothing about the expected value leaks back.
  assert.ok(!JSON.stringify(res.body).includes(KEY));
});

test("a key required but not configured fails CLOSED, and the refusal says what to set", async () => {
  const posture = portalAccessPosture({ VERCEL: "1" }, { persistent: false }); // no PORTAL_ACCESS_KEY
  const { handler, audit } = portal({ access: posture });
  const res = await call(handler, { method: "POST", path: "/api/requests/uc03", body: SPAIN_TRIP });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "portal_access_key_not_configured");
  assert.equal(audit.rows.length, 0);
  // The refusal explains itself, in the voice of handler.js's
  // unconfiguredVerifierBody(): what is missing, why, and where to set it. A
  // bare 401 here reads as a broken deployment, and the next thing that happens
  // is somebody "fixes" it by taking the gate off.
  assert.ok(res.body.reason && res.body.why && Array.isArray(res.body.howToFix));
  assert.ok(res.body.howToFix.join(" ").includes(PORTAL_KEY_ENV));
  assert.ok(res.body.why.includes("publicly reachable"));
});

test("POSITIVE: with the key, the trip that MUST auto-resolve still auto-resolves", async () => {
  // The one assertion that distinguishes a gate from a wall. docs/E2E-TEST-PLAN.md
  // Phase 2 row 3 is this request, and it is the plan's own checkpoint for the
  // same reason: UC-03 shipped for weeks structurally unable to succeed while
  // every fail-closed test passed.
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const { handler, audit } = portal({ access: posture });

  const res = await call(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: SPAIN_TRIP,
    headers: { [PORTAL_KEY_HEADER]: KEY },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "auto_resolve");
  assert.equal(res.body.useCase, "UC-03");
  assert.ok(audit.rows.length >= 1, "an authenticated submission must reach the audit log");
});

test("POSITIVE: the 🔴 tier still compiles a dossier and still offers no execution path", async () => {
  // The gate must not change WHAT the portal decides for any tier — only who
  // may ask. UC-08's workflow is handed no Remote or Zendesk client at all, and
  // that is as true through the gate as around it.
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const { handler } = portal({ access: posture });

  const res = await call(handler, {
    method: "POST",
    path: "/api/requests/uc08",
    body: {
      persona: "chris",
      text: "I have been working from Portugal for about five months this year — do I owe tax there?",
      externalRef: "portal-access-8001",
    },
    headers: { [PORTAL_KEY_HEADER]: KEY },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.executionPath, "none");
});

test("an open posture needs no header at all — the fresh-clone path is unchanged", async () => {
  const { handler } = portal({ access: portalAccessPosture({}, { persistent: false }) });
  const res = await call(handler, { method: "POST", path: "/api/requests/uc03", body: SPAIN_TRIP });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_resolve");
});

test("the page itself is served without a key — it is how you are TOLD a key is needed", async () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const { handler } = portal({ access: posture });

  for (const path of ["/", "/app.js", "/style.css"]) {
    const res = await call(handler, { path });
    assert.equal(res.status, 200, `${path} must be served ungated`);
    assert.ok(!res.text.includes(KEY), `${path} must not carry the key`);
  }
});

test("no shipped asset contains a key, a secret or a storage of one", () => {
  // sessionStorage holds the key at runtime; the bundle must never hold one.
  const app = readFileSync(join(ASSETS, "app.js"), "utf8");
  assert.ok(app.includes("sessionStorage"), "the page should keep the key for the session");
  assert.ok(!/PORTAL_ACCESS_KEY\s*=/.test(app), "app.js must not carry a key value");
  assert.ok(!/\.innerHTML\s*=/.test(app), "app.js must not write markup");
});

test("the browser assets are addressed relatively, so the page works under a path prefix", () => {
  const html = readFileSync(join(ASSETS, "index.html"), "utf8");
  // An absolute /app.js would ask the DEPLOYMENT's router for a use case called
  // "app.js" once the portal is mounted at /portal, and 404. This is checked in
  // the markup rather than in the browser because nothing else would catch it
  // before a live page failed to load its own script.
  assert.ok(!/(?:src|href)="\/[^"]*"/.test(html), "index.html must not load assets by absolute path");
  assert.ok(html.includes('src="app.js"') && html.includes('href="style.css"'));
});

test("a mounted portal gets a <base> tag, so those relative URLs resolve under the prefix", () => {
  const html = readFileSync(join(ASSETS, "index.html"), "utf8");
  assert.equal(withBaseHref(html, ""), html, "unmounted at the root, nothing is injected");

  const mounted = withBaseHref(html, "/portal");
  assert.ok(mounted.includes('<base href="/portal/" />'));
  // Both spellings of the mount point work, which is why this is a base tag
  // and not a redirect: whether a platform rewrite preserves a trailing slash
  // is exactly the sort of detail this deployment has already been bitten by.
  assert.equal(new URL("app.js", "https://x.test/portal/").pathname, "/portal/app.js");
  assert.equal(new URL("app.js", new URL("/portal/", "https://x.test")).pathname, "/portal/app.js");
});

// ---------------------------------------------------------------------------
// 3. The pure check, directly
// ---------------------------------------------------------------------------

test("checkPortalAccess is a no-op when nothing is required", () => {
  assert.deepEqual(checkPortalAccess({ headers: {} }, OPEN_ACCESS), { ok: true });
});

test("a header value with surrounding whitespace still matches", () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  assert.deepEqual(checkPortalAccess({ headers: { [PORTAL_KEY_HEADER]: `  ${KEY}  ` } }, posture), { ok: true });
});

test("a key of a different length is compared without throwing — constant-time compare needs equal lengths", () => {
  const posture = portalAccessPosture({ VERCEL: "1", [PORTAL_KEY_ENV]: KEY }, { persistent: false });
  const verdict = checkPortalAccess({ headers: { [PORTAL_KEY_HEADER]: "x" } }, posture);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.body.code, "portal_access_key_invalid");
});
