// ---------------------------------------------------------------------------
// handoffDirections.test.js
//
// WHAT THESE PIN, and why each one exists rather than being a restatement of
// the code:
//
//  1. THE FOUR STATES READ DIFFERENTLY. Not "each returns a string" — that a
//     tired specialist could tell them apart. The two absences are the pair
//     that matters: `none_by_design` and `none_missing` produce the same
//     absence of buttons and opposite facts, and the whole point of
//     approvalRoutes.js keeping two words is lost if the prose says one thing.
//  2. NO VERB IS INVENTED. Every word offered as an option is a token the use
//     case's own policy module accepts. UC-05 signs off, UC-09 denies; a note
//     that said "approve or deny" on either would send somebody hunting for a
//     button that is not on their screen.
//  3. NO SECOND OPINION IS FORMED. The module must read `{actionable,
//     actionableReason}` and never compute one — asserted by source inspection
//     as well as behaviour, because a behavioural test cannot see a branch that
//     only fires on inputs it did not think of.
//  4. THE NOTE STAYS INTERNAL. This module composes a fragment and never a
//     Zendesk comment object, so `public: false` cannot be lost inside it. That
//     is a structural claim (no `public` key exists here at all) and it is
//     tested as one — CLAUDE.md §4 records what the other shape cost.
//  5. ONE SOURCE, NOT NINE. The rendered sentences must move when the row
//     moves, so the surface, endpoint and verbs are asserted to come off the
//     table rather than to match a hard-coded expectation.
//
// `none_missing` IS EXERCISED THROUGH `directionsForRoute()` WITH A ROW, NOT
// THROUGH A USE CASE. No use case is in that state today — UC-03 left it on
// 2026-08-20 when its sign-off surface was built — and a test keyed on a use
// case id would have silently stopped covering the branch that morning.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  handoffDirections,
  directionsForRoute,
} from "../src/approvalqueue/handoffDirections.js";
import { APPROVAL_ROUTES } from "../src/approvalqueue/approvalRoutes.js";
import { escalationTeamFor } from "../src/shared/escalationRouting.js";

const SOURCE = readFileSync(new URL("../src/approvalqueue/handoffDirections.js", import.meta.url), "utf8");

/**
 * The module's CODE with its comments and its string/template literals removed.
 *
 * Needed because this module's whole output is prose: the sentence "record a
 * decision on it" contains the word "decision", and a naive scan for that word
 * cannot tell a sentence a specialist reads from a field this module must never
 * consult. Stripping the literals leaves only what the code actually touches.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/** A row in a state no use case currently holds, so the branch stays covered. */
const NONE_MISSING_ROW = Object.freeze({
  useCase: "UC-XX",
  tier: "low",
  control: "none_missing",
  surface: null,
  endpoint: null,
  hasPostRoute: false,
  roles: [],
  slotsRequired: null,
  verbs: [],
  note: "An artifact is drafted, stored and queued — and nothing anywhere can release it.",
});

// ---------------------------------------------------------------------------
// 1. Every use case gets all three sentences, and they are not empty
// ---------------------------------------------------------------------------

test("every use case is told where to act, what the verbs are, and what it cannot do", () => {
  for (const useCase of Object.keys(APPROVAL_ROUTES)) {
    const d = handoffDirections({ useCase });
    assert.equal(d.lines.length, 3, useCase);
    assert.ok(d.where.startsWith("Where to act:"), useCase);
    assert.ok(d.options.startsWith("Your options:"), useCase);
    assert.ok(d.limits.startsWith("What you cannot do here:"), useCase);
    for (const line of d.lines) assert.ok(line.length > 60, `${useCase}: ${line}`);
  }
});

test("an unknown use case says it cannot answer instead of guessing a surface", () => {
  const d = handoffDirections({ useCase: "UC-42" });
  assert.equal(d.control, "unknown");
  assert.equal(d.endpoint, null);
  assert.deepEqual(d.verbs, []);
  assert.match(d.where, /not answerable/i);
  // The failure this prevents: a plausible default sends a real person to a
  // real screen that does not decide this.
  assert.ok(!/sidebar/i.test(d.options), "no surface may be invented for an unknown use case");
});

