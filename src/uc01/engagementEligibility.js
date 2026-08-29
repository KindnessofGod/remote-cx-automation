// ---------------------------------------------------------------------------
// engagementEligibility.js  —  G-1: is this an engagement Remote can attest to?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS  (DRIFT-074, decided 2026-08-20; owner: "let behaviour stick
// to Remote's documentation")
//
// rca-bdz, CLOSED on the Node path 2026-08-23: this gate used to see only the
// employment record's own `status`, so an employee serving notice whose
// status still read `active` was invisible here (see OFFBOARDING_STATUSES'
// own comment, below, for the full history). It now also takes the result of
// `RemoteClient.listOffboardingsForEmployment()` — a second, real Remote
// read `src/uc01/workflow.js` and `src/uc01/selfServiceLetter.js` both make
// before calling this function — and a non-empty result escalates the SAME
// way a status-derived one always did. STILL OPEN on the n8n path: the
// deployed graph has no node making this call, and adding one is a
// graph-shape change (a new HTTP node + wiring), not a Code-node body edit —
// see `workflows/nodes/gates.js`'s own comment on `classifyEngagement`.
//
// Until this gate existed, UC-01 never consulted the engagement type at all. A
// contractor asking for an employment verification letter passed every gate and
// received a document saying Remote employs them. Remote does not employ them —
// it is not their legal employer, and saying so in a document that goes to a
// bank, a landlord or an immigration officer is a FALSE ATTESTATION about a
// third party's legal relationship. It is not a formatting problem, and it
// shipped on the live path.
//
// WHY IT SITS IN FIRST POSITION, AHEAD OF IDENTITY
// Eligibility is a property of the RECORD; identity is a property of the
// REQUESTER. Asking "may this engagement have a letter at all?" before "who is
// asking?" means an ineligible request is refused having read no employment
// facts and disclosed nothing. The reverse order leaks the shape of a record we
// were never going to write about.
//
// WHY FOUR REASONS AND NOT ONE
// Per DRIFT-074's own disposition table. A single `not_eligible` tells the
// specialist nothing, and the four classes need four different human responses:
// a contractor is directed to a contract/invoice history, a direct employee to
// their own employer, an unfinished onboarding to whatever is outstanding, and
// an offboarding to Lifecycle Support, which may be sitting on a severance or a
// dispute. One slug would collapse four conversations into one shrug.
//
// FAILS CLOSED. An absent or unrecognised engagement type is `eor_status_unknown`
// and refuses. This is the rule `normalizeEmployment()` already established for
// country codes: an unusable value becomes a refusal, never a guess. An engagement
// we cannot read is not an EOR engagement we may attest to.
//
// THIS MODULE DECIDES NOTHING ABOUT DISCLOSURE. It answers one question about
// the record and returns a verdict; policyEngine.evaluate() places it.
// ---------------------------------------------------------------------------

import { upstreamVerdict } from "../shared/upstreamFailure.js";

/**
 * Engagement models Remote is the LEGAL EMPLOYER for, and may therefore attest
 * to.
 *
 * `eor_employee` IS UNVERIFIED and is kept for the same reason `full_time` and
 * `part_time` below are named rather than removed. A documentation sweep on
 * 2026-08-28 (developer.remote.com's employment reference, both published
 * enums) found ZERO occurrences of it: Remote's two real enums are
 * `type` (`employee` | `contractor` | `direct_employee` | `global_payroll_employee`)
 * and `employment_model` (`eor` | `global_payroll` | `peo`). Listing a value
 * Remote does not emit is harmless — nothing can carry it — but a reader is
 * entitled to know which entries here are Remote's and which are ours.
 *
 * `employee` is on this list correctly but NOT self-evidently: `type:
 * "employee"` does not by itself mean EOR. It is safe because
 * `normalizeEmployment()` prefers `employment_model`, and the two non-EOR
 * employee shapes carry their own distinct `type` values — so an EOR record is
 * the only thing that reaches here saying "employee". If that preference order
 * ever changes, this entry is the one that stops being true.
 *
 * `eor` is Remote's own value, observed live across all 81 active Sandbox
 * employments (see `getContractAmendmentSchema()`'s probe table in
 * src/remote/restClient.js — one call per (country, employment_model) pair,
 * 2026-08-18).
 *
 * `full_time` and `part_time` are NOT Remote values. They are the flat shape
 * `src/remote/mockServer.js` serves, which predates `normalizeEmployment()` and
 * which that function's own header calls out as a simplification. They are
 * recognised here so the mock-driven demo and the hermetic suite keep working,
 * and they are named as a SUBSTITUTION (ladder rung 3) rather than left to look
 * like something Remote said. If the mock is ever brought up to the real shape,
 * delete these two and nothing else changes.
 */
