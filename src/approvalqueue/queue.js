// ---------------------------------------------------------------------------
// queue.js  —  Composing one cross-use-case queue out of eight tables
// ---------------------------------------------------------------------------
// WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT DOES NOT
//
// It joins four things that already exist and adds no fifth: the stored records
// (queueStore.js), the awaiting judgement (awaiting.js), the routing table
// every ticket was tagged from (src/shared/escalationRouting.js), and the
// ticket's own facts read back from Zendesk (ticketFacts.js). From those it
// answers three questions per item — is a person still needed, where would they
// act, and can they get there — and nothing else.
//
// NO POLICY IS RE-DERIVED HERE. Nothing in this file decides whether a request
// should have been approved, whether an approver is entitled, or whether a
// decision was right. Those answers belong to each use case's own policy
// engine, and a second copy of any of them on a reporting surface would be the
// duplicated-gates bug with a nicer font. Where a fact is not recorded, the
// item says it is not recorded — it never computes a rival answer.
//
// THE ORDER IS BY HOW LONG IT HAS WAITED, oldest first, because the oldest
// thing nobody can act on is the thing this page exists to find.
// ---------------------------------------------------------------------------

import { routeFor, isEscalation } from "../shared/escalationRouting.js";
import { approvalRouteFor } from "./approvalRoutes.js";
import { directionsForRoute } from "./handoffDirections.js";
import { awaitingState, approvalProgress, waited } from "./awaiting.js";
import { ticketVerdict, looksLikeTicketId } from "./ticketVerdict.js";
import { stuckVerdict, summarise } from "./stuck.js";
import { CONSENT_AGE_WARN_DAYS, isConsentWaitingLong } from "../shared/consentPolicy.js";

/**
 * @param {object} args
 * @param {import("./queueStore.js").ApprovalQueueStore} args.store
 * @param {import("./ticketFacts.js").TicketFacts} args.ticketFacts
 * @param {number} [args.now]
 */