// ---------------------------------------------------------------------------
// 2. The four states read differently — the point of the whole module
// ---------------------------------------------------------------------------

test("the four states produce four different texts", () => {
  const open = handoffDirections({ useCase: "UC-04", actionable: true });
  const closed = handoffDirections({
    useCase: "UC-04",
    actionable: false,
    actionableReason: "This authorization was already decided.",
  });
  const byDesign = handoffDirections({ useCase: "UC-07" });
  const missing = directionsForRoute({ useCase: "UC-XX", route: NONE_MISSING_ROW, team: "Some Team" });

  const texts = [open.text, closed.text, byDesign.text, missing.text];
  assert.equal(new Set(texts).size, 4, "four states, four texts");
});

test("none_by_design and none_missing say opposite things in words, not only in a code", () => {
  const byDesign = handoffDirections({ useCase: "UC-07" });
  const missing = directionsForRoute({ useCase: "UC-XX", route: NONE_MISSING_ROW, team: "Some Team" });

  assert.equal(byDesign.control, "none_by_design");
  assert.equal(missing.control, "none_missing");

  // The 🔴 refusal says the absence is correct and permanent.
  assert.match(byDesign.where, /that is the design/i);
  assert.match(byDesign.options, /not permitted/i);
  assert.ok(!/gap/i.test(byDesign.text), "a deliberate refusal must never be described as a gap");

  // The hole says the opposite, in words, up front.
  assert.match(missing.where, /gap rather than a rule/i);
  assert.match(missing.limits, /NOT the deliberate refusal/);
  assert.ok(
    !/that is the design/i.test(missing.text),
    "a missing surface must never be described as deliberate"
  );
});

test("a surface that exists but is closed still names the surface, and withholds the verbs", () => {
  const closed = handoffDirections({
    useCase: "UC-06",
    actionable: false,
    actionableReason: "This amendment is past its payroll cutoff.",
  });
  // Named, because the reader must know the panel is real and where it is.
  assert.match(closed.where, /UC-06 panel/);
  assert.match(closed.where, /POST \/uc06\/api\/amendments/);
  // Withheld, because listing buttons on a shut panel sends somebody to be
  // refused, and a correct refusal then reads as a broken screen.
  assert.ok(!/approve/i.test(closed.options), closed.options);
  // The server's own words, quoted, not paraphrased.
  assert.match(closed.limits, /This amendment is past its payroll cutoff\./);
  assert.equal(closed.open, false);
});

test("a closed case with no stated reason says so rather than inventing one", () => {
  const d = handoffDirections({ useCase: "UC-06", actionable: false });
  assert.match(d.limits, /No reason was supplied/);
});

test("an omitted verdict is not the same as a refusal", () => {
  const unknown = handoffDirections({ useCase: "UC-04" });
  const refused = handoffDirections({ useCase: "UC-04", actionable: false });
  assert.equal(unknown.open, null);
  assert.equal(refused.open, false);
  assert.match(unknown.limits, /has not re-checked it/);
  assert.notEqual(unknown.text, refused.text);
});

// ---------------------------------------------------------------------------
// 3. No verb is invented — every offered word is a token the endpoint accepts
// ---------------------------------------------------------------------------

test("the option set is each use case's own verbs, and three rows are not approve/decline", () => {
  assert.deepEqual(APPROVAL_ROUTES["UC-05"].verbs, ["signoff", "decline"]);
  assert.deepEqual(APPROVAL_ROUTES["UC-09"].verbs, ["approve", "deny"]);
  assert.deepEqual(APPROVAL_ROUTES["UC-02"].verbs, ["approve", "decline", "hold"]);

  assert.match(handoffDirections({ useCase: "UC-05" }).options, /sign off or decline/);
  assert.match(handoffDirections({ useCase: "UC-09" }).options, /approve or deny/);
  assert.match(handoffDirections({ useCase: "UC-02" }).options, /approve, decline or hold/);

  // The failure mode this closes: offering the wrong word.
  assert.ok(!/\bdeny\b/.test(handoffDirections({ useCase: "UC-05" }).options));
  assert.ok(!/\bdecline\b/.test(handoffDirections({ useCase: "UC-09" }).options));
});

