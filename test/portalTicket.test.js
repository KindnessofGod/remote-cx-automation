// ---------------------------------------------------------------------------
// portalTicket.test.js  —  the portal's Zendesk hand-off, and the ref control
// ---------------------------------------------------------------------------
// THE QUESTION THIS SUITE EXISTS FOR
// "Will situations requiring human review show up on Zendesk?" The answer had
// to become yes. The ZAF sidebar finds a case by TICKET ID, and the portal
// created no ticket at all — so a portal submission that reached a human-gated
// decision produced a correct, durably recorded decision with nothing for the
// sidebar to attach to. The human gate existed and was unreachable for exactly
// the submissions being tested.
//
// The load-bearing tests are the positive ones: a human-gated decision MUST
// create a pre-tagged ticket, and the record MUST afterwards be findable by
// that ticket id — which is the only thing that actually closes the loop.
// Beside them sits the ordering proof src/remoteui/ already carries: with a
// Zendesk client that always throws, the decision still stands.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startMockServer, EXPENSES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import {
  needsTicket,
  ticketTags,
  MARKER_TAG,
  TICKETABLE_TYPES,
  NO_TICKET_DECISIONS,
} from "../src/portal/ticketing.js";

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

const REMOTE_PORT = 4105; // allocated in src/shared/ports.js TEST_PORTS (was 4094, which three other files bind)

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
let audit;
let stores;

const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});
after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

