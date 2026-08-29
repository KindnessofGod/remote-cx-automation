// ---------------------------------------------------------------------------
// cli.js  —  `npm run queue-ui`
// ---------------------------------------------------------------------------
// Starts the approval queue: everything awaiting a human across all nine use
// cases, and — as the headline — everything awaiting a human with no reachable
// place to be approved.
//
// Honest wiring, matching how every other surface treats real vs. seeded:
//   - Supabase: real when SUPABASE_DB_URL is set. Every row is a live read of
//     the eight places a pending decision can sit. This view WRITES NOTHING in
//     any mode (src/approvalqueue/server.js has no POST route).
//   - Zendesk: real when the OAuth pair is configured. Ticket ids are read back
//     so a reference can be reported as a CONFIRMED ticket rather than as a
//     string that looks like one. Unconfigured, every such reference is
//     reported as unverified — never as reachable, never as missing.
//   - Unconfigured (or --seeded): a labelled demo dataset with its own fake
//     Zendesk, so a fresh clone shows every stuck category with zero
//     credentials. The page banners the mode.
//   - Access: OPEN on a fresh clone; gated behind PORTAL_ACCESS_KEY the moment
//     a durable store is attached — the same key as the request portal and the
//     audit viewer, because this surface serves real employment ids, requester
//     names and decision records.
//
// Usage:
//   npm run queue-ui                 # port 4047
//   npm run queue-ui -- --port 4099
//   npm run queue-ui -- --seeded     # demo dataset even with Supabase configured
// ---------------------------------------------------------------------------

import "dotenv/config";

import { startApprovalQueueServer } from "./server.js";
import { ApprovalQueueStore } from "./queueStore.js";
import { TicketFacts } from "./ticketFacts.js";
import { buildQueueDemoDataset, demoZendesk } from "./demoSeed.js";
import { ZendeskClient } from "../zendesk/restClient.js";
import { portalAccessPosture, PORTAL_KEY_ENV } from "../portal/access.js";
import { getPgPool } from "../shared/db.js";
import { PORTS } from "../shared/ports.js";

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.APPROVAL_QUEUE;

  const pgPool = forceSeeded ? null : getPgPool();
  const seeded = !pgPool;
  const seedData = seeded ? buildQueueDemoDataset(Date.now()) : null;
  const store = new ApprovalQueueStore({ pgPool, seeded, seedData });

  const ticketFacts = seeded
    ? new TicketFacts({ zendesk: demoZendesk(seedData.tickets), subdomain: "demo-account", demo: true })
    : new TicketFacts({ zendesk: realZendesk(), subdomain: process.env.ZENDESK_SUBDOMAIN ?? null });

  const access = portalAccessPosture(process.env, { persistent: Boolean(pgPool) });
  const server = await startApprovalQueueServer({ store, ticketFacts, access }, port);

  console.log(`▶ Approval queue: http://localhost:${port}`);
  console.log(`  Data:    ${dataLine(store)}`);
  console.log(`  Tickets: ${ticketFacts.posture().detail}`);
  console.log(`  Access:  ${accessLine(access)}`);
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

/**
 * The read-only Zendesk client, or null when unconfigured.
 *
 * `tickets:read tickets:write` is the shared client's least-privilege default
 * and it is all this view needs: it reads tickets and never writes one, and it
 * compares a ticket's group_id against the ids already resolved in
 * src/shared/escalationGroupIds.js rather than listing groups, which would need
 * the wider `read` scope.
 */
function realZendesk() {
  const subdomain = process.env.ZENDESK_SUBDOMAIN;
  const clientId = process.env.ZENDESK_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ZENDESK_OAUTH_CLIENT_SECRET;
  if (!subdomain || !clientId || !clientSecret) return null;
  return new ZendeskClient({ subdomain, clientId, clientSecret });
}

function dataLine(store) {
  return store.mode() === "supabase"
    ? "REAL Supabase reads (uc02/uc04/uc05/uc06/uc09 records, uc07/uc08 dossiers, cases + review_queue)."
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
