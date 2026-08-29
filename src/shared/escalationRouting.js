// ---------------------------------------------------------------------------
// escalationRouting.js  —  Which team owns a hand-off, in exactly one place
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// An escalation that nobody owns is a slower way of dropping the case. The
// system was already tagging escalations correctly and handing them to no one:
// a tag is a label a trigger *could* route on, and until something does, the
// ticket sits in whatever the account's default view is. Assignment is the part
// that makes an escalation a hand-off rather than a filing.
//
// EVERY TEAM BELOW COMES FROM ITS USE CASE'S OWN SPEC, cited on the row. That
// matters more than it looks: an owning team invented here would be a fact
// about Remote's org that this repository has no standing to assert, and it
// would be asserted in a real Zendesk account. Where a spec names a tier as
// well as a team (UC-04's "Tier-2", UC-07's "Tier-3"), the tier is part of the
// name, because escalating to "Mobility" when the spec says Tier-2 Mobility/
// Legal is a different hand-off.
//
// TWO TAGS PER ROW, AND THAT SPLIT IS THE POINT OF THIS FILE'S SECOND REVISION
// ---------------------------------------------------------------------------
// Originally each row carried ONE tag, spelled `escalation_<team>`, and
// src/portal/server.js pushed it onto EVERY ticket it raised. Most of the
// tickets it raises are not escalations: `ready_for_approval` (UC-04's
// one-click specialist gate), `human_review`, `prepared_for_signoff` and the
// approval-required decisions are the ordinary, healthy medium-tier path — a
// human is expected to look, which is the design working rather than the
// automation giving up. Every one of them reached Zendesk wearing
// `escalation_*`.
//
// That is not cosmetic. An escalation tag is an operational claim with two
// consumers: the triggers/views that route work, and the reporting that counts
// how often the automation could not finish. Tagging routine approvals as
// escalations inflates the second and misdirects the first — on UC-04 it sent
// one-click approvals to the Tier-2 Mobility/Legal queue that UC-04.md §5
// reserves for *"ANY dimension unconfirmed/ambiguous"*.
//
// The fix is NOT "only tag escalations". A flagged UC-02 claim on
// `human_review` goes to the same Finance Ops queue an escalated one does, so
// dropping the tag for review decisions would leave the reviews unroutable —
// which is the defect this file was written to close in the first place. The
// two things were conflated in one string, so the string is split in two:
//
//   queueTag       the OWNING TEAM's routing tag. On every ticket, always.
//                  Answers "whose queue is this?"  ->  `queue_finance_ops`
//   escalationTag  the ESCALATION marker. Only when the decision really is an
//                  escalation. Answers "did the automation give up?"
//                  ->  `escalation_finance_ops`
//
// An escalated ticket therefore carries BOTH: it is still Finance Ops's work,
// and it is additionally an escalation. Escalation rate is then a real ratio
// (escalation_* over queue_*) instead of a constant 100%.
//
// AND TWO ROWS NEED TWO TEAMS, FOR THE SAME REASON. UC-04's spec names a
// different owner for its two paths: §5/§8 send a clean four-dimension case to
// a *mobility specialist* for a 1-click approve/decline, and an unconfirmed one
// to *Mobility/Legal Tier-2* for "stronger safe-escalation treatment, not a
// simple 1-click". Splitting only the tag would still have addressed the
// routine approvals to the legal queue, so `escalationGroup` exists — optional,
// and absent on the seven rows whose specs name a single owning team for both
// paths.
//
// UC-05 is the second, added once somebody asked the obvious question about a
// real escalation — a Portuguese resignation 23 days inside statutory notice —
// and got two different answers: the panel said Local HR Legal decided it and
// the routing sent it to HR Ops. Its row below carries the argument.
//
// WHAT AN UNKNOWN DECISION COUNTS AS, and why it is not the same answer as
// above. A decision this file cannot classify is treated as an ESCALATION.
// That looks like the very mislabelling being fixed and is the opposite case:
// the defect was a KNOWN routine decision being called an escalation, whereas
// an unknown one is a missing signal, and a missing signal takes the stronger
// treatment here as everywhere else in this repo. Getting it backwards would
// let an unclassifiable UC-04 case land with a specialist as a one-click
// approval, which §8 forbids outright.
//
// PURE DATA, NO I/O — the src/shared/ports.js and src/portal/requestTypes.js
// pattern. This file creates no group, contacts no account and decides nothing
// about any request; it answers "who owns this, and is it an escalation".
// Whether a request escalates at all is each use case's own policy engine's
// judgement, and nothing here is ever consulted to make it.
//
// GROUPS ARE NOT CREATED IMPLICITLY. `scripts/setup-zendesk-groups.mjs` is the
// only thing that creates them, it is idempotent, and it must be run
// deliberately. A workflow that quietly creates org structure in a live Zendesk
// account the first time something escalates is exactly the kind of outward
// action this repo requires be a decision rather than a side effect. When a
// group is missing at escalation time the caller falls back to tagging plus an
// internal note that NAMES the intended team and says assignment was skipped —
// visible failure, never silent.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} EscalationRoute
 * @property {string} group     the Zendesk group that owns this use case's
 *   ordinary human-review / approval work
 * @property {string} queueTag  the owning team's routing tag, applied to every
 *   ticket this use case raises — so a trigger can route it even when
 *   assignment failed, and whether or not it escalated
 * @property {string} escalationTag  applied ON TOP of `queueTag` when the
 *   decision really is an escalation, and never otherwise
 * @property {string} [escalationGroup]  the group an ESCALATION goes to, when
 *   the spec names a different one from `group`. Absent means "same team"
 * @property {"low"|"normal"|"high"|"urgent"} priority  the Zendesk priority
 * @property {string} source    where the team names come from, so a reader can
 *   check them rather than trust them
 */

