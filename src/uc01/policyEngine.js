// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-01 deterministic decision gates
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The LLM (classifier) only *interprets*. The DECISION of whether a letter may
// be auto-issued is made here, with plain rules — no AI. This separation is the
// core safety idea of the whole portfolio: "AI interprets. Rules decide."
//
// It returns a decision plus the list of escalation flags it raised, so the
// risk engine and the audit log can see exactly why a case went the way it did.
//
// Below evaluate() sit three PURE DESCRIBERS — `describeDecidingGate`,
// `describeGateLadder` and `describeDecisionFacts`. They decide nothing and
// evaluate() cannot see them; they turn a decision already made into something
// the one human who ever sees a 🟢 use case — the person holding the exception
// — can act on without going and looking things up. See their own headers.
// ---------------------------------------------------------------------------

import { bindGateDescriptions } from "../shared/gateLadder.js";
import { classifyEngagement } from "./engagementEligibility.js";
import { decisionFacts, fact, unknownFact } from "../shared/decisionFacts.js";
import { readDisclosures } from "./disclosureFields.js";
import { canonicaliseRequestedField } from "./requestedFieldVocabulary.js";
import { REASON_UPSTREAM_UNAVAILABLE, REASON_UPSTREAM_NOT_FOUND } from "../shared/upstreamFailure.js";

/**
 * Minimum classifier confidence before a letter may be auto-issued.
 *
 * Exported rather than left as an inline default so the exception surface can
 * NAME it. "The classifier was not confident enough" without the threshold and
 * the score is C-27's shape exactly: a true sentence the reader cannot act on,
 * because "not enough" is a comparison and only one side of it was shown.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Fields the standard letter PRINTS AS FACT and therefore cannot render
 * without.
 *
 * `job_title` is deliberately absent: letter.js already guards that row with a
 * conditional, so its absence removes a row rather than leaving a blank one.
 * `status` is absent because gate 2 has already proved it is exactly "active"
 * by the time this is checked.
 */
export const REQUIRED_LETTER_FIELDS = ["full_name", "start_date", "contract_type"];

/** Fields the standard letter is allowed to disclose. Nothing else may leak. */
export const STANDARD_LETTER_FIELDS = [
  "full_name",
  "start_date",
  "contract_type",
  "probation",
  "status",
  "legal_entity",
];

// ---------------------------------------------------------------------------
// TWO VOCABULARIES FOR ONE FIELD, and neither is wrong.
// ---------------------------------------------------------------------------
// Classifier V2.2's frozen prompt teaches the model
// `"Please include my salary." -> requestedFields = ["compensation"]`, and the
// 48-case golden dataset encodes `compensation` as the answer key. The
// acceptance contract came first and says `salary` — VC-09 requires that exact
// word reach the review surface, because a specialist reads it.
//
// Renaming either side would be the wrong repair. Changing the prompt or the
// dataset invalidates a frozen regression result that has already been
// measured (47/48 -> 48/48); changing VC-09 edits an acceptance criterion to
// suit an implementation, which is the one move this repository refuses.
//
// So they are translated at the boundary instead, in ONE place, on the way
// into policy. The classifier keeps emitting what it was evaluated emitting;
// the contract keeps receiving what it was written to receive.
//
// THE TABLE MOVED OUT OF THIS FILE ON 2026-08-28, AND GREW, because a one-entry
// map assumed the model obeys its prompt. On ticket #161 it returned
// `gross_annual_salary` — not `compensation`, which its prompt names as the
// only permitted value — and the sidebar told a specialist
// "gross_annual_salary — never released" about the one field the whole
// disclosure feature exists to release. See
// ./requestedFieldVocabulary.js for the full argument, including why the map is
// explicit rather than a `/salary|pay|wage/` pattern.
//
// The translation is unchanged in kind: still at the boundary, still in ONE
// place, still on the way into policy. It simply no longer trusts a frozen
// prompt to be validation, which prime directive #1 says it never was.

/**
 * The over-scope fields in a classification, in CONTRACT vocabulary.
 *
 * EXPORTED as of 2026-08-28 (as `overScopeFieldsRequested`) because
 * `src/review/service.js` now needs the same list to decide what an approval
 * releases onto a customized letter. It is exported rather than re-derived
 * there for the obvious reason and one less obvious one: the `null` case below
 * is a fail-closed answer that a re-implementation would almost certainly
 * flatten to `[]`, and `[]` here means "nothing extra was asked for" — which
 * would turn "we do not know what they wanted" into "they wanted nothing", on
 * the path that decides what a letter discloses.
 *
 * @returns {string[]|null} null means the question was never answered — an
 *   absent or malformed `requestedFields` is not the same as an empty one, and
 *   must fail closed rather than read as "nothing extra was asked for".
 */
function overScopeFieldsIn(classification) {
  const requested = classification.requestedFields;
  if (!Array.isArray(requested) || requested.some((f) => typeof f !== "string")) {
    return null;
  }
  return requested
    .map(canonicaliseRequestedField)
    .filter((f) => !STANDARD_LETTER_FIELDS.includes(f));
}

/**
 * The same list, for callers outside this module, with the null case collapsed
 * to an empty array — which is SAFE HERE AND ONLY HERE, because the consumer
 * (`authorisableDisclosures()`) treats an empty list as "release nothing". The
 * fail-closed direction for a discloser is to disclose less, which is the
 * opposite of the gate's, where an unknown must not read as "nothing asked
 * for". Both are the cautious answer to their own question.
 *
 * @param {object|null} classification
 * @returns {string[]}
 */
export function overScopeFieldsRequested(classification) {
  if (!classification || typeof classification !== "object") return [];
  return overScopeFieldsIn(classification) ?? [];
}

/**
 * Decide how a verification request should be handled.
 * @param {object} args
 * @param {object} args.employment      the fetched employment record
 * @param {object} args.classification  output of classifyRequest()
 * @param {object} args.identity        output of verifyRequester()
 * @param {number} [args.confidenceThreshold]
 * @param {{offboardings: object[]|null, error: object|null}|null} [args.offboarding]
 *   `RemoteClient.listOffboardingsForEmployment()`'s result (rca-bdz) — the
 *   second Remote read G-1 needs to see an in-progress offboarding an
 *   `active` employment status alone does not show. Null when the caller
 *   made no such read (`engagementEligibility.js`'s own JSDoc explains why
 *   that degrades safely rather than failing).
 * @returns {{decision:"auto_resolve"|"human_review"|"escalate", flags:string[], reason:string}}
 */
