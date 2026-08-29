// ---------------------------------------------------------------------------
// signoffPolicy.js  —  Whether a specialist may issue THIS drafted travel letter
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT ALMOST DID NOT
//
// `docs/APPROVAL-QUEUE.md` §0 measured, against production, three UC-03 cases
// in the category `no_approval_surface`: "correctly ticketed, correctly queued,
// and no route anywhere records a sign-off". That is a true statement, and the
// obvious response to it — give UC-03 an approve button — would have been
// wrong. All four `review_queue` rows waiting on a person that day were
// `route_to_uc04` / `work_authorization_requested`, and NOT ONE of them is
// something a person signs. A handoff is not an approval. An approve button on
// those rows would be a 🟢 router minting a 🟡 work authorization by click,
// which is the exact dispatch `src/uc03/uc04Intake.js` argues at length against.
//
// So this module gates ONE outcome and refuses the other four by name:
//
//     human_review / formal_letter_requested   -> the one decision this file
//         admits BY NAME. It was the ordinary outcome of every letter request
//         when this module was written; it is not any more, and the change is
//         the most important thing to know about this file.
//
//         A STANDARD letter, for a traveller every gate has qualified, on a
//         trip inside the duration cap, is now written and issued by
//         `policyEngine.js`'s letter rung with nobody in the path — the project
//         owner's decision, argued in `docs/use-cases/UC-03.md` §23. What still
//         reaches this rung is a letter that was asked for, IS allowed, and had
//         no LETTERHEAD to be written on, because `getLegalEntity()` returned
//         nothing usable. On that path nothing is drafted at all, so
//         `evaluateLetterActionability()` below refuses it with `letter_missing`
//         — correctly, and that refusal names the real work: fix the
//         employing-entity record and re-run.
//
//         SO THE SUCCESS PATH OF THIS MODULE IS NOW REACHABLE ONLY FOR CASES
//         DECIDED BEFORE THAT CHANGE, and saying so is the point. A gate whose
//         success path cannot be reached and a gate that is being appropriately
//         cautious look identical from outside — this repository's most
//         expensive recurring defect — so it is written down here, in
//         `UC-03.md` §23.6, and pinned by a test rather than left to be
//         rediscovered. The module is kept rather than deleted because those
//         cases are real, `documents` and `review_queue` still hold them, and
//         the refusals below are the only thing that explains them to a reader.
//
//     human_review / low_confidence | confidence_unknown  -> NOT SIGNABLE, and
//         this is the refusal that matters most. Those two reasons mean the
//         router did not trust its own reading of the request. Nobody asked for
//         a letter; the extraction is what is in doubt. A letter drafted from a
//         classification we refused to trust is not a letter a specialist can
//         responsibly sign, and `workflow.js` no longer drafts one at all — see
//         its STEP 5. The work here is to confirm the intent and re-run, not to
//         sign.
//
//     route_to_uc04  -> NOT SIGNABLE. The person picking this up has real work
//         to do, and it is an outreach, not a signature: the employee has to
//         raise a work-authorisation request in Remote's own Request Hub. The
//         refusal says that instead of saying "you may not approve this", which
//         would leave the reader with nothing to do.
//
//     escalate       -> NOT SIGNABLE. Same rule `src/review/reviewPolicy.js`
//         gate 1 states for every use case: an escalation is visible and never
//         closable from a sidebar, or the safe path doubles as a dismiss button.
//
//     auto_resolve / all_gates_passed  -> NOT SIGNABLE. It was answered
//         informationally, in plain text, with no letter and no compensation in
//         it. There is no artifact here, and never was.
//
//     auto_resolve / standard_letter_issued  -> NOT SIGNABLE, and this is the
//         new one. There IS an artifact, it is the real travel letter, and it
//         has already gone to the employee. Signing it would be a second
//         release of a document that has already been released. The refusal
//         says that rather than "not actionable", because the two read
//         identically to a specialist and mean opposite things.
//
// Pure function over plain rows — no database, no HTTP, no clock — same split
// as `src/uc05/signoffPolicy.js`, `src/uc04/approvalPolicy.js` and
// `src/review/reviewPolicy.js`. `policyEngine.js` decided once, when the ticket
// arrived, whether a letter should be drafted. THIS file decides, possibly days
// later, whether one named human may release it.
//
// NO HIGH-TIER BACKSTOP HERE, DELIBERATELY. `reviewPolicy.js` carries one
// because it serves whatever use case a shared `cases` row belongs to. This
// file is reached only through UC-03's own API, `USE_CASE_TIERS["UC-03"]` is
// `"low"`, and `classifyRisk()` can raise a flagged low-tier case to `medium`
// and no further — so a `tier === "high"` branch here would be unreachable
// code wearing the appearance of a control, which this repository has paid for
// twice. The structural equivalent IS present and IS reachable: the only
// decision this file will act on is named explicitly, so a new UC-03 outcome
// added later is refused by default rather than admitted by default.
// ---------------------------------------------------------------------------

