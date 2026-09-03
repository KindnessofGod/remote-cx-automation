// ---------------------------------------------------------------------------
// cli.js  —  `npm run portal`
// ---------------------------------------------------------------------------
// Starts the request portal: one Remote-styled intake page with seven request
// forms, one for each use case that had no entry point of its own (UC-02, 03,
// 04, 05, 07, 08, 09). Every submission runs that use case's REAL workflow
// function in this process — see src/portal/server.js's header for why it is
// in-process rather than a caller of the nine `npm run ucNN-api` servers, and
// src/portal/README.md for the whole picture.
//
// Honest wiring, matching how every other surface in this repo treats real
// vs. mock:
//   - Remote API: ALWAYS the local mock. The portal is a demo intake surface
//     and its UC-02 form picks from the mock's own expense fixtures; pointing
//     it at the Sandbox would mean submitting expenses against records nobody
//     has verified. The console says so on every start.
//   - Zendesk: REAL when credentials are configured, the local mock otherwise
//     — the same choice src/remoteui/cli.js makes. This line used to read
//     "never: the portal creates no tickets", and that left the loop open: the
//     ZAF sidebar finds a case by TICKET ID, so a portal submission needing a
//     human had no ticket for the sidebar to attach to. A ticket is now raised
//     for a human-gated decision ONLY, after the gates have run and the record
//     is durable. See src/portal/ticketing.js for which decisions qualify.
//   - Supabase: real when SUPABASE_DB_URL is set (audit rows + all seven
//     stores), in-memory otherwise. This used to say UC-02's store was
//     in-memory "in every mode … no uc02 schema has been verified or
//     provisioned" — that claim was already false when it was written (the
//     `uc02_expenses` table existed the whole time; see expenseStore.js's
//     header and docs/BUILD-LOG.md §3.35) and has been corrected in
//     src/portal/wiring.js. There is now no exception in this list.
//   - OpenAI: real when configured. When it is not, the rule-based classifier
//     each use case already ships is passed explicitly, so a run with no .env
//     at all is deterministic instead of quietly degraded.
//   - Access: OPEN on a fresh clone, and gated behind PORTAL_ACCESS_KEY as soon
//     as anything durable is attached — the same rule the public deployment
//     applies (src/portal/access.js). With SUPABASE_DB_URL set and no key
//     configured this refuses every API call and says so at startup; `--seeded`
//     keeps a credential-free run open.
//
// Usage:
//   npm run portal                 # port 4042
//   npm run portal -- --port 4042
//   npm run portal -- --seeded     # force in-memory even if Supabase is configured
// ---------------------------------------------------------------------------

import { startPortalServer } from "./server.js";
import { resolveChromiumPath } from "../shared/chromiumPath.js";
import { REQUEST_TYPES } from "./requestTypes.js";
import { buildPortalStores, portalLlmDefaults, portalReceiptReader } from "./wiring.js";
import { portalAccessPosture, PORTAL_KEY_ENV } from "./access.js";
import { startMockServer } from "../remote/mockServer.js";
import { ZendeskClient } from "../zendesk/restClient.js";
import { startMockServer as startZendeskMock } from "../zendesk/mockServer.js";
import { config, isZendeskConfigured } from "../shared/config.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { getPgPool } from "../shared/db.js";
import { isLlmConfigured } from "../shared/llm.js";
import { PORTS } from "../shared/ports.js";
import { renderPdfFromHtml } from "../pdf/render.js";

