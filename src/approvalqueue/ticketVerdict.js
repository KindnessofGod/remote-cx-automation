// ---------------------------------------------------------------------------
// ticketVerdict.js  —  Is there actually a ticket, and is it in anybody's queue
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT REFUSES TO GUESS
//
// "Where is this actioned?" reduces to two facts: a ticket exists, and it sits
// in the queue of the team that owns it. Both are facts about a Zendesk
// account, and neither is stored in this system's tables. What IS stored is a
// reference — and a reference that looks like a ticket id is not a ticket.
//
// Proven live on 2026-08-19 while this file was being written. Four records
// carried the references 9001, 9002, 2004, 2007. Every one of them reads as a
// Zendesk ticket id. Every one of them returns "not found" against the real
// account — they are ids minted by the mock Zendesk server during local runs.
// Meanwhile 40–51 are real tickets. Nothing about the strings tells them apart.
//
// So the shape of a reference is EVIDENCE and never a verdict, and this file
// has four separate answers where a naive one would have two:
//
//   "confirmed"   asked Zendesk, the ticket is there. Only this state produces
//                 a link — the brief says a link that would 404 must not be
//                 rendered, and this is the only state that can promise that.
//   "not_found"   asked Zendesk, there is no such ticket. The record believes
//                 it was handed over and it was not. STUCK.
//   "unverified"  the reference could be a ticket id and nobody asked, because
//                 no Zendesk client is configured (or the per-run lookup budget
//                 was spent). NOT a synonym for either of the two above. It is
//                 the honest middle, and it is counted separately everywhere.
//   "none"        the reference is not a ticket id and no audit row records
//                 one, so no ticket was ever raised for this record. Nobody was
//                 told. STUCK.
//
// THE GROUP HALF IS THE ONE THAT CAUGHT THE REAL DEFECT. A ticket can exist,
// carry the right routing tag, and still be in nobody's queue: Zendesk drops a
// ticket into the account's default group when the caller assigns none, and a
// tag is a label a trigger *could* route on rather than a queue. A correctly
// tagged ticket in the wrong group is indistinguishable from a healthy hand-off
// unless something compares the ticket's group against the owning team, which
// is what groupVerdict() below does.
//
// AND THE COMPARISON HAS TWO WAYS TO FAIL, which is why groupVerdict() answers
// four things and not two. The ticket may be in another team's queue, or the
// owning team may have no queue in this account at all — same symptom, two
// different fixes (re-assign the ticket; create the group and re-sync).
//
// The instance that prompted this file, kept as dated history rather than as
// the description: on 2026-08-19 ticket #51 — a UC-04 request ready for one
// mobility specialist to approve — carried `queue_mobility_specialists` and sat
// in the default "Support" group, because the account had no group called
// "Mobility Specialists" at all. That group was created on 2026-08-20 and every
// routed team has had one since, so the live reading of #51 moved from
// `owner_absent` to `elsewhere`: creating a group does not move a ticket that
// was raised before it existed. The second answer is the one production is
// giving today, and it is still stuck.
//
// IT COMPARES IDS, NOT NAMES, AND NEEDS NO EXTRA SCOPE. The synced map
// (src/shared/escalationGroupIds.js, `npm run sync-groups`) already holds
// name → id for every routing group in this account. A ticket read needs only
// `tickets:read`; listing groups needs the wider `read`. Comparing the ticket's
// `group_id` to the synced id therefore answers the question with the least
// privilege the client already has — and an owning team ABSENT from that map is
// itself the finding, not a gap in the check.
//
// PURE. No I/O here — the lookup result is handed in. The caller does the
// asking (ticketFacts.js) so this judgement can be tested without a network.
// ---------------------------------------------------------------------------

import { groupIdFor } from "../shared/escalationGroupIds.js";

/** A reference that could be a Zendesk ticket id. Shape only — see the header. */
export function looksLikeTicketId(ref) {
  return typeof ref === "string" && /^[0-9]{1,12}$/.test(ref.trim());
}

/**
 * @param {object} args
 * @param {string|null} args.reference   the record's external_ref
 * @param {string|null} [args.recordedTicketId]  a ticket id an audit row states
 *   outright (portal_reference_relinked / _superseded). Stronger evidence than
 *   the reference's shape, and preferred when present.
 * @param {object|null} [args.lookup]  what ticketFacts.js found, or null when
 *   nothing was asked. `{checked:false, reason}` | `{checked:true, found:false}`
 *   | `{checked:true, found:true, ticket:{...}}`
 * @param {string|null} [args.subdomain]  Zendesk subdomain, for the link. The
 *   URL is composed HERE and never in the browser — same rule as the portal's.
 * @param {string|null} [args.owningGroup]  the team that owns this hand-off
 */
