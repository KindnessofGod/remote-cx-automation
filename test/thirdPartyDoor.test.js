// ---------------------------------------------------------------------------
// thirdPartyDoor.test.js — L-12: VC-06/VC-07/VC-08/VC-33
// ---------------------------------------------------------------------------
// VC-33 is the criterion this file exists to prove, and its own text names
// the risk: "the criterion most likely to be satisfied on paper and violated
// in fact... every natural implementation returns early on 'no such record'."
// So this suite drives all FOUR of Amendment 3's cases through the real HTTP
// handler (no listening socket, same doubles pattern the rest of this repo's
// server tests use) and compares the responses AS DATA, never by eye:
//   (a) a real, active employee with no consent on record yet
//   (b) a real, active employee who has already declined
//   (c) a person who does not exist at Remote at all
//   (d) an internal error during the workflow (Amendment 3's "fourth case")
// Amendment 3's preferred, STRUCTURAL proof is also asserted directly: the
// route's response body is built from a module-level CONSTANT with no
// parameters, so no branch in the handler is even capable of selecting it.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createThirdPartyDoorHandler, THIRD_PARTY_ACK_MESSAGE, EVIDENCE_ACK_MESSAGE, FOLLOWUP_ACK_MESSAGE, withBaseHref } from "../src/thirdparty/server.js";
import { stripHtmlComments, stripJsComments } from "../src/shared/stripBuildComments.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { advanceOnConsentGrant } from "../src/uc01/consentAdvance.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer } from "../src/remote/mockServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "thirdparty", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

test("index.html loads exactly the assets that exist", () => {
  const html = read("index.html");
  for (const asset of ["style.css", "app.js"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
});

test("app.js compiles and never uses innerHTML", () => {
  const source = read("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

test("D-29 (structural): the page does not wrap its content in the .r-app sidebar grid it has no sidebar for", () => {
  // .r-app is `display: grid; grid-template-columns: var(--r-sidebar-w) 1fr`
  // (src/shared/ui/remote-ui.css) and expects an <aside class="r-sidebar">
  // FIRST CHILD to occupy the first (264px) track. This page has no sidebar
  // — anyone unauthenticated reaches it — so with only .tp-main as a child,
  // grid auto-placement put the content column into the SIDEBAR track
  // instead, fixing its width at ~216px regardless of viewport. The real,
  // measured-in-a-browser regression test is the opt-in Chromium check at
  // the bottom of this file (RUN_REAL_BROWSER_TESTS=1); this one is the fast
  // structural guard that runs every time and catches the class coming back.
  const html = read("index.html");
  assert.ok(!/class="[^"]*\br-app\b[^"]*"/.test(html), "index.html must not use the .r-app two-column grid shell (no sidebar exists on this page)");
  assert.ok(/class="tp-app"/.test(html), "the page's own single-column wrapper class must still be present");
});

test("F-1: index.html and app.js address every asset/API path relatively, so the page works under /thirdparty on the deployment", () => {
  // Root-absolute references (href="/style.css", fetch("/api/requests")) 404
  // once the page is loaded at a prefix like /thirdparty, because the browser
  // resolves them against the site root, not the mount — the exact defect
  // rca-4v5's F-1 finding caught by actually loading the page in a browser
  // rather than curling the API route directly (see server.js's withBaseHref
  // header). Every asset tag and fetch call must be mount-relative instead.
  const html = read("index.html");
  assert.ok(!/(?:src|href)="\/[^"]*"/.test(html), "index.html must not load an asset by root-absolute path");
  assert.ok(html.includes('href="remote-ui.css"'), "the shared design system is linked relatively");
  assert.ok(html.includes('href="style.css"'), "the page's own stylesheet is linked relatively");
  assert.ok(html.includes('src="app.js"'), "the page script is linked relatively");

  const source = read("app.js");
  assert.ok(!/fetch\(\s*"\//.test(source), "app.js must not fetch a root-absolute API path");
  assert.ok(source.includes('fetch("api/requests"'), "the submit call must be mount-relative");
});

test("a mounted page gets a <base> tag, so those relative URLs resolve under the /thirdparty prefix", () => {
  const html = withBaseHref("<head></head>", "/thirdparty");
  assert.ok(html.includes('<base href="/thirdparty/" />'));
  assert.equal(withBaseHref("<head></head>", ""), "<head></head>", "unmounted pages (npm run thirdparty) are untouched");
});

test("GET / on a mounted handler serves the page with the <base> tag injected", async () => {
  const mountedHandler = createThirdPartyDoorHandler({
    remote,
    audit,
    caseStore,
    classify: classifyRequestRuleBased,
    basePath: "/thirdparty",
  });
  const page = await new Promise((resolve, reject) => {
    const req = { method: "GET", url: "/", headers: {}, on() {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, headers: this.headers, body: payload.toString("utf8") });
      },
    };
    mountedHandler(req, res).catch(reject);
  });
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('<base href="/thirdparty/" />'), "the served page must carry the injected base tag");
  assert.ok(page.body.includes('href="style.css"'), "the stylesheet reference is still mount-relative");
});

/** Fetches one GET asset off a handler, resolving to { status, headers, body }. */
function getAsset(h, path) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: path, headers: {}, on() {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, headers: this.headers, body: payload.toString("utf8") });
      },
    };
    h(req, res).catch(reject);
  });
}

test("rca-b7rr / R7-10: the SERVED index.html and app.js carry no developer comments naming defect ids or src/ paths", async () => {
  // The source files under src/thirdparty/assets/ DO carry `D-NN` and `src/`
  // comments on purpose (this repo's convention for WHY-comments) — that is
  // fine for a developer reading the code. This door is unauthenticated by
  // design (see server.js's header), so what matters is what actually goes
  // over the wire to a stranger with a browser, which is why this test goes
  // through the real handler rather than reading the source files directly.
  const plainHandler = createThirdPartyDoorHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
  const html = await getAsset(plainHandler, "/");
  const js = await getAsset(plainHandler, "/app.js");

  for (const [name, body] of [
    ["index.html", html.body],
    ["app.js", js.body],
  ]) {
    assert.ok(!body.includes("<!--"), `served ${name} must not carry an HTML comment`);
    assert.ok(!/\bD-\d+\b/.test(body), `served ${name} must not name a defect id`);
    assert.ok(!/\bsrc\/[a-zA-Z]/.test(body), `served ${name} must not name an internal source path`);
  }
  // The guard is the stripper itself, not a coincidence of these two files'
  // current content — assert it is actually being applied, not bypassed.
  const rawHtml = read("index.html");
  const rawJs = read("app.js");
  assert.ok(/\bD-\d+\b/.test(rawHtml) && /src\//.test(rawHtml), "fixture check: the raw source must still carry the comments this test strips");
  assert.ok(/\bD-\d+\b/.test(rawJs) && /src\//.test(rawJs), "fixture check: the raw source must still carry the comments this test strips");
  assert.equal(stripHtmlComments(rawHtml).includes("D-29"), false);
  assert.equal(stripJsComments(rawJs).includes("D-27"), false);
});

test("app.js reads the ack message off the response and never re-derives an outcome", () => {
  // The browser-side half of VC-33's structural proof: the page has no
  // `result.decision`/`result.flags` to branch on at all, because the server
  // never sends one for a submitted request — see server.js's own header.
  // `data.reason` DOES appear, and is not a VC-33 concern: it is only ever
  // present on the 400 form-validation refusal, which fires before any
  // employment is looked at and is identical for every caller regardless of
  // what they typed.
  const source = read("app.js");
  assert.ok(source.includes("data.message"), "the page must render the server's own message field");
  assert.ok(
    !/data\.decision|data\.flags|result\.decision|result\.flags/.test(source),
    "app.js must never read a decision field the server does not send"
  );
});

// ---------------------------------------------------------------------------
// The HTTP API
// ---------------------------------------------------------------------------

let remoteServer;
let remote;
let caseStore;
let audit;
let handler;

before(async () => {
  remoteServer = await startMockServer(4125); // thirdPartyDoor-test-only port; registered in src/shared/ports.js TEST_PORTS
  remote = new RemoteClient({ baseUrl: "http://localhost:4125" });
});
after(() => remoteServer && remoteServer.close());

beforeEach(() => {
  caseStore = new CaseStore();
  audit = new AuditLogger();
  handler = createThirdPartyDoorHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
});

/** Minimal req/res doubles so the real handler runs without a listening socket. */
function callApi(h, { method, path, body = null }) {
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
    h(req, res).catch(reject);
  });
}

const VALID_BODY = {
  requestingParty: "First Bank",
  purpose: "Mortgage application",
  employmentReference: "emp_active_001",
  // The sixth field, added 2026-08-28. It is what tells a specialist WHOSE
  // permission to go and ask; it is never a lookup key, and no test here may
  // ever assert that it changed an outcome, because it must not.
  subjectName: "Amara Okafor",
  // The disambiguator (2026-08-28). A name identifies nobody; this is the one
  // further fact the subject supplied. Never matched, never echoed.
  subjectDateOfBirth: "1990-05-04",
  message: "Please confirm this person is employed with you.",
  // F1: the door's fifth field — see test/uc01ConsentAging.test.js for its
  // own validation (absent vs. unreadable) and downstream wiring coverage.
  returnAddress: "ops@firstbank.example",
};