test("a use case with a control offers no verb it does not have", () => {
  for (const [useCase, route] of Object.entries(APPROVAL_ROUTES)) {
    if (route.control !== "exists") continue;
    const options = handoffDirections({ useCase }).options;
    for (const word of ["approve", "decline", "deny", "hold", "sign off"]) {
      const token = word === "sign off" ? "signoff" : word;
      if (route.verbs.includes(token)) continue;
      assert.ok(
        !new RegExp(`\\b${word}\\b`).test(options),
        `${useCase} offers "${word}" and its endpoint does not accept it`
      );
    }
  }
});

test("every row with a control carries verbs, and every row without one carries none", () => {
  for (const [useCase, route] of Object.entries(APPROVAL_ROUTES)) {
    if (route.control === "exists") {
      assert.ok(route.verbs.length > 0, `${useCase} claims a control and lists no verb`);
      assert.equal(route.hasPostRoute, true, useCase);
    } else {
      assert.deepEqual(route.verbs, [], `${useCase} has no control and must offer no verb`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Slots: the floor is the number, the roles are the pool
// ---------------------------------------------------------------------------

test("UC-09's three roles behind a floor of two are not read as three signatures", () => {
  const d = handoffDirections({ useCase: "UC-09", actionable: true });
  assert.match(d.options, /At least 2 signatures/);
  assert.ok(!/3 signatures/.test(d.options), d.options);
  assert.match(d.limits, /a different person/);
});

test("a two-slot use case says you cannot finish it alone", () => {
  assert.match(handoffDirections({ useCase: "UC-06" }).limits, /finish this alone/);
  assert.ok(!/finish this alone/.test(handoffDirections({ useCase: "UC-04" }).limits));
});

test("a use case that names no role says nothing checks your entitlement", () => {
  const d = handoffDirections({ useCase: "UC-02" });
  assert.deepEqual(APPROVAL_ROUTES["UC-02"].roles, []);
  assert.match(d.limits, /names no role/);
});

// ---------------------------------------------------------------------------
// 5. One source, not nine
// ---------------------------------------------------------------------------

test("the surface, endpoint and team are printed from the tables, never restated", () => {
  for (const [useCase, route] of Object.entries(APPROVAL_ROUTES)) {
    const d = handoffDirections({ useCase });
    if (route.control === "exists") {
      assert.ok(d.where.includes(route.surface), useCase);
      assert.ok(d.where.includes(route.endpoint), useCase);
      assert.equal(d.endpoint, route.endpoint, useCase);
    } else {
      const team = escalationTeamFor(useCase);
      assert.ok(d.where.includes(team), `${useCase} must name ${team} from the routing table`);
    }
  }
});

test("the module writes no use-case-specific prose", () => {
  // The drift this prevents: a tenth copy of a sentence, written here, that
  // stops agreeing with the row it was copied from. Nine `if (useCase === …)`
  // branches is exactly how the routing table came to contradict itself.
  const body = codeOnly(SOURCE);
  assert.ok(!/UC-0\d/.test(body), "no use case may be named in this module's code");
});

// ---------------------------------------------------------------------------
// 6. It reads a verdict; it never forms one
// ---------------------------------------------------------------------------

test("no policy is re-derived: the module inspects no status, decision or approver", () => {
  const body = codeOnly(SOURCE);
  for (const forbidden of ["status", "decision", "approver", "escalated", "pending_", "review_queue"]) {
    assert.ok(
      !body.includes(forbidden),
      `handoffDirections must not consult "${forbidden}" — actionability is the API's verdict, not this note's`
    );
  }
});

test("the verdict is echoed exactly as given, never recomputed", () => {
  assert.equal(handoffDirections({ useCase: "UC-04", actionable: true }).open, true);
  assert.equal(handoffDirections({ useCase: "UC-04", actionable: false }).open, false);
  assert.equal(handoffDirections({ useCase: "UC-04" }).open, null);
});

// ---------------------------------------------------------------------------
// 7. The note is internal, and it cannot lose that
// ---------------------------------------------------------------------------

test("this module composes a fragment and never a Zendesk comment object", () => {
  // CLAUDE.md §4: a hand-written comment payload is how `public: false` gets
  // dropped and internal analysis reaches a customer. There is no comment
  // object here to drop it from — the caller builds one and its own test sees
  // the flag.
  const body = codeOnly(SOURCE);
  assert.ok(!body.includes("public"), "no comment object may be built in this module");
  assert.ok(!body.includes("html_body"), "no comment payload may be built in this module");
  assert.ok(!body.includes("createTicket") && !body.includes("updateTicket"));
  // And nothing here is fit for a customer: it names endpoints and internal gaps.
  assert.match(handoffDirections({ useCase: "UC-04" }).where, /POST \//);
});

test("every interpolated value in the HTML fragment is escaped", () => {
  const d = directionsForRoute({
    useCase: "UC-XX",
    route: { ...NONE_MISSING_ROW, note: '<script>alert("x")</script> & "quoted"' },
    team: "Some <b>Team</b>",
  });
  assert.ok(!d.html.includes("<script>"), d.html);
  assert.ok(d.html.includes("&lt;script&gt;"), d.html);
  assert.ok(!d.html.includes("<b>Team</b>"));
  // The only tags in the fragment are the ones this module emits.
  const tags = [...d.html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual([...new Set(tags)].sort(), ["h3", "p", "strong"]);
});

test("the HTML fragment carries the same three sentences as the text", () => {
  const d = handoffDirections({ useCase: "UC-07" });
  const stripped = d.html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  for (const line of d.lines) {
    const body = line.slice(line.indexOf(": ") + 2);
    assert.ok(stripped.includes(body.slice(1, 60)), body.slice(0, 60));
  }
});

// ---------------------------------------------------------------------------
// 8. The queue surface adopts it, and adds nothing of its own
// ---------------------------------------------------------------------------

test("the browser asset prints the server's sentences and composes none", () => {
  const app = readFileSync(new URL("../src/approvalqueue/assets/app.js", import.meta.url), "utf8");
  assert.ok(app.includes("directionsBlock"), "the page renders the directions block");
  assert.ok(!app.includes("innerHTML"));
  // No verb vocabulary in the page: if the page phrased the options itself it
  // would be the tenth copy again, one layer further out.
  for (const word of ["Approve or", "Sign off or", "approve or deny"]) {
    assert.ok(!app.includes(word), `the page must not phrase options itself: ${word}`);
  }
});

// ---------------------------------------------------------------------------
// 9. The queue wires the verdict in ONE direction only
// ---------------------------------------------------------------------------
//
// `false` may be passed (awaiting.js already publishes "nobody approves an
// escalation" as its own judgement, so reading it is not forming a second one);
// `true` may never be. A stored status that reads as awaiting can still be
// refused by the approval API for a reason no status column carries, so the
// worst this wiring can do is withhold a verb list from somebody who had one —
// never offer a verb to somebody who does not.

test("the queue withholds verbs from an escalation and never promises them to anyone", async () => {
  const { buildQueueDemoDataset, demoZendesk } = await import("../src/approvalqueue/demoSeed.js");
  const { ApprovalQueueStore } = await import("../src/approvalqueue/queueStore.js");
  const { TicketFacts } = await import("../src/approvalqueue/ticketFacts.js");
  const { buildQueue } = await import("../src/approvalqueue/queue.js");

  const now = Date.parse("2026-08-19T22:00:00.000Z");
  const seedData = buildQueueDemoDataset(now);
  const queue = await buildQueue({
    store: new ApprovalQueueStore({ seedData }),
    ticketFacts: new TicketFacts({ zendesk: demoZendesk(seedData.tickets), subdomain: "demo", demo: true }),
    now,
  });

  assert.ok(queue.items.length > 0);
  for (const item of queue.items) {
    assert.ok(item.directions, `${item.useCase} carries no directions`);
    // Never `true`: only the approval API may promise a specialist a control.
    assert.notEqual(item.directions.open, true, item.useCase);
    if (item.escalated && item.directions.control === "exists") {
      assert.equal(item.directions.open, false, item.useCase);
      assert.match(item.directions.options, /none on this case right now/);
    }
  }

  const escalated = queue.items.find((i) => i.escalated && i.directions.control === "exists");
  assert.ok(escalated, "the demo dataset must contain an escalation with a surface");
  // The surface is still named. Naming nothing would read like the no-surface
  // case, which is the confusion this whole module exists to prevent.
  assert.match(escalated.directions.where, /sidebar/);
});
