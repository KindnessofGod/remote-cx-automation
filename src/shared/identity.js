// ---------------------------------------------------------------------------
// identity.js  —  Identity service (identity comes from the SESSION, not a claim)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS  (updated design)
// The requester is almost always asking from a LOGGED-IN session. So the
// trustworthy source of "who is this?" is the authenticated session, not an
// email address typed into a ticket. Remote's own API/MCP already enforces this:
// it uses OAuth2 and is row-level-security aware, so a logged-in user can only
// read their own data. Our job is to respect that, not to re-verify identity by
// matching a claimed email.
//
// The three real situations:
//   1. Authenticated self  — session proves who they are, and it matches the
//      employee the request is about  -> trusted.
//   2. Authenticated, but asking about SOMEONE ELSE — a logged-in user trying to
//      pull another employee's letter -> refuse / escalate.
//   3. No session (plain inbound email, or a third party like a bank) — NOT
//      auto-trusted. A third party needs recorded consent; an unauthenticated
//      "self" needs step-up verification (a human).
//
// This is a security decision, so it is deterministic — no LLM.
//
// G-3 / VC-06/07/08/33: THE THIRD-PARTY REGIME HAS THREE OUTCOMES, NOT TWO.
// `consentOnRecord` used to be a boolean, which could only ever ask "may this
// proceed?" — collapsing "nobody has answered yet" into the same "no" as "the
// employee said no". VC-06 requires the first of those to be a PENDING state,
// not a refusal: nothing was decided about willingness because nobody has
// been asked, or nobody has answered. `consentRecord` (L-8) is the artifact
// itself — null, or a `consent_records` row — and `verified`/`pending` are
// now reported separately so a caller can never conflate the two:
//   granted  (isConsentGranted)  -> verified: true
//   denied   (isConsentDenied)   -> verified: false, pending: false
//   anything else (isConsentPending, the safe default) -> verified: false,
//     pending: true — see src/shared/consentArtifact.js for exactly what
//     counts as each, including why an INCOMPLETE "granted" row is treated as
//     pending rather than trusted or refused.
// ---------------------------------------------------------------------------

import { isConsentGranted, isConsentDenied } from "./consentArtifact.js";

/**
 * @param {object} args
 * @param {object|null} args.session   authenticated session, or null for email/anon
 * @param {string} args.session.authenticatedEmploymentId  the verified employee id
 * @param {object} args.employment     employment record the request is ABOUT
 * @param {"self"|"third_party"} [args.requesterType]
 * @param {object|null} [args.consentRecord]  the consent_records row (L-8), or
 *   null when no matching row exists. Required, in spirit, when
 *   requesterType==="third_party" — see src/shared/consentArtifact.js for the
 *   completeness rule this function applies to it.
 * @returns {{verified: boolean, pending: boolean, method: string, reason: string, consentRecordId?: string|null}}
 */
