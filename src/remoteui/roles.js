// ---------------------------------------------------------------------------
// roles.js  —  Who may submit what in the Remote UI stand-in (issue #34)
// ---------------------------------------------------------------------------
// The stand-in models three genuinely separate actors, each with its own
// server-side session; the role comes from that authenticated session, never
// from a claim in the request body (CLAUDE.md prime directive #3). This file
// is the pure authorization matrix those gates are built on — no I/O, same
// pattern as src/uc06/dualApprovalPolicy.js, so every rule is unit-testable
// in isolation and the server can never "decide" authorization inline.
//
// WHY THESE ACTIONS — grounded in UC-06, not invented:
//   - company_admin may submit an amendment REQUEST. The canonical spec
//     (docs/use-cases/UC-06.md §1/§2) names the customer admin as the primary
//     actor and the trigger, and its research source (UC-06 ChatGpt v1 §6,
//     "Customer Admin — Initiates amendment", plus §5's "Only the company
//     owner and super admins can submit and view") confirms requesting is a
//     company-side act that the admin performs on the company's behalf.
//   - employee may CONSENT to an amendment of their OWN contract. v1's actor
//     table: "Employee — Reviews/signs amendment where required", and its
//     status machine has awaiting_employee_signature ("Employee action
//     required"). An employee initiating an amendment to their own contract
//     would let a worker change their own comp — exactly what the admin-driven
//     trigger exists to prevent.
//   - employer (the company representative, distinct from the admin USER who
//     operates the console) may CONSENT on the company's behalf — v1's
//     employer_signed_at / awaiting_employer_signature ("Employer action
//     required"). Requesting is NOT an employer action here: v1 restricts
//     requesting to the company owner/super admins, which is the company_admin
//     role in this model.
//   - Consent is the employee's or employer's act, never the admin's: the
//     admin's control point in UC-06 is the dual APPROVAL in the ZAF sidebar
//     (UC-06.md §8), not a signature. So a company-admin session attempting a
//     consent is refused just as firmly as an employee attempting a request.
// ---------------------------------------------------------------------------

export const ROLES = Object.freeze({
  company_admin: "company_admin",
  employer: "employer",
  employee: "employee",
});

// The two parties who consent to a contract amendment (v1's signature model).
export const CONSENT_PARTIES = Object.freeze({
  employee: "employee",
  employer: "employer",
});

export const SUBMIT_ACTION = "submit_amendment_request";
export const CONSENT_ACTION = "consent_amendment";

/**
 * READING an amendment's current state. Deliberately not in ROLE_ACTIONS
 * below: that map answers "may this role ACT?", and every entry in it changes
 * something. Watching a request you are party to changes nothing, is available
 * to all three roles, and is gated by WHOSE amendment it is rather than by
 * what the role may do — see evaluateAmendmentVisibility().
 */
export const TRACK_ACTION = "track_amendment";

const ROLE_ACTIONS = Object.freeze({
  [ROLES.company_admin]: new Set([SUBMIT_ACTION]),
  [ROLES.employer]: new Set([CONSENT_ACTION]),
  [ROLES.employee]: new Set([CONSENT_ACTION]),
});

/**
 * May this role perform this submission action at all?
 *
 * `Object.hasOwn` rather than a bare `ROLE_ACTIONS[role]` (finding F-21's
 * pattern, audited across the repo): `role` comes from a request, and
 * `ROLE_ACTIONS["constructor"]` resolves through the prototype chain to
 * `Object`, which is truthy — the old expression then called `.has(action)`
 * on it and threw a TypeError from inside the request handler instead of
 * answering "no".
 */
export function canRoleSubmit(role, action) {
  if (typeof role !== "string" || !Object.hasOwn(ROLE_ACTIONS, role)) return false;
  return ROLE_ACTIONS[role].has(action);
}

/**
 * Pure consent verdict, same refusal shape as dualApprovalPolicy.js.
 * `amendment` and `employment` are fetched by the caller through its I/O;
 * everything here is deterministic policy.
 * @param {object} args
 * @param {object} args.session    authenticated session {role, companyId, employmentId?}
 * @param {"employee"|"employer"} args.party  whose consent this submission claims to be
 * @param {object|null} args.amendment  the amendment being consented to
 * @param {object|null} args.employment  the amendment's employment record (employer consent only)
 */
