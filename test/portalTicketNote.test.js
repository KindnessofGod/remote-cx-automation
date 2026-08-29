// ---------------------------------------------------------------------------
// portalTicketNote.test.js  —  the two texts a person actually reads after a
//                              decision, and the shape of each
// ---------------------------------------------------------------------------
// WHAT WENT WRONG
//
// Two surfaces, one complaint each, both from the project owner reading the
// real thing rather than the code.
//
// 1. THE SETTLED DECISION. A specialist approved a work-authorization request
//    and the message afterwards read, in one paragraph:
//
//      "Already APPROVED by b.person@gmail.com on Wed Aug 19 2026 22:25:07
//       GMT+0000 (Coordinated Universal Time). The decision was NOT sent to
//       Remote — No Remote work-authorization request is linked to this
//       decision, so no PATCH was made. A request is raised by the employee
//       inside Remote's own Request Hub; there is no API that creates one, and
//       nothing here fabricates an id.. The approval is real and recorded; the
//       Remote request it would have updated does not exist. Note left: "k". An
//       approved authorization cannot be approved or declined again."
//
//    The reply was: "please explain to me why all this story". Five separate
//    facts — who, when, their note, that Remote holds nothing, and that the
//    decision is final — run together, with a raw `Date` object in the middle
//    (that is what `pg` hands back for a `timestamptz`) and a doubled full stop
//    where a durable field already ending in one met a template that added
//    another.
//
// 2. THE ZENDESK INTERNAL NOTE. It rendered as plain text with ASCII rules
//    (`--- routing ---`) standing in for headings, and it opened with a 403
//    about `GET /api/v2/groups` — an operator's problem, at the top of a note a
//    SPECIALIST reads — plus "Narrative faithfulness: not_evaluated", which is
//    this system's own quality telemetry and means nothing to the person
//    deciding whether somebody may work from Spain. "why is it always ugly, not
//    well formatted and look that way, is that all zendesk looks like, or you
//    just used the bare minimum". It was the bare minimum: a Zendesk internal
//    note accepts HTML, which CLAUDE.md §4 records explicitly.
//
// WHY THESE TESTS PIN PROPERTIES AND NOT STRINGS
//
// Same reasoning as test/portalCopy.test.js, and the same technique: copy gets
// rewritten, and a test that pins a sentence makes the next rewrite harder while
// proving nothing about the one after it. What must not come back is the SHAPE
// — five facts in one run-on, a machine timestamp, a doubled stop, an operator's
// 403 above the decision, telemetry in a specialist's face. So the assertions
// below are structural: a fact per labelled field, an ordering, an escaping
// rule, and a budget.
//
// HONEST IS NOT THE SAME AS VERBOSE. Section 3 asserts that the load-bearing
// admissions — that the approval is real while the Remote request is not, that a
// cumulative day count with no history behind it is a floor rather than a
// measurement — are still there, word for word. Nothing was shortened by
// dropping what the system cannot claim.
//
// HERMETIC: every LLM seam is faked with the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom, the mock Remote
// is dispatched in-process, and Zendesk is a capture object. No socket is bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";
import { describeSettled, settledFacts } from "../src/uc04/approvalPolicy.js";
import { humanTime } from "../src/shared/settledDecision.js";
import { submitWorkationApproval } from "../src/uc04/workflow.js";

const unconfigured = { isConfigured: () => false };

/** A Zendesk that records what it was asked to create, and reads no groups. */
function capturingZendesk({ groupsReadable = false } = {}) {
  const created = [];
  return {
    created,
    async listGroups() {
      if (groupsReadable) return [{ id: 77, name: "Mobility Specialists" }];
      // The real failure this stands for, verbatim from the live account: the
      // shared client holds the least privilege its ticket path needs.
      throw new Error("403 Forbidden: You are missing the following required scopes: groups:read, read");
    },
    async createTicket(fields) {
      created.push(fields);
      return { id: 4242, ...fields };
    },
    async updateTicket(id, patch) {
      return { ticket: { id, ...patch } };
    },
  };
}

function portal(zendesk) {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores: buildPortalStores(),
    zendesk,
    llm: { draftSummary: (a) => draftSummary(a, unconfigured), judge: (a) => judgeNarrative(a, unconfigured) },
  });
}