/** @type {Record<string, EscalationRoute>} */
export const ESCALATION_ROUTES = Object.freeze({
  "UC-01": {
    group: "HR Ops",
    queueTag: "queue_hr_ops",
    escalationTag: "escalation_hr_ops",
    priority: "normal",
    source: "UC-01.md §5/§9 — 'route to HR Ops queue, tag verification_exception'",
  },
  "UC-02": {
    group: "Finance Ops",
    queueTag: "queue_finance_ops",
    escalationTag: "escalation_finance_ops",
    priority: "normal",
    // One team, both paths, and the spec says so in both places: §6 routes a
    // FLAGGED claim to Finance Ops via ZAF, §9 routes an escalated one to the
    // Finance Ops queue. This row is why "tag only escalations" was the wrong
    // fix — the review needs the queue tag as much as the escalation does.
    source: "UC-02.md §6/§9 — 'route to Finance Ops (ZAF)', 'route to Finance Ops queue'",
  },
  "UC-03": {
    group: "Travel & Mobility Support",
    queueTag: "queue_travel_support",
    escalationTag: "escalation_travel_support",
    priority: "normal",
    source:
      "UC-03.md §7.1/§8 — a formal travel letter is held for a specialist, and an unsupported or sanctioned destination escalates rather than being answered",
  },
  "UC-04": {
    // THE ONE ROW WITH TWO TEAMS. UC-04.md §5 draws the line itself: "ALL 4
    // confirmed with high confidence -> … specialist 1-click approve/decline" vs
    // "ANY dimension unconfirmed/ambiguous -> escalate to Mobility/Legal
    // Tier-2, stronger safe-escalation treatment, not a simple 1-click". §8
    // repeats it, and §1's Primary-actor row names the ordinary approver:
    // "Mobility specialist (approver, via this project's ZAF panel)". The
    // tier is part of the escalation team's name — escalating to
    // plain "Mobility" would be the wrong hand-off, and routing a one-click
    // approval to Tier-2 is the wrong hand-off in the other direction.
    group: "Mobility Specialists",
    queueTag: "queue_mobility_specialists",
    escalationGroup: "Mobility & Legal (Tier-2)",
    escalationTag: "escalation_mobility_legal_t2",
    priority: "high",
    source:
      "UC-04.md §5/§8 — 'specialist 1-click approve/deny' (the Mobility specialist named as the ZAF approver in §1's Primary actor row) vs 'ANY dimension unconfirmed/ambiguous → escalate to Mobility/Legal Tier-2 … not a simple 1-click'",
  },
  "UC-05": {
    // THE SECOND ROW WITH TWO TEAMS, and it was hiding in plain sight. UC-05.md
    // draws the same line UC-04's spec does, in two different sections: §15
    // names the ordinary owner — "Single HR Ops sign-off" on a prepared report
    // whose arithmetic somebody has to check — while §8 names a different one
    // for the case where the arithmetic is not the question: "Statutory
    // discrepancy or unconfirmable country rule → escalate to Local HR/Legal."
    //
    // They are different acts. Signing off is confirming a calculation. A
    // resignation proposing a last working day 23 days inside Portugal's
    // statutory notice is not a calculation to confirm — the calculation is
    // agreed and it is what creates the problem. Somebody has to decide how the
    // shortfall is handled, and Código do Trabalho art. 401.º attaches a money
    // consequence to the answer (see src/uc05/decisionSources.js). That is a
    // legal question about one jurisdiction, which is why the spec sends it to
    // the LOCAL desk, and it is not what an HR Ops sign-off queue is for.
    //
    // Until this row existed the screen and the routing disagreed out loud:
    // src/uc05/decisionFacts.js told the reader "Local HR Legal decides how the
    // shortfall is handled" while every UC-05 escalation was tagged and
    // assigned to HR Ops, and no team by that name existed anywhere in this
    // file. Both halves now come from here — the prose is built from this row
    // (see decisionFacts.js's `escalationTeamName()`), so the two cannot drift
    // apart again.
    group: "HR Ops",
    queueTag: "queue_hr_ops",
    escalationGroup: "Local HR & Legal",
    escalationTag: "escalation_local_hr_legal",
    priority: "normal",
    source:
      "UC-05.md §15 — 'Single HR Ops sign-off'; the signed-off report is the artifact — vs §8 — 'Statutory discrepancy or unconfirmable country rule → escalate to Local HR/Legal'",
  },
  "UC-06": {
    // The one use case with a real, sharp clock — see urgencyFor() below.
    group: "Payroll Ops",
    queueTag: "queue_payroll_ops",
    escalationTag: "escalation_payroll_ops",
    priority: "high",
    source: "UC-06.md §9 — 'Within 48h of cutoff → urgent escalation to Payroll Ops'",
  },
  "UC-07": {
    group: "Mobility Legal (Tier-3)",
    queueTag: "queue_mobility_legal_t3",
    escalationTag: "escalation_mobility_legal_t3",
    priority: "high",
    // High tier: every decision is an escalation, so `queueTag` never appears
    // alone on a UC-07 ticket. It is defined anyway, because the tag vocabulary
    // is a property of the routing table rather than of one use case's decision
    // set, and a row missing it would read as an omission rather than a fact.
    source: "UC-07.md §5 — 'Always compiles dossier → assigns Mobility Legal. No branch leads anywhere else.'",
  },
  "UC-08": {
    group: "Tax Operations",
    queueTag: "queue_tax_operations",
    escalationTag: "escalation_tax_operations",
    priority: "high",
    source: "UC-08.md §1/§5 — 'Primary actor: Requester → Remote Tax Operations'; 'escalate dossier to Remote Tax Operations'",
  },
  "UC-09": {
    group: "Payroll Ops",
    queueTag: "queue_payroll_ops",
    escalationTag: "escalation_payroll_ops",
    priority: "urgent",
    source: "UC-09.md §1/§5 — Remote Payroll specialist; the one high-tier path that can move money",
  },
});