test("STRUCTURAL (VC-33 Amendment 3): the ack is a constant with no parameters — no branch can select it", () => {
  const source = readFileSync(new URL("../src/thirdparty/server.js", import.meta.url), "utf8");
  // The exported constant is a plain string literal assignment, not a
  // function or a template built from `result`/`err`/`decision`.
  assert.match(source, /export const THIRD_PARTY_ACK_MESSAGE =\s*\n?\s*"/);
  // And the one place it is sent is a literal object, not a call that could
  // vary its shape. D-25 added `reference` to that literal — minted BEFORE
  // any lookup runs (`const reference = randomUUID()` precedes the awaited
  // call), so it is still a property of the SUBMISSION, never of what the
  // lookup underneath it found, and every branch reaching this line carries
  // the exact same two other fields.
  assert.match(source, /let reference = randomUUID\(\);/);
  assert.match(source, /send\(res, 200, \{ ok: true, message: THIRD_PARTY_ACK_MESSAGE, reference \}\)/);

  // 2026-08-28: `reference` became `let` so the intake-window join can rebind
  // it to the reference the FIRST submission was given, when a granted consent
  // reopens a joined enquiry. The property this test exists to protect is
  // unchanged and is now asserted DIRECTLY rather than implied by `const`:
  // the reference is minted before any lookup, and the only thing it may ever
  // be reassigned from is another reference this door itself minted earlier.
  // An assignment out of a lookup result — an employment, a consent artifact,
  // a decision — would make it a property of what was FOUND, which is the
  // leak `const` was standing in for.
  const reassignments = [...source.matchAll(/^\s*reference = (.+);$/gm)].map((m) => m[1].trim());
  assert.deepEqual(
    reassignments,
    ["joinedReference"],
    "`reference` is reassigned from something other than a previously-minted reference"
  );
});

/** D-25: a submission gets back an id an enquirer can actually quote. */
const REFERENCE_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("(a) a real active employee with no consent yet — the ack, and a pending artifact is created", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE);
  // D-25 — POSITIVE: the enquirer gets a reference they can quote, not just
  // the absence of an error.
  assert.match(res.body.reference, REFERENCE_SHAPE, "a submission must receive a quotable reference");

  // Internally, for VC-06: the real workflow ran, and a pending consent
  // artifact was written — read back, not merely asserted to have happened.
  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.ok(artifact, "a pending consent_records row must exist for this (party, purpose)");
  assert.equal(artifact.status, "pending");
  assert.equal(artifact.grantedAt, null);

  // D-25 — the reference genuinely resolves to THIS submission's case, the
  // same lookup the evidence route (D-28) and the audit viewer both use —
  // not a decorative value that merely looks like an id.
  const found = await caseStore.findByExternalRef(res.body.reference, "UC-01");
  assert.ok(found, "the returned reference must resolve back to the case it names");
  assert.equal(found.employmentId, "emp_active_001");
});

test("R7-45: optional 'acting on behalf of' composes into the stored requesting party, rather than being dropped or improvised into free text", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, requestingParty: "Acme Screening Ltd", actingOnBehalfOf: "Quayside Property Group" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE);

  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "Acme Screening Ltd (acting on behalf of Quayside Property Group)",
    purpose: "Mortgage application",
  });
  assert.ok(artifact, "the composed party string is what the consent artifact is scoped by");
  assert.equal(artifact.status, "pending");
});

test("R7-45: leaving 'acting on behalf of' blank behaves exactly as before — no parenthetical is added", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: { ...VALID_BODY, actingOnBehalfOf: "" } });
  assert.equal(res.status, 200);

  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.ok(artifact, "an absent actingOnBehalfOf must not change the stored requesting party at all");
});

test("(b) a real active employee who has already DECLINED — the SAME ack", async () => {
  // Seed a prior denial the same way the employee consent surface would.
  const seedCase = caseStore.createCase({
    useCase: "UC-01",
    employmentId: "emp_active_001",
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "denied",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "test_seed",
  });

  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE);
  assert.match(res.body.reference, REFERENCE_SHAPE, "a reference is returned on this path too");
});

test("(c) a person who does not exist at Remote at all — the SAME ack", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "emp_does_not_exist_at_all" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE);
  assert.match(res.body.reference, REFERENCE_SHAPE, "a reference is returned even when nobody exists at Remote");
});

test("(d) an internal error during the workflow — the SAME ack, never a 500", async () => {
  // A remote client whose every call throws — the internal-error case
  // Amendment 3 requires be tested alongside the other three.
  const throwingRemote = {
    getEmployment: async () => {
      throw new Error("simulated Remote outage");
    },
  };
  const throwingHandler = createThirdPartyDoorHandler({
    remote: throwingRemote,
    audit,
    caseStore,
    classify: classifyRequestRuleBased,
  });
  const res = await callApi(throwingHandler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE);
  // D-25 — even an internal error still returns a reference: it is minted
  // BEFORE the throwing call runs, so this path is no exception to "every
  // path gets one back."
  assert.match(res.body.reference, REFERENCE_SHAPE, "a reference is returned even when the workflow itself throws");
});

test("VC-33: all four cases produce IDENTICAL response bodies, compared as data", async () => {
  const throwingRemote = { getEmployment: async () => { throw new Error("simulated outage"); } };
  const throwingHandler = createThirdPartyDoorHandler({ remote: throwingRemote, audit, caseStore, classify: classifyRequestRuleBased });

  const seedCase = caseStore.createCase({ useCase: "UC-01", employmentId: "emp_active_001", decision: "awaiting_employee_consent", status: "awaiting_consent" });
  caseStore.createConsentRecord({
    caseId: seedCase.id, consentType: "third_party_verification", status: "denied",
    requestingParty: "First Bank", purpose: "Mortgage application",
    grantedByEmploymentId: "emp_active_001", grantedBySignal: "test_seed",
  });

  const a = await callApi(handler, { method: "POST", path: "/api/requests", body: { ...VALID_BODY, purpose: "A fresh, unanswered purpose" } });
  const b = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY }); // denied above
  const c = await callApi(handler, { method: "POST", path: "/api/requests", body: { ...VALID_BODY, employmentReference: "emp_nonexistent" } });
  const d = await callApi(throwingHandler, { method: "POST", path: "/api/requests", body: VALID_BODY });

  for (const [label, res] of [["a", a], ["b", b], ["c", c], ["d", d]]) {
    assert.equal(res.status, 200, label);
    // `reference` is EXPECTED to differ across submissions (D-25: it names
    // THIS submission, not the decision), so the identity check is on the
    // decision-bearing fields, and `reference`'s shape is checked separately.
    assert.equal(res.body.ok, true, label);
    assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE, label);
    assert.match(res.body.reference, REFERENCE_SHAPE, label);
    assert.deepEqual(Object.keys(res.body).sort(), ["message", "ok", "reference"], `${label}: no other field may appear`);
  }
});

test("missing fields refuse with a form error, before anything about an employment is looked at", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: { requestingParty: "First Bank" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "all_fields_required");
});

test("an unknown route is a 404, not a silent fallback", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/nonsense" });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

// ---------------------------------------------------------------------------
// D-27 (rca-87ee) — form-shape validation on employmentReference, checked
// BEFORE any employment is looked at, identically to the four-field and
// return-address checks above.
// ---------------------------------------------------------------------------

test("D-27: an employment reference too short to be genuine refuses with a form error", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "x" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "employment_reference_too_short");
});

test("D-27: a well-formed-but-fabricated reference is refused IDENTICALLY to a genuine one this short — the check is shape, not existence", async () => {
  const fabricated = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "zz" },
  });
  const real = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "e2" },
  });
  assert.deepEqual(fabricated.body, real.body, "the too-short refusal must not depend on whether the string could ever resolve");
});

test("D-27 (positive path): a well-formed reference at exactly the floor length is accepted", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "abcdef" }, // 6 chars — the floor
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

// ---------------------------------------------------------------------------
// D-28 (rca-87ee) — the third party can supply evidence they already hold
// the employee's written authorisation, either inline on the original form
// (`consentEvidence`) or afterwards via POST /api/requests/:reference/evidence.
// Acceptance is end-to-end: the evidence must reach a real consent_records
// row `findConsentArtifact()`/the ZAF sidebar's `describeConsentRecordForSpecialist()`
// can actually find, scoped by the SAME requestingParty/purpose the original
// submission recorded — never re-collected.
// ---------------------------------------------------------------------------

test("D-28: evidence supplied INLINE on the original submission attaches to that case's own pending consent row", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: {
      ...VALID_BODY,
      consentEvidence: "Signed release from the employee, dated 2026-08-01, ref AUTH-9001, on file with our compliance team.",
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE, "VC-33: the ack is unaffected by whether evidence was attached");

  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.ok(artifact, "a consent_records row must exist");
  assert.equal(artifact.status, "asserted", "third-party-supplied evidence is 'asserted', never 'granted' — only the employee can grant");
  assert.equal(artifact.evidenceReference, "Signed release from the employee, dated 2026-08-01, ref AUTH-9001, on file with our compliance team.");
  assert.equal(artifact.grantedByEmploymentId, null, "nobody employee-side has acted — asserted is not granted");

  // isConsentGranted()/isConsentPending() must treat this the same as an
  // unanswered row — VC-06/VC-07 depend on "asserted" never satisfying a
  // disclosure by itself.
  const { isConsentGranted, isConsentPending } = await import("../src/shared/consentArtifact.js");
  assert.equal(isConsentGranted(artifact), false);
  assert.equal(isConsentPending(artifact), true);
});