import { attribution, noteClause, gateClause, humanTime } from "../shared/settledDecision.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
import { describeDecidingGate, describeGateLadder } from "./policyEngine.js";
import { UC03_ROLE } from "../review/approverEntitlement.js";

/**
 * The verbs. `signoff` matches UC-05's positive verb — this is a sign-off on a
 * prepared artifact, not an approval of a state change, and UC-05 already
 * settled that word for that shape. `decline` is the repo-wide negative verb
 * (docs/REMOTE-VOCABULARY.md §2.1); `deny` is still accepted on input and
 * normalised at the entry point in workflow.js.
 */
export const ACTIONS = new Set(["signoff", "decline"]);

/** The one case decision this surface may act on. Named, never inferred. */
export const SIGNABLE_DECISION = "human_review";
/** …and the one reason within it. `human_review` alone is not enough — see the header. */
export const SIGNABLE_REASON = "formal_letter_requested";

/** The `documents.type` the drafted letter is stored under (workflow.js STEP 6c). */
export const LETTER_DOCUMENT_TYPE = "travel_support_letter";

export const REFUSALS = {
  case_not_found: { status: 404, reason: "No UC-03 case exists with this id." },
  approver_required: { status: 401, reason: "No approver identity was supplied." },
  unknown_action: { status: 400, reason: "action must be 'signoff' or 'decline'." },
  no_signoff_path: {
    status: 403,
    reason: "This travel request produced no letter to sign, so there is nothing to sign off here.",
  },
  classification_unconfirmed: {
    status: 403,
    reason:
      "The router could not trust its reading of this request, so no travel letter was drafted and none can be " +
      "issued. Confirm what the employee is actually asking for and re-run the request.",
  },
  letter_missing: {
    status: 409,
    reason:
      "This case asked for a formal travel letter and no drafted letter is stored against it, so there is nothing " +
      "to put a signature on. Re-run the request rather than issuing an unseen document.",
  },
  review_entry_missing: {
    status: 409,
    reason: "This case is awaiting a specialist but has no review-queue entry to record the decision on.",
  },
  already_decided: { status: 409, reason: "A specialist has already signed off or declined this letter." },
  self_signoff: {
    status: 403,
    reason: "The employee a travel letter is about may not sign it off.",
  },
  reason_required: {
    status: 400,
    reason:
      "A declined travel letter must carry a reason — the employee is told why, and the reason is recorded in the " +
      "audit log.",
  },
  // Raised by workflow.js, not by the pure gate below: it needs a live read of
  // the employment record, which this file deliberately cannot do. Registered
  // here anyway so every refusal this API can return has exactly one definition
  // of its status code and its wording.
  employment_no_longer_active: {
    status: 409,
    reason:
      "The employment record is no longer active. A travel letter states that this person is employed today, so it " +
      "cannot be issued against a record that has since changed — re-run the request instead.",
  },
};

/**
 * @typedef {object} SignoffVerdict
 * @property {boolean} allowed
 * @property {string} code
 * @property {string} reason
 * @property {number} status
 */

/**
 * Is this CASE open to a specialist's sign-off at all — regardless of who is
 * asking? Split out so a UI can ask "should I render controls?" without
 * inventing a fake approver identity to ask with, exactly as
 * `evaluateCaseActionability()` and `evaluateResignationActionability()` are.
 *
 * @param {object} args
 * @param {object|null} args.caseRow          the `cases` row (camelCase)
 * @param {object|null} args.reviewRow        the matching `review_queue` row, if any
 * @param {object|null} [args.letterDocument] the stored `travel_support_letter`, if any.
 *   Passed IN rather than looked up, so this stays a pure function — and passed
 *   at all because a signature on a document nobody can produce is worse than
 *   no signature.
 * @returns {SignoffVerdict}
 */