function call(handler, { method = "POST", path, body = null }) {
  return new Promise((resolve) => {
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
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res);
  });
}

/** Anna Müller — DE, employee, active. Two weeks in Spain: a routine review. */
const TRIP = {
  persona: "admin",
  employmentId: "09b65526-643b-4956-959b-916e6429bd23",
  homeCountry: "DE",
  nationality: "DE",
  destinationCountry: "ES",
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  reasonText: "Two weeks with the Madrid team.",
  now: "2026-08-15",
};

async function noteFor(overrides = {}, zendeskOpts = {}) {
  const zendesk = capturingZendesk(zendeskOpts);
  const res = await call(portal(zendesk), {
    path: "/api/requests/uc04",
    body: { ...TRIP, externalRef: `note-${Math.random().toString(36).slice(2)}`, ...overrides },
  });
  assert.equal(res.body.ticketCreated, true, `fixture precondition: this decision must raise a ticket (${res.body.decision})`);
  return { note: zendesk.created[0].comment.html_body, comment: zendesk.created[0].comment, res };
}

// ---------------------------------------------------------------------------
// 1 — the settled decision: fields, not a paragraph
// ---------------------------------------------------------------------------

/** The row the owner's own approval produced: a `pg` Date, a note, nothing sent. */
const APPROVED_ROW = {
  decision: "ready_for_approval",
  status: "executed",
  approver: "b.person@example.com",
  approvedAt: new Date("2026-08-19T22:25:07Z"),
  approvalNote: "k",
  remoteResult: {
    transmitted: false,
    reason: "no_remote_work_authorization_request",
    // WITH the trailing full stop a durable row written before this pass still
    // carries — which is what produced the doubled stop the owner read.
    detail: "no work-authorisation request is linked to it.",
  },
};

test("a settled approval is FIELDS: one fact per labelled line, and none of them twice", () => {
  const settled = settledFacts(APPROVED_ROW);
  const labels = settled.facts.map((f) => f.label);

  assert.equal(settled.headline, "Approved.", "which of the two outcomes, first and alone");
  assert.deepEqual(new Set(labels).size, labels.length, "no fact may be published under two labels");
  for (const wanted of ["Approved by", "Approved on", "Note left", "Sent to Remote"]) {
    assert.ok(labels.includes(wanted), `${wanted} must be its own field, not a clause: ${labels.join(" / ")}`);
  }
  // Finality is a STATE of the decision, not a sentence to re-read inside it.
  assert.ok(!labels.some((l) => /again|final/i.test(l)));
  assert.match(settled.finality, /cannot be approved or declined again/);

  // And each field holds ONE fact: no field smuggles a second label back in.
  for (const fact of settled.facts) {
    assert.ok(
      !/\b(Approved by|Approved on|Note left|Sent to Remote):/.test(fact.value),
      `"${fact.label}" carries another labelled fact inside it: ${fact.value}`
    );
  }
});

test("the timestamp is written for a person — no weekday, no GMT offset, no timezone name", () => {
  const text = describeSettled(APPROVED_ROW);
  // The exact string the owner read, and the two shapes it comes in.
  assert.doesNotMatch(text, /GMT[+-]\d{4}/, "a raw Date.toString() offset");
  assert.doesNotMatch(text, /Coordinated Universal Time/, "the timezone NAME nobody asked for");
  assert.doesNotMatch(text, /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/, "a weekday nobody asked for");
  assert.match(text, /^Approved on: 19 Aug 2026 at 22:25 UTC$/m);

  // AND THE TWO SOURCES AGREE. `pg` returns a Date for a timestamptz while an
  // in-memory row holds an ISO string; the same decision must read identically
  // whichever store answered.
  assert.equal(humanTime(new Date("2026-08-19T22:25:07Z")), humanTime("2026-08-19T22:25:07Z"));
});

test("no doubled punctuation, whatever the durable field it was joined to already carried", () => {
  const text = describeSettled(APPROVED_ROW);
  assert.doesNotMatch(text, /[.;,]\s*[.;,]/, `doubled punctuation survived: ${text}`);
});