test("D-28: an enquirer who leaves consentEvidence blank gets the ordinary pending row, unchanged", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(res.status, 200);
  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.equal(artifact.status, "pending");
  assert.equal(artifact.evidenceReference, null);
});

test("D-28: evidence text too short to be useful refuses with a form error (optional field, but not free-form garbage)", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, consentEvidence: "yes" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "evidence_too_short");
});

test("D-28: the specialist-facing projection (src/review/server.js) can actually see the attached evidence", async () => {
  await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, consentEvidence: "Notarised authorisation letter, mailed 2026-08-10, tracking #Z-4471." },
  });
  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  // The exact shape src/review/server.js's describeConsentRecordForSpecialist()
  // returns to the ZAF sidebar — proving the field the specialist reads
  // (`view.consentRecord.evidenceReference`) is actually populated end to end,
  // not merely present on the raw store row.
  const projected = {
    id: artifact.id,
    status: artifact.status,
    requestingParty: artifact.requestingParty,
    purpose: artifact.purpose,
    grantedByEmploymentId: artifact.grantedByEmploymentId,
    grantedAt: artifact.grantedAt,
    createdAt: artifact.createdAt,
    evidenceReference: artifact.evidenceReference ?? null,
  };
  assert.equal(projected.evidenceReference, "Notarised authorisation letter, mailed 2026-08-10, tracking #Z-4471.");
  assert.equal(projected.status, "asserted");
});

test("D-28: evidence attached via the STANDALONE follow-up route (a reference obtained after the fact) joins the SAME pending row", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const reference = first.body.reference;

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/requests/${reference}/evidence`,
    body: { evidenceReference: "Obtained the signed release today; attaching reference LTR-2201." },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, EVIDENCE_ACK_MESSAGE);

  const artifact = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.equal(artifact.status, "asserted");
  assert.equal(artifact.evidenceReference, "Obtained the signed release today; attaching reference LTR-2201.");
});

test("D-28/VC-33: the standalone evidence route answers IDENTICALLY whether `:reference` is real, well-formed-but-wrong, or nonsense", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const real = await callApi(handler, {
    method: "POST",
    path: `/api/requests/${first.body.reference}/evidence`,
    body: { evidenceReference: "A genuine authorisation, held on file." },
  });
  const wrong = await callApi(handler, {
    method: "POST",
    path: `/api/requests/${"00000000-0000-0000-0000-000000000000"}/evidence`,
    body: { evidenceReference: "A genuine authorisation, held on file." },
  });
  assert.deepEqual(real.body, wrong.body, "a lookup miss must read exactly like a lookup hit");
  assert.equal(real.status, 200);
  assert.equal(wrong.status, 200);
});

test("D-28: an ALREADY-GRANTED or ALREADY-DENIED consent is left alone — evidence arriving after a terminal decision does not reopen it", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const pending = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  await caseStore.updateConsentDecision(pending.id, {
    status: "denied",
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "test_seed",
  });

  await callApi(handler, {
    method: "POST",
    path: `/api/requests/${first.body.reference}/evidence`,
    body: { evidenceReference: "We insist we have authorisation — please reconsider." },
  });

  const after = await caseStore.findConsentRecordById(pending.id);
  assert.equal(after.status, "denied", "a terminal decision must not be overwritten by later-arriving evidence");
  assert.equal(after.evidenceReference, null, "and no evidence should be attached to a row that already resolved");
});

test("D-28: evidence text and form fields never appear in the outward response — VC-33 is unaffected by this feature", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, consentEvidence: "Signed release, ref XJ-118, sent by courier." },
  });
  assert.deepEqual(Object.keys(res.body).sort(), ["message", "ok", "reference"]);
});

// ---------------------------------------------------------------------------
// R7-23 (rca-n5x8) — POST /api/requests/:reference/followup: a general
// "writing to you again about this request" surface for an enquirer with a
// reference and something to say, but nothing to attach. Unlike the evidence
// route, no lookup runs at all — the message is recorded unconditionally,
// keyed by the reference, so the response can never distinguish a real
// reference from a wrong or nonsense one.
// ---------------------------------------------------------------------------

test("R7-23: a follow-up on a real reference is accepted and durably recorded against it", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const reference = first.body.reference;

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/requests/${reference}/followup`,
    body: { message: "Following up — our client now has a hard deadline of Friday." },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, FOLLOWUP_ACK_MESSAGE);
  assert.deepEqual(Object.keys(res.body).sort(), ["message", "ok"], "no other field may appear");

  const recorded = audit.entries.find(
    (e) => e.action === "third_party_followup_received" && e.details?.externalRef === reference
  );
  assert.ok(recorded, "the follow-up must be durably recorded, keyed by the reference, for a specialist to find");
  assert.equal(recorded.details.message, "Following up — our client now has a hard deadline of Friday.");
});

test("R7-23/VC-33: the follow-up route answers IDENTICALLY whether `:reference` is real, well-formed-but-wrong, or nonsense", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const real = await callApi(handler, {
    method: "POST",
    path: `/api/requests/${first.body.reference}/followup`,
    body: { message: "Just checking this reached someone." },
  });
  const wrong = await callApi(handler, {
    method: "POST",
    path: `/api/requests/${"00000000-0000-0000-0000-000000000000"}/followup`,
    body: { message: "Just checking this reached someone." },
  });
  const nonsense = await callApi(handler, {
    method: "POST",
    path: `/api/requests/not-a-real-reference/followup`,
    body: { message: "Just checking this reached someone." },
  });
  assert.deepEqual(real.body, wrong.body, "a resolving reference must read exactly like one that does not");
  assert.deepEqual(real.body, nonsense.body, "a malformed reference must read exactly like a genuine one");
  assert.equal(real.status, 200);
  assert.equal(wrong.status, 200);
  assert.equal(nonsense.status, 200);

  // And the recording happens for all three, even the two that name nothing —
  // the whole point is that this route performs no lookup to branch on.
  for (const ref of [first.body.reference, "00000000-0000-0000-0000-000000000000", "not-a-real-reference"]) {
    assert.ok(
      audit.entries.some((e) => e.action === "third_party_followup_received" && e.details?.externalRef === ref),
      `a follow-up row must be recorded for ${ref} regardless of whether it resolves`
    );
  }
});

test("R7-23: an empty follow-up message refuses with a form error, reached before any reference is considered", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests/some-reference/followup",
    body: { message: "" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "followup_message_required");
});

test("R7-23: a follow-up message too short to be useful refuses with a form error", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests/some-reference/followup",
    body: { message: "hi" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "followup_too_short");
});

// ---------------------------------------------------------------------------
// R7-49 — the follow-up row now says WHETHER THE REFERENCE RESOLVED, and the
// response still cannot.
//
// The route is unauthenticated and `:reference` is whatever the caller typed,
// so before this a stranger could write a durable `third_party_followup_received`
// row against ANY reference — including a real one read off a genuine case. The
// rate limiter bounds how many; nothing bounded what they could be keyed to, and
// `/audit` is where an operator reconstructs a case, so a planted row sat in a
// real case's trail looking exactly like an enquirer's own message.
//
// The fix could not be a refusal: a 404 (or any response that varied) would
// answer "does this reference exist?" for an unauthenticated caller, which is
// VC-33's question one step removed. So the lookup reaches the DATABASE and
// never the RESPONSE, and both halves of that are asserted below — the rows
// differ, the responses are deepEqual.
// ---------------------------------------------------------------------------

test("R7-49: a follow-up on a REAL reference and one on a planted reference store different rows", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const real = first.body.reference;
  const planted = "11111111-2222-3333-4444-555555555555";

  await callApi(handler, {
    method: "POST",
    path: `/api/requests/${real}/followup`,
    body: { message: "Following up on our mortgage verification request." },
  });
  await callApi(handler, {
    method: "POST",
    path: `/api/requests/${planted}/followup`,
    body: { message: "Following up on our mortgage verification request." },
  });

  const rowFor = (ref) =>
    audit.entries.find((e) => e.action === "third_party_followup_received" && e.details?.externalRef === ref);

  assert.equal(rowFor(real).details.referenceResolved, true, "a follow-up on a real enquiry must be marked as one");
  assert.equal(rowFor(planted).details.referenceResolved, false, "a follow-up naming nothing must be readable as such on /audit");
  assert.ok(rowFor(real).details.caseId, "the resolved row names the case, so it is followable and not merely labelled");
  assert.ok(!("caseId" in rowFor(planted).details), "and an unresolved row invents no case to point at");
});

test("R7-49/VC-33: the two responses stay byte-identical — the lookup reaches the row and never the caller", async () => {
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const message = "Any update on this? Our client has a deadline.";

  const real = await callApi(handler, { method: "POST", path: `/api/requests/${first.body.reference}/followup`, body: { message } });
  const planted = await callApi(handler, { method: "POST", path: `/api/requests/${"11111111-2222-3333-4444-555555555555"}/followup`, body: { message } });
  const nonsense = await callApi(handler, { method: "POST", path: `/api/requests/not-a-real-reference/followup`, body: { message } });

  assert.deepEqual(real.body, planted.body);
  assert.deepEqual(real.body, nonsense.body);
  // deepEqual would pass on two objects with the same keys in a different
  // order; the caller reads BYTES, so compare those too.
  assert.equal(JSON.stringify(real.body), JSON.stringify(planted.body));
  assert.equal(JSON.stringify(real.body), JSON.stringify(nonsense.body));
  assert.equal(real.status, planted.status);
  assert.equal(real.status, nonsense.status);
  assert.deepEqual(Object.keys(real.body).sort(), ["message", "ok"], "no field may appear that could carry the outcome");
  assert.equal(real.body.message, FOLLOWUP_ACK_MESSAGE);

  // And the stored rows DID differ, or the test above proves only that the
  // route stopped looking.
  const resolutions = audit.entries
    .filter((e) => e.action === "third_party_followup_received")
    .map((e) => e.details.referenceResolved);
  assert.deepEqual(resolutions, [true, false, false]);
});