export const EOR_ENGAGEMENTS = Object.freeze([
  "eor",
  "eor_employee",
  "employee",
  // --- mock-shape only, see above ---
  "full_time",
  "part_time",
]);

/**
 * Engagement models Remote administers but does NOT employ. Observed live:
 * `contractor` and `global_payroll`. `direct_employee`/`hris_employee` are the
 * vocabulary the acceptance contract §6 uses for the same class; both are
 * accepted so a record phrased either way lands in the same refusal.
 */
export const NON_EOR_ENGAGEMENTS = Object.freeze({
  contractor: "engagement_not_eor_contractor",
  independent_contractor: "engagement_not_eor_contractor",
  global_payroll: "engagement_not_eor_direct",
  global_payroll_employee: "engagement_not_eor_direct",
  direct: "engagement_not_eor_direct",
  direct_employee: "engagement_not_eor_direct",
  hris_employee: "engagement_not_eor_direct",
  // `hris` is the CREATE-side spelling of the same thing. Remote's
  // `POST /v1/employments` accepts `type: "hris"` and the record then READS
  // BACK as `direct_employee` (confirmed 2026-08-28 against
  // developer.remote.com's employment reference, both enums fetched). So the
  // value only ever appears on a payload we ourselves submitted or echoed —
  // which is exactly the path where an unlisted value would have fallen
  // through to `eor_status_unknown` and refused for the wrong reason. Same
  // refusal either way; a reader is now told which of the four classes it is.
  hris: "engagement_not_eor_direct",
});

/**
 * Statuses that mean the employment relationship has not STARTED yet.
 *
 * A letter attesting facts not yet established is a false attestation in the
 * other direction from the contractor case: the person is not yet employed
 * rather than not employed by us.
 */
export const ONBOARDING_STATUSES = Object.freeze([
  "created",
  "initiated",
  "pending",
  "invited",
  "onboarding",
  "pre_hire",
]);

/**
 * Statuses that mean the relationship is ENDING but has not ended.
 *
 * FORMERLY A NAMED ABSENCE (rca-bdz): until 2026-08-23 this list was the
 * WHOLE of what this gate could see, and an employment that stayed `active`
 * while an offboarding ran in the background was invisible to it. Remote
 * exposes that fact at `GET /v1/offboardings/employments/{id}` (found by
 * UC-07's pass, 2026-08-21; measured live and confirmed reachable, 2026-08-21
 * — see `RemoteClient.listOffboardingsForEmployment()`'s own header), and
 * `classifyEngagement()` below now takes that read's result as a second
 * signal alongside this list. This list still matters on its own: it is the
 * only signal available when a caller has no offboarding read to offer (a
 * legacy call site, or a test fixture), and it catches the case where the
 * STATUS ITSELF already says the employment is winding down, cheaper than a
 * second network call.
 */
export const OFFBOARDING_STATUSES = Object.freeze([
  "offboarding",
  "notice",
  "serving_notice",
  "leaving",
  "termination_pending",
]);

/**
 * Decide whether this engagement may have an employment verification letter.
 *
 * @param {object|null} employment  a normalized employment record
 * @param {{offboardings: object[]|null, error: {call:string, status:number|null, kind:string, message:string}|null}|null} [offboardingResult]
 *   `RemoteClient.listOffboardingsForEmployment()`'s result, or null when the
 *   caller made no such read (a legacy call site, or a test that only cares
 *   about the status-derived signal). Absent is treated exactly like "read
 *   not attempted", never like "read attempted and came back empty" — this
 *   function does not perform the read itself and cannot tell the two apart
 *   on its own, so a caller that skips the read simply gets the narrower,
 *   status-only answer this gate has always given.
 * @returns {{eligible: boolean, decision?: "blocked"|"escalate", reason?: string, flag?: string, engagement: string|null}}
 *   `eligible: true` means only that this gate does not refuse. Every other
 *   gate still runs.
 */
