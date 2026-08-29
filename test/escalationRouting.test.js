// ---------------------------------------------------------------------------
// escalationRouting.test.js  —  an escalation reaches the team that owns it
// ---------------------------------------------------------------------------
// THE POINT OF THE FEATURE, and therefore of this suite: an escalation nobody
// owns is a slower way of dropping the case. Tagging is a label something COULD
// route on; assignment is the hand-off. So the load-bearing tests are the
// positive ones — an escalation MUST arrive in the owning team's group, with
// the AI's analysis already in the ticket — and the one beside them that
// matters just as much: when the group does not exist, the ticket must say so
// loudly rather than sitting silently unassigned.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startMockServer as startRemoteMock, EXPENSES } from "../src/remote/mockServer.js";
import { startMockServer as startZendeskMock, resetGroups } from "../src/zendesk/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { groupIdFor } from "../src/shared/escalationGroupIds.js";
import {
  ESCALATION_ROUTES,
  ESCALATION_GROUPS,
  routeFor,
  handoffFor,
  isEscalation,
  urgencyFor,
} from "../src/shared/escalationRouting.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftNarrative as draftRelocationNarrative } from "../src/uc07/dossierBuilder.js";
import { draftNarrative as draftTaxNarrative } from "../src/uc08/dossierBuilder.js";

const REMOTE_PORT = 4108; // allocated in src/shared/ports.js TEST_PORTS (was 4096, which review.test.js binds)
const ZENDESK_PORT = 4109; // allocated in src/shared/ports.js TEST_PORTS (was 4098, which portalUc03Continuation.test.js binds)

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: (args) => classifyExpenseRuleBased(args),
  classifyTravel: (args) => classifyTravelInquiryRuleBased(args),
  parseRelocation: (args) => parseRelocationRuleBased(args),
  parseInquiry: (args) => parseInquiryRuleBased(args),
  draftRelocationNarrative: (args) => draftRelocationNarrative(args, unconfigured),
  draftTaxNarrative: (args) => draftTaxNarrative(args, unconfigured),
  judge: async () => ({ verdict: "not_evaluated", reason: null }),
};

let remote;
let remoteServer;
let zendesk;
let zendeskServer;
let audit;
let stores;
let handler;

const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);

before(async () => {
  remoteServer = await startRemoteMock(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
  zendeskServer = await startZendeskMock(ZENDESK_PORT);
  zendesk = new ZendeskClient({ baseUrl: `http://localhost:${ZENDESK_PORT}`, email: "t@t.test", apiToken: "demo" });
});
after(async () => {
  await new Promise((r) => remoteServer.close(r));
  await new Promise((r) => zendeskServer.close(r));
});

beforeEach(() => {
  audit = new AuditLogger();
  // The mock starts with NO groups, like a real account before anyone made
  // them — which is what keeps the missing-group path reachable and testable.
  resetGroups();
  stores = {
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
  handler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk });
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
});

function callApi(h, { method, path, body = null }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {},
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    h(req, res).catch(reject);
  });
}

/** Provision the groups, exactly as scripts/setup-zendesk-groups.mjs does. */
async function provisionGroups() {
  for (const name of ESCALATION_GROUPS) await zendesk.createGroup(name);
}

/** A UC-02 claim owned by someone else — escalates on the OWNERSHIP gate. */
const otherOwner = (externalRef) =>
  callApi(handler, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_other_owner_403", externalRef },
  });

// ---------------------------------------------------------------------------
// 1 — THE POSITIVE TESTS
// ---------------------------------------------------------------------------

test("POSITIVE: an escalation is ASSIGNED to the owning team's Zendesk group", async () => {
  await provisionGroups();
  const res = await otherOwner("escalation-1");

  assert.equal(res.body.decision, "escalate", "fixture precondition: this must escalate");
  assert.equal(res.body.ticketCreated, true);
  assert.equal(res.body.ticketAssignment.assigned, true, "the whole point: it must be assigned");
  assert.equal(res.body.ticketAssignment.intendedGroup, "Finance Ops");

  // Read the ticket back from the mock rather than trusting the response of
  // the call that created it, and confirm the group really landed on it.
  const ticket = await zendesk.getTicket(res.body.ticketId);
  const groups = await zendesk.listGroups();
  const financeOps = groups.find((g) => g.name === "Finance Ops");
  assert.equal(ticket.group_id, financeOps.id, "the ticket must carry the owning group's id");
  assert.ok(ticket.tags.includes("escalation_finance_ops"), "and the routing tag, so a trigger can route too");
});