export async function buildQueue({ store, ticketFacts, now = Date.now() }) {
  const records = await store.listRecords();
  const links = await store.ticketLinks();

  // First pass: everything except the ticket, which needs one batched round of
  // I/O and is only worth spending on items that are actually waiting.
  const partial = records.map((record) => {
    const awaiting = awaitingState({
      useCase: record.useCase,
      status: record.status,
      queueStatus: record.queueStatus,
    });
    const route = approvalRouteFor(record.useCase);
    const escalated = isEscalation(record.decision);
    const routing = routeFor(record.useCase);
    // An escalation goes to the escalation team where a spec names a separate
    // one (UC-04 is the only row that does); everything else to the owning team.
    const owningGroup = routing ? (escalated && routing.escalationGroup ? routing.escalationGroup : routing.group) : null;

    return {
      ...record,
      raw: undefined, // dropped from the wire — the page needs facts, not rows
      tier: route?.tier ?? null,
      awaiting,
      escalated,
      owningGroup,
      queueTag: routing?.queueTag ?? null,
      approvalRoute: route,
      // THE SAME THREE SENTENCES THE ZENDESK NOTE CARRIES, from the same row.
      //
      // `actionable` IS PASSED IN ONE DIRECTION ONLY, and the asymmetry is the
      // whole of the discipline here. `false` is passed for an item awaiting
      // "handling", because that is awaiting.js's own already-made judgement —
      // its header states it outright: "nobody approves an escalation, the
      // sidebar deliberately gives an escalation no buttons" — and reading a
      // verdict this module already publishes is not forming one. `true` is
      // NEVER passed: a record whose status column reads as awaiting can still
      // be refused by the approval API for a reason no status column carries,
      // and promising a specialist that a panel will accept them is a claim
      // only that API may make. So the worst this can do is withhold a verb
      // list from somebody who did have one, and it can never offer a verb to
      // somebody who does not.
      directions: directionsForRoute({
        useCase: record.useCase,
        route,
        team: owningGroup,
        actionable: escalated || awaiting.waitingFor === "handling" ? false : null,
        actionableReason:
          escalated || awaiting.waitingFor === "handling"
            ? "The automation escalated this rather than preparing it for approval, and an " +
              "escalation has no approval control — the sidebar deliberately gives one no buttons, " +
              "so the safe path cannot double as a dismiss button. What it needs is the team named " +
              "above."
            : null,
      }),
      progress: approvalProgress({ useCase: record.useCase, row: record.raw ?? {} }),
      waited: waited(record.createdAt, now),
      // G-4/F3/L-19: the figure stuck.js's own "our own policy figure" line
      // names, made visible on the ONE surface VC-32 actually calls the
      // operator's — this page, not the portal (that is the employee's
      // surface). Present only when a person is waiting on the employee's own
      // consent decision, matching the same waitingFor value awaitingState()
      // computes two lines above; null everywhere else so this never reads as
      // a claim about a request that isn't a consent wait at all. Shared
      // constant/verdict with the portal's own consentRequestView() via
      // ../shared/consentPolicy.js — one figure, never two.
      consentAgePolicy:
        awaiting.waitingFor === "consent"
          ? { days: CONSENT_AGE_WARN_DAYS, waitingLong: isConsentWaitingLong(record.status, record.createdAt, now) }
          : null,
      recordedTicketId: links.byRecordId.get(record.recordId) ?? links.bySubmittedRef.get(record.reference) ?? null,
    };
  });

  const waitingItems = partial.filter((i) => i.awaiting.state !== "settled");

  const idsToCheck = waitingItems
    .map((i) => i.recordedTicketId ?? (looksLikeTicketId(i.reference) ? String(i.reference).trim() : null))
    .filter(Boolean);
  const lookups = await ticketFacts.lookupMany(idsToCheck);

  const items = partial.map((item) => {
    const candidate = item.recordedTicketId ?? (looksLikeTicketId(item.reference) ? String(item.reference).trim() : null);
    const ticket = ticketVerdict({
      reference: item.reference,
      recordedTicketId: item.recordedTicketId,
      // A settled item's ticket was never looked up, and that absence is not
      // evidence of anything — ticketVerdict renders it as "unverified".
      lookup: candidate ? (lookups.get(candidate) ?? null) : null,
      subdomain: ticketFacts.subdomain,
      owningGroup: item.owningGroup,
    });
    return {
      ...item,
      ticket,
      awaitingWho: awaitingWho(item),
      stuckVerdict: stuckVerdict({
        awaiting: item.awaiting,
        ticket,
        control: item.approvalRoute?.control ?? "unknown",
        useCase: item.useCase,
        owningGroup: item.owningGroup,
      }),
    };
  });

  const waiting = items.filter((i) => i.awaiting.state !== "settled");
  waiting.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return {
    mode: store.mode(),
    verification: ticketFacts.posture(),
    generatedAt: new Date(now).toISOString(),
    counts: {
      recordsRead: items.length,
      waiting: waiting.length,
      settled: items.length - waiting.length,
    },
    summary: summarise(waiting),
    byUseCase: byUseCase(items),
    items: waiting,
    stuck: waiting.filter((i) => i.stuckVerdict.stuck === true),
    unknown: waiting.filter((i) => i.stuckVerdict.stuck === "unknown"),
  };
}

/**
 * Who is this waiting on, in words a CX lead would use.
 *
 * A role where the use case names one, a team where it does not — and never a
 * person, because nothing in these tables records who was asked.
 */
function awaitingWho(item) {
  const roles = item.approvalRoute?.roles ?? [];
  if (item.awaiting.waitingFor === "approval" && roles.length) {
    if (item.progress.applies) {
      const outstanding = item.progress.outstanding;
      return outstanding.length ? outstanding.join(" and ") : "nobody — every slot is filled";
    }
    return roles.map((r) => r.label).join(" and ");
  }
  if (item.awaiting.waitingFor === "reading") return `${item.owningGroup ?? "an unnamed team"} — to read the dossier`;
  if (item.awaiting.waitingFor === "handling") return `${item.owningGroup ?? "an unnamed team"} — to work the escalation`;
  return item.owningGroup ?? "an unnamed team";
}

function byUseCase(items) {
  const order = ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"];
  const map = new Map(order.map((uc) => [uc, { useCase: uc, waiting: 0, stuck: 0, unknown: 0, settled: 0 }]));
  for (const item of items) {
    if (!map.has(item.useCase)) {
      map.set(item.useCase, { useCase: item.useCase, waiting: 0, stuck: 0, unknown: 0, settled: 0 });
    }
    const row = map.get(item.useCase);
    if (item.awaiting.state === "settled") row.settled += 1;
    else {
      row.waiting += 1;
      if (item.stuckVerdict.stuck === true) row.stuck += 1;
      else if (item.stuckVerdict.stuck === "unknown") row.unknown += 1;
    }
  }
  for (const [uc, row] of map) {
    const route = approvalRouteFor(uc);
    row.control = route?.control ?? "unknown";
    row.tier = route?.tier ?? null;
    row.surface = route?.surface ?? null;
    row.note = route?.note ?? "";
  }
  return [...map.values()];
}