export function evaluate({ employment, classification, identity, session = null, offboarding = null, confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD }) {
  const flags = [];

  // 0. ENGAGEMENT ELIGIBILITY — G-1, and it is deliberately AHEAD of identity.
  //
  //    Eligibility is a property of the RECORD; identity is a property of the
  //    REQUESTER. Asking "may this engagement have a letter at all?" first
  //    means an ineligible request is refused having disclosed nothing about
  //    the record — the reverse order leaks the shape of a document we were
  //    never going to write.
  //
  //    Before this gate existed, a contractor passed every gate below and
  //    received a letter stating Remote employs them. Remote is not their
  //    legal employer. See engagementEligibility.js's header and DRIFT-074.
  const engagement = classifyEngagement(employment, offboarding);
  if (!engagement.eligible) {
    flags.push(engagement.flag);
    return { decision: engagement.decision, flags, reason: engagement.reason, engagement: engagement.engagement };
  }

  // 1. Identity must be verified first — a security gate, not negotiable.
  //
  //    G-3 SPLITS THE OLD BINARY "verified or escalate" INTO THREE. A third
  //    party with no usable consent artifact is neither verified NOR refused
  //    (VC-06): nothing was decided about the employee's willingness because
  //    they have not been asked, or have not answered — `identity.pending`
  //    carries exactly that, and it is a PENDING state, not an escalation. A
  //    third party the employee affirmatively DECLINED (VC-08) is `blocked`,
  //    the same terminal-refusal shape G-1 already uses, never `escalate` —
  //    an escalation implies a specialist should look at the record, and there
  //    is nothing left for one to look at once the employee has said no.
  //    Everything else that fails identity (a session that does not match its
  //    own claimed "self" record, an unauthenticated self-request) is the
  //    ORIGINAL failure this gate has always reported: `escalate` /
  //    `identity_not_verified`.
  if (!identity.verified) {
    if (identity.pending) {
      flags.push(`identity_${identity.reason}`);
      return { decision: "awaiting_employee_consent", flags, reason: "awaiting_employee_consent" };
    }
    if (identity.reason === "third_party_consent_denied") {
      flags.push("consent_refused");
      return { decision: "blocked", flags, reason: "consent_refused" };
    }
    flags.push(`identity_${identity.reason}`);
    return { decision: "escalate", flags, reason: "identity_not_verified" };
  }

  // 2. Employee must be ACTIVE. Never issue a letter for a terminated/suspended
  //    employee — this is the single most important failure mode for UC-01.
  if (employment.status !== "active") {
    flags.push(`employment_status_${employment.status}`);
    return { decision: "escalate", flags, reason: "employee_not_active" };
  }

  // 3. A verified third party (e.g. a bank with consent GRANTED — see gate 1
  //    above, which is the only way this line is ever reached for a third
  //    party) is never zero-touch — third-party disclosures always get a
  //    human's eyes.
  if (classification.requesterType === "third_party") {
    flags.push("third_party_request");
    return { decision: "human_review", flags, reason: "third_party_request" };
  }

  // 4. Anything non-standard (attached form, external portal) is a human job.
  //    Record the artifact signals FIRST, then decide — otherwise an early
  //    return would drop the very flags that explain the decision.
  if (classification.intent === "out_of_scope") {
    flags.push("out_of_scope");
    return { decision: "out_of_scope", flags, reason: "out_of_scope" };
  }
  if (classification.hasAttachment) flags.push("has_attachment");
  if (classification.hasExternalUrl) flags.push("external_url");
  if (flags.length > 0) {
    return { decision: "human_review", flags, reason: "artifact_present" };
  }
  // OVER-SCOPE IS CHECKED BEFORE THE GENERIC NON-STANDARD REFUSAL, and the
  // order is the whole point. Both gates send the request to a human, so the
  // decision is identical either way — what differs is what the specialist is
  // told. `non_standard_request` says only "this was not a plain letter";
  // `over_scope_request` names the field that cannot be disclosed, which is
  // what VC-09 requires reach the review surface.
  //
  // This became reachable-or-not with Classifier V2.2. The old taxonomy called
  // a salary-augmented letter request `standard_letter`, so it fell through to
  // gate 5 and reported over-scope. V2.2 calls it `customized_letter` — more
  // accurate, and it made the generic gate below swallow every over-scope
  // request before the specific gate could see it. Ordering, not logic, was
  // the defect.
  const overScopeEarly = overScopeFieldsIn(classification);
  if (overScopeEarly === null) {
    flags.push("requested_fields_unknown");
    return { decision: "human_review", flags, reason: "over_scope_undetermined" };
  }
  if (overScopeEarly.length > 0) {
    flags.push("over_scope_disclosure_requested");
    return {
      decision: "human_review",
      flags,
      reason: "over_scope_request",
      overScopeFields: overScopeEarly,
    };
  }

  if (classification.intent !== "standard_letter") {
    flags.push("non_standard_request");
    return { decision: "human_review", flags, reason: "non_standard_request" };
  }

  // 5. If the requester asks for fields outside the standard whitelist, a
  //    human must review — never silently redact and auto-resolve.
  //
  //    FAILS CLOSED. This gate used to read `classification.requestedFields ??
  //    []`, which turned a classification that never carried the field into
  //    "nothing over-scope was asked for" — indistinguishable from a genuine
  //    empty list. A model response with the key missing (or a non-array in
  //    its place) means the over-scope question was never answered, not that
  //    the answer was no, so it goes to a human.
  const requested = classification.requestedFields;
  if (!Array.isArray(requested) || requested.some((f) => typeof f !== "string")) {
    flags.push("requested_fields_unknown");
    return { decision: "human_review", flags, reason: "over_scope_undetermined" };
  }
  const overScope = requested.filter((f) => !STANDARD_LETTER_FIELDS.includes(f));
  if (overScope.length > 0) {
    flags.push("over_scope_disclosure_requested");
    return {
      decision: "human_review",
      flags,
      reason: "over_scope_request",
      overScopeFields: overScope,
    };
  }

  // 6. Low confidence in understanding -> let a human look.
  //
  //    FAILS CLOSED, for the same reason and by the same arithmetic trap:
  //    `undefined < 0.85` and `NaN < 0.85` are BOTH false, so the bare
  //    comparison this used to be auto-resolved every classification whose
  //    confidence never arrived — the one case where a human is most needed.
  const confidence = classification.confidence;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    flags.push("confidence_unknown");
    return { decision: "human_review", flags, reason: "confidence_unknown" };
  }
  if (confidence < confidenceThreshold) {
    flags.push("low_confidence");
    return { decision: "human_review", flags, reason: "low_confidence" };
  }

  // 7. The record must be COMPLETE enough to state every fact the letter
  //    prints. This is the last gate before auto-issue because it is the only
  //    one that is purely a precondition of *rendering*: every other path
  //    already puts a human in front of the record.
  //
  //    FAILS CLOSED, and it is the same class of bug as gates 5 and 6 — an
  //    absent value silently reading as an acceptable one. letter.js escapes
  //    through `escapeHtml()`, which maps null/undefined to "", so a record
  //    with no start date rendered a letter with a silently BLANK row instead
  //    of failing. Nothing downstream could catch it either: a blank string is
  //    a perfectly valid render, the Zendesk write succeeds, the ticket is
  //    solved and the audit row reads `auto_resolve / all_gates_passed`.
  //
  //    That document goes to a bank, a landlord or an immigration officer as a
  //    statement of fact about a named person, so a blank field there is worse
  //    than a refusal. A human can fill the gap; a silent blank cannot be
  //    withdrawn once sent.
  const missingFields = REQUIRED_LETTER_FIELDS.filter(
    (f) => employment[f] == null || String(employment[f]).trim() === ""
  );
  if (missingFields.length > 0) {
    flags.push("incomplete_employment_record");
    return {
      decision: "human_review",
      flags,
      reason: "incomplete_employment_record",
      missingFields,
    };
  }

  // 8. SELF-SERVICE DEFLECTION — G-2, and it reads the SAME engagement, status
  //    and onboarding facts gate 0 read. That is why G-1 and G-2 are one piece
  //    of work: "is this person eligible for a letter at all?" and "could this
  //    person have served themselves?" are one set of facts asked twice. Gate 0
  //    reads them to refuse; this reads them to redirect.
  //
  //    WHY IT SITS LAST, AND WHAT KEEPS AUTO-ISSUE ALIVE.
  //    Everything reaching this line is an eligible, active, identified EOR
  //    employee asking for the plain standard letter — exactly the request
  //    Remote's own Requests tab already serves in seconds. Issuing a second
  //    parallel copy duplicates a solved flow (DRIFT-076).
  //
  //    But deflecting EVERYONE here would make `auto_resolve` unreachable in
  //    production while every negative test stayed green — this repository's
  //    most expensive shape, three times over, and the exact failure VC-25
  //    exists to catch. So the deflection needs a POSITIVE reason to believe
  //    this requester can actually reach that flow, and there is only one such
  //    signal UC-01 holds: an authenticated REMOTE SESSION. A person holding
  //    one is, by definition, logged into Remote, and the Requests tab is one
  //    click away.
  //
  //    A requester identified by the weaker signal — the Zendesk-authenticated
  //    email matching the record — is NOT known to have a Remote login, and
  //    reached us by raising a ticket, which is evidence they did not use the
  //    self-service flow or could not. Telling that person to "use the Requests
  //    tab" is advice we cannot stand behind, so they get the letter, exactly as
  //    today. That is the fallback VC-25 requires, and it is positively
  //    reachable rather than notionally retained.
  if (session && session.authenticatedEmploymentId) {
    flags.push("self_service_available");
    return {
      decision: "deflected_to_self_service",
      flags,
      reason: "self_service_available",
      engagement: engagement.engagement,
    };
  }

  // All gates passed and self-service was not demonstrably available: issue.
  return { decision: "auto_resolve", flags, reason: "all_gates_passed", engagement: engagement.engagement };
}

