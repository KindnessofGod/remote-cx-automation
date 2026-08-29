// ---------------------------------------------------------------------------
// uc01Routing.test.js — a UC-01 decision reaches the team that owns it, on the
// NODE path, which is the path the demos drive
// ---------------------------------------------------------------------------
// WHAT WAS WRONG, and why nothing caught it
//
// `src/uc01/workflow.js` is one of only two workflow.js files that talk to
// Zendesk directly, and it did not import `src/shared/escalationRouting.js` at
// all. Every UC-01 outcome raised through this path — `npm run live`,
// `npm run livedemo`, the demo scripts — reached Zendesk carrying
// `verification_exception` and nothing else: no `queue_*` tag, no
// `escalation_*` tag, no group. The identical decision through the n8n graph
// was tagged and assigned by its `Assign Routing` node. Two execution paths,
// one of which silently dropped the hand-off. docs/ESCALATION-DESTINATIONS.md
// §2.5.
//
// WHY THESE TESTS ARE POSITIVE ONES, DELIBERATELY
//
// A path that never routes and a path that correctly declined to route look
// identical from outside: both produce a ticket with no group on it. Asserting
// "a sanctioned/unroutable case is NOT assigned" would have passed against the
// broken code, every time. So every test below states the tags and the group a
// decision MUST come out carrying, and the two that matter most are the
// ordinary ones — an escalation carrying BOTH tags, and an auto-resolve
// carrying the queue tag and NOT the escalation tag. That second one is the
// whole point of the vocabulary split: the tags were one string once, and a
// routine outcome wearing `escalation_*` makes the escalation rate a constant.
//
// HERMETIC. Remote is the in-process mock fixture set (no socket, so no port to
// register in src/shared/ports.js), the classifier is the rule-based one, and
// every Zendesk client here is a fake that records calls. Nothing reaches a
// network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { routeFor } from "../src/shared/escalationRouting.js";
import { groupIdFor } from "../src/shared/escalationGroupIds.js";
import { resolveGroupAssignment, describeAssignment } from "../src/shared/groupAssignment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (...parts) => readFileSync(join(__dirname, "..", ...parts), "utf8");

const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });

// THE EXPECTED VALUES COME FROM THE TABLE, NOT FROM A STRING TYPED HERE.
// The team name is typed in exactly one file in this repository
// (src/shared/escalationRouting.js) and a test that re-typed it would be a
// second copy of the very fact the module exists to hold once — it would also
// keep passing after somebody corrected the table.
const ROUTE = routeFor("UC-01");

/** A Zendesk stand-in that records every call and can be told what the account holds. */
function fakeZendesk({ groups = [ROUTE.group], listGroups = undefined } = {}) {
  const calls = [];
  const client = {
    calls,
    async resolveWithLetter(ref, html, extra = {}) {
      calls.push({ kind: "resolveWithLetter", ref, html, extra });
    },
    async flagForReview(ref, payload) {
      calls.push({ kind: "flagForReview", ref, payload });
    },
  };
  if (listGroups !== undefined) {
    if (listGroups !== null) client.listGroups = listGroups;
  } else {
    client.listGroups = async () => groups.map((name, i) => ({ id: 900_000 + i, name }));
  }
  return client;
}

function run(ticket, zendesk) {
  return handleVerificationTicket(
    { source: "zendesk", ...ticket },
    {
      remote,
      audit: new AuditLogger(),
      caseStore: new CaseStore(),
      zendesk,
      classify: classifyRequestRuleBased,
    }
  );
}

const sessionFor = (id) => ({ authenticatedEmploymentId: id });

// --- THE TWO POSITIVE CASES THE FIX EXISTS FOR ------------------------------