beforeEach(() => {
  audit = new AuditLogger();
  stores = {
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
});

/**
 * A Postgres double that ENFORCES the one constraint under test: the
 * `workflow_claims` primary key `(use_case, external_ref)`.
 *
 * WHY A TEST NEEDS THIS AT ALL, and it is the honest finding of this pass.
 * `claimExternalRef()` documents its unconfigured path plainly: with no pool
 * there is no ledger, so it returns `{claimed: true, ledgerUnavailable: true}`
 * and the request proceeds. That is the right degradation — a per-process Set
 * would fake a guarantee that only holds in the case that never matters — but
 * it means a repeated reference is NOT refused on an in-memory run, and a test
 * without a pool would quietly assert nothing.
 *
 * A stub returning "nothing here" would be worse than useless: it would
 * reproduce exactly the behaviour under test and pass. So this one really
 * stores rows and really rejects the second insert of a key.
 *
 * Every other statement answers empty, which is all the stores need: each of
 * them checks memory first, so a pooled read only ever falls through on a
 * genuine miss.
 */
function fakeLedgerPool() {
  const claims = new Set();
  return {
    claims,
    async query(sql, params) {
      if (/insert into workflow_claims/i.test(sql)) {
        const key = `${params[0]}::${params[1]}`;
        if (claims.has(key)) return { rows: [], rowCount: 0 }; // on conflict do nothing
        claims.add(key);
        return { rows: [{ external_ref: params[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** A Zendesk double that records what it was asked to create and to update. */
function fakeZendesk() {
  let next = 900;
  const created = [];
  const updated = [];
  return {
    created,
    updated,
    async createTicket(payload) {
      next += 1;
      created.push(payload);
      return { id: next };
    },
    async updateTicket(id, patch) {
      updated.push({ id, patch });
      return { ticket: { id } };
    },
  };
}

/** A Zendesk client that always fails — the ordering proof. */
function throwingZendesk(message = "Zendesk is down") {
  return {
    async createTicket() {
      throw new Error(message);
    },
  };
}

function handlerWith(zendesk) {
  return createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk });
}

/**
 * A handler whose stores carry the enforcing ledger pool above — the only
 * configuration in which a repeated reference is actually refused. See
 * fakeLedgerPool()'s header for why that is a property of the deployment
 * rather than of the code.
 */
function pooledHandler(zendesk) {
  const pgPool = fakeLedgerPool();
  for (const store of Object.values(stores)) store.pgPool = pgPool;
  return { handler: createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk }), pgPool };
}

function callApi(handler, { method, path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
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
    handler(req, res).catch(reject);
  });
}

const overCap = (handler, externalRef) =>
  callApi(handler, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_over_cap_402", externalRef },
  });

const cleanClaim = (handler, externalRef) =>
  callApi(handler, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_clean_401", externalRef },
  });

// ---------------------------------------------------------------------------
// 1 — THE POSITIVE TESTS. Read the file header before changing them.
// ---------------------------------------------------------------------------

test("POSITIVE: a human-gated decision creates a pre-tagged Zendesk ticket", async () => {
  const zendesk = fakeZendesk();
  const res = await overCap(handlerWith(zendesk), "ticket-proof-1");

  assert.equal(res.body.decision, "human_review", "fixture precondition: this must need a human");
  assert.equal(res.body.ticketCreated, true);
  assert.equal(typeof res.body.ticketId, "string");
  assert.equal(zendesk.created.length, 1);

  const ticket = zendesk.created[0];
  // The last tag is the OWNING TEAM's routing tag, and it is applied to every
  // ticket rather than only to escalations. That is deliberate: a flagged UC-02
  // claim goes to the same Finance Ops queue an escalated one does
  // (src/shared/escalationRouting.js), so tagging only escalations would leave
  // the reviews unroutable and add a special case for no gain.
  //
  // IT USED TO BE `escalation_finance_ops`, AND THAT WAS THE DEFECT. The
  // sentence above is right about the routing and was wrong about the tag: one
  // string was carrying two claims — whose queue this is, and whether the
  // automation gave up — so the routing could only be kept by asserting an
  // escalation about `human_review`, the healthy medium-tier outcome. Escalation
  // tags are what a support org routes and reports on, so every review inflated
  // the escalation rate. The vocabulary is split now: `queue_*` on every ticket
  // (the routing this test was protecting), `escalation_*` only when the
  // decision really is one — see the escalate case immediately below.
  assert.deepEqual(ticket.tags, [MARKER_TAG, "uc02", "uc02_finance_ops_review", "queue_finance_ops"]);
  assert.ok(
    !ticket.tags.some((t) => t.startsWith("escalation_")),
    "a human_review is the gate working — it must not claim the automation escalated"
  );
  assert.equal(res.body.ticketAssignment.escalated, false);
  // Still routed: the owning team is named and the note says which hand-off
  // this is, so a specialist opening the queue can tell the two apart.
  assert.equal(res.body.ticketAssignment.intendedGroup, "Finance Ops");
  // `html_body`, not `body` — an internal note is the Zendesk comment field that
  // accepts HTML, and this note is composed as one. See buildTicketNote() and
  // test/portalTicketNote.test.js, which pins the shape of it.
  const note = ticket.comment.html_body;
  assert.match(note, /Routine review/);
  // The note carries what the gates actually reported, so a specialist opening
  // the ticket has the decision in front of them rather than a bare pointer.
  assert.match(note, /<th[^>]*>Decision<\/th><td[^>]*>human_review<\/td>/);
  assert.match(note, /<th[^>]*>Reason<\/th><td[^>]*>over_policy_cap<\/td>/);
  assert.equal(ticket.comment.body, undefined, "an HTML note must not also be sent as plain text");
  assert.equal(ticket.comment.public, false, "an intake note is never a public reply");
});

test("POSITIVE: round-6 D-05 — a ticketed decision also carries a PUBLIC reply the requester can read", async () => {
  // Round 6's own evidence: ticket #119 carried one message, marked Internal,
  // and zero public replies, unchanged twenty minutes later
  // (qa/evidence/UC-01/2026-08-22-uc01-e2e-6/OPEN-DEFECTS.md D-05). The
  // internal note above is necessary for a specialist and insufficient for the
  // person who filed the request — this test is the second half.
  const zendesk = fakeZendesk();
  const res = await overCap(handlerWith(zendesk), "ticket-proof-d05");

  assert.equal(res.body.ticketCreated, true);
  assert.equal(zendesk.updated.length, 1, "exactly one follow-up update — the public reply, and nothing else");

  const [update] = zendesk.updated;
  assert.equal(update.id, Number(res.body.ticketId));
  assert.equal(update.patch.comment.public, true, "the requester's own reply must be PUBLIC, not another internal note");
  assert.equal(typeof update.patch.comment.body, "string");
  assert.ok(update.patch.comment.body.length > 0, "a public reply with no words tells the requester nothing");
  // SAME WORDS AS THE PAGE, NEVER A SECOND COPY. plainAnswer() composes both;
  // this proves the Zendesk reply is not a hand-authored sentence that could
  // silently drift from what the result panel already told the requester.
  assert.equal(update.patch.comment.body, [res.body.plainAnswer.lead, res.body.plainAnswer.next].filter(Boolean).join(" "));
  assert.ok(update.patch.status === undefined, "a public reply must not itself resolve a ticket still awaiting a human");
});

test("an escalation is ASSIGNED to its owning group without any groups read", async () => {
  // THE DEFECT. The group was resolved by calling GET /api/v2/groups at request
  // time, and the shared Zendesk client holds the least privilege its ticket
  // path needs — no `read` scope — so that call 403s ("missing the following
  // required scopes: groups:read, read"). The escalation was tagged
  // `escalation_finance_ops` and assigned to nobody. Observed live on ticket
  // #38, reported honestly on the response and still useless: the specialist
  // never saw the work, which is the one thing the routing exists to do.
  //
  // A client with NO listGroups at all is used here deliberately. If the
  // assignment still lands, it cannot have come from an API call.
  const zendesk = fakeZendesk();
  delete zendesk.listGroups;

  const res = await overCap(handlerWith(zendesk), "ticket-proof-assigned");
  assert.equal(res.body.ticketCreated, true);
  assert.equal(res.body.ticketAssignment.assigned, true, "an escalation with an owning team must be assigned to it");
  assert.equal(res.body.ticketAssignment.intendedGroup, "Finance Ops");
  assert.equal(typeof res.body.ticketAssignment.groupId, "number");
  assert.equal(res.body.ticketAssignment.skippedReason, null);

  // And the id reaches the ticket Zendesk is actually asked to create.
  assert.equal(zendesk.created[0].group_id, res.body.ticketAssignment.groupId);
  assert.match(res.body.ticketNote, /assigned it to Finance Ops/);
});

test("the requester address is one Zendesk actually accepts, and is still unroutable", async () => {
  // WHY THIS IS A TEST AND NOT A DETAIL. The address used to be
  // `<persona>@portal.invalid` — RFC 2606's most emphatic reserved form, chosen
  // so a demo ticket could never carry a real person's address. Zendesk rejects
  // it: `POST /api/v2/tickets` answers `422 RecordInvalid`, "…is not a valid
  // address". So every portal decision that needed a human failed to raise its
  // ticket, while the decision itself was correct and durably recorded — the
  // failure was reported honestly on the page AND in `audit_log`, and still
  // looked from the Zendesk side exactly like the hand-off never having been
  // built. A tester checked the account and found nothing there.
  //
  // Both halves are asserted because dropping either reintroduces a real fault:
  // an address Zendesk refuses breaks the hand-off, and a plausible one risks
  // mailing a stranger from a real support account.
  const zendesk = fakeZendesk();
  await overCap(handlerWith(zendesk), "ticket-proof-requester");
  const email = zendesk.created[0].requester.email;

  assert.match(email, /@example\.com$/, "must be an address the live account accepts — see this test's header");
  assert.doesNotMatch(email, /\.invalid$/, "Zendesk 422s .invalid; that outage is what this pins");

  // And the source must not drift back. `example.com` is reserved by the same
  // RFC, IANA-controlled and accepts no mail, so it is unroutable without being
  // syntactically invalid.
  const server = readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");
  assert.match(server, /function personaEmail[\s\S]{0,200}@example\.com/);
});

test("POSITIVE: the record is findable BY TICKET ID afterwards — the loop the sidebar needs", async () => {
  const zendesk = fakeZendesk();
  const res = await overCap(handlerWith(zendesk), "ticket-proof-2");

  // This is the whole point. The ZAF sidebar opens on a ticket and asks
  // `GET /api/expenses/by-ticket/:externalRef`; before this pass there was no
  // ticket id to ask with, so a portal submission needing a human was
  // unreachable from the sidebar.
  const row = await stores.uc02.findByExternalRef(res.body.ticketId);
  assert.ok(row, "the claim must be findable by its ticket id");
  assert.equal(row.decision, "human_review");
  assert.equal(row.id, res.body.recordId);
});

// rca-whir. A decision made through the portal is durable BEFORE its ticket
// exists ("gates first, ticket after" — this file's header, raiseTicketIfNeeded's
// own comment), so the decision's own audit_log row is written with no ticket id
// at all, and `recordTicketRelink()` writes a SECOND row once the ticket is
// created. Measured live 2026-08-22: of 65 real UC-02 audit_log rows, exactly
// ONE carried a numeric, joinable Zendesk ticket id — because that relink row
// echoed its OWN action name back as `details.reason` ("portal_reference_relinked")
// instead of the decision's real reason ("over_policy_cap"), so
// src/surfaceverify/scenarios.js's `discoverScenarios()` — which joins on
// `details->>'reason'` — could never find it by the reason it was actually
// looking for. This is the field that fixes that: `details.reason` on the
// relink row now carries the ORIGINAL decision's reason, same shape as
// src/uc01/workflow.js's third-party hand-off (`details.reason: outcome.reason`
// beside its own `ticketId`).
test("POSITIVE: the ticket is joinable by the decision's own REASON, not just its record id", async () => {
  const zendesk = fakeZendesk();
  const res = await overCap(handlerWith(zendesk), "ticket-proof-reason-1");
  assert.equal(res.body.decision, "human_review", "fixture precondition");

  const relink = audit.entries.find(
    (e) => e.action === "portal_reference_relinked" && e.details?.ticketId === res.body.ticketId
  );
  assert.ok(relink, "the relink row for this ticket must exist");
  assert.equal(
    relink.details.reason,
    "over_policy_cap",
    "the relink row must carry the DECISION's reason, not its own action name, or a reason-keyed lookup " +
      "(discoverScenarios()) can never find this ticket"
  );
});

test("POSITIVE: an auto-approved claim creates NO ticket, and says why", async () => {
  const zendesk = fakeZendesk();
  const res = await cleanClaim(handlerWith(zendesk), "ticket-proof-3");

  assert.equal(res.body.decision, "auto_approve", "fixture precondition");
  assert.equal(res.body.ticketCreated, false);
  assert.equal(res.body.ticketId, null);
  assert.deepEqual(zendesk.created, [], "a clean claim must not put work in a support queue");
  assert.match(res.body.ticketNote, /needs no human/i);
});

// ---------------------------------------------------------------------------
// 2 — THE ORDERING PROOF (src/remoteui/'s, applied here)
// ---------------------------------------------------------------------------

test("a Zendesk failure never erases a decision that was already made", async () => {
  const res = await overCap(handlerWith(throwingZendesk("connect ECONNREFUSED")), "ticket-proof-4");

  // The submission still succeeded, and the decision is the real one.
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "human_review");
  assert.ok(res.body.recordId, "the record must exist");

  // The record is durable, with its own reference intact.
  const row = await stores.uc02.findById(res.body.recordId);
  assert.equal(row.decision, "human_review");
  assert.equal(row.externalRef, "ticket-proof-4", "no ticket, so the requester's own ref stands");

  // And the failure is neither hidden nor fatal: it is on the response AND in
  // the audit log, so a hand-off that did not happen is discoverable.
  assert.equal(res.body.ticketCreated, false);
  assert.match(res.body.ticketError, /ECONNREFUSED/);
  assert.match(res.body.ticketNote, /decision and its audit row ARE recorded/i);
  assert.ok(
    audit.entries.some((e) => e.action === "portal_ticket_creation_failed"),
    "the failed hand-off must be audited"
  );
});

test("with no Zendesk client configured at all, the decision still stands and the response says so", async () => {
  const res = await overCap(createPortalHandler({ remote, audit, stores, llm: FAKE_LLM }), "ticket-proof-5");
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "human_review");
  assert.equal(res.body.ticketCreated, false);
  assert.match(res.body.ticketNote, /ticket creation is not turned on/i);
});

