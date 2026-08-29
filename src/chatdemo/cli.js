// ---------------------------------------------------------------------------
// cli.js  —  `npm run chatdemo`
// ---------------------------------------------------------------------------
// Starts the UC-01 chat demo: a page at http://localhost:4046 where a demo
// user types a message and gets the REAL UC-01 decision back as the reply.
// Each chat line is a ticket: the backend builds a ticket from the message +
// the identity context chosen below, calls handleVerificationTicket() on it
// directly, and renders the actual result — no chat-specific decision logic
// anywhere. Same architecture as src/playground/, different wrapper.
//
// Always runs against the mock Remote server with in-memory-only stores —
// this is a sandbox for exploring the decision logic, never a path to real
// Supabase or a real Zendesk ticket. Zero credentials needed.
//
// Uses the real classifyRequest(), so if OPENAI_API_KEY is set in .env this
// exercises the actual LLM call; if not, the built-in rule-based fallback
// runs automatically — the same behavior npm run live relies on.
// ---------------------------------------------------------------------------

import { startChatDemoServer } from "./server.js";
import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { isLlmConfigured } from "../shared/llm.js";
import { PORTS } from "../shared/ports.js";

const MOCK_PORT = PORTS.CHATDEMO_REMOTE_MOCK; // registry-allocated; see src/shared/ports.js

async function main() {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.CHATDEMO;

  const mockServer = await startMockServer(MOCK_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${MOCK_PORT}` });
  const audit = new AuditLogger(); // in-memory only — this tool never touches Supabase
  const caseStore = new CaseStore(); // in-memory only — see above

  const server = await startChatDemoServer({ remote, audit, caseStore }, port);

  console.log(`▶ UC-01 chat demo: http://localhost:${port}`);
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