export function evaluateLetterActionability({ caseRow, reviewRow, letterDocument = null }) {
  if (!caseRow) return refuse("case_not_found");

  // ONE DECISION IS ADMITTED BY NAME; EVERY OTHER OUTCOME IS REFUSED WITH A
  // SENTENCE THAT SAYS WHAT THE PERSON ACTUALLY HAS TO DO. A bare "not
  // actionable" on a `route_to_uc04` row is how a queue entry comes to look
  // like a missing button rather than an outstanding outreach.
  if (caseRow.decision !== SIGNABLE_DECISION) {
    return refuse("no_signoff_path", { reason: describeNoSignoffPath(caseRow) });
  }
  if (caseRow.reason !== SIGNABLE_REASON) {
    return refuse("classification_unconfirmed", { reason: describeUnconfirmed(caseRow) });
  }

  if (!reviewRow) return refuse("review_entry_missing");
  if (reviewRow.status !== "pending") return refuse("already_decided", { reason: describeSettled(caseRow, reviewRow) });

  // LAST, NOT FIRST. A case whose letter is missing but which has already been
  // decided should say it was decided — the missing document is then a
  // curiosity, not the answer to "can I act on this".
  if (!letterDocument) return refuse("letter_missing");

  return {
    allowed: true,
    code: "actionable",
    status: 200,
    reason: "A formal travel letter is drafted and awaiting Travel & Mobility Support's sign-off before it is issued.",
  };
}

/**
 * Decide whether `approver` may take `action` on this case right now.
 *
 * @param {object} args
 * @param {object|null} args.caseRow
 * @param {object|null} args.reviewRow
 * @param {object|null} [args.letterDocument]
 * @param {string|null} args.approver   the VERIFIED identity, never a body claim
 * @param {"signoff"|"decline"} args.action
 * @param {string} [args.note]
 * @param {{check: Function}|null} [args.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional, consulted LAST, only refuses.
 * @returns {SignoffVerdict}
 */
export function evaluateLetterSignoffAction({
  caseRow,
  reviewRow,
  letterDocument = null,
  approver,
  action,
  note = "",
  entitlement = null,
}) {
  // Request-shaped checks first, so a malformed or unauthenticated call is
  // never answered with information about a case it had no business naming.
  if (!approver || typeof approver !== "string" || !approver.trim()) return refuse("approver_required");
  if (typeof action !== "string" || !ACTIONS.has(action)) return refuse("unknown_action");

  const actionability = evaluateLetterActionability({ caseRow, reviewRow, letterDocument });
  if (!actionability.allowed) return actionability;

  // SEGREGATION OF DUTIES. `cases.requester` holds the authenticated employment
  // id the request came in under; the approver is a Zendesk/ZAF identity, so the
  // two live in different namespaces today and this only bites if they are ever
  // unified — which is exactly when it starts mattering and exactly when nobody
  // would remember to add it. Same reasoning, same wording, as
  // src/review/reviewPolicy.js. It is sharper here than there: a travel letter
  // is a document about the requester, addressed to a destination authority.
  if (caseRow.requester && caseRow.requester === approver.trim()) {
    return refuse("self_signoff");
  }

  // A REASON IS REQUIRED ON A DECLINE AND NOT ON A SIGN-OFF, and the asymmetry
  // is the point. Signing off says "this drafted letter is correct as drafted"
  // — the artifact IS the statement, and demanding prose beside it produces
  // notes reading "ok". A decline is a refusal the employee has to be told the
  // reason for, and src/shared/settledDecision.js already treats a
  // reason-less decline as a finding rather than a blank. Requiring it up front
  // is cheaper than reporting its absence forever afterwards.
  if (action === "decline" && (!note || typeof note !== "string" || !note.trim())) {
    return refuse("reason_required");
  }

  // ENTITLEMENT IS CONSULTED LAST AND CAN ONLY EVER REFUSE (see that module's
  // properties 1 and 2). UC-03 has no `role` parameter — one letter, one
  // signature — so the role is NOMINAL: `travel_support_specialist`, named once
  // in src/review/approverEntitlement.js and passed here as a constant, never
  // read off a request body. Without it, any identity able to reach the route
  // could put the company's name on a letter to a foreign border authority.
  if (entitlement) {
    const denial = entitlement.check({ useCase: "UC-03", role: UC03_ROLE, approver });
    if (denial) return denial;
  }

  return { allowed: true, code: action, status: 200, reason: `Permitted: ${action}.` };
}

