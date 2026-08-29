// ---------------------------------------------------------------------------
// refusalAudit.js  —  Auditing the portal's IDENTITY refusals
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN
// Someone filed a UC-02 expense from the portal while signed in as the ADMIN
// persona. The adapter refused it, correctly, with 403 `persona_cannot_claim`:
// an expense is claimed by the employee it belongs to. But that refusal returns
// from the adapter BEFORE handleExpenseSubmission() is ever called, so no
// workflow ran, no store was written, and — the part that matters — no
// `audit_log` row existed. The page still showed the requester a request
// reference (`uc02-20260819104528-11aomw`), and that reference named nothing in
// any table. The Execution & Audit Trail viewer's live feed showed nothing at
// all. From every durable surface this repo has, the attempt had not happened.
//
// WHY IT IS A DEFECT AND NOT A GAP
// A refusal is a decision. A rule looked at a request and said no, and this
// repository's whole discipline is that a decision is durable before anything
// else happens (see src/uc01/workflow.js's STEP 7/STEP 8 ordering, and
// recordRefusal()/recordReviewRefusal() in uc04 and uc02, which already audit
// their own refusals). An IDENTITY refusal is the most audit-worthy kind there
// is: it is somebody attempting to act on a record they are not entitled to.
// "Nobody was allowed to do that, so there is nothing to record" has the logic
// exactly backwards.
//
// ---------------------------------------------------------------------------
// THE SPLIT: WHICH REFUSALS GET A ROW, AND WHY THE REST MUST NOT
// ---------------------------------------------------------------------------
// The portal's intake route refuses in eighteen places. They are two different
// kinds of event, and only one of them belongs in an append-only decision log.
//
//   AUDITED — 401 `unauthenticated` (five sites) and 403 `persona_cannot_*`
//   (five sites). Every one of these is a JUDGEMENT ABOUT A CALLER: the server
//   resolved (or failed to resolve) an identity through its own persona map and
//   a rule then refused that identity this action. Somebody tried to do
//   something they may not do. That is exactly the event an auditor is looking
//   for, and it is the only record that the attempt ever happened.
//
//   NOT AUDITED — 400 `expense_required`, `text_required`, `employment_required`,
//   `destination_required`, `request_text_required` (eight sites). An
//   incomplete form is not a judgement about a record. Nothing was attempted
//   against anything; a field was blank. Writing these would fill the live feed
//   with "you left a box empty", and a feed that is mostly noise trains its
//   reader to stop looking — which costs more than the rows are worth. It is
//   the same call `renderMyRequestsUnavailable()` in ./assets/app.js makes when
//   it separates a scope boundary from a real failure, and the same one
//   uc02/workflow.js's UNATTRIBUTED_REVIEW_REFUSALS makes when it drops
//   `reviewer_required`.
//
// THE RULE IS KEYED ON THE STATUS, NOT ON A LIST OF CODES, on purpose. A code
// list has to be remembered every time a refusal is added, and its failure mode
// is silent: the new refusal simply never appears and nobody finds out. 401 and
// 403 already carry the meaning being selected for — "who you are is the
// problem" — where 400 carries "what you sent is the problem". A refusal added
// later lands on the correct side by being given the correct status, which its
// author has to think about anyway.
//
// WHAT IS DELIBERATELY OUT OF SCOPE HERE
//   - The shared-key gate (`portal_access_key_required`, ./access.js). It
//     refuses BEFORE the route is even matched, so there is no request type, no
//     use case and no risk tier to attribute a row to — and inventing one would
//     be worse than the absence. test/portalAccess.test.js pins that the key
//     gate writes nothing, and it should stay pinned.
//   - `unknown_request_type` (404). Nobody was judged; a URL did not exist.
// ---------------------------------------------------------------------------

/**
 * The statuses whose refusals are judgements about a CALLER. See the header —
 * this is the whole selection rule, and it lives in one place so a test can
 * read it rather than restate it.
 */
export const AUDITED_REFUSAL_STATUSES = new Set([401, 403]);