/**
 * Every distinct group name — review teams AND escalation teams — for the setup
 * script. Sorted, so its output is stable.
 *
 * Both halves, deliberately: UC-04's escalation team would otherwise never be
 * created, and its escalations would arrive tagged-but-unassigned forever on an
 * account the setup script had been run against.
 */
export const ESCALATION_GROUPS = Object.freeze(
  [
    ...new Set(
      Object.values(ESCALATION_ROUTES).flatMap((r) => [r.group, r.escalationGroup].filter(Boolean))
    ),
  ].sort()
);

/**
 * The route for a use case, or null when none is defined.
 * NULL RATHER THAN A DEFAULT, deliberately: a fallback group would send an
 * escalation this file knows nothing about to a team that did not agree to own
 * it, and the ticket would look correctly routed. A caller that gets null must
 * say so on the ticket instead.
 * @param {string} useCase  e.g. "UC-04"
 */
export function routeFor(useCase) {
  return ESCALATION_ROUTES[useCase] ?? null;
}

/**
 * Is this decision an escalation — i.e. did the automation stop and hand the
 * case over, rather than prepare it for a human who was always going to look?
 *
 * ONE DEFINITION, because the answer is copied into an n8n Code node that
 * cannot import it (workflows/nodes/assignRouting.js), and two definitions of
 * "is this an escalation?" would drift with nothing going red.
 *
 * `escalate` is the only escalation decision any of the nine policy engines
 * produces today; the prefix match also covers `escalated`/`escalate_*` so a
 * future spelling is not silently demoted to routine. Everything else —
 * `human_review`, `ready_for_approval`, `prepared_for_signoff`,
 * `dual_approval_required`, `triple_approval_required`,
 * `off_cycle_adjustment_required`, `route_to_uc04` — is the human gate working.
 *
 * A MISSING OR UNRECOGNISABLE DECISION COUNTS AS AN ESCALATION. See the header:
 * the bug was a known-routine decision being called an escalation, and the
 * fail-closed direction for an unknown one is the stronger treatment.
 *
 * @param {unknown} decision
 */
