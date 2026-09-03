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
import { createWorkAuthorizationStandin } from "./workAuthStandin.js";
import { portalAccessPosture, createPortalThrottleStore } from "../portal/access.js";
import { getPgPool } from "../shared/db.js";
import { AuthorizationStore } from "../uc04/authorizationStore.js";

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

  // --- the WORK-AUTHORIZATION surface's Remote client ------------------------
  // A separate seam from UC-06's, because the two are genuinely in different
  // positions on the substitution ladder. UC-06's amendment reads are mock-only
  // in this build; `GET /v1/work-authorization-requests` is a real, published
  // endpoint that answers 200 — rung 2 — so it is asked for real whenever a
  // token is configured. Whichever client this is, it serves BOTH the
  // company-boundary employment reads and the request list/PATCH: scoping in
  // one world and acting in another is the defect src/shared/remoteWorld.js
  // exists to close.
  //
  // THE DEFAULT IS THE MOCK, AND IT USED NOT TO BE. This read
  // `remoteMode !== "mock" && Boolean(config.remote.token)`, so merely HAVING a
  // REMOTE_API_TOKEN in .env silently pointed this surface at the real Sandbox
  // — whose employments all sit at a company none of the demo sessions speaks
  // for. Every one of the eleven candidates came back `inCompany: false`, the
  // scope resolved to nobody, Remote was asked about nothing, and the page
  // rendered an empty list. The boundary "passed" for a reason that had nothing
  // to do with anyone's company, including Lars's, and the probe read as
  // "Remote holds none" when the truth was "we asked about none".
  //
  // So the Sandbox is opt-IN (`--remote sandbox`) rather than opt-out. Pair it
  // with REMOTEUI_ADMIN_COMPANY_ID when you do, or the console will speak for a
  // company that does not exist there — which the page will now say out loud
  // rather than show as an empty queue.
  const remoteMode = argv.indexOf("--remote") !== -1 ? argv[argv.indexOf("--remote") + 1] : null;
  const useSandbox = remoteMode === "sandbox";
  const workAuthRemote = useSandbox
    ? new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token })
    : remote;

  // The shared-key posture, computed the same way `npm run portal` computes it.
  // No durable pool here, and no VERCEL, so a fresh clone runs open — the same
  // fail-open-locally / fail-closed-in-public rule, decided in one file.
  // THE POOL, RESOLVED ONCE. Null when SUPABASE_DB_URL is unset, which keeps a
  // fresh clone running entirely in memory exactly as before — the stores below
  // each treat a null pool as "in-memory only".
  const pgPool = getPgPool();

  const access = portalAccessPosture(process.env, { persistent: false });

  const server = await startRemoteUiServer(
    {
      remote,
      // POOLED WHEN A DATABASE IS CONFIGURED, and this is the difference between
      // the demo working and the demo looking broken (2026-08-31). Stage 2 reads
      // the work-authorization requests the PORTAL filed, and the portal runs in
      // a different process — so with an in-memory store this screen shows an
      // empty queue no matter how many requests were just submitted, which is
      // indistinguishable from "nothing is pending". Same two lines
      // src/uc04/cli.js and src/portal/cli.js already use.
      audit: new AuditLogger(null, { pgPool }),
      amendmentStore: new AmendmentStore({ pgPool }),
      authorizationStore: new AuthorizationStore({ pgPool }),
      zendesk,
      employees: REMOTE_UI_EMPLOYEES,
      employmentIdFieldId,
      remoteWorkAuth: workAuthRemote,
      workAuthStandin: createWorkAuthorizationStandin(),
      // From this process's environment, never from a request.
      adminCompanyId: process.env.REMOTEUI_ADMIN_COMPANY_ID || undefined,
      access,
      throttleStore: createPortalThrottleStore(null),
    },
    port
  );

  console.log(`▶ UC-06 Remote UI stand-in: http://localhost:${port}`);
  console.log(`▶ UC-04 employer work-authorization decision: http://localhost:${port}/work-authorizations`);
  console.log(`  Remote API (UC-06): MOCK (http://localhost:${REMOTE_MOCK_PORT}) — UC-06's Remote reads are mock-only in this build.`);
  const adminCompany = process.env.REMOTEUI_ADMIN_COMPANY_ID || "co_amend_01";
  console.log(
    `  Remote API (work authorizations): ${useSandbox ? `REAL (${config.remote.baseUrl})` : `MOCK (http://localhost:${REMOTE_MOCK_PORT})`} — ` +
      "the list endpoint is real and is asked on every load; requests it cannot supply come from the marked stand-in."
  );
  console.log(`  This console speaks for company: ${adminCompany} (REMOTEUI_ADMIN_COMPANY_ID to change it).`);
  if (useSandbox && adminCompany === "co_amend_01") {
    console.log(
      "  ⚠ Pointed at the real Sandbox while speaking for co_amend_01, which is this repo's MOCK company. No " +
        "employment there will match, so the queue will be empty — set REMOTEUI_ADMIN_COMPANY_ID to the Sandbox's " +
        "own company id. The page reports this state rather than showing an empty queue as if nothing were pending."
    );
  }
  console.log("  This page is a STAND-IN for Remote's own amendment-request surface — it is not Remote's real platform.");
  console.log(`  Access key: ${access.required ? (access.keyConfigured ? "REQUIRED and configured" : "REQUIRED but NOT configured — every /api call will refuse") : "not required in this posture"}`);
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