/**
 * A UC-03 case that has no letter to sign, described by what it actually IS —
 * and, where the gate ladder can say it, by what its own deciding gate meant.
 *
 * Every branch names the outstanding human work rather than only denying the
 * click, because these are the rows `docs/APPROVAL-QUEUE.md` §0 measured as
 * stuck. Three of them were `route_to_uc04`, and what they need is somebody to
 * tell an employee to file in the Request Hub — a sentence that a refusal
 * reading "not actionable" would never have produced.
 */
export function describeNoSignoffPath(caseRow) {
  const row = caseRow ?? {};
  const gate = gateClause(describeDecidingGate, row.reason);

  if (row.decision === "route_to_uc04") {
    return (
      "This is a work-authorisation request, not a travel letter, and there is nothing to sign." +
      " UC-03 recorded a handoff event for inspection and dispatched nothing — no UC-04 case exists." +
      " The outstanding work is an outreach, not a signature: the employee raises a work-authorisation request in" +
      " Remote's own Request Hub (no API can create one on their behalf), and UC-04 decides on that." +
      " See the decision's `uc04Intake` block for what this travel request cannot carry over."
    );
  }

  if (row.decision === "escalate") {
    return (
      `This travel request was ESCALATED${gate.at}, not prepared for a letter.${gate.means}` +
      " It is worked by Travel & Mobility Support on its own ticket; an escalation is visible here and is never" +
      " closed from a sidebar."
    );
  }

  if (row.decision === "auto_resolve" && row.reason === "standard_letter_issued") {
    return (
      "The travel letter on this case has ALREADY BEEN ISSUED, and no signature was needed. Every gate passed, the" +
      " request asked for nothing the standard template cannot say, and the 🟢 path wrote and delivered it — the" +
      " document and its sha256 are on this case and on its audit row. There is nothing to sign because there is" +
      " nothing outstanding; a signature here would be a second release of a document that has already gone."
    );
  }

  if (row.decision === "auto_resolve") {
    return (
      "This inquiry was answered informationally and closed — a plain-text answer with the mandatory travel" +
      " disclaimer, no formal letter and no compensation in it. There is no artifact here to sign, and there never" +
      " was one."
    );
  }

  return REFUSALS.no_signoff_path.reason;
}

/**
 * A `human_review` case that stopped somewhere other than the letter gate.
 *
 * Kept separate from `describeNoSignoffPath()` on purpose: "this request has no
 * letter in it" and "we could not read this request" are opposite findings, and
 * one sentence covering both would tell the specialist neither.
 */
export function describeUnconfirmed(caseRow) {
  const row = caseRow ?? {};
  const gate = gateClause(describeDecidingGate, row.reason);
  if (row.reason === "low_confidence" || row.reason === "confidence_unknown") {
    return (
      `A person is needed here${gate.at}, and what they owe is a reading of the request, not a signature.${gate.means}` +
      " No travel letter was drafted, deliberately: a formal letter built from an extraction the router itself" +
      " refused to trust is not something anybody can responsibly sign. Confirm what is being asked and re-run it."
    );
  }
  return REFUSALS.classification_unconfirmed.reason;
}

/**
 * A letter that has already been signed off or declined, described from the
 * `review_queue` row rather than as a list of possibilities.
 *
 * `review_queue` records `approved` / `rejected` — the exact vocabulary
 * `src/metrics/compute.js` counts for the HITL accept rate, which is why this
 * reads those words and does not rename them. What a person sees says
 * "signed off" / "declined", which is what actually happened to the letter.
 */
export function describeSettled(caseRow, reviewRow) {
  const review = reviewRow ?? {};
  const status = canonicalDecisionStatus(review.status);

  if (status === "approved") {
    const by = attribution(review.assignee, review.updatedAt);
    const note = noteClause(review.notes);
    return (
      `Already SIGNED OFF${by}.${note} The travel letter has been issued; it cannot be signed off or declined` +
      " again, and a further copy would be a second signed document for one request."
    );
  }

  if (status === "rejected" || status === "declined") {
    const by = attribution(review.assignee, review.updatedAt);
    const note = noteClause(review.notes, {
      label: "Reason given",
      expected: true,
      missing: "No reason was recorded, which a decline is supposed to carry.",
    });
    return `Already DECLINED${by}.${note} A declined letter has to be re-drafted by re-running the request, not re-decided here.`;
  }

  return REFUSALS.already_decided.reason;
}