test("an ESCALATION reaches HR Ops: both tags on the ticket, and a real group_id", async () => {
  const zendesk = fakeZendesk();
  const r = await run(
    {
      text: "Please confirm this person's employment for a mortgage application.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: "5001",
    },
    zendesk
  );

  assert.equal(r.decision, "escalate", "the scenario must actually escalate, or this proves nothing");

  const [call] = zendesk.calls;
  assert.equal(call.kind, "flagForReview");
  assert.equal(call.ref, "5001");

  // The owning team's tag AND the escalation marker. Both, because an escalated
  // ticket is still that team's work and is additionally an escalation.
  assert.ok(call.payload.tags.includes(ROUTE.queueTag), `expected ${ROUTE.queueTag} in ${call.payload.tags}`);
  assert.ok(call.payload.tags.includes(ROUTE.escalationTag), `expected ${ROUTE.escalationTag} in ${call.payload.tags}`);
  // UC-01.md §5c's own tag keeps its place — the live Zendesk trigger guard reads it.
  assert.ok(call.payload.tags.includes("verification_exception"));

  // ASSIGNMENT, not just labelling. A tag is something a trigger COULD route on.
  assert.equal(typeof call.payload.groupId, "number");
  assert.equal(r.ticketAssignment.assigned, true);
  assert.equal(r.ticketAssignment.intendedGroup, ROUTE.group);
  assert.equal(r.ticketAssignment.assignedFrom, "live");

  // And the note SAYS whose queue it is — §2.4's half of the same defect: the
  // exception note carried the decision, the reason and the figures and never
  // named a team, so it could not be read as a hand-off at all.
  assert.match(call.payload.note, /Routing — Assigned to /);
  assert.ok(call.payload.note.includes(ROUTE.group));
});

test("an AUTO-RESOLVE carries the queue tag, NOT the escalation tag, AND is assigned to HR Ops", async () => {
  const zendesk = fakeZendesk();
  const r = await run(
    {
      text: "Please send me a standard employment verification letter.",
      // The TICKET-REQUESTER signal, not a Remote session: since G-2 a logged-in
      // requester is deflected to Remote's own Requests tab, so a Remote session
      // here would silently turn this into a deflection test and the assertion
      // below — "the scenario must actually auto-resolve, or this proves
      // nothing" — is what caught it.
      session: { authenticatedEmail: "amara@acme.test" },
      employmentId: "emp_active_001",
      externalRef: "5002",
    },
    zendesk
  );

  assert.equal(r.decision, "auto_resolve", "the scenario must actually auto-resolve, or this proves nothing");

  const [call] = zendesk.calls;
  assert.equal(call.kind, "resolveWithLetter");
  assert.deepEqual(call.extra.tags, [ROUTE.queueTag]);
  assert.ok(
    !call.extra.tags.includes(ROUTE.escalationTag),
    "a resolved verification is not an escalation — that conflation is what made the escalation rate a constant 100%"
  );

  // ASSIGNED, not just labelled — owner decision, 2026-08-22 (mail
  // rcc-wisp-u36ja, F-6/rca-1rx). An auto-resolved ticket is still HR Ops's
  // work, the same as an escalated one, resolved through the same
  // `resolveGroupAssignment()` the human_review branch uses.
  assert.equal(typeof call.extra.groupId, "number");
  assert.equal(r.ticketAssignment.assigned, true);
  assert.equal(r.ticketAssignment.intendedGroup, ROUTE.group);
  assert.equal(r.routing.escalated, false);
  assert.equal(r.routing.intendedGroup, ROUTE.group);
});

test("a HUMAN_REVIEW is routed without being called an escalation", async () => {
  const zendesk = fakeZendesk();
  const r = await run(
    {
      text: "Attached is a bank form that needs completing for my employment verification.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      hasAttachment: true,
      externalRef: "5003",
    },
    zendesk
  );

  assert.equal(r.decision, "human_review");
  const [call] = zendesk.calls;
  assert.deepEqual(call.payload.tags, [ROUTE.queueTag]);
  assert.equal(r.ticketAssignment.escalated, false);
  // Still assigned: the review has to be routable too, which is why "tag only
  // escalations" was the wrong fix.
  assert.equal(r.ticketAssignment.assigned, true);
  assert.equal(typeof call.payload.groupId, "number");
});

// --- WHEN THE GROUP IS NOT THERE, SAY SO ON THE TICKET ----------------------