// ---------------------------------------------------------------------------
// 3 — which decisions qualify, as a pure table
// ---------------------------------------------------------------------------

test("the ticket rule: auto-resolved and hard-blocked decisions raise nothing; everything else does", () => {
  assert.equal(needsTicket("uc02", "auto_approve"), false);
  assert.equal(needsTicket("uc02", "blocked"), false);
  assert.equal(needsTicket("uc02", "human_review"), true);
  assert.equal(needsTicket("uc02", "escalate"), true);

  assert.equal(needsTicket("uc03", "auto_resolve"), false);
  assert.equal(needsTicket("uc03", "route_to_uc04"), true);
  assert.equal(needsTicket("uc04", "blocked"), false);
  assert.equal(needsTicket("uc04", "ready_for_approval"), true);
  assert.equal(needsTicket("uc05", "prepared_for_signoff"), true);

  // FAILS TOWARD A HUMAN SEEING IT. A decision string added later is not in
  // any deny-list, so it raises a ticket rather than vanishing. An allow-list
  // would fail the other way, and a request that silently reaches nobody is
  // the exact failure this whole pass closes.
  assert.equal(needsTicket("uc02", "some_new_decision_added_later"), true);
});

test("UC-07 and UC-08 raise no ticket, because linking one would need a mutation method their stores must not have", async () => {
  assert.equal(needsTicket("uc07", "escalate"), false);
  assert.equal(needsTicket("uc08", "escalate"), false);
  assert.deepEqual([...TICKETABLE_TYPES].sort(), ["uc01", "uc02", "uc03", "uc04", "uc05", "uc09"]);

  // The structural fact the rule rests on, asserted rather than asserted-about:
  // neither dossier store has a linkTicket (or any other mutation).
  assert.equal(typeof stores.uc07.linkTicket, "undefined");
  assert.equal(typeof stores.uc08.linkTicket, "undefined");

  const zendesk = fakeZendesk();
  const res = await callApi(handlerWith(zendesk), {
    method: "POST",
    path: "/api/requests/uc08",
    body: {
      persona: "chris",
      text: "I spent 200 days in Portugal this year. Am I tax resident there?",
      targetCountry: "PT",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    },
  });
  assert.equal(res.body.ticketCreated, false);
  assert.deepEqual(zendesk.created, []);
  assert.match(res.body.ticketNote, /no execution path/i);
});

