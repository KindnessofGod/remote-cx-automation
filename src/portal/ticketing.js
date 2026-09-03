// ---------------------------------------------------------------------------
// ticketing.js  —  Which portal submissions become a Zendesk ticket, and why
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES
// The ZAF sidebar finds a case by TICKET ID (`GET /api/…/by-ticket/:externalRef`
// on all nine APIs). The portal created no Zendesk ticket at all. So a portal
// submission that reached a human-gated decision produced a correct, durably
// recorded decision — and nothing for the sidebar to attach to. The decision
// surface existed and was unreachable for exactly the submissions being tested.
// This file is the missing half: gates first, then a pre-tagged ticket, then
// the record linked to it.
//
// NOT EVERY SUBMISSION GETS ONE, and the rule is a judgement rather than a
// convenience. A ticket is a real object in a real support queue; creating one
// per submission would fill a live account with noise and make the queue
// useless for the thing it exists for. So:
//
//   - AUTO-RESOLVED decisions get no ticket. That is the whole point of 🟢
//     automation — a clean expense was approved with nobody involved, and a
//     ticket asking a human to notice that is exactly the work the automation
//     removed.
//   - HARD-BLOCKED decisions get no ticket either. `blocked` means a gate
//     refused with nothing left to weigh — a duplicate submission, an expense
//     that is not the submitter's, a sanctioned destination. There is no human
//     action to take; the requester is told and that is the end of it. (A
//     duplicate DELIVERY is the strongest case: creating a ticket for the
//     second delivery of the same request is precisely the duplicate the
//     idempotency ledger exists to prevent.)
//   - Everything else — human_review, ready_for_approval, prepared_for_signoff,
//     the approval-required decisions, and every escalate — DOES get one,
//     because in every one of those a named human has to look.
//
// UC-07 AND UC-08 ARE DELIBERATELY ABSENT, AND THIS IS THE INTERESTING ONE.
// Their dossiers plainly need a human — that is the entire 🔴 design. But
// linking a ticket means writing the ticket id back onto the stored record,
// and their stores have exactly ONE write method and ZERO mutation methods.
// That is not an oversight to work around; it is the structural guarantee the
// tier is argued from, asserted by test in both use cases. Adding a
// `linkTicket()` there would put a mutation method on the two stores whose
// defining property is that they have none — and the next bug would have a
// place to live. So the 🔴 dossiers are handed over as dossiers, read where
// they are, and this file says so rather than quietly bending the rule.
//
// THIS FILE HOLDS NO GATE. It decides nothing about the request; it reads a
// decision that has already been made and answers one question about it. The
// decisions themselves come from each use case's own policy engine, and the
// tags below are labels on an already-final outcome.
// ---------------------------------------------------------------------------

/** Every portal submission carries this, so a real account can find them all. */
export const MARKER_TAG = "portal_request";

/**
 * Decisions that need no ticket, per use case. A DENY-LIST rather than an
 * allow-list, on purpose: a decision string added later (a new escalation
 * reason, a new review route) defaults to CREATING a ticket, which fails
 * toward a human seeing it. An allow-list would fail toward silence, and a
 * request that silently reaches nobody is the failure this whole pass exists
 * to close.
 */
export const NO_TICKET_DECISIONS = Object.freeze({
  // F-2/F-8: UC-01's self-service letter (L-14, src/uc01/selfServiceLetter.js)
  // only ever reaches this table on a SUCCESS — every refusal returns before a
  // case is created at all — and its one success decision is `auto_resolve`:
  // nobody has to look, the same reason UC-03's own `auto_resolve` needs no
  // ticket. Before this entry, `needsTicket("uc01", …)` fell through to
  // `false` for the wrong reason — "uc01" was not a key at all, so
  // `raiseTicketIfNeeded()` printed the 🔴 UC-07/UC-08 sentence ("this use
  // case has no execution path…") on a 🟢 use case that had just issued a
  // letter. UC-01 belongs in this list because it IS ticketable, not because
  // it never needs one.
  uc01: ["auto_resolve"],
  uc02: ["auto_approve", "blocked"],
  // `blocked` joins `auto_resolve` here (2026-09-03): the engagement gate's
  // refusal is terminal on a fact Remote publishes, so there is nothing for a
  // specialist to look at and a ticket would be a hand-off to nobody. Same
  // reasoning UC-01 applies to its own `blocked`.
  uc03: ["auto_resolve", "blocked"],
  uc04: ["blocked"],
  uc05: [],
  uc09: [],
});

/**
 * Use cases the portal can raise a ticket for at all. UC-07 and UC-08 are
 * absent by design — see the header.
 */
export const TICKETABLE_TYPES = Object.freeze(Object.keys(NO_TICKET_DECISIONS));