test("a declined decision names who, when and the reason — and says so when no reason was left", () => {
  const settled = settledFacts({ status: "declined", declinedBy: { approver: "Ana", at: "2026-08-19T06:00:00Z", note: null } });
  assert.equal(settled.headline, "Declined.");
  const byLabel = Object.fromEntries(settled.facts.map((f) => [f.label, f.value]));
  assert.equal(byLabel["Declined by"], "Ana");
  assert.equal(byLabel["Declined on"], "19 Aug 2026 at 06:00 UTC");
  // A decline is SUPPOSED to carry a reason, so silence is reported as a
  // finding rather than left as a blank the reader has to notice.
  assert.match(byLabel["Reason given"], /supposed to carry/);
});

test("a row whose outcome cannot be read publishes no fields, rather than inventing some", () => {
  // The honest "we cannot say" fallback. Guessing a verdict here would be
  // strictly worse than the generic sentence.
  assert.equal(settledFacts({ status: "executing" }), null);
  assert.match(describeSettled({ status: "executing" }), /already been approved or declined/);
});

// ---------------------------------------------------------------------------
// 2 — the Zendesk internal note: a document, not a wall
// ---------------------------------------------------------------------------

test("the note is HTML, sent as html_body, and carries no ASCII section rules", async () => {
  const { note, comment } = await noteFor();

  // `html_body`, never `body`. CLAUDE.md §4: a PUBLIC reply is the one that
  // silently escapes HTML; an internal note is the documented "(Accepts HTML)"
  // side. Sending both would let a client pick the wrong one.
  assert.equal(comment.body, undefined);
  assert.equal(comment.public, false, "an intake note is never a public reply");

  assert.match(note, /<h2[^>]*>/, "real headings");
  assert.match(note, /<table>/, "the facts are a table, not aligned text");
  assert.doesNotMatch(note, /---\s*\w+\s*---/, "ASCII rules standing in for headings");
});

test("the specialist's answer comes first; the operators' machinery comes last", async () => {
  const { note } = await noteFor();

  const opsAt = note.indexOf("For operators");
  assert.ok(opsAt > 0, "the operators' section must exist rather than the machinery being deleted");

  // What a human must do, and what actually happened, are above the fold.
  for (const early of ["What a human controls here", "What happened", "The decision so far"]) {
    const at = note.indexOf(early);
    assert.ok(at > 0 && at < opsAt, `"${early}" must sit above the operators' section`);
  }

  // THE 403 THE OWNER SCREENSHOTTED. It used to be the third line of a note a
  // SPECIALIST reads. It is kept — a tagged-but-unassigned escalation is a real
  // failure and hiding it would be worse — and it is kept BELOW.
  // ABSENT IS ALSO CORRECT, and it became the ordinary case on 2026-08-20.
  // This asserted the 403 was PRESENT and low, because every fallback then
  // failed: the two teams the routing table named had no group in the account,
  // so a live lookup that could not run had no synced id to fall back to
  // either. Both groups now exist and `npm run sync-groups` has recorded their
  // ids, so an unreadable API is no longer a stranded ticket — it resolves
  // from the synced map and reports no failure at all. The rule being pinned
  // is about PLACEMENT, not about the error existing: if it is reported, it
  // belongs to operators. Same shape as the telemetry assertion below.
  const scopeError = note.indexOf("groups:read");
  assert.ok(scopeError === -1 || scopeError > opsAt, "the API scope failure belongs to operators, not to the specialist");

  // Same for this system's own quality telemetry.
  const telemetry = note.indexOf("Narrative faithfulness");
  assert.ok(telemetry === -1 || telemetry > opsAt, "narrative faithfulness is telemetry, not a specialist's fact");
});

test("an assigned ticket says so plainly, and where the group id came from", async () => {
  const { note } = await noteFor({}, { groupsReadable: true });
  assert.match(note, /assigned to Zendesk group 77/);
  assert.match(note, /read live from the account/);
  assert.doesNotMatch(note, /groups:read/, "there was no scope failure, so nothing may report one");
});