test("every ticket carries the shared marker, its use case, and an outcome tag", () => {
  assert.deepEqual(ticketTags("uc04", "ready_for_approval"), [MARKER_TAG, "uc04", "uc04_specialist_approval"]);
  // A decision with no named tag still gets one derived from the decision
  // itself — an untagged ticket is one no trigger can route.
  const derived = ticketTags("uc09", "multi_role_approval_required");
  assert.equal(derived[0], MARKER_TAG);
  assert.equal(derived[2], "uc09_multi_role_approval_required");
  // And the derived form can never smuggle characters a tag cannot hold.
  assert.match(ticketTags("uc09", "weird decision/with stuff")[2], /^uc09_[a-z0-9_]+$/i);
});

test("the deny-lists name only decisions, and every ticketable type has one", () => {
  for (const type of TICKETABLE_TYPES) {
    assert.ok(Array.isArray(NO_TICKET_DECISIONS[type]), `${type} needs a deny-list, even an empty one`);
  }
});

// ---------------------------------------------------------------------------
// 4 — the reference control: a repeat is refused as a DELIVERY, not by a gate
// ---------------------------------------------------------------------------

test("POSITIVE: a fresh reference is processed; the SAME one again is refused as an already-processed delivery", async () => {
  const zendesk = fakeZendesk();
  const { handler } = pooledHandler(zendesk);

  const first = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { persona: "emma", text: "Can I work from Spain for two weeks?", externalRef: "repeat-me-1" },
  });
  assert.equal(first.body.ok, true);
  assert.equal(first.body.duplicateDelivery, false, "a fresh reference is not a duplicate");
  assert.ok(first.body.recordId);

  const second = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { persona: "emma", text: "Can I work from Spain for two weeks?", externalRef: "repeat-me-1" },
  });

  // THE DISTINCTION THE TESTER MUST NOT HAVE TO GUESS AT.
  assert.equal(second.body.ok, true, "a refused redelivery is not an error");
  assert.equal(second.body.duplicateDelivery, true);
  assert.match(second.body.duplicateExplanation, /already been processed/i);
  assert.match(second.body.duplicateExplanation, /not a policy refusal/i);
  // rca-lapd (R7-12): this sentence is read by the employee it refused, not by
  // an engineer — "refused at the idempotency ledger's primary key" is a
  // database term dressed up as an answer to "did that work or not?".
  assert.doesNotMatch(
    second.body.duplicateExplanation,
    /idempotency ledger|primary key/i,
    "the employee-facing explanation must not use ledger/primary-key vocabulary"
  );
  assert.equal(second.body.duplicateOf, "repeat-me-1");
  // Nothing was written twice, and no second record exists.
  assert.equal(second.body.recordId, undefined);
});

