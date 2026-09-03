// ---------------------------------------------------------------------------
// linkedRequest.js  —  Reading the Remote work-authorization request this
//                      decision is ABOUT, at the moment the panel is opened
// ---------------------------------------------------------------------------
// THE DEFECT THIS CLOSES, IN ONE LINE: the panel printed "no document" about a
// request that carries a travel document number.
//
// `requestLink.js` resolves which Remote work-authorization request a decision
// belongs to, at DECISION time, and keeps only its id (`work_authorization_id`
// on `uc04_authorizations`). Everything else Remote returned about it —
// `travel_document_number`, `work_location`, `will_negotiate_or_sign_contracts`,
// `reason`, `additional_information`, `submitted_at` — was read and dropped.
// Meanwhile the immigration dimension told a specialist that the only thing the
// request holds is a visa TYPE the requester selected from a dropdown, and its
// own `whatItWouldTake` named `travel_document_number` as the field that would
// improve it. The field was already being fetched. Nobody kept it.
//
// WHY A LIVE READ AND NOT A COLUMN. The scoped fix (W-1,
// docs/UC04-DECISION-SURFACE.md) was a migration adding two columns. This is
// better on every axis that matters here and cheaper on the one that does not:
//
//   · NO MIGRATION. `uc04_authorizations` is provisioned by hand
//     (docs/SETUP-CHECKLIST.md) and Supabase is unreachable over raw TCP from a
//     coding session (CLAUDE.md §6). A column the deployment does not have is a
//     field the store silently drops — which is the exact half-done shape
//     workflow.js already refused for `remote_request` and `reason_text`.
//   · A SNAPSHOT CANNOT ANSWER "WHAT DOES REMOTE SAY NOW". The employer may
//     have edited the request, withdrawn it, or had it decided since. The
//     employee card two inches up is already a live read for that reason, and
//     it says so on the screen. Two adjacent blocks with opposite freshness
//     semantics is how a reader is taught to trust neither.
//   · THE ID IS ALREADY DURABLE. `work_authorization_id` is a real column, so
//     the audit trail still records WHICH request was judged. What is not kept
//     is what it said — and what it said is a live fact, not a decision input.
//
// WHAT THIS IS NOT. It is not evidence for the immigration dimension's verdict.
// `travel_document_number` is the number of the document the traveller will
// travel ON — a passport, in practice — and it is typed by the requester on
// Remote's own form. It identifies a document a specialist can go and verify;
// it is not an authorization to WORK at the destination, and nothing here
// clears that dimension. See `documentDimension()`.
//
// FAIL-SOFT, DELIBERATELY, AND THIS IS THE ONE PLACE IN UC-04 WHERE SOFT IS
// RIGHT. Every branch below returns a described state and never throws: this is
// a display block on a screen whose other job is to show a specialist a case
// they are holding a ticket about. A read failure here must degrade one card,
// never the panel. Nothing on this path can change a decision, a flag or a
// level — it is consulted after the verdict exists, by the route that renders
// it, and by nothing else. `test/uc04LinkedRequest.test.js` pins that
// structurally.
// ---------------------------------------------------------------------------

/** No `work_authorization_id` on the row — the portal's ordinary case. */
export const LINKED_NONE = "none";
/** No Remote client wired in — a property of the deployment, not the request. */
export const LINKED_NOT_LOOKED_UP = "not_looked_up";
/** Remote answered 404: the id is on our row and not in Remote. */
export const LINKED_MISSING = "missing";
/** The read itself failed. Never a finding about the request. */
export const LINKED_UNAVAILABLE = "unavailable";
/** Remote returned it. */
export const LINKED_READ = "read";

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The fields Remote's `WorkAuthorizationRequest` actually carries, [CONFIRMED]
 * against the list endpoint's schema on 2026-08-19 and recorded in
 * `src/portal/uc03Continuation.js`'s header. Read as a fixed list rather than
 * spread wholesale, because a field Remote adds later would otherwise appear on
 * an approval screen with no label, no provenance and nobody's decision behind
 * it.
 */
function describeFields(request) {
  const signing = request?.will_negotiate_or_sign_contracts;
  return {
    travelDocumentNumber: text(request?.travel_document_number),
    workLocation: text(request?.work_location),
    // TRISTATE, NOT A BOOLEAN CAST. `false` is an answer ("no, they will not
    // sign"), absent is not, and `?? null` keeps them apart — a `!!` here would
    // report an unanswered question as a confident no.
    willNegotiateOrSignContracts: typeof signing === "boolean" ? signing : null,
    reason: text(request?.reason),
    additionalInformation: text(request?.additional_information),
    submittedAt: text(request?.submitted_at),
    status: text(request?.status),
  };
}

/**
 * Read the linked work-authorization request, or say precisely why not.
 *
 * @param {object} args
 * @param {object|null} args.remote            a RemoteClient, or null
 * @param {string|null} args.workAuthorizationId
 * @returns {Promise<{state:string, id:string|null, fields:object|null,
 *   httpStatus:number|null, finding:string}>}
 */
export async function readLinkedRequest({ remote, workAuthorizationId }) {
  const id = text(workAuthorizationId);
  if (!id) {
    return {
      state: LINKED_NONE,
      id: null,
      fields: null,
      httpStatus: null,
      finding:
        "No Remote work-authorization request is linked to this decision, so the only account of the trip is the one " +
        "on this screen. That is normal for a request filed through this system rather than raised by the employee " +
        "in Remote's Request Hub.",
    };
  }

  if (!remote || typeof remote.getWorkAuthorization !== "function") {
    return {
      state: LINKED_NOT_LOOKED_UP,
      id,
      fields: null,
      httpStatus: null,
      /* THE ID IS PUBLISHED AS DATA AND KEPT OUT OF THE PROSE. A raw UUID in a
         sentence a specialist reads is the bare-UUID defect this panel already
         fixed once for `employmentId`, and test/zafNoDeveloperArtifacts.test.js
         caught this one before it shipped. `id` is on this object and on the
         case record, which is where somebody quoting it into Remote goes. */
      finding:
        "No Remote client is wired into this API, so the linked work-authorization request was never asked for. " +
        "Nothing here is a finding about it.",
    };
  }

  let request = null;
  try {
    request = await remote.getWorkAuthorization(id);
  } catch (err) {
    // RemoteClient returns null on 404 and THROWS otherwise, carrying a status
    // when it has one — so a throw is never "the request is gone", it is "the
    // question was not answered". Same split as src/shared/upstreamFailure.js.
    const status = Number.isInteger(err?.status) ? err.status : null;
    return {
      state: LINKED_UNAVAILABLE,
      id,
      fields: null,
      httpStatus: status,
      finding:
        `Remote could not be asked about the linked work-authorization request${status ? ` (HTTP ${status})` : ""}. ` +
        "This is a failure to read, not a finding about the request.",
    };
  }

  if (!request) {
    return {
      state: LINKED_MISSING,
      id,
      fields: null,
      httpStatus: 404,
      finding:
        "This decision names a Remote work-authorization request, and Remote answered that no such request exists. " +
        "The id was resolved when the decision was made, so something has removed it since — it is on the case " +
        "record below if you need to quote it.",
    };
  }

  const fields = describeFields(request);
  return {
    state: LINKED_READ,
    id,
    fields,
    httpStatus: 200,
    finding:
      "Read from Remote just now, from the work-authorization request the employee raised — not a snapshot kept " +
      "with this decision. Every value here is the employee's own answer on Remote's form.",
  };
}