/**
 * WHAT THE SYSTEM WOULD DO, AND WHY — the second half of the project owner's
 * statement, which the first half made overdue:
 *
 *   "Some parts of things that have some legal implications, the system can
 *    decide and recommend an action to the expert, but submit for approval."
 *
 * Until this function, a specialist opening a UC-03 letter case was handed a
 * COMPILED CASE and no proposal. They got the decision slug, the deciding rung
 * in plain words, the whole gate ladder, the figures each rung compared, the
 * request's own text and the drafted document — everything needed to reconstruct
 * the reasoning, and not one sentence saying what this system thinks should
 * happen. That is a real difference. A compiled case asks a person to derive the
 * answer; a recommendation asks them to check one, which is faster and, more
 * importantly, is falsifiable: a proposal a reviewer disagrees with is a
 * measurable event (`src/metrics/compute.js` counts approve/decline against the
 * automation's recommendation), and a case with no proposal in it can never
 * disagree with anybody.
 *
 * THREE PROPERTIES, EACH PINNED BY TEST RATHER THAN PROMISED IN THIS COMMENT:
 *
 *   1. IT IS PURE AND IT DECIDES NOTHING. It takes rows and returns prose. No
 *      gate calls it, no route consults it, and it has no return value any
 *      caller could act on automatically — `action` is a verb the human may
 *      press, never one this system presses.
 *   2. IT NEVER RECOMMENDS SOMETHING THE POLICY WOULD REFUSE. It is computed
 *      FROM `evaluateLetterActionability()`'s verdict, so a case with no
 *      signable path recommends nothing at all rather than proposing a click
 *      that would 403 — the "button that cannot work" shape this repository has
 *      already paid for on this exact surface.
 *   3. IT CARRIES ITS OWN CAUTIONS. A recommendation that lists only reasons to
 *      agree is an argument, not advice. `check` names what the reviewer is
 *      being asked to confirm that this system could not — starting with the one
 *      thing the gates cannot see: whether the drafted document is right for the
 *      authority that will read it.
 *
 * @param {object} args
 * @param {object|null} args.caseRow
 * @param {object|null} args.reviewRow
 * @param {object|null} [args.letterDocument]
 * @returns {{action:string|null, label:string, because:string[], check:string[],
 *   isRecommendation:true}|null} null when the case is not open to a decision at
 *   all — there is nothing to recommend, and an empty proposal reads like
 *   missing data.
 */
export function recommendLetterAction({ caseRow, reviewRow, letterDocument = null }) {
  const actionability = evaluateLetterActionability({ caseRow, reviewRow, letterDocument });
  if (!actionability.allowed) {
    // ONE EXCEPTION, AND IT IS THE ONE THAT MATTERS ON THIS SURFACE TODAY. A
    // letter case with no drafted document is the only way a new request reaches
    // a specialist at all, and "not actionable" would leave them with nothing to
    // do. There IS an action; it is simply not one this route can take.
    if (actionability.code === "letter_missing") {
      return {
        action: null,
        label: "Nothing to sign — fix the employing-entity record, then re-run the request",
        because: [
          "Every gate about the trip itself passed: this letter is allowed, and on the default posture it would " +
            "have been issued with no signature at all.",
          "No document exists to put a signature on. The employing entity could not be read from Remote, so there " +
            "was no letterhead to write on and nothing was drafted.",
        ],
        check: [
          "That the employment record names a legal entity, and that Remote returns it.",
          "Whether the employee needs the letter sooner than the record can be fixed — if so, it has to be written " +
            "outside this system, and this case is not the place to record that.",
        ],
        isRecommendation: true,
      };
    }
    return null;
  }

  const ladder = describeGateLadder(caseRow?.reason);
  const passed = ladder.filter((rung) => rung.status === "passed").length;

  return {
    // THE VERB, MATCHING THE ROUTE. Naming an action the API does not have is
    // how a recommendation becomes a dead button one release later.
    action: "signoff",
    label: "Sign off and issue this letter",
    because: [
      passed > 0
        ? `Every check above this one passed — ${passed} of ${ladder.length} rungs, including identity against the ` +
          "authoritative record, an active employment, a destination that is neither restricted nor outside " +
          "Remote's registry, and a trip inside the duration cap."
        : "Every check this router makes passed.",
      "Nothing outside the standard template was asked for, and every row the template asserts has a value behind " +
        "it — so this is a signature on a prepared document, not a document to be reconstructed.",
      "The letter is drafted from the employment record as read, never from anything a model wrote.",
    ],
    check: [
      "That the drafted document says what the destination authority actually needs. This system cannot see the " +
        "consulate's requirements and does not claim to.",
      "That the trip is still going ahead as stated — the dates are the employee's, read from their own words.",
      // NAMED HERE BECAUSE IT IS THE ONE REFUSAL THAT ARRIVES AFTER THE CLICK.
      "Nothing needs checking about the employment status: it is re-read from Remote at the moment you sign, and " +
        "the sign-off refuses rather than issuing against a record that has changed.",
    ],
    isRecommendation: true,
  };
}

