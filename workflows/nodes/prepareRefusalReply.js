// ---------------------------------------------------------------------------
// prepareRefusalReply.js — body of the "Prepare Refusal Reply" n8n Code node
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-c73)
//
// gates.js can emit `blocked`, `awaiting_employee_consent` and
// `deflected_to_self_service` — three decisions "Route by Decision" had no
// output for, so all three fell to the `Unrecognised Decision` fallback: a
// correctly-decided refusal, pending state and deflection were all treated as
// if the automation had produced garbage. Each of the three is answered
// directly and terminally per src/uc01/workflow.js STEP 8 (`if (requesterReply)`
// branch) — the requester is told the answer in their own words and the
// ticket is solved, because nobody is waiting for it. None of the three is a
// hand-off: no group is looked up, no review-queue entry exists for them
// (Queue Gate — Specialist Needed? already excludes them), and no letter/
// document is ever produced on this path.
//
// This node computes WHAT THE REQUESTER READS. Ported from
// src/uc01/refusalCopy.js verbatim, because an n8n Code node has no imports —
// the same reason gates.js and assignRouting.js are files rather than module
// imports. test/n8nRefusalCopyParity.test.js executes THIS FILE and asserts it
// agrees with refusalCopyFor()/refusalReplyFor() for every reason in
// REASONS_WITH_COPY, so the two cannot drift apart unnoticed.
//
// `awaiting_employee_consent` and `consent_refused` deliberately share the
// EXACT SAME copy object — see refusalCopy.js's own comment on
// AWAITING_OR_REFUSED_CONSENT for why: VC-33 requires a third party's request
// about a real employee who has not yet answered, a real employee who
// declined, and a person who does not exist at Remote at all to be
// indistinguishable from outside. Splitting the copy would itself be a leak.
// ---------------------------------------------------------------------------

const AWAITING_OR_REFUSED_CONSENT = {
  message:
    "Thanks for getting in touch. We can't disclose employment details to an outside party without the employee's own permission, so we've made a note of this request. If we're able to confirm anything, you'll hear from us.",
  whatYouCanGet:
    "There's nothing further to send us right now — this moves forward only if the employee involved agrees to it.",
};

const COPY = {
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
  awaiting_employee_consent: AWAITING_OR_REFUSED_CONSENT,
  consent_refused: AWAITING_OR_REFUSED_CONSENT,
};

const ctx = $json && typeof $json === "object" ? $json : {};
const copy = COPY[ctx.reason] || null;
const requesterReply = copy ? copy.message + "\n\n" + copy.whatYouCanGet : null;

return [
  {
    json: Object.assign({}, ctx, { requesterReply }),
    // Explicit, matching Carry Context After Claim / Assign Routing: several
    // downstream nodes address earlier nodes by name, which resolves through
    // item pairing.
    pairedItem: { item: 0 },
  },
];
