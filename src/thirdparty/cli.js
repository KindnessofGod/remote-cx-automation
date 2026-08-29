// ---------------------------------------------------------------------------
// cli.js  —  `npm run thirdparty`
// ---------------------------------------------------------------------------
// Starts the third-party consent door (L-12): the deliberately unauthenticated
// free-text compose box a bank, landlord or screening vendor uses to ask about
// somebody's employment. See server.js's header for the invariant this whole
// file exists to hold (invariant 14, VC-33) and why the response it returns
// is a fixed constant rather than anything computed from the workflow's result.
//
// Always runs against the mock Remote server with in-memory-only stores —
// same sandbox posture as npm run playground. Zero credentials needed.
//
// ZENDESK IS THE ONE EXCEPTION, and it is opt-out rather than opt-in.
// REPORTED 2026-08-28: "I just submitted a request now from the third party
// platform. I open Zendesk, and I didn't see anything there." Two separate
// causes sat behind that, and only the first is a defect:
//
//   1. THIS FILE PASSED NO `zendesk` AT ALL, so the hand-off branch in
//      uc01/workflow.js STEP 8 could never fire — while the DEPLOYED copy
//      (deploy/cx-apis/deps.js) has always passed `zendeskClient()`. The two
//      surfaces disagreed, exactly like the demo-subject id did.
//
//   2. A FIRST-TIME REQUEST CREATES NO TICKET ANYWAY, by design. It decides
//      `awaiting_employee_consent`, which STEP 8 deliberately EXCLUDES — the
//      employee owns that state, not a specialist, and a ticket there would
//      be a hand-off with nothing to hand off. The ticket appears on the
//      FOLLOW-UP, after the employee has granted consent in the portal.
//
// So fixing (1) alone would not have produced a ticket for the reported
// submission. The console now says which of the two happened, because the
// caller is told nothing (VC-33) and the operator running the demo was
// therefore left unable to tell "pending" from "broken".
// ---------------------------------------------------------------------------

import { startThirdPartyDoorServer } from "./server.js";
import { advanceOnConsentGrant } from "../uc01/consentAdvance.js";
import { startMockServer } from "../remote/mockServer.js";
import { RemoteClient } from "../remote/restClient.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { isLlmConfigured } from "../shared/llm.js";
import { config, isZendeskConfigured } from "../shared/config.js";
import { ZendeskClient } from "../zendesk/restClient.js";
import { PORTS } from "../shared/ports.js";

const MOCK_PORT = PORTS.THIRD_PARTY_DOOR_REMOTE_MOCK; // registry-allocated; see src/shared/ports.js