/**
 * The action name every one of these rows carries.
 *
 * NAMED FOR WHERE IT HAPPENED, not for what it decided. A reader scanning the
 * feed has to be able to tell at a glance that this request was stopped at
 * INTAKE — before any gate ran — rather than by a policy engine. "escalate",
 * "blocked" and "human_review" are all things a gate concluded after reading a
 * record; this one means no gate ever saw the request.
 */
export const INTAKE_REFUSAL_ACTION = "portal_intake_refused";

/** A claimed persona key is diagnostic only, so it does not need to be long. */
const MAX_CLAIM_CHARS = 120;

/**
 * @param {{ok?: boolean, status?: number, code?: string, reason?: string}} refusal
 * @returns {boolean} whether this refusal is a judgement about a caller
 */
export function isAuditableRefusal(refusal) {
  if (!refusal || refusal.ok !== false) return false;
  return AUDITED_REFUSAL_STATUSES.has(refusal.status);
}

/**
 * Build the `audit_log` event for one intake refusal, or null when the refusal
 * is not one of the audited kinds.
 *
 * PURE — it reads, it decides nothing about the request, and it writes nowhere.
 * The shape follows src/shared/audit.js's log() contract exactly, and the
 * `details` keys follow the ones the rest of this repo already writes, because
 * src/auditview/readStore.js selects `details->>'externalRef'`,
 * `details->>'reason'` and `details->>'source'` BY NAME. A parallel shape here
 * would produce a row that exists in Postgres and is invisible in the viewer,
 * which is most of the way back to the bug this file exists to fix.
 *
 * @param {object} args
 * @param {{id: string, useCase: string, tier: string}} args.type  the request type
 * @param {object} args.refusal  the adapter's refusal object
 * @param {object} args.body     the submitted body — CALLER-SUPPLIED, treated as such
 * @param {object|null} args.persona  the resolved persona, or null when the key
 *   named no persona this server knows. Resolved by the caller through
 *   ./personas.js; never read out of the body here.
 * @returns {object|null} an audit event, or null when this refusal is not audited
 */
export function buildRefusalAuditEvent({ type, refusal, body = {}, persona = null }) {
  if (!isAuditableRefusal(refusal)) return null;

  const session = persona?.session ?? null;
  const submitted = body ?? {};

  return {
    useCase: type.useCase,
    action: INTAKE_REFUSAL_ACTION,
    // THE ACTOR IS THE SERVER'S ANSWER, NEVER THE CALLER'S.
    //
    // For a 403 the persona resolved through the server-owned map, so there IS
    // an authenticated identity, and it is the same value the workflow behind
    // this adapter would have recorded — `authenticatedEmploymentId` for an
    // employee, `authenticatedAdminId` for the company admin (see
    // uc02/workflow.js:130 and uc04/workflow.js:246, whose expression this
    // mirrors rather than reinvents).
    //
    // For a 401 there is NO actor, and this row must not manufacture one. The
    // persona key the body claimed is a CLAIM — anyone can post any string —
    // and putting it in the `actor` column would turn an unauthenticated
    // request into an attributed one, which is the exact confusion prime
    // directive #3 exists to prevent. It goes in `details.claimedPersona`,
    // labelled as a claim, where nothing will mistake it for an identity.
    // "unauthenticated" is this repo's existing word for that state and already
    // appears in `audit_log.actor` on both execution paths.
    actor: session?.authenticatedEmploymentId ?? session?.authenticatedAdminId ?? "unauthenticated",
    riskTier: type.tier,
    details: {
      typeId: type.id,
      // The searchable slug goes in the same slot every decision row uses, so
      // the viewer's `reason` column and the metrics exception ranking both
      // read it without a special case.
      reason: refusal.code ?? null,
      // The sentence the caller was actually shown, kept beside the slug rather
      // than instead of it — the slug is what somebody greps for, the sentence
      // is what they were told.
      refusalMessage: refusal.reason ?? null,
      refusalStatus: refusal.status ?? null,
      // WHERE IT WAS STOPPED. Redundant with the action name, and deliberately
      // so: `action` is what a human reads, these two are what a query filters.
      stage: "intake",
      refusedBeforeGates: true,
      // THE WHOLE POINT. The requester is shown this reference on the page, so
      // it has to find the row. Read as a non-empty string or not at all, so a
      // caller cannot smuggle an object into the column.
      externalRef:
        typeof submitted.externalRef === "string" && submitted.externalRef ? submitted.externalRef : null,
      // A CLAIM, and named as one. Recorded whether or not it resolved, because
      // "somebody tried to act as `admin`" and "somebody tried to act as a
      // persona that does not exist" are different investigations.
      claimedPersona:
        typeof submitted.persona === "string" && submitted.persona
          ? submitted.persona.slice(0, MAX_CLAIM_CHARS)
          : null,
      claimedPersonaResolved: Boolean(persona),
      source: "portal",
    },
  };
}

