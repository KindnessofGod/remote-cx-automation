// ---------------------------------------------------------------------------
// server.js  —  The HTTP API the ZAF sidebar talks to
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A ZAF v2 app is static HTML/JS running in an iframe inside Zendesk. It cannot
// reach Postgres, and it must never hold a Remote or Supabase credential — the
// bundle is downloadable by anyone with an agent seat. So the sidebar renders
// and clicks; this service holds every credential and every gate.
//
// Deliberately the same shape as the two mock servers (node:http, no framework)
// so the repo stays clonable and runnable with `npm install` alone.
//
// ---------------------------------------------------------------------------
// HONEST SECURITY STATUS — READ THIS BEFORE PUTTING IT ON THE INTERNET
// ---------------------------------------------------------------------------
// By DEFAULT (requireSignedIdentity: false), the approver identity arrives in
// the `X-ZAF-Approver` header, set by the sidebar from ZAF's `currentUser` —
// and THIS SERVICE TRUSTS IT. That is fine for a local demo and NOT fine in
// production, because anyone who can reach the endpoint can name themselves
// as the approver.
//
// The production fix — docs/BUILD-LOG.md §5 item 11 — IS NOW BUILT:
// `requireSignedIdentity: true` (see ZAF_REQUIRE_SIGNED_IDENTITY in
// .env.example) makes this handler verify a signed JWT — sent by the sidebar as
// `Authorization: Bearer <token>`, and also accepted in `X-ZAF-Token` — via
// `zafVerifier`, and use ONLY the verified claim as the approver. The
// X-ZAF-Approver header is never consulted in this mode, so a valid signature
// can never be paired with a spoofed name. If `requireSignedIdentity` is on
// but no `zafVerifier` was supplied, every state-changing call is refused —
// this deliberately cannot silently degrade back to trusting the header.
//
// WHICH SIGNATURE. zaf-app/ is a CLIENT-SIDE app, so the token it sends is
// ZAF's own HS256 JWT, signed with the shared secret held as a secure app
// setting (ZAF_SHARED_SECRET here, `cxSharedSecret` there). zafAuth.js's header
// has the full account, including why the RS256 path beside it is a different
// mechanism for a different app type and cannot verify these tokens.
//
// This is written down rather than quietly shipped because an unauthenticated
// approve endpoint that writes to audit_log would make the audit log's
// attribution field worthless — which is worse than having no endpoint.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { getReviewView, submitReviewDecision, submitManualSendRecord } from "./service.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeEmployee } from "../shared/employeeSubject.js";
import { describeDecisionFacts } from "../uc01/policyEngine.js";
import { approvalMayDisclose } from "../uc01/disclosureFields.js";
import { remoteFor } from "../shared/remoteWorld.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";

/**
 * Build the request handler. Everything it needs is injected, so tests drive
 * the real handler against mocks without a process or a port.
 *
 * @param {object} deps
 * @param {import("./store.js").PostgresReviewStore|import("./store.js").InMemoryReviewStore} deps.store
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../zendesk/restClient.js").ZendeskClient|null} [deps.zendesk]
 * @param {string} [deps.allowedOrigin]  CORS origin; see the note in cors() below
 * @param {boolean} [deps.requireSignedIdentity]  refuse unsigned identity claims
 * @param {{verify: (token: string) => object}|null} [deps.zafVerifier]
 *   required when requireSignedIdentity is true — see zafAuth.js. Injected
 *   (never constructed in here) so tests can supply a verifier bound to a
 *   locally generated test keypair without any network access.
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST — see K10
 *   (qa/HUMAN-DECISIONS-REQUIRED.md, 2026-08-23).
 */