const REMOTE_MOCK_PORT = PORTS.PORTAL_REMOTE_MOCK; // registry-allocated; see src/shared/ports.js
const ZENDESK_MOCK_PORT = PORTS.PORTAL_ZENDESK_MOCK; // ditto — never a literal here

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.PORTAL;

  const pgPool = forceSeeded ? null : getPgPool();

  const remoteMock = await startMockServer(REMOTE_MOCK_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_MOCK_PORT}` });
  const audit = new AuditLogger(null, { pgPool });

  // One store per use case, all owned by THIS process, built by the same
  // function the Vercel deployment uses (./wiring.js). Deliberately not shared
  // with the nine `npm run ucNN-api` processes: they each seed their own, and
  // the page says plainly that a portal submission will not show up on
  // `npm run dashboard` because of it.
  const stores = buildPortalStores({ pgPool });
  const llm = portalLlmDefaults();
  const receiptReader = portalReceiptReader();

  // Same rule as the deployment (src/portal/access.js): a key is required once
  // a durable store is attached, or on a public URL. A seeded, in-memory run —
  // a fresh clone with no .env — needs nothing.
  const access = portalAccessPosture(process.env, { persistent: Boolean(pgPool) });

  // ZENDESK — REAL when configured, the mock otherwise, exactly the choice
  // src/remoteui/cli.js makes. A ticket is only ever raised for a decision
  // that needs a human (src/portal/ticketing.js), and only after the real
  // gates have run and the record is durable.
  let zendesk;
  let zendeskMock = null;
  if (isZendeskConfigured()) {
    zendesk = new ZendeskClient({
      subdomain: config.zendesk.subdomain,
      email: config.zendesk.email,
      apiToken: config.zendesk.apiToken,
      clientId: config.zendesk.oauthClientId,
      clientSecret: config.zendesk.oauthClientSecret,
    });
  } else {
    zendeskMock = await startZendeskMock(ZENDESK_MOCK_PORT);
    zendesk = new ZendeskClient({
      baseUrl: `http://localhost:${ZENDESK_MOCK_PORT}`,
      email: "demo@portal.test",
      apiToken: "demo",
    });
  }
  const employmentIdFieldId = config.zendesk.employmentIdFieldId ?? null;

  // PDF rendering — real Chromium, the same seam src/pdf/cli.js exercises for
  // `npm run pdf-demo`. rca-cput: the capability already existed and nothing
  // offered it, so this wires it into the surface that does. This container
  // pre-installs Chromium at a fixed path that can drift ahead of whichever
  // build the installed `playwright` package expects by default — override
  // via PW_CHROMIUM_PATH rather than downloading a second browser build.
  const renderPdf = (html) =>
    renderPdfFromHtml(html, { executablePath: resolveChromiumPath() });

  const server = await startPortalServer(
    { remote, audit, stores, llm, receiptReader, access, zendesk, employmentIdFieldId, renderPdf },
    port
  );

  console.log(`▶ Request portal: http://localhost:${port}`);
  console.log(`  Remote API: MOCK (http://localhost:${REMOTE_MOCK_PORT}) — the portal never touches a real Remote account.`);
  console.log(
    `  Zendesk: ${
      isZendeskConfigured()
        ? `REAL (${config.zendesk.subdomain}.zendesk.com) — a decision needing a human creates an ACTUAL ticket.`
        : `MOCK (http://localhost:${ZENDESK_MOCK_PORT}) — tickets are created there only.`
    }`
  );
  console.log("  A ticket is raised only for decisions that need a human, after the gates have run — never for an auto-resolved one.");
  console.log(`  Persistence: ${pgPool ? "Supabase Postgres (audit + six stores)" : "in-memory — nothing is persisted"}.`);
  console.log("  UC-01 letter PDF: real Chromium (Playwright) — \"Save as PDF\" renders on demand.");
  console.log(`  Access: ${accessLine(access)}`);
  console.log(`  Classification: ${isLlmConfigured() ? "real OpenAI (rule-based fallback on failure)" : "rule-based (no OPENAI_API_KEY configured)"}.`);
  console.log("  This page STANDS IN for Remote product surfaces that have no public API — it is not Remote's real platform.");
  console.log("  Submissions land in this process's own stores, so they do NOT appear in `npm run dashboard`.");
  console.log("  Request types:");
  for (const t of REQUEST_TYPES) {
    console.log(`   ${t.useCase} (${t.tier.padEnd(6)}) — ${t.label}`);
  }

  const shutdown = () => {
    // Stop accepting new connections; let in-flight requests finish. If any
    // connection is still open after the grace period (e.g. an idle
    // keep-alive), force it closed rather than hang the process forever.
    const forceExit = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 10_000);
    forceExit.unref();
    server.close(() => {
      remoteMock.close();
      zendeskMock?.close();
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * One line saying whether this run is gated, and what to do about it. Printed
 * at startup because the failure it describes — every API call refused — looks
 * from the browser like a broken portal rather than a missing setting.
 */
function accessLine(access) {
  if (!access.required) return "OPEN — no key required (nothing durable is attached and this is not a public deployment).";
  if (!access.keyConfigured) {
    return (
      `REFUSING EVERY REQUEST — a key is required (${access.reasons.join("; ")}) and ${PORTAL_KEY_ENV} is not set. ` +
      `Set ${PORTAL_KEY_ENV} in .env, or run with --seeded to keep everything in memory.`
    );
  }
  return `KEY REQUIRED (${access.reasons.join("; ")}) — the page asks for ${PORTAL_KEY_ENV}'s value once and keeps it for the browser session.`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
