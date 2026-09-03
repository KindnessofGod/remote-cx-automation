// ---------------------------------------------------------------------------
// server.js  —  The Remote UI stand-in's HTTP API (issue #30)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-06's real trigger is a customer admin acting inside Remote's own product
// to request a contract amendment. Remote has no public API that produces a
// "contract amendment request" event (that's the whole reason UC-06's
// Zendesk intake exists in the first place), so nothing in this repo could
// demonstrate the amendment flow from its TRUE starting point. This page
// stands in for that product surface: an admin submits a structured
// amendment request the way Remote's own UI would send it.
//
// It follows issue #17's trigger-source model exactly (00-FOUNDATION.md §2's
// Remote-native webhook path): UC-06's REAL identity verification, policy/
// cutoff gates, and fact-gathering run FIRST against the webhook-shaped
// event, and only once that has produced an outcome is a Zendesk ticket
// created — already pre-tagged with the decision and pre-populated with the
// drafted summary/amendment id — to host the shared ZAF sidebar. Never the
// other way around: no gate ever runs against a half-written ticket, and no
// ticket exists for a request the gates rejected.
//
// It is a thin router over the real pieces, nothing is re-implemented:
//   - gates + amendment row + audit:  src/uc06/workflow.js (handleAmendmentRequest)
//   - "is this open to approval?":    src/uc06/dualApprovalPolicy.js (evaluateAmendmentActionability)
//   - ticket creation:                src/zendesk/restClient.js (ZendeskClient.createTicket)
// The only logic this file owns is the Remote-native event shape and which
// tags the outcome gets — presentation, not policy.
//
// Honest labeling: the page says plainly it is a STAND-IN for a Remote
// Sandbox limitation, not Remote's real platform (same framing as
// src/livedemo/ for Zendesk). Submissions are role-gated server-side (issue
// #34): employee, employer, and company-admin each have their own
// authenticated session and their own permitted actions (src/remoteui/roles.js),
// and a submission attempting an action outside its role is refused — identity
// comes from an authenticated signal, here the stand-in product's own session,
// never a claim in the request body (CLAUDE.md prime directive #3).
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleAmendmentRequest } from "../uc06/workflow.js";
import { evaluateAmendmentActionability } from "../uc06/dualApprovalPolicy.js";
import { fromRemoteInteger } from "../shared/money.js";
import { draftSummary } from "../uc06/changeParser.js";
import { judgeNarrative } from "../shared/narrativeJudge.js";
import { classifyRisk } from "../shared/riskEngine.js";
import {
  canRoleSubmit,
  evaluateConsentAuthorization,
  evaluateAmendmentVisibility,
  ROLES,
  SUBMIT_ACTION,
  CONSENT_ACTION,
} from "./roles.js";
// The requester-facing translation of an amendment row, and UC-06's own
// settled-decision sentence. describeSettled() is IMPORTED rather than
// paraphrased for the reason its own header gives: it names which outcome,
// both signatures, the note, and whether the write to Remote landed — the last
// of which no paraphrase keeps, and it is the one that decides whether the
// contract actually changed. REFUSALS travels with it because its generic
// "executed or declined" fallback is the one sentence this surface must not
// print (see the route below).
import { describeAmendmentStatus, STATES as AMENDMENT_STATES } from "./amendmentStatus.js";
import { describeSettled, REFUSALS as DUAL_APPROVAL_REFUSALS } from "../uc06/dualApprovalPolicy.js";
import { describeAmendmentBasis } from "../uc06/decisionFacts.js";
import { recordTicketRelink } from "../portal/server.js";
import { NO_AMENDMENT_FORM_EMPLOYMENTS } from "./employees.js";
import { readJsonBody } from "../shared/httpBody.js";
import { stripHtmlComments, stripJsComments } from "../shared/stripBuildComments.js";
// The shared-key gate, reused whole from the request portal rather than
// re-derived. `npm run remoteui` and the deployment must apply ONE rule; a copy
// of it here would be a second one to keep in step, and the surface this page
// grew — an employer deciding a real work authorization — is exactly the kind
// that must not be reachable by an anonymous caller on the open internet.
// Defaults to OPEN_ACCESS so a fresh clone still runs `npm run remoteui` with
// no configuration at all. See src/portal/access.js's header for what a shared
// key does and does not prove.
import { checkPortalAccessThrottled, OPEN_ACCESS } from "../portal/access.js";
import {
  CURRENT_STAGE,
  DECIDABLE_STATUS,
  DECIDE_WORK_AUTHORIZATION_ACTION,
  EMPLOYER_ACTIONS,
  EMPLOYER_VERBS,
  REMOTE_ONLY_STATUSES,
  STAGES,
  STAGE_3_NOTE,
  buildDecisionPayload,
  evaluateEmployerDecision,
} from "./workAuthPolicy.js";
import { resolveEmployerScope, workAuthorizationRoster } from "./workAuthScope.js";
import { STANDIN_HEADER, createWorkAuthorizationStandin, isStandinId } from "./workAuthStandin.js";
import { RECORD_HEADER, RECORD_ORIGIN, toWorkAuthorizationShape } from "./workAuthRecords.js";
import { AuthorizationStore } from "../uc04/authorizationStore.js";
import { handoffFor } from "../shared/escalationRouting.js";
// The one place the intake tag is spelled. See UC04_AWAITING_EMPLOYER_TAG.
import { UC04_AWAITING_EMPLOYER_TAG } from "../portal/ticketing.js";
import { describeAssignment, resolveGroupAssignment } from "../shared/groupAssignment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  // The employer's work-authorization queue — Remote's stage 2. A SEPARATE
  // page rather than a fourth tab on the amendment screen: Remote's own product
  // keeps request types on their own screens, and an amendment and a travel
  // authorization share no field, no gate and no approver role.
  "/work-authorizations": { file: "workauth.html", type: "text/html; charset=utf-8" },
  "/workauth.js": { file: "workauth.js", type: "application/javascript; charset=utf-8" },
  // The shared design system (src/shared/ui/remote-ui.css), served from every
  // browser surface at the same path so the six of them stay one product
  // rather than six. `dir` overrides the default assets/ lookup below.
  "/remote-ui.css": {
    file: "remote-ui.css",
    dir: join(__dirname, "..", "shared", "ui"),
    type: "text/css; charset=utf-8",
  },
};

// The identities the stand-in product believes are logged in, one per role
// (issue #34). A real Remote webhook/product session would be the
// authenticated user's; here the demo page picks who is logged in and sends
// the chosen session key as the `X-RemoteUi-Session` header — a server-owned
// identifier, never a claim in the request body (a POST that names its own
// role proves nothing). The admin session keeps the legacy
// `{authenticatedAdminId}` field name because that is what
// handleAmendmentRequest() reads as the amendment's requester. The employee
// session carries its own employmentId because an employee may only consent
// to amendments of THEIR OWN contract.
/**
 * The company this admin console speaks for, by default.
 *
 * `co_amend_01` is the company every employment in this repo's mock Remote
 * belongs to except one (Lars van der Berg, deliberately at `co_northwind_02`),
 * so on the mock the boundary genuinely admits ten people and genuinely refuses
 * him. Pointed at a Remote whose employments belong to somebody else — the real
 * Sandbox, whose company is a UUID — it matches nobody, and the surface now
 * SAYS so instead of rendering an empty list that reads like "nothing pending".
 *
 * Overridable per process by whoever starts it (`REMOTEUI_ADMIN_COMPANY_ID`),
 * which is how the same code demonstrates against either world. It is still
 * server-owned in the sense that matters: it is read from the environment of
 * the process, never from a request, and no header, body or query parameter can
 * reach it.
 */
export const DEFAULT_ADMIN_COMPANY_ID = "co_amend_01";

const DEMO_SESSIONS = {
  // `approverName` is the display name Remote's `employer_approver` block wants
  // (`{id, name, email}`). No email is invented for it: an address nobody gave
  // us, written into a record and read back as though Remote had supplied it,
  // is exactly the fabrication the substitution ladder forbids. Null is the
  // honest value and the record carries it.
  admin: {
    role: ROLES.company_admin,
    companyId: DEFAULT_ADMIN_COMPANY_ID,
    authenticatedAdminId: "admin_jane",
    // A WHOLE PERSON, NOT A SESSION ID (2026-08-31). This was
    // `approverName: "Jane Doe (company admin)"`, and downstream the ZAF
    // sidebar rendered "Approved by admin_jane" — which the project owner
    // reasonably objected to: a Remote specialist reviewing this cannot tell
    // WHO approved it, what standing they had to approve it, or WHICH of
    // Remote's client companies they belong to. Remote has many clients; a bare
    // session id identifies none of them, and "admin_jane" reads like somebody
    // at Remote when the whole point of stage 2 is that the decision is the
    // CUSTOMER'S.
    //
    // A NAMED, MARKED FIXTURE — rung 4 of the substitution ladder (CLAUDE.md
    // §3). No company name exists anywhere in the Remote Sandbox record: an
    // employment carries `company_id` and `legal_entity_id` and no human name
    // for either, so there is no higher rung to take this from. It is therefore
    // fabricated on purpose and self-identifies as the signed-in demo session,
    // which is what rung 4 requires. `approverCompany` is the EMPLOYER — the
    // Remote client this employee works for — never Remote itself.
    approverName: "Jane Okonkwo",
    approverTitle: "Head of People Operations",
    approverCompany: "Meridian Analytics",
  },
  employer: { role: ROLES.employer, companyId: "co_amend_01", authenticatedId: "company_owner" },
  // The signed-in employee is the Dutch one ON PURPOSE. This used to be
  // emp_active_001, a Nigerian employment whose amendments can never be
  // schema-validated (see employees.js), so the demo's own chain —
  // admin requests -> employee consents -> employer consents -> the sidebar's
  // dual approval — had an employee who could only ever consent to something
  // that had already escalated. Consent is not a gate, so nothing was WRONG;
  // it just meant the three roles could never be walked through end to end on
  // one amendment, which is the only thing this page exists to show.
  employee: { role: ROLES.employee, companyId: "co_amend_01", authenticatedId: "emp_nl_amend_001", employmentId: "emp_nl_amend_001" },
};