export function ticketVerdict({ reference, recordedTicketId = null, lookup = null, subdomain = null, owningGroup = null }) {
  const candidate = recordedTicketId ?? (looksLikeTicketId(reference) ? String(reference).trim() : null);
  const evidence = recordedTicketId
    ? "an audit row records this ticket id against the record"
    : "the record's own reference is shaped like a ticket id";

  if (!candidate) {
    return {
      state: "none",
      ticketId: null,
      url: null,
      headline: "No ticket was raised",
      detail:
        `The record's reference is "${reference ?? "(none)"}", which is not a Zendesk ticket id, and no audit row records one against it. ` +
        "Nothing in Zendesk represents this request, so nobody has been told about it.",
      group: noGroup("There is no ticket, so there is no queue."),
    };
  }

  if (!lookup || lookup.checked === false) {
    return {
      state: "unverified",
      ticketId: candidate,
      url: null, // never a link we have not confirmed
      headline: `Reference ${candidate} may be ticket #${candidate}`,
      detail:
        `${capitalise(evidence)}, but nothing checked whether that ticket exists: ${lookup?.reason ?? "no Zendesk client is configured for this view"}. ` +
        "This is not the same as confirming it, and it is not the same as finding it missing — references shaped exactly like this one have turned out to be mock-server ids with no ticket behind them.",
      group: noGroup("The ticket was not read, so its queue is unknown."),
    };
  }

  if (lookup.found === false) {
    return {
      state: "not_found",
      ticketId: candidate,
      url: null,
      headline: `Ticket #${candidate} does not exist`,
      detail:
        `${capitalise(evidence)}, and Zendesk has no ticket with that id. The record believes it was handed to a person and it was not — ` +
        "whatever a reader follows this reference to, it is not a queue.",
      group: noGroup("There is no such ticket, so there is no queue."),
    };
  }

  const t = lookup.ticket ?? {};
  return {
    state: "confirmed",
    ticketId: String(t.id ?? candidate),
    url: subdomain ? `https://${subdomain}.zendesk.com/agent/tickets/${encodeURIComponent(String(t.id ?? candidate))}` : null,
    headline: `Zendesk ticket #${t.id ?? candidate}`,
    detail: `Read from the account: status ${t.status ?? "unknown"}${t.assignee_id ? ", assigned to an agent" : ", no individual assignee"}.`,
    group: groupVerdict({ ticket: t, owningGroup }),
  };
}

/**
 * Is this ticket in the owning team's queue?
 *
 * FOUR ANSWERS, and the fourth is the one worth the file:
 *   "owning_team"     the ticket's group is the team that owns this work.
 *   "elsewhere"       it is in some other group — usually the account default,
 *                     which is where Zendesk puts a ticket nobody assigned.
 *   "owner_absent"    the owning team has no group in this account at all, so
 *                     no assignment was ever possible. The tag says one thing
 *                     and the account cannot honour it. Distinct from
 *                     "elsewhere" because the fix is: create the group and
 *                     re-sync, not re-assign the ticket. No routed team is in
 *                     this state today (teams.js reports all nine provisioned);
 *                     the next team added to the routing table is in it from
 *                     the moment it is added until somebody runs the setup
 *                     script, which is how both of the last two arose.
 *   "unknown"         the ticket carries no group, or this view has no id for
 *                     the owning team and cannot compare. Not "fine".
 */
export function groupVerdict({ ticket, owningGroup }) {
  const actualId = ticket?.group_id ?? null;
  const intendedId = owningGroup ? groupIdFor(owningGroup) : null;

  if (!owningGroup) {
    return {
      state: "unknown",
      actualId,
      intendedName: null,
      intendedId: null,
      detail: "No owning team is defined for this use case, so there is nothing to compare the ticket's queue against.",
    };
  }

  if (intendedId === null) {
    return {
      state: "owner_absent",
      actualId,
      intendedName: owningGroup,
      intendedId: null,
      detail:
        `"${owningGroup}" owns this work, and this account has no group by that name — the last group sync resolved no id for it. ` +
        "The ticket carries the right routing tag and could never have been assigned to the right queue, so Zendesk left it wherever its default puts an unassigned ticket.",
    };
  }

  if (actualId === null) {
    return {
      state: "unknown",
      actualId: null,
      intendedName: owningGroup,
      intendedId,
      detail: `The ticket carries no group at all, so it is in no team's queue. It should be with ${owningGroup}.`,
    };
  }

  if (String(actualId) === String(intendedId)) {
    return {
      state: "owning_team",
      actualId,
      intendedName: owningGroup,
      intendedId,
      detail: `In ${owningGroup}'s queue, which is the team that owns it.`,
    };
  }

  return {
    state: "elsewhere",
    actualId,
    intendedName: owningGroup,
    intendedId,
    detail:
      `The ticket is in group ${actualId}, and ${owningGroup} (group ${intendedId}) owns this work. ` +
      "A ticket nobody assigned lands in the account's default group, which is a queue the owning team does not watch.",
  };
}

function noGroup(detail) {
  return { state: "unknown", actualId: null, intendedName: null, intendedId: null, detail };
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