test("R7-49: a store that cannot answer records null — never false, which would slander a genuine follow-up", async () => {
  // The same three-state rule ticketFacts.js applies to Zendesk reads and the
  // gate ladder applies to `not_reached`: "we looked and found nothing" and "we
  // could not look" send a reader to two different places. Collapsing them
  // would let one database blip relabel every real follow-up in the window as
  // planted — the same defect with the opposite sign.
  const brokenStore = {
    async findByDoorReference() {
      throw new Error("connection terminated unexpectedly");
    },
  };
  const brokenHandler = createThirdPartyDoorHandler({
    remote,
    audit,
    caseStore: brokenStore,
    classify: classifyRequestRuleBased,
  });
  const res = await callApi(brokenHandler, {
    method: "POST",
    path: `/api/requests/${"11111111-2222-3333-4444-555555555555"}/followup`,
    body: { message: "Checking in on this request again." },
  });

  assert.equal(res.status, 200, "and the caller is told exactly what everybody else is told");
  assert.equal(res.body.message, FOLLOWUP_ACK_MESSAGE);
  const row = audit.entries.find((e) => e.action === "third_party_followup_received");
  assert.equal(row.details.referenceResolved, null);
  assert.ok(!("caseId" in row.details));
});

test("R7-49: a store with no door lookup at all records null rather than assuming", async () => {
  const handlerWithoutLookup = createThirdPartyDoorHandler({
    remote,
    audit,
    caseStore: {},
    classify: classifyRequestRuleBased,
  });
  await callApi(handlerWithoutLookup, {
    method: "POST",
    path: `/api/requests/${"11111111-2222-3333-4444-555555555555"}/followup`,
    body: { message: "Checking in on this request again." },
  });
  const row = audit.entries.find((e) => e.action === "third_party_followup_received");
  assert.equal(row.details.referenceResolved, null);
});

test("R7-49 (structural): the follow-up route's own response is a constant no branch can select", () => {
  // Same proof shape as the VC-33 structural test above, applied to this route
  // because it is the one that now performs a lookup: what keeps it safe is not
  // that it looks nothing up, it is that nothing it finds can reach send().
  const source = readFileSync(new URL("../src/thirdparty/server.js", import.meta.url), "utf8");
  assert.match(source, /export const FOLLOWUP_ACK_MESSAGE =\s*\n?\s*"/);
  assert.ok(
    source.includes("return send(res, 200, { ok: true, message: FOLLOWUP_ACK_MESSAGE });"),
    "the follow-up response must stay a literal object built from the constant"
  );
  // The resolution may only ever be read into the audit details. If it ever
  // appears on a line that also calls send(), the lookup has reached the caller.
  for (const line of source.split("\n")) {
    if (line.includes("resolution.") || line.includes("resolveFollowupReference(")) {
      assert.ok(!line.includes("send("), `the lookup result must never reach a response: ${line.trim()}`);
    }
  }
});

test("R7-23: the page itself now offers a follow-up surface, wired to the new route", () => {
  const html = read("index.html");
  const js = read("app.js");
  assert.ok(/id="followupReference"/.test(html), "index.html must offer a field to quote a prior reference");
  assert.ok(/id="followupMessage"/.test(html), "index.html must offer a field to say what the follow-up is");
  assert.ok(/\/followup/.test(js), "app.js must call the follow-up route");
});

// ---------------------------------------------------------------------------
// rca-52q / E3-F9 — the third-party disclosure decision now reaches a
// specialist, via a real Zendesk hand-off ticket. This SUPERSEDES the old
// "the door never touches Zendesk" test: the door now accepts an OPTIONAL
// zendesk dependency (src/uc01/workflow.js STEP 8's third-party branch), and
// what must stay true is VC-33 — the requesting party is told nothing about
// what any of this decided, whether or not a ticket gets raised behind the
// scenes.
// ---------------------------------------------------------------------------

/**
 * Drive an enquiry to a GRANTED disclosure, the way it actually happens.
 *
 * This used to pre-seed a granted consent row and then submit, which worked
 * while a grant was a STANDING authorisation for (employee, party, purpose).
 * Consent is now PER-ENQUIRY (2026-08-28, owner decision), so a grant made
 * before the enquiry exists can never apply to it — by design, and that is the
 * point of the change. The enquiry has to arrive first, stop for consent, and
 * be granted; the grant is what raises the hand-off.
 *
 * Returns the reference the enquirer was given, so a caller can collect against
 * it, and asserts the intermediate state rather than assuming it.
 */
async function grantEnquiry(store, { employmentId = "emp_active_001", purpose = "Mortgage application", zendesk = null, body = VALID_BODY } = {}) {
  const pendingHandler = createThirdPartyDoorHandler({ remote, audit, caseStore: store, classify: classifyRequestRuleBased });
  const first = await callApi(pendingHandler, { method: "POST", path: "/api/requests", body });
  assert.equal(first.status, 200);

  const pending = store.consentRecords.filter((r) => r.status === "pending").pop();
  assert.ok(pending, "the enquiry did not stop for consent — nothing to grant");
  await store.updateConsentDecision(pending.id, {
    status: "granted",
    grantedByEmploymentId: employmentId,
    grantedBySignal: "test_seed",
  });
  // THE GRANT IS WHAT ADVANCES IT (src/uc01/consentAdvance.js) — the same call
  // the portal's consent route makes.
  await advanceOnConsentGrant({ caseStore: store, audit, remote, zendesk, consentRecordId: pending.id });
  return first.body.reference;
}

test("zendesk is now an OPTIONAL dependency — omitting it behaves exactly as before", () => {
  const source = readFileSync(new URL("../src/thirdparty/server.js", import.meta.url), "utf8");
  assert.ok(/zendesk/i.test(source), "the door must accept a zendesk seam for the hand-off ticket");
  // Still never read while building the outward response — VC-33's proof
  // stays structural: the ack is the literal constant, unconditionally.
  assert.match(source, /send\(res, 200, \{ ok: true, message: THIRD_PARTY_ACK_MESSAGE, reference \}\)/);
});

test("a GRANTED third-party request now raises a real hand-off ticket for a specialist, with no employment fact in the subject", async () => {
  const createdTickets = [];
  const zendesk = {
    createTicket: async (fields) => {
      createdTickets.push(fields);
      return { id: 9001, ...fields };
    },
    listGroups: async () => [],
  };
  // VC-33 is unaffected: the ack is still the one fixed message, whatever a
  // ticket creation behind it did or did not do.
  const reference = await grantEnquiry(caseStore, { zendesk });
  assert.match(reference, REFERENCE_SHAPE);

  assert.equal(createdTickets.length, 1, "a hand-off ticket must be raised for a granted disclosure decision");
  const ticket = createdTickets[0];
  assert.ok(
    !/amara|okafor|active|emp_active_001/i.test(ticket.subject),
    "the ticket SUBJECT must carry no employment fact — constraint 2"
  );
  assert.equal(ticket.comment.public, false, "the hand-off is an internal note, never a public reply");
  assert.ok(ticket.comment.html_body.includes("First Bank"), "the internal note must give the specialist what they need to decide");
  assert.ok(ticket.tags.includes("third_party_door"), "the ticket must be traceable back to this channel");

  // E4-F16 (rca-0nm) — ticket #108: approving used to end at a solved ticket
  // with the letter posted where the bank cannot see it and nothing saying a
  // manual send was outstanding. The note must now say so explicitly, name
  // who the ticket's own requester is NOT, and carry the return address to
  // send to.
  assert.ok(
    ticket.comment.html_body.includes("nothing is sent to them automatically"),
    "the note must say plainly that approving does not reach the third party"
  );
  assert.ok(
    ticket.comment.html_body.includes("send the letter to ops@firstbank.example yourself"),
    "the note must name the exact return address a person has to send to"
  );

  const relinked = await caseStore.findByExternalRef("9001", "UC-01");
  assert.ok(relinked, "the case must be reachable by the new ticket id — the same join src/portal/ticketing.js uses");
  assert.equal(relinked.decision, "human_review");
});

test("an ESCALATE decision (consent granted, employment no longer active) also raises a hand-off ticket", async () => {
  const createdTickets = [];
  const zendesk = {
    createTicket: async (fields) => {
      createdTickets.push(fields);
      return { id: 9002, ...fields };
    },
    listGroups: async () => [],
  };
  const reference = await grantEnquiry(caseStore, {
    employmentId: "emp_terminated_002",
    zendesk,
    body: { ...VALID_BODY, employmentReference: "emp_terminated_002" },
  });
  assert.match(reference, REFERENCE_SHAPE);
  assert.equal(createdTickets.length, 1, "employee_not_active still needs a human, so it still gets a ticket");
  assert.ok(createdTickets[0].tags.includes("verification_exception"));

  // E4-F16 (rca-0nm) — this branch never issues a letter at all, so its
  // action line must say that plainly rather than promising a manual send
  // that will never have anything to send.
  const body = createdTickets[0].comment.html_body;
  assert.ok(body.includes("no letter can be issued on this ticket"), "escalate must not promise a letter that can never exist");
  assert.ok(
    body.includes("Nothing has been, or will be, sent to the requesting party from here"),
    "escalate must still say plainly that the requesting party has heard nothing"
  );
  assert.ok(!body.includes("send the letter to"), "escalate must not carry the human_review send instruction");
});

test("a PENDING or DENIED third-party decision raises NO ticket, even with zendesk configured", async () => {
  const createdTickets = [];
  const zendesk = { createTicket: async (fields) => { createdTickets.push(fields); return { id: 9003 }; }, listGroups: async () => [] };
  const zendeskHandler = createThirdPartyDoorHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased, zendesk });

  // (a) nobody has answered yet — the employee owns this, not a specialist.
  await callApi(zendeskHandler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(createdTickets.length, 0, "awaiting_employee_consent must not raise a ticket");

  // (b) the employee already said no — a terminal refusal, nothing to hand off.
  const seedCase = caseStore.createCase({ useCase: "UC-01", employmentId: "emp_active_001", decision: "awaiting_employee_consent", status: "awaiting_consent" });
  caseStore.createConsentRecord({
    caseId: seedCase.id, consentType: "third_party_verification", status: "denied",
    requestingParty: "First Bank", purpose: "Mortgage application",
    grantedByEmploymentId: "emp_active_001", grantedBySignal: "test_seed",
  });
  await callApi(zendeskHandler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(createdTickets.length, 0, "consent_refused must not raise a ticket either");
});

test("a Zendesk failure while raising the hand-off ticket never breaks the ack — the decision stays durable and the failure is audited", async () => {
  const zendesk = {
    createTicket: async () => {
      throw new Error("simulated Zendesk outage");
    },
    listGroups: async () => [],
  };
  const reference = await grantEnquiry(caseStore, { zendesk });
  assert.match(reference, REFERENCE_SHAPE);
  assert.ok(
    audit.entries.some((e) => e.action === "third_party_handoff_ticket_failed"),
    "the hand-off failure must itself be findable, not just console-logged"
  );
});

// ---------------------------------------------------------------------------
// D-26 — a silent 8-15s submit created two REAL production duplicates on this
// door: a per-submission `randomUUID()` is the OPPOSITE of an idempotency
// key, so an enquirer who assumed the disabled button had hung and resubmitted
// got a second, fully independent case for the same enquiry. THE POSITIVE
// TEST IS THE ONLY ONE THAT MATTERS (C-16, this bead's own dispatch note):
// "refuses correctly" and "cannot refuse at all" produce identical output on
// every negative test, so every test below submits the SAME enquiry TWICE and
// asserts there is exactly ONE case, not merely that a duplicate is flagged.
//
// A FAKE `workflow_claims` ONLY, same scope test/uc02Persistence.test.js's
// fake pool uses for the identical reason: `CaseStore.createCase()` and
// friends push to their own in-memory arrays synchronously and treat a pgPool
// write as fire-and-forget background work, so this fake only has to answer
// the two queries `claimExternalRef()`/`findClaimDecision()` actually issue.
// ---------------------------------------------------------------------------

/** Same fake `workflow_claims` shape test/uc02Persistence.test.js's uses. */
function fakeClaimsPool() {
  const claims = new Map(); // "useCase ref" -> decision
  return {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim();
      if (/^insert into workflow_claims/i.test(q)) {
        const [useCase, externalRef, decision] = params;
        const key = `${useCase} ${externalRef}`;
        if (claims.has(key)) return { rows: [], rowCount: 0 }; // the PRIMARY KEY
        claims.set(key, decision);
        return { rows: [{ external_ref: externalRef }], rowCount: 1 };
      }
      if (/^select decision from workflow_claims/i.test(q)) {
        const [useCase, externalRef] = params;
        const key = `${useCase} ${externalRef}`;
        const decision = claims.get(key);
        return decision === undefined ? { rows: [], rowCount: 0 } : { rows: [{ decision }], rowCount: 1 };
      }
      // Everything else (cases/consent_records inserts): fire-and-forget,
      // resolved harmlessly — see this block's header.
      return { rows: [], rowCount: 0 };
    },
  };
}