/**
 * The `source` every amendment filed through this page carries. Exported so
 * deploy/cx-apis/deps.js can key the execution world on it rather than on a
 * second spelling of this string: a stand-in row is decided against the
 * in-process mock, and every later read and write about it — the sidebar's
 * employee card, the freshness re-check, the amendment itself — must happen in
 * that same world, or the panel reports the employee missing two cards above a
 * live Approve button (2026-09-02, ten of ten live cases).
 */
export const REMOTE_UI_SOURCE = "remoteui";

const SESSION_HEADER = "x-remoteui-session";

// Own-property lookup only (finding F-21's pattern). The session key is an
// attacker-controlled header: `X-RemoteUi-Session: constructor` used to
// resolve to `Object` through the prototype chain — a truthy "session" with
// no role, which is precisely the shape the role gate then has to reason
// about. An unknown key must be null, and null fails closed downstream.
function resolveSession(req, { adminCompanyId = DEFAULT_ADMIN_COMPANY_ID } = {}) {
  const key = req.headers[SESSION_HEADER];
  if (typeof key !== "string" || !Object.hasOwn(DEMO_SESSIONS, key)) return null;
  const session = DEMO_SESSIONS[key];
  // The override applies to every session that carries a company, not just the
  // admin's: one console speaks for one company, and two sessions disagreeing
  // about which is the two-worlds defect this exists to close, rotated.
  if (adminCompanyId && adminCompanyId !== DEFAULT_ADMIN_COMPANY_ID && session.companyId) {
    return { ...session, companyId: adminCompanyId };
  }
  return session;
}

// Outcome tags, modeled on UC-01's scheme (marker tag + one outcome tag per
// decision). A future UC-06 Zendesk trigger would key off these the way the
// live UC-01 trigger keys off `uc01_*`.
export const MARKER_TAG = "uc06_amendment";
export const OUTCOME_TAGS = {
  dual_approval_required: "uc06_dual_approval_required",
  escalate: "uc06_escalated",
};

/**
 * The states that mean A HUMAN HAS FINISHED WITH IT — the flag the page uses
 * to decide whether an amendment's outcome gets the prominent treatment.
 * Decided here rather than in the browser, for the same reason every other
 * string on that page is: the page renders what it is given.
 *
 * `applying` is deliberately absent. Both approvals are in and the PUT is in
 * flight, which is not the same as a contract having changed, and it is the
 * one rounding that cannot be walked back once the requester has read it.
 */
export const SETTLED_STATES = new Set([AMENDMENT_STATES.EXECUTED, AMENDMENT_STATES.DECLINED]);

export function outcomeTags(decision) {
  return [MARKER_TAG, OUTCOME_TAGS[decision] ?? decision];
}

/**
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../uc06/amendmentStore.js").AmendmentStore} deps.amendmentStore
 * @param {import("../zendesk/restClient.js").ZendeskClient} deps.zendesk
 * @param {Array<{id:string,name:string,email:string,companyId:string}>} deps.employees
 *   known demo employees the admin may submit for
 * @param {string} deps.employmentIdFieldId  Zendesk custom-field id carrying the Remote employment id
 * @param {typeof draftSummary} [deps.draftSummary]  override for tests — defaults
 *   to the real draftSummary() so production is unaffected; injectable so a test
 *   never makes a real, retried LLM call just because OPENAI_API_KEY happens to
 *   be set in its environment (see #31/#32 for why this matters here specifically).
 * @param {typeof judgeNarrative} [deps.judge]  same reasoning as draftSummary above.
 * @param {object} [deps.remoteWorkAuth]  the Remote client the WORK-AUTHORIZATION
 *   surface reads and writes in. Defaults to `remote`. It is a separate seam
 *   because the two surfaces can legitimately live in different worlds: UC-06's
 *   amendment reads are mock-only in this build, while work-authorization reads
 *   are a real, published, 200-answering Sandbox endpoint. Whatever client is
 *   passed is used for BOTH halves of that surface — the company-boundary
 *   employment reads and the request list/PATCH — because scoping in one world
 *   and acting in another is the defect src/shared/remoteWorld.js exists to
 *   close.
 * @param {object} [deps.workAuthStandin]  the rung-3 store (./workAuthStandin.js)
 * @param {import("../uc04/authorizationStore.js").AuthorizationStore} [deps.authorizationStore]
 *   UC-04's own store — the work-authorization requests really filed on this
 *   system's intake surfaces (the portal, the UC-03 continuation, Zendesk/n8n).
 *   Without it this screen shows Remote's requests and the stand-in's and NOT
 *   the one the customer just filed, which is the defect this dependency exists
 *   to close.
 *
 *   DEFAULTED FROM THE AUDIT LOGGER'S POOL, deliberately. Durability is the
 *   whole point — `uc04_authorizations` is Supabase-backed on the deployment
 *   (one function, one pool) while an in-memory store is empty in the next
 *   serverless invocation — and `audit` is the only dependency this factory
 *   already receives that carries the pool. Every caller that gives this surface
 *   a durable audit log therefore gets a durable record store with no wiring
 *   change; a caller with neither keeps an in-memory store and a hermetic test.
 *   An explicit store always wins, and deploy/cx-apis/deps.js should pass one.
 * @param {Array<{employmentId: string, name: string}>} [deps.workAuthRoster]
 * @param {string} [deps.adminCompanyId]  which company this console speaks for.
 *   From the process's environment, never from a request — see
 *   DEFAULT_ADMIN_COMPANY_ID.
 * @param {object} [deps.access]  shared-key posture from src/portal/access.js
 * @param {object} [deps.throttleStore]  brute-force counter for the key gate
 * @param {string} [deps.basePath]  mount prefix on the deployment ("/remoteui")
 */
