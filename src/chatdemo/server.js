// ---------------------------------------------------------------------------
// server.js  —  The UC-01 chat demo's HTTP API
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The playground (src/playground/) shows UC-01 as a form + queue: you write a
// ticket, watch it decide, then approve/decline as the specialist. This is the
// same thing in a different wrapper — a conversational one — where every line
// a demo user types IS a ticket: it is sent straight into
// handleVerificationTicket(), and the real decision is rendered back as the
// reply. No chat-specific decision logic exists anywhere in this file.
//
// It is deliberately a thin router, exactly like src/playground/server.js:
//   - message -> decision:  src/uc01/workflow.js (handleVerificationTicket)
// This file adds no gates. If it did, that would be a second copy of the
// rules the rest of BUILD-LOG.md's gotchas exist to warn against.
//
// In-memory only — the cli never wires a pgPool or a zendesk client, so the
// conversation can never reach real Supabase or a real Zendesk ticket. This
// is a demo/testing aid for exploring the decision logic, not a submission
// deliverable in its own right.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleVerificationTicket } from "../uc01/workflow.js";
import { classifyRequest } from "../uc01/classifier.js";
import { readJsonBody } from "../shared/httpBody.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The shared design system (src/shared/ui/remote-ui.css), served from every
  // browser surface at the same path so the six of them read as one product
  // rather than six. `dir` overrides the default assets/ lookup below.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

/**
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {typeof classifyRequest} [deps.classify] test-only seam — defaults to
 *   the real classifyRequest so production behavior is unaffected; injectable
 *   so tests never depend on whether OPENAI_API_KEY happens to be set in the
 *   environment they run in (see workflow.js's own classify parameter).
 */
/**
 * The fixed (requestingParty, purpose) this demo's "third-party consent on
 * record" checkbox stands for — see src/playground/server.js's identical
 * `DEMO_CONSENT`/`ensureDemoConsentGranted()` for the full reasoning; this
 * server needs its own copy of both because the two never share a caseStore.
 */
export const DEMO_CONSENT = Object.freeze({ requestingParty: "Demo Bank", purpose: "Chat demo demonstration" });

// PER-ENQUIRY CONSENT (2026-08-28). A granted consent now authorises only the
// enquiry it was given for, so this seed has to name the enquiry it is standing
// in for — a seed with no `doorReference` matches nothing and the demo's
// "consent on record" checkbox silently stops working.
async function ensureDemoConsentGranted(caseStore, employmentId, enquiryReference = null) {
  const existing = await caseStore.findConsentArtifact({
    employmentId,
    requestingParty: DEMO_CONSENT.requestingParty,
    purpose: DEMO_CONSENT.purpose,
    enquiryReference,
  });
  if (existing) return;
  const seedCase = caseStore.createCase({
    source: "consent_seed_internal",
    useCase: "UC-01",
    employmentId,
    ...(enquiryReference ? { classification: { doorReference: String(enquiryReference) } } : {}),
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "granted",
    source: "chatdemo_demo",
    requestingParty: DEMO_CONSENT.requestingParty,
    purpose: DEMO_CONSENT.purpose,
    grantedByEmploymentId: employmentId,
    grantedBySignal: "chatdemo_demo",
    grantedAt: new Date().toISOString(),
  });
}

export function createChatDemoHandler({ remote, audit, caseStore, classify = classifyRequest }) {
  let nextRef = 1;

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && ASSETS[url.pathname]) {
        const asset = ASSETS[url.pathname];
        const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
        res.statusCode = 200;
        res.setHeader("Content-Type", asset.type);
        return res.end(body);
      }

      // POST /api/messages  — "the demo user just sent this line"
      if (req.method === "POST" && isPath(parts, ["api", "messages"]) && parts.length === 2) {
        const body = await readJsonBody(req);
        const externalRef = `chatdemo-${nextRef++}`;
        const ticket = {
          source: "zendesk",
          externalRef,
          text: typeof body.text === "string" ? body.text : "",
          hasAttachment: Boolean(body.hasAttachment),
          employmentId: body.employmentId,
          // THE SESSION MUST MATCH THE CHANNEL IT CLAIMS TO ARRIVE ON.
          //
          // This used to mint `{ authenticatedEmploymentId }` on a ticket
          // declaring `source: "zendesk"` — an impossible combination, and
          // DRIFT-118's exact shape one layer up: a Zendesk ticket carries no
          // Remote session, which is why the live n8n path derives identity
          // from the ticket's Zendesk-authenticated requester instead. The demo
          // was therefore exercising a code path production cannot reach.
          //
          // Now the demo picks the signal that goes with the channel, and
          // `asRemoteSession: true` opts into the logged-in-Remote path — which
          // since G-2 is the DEFLECTION, and is worth demonstrating in its own
          // right: it is the outcome an eligible employee actually gets.
          session: await demoSession(remote, body),
          // G-3/L-8: see ensureDemoConsentGranted()'s comment above — the old
          // `consentOnRecord` boolean is retired in favour of a real artifact.
          ...(body.consentOnRecord
            ? { requestingParty: DEMO_CONSENT.requestingParty, purpose: DEMO_CONSENT.purpose }
            : {}),
        };
        if (body.consentOnRecord && ticket.employmentId) {
          await ensureDemoConsentGranted(caseStore, ticket.employmentId, externalRef);
        }
        // One chat line in, one real ticket through the real handler. The
        // response the page renders is exactly what handleVerificationTicket
        // returns — nothing is added, translated or re-decided here.
        const result = await handleVerificationTicket(ticket, { remote, audit, caseStore, classify });
        return send(res, 200, { ...result, externalRef });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[chatdemo] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the chat demo on `port`. Returns the http.Server once listening. */
export function startChatDemoServer(deps, port = 4046) {
  const server = createServer(createChatDemoHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/**
 * Build the authenticated signal that matches the channel this demo claims.
 *
 * `asRemoteSession: true` -> a Remote login (the G-2 deflection path).
 * `asEmploymentId` alone   -> the Zendesk-authenticated requester, read from the
 *   employment record so the demo matches what a real ticket carries. Reading it
 *   here rather than accepting an email from the request body is deliberate: an
 *   address supplied by the caller is a CLAIM, and the one rule this identity
 *   model has is that it never takes one.
 */
async function demoSession(remote, body) {
  if (!body.asEmploymentId) return null;
  if (body.asRemoteSession === true) {
    return { authenticatedEmploymentId: body.asEmploymentId };
  }
  const employment = await remote.getEmployment(body.asEmploymentId).catch(() => null);
  const email = employment?.email ?? null;
  return email ? { authenticatedEmail: String(email).trim().toLowerCase() } : null;
}