test("D-26 (positive): submitting the SAME third-party enquiry TWICE produces ONE case, not two — the production shape (identical requestingParty/purpose/employment, 50.8s apart)", async () => {
  const dedupCaseStore = new CaseStore({ pgPool: fakeClaimsPool() });
  const dedupHandler = createThirdPartyDoorHandler({ remote, audit, caseStore: dedupCaseStore, classify: classifyRequestRuleBased });

  const body = { ...VALID_BODY, requestingParty: "Quayside Property Group", purpose: "Tenancy referencing" };
  const first = await callApi(dedupHandler, { method: "POST", path: "/api/requests", body });
  const second = await callApi(dedupHandler, { method: "POST", path: "/api/requests", body });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.message, THIRD_PARTY_ACK_MESSAGE);
  assert.equal(second.body.message, THIRD_PARTY_ACK_MESSAGE, "VC-33's fixed ack is unaffected by the join");

  // THE ONE ROW. Read directly off the store's own in-memory array, the same
  // way test/selfServiceLetterDedup.test.js does — with a pgPool attached,
  // listByUseCase() would treat Postgres (this fake, which does not model
  // `cases`) as authoritative and read back nothing.
  const rows = dedupCaseStore.cases.filter((c) => c.useCase === "UC-01" && c.source === "third_party_door");
  assert.equal(rows.length, 1, "a rapid resubmit of the same enquiry must not create a second case");

  // THE SECOND SUBMISSION IS TOLD IT JOINED THE FIRST, and names the SAME
  // reference — not a fresh one that would resolve to nothing (D-25).
  assert.equal(first.body.duplicate, undefined, "the first, winning submission is not itself a duplicate");
  assert.equal(second.body.duplicate, true, "the second submission must be told it joined the first");
  assert.equal(second.body.reference, first.body.reference);

  const found = await dedupCaseStore.findByExternalRef(second.body.reference, "UC-01");
  assert.ok(found, "the joined reference must still resolve back to the real case (D-25)");
});

test("D-26: a DIFFERENT purpose or requesting party is a DIFFERENT enquiry — no false join", async () => {
  const dedupCaseStore = new CaseStore({ pgPool: fakeClaimsPool() });
  const dedupHandler = createThirdPartyDoorHandler({ remote, audit, caseStore: dedupCaseStore, classify: classifyRequestRuleBased });

  const first = await callApi(dedupHandler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, requestingParty: "Quayside Property Group", purpose: "Tenancy referencing" },
  });
  const second = await callApi(dedupHandler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, requestingParty: "A Different Bank Entirely", purpose: "Tenancy referencing" },
  });
  const third = await callApi(dedupHandler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, requestingParty: "Quayside Property Group", purpose: "Mortgage application" },
  });

  assert.equal(second.body.duplicate, undefined, "a different requesting party must not be folded into the first enquiry");
  assert.equal(third.body.duplicate, undefined, "a different purpose must not be folded into the first enquiry");
  assert.notEqual(second.body.reference, first.body.reference);
  assert.notEqual(third.body.reference, first.body.reference);

  const rows = dedupCaseStore.cases.filter((c) => c.useCase === "UC-01" && c.source === "third_party_door");
  assert.equal(rows.length, 3, "three genuinely distinct enquiries must produce three cases");
});

test("D-26: evidence supplied on a resubmission that turns out to be a duplicate still attaches to the ORIGINAL case, not an orphan", async () => {
  const dedupCaseStore = new CaseStore({ pgPool: fakeClaimsPool() });
  const dedupHandler = createThirdPartyDoorHandler({ remote, audit, caseStore: dedupCaseStore, classify: classifyRequestRuleBased });

  const body = { ...VALID_BODY, requestingParty: "Quayside Property Group", purpose: "Tenancy referencing" };
  const first = await callApi(dedupHandler, { method: "POST", path: "/api/requests", body });
  const second = await callApi(dedupHandler, {
    method: "POST",
    path: "/api/requests",
    body: {
      ...body,
      consentEvidence: "Signed release from the employee, dated 2026-08-01, ref AUTH-9002, on file with our compliance team.",
    },
  });

  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.reference, first.body.reference);

  const artifact = await dedupCaseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "Quayside Property Group",
    purpose: "Tenancy referencing",
  });
  assert.ok(artifact, "the evidence must attach to the pending consent row the FIRST submission created");
  assert.equal(artifact.status, "asserted");
  assert.match(artifact.evidenceReference, /AUTH-9002/);
});

test("D-26: with no pgPool attached, the join degrades to 'no guarantee' rather than silently refusing a second enquiry — matching every other use of claimExternalRef()", async () => {
  // `handler`/`caseStore` from beforeEach — no pgPool, exactly the shape
  // every other test above this block already runs against.
  const body = { ...VALID_BODY, requestingParty: "Quayside Property Group", purpose: "Tenancy referencing" };
  const first = await callApi(handler, { method: "POST", path: "/api/requests", body });
  const second = await callApi(handler, { method: "POST", path: "/api/requests", body });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  // Documented degradation (workflowClaims.js): with no ledger, every call is
  // "claimed" — a known, visible gap, not a silent failure.
  assert.equal(second.body.duplicate, undefined);
  const rows = caseStore.cases.filter((c) => c.useCase === "UC-01" && c.source === "third_party_door");
  assert.equal(rows.length, 2, "without a ledger this is a documented, known gap — not a claim of protection");
});