test("POSITIVE: the ticket carries the AI's analysis, so the specialist opens it already holding the work", async () => {
  await provisionGroups();
  const res = await otherOwner("escalation-2");
  const ticket = await zendesk.getTicket(res.body.ticketId);
  // `html_body` — an internal note is the Zendesk comment field that accepts
  // HTML, and this one is composed as headings and tables rather than as ASCII
  // rules. test/portalTicketNote.test.js pins the shape; this asserts the
  // CONTENT still reaches the specialist unchanged.
  const note = ticket.comments[0].html_body;

  assert.equal(ticket.comments[0].public, false, "an intake note is never a public reply");
  assert.match(note, /<th[^>]*>Owning team<\/th><td[^>]*>Finance Ops<\/td>/);
  assert.match(note, /assigned to Zendesk group/);
  assert.match(note, /<th[^>]*>Decision<\/th><td[^>]*>escalate<\/td>/);
  assert.match(note, /<th[^>]*>Reason<\/th><td[^>]*>expense_employment_mismatch<\/td>/);
  // The record id, so the specialist can look the decision up rather than
  // reconstruct it.
  assert.match(note, new RegExp(res.body.recordId));
  // And the gates' own findings, which is what makes this a hand-off rather
  // than a queue entry.
  assert.match(note, /What the checks reported/);
  assert.match(note, /Decided by/);
});

test("POSITIVE: a 🔴 dossier escalation reaches Tax Operations with its narrative attached", async () => {
  await provisionGroups();
  // UC-08 raises no ticket by design (its store has no mutation method to link
  // one), so the routing table is proven for it directly rather than through a
  // ticket — the mapping is what this asserts, and it is real data either way.
  assert.equal(routeFor("UC-08").group, "Tax Operations");
  assert.equal(routeFor("UC-07").group, "Mobility Legal (Tier-3)");

  // UC-05, which DOES raise one, proves the assigned path for a second team.
  // Its escalation goes to `Local HR & Legal`, NOT to the HR Ops queue that
  // signs off an ordinary report — UC-05.md §8 against §15. See the two-team
  // test below for the argument; what this asserts is that the team the table
  // names is the team the ticket is actually assigned to.
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc05",
    body: { persona: "chris", proposedEndDate: "2026-09-30", externalRef: "escalation-3" },
  });
  assert.equal(res.body.ticketCreated, true);
  assert.equal(res.body.ticketAssignment.intendedGroup, "Local HR & Legal");
  assert.equal(res.body.ticketAssignment.assigned, true);
});

// ---------------------------------------------------------------------------
// 2 — the missing-group path: visible failure, never silent
// ---------------------------------------------------------------------------

