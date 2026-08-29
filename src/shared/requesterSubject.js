// ---------------------------------------------------------------------------
// requesterSubject.js  —  who filed this, about whom, and what "verified" meant
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS SHARED RATHER THAN NINE COPIES
//
// UC-04 grew this description first (`src/uc04/decisionFacts.js`, 2026-08-19)
// and it was the only one of the nine that had it — and it has never been
// rendered, because it was buried under `basis.requester` where UC-04's panel
// alone could find it. `zaf-app/assets/main.js` recorded exactly that:
//
//   "basis.requester IS STILL NOT RENDERED, and it is real: UC-04 publishes who
//    filed the request, whether they were acting for the subject, and that a
//    verified identity is an authorisation to act for a company rather than
//    evidence about the person behind the session."
//
// A request is made by one party ABOUT another, and every identity gate in this
// repository is a COMPARISON between those two. A screen that says only
// "Requester: admin_jane" cannot be used to judge whether the request is even
// coherent, let alone whether the gate that passed it proved anything.
//
// THE THREE THINGS IT KEEPS APART, each of which was being read as another:
//
//   1. WHO FILED IT. `unauthenticated` is a REAL VALUE with a real meaning —
//      the workflows write that literal string when no session was present —
//      and a row with no requester field at all is a THIRD thing, an older or
//      hand-built record. Folding either into "anonymous" loses the difference
//      between "we know nobody was authenticated" and "we do not know".
//   2. WHOSE RECORD IT IS ABOUT. Compared, never assumed: UC-03's filer IS the
//      subject (an employee asking about their own travel), UC-04's is an admin
//      acting for someone else, and a system that later files a self-service
//      workation would produce the third combination. The sentence must not go
//      on claiming one shape when the ids say the other.
//   3. WHAT "VERIFIED" ACTUALLY PROVED. This is the one worth the file. A
//      verified UC-04 identity means a session's company id equalled the
//      employment's company id — an AUTHORISATION TO ACT FOR A COMPANY, not
//      evidence about the human behind the session. Rendering it as a tick
//      beside a person's name asserts the second.
//
// PURE, AND IT DECIDES NOTHING. No client, no clock, no I/O; it is handed
// values already read off a stored row and returns sentences. No gate consults
// it. Same contract as `describeDecidingGate()`.
//
// PARAMETERISED BY SENTENCES, NOT BY BEHAVIOUR. Every use case's identity gate
// compares different things, so the *finding* differs while the *shape* must
// not — the sidebar needs one renderer, not nine. `model` carries the wording;
// the branching is here, once.
// ---------------------------------------------------------------------------

/** The literal value every workflow writes when no session was present. */
export const UNAUTHENTICATED = "unauthenticated";

/**
 * @param {object} args
 * @param {unknown} args.filerId  the row's `requester` column, raw.
 * @param {unknown} args.subjectEmploymentId  the row's `employmentId`.
 * @param {boolean} args.identityVerified  the gate's own verdict, off a flag —
 *   never recomputed here.
 * @param {unknown} [args.source]  intake surface, off the row.
 * @param {unknown} [args.externalRef]  the reference the requester holds.
 * @param {object} args.model  the wording this use case needs. Every key has a
 *   default that is true of every use case; a caller overrides only what its own
 *   gate makes more specific.
 * @returns {{filedBy: object, actingFor: object, identity: object, intake: object}}
 */
export function describeRequesterParties({
  filerId,
  subjectEmploymentId,
  identityVerified,
  source = null,
  externalRef = null,
  model = {},
} = {}) {
  const raw = typeof filerId === "string" ? filerId.trim() : "";
  const id = raw ? raw : null;
  const authenticated = Boolean(id) && id !== UNAUTHENTICATED;
  const subjectId = subjectEmploymentId ?? null;

  const {
    authenticatedState = "authenticated_actor",
    authenticatedFinding = (who) => `Filed by ${who}, an authenticated actor.`,
    unauthenticatedFinding = "No authenticated actor. The request arrived without a session, and the workflow recorded the literal value 'unauthenticated' rather than a name — so nobody is identified as having filed this.",
    notRecordedFinding = "This row carries no requester value at all — neither an actor id nor the 'unauthenticated' marker the workflow writes when a session is absent. It is not a record of an anonymous request; it is a record with the field missing.",
    selfFinding = "The filer's id and the subject's employment id are the same value, so this request was filed by the person it is about.",
    onBehalfFinding = (who, about) => `Filed by ${who} about employment ${about} — an actor acting on someone else's record.`,
    identityChecks = "that a session was present and that it resolved to this record",
    identityVerifiedFinding = "Verified. That is an authorisation to act — it is not evidence about who the person behind the session is.",
    identityUnverifiedFinding = "NOT verified. This is a failure to confirm, not a finding that the filer is unauthorised.",
  } = model;

  const filedBy = authenticated
    ? { id, state: authenticatedState, finding: authenticatedFinding(id) }
    : id === UNAUTHENTICATED
      ? { id: null, state: "unauthenticated", finding: unauthenticatedFinding }
      : { id: null, state: "not_recorded", finding: notRecordedFinding };

  // Two ids from two different spaces — an actor id and an employment id — and
  // they are COMPARED rather than assumed unequal. UC-03's are usually the same
  // value; UC-04's never are.
  const actingFor =
    !authenticated || !subjectId
      ? {
          state: "unknown",
          finding:
            "Whether the filer is the subject or is acting for them cannot be read from this row: one of the two ids is absent.",
        }
      : String(id) === String(subjectId)
        ? { state: "the_subject_themselves", finding: selfFinding }
        : { state: "on_behalf_of_the_subject", finding: onBehalfFinding(id, subjectId) };

  const identity = {
    state: identityVerified ? "verified" : "not_verified",
    checks: identityChecks,
    finding: identityVerified ? identityVerifiedFinding : identityUnverifiedFinding,
  };

  const intake = {
    source: source ?? null,
    externalRef: externalRef ?? null,
    finding: source
      ? `Arrived via '${source}'${externalRef ? `, reference ${externalRef}` : ", with no external reference recorded"}.`
      : "No intake surface recorded on this row, so which channel the request arrived on cannot be read back.",
  };

  return { filedBy, actingFor, identity, intake };
}