test("a missing Zendesk group is tagged and SAID, never silently unassigned", async () => {
  // `Mobility Specialists` and `Local HR & Legal` are genuinely absent from the
  // live account today, so this is the ordinary path for two of the nine rows.
  const zendesk = fakeZendesk({ groups: ["Support"] });
  const r = await run(
    {
      text: "Please confirm employment for a visa application.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: "5004",
    },
    zendesk
  );

  assert.equal(r.decision, "escalate");
  const [call] = zendesk.calls;

  // Tagged anyway — the team's own view still finds it.
  assert.ok(call.payload.tags.includes(ROUTE.queueTag));
  assert.ok(call.payload.tags.includes(ROUTE.escalationTag));
  // Not assigned, and not guessed either: an omitted group_id leaves the ticket
  // where it is, while a guessed one would put real work in the wrong queue.
  assert.equal(call.payload.groupId, null);
  assert.equal(r.ticketAssignment.assigned, false);
  // And the failure is a sentence a human reads, not an absence they must notice.
  assert.match(call.payload.note, /ASSIGNMENT SKIPPED/);
  assert.ok(call.payload.note.includes(ROUTE.group));
  // rca-ynsb: the remedy no longer names a repo script — this note's real
  // reader is the specialist working the ticket, who has no repo and no
  // terminal — but the ticket must still say what to do about it.
  assert.match(call.payload.note, /flag it to the team/i);
  assert.doesNotMatch(call.payload.note, /npm run|scripts\/|\.mjs/);
});

test("a groups read that FAILS falls back to the synced ids and says where the id came from", async () => {
  const zendesk = fakeZendesk({
    listGroups: async () => {
      throw new Error("403 missing scopes");
    },
  });
  const r = await run(
    {
      text: "Please confirm employment for a visa application.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: "5005",
    },
    zendesk
  );

  // A groups read that fails must never fail the escalation.
  assert.equal(r.decision, "escalate");
  assert.equal(r.ticketAssignment.assigned, true);
  assert.equal(r.ticketAssignment.assignedFrom, "synced");
  assert.equal(r.ticketAssignment.groupId, groupIdFor(ROUTE.group));
  // rca-ynsb: same reasoning — provenance is kept, the CLI command is not.
  assert.match(zendesk.calls[0].payload.note, /locally cached list of group ids/);
  assert.doesNotMatch(zendesk.calls[0].payload.note, /npm run|scripts\/|\.mjs/);
});

test("a client with no listGroups at all still assigns from the synced ids", async () => {
  const zendesk = fakeZendesk({ listGroups: null });
  const r = await run(
    {
      text: "Please confirm employment for a visa application.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: "5006",
    },
    zendesk
  );
  assert.equal(r.ticketAssignment.assignedFrom, "synced");
  assert.equal(zendesk.calls[0].payload.groupId, groupIdFor(ROUTE.group));
});

test("a live read that ANSWERS overrules the synced cache — an id is not a fact about this account", async () => {
  // The account answered and said the group is not there. That IS the answer:
  // falling back to a cached id would assign real work to a group this account
  // may no longer have.
  const zendesk = fakeZendesk({ groups: [] });
  const r = await run(
    {
      text: "Please confirm employment for a visa application.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      externalRef: "5007",
    },
    zendesk
  );
  assert.equal(r.ticketAssignment.assigned, false);
  assert.notEqual(groupIdFor(ROUTE.group), null, "the synced cache DOES hold an id — that is what makes this test meaningful");
});

// --- ROUTING IS DOWNSTREAM OF THE RECORD, AND CANNOT CHANGE A DECISION ------

test("routing runs after the durable audit write, so it can cost a group but never a record", async () => {
  const order = [];
  const audit = new AuditLogger();
  audit.logDurable = async (entry) => {
    order.push(`audit:${entry.action}`);
  };
  const zendesk = {
    async listGroups() {
      order.push("zendesk:listGroups");
      return [];
    },
    async flagForReview() {
      order.push("zendesk:flagForReview");
    },
  };

  await handleVerificationTicket(
    {
      text: "Please confirm employment for a visa application.",
      session: sessionFor("emp_terminated_002"),
      employmentId: "emp_terminated_002",
      source: "zendesk",
      externalRef: "5008",
    },
    { remote, audit, caseStore: new CaseStore(), zendesk, classify: classifyRequestRuleBased }
  );

  assert.deepEqual(order, ["audit:escalate", "zendesk:listGroups", "zendesk:flagForReview"]);
});

test("the decision is identical with and without a Zendesk client — routing decides nothing", async () => {
  const ticket = {
    text: "Please confirm employment for a visa application.",
    session: sessionFor("emp_terminated_002"),
    employmentId: "emp_terminated_002",
  };
  const withRouting = await run({ ...ticket, externalRef: "5009" }, fakeZendesk());
  const without = await run({ ...ticket, externalRef: "5010" }, null);

  assert.equal(withRouting.decision, without.decision);
  assert.equal(withRouting.reason, without.reason);
  assert.deepEqual(withRouting.flags, without.flags);
  // The team is still named when no ticket was touched: whose work this is is a
  // property of the DECISION, not of whether a Zendesk client happened to exist.
  assert.deepEqual(withRouting.routing, without.routing);
  assert.equal(without.ticketAssignment, null, "no hand-off ran, and that is stated rather than reported as a failed one");
});