// ---------------------------------------------------------------------------
// GATE_SEQUENCE  —  what each reason MEANS, and where in the order it sits
// ---------------------------------------------------------------------------
// UC-01 was the last 🟢 use case with no ladder at all. UC-02 grew one after a
// tester read "Decided by gate 15" and asked what gates 1–14 were
// (docs/GATES.md); UC-03 grew one after `route_to_uc04` reached a requester as a
// bare slug. UC-01 — the use case that actually runs live, and whose exceptions
// are the only part of it a human ever sees — still handed the reviewer
// `human_review / over_scope_request` and a flag list, with the order those came
// out of readable only by opening this file.
//
// Derived by reading evaluate() above top to bottom. One row PER REASON, because
// one gate refuses several ways and each way means something different to a
// person: `checks` is the PASSING condition (so a rung marked "passed" reads
// correctly against it), `means` is what it is to a human when THAT reason is
// the one that decided. The slug is never replaced — it is the exact string in
// `audit_log`, in the metrics exception ranking and in workflows/nodes/gates.js,
// so it stays beside the prose as the thing somebody searches by.
//
// `out_of_scope` is on the ladder even though no reviewer works it: it is a real
// outcome evaluate() returns, and a ladder missing one of its own rungs reports
// "unknown" for a decision the system makes routinely.
// ---------------------------------------------------------------------------
export const GATE_SEQUENCE = Object.freeze([
  // --- G-1: engagement eligibility. Five rows at position 1, because one gate
  // --- refuses five ways and each is a different conversation with a person.
  {
    position: 1,
    reason: "engagement_not_eor_contractor",
    gate: "engagement_eligibility",
    checks: "Remote is the legal employer of the person the letter would be about",
    means:
      "This person is engaged as an independent contractor, so Remote is not their legal employer and cannot attest that it employs them. That is not a formatting limit — a letter saying otherwise is a false statement about a legal relationship. A contract or invoice history is the document that answers what they actually need.",
  },
  {
    position: 1,
    reason: "engagement_not_eor_direct",
    gate: "engagement_eligibility",
    checks: "Remote is the legal employer of the person the letter would be about",
    means:
      "This employment is administered by Remote but the client company is the legal employer — a direct, HRIS or Global Payroll arrangement. Their own employer issues this letter; Remote cannot issue it on their behalf.",
  },
  {
    position: 1,
    reason: "engagement_onboarding_incomplete",
    gate: "engagement_eligibility",
    checks: "the employment relationship has actually started",
    means:
      "Onboarding is not finished, so the employment relationship this letter would attest to does not exist yet. The facts a verification letter states are not established until it does.",
  },
  {
    position: 1,
    reason: "engagement_offboarding",
    gate: "engagement_eligibility",
    checks: "the employment is not in the process of ending",
    means:
      "This employment is winding down — notice is being served or an offboarding is in progress. Lifecycle Support owns it, never an automation: there may be an active severance or a dispute, and a letter issued today would be stale on arrival.",
  },
  {
    position: 1,
    reason: "eor_status_unknown",
    gate: "engagement_eligibility",
    checks: "the engagement type on the record can be read and recognised",
    means:
      "The record does not say what kind of engagement this is, or says something this system does not recognise. It refuses rather than assuming: an engagement we cannot read is not one we may attest to. This is a RECORD problem before it is a request problem, and it is fixed by looking at the employment rather than by re-asking the requester.",
  },
  // rca-bdz: the SECOND Remote read G-1 needs (is this employment currently
  // mid-offboarding?) can itself fail, and a failed read is not an answer —
  // reusing upstreamFailure.js's shared vocabulary rather than inventing a
  // UC-01-only reason, so a triager sees the same two strings here as on
  // every other use case's upstream failures.
  {
    position: 1,
    reason: REASON_UPSTREAM_UNAVAILABLE,
    gate: "engagement_eligibility",
    checks: "whether this employment is currently mid-offboarding could be read at all",
    means:
      "Remote's offboarding read could not be reached or was refused, so whether this employment is currently serving notice is unknown rather than answered no. Nothing has been decided about the letter either way.",
  },
  {
    position: 1,
    reason: REASON_UPSTREAM_NOT_FOUND,
    gate: "engagement_eligibility",
    checks: "whether this employment is currently mid-offboarding could be read at all",
    means:
      "Remote answered 404 for this employment's offboarding read, which is inconsistent with an employment record that was just read successfully — worth a second look rather than treating it as a clean answer.",
  },
  {
    position: 2,
    reason: "identity_not_verified",
    gate: "identity",
    checks: "the requester is provably the employee the letter would be about, or a third party with recorded consent",
    means:
      "We could not confirm who is asking, so nothing about this employment was disclosed and no letter was produced. This is a failure to VERIFY — it is not a finding that the requester is an impostor.",
  },
  // --- G-3: the third-party consent regime. Two more rows at the identity
  // --- gate's position, because both are outcomes of the SAME check
  // --- ("is this requester entitled to see this employment?") and neither is
  // --- the ordinary escalation above. VC-06/VC-08.
  {
    position: 2,
    reason: "awaiting_employee_consent",
    gate: "identity",
    checks: "the requester is provably the employee the letter would be about, or a third party with recorded consent",
    means:
      "An outside party asked about this employment and the employee has not (yet) answered whether they may be told anything. Nothing was disclosed and nothing was decided — this is not a refusal. It stays open until the employee grants or declines; see the consent request's own age before assuming it needs a nudge.",
  },
  {
    position: 2,
    reason: "consent_refused",
    gate: "identity",
    checks: "the requester is provably the employee the letter would be about, or a third party with recorded consent",
    means:
      "An outside party asked about this employment, and the employee declined to consent to the disclosure. Nothing was told to the third party beyond a generic refusal — not the reason, and not that a person even exists at this reference. Nothing further should be volunteered on this ticket.",
  },
  {
    position: 3,
    reason: "employee_not_active",
    gate: "employment_status",
    checks: "the employment record is active",
    means:
      "The employment is not active, so a letter stating current employment as fact cannot be issued automatically. A letter about a past employment is a different document, and a person writes it.",
  },
  {
    position: 4,
    reason: "third_party_request",
    gate: "third_party_disclosure",
    checks: "the requester is the employee themselves rather than an outside party",
    means:
      "An outside party — typically a bank or a landlord — is asking for this employee's details. Consent is on record, which is why this reached a human rather than being refused outright, but a disclosure to somebody other than the employee is never zero-touch.",
  },
  {
    position: 5,
    reason: "out_of_scope",
    gate: "in_scope",
    checks: "the ticket is asking for an employment verification letter at all",
    means:
      "This ticket is not an employment-verification request, so UC-01 declined it and recorded nothing. No case was created and no queue holds it — the requester was told plainly that this channel handles verification letters.",
  },
  {
    position: 6,
    reason: "artifact_present",
    gate: "no_artifacts",
    checks: "the request carries no attached form and no external portal link",
    means:
      "The request carries something a person has to read — an attached form to complete, or a link to an external portal to submit through. The standard letter is not what is being asked for, whatever the wording says.",
  },
  {
    position: 7,
    reason: "non_standard_request",
    gate: "standard_letter",
    checks: "the request is for the standard verification letter",
    means:
      "The request was understood, and it is not for the standard letter. Something about it needs wording, a format or a statement the standard template does not produce.",
  },
  {
    position: 8,
    reason: "over_scope_undetermined",
    gate: "over_scope_disclosure",
    checks: "the classifier reported which fields the requester asked to have included",
    means:
      "The classifier did not answer which fields were being asked for, so whether anything outside the standard letter was requested is UNKNOWN — not answered 'no'. A person reads the request, because the field this gate protects is compensation.",
  },
  {
    position: 9,
    reason: "over_scope_request",
    gate: "over_scope_disclosure",
    checks: "every field the requester asked for is one the standard letter is allowed to state",
    means:
      "The requester asked for at least one detail the standard letter never states — compensation being the one this gate exists for. Nothing was quietly redacted and sent anyway: a person decides what may be disclosed and issues the letter themselves.",
  },
  {
    position: 10,
    reason: "confidence_unknown",
    gate: "classification_confidence",
    checks: "the classifier reported a usable confidence in its reading of the request",
    means:
      "The classifier returned no usable confidence figure, so there is no basis for trusting its reading of the request. Every gate above this one acted on that reading, so a person confirms it before a letter goes out.",
  },
  {
    position: 11,
    reason: "low_confidence",
    gate: "classification_confidence",
    checks: "the classifier is confident enough in its reading of the request",
    means:
      "The classifier was not confident enough about what was being asked. A person confirms the request before a letter stating facts about a named employee goes to a bank or a landlord.",
  },
  {
    position: 12,
    reason: "incomplete_employment_record",
    gate: "record_complete",
    checks: "the employment record states every fact the standard letter prints",
    means:
      "The employment record is missing a fact the letter prints as a statement of truth. Rendering it anyway would put a blank row in a document going to a bank, a landlord or an immigration officer, and that cannot be withdrawn once sent — whereas a person can simply fill the gap.",
  },
  {
    position: 13,
    reason: "all_gates_passed",
    gate: "outcome",
    checks: "every gate above passed",
    means:
      "Every check passed, so the standard letter was issued and the ticket resolved with no person involved. The letter states employment and never compensation — that is a property of the template, not of this decision.",
  },
  // --- G-2: the deflection. Shares position 13 with all_gates_passed on
  // --- purpose: they are the two outcomes of ONE terminal gate, and marking
  // --- the deflection later would imply a check the letter path skipped.
  {
    position: 13,
    reason: "self_service_available",
    gate: "outcome",
    checks: "every gate above passed",
    means:
      "Every check passed, and this requester is signed in to Remote — where this exact letter is available from the Requests tab in seconds. They were pointed at it rather than issued a second parallel copy of a document Remote already produces. Nothing was refused: had they reached us any other way, the letter would have been issued.",
  },
]);

