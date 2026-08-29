// ---------------------------------------------------------------------------
// requesterType.js  —  L-10 / VC-29: who is asking is not the model's to decide
// ---------------------------------------------------------------------------
// WHY THIS EXISTS  (DRIFT-119)
// `requesterType` selects the whole disclosure REGIME: `self` goes down the
// ordinary path, `third_party` requires recorded consent from the employee. Until
// this module, that field came out of the LLM classifier — so the model decided
// whether a consent artifact was required at all.
//
// That is not a permitted use. §9's list of what the LLM may do does not contain
// `requesterType`; §10's list of what must be deterministic contains the
// third-party gate and consent verification. And prime directive #1 is explicit:
// an LLM may classify, extract and draft, and may never perform a state change
// or reach a gate unvalidated. A model answer of `"self"` on a request from a
// stranger removed the consent requirement silently, with a confident tone and
// no flag anywhere.
//
// WHAT REPLACES IT
// The two facts this system actually holds, both authenticated, neither claimed:
//   1. the CHANNEL the request arrived on, which the system chose, not the
//      requester — a ticket, a portal session, the unauthenticated door;
//   2. whether the authenticated signal on that channel MATCHES the employment
//      record the request is about.
//
// The classifier's answer is retained as a CORROBORATING signal that may only
// ever tighten — `self` → `third_party`, never the reverse. A model may raise
// suspicion; it may not lower a requirement. That asymmetry is the whole design,
// and it is what makes this incapable of weakening anything.
//
// FAILS CLOSED TO THIRD PARTY (VC-29). An absent or unparseable classifier
// answer, an absent authenticated signal, an absent record — every one lands on
// the STRICTER regime. `self` is the permissive answer, so it must be earned by
// a positive match and can never be arrived at by default. Invariant 9 applied
// to the field that selects the regime.
//
// THE DISAGREEMENT IS RECORDED, NOT DISCARDED (VC-29's audit line). When the
// classifier and the derivation differ, both are carried on the result so a
// later reader can see that they did — a silent override teaches nobody
// anything, and a model that is systematically wrong about this is a fact worth
// having.
// ---------------------------------------------------------------------------

/** Channels that carry no authenticated identity at all. Always third party. */
export const UNAUTHENTICATED_SOURCES = Object.freeze(["third_party_door", "anonymous", "public"]);

/**
 * Derive who is asking, deterministically.
 *
 * @param {object} args
 * @param {object|null} args.session      the authenticated session, whatever
 *   shape the channel produces: `{authenticatedEmploymentId}` from a Remote
 *   login, `{authenticatedEmail}` from a Zendesk-authenticated requester.
 * @param {object|null} args.employment   the record the request is ABOUT
 * @param {string|null} [args.source]     the channel ("zendesk", "portal", …)
 * @param {*} [args.classifierRequesterType]  whatever the model returned — any
 *   type, because "unparseable" is a case this must handle rather than assume
 *   away.
 * @returns {{requesterType:"self"|"third_party", basis:string, source:"deterministic",
 *            classifierOpinion:string|null, disagreesWithClassifier:boolean}}
 */
export function deriveRequesterType({ session, employment, source = null, classifierRequesterType = null }) {
  const opinion =
    classifierRequesterType === "self" || classifierRequesterType === "third_party"
      ? classifierRequesterType
      : null;

  const derived = derive({ session, employment, source });

  // The classifier may only ever TIGHTEN. Both directions are stated
  // explicitly rather than left to a `||`, because the asymmetry IS the
  // control and a reader must be able to see it without reasoning about
  // operator precedence.
  let requesterType = derived.requesterType;
  let basis = derived.basis;
  if (opinion === "third_party" && requesterType === "self") {
    requesterType = "third_party";
    basis = "classifier_raised_to_third_party";
  }
  // opinion === "self" while derived is third_party: IGNORED, deliberately.
  // This is the case DRIFT-119 is about — a stranger writing "I am confirming
  // my own employment" and a model agreeing with them.

  // AN ABSENT OR UNPARSEABLE CLASSIFIER ANSWER FAILS CLOSED TO THIRD PARTY.
  //
  // VC-29's failure/recovery line, honoured literally: *"an absent or
  // unparseable requesterType from the classifier fails closed to third party,
  // never to self."*
  //
  // This is stricter than it first looks and the consequence is stated rather
  // than discovered: a provably-self requester — a logged-in employee whose
  // session matches the record — is placed on the THIRD-PARTY regime when the
  // model's answer is missing or malformed, and therefore reaches a human
  // instead of a letter.
  //
  // That was a deliberate choice over the softer reading, in which a positive
  // authenticated match outranks a broken model answer. The softer one is
  // defensible and it is not what the countersigned criterion says, and this
  // direction cannot cause a wrong disclosure — it can only ever cost a
  // correct requester a wait. `self` is the permissive answer; it is earned by
  // a positive match AND a readable corroborating signal, never arrived at
  // because something was missing.
  //
  // It is reachable in practice only when the model returns an unusable field
  // AND the rule-based fallback did not answer either, since
  // validateClassification rejects a response without it. If that combination
  // ever becomes common, the fix is the classifier, not this rule.
  if (opinion === null && requesterType === "self") {
    requesterType = "third_party";
    basis = "classifier_requester_type_unreadable";
  }

  return {
    requesterType,
    basis,
    source: "deterministic",
    classifierOpinion: opinion,
    disagreesWithClassifier: opinion !== null && opinion !== requesterType,
  };
}

function derive({ session, employment, source }) {
  if (source && UNAUTHENTICATED_SOURCES.includes(String(source))) {
    return { requesterType: "third_party", basis: "unauthenticated_channel" };
  }
  if (!session) {
    // No authenticated signal: nothing has been proved about who is asking, so
    // the stricter regime applies. This is NOT the same as an identity failure
    // — identity.js still decides whether the request may proceed at all.
    return { requesterType: "third_party", basis: "no_authenticated_signal" };
  }
  if (!employment) {
    return { requesterType: "third_party", basis: "no_employment_record" };
  }

  // The strong signal: a Remote session naming an employment id.
  if (session.authenticatedEmploymentId) {
    return session.authenticatedEmploymentId === employment.id
      ? { requesterType: "self", basis: "session_matches_employment" }
      : { requesterType: "third_party", basis: "session_names_another_employment" };
  }

  // The next-best signal: the requester Zendesk itself authenticated, matched
  // against the email on the authoritative Remote record. Never an address
  // typed into the ticket body — a claimed address proves nothing.
  if (session.authenticatedEmail) {
    const recordEmail = typeof employment.email === "string" ? employment.email.trim().toLowerCase() : null;
    if (!recordEmail) {
      // The record carries no email, so the match CANNOT BE PERFORMED. That is
      // not evidence of a third party and not evidence of self — it is an
      // absent comparison, and it lands on the stricter side.
      return { requesterType: "third_party", basis: "no_email_on_employment_record" };
    }
    return String(session.authenticatedEmail).trim().toLowerCase() === recordEmail
      ? { requesterType: "self", basis: "requester_email_matches_employment" }
      : { requesterType: "third_party", basis: "requester_email_does_not_match" };
  }

  // A session object carrying no signal this function recognises.
  return { requesterType: "third_party", basis: "unrecognised_session_shape" };
}