// --- ONE VOCABULARY ACROSS ALL THREE EXECUTION PATHS ------------------------

test("the team name is never typed into src/uc01/", () => {
  const sources = ["src/uc01/workflow.js", "src/shared/groupAssignment.js"].map((p) => repoFile(p));
  for (const src of sources) {
    assert.ok(
      !src.includes(`"${ROUTE.group}"`) && !src.includes(`'${ROUTE.group}'`),
      "the owning team is a fact src/shared/escalationRouting.js holds once; a literal here would be a second copy that keeps passing after the table is corrected"
    );
    assert.ok(!src.includes(`"${ROUTE.queueTag}"`), "the tags come from the table too");
  }
});

test("the three execution paths explain the same failure the same way", () => {
  // A specialist works ONE queue and sees tickets from the portal, from n8n and
  // from this path. The same missing group must not arrive wearing three
  // different explanations, so the sentence is held against the two that
  // already existed.
  //
  // rca-ee04: the portal no longer carries this wording as a SECOND COPY —
  // it calls `resolveGroupAssignment()` (src/shared/groupAssignment.js), the
  // one place the sentence is written, rather than reimplementing it. Two
  // literal copies is exactly the shape that let the portal's own no-handoff
  // wording drift and print a repo path to a requester after the shared
  // module's had already been fixed. n8n's Code node still carries the
  // wording literally — it has no import mechanism to call into.
  const anchor = "does not exist in this account, so this ticket was tagged";
  assert.ok(
    !repoFile("src", "portal", "server.js").includes(anchor),
    "the portal is carrying its own copy of this sentence again — call resolveGroupAssignment() instead of forking it"
  );
  assert.ok(
    repoFile("src", "portal", "server.js").includes("resolveGroupAssignment"),
    "the portal must resolve routing through the one shared implementation"
  );
  assert.ok(repoFile("workflows", "nodes", "assignRouting.js").includes(anchor), "the n8n port's wording moved — reconcile, do not fork");
  assert.ok(repoFile("src", "shared", "groupAssignment.js").includes(anchor));
});

// --- THE RESOLVER ITSELF ----------------------------------------------------

test("an unrouted use case is reported by name, never defaulted to somebody's queue", async () => {
  const assignment = await resolveGroupAssignment({ handoff: null, zendesk: fakeZendesk(), useCase: "UC-99" });
  assert.equal(assignment.assigned, false);
  assert.equal(assignment.intendedGroup, null);
  assert.deepEqual(assignment.routingTags, []);
  // rca-ee04: the use case IS named, but on the operator-facing half — never
  // on `skippedReason`, which a requester's own result panel renders verbatim
  // and must never carry this project's own use-case index or a repo path.
  assert.doesNotMatch(assignment.skippedReason, /UC-99/);
  assert.match(assignment.operatorRemedy, /UC-99/);
  assert.match(describeAssignment(assignment), /UC-99/);
  assert.match(describeAssignment(assignment), /^ROUTING SKIPPED/);
});

test("a DEFLECTION carries the queue tag too, and is not an escalation", async () => {
  // G-2 adds a fourth outcome, and the denominator argument that put the queue
  // tag on auto-resolved tickets applies to it unchanged: the escalation RATE is
  // `escalation_*` over `queue_*`, so every ticket UC-01 handled has to carry the
  // queue tag or the rate climbs as the deflection succeeds. A deflection is work
  // this use case did — it is not an escalation and it is not nothing.
  const zendesk = fakeZendesk();
  const r = await run(
    {
      text: "Please send me a standard employment verification letter.",
      session: sessionFor("emp_active_001"),
      employmentId: "emp_active_001",
      externalRef: "5003",
    },
    zendesk
  );

  assert.equal(r.decision, "deflected_to_self_service", "the scenario must actually deflect, or this proves nothing");

  const [call] = zendesk.calls;
  assert.deepEqual(call.extra.tags, [ROUTE.queueTag]);
  assert.ok(!call.extra.tags.includes(ROUTE.escalationTag));
});