export function classifyEngagement(employment, offboardingResult = null) {
  // No record at all is not this gate's refusal to make. Identity owns
  // "there was nothing to verify against" (`no_employment_record`), and
  // answering it here would give the same absence two different reasons on two
  // different paths — which is the divergence class this build exists to close.
  if (!employment) {
    return { eligible: true, engagement: null };
  }

  // THE OFFBOARDING READ ITSELF FAILED (rca-bdz). Fails closed, exactly the
  // way `listPayrollRunsResult()`'s callers already do: "we could not ask"
  // and "Remote said no offboarding exists" are opposite facts, and reading a
  // failed call as "clear to issue" would be inferring notice-status from an
  // absence — precisely what this gate's own history warns against. Reuses
  // `upstreamFailure.js`'s shared vocabulary rather than a UC-01-only reason,
  // so this ranks in the metrics dashboard beside every other upstream
  // failure instead of as a private dialect.
  if (offboardingResult?.error) {
    const verdict = upstreamVerdict(offboardingResult.error);
    return {
      eligible: false,
      decision: verdict.decision,
      reason: verdict.reason,
      flag: verdict.flags[verdict.flags.length - 1],
      engagement: normalize(employment.contract_type) || null,
    };
  }

  // A REAL, IN-PROGRESS OFFBOARDING, SEEN DIRECTLY. Any record at all is
  // treated as evidence — see `listOffboardingsForEmployment()`'s own header
  // for why this does not filter by status. Checked ahead of the
  // status-derived list below because it is authoritative when present:
  // Remote's own offboarding resource, not an inference from the employment
  // record's `status` field.
  const hasActiveOffboarding = Array.isArray(offboardingResult?.offboardings) && offboardingResult.offboardings.length > 0;

  const status = normalize(employment.status);

  // Lifecycle before engagement type, for one class only: an employment that is
  // ENDING is a Lifecycle Support conversation whatever model it runs on, and
  // it is the only one of the four that escalates to a human rather than being
  // refused outright. Onboarding stays below the engagement check, because an
  // unfinished CONTRACTOR onboarding is still a contractor and the contractor
  // sentence is the one that person needs.
  if (OFFBOARDING_STATUSES.includes(status) || hasActiveOffboarding) {
    return {
      eligible: false,
      decision: "escalate",
      reason: "engagement_offboarding",
      // Distinct flag when the API read is what caught it, so an audit row
      // shows a genuinely active `active`-status employee's offboarding was
      // caught by the SECOND read, not misread as the status list catching a
      // status it does not contain.
      flag: hasActiveOffboarding ? "offboarding_record_found" : `engagement_status_${status}`,
      engagement: normalize(employment.contract_type) || null,
    };
  }

  const engagement = normalize(employment.contract_type);

  // Fails closed. An engagement we cannot read is not an EOR engagement.
  // `"unknown"` is a real value here, not a hypothetical: normalizeEmployment()
  // in src/remote/restClient.js writes exactly that string when the record
  // offers neither `employment_model` nor `type`.
  if (!engagement || engagement === "unknown") {
    return {
      eligible: false,
      decision: "blocked",
      reason: "eor_status_unknown",
      flag: "engagement_unreadable",
      engagement: engagement || null,
    };
  }

  const nonEorReason = NON_EOR_ENGAGEMENTS[engagement];
  if (nonEorReason) {
    return {
      eligible: false,
      decision: "blocked",
      reason: nonEorReason,
      flag: `engagement_${engagement}`,
      engagement,
    };
  }

  if (!EOR_ENGAGEMENTS.includes(engagement)) {
    // Recognised as neither EOR nor non-EOR: a value Remote has started
    // returning that this list has not caught up with. That is exactly the
    // case that must refuse rather than default, and it is distinguishable in
    // the flag from an absent value so the fix is obvious from the audit row.
    return {
      eligible: false,
      decision: "blocked",
      reason: "eor_status_unknown",
      flag: `engagement_unrecognised_${engagement}`,
      engagement,
    };
  }

  if (ONBOARDING_STATUSES.includes(status)) {
    return {
      eligible: false,
      decision: "blocked",
      reason: "engagement_onboarding_incomplete",
      flag: `engagement_status_${status}`,
      engagement,
    };
  }

  return { eligible: true, engagement };
}

/** Lowercased, trimmed, or "" — never null, so callers need no second guard. */
function normalize(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}
