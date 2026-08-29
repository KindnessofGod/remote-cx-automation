// ---------------------------------------------------------------------------
// liveVerify.js  —  npm run live: one real end-to-end UC-01 run
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `npm test` and `npm run demo` are deliberately hermetic — no real API calls,
// ever (see classifier.js, restClient.js, audit.js, caseStore.js). This script
// is the ONE place allowed to touch real services. It runs the actual UC-01
// workflow once, for real:
//   - classify a ticket with a real OpenAI call (not the rule-based fallback)
//   - fetch a real employment + legal entity from Remote Sandbox
//   - write the resulting audit_log entry AND the operational rows (cases,
//     plus review_queue/documents depending on the decision) to real
//     Supabase tables, then read them all back to confirm they landed
//   - IF Zendesk is configured (optional — Remote/OpenAI/Supabase are not):
//     read a real ticket and write an internal note + tag to it, proving the
//     OAuth client_credentials exchange and the write path both still work.
//     Deliberately a standalone connectivity check, not routed through the
//     main workflow run above — that run uses an auto-discovered Sandbox
//     employment with no matching real Zendesk ticket to tie it to.
// It fails loudly and exits non-zero if any REQUIRED integration doesn't
// work, rather than silently falling back — the whole point is to prove
// they're wired up. Zendesk is skipped (not failed) if unconfigured.
// ---------------------------------------------------------------------------

import { config, isZendeskConfigured } from "./shared/config.js";
import { RemoteClient } from "./remote/restClient.js";
import { AuditLogger } from "./shared/audit.js";
import { CaseStore } from "./shared/caseStore.js";
import { getPgPool, closePgPool } from "./shared/db.js";
import { handleVerificationTicket } from "./uc01/workflow.js";
import { ZendeskClient } from "./zendesk/restClient.js";

function fail(message) {
  console.error(`   ❌ ${message}`);
  return false;
}

const missing = [];
if (!config.openai.apiKey) missing.push("OPENAI_API_KEY");
if (!config.remote.token) missing.push("REMOTE_API_TOKEN");
if (!config.supabase.dbUrl) missing.push("SUPABASE_DB_URL");
if (missing.length > 0) {
  console.error(
    `Missing required .env vars: ${missing.join(", ")}\n` +
      "Copy .env.example to .env and fill them in before running `npm run live`."
  );
  process.exit(1);
}

console.log(
  `=== UC-01 live verification: Sandbox + OpenAI + Supabase${isZendeskConfigured() ? " + Zendesk" : ""} ===`
);

let ok = true;
const remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
const pgPool = getPgPool();
const audit = new AuditLogger(null, { pgPool });
const caseStore = new CaseStore({ pgPool });

// 1. Remote Sandbox — auto-discover a real employment to run the workflow against.
console.log("\n[1/3] Remote Sandbox: listing employments...");
let employmentId;
try {
  const list = await remote.listEmployments({ pageSize: 1 });
  employmentId = list?.employments?.[0]?.id;
  if (!employmentId) throw new Error("Sandbox returned no employments to test against.");
  console.log(`   ok — using employment ${employmentId}`);
} catch (err) {
  ok = fail(`Remote Sandbox check failed: ${err.message}`);
}

// 2. The full UC-01 workflow, once, for real: real OpenAI classification,
//    real Remote reads, deterministic policy gates, letter rendering, and now
//    real cases/review_queue/documents rows alongside the audit_log entry.
//    `classify` is left at its default (the real classifyRequest) since
//    OPENAI_API_KEY is confirmed present above.
let workflowResult;
if (ok) {
  console.log("\n[2/3] Running the full UC-01 workflow (real OpenAI + real Sandbox)...");
  try {
    workflowResult = await handleVerificationTicket(
      {
        text: "Please send me a standard employment verification letter.",
        session: { authenticatedEmploymentId: employmentId },
        employmentId,
        source: "zendesk",
        externalRef: `live-verify-${employmentId}`,
      },
      { remote, audit, caseStore }
    );
    console.log(`   ok — decision: ${workflowResult.decision} (${workflowResult.reason})`);
    if (workflowResult.letterHtml) {
      console.log(`   letter generated (${workflowResult.letterHtml.length} chars, no salary disclosed)`);
    }
  } catch (err) {
    ok = fail(`UC-01 workflow failed: ${err.message}`);
  }
}

