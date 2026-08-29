// ---------------------------------------------------------------------------
// consentArtifact.js  —  what makes a consent_records row USABLE (VC-30, L-8)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// L-7's migration gave `consent_records` a column per fact invariant 13
// requires — who granted it, to whom, for what purpose, when — but a row
// existing is not the same claim as a row being FIT to clear a disclosure.
// VC-30's own failure/recovery line: "a standing 'yes to anyone, forever'
// cannot be represented — a row with no named requesting party does not
// satisfy a disclosure check." This file is the one place that rule is
// written down, so `src/shared/identity.js` (the Node path) and
// `workflows/nodes/gates.js` (the n8n port, which cannot import this — see
// its own comment) implement the SAME completeness test rather than each
// inventing one.
//
// THREE STATES, NOT TWO. A `consent_records` row is one of:
//   granted  — every one of the four facts is present AND status is
//              "granted". Only this state may ever verify a third-party
//              disclosure (VC-07).
//   denied   — status is "denied". The employee was asked and said no.
//              Completeness is NOT required to recognise a denial: refusing
//              needs no purpose on file, only a "no" (VC-08).
//   pending  — everything else: no row at all, or a row that is neither
//              granted-and-complete nor denied. This is NOT a refusal
//              (VC-06) — it is "the employee has not (yet, usably) answered".
//
// A row that claims `status: "granted"` but is missing a fact (a legacy row
// migrated before L-7, or a write that skipped a field) is treated as
// PENDING, never as granted and never as denied. Both alternatives are worse:
// treating it as granted would let an incomplete artifact clear a real
// disclosure; treating it as denied would tell a third party "no" on the
// strength of a row that never recorded a "no". Pending is the only
// direction that cannot itself cause harm — it can only ever cost a wait.
// ---------------------------------------------------------------------------

/** The four facts invariant 13 requires, as they sit on a `consent_records` row. */
const REQUIRED_GRANT_FIELDS = ["grantedByEmploymentId", "requestingParty", "purpose", "grantedAt"];

/**
 * Does this row carry all four facts invariant 13 requires?
 * @param {object|null} record  a consent_records row (camelCase, as caseStore.js returns it)
 */
export function isConsentComplete(record) {
  if (!record) return false;
  return REQUIRED_GRANT_FIELDS.every((f) => record[f] !== null && record[f] !== undefined && record[f] !== "");
}

/**
 * May this row verify a third-party disclosure? Requires BOTH `status ===
 * "granted"` AND completeness — see the header for why an incomplete
 * "granted" row is refused rather than trusted.
 * @param {object|null} record
 */
export function isConsentGranted(record) {
  return Boolean(record) && record.status === "granted" && isConsentComplete(record);
}

/**
 * Did the employee affirmatively decline? Completeness is not required —
 * VC-08 needs only the "no", not a purpose on file.
 * @param {object|null} record
 */
export function isConsentDenied(record) {
  return Boolean(record) && record.status === "denied";
}

/**
 * Neither granted-and-usable nor denied: no record at all, or one that is
 * incomplete, unanswered, or in some other state. This is the SAFE default —
 * it is the only one of the three that can never itself cause a wrong
 * disclosure or a wrong refusal, and it is what VC-06 requires the outward
 * behaviour to be.
 * @param {object|null} record
 */
export function isConsentPending(record) {
  return !isConsentGranted(record) && !isConsentDenied(record);
}