const descriptions = bindGateDescriptions(GATE_SEQUENCE);

/**
 * Which gate decided this outcome, and what that means in plain words.
 * Returns null for a reason with no row — see src/shared/gateLadder.js.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeDecidingGate = descriptions.describeDecidingGate;

/**
 * The whole ordered ladder, each rung marked passed / decided / not_reached.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeGateLadder = descriptions.describeGateLadder;

// ---------------------------------------------------------------------------
// SELF_SERVICE_GATE_SEQUENCE  —  the SAME idea, for L-14's own, shorter chain
// ---------------------------------------------------------------------------
// rca-nr4i / D-20. `src/uc01/selfServiceLetter.js` is a deliberately separate,
// simpler function (see its own header) — no classifier, no third-party
// consent, no over-scope disclosure — and its terminal success reason,
// `self_service_all_gates_passed`, has never had a row on GATE_SEQUENCE above.
// So `/audit`'s reader saw the failing (ticket-driven) path name "gate 6 of 14
// (destination_known)"-style detail on OTHER use cases, and this one's own
// PASSING path — the only decision this path has ever actually written to
// audit_log — render nothing at all: no gate, no position, no meaning.
//
// THIS IS NOT A SECOND COPY OF GATE_SEQUENCE ABOVE, appended to make the
// numbers add up. Self-service runs a genuinely SHORTER chain — four checks,
// not thirteen — so a combined 13-rung ladder would mark "over_scope_disclosure:
// passed" and "classification_confidence: passed" on a request that never ran a
// classifier at all. That would be a fabricated ladder, worse than none: this
// file's whole premise (see the module header) is that a rung means the
// condition genuinely held, not that a person is confident it probably would
// have. So this is its own, independently-numbered sequence — position 1..5,
// not 1..13 — reusing the SAME `checks`/`means` prose as the rungs above
// wherever the same fact is being checked (via `reuseRung()`), so a shared
// finding cannot read two different ways depending on which door the request
// came through.
//
// gateMeanings.js combines this with the ladder above for "UC-01": the ticket
// ladder is tried first (its reasons never collide with this one's two unique
// reasons, `not_your_employment` and `self_service_all_gates_passed`), and
// this one is the fallback. See that file's registry entry.
// ---------------------------------------------------------------------------

/** Copy a shared rung's `checks`/`means` text rather than retyping it — the
 *  two doors check the identical fact and must never be free to say it two
 *  different ways. Throws on a typo'd reason rather than silently degrading,
 *  because a ladder entry with an empty `means` is indistinguishable from one
 *  that was never written. */
