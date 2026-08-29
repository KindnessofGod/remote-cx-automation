// ---------------------------------------------------------------------------
// server.js  —  The interactive UC-01 playground's HTTP API
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Every other way to see UC-01 run is either narrated to a terminal
// (npm run demo / npm run scenarios) or requires a real Zendesk ticket
// (zaf-app/). This is neither: a single local page where a person can type a
// ticket as if they were the client, watch the real workflow decide, then
// switch hats and act as the specialist who approves or denies it — with the
// audit trail updating live underneath.
//
// It is deliberately a thin router. Every decision it makes was already made
// somewhere else:
//   - ticket -> decision:      src/uc01/workflow.js (handleVerificationTicket)
//   - "can this be actioned?": src/review/reviewPolicy.js (evaluateCaseActionability)
//   - approve/decline:         src/review/service.js (submitReviewDecision)
// This file adds no new gates. If it did, that would be a second copy of the
// rules the rest of BUILD-LOG.md's gotchas exist to warn against.
//
// Same node:http, no-framework shape as the other local servers in this repo.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleVerificationTicket } from "../uc01/workflow.js";
import { classifyRequest } from "../uc01/classifier.js";
import { getReviewView, submitReviewDecision } from "../review/service.js";
import { InMemoryReviewStore } from "../review/store.js";
import { evaluateCaseActionability } from "../review/reviewPolicy.js";
import { classifyRisk } from "../shared/riskEngine.js";
import { readJsonBody } from "../shared/httpBody.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The fixed (requestingParty, purpose) this demo's "third-party consent on
 * record" checkbox stands for. Fixed rather than user-typed because this
 * checkbox is demonstrating the GRANTED state, not the full third-party door
 * (that is `src/thirdparty/`, L-12) — a single named scenario is enough to
 * show `human_review`/`third_party_request` is still reachable with consent.
 */
const DEMO_CONSENT = Object.freeze({ requestingParty: "Demo Bank", purpose: "Playground demonstration" });

/**
 * Writes a GRANTED, COMPLETE consent_records artifact for this employment if
 * one does not already exist for DEMO_CONSENT's party+purpose — idempotent,
 * so checking the box twice for the same employee does not pile up rows.
 * The seed case it hangs off carries no review_queue entry, so it never
 * appears in `GET /api/cases` below (scoped by `caseStore.cases`, not by
 * review_queue — see the comment there for why that is still safe).
 */
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
    // A distinct, never-real `source` so `GET /api/cases` below can filter
    // this out of the visible queue — it exists purely as the consent
    // artifact's FK target and must persist for the life of this process
    // (every later ticket's consent lookup re-joins through it), unlike a
    // one-shot test seed that can simply be removed once its lookup has run.
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
    source: "playground_demo",
    requestingParty: DEMO_CONSENT.requestingParty,
    purpose: DEMO_CONSENT.purpose,
    grantedByEmploymentId: employmentId,
    grantedBySignal: "playground_demo",
    grantedAt: new Date().toISOString(),
  });
}

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
 * Stands in for a real LLM's independent confidence signal — the same
 * technique src/uc01/scenarios.js uses for §12.6, and for the same reason:
 * the rule-based classifier's confidence and intent heuristics come from the
 * same text signal, so "standard-looking but low-confidence" cannot occur
 * from rules alone. Only reached when the caller explicitly opts in.
 */
function simulatedLowConfidenceClassify({ hasAttachment = false } = {}) {
  return Promise.resolve({
    intent: "standard_letter",
    hasAttachment,
    hasExternalUrl: false,
    requesterType: "self",
    confidence: 0.6,
    // Explicitly answered: the over-scope gate now fails closed on an absent
    // requestedFields (F-17) and would otherwise short-circuit this toggle
    // before the confidence gate it exists to demonstrate.
    requestedFields: [],
  });
}

/**
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {typeof classifyRequest} [deps.classify]  override for tests — defaults
 *   to the real classifyRequest() so production is unaffected (the "simulate
 *   low confidence" toggle still overrides it per-request); injectable so a
 *   test never makes a real, retried LLM call just because OPENAI_API_KEY
 *   happens to be set in its environment.
 */