/**
 * The UC-04 intake tag that stops being true the moment the employer decides.
 *
 * EXPORTED SO THE REMOVER CANNOT DRIFT FROM THE WRITER. This string is added
 * here, at intake, and dropped in src/remoteui/server.js's handOffToMobility()
 * when the customer's manager approves or declines. Two literals would be two
 * things to keep in step, and the failure is SILENT in the worst direction: a
 * remover naming a tag nothing writes removes nothing and reports success, so
 * the stale tag survives and the guard that was supposed to catch it passes.
 *
 * WHY IT NEEDED REMOVING. Read live on 2026-09-01: ticket 127 carried
 * `uc04_awaiting_employer_approval` thirty-five minutes after admin_jane had
 * approved it and Remote's mobility team had cleared it. Tags are written at
 * intake and nothing rewrote them, so the ticket asserted it was waiting for a
 * decision that had already been made twice over. Same defect class as the
 * sidebar badge and the "My requests" status the same evening — a surface that
 * does not move when the state does.
 *
 * ONLY THIS ONE. `uc04_specialist_approval` stays: after the employer approves,
 * a Remote mobility specialist genuinely is the next reader, so that tag is
 * still true. And the QUEUE tag stays on a decline as well, deliberately —
 * handOffToMobility() argues that case where it makes it.
 */
export const UC04_AWAITING_EMPLOYER_TAG = "uc04_awaiting_employer_approval";

/** Outcome tags per use case, matching each one's own n8n/ZAF vocabulary. */
const OUTCOME_TAGS = Object.freeze({
  uc02: {
    human_review: "uc02_finance_ops_review",
    escalate: "uc02_escalated",
  },
  uc03: {
    human_review: "uc03_formal_letter_review",
    escalate: "uc03_escalated",
    route_to_uc04: "uc03_routed_uc04",
    blocked: "uc03_blocked_ineligible",
  },
  uc04: {
    // THE ACTOR IN THIS TAG IS WRONG, AND IT IS ON EVERY LIVE UC-04 TICKET
    // (2026-08-31). `uc04_specialist_approval` says a Remote mobility
    // specialist approves. Since the three-stage correction (UC-04.md §1a) a
    // `ready_for_approval` request waits on the CUSTOMER'S OWN MANAGER, in
    // Remote's own product, and `src/uc04/approvalPolicy.js` refuses the
    // specialist who reads this tag and goes looking for a button.
    //
    // ADDED, NOT RENAMED, and the asymmetry is the whole decision. Twenty live
    // tickets carry the old string, the live Zendesk views and this repo's own
    // registries key off it, and a rename would strand every one of them — the
    // hand-off would be correct for the next request and unfindable for all the
    // existing ones. The n8n port made the same call one file over
    // (`uc04_ready_for_approval` kept, `uc04_awaiting_employer_approval`
    // added), and two surfaces disagreeing about a tag is worse than one
    // surface carrying a legacy one. Retiring the old string is its own unit of
    // work, with a sweep of the live queue, and is not this one.
    ready_for_approval: ["uc04_specialist_approval", UC04_AWAITING_EMPLOYER_TAG],
    escalate: "uc04_escalated",
  },
  uc05: {
    prepared_for_signoff: "uc05_hr_ops_signoff",
    escalate: "uc05_escalated",
  },
  uc09: {
    escalate: "uc09_escalated",
  },
});

/**
 * Does this decision need a Zendesk ticket?
 * @param {string} typeId  the portal's route segment, "uc02" … "uc09"
 * @param {string|null} decision
 */
export function needsTicket(typeId, decision) {
  const skip = NO_TICKET_DECISIONS[typeId];
  if (!skip) return false; // not a ticketable use case at all — see the header
  if (!decision) return false;
  return !skip.includes(decision);
}

/**
 * The tags a created ticket carries: the shared marker, the use case, and the
 * decision's own outcome tag.
 *
 * A decision with no entry in the table above still gets a tag — derived from
 * the decision string itself (`uc09_multi_role_approval_required`) rather than
 * dropped. A ticket with no outcome tag is one a trigger cannot route, and
 * silently untagged is worse than generically tagged.
 */
export function ticketTags(typeId, decision) {
  const named = OUTCOME_TAGS[typeId]?.[decision];
  // AN ENTRY MAY NOW BE A LIST, because one decision can legitimately need two
  // outcome tags: a legacy one that live tickets and live Zendesk views already
  // key off, and a corrected one. See the uc04 entry above for the case that
  // forced it. A string is still a string — the array form is opt-in per entry,
  // so no other use case's tags move.
  const outcome = named ?? `${typeId}_${String(decision ?? "unknown").replace(/[^a-z0-9_]/gi, "_")}`;
  return [MARKER_TAG, typeId, ...(Array.isArray(outcome) ? outcome : [outcome])];
}