test("a refused redelivery raises NO second ticket — that duplicate is what the ledger exists to prevent", async () => {
  const zendesk = fakeZendesk();
  const { handler } = pooledHandler(zendesk);

  // UC-03, not UC-02, and deliberately: UC-02 asks "have I decided this
  // EXPENSE before?" ahead of its gates, so re-submitting one expense would
  // stop at that record-level replay and never reach the ledger. Testing the
  // ledger requires a request whose only repeated thing is the REFERENCE.
  const body = { persona: "emma", text: "Please issue a formal travel support letter for my trip to Spain." };

  const first = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { ...body, externalRef: "repeat-ticket-1" },
  });
  assert.equal(first.body.ticketCreated, true, "fixture precondition: this decision needs a human");
  assert.equal(zendesk.created.length, 1, "the first delivery raises one");

  const second = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { ...body, externalRef: "repeat-ticket-1" },
  });
  assert.equal(second.body.duplicateDelivery, true);
  assert.equal(second.body.alreadyHandledKind, "delivery");
  assert.equal(zendesk.created.length, 1, "the redelivery must raise none");
  assert.equal(second.body.ticketCreated, false);
  assert.match(second.body.ticketNote, /already been handled/i);
});

test("re-submitting the same EXPENSE is a record-level replay, and is reported as a different thing", async () => {
  const { handler } = pooledHandler(fakeZendesk());

  const first = await overCap(handler, "replay-a");
  assert.equal(first.body.decision, "human_review");

  // A brand-new reference, so the ledger has no objection — and the request is
  // still not decided again, because UC-02 had already judged this expense.
  const again = await overCap(handler, "replay-b-different-ref");
  assert.equal(again.body.alreadyHandled, true);
  assert.equal(again.body.alreadyHandledKind, "record", "this is NOT the reference check");
  assert.equal(again.body.duplicateDelivery, false);
  assert.match(again.body.duplicateExplanation, /NOT the reference check/i);
  assert.match(again.body.duplicateExplanation, /policy refusal/i);
});