export function evaluateConsentAuthorization({ session, party, amendment, employment }) {
  if (!amendment) {
    return { allowed: false, status: 404, code: "amendment_not_found", reason: "No amendment exists with this id." };
  }
  if (![CONSENT_PARTIES.employee, CONSENT_PARTIES.employer].includes(party)) {
    return {
      allowed: false,
      status: 400,
      code: "unknown_party",
      reason: "party must be 'employee' or 'employer' — the two parties who consent to a contract amendment.",
    };
  }
  if (!canRoleSubmit(session.role, CONSENT_ACTION)) {
    return {
      allowed: false,
      status: 403,
      code: "role_not_authorized",
      reason: "Consent is the employee's or employer's act, not the customer admin's — the admin's control point is the dual approval in the sidebar.",
    };
  }
  if (session.role !== party) {
    return {
      allowed: false,
      status: 403,
      code: "role_not_authorized",
      reason:
        party === CONSENT_PARTIES.employee
          ? "Only the employee can consent to an amendment of their own contract — the employer cannot consent for them."
          : "Only the employer can consent on the company's behalf — the employee cannot consent for the employer.",
    };
  }
  if (party === CONSENT_PARTIES.employee) {
    if (amendment.employmentId !== session.employmentId) {
      return {
        allowed: false,
        status: 403,
        code: "not_your_amendment",
        reason: "An employee may only consent to an amendment of their own contract.",
      };
    }
  } else if (!employment || employment.company_id !== session.companyId) {
    return {
      allowed: false,
      status: 403,
      code: "not_your_amendment",
      reason: "The employer may only consent to an amendment for one of its own employees.",
    };
  }
  return { allowed: true, status: 200, code: "consent_permitted", reason: `Consent recorded as the ${party}.` };
}

/**
 * MAY THIS SESSION SEE WHAT HAPPENED TO THIS AMENDMENT?
 *
 * A read, not an act — nothing this verdict permits changes anything, and the
 * route it guards offers no approve, no deny, no consent. What it decides is
 * scope: which rows a caller is allowed to SEE, which is the same question
 * src/portal/ownership.js answers for the portal and it is answered the same
 * way — from the SERVER-OWNED SESSION, never from a value in the request. The
 * amendment id in the URL is not an identity claim and is not treated as one:
 * knowing a UUID entitles nobody to read a contract change.
 *
 * WHY THE THREE ROLES SCOPE DIFFERENTLY, and why that asymmetry is the point:
 *
 *   - company_admin — the row records `requester`, which handleAmendmentRequest()
 *     sets from `session.authenticatedAdminId` and no form can reach. An admin
 *     sees the amendments THEY requested. Not every amendment in the company:
 *     the row carries no company id of its own to compare against, and reading
 *     one off the employment record to widen the scope would be widening it on
 *     the strength of a record the caller named.
 *   - employee — sees amendments to THEIR OWN contract, matched on
 *     `session.employmentId`. This is the same predicate their consent is
 *     gated by, and it is the one people notice missing first: an employee
 *     asked to sign a change to their own terms and then told nothing.
 *   - employer — consents on the company's behalf, so the scope is the
 *     EMPLOYMENT'S company, read from the employment record exactly as the
 *     consent path already reads it. The caller supplies no company id.
 *
 * FAILS CLOSED on every missing piece: no session, no amendment, an employment
 * that could not be read, or a null on either side of a comparison. Two nulls
 * are not a match — `null === null` passing for a verified identity is a real
 * defect this repo has already paid for in four n8n gates (CLAUDE.md §5), and
 * an admin whose session carries no id must not thereby see every amendment
 * whose requester is also null.
 *
 * @param {object} args
 * @param {object|null} args.session   authenticated session {role, companyId, employmentId?, authenticatedAdminId?}
 * @param {object|null} args.amendment the amendment being read
 * @param {object|null} args.employment the amendment's employment record (employer only)
 */
export function evaluateAmendmentVisibility({ session, amendment, employment }) {
  if (!session) {
    return {
      allowed: false,
      status: 401,
      code: "unauthenticated",
      reason: "No authenticated Remote UI session was supplied.",
    };
  }
  if (!amendment) {
    return { allowed: false, status: 404, code: "amendment_not_found", reason: "No amendment exists with this id." };
  }

  if (session.role === ROLES.company_admin) {
    if (!matches(amendment.requester, session.authenticatedAdminId)) {
      return notYours("An admin sees the amendments they requested. This one was requested by someone else.");
    }
    return visible("You requested this amendment.");
  }

  if (session.role === ROLES.employee) {
    if (!matches(amendment.employmentId, session.employmentId)) {
      return notYours("An employee sees amendments to their own contract only.");
    }
    return visible("This is an amendment to your own contract.");
  }

  if (session.role === ROLES.employer) {
    if (!employment) {
      return {
        allowed: false,
        status: 403,
        code: "scope_unavailable",
        reason:
          "The employment record behind this amendment could not be read, so there is nothing to check the company against. Refusing rather than showing it: an unreadable scope is not an empty one.",
      };
    }
    if (!matches(employment.company_id, session.companyId)) {
      return notYours("The employer sees amendments for its own employees only.");
    }
    return visible("This amendment is for one of your company's employees.");
  }

  return notYours("This session's role has no view of amendments.");
}

/** Both sides present and equal. A null on either side is never a match. */
function matches(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function visible(reason) {
  return { allowed: true, status: 200, code: "amendment_visible", reason };
}

function notYours(reason) {
  return { allowed: false, status: 403, code: "not_your_amendment", reason };
}