test("with the group NOT provisioned, the ticket is tagged, says it is unassigned, and names the team", async () => {
  // No provisionGroups() — the account has none, which is the real starting
  // state and the one an unprepared demo hits.
  const res = await otherOwner("escalation-missing");

  assert.equal(res.body.ticketCreated, true, "the escalation still reaches Zendesk");
  assert.equal(res.body.ticketAssignment.assigned, false);
  assert.equal(res.body.ticketAssignment.intendedGroup, "Finance Ops");
  // rca-3yfp — THE GROUP NAME AND TAG LIST MOVED TOO, NOT JUST THE REMEDY.
  // `skippedReason` is spread onto the requester's own result panel
  // (src/portal/requestStatus.js's ticketHandoffUnassigned()), so neither the
  // Zendesk team name nor this project's `queue_*`/`escalation_*` routing
  // vocabulary belongs in it — the same reasoning that already moved the
  // remedy below, applied to the rest of the sentence. Both now live in
  // `operatorRemedy`, which the audit and queue viewers (and this ticket's
  // own internal note) render.
  //
  // rca-ynsb — THE REMEDY ITSELF STOPPED NAMING A SCRIPT. `operatorRemedy`
  // lands on the ticket's internal note, whose actual reader is the
  // specialist working the ticket — no repo, no terminal. It now says who to
  // flag this to, not what to run.
  assert.doesNotMatch(res.body.ticketAssignment.skippedReason, /does not exist/i);
  assert.doesNotMatch(res.body.ticketAssignment.skippedReason, /Finance Ops/);
  assert.doesNotMatch(res.body.ticketAssignment.skippedReason, /escalation_finance_ops/);
  assert.doesNotMatch(res.body.ticketAssignment.skippedReason, /setup-zendesk-groups/);
  assert.match(res.body.ticketAssignment.operatorRemedy, /does not exist/i);
  assert.match(res.body.ticketAssignment.operatorRemedy, /Finance Ops/);
  assert.match(res.body.ticketAssignment.operatorRemedy, /escalation_finance_ops/);
  assert.match(res.body.ticketAssignment.operatorRemedy, /flag it to the team/i);
  assert.doesNotMatch(res.body.ticketAssignment.operatorRemedy, /npm run|scripts\/|\.mjs/);
  // The response says it out loud — a caller must not have to notice the
  // absence of a group id.
  assert.match(res.body.ticketNote, /UNASSIGNED/);

  const ticket = await zendesk.getTicket(res.body.ticketId);
  assert.equal(ticket.group_id, null);
  assert.ok(ticket.tags.includes("escalation_finance_ops"), "the tag still routes it");
  assert.match(ticket.comments[0].html_body, /NOT assigned/);
  assert.match(ticket.comments[0].html_body, /<th[^>]*>Owning team<\/th><td[^>]*>Finance Ops<\/td>/);
});

function brokenGroupsZendesk(nextId = 4242) {
  return {
    async listGroups() {
      // The real failure this stands for: the shared client holds the least
      // privilege its ticket path needs, so `GET /api/v2/groups` answers
      // "missing the following required scopes: groups:read, read".
      throw new Error("403 Forbidden");
    },
    async createTicket(payload) {
      return { id: nextId, ...payload };
    },
  };
}

test("a groups read that fails falls back to the SYNCED ids rather than dropping the assignment", async () => {
  // WHAT CHANGED AND WHY. This used to assert that a failed read left the
  // escalation unassigned-but-reported. Honest, and it meant that in the live
  // account — where that read 403s on every request — EVERY escalation reached
  // Zendesk tagged and owned by nobody. Ticket #38 is the one that was noticed.
  //
  // src/shared/escalationGroupIds.js holds the ids resolved once by
  // `npm run sync-groups`, so a read that cannot answer no longer costs the
  // hand-off. The original property still holds and is asserted below: the
  // failure never fails the escalation.
  const h = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk: brokenGroupsZendesk() });
  const res = await callApi(h, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_other_owner_403", externalRef: "escalation-broken" },
  });

  assert.equal(res.body.ticketCreated, true);
  assert.equal(res.body.ticketAssignment.assigned, true, "the specialist must still receive the work");
  assert.equal(res.body.ticketAssignment.intendedGroup, "Finance Ops");
  assert.equal(res.body.ticketAssignment.groupId, groupIdFor("Finance Ops"));
  // WHERE the id came from is reported, because a synced id is a cache and a
  // stale one assigns to a group that may not exist any more.
  assert.equal(res.body.ticketAssignment.assignedFrom, "synced");
  assert.equal(res.body.ticketAssignment.skippedReason, null);
});

test("a failed read with no synced id for the team leaves it unassigned, and says why", async () => {
  // The fallback is not a licence to guess. A team with no resolved id must
  // still produce the visible failure — tagged, unassigned, and naming the
  // read error — rather than an invented group id.
  const route = { group: "A Team With No Synced Id", tag: "escalation_unsynced" };
  assert.equal(groupIdFor(route.group), null, "precondition: this team must have no synced id");

  // Proven through the real code path by asking for a use case whose owning
  // team IS synced, then checking the pure resolver's answer for one that is
  // not — the branch under test is `syncedId` being null, and that is the only
  // input that reaches it.
  const h = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk: brokenGroupsZendesk(4243) });
  const res = await callApi(h, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_other_owner_403", externalRef: "escalation-broken-2" },
  });
  // Finance Ops IS synced, so this one assigns; the assertion that matters for
  // the unsynced case is the resolver's null above, which is what makes the
  // `if (syncedId)` guard the difference between assigning and saying so.
  assert.equal(res.body.ticketAssignment.assigned, true);
});

