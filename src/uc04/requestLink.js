// ---------------------------------------------------------------------------
// requestLink.js  —  Which Remote work-authorization request is this decision
//                    ABOUT? (and the honest answer when there isn't one)
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
//
// UC-04 used to CREATE the record it decided on: `handleWorkationRequest()`
// called `remote.createWorkAuthorization()` on every `ready_for_approval` and
// every `escalate`, then swallowed the failure with a `console.error`. There is
// no `POST /v1/work-authorization-requests` — Remote's own schemas say why (a
// `WorkAuthorizationRequest` is *"submitted by an employee"*, `pending` means
// *"awaiting manager review"*, there is a `work_authorization.requested`
// webhook, and the update body is a closed `oneOf` over `approved_by_manager` /
// `declined_by_manager`). The contract is CREATE-BY-EMPLOYEE, DECIDE-BY-API.
// See `docs/REMOTE-VOCABULARY.md` §13.1 and `docs/BUILD-LOG.md` §3.62.
//
// So UC-04's input is not a request it raises. It is a request that ALREADY
// EXISTS in Remote — arriving as an id on the `work_authorization.requested`
// webhook — and its output is a verdict PATCHed back onto it. This module is the
// one place that answers "which request is that, and are we sure?".
//
// THREE STATES, AND THE DISTINCTION BETWEEN THE LAST TWO IS THE WHOLE POINT
//
//   linked      Remote has this request, it is `pending`, and its destination
//               matches the trip the gates just judged. The decision has a
//               counterpart and the PATCH has a target.
//   unlinked    Remote answered, authoritatively, that there is no such request
//               (the portal's ordinary case — a persona files through our own
//               form, and no employee has raised anything in the Request Hub).
//               An ANSWER. Nothing is wrong; the decision simply has no Remote
//               counterpart, and the record says so.
//   unresolved  We could not establish WHICH request this is — the read failed,
//               or the request is no longer pending, or the destination on the
//               Remote record is not the destination we judged, or two pending
//               requests both fit. A FAILURE, and one that must never be
//               resolved by guessing: PATCHing a request we did not identify
//               approves a trip nobody reviewed.
//
// That split mirrors `src/shared/upstreamFailure.js` exactly — "Remote says no"
// and "we could not ask" are different facts with different fixes, and this repo
// has already paid once for recording them as the same thing.
//
// FAIL-CLOSED BY CONSTRUCTION. Nothing here can approve anything. The only
// decision change it can produce is `ready_for_approval -> escalate` (see
// `workflow.js`), so a resolution failure can downgrade a request into human
// hands and can never do the reverse.
//
// WHY NOT JUST REFUSE A REQUEST WITH NO REMOTE ID? Because that would make
// every portal submission fail, and UC-04 would become a use case that can only
// ever be observed refusing — the exact shape `docs/BUILD-LOG.md` §3.30 records
// as this project's most expensive failure mode, where "structurally cannot
// succeed" and "appropriately cautious" are indistinguishable from outside. The
// gates, the risk matrix and the specialist's judgement are worth having whether
// or not Remote holds a matching row; what must never happen is the system
// implying a Remote record exists when none does.
//
// WHY NOT MINT ONE, THE WAY src/remoteui/ STANDS IN FOR THE AMENDMENT UI?
// `src/remoteui/` stands in for a product SURFACE and then creates a genuinely
// real artifact (a Zendesk ticket) that a human can open. The stand-in pattern
// needs a real downstream to land in. Here the artifact would have to be a
// Remote work-authorization request, and no API anywhere can create one — so a
// stand-in would have nothing to stand in with, and its "id" would be a
// fabrication carried into an audit row. That is the defect being removed, one
// layer down.
// ---------------------------------------------------------------------------

/** Remote has the request, it is decidable, and it is the one we judged. */
export const LINK_LINKED = "linked";
/** Remote answered: there is no such request. Normal for portal intake. */
export const LINK_UNLINKED = "unlinked";
/** We could not establish which request this is. Never guess past this. */
export const LINK_UNRESOLVED = "unresolved";

/** The one status a caller may act on — `pending` is "awaiting manager review". */
export const DECIDABLE_STATUS = "pending";

/**
 * Resolve the Remote work-authorization request a UC-04 decision is about.
 *
 * @param {object} args
 * @param {import("../remote/restClient.js").RemoteClient} args.remote
 * @param {string|null} [args.workAuthorizationId]
 *   the id from the `work_authorization.requested` webhook, when there is one
 * @param {string|null} [args.employmentId]
 * @param {string|null} [args.destinationCountry]
 *   the CANONICAL alpha-2 the gates judged, not the raw string a requester typed
 * @returns {Promise<{
 *   state: string, id: string|null, request: object|null,
 *   reason: string, detail: string, upstream: object|null
 * }>}
 */
