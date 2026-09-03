// ---------------------------------------------------------------------------
// demoSeed.js  —  Labelled demonstration rows for a fresh clone
// ---------------------------------------------------------------------------
// WHY DEMO ROWS AT ALL, AND WHY THEY ARE NEVER SERVED ON A DEPLOYMENT
// `npm run queue-ui` on a fresh clone has no Supabase and no Zendesk, and an
// empty page teaches nobody what the surface is for. So an unconfigured LOCAL
// run serves this dataset and the page banners it loudly. The DEPLOYMENT does
// the opposite — with no pool attached it answers 503 rather than serve these,
// because fabricated rows on a public URL are indistinguishable from real
// history. Same split as src/auditview/demoSeed.js.
//
// EVERY ROW IS MODELLED ON A REAL RECORD found in production on 2026-08-19
// rather than invented to look interesting — a demo that only shows the happy
// path would hide precisely the thing this surface exists to show. That rule
// outranks completeness, so this dataset exercises the stuck categories that
// production actually produced and NOT all six:
//
//   exercised     no_ticket, ticket_missing, queued_elsewhere — and reachable
//                 rows too, because a classifier that called everything stuck
//                 would look identical to a working one without them.
//   not exercised no_approval_surface (UC-03 gained a sign-off surface),
//                 queue_owner_absent (the last unprovisioned team got its group
//                 on 2026-08-20), unqueued (no production ticket has ever had a
//                 null group here).
//
// Those three categories keep their rules pinned directly against
// stuckVerdict() in test/approvalQueue.test.js, on pure inputs that no account
// state can reach. Seeding a row to keep the demo's category list complete
// would make it assert something untrue about the system it demonstrates —
// which is the same trade the `none_missing` control state was kept under: the
// detector survives its last member, the fixture does not fake one.
//
// THE DEMO TICKETS ARE PART OF THE DATASET. Reachability cannot be shown
// without them: with no Zendesk client every reference is honestly "unverified",
// which is the right answer and a dull demonstration. The seeded run therefore
// gets a fake Zendesk backed by the tickets below, so the offline page shows
// confirmed, missing and misqueued tickets side by side.
// ---------------------------------------------------------------------------

import { ESCALATION_GROUP_IDS } from "../shared/escalationGroupIds.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Real group ids, READ FROM THE REGISTRY rather than copied out of it.
 *
 * These were literals until 2026-08-29, when the Zendesk account was migrated
 * and every group id changed. `npm run sync-groups` updated the registry and
 * this second copy silently kept the retired numbers, so the seeded demo
 * classified every owning-team ticket as `elsewhere` — the queue's own
 * headline claim, "nobody can reach this", produced by nothing but a stale
 * constant. A demo that says the routing is broken when it is not is worse
 * than no demo. There is now one source for these ids.
 *
 * `support_default` stays a literal on purpose: it is the account's catch-all
 * Support group and its whole role in this fixture is to be a group that is
 * NOT an owning team, so it must not track the registry. Any id absent from
 * ESCALATION_GROUP_IDS would do.
 */
const GROUP = Object.freeze({
  support_default: 6151578998431,
  finance_ops: ESCALATION_GROUP_IDS["Finance Ops"],
  hr_ops: ESCALATION_GROUP_IDS["HR Ops"],
  travel_support: ESCALATION_GROUP_IDS["Travel & Mobility Support"],
  mobility_legal_t3: ESCALATION_GROUP_IDS["Mobility Legal (Tier-3)"],
  payroll_ops: ESCALATION_GROUP_IDS["Payroll Ops"],
});