// ---------------------------------------------------------------------------
// THE SECOND DECISION ON THE SAME TRIP — and whether it gets a second ticket
// ---------------------------------------------------------------------------
// THE DEFECT THIS ANSWERS. An employee asked whether a trip was all right on
// the portal, was answered informationally, and accepted the offer of a formal
// travel letter. That accept produced a correct, durable, audited second
// decision — `human_review / formal_letter_requested`, with the letter drafted
// and a `review_queue` row — and RAISED NO ZENDESK TICKET, because the accept
// route returned straight out of `acceptTravelLetterOffer()` without ever
// reaching `raiseTicketIfNeeded()`. The ZAF sidebar finds a case BY TICKET ID.
// With no ticket there was no ticket to open, so no panel rendered, so the
// specialist was not missing a sign-off button — they were missing the entire
// case. Measured in production: case `c2df9893…`, `pending_review`, filed under
// `uc03-20260820095458-18k04`, a portal reference that names no ticket.
//
// THE DESIGN QUESTION, AND THE ANSWER: THE TICKET FOLLOWS THE TRIP.
//
// A letter request is a second decision on a trip that already has one. The
// ticket could follow the CASE (one ticket per thing to be done) or the TRIP
// (one conversation about one journey). This repository chooses the trip, and
// the choice is already half-made in `acceptTravelLetterOffer()`: when the
// answer came from Zendesk it REOPENS that ticket rather than raising another,
// because the informational answer had solved it. Doing the opposite here would
// mean the same act produced one ticket from Zendesk and two from the portal.
//
// The three reasons, in the order they matter:
//
//   1. THE SPECIALIST READS A CONVERSATION, not a row. Signing a letter means
//      reading what was asked, what was answered, and what is now being
//      certified — to a consulate, on the legal entity's letterhead. Splitting
//      that across two tickets asks them to find the other half, and nothing
//      would link the halves: `readStore.js` resolves a reference by
//      `details->>'externalRef'` alone, so a pointer that is not in that field
//      is a pointer nobody can follow.
//   2. THE QUEUE STILL COUNTS ONE ROW OF WORK. The worry about following the
//      trip is that a queue counting tickets under-counts the work. It does not
//      here: the `review_queue` row is what a queue counts, `caseStore
//      .findByExternalRef()` returns the NEWEST case for a reference, and the
//      newest is the letter case. So the sidebar opened on that ticket renders
//      the letter panel with its sign-off control — the second decision, not
//      the settled first one.
//   3. A TRIP WITH NO TICKET STILL NEEDS ONE, and that is the actual gap. Every
//      portal-answered trip has none, because an auto-resolved answer raises no
//      ticket by design (`NO_TICKET_DECISIONS.uc03` above, and rightly — a
//      ticket asking a human to notice a zero-touch answer is the work the
//      automation removed). The letter request is the first thing on that trip
//      a person must act on, so it is the first thing that earns a ticket.
//
// WHETHER THE TRIP ALREADY HAS ONE IS DERIVED, NEVER ASSUMED. Not "the source
// is portal, so there is no ticket" — that is a fact about today's deny-list
// restated in a second place, free to drift the moment an offer is made on
// another outcome. It is read off the answered case itself: a Zendesk-sourced
// case's `externalRef` IS its ticket id, and a portal case's `externalRef` is
// the ticket id exactly when its own decision needed one, because `linkTicket()`
// replaced it at that moment. Both branches ask the same table this file
// already owns.
// ---------------------------------------------------------------------------

/**
 * Does the accepted letter request need a Zendesk ticket raised for it, or does
 * the trip already have one?
 *
 * Pure — no store, no clock, no HTTP. It reads two rows that already exist and
 * answers one question about them, the same shape as `needsTicket()` above.
 *
 * @param {object} args
 * @param {object|null} args.answeredCase  the auto-resolved case the offer was
 *   made on, as stored. `source` and `externalRef` are the only fields read.
 * @param {string|null} args.decision  the SECOND decision, the one the accept
 *   just produced. Usually `human_review`; `escalate` or `route_to_uc04` when
 *   the trip stopped clearing the gates it cleared when it was answered, and
 *   those need a human every bit as much.
 * @returns {{raise: boolean, existingTicketId: string|null, code: string,
 *   note: string}}
 */
export function letterTicketPlan({ answeredCase, decision }) {
  if (!answeredCase) {
    return {
      raise: false,
      existingTicketId: null,
      code: "no_answered_case",
      note:
        "No Zendesk ticket: the answered travel request this letter continues could not be read back, so there is " +
        "nothing to say whether the trip already has a ticket. The letter decision itself is recorded and audited.",
    };
  }

  const ref = answeredCase.externalRef ? String(answeredCase.externalRef) : null;
  const carriesTicket =
    ref !== null && (answeredCase.source === "zendesk" || needsTicket("uc03", answeredCase.decision));

  if (carriesTicket) {
    return {
      raise: false,
      existingTicketId: ref,
      code: "ticket_follows_trip",
      note:
        `No new Zendesk ticket: this trip is already ticket #${ref}, and the letter request is a second decision on ` +
        "the same journey rather than a new one. A specialist opening that ticket gets the newest case on it, which " +
        "is this letter — the whole story in one conversation.",
    };
  }

  if (!needsTicket("uc03", decision)) {
    return {
      raise: false,
      existingTicketId: null,
      code: "no_human_needed",
      note: "No Zendesk ticket: this decision needs no human, so raising one would be noise in a real queue.",
    };
  }

  return {
    raise: true,
    existingTicketId: null,
    code: "raise_new_ticket",
    note: "",
  };
}