test("every value the gates reported still reaches the note — the split drops nothing", async () => {
  const { note, res } = await noteFor();
  for (const detail of res.body.details ?? []) {
    // Escaped as it will be in the markup, so a value containing & or a quote
    // is still found rather than silently counted as missing.
    const needle = String(detail.value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    assert.ok(note.includes(needle), `"${detail.label}" was dropped from the hand-off`);
  }
});

test("every interpolated value is escaped — a note carries text a person typed", async () => {
  // UC-04's inputs are all pickers and dates, so this is proved on the use case
  // whose intake really is free text: an off-cycle payment request, typed by a
  // person, echoed back into the note. Same builder, same escaping.
  const zendesk = capturingZendesk();
  const res = await call(portal(zendesk), {
    path: "/api/requests/uc09",
    body: {
      persona: "admin",
      employmentId: "09b65526-643b-4956-959b-916e6429bd23",
      requestText: 'Bonus of 500 EUR <script>alert("x")</script> & <b>bold</b>',
      externalRef: "note-escaping-1",
    },
  });
  assert.equal(res.body.ticketCreated, true, `fixture precondition (${res.body.decision})`);
  const note = zendesk.created[0].comment.html_body;

  assert.ok(!/<script/i.test(note), "markup a requester typed must never become markup here");
  assert.match(note, /&lt;script&gt;/);
  assert.match(note, /&amp;/);
  // And the tags a person typed are inert, not just absent: the escaped form is
  // what proves the value arrived rather than being silently dropped.
  assert.match(note, /&lt;b&gt;bold&lt;\/b&gt;/);
});

// ---------------------------------------------------------------------------
// 3 — the honesty statements, which no rewrite may shorten away
// ---------------------------------------------------------------------------

test("the load-bearing admissions survive both rewrites, word for word", async () => {
  // A human said yes and Remote holds nothing. These are DIFFERENT FACTS, and
  // conflating them is how "approved" comes to mean two things.
  assert.match(
    describeSettled(APPROVED_ROW),
    /The approval is real and recorded; the Remote request it would have updated does not exist\./
  );

  // A day count with no travel history behind it is a FLOOR, not a measurement.
  const { note } = await noteFor();
  assert.match(note, /this is a floor, not a count/);
  // And the ticket is a record of a decision already taken, not the decision.
  assert.match(note, /already recorded and audited before this ticket existed/);
});

// ---------------------------------------------------------------------------
// 4 — the portal's own table: each fact in exactly one place
// ---------------------------------------------------------------------------

test("the requester's row does not print who/when/note twice — the columns already carry them", async () => {
  // The listing has its own Decided-by, Decided-at and Note columns, read off
  // the same row. Repeating them inside the resolution cell is the repetition
  // that turned a decision into a story.
  //
  // The approval is taken through UC-04's own workflow rather than through the
  // portal, because THE PORTAL HAS NO APPROVE ROUTE — it is an intake surface
  // and test/portal.test.js pins that it stays one. The store is shared, which
  // is what makes this the same row.
  const stores = buildPortalStores();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const audit = new AuditLogger();
  const handler = createPortalHandler({
    remote,
    audit,
    stores,
    zendesk: capturingZendesk(),
    llm: { draftSummary: (a) => draftSummary(a, unconfigured), judge: (a) => judgeNarrative(a, unconfigured) },
  });

  const submitted = await call(handler, {
    path: "/api/requests/uc04",
    body: { ...TRIP, externalRef: "portal-dedup-1" },
  });
  assert.equal(submitted.body.ok, true, JSON.stringify(submitted.body));
  assert.equal(submitted.body.decision, "ready_for_approval");

  const approved = await submitWorkationApproval(
    { authorizationId: submitted.body.recordId, action: "approve", approver: "mobility_sam", note: "k" },
    { remote, audit, authorizationStore: stores.uc04 }
  );
  assert.equal(approved.ok, true, approved.reason);

  const mine = await call(handler, { method: "GET", path: "/api/my-requests?persona=admin" });
  const row = (mine.body.requests ?? []).find((r) => r.recordId === submitted.body.recordId);
  assert.ok(row, "the admin filed it, so the admin sees it");
  assert.ok(row.resolutionFacts, "a settled row publishes fields, not only a sentence");

  const shown = [row.status.decidedBy, humanTime(row.status.decidedAt), row.status.note].filter(Boolean);
  for (const fact of row.resolutionFacts.facts) {
    assert.ok(
      !shown.includes(fact.value),
      `"${fact.label}" repeats a value the table already has its own column for: ${fact.value}`
    );
  }
  // What the columns CANNOT say is still said: whether Remote was updated.
  assert.ok(row.resolutionFacts.facts.some((f) => f.label === "Sent to Remote"));
});
