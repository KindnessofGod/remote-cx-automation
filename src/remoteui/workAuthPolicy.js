// ---------------------------------------------------------------------------
// workAuthPolicy.js  —  The EMPLOYER's decision on a work-authorization request
// ---------------------------------------------------------------------------
// WHAT THIS IS A STAND-IN FOR, AND WHICH STAGE IT IS
//
// Remote's work-authorization flow has THREE stages and only the middle one is
// ours. Transcribed from developer.remote.com (verified live 2026-08-30), not
// inferred:
//
//   1. THE EMPLOYEE SUBMITS, inside Remote's own Request Hub. The schema says
//      a `WorkAuthorizationRequest` is "submitted by an employee" and `pending`
//      means "Submitted and awaiting manager review". There is NO create
//      endpoint: `POST /v1/work-authorization-requests` -> 404,
//      `POST /v1/employee/work-authorization-requests` -> 404, and Remote's
//      llms.txt carries 79 `post_…` pages, so an absent create is a pattern
//      rather than a gap.
//   2. THE CUSTOMER'S MANAGER DECIDES — this surface. Remote calls the decider
//      the `employer_approver` (its example email is `user0@company.com`, a
//      COMPANY address, not a Remote one) and gives the employer its own field
//      for its own words, `employer_special_instructions` ("Special
//      instructions from the employer"). The API accepts exactly two verdicts
//      here and nothing else — see EMPLOYER_VERBS below.
//   3. REMOTE'S OWN MOBILITY TEAM REVIEWS IT, producing `approved_by_remote`
//      ("Fully approved by both the manager and Remote") or
//      `declined_by_remote`. **There is no endpoint for stage 3 at all** — not
//      a permission this token lacks, an endpoint Remote does not publish. So
//      this system can neither perform stage 3 nor observe it, and STAGE_3_NOTE
//      below is the sentence that says so on the page rather than leaving a
//      reader to assume an approval here is the end of it.
//
// WHY A CLOSED TWO-VERB SET IS THE WHOLE POINT
// `UpdateWorkAuthorizationRequestParams` is `additionalProperties: false` over
// a `oneOf` with exactly two branches. Offering a third verb on the screen
// would be offering a decision the API cannot express — and this repository has
// already shipped exactly that defect once: src/uc04/workflow.js's header
// records a payload of `{status: "approved_by_remote", approved_by, approved_at,
// decision_reason}` that recorded REMOTE's approval of a trip Remote had never
// seen, and three fields the closed schema refuses. Every one of those passed
// the test suite, because the mock had been written from the code.
//
// PURE. No I/O, no clock, no store — the same shape as ./roles.js and
// src/uc06/dualApprovalPolicy.js, so each rule is unit-testable on its own and
// the server can never "decide" a boundary inline.
// ---------------------------------------------------------------------------

import { ROLES } from "./roles.js";

/** The action name the role matrix in ./roles.js gates. */
export const DECIDE_WORK_AUTHORIZATION_ACTION = "decide_work_authorization";

/**
 * The two verdicts Remote's PATCH accepts from an employer, and the exact
 * status each one writes.
 *
 * This map is the ONLY place a status string for this resource is written in
 * this directory. `approved_by_remote` and `declined_by_remote` are absent on
 * purpose and must stay absent: they are stage 3's, they are Remote's own
 * verdict, and there is no endpoint that sets them.
 */
export const EMPLOYER_VERBS = Object.freeze({
  approve: "approved_by_manager",
  decline: "declined_by_manager",
});

/** The two verbs, in the order the page offers them. */
export const EMPLOYER_ACTIONS = Object.freeze(Object.keys(EMPLOYER_VERBS));

/** Statuses only Remote can set. Named so a test can assert we never send one. */
export const REMOTE_ONLY_STATUSES = Object.freeze(["approved_by_remote", "declined_by_remote"]);