function reuseRung(reason) {
  const row = GATE_SEQUENCE.find((r) => r.reason === reason);
  if (!row) throw new Error(`SELF_SERVICE_GATE_SEQUENCE expected a GATE_SEQUENCE rung for "${reason}"`);
  return { checks: row.checks, means: row.means };
}

export const SELF_SERVICE_GATE_SEQUENCE = Object.freeze([
  // Identity first, exactly as it is in the ticket-driven ladder's own
  // ordering — before any employment fact is read, per this function's own
  // "IDENTITY FIRST" comment.
  {
    position: 1,
    reason: "not_your_employment",
    gate: "self_identity",
    checks: "the signed-in session's own employment id equals the employment being asked about",
    means:
      "The signed-in session asked about an employment that is not its own. Self-service only ever answers for the requester themselves — asking on someone else's behalf goes through the ordinary support channel, where identity is verified a different way (and, for a third party, where consent is recorded).",
  },
  // G-1, reused rung for rung: one gate, five reasons, exactly as above.
  { position: 2, reason: "engagement_not_eor_contractor", gate: "engagement_eligibility", ...reuseRung("engagement_not_eor_contractor") },
  { position: 2, reason: "engagement_not_eor_direct", gate: "engagement_eligibility", ...reuseRung("engagement_not_eor_direct") },
  { position: 2, reason: "engagement_onboarding_incomplete", gate: "engagement_eligibility", ...reuseRung("engagement_onboarding_incomplete") },
  { position: 2, reason: "engagement_offboarding", gate: "engagement_eligibility", ...reuseRung("engagement_offboarding") },
  { position: 2, reason: "eor_status_unknown", gate: "engagement_eligibility", ...reuseRung("eor_status_unknown") },
  { position: 2, reason: REASON_UPSTREAM_UNAVAILABLE, gate: "engagement_eligibility", ...reuseRung(REASON_UPSTREAM_UNAVAILABLE) },
  { position: 2, reason: REASON_UPSTREAM_NOT_FOUND, gate: "engagement_eligibility", ...reuseRung(REASON_UPSTREAM_NOT_FOUND) },
  { position: 3, reason: "employee_not_active", gate: "employment_status", ...reuseRung("employee_not_active") },
  { position: 4, reason: "incomplete_employment_record", gate: "record_complete", ...reuseRung("incomplete_employment_record") },
  {
    position: 5,
    reason: "self_service_all_gates_passed",
    gate: "outcome",
    checks: "every self-service check above passed",
    means:
      "Every self-service check passed — identity match, Remote is the legal employer, the employment is active, and the record states every fact the letter prints — so the standard letter was issued immediately with no person involved.",
  },
]);

