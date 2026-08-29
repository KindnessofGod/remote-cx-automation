// ---------------------------------------------------------------------------
// stuck.js  —  Is this item waiting somewhere nobody can act on it
// ---------------------------------------------------------------------------
// THIS FILE IS THE POINT OF THE WHOLE SURFACE.
//
// A queue of the things that work is worth much less than an honest inventory
// of the things that are stuck, so the stuck list is the headline and every
// other view on this page is context for it.
//
// "STUCK" MEANS ONE THING: a person is still needed, and there is no reachable
// place for that person to act. It decomposes into exactly the failures below,
// each of which was found in production rather than imagined:
//
//   no_ticket           A decision awaiting a human that raised no ticket at
//                       all. Correct, durable, audited — and in nobody's queue,
//                       because nothing in Zendesk represents it.
//   ticket_missing      A reference shaped like a ticket id with no ticket
//                       behind it. Worse than no ticket, because the record
//                       reads as handed over.
//   no_approval_surface Something must approve it and nothing anywhere can.
//                       UC-03's drafted travel letter was the live instance,
//                       until UC-03 gained a sign-off route.
//   queue_owner_absent  A ticket exists, tagged for a team whose Zendesk group
//                       does not exist, so it sits in the account default.
//   queued_elsewhere    A ticket exists and is in some other team's queue.
//   unqueued            A ticket exists and is in no group at all.
//
// THREE OF THOSE SIX HAVE NO MEMBERS TODAY, AND THAT IS A RESULT. `queue_owner_absent`
// emptied on 2026-08-20 when the last unprovisioned team got its group;
// `no_approval_surface` emptied when UC-03 gained a sign-off route; `unqueued`
// has never had one here. None of the three is deleted along with its last
// member — the next team added to `escalationRouting.js` is unprovisioned from
// the moment it is added until somebody runs the setup script, which is exactly
// how the last two arose, and a detector with no members is what a queue that
// has done its job looks like. What a detector must not lose is its TEST: each
// of the three is pinned directly against stuckVerdict() on pure inputs, where
// no account state can reach it, rather than through a seeded row pretending
// the gap is still open.
//
// AND THE TWO THAT MUST NEVER BE CONFLATED, which is why they are separate
// return values rather than one "no approval control" flag:
//
//   A 🔴 dossier has no approval path BY DESIGN and that is correct. It is only
//   stuck if nothing told the team it exists. So a UC-07 dossier sitting in
//   Mobility Legal's queue is NOT on this list, and one with no ticket IS —
//   under no_ticket, with a `why` that says plainly that the missing thing is
//   the hand-off and not a control.
//
//   A missing control that SHOULD exist is the opposite, and it lands under
//   no_approval_surface even when its ticket is perfectly queued, because a
//   ticket a specialist can open and cannot act on is not a place to approve.
//   UC-03's `human_review` held that state — a formal travel letter drafted,
//   stored, queued and unsignable — until this view measured it and the route
//   was built.
//
// "unknown" IS A THIRD VALUE OF `stuck`, NOT A FALSE. When the ticket could not
// be verified (no Zendesk client configured, or the lookup budget spent) this
// view does not know whether the item is reachable, and saying "not stuck"
// would be a claim it cannot support. An empty stuck list and a stuck list that
// could not be computed must never look the same — the count of unknowns is
// carried beside the count of stuck items everywhere both appear.
// ---------------------------------------------------------------------------

/** Worst first. The page renders groups in this order and nothing re-sorts. */
export const CATEGORY_ORDER = Object.freeze([
  "no_ticket",
  "ticket_missing",
  "no_approval_surface",
  "queue_owner_absent",
  "queued_elsewhere",
  "unqueued",
]);

export const CATEGORY_LABELS = Object.freeze({
  no_ticket: "No ticket was ever raised",
  ticket_missing: "The ticket it points at does not exist",
  no_approval_surface: "Nothing anywhere can approve it",
  queue_owner_absent: "Queued to a team that has no group in this account",
  queued_elsewhere: "Sitting in another team's queue",
  unqueued: "In no queue at all",
});

/**
 * @param {object} args
 * @param {{state:string, waitingFor:string|null}} args.awaiting
 * @param {{state:string, group:{state:string,intendedName:string|null}}} args.ticket
 * @param {"exists"|"none_by_design"|"none_missing"|"unknown"} args.control
 * @param {string} args.useCase
 * @param {string|null} args.owningGroup
 * @returns {{stuck:true|false|"unknown", category:string|null, label:string|null,
 *   why:string, also:string[], byDesign:boolean}}
 */