/**
 * The one status an employer may act on. Remote's gloss for `pending` is
 * "Submitted and awaiting manager review"; every other member of the enum names
 * an actor who has already answered.
 */
export const DECIDABLE_STATUS = "pending";

/** The three stages, for the page's own copy. Data, so one sentence exists once. */
export const STAGES = Object.freeze([
  Object.freeze({
    number: 1,
    actor: "The employee",
    where: "Remote's own Request Hub",
    what: "raises the work-authorization request",
    ours: false,
    api: "No create endpoint is published. POST /v1/work-authorization-requests answers 404, and so does the employee-scoped path.",
  }),
  Object.freeze({
    number: 2,
    actor: "The customer's manager (this screen)",
    where: "this employer surface",
    what: "approves or declines it",
    ours: true,
    api: "PATCH /v1/work-authorization-requests/{id} accepts exactly approved_by_manager and declined_by_manager.",
  }),
  Object.freeze({
    number: 3,
    actor: "Remote's Mobility Team",
    where: "inside Remote",
    what: "performs its own separate compliance review",
    ours: false,
    api: "No endpoint exists. approved_by_remote / declined_by_remote can be READ back off the record and can never be written by a caller.",
  }),
]);

/** The stage this surface is. */
export const CURRENT_STAGE = 2;

/**
 * What happens next, said plainly, because an employer approval reads like the
 * end of the process and is not one.
 *
 * Stated as a fact about REMOTE'S API rather than about our permissions: "we
 * can't do that yet" and "Remote publishes no endpoint for it" are different
 * claims, and CLAUDE.md §3's ladder exists because this repository has already
 * recorded the first when the second was true (three times, and two of the
 * three endpoints turned out to exist).
 */
export const STAGE_3_NOTE =
  "Approving here records the EMPLOYER's decision and nothing more. Remote's own Mobility Team then " +
  "performs a second, separate review, and only that review produces approved_by_remote — " +
  '"Fully approved by both the manager and Remote". Remote publishes no endpoint for that stage, so ' +
  "this system can neither perform it nor watch for it. The employee is not cleared to travel until " +
  "Remote has answered, and you will not learn Remote's answer here.";

/**
 * Build the PATCH body for one employer verdict, or refuse.
 *
 * Transcribed from `UpdateWorkAuthorizationRequestParams`, both branches:
 *   ApprovedWorkAuthozation  {status:"approved_by_manager",
 *                             employer_special_instructions?}   required:[status]
 *   DeclinedWorkAuthozation  {status:"declined_by_manager", reason,
 *                             employer_special_instructions?}   required:[status,reason]
 * (Remote's own schema titles carry the typo "Authozation". Copied, not
 * corrected — it is their identifier.)
 *
 * `reason` IS REQUIRED ON A DECLINE and this refuses rather than inventing one.
 * A required field filled with plausible text nobody wrote is a fabricated
 * record, which is the one thing the substitution ladder forbids outright.
 *
 * `employer_special_instructions` is sent only when there is something in it:
 * `additionalProperties: false` punishes a manufactured empty string exactly as
 * it punishes a manufactured field.
 *
 * @param {object} args
 * @param {string} args.action  "approve" | "decline"
 * @param {string} [args.reason]  the manager's reason — required on a decline
 * @param {string} [args.employerSpecialInstructions]  the employer's own words
 * @returns {{ok: true, payload: object}|{ok: false, status: number, code: string, reason: string}}
 */
