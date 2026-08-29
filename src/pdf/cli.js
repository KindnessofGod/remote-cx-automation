// ---------------------------------------------------------------------------
// cli.js  —  render a REAL UC-01 letter to a REAL PDF file. Run: npm run pdf-demo
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// render.js's Playwright/Chromium path is deliberately NOT exercised by
// `npm test` (see render.js's header + test/pdfRender.test.js) — a real
// browser launch is neither fast nor hermetic. This script is the actual
// proof the real path works: it runs a real UC-01 ticket through the real
// mock Remote server and the real handleVerificationTicket(), with
// `renderPdf` wired to the real `renderPdfFromHtml`, and writes the
// resulting PDF bytes to disk so the file itself — not just a green test —
// is the evidence.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { resolveChromiumPath } from "../shared/chromiumPath.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { handleVerificationTicket } from "../uc01/workflow.js";
import { classifyRequestRuleBased } from "../uc01/classifier.js";
import { PORTS } from "../shared/ports.js";
import { renderPdfFromHtml } from "./render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "..", "demo", "letter.pdf");

const server = await startMockServer(PORTS.PDF_DEMO_MOCK); // registry-allocated; see src/shared/ports.js
const remote = new RemoteClient({ baseUrl: `http://localhost:${PORTS.PDF_DEMO_MOCK}` });

// rca-uv8q / K8(a): an `authenticatedEmploymentId` session is a Remote
// session — G-2 (policyEngine.js gate 8) deliberately deflects it to
// self-service, so this demo used to be unable to ever reach auto_resolve.
// The email session below is what a genuine ticket-requester carries; do not
// revert this to authenticatedEmploymentId, it will silently break the demo.
const ticket = {
  text: "Please send me a standard employment verification letter.",
  session: { authenticatedEmail: "amara@acme.test" },
  employmentId: "emp_active_001",
  // rca-fawf/K3: an auto_resolve carrying no reference is refused on both
  // execution paths — a letter that can't be traced back to its request is
  // exactly what that ruling forbids, and this demo's whole subject is the
  // letter.
  externalRef: "pdf-demo-1",
};

console.log("Running UC-01 with a real renderPdf dependency (real Chromium launch)...");

// This container pre-installs Chromium at a fixed path
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers/chromium) that can drift ahead
// of whichever exact revision the installed `playwright` package expects by
// default — override via PW_CHROMIUM_PATH (or this hardcoded fallback) rather
// than downloading a second browser build, per this environment's own setup
// note (no `playwright install`; restricted network egress).
const executablePath = resolveChromiumPath();
const renderPdf = (html) => renderPdfFromHtml(html, { executablePath });

const result = await handleVerificationTicket(ticket, {
  remote,
  audit: new AuditLogger(), // in-memory only — this is a rendering demo, not a live audit run
  caseStore: new CaseStore(),
  classify: classifyRequestRuleBased, // free/offline/deterministic, same as npm run demo
  renderPdf,
});

server.close();

if (result.decision !== "auto_resolve" || !result.letterPdf) {
  console.error(`Expected auto_resolve with a letterPdf, got decision=${result.decision}`);
  process.exit(1);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, result.letterPdf);

console.log(`decision: ${result.decision}`);
console.log(`letterHtml: ${result.letterHtml.length} bytes`);
console.log(`letterPdf:  ${result.letterPdf.length} bytes -> ${OUT_PATH}`);
