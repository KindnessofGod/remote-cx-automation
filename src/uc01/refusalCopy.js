// ---------------------------------------------------------------------------
// refusalCopy.js  —  what the REQUESTER reads, in their own words   (L-6, G-1)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// §14 of the acceptance contract: *"A refusal must be actionable. An ineligible
// requester is told what they CAN get, in one sentence, in their own words — not
// that a gate refused."* Before this module, an ineligible requester received
// either the generic boundary reply or nothing at all, and the only sentence the
// system had ever written about their case was a slug — `not_eor_engagement` —
// which is a name for a decision, not an answer to a person.
//
// G-1 makes this the HIGHEST-VOLUME MESSAGE UC-01 WILL EVER SEND. Every
// contractor who asks for an employment letter now reaches it. Getting it wrong
// is not a cosmetic failure: it is thousands of people told "no" with no idea
// what to do next, by a system that knew.
//
// THE RULE THIS MODULE ENFORCES, AND WHY IT IS STRUCTURAL
// A gate slug must never reach a customer-facing string. Slugs are for the
// audit row, the metrics ranking and the specialist's ladder — three readers who
// search by them. A requester is a fourth reader who has never seen one.
// `test/uc01RefusalCopy.test.js` asserts this by comparing this module's output
// against every reason in GATE_SEQUENCE, so a new slug added without copy fails
// the suite rather than reaching a person.
//
// WHAT IS DELIBERATELY *NOT* HERE
// No employment facts. A refusal is sent before this system knows whether it is
// even talking to the right person — the engagement gate runs AHEAD of identity
// — so nothing in these strings may reveal anything about the record beyond the
// fact that a request about it was refused. `eor_status_unknown` is the sharpest
// case: it says a record problem exists without saying which record or what.
//
// The audience is set by docs/UI-AUDIENCES.md's rule: a fact earns its place by
// answering one of THIS reader's questions. The reader here has exactly two —
// *can I get this?* and *then what do I do?* — and both are answered in every
// string below, in that order.
// ---------------------------------------------------------------------------

/**
 * Customer-facing copy, one entry per refusing reason `evaluate()` can return.
 *
 * Each is a single paragraph, because it is delivered as a Zendesk public reply
 * to someone who asked a one-line question. `whatYouCanGet` is a separate field
 * rather than a second sentence so a surface that renders a call-to-action
 * differently (a portal page, an email) can place it without re-parsing prose.
 */
// G-3 / VC-33. `awaiting_employee_consent` and `consent_refused` share this
// EXACT SAME object, on purpose, and that is the criterion working rather
// than a shortcut. VC-33 requires a request about a real employee who has not
// yet answered (a), a real employee who declined (b), and a person who does
// not exist at Remote at all (c) to be indistinguishable to the third party
// who asked — same wording, same status, same shape. If the two reasons below
// pointed at two separately-written entries, the difference between them
// would itself tell an outside party which of (a)/(b) they were looking at —
// and any future edit to one and not the other would reopen exactly that
// leak. Declared once, before the map, and referenced by both keys, so
// "must always say the same thing" is a property of the code rather than a
// convention someone has to remember to keep.
const AWAITING_OR_REFUSED_CONSENT = {
  message:
    "Thanks for getting in touch. We can't disclose employment details to an outside party without the employee's own permission, so we've made a note of this request. If we're able to confirm anything, you'll hear from us.",
  whatYouCanGet:
    "There's nothing further to send us right now — this moves forward only if the employee involved agrees to it.",
};

const COPY = Object.freeze({
  engagement_not_eor_contractor: {
    message:
      "Thanks for getting in touch. We're not able to issue an employment verification letter for your engagement: you work through Remote as an independent contractor, which means Remote is not your legal employer and can't state that it employs you.",
    whatYouCanGet:
      "What we can provide is proof of your contract and your invoice or payment history, which is what most banks, landlords and visa applications accept from a contractor. Reply here and we'll get it to you.",
  },
  engagement_not_eor_direct: {
    message:
      "Thanks for getting in touch. We're not able to issue this letter ourselves. Remote administers your payroll, but the company you work for is your legal employer — so they're the ones who can confirm your employment.",
    whatYouCanGet:
      "Your employer's HR or People team can issue an employment verification letter for you. If you'd like, reply here and we'll point you to the right contact at your company.",
  },
  engagement_onboarding_incomplete: {
    message:
      "Thanks for getting in touch. We can't issue an employment verification letter just yet, because your onboarding isn't finished — the letter states your employment as an established fact, and that isn't in place until onboarding completes.",
    whatYouCanGet:
      "Reply here and we'll tell you exactly what's outstanding and roughly how long it should take. As soon as onboarding completes, we can issue the letter straight away.",
  },
  engagement_offboarding: {
    message:
      "Thanks for getting in touch. Because your employment is currently in the process of ending, this request needs a person rather than an automated answer — the details a letter would state are changing right now, and we don't want to send you something that's out of date by the time you use it.",
    whatYouCanGet:
      "A colleague from our Lifecycle Support team will pick this up and confirm what can be issued and when. If you have a deadline, reply here and tell us — it helps us prioritise.",
  },
  eor_status_unknown: {
    message:
      "Thanks for getting in touch. We've hit a problem on our side: your employment record isn't giving us enough information to confirm what kind of engagement it is, and we won't issue a letter about an employment we can't read properly.",
    whatYouCanGet:
      "This is ours to fix, not yours — a colleague is looking at the record now and will come back to you. You don't need to do anything or send anything else.",
  },
  self_service_available: {
    message:
      "Good news — you can get this yourself right now, and it'll be faster than waiting on us. Because you're signed in to Remote, the standard employment verification letter is available directly from the Requests tab in your account, and it's issued in seconds.",
    whatYouCanGet:
      "Open Remote, go to Requests, and choose the employment verification letter. If you need something the standard letter doesn't cover — a specific wording, extra details, or a form to be completed — reply here and we'll handle it as an exception.",
  },

  // See AWAITING_OR_REFUSED_CONSENT's own comment, above the map, for why
  // these two keys deliberately point at the identical object.
  awaiting_employee_consent: AWAITING_OR_REFUSED_CONSENT,
  consent_refused: AWAITING_OR_REFUSED_CONSENT,
});

/**
 * The requester-facing paragraph for a refusing or deflecting reason.
 *
 * @param {string} reason  a slug from `evaluate()`
 * @returns {{message: string, whatYouCanGet: string}|null} null when this reason
 *   has no customer-facing copy, which is correct for every reason that routes
 *   to a human: those are answered by a specialist writing to the person, not by
 *   a template. A caller must treat null as "a person answers this", never as
 *   "send nothing".
 */
export function refusalCopyFor(reason) {
  return COPY[reason] ?? null;
}

/**
 * The paragraph as one string, ready to post as a Zendesk public reply.
 * @param {string} reason
 * @returns {string|null}
 */
export function refusalReplyFor(reason) {
  const copy = refusalCopyFor(reason);
  return copy ? `${copy.message}\n\n${copy.whatYouCanGet}` : null;
}

/** Every reason this module writes copy for. Used by the structural test. */
export const REASONS_WITH_COPY = Object.freeze(Object.keys(COPY));
