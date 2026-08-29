// ---------------------------------------------------------------------------
// cli.js  —  `npm run playground`
// ---------------------------------------------------------------------------
// Starts the interactive UC-01 playground: a page at http://localhost:4030
// where a person can play both roles the real system separates —
//
//   the CLIENT   — write a free-text ticket, pick who's "logged in" and whose
//                  record it's about, submit, watch the real workflow decide
//   the SPECIALIST — for any case routed to human_review, approve or decline it
//                  through the exact same reviewPolicy/service.js gates the
//                  ZAF sidebar uses
//
// Always runs against the mock Remote server with in-memory-only stores —
// this is a sandbox for exploring the decision logic, never a path to real
// Supabase or a real Zendesk ticket. Zero credentials needed.
//
// Uses the real classifyRequest(), so if OPENAI_API_KEY is set in .env this
// exercises the actual LLM call; if not, the built-in rule-based fallback
// runs automatically — the same behavior npm run live relies on.
// ---------------------------------------------------------------------------

import { startPlaygroundServer } from "./server.js";
import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { isLlmConfigured } from "../shared/llm.js";
import { PORTS } from "../shared/ports.js";

const MOCK_PORT = PORTS.PLAYGROUND_REMOTE_MOCK; // registry-allocated; see src/shared/ports.js

async function main() {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.PLAYGROUND;

  const mockServer = await startMockServer(MOCK_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${MOCK_PORT}` });
  const audit = new AuditLogger(); // in-memory only — this tool never touches Supabase
  const caseStore = new CaseStore(); // in-memory only — see above

  const server = await startPlaygroundServer({ remote, audit, caseStore }, port);

  console.log(`▶ UC-01 playground: http://localhost:${port}`);
  console.log(
    isLlmConfigured()
      ? "  Classifier: real OpenAI call (OPENAI_API_KEY set) — falls back to rules on any failure."
      : "  Classifier: rule-based (no OPENAI_API_KEY set) — add one to .env to try the real LLM here."
  );
  console.log("  Mock employees: emp_active_001 (Amara Okafor, active) · emp_terminated_002 (Kofi Mensah, terminated)");
  console.log("  Nothing here writes to Supabase or a real Zendesk ticket — it's a local sandbox only.");

  const shutdown = () => {
    server.close();
    mockServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
