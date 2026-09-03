// ---------------------------------------------------------------------------
// ownership.js  —  what "mine" means, per persona and per request type
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS A SEPARATE FILE
// `GET /api/my-requests` used to read a process-local array that was pushed to
// at submission time, so "mine" meant "filed by this persona key, in this
// process". That answer is gone: the list is now derived from the seven
// durable stores, which is the only way a request can still be found after the
// process that took it has ended — which on the Vercel deployment is after
// every single request. Deriving it from the stores means asking the stores a
// question, and the question has to name an owner. This file decides what that
// owner is.
//
// THE RULE IT ENFORCES IS CLAUDE.md PRIME DIRECTIVE #3, one layer up from where
// the workflows enforce it: identity comes from an authenticated signal, never
// a claim. Every scope below is built from ./personas.js's server-owned map —
// the employment id the portal believes the caller IS, or the admin id the
// portal believes they are acting AS. Nothing in a request body reaches this
// file. A scope that cannot be built that way is not built at all: the route
// lists nothing for that pairing and reports why, rather than falling back to
// an employment id somebody typed into a form.
//
// WHY THE PAIRINGS BELOW ARE NOT SYMMETRIC
// The three kinds of request in this portal have three different owners, and
// they are genuinely different questions:
//
//   - SELF-SERVICE (UC-01 verification letter, UC-02 expense, UC-03 travel,
//     UC-05 resignation). Filed by the employee about themselves. The
//     record's `employment_id` IS the filer, so employment is the scope.
//     src/portal/server.js's adapters refuse these from an admin persona
//     outright, so an admin scope would be a scope for requests that cannot
//     exist.
//
//   - ON-BEHALF-OF (UC-09 payroll adjustment). Filed by a company admin ABOUT
//     an employee. Scoping these by employment would show the admin nothing —
//     their own employment id is null, and the record's belongs to somebody
//     else. The record carries `requester`
//     (= session.authenticatedAdminId, set by the workflow itself, never by
//     the form), so that is the scope.
//
//   - EITHER (UC-04 workation). Since 2026-08-30 a work-authorization request
//     can be filed BY THE EMPLOYEE about their own trip (Remote's own primary
//     actor for it) or by a company admin on their behalf, so this type has two
//     owners and needs a rule per persona kind rather than one per type. See
//     the block above SELF_OR_ON_BEHALF_OF for the disclosure decision.
//
//   - DOSSIERS (UC-07, UC-08). 🔴, and the odd ones out in a way that matters.
//     Their stores have no `requester` column at all — a dossier records the
//     employment it is ABOUT and nothing about who asked. So an employee sees
//     dossiers on their own record, and an ADMIN persona sees none, because
//     there is nothing on the row that ties one to their session. The honest
//     move there is to say so, which the route does, rather than to scope on
//     the employment id the admin typed into the form: that is a claim in a
//     request body, and this file exists to not do that.
//
// A pure table with no I/O, no store and no http, for the same reason
// ./requestStatus.js is one — and it holds no policy in the gate sense either.
// Nothing here decides whether an action is permitted; it decides which rows a
// caller is allowed to SEE. If this file were deleted, no gate anywhere would
// behave differently; the status page would simply have no rows to draw.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} OwnerScope
 * @property {boolean} scoped   can this pairing be scoped from the session alone?
 * @property {object|null} query  the argument for `store.listByOwner()`
 * @property {string|null} reason  when `scoped` is false, why — shown to the
 *   caller, because "not listed" and "you filed none" are different facts and
 *   only one of them is safe to act on
 */

/** Filed by the employee, about themselves. */
const SELF_SERVICE = new Set(["uc01", "uc02", "uc03", "uc05"]);

/** Filed by a company admin, about an employee. */
const ON_BEHALF_OF = new Set(["uc09"]);