export function createRemoteUiHandler({
  remote,
  audit,
  amendmentStore,
  zendesk,
  employees,
  employmentIdFieldId,
  draftSummary: draftSummaryFn = draftSummary,
  judge = judgeNarrative,
  remoteWorkAuth = null,
  workAuthStandin = createWorkAuthorizationStandin(),
  authorizationStore = null,
  workAuthRoster = workAuthorizationRoster(),
  adminCompanyId = DEFAULT_ADMIN_COMPANY_ID,
  access = OPEN_ACCESS,
  throttleStore = null,
  basePath = "",
}) {
  const workAuthRemote = remoteWorkAuth ?? remote;
  // See the JSDoc above for why the pool is taken off the audit logger. Built
  // ONCE per handler rather than per request: the store's own `flush()` awaits
  // writes it started, and a fresh store every request would await nothing.
  const uc04Store = authorizationStore ?? new AuthorizationStore({ pgPool: audit?.pgPool ?? null });
  const prefix = String(basePath || "").replace(/\/+$/, "");

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (req.method === "GET" && ASSETS[url.pathname]) {
        const asset = ASSETS[url.pathname];
        const body = readFileSync(join(asset.dir ?? join(__dirname, "assets"), asset.file));
        res.statusCode = 200;
        res.setHeader("Content-Type", asset.type);
        // COMMENTS ARE STRIPPED AT SERVE TIME, and a mounted page gets a
        // <base>. Both for the reasons src/portal/server.js gives: these pages
        // are public (only the /api routes below the gate need the key), so
        // anything in the bundle is readable via view-source, and internal issue
        // ids and src/ paths are not for a stranger. The source files keep their
        // comments for the next developer.
        if (asset.type.startsWith("text/html")) {
          return res.end(withBaseHref(stripHtmlComments(body.toString("utf8")), prefix));
        }
        if (asset.type.startsWith("application/javascript")) {
          return res.end(stripJsComments(body.toString("utf8")));
        }
        return res.end(body);
      }

      // THE GATE, before the route match rather than inside each route, so a
      // route added later is gated by existing rather than by being remembered.
      // Everything below it either reads employment records or writes a
      // decision; everything above is the empty shell that asks for the key.
      //
      // FAILS CLOSED IN THE CONFIGURATION GAP — when a key is required and none
      // is configured, every API request is refused rather than allowed. A
      // surface that refuses is fixed with one environment variable; an employer
      // approval accepted from an anonymous caller cannot be un-approved.
      const gate = await checkPortalAccessThrottled(req, access, { store: throttleStore });
      if (!gate.ok) return send(res, gate.status, gate.body);

      // GET /api/employees — who the admin can submit for, with their CURRENT
      // contract values (fetched from Remote so the form never hard-codes
      // them). This is the fact-gathering read, done up front exactly as the
      // real webhook path would; money comes back ÷100, human units.
      // GET /api/session — WHO the signed-in role is, from the server's own
      // session table. The employee tab used to hard-code a name in its HTML
      // ("Amara Okafor") while the server signed the employee in as somebody
      // else (Jan Willem Bakker): a caption the browser authors is a second
      // copy of a server fact, free to drift, and it drifted. The page now asks.
      if (req.method === "GET" && isPath(parts, ["api", "session"]) && parts.length === 2) {
        const session = resolveSession(req, { adminCompanyId });
        if (!session) {
          return send(res, 401, { ok: false, code: "unauthenticated", reason: "No authenticated Remote UI session was supplied." });
        }
        const id = session.authenticatedAdminId ?? session.authenticatedId ?? null;
        const person = session.employmentId ? employees.find((e) => e.id === session.employmentId) ?? null : null;
        return send(res, 200, {
          ok: true,
          role: session.role,
          id,
          name: person?.name ?? session.approverName ?? null,
          title: session.approverTitle ?? null,
          company: session.approverCompany ?? null,
          employmentId: session.employmentId ?? null,
        });
      }

      if (req.method === "GET" && isPath(parts, ["api", "employees"])) {
        const enriched = [];
        for (const emp of employees) {
          const current = await readCurrentValues(remote, emp.id);
          enriched.push({ id: emp.id, name: emp.name, email: emp.email, companyId: emp.companyId, current });
        }
        return send(res, 200, { employees: enriched });
      }

      // POST /api/submit — "as this admin, request this amendment" -> the
      // REAL gates run, THEN a real (mock-in-tests) Zendesk ticket is created
      // carrying the outcome. Company-admin only: requesting an amendment is
      // the customer admin's act (UC-06.md §1/§2), never the employee's or
      // the employer's — the gate is server-side, not a UI difference.
      if (req.method === "POST" && isPath(parts, ["api", "submit"])) {
        const session = resolveSession(req, { adminCompanyId });
        if (!session) {
          return send(res, 401, { ok: false, code: "unauthenticated", reason: "No authenticated Remote UI session was supplied." });
        }
        if (!canRoleSubmit(session.role, SUBMIT_ACTION)) {
          return send(res, 403, {
            ok: false,
            code: "role_not_authorized",
            role: session.role,
            action: SUBMIT_ACTION,
            reason: "Only the customer admin can request a contract amendment — employees and the employer do not initiate amendments.",
          });
        }

        const body = await readJsonBody(req);
        const employee = employees.find((e) => e.id === body.employmentId);
        if (!employee) return send(res, 400, { ok: false, code: "unknown_employee" });
        if (!body.changes || typeof body.changes !== "object" || Object.keys(body.changes).length === 0) {
          return send(res, 400, { ok: false, code: "invalid_changes" });
        }

        // --- STEP 1: the REAL gates, before any Zendesk call ---------------
        // handleAmendmentRequest runs identity -> employment -> schema ->
        // cutoff (policyEngine.js), drafts the summary (changeParser.js), and
        // records the amendment + audit row. `now` is the webhook event's
        // timestamp; the demo form sends a fixed one so the cutoff outcome is
        // deterministic against the mock payroll calendar, otherwise real now.
        const result = await handleAmendmentRequest(
          {
            employmentId: employee.id,
            session,
            changes: body.changes,
            requestedEffectiveDate: body.requestedEffectiveDate,
            reasonText: typeof body.reasonText === "string" ? body.reasonText : "",
            now: typeof body.now === "string" && body.now ? body.now : new Date().toISOString(),
            source: REMOTE_UI_SOURCE,
          },
          { remote, audit, amendmentStore, draftSummary: draftSummaryFn, judge }
        );

        // --- STEP 2: only now does a Zendesk ticket exist ------------------
        // Pre-tagged with the decision's outcome tag, pre-populated with the
        // drafted summary + amendment id, so the shared ZAF sidebar can host
        // the dual-approval flow with everything already gathered.
        // ROUTED, NOT ONLY TAGGED (contract [A-30]/[A-31], built 2026-09-02).
        // The ticket carries the owning team's queue tag and, when this
        // account's group id is known, lands in that group — the same shared
        // table and the same resolver the UC-04 path below uses, so a hard-coded
        // id cannot survive the next account move. An escalation additionally
        // carries the escalation tag. Until this date the stand-in's ticket
        // reached nobody's queue (DRIFT-062).
        const routing = handoffFor({ useCase: "UC-06", decision: result.decision });
        const assignment = await resolveGroupAssignment({ handoff: routing, zendesk, useCase: "UC-06" });
        const ticketTags = [...new Set([...outcomeTags(result.decision), ...(routing?.tags ?? [])])];
        // The row is read back BEFORE the note is composed, so the note can
        // carry the same cycle, lock, runway and form verdict the approvers
        // read (describeAmendmentBasis) — the n8n path's note carried all of
        // them and this one carried none (2026-09-02, expert review D4).
        await amendmentStore.flush();
        const rowForNote = await amendmentStore.findById(result.amendmentId);
        const ticket = await zendesk.createTicket({
          subject: `Contract amendment request — ${employee.name}`,
          comment: { body: `${buildInternalNote(result, rowForNote)}\n\n${describeAssignment(assignment)}`, public: false },
          requester: { name: employee.name, email: employee.email },
          tags: ticketTags,
          ...(assignment.groupId ? { group_id: assignment.groupId } : {}),
          custom_fields: [{ id: Number(employmentIdFieldId), value: employee.id }],
        });
        await amendmentStore.linkTicket(result.amendmentId, String(ticket.id));
        // THE JOIN, WRITTEN WHERE READERS LOOK FOR IT. The decision's audit row
        // was written before the ticket existed, so it carries
        // `externalRef: null`; linkTicket() repoints the ROW, and nothing
        // repointed the TRAIL — `/audit/api/refs/<ticket>` answered "nothing in
        // the trail carries this reference" for every stand-in amendment
        // (2026-09-02, expert review D3). Same helper, same action name and
        // same shape as the portal's relink, so one reader finds both.
        await recordTicketRelink({
          audit,
          type: { useCase: "UC-06", tier: classifyRisk("UC-06", result.flags ?? []).tier },
          typeId: "uc06",
          submittedRef: null,
          ticketId: String(ticket.id),
          recordId: result.amendmentId,
          persona: { session },
          reason: result.reason ?? null,
        });

        // Actionability is the real policy's answer, not the page's guess:
        // only a `dual_approval_required` amendment is open to the two-role
        // approve flow; an escalated one is visible but not actionable.
        const storedRow = await amendmentStore.findById(result.amendmentId);
        const actionability = evaluateAmendmentActionability({ amendmentRow: storedRow });

        return send(res, 200, {
          ok: true,
          ticketId: ticket.id,
          amendmentId: result.amendmentId,
          decision: result.decision,
          reason: result.reason,
          amendmentType: result.amendmentType,
          flags: result.flags,
          summary: result.summary,
          tags: ticketTags,
          // THE CLOCK THE GATES RAN ON, echoed. The page's quick-fills pin a
          // clock in June/July 2026 so the scenarios land on the fixture
          // calendar; a result that did not say so read as "evaluated today".
          evaluatedAt: typeof body.now === "string" && body.now ? body.now : storedRow?.createdAt ?? null,
          clockPinned: Boolean(typeof body.now === "string" && body.now),
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          explanation: explainRefusal(result, employee.id, storedRow),
          // WHO OWNS IT, from the routing table — named on the page for an
          // escalation, which used to end at a slug chip.
          owner: routing ? { team: routing.group, escalated: Boolean(routing.escalationTag) } : null,
          employee: { name: employee.name, email: employee.email },
        });
      }

      // ---------------------------------------------------------------------
      // GET /api/amendments/:id — "what happened to the change I asked for?"
      // ---------------------------------------------------------------------
      // THE HALF OF THE HUMAN GATE THIS PAGE NEVER HAD.
      //
      // An admin submitted an amendment here and got a decision at intake —
      // `dual_approval_required` or `escalate` — and then the request left for
      // somewhere they could not see. Two named people approve it in the ZAF
      // sidebar, or one denies it, and the amendment either reaches Remote or
      // does not. Every one of those facts was written to the row from day one.
      // None of them was ever shown to the person who asked for the change, so
      // the only way to find out was to ask a human whether a human had
      // answered yet. A control whose outcome the requester cannot observe is
      // only half a control — the same argument src/portal/server.js's
      // GET /api/my-requests makes, on the other requester surface.
      //
      // READ-ONLY, AND THAT BOUNDARY IS THE POINT. There is no approve here,
      // no decline, no "acknowledge" that writes anything. UC-06's dual approval
      // lives in the ZAF sidebar and in submitAmendmentApproval() behind a
      // signed approver identity, and a second place to decide would be a
      // second, UNAUDITED place to decide — with, in this case, one signature
      // instead of two, which is the specific control dual approval exists to
      // be. Showing status is reading; deciding is not.
      //
      // BY ID, NOT A LIST, and that is a deliberate limit rather than an
      // oversight. AmendmentStore.list() returns only the rows created in THIS
      // process, which on a serverless deployment is none — the same trap the
      // portal's "My requests" sat in for months while its own comment
      // accurately described it. findById() falls through to Postgres, so this
      // route answers correctly from a process that never saw the submission.
      // A durable list would need a listByOwner() on a store this surface does
      // not own; until then, one id read durably beats a list that is empty
      // wherever it matters.
      //
      // WHOSE AMENDMENT, decided by ./roles.js's evaluateAmendmentVisibility()
      // from the SERVER-OWNED session — never from the id in the URL, which is
      // not an identity claim and is not treated as one.
      // Exact length as well as prefix: isPath() matches a PREFIX, so without
      // the length check `/api/amendments/<id>/approve` would resolve here and
      // answer 200 with a status — a read-only route quietly swallowing the
      // shape of a decision route.
      if (req.method === "GET" && parts.length === 3 && isPath(parts, ["api", "amendments"])) {
        const session = resolveSession(req, { adminCompanyId });
        const amendment = session ? await amendmentStore.findById(parts[2]) : null;
        // Only the employer's scope needs the employment record, and only when
        // there is an amendment to scope — exactly as the consent path reads
        // it, and never as a way for the caller to name a company.
        const employment =
          session?.role === ROLES.employer && amendment ? await remote.getEmployment(amendment.employmentId) : null;

        const visibility = evaluateAmendmentVisibility({ session, amendment, employment });
        if (!visibility.allowed) {
          return send(res, visibility.status, {
            ok: false,
            code: visibility.code,
            reason: visibility.reason,
            role: session?.role ?? null,
            amendmentId: parts[2],
          });
        }

        const status = describeAmendmentStatus(amendment);
        // UC-06's own settled sentence, imported rather than paraphrased: it
        // names both signatures, the note, and whether the PUT to Remote
        // actually landed — which on a contract amendment is the difference
        // between the employee's terms having changed and only the record of
        // it having changed. Dropped when it degrades to the generic "executed
        // or declined" fallback, because that enumerates the very thing the
        // reader wanted resolved and `status.detail` already says more.
        const settledSentence = describeSettled(amendment);
        const resolution =
          settledSentence && settledSentence !== DUAL_APPROVAL_REFUSALS.already_decided.reason
            ? settledSentence
            : null;
        // Whether the approval flow is still open, from the real policy — the
        // page never guesses, and this is REPORTED, not offered: no control on
        // this surface can act on it.
        const actionability = evaluateAmendmentActionability({ amendmentRow: amendment });
        // THE CONSENTS, ON THE PAGE THAT CLAIMS TO SHOW "what a person decided
        // about it". Both parties consented on the live stand-in and no role's
        // screen showed either (2026-09-02); the rows were in audit_log the
        // whole time. `null` means the read failed and the page says so.
        const consents = await listConsents(audit, amendment.id);

        return send(res, 200, {
          ok: true,
          amendmentId: amendment.id,
          employmentId: amendment.employmentId,
          decision: amendment.decision ?? null,
          reason: amendment.reason ?? null,
          amendmentType: amendment.amendmentType ?? null,
          requestedEffectiveDate: amendment.requestedEffectiveDate ?? null,
          summary: amendment.summary ?? null,
          submittedAt: amendment.createdAt ?? null,
          // The Zendesk ticket the submit raised. The same string the ZAF
          // sidebar looks the amendment up by, so a requester quoting it and a
          // specialist searching it are using one identifier.
          externalRef: amendment.externalRef ?? null,
          status,
          resolution,
          settled: SETTLED_STATES.has(status.state),
          openToApproval: actionability.allowed,
          openToApprovalReason: actionability.reason,
          visibleBecause: visibility.reason,
          consents,
          signatoriesNote: signatoriesNote(session.role),
          readOnly: true,
          // Carried in the payload and not only in the page's copy, so the
          // boundary travels with the data to anything else that reads this.
          note:
            "Read-only. This page shows what happened to an amendment; it never offers a control that could decide one. The two approvals happen in Remote's support desk, where dual control requires two different people.",
        });
      }

      // POST /api/consent — "as the logged-in role, consent to this amendment".
      // The employee (their own contract) or employer (their own company) is
      // the only party who can consent; the customer admin's control point in
      // UC-06 is the dual APPROVAL in the sidebar, never a signature. The
      // whole verdict comes from the pure evaluateConsentAuthorization() —
      // the server fetches the amendment/employment and nothing else decides.
      if (req.method === "POST" && isPath(parts, ["api", "consent"])) {
        const body = await readJsonBody(req);
        const session = resolveSession(req, { adminCompanyId });
        if (!session) {
          return send(res, 401, { ok: false, code: "unauthenticated", reason: "No authenticated Remote UI session was supplied." });
        }

        const party = body.party;
        const amendment = await amendmentStore.findById(body.amendmentId);
        const employment = party === "employer" && amendment ? await remote.getEmployment(amendment.employmentId) : null;

        const verdict = evaluateConsentAuthorization({ session, party, amendment, employment });
        if (!verdict.allowed) {
          return send(res, verdict.status, {
            ok: false,
            code: verdict.code,
            reason: verdict.reason,
            role: session.role,
            party: party ?? null,
            amendmentId: body.amendmentId ?? null,
          });
        }

        // The consent IS the durable record, so audit FIRST — same ordering
        // rule as submitAmendmentApproval(): the audit row is the proof a
        // human consented, so a later best-effort note failing must never
        // erase it.
        const { tier } = classifyRisk("UC-06", amendment.flags ?? []);
        const consentingIdentity =
          party === "employee"
            ? (employees.find((e) => e.id === amendment.employmentId)?.email ?? session.authenticatedId)
            : session.authenticatedId;
        await audit.logDurable({
          useCase: "UC-06",
          action: party === "employee" ? "amendment_employee_consented" : "amendment_employer_consented",
          actor: consentingIdentity,
          riskTier: tier,
          details: { amendmentId: amendment.id, employmentId: amendment.employmentId, party, note: body.note ?? null },
        });

        // Visible on the ticket the admin's submit created (externalRef).
        // Best-effort: a note that fails must never erase the consent above.
        if (amendment.externalRef) {
          try {
            await zendesk.updateTicket(amendment.externalRef, {
              comment: {
                body: buildConsentNote({ party, employmentId: amendment.employmentId, amendmentId: amendment.id, note: body.note, consenter: consentingIdentity }),
                public: false,
              },
            });
          } catch (err) {
            console.error(`[remoteui] consent note on ticket ${amendment.externalRef} failed: ${err.message}`);
          }
        }

        return send(res, 200, {
          ok: true,
          code: "consent_recorded",
          party,
          amendmentId: amendment.id,
          employmentId: amendment.employmentId,
          reason: verdict.reason,
        });
      }

      // ---------------------------------------------------------------------
      // GET /api/work-authorizations — STAGE 2: what is awaiting THIS
      // employer's decision, for THIS company.
      // ---------------------------------------------------------------------
      // The company comes from the session and the scope is resolved by reading
      // each candidate employment back from Remote (./workAuthScope.js). There
      // is no query parameter, no body and no header on this route through
      // which a caller can name a company, an employment or a request — which
      // is what makes the boundary a boundary rather than a default.
      //
      // TWO RUNGS, REPORTED SEPARATELY AND NEVER BLENDED. Rung 2 (the real
      // `GET /v1/work-authorization-requests?employment_id=…&status=pending`)
      // is asked first, on every load, and what it answered is reported in
      // `remoteProbe` — including when it answered with nothing, because a
      // probe skipped on the strength of a prediction is how a Sandbox
      // limitation becomes a recorded fact about Remote's platform. Rung 3 is
      // additive only: a stand-in row can never displace or rewrite a real one,
      // and every stand-in row is marked in three independent places (a
      // `standin-` id, a `_standin` block on the record, and the
      // X-Standin-Work-Authorizations header on this response).
      if (req.method === "GET" && isPath(parts, ["api", "work-authorizations"]) && parts.length === 2) {
        const session = resolveSession(req, { adminCompanyId });
        if (!session) {
          return send(res, 401, { ok: false, code: "unauthenticated", reason: "No authenticated Remote UI session was supplied." });
        }
        if (!canRoleSubmit(session.role, DECIDE_WORK_AUTHORIZATION_ACTION)) {
          return send(res, 403, {
            ok: false,
            code: "role_not_authorized",
            role: session.role,
            action: DECIDE_WORK_AUTHORIZATION_ACTION,
            reason:
              "Stage 2 is the customer's decision and the company admin holds it. An employee submitted the " +
              "request and cannot approve their own travel; the employer-consent role signs contract amendments, " +
              "which is a different act.",
          });
        }

        const scope = await resolveEmployerScope({
          session,
          remote: workAuthRemote,
          standin: workAuthStandin,
          authorizationStore: uc04Store,
          roster: workAuthRoster,
        });

        const standinIds = scope.requests.filter((r) => r.origin === "standin").map((r) => r.id);
        res.setHeader(STANDIN_HEADER, standinIds.join(",") || "none");
        // OURS ARE NAMED IN A HEADER TOO, in a header of their own. Same promise
        // the stand-in makes and a SEPARATE one, because "this trip was invented
        // for a demo" and "somebody really filed this" are different claims and
        // one header cannot carry both.
        const recordIds = scope.requests.filter((r) => r.origin === RECORD_ORIGIN).map((r) => r.id);
        res.setHeader(RECORD_HEADER, recordIds.join(",") || "none");

        return send(res, 200, {
          ok: true,
          companyId: scope.companyId,
          stage: CURRENT_STAGE,
          stages: STAGES,
          nextStage: STAGE_3_NOTE,
          actions: EMPLOYER_ACTIONS,
          statuses: EMPLOYER_VERBS,
          // Named so the page can say it and a test can assert we never send
          // one. Remote's own verdict has no endpoint at all.
          remoteOnlyStatuses: REMOTE_ONLY_STATUSES,
          decidableStatus: DECIDABLE_STATUS,
          requests: scope.requests,
          scope: {
            employments: scope.employments,
            // An employment that could not be read is EXCLUDED and named. An
            // unreadable scope is not an empty one.
            unreadable: scope.unreadable,
            // "This session owns nobody here" is a REAL state, and it renders
            // identically to "nothing is pending" unless something says which
            // it is. Decided server-side so the page renders what it is given.
            verdict: scope.scopeVerdict,
            // Stand-in rows this session is NOT shown, each with the reason.
            // Reported rather than silently filtered: a stand-in whose
            // employment answers with another company is the boundary working,
            // and an exclusion nobody can see is how this surface previously
            // contradicted itself without anyone noticing.
            standinUnattributed: scope.standinUnattributed,
            // Rows this system holds for these employments that name NO
            // employer decision — escalated, hard-blocked or already executed.
            // Shown as exclusions with their reasons rather than dropped: a
            // manager who filed something and cannot find it is owed "it went
            // to a specialist", not silence.
            recordsNotForEmployer: scope.recordsNotForEmployer,
          },
          remoteProbe: scope.remoteProbe,
          // The same question asked of OUR store: was it read, what did it hold,
          // and did anything of ours get left out because Remote had already
          // answered for that id. "Nothing has been filed" and "we never looked"
          // must never render the same way.
          recordProbe: scope.recordProbe,
          standinIds,
          recordIds,
          note:
            "Requests marked `standin` are not Remote's. Remote publishes no endpoint that creates a " +
            "work-authorization request, and the Sandbox holds none, so there would otherwise be nothing on " +
            "this screen to decide. Every field on them is a property of Remote's own schema; the values are " +
            "this repository's, and a decision on one is recorded here and never sent to Remote. Requests " +
            "marked `uc04_record` are a different thing again and must not be read as fixtures: each one is a " +
            "request a real person really filed on one of this system's own intake surfaces, assessed by " +
            "UC-04's gates and stored in uc04_authorizations. Remote has not been told about those either — " +
            "for the same reason, there is no endpoint to tell it — so deciding one is recorded here and in " +
            "the audit log, and hands the case on to Remote's Mobility Team through Zendesk.",
        });
      }

      // ---------------------------------------------------------------------
      // POST /api/work-authorizations/:id/decision — the employer's verdict.
      // ---------------------------------------------------------------------
      // TWO VERBS AND NOTHING ELSE. `UpdateWorkAuthorizationRequestParams` is
      // `additionalProperties: false` over a `oneOf` with exactly two branches,
      // so `approve` -> `approved_by_manager` and `decline` ->
      // `declined_by_manager` is the whole vocabulary. `approved_by_remote` is
      // stage 3 — Remote's own compliance verdict, with no endpoint — and this
      // repository has already shipped the defect of writing it once
      // (src/uc04/workflow.js's header): a record saying Remote had approved a
      // trip Remote had never seen.
      //
      // ORDERING: THE DURABLE RECORD FIRST, THE OUTWARD ACT SECOND. The audit
      // row is the proof a named human decided, and it is written before
      // anything leaves this process — the same order as the n8n graph's
      // "Append Audit Log" before "Route by Decision", and the same reason: a
      // transport failure downstream must lose the ACT, never the DECISION.
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "work-authorizations"]) &&
        parts.length === 4 &&
        parts[3] === "decision"
      ) {
        const session = resolveSession(req, { adminCompanyId });
        const body = await readJsonBody(req);
        const requestId = parts[2];

        // Scope is resolved BEFORE the record is looked up, and the record is
        // then taken from the scope rather than fetched by the id the caller
        // sent. A caller's id can select from what they may see; it can never
        // widen it.
        const scope = session
          ? await resolveEmployerScope({
              session,
              remote: workAuthRemote,
              standin: workAuthStandin,
              authorizationStore: uc04Store,
              roster: workAuthRoster,
            })
          : { companyId: null, requests: [], allRequests: [], recordIds: new Set() };

        // From the FULL company set, not the pending-only list the screen shows
        // — otherwise an already-decided request of your own company answers
        // "no such request", and the reader is told the wrong thing about their
        // own record.
        const entry = (scope.allRequests ?? []).find((r) => r.id === requestId) ?? null;
        // Looked up outside the scope ONLY so that "no such request" and "not
        // yours" stay different answers. The policy still decides, and it
        // decides from `scope.recordIds`; this lookup can only ever turn a 404
        // into a 403, never a refusal into a permission.
        //
        // ALL THREE WORLDS ARE CONSULTED HERE, not just the stand-in. A record
        // of OURS quoted from outside the caller's company used to fall through
        // to `null` and answer `work_authorization_not_found` — telling an admin
        // that another company's request does not exist, which is a different
        // (and wrong) fact from "it is not yours to decide". The store read
        // cannot throw the request: an unreachable store leaves `known` null,
        // which is the pre-existing 404 and never a permission.
        let known = entry?.request ?? (isStandinId(requestId) ? workAuthStandin.findById(requestId) : null);
        if (!known) {
          try {
            known = toWorkAuthorizationShape(await uc04Store.findById(requestId));
          } catch {
            known = null;
          }
        }

        const verdict = evaluateEmployerDecision({
          session,
          action: body.action,
          record: known,
          scope,
        });
        if (!verdict.allowed) {
          return send(res, verdict.status, {
            ok: false,
            code: verdict.code,
            reason: verdict.reason,
            role: session?.role ?? null,
            workAuthorizationId: requestId,
            actions: EMPLOYER_ACTIONS,
          });
        }

        const built = buildDecisionPayload({
          action: body.action,
          reason: body.reason,
          employerSpecialInstructions: body.employerSpecialInstructions,
        });
        if (!built.ok) {
          return send(res, built.status, {
            ok: false,
            code: built.code,
            reason: built.reason,
            workAuthorizationId: requestId,
            actions: EMPLOYER_ACTIONS,
          });
        }

        const actor = session.authenticatedAdminId;
        const { tier } = classifyRisk("UC-04", []);

        // WHICH WORLD THIS RECORD CAME FROM, resolved ONCE and used by both the
        // audit row and the write branch. It used to be computed twice, in two
        // expressions that happened to agree; two copies of a discriminator is
        // two things to drift, and this one decides where a decision is written.
        // The discriminator is the record's ORIGIN, never the shape of its id —
        // guessing from an id string is how a portal-originated expense came to
        // be released against the real gateway and 404 every time
        // (src/shared/remoteWorld.js).
        const origin = entry?.origin ?? (isStandinId(requestId) ? "standin" : "remote_api");

        // --- STEP 1: the durable record, before anything leaves this process.
        await audit.logDurable({
          useCase: "UC-04",
          action: body.action === "approve" ? "work_authorization_employer_approved" : "work_authorization_employer_declined",
          actor,
          riskTier: tier,
          details: {
            workAuthorizationId: requestId,
            // THE ONE FIELD THAT MAKES THIS ROW FINDABLE BY A HUMAN. Added
            // 2026-08-31: src/auditview/readStore.js searches
            // `details->>'externalRef'` BY NAME, so a decision row without it
            // cannot be reached from the only id anybody holds — the Zendesk
            // ticket number the hand-off two steps below is about to update.
            // The employer's approval was the one transition in this chain that
            // did not carry it, which meant the /audit feed could show the
            // request being filed and the ticket being handed off with the
            // decision between them invisible.
            //
            // NULL WHEN THERE IS GENUINELY NONE. A stand-in or Remote-origin
            // row has no ticket of ours; a fabricated reference would return
            // somebody else's trail, which is worse than an absent one.
            externalRef: entry?.externalRef ?? entry?.ticketId ?? null,
            employmentId: entry?.employmentId ?? null,
            // WHO, IN WORDS — not just the session id in `actor` above.
            // Added 2026-08-31 because the display name was durable NOWHERE.
            // `uc04_authorizations` has no column for it (authorizationStore.js
            // says so, and a migration is not runnable from a coding session),
            // so it lived on the in-memory row and in the prose of a Zendesk
            // note. The ZAF sidebar reads Postgres from another process, so the
            // specialist reviewing an approved request was shown "Approved by
            // admin_jane" — a session id, which is an audit-grade identity and
            // not an answer to "who approved this". The append-only row's
            // `details` is jsonb, so recording it here needs no migration and
            // cannot lose the id: `actor` still carries it, unchanged.
            approverName: session.approverName ?? null,
            // The standing they approved IN, and WHOSE. A name alone still does
            // not answer "why was this person entitled to approve it" or "which
            // of Remote's clients is this" — see DEMO_SESSIONS above.
            approverTitle: session.approverTitle ?? null,
            approverCompany: session.approverCompany ?? null,
            companyId: scope.companyId,
            stage: CURRENT_STAGE,
            status: built.payload.status,
            origin,
            reason: built.payload.reason ?? null,
            employerSpecialInstructions: built.payload.employer_special_instructions ?? null,
            source: REMOTE_UI_SOURCE,
            // Recorded on the row itself, so a reader of the audit trail alone
            // is never left thinking this decision cleared the employee to
            // travel. Stage 3 is Remote's and has no endpoint.
            remoteReviewOutstanding: true,
          },
        });

        // --- STEP 2: the outward act, in the world the record came from.
        // A stand-in record gets a stand-in write, our own record gets a write
        // to uc04_authorizations, and anything Remote handed us gets the real
        // PATCH through the SAME client that produced it.
        const standin = origin === "standin";
        let updated = null;
        let transmission;
        // The Zendesk hand-off, on our own records only — see handOffToMobility().
        let handoff = null;

        if (origin === RECORD_ORIGIN) {
          // --- OUR OWN RECORD: the verdict is written to uc04_authorizations.
          //
          // Nothing goes to Remote and nothing CAN: Remote holds no such
          // request, because it publishes no endpoint that creates one. So the
          // durable artifacts are the audit row above and this row — and the
          // hand-off below is what carries the case to the humans who act next.
          const decided = await uc04Store.recordEmployerDecision(requestId, {
            action: body.action,
            approver: actor,
            approverName: session.approverName ?? null,
            // Remote requires a reason on a decline and this repository refuses
            // to invent one (buildDecisionPayload()), so the decline branch
            // always has one. On an approve the employer's own words are
            // optional and null is honest.
            note: built.payload.reason ?? built.payload.employer_special_instructions ?? null,
          });

          if (!decided) {
            // The row moved between the scope read and the write — a second
            // delivery of the same decision, or another decider. The DECISION is
            // already audited, so what is reported is precisely that: recorded,
            // and not applied, with which of the two it was.
            await audit.log({
              useCase: "UC-04",
              action: "work_authorization_employer_record_not_updated",
              actor,
              riskTier: tier,
              details: { workAuthorizationId: requestId, status: built.payload.status, origin },
            });
            return send(res, 409, {
              ok: false,
              code: "decision_recorded_record_not_updated",
              reason:
                "Your decision is recorded and audited, and the request could NOT be updated: it is no longer " +
                "awaiting a manager. Somebody else decided it, or this decision was delivered twice. Reload the " +
                "queue to see which.",
              workAuthorizationId: requestId,
              status: built.payload.status,
            });
          }

          updated = toWorkAuthorizationShape(decided);
          transmission = {
            transmitted: false,
            target: RECORD_ORIGIN,
            detail:
              "Written to this system's own uc04_authorizations record, not to Remote. Remote holds no such " +
              "request — it publishes no endpoint that creates one — so there is nothing there to PATCH. The " +
              "durable record of this decision is that row and the audit_log row above it.",
          };
          res.setHeader(RECORD_HEADER, requestId);

          // --- STEP 3: THE HAND-OFF. A decision nobody is told about is a
          // decision that reaches nobody, which is the failure this whole pass
          // exists to close one door up. It runs AFTER both durable writes and
          // it cannot fail either of them — see handOffToMobility().
          handoff = await handOffToMobility({
            zendesk,
            audit,
            store: uc04Store,
            employmentIdFieldId,
            record: decided,
            action: body.action,
            actor,
            actorName: session.approverName ?? null,
            employeeName: entry?.employeeName ?? null,
            status: built.payload.status,
            note: built.payload.reason ?? built.payload.employer_special_instructions ?? null,
            tier,
          });
        } else if (standin) {
          updated = workAuthStandin.decide(requestId, built.payload, {
            id: actor,
            name: session.approverName ?? actor,
            email: session.approverEmail ?? null,
          });
          transmission = {
            transmitted: false,
            target: "standin",
            detail:
              "Written to this repository's stand-in, not to Remote. Remote holds no such request — it " +
              "publishes no endpoint that creates one — so there is nothing there to PATCH. The durable " +
              "record of this decision is the audit_log row above.",
          };
        } else {
          try {
            updated = await workAuthRemote.patchWorkAuthorization(requestId, built.payload);
            transmission = {
              transmitted: true,
              target: "remote_api",
              detail: `PATCH /v1/work-authorization-requests/${requestId} accepted \`${built.payload.status}\`.`,
            };
          } catch (err) {
            // The DECISION stands — it is already durable. Only the
            // transmission failed, and saying which is the difference between
            // "nobody decided" and "Remote was not told".
            await audit.log({
              useCase: "UC-04",
              action: "work_authorization_employer_write_failed",
              actor,
              riskTier: tier,
              details: { workAuthorizationId: requestId, status: built.payload.status, message: String(err.message).slice(0, 300) },
            });
            return send(res, 502, {
              ok: false,
              code: "decision_recorded_remote_write_failed",
              reason:
                `Your decision is recorded and audited, and Remote was NOT told: ${err.message}. ` +
                "The request is still awaiting a manager at Remote's end.",
              workAuthorizationId: requestId,
              status: built.payload.status,
            });
          }
        }

        if (standin) res.setHeader(STANDIN_HEADER, requestId);

        return send(res, 200, {
          ok: true,
          code: body.action === "approve" ? "approved_by_manager" : "declined_by_manager",
          reason: verdict.reason,
          workAuthorizationId: requestId,
          status: built.payload.status,
          origin,
          stage: CURRENT_STAGE,
          nextStage: STAGE_3_NOTE,
          remoteWrite: transmission,
          // Null on a Remote or stand-in row — there is no ticket behind either
          // — and on ours it reports whether the case actually reached anyone,
          // including when it did not. Never omitted on a failure: a hand-off
          // that silently did not happen is the defect, not the report of it.
          handoff,
          request: updated,
        });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[remoteui] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

// ---------------------------------------------------------------------------
// THE HAND-OFF — stage 2 finishes, stage 3 has to hear about it
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AT ALL. An employer approval is not the end of the process
// and reads exactly like one. Remote's Mobility Team performs its own separate
// compliance review afterwards, and Remote publishes NO endpoint for that stage
// — so this system cannot start it, cannot watch it, and the only way the case
// reaches those humans is the support queue. Without this, a manager clicks
// Approve, a durable row is written, and nobody is told: the same shape as §7's
// honest-gaps items 7–11, where a correct, durable, audited decision reached
// nobody's queue.
//
// IT UPDATES THE EXISTING TICKET RATHER THAN RAISING A SECOND ONE. The intake
// that produced this request already raised one and stored its id as the
// record's `external_ref` (src/portal/ticketing.js, then `linkTicket()`). A
// second ticket would split one journey across two conversations, and nothing
// would link the halves — `src/auditview/readStore.js` resolves a reference by
// `details->>'externalRef'` alone, so a pointer that is not in that field is a
// pointer nobody can follow. Same rule, same reasoning as
// `letterTicketPlan()`'s "the ticket follows the trip".
//
// IT CANNOT LOSE THE DECISION, AND THAT IS THE WHOLE ORDERING. Both durable
// writes — the audit row and the uc04_authorizations row — have already landed
// before this is called, and every failure here is caught, audited under its own
// action name, and REPORTED in the response. A transport failure must lose the
// ACT, never the DECISION.
//
// ROUTING COMES FROM THE SHARED TABLE, NEVER A LITERAL. `handoffFor()` answers
// which team owns a UC-04 hand-off and `resolveGroupAssignment()` turns that
// name into this account's group id — live read first, the synced ids as the
// fallback, and a sentence on the ticket when neither answered. A hard-coded id
// would assign real work to the wrong queue on the next account move, and this
// project has moved Zendesk account twice.
// ---------------------------------------------------------------------------

/** The outcome tag per employer verdict, in UC-01's `uc0N_*` scheme. */
export const EMPLOYER_OUTCOME_TAGS = Object.freeze({
  approve: "uc04_employer_approved",
  decline: "uc04_employer_declined",
});

/**
 * Tell the Mobility Team what the employer decided.
 *
 * @returns {Promise<object>} always a report, never a throw. `delivered` says
 *   whether anything actually reached Zendesk.
 */
async function handOffToMobility({
  zendesk,
  audit,
  store,
  employmentIdFieldId,
  record,
  action,
  actor,
  actorName,
  employeeName,
  status,
  note,
  tier,
}) {
  const outcomeTag = EMPLOYER_OUTCOME_TAGS[action];
  const ref = record?.externalRef ? String(record.externalRef) : null;
  // A NUMERIC reference IS a Zendesk ticket id; anything else is the requester's
  // own reference string, which names no ticket. Coercing one into the other is
  // how a specialist gets sent to a 404 (§7 honest-gaps item 12).
  const ticketId = ref && /^\d+$/.test(ref) ? ref : null;

  // ROUTED ONLY ON AN APPROVAL. An approved request becomes new work for the
  // Mobility Team, so it is assigned to them. A declined one is FINISHED — the
  // employer said no and nobody downstream has anything to do — so it is
  // recorded on the ticket and deliberately not pushed into a team's queue as if
  // it were work. `handoffFor()` is still consulted for the queue tag either way,
  // because an untagged ticket is one no view can find.
  const routing = handoffFor({ useCase: "UC-04", decision: "ready_for_approval" });
  const assignment = await resolveGroupAssignment({ handoff: routing, zendesk, useCase: "UC-04" });
  const groupId = action === "approve" ? assignment.groupId : null;
  const tags = [...new Set([...(routing?.tags ?? []), "uc04", outcomeTag])];

  // THE TAG THAT STOPS BEING TRUE THE MOMENT THIS FUNCTION RUNS.
  //
  // Intake writes `uc04_awaiting_employer_approval` (src/portal/ticketing.js),
  // and until now nothing ever took it off — `flagForReview()` ADDS tags
  // without replacing. Read live 2026-09-01: ticket 127 still carried it
  // thirty-five minutes after the employer had approved AND Remote's mobility
  // team had cleared it, so the ticket asserted it was waiting for a decision
  // that had already been made twice over. That is the same defect as the
  // sidebar badge and the "My requests" status the same evening: a surface
  // that does not move when the state does.
  //
  // BOTH VERDICTS. An approval and a decline are equally not "awaiting the
  // employer" — this is not a success-only cleanup.
  //
  // NOT VIA ZENDESK'S `remove_tags`, WHICH IS A NO-OP ON A TICKET UPDATE
  // (rca-7txk, measured live): the client resolves removals against the
  // ticket's OWN current tags and sends the computed set back, so this cannot
  // clobber a tag some other process added in the meantime — see
  // src/zendesk/restClient.js's #tagsAfterRemoval().
  //
  // THE STRING IS IMPORTED, NEVER RETYPED. A remover naming a tag nothing
  // writes removes nothing and reports success, so a second literal here would
  // fail silently in the one direction that leaves the bug in place.
  const removeTags = [UC04_AWAITING_EMPLOYER_TAG];

  const body = buildEmployerHandoffNote({
    action,
    status,
    actor,
    actorName,
    employeeName,
    record,
    note,
    assignmentSentence: action === "approve" ? describeAssignment(assignment) : null,
  });

  try {
    if (!zendesk || typeof zendesk.createTicket !== "function") {
      throw new Error("no Zendesk client is configured on this surface");
    }
    if (ticketId) {
      // flagForReview() adds tags without replacing what is already there and
      // posts the note as `public: false`. The employee is not the audience: a
      // stage-3 compliance review is internal, and telling them "approved" here
      // would read as clearance to travel, which it is not.
      await zendesk.flagForReview(ticketId, {
        note: body,
        additionalTags: tags,
        removeTags,
        ...(groupId ? { groupId } : {}),
      });
      return {
        delivered: true,
        ticketId,
        created: false,
        tags,
        groupId,
        assignment: describeAssignment(assignment),
        detail: `The employer's decision was posted to the existing Zendesk ticket #${ticketId} as an internal note.`,
      };
    }

    // NO TICKET ON THE RECORD — raise one. A request can legitimately reach this
    // state: the intake that filed it decided no human had to look yet, or the
    // ticket write failed at the time. Either way the employer HAS now decided
    // and somebody has to receive it.
    const created = await zendesk.createTicket({
      subject: `Work authorization — employer ${action === "approve" ? "approved" : "declined"}${employeeName ? ` — ${employeeName}` : ""}`,
      comment: { body, public: false },
      tags,
      ...(groupId ? { group_id: groupId } : {}),
      ...(record?.employmentId && employmentIdFieldId
        ? { custom_fields: [{ id: Number(employmentIdFieldId), value: record.employmentId }] }
        : {}),
    });
    const newId = created?.id ? String(created.id) : null;
    // Repoint the record at the ticket, exactly as the portal's intake does, so
    // the ZAF sidebar's by-ticket lookup can find this case at all.
    if (newId && typeof store?.linkTicket === "function") await store.linkTicket(record.id, newId);
    return {
      delivered: Boolean(newId),
      ticketId: newId,
      created: true,
      tags,
      groupId,
      assignment: describeAssignment(assignment),
      detail: newId
        ? `This request carried no Zendesk ticket, so one was raised (#${newId}) carrying the employer's decision.`
        : "A Zendesk ticket was requested but the account returned no id, so nothing can be linked to this decision.",
    };
  } catch (err) {
    // THE DECISION STANDS — it is already durable, twice. Only the hand-off
    // failed, and saying which is the difference between "nobody decided" and
    // "the Mobility Team was not told".
    await audit.log({
      useCase: "UC-04",
      action: "work_authorization_employer_handoff_failed",
      actor,
      riskTier: tier,
      details: {
        workAuthorizationId: record?.id ?? null,
        externalRef: ref,
        status,
        message: String(err.message).slice(0, 300),
      },
    });
    return {
      delivered: false,
      ticketId,
      created: false,
      tags,
      groupId,
      assignment: describeAssignment(assignment),
      detail:
        `Your decision is recorded and audited, and Zendesk was NOT updated: ${err.message}. ` +
        "Remote's Mobility Team has not been told, so this needs to be passed on by hand.",
    };
  }
}

/**
 * The internal note the Mobility Team reads. Deterministic text, never
 * LLM-authored — the same discipline as buildInternalNote() below.
 *
 * It says what was decided, by whom, on which record, and — the sentence that
 * matters most — that this is the EMPLOYER's decision and not Remote's, so a
 * reader is never left thinking the employee is cleared to travel.
 */
export function buildEmployerHandoffNote({ action, status, actor, actorName, employeeName, record, note, assignmentSentence }) {
  const who = actorName ? `${actorName} (${actor})` : actor;
  const lines = [
    `Work authorization — the employer ${action === "approve" ? "APPROVED" : "DECLINED"} this request.`,
    "",
    `Employee: ${employeeName ?? "(not named on the record)"}`,
    `Employment: ${record?.employmentId ?? "(none recorded)"}`,
    `Decided by: ${who}`,
    `Recorded status: ${status}`,
  ];
  if (note) lines.push(`Employer's words: ${note}`);
  if (record?.reason) lines.push(`Assessment: ${record.decision} (${record.reason})`);
  if (Array.isArray(record?.flags) && record.flags.length) lines.push(`Flags: ${record.flags.join(", ")}`);
  if (record?.summary) lines.push("", record.summary);
  lines.push("", `Work authorization record: ${record?.id ?? "(unknown)"}`);
  if (assignmentSentence) lines.push(assignmentSentence);
  lines.push("", STAGE_3_NOTE);
  return lines.join("\n");
}

/**
 * The ticket's internal note — the "pre-populated" part of the authored
 * ticket: decision, reason, flags, drafted summary, and the amendment id a
 * specialist needs to find the record. Deterministic text, mirroring the
 * case-assist template UC-01 posts; never LLM-authored in this path.
 */
function buildInternalNote(result, amendmentRow = null) {
  const lines = [
    "UC-06 contract amendment intake (Remote UI stand-in).",
    "",
    result.summary,
    "",
    `Decision: ${result.decision}${result.reason ? ` (${result.reason})` : ""}`,
  ];
  if (result.flags && result.flags.length) lines.push(`Flags: ${result.flags.join(", ")}`);
  lines.push(`Amendment: ${result.amendmentId}`);
  // WHAT THE TWO APPROVERS WILL READ, on the ticket too: the contract diff,
  // the form verdict, and the payroll cycle with its lock and runway — the
  // same sentences the sidebar shows, from the same describer, so the ticket
  // and the panel cannot disagree. A projected cycle says so in the payroll
  // sentence; a cycle that was never consulted says that.
  const basis = amendmentRow ? describeAmendmentBasis({ amendmentRow }) : null;
  if (basis) {
    lines.push("", `Change: ${basis.change.sentence}`, `Form: ${basis.schema.sentence}`, `Payroll: ${basis.payroll.sentence}`);
  }
  return lines.join("\n");
}

/** Deterministic internal-note text for a recorded consent — who consented to what. */
function buildConsentNote({ party, employmentId, amendmentId, note, consenter }) {
  const lines = [
    "UC-06 contract amendment consent (Remote UI stand-in).",
    "",
    `The ${party} consented to amendment ${amendmentId} for ${employmentId}.`,
    `Consenting identity: ${consenter}.`,
  ];
  if (note) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

/**
 * Plain-English context for a refusal the gates have ALREADY returned.
 *
 * THIS IS NOT A GATE AND MUST NEVER BECOME ONE. It reads `result.reason` — a
 * decision policyEngine.js has already made — and adds a sentence saying what
 * that reason means in this environment. It cannot change a decision, cannot
 * produce one, and returns null whenever it has nothing to add.
 *
 * WHY IT EXISTS. `country_schema_unavailable` is a true reason and a useless
 * one to the person reading it: it reads like a transient outage, or like the
 * amendment's fault. In this environment it is neither — Remote publishes no
 * contract-amendment form for Nigeria or the USA at all, permanently, and the
 * endpoint answers 500. A refusal nobody can act on is how a use case that
 * structurally cannot succeed goes on looking like one that is being
 * appropriately careful, which is the failure mode that let UC-06 record 26
 * refusals and zero successes without anyone noticing. Naming the cause is the
 * cheapest thing that tells those two apart on sight.
 */
export function explainRefusal(result, employmentId, amendmentRow = null) {
  if (!result || result.decision !== "escalate") return null;
  if (result.reason === "country_schema_unavailable") {
    const country = NO_AMENDMENT_FORM_EMPLOYMENTS[employmentId];
    if (country) {
      return (
        `Remote publishes no contract-amendment form for ${country}, so no amendment for this ` +
        `employee can be schema-validated — the request is sound, the form does not exist. ` +
        `This is a permanent property of the country, not a fault in this request or a temporary outage.`
      );
    }
    return (
      "The contract-amendment form for this employee's country could not be read. That is either a " +
      "country Remote publishes no form for, or a genuine outage — the API returns the same empty " +
      "result for both, so a human has to check before anyone approves a write."
    );
  }

  // EVERY OTHER REFUSAL, IN WORDS (2026-09-02). Until this date the page named
  // an escalation as slug chips alone — `cutoff_lock_passed`, `schema_invalid
  // missing_salary_decrease_reason` — with no sentence, no cycle, no lock
  // instant, no field name a person could act on. The sentences are the SAME
  // ones the approvers read in the sidebar (describeAmendmentBasis(), one
  // authority), composed from the row that was just written; nothing here
  // decides or re-derives.
  const basis = amendmentRow ? describeAmendmentBasis({ amendmentRow }) : null;
  switch (result.reason) {
    case "cutoff_lock_passed":
    case "no_matching_payroll_cycle":
    case "ambiguous_payroll_cycle":
    case "cutoff_date_unknown":
      return basis?.payroll?.sentence ?? null;
    case "schema_invalid":
    case "change_not_expressible":
    case "change_value_underivable": {
      const sentence = basis?.schema?.sentence ?? null;
      if (!sentence) return null;
      return sentence + fieldsInWords(basis.schema.missingFields ?? []);
    }
    case "employee_not_active":
      return "This person's employment is not active, so there is no live contract to amend. Nothing about the requested change or the payroll calendar was assessed.";
    case "identity_not_verified":
      return "The signed-in session does not act for the company that employs this person, so the request was not assessed at all.";
    default:
      return null;
  }
}

/**
 * The form fields a refusal names, in the words a company admin would use —
 * and, for each, whether THIS page can supply it. A field the page has a box
 * for is pointed at; a field it does not is stated as such, because "supply
 * it and resubmit" is only honest advice when there is somewhere to supply it.
 */
const FIELD_WORDS = Object.freeze({
  salary_decrease_reason: { words: "why the salary is being reduced", onThisPage: "the 'If this is a decrease' box below" },
  was_employee_informed: { words: "confirmation that the employee has been told", onThisPage: "the 'If this is a decrease' box below" },
  default_weekly_hours: { words: "the default weekly hours for a part-time contract", onThisPage: null },
  part_time_salary_confirmation: { words: "confirmation that the stated salary is for the part-time hours", onThisPage: null },
  contract_end_date: { words: "the end date of a fixed-term contract", onThisPage: null },
});

function fieldsInWords(missingFields) {
  const known = missingFields.filter((f) => Object.hasOwn(FIELD_WORDS, f));
  if (!known.length) return "";
  const named = known.map((f) => FIELD_WORDS[f].words).join("; ");
  const here = known.filter((f) => FIELD_WORDS[f].onThisPage);
  const notHere = known.filter((f) => !FIELD_WORDS[f].onThisPage);
  let out = ` In plain words: ${named}.`;
  if (here.length) out += ` Supply ${here.length === 1 ? "it" : "these"} in ${FIELD_WORDS[here[0]].onThisPage} and submit again.`;
  if (notHere.length) {
    out += ` This page has no field for ${notHere.map((f) => FIELD_WORDS[f].words).join(" or ")}, so an amendment that needs ${notHere.length === 1 ? "it" : "them"} cannot be filed from here — it has to be raised with Remote directly.`;
  }
  return out;
}

/**
 * The employee's and employer's recorded consents for one amendment — read
 * back from `audit_log`, which is where POST /api/consent writes them (the
 * amendment row has no consent column, on purpose: consent is not a gate).
 * Postgres when the logger has a pool, the in-memory entries otherwise; `null`
 * when the read itself failed, which the page states rather than rendering as
 * "nobody consented".
 */
const CONSENT_ACTIONS = Object.freeze({ amendment_employee_consented: "employee", amendment_employer_consented: "employer" });

async function listConsents(audit, amendmentId) {
  const shape = (party, by, at, note) => ({
    party,
    by: by ?? null,
    at: at instanceof Date ? at.toISOString() : at ?? null,
    note: note ?? null,
  });
  if (audit?.pgPool) {
    try {
      const { rows } = await audit.pgPool.query(
        `select at, action, actor, details from audit_log
          where use_case = 'UC-06' and action = any($1::text[]) and details->>'amendmentId' = $2
          order by at asc`,
        [Object.keys(CONSENT_ACTIONS), amendmentId]
      );
      return rows.map((r) => shape(CONSENT_ACTIONS[r.action], r.actor, r.at, r.details?.note));
    } catch (err) {
      console.error(`[remoteui] consent read for ${amendmentId} failed: ${err.message}`);
      return null;
    }
  }
  const entries = typeof audit?.forUseCase === "function" ? audit.forUseCase("UC-06") : [];
  return entries
    .filter((e) => CONSENT_ACTIONS[e.action] && e.details?.amendmentId === amendmentId)
    .map((e) => shape(CONSENT_ACTIONS[e.action], e.actor, e.at, e.details?.note));
}

/**
 * Who the two signatures belong to, said to THIS reader. The admin who filed
 * the request read "Customer Admin: not yet signed" on their own tracking page
 * and took it to mean their signature was the missing one — the person UC-06
 * refuses from that slot by name. One sentence per role, the same two facts.
 */
function signatoriesNote(role) {
  const both =
    "Slot 1 is the employer's signatory — a person other than whoever filed the request — and slot 2 is a Remote payroll " +
    "specialist. Both sign in Remote's support desk, not on this page.";
  if (role === ROLES.company_admin) return `Neither signature is yours: the person who files an amendment cannot sign it. ${both}`;
  if (role === ROLES.employee) return `Neither signature is yours: your consent is recorded separately and is not one of the two. ${both}`;
  return `Your consent on the company's behalf is recorded separately; the employer's signature is a different act. ${both}`;
}

/**
 * ONE field of the employment record, looked up the way UC-06 itself looks it
 * up: top level first, then `basic_information`, then `contract_details`.
 *
 * This mirrors `sourceValue()` in src/uc06/policyEngine.js deliberately. The
 * page prefills the CURRENT side of every "current → new" pair, and those
 * prefilled numbers are what a human then edits and submits, so the page must
 * read the record from the same three blocks the gates read it from. Reading
 * only the top level is how the form came to show a blank salary and a wrong
 * currency for every Dutch employment: `normalizeEmployment()` carries
 * Remote's own `contract_details` through untouched rather than flattening it,
 * so `annual_gross_salary` and `compensation_currency_code` live there and
 * `base_salary`/`currency` simply do not exist on those records.
 */
function recordField(employment, names) {
  for (const name of names) {
    for (const block of [employment, employment?.basic_information, employment?.contract_details]) {
      const value = block?.[name];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return null;
}

/** Fetch one employee's current contract values (money ÷100 to human units). */
async function readCurrentValues(remote, employmentId) {
  try {
    const emp = await remote.getEmployment(employmentId);
    if (!emp) return null;
    const rawSalary = recordField(emp, ["base_salary", "annual_gross_salary"]);
    const rawHours = recordField(emp, ["weekly_hours", "work_hours_per_week"]);
    // `work_hours_per_week` is the STRING "24" on one live NL record and the
    // NUMBER 40 on another — Remote's own inconsistency, reproduced by the
    // fixtures on purpose. Display coerces; nothing downstream reads this.
    const hours = typeof rawHours === "string" && rawHours.trim() !== "" ? Number(rawHours) : rawHours;
    return {
      salary: Number.isInteger(rawSalary) ? fromRemoteInteger(rawSalary) : rawSalary,
      // NEVER DEFAULTED. This used to read `emp.currency ?? "USD"`, which
      // prefilled USD for every employment whose currency lives in
      // `contract_details` — i.e. every Dutch one, all of which are paid in
      // EUR. That default does not stay on the screen: the page submits the
      // prefilled currency as `changes.salary.currency`, and policyEngine.js
      // writes it straight through to `compensation_currency_code` without
      // ever comparing it to the record. A guessed currency riding into a
      // payroll-affecting write is precisely what prime directive #1 forbids,
      // so an unreadable currency is now null and the form shows nothing
      // rather than showing a plausible wrong answer.
      currency: recordField(emp, ["currency", "compensation_currency_code"]),
      jobTitle: recordField(emp, ["job_title"]),
      weeklyHours: Number.isFinite(hours) ? hours : null,
      status: emp.status ?? null,
    };
  } catch {
    // A failed fact-gathering read must not take the whole page down — the
    // form just falls back to manually-typed values.
    return null;
  }
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}

/**
 * Mounted pages need a <base> so their relative asset and API URLs resolve
 * against the prefix instead of the domain root.
 *
 * This is why the pages here load `app.js` and fetch `api/submit` RELATIVELY
 * rather than from `/app.js` and `/api/submit`, as they used to. An absolute
 * path ignores <base>, so under `/remoteui` the browser would have asked the
 * deployment root for `/app.js` — a 404 from the router, on a page that renders
 * its shell perfectly and then does nothing. Same helper, same one-line shape,
 * as src/portal/, src/auditview/, src/approvalqueue/ and src/thirdparty/.
 */
export function withBaseHref(html, prefix) {
  if (!prefix) return html;
  return html.replace("<head>", `<head>\n<base href="${prefix}/" />`);
}


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the Remote UI stand-in on `port`. Returns the http.Server once listening.
 *  The port is passed in — never a literal here; src/shared/ports.js is the only
 *  place a port is written down (this signature carried a bare `4041` default
 *  until 2026-08-30, which is exactly the shape the registry exists to stop). */
export function startRemoteUiServer(deps, port) {
  const server = createServer(createRemoteUiHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
