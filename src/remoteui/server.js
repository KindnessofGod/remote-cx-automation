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
import { NO_AMENDMENT_FORM_EMPLOYMENTS } from "./employees.js";
import { readJsonBody } from "../shared/httpBody.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ASSETS = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
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
const DEMO_SESSIONS = {
  admin: { role: ROLES.company_admin, companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
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

const SESSION_HEADER = "x-remoteui-session";

// Own-property lookup only (finding F-21's pattern). The session key is an
// attacker-controlled header: `X-RemoteUi-Session: constructor` used to
// resolve to `Object` through the prototype chain — a truthy "session" with
// no role, which is precisely the shape the role gate then has to reason
// about. An unknown key must be null, and null fails closed downstream.
function resolveSession(req) {
  const key = req.headers[SESSION_HEADER];
  if (typeof key !== "string" || !Object.hasOwn(DEMO_SESSIONS, key)) return null;
  return DEMO_SESSIONS[key];
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
}) {
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

      // GET /api/employees — who the admin can submit for, with their CURRENT
      // contract values (fetched from Remote so the form never hard-codes
      // them). This is the fact-gathering read, done up front exactly as the
      // real webhook path would; money comes back ÷100, human units.
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
        const session = resolveSession(req);
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
            source: "remoteui",
          },
          { remote, audit, amendmentStore, draftSummary: draftSummaryFn, judge }
        );

        // --- STEP 2: only now does a Zendesk ticket exist ------------------
        // Pre-tagged with the decision's outcome tag, pre-populated with the
        // drafted summary + amendment id, so the shared ZAF sidebar can host
        // the dual-approval flow with everything already gathered.
        const ticket = await zendesk.createTicket({
          subject: `Contract amendment request — ${employee.name}`,
          comment: { body: buildInternalNote(result), public: false },
          requester: { name: employee.name, email: employee.email },
          tags: outcomeTags(result.decision),
          custom_fields: [{ id: Number(employmentIdFieldId), value: employee.id }],
        });
        await amendmentStore.flush(); // let the amendment's own background write land first (pgPool only)
        await amendmentStore.linkTicket(result.amendmentId, String(ticket.id));

        // Actionability is the real policy's answer, not the page's guess:
        // only a `dual_approval_required` amendment is open to the two-role
        // approve flow; an escalated one is visible but not actionable.
        const actionability = evaluateAmendmentActionability({
          amendmentRow: await amendmentStore.findById(result.amendmentId),
        });

        return send(res, 200, {
          ok: true,
          ticketId: ticket.id,
          amendmentId: result.amendmentId,
          decision: result.decision,
          reason: result.reason,
          amendmentType: result.amendmentType,
          flags: result.flags,
          summary: result.summary,
          tags: outcomeTags(result.decision),
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          explanation: explainRefusal(result, employee.id),
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
        const session = resolveSession(req);
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
          readOnly: true,
          // Carried in the payload and not only in the page's copy, so the
          // boundary travels with the data to anything else that reads this.
          note:
            "Read-only. This page shows what happened to an amendment; it never offers a control that could decide one. The two approvals happen in the ZAF sidebar, where dual control requires two different people.",
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
        const session = resolveSession(req);
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

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[remoteui] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * The ticket's internal note — the "pre-populated" part of the authored
 * ticket: decision, reason, flags, drafted summary, and the amendment id a
 * specialist needs to find the record. Deterministic text, mirroring the
 * case-assist template UC-01 posts; never LLM-authored in this path.
 */
function buildInternalNote(result) {
  const lines = [
    "UC-06 contract amendment intake (Remote UI stand-in).",
    "",
    result.summary,
    "",
    `Decision: ${result.decision}${result.reason ? ` (${result.reason})` : ""}`,
  ];
  if (result.flags && result.flags.length) lines.push(`Flags: ${result.flags.join(", ")}`);
  lines.push(`Amendment: ${result.amendmentId}`);
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
export function explainRefusal(result, employmentId) {
  if (!result || result.reason !== "country_schema_unavailable") return null;
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


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the Remote UI stand-in on `port`. Returns the http.Server once listening. */
export function startRemoteUiServer(deps, port = 4041) {
  const server = createServer(createRemoteUiHandler(deps));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
