// ---------------------------------------------------------------------------
// scenarios.js  —  runs every UC-01 §12 scenario, fully offline. npm run scenarios
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// docs/use-cases/UC-01.md §12 lists 8 test-plan scenarios (§12.5 covers two
// outcomes, so 9 runs total). test/uc01.test.js already asserts these as unit
// tests; this script is for a human to SEE them — one clearly labeled block
// per scenario, run against the mock Remote server with in-memory-only audit
// and case stores (no pgPool) and the rule-based classifier (no OpenAI key
// needed) — free and repeatable, unlike `npm run live`.
//
// Scenario 6 ("non-English / ambiguous request -> low confidence -> review")
// is a special case: the offline rule-based classifier (classifier.js) can
// never actually produce "standard_letter intent + low confidence" together
// — whenever its confidence would be low, its intent is simultaneously
// "non_standard", which policyEngine.js already routes to human_review one
// gate earlier (see policyEngine.js's ordering). That's correct behavior, but
// it means the low_confidence gate is only reachable via a real LLM's
// independent confidence signal. To still demonstrate it here, this scenario
// injects a `classify` override that returns a fixed low-confidence
// classification — clearly labeled as simulated below, not a real LLM call.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { handleVerificationTicket } from "./workflow.js";
import { classifyRequestRuleBased } from "./classifier.js";
import { PORTS } from "../shared/ports.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LETTER_OUT_PATH = join(__dirname, "..", "..", "demo", "letter.html");

const sessionFor = (id) => ({ authenticatedEmploymentId: id });

/**
 * Stands in for a real LLM's independent confidence signal on an ambiguous
 * request — see the file header. Not a network call; a fixed local function.
 */
function simulatedLowConfidenceClassify({ hasAttachment = false } = {}) {
  return Promise.resolve({
    intent: "standard_letter",
    hasAttachment,
    hasExternalUrl: false,
    requesterType: "self",
    confidence: 0.6, // below policyEngine.js's 0.85 threshold
  });
}

const SCENARIOS = [
  {
    name: "1. Active employee, standard request",
    spec: "§12.1 — auto-resolve, correct letter",
    ticket: {
      text: "Please send me a standard employment verification letter.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: "zendesk_1001",
    },
    saveLetter: true,
  },
  {
    name: "2. Terminated employee",
    spec: "§12.2 — exception, no letter",
    ticket: {
      text: "I need a standard employment letter.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: "zendesk_1002",
    },
  },
  {
    name: "3. Uploaded bank form",
    spec: "§12.3 — human review with AI summary",
    ticket: {
      text: "My bank sent this form, please complete it.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      hasAttachment: true,
      externalRef: "zendesk_1003",
    },
  },
  {
    name: "4. External verification portal URL",
    spec: "§12.4 — human review",
    ticket: {
      text: "Here is the link to my lender's portal: https://verify.example.com/xyz",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: "zendesk_1004",
    },
  },
  {
    name: "5a. Third-party verification, nobody has answered yet (G-3)",
    spec: "§12.5 (no consent) — awaiting_employee_consent: a PENDING state, not a refusal (VC-06)",
    ticket: {
      text: "This is First Bank, we need to verify employment directly.",
      session: null,
      employmentId: "emp_active_001",
      requestingParty: "First Bank",
      purpose: "Mortgage application",
      externalRef: "zendesk_1005a",
    },
  },
  {
    name: "5b. Third-party verification, WITH a GRANTED consent artifact (G-3/VC-07)",
    spec: "§12.5 (with consent) — proceeds, but still human review (never zero-touch)",
    // L-8 replaced the old `consentOnRecord: true` boolean with a real lookup
    // against `consent_records`. To demonstrate the GRANTED path here, `seed`
    // below writes a granted, complete row into this scenario's own fresh
    // CaseStore before the ticket runs — the same round trip VC-07 requires
    // (a readable row, not an asserted boolean), just performed ahead of time
    // rather than via a second run.
    seed(caseStore) {
      const seedCase = caseStore.createCase({
        useCase: "UC-01",
        employmentId: "emp_active_001",
        decision: "awaiting_employee_consent",
        status: "awaiting_consent",
      });
      caseStore.createConsentRecord({
        caseId: seedCase.id,
        consentType: "third_party_verification",
        status: "granted",
        source: "scenario_seed",
        requestingParty: "First Bank",
        purpose: "Mortgage application",
        grantedByEmploymentId: "emp_active_001",
        grantedBySignal: "scenario_seed",
        grantedAt: new Date().toISOString(),
      });
    },
    ticket: {
      text: "This is First Bank, please verify employment on behalf of the employee.",
      session: null,
      employmentId: "emp_active_001",
      requestingParty: "First Bank",
      purpose: "Mortgage application",
      externalRef: "zendesk_1005b",
    },
  },
  {
    name: "6. Non-English / ambiguous request",
    spec: "§12.6 — low confidence -> review (SIMULATED classification; see file header)",
    ticket: {
      text: "Necesito una carta de verificación de empleo, no estoy segura del formato exacto.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: "zendesk_1006",
    },
    classify: simulatedLowConfidenceClassify,
  },
  {
    name: "7. Over-scope field request (asks for salary)",
    spec: "§12.7 — disclosure gate: requests for non-standard fields route to human review",
    ticket: {
      text: "Please send a standard employment verification letter, and can you also confirm my salary on it?",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: "zendesk_1007",
    },
  },
  {
    name: "8. Out-of-scope request",
    spec: "§12.8 — out-of-scope / gibberish requests are refused before a case is created",
    ticket: {
      text: "What's the weather like today?",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: "zendesk_1008",
    },
  },
];

