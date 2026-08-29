// ---------------------------------------------------------------------------
// demo.js  —  See UC-01 run, without any test framework.  Run:  npm run demo
// ---------------------------------------------------------------------------
import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { handleVerificationTicket } from "./workflow.js";
import { classifyRequestRuleBased } from "./classifier.js";
import { PORTS } from "../shared/ports.js";

const server = await startMockServer(PORTS.DEMO_MOCK); // registry-allocated; see src/shared/ports.js
const remote = new RemoteClient({ baseUrl: `http://localhost:${PORTS.DEMO_MOCK}` });
// Write audit entries to ./audit.log (JSON-lines) so you can open and read them.
// In production this same logger writes to a Postgres/Supabase table instead.
const audit = new AuditLogger("./audit.log");
// In-memory only (no pgPool) — same reasoning as the audit log above.
const caseStore = new CaseStore();

const tickets = [
  { label: "Logged-in employee, standard request",
    text: "Please send a standard employment verification letter.",
    session: { authenticatedEmploymentId: "emp_active_001" }, employmentId: "emp_active_001" },
  { label: "Logged-in but terminated employee",
    text: "I need a standard employment letter.",
    session: { authenticatedEmploymentId: "emp_terminated_002" }, employmentId: "emp_terminated_002" },
  { label: "Logged-in user requesting someone else's letter",
    text: "Standard employment letter please.",
    session: { authenticatedEmploymentId: "emp_active_001" }, employmentId: "emp_terminated_002" },
  { label: "Bank asks to verify directly (no session, no consent)",
    text: "This is First Bank, verify employment directly.",
    session: null, employmentId: "emp_active_001" },
];

for (const t of tickets) {
  // Force the rule-based classifier: this demo stays free/offline/deterministic
  // even if this machine's .env has a real OPENAI_API_KEY (that path is only
  // exercised by `npm run live`).
  const r = await handleVerificationTicket(t, { remote, audit, caseStore, classify: classifyRequestRuleBased });
  console.log(`\n▶ ${t.label}`);
  console.log(`   decision: ${r.decision}  (${r.reason})`);
  if (r.flags.length) console.log(`   flags:    ${r.flags.join(", ")}`);
  if (r.letterHtml) console.log(`   letter:   generated (${r.letterHtml.length} chars, no salary disclosed)`);
}

console.log(`\n📋 Audit log captured ${audit.forUseCase("UC-01").length} entries.`);
console.log(
  `📁 Case store: ${caseStore.cases.length} cases, ${caseStore.reviewQueue.length} review_queue entries, ${caseStore.documents.length} documents.`
);
server.close();