test("a DUPLICATE DELIVERY and a duplicate-receipt POLICY refusal are different facts, reported differently", async () => {
  const { handler } = pooledHandler(fakeZendesk());

  // (a) UC-02's §7 receipt gate: a real decision, by a gate, about the money.
  await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_clean_401", receiptHash: "same-receipt", externalRef: "policy-a" },
  });
  const policy = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc02",
    body: { persona: "chris", expenseId: "exp_sandbox_over_cap_402", receiptHash: "same-receipt", externalRef: "policy-b" },
  });
  assert.equal(policy.body.decision, "blocked");
  assert.equal(policy.body.reason, "duplicate_submission");
  // A gate decided this. It is NOT a delivery refusal.
  assert.equal(policy.body.duplicateDelivery, false);
  assert.ok(policy.body.recordId, "a policy refusal still records a decision");

  // (b) The exactly-once ledger, on a request whose only repeated thing is the
  // reference. No gate ran at all this time.
  const travel = { persona: "emma", text: "Please issue a formal travel support letter for Spain." };
  await callApi(handler, { method: "POST", path: "/api/requests/uc03", body: { ...travel, externalRef: "same-ref" } });
  const delivery = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { ...travel, externalRef: "same-ref" },
  });
  assert.equal(delivery.body.duplicateDelivery, true);
  assert.equal(delivery.body.alreadyHandledKind, "delivery");
  assert.equal(delivery.body.recordId, undefined, "nothing was decided or written the second time");

  // The three are mutually exclusive, which is the whole point.
  assert.notEqual(policy.body.alreadyHandled, true);
  assert.equal(delivery.body.decision !== "blocked" || delivery.body.reason !== "duplicate_submission", true);
});