/**
 * The same facts as label/value rows, for the sidebar's settled-decision card.
 * Returns null while the case is still open — there is nothing settled to
 * describe, and an empty bundle reads like missing data. Mirrors
 * `src/uc04/approvalPolicy.js`'s `settledFacts()`.
 */
export function settledFacts(reviewRow, letterDocument = null) {
  const review = reviewRow ?? {};
  const status = canonicalDecisionStatus(review.status);

  if (status === "approved") {
    const facts = [];
    if (review.assignee) facts.push({ label: "Signed off by", value: String(review.assignee) });
    const when = humanTime(review.updatedAt);
    if (when) facts.push({ label: "Signed off on", value: when });
    const note = String(review.notes ?? "").trim();
    if (note) facts.push({ label: "Note left", value: note });
    // WHAT WAS ACTUALLY SIGNED. A signature that does not name the document it
    // covers is a signature on whatever the store happens to hold now.
    if (letterDocument?.contentHash) {
      facts.push({ label: "Letter signed (sha256)", value: String(letterDocument.contentHash) });
    }
    return {
      headline: "Travel letter signed off and issued.",
      facts,
      finality: "This is final — an issued letter cannot be signed off or declined again.",
    };
  }

  if (status === "rejected" || status === "declined") {
    const facts = [];
    if (review.assignee) facts.push({ label: "Declined by", value: String(review.assignee) });
    const when = humanTime(review.updatedAt);
    if (when) facts.push({ label: "Declined on", value: when });
    facts.push({
      label: "Reason given",
      value: String(review.notes ?? "").trim() || "None was recorded, which a decline is supposed to carry.",
    });
    return {
      headline: "Travel letter declined — nothing was issued.",
      facts,
      finality: "This is final — the request has to be re-run rather than re-decided here.",
    };
  }

  return null;
}

/**
 * WHO IS BEING ASKED TO DECIDE — the `approvalRoles` block
 * `docs/SIDEBAR-APPROVAL-ROLES.md` §3 specifies, so the sidebar renders it with
 * no sidebar change.
 *
 * `youHold` is `null` unless an entitlement checker is supplied, and `null` is
 * NOT `true`: "nothing checked this here" and "you hold this role" are
 * different answers, and only one of them is safe to render as a tick.
 *
 * @param {object} args
 * @param {object|null} args.caseRow
 * @param {object|null} args.reviewRow
 * @param {{check: Function}|null} [args.entitlement]
 * @param {string|null} [args.reader]  the VERIFIED reader identity, when there is one
 */
export function approvalRoles({ caseRow, reviewRow, entitlement = null, reader = null }) {
  const review = reviewRow ?? {};
  const status = canonicalDecisionStatus(review.status);
  const filled = status === "approved" || status === "rejected" || status === "declined";

  let youHold = null;
  if (entitlement && reader) {
    youHold = entitlement.check({ useCase: "UC-03", role: UC03_ROLE, approver: reader }) === null;
  }

  return {
    summary:
      "One named Travel & Mobility Support specialist signs off the drafted travel letter before it is issued." +
      " There is no second signature.",
    roles: [
      {
        roleId: `uc03:${UC03_ROLE}`,
        label: "Travel & Mobility Support specialist",
        decides: "whether the drafted travel letter is correct and may be issued to the employee",
        filledBy: filled ? (review.assignee ?? null) : null,
        filledOn: filled ? humanTime(review.updatedAt) || null : null,
        filledAs: filled ? (status === "approved" ? "Signed off" : "Declined") : null,
        youHold,
      },
    ],
  };
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