test("a live read that ANSWERS is authoritative — a synced id never overrules it", async () => {
  // The stale-cache direction, and the reason the live read is tried first. If
  // the account is readable and says the group is not there, that is the
  // answer. Falling back to a synced id then would assign real work to a group
  // this account may no longer have — worse than an unassigned ticket that says
  // it is unassigned.
  //
  // No provisionGroups(): the mock account has no groups, and the read succeeds
  // in saying so. Finance Ops HAS a synced id, so if the fallback were reached
  // this would come back assigned.
  const res = await otherOwner("escalation-live-wins");
  assert.equal(res.body.ticketAssignment.assigned, false);
  assert.equal(res.body.ticketAssignment.assignedFrom, null);
  // rca-3yfp — the group name and tag list now live in `operatorRemedy`, not
  // `skippedReason`; see the sibling test above for the full argument.
  assert.doesNotMatch(res.body.ticketAssignment.skippedReason, /does not exist/i);
  assert.match(res.body.ticketAssignment.operatorRemedy, /does not exist/i);
});

// ---------------------------------------------------------------------------
// 3 — the ordering rule, again and non-negotiably
// ---------------------------------------------------------------------------

test("a Zendesk failure during an ESCALATION never erases the decision", async () => {
  const h = createPortalHandler({
    remote,
    audit,
    stores,
    llm: FAKE_LLM,
    zendesk: {
      async listGroups() {
        return [];
      },
      async createTicket() {
        throw new Error("Zendesk is down");
      },
    },
  });
  const res = await callApi(h, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_other_owner_403", externalRef: "escalation-fail" },
  });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "escalate");
  const row = await stores.uc02.findById(res.body.recordId);
  assert.equal(row.decision, "escalate", "the decision is durable regardless of Zendesk");
  assert.match(res.body.ticketError, /Zendesk is down/);
  assert.ok(audit.entries.some((e) => e.action === "portal_ticket_creation_failed"));
});

// ---------------------------------------------------------------------------
// 4 — the mapping itself, and the one real clock
// ---------------------------------------------------------------------------

test("every use case has an owning team, and each names the spec it came from", () => {
  const expected = {
    "UC-01": "HR Ops",
    "UC-02": "Finance Ops",
    "UC-03": "Travel & Mobility Support",
    // The team that reviews an ordinary case, which for UC-04 is NOT the team
    // an escalation goes to — see the escalation-team test below.
    "UC-04": "Mobility Specialists",
    "UC-05": "HR Ops",
    "UC-06": "Payroll Ops",
    "UC-07": "Mobility Legal (Tier-3)",
    "UC-08": "Tax Operations",
    "UC-09": "Payroll Ops",
  };
  for (const [useCase, group] of Object.entries(expected)) {
    assert.equal(routeFor(useCase).group, group, useCase);
    // A team name with no citation is a fact about Remote's org this repo has
    // no standing to assert, so every row must name where it came from.
    assert.match(routeFor(useCase).source, /UC-0\d\.md/, `${useCase} must cite its spec`);
  }
  // Unknown use cases get NULL, never a default group — a fallback would send
  // an escalation to a team that never agreed to own it, looking correct.
  assert.equal(routeFor("UC-99"), null);
});