// ---------------------------------------------------------------------------
// D-29 — opt-in real-Chromium measurement. Skipped unless
// RUN_REAL_BROWSER_TESTS=1 (same pattern as test/pdfRender.test.js's real
// Playwright check: not fast, not network-hermetic in the "sub-5-second, no
// subprocess" sense the rest of this suite holds itself to, so `npm test`
// never launches a browser by default). Run it explicitly with:
//   RUN_REAL_BROWSER_TESTS=1 node --test test/thirdPartyDoor.test.js
//
// This is the test the bead's dispatch note asked for directly: "the test is
// a measured width at 1280 and 1920, not a screenshot that looks fine." The
// structural test above (no `.r-app` class) catches the regression coming
// back; this one proves the fix actually changed what a browser renders.
// ---------------------------------------------------------------------------
const realBrowserSkipReason =
  process.env.RUN_REAL_BROWSER_TESTS === "1"
    ? false
    : "set RUN_REAL_BROWSER_TESTS=1 to measure real Chromium layout (not run by default — see file header)";

test(
  "D-29 (measured): the content column is the SAME width at 1280px and 1920px, and a 390px phone is narrower than both",
  { skip: realBrowserSkipReason },
  async () => {
    const { chromium } = await import("playwright");
    const { createServer } = await import("node:http");

    const measureHandler = createThirdPartyDoorHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
    const server = createServer(measureHandler);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const browser = await chromium.launch();
    try {
      const widths = {};
      for (const viewportWidth of [1280, 1920, 390]) {
        const ctx = await browser.newContext({ viewport: { width: viewportWidth, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded" });
        const box = await page.locator(".tp-main").boundingBox();
        widths[viewportWidth] = box.width;
        await ctx.close();
      }

      // Pre-fix this measured ~216 at every width (264px .r-app sidebar
      // track minus padding) — constant regardless of viewport, and the
      // 390px phone came out WIDER than the 1920px desktop. Post-fix it is
      // the design's own max-width (640px), reached identically at both
      // desktop sizes and correctly narrower on the phone.
      assert.equal(widths[1280], widths[1920], "the content column must not depend on viewport width once it is no longer capped by the sidebar track");
      assert.ok(widths[1280] > 300, `expected the content column to use its real max-width, measured ${widths[1280]}px`);
      assert.ok(widths[390] < widths[1280], `a 390px phone must not render WIDER than a 1920px desktop (phone: ${widths[390]}px, desktop: ${widths[1280]}px)`);
    } finally {
      await browser.close();
      server.close();
    }
  }
);

// ---------------------------------------------------------------------------
// Quick-fills (reported 2026-08-28: "add an option to prefill")
// ---------------------------------------------------------------------------

/** The SCENARIOS array literal, lifted out of the browser file and evaluated. */
function readScenarios() {
  const source = read("app.js");
  const start = source.indexOf("const SCENARIOS = [");
  assert.ok(start !== -1, "SCENARIOS has moved — re-point this test");
  const body = source.slice(source.indexOf("[", start), source.indexOf("\n];", start) + 2);
  return new Function(`return ${body};`)();
}

test("every quick-fill sets the SAME set of fields, so one scenario can never leak into the next", () => {
  // The portal's convention, and load-bearing rather than tidy. A quick-fill
  // only writes the keys it lists, so a key omitted by ONE scenario keeps
  // whatever the previously clicked chip put there — and the reader is then
  // looking at two scenarios blended into one, with nothing on screen saying
  // so. Compared against the union of all scenarios rather than a hardcoded
  // list: a count or a literal key list cannot tell "a field was dropped"
  // from "a field was added", which is exactly how the portal's own
  // quick-fill guard missed UC-01 having no scenarios at all.
  const scenarios = readScenarios();
  assert.ok(scenarios.length >= 2, "at least two scenarios, or the guard proves nothing");

  const union = new Set(scenarios.flatMap((s) => Object.keys(s.fields)));
  for (const s of scenarios) {
    assert.deepEqual(
      Object.keys(s.fields).sort(),
      [...union].sort(),
      `scenario "${s.id}" does not set every field the others do — the missing ones keep the previous chip's values`
    );
  }
});

/**
 * The MAIN request form only, sliced out of the page.
 *
 * These guards used to scan the whole document and filter ids by prefix
 * (`followup*`), which meant every new panel with its own required field broke
 * them — a third panel (`collect*`, the approved-response collector) did
 * exactly that. Slicing to `<form id="request-form">` says what the tests
 * actually mean: THIS form is the one a quick-fill must satisfy and the one the
 * payload must match. A fourth panel will not need a fourth prefix here.
 */
function mainFormHtml() {
  const html = read("index.html");
  const start = html.indexOf('<form id="request-form"');
  assert.ok(start !== -1, "the main request form has been renamed — re-point mainFormHtml()");
  const end = html.indexOf("</form>", start);
  assert.ok(end !== -1, "the main request form is unterminated");
  return html.slice(start, end);
}

test("every quick-fill fills all five required fields, so a chip is submittable without typing", () => {
  // The whole point of the feature: click, read it aloud, send. A scenario
  // that left a required box empty would fail native validation on submit and
  // look like the page was broken.
  const html = mainFormHtml();
  const required = [...html.matchAll(/id="([a-zA-Z]+)"[^>]*required|required[^>]*id="([a-zA-Z]+)"/g)]
    .map((m) => m[1] ?? m[2]);

  for (const s of readScenarios()) {
    for (const id of required) {
      assert.ok(
        typeof s.fields[id] === "string" && s.fields[id].trim() !== "",
        `scenario "${s.id}" leaves required field ${id} empty`
      );
    }
  }
});

test("a quick-fill that writes into the collapsed optional section opens it", () => {
  // Never write into a box the reader cannot see. `actingOnBehalfOf` and
  // `consentEvidence` live inside a <details>; a scenario that fills either
  // and leaves the fold shut would put words on the wire that nobody on the
  // page can read back — the same class of defect as the portal's persona
  // caption, where the screen disagreed with the request it was about to send.
  const optionalFields = ["actingOnBehalfOf", "consentEvidence"];
  for (const s of readScenarios()) {
    const writesOptional = optionalFields.some((f) => (s.fields[f] ?? "").trim() !== "");
    assert.equal(
      Boolean(s.opens),
      writesOptional,
      `scenario "${s.id}": opens=${Boolean(s.opens)} but writesOptional=${writesOptional} — the fold must agree with what is in it`
    );
  }
});

test("quick-fill buttons never submit the form they sit above, and say which one is chosen in words", () => {
  const source = read("app.js");
  assert.match(source, /button\.type\s*=\s*"button"/, "a chip without type=button submits the form on click");
  // Colour is never the only carrier — the same rule the portal's own
  // `.is-chosen` follows, after a reader misread one scenario's values as
  // another's because nothing named the active chip.
  assert.match(source, /scenarioNote\.textContent\s*=/, "nothing names the chosen scenario in words");
  assert.match(source, /classList\.toggle\("is-chosen"/, "the chosen chip is not marked");
  assert.match(read("style.css"), /\.is-chosen/, "the chosen-chip style is missing");
});

test("filling a field tells the page it changed, rather than assigning .value silently", () => {
  // A bare `.value =` is invisible to listeners and to native constraint-
  // validation state, so a filled form can still report itself untouched.
  const body = read("app.js");
  const fn = body.slice(body.indexOf("function setFieldValue("), body.indexOf("function applyScenario("));
  assert.match(fn, /dispatchEvent\(new Event\("input"/, "no input event dispatched after a quick-fill");
  assert.match(fn, /dispatchEvent\(new Event\("change"/, "no change event dispatched after a quick-fill");
});

test("the five fields the surface probe fills are outside the collapsed optional section", () => {
  // src/surfaceverify/surfaces/browser.js drives this page in a real browser
  // and fills exactly these five. Playwright cannot fill a field inside a
  // closed <details>, so folding one of them away would break the live
  // surface check in a way no unit test would see.
  const html = read("index.html");
  const optional = html.slice(html.indexOf('<details class="tp-optional"'), html.indexOf("</details>", html.indexOf('<details class="tp-optional"')));
  for (const id of ["requestingParty", "purpose", "employmentReference", "message", "returnAddress"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} has gone missing from the page`);
    assert.ok(!optional.includes(`id="${id}"`), `${id} was folded into the optional section — the surface probe cannot fill it`);
  }
});

// ---------------------------------------------------------------------------
// The subject's name (2026-08-28), and the server-owned demo reference
// ---------------------------------------------------------------------------
// REPORTED by the project owner: "Should they not be including the employee's
// name where they are making a request? ... the employee's ID is made up."
//
// Both halves were right, and researching them against primary sources turned
// up more than the report claimed:
//
//   * NAME. Every canonical verification form carries it — Fannie Mae 1005
//     item 7, VA 26-8497 item 2, the Dutch NHG werkgeversverklaring, Experian
//     Verify ("Employee Full Name", required), Truework. Remote's own standard
//     letter prints it as the first line. This form had no name field at all,
//     which made it the only verification intake anywhere that could not say
//     whose employment it was about.
//
//   * BUT NEVER AS A LOOKUP KEY. No system in that set resolves a person by
//     name alone: each pairs it with a fact the employee themself supplied
//     (SSN, date of birth, address, start date) or a signed release. "Does
//     anyone called X work for you" is exactly the question VC-33 refuses, and
//     the ICO's own neither-confirm-nor-deny guidance states the same property
//     — a response must "leave the question entirely open", evaluated against
//     hypothetical rather than actual holdings.
//
// So the name is collected, is carried to the specialist as a CLAIM, and
// changes no outcome. These tests pin all three.
// ---------------------------------------------------------------------------

test("the name is required, and its absence refuses as FORM validation — before any employment is touched", async () => {
  const { subjectName, ...withoutName } = VALID_BODY;
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: withoutName });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "all_fields_required");
  // The refusal must name the new field, or a caller cannot tell which of the
  // five is missing.
  assert.match(res.body.reason, /whose employment this is about/i);
});

test("VC-33 IS UNAFFECTED: the same name against a real, a declined and a nonexistent person gives byte-identical answers", async () => {
  // The load-bearing test for this feature. Adding a field that names a person
  // makes the form LOOK like a lookup, so the invariant stops being incidental
  // and starts being the thing most likely to break. If the name ever reached
  // a branch, this is where it would show.
  const bodies = ["emp_active_001", "emp_declined_003", "emp_does_not_exist_zzz"].map((ref) => ({
    ...VALID_BODY,
    employmentReference: ref,
    subjectName: "Amara Okafor",
  }));
  const answers = [];
  for (const body of bodies) {
    // A distinct purpose per submission, so the intake-key join (D-26) treats
    // these as three separate enquiries rather than folding them together —
    // which would make the comparison vacuous rather than false.
    const res = await callApi(handler, {
      method: "POST",
      path: "/api/requests",
      body: { ...body, purpose: `Name-invariance probe ${body.employmentReference}` },
    });
    // The reference is minted per submission and is deliberately not constant.
    const { reference, ...rest } = res.body;
    answers.push({ status: res.status, ...rest });
  }
  assert.deepEqual(answers[0], answers[1], "a declined person answered differently from a pending one");
  assert.deepEqual(answers[0], answers[2], "a person who does not exist answered differently from one who does");
});

test("a WRONG name against a real reference changes nothing — the name is never matched against the record", async () => {
  // If the name were ever compared to the employment, this is the case that
  // would diverge. It must not: the name routes the permission request, and a
  // mismatch is for the specialist to notice, not for this door to reveal.
  const ask = async (subjectName, purpose) => {
    const res = await callApi(handler, {
      method: "POST",
      path: "/api/requests",
      body: { ...VALID_BODY, subjectName, purpose },
    });
    const { reference, ...rest } = res.body;
    return { status: res.status, ...rest };
  };
  const a = await ask("Amara Okafor", "Name-mismatch probe A");
  const b = await ask("Somebody Else Entirely", "Name-mismatch probe B");
  assert.deepEqual(a, b, "the name reached a branch");
});

test("the name never appears in anything the enquirer is sent back", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, subjectName: "Wilhelmina Distinctive-Surname" },
  });
  assert.ok(
    !JSON.stringify(res.body).includes("Distinctive-Surname"),
    "the subject's name was echoed to an unauthenticated caller"
  );
});

test("the hand-off note carries the name as a CLAIM, and says nothing was resolved by it", () => {
  // The specialist is the first person who can tell an assertion from a fact.
  // The note must not let them read a stranger's typing as a record match.
  const source = readFileSync(new URL("../src/uc01/workflow.js", import.meta.url), "utf8");
  assert.match(source, /Name the enquirer gave for the person/, "the hand-off note does not carry the name at all");
  assert.match(source, /THEIR CLAIM, not a record match/, "the note presents an unverified name without qualifying it");
});

test("GET /api/example serves a CONFIGURED subject and performs no lookup", async () => {
  // Structural: the route must be answerable with no `remote` at all. If it
  // ever grew a lookup, this construction would throw rather than pass.
  const handler = createThirdPartyDoorHandler({
    remote: null,
    audit,
    caseStore,
    classify: classifyRequestRuleBased,
    demoSubject: { employmentReference: "emp_active_001", subjectName: "Amara Okafor" },
  });
  const res = await callApi(handler, { method: "GET", path: "/api/example" });
  assert.equal(res.status, 200);
  assert.equal(res.body.demo.employmentReference, "emp_active_001");
  assert.equal(res.body.demo.subjectName, "Amara Okafor");
});

test("with no demo subject configured the example route answers null, rather than inventing one", async () => {
  // The correct posture for a real deployment: a production door has no demo
  // subject and must offer none. The page falls back to marked examples.
  const handler = createThirdPartyDoorHandler({ remote: null, audit, caseStore, classify: classifyRequestRuleBased });
  const res = await callApi(handler, { method: "GET", path: "/api/example" });
  assert.equal(res.status, 200);
  assert.equal(res.body.demo, null);
});

test("the two copies of this door each get a reference that resolves on the Remote they actually talk to", () => {
  // The whole reason the server owns this. `npm run thirdparty` runs against
  // the in-process mock; the mounted copy reads the live Sandbox. A single
  // hardcoded id would resolve on one and 404 on the other — and because every
  // outcome returns the identical ack, the broken one would be INVISIBLE.
  const cli = readFileSync(new URL("../src/thirdparty/cli.js", import.meta.url), "utf8");
  assert.match(cli, /demoSubject/, "the local door passes no demo subject, so its quick-fills reach nothing");
  assert.match(cli, /emp_active_001/, "the local door's example is not the mock's own employee");

  const deps = readFileSync(new URL("../deploy/cx-apis/deps.js", import.meta.url), "utf8");
  assert.match(deps, /demoSubject/, "the deployed door passes no demo subject");
  // Taken from KNOWN_EMPLOYEES rather than written out — that list is the one
  // place a Sandbox id is re-verified against the live account, and the ids rot
  // silently when the Sandbox is re-provisioned (it has happened once already).
  assert.match(deps, /KNOWN_EMPLOYEES/, "the deployed door hardcodes an id instead of reading the verified list");
  assert.ok(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(deps.slice(deps.indexOf("buildThirdPartyDoorHandler"))),
    "a Sandbox UUID was pasted into deps.js — it will rot silently and separately from KNOWN_EMPLOYEES"
  );
});

test("the page tells the reader WHERE the filled reference came from", () => {
  // A real record and a marked example look identical in a text box, and the
  // answer this door gives is identical either way — so nothing on screen
  // would distinguish them unless the page says so.
  const source = read("app.js");
  assert.match(source, /a real demo record on the Remote account/, "the page never says the reference is real");
  assert.match(source, /marked examples/, "the page never says the reference is an example");
  assert.match(source, /fetch\("api\/example"\)/, "the page does not ask the server which it has");
});

test("the browser sends every field the server requires — the form and the payload cannot drift apart", () => {
  // CAUGHT IN A REAL BROWSER, NOT BY A UNIT TEST, and that is the point.
  // `subjectName` was added to index.html and to the quick-fills, and every
  // test in this file kept passing, because they all POST JSON directly and
  // never build the body the way the page does. In Chromium the form filled
  // correctly, passed native validation, and then posted without the field —
  // so a clicked quick-fill answered with the 400 form-validation text where
  // the acknowledgement should have been.
  //
  // Comparing the payload against the HTML's own `required` attributes,
  // rather than against a list restated here, is what makes this survive the
  // NEXT field somebody adds.
  const html = mainFormHtml();
  const source = read("app.js");
  const body = source.slice(source.indexOf("const body = {"), source.indexOf("try {", source.indexOf("const body = {")));

  const required = [...html.matchAll(/id="([a-zA-Z]+)"[^>]*\brequired\b/g)].map((m) => m[1]);
  assert.ok(required.length >= 5, "no required fields found — re-point this test");

  for (const id of required) {
    assert.match(
      body,
      new RegExp(`getElementById\\("${id}"\\)`),
      `the page marks ${id} required but never sends it — a filled form will be refused as empty`
    );
  }
});

// ---------------------------------------------------------------------------
// Remote's own Employee ID — what a third party can actually hold
// ---------------------------------------------------------------------------
// THE QUESTION THAT PROMPTED THIS: "when a bank sends a request to Remote, how
// do they identify the employee? It cannot be just a name. If there is a form
// of ID, what is that ID?"
//
// The answer was not in this repo and had never been established. It is
// Remote's **Employee ID** — "a unique identifier assigned to each employee on
// the Remote platform", which Remote shows the employee in their own profile
// under Job and Pay (support.remote.com article 20120956060941). It is NOT the
// API's UUID. It is six characters, and the API exposes it as `short_id`.
//
// Measured live 2026-08-28 against gateway.remote-sandbox.com:
//   GET /v1/employments/CZKYVH          -> 404 "Employment not found"
//   GET /v1/employments?short_id=CZKYVH -> 200, total_count 1
//   112 employments · 112 with a short_id · 112 DISTINCT · all /^[A-Z0-9]{6}$/
//
// That is why the field now asks for it by name and tells the enquirer where
// the employee finds it, instead of "the reference number or id they provided"
// — which named nothing that exists.
// ---------------------------------------------------------------------------

test("a Remote Employee ID is resolved to the employment it names", async () => {
  let askedFor = null;
  const resolvingRemote = {
    findEmploymentByShortId: async (code) => {
      askedFor = code;
      return { id: "emp_active_001" };
    },
    getEmployment: async (id) => (id === "emp_active_001" ? { id, status: "active" } : null),
  };
  const h = createThirdPartyDoorHandler({
    remote: resolvingRemote,
    audit,
    caseStore,
    classify: classifyRequestRuleBased,
  });
  const res = await callApi(h, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "CZKYVH", purpose: "Short-id resolution probe" },
  });
  assert.equal(res.status, 200);
  assert.equal(askedFor, "CZKYVH", "the six-character code was never resolved");
});

test("a UUID still works — resolution only fires for something shaped like a short id", async () => {
  let called = false;
  const h = createThirdPartyDoorHandler({
    remote: {
      findEmploymentByShortId: async () => { called = true; return null; },
      getEmployment: async () => null,
    },
    audit,
    caseStore,
    classify: classifyRequestRuleBased,
  });
  await callApi(h, {
    method: "POST",
    path: "/api/requests",
    body: {
      ...VALID_BODY,
      employmentReference: "2f7f8210-91fc-47db-803c-77a1cc625781",
      purpose: "UUID passthrough probe",
    },
  });
  assert.equal(called, false, "a UUID was sent to the short-id filter, which cannot match it");
});

test("VC-33: an unresolvable code, a resolvable one and a thrown lookup are indistinguishable from outside", async () => {
  // The reason the resolution is swallowed. If a failed lookup changed the
  // answer, an unreachable Remote would be distinguishable from a code that
  // does not exist — a disclosure by side channel rather than by wording.
  const answers = [];
  const remotes = [
    { label: "resolves", findEmploymentByShortId: async () => ({ id: "emp_active_001" }), getEmployment: async () => ({ id: "emp_active_001", status: "active" }) },
    { label: "no match", findEmploymentByShortId: async () => null, getEmployment: async () => null },
    { label: "throws", findEmploymentByShortId: async () => { throw new Error("upstream down"); }, getEmployment: async () => null },
  ];
  for (const remote of remotes) {
    const h = createThirdPartyDoorHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
    const res = await callApi(h, {
      method: "POST",
      path: "/api/requests",
      body: { ...VALID_BODY, employmentReference: "ABC123", purpose: `Short-id VC-33 probe ${remote.label}` },
    });
    const { reference, ...rest } = res.body;
    answers.push({ status: res.status, ...rest });
  }
  assert.deepEqual(answers[0], answers[1], "a code that resolved answered differently from one that did not");
  assert.deepEqual(answers[0], answers[2], "an upstream failure was visible to the caller");
});

test("findEmploymentByShortId refuses a malformed code without calling Remote, and refuses an ambiguous match", async () => {
  const { RemoteClient } = await import("../src/remote/restClient.js");
  const calls = [];
  const client = new RemoteClient({
    baseUrl: "http://unused.invalid",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ data: { employments: [{ id: "a" }, { id: "b" }] } }) };
    },
  });
  // Shape first: a UUID, a short string and free text must never reach the wire.
  for (const bad of ["2f7f8210-91fc-47db-803c-77a1cc625781", "ABC", "not a code", "", null]) {
    assert.equal(await client.findEmploymentByShortId(bad), null, `${bad} was accepted`);
  }
  assert.equal(calls.length, 0, "a malformed code was sent to Remote");

  // Two matches is an assumption that has stopped holding. Guessing which is
  // right would attest to the wrong person, so it refuses.
  assert.equal(await client.findEmploymentByShortId("CZKYVH"), null, "an ambiguous match was resolved anyway");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /short_id=CZKYVH/);
});

test("the form asks for the Employee ID by name and says where the employee finds it", () => {
  // "The reference number or id they provided" named nothing that exists. A
  // field an enquirer cannot fill is a gate that only stops legitimate people.
  const html = read("index.html");
  assert.match(html, /Remote Employee ID/, "the field does not name what it wants");
  assert.match(html, /Job and Pay/i, "the page does not say where the employee finds it");
  assert.match(html, /CZKYVH|6-character/i, "the page does not show the shape of the code");
});

// ---------------------------------------------------------------------------
// The identifiers a real bank sends
// ---------------------------------------------------------------------------
// "They cannot just use a name. They could be a hundred Alex Ocumbos."
// Correct, and it is how every real verification system is built: the subject's
// NAME plus one further fact THE SUBJECT THEMSELF supplied.
//
//   US        Social Security Number. Experian Verify requires the full SSN;
//             The Work Number keys on SSN + employer code and does not require
//             the name at all; employers receiving requests ask for the last 4.
//   NL        The NHG model werkgeversverklaring — the standard employer's
//             statement for a mortgage — uses name, address, DATE OF BIRTH,
//             start date and position, and carries no BSN.
//   Truework  Name + SSN + date of birth + authorisation form.
//
// We collect NAME + DATE OF BIRTH + Remote's own Employee ID, and deliberately
// no national identifier. Those services key on SSN because they are
// credentialed consumer reporting agencies under the FCRA with vetted verifier
// accounts; this page is open to anyone, and a box asking strangers for
// national ID numbers collects more risk than it resolves.
//
// And the transaction's real shape: a request is never "does anyone called X
// work for you", it is "your employee told us these facts, confirm them"
// (Fannie Mae Form 1005; HomeLet's referencing form). So the claimed start
// date is carried to the specialist as the claim under check.
// ---------------------------------------------------------------------------

test("a name alone is refused — the date of birth is required, and the refusal says why", async () => {
  const { subjectDateOfBirth, ...withoutDob } = VALID_BODY;
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: withoutDob });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "subject_date_of_birth_required");
  assert.match(res.body.reason, /many people with the same one/i, "the refusal does not explain why a name is not enough");
});

test("the date of birth is shape-checked, never plausibility-checked", async () => {
  // A plausibility rule (an age range, say) would be a statement about who
  // could possibly be employed, applied before any record is read — a rule
  // about people wearing a validator's clothes.
  const bad = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, subjectDateOfBirth: "2026-13-45" },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "subject_date_of_birth_malformed");

  // A 12-year-old and a 120-year-old are both ACCEPTED. Whether the record
  // supports the claim is the specialist's judgement, not this form's.
  for (const dob of ["2014-01-01", "1906-01-01"]) {
    const res = await callApi(handler, {
      method: "POST",
      path: "/api/requests",
      body: { ...VALID_BODY, subjectDateOfBirth: dob, purpose: `Age plausibility probe ${dob}` },
    });
    assert.equal(res.status, 200, `${dob} was refused on plausibility rather than shape`);
  }
});

test("VC-33: two different dates of birth against the same employment answer identically", async () => {
  // The invariant that matters most now. A date of birth that "matched" and
  // one that did not must be indistinguishable, or an enquirer could brute
  // force a birthday against a known Employee ID and read the answer off the
  // difference.
  const ask = async (dob, purpose) => {
    const res = await callApi(handler, {
      method: "POST",
      path: "/api/requests",
      body: { ...VALID_BODY, subjectDateOfBirth: dob, purpose },
    });
    const { reference, ...rest } = res.body;
    return { status: res.status, ...rest };
  };
  const a = await ask("1990-05-04", "DOB invariance probe A");
  const b = await ask("1971-11-30", "DOB invariance probe B");
  assert.deepEqual(a, b, "the date of birth reached a branch — a birthday is now brute-forceable");
});

test("neither the date of birth nor the claimed start date is echoed to the enquirer", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, subjectDateOfBirth: "1977-03-19", subjectClaimedStartDate: "2019-08-26" },
  });
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes("1977-03-19"), "the subject's date of birth was echoed back");
  assert.ok(!body.includes("2019-08-26"), "the claimed start date was echoed back");
});

test("the claimed start date is optional, and a malformed one is refused distinguishably from a missing one", async () => {
  const blank = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, subjectClaimedStartDate: "", purpose: "Optional start date probe" },
  });
  assert.equal(blank.status, 200, "an enquirer holding only a name and an id was refused");

  const bad = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, subjectClaimedStartDate: "last summer" },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "subject_claimed_start_date_malformed");
});

test("the specialist is told both facts are CLAIMS, and told to treat a mismatch as a reason to stop", () => {
  // A mismatch must never be a gate here: refusing on it would tell an
  // enquirer, by the shape of the refusal, that they had guessed part of it
  // right. It is a signal for the one person who can act on it.
  const source = readFileSync(new URL("../src/uc01/workflow.js", import.meta.url), "utf8");
  assert.match(source, /Date of birth given/, "the hand-off note does not carry the date of birth");
  assert.match(source, /Start date they were told/, "the hand-off note does not carry the claimed start date");
  assert.match(source, /BOTH ARE CLAIMS/, "the note presents unverified facts without qualifying them");
  assert.match(source, /reason to stop rather than a detail to correct/, "the note does not say what to do with a mismatch");
});

test("the page refuses to collect a national identifier, and says so where an enquirer will read it", () => {
  // The design statement. Anyone who has used The Work Number will expect an
  // SSN box; its absence has to be explained or it reads as an omission.
  const html = read("index.html");
  assert.match(html, /never ask for a national ID number/i, "the page does not state the refusal");
  assert.match(html, /Social Security/i, "the page does not name what it is refusing");

  // Structural, not cosmetic: no such field may exist on the form at all.
  for (const banned of ["ssn", "socialSecurity", "nationalId", "bsn", "nino", "taxId"]) {
    assert.ok(
      !new RegExp(`id="${banned}"`, "i").test(html),
      `the form collects ${banned} — the page's own promise is false`
    );
  }
  const server = readFileSync(new URL("../src/thirdparty/server.js", import.meta.url), "utf8");
  assert.ok(!/body\.(ssn|nationalId|socialSecurity)/i.test(server), "the server reads a national identifier off the body");
});