const selfServiceDescriptions = bindGateDescriptions(SELF_SERVICE_GATE_SEQUENCE);

/**
 * Which SELF-SERVICE rung decided this outcome. Returns null for a reason with
 * no row here — including every reason from the ticket-driven ladder above,
 * which this function does not know about on purpose (see gateMeanings.js for
 * where the two are combined).
 * @param {string} reason
 */
export const describeSelfServiceDecidingGate = selfServiceDescriptions.describeDecidingGate;

/**
 * THE FIGURES BEHIND THE REFUSAL.
 *
 * `means` above says what happened. This says what it happened TO — the values
 * this file compared at the instant it refused, which are exactly the values a
 * reviewer would otherwise open Remote and the ticket to go and find.
 *
 * C-27's four numbers, in UC-01's vocabulary: which fields were asked for that
 * the letter may not state, which required fields the record does not have, what
 * the confidence actually was and against what threshold, and WHICH identity
 * signal was missing. Every one of them is in this function's hands when the
 * gate fires, and none of them reached a human before this existed — the Zendesk
 * note said `AI summary — decision: human_review (over_scope_request). Flags:
 * over_scope_disclosure_requested.` and stopped there.
 *
 * THE ONE THING THAT MAY NEVER APPEAR HERE IS A COMPENSATION VALUE.
 * `over_scope_request` fires precisely because somebody asked for salary, so the
 * obvious "helpful" move — show the reviewer the figure — would put compensation
 * into the exception surface of the one use case whose entire safety property is
 * that its letter does not carry it. The letter and the reviewer panel are
 * different artifacts and only one of them is safe to enrich. This names the
 * FIELD that was asked for and never reads a value off the record; a test
 * asserts no bundle any reason produces can carry one.
 *
 * RECOMPUTED, NOT READ OFF THE OUTCOME. `evaluate()` already puts `overScopeFields`
 * and `missingFields` on its return value, and those were being thrown away one
 * layer up — but taking them as an argument would mean only the workflow could
 * ever produce this. Deriving them from the same inputs lets a caller holding a
 * stored classification and a record (an API view, days later) get the identical
 * list, and a test pins the two against each other so they cannot drift.
 *
 * PURE, AND IT DECIDES NOTHING — `evaluate()` neither calls it nor can see it.
 *
 * @param {object} args
 * @param {string} args.reason  the slug evaluate() returned
 * @param {object|null} [args.employment]
 * @param {object|null} [args.classification]
 * @param {object|null} [args.identity]
 * @param {number} [args.confidenceThreshold]
 * @returns {{reason:string, sentence:string,
 *            facts:import("../shared/decisionFacts.js").DecisionFact[]}|null}
 *   null for an outcome that refused nothing, so a renderer shows no panel
 *   rather than an empty one that reads like missing data.
 */