/**
 * Filed EITHER by the employee about their own trip OR by a company admin on
 * their behalf — UC-04, and only UC-04 (see src/uc04/submissionIdentity.js).
 *
 * THE EMPLOYEE'S SCOPE IS THE TIGHTER OF THE TWO CANDIDATES, DELIBERATELY.
 * Two readings of "mine" were available here and they are not the same
 * question:
 *
 *   (a) rows I FILED           -> requester = my employment id
 *   (b) rows ABOUT ME          -> employment_id = my employment id
 *
 * (b) is WIDER, and widening what a page shows is a disclosure change, not a
 * convenience: it would put every workation assessment a company admin filed
 * about that employee — including one they may not know exists, with the
 * admin's own id, the risk level and the drafted summary on it — onto the
 * employee's history page, on the strength of a UI decision nobody reviewed.
 * That may well be the right product call, and it is one for a human to make
 * (there is no consent record and no policy anywhere in this repo that says an
 * employee may read their employer's mobility assessment of them). Until then
 * this scopes on BOTH columns ANDed — filed by me, about me — which is the
 * only shape an employee can create through this portal anyway, so nothing
 * they filed is hidden by it.
 *
 * The AND matters for a second reason. `requester` and `employment_id` hold
 * ids from two different spaces (an admin id, an employment id), and scoping on
 * `requester` alone would trust that they can never collide. They do not today
 * — admin ids read `admin_jane` — but "these two namespaces never overlap" is
 * exactly the kind of invariant nothing enforces and one seed file can break.
 */
const SELF_OR_ON_BEHALF_OF = new Set(["uc04"]);

/** 🔴 dossiers: no requester is recorded anywhere on the row. */
const DOSSIERS = new Set(["uc07", "uc08"]);

/**
 * `cases` is shared between UC-01 and UC-03, so EITHER's rows are only
 * identifiable with the use case in the scope — leaving it off UC-01 would
 * hand an employee's own verification-letter case back as one of their UC-03
 * travel requests (or vice versa), where describeStatus() reads it against
 * the wrong vocabulary and reports "unknown". Stated here rather than in the
 * route because it is part of the answer to "which rows are this request
 * type's" — see CaseStore.listByOwner()'s header for what goes wrong without
 * it.
 */
const SHARED_TABLE_USE_CASE = { uc01: "UC-01", uc03: "UC-03" };

/**
 * What does "mine" mean, for this persona and this request type?
 *
 * @param {import("./personas.js").Persona|null} persona  ALREADY RESOLVED from
 *   the server-owned map. A persona key straight off the query string must be
 *   run through resolvePersona() first; this function never sees a raw claim.
 * @param {string} typeId  "uc02" … "uc09"
 * @returns {OwnerScope}
 */
export function ownerScopeFor(persona, typeId) {
  if (!persona) {
    return unscoped("No session. The portal lists requests for an authenticated persona only.");
  }

  if (SELF_SERVICE.has(typeId)) {
    if (persona.kind !== "employee" || !persona.employmentId) {
      return unscoped(
        "Filed by the employee it is about, so there is nothing an admin session could own here — the portal refuses these from an admin at intake too."
      );
    }
    return scoped({ employmentId: persona.employmentId, ...useCaseFor(typeId) });
  }

  if (SELF_OR_ON_BEHALF_OF.has(typeId)) {
    if (persona.kind === "employee") {
      if (!persona.employmentId) {
        return unscoped(
          "This session names no employment record, so there is nothing it could have filed about itself."
        );
      }
      // Filed by me, about me — both, ANDed. See the set's header for why the
      // wider "everything about me" reading was NOT taken.
      return scoped({ employmentId: persona.employmentId, requester: persona.employmentId });
    }
    const filerId = persona.kind === "company_admin" ? persona.session?.authenticatedAdminId : null;
    if (!filerId) {
      return unscoped(
        "Filed by the travelling employee or by a company admin on their behalf. This session is neither, so it owns none of these."
      );
    }
    return scoped({ requester: filerId });
  }

  if (ON_BEHALF_OF.has(typeId)) {
    const adminId = persona.kind === "company_admin" ? persona.session?.authenticatedAdminId : null;
    if (!adminId) {
      return unscoped(
        "Filed by a company admin on an employee's behalf. The record names the admin who filed it, not the employee's own session, so an employee session owns none of these."
      );
    }
    return scoped({ requester: adminId });
  }

  if (DOSSIERS.has(typeId)) {
    if (!persona.employmentId) {
      // The one honest "we cannot answer this". See the header.
      return unscoped(
        "A dossier records the employment it is about and nothing about who asked, so nothing on the row ties one to an admin session. Scoping on the employment id typed into the form would be scoping on a claim in a request body, which is exactly what an identity check must not do. Open the dossier by its own id instead."
      );
    }
    return scoped({ employmentId: persona.employmentId });
  }

  return unscoped(`No ownership rule exists for ${typeId}.`);
}

function scoped(query) {
  return { scoped: true, query, reason: null };
}

function unscoped(reason) {
  return { scoped: false, query: null, reason };
}

function useCaseFor(typeId) {
  const useCase = SHARED_TABLE_USE_CASE[typeId];
  return useCase ? { useCase } : {};
}