export function buildDecisionPayload({ action, reason = "", employerSpecialInstructions = "" }) {
  // Own-property lookup (finding F-21's pattern): `action` arrives in a request
  // body, and `EMPLOYER_VERBS["constructor"]` would otherwise resolve through
  // the prototype chain to a truthy value that is not a status.
  if (typeof action !== "string" || !Object.hasOwn(EMPLOYER_VERBS, action)) {
    return {
      ok: false,
      status: 400,
      code: "unknown_action",
      reason:
        `The employer's decision must be one of: ${EMPLOYER_ACTIONS.join(", ")}. ` +
        "Remote's update schema is a closed oneOf over exactly two branches, so there is no third " +
        "verdict to offer. Remote's own approval (approved_by_remote) is stage 3 and has no endpoint at all.",
    };
  }

  const instructions = String(employerSpecialInstructions ?? "").trim();
  const payload = { status: EMPLOYER_VERBS[action] };

  if (action === "decline") {
    const given = String(reason ?? "").trim();
    if (!given) {
      return {
        ok: false,
        status: 400,
        code: "decline_reason_required",
        reason:
          "Remote requires a reason on a declined work authorization (DeclinedWorkAuthozation lists it as " +
          "required). Nothing here will invent one — the employee is owed the actual reason they were refused.",
      };
    }
    payload.reason = given;
  }

  if (instructions) payload.employer_special_instructions = instructions;
  return { ok: true, payload };
}

/**
 * MAY THIS SESSION DECIDE THIS REQUEST?
 *
 * Every input except `session` describes a record the caller ALREADY had to be
 * shown; `scope` is the company-scoped set the server resolved from the session
 * (see ./workAuthScope.js). Nothing here reads a company id, an employment id
 * or a role out of a request body, and there is no argument through which a
 * caller could supply one.
 *
 * FAILS CLOSED on every missing piece — no session, no record, an unresolved
 * scope, or a null on either side of the company comparison. Two nulls are not
 * a match: `null === null` passing for a verified identity is a defect this
 * repository has already paid for in four n8n gates.
 *
 * @param {object} args
 * @param {object|null} args.session  server-owned {role, companyId, authenticatedAdminId}
 * @param {string} args.action
 * @param {object|null} args.record   the work-authorization request, or null
 * @param {{companyId: string|null, recordIds: Set<string>|string[]}} args.scope
 */
export function evaluateEmployerDecision({ session, action, record, scope }) {
  if (!session) {
    return refusal(401, "unauthenticated", "No authenticated Remote UI session was supplied.");
  }
  if (session.role !== ROLES.company_admin) {
    return refusal(
      403,
      "role_not_authorized",
      "Stage 2 is the CUSTOMER's decision: Remote calls the decider the employer_approver and the " +
        "company's admin is who holds that seat here. An employee cannot approve their own travel, and " +
        "the employer-consent role is a signature on a contract amendment, not a work-authorization verdict."
    );
  }

  // The verb is checked before the record, so an unknown verb answers the same
  // way whether or not the id resolves — a caller must not be able to probe
  // which ids exist by varying the action.
  const built = buildDecisionPayload({ action });
  if (!built.ok && built.code === "unknown_action") {
    return refusal(built.status, built.code, built.reason);
  }

  if (!record) {
    return refusal(404, "work_authorization_not_found", "No work-authorization request exists with this id.");
  }

  const ids = scope?.recordIds instanceof Set ? scope.recordIds : new Set(scope?.recordIds ?? []);
  if (!ids.has(record.id)) {
    return refusal(
      403,
      "not_your_company",
      "This work-authorization request belongs to an employment outside your company. The set of requests " +
        "you may decide is resolved from your session's company, never from the id you supplied — knowing " +
        "an id entitles nobody to decide it."
    );
  }

  if (record.status !== DECIDABLE_STATUS) {
    return refusal(
      409,
      "not_awaiting_manager",
      `This request is \`${record.status}\`, not \`${DECIDABLE_STATUS}\`. Only a request awaiting manager ` +
        "review can carry an employer decision; every other status names an actor who has already answered."
    );
  }

  return {
    allowed: true,
    status: 200,
    code: "decision_permitted",
    reason: "You are the company admin for this employment, and the request is awaiting a manager.",
  };
}

function refusal(status, code, reason) {
  return { allowed: false, status, code, reason };
}