export function buildQueueDemoDataset(now = Date.now()) {
  const at = (ms) => new Date(now - ms).toISOString();

  const records = [
    {
      useCase: "UC-04",
      recordId: "demo-uc04-ready",
      createdAt: at(3 * HOUR),
      employmentId: "09b65526-643b-4956-959b-916e6429bd23",
      requester: "admin_jane",
      decision: "ready_for_approval",
      reason: "all_gates_passed",
      status: "pending_specialist_approval",
      reference: "51",
      source: "portal",
      queueStatus: undefined,
      raw: {},
    },
    {
      useCase: "UC-02",
      recordId: "demo-uc02-noticket",
      createdAt: at(19 * HOUR),
      employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
      requester: "chris",
      decision: "human_review",
      reason: "over_policy_cap",
      status: "flagged",
      reference: "uc02-20260819033052-4mdzn",
      source: "portal",
      queueStatus: undefined,
      raw: {},
    },
    {
      useCase: "UC-02",
      recordId: "demo-uc02-ghost",
      createdAt: at(21 * HOUR),
      employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
      requester: "chris",
      decision: "human_review",
      reason: "policy_cap_currency_mismatch",
      status: "flagged",
      reference: "9002",
      source: "portal",
      queueStatus: undefined,
      raw: {},
    },
    {
      useCase: "UC-03",
      recordId: "demo-uc03-letter",
      createdAt: at(11 * HOUR),
      employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
      requester: "employee_sam",
      decision: "human_review",
      reason: "formal_letter_requested",
      status: "flagged",
      reference: "48",
      source: "portal",
      queueStatus: "pending",
      queueAssignee: null,
      raw: {},
    },
    {
      useCase: "UC-01",
      recordId: "demo-uc01-escalated",
      createdAt: at(2 * DAY),
      employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      requester: "alexandre@example.test",
      decision: "escalate",
      reason: "identity_not_verified",
      status: "escalated",
      reference: "31",
      source: "zendesk",
      queueStatus: "pending",
      queueAssignee: null,
      raw: {},
    },
    {
      useCase: "UC-05",
      recordId: "demo-uc05-signoff",
      createdAt: at(32 * HOUR),
      employmentId: "e818418e-1db7-431d-a663-9f477addb8bd",
      requester: "hr_bot",
      decision: "prepared_for_signoff",
      reason: "all_gates_passed",
      status: "pending_signoff",
      reference: "f33-uc05-valid-a",
      source: "webhook",
      queueStatus: undefined,
      raw: {},
    },
    {
      useCase: "UC-06",
      recordId: "demo-uc06-dual",
      createdAt: at(6 * HOUR),
      employmentId: "09b65526-643b-4956-959b-916e6429bd23",
      requester: "admin_jane",
      decision: "dual_approval_required",
      reason: "within_cutoff_window",
      status: "pending_dual_approval",
      reference: "60",
      source: "portal",
      queueStatus: undefined,
      raw: { admin_approval: { approver: "jane.admin@acme.test", at: at(5 * HOUR) }, payroll_approval: null },
    },
    {
      useCase: "UC-09",
      recordId: "demo-uc09-multi",
      createdAt: at(4 * HOUR),
      employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
      requester: "admin_jane",
      decision: "triple_approval_required",
      reason: "high_value_adjustment",
      status: "pending_approval",
      reference: "61",
      source: "portal",
      queueStatus: undefined,
      raw: {
        approval_slots_required: 3,
        requester_approval: { approver: "jane.admin@acme.test", at: at(4 * HOUR) },
        approver_approval: null,
        payment_releaser_approval: null,
      },
    },
    {
      useCase: "UC-07",
      recordId: "demo-uc07-queued",
      createdAt: at(30 * HOUR),
      employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      requester: null,
      decision: null,
      reason: null,
      status: null,
      reference: "34",
      source: "webhook",
      queueStatus: undefined,
      raw: {},
    },
    {
      useCase: "UC-07",
      recordId: "demo-uc07-orphan",
      createdAt: at(3 * DAY),
      employmentId: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      requester: null,
      decision: null,
      reason: null,
      status: null,
      reference: "f29-uc07-prefix-a",
      source: "webhook",
      queueStatus: undefined,
      raw: {},
    },
    {
      useCase: "UC-02",
      recordId: "demo-uc02-settled",
      createdAt: at(26 * HOUR),
      employmentId: "2f7f8210-91fc-47db-803c-77a1cc625781",
      requester: "chris",
      decision: "human_review",
      reason: "over_policy_cap",
      status: "approved",
      reference: "44",
      source: "portal",
      queueStatus: undefined,
      raw: {},
    },
  ];

  /** id -> ticket, as Zendesk would answer. Anything absent is a real 404. */
  const tickets = {
    // Ticket #51, the request that prompted this whole view. Raised while the
    // account had no Mobility Specialists group, so Zendesk left it in the
    // default group. The group was created on 2026-08-20 and this ticket did
    // not move — creating a group re-queues nothing already raised — so the row
    // now reads `queued_elsewhere`, alongside escalations #19–#33, instead of
    // `queue_owner_absent`. The fixture is unchanged; the verdict it draws
    // followed the account. That is the demo tracking production, not drifting
    // from it.
    51: { id: 51, status: "open", group_id: GROUP.support_default, assignee_id: 1, tags: ["queue_mobility_specialists"] },
    48: { id: 48, status: "open", group_id: GROUP.travel_support, assignee_id: 1, tags: ["queue_travel_support"] },
    31: { id: 31, status: "open", group_id: GROUP.support_default, assignee_id: 1, tags: ["escalation_hr_ops"] },
    34: { id: 34, status: "open", group_id: GROUP.mobility_legal_t3, assignee_id: null, tags: ["escalation_mobility_legal_t3"] },
    60: { id: 60, status: "open", group_id: GROUP.payroll_ops, assignee_id: null, tags: ["queue_payroll_ops"] },
    61: { id: 61, status: "open", group_id: GROUP.payroll_ops, assignee_id: null, tags: ["queue_payroll_ops"] },
    44: { id: 44, status: "solved", group_id: GROUP.finance_ops, assignee_id: 1, tags: ["queue_finance_ops"] },
    // 9002 is deliberately absent: a reference shaped exactly like a ticket id
    // with no ticket behind it, which is a real thing that has happened here.
  };

  return { records, tickets, ticketLinks: {} };
}

/** A getTicket() over the demo tickets, for the seeded run's TicketFacts. */
export function demoZendesk(tickets) {
  return {
    async getTicket(id) {
      return tickets[String(id)] ?? null; // null is how the real client reports a 404
    },
  };
}