export function describeDecisionFacts({
  reason,
  employment = null,
  classification = null,
  identity = null,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  // OPT-IN, and it stays opt-in. See the `over_scope_request` case for why the
  // default is the load-bearing half: this bundle is rendered into a durable
  // Zendesk internal note, and only the reviewer's own route may ask for
  // compensation values.
  includeDisclosureValues = false,
}) {
  const c = classification ?? {};

  switch (reason) {
    case "identity_not_verified":
      // WHICH SIGNAL WAS MISSING, which is the whole of what a reviewer needs:
      // "no session at all" and "signed in as somebody else" are the same slug
      // and opposite situations — one is a step-up verification, the other is an
      // access attempt on another employee's record.
      return decisionFacts(
        reason,
        IDENTITY_SENTENCE[identity?.reason] ??
          "The identity check did not pass, and the signal it failed on was not recorded on this decision.",
        [
          fact("Identity signal used", identity?.method, "session = an authenticated login; consent = a recorded third-party consent; none = neither was present"),
          fact("What was missing", identity?.reason),
          fact("Requester type as read", c.requesterType),
          employment
            ? fact("Employment record read", "yes")
            : unknownFact(
                "Employment record read",
                "Remote returned no record for this employment id, so there was nothing to check an identity against. Confirm the id resolves before treating this as an identity problem."
              ),
        ]
      );

    case "employee_not_active":
      return decisionFacts(
        reason,
        `The employment record's status is "${employment?.status ?? "not recorded"}", and the standard letter is only issued for an active employment.`,
        [
          fact("Status on the record", employment?.status),
          fact("Employment id", employment?.id),
          fact("Contract type", employment?.contract_type),
        ]
      );

    case "third_party_request":
      return decisionFacts(
        reason,
        "An outside party asked for this employee's details with consent on record, so a person decides what may be disclosed and to whom.",
        [
          fact("Requester type as read", c.requesterType),
          fact("Consent signal", identity?.reason, "third_party_with_consent means a granted, complete consent record was present — the identity gate above would have refused or held otherwise"),
          fact("Consent record", identity?.consentRecordId, "The consent_records row this disclosure is being decided against — open it to see who granted it, to whom and for what purpose."),
          fact("Which reader produced the classification", c.source),
        ]
      );

    // G-3 / VC-06. THIS IS THE ONE READER FOR WHOM THE THIRD PARTY'S NAME AND
    // PURPOSE ARE SAFE TO SHOW. Invariant 14 protects what the THIRD PARTY
    // learns, never what the employee's own specialist sees — the employee
    // asked to grant or withhold has to know who is asking and why, which is
    // exactly what `requestingParty`/`purpose` on the consent row are for.
    case "awaiting_employee_consent":
      return decisionFacts(
        reason,
        identity?.reason === "awaiting_employee_consent_other_employee_signed_in"
          ? "The requester is signed in, but as a DIFFERENT employee from the one this request is about. That is an access attempt on somebody else's record, not an outside party's ask — the employee on record has not yet answered whether the signed-in requester may be told anything, and nothing has been disclosed or decided."
          : "An outside party asked about this employment and the employee has not yet answered whether they may be told anything. Nothing has been disclosed and nothing has been decided.",
        [
          fact("Requesting party", c.requestingParty, "Who is asking — from the third-party door, never from a claim in a ticket body."),
          fact("Purpose stated", c.purpose),
          fact("Consent record", identity?.consentRecordId, "The pending row waiting on the employee's answer, if one was created."),
          identity?.reason === "awaiting_employee_consent_other_employee_signed_in"
            ? fact(
                "Worth a second look",
                "yes",
                "The requester is signed in, but as a DIFFERENT employee from the one this request is about — that is an access attempt on somebody else's record, not an ordinary third-party ask, even though the outward regime (waiting on consent) is identical."
              )
            : null,
        ]
      );

    case "consent_refused":
      return decisionFacts(
        reason,
        "An outside party asked about this employment, and the employee declined to consent to the disclosure.",
        [
          fact("Requesting party", c.requestingParty),
          fact("Purpose stated", c.purpose),
          fact("Consent record", identity?.consentRecordId, "The consent_records row carrying the employee's decision."),
          unknownFact(
            "What the third party was told",
            "Deliberately not the reason. This system never tells a third party WHY a disclosure did not proceed — the same generic reply is sent whether the employee declined, has not yet answered, or nobody by this reference exists at all."
          ),
        ]
      );

    case "artifact_present":
      // WHICH artifact, not merely that there was one: an attached form and a
      // portal link are different jobs for the person picking this up.
      return decisionFacts(reason, artifactSentence(c), [
        fact("Attachment on the ticket", boolWord(c.hasAttachment)),
        fact("External portal link in the text", boolWord(c.hasExternalUrl)),
        fact("Intent as read", c.intent),
        unknownFact(
          "The attachment or link itself",
          "Not carried on the decision. This system records THAT an artifact is present, never its contents — open the Zendesk ticket to read it."
        ),
      ]);

    case "non_standard_request":
      return decisionFacts(
        reason,
        `The request was read as "${c.intent ?? "not recorded"}", which is not the standard verification letter.`,
        [
          fact("Intent as read", c.intent),
          fact("Which reader produced it", c.source, "llm = the model answered; rule_based_fallback = the model was unreachable or returned an invalid shape and the deterministic rules answered instead"),
          fact("Confidence in that reading", c.confidence),
        ]
      );

    case "over_scope_undetermined":
      return decisionFacts(
        reason,
        "The classifier did not report which fields were requested, so whether anything over-scope was asked for is unknown rather than answered no.",
        [
          unknownFact(
            "Fields the requester asked for",
            "The classifier returned no usable list. This is NOT an empty list — an empty list would mean nothing extra was asked for, and this means the question went unanswered. Read the ticket."
          ),
          fact("Which reader produced the classification", c.source),
          fact("What the standard letter may state", STANDARD_LETTER_FIELDS.join(", ")),
        ]
      );

    case "over_scope_request": {
      // CONTRACT VOCABULARY, on both facts. A specialist reads these two lines
      // side by side, so the same field must not appear as "compensation" on
      // one and "salary" on the other — see FIELD_VOCABULARY at the top of this
      // file for why the two names exist and why neither side was renamed.
      const requested = (
        Array.isArray(c.requestedFields)
          ? c.requestedFields.filter((f) => typeof f === "string")
          : []
      ).map(canonicaliseRequestedField);
      const overScope = requested.filter((f) => !STANDARD_LETTER_FIELDS.includes(f));

      // THE VALUES — OFF BY DEFAULT, AND THE DEFAULT IS THE IMPORTANT HALF.
      //
      // Owner decision 2026-08-28 reversed rca-iih7 / D-16 for ONE surface: the
      // reviewer's sidebar, because an approval now issues Remote's customized
      // letter and a specialist who cannot see the figure is not deciding, they
      // are signing (src/uc01/disclosureFields.js).
      //
      // It reversed it for that surface ONLY, and `includeDisclosureValues`
      // defaulting to false is what confines it there. This same bundle is
      // rendered into the Zendesk INTERNAL NOTE, by this function on the Node
      // path and by `workflows/nodes/composeInternalNote.js` on the n8n one —
      // a durable comment on a ticket that every agent on the account can read,
      // long after the decision. A salary belongs on the screen of the one
      // person entitled to weigh it and on the letter they authorise; it does
      // not belong in a ticket comment, an `audit_log` row, or a metrics
      // dashboard that reads them.
      //
      // So the caller must ASK for values, and exactly one caller does:
      // `GET /api/review/ticket/:id` in src/review/server.js, which is the
      // sidebar's own route. Every other caller — the workflow, the internal
      // note, the audit trail, the n8n port — gets the named absence below and
      // is unchanged by this decision. `test/n8nInternalNoteParity.test.js`
      // holds the two paths together and would fail the moment that stopped
      // being true.
      //
      // WITHOUT A RECORD, SAY SO — never run the readers against `null`. Each
      // would dutifully return null and the screen would print "the record does
      // not carry this" four times, which is a fabricated fact: nothing was
      // read, so nothing is known. That is the exact hazard
      // `CLASSIFICATION_ONLY_FACT_REASONS` in src/review/service.js exists to
      // avoid.
      const disclosureFacts =
        includeDisclosureValues && employment
          ? readDisclosures(employment, overScope).map((d) => {
              // THREE OUTCOMES PER FIELD, and collapsing any two of them makes
              // the screen lie about what Approve does:
              //   releasable   — here is the value, pressing Approve puts it
              //                  on the letter;
              //   unsupported  — this system would release it, but the record
              //                  does not carry it, so Approve puts nothing;
              //   never        — outside AUTHORISABLE_FIELDS entirely, so no
              //                  decision on this screen touches it. A bank
              //                  account number must not appear beside a
              //                  salary under a heading that implies a choice.
              if (!d.authorisable) return unknownFact(`${d.label} — never released`, d.why);
              // FOUR OUTCOMES, then. A field the standard letter already
              // prints is not a decision: saying "released if approved" over
              // it offers the specialist a control that changes nothing.
              if (d.alreadyOnStandardLetter) {
                return fact(`${d.label} — already on the standard letter`, d.value ?? "not on this record");
              }
              return d.available
                ? fact(`${d.label} — released if approved`, d.value)
                : unknownFact(`${d.label} — released if approved`, d.why);
            })
          : [
              unknownFact(
                "The values of those fields",
                "Not carried here. This bundle is also written into the ticket's internal note, which is durable and readable by every agent on the account, so a compensation figure must not travel in it. The value is shown on the reviewer's own screen, to the one person being asked to authorise its release, and nowhere else."
              ),
            ];

      return decisionFacts(
        reason,
        `The requester asked for ${overScope.length} field${overScope.length === 1 ? "" : "s"} the standard letter never states: ${overScope.join(", ")}.`,
        [
          fact("Asked for beyond the standard letter", overScope.join(", ")),
          fact("Everything the requester asked for", requested.join(", ")),
          fact("What the standard letter may state", STANDARD_LETTER_FIELDS.join(", ")),
          // THE VALUES, SHOWN — a reversal of rca-iih7 / D-16, made by the
          // project owner on 2026-08-28, and worth stating as a reversal
          // rather than quietly overwriting.
          //
          // D-16 held that the sidebar must never carry the figure, on the
          // reasoning that UC-01 never discloses compensation whatever this
          // ticket decides. That reasoning was sound about the STANDARD letter
          // and it silently assumed the standard letter was the only outcome an
          // approval could produce. It no longer is: an approval now issues
          // Remote's OTHER document, the customized letter, which may state
          // what was asked for (src/uc01/disclosureFields.js).
          //
          // Once approving can disclose, hiding the value stops being caution
          // and becomes the opposite — it asks a named person to authorise a
          // release they cannot read, which is not a decision, it is a
          // signature. So the figure is here, on the screen of the one person
          // entitled to weigh it, and nowhere else: not in `audit_log` (the
          // approve row records field NAMES), not on the requester's own
          // result panel, and not on any letter that has not been through
          // this screen.
          //
          // An UNAVAILABLE field is shown as unavailable rather than omitted,
          // because "the record does not hold this" and "we chose not to show
          // you" lead to different decisions, and a specialist who approves
          // expecting a salary row must not be the one to discover afterwards
          // that the letter went out without one.
          ...disclosureFacts,
        ]
      );
    }

    case "confidence_unknown":
      return decisionFacts(
        reason,
        `The classifier returned no usable confidence figure, so nothing could be compared against the ${confidenceThreshold} threshold.`,
        [
          unknownFact(
            "Confidence reported",
            `Absent, or not a number. This is not a low score — a low score would be a figure below ${confidenceThreshold}, and this is no figure at all.`
          ),
          fact("Threshold it would have been compared against", confidenceThreshold),
          fact("Which reader produced the classification", c.source),
          fact("Intent it reported anyway", c.intent),
        ]
      );

    case "low_confidence":
      return decisionFacts(
        reason,
        `The classifier reported ${c.confidence} against a ${confidenceThreshold} threshold, so a person confirms the reading before a letter is issued.`,
        [
          fact("Confidence reported", c.confidence),
          fact("Threshold", confidenceThreshold),
          fact("Which reader produced it", c.source, "llm = the model answered; rule_based_fallback = the rules answered because the model was unreachable or returned an invalid shape"),
          fact("Intent as read", c.intent),
        ]
      );

    case "incomplete_employment_record": {
      const missing = REQUIRED_LETTER_FIELDS.filter(
        (f) => employment?.[f] == null || String(employment[f]).trim() === ""
      );
      const present = REQUIRED_LETTER_FIELDS.filter((f) => !missing.includes(f));
      return decisionFacts(
        reason,
        `The employment record is missing ${missing.length} field${missing.length === 1 ? "" : "s"} the letter prints as fact: ${missing.join(", ")}.`,
        [
          fact("Missing from the record", missing.join(", ")),
          fact("Every field the letter must print", REQUIRED_LETTER_FIELDS.join(", ")),
          fact("Employment id to correct", employment?.id),
          present.length
            ? fact("Fields the record does carry", present.join(", "))
            : unknownFact(
                "Fields the record does carry",
                "None of the three. Confirm the id resolves to the employee you expect before editing anything — a record this empty is more often the wrong record than an incomplete one."
              ),
        ]
      );
    }

    default:
      // all_gates_passed and out_of_scope. Nothing was refused, so there are no
      // figures behind a refusal; `means` already says what happened. null
      // rather than an empty bundle, so a renderer shows nothing rather than an
      // empty panel that reads like missing data.
      return null;
  }
}