export function createReviewHandler({
  store,
  caseStore,
  audit,
  remote,
  zendesk = null,
  allowedOrigin = "*",
  requireSignedIdentity = false,
  zafVerifier = null,
  entitlement = null,
}) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    cors(res, allowedOrigin);

    // ZAF iframes are served from a Zendesk-controlled origin, so every real
    // call is cross-origin and preflighted.
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
      // GET /api/review/tickets — every case with a review_queue row, newest
      // first (UC-01's HITL queue). Must come before /api/review/ticket/:id
      // below since that's a prefix match on "ticket" (singular) — "tickets"
      // (plural) is a different, more specific segment and is checked first.
      if (req.method === "GET" && isPath(parts, ["api", "review", "tickets"]) && parts.length === 3) {
        return send(res, 200, { tickets: await store.list() });
      }

      // GET /api/review/ticket/:ticketId
      if (req.method === "GET" && isPath(parts, ["api", "review", "ticket"]) && parts[3]) {
        const view = await getReviewView({ ticketId: parts[3] }, { store });
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without
        // the account it was issued by. Checked against the CASE ROW's own
        // createdAt, which getReviewView carries through untouched.
        // See src/shared/byTicketAccountGuard.js.
        const foreignAccount = view.found ? byTicketAccountRefusal(view.case, parts[3]) : null;
        if (foreignAccount) return send(res, 404, foreignAccount);
        // WHO IS THIS ABOUT — the specialist's first question (L-17, VC-17,
        // DRIFT-042).
        //
        // UC-01's sidebar answered it with an employment id. Six of the nine
        // servers already publish the subject through this one module; UC-01,
        // the flagship and the only use case that actually runs live, was one
        // of the three that did not — so the one human who ever sees a 🟢 use
        // case, holding its hardest case, got `emp_active_001` where a name
        // belongs and had to go and look the person up.
        //
        // `describeEmployee` is used rather than a local read for the reason
        // the module exists: an absent field renders as a NAMED ABSENCE, never
        // a blank. A blank is indistinguishable from a value that is genuinely
        // empty, and on a screen where somebody is deciding what may be
        // disclosed about a named person, "we did not look" and "there is
        // nothing there" are different facts.
        //
        // Attached OUTSIDE getReviewView() on purpose: that function takes a
        // store and nothing else, and giving it a Remote client would put a
        // network read inside a pure store query that four other callers use.
        //
        // E3-F12 / rca-wif — WITHHELD ON `identity_not_verified`, BY OWNER
        // RULING (2026-08-22), OPTION (a). Ticket #99: the case's own verdict
        // was "we could not establish who the requester is", and the internal
        // note correctly says nothing about the subject — but this same route
        // was still resolving and sending the person's name, job title,
        // status, contract type and country. The note and the sidebar
        // disagreed about the same case, and the note was the one that was
        // right.
        //
        // The withholding happens HERE, not in the browser: `view.employee`
        // is simply never set, so the fact never leaves this process. A
        // client-side fix (skipping a field the panel was still sent) would
        // still have shipped the data to an iframe running in the browser of
        // whoever opened the ticket.
        //
        // Scoped to the reason, not the use case: `identity_not_verified` is a
        // rung several use cases' sequences can reach (see describeDecision()
        // in service.js), and every one of them shares the same fact — an
        // unauthenticated caller quoting someone else's employment id proves
        // nothing about that person, so nothing about them is disclosed on
        // this screen. Every other reason is unaffected: a verified requester
        // (e.g. #98/#102's human_review cases) still sees the subject block.
        //
        // rca-h457 (round-7 R7-25) — READ THE SAME WORLD THE DECISION WAS MADE
        // IN. A portal-originated case (`case.source === "portal"`) was DECIDED
        // against the in-process mock (deploy/cx-apis/deps.js's
        // buildPortalHandler() always hands the portal a mock RemoteClient, by
        // design — CLAUDE.md's rung 3/4 substitution ladder), using a mock
        // fixture employment id. Looking that same id up against the real
        // Sandbox 404s it every time — not because the person doesn't exist,
        // but because this deployment asked the wrong world. `remoteFor()` is
        // the exact function the four approval paths already use for this
        // reason (src/shared/remoteWorld.js): it answers "which client belongs
        // to this record?" off the record's own persisted `source` column, and
        // is a no-op (returns `remote` unchanged) for every non-portal case and
        // for a plain RemoteClient with no `forSource`.
        if (view.found && view.case?.reason !== "identity_not_verified") {
          view.employee = await describeEmployee({
            remote: remoteFor(remote, view.case?.source),
            employmentId: view.case?.employmentId ?? null,
            fields: ["full_name", "job_title", "status", "contract_type", "country_code"],
          });
        }

        // WHAT AN APPROVAL WOULD ACTUALLY RELEASE — with the real values.
        //
        // Owner decision 2026-08-28, and it is a reversal of rca-iih7 / D-16.
        // Approving an over-scope request used to issue the same salary-free
        // standard letter, so the sidebar deliberately carried field NAMES and
        // never values: there was nothing to weigh. An approval now issues
        // Remote's customized letter, which states what was asked for — so a
        // specialist who cannot see the figure is not deciding, they are
        // signing. `src/uc01/disclosureFields.js` holds the whole argument.
        //
        // ATTACHED HERE, NOT IN getReviewView(), for exactly the reason the
        // employee block above is: that function takes a store and nothing
        // else, and its four other callers must not acquire a network read.
        // `describeDecision()` in service.js builds this reason's facts from
        // the `cases` row alone and therefore CANNOT carry values — it emits a
        // named absence saying the record was not read, and this replaces that
        // bundle with the one built from a live record.
        //
        // Same `remoteFor()` world-selection as above: a portal-originated
        // case was decided against the in-process mock, and looking its
        // fixture id up against the real Sandbox 404s every time.
        //
        // FAILS TO THE NAMED ABSENCE, never to a blank or a guess. If the read
        // throws, `view.decisionFacts` keeps the bundle service.js already
        // built, which says in words that the record was not read here — so a
        // specialist is never shown an empty value that reads as "the record
        // holds nothing".
        if (view.found && approvalMayDisclose(view.case?.reason) && view.case?.employmentId) {
          try {
            const employment = await remoteFor(remote, view.case?.source).getEmployment(view.case.employmentId);
            if (employment) {
              view.decisionFacts = describeDecisionFacts({
                reason: view.case.reason,
                classification: view.case.classification,
                employment,
                // THE ONLY CALLER IN THE REPOSITORY THAT PASSES THIS. See
                // describeDecisionFacts()'s own comment: the same bundle is
                // written into the ticket's internal note, so the values are
                // opt-in and this route — the sidebar's own, seen only by the
                // person being asked to authorise the release — is the one
                // place entitled to opt in.
                includeDisclosureValues: true,
              });
            }
          } catch (err) {
            console.error(`[review] could not read employment for disclosure values on ${parts[3]}: ${err.message}`);
          }
        }

        // D-11 (rca-kfg2) — MAKE "CONSENT RECORD: <id>" OPENABLE.
        //
        // `describeDecisionFacts()` in policyEngine.js prints a "Consent
        // record: <id> — open it to see who granted it, to whom and for what
        // purpose" fact for third_party_request/awaiting_employee_consent/
        // consent_refused, and that fact reaches a real Zendesk internal note
        // (src/uc01/workflow.js). But service.js's getReviewView() deliberately
        // never computes decisionFacts for these three reasons at all — they
        // need `identity`, which a `cases` row does not carry (see
        // CLASSIFICATION_ONLY_FACT_REASONS's own comment) — so the id landed on
        // a real ticket with nothing in the app frame that could resolve it: not
        // the sidebar's own facts panel, and not a Zendesk search, which finds
        // only the ticket that printed it. Invariant 13 requires an artifact
        // "that can be produced afterwards"; an id with nothing behind it
        // satisfies neither that nor §16 item 11's "readable".
        //
        // Resolved with the SAME lookup workflow.js used to make the original
        // decision (STEP 2c, findConsentArtifact scoped by employment id +
        // requesting party + purpose) rather than a case-id join — a GRANTED
        // consent record's `case_id` points at whichever ticket first captured
        // the pending ask, which is very often an EARLIER ticket than the one
        // now citing it (ticket #114 quotes a consent granted against a prior
        // request), so a lookup scoped to THIS case's id would silently find
        // nothing on exactly the case that most needs it. `requestingParty`/
        // `purpose` survive on `classification` for this exact reason (E4-F17).
        const CONSENT_VISIBLE_REASONS = ["third_party_request", "awaiting_employee_consent", "consent_refused"];
        if (
          view.found &&
          view.case?.source === "third_party_door" &&
          CONSENT_VISIBLE_REASONS.includes(view.case?.reason) &&
          typeof caseStore.findConsentArtifact === "function"
        ) {
          const cls = view.case.classification || {};
          const record = await caseStore.findConsentArtifact({
            employmentId: view.case.employmentId,
            requestingParty: cls.requestingParty ?? null,
            purpose: cls.purpose ?? null,
          });
          view.consentRecord = record ? describeConsentRecordForSpecialist(record) : null;
        }
        return send(res, view.found ? 200 : 404, view);
      }

      // POST /api/review/ticket/:ticketId/manual-send — D-12 (rca-kfg2).
      // Checked BEFORE the generic approve/decline route below, which would
      // otherwise treat "manual-send" as an unrecognised `action` value.
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "review", "ticket"]) &&
        parts[3] &&
        parts[4] === "manual-send"
      ) {
        const body = await readJsonBody(req);
        const identity = resolveApprover({ req, body, requireSignedIdentity, zafVerifier });
        if (!identity.ok) {
          return send(res, identity.status, { ok: false, code: identity.code, reason: identity.reason });
        }
        const result = await submitManualSendRecord(
          { ticketId: parts[3], status: body.status, approver: identity.approver, note: body.note ?? "" },
          { store, caseStore, audit, zendesk }
        );
        return send(res, result.status, result);
      }

      // POST /api/review/ticket/:ticketId/approve | /decline
      //   `/deny` is STILL ROUTED as the legacy spelling: the segment is not
      //   whitelisted here, and evaluateReviewAction() canonicalises it, so the
      //   installed ZAF bundle keeps working until it is re-uploaded.
      if (req.method === "POST" && isPath(parts, ["api", "review", "ticket"]) && parts[3] && parts[4]) {
        const action = parts[4];

        const body = await readJsonBody(req);
        // The identity rule now lives in shared/approverAuth.js, used
        // identically by uc04/uc05/uc06/uc09 (finding F-20) — those endpoints
        // had no signed path at all, and rather than write the logic four more
        // times it moved to one module. Behaviour here is unchanged: signed
        // mode consults ONLY the verified claim, unsigned mode reads the
        // (untrusted) header then the body.
        const identity = resolveApprover({ req, body, requireSignedIdentity, zafVerifier });
        if (!identity.ok) {
          return send(res, identity.status, { ok: false, code: identity.code, reason: identity.reason });
        }

        const result = await submitReviewDecision(
          { ticketId: parts[3], action, approver: identity.approver, note: body.note ?? "" },
          { store, caseStore, audit, remote, zendesk, entitlement }
        );
        return send(res, result.status, result);
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      // The sidebar shows this string to an agent, so it must say something
      // actionable rather than "something went wrong".
      console.error(`[review-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * D-11 (rca-kfg2) — one `consent_records` row, shaped for the SPECIALIST
 * deciding whether an outside party may be told about someone else's
 * employment (as distinct from `consentRequestView()` in src/portal/server.js,
 * shaped for the EMPLOYEE deciding their own). The specialist's question is
 * exactly the one the note promises an answer to: who granted it, to whom,
 * and for what purpose — so this carries `grantedByEmploymentId`/`grantedAt`,
 * which the employee-facing view never needs to (an employee already knows
 * whether and when they decided).
 */
function describeConsentRecordForSpecialist(record) {
  return {
    id: record.id,
    status: record.status,
    requestingParty: record.requestingParty,
    purpose: record.purpose,
    grantedByEmploymentId: record.grantedByEmploymentId,
    grantedAt: record.grantedAt,
    createdAt: record.createdAt,
    // D-28 (rca-87ee) — what the requesting party attached when they asserted
    // they already hold the employee's written authorisation (status
    // "asserted"; src/thirdparty/server.js's evidence route). Not consent
    // itself — the employee still has to decide — but "nowhere to put it"
    // was the finding, and a specialist reading this record needs to see
    // what was submitted, not just that something was.
    evidenceReference: record.evidenceReference ?? null,
  };
}

/**
 * CORS for the ZAF iframe. Defaults to "*" for local development, which is
 * acceptable only because every state-changing route is gated by reviewPolicy
 * and (in production) by the signed-identity check above — CORS is not an
 * authorization mechanism. A real deployment should pin this to the account's
 * `https://<subdomain>.zendesk.com` via ZAF_ALLOWED_ORIGIN.
 */
function cors(res, allowedOrigin) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ZAF-Approver, X-ZAF-Token");
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

/** Start the API on `port`. Returns the http.Server once it is listening. */
export function startReviewServer(deps, port = 4020) {
  const server = createServer(createReviewHandler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
