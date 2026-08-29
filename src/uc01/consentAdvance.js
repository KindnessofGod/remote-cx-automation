// ---------------------------------------------------------------------------
// consentAdvance.js — the employee says yes, and the request moves
// ---------------------------------------------------------------------------
// OWNER REPORT 2026-08-28: "I made a third party request. I consented. And I
// went to Zendesk expecting to see a ticket... I do not see that."
//
// They were right, and the audit trail said so exactly:
//
//   13:36:22  awaiting_employee_consent
//   13:37:12  consent_granted
//             (nothing further)
//
// Three individually-correct decisions had combined into a dead end:
//   - the grant raises no ticket (workflow.js STEP 8 excludes
//     `awaiting_employee_consent` — the employee owns that state, not a
//     specialist, and a ticket there hands off nothing);
//   - the follow-up route re-decides nothing, by design;
//   - the intake window joins the resubmission that WOULD have re-decided.
//
// An earlier pass fixed the third, which made the flow work only if the third
// party asked again. Nobody should have to. The grant is the event that changes
// the answer, so the grant is what advances the case.
//
// WHAT THIS IS NOT. It is not a second place a disclosure gets DECIDED. It
// re-runs the SAME `handleVerificationTicket()` over the SAME stored inputs and
// the SAME stored classification — the gates decide, exactly as they did the
// first time, and the only thing that changed is a consent row they read. There
// is no path here that can produce an approval the policy engine did not.
// ---------------------------------------------------------------------------

import { handleVerificationTicket } from "./workflow.js";
import { randomUUID } from "node:crypto";

/**
 * Advance a third-party enquiry that was waiting on this consent record.
 *
 * SILENT AND NON-FATAL BY CONTRACT. Every failure path returns a reason rather
 * than throwing, because the caller is the portal's consent route: the
 * employee's decision is already durable by the time this runs, and losing
 * their grant to a hand-off failure would be strictly worse than a late
 * hand-off. The return value is for logging and tests, never for a response
 * body — the employee is told their own decision was recorded, which is true
 * regardless of what happens here.
 *
 * @param {object} args
 * @param {import("../shared/caseStore.js").CaseStore} args.caseStore
 * @param {import("../shared/audit.js").AuditLogger} args.audit
 * @param {object} args.remote            a client that can read the REAL record this
 *   case names — see the caller's note on `forSource()`; a portal-mock client
 *   would 404 a live employment id and turn a valid disclosure into an escalation.
 * @param {object|null} [args.zendesk]
 * @param {string} args.consentRecordId
 * @returns {Promise<{advanced: boolean, reason: string, caseId?: string}>}
 */
export async function advanceOnConsentGrant({ caseStore, audit, remote, zendesk = null, consentRecordId }) {
  try {
    if (typeof caseStore?.findConsentRecordById !== "function") {
      return { advanced: false, reason: "store_cannot_read_consent" };
    }
    const consent = await caseStore.findConsentRecordById(consentRecordId);
    if (!consent) return { advanced: false, reason: "no_such_consent_record" };
    // ONLY a grant. A denial must never reach a specialist: the employee said
    // no, and handing their refusal to a human to look at again is the shape
    // this whole use case exists to refuse.
    if (consent.status !== "granted") return { advanced: false, reason: "consent_not_granted" };

    const caseRow = await caseStore.findById(consent.caseId);
    if (!caseRow) return { advanced: false, reason: "no_such_case" };
    if (caseRow.source !== "third_party_door") return { advanced: false, reason: "not_a_third_party_case" };
    // Only an enquiry that STOPPED for consent can be restarted by consent. A
    // case decided for any other reason is not waiting on this and must not be
    // re-run because a matching consent row happened to appear.
    if (caseRow.decision !== "awaiting_employee_consent") {
      return { advanced: false, reason: "case_not_awaiting_consent" };
    }

    const cls = caseRow.classification || {};
    const alreadyReference = cls.doorReference ?? caseRow.externalRef ?? null;
    // ALREADY ADVANCED? Two clicks on Grant, or a retry, must not produce two
    // hand-offs for one disclosure.
    //
    // The check cannot be "is this case still awaiting consent", because the
    // advance does not MUTATE this case — it re-decides, producing a NEW case
    // under a fresh workflow ref (the first ref is claimed; see below). So the
    // original row stays `awaiting_employee_consent` forever and would re-arm
    // this path on every call. Asking instead whether the enquirer's own
    // reference now resolves to a case that has MOVED ON is the question that
    // actually has one answer per disclosure. Caught by test rather than
    // reasoned about: the first version of this file raised two tickets.
    if (alreadyReference && typeof caseStore.findByDoorReference === "function") {
      const newest = await caseStore.findByDoorReference(alreadyReference);
      if (newest && newest.id !== caseRow.id && newest.decision !== "awaiting_employee_consent") {
        return { advanced: false, reason: "already_advanced", caseId: newest.id };
      }
    }
    // A FRESH workflow ref, and the enquirer's own reference carried alongside.
    // `handleVerificationTicket()` claims its externalRef before the first
    // durable write; the first run already claimed the enquirer's reference, so
    // re-running under it is refused as a redelivery and writes nothing at all.
    // That exact mistake shipped once and looked like the feature simply not
    // working — no error, no row, nothing to grep for.
    const doorReference = alreadyReference;

    const result = await handleVerificationTicket(
      {
        text: caseRow.ticketText ?? "",
        session: null,
        employmentId: caseRow.employmentId,
        requestingParty: cls.requestingParty ?? null,
        purpose: cls.purpose ?? null,
        subjectName: cls.claimedSubjectName ?? null,
        subjectDateOfBirth: cls.claimedSubjectDateOfBirth ?? null,
        subjectClaimedStartDate: cls.claimedStartDate ?? null,
        returnAddress: caseRow.returnAddress ?? null,
        source: "third_party_door",
        doorReference,
        externalRef: randomUUID(),
      },
      {
        remote,
        audit,
        caseStore,
        zendesk,
        // THE STORED INTERPRETATION, REPLAYED — not a second LLM call.
        //
        // Prime directive 1 says an LLM interprets and deterministic code
        // decides. The interpretation of this enquirer's words already happened,
        // was validated, and is on the record; re-running it could only either
        // agree (a wasted call) or disagree (a decision that changed because a
        // model was sampled twice, which is exactly what the directive forbids).
        // Replaying it makes this a re-DECIDE and not a re-READ.
        classify: async () => stripDerivedKeys(cls),
      }
    );

    return { advanced: true, reason: result?.reason ?? "advanced", caseId: caseRow.id, decision: result?.decision };
  } catch (err) {
    // Recorded where an operator can find it, never surfaced. See the contract
    // note above: the employee's grant is already durable.
    try {
      audit?.log?.({
        useCase: "UC-01",
        action: "third_party_consent_advance_failed",
        actor: "system",
        riskTier: "medium",
        details: { consentRecordId, error: String(err?.message ?? err) },
      });
    } catch {
      /* an audit failure must not mask the original one */
    }
    return { advanced: false, reason: "advance_threw" };
  }
}

/**
 * The classification as the classifier produced it, with the keys the workflow
 * folds in afterwards removed — otherwise each replay would nest the previous
 * run's `identity` inside the next one's classification and the object would
 * grow every time.
 */
function stripDerivedKeys(classification) {
  const {
    identity: _identity,
    doorReference: _doorReference,
    requestingParty: _requestingParty,
    purpose: _purpose,
    claimedSubjectName: _n,
    claimedSubjectDateOfBirth: _d,
    claimedStartDate: _s,
    ...rest
  } = classification || {};
  return rest;
}
