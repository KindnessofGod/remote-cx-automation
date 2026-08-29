// ---------------------------------------------------------------------------
// pdfRender.test.js  —  the renderPdf seam, hermetically, plus an opt-in
// real-Chromium check
// ---------------------------------------------------------------------------
// WHY THIS IS SPLIT IN TWO
// A real Playwright/Chromium launch is a real subprocess with real disk/IPC —
// not fast, not fully hermetic in the sense the rest of this suite is (no
// network, no filesystem beyond the audit log, sub-5-second total). So:
//
//   1. The tests that ALWAYS run (the majority below) prove the PLUMBING —
//      handleVerificationTicket()'s `renderPdf` seam does the right thing —
//      using a fake `renderPdf` function, never a real browser. This is the
//      option CLAUDE.md's "optional integrations degrade to safe defaults"
//      convention and this repo's own DI pattern (classify/zendesk/judge)
//      call for, and it's what actually needs proving: that a caller who
//      supplies a renderer gets a PDF back, that one who doesn't sees zero
//      behavior change, and that the seam is never invoked outside the
//      auto_resolve path.
//   2. ONE test at the bottom launches the REAL renderPdfFromHtml() against
//      the REAL Chromium this container pre-installs. It is explicitly
//      opt-in — skipped by default — via RUN_REAL_PDF_TESTS=1, so `npm test`
//      never launches a browser on every run. The real path is otherwise
//      proven by `npm run pdf-demo` (src/pdf/cli.js), which writes an actual
//      PDF file to disk — see that script's own header and this repo's
//      report for the real file size.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { renderPdfFromHtml } from "../src/pdf/render.js";

const PORT = 4033; // dedicated — never clashes with other test files' mock servers

// ONE server for the whole file (started/stopped once), matching
// test/uc01.test.js's own pattern — NOT started/stopped per test on the same
// port: Node's global fetch keeps a keep-alive connection pool per origin,
// and restarting a server on a port fetch already has a pooled (now-stale)
// connection to surfaces as a spurious "fetch failed / other side closed" on
// the very next request, unrelated to anything this file is actually testing.
let server;
let remote;

before(async () => {
  server = await startMockServer(PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${PORT}` });
});
after(() => server && server.close());

function run(ticket, extraDeps = {}) {
  return handleVerificationTicket(ticket, {
    remote,
    audit: new AuditLogger(),
    caseStore: new CaseStore(),
    classify: classifyRequestRuleBased,
    ...extraDeps,
  });
}

const AUTO_RESOLVE_TICKET = {
  text: "Please send me a standard employment verification letter.",
  session: { authenticatedEmail: "amara@acme.test" },
  employmentId: "emp_active_001",
  // rca-fawf/K3: an `auto_resolve` carrying no reference is now REFUSED — a
  // letter that cannot be traced back to the request that asked for it is
  // exactly the artifact the ruling forbids, and this fixture's whole subject
  // is the letter.
  externalRef: "pdf-auto-1",
};

const ESCALATE_TICKET = {
  text: "I need a standard employment letter.",
  // THE SESSION MUST MATCH ITS OWN RECORD (kofi@acme.test — mockServer.js's
  // emp_terminated_002 fixture) or this stops being an escalation at all.
  // Since G-3, an authenticated signal that does not match its own claimed
  // record is a THIRD PARTY — a pending consent question, not an escalation —
  // and this test needs a genuine `employee_not_active` escalate to prove
  // renderPdf is never called for one.
  session: { authenticatedEmail: "kofi@acme.test" },
  employmentId: "emp_terminated_002",
};

test("default behavior (no renderPdf supplied) is completely unchanged", async () => {
  const r = await run(AUTO_RESOLVE_TICKET);
  assert.equal(r.decision, "auto_resolve");
  assert.match(r.letterHtml, /Employment Verification Letter/);
  assert.equal("letterPdf" in r, false, "letterPdf must be absent, not merely undefined, on the default path");
});

test("with a fake renderPdf, auto_resolve returns letterPdf built from the real letterHtml", async () => {
  let receivedHtml = null;
  const fakeRenderPdf = async (html) => {
    receivedHtml = html;
    return Buffer.from(`FAKE-PDF-BYTES-FOR:${html.length}`);
  };

  const r = await run(AUTO_RESOLVE_TICKET, { renderPdf: fakeRenderPdf });

  assert.equal(r.decision, "auto_resolve");
  assert.ok(Buffer.isBuffer(r.letterPdf), "letterPdf must be a Buffer");
  assert.equal(receivedHtml, r.letterHtml, "renderPdf must be called with exactly the rendered letter HTML");
  assert.equal(r.letterPdf.toString(), `FAKE-PDF-BYTES-FOR:${r.letterHtml.length}`);
});

test("renderPdf is never called for a non-auto_resolve decision (escalate)", async () => {
  let called = false;
  const fakeRenderPdf = async () => {
    called = true;
    return Buffer.from("should not happen");
  };

  const r = await run(ESCALATE_TICKET, { renderPdf: fakeRenderPdf });

  assert.equal(r.decision, "escalate");
  assert.equal(r.letterHtml, undefined);
  assert.equal(called, false, "renderPdf must not run when no letter was rendered");
  assert.equal("letterPdf" in r, false);
});

test("a rejecting renderPdf propagates rather than silently swallowing (it's an explicit opt-in, not a background write)", async () => {
  const failingRenderPdf = async () => {
    throw new Error("chromium exploded");
  };
  await assert.rejects(() => run(AUTO_RESOLVE_TICKET, { renderPdf: failingRenderPdf }), /chromium exploded/);
});

test("renderPdfFromHtml rejects empty/invalid input without touching a browser", async () => {
  await assert.rejects(() => renderPdfFromHtml(""), /non-empty string/);
  await assert.rejects(() => renderPdfFromHtml(null), /non-empty string/);
});

// ---------------------------------------------------------------------------
// Opt-in real-Chromium check. Skipped unless RUN_REAL_PDF_TESTS=1 is set —
// `npm test` never launches a browser by default (see file header). Run it
// explicitly with:
//   RUN_REAL_PDF_TESTS=1 node --test test/pdfRender.test.js
// ---------------------------------------------------------------------------
const realBrowserSkipReason =
  process.env.RUN_REAL_PDF_TESTS === "1"
    ? false
    : "set RUN_REAL_PDF_TESTS=1 to exercise the real Chromium/Playwright path (not run by default — see file header)";

test(
  "renderPdfFromHtml produces a real, non-trivial PDF via real Chromium",
  { skip: realBrowserSkipReason },
  async () => {
    const html = "<html><body><h1>Real Chromium render check</h1><p>hello pdf</p></body></html>";
    const pdf = await renderPdfFromHtml(html, { executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    assert.ok(Buffer.isBuffer(pdf));
    // %PDF- magic bytes — proves this is an actual PDF file, not an error page.
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(pdf.length > 1000, `expected a real multi-KB PDF, got ${pdf.length} bytes`);
  }
);