export function stuckVerdict({ awaiting, ticket, control, useCase, owningGroup }) {
  const byDesign = control === "none_by_design";

  if (awaiting.state === "settled") {
    return ok("A person has already decided this. It is not waiting for anyone.", byDesign);
  }

  if (awaiting.state === "unknown") {
    return {
      stuck: "unknown",
      category: null,
      label: null,
      why:
        "This view cannot tell whether the record is still waiting for a person, so it cannot tell whether it is reachable either. " +
        "It is counted as unknown rather than as either answer.",
      also: [],
      byDesign,
    };
  }

  const hits = [];

  // G-3/L-19: a consent request waits on the EMPLOYEE, via the portal's
  // consent surface — never on a Zendesk hand-off. Most of these (every one
  // that arrived through the third-party door, L-12) genuinely raise no
  // ticket at all, by design — the third party's channel is deliberately
  // unauthenticated and outside Zendesk. Skipping the ticket-based checks
  // entirely for this waitingFor value is what stops "no ticket" reading as
  // a defect for a request that was never supposed to have one; it is NOT the
  // same reasoning as `no_approval_surface`, which is skipped below because
  // nothing may ever approve a consent request either way (an employee's own
  // "yes"/"no" is not an approval control in the sidebar's sense).
  if (awaiting.waitingFor !== "consent") {
    if (ticket.state === "none") hits.push("no_ticket");
    if (ticket.state === "not_found") hits.push("ticket_missing");
    if (ticket.state === "confirmed") {
      if (ticket.group.state === "owner_absent") hits.push("queue_owner_absent");
      else if (ticket.group.state === "elsewhere") hits.push("queued_elsewhere");
      else if (ticket.group.state === "unknown") hits.push("unqueued");
    }
  }
  if (awaiting.waitingFor === "approval" && control === "none_missing") hits.push("no_approval_surface");

  if (hits.length === 0) {
    if (ticket.state === "unverified") {
      return {
        stuck: "unknown",
        category: null,
        label: null,
        why:
          "Nothing checked whether this item's ticket exists, so whether anyone can reach it is unknown. " +
          "It is not being reported as reachable on the strength of a reference that merely looks like a ticket id.",
        also: [],
        byDesign,
      };
    }
    return ok(reachableWhy({ awaiting, control, owningGroup, useCase }), byDesign);
  }

  const ordered = CATEGORY_ORDER.filter((c) => hits.includes(c));
  const category = ordered[0];
  return {
    stuck: true,
    category,
    label: CATEGORY_LABELS[category],
    why: whyFor(category, { awaiting, control, useCase, owningGroup, ticket }),
    also: ordered.slice(1).map((c) => CATEGORY_LABELS[c]),
    byDesign,
  };
}

function ok(why, byDesign) {
  return { stuck: false, category: null, label: null, why, also: [], byDesign };
}

function reachableWhy({ awaiting, control, owningGroup, useCase }) {
  if (awaiting.waitingFor === "consent") {
    return (
      "Waiting on the employee to grant or decline, through their own consent surface — not a Zendesk hand-off, " +
      "and none is needed. See the age (L-19): our own policy figure decides when this reads as waiting a while, " +
      "and nothing here may transition the request because time passed."
    );
  }
  if (awaiting.waitingFor === "reading") {
    return (
      `Nothing may approve a ${useCase} dossier and nothing should — that is the design. What it needed was a hand-off, and it has one: ` +
      `it is in ${owningGroup ?? "the owning team"}'s queue, where a specialist reads it and acts outside this system.`
    );
  }
  if (awaiting.waitingFor === "handling") {
    return `The automation escalated and handed this over. An escalation has no approve button anywhere, by design; it is in ${owningGroup ?? "the owning team"}'s queue for a person to work.`;
  }
  if (control === "exists") {
    return `Waiting on a person who has somewhere to go: the ticket is in ${owningGroup ?? "the owning team"}'s queue and the approval control exists.`;
  }
  return "Reachable.";
}

function whyFor(category, { awaiting, control, useCase, owningGroup, ticket }) {
  switch (category) {
    case "no_ticket":
      return awaiting.waitingFor === "reading"
        ? `The dossier is compiled and stored, and nothing raised a ticket for it — so ${owningGroup ?? "the owning team"} has not been told it exists. ` +
            "The missing thing is the hand-off, not an approval control: nothing may approve a high-risk dossier here and nothing should."
        : `A person is needed and nothing in Zendesk represents this request, so it is in nobody's queue. ` +
            "The decision is recorded and audited; the hand-off never happened.";
    case "ticket_missing":
      return (
        "The record points at a ticket id that does not exist in this account. Anyone following the reference finds nothing, " +
        "and the record reads as though it had been handed over."
      );
    case "no_approval_surface":
      return (
        `${useCase} produces work that a named human must sign off, and there is no route anywhere that records that sign-off — ` +
        "not in the sidebar, not in any API. A specialist can open the ticket, read the case, and do nothing with it."
      );
    case "queue_owner_absent":
      return (
        `${ticket.group.intendedName ?? owningGroup ?? "The owning team"} owns this work and has no group in this account, so the ticket could never be assigned to it. ` +
        "It carries the correct routing tag and sits in whichever group Zendesk defaults an unassigned ticket to — correctly labelled, and in nobody's queue."
      );
    case "queued_elsewhere":
      return `The ticket is in a different group from ${ticket.group.intendedName ?? owningGroup ?? "the owning team"}, so the people who own this work are not looking at it.`;
    case "unqueued":
      return "The ticket exists and belongs to no group, so no team's view will show it.";
    default:
      return "Stuck.";
  }
}

/**
 * Roll a list of verdicts up into counts that keep `unknown` separate from
 * `cleared` at every level — the whole discipline of this file in one shape.
 */
export function summarise(items) {
  const byCategory = new Map();
  let stuck = 0;
  let unknown = 0;
  let reachable = 0;
  for (const item of items) {
    const v = item.stuckVerdict;
    if (v.stuck === true) {
      stuck += 1;
      byCategory.set(v.category, (byCategory.get(v.category) ?? 0) + 1);
    } else if (v.stuck === "unknown") unknown += 1;
    else reachable += 1;
  }
  return {
    total: items.length,
    stuck,
    unknown,
    reachable,
    byCategory: CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      label: CATEGORY_LABELS[c],
      count: byCategory.get(c),
    })),
  };
}