test("an in-memory run SAYS a repeat went undetected, instead of looking like a broken check", async () => {
  // No pool: claimExternalRef() has no ledger and proceeds, by design.
  const handler = handlerWith(fakeZendesk());
  const travel = { persona: "emma", text: "Please issue a formal travel support letter for Spain." };

  const first = await callApi(handler, { method: "POST", path: "/api/requests/uc03", body: { ...travel, externalRef: "blind-1" } });
  assert.notEqual(first.body.ledgerUndetected, true);

  const second = await callApi(handler, { method: "POST", path: "/api/requests/uc03", body: { ...travel, externalRef: "blind-1" } });
  assert.equal(second.body.duplicateDelivery, false, "with no ledger there is nothing to refuse it");
  assert.equal(second.body.ledgerUndetected, true);
  assert.match(second.body.ledgerUndetectedExplanation, /no durable idempotency ledger/i);
});

// ---------------------------------------------------------------------------
// 5 — the browser half: the control exists, polls, and decides nothing
// ---------------------------------------------------------------------------

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../src/portal/assets/index.html", import.meta.url), "utf8");

test("the page offers both reference behaviours, and generates a unique one per submission", () => {
  assert.match(APP, /Generate a new reference/);
  assert.match(APP, /Reuse a reference/);
  // Uniqueness must not rest on the clock alone: two clicks inside one
  // millisecond would collide and look exactly like the duplicate-delivery
  // refusal the control exists to demonstrate.
  assert.match(APP, /refCounter \+= 1/);
  // Every builder sends the resolved reference, not the raw box.
  assert.equal((APP.match(/externalRef: reference\("uc0\d"\)/g) || []).length, 7);
  assert.doesNotMatch(APP, /externalRef: orNull\(/);
});

test("the status view polls, and the page says plainly that it is polling rather than a push", () => {
  assert.match(APP, /var POLL_MS = \d+/);
  assert.match(APP, /setInterval\(/);
  // A visible control, and a stop when the panel is not on screen.
  assert.match(APP, /my-requests-live/);
  assert.match(APP, /function stopPolling/);
  assert.match(INDEX, /not a live push/i);
});

test("no claim logic was re-implemented in the browser, and the page still decides nothing", () => {
  // The workflows claim; this file only chooses which reference to send.
  //
  // Checked against the CODE, not the prose: app.js's comments name
  // claimExternalRef and workflow_claims because they are explaining them, and
  // forbidding the nouns would push the explanation out of the file that most
  // needs it. Comments are stripped first — the same technique
  // test/uc08.test.js uses for its no-write-path structural check.
  const code = APP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /claimExternalRef/);
  assert.doesNotMatch(code, /workflow_claims/);
  assert.doesNotMatch(code, /insert into/i);
  // And the standing rules for this asset hold — again against the stripped
  // code, because the file's own header explains that it never writes markup.
  assert.doesNotMatch(code, /innerHTML/);
});

// ---------------------------------------------------------------------------
// 6 — the reference is SAYS WHAT IT IS, and survives being shown
// ---------------------------------------------------------------------------
//
// The reference is the one id a requester is ever handed, and the only string
// that ties their request's records together — the claim in the exactly-once
// ledger, the decision, the audit trail. The page displayed it and said only
// what it does NEXT (reuse it to see a duplicate refused). A capability nobody
// can find is, for the person in front of it, a capability that does not exist.

test("the page says what the reference IS — once, where it is looked for", () => {
  // THIS TEST USED TO REQUIRE THE OPPOSITE, and the correction is the
  // interesting part. It pinned two sentences INSIDE referenceLine(): "the id
  // that ties every record of this request together; quote it to have this
  // request traced", and "Switch this form to 'Reuse a reference' and submit
  // again to see it refused as an already-processed delivery."
  //
  // The concern behind it stands and is not being weakened: a capability
  // nobody can find is, for the person in front of it, a capability that does
  // not exist. What was wrong was the PLACE. referenceLine() renders under the
  // outcome of every decision, of every request type, every time — so a demo
  // instruction there is printed forever at people who are reading a decision,
  // and the first sentence had by then become self-evident (a copyable chip
  // labelled "Reference sent"). It was also, when written, a promise the code
  // did not keep; d9f1850 made it true, which is what let it become redundant.
  //
  // So the explanation moved to the two surfaces somebody consults ON PURPOSE,
  // and this test now checks it is on both — that is the real guard against
  // the capability disappearing.
  const start = APP.indexOf("function referenceLine(");
  assert.ok(start > 0, "referenceLine must still be the one place the reference is reported");
  const fn = APP.slice(start, APP.indexOf("\n  }", start));
  assert.match(fn, /Reference sent/, "the reference must still be labelled where it is shown");
  assert.match(fn, /tag-chip/, "and still rendered as something a reader can copy");
  assert.doesNotMatch(fn, /ties every record/, "the explanation belongs beside the control, not on every decision");
  assert.doesNotMatch(fn, /already-processed delivery/, "a demo instruction must not ride on every decision");

  // 1. The control that generates it, above the form, before anything is sent.
  const control = APP.slice(APP.indexOf("function upgradeReferenceFields("), APP.indexOf("function freshCopyOf("));
  assert.match(control, /An id for this one submission/, "the reference control no longer says what it is");
  assert.match(control, /Reuse a reference/, "how to see the duplicate refused must live beside the control that does it");
  assert.match(control, /turned away/, "and what happens on a repeat must still be stated");

  // 2. The column in "My requests" that lists them.
  const cell = APP.slice(APP.indexOf("function referenceCell("), APP.indexOf("function idCell("));
  assert.match(cell, /ties every record of this request together/, "the one lasting explanation must not go too");
});

test("the result head names what was created without printing an id nobody can use", () => {
  // It read `UC-05 · Resignation record 68fc6e99…`. The elision is the tell:
  // a truncated id cannot be copied or quoted, and it sat directly above the
  // reference — which is the id that can be. One usable id per outcome.
  // Comments stripped first: the one above this line in app.js quotes the very
  // call being banned, in order to record why it went.
  const head = APP.slice(APP.indexOf("var head = el(\"div\", \"result-head\")"), APP.indexOf("wrap.appendChild(head)")).replace(
    /^\s*\/\/.*$/gm,
    ""
  );
  assert.match(head, /payload\.recordLabel/, "the outcome must still say what kind of record was created");
  assert.doesNotMatch(head, /shortId\(payload\.recordId\)/, "an elided record id cannot be copied, and the reference is right below it");
});

test("the reference in “My requests” is shown WHOLE — a truncated one cannot be quoted", () => {
  // idCell() elides anything past 12 characters. A portal reference is ~26
  // (`uc02-20260819104528-11aomw`), so every one of them rendered as
  // `uc02-202…` in the single place a requester goes to look theirs up.
  assert.match(APP, /tr\.appendChild\(referenceCell\(request\.externalRef\)\)/);
  assert.doesNotMatch(APP, /idCell\(request\.externalRef\)/);

  const cell = APP.slice(APP.indexOf("function referenceCell("), APP.indexOf("function idCell("));
  assert.doesNotMatch(cell, /shortId/, "the reference must not be shortened");
  assert.match(cell, /ties every record of this request together/, "and it must say what it is for");

  // The column header explains it once, where the table does. Match against
  // whitespace-collapsed HTML — in rendered output a newline IS a space, so
  // this prose assertion must not be sensitive to source line-wrapping.
  assert.match(INDEX.replace(/\s+/g, " "), /the id that ties every record of a request together/);
});