async function main() {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.THIRD_PARTY_DOOR;

  const mockServer = await startMockServer(MOCK_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${MOCK_PORT}` });
  const audit = new AuditLogger(); // in-memory only — this tool never touches Supabase
  const caseStore = new CaseStore(); // in-memory only — see above

  // The quick-fills' example, served by the server rather than baked into the
  // browser file, because THIS copy talks to the mock while the deployed copy
  // reads the live Sandbox — see the GET /api/example comment in server.js.
  // `emp_active_001` is the mock's own active employee, so a quick-fill here
  // reaches a record that actually resolves.
  // The SIX-CHARACTER code, not the fixture id. The field beside it says
  // "6-character code" and enforces minlength=6, so quick-filling
  // `emp_active_001` made the form disagree with its own hint — and with
  // the deployed copy, which has always used a real short id
  // (deploy/cx-apis/deps.js). The mock resolves this via `?short_id=`.
  const demoSubject = { employmentReference: "AO4T9X", subjectName: "Amara Okafor" };

  // `--no-zendesk` keeps the fully offline posture for anyone who wants it.
  // Wired whenever Zendesk is configured, following §9's convention: an
  // optional integration degrades to a safe default when unconfigured rather
  // than failing. Safe to leave on by default because the hand-off ticket
  // carries NO employment-id custom field and no `uc01_test` tag (verified
  // against the payload), and all nine n8n intake triggers require that field
  // to be present — so this can never fire a workflow against a mock id.
  const wantZendesk = !argv.includes("--no-zendesk");
  const zendesk =
    wantZendesk && isZendeskConfigured()
      ? new ZendeskClient({
          subdomain: config.zendesk.subdomain,
          email: config.zendesk.email,
          apiToken: config.zendesk.apiToken,
          clientId: config.zendesk.oauthClientId,
          clientSecret: config.zendesk.oauthClientSecret,
        })
      : null;

  const server = await startThirdPartyDoorServer(
    { remote, audit, caseStore, demoSubject, zendesk },
    port
  );

  // `--auto-consent` — STANDS IN FOR THE EMPLOYEE, and says so out loud.
  //
  // Granting consent lives in the PORTAL (L-13, src/portal/server.js), which on
  // a laptop is a separate process with its own in-memory store, so the door
  // cannot see a grant made there. On the deployment both share one Supabase
  // pool and the real two-surface flow works; locally it cannot. Rather than
  // seed a fabricated grant, this grants the pending row the door itself just
  // created — the same row, through the same method the portal calls, so the
  // decision path being demonstrated is the real one.
  //
  // OFF by default. It is a demo aid, not a policy change: nothing here lets a
  // third party's own claim stand in for consent (that records `asserted` and
  // is still refused — the gate is untouched).
  let consentTimer = null;
  if (argv.includes("--auto-consent")) {
    consentTimer = setInterval(async () => {
      for (const row of caseStore.consentRecords) {
        if (row.status !== "pending") continue;
        // The employment id lives on the CASE, not on the consent row (which
        // has no employment_id column of its own — see findConsentArtifact()'s
        // header), so it is resolved rather than read off `row`.
        const owningCase = caseStore.cases.find((c) => c.id === row.caseId);
        await caseStore.updateConsentDecision(row.id, {
          status: "granted",
          grantedByEmploymentId: owningCase?.employmentId ?? null,
          grantedBySignal: "demo_auto_consent",
        });
        // THE GRANT IS WHAT ADVANCES IT — the same call the portal's consent
        // route makes. Without this the local demo granted and stopped: consent
        // is per-enquiry, so a resubmission is a NEW enquiry needing its own
        // consent, and the enquirer would never get past this state.
        const advanced = await advanceOnConsentGrant({
          caseStore,
          audit,
          remote,
          zendesk,
          consentRecordId: row.id,
        });
        console.log(
          `[thirdparty] --auto-consent: granted ${row.id.slice(0, 8)} on the employee's behalf — ` +
            (advanced.advanced
              ? `advanced to ${advanced.decision}${zendesk ? " and raised the hand-off ticket" : " (no Zendesk client, so no ticket)"}.`
              : `not advanced (${advanced.reason}).`)
        );
      }
    }, 1000);
    consentTimer.unref?.();
  }

  console.log(`▶ Third-party consent door: http://localhost:${port}`);
  console.log(
    isLlmConfigured()
      ? "  Classifier: real OpenAI call (OPENAI_API_KEY set) — falls back to rules on any failure."
      : "  Classifier: rule-based (no OPENAI_API_KEY set) — add one to .env to try the real LLM here."
  );
  console.log("  Mock employees: AO4T9X / emp_active_001 (Amara Okafor, active) · KM8R2D / emp_terminated_002 (Kofi Mensah, terminated)");
  console.log("  Every submission gets the SAME acknowledgement, whatever it finds — see server.js's header (VC-33).");
  console.log(
    zendesk
      ? "  Zendesk: REAL — a hand-off ticket is created once the employee has consented (--no-zendesk to disable).\n" +
        "           A FIRST request creates no ticket: it is awaiting_employee_consent, which the employee owns."
      : "  Zendesk: none — no hand-off ticket will be created. Nothing here writes to Supabase either."
  );
  console.log(
    consentTimer
      ? "  --auto-consent: ON — the employee's grant is simulated locally (the portal owns it for real)."
      : "  --auto-consent: off — a first request stops at awaiting_employee_consent, which is correct. Pass --auto-consent to see the hand-off ticket."
  );

  const shutdown = () => {
    if (consentTimer) clearInterval(consentTimer);
    server.close();
    mockServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await main();
