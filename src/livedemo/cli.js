// ---------------------------------------------------------------------------
// cli.js  —  `npm run livedemo`
// ---------------------------------------------------------------------------
// Starts the live demo: a page where a person acts as the CLIENT, picks a
// real Remote Sandbox employee, and submits a request. That creates a REAL
// ticket in your real Zendesk account, tagged exactly the way the live
// Zendesk trigger (see scripts/setup-zendesk-trigger.mjs /
// fix-zendesk-trigger-condition.mjs) expects, so the already-live n8n
// workflow picks it up and processes it completely automatically — classify,
// fetch the real employment, run the identity + policy gates, and either
// reply + resolve or flag for a human, exactly as it would for any other
// ticket. This page then polls the same real ticket and shows what happened.
//
// Unlike every other command in this repo, this ALWAYS touches your real
// Zendesk account — there is no mock fallback, because the entire point is
// to prove the live path works. Requires real Zendesk credentials in .env
// (see .env.example); refuses to start without them.
// ---------------------------------------------------------------------------

import { startLiveDemoServer } from "./server.js";
import { ZendeskClient } from "../zendesk/restClient.js";
import { config, isZendeskConfigured } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";
import { KNOWN_EMPLOYEES } from "./employees.js";

async function main() {
  if (!isZendeskConfigured()) {
    console.error(
      "Missing Zendesk credentials in .env (ZENDESK_SUBDOMAIN + ZENDESK_OAUTH_CLIENT_ID/SECRET).\n" +
        "This tool only exists to touch the real account — there is no mock fallback. See .env.example."
    );
    process.exit(1);
  }
  if (!config.zendesk.employmentIdFieldId) {
    console.error("Missing ZENDESK_EMPLOYMENT_ID_FIELD_ID in .env — see .env.example.");
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.LIVEDEMO;

  const zendesk = new ZendeskClient({
    subdomain: config.zendesk.subdomain,
    email: config.zendesk.email,
    apiToken: config.zendesk.apiToken,
    clientId: config.zendesk.oauthClientId,
    clientSecret: config.zendesk.oauthClientSecret,
    // ONE scope beyond the client's least-privilege default, for one reason:
    // findUserIdByEmail() attributes the first comment to the CUSTOMER rather
    // than to this API account (see server.js). `users:read` is additive and
    // read-only — it is NOT `read`, which would hand this demo surface
    // account-wide read for the sake of one lookup, exactly the widening
    // restClient.js's scope comment argues against. Ticket writes stay on the
    // same two ticket scopes the workflows use.
    scope: "tickets:read tickets:write users:read",
  });

  const server = await startLiveDemoServer(
    { zendesk, employmentIdFieldId: config.zendesk.employmentIdFieldId, employees: KNOWN_EMPLOYEES },
    port
  );

  console.log(`▶ UC-01 live demo: http://localhost:${port}`);
  console.log(`  Every submission creates a REAL ticket in ${config.zendesk.subdomain}.zendesk.com.`);
  console.log(`  Known Sandbox employees: ${KNOWN_EMPLOYEES.map((e) => e.name).join(", ")}`);
  console.log("  Add more in src/livedemo/employees.js — see that file's header comment.");

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