export function isEscalation(decision) {
  if (typeof decision !== "string" || decision.trim() === "") return true;
  return /^escalat/i.test(decision.trim());
}

/**
 * WHICH TEAM AN ESCALATION IS ADDRESSED TO — the one question a person reading
 * an escalated case asks first, answered from the table rather than from prose.
 *
 * WHY THIS TINY FUNCTION EXISTS AT ALL. `src/uc05/decisionFacts.js` told the
 * reader of a Portuguese notice shortfall that "Local HR Legal decides how the
 * shortfall is handled", in five places across `src/uc05/`, while every UC-05
 * escalation was routed to HR Ops — and no team called Local HR Legal existed
 * anywhere in this file, in the Zendesk groups, or in the setup script. A
 * hand-typed team name in a description is a second source of truth for a fact
 * this module owns, and the two had already drifted before anyone noticed.
 * Every such sentence is now built from this function, so the screen and the
 * routing move together or not at all.
 *
 * Returns null for an unknown use case, for the same reason `routeFor()` does:
 * a default team here would put a name in front of a human that nobody agreed
 * to own.
 *
 * @param {string} useCase
 * @returns {string|null}
 */
export function escalationTeamFor(useCase) {
  const route = routeFor(useCase);
  if (!route) return null;
  return route.escalationGroup ?? route.group;
}

/**
 * The full hand-off for one decision: which team, which tags, what priority.
 *
 * This is what a caller should use. `routeFor()` remains the raw row, for the
 * setup script and for tests that assert the table itself.
 *
 * @param {object} args
 * @param {string} args.useCase
 * @param {unknown} [args.decision]  the decision that was actually reached
 * @returns {{
 *   group: string,
 *   queueTag: string,
 *   escalationTag: string|null,
 *   tags: string[],
 *   priority: string,
 *   escalated: boolean,
 *   decisionKnown: boolean,
 * }|null} null when no route is defined for the use case
 */
export function handoffFor({ useCase, decision = null }) {
  const route = routeFor(useCase);
  if (!route) return null;

  const decisionKnown = typeof decision === "string" && decision.trim() !== "";
  const escalated = isEscalation(decision);
  const group = escalated ? route.escalationGroup ?? route.group : route.group;

  return {
    group,
    queueTag: route.queueTag,
    escalationTag: escalated ? route.escalationTag : null,
    // Order matters only for readability: whose queue first, then what kind of
    // work. Both land on the ticket; neither replaces the other.
    tags: escalated ? [route.queueTag, route.escalationTag] : [route.queueTag],
    priority: route.priority,
    escalated,
    decisionKnown,
  };
}

/**
 * Raise the priority, and set a due date, when the DECISION ITSELF produced a
 * real deadline. Nothing here invents an SLA: the only clock this system
 * actually knows about is UC-06's payroll cutoff lock, which the cutoff engine
 * computes and which UC-06.md §9 already names as the urgency trigger
 * ("within 48h of cutoff → urgent"). Every other use case keeps its table
 * priority and gets no due date, because promising a response time the system
 * has no way to honour is worse than promising none.
 *
 * @param {object} args
 * @param {string} args.useCase
 * @param {string|null} [args.deadlineIso]  the real deadline this decision
 *   produced (UC-06's cutoff lock time), when there is one
 * @param {string} [args.now]
 * @returns {{priority: string, dueAt: string|null, urgencyReason: string|null}}
 */
export function urgencyFor({ useCase, deadlineIso = null, now = new Date().toISOString() }) {
  const route = routeFor(useCase);
  const base = route?.priority ?? "normal";
  if (!deadlineIso) return { priority: base, dueAt: null, urgencyReason: null };

  const deadline = Date.parse(deadlineIso);
  const current = Date.parse(now);
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) {
    // An unreadable deadline is not a distant one. Keep the table priority and
    // say nothing, rather than computing urgency from a value we could not parse.
    return { priority: base, dueAt: null, urgencyReason: null };
  }

  const hoursLeft = (deadline - current) / 3_600_000;
  if (hoursLeft <= 48) {
    return {
      priority: "urgent",
      dueAt: deadlineIso,
      urgencyReason:
        hoursLeft <= 0
          ? `The deadline (${deadlineIso}) has already passed.`
          : `${Math.max(1, Math.round(hoursLeft))}h until the deadline (${deadlineIso}) — inside the 48h urgent window.`,
    };
  }
  return { priority: base, dueAt: deadlineIso, urgencyReason: null };
}