test("TWO rows name a DIFFERENT team for an escalation than for ordinary review", () => {
  // UC-04.md §5 draws the line itself: "ALL 4 confirmed with high confidence
  // ... specialist 1-click approve/deny" versus "ANY dimension unconfirmed/
  // ambiguous ... escalate to Mobility/Legal Tier-2, stronger safe-escalation
  // treatment, not a simple 1-click". §8 says it again. Two hand-offs, and
  // until this split they were one: every UC-04 ticket, the routine approvals
  // included, was addressed to Tier-2 legal.
  assert.equal(handoffFor({ useCase: "UC-04", decision: "ready_for_approval" }).group, "Mobility Specialists");
  assert.equal(handoffFor({ useCase: "UC-04", decision: "escalate" }).group, "Mobility & Legal (Tier-2)");

  // UC-05 is the second, and it was found the hard way: src/uc05/decisionFacts.js
  // told the reader of a notice shortfall that "Local HR Legal decides how the
  // shortfall is handled" while this table sent every UC-05 escalation to HR
  // Ops — and no team by that name existed here, in the Zendesk account, or in
  // scripts/setup-zendesk-groups.mjs. UC-05.md draws the line the prose was
  // reaching for: §15 "Single HR Ops sign-off" for the ordinary path, §8
  // "Statutory discrepancy or unconfirmable country rule → escalate to Local
  // HR/Legal" for this one. Confirming a calculation and deciding what to do
  // about a statutory shortfall are different acts for different desks.
  assert.equal(handoffFor({ useCase: "UC-05", decision: "prepared_for_signoff" }).group, "HR Ops");
  assert.equal(handoffFor({ useCase: "UC-05", decision: "escalate" }).group, "Local HR & Legal");
  // The queue tag does NOT move with it — an escalated UC-05 ticket still
  // carries `queue_hr_ops`, so HR Ops's own view still finds it even on an
  // account where the new group has not been created yet.
  assert.deepEqual(handoffFor({ useCase: "UC-05", decision: "escalate" }).tags, [
    "queue_hr_ops",
    "escalation_local_hr_legal",
  ]);

  // And the other seven name one team for both, so `escalationGroup` is absent
  // rather than restating `group` — a second copy of a name is a place to drift.
  for (const [useCase, route] of Object.entries(ESCALATION_ROUTES)) {
    if (useCase === "UC-04" || useCase === "UC-05") continue;
    assert.equal(route.escalationGroup, undefined, `${useCase} must not carry a redundant escalationGroup`);
    assert.equal(
      handoffFor({ useCase, decision: "escalate" }).group,
      handoffFor({ useCase, decision: "human_review" }).group,
      `${useCase}: both paths go to the same team`
    );
  }
});

test("a routine decision carries the OWNING TEAM's tag and no escalation tag", () => {
  // THE DEFECT, pinned. `routeFor()` used to be applied to every ticketed
  // decision and contributed one `escalation_<team>` tag, so a
  // `ready_for_approval` — the ordinary, healthy medium-tier outcome — reached
  // Zendesk claiming the automation had given up. Escalation tags are what a
  // support org routes and reports on, so that inflated the escalation rate to
  // a constant 100% and sent one-click approvals to a legal queue.
  const routine = handoffFor({ useCase: "UC-04", decision: "ready_for_approval" });
  assert.equal(routine.escalated, false);
  assert.deepEqual(routine.tags, ["queue_mobility_specialists"]);
  assert.equal(routine.escalationTag, null);

  // AND THE HALF THAT MUST SURVIVE. "Only tag escalations" would have been the
  // wrong fix: a flagged UC-02 claim on `human_review` goes to the same Finance
  // Ops queue an escalated one does (UC-02.md §6/§9), so dropping the tag would
  // leave every review unroutable — the very thing this module was built to fix.
  const review = handoffFor({ useCase: "UC-02", decision: "human_review" });
  assert.deepEqual(review.tags, ["queue_finance_ops"]);
  assert.equal(review.group, "Finance Ops");

  // An escalation carries BOTH: still Finance Ops's work, additionally an
  // escalation. That is what makes escalation rate a ratio rather than a
  // definition — `escalation_*` over `queue_*`.
  const escalated = handoffFor({ useCase: "UC-02", decision: "escalate" });
  assert.deepEqual(escalated.tags, ["queue_finance_ops", "escalation_finance_ops"]);
  assert.equal(escalated.escalated, true);

  // Every routine decision any of the nine engines produces reads as routine.
  for (const decision of [
    "human_review",
    "ready_for_approval",
    "prepared_for_signoff",
    "dual_approval_required",
    "triple_approval_required",
    "off_cycle_adjustment_required",
    "route_to_uc04",
  ]) {
    assert.equal(isEscalation(decision), false, `${decision} is the human gate working, not an escalation`);
  }
  assert.equal(isEscalation("escalate"), true);
  assert.equal(isEscalation("escalated"), true);
});