export function createPlaygroundHandler({ remote, audit, caseStore, classify = classifyRequest }) {
  const store = new InMemoryReviewStore(caseStore);
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

      // POST /api/tickets  — "send this ticket in as the client"
      if (req.method === "POST" && isPath(parts, ["api", "tickets"]) && parts.length === 2) {
        const body = await readJsonBody(req);
        const externalRef = `playground-${nextRef++}`;
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
          // G-3/L-8: the old `consentOnRecord` boolean is retired — the
          // checkbox now stands for "the employee has already granted this",
          // demonstrated by ensuring a real, readable GRANTED consent_records
          // artifact exists (VC-07: a boolean is not evidence) rather than by
          // passing a flag the workflow no longer reads. See
          // `ensureDemoConsentGranted()` below.
          ...(body.consentOnRecord
            ? { requestingParty: DEMO_CONSENT.requestingParty, purpose: DEMO_CONSENT.purpose }
            : {}),
        };
        if (body.consentOnRecord && ticket.employmentId) {
          await ensureDemoConsentGranted(caseStore, ticket.employmentId, externalRef);
        }
        const classifyFn = body.simulateLowConfidence ? simulatedLowConfidenceClassify : classify;
        const result = await handleVerificationTicket(ticket, { remote, audit, caseStore, classify: classifyFn });
        return send(res, 200, { ...result, externalRef });
      }

      // GET /api/cases  — the queue, newest first
      if (req.method === "GET" && isPath(parts, ["api", "cases"]) && parts.length === 2) {
        const rows = caseStore.cases
          // Never a real ticket's outcome — see ensureDemoConsentGranted()'s
          // own comment for why this one row has to persist in `caseStore.
          // cases` without ever being a visible queue entry.
          .filter((c) => c.source !== "consent_seed_internal")
          .map((c) => {
            const review = caseStore.reviewQueue.filter((r) => r.caseId === c.id).slice(-1)[0] ?? null;
            const { tier } = classifyRisk(c.useCase, c.flags ?? []);
            const actionability = evaluateCaseActionability({ caseRow: c, reviewRow: review });
            return {
              externalRef: c.externalRef,
              employmentId: c.employmentId,
              requester: c.requester,
              decision: c.decision,
              reason: c.reason,
              status: c.status,
              tier,
              reviewStatus: review ? review.status : null,
              actionable: actionability.allowed,
              createdAt: c.createdAt,
            };
          })
          .reverse();
        return send(res, 200, { cases: rows });
      }

      // GET /api/cases/:externalRef  — full detail, same shape the ZAF sidebar reads
      if (req.method === "GET" && isPath(parts, ["api", "cases"]) && parts.length === 3) {
        const view = await getReviewView({ ticketId: parts[2] }, { store });
        return send(res, view.found ? 200 : 404, view);
      }

      // POST /api/cases/:externalRef/approve|decline — "act as the specialist"
      //   `/deny` still works: evaluateReviewAction() canonicalises it.
      if (req.method === "POST" && isPath(parts, ["api", "cases"]) && parts.length === 4) {
        const body = await readJsonBody(req);
        const result = await submitReviewDecision(
          { ticketId: parts[2], action: parts[3], approver: body.approver || null, note: body.note || "" },
          { store, caseStore, audit, remote, zendesk: null }
        );
        return send(res, result.status, result);
      }

      // GET /api/audit  — the immutable trail, newest first
      //
      // TWO KINDS OF RECORD LIVE IN ONE ARRAY, and this route used to hand
      // both back as if they were the same thing.
      //
      // `AuditLogger.entries` holds DECISION rows (from log()/logDurable(),
      // carrying useCase/action/actor/riskTier/details) and TRACE steps (from
      // logTraceStep(), carrying call/attempt/ok/parentId and none of those
      // fields) — the two levels of invariant 7. The page renders a table whose
      // columns are the decision row's fields, so every trace step became a row
      // with an empty use case, an empty action, an empty actor and a details
      // cell reading `{}`. One UC-01 ticket produces three of them, so the
      // "Audit log — immutable, append-only" panel was three-quarters blank
      // rows, which reads as data loss in the one artifact whose whole job is
      // to be trustworthy.
      //
      // Splitting them here rather than filtering in the page keeps the rule
      // that the server decides and the page renders, and it lets the trace be
      // shown as what it is — the attempts BEHIND a decision — instead of being
      // thrown away. A trace step is identified by the field that defines it
      // (`call`), never by the absence of another field: a decision row that
      // one day lacks an actor must not silently become a trace step.
      if (req.method === "GET" && isPath(parts, ["api", "audit"])) {
        const all = [...audit.entries];
        const isTrace = (e) => typeof e.call === "string" && typeof e.attempt === "number";
        const traces = all.filter(isTrace);
        const entries = all.filter((e) => !isTrace(e));

        // Attempts hang under the decision row they were bound to. A trace
        // whose parent is still unbound (the decision row has not been written
        // yet) is reported under `unboundTraceCount` rather than dropped —
        // silently discarding an attempt would defeat the point of recording it.
        const byParent = new Map();
        let unbound = 0;
        for (const t of traces) {
          if (!t.parentId) { unbound += 1; continue; }
          if (!byParent.has(t.parentId)) byParent.set(t.parentId, []);
          byParent.get(t.parentId).push({ call: t.call, attempt: t.attempt, ok: t.ok, error: t.error });
        }
        return send(res, 200, {
          entries: entries.reverse().map((e) => ({ ...e, traceSteps: byParent.get(e.id) ?? [] })),
          unboundTraceCount: unbound,
        });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[playground] ${req.method} ${url.pathname} failed: ${err.stack}`);
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

/** Start the playground on `port`. Returns the http.Server once listening. */
export function startPlaygroundServer(deps, port = 4030) {
  const server = createServer(createPlaygroundHandler(deps));
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
