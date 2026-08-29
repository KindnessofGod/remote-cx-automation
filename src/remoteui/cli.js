// ---------------------------------------------------------------------------
// cli.js  —  `npm run remoteui`
// ---------------------------------------------------------------------------
// Starts the UC-06 Remote UI stand-in: a page where a demo user acts as the
// customer admin inside "Remote's own product" and submits a contract
// amendment request. The REAL UC-06 gates run first (identity -> employment ->
// schema -> cutoff), then a Zendesk ticket is created already pre-tagged with
// the outcome and pre-populated with the drafted summary — mirroring issue
// #17's trigger-source model (00-FOUNDATION.md §2).
//
// Honest wiring, matching how every other surface in this repo treats real
// vs. mock:
//   - Remote API: ALWAYS the mock. UC-06's Remote reads are mock-only in this
//     build (docs/use-cases/UC-06.md §15) — there is no verified Sandbox
//     endpoint for the amendment flow yet.
//   - Zendesk: REAL when credentials are configured (creates actual tickets,
//     like `npm run livedemo`), else a local mock — nothing leaves the
//     machine. The console and the page both say which one is live.
//
// Usage:
//   npm run remoteui                # mock Zendesk unless configured
//   npm run remoteui -- --port 4041
// ---------------------------------------------------------------------------

import { startRemoteUiServer } from "./server.js";
import { REMOTE_UI_EMPLOYEES } from "./employees.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer as startRemoteMock } from "../remote/mockServer.js";
import { ZendeskClient } from "../zendesk/restClient.js";
import { startMockServer as startZendeskMock } from "../zendesk/mockServer.js";
import { AuditLogger } from "../shared/audit.js";
import { AmendmentStore } from "../uc06/amendmentStore.js";
import { config, isZendeskConfigured } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";

// Registry-allocated; see src/shared/ports.js.
const REMOTE_MOCK_PORT = PORTS.REMOTEUI_REMOTE_MOCK;
const ZENDESK_MOCK_PORT = PORTS.REMOTEUI_ZENDESK_MOCK;

async function main() {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.REMOTEUI;

  const remoteMock = await startRemoteMock(REMOTE_MOCK_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_MOCK_PORT}` });

  let zendesk;
  if (isZendeskConfigured()) {
    zendesk = new ZendeskClient({
      subdomain: config.zendesk.subdomain,
      email: config.zendesk.email,
      apiToken: config.zendesk.apiToken,
      clientId: config.zendesk.oauthClientId,
      clientSecret: config.zendesk.oauthClientSecret,
    });
    console.log(`▶ Zendesk: REAL (${config.zendesk.subdomain}.zendesk.com) — submissions create real tickets.`);
  } else {
    await startZendeskMock(ZENDESK_MOCK_PORT);
    zendesk = new ZendeskClient({ baseUrl: `http://localhost:${ZENDESK_MOCK_PORT}`, email: "demo@remoteui.test", apiToken: "demo" });
    console.log(`▶ Zendesk: MOCK (http://localhost:${ZENDESK_MOCK_PORT}) — submissions create mock tickets only.`);
  }

  const employmentIdFieldId = config.zendesk.employmentIdFieldId ?? "360000000002";

  const server = await startRemoteUiServer(
    {
      remote,
      audit: new AuditLogger(),
      amendmentStore: new AmendmentStore(),
      zendesk,
      employees: REMOTE_UI_EMPLOYEES,
      employmentIdFieldId,
    },
    port
  );

  console.log(`▶ UC-06 Remote UI stand-in: http://localhost:${port}`);
  console.log(`  Remote API: MOCK (http://localhost:${REMOTE_MOCK_PORT}) — UC-06's Remote reads are mock-only in this build.`);
  console.log("  This page is a STAND-IN for Remote's own amendment-request surface — it is not Remote's real platform.");
  console.log(`  Demo employees: ${REMOTE_UI_EMPLOYEES.map((e) => `${e.name} (${e.id})`).join(", ")}`);

  const shutdown = () => {
    server.close();
    remoteMock.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
