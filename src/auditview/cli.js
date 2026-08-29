// ---------------------------------------------------------------------------
// cli.js  —  `npm run audit-ui`
// ---------------------------------------------------------------------------
// Starts the execution & audit trail viewer: a live feed of audit_log
// decisions, a drill-down to every audit_trace attempt under one decision, a
// bug-audit lookup by external ref (workflow_claims + audit rows + nearby
// ops_alerts), and the ops-alerts ledger.
//
// Honest wiring, matching how every other surface treats real vs. seeded:
//   - Supabase: real when SUPABASE_DB_URL is set — every read is a live query
//     against audit_log/audit_trace/workflow_claims/ops_alerts. This viewer
//     WRITES NOTHING in any mode (src/auditview/server.js has no POST route).
//   - Unconfigured (or --seeded): a labelled demo dataset, so a fresh clone
//     shows the whole UI with zero credentials. The page banners the mode —
//     fabricated rows must never read as production history.
//   - Access: OPEN on a fresh clone; gated behind PORTAL_ACCESS_KEY the moment
//     a durable store is attached — the same shared-key rule and the same key
//     as the request portal (src/portal/access.js), because this surface
//     serves real employment ids, actors and decision records.
//
// Usage:
//   npm run audit-ui                 # port 4044
//   npm run audit-ui -- --port 4099
//   npm run audit-ui -- --seeded     # force the demo dataset even with Supabase configured
// ---------------------------------------------------------------------------

import { startAuditViewServer } from "./server.js";
import { AuditReadStore } from "./readStore.js";
import { portalAccessPosture, PORTAL_KEY_ENV } from "../portal/access.js";
import { getPgPool } from "../shared/db.js";
import { PORTS } from "../shared/ports.js";

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.AUDIT_VIEW;

  const pgPool = forceSeeded ? null : getPgPool();
  // Unconfigured means seeded: the viewer's zero-credential mode is demo rows,
  // clearly labelled, not an empty page. (The DEPLOYMENT does the opposite —
  // no pool there means an honest 503, because demo rows on a public URL would
  // be indistinguishable from live history. deploy/cx-apis/deps.js.)
  const store = new AuditReadStore({ pgPool, seeded: !pgPool });

  // Same rule as the portal and the deployment: a key is required once a
  // durable store is attached, or on a public URL. A seeded run needs nothing.
  const access = portalAccessPosture(process.env, { persistent: Boolean(pgPool) });

  const server = await startAuditViewServer({ store, access }, port);

  console.log(`▶ Audit trail viewer: http://localhost:${port}`);
  console.log(`  Data: ${dataLine(store)}`);
  console.log(`  Access: ${accessLine(access)}`);
  console.log("  This surface is READ-ONLY — no POST route exists in its server (same discipline as UC-08's API).");

  const shutdown = () => {
    const forceExit = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 10_000);
    forceExit.unref();
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function dataLine(store) {
  return store.mode() === "supabase"
    ? "REAL Supabase reads (audit_log, audit_trace, workflow_claims, ops_alerts)."
    : "SEEDED demo rows — no Supabase attached; the page banners this.";
}

function accessLine(access) {
  if (!access.required) return "OPEN — no key required (nothing durable is attached and this is not a public deployment).";
  if (!access.keyConfigured) {
    return (
      `REFUSING EVERY REQUEST — a key is required (${access.reasons.join("; ")}) and ${PORTAL_KEY_ENV} is not set. ` +
      `Set ${PORTAL_KEY_ENV} in .env, or run with --seeded to stay on demo rows.`
    );
  }
  return `KEY REQUIRED (${access.reasons.join("; ")}) — the page asks for ${PORTAL_KEY_ENV}'s value once and keeps it for the browser session.`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