/**
 * Record one intake refusal, and never let the recording break the refusal.
 *
 * WHY log() AND NOT logDurable(). logDurable() awaits the Supabase write and
 * lets a failure throw — right for a human clicking "Approve", because there
 * the row IS the authorisation. Here the caller is being told NO. If the audit
 * write fails, the correct outcome is still to refuse them: turning a 403 into
 * a 500 because a logger was unreachable would convert a working control into
 * an outage, and would do it in the direction of leaving the caller unsure
 * whether they were allowed.  So the row is best-effort and the refusal is not.
 *
 * BUT THE SWALLOW IS NEVER SILENT. A dropped audit row is a hole in an
 * append-only log and has to be findable afterwards, so a throw is reported on
 * stderr naming the use case and the refusal code — the same shape audit.js's
 * own background write uses when its Supabase insert fails. (audit.log()
 * already catches its ASYNCHRONOUS failure that way; this catch covers a
 * SYNCHRONOUS throw — an unwritable JSON-lines file, or a logger double that
 * throws.)
 *
 * @returns {object|null} the recorded entry, or null when nothing was recorded
 */
/**
 * AWAIT THIS. It never rejects — a synchronous throw is caught below and an
 * asynchronous one is absorbed into the returned promise — so awaiting it
 * cannot turn a 403 into a 500, which is the only thing the swallow was
 * protecting. What awaiting DOES buy is the ordering the rest of this
 * repository is built on: the decision is durable before the caller is told.
 * Fire-and-forget would have been fine on a long-lived process and silently
 * lossy on the deployment, where the platform may freeze the invocation the
 * moment the response is written — losing precisely the identity refusals this
 * file exists to record, and losing them only in production.
 */
export function recordIntakeRefusal({ audit, type, refusal, body, persona }) {
  const event = buildRefusalAuditEvent({ type, refusal, body, persona });
  if (!event || typeof audit?.log !== "function") return null;
  try {
    const entry = audit.log(event);
    // A logger DOUBLE — or a future asynchronous one — may hand back a promise
    // rather than an entry. An unhandled rejection takes the process down,
    // which is precisely the outage this function exists to avoid, so the
    // asynchronous failure gets the same swallow and the same visibility.
    if (entry && typeof entry.then === "function") {
      // THE HANDLED PROMISE IS WHAT IS RETURNED, not the original. Attaching a
      // rejection handler and returning `entry` would leave the caller holding
      // a promise that still rejects — so the route awaiting it (which it must,
      // see below) would take the process down on exactly the failure this
      // swallow exists to absorb.
      return entry.then(
        (settled) => settled,
        (err) => {
          console.error(
            `[portal] failed to audit ${type?.useCase} intake refusal "${refusal?.code}": ${err.message}`
          );
          return null;
        }
      );
    }
    return entry;
  } catch (err) {
    console.error(
      `[portal] failed to audit ${type?.useCase} intake refusal "${refusal?.code}": ${err.message}`
    );
    return null;
  }
}