export async function resolveWorkAuthorizationRequest({
  remote,
  workAuthorizationId = null,
  employmentId = null,
  destinationCountry = null,
}) {
  const wanted = normalizeCountry(destinationCountry);

  if (workAuthorizationId) {
    let request;
    try {
      request = await remote.getWorkAuthorization(workAuthorizationId);
    } catch (err) {
      // The REST client returns null on 404 and THROWS on everything else, so a
      // throw here is a 403 / 5xx / transport failure: the request was never
      // evaluated and nothing about it is knowable.
      return unresolved({
        id: workAuthorizationId,
        reason: "work_authorization_unreachable",
        detail: `Remote could not be asked about work-authorization request ${workAuthorizationId}: ${err.message}`,
        upstream: { call: "work_authorization", kind: "unreachable", status: null, message: String(err.message).slice(0, 200) },
      });
    }
    if (!request) {
      // A 404 on an id we were HANDED is not the portal's "nobody raised one";
      // it is an id that should have resolved and did not. Unresolved, not
      // unlinked — an answer about a record we were told exists.
      return unresolved({
        id: workAuthorizationId,
        reason: "work_authorization_not_found",
        detail: `Remote has no work-authorization request ${workAuthorizationId}. The id this request arrived with does not resolve.`,
        upstream: { call: "work_authorization", kind: "not_found", status: 404, message: "work authorization request not found" },
      });
    }
    if (request.status !== DECIDABLE_STATUS) {
      return unresolved({
        id: workAuthorizationId,
        request,
        reason: "work_authorization_not_pending",
        detail:
          `Work-authorization request ${workAuthorizationId} is \`${request.status}\`, not \`pending\`. ` +
          "Only a request awaiting manager review can carry an employer decision.",
      });
    }
    const mismatch = destinationMismatch(request, wanted);
    if (mismatch) return unresolved({ id: workAuthorizationId, request, ...mismatch });
    return linked(request);
  }

  // --- No id in hand. Resolve by employment, or answer honestly that there is
  // nothing to resolve. `employment_id` and `status` are documented filters on
  // Remote's own list endpoint, so this is a lookup, not a heuristic.
  if (!employmentId) {
    return unlinked({
      reason: "no_remote_work_authorization_request",
      detail:
        "This request arrived with no Remote work-authorization id and no employment to look one up by, " +
        "so it has no Remote counterpart. The decision below is recorded here and nowhere else.",
    });
  }

  let candidates;
  try {
    candidates = await remote.listWorkAuthorizations({ employmentId, status: DECIDABLE_STATUS });
  } catch (err) {
    return unresolved({
      reason: "work_authorization_unreachable",
      detail: `Remote could not be asked for this employee's pending work-authorization requests: ${err.message}`,
      upstream: { call: "work_authorization_list", kind: "unreachable", status: null, message: String(err.message).slice(0, 200) },
    });
  }

  if (!candidates.length) {
    return unlinked({
      reason: "no_pending_work_authorization_request",
      detail:
        // The second sentence used to add "; nothing here can create one" —
        // our own API limitation, addressed to a reader who did not ask about
        // our API. The fact that matters to them is who raises it.
        "Remote holds no pending work-authorization request for this employee, so this decision has no Remote " +
        "counterpart. A request is raised by the employee in Remote's own Request Hub.",
    });
  }

  // Destination is the ONE fact allowed to disambiguate, and it is required
  // rather than optional: two pending trips for the same person are two
  // different requests, and matching on the employee alone would attach this
  // verdict to whichever happened to come back first.
  if (!wanted) {
    return unresolved({
      reason: "work_authorization_ambiguous",
      detail:
        `Remote holds ${candidates.length} pending work-authorization request(s) for this employee, and this ` +
        "request carries no readable destination to tell them apart.",
    });
  }
  const matches = candidates.filter((row) => countryOf(row) === wanted);
  if (matches.length === 1) return linked(matches[0]);
  if (matches.length > 1) {
    return unresolved({
      reason: "work_authorization_ambiguous",
      detail:
        `Remote holds ${matches.length} pending work-authorization requests for this employee to ${wanted}. ` +
        "Which one this decision belongs to cannot be established, and guessing would record a verdict against a trip nobody reviewed.",
    });
  }
  return unlinked({
    reason: "no_matching_work_authorization_request",
    detail:
      `Remote holds ${candidates.length} pending work-authorization request(s) for this employee, none of them to ` +
      `${wanted}. This decision has no Remote counterpart.`,
  });
}

/**
 * Does the Remote record describe the same destination the gates judged?
 * `destination_country` is a full `Country` object on the real API — never a
 * bare code, whatever this repo's old fixtures implied.
 */
function destinationMismatch(request, wanted) {
  const onRecord = countryOf(request);
  if (!wanted || !onRecord || onRecord === wanted) return null;
  return {
    reason: "work_authorization_destination_mismatch",
    detail:
      `Work-authorization request ${request.id} is for ${onRecord}, but the gates judged a trip to ${wanted}. ` +
      "Recording this verdict against that request would approve a trip that was never assessed.",
  };
}

function countryOf(request) {
  const country = request?.destination_country;
  if (!country) return null;
  if (typeof country === "string") return normalizeCountry(country);
  return normalizeCountry(country.alpha_2_code);
}

function normalizeCountry(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

function linked(request) {
  return {
    state: LINK_LINKED,
    id: request.id ?? null,
    request,
    reason: "work_authorization_linked",
    detail: `Linked to Remote work-authorization request ${request.id}, currently \`${request.status}\`.`,
    upstream: null,
  };
}

function unlinked({ reason, detail }) {
  return { state: LINK_UNLINKED, id: null, request: null, reason, detail, upstream: null };
}

function unresolved({ id = null, request = null, reason, detail, upstream = null }) {
  return { state: LINK_UNRESOLVED, id, request, reason, detail, upstream };
}
