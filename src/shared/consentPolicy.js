// ---------------------------------------------------------------------------
// consentPolicy.js  —  the ONE clock UC-01's consent round-trip runs on
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (G-4/F1/F3)
// Owner answer A5 / DRIFT-041 (qa/SPEC-DRIFT-INDEX.md:1090, 748): "age and
// warn everywhere, lapse nowhere". Remote publishes exactly one deadline
// construct of its own (employment.probation.period_ending_reminder_sent),
// which fires ahead of a boundary and changes NO state; Remote models no
// approval expiry at all. So this figure is OURS — rung 4 of the
// substitution ladder, never mistaken for one of Remote's own deadlines —
// and it must exist in exactly one place so every surface that reads it
// agrees. Before this file, `src/portal/server.js` declared its own
// `CONSENT_AGE_WARN_DAYS` and nothing else could see it: the approval
// queue (the OPERATOR surface VC-32 actually names) had no figure to show
// at all, and a stuck-item explanation (src/approvalqueue/stuck.js) named
// "our own policy figure" without anywhere on the page saying what it was.
// ---------------------------------------------------------------------------

/**
 * Our own policy figure for when an unanswered consent request starts
 * reading as "waiting a while" — labelled as ours everywhere it is shown,
 * never Remote's. Nothing may transition a consent record because this many
 * days have passed; it only ever changes a LABEL, never a `status` column.
 */
export const CONSENT_AGE_WARN_DAYS = 3;

/**
 * Has an unanswered consent request been waiting at least
 * `CONSENT_AGE_WARN_DAYS`? A LABEL, never a transition — the caller's own
 * `status` field is read and never written by this function.
 * @param {string|null} status      the consent_records row's own status
 * @param {string} createdAt        ISO timestamp the request was recorded
 * @param {number} [now]            epoch ms, injectable for tests
 */
export function isConsentWaitingLong(status, createdAt, now = Date.now()) {
  if (status === "granted" || status === "denied") return false;
  const ageMs = now - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs)) return false;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return ageDays >= CONSENT_AGE_WARN_DAYS;
}