// 3. Supabase — confirm EVERY row the workflow just wrote actually landed:
//    audit_log (always), cases (always), and whichever of review_queue /
//    documents applies to this decision.
if (ok) {
  console.log("\n[3/3] Supabase: confirming rows landed...");
  try {
    await Promise.all([audit.flush(), caseStore.flush()]);

    const auditEntry = audit.forUseCase("UC-01")[0];
    const { rows: auditRows } = await pgPool.query("select * from audit_log where id = $1", [auditEntry.id]);
    if (auditRows.length === 0) throw new Error("Row not found in audit_log after flush().");
    console.log(`   ok — audit_log row ${auditRows[0].id} confirmed (action: ${auditRows[0].action})`);

    const caseId = workflowResult.caseId;
    const { rows: caseRows } = await pgPool.query("select * from cases where id = $1", [caseId]);
    if (caseRows.length === 0) throw new Error("Row not found in cases after flush().");
    console.log(`   ok — cases row ${caseRows[0].id} confirmed (status: ${caseRows[0].status})`);

    if (workflowResult.decision === "human_review" || workflowResult.decision === "escalate") {
      const { rows: rqRows } = await pgPool.query("select * from review_queue where case_id = $1", [caseId]);
      if (rqRows.length === 0) throw new Error("Row not found in review_queue after flush().");
      console.log(`   ok — review_queue row ${rqRows[0].id} confirmed (status: ${rqRows[0].status})`);
    }

    if (workflowResult.letterHtml) {
      const { rows: docRows } = await pgPool.query("select * from documents where case_id = $1", [caseId]);
      if (docRows.length === 0) throw new Error("Row not found in documents after flush().");
      console.log(`   ok — documents row ${docRows[0].id} confirmed (type: ${docRows[0].type})`);
    }
  } catch (err) {
    ok = fail(`Supabase check failed: ${err.message}`);
  }
}

// 4. Zendesk (OPTIONAL — skipped, not failed, if unconfigured). Standalone
//    connectivity check: read config.zendesk.liveTestTicketId, write an
//    internal note + a distinctive tag, read it back to confirm it landed.
if (ok && isZendeskConfigured()) {
  console.log(`\n[4/4] Zendesk: verifying ticket ${config.zendesk.liveTestTicketId}...`);
  try {
    const zendesk = new ZendeskClient({
      subdomain: config.zendesk.subdomain,
      email: config.zendesk.email,
      apiToken: config.zendesk.apiToken,
      clientId: config.zendesk.oauthClientId,
      clientSecret: config.zendesk.oauthClientSecret,
    });
    const ticketId = config.zendesk.liveTestTicketId;
    const before = await zendesk.getTicket(ticketId);
    if (!before) throw new Error(`Ticket ${ticketId} not found — set ZENDESK_LIVE_TEST_TICKET_ID to a real ticket id.`);

    const marker = `uc01_live_verify_${Date.now()}`;
    await zendesk.flagForReview(ticketId, {
      note: "[UC-01 live verification] read+write path confirmed by npm run live — safe to ignore.",
      tags: [...before.tags.filter((t) => !t.startsWith("uc01_live_verify_")), marker],
    });

    const after = await zendesk.getTicket(ticketId);
    if (!after.tags.includes(marker)) throw new Error("Write succeeded but the marker tag wasn't found on read-back.");
    console.log(`   ok — ticket ${ticketId} read+write confirmed (tag: ${marker})`);
  } catch (err) {
    ok = fail(`Zendesk check failed: ${err.message}`);
  }
} else if (!isZendeskConfigured()) {
  console.log("\n[Zendesk: skipped — not configured. See .env.example if you want it exercised here too.]");
}

await closePgPool();

console.log(ok ? "\n✅ Live verification passed." : "\n❌ Live verification failed — see above.");
process.exit(ok ? 0 : 1);