/** What each identity failure actually is, in the reviewer's terms. */
const IDENTITY_SENTENCE = Object.freeze({
  no_employment_record:
    "Remote returned no employment record for the id on this ticket, so there was nothing to verify the requester against. This is a record problem before it is an identity one.",
  session_employment_mismatch:
    "The requester is signed in, but as a DIFFERENT employee from the one this letter would be about. That is an access attempt on somebody else's record, not a verification gap.",
  third_party_missing_consent:
    "The request arrived with no authenticated session at all — a plain email or an anonymous form — so an outside party asked for this employee's details, no consent record was found, and nothing was disclosed. Step-up verification is needed before anything can be.",
  third_party_other_employee_missing_consent:
    "The requester is signed in, but as a DIFFERENT employee from the one this letter would be about, and no consent record was found. That is an access attempt on somebody else's record, not a verification gap — worth a look at who is signed in, not just at what was asked for.",
  unauthenticated_requires_stepup:
    "The request arrived with no authenticated session at all — a plain email or an anonymous form — so the requester's identity rests on a claim. Step-up verification is needed before anything is disclosed.",
});

/** Which artifact was present: an attached form and a link are different jobs. */
function artifactSentence(c) {
  if (c.hasAttachment && c.hasExternalUrl)
    return "The ticket carries both an attached form and a link to an external portal, so the standard letter is not what is being asked for.";
  if (c.hasAttachment) return "The ticket carries an attached form to be completed, which the standard letter cannot satisfy.";
  if (c.hasExternalUrl) return "The ticket carries a link to an external portal the letter would have to be submitted through.";
  return "An artifact was flagged on this request, but which one was not recorded on the decision.";
}

/**
 * "yes"/"no" for a real boolean, and null for anything else.
 *
 * NOT `Boolean(v) ? "yes" : "no"`: an absent flag is not a "no". The classifier
 * failing to report whether there was an attachment and reporting that there was
 * none are different facts, and collapsing them here would manufacture the
 * second from the first — the same defaulted-value-that-reads-as-a-measurement
 * this repo has paid for elsewhere.
 */
function boolWord(v) {
  return v === true ? "yes" : v === false ? "no" : null;
}
