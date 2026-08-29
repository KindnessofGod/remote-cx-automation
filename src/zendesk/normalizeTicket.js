// ---------------------------------------------------------------------------
// normalizeTicket.js  —  raw Zendesk ticket -> the internal ticket shape
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// handleVerificationTicket() (workflow.js) takes a plain object — it has no
// idea Zendesk exists. This is the one place that bridges a real Zendesk
// ticket into that shape. Keeping it a pure function (no I/O) makes it
// trivially testable with a fixture, independent of a live/mock server.
//
// TWO HONEST GAPS, DOCUMENTED RATHER THAN HIDDEN (see BUILD-LOG.md §5):
//
// 1. `employmentId` comes from a Zendesk CUSTOM FIELD (see config.js's
//    ZENDESK_EMPLOYMENT_ID_FIELD_ID). Zendesk has no native concept of a
//    Remote employment id — something upstream of this system (a Zendesk
//    form, or a sync job) has to have populated that field when the ticket
//    was created. If it's missing, this throws rather than silently
//    guessing — an unidentifiable request must not proceed automatically.
//
// 2. RETIRED 2026-08-21 (L-11 / DRIFT-118). This used to read "`session` is
//    always null ... every Zendesk-sourced request correctly lands in
//    human_review/escalate rather than being silently auto-trusted." Every
//    sentence of that was true and the conclusion was a defect: the LIVE n8n
//    path derived a session from the ticket's Zendesk-authenticated requester
//    all along, so the two production paths reached opposite identity verdicts
//    from the same ticket and this one could never auto-resolve at all. Kept
//    here rather than deleted because "correctly lands in human_review" is
//    exactly how a structurally dead path describes itself.
// ---------------------------------------------------------------------------

/**
 * @param {object} rawTicket  a Zendesk ticket object (the `ticket` field
 *   from GET/PUT /api/v2/tickets/:id, or a webhook payload's `ticket`)
 * @param {object} [opts]
 * @param {number|string} [opts.employmentIdFieldId]  the custom_field id carrying the Remote employment id
 * @param {boolean} [opts.hasAttachment]  pass through if known from the caller
 *   (e.g. a webhook payload that included attachment info) — GET /tickets/:id
 *   alone does not reliably include comment attachments; see BUILD-LOG.md.
 * @returns {object} the ticket shape handleVerificationTicket() expects
 */
export function normalizeZendeskTicket(rawTicket, { employmentIdFieldId = null, hasAttachment = false } = {}) {
  const employmentIdField = (rawTicket.custom_fields ?? []).find(
    (f) => String(f.id) === String(employmentIdFieldId)
  );
  const employmentId = employmentIdField?.value ?? null;
  if (!employmentId) {
    throw new Error(
      `Zendesk ticket ${rawTicket.id} has no employment id in custom field ${employmentIdFieldId} — cannot proceed automatically.`
    );
  }

  // IDENTITY SOURCE — the L-11 fix (DRIFT-118).
  //
  // This used to be `session: null` unconditionally, with a comment explaining
  // that a Zendesk ticket carries no Remote session. The premise is true; the
  // conclusion was wrong, and it was wrong in a way that made the two
  // production paths derive OPPOSITE identities from the SAME ticket.
  // `workflows/nodes/normalizeTicket.js` — the live n8n path — has always read
  // the ticket's Zendesk-authenticated requester and matched it against the
  // email on the Remote record. This path did not, so `verifyRequester()`
  // returned `unauthenticated_requires_stepup` for every ticket and
  // `auto_resolve` was structurally unreachable here. Invariant 11 held on this
  // path only VACUOUSLY: it never disclosed anything because it never got that
  // far.
  //
  // A Zendesk-authenticated requester is an AUTHENTICATED SIGNAL, not a claim —
  // Zendesk established who sent the mail. It is weaker than a Remote session
  // and `verifyRequester()` says which of the two answered. What must never
  // happen is reading an address out of the ticket BODY, and that is not what
  // this is: `requester.email` is the account Zendesk authenticated, and the
  // `via` fallback is the envelope sender Zendesk recorded, neither of them
  // anything the writer could type into the message.
  const requesterEmail = rawTicket.requester?.email ?? rawTicket.via?.source?.from?.address ?? null;

  return {
    text: rawTicket.description ?? "",
    session: requesterEmail ? { authenticatedEmail: String(requesterEmail).trim().toLowerCase() } : null,
    employmentId,
    hasAttachment,
    // NO `consentOnRecord`/`consentRecord` FIELD HERE. G-3/L-8: whether a
    // consent artifact exists is a FACT ABOUT THE DATABASE, not a property of
    // the ticket that arrived, so a normalizer is the wrong place to answer
    // it — `handleVerificationTicket()` (workflow.js STEP 2c) now performs
    // the lookup itself, against `caseStore.findConsentArtifact()`, for
    // exactly the requests that need it (third-party). A field asserted here
    // — `false`, or even `null` claiming "not looked up here" — was always
    // one function's opinion about a fact it had no way to check; removing it
    // removes the opinion rather than softening its wording.
    source: "zendesk",
    externalRef: String(rawTicket.id),
  };
}