const DECISION_LABEL = {
  auto_resolve: "✅ auto_resolve",
  human_review: "🔎 human_review",
  escalate: "🚨 escalate",
  out_of_scope: "🚫 out_of_scope",
};

function printScenario(scenario, result, caseStore) {
  const bar = "─".repeat(70);
  // BY `result.caseId`, NOT `caseStore.cases[0]`. A scenario's `seed()` hook
  // (5b) may write an earlier case into this same fresh store purely to hang
  // a consent artifact off — `cases[0]` would then print the SEED case's
  // status rather than the one THIS ticket actually produced.
  const caseRow = result.caseId ? caseStore.cases.find((c) => c.id === result.caseId) : null;
  const reviewEntry = caseRow ? caseStore.reviewQueue.find((r) => r.caseId === caseRow.id) : null;
  const documentRow = caseRow ? caseStore.documents.find((d) => d.caseId === caseRow.id) : null;

  console.log(`\n${bar}`);
  console.log(`▶ ${scenario.name}`);
  console.log(`  ${scenario.spec}`);
  console.log(bar);
  console.log(`  decision       ${DECISION_LABEL[result.decision] ?? result.decision}`);
  console.log(`  reason         ${result.reason}`);
  console.log(`  flags          ${result.flags.length ? result.flags.join(", ") : "(none)"}`);
  console.log(`  case status    ${caseRow ? `${caseRow.status}  (case ${caseRow.id})` : "no case created"}`);
  console.log(`  review_queue   ${reviewEntry ? `yes — status: ${reviewEntry.status}` : "no"}`);
  console.log(
    `  document       ${documentRow ? `yes — ${documentRow.type} (${documentRow.content.length} chars, hash ${documentRow.contentHash.slice(0, 12)}…)` : "no"}`
  );
}

async function main() {
  const server = await startMockServer(PORTS.SCENARIOS_MOCK); // registry-allocated; see src/shared/ports.js
  const remote = new RemoteClient({ baseUrl: `http://localhost:${PORTS.SCENARIOS_MOCK}` });

  console.log("=== UC-01 scenarios: every case from docs/use-cases/UC-01.md §12 (offline, mock only) ===");

  let auto = 0,
    review = 0,
    escalated = 0,
    refused = 0;

  for (const scenario of SCENARIOS) {
    // Fresh, in-memory-only stores per scenario — no pgPool, no cross-scenario bleed.
    const audit = new AuditLogger();
    const caseStore = new CaseStore();
    const classify = scenario.classify ?? classifyRequestRuleBased;
    if (typeof scenario.seed === "function") scenario.seed(caseStore);

    const result = await handleVerificationTicket(scenario.ticket, { remote, audit, caseStore, classify });
    printScenario(scenario, result, caseStore);

    if (result.decision === "auto_resolve") auto++;
    else if (result.decision === "human_review") review++;
    else if (result.decision === "out_of_scope") refused++;
    else escalated++;

    if (scenario.saveLetter && result.letterHtml) {
      mkdirSync(dirname(LETTER_OUT_PATH), { recursive: true });
      writeFileSync(LETTER_OUT_PATH, result.letterHtml);
      console.log(`  📄 letter written to ${LETTER_OUT_PATH}`);
    }
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(
    `Summary: ${SCENARIOS.length} scenarios — ${auto} auto_resolve, ${review} human_review, ${escalated} escalate, ${refused} refused.`
  );
  console.log("All stores were in-memory only — nothing was written to Supabase.");

  server.close();
}

await main();
