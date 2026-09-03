// ---------------------------------------------------------------------------
// server.js  —  The read-only HTTP API for UC-07's feasibility dossiers
// ---------------------------------------------------------------------------
// WHY THIS IS GET-ONLY, DELIBERATELY
// UC-07 is the 🔴 use case with no execution path (see workflow.js's header).
// That guarantee is only as strong as its weakest link — a write-capable API
// sitting in front of an otherwise pure workflow would BE the execution path
// this project's own prime directive #2 says must not exist. So this file has
// no POST route, no PATCH route, nothing that mutates a dossier. There is
// exactly one thing to do with a UC-07 case in the ZAF sidebar: read it.
// A POST to any path 404s as no_such_route — not by a runtime refusal, but by
// the route simply not existing, exactly like uc08/server.js.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { resolveReader } from "../shared/approverAuth.js";
import { describeRiskPosture } from "../shared/riskEngine.js";
import { describeDossier } from "./dossierView.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";

// UC-07 is never actionable — there is no approve/deny path, ever (see
// server.js's own header and workflow.js's). Stated once, here, rather than
// re-derived by a UI that would otherwise have to guess "does this use case
// ever show buttons?" from the absence of a POST route.
const ACTIONABILITY = {
  // THE 🔴 GUARANTEE, STATED BY THE ONLY THING ENTITLED TO STATE IT.
  // `executionModel: "none"` is what licenses the sidebar to print "no
  // execution path exists — this can only be escalated", and it is a property
  // of UC-07 itself, not of any request. The sidebar used to infer that
  // sentence from a `tier` of "high", which is false for UC-09 (🔴-framed,
  // and it deliberately HAS an execution path behind a floor-of-2 approval)
  // and was being printed over a working Approve button on 🟡 UC-04. See
  // src/shared/riskEngine.js's header.
  ...describeRiskPosture("UC-07", []),
  // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests read
  // it. Nothing new should. Identical to the use-case tier here, since a
  // dossier that is already at the top tier cannot be escalated further.
  tier: "high",
  actionable: false,
  actionableReason: "UC-07 has no execution path — this dossier is for a Mobility Legal Tier-3 specialist's manual review only.",
};

/**
 * @param {object} deps
 * @param {import("./dossierStore.js").DossierStore} deps.dossierStore
 * @param {string} [deps.allowedOrigin]
 * @param {boolean} [deps.requireSignedIdentity]  gate GETs on a signed ZAF
 *   identity, the same flag the deployment applies to writes. Defaults to
 *   false so a credential-free `npm run` clone still reads.
 * @param {{verify: (token: string) => object}|null} [deps.zafVerifier]
 */
export function createUc07Handler({ dossierStore, allowedOrigin = "*", requireSignedIdentity = false, zafVerifier = null }) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    cors(res, allowedOrigin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === "GET" && parts[0] === "healthz") {
      return send(res, 200, { ok: true });
    }

    // READ GATE — the same signed identity a write requires, off the same flag.
    //
    // WHY. This route returns an employment id, the requester's real email
    // address, the decision, its reason and its flags. That was reachable with
    // no credential at all on the public deployment, over sequential integer
    // ticket ids, because the signed-identity mechanism was only ever applied
    // to POST. Authenticating the write and publishing the read protects the
    // audit log's attribution while giving away what the audit log is about.
    //
    // GET ONLY, on purpose: a POST is gated one layer down by resolveApprover(),
    // which is strictly stricter (it must also resolve an approver identity)
    // and would only be run twice for no gain.
    //
    // `healthz` above is deliberately outside this — it carries no customer
    // data and is how an operator establishes the service is alive at all.
    if (req.method === "GET") {
      const readGate = resolveReader({ req, requireSignedIdentity, zafVerifier });
      if (!readGate.ok) {
        return send(res, readGate.status, { ok: false, code: readGate.code, reason: readGate.reason });
      }
    }

    try {
      // GET /api/dossiers — every dossier built, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "dossiers"]) && parts.length === 2) {
        return send(res, 200, { dossiers: await dossierStore.list() });
      }

      // GET /api/dossiers/by-ticket/:externalRef — for the ZAF sidebar, opened
      // in the context of a ticket, not a dossier id. Must come before the
      // generic /:id route below since "by-ticket" would otherwise be read as
      // a dossier id.
      if (req.method === "GET" && isPath(parts, ["api", "dossiers", "by-ticket"]) && parts[3] && parts.length === 4) {
        const dossierRow = await dossierStore.findByExternalRef(parts[3]);
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without the
        // account it was issued by. See src/shared/byTicketAccountGuard.js.
        const foreignAccount = byTicketAccountRefusal(dossierRow, parts[3]);
        if (foreignAccount) return send(res, 404, foreignAccount);
        if (!dossierRow) return send(res, 404, { found: false });
        return send(res, 200, { found: true, dossierRow, ...ACTIONABILITY, ...describeDossier(dossierRow) });
      }

      // GET /api/dossiers/:id
      if (req.method === "GET" && isPath(parts, ["api", "dossiers"]) && parts[2] && parts.length === 3) {
        const dossierRow = await dossierStore.findById(parts[2]);
        if (!dossierRow) return send(res, 404, { found: false });
        return send(res, 200, { found: true, dossierRow, ...ACTIONABILITY, ...describeDossier(dossierRow) });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc07-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

function cors(res, allowedOrigin) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  // Authorization/X-ZAF-Token are allow-listed because the READ gate needs the
  // signed token on a GET; a browser would otherwise fail the preflight.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ZAF-Token");
  res.setHeader("Vary", "Origin");
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the API on `port`. Returns the http.Server once listening. */
export function startUc07Server(deps, port = 4054) {
  const server = createServer(createUc07Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