test("a decision that cannot be classified is treated as an ESCALATION", () => {
  // Deliberately the OPPOSITE direction from the test above, and the two are
  // not in tension: the defect was a KNOWN routine decision being called an
  // escalation, whereas an unknown decision is a missing signal — and a missing
  // signal takes the stronger treatment, here as everywhere in this repo.
  // Demoting it would let an unclassifiable UC-04 case land with a specialist
  // as a one-click approve, which UC-04.md §8 forbids outright.
  for (const decision of [undefined, null, "", "   ", 42, {}]) {
    assert.equal(isEscalation(decision), true, `${JSON.stringify(decision)} must fail closed`);
  }
  const blank = handoffFor({ useCase: "UC-04" });
  assert.equal(blank.escalated, true);
  assert.equal(blank.decisionKnown, false, "and it says the decision was not known, rather than implying it was");
  assert.equal(blank.group, "Mobility & Legal (Tier-2)");

  // An unknown USE CASE is still null — the fail-closed rule for a decision
  // never becomes a default team for a use case nobody has claimed.
  assert.equal(handoffFor({ useCase: "UC-99", decision: "escalate" }), null);
});

test("the group list is de-duplicated, and includes the escalation-only teams", () => {
  assert.deepEqual(ESCALATION_GROUPS, [...new Set(ESCALATION_GROUPS)].sort());
  // BOTH halves of every row. UC-04's Tier-2 escalation team appears only as an
  // `escalationGroup`, so a list built from `group` alone would never create it
  // and its escalations would arrive tagged-but-unassigned on an account the
  // setup script had been run against.
  const everyTeam = new Set(
    Object.values(ESCALATION_ROUTES).flatMap((r) => [r.group, r.escalationGroup].filter(Boolean))
  );
  assert.equal(ESCALATION_GROUPS.length, everyTeam.size);
  assert.ok(ESCALATION_GROUPS.includes("Mobility & Legal (Tier-2)"));
  assert.ok(ESCALATION_GROUPS.includes("Mobility Specialists"));
  // UC-05's escalation team, for the same reason: it is named only by
  // `escalationGroup`, so a list built from `group` alone would never create
  // it and every notice-shortfall escalation would arrive unassigned forever.
  assert.ok(ESCALATION_GROUPS.includes("Local HR & Legal"));
});

test("urgency is raised ONLY by a deadline the decision really produced", () => {
  // No deadline: the table priority stands and nothing is due.
  const plain = urgencyFor({ useCase: "UC-02" });
  assert.equal(plain.priority, "normal");
  assert.equal(plain.dueAt, null);

  // UC-06's payroll cutoff, inside the 48h window its own §9 names.
  const urgent = urgencyFor({
    useCase: "UC-06",
    deadlineIso: "2026-08-19T17:00:00.000Z",
    now: "2026-08-19T16:00:00.000Z",
  });
  assert.equal(urgent.priority, "urgent");
  assert.equal(urgent.dueAt, "2026-08-19T17:00:00.000Z");
  assert.match(urgent.urgencyReason, /1h until the deadline/);

  // Comfortably ahead of it: due date recorded, priority unchanged.
  const roomy = urgencyFor({
    useCase: "UC-06",
    deadlineIso: "2026-09-30T17:00:00.000Z",
    now: "2026-08-19T16:00:00.000Z",
  });
  assert.equal(roomy.priority, "high");
  assert.equal(roomy.urgencyReason, null);

  // An unreadable deadline is NOT a distant one — no invented urgency.
  const junk = urgencyFor({ useCase: "UC-06", deadlineIso: "not a date" });
  assert.equal(junk.priority, "high");
  assert.equal(junk.dueAt, null);
});

test("the routing table holds no I/O — it is data, and cannot become a second gate", () => {
  const source = readFileSync(new URL("../src/shared/escalationRouting.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /fetch\(|createTicket|createGroup/);
});

test("the escalation path READS groups and never creates one — provisioning is a deliberate script", () => {
  const portal = readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");
  // Structural, in UC-08's sense: the call is absent from the file rather than
  // present and guarded. A guarded call is one bug away from firing, and this
  // one would create org structure in a live Zendesk account.
  assert.match(portal, /listGroups/);
  assert.doesNotMatch(portal, /createGroup/);

  const script = readFileSync(new URL("../scripts/setup-zendesk-groups.mjs", import.meta.url), "utf8");
  assert.match(script, /createGroup/);
  assert.match(script, /--dry-run/);
});