export function verifyRequester({ session, employment, requesterType = "self", consentRecord = null }) {
  // --- THIRD PARTY IS TESTED FIRST, AHEAD OF EVERYTHING ELSE, INCLUDING
  // --- "does this employment even exist?" ----------------------------------
  //
  // DRIFT-118, and the second half of the Validator's L-11 correction —
  // extended by G-3. This function used to test the SESSION first while
  // workflows/nodes/gates.js tested `requesterType` first, so for a third
  // party PRESENTING A SESSION the two paths reached different verdicts from
  // the same ticket: `session_employment_mismatch` here, the consent branch
  // there. One of those is a refusal; the other is a regime. They are not the
  // same answer.
  //
  // G-3 goes one step further and moves this branch AHEAD OF the
  // `!employment` check below too. VC-33 requires a request about a real
  // employee with no consent (a), a real employee who refused (b), and a
  // person who does not exist at Remote (c) to be INDISTINGUISHABLE from
  // outside. If "no employment record" ran first, (c) would reach a
  // different verdict (`no_employment_record`) than (a)/(b) reach
  // (`pending`/`denied`) — and the shape of the refusal alone would disclose
  // that nobody by that reference exists, which is invariant 14's exact
  // concern. Testing the channel/regime before the record is what keeps (c)
  // on the same path as (a) and (b): a third party gets the consent regime
  // whether or not there is anyone behind the id they named.
  if (requesterType === "third_party") {
    if (isConsentGranted(consentRecord)) {
      return { verified: true, pending: false, method: "consent", reason: "third_party_with_consent", consentRecordId: consentRecord.id };
    }
    if (isConsentDenied(consentRecord)) {
      return { verified: false, pending: false, method: "consent", reason: "third_party_consent_denied", consentRecordId: consentRecord.id };
    }
    // PENDING — not a refusal (VC-06). TWO WAYS TO GET HERE, and a reviewer
    // (never the third party — see VC-33) acts differently on each.
    //
    // Reconciling the ordering (above) collapsed `session_employment_mismatch`
    // into the consent regime, which is the right REGIME — but it very nearly
    // took the diagnosis with it: "an outside party asked and nobody has
    // answered" and "somebody signed in as one employee asked about another"
    // would have produced one sentence for two different situations, one of
    // which is an ordinary bank request and the other an access attempt on a
    // colleague's record. That the flag became identical is exactly what
    // `test/lowTierExceptionData.test.js`'s "the two failures differ" caught.
    //
    // The REGIME is shared (both are `pending: true`, both reach
    // `awaiting_employee_consent`) and the REASON is not — only one is worth a
    // second look at who is signed in.
    if (session && (session.authenticatedEmploymentId || session.authenticatedEmail)) {
      return {
        verified: false,
        pending: true,
        method: "consent",
        reason: "awaiting_employee_consent_other_employee_signed_in",
        consentRecordId: consentRecord?.id ?? null,
      };
    }
    return {
      verified: false,
      pending: true,
      method: "consent",
      reason: "awaiting_employee_consent",
      consentRecordId: consentRecord?.id ?? null,
    };
  }

  if (!employment) {
    return { verified: false, pending: false, method: "none", reason: "no_employment_record" };
  }

  // --- ONE FUNCTION, BOTH AUTHENTICATED SIGNALS ----------------------------
  //
  // The first half of the L-11 correction. This function read ONLY
  // `session.authenticatedEmploymentId`, while the live n8n path emits
  // `session.authenticatedEmail` (a Zendesk ticket carries no Remote session,
  // so the next-best authenticated signal is the requester Zendesk itself
  // authenticated). Emitting the email from the Node-side normalizer therefore
  // changed nothing on its own: this function did not read that field, fell
  // through, and returned `unauthenticated_requires_stepup` for every ticket —
  // which is why `auto_resolve` was unreachable on the Node path entirely.
  //
  // Both are authenticated signals and neither is a claim. They differ in
  // STRENGTH, and the reason says which one answered, so a reader is never left
  // to assume the stronger one.

  // 1. A Remote session naming an employment id — the strong path.
  if (session && session.authenticatedEmploymentId) {
    if (session.authenticatedEmploymentId === employment.id) {
      return { verified: true, pending: false, method: "session", reason: "authenticated_session" };
    }
    // Reachable only when a caller passes `requesterType: "self"` explicitly
    // against a non-matching session — i.e. NOT via the L-10 derivation, which
    // would have made this a third party above. Kept, and kept refusing.
    return { verified: false, pending: false, method: "session", reason: "session_employment_mismatch" };
  }

  // 2. The Zendesk-authenticated requester, matched against the email on the
  //    authoritative Remote record. Never an address typed into the ticket
  //    body. Fails CLOSED: any missing piece means unverified, which is why
  //    the absent-email case is its own reason rather than a silent false.
  if (session && session.authenticatedEmail) {
    const recordEmail = typeof employment.email === "string" ? employment.email.trim().toLowerCase() : null;
    if (!recordEmail) {
      return { verified: false, pending: false, method: "requester_email", reason: "no_email_on_employment_record" };
    }
    if (String(session.authenticatedEmail).trim().toLowerCase() === recordEmail) {
      return { verified: true, pending: false, method: "requester_email", reason: "requester_matches_employment" };
    }
    return { verified: false, pending: false, method: "requester_email", reason: "requester_employment_mismatch" };
  }

  // An unauthenticated "self" (plain email, no login) can't be auto-trusted.
  return { verified: false, pending: false, method: "none", reason: "unauthenticated_requires_stepup" };
}
