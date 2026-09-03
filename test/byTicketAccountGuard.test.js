// ---------------------------------------------------------------------------
// byTicketAccountGuard.test.js
//
// Pins the guard that stopped `by-ticket/:ref` serving a record from a RETIRED
// Zendesk account. The headline case is not invented: on 2026-08-30 the ZAF
// sidebar showed Alexandre Tremblay's UC-06 contract amendment (written
// 2026-08-19, account `your-subdomain`) to a specialist holding `your-subdomainhelp`
// ticket #32, which was Chris Lee's UC-02 expense claim filed that morning.
// Both records answered `found: true` for "ticket 32" and both were right
// about their own account.
//
// The three PASS-THROUGH cases matter as much as the refusal. This guard is on
// the sidebar's only route to a case, so refusing whatever it cannot prove
// would hide live work — including on every laptop with no ZENDESK_SUBDOMAIN.
// Each is asserted so that "fail closed everywhere" cannot be applied here by
// a later reader who has only read the module's siblings.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { byTicketAccountRefusal } from "../src/shared/byTicketAccountGuard.js";
import { foreignTicketAccountRefusal, resolveTicketAccount } from "../src/shared/zendeskAccounts.js";

const NOW = "your-subdomainhelp";

test("THE OBSERVED COLLISION: a 2026-08-19 record is refused for a your-subdomainhelp ticket", () => {
  const uc06Row = { createdAt: "2026-08-19T02:23:07.180Z" };
  const refusal = byTicketAccountRefusal(uc06Row, "32", { currentSubdomain: NOW });
  assert.ok(refusal, "the pre-migration row must be refused");
  assert.equal(refusal.found, false);
  assert.equal(refusal.reason, "reference_belongs_to_another_zendesk_account");
  assert.equal(refusal.storedAccount, "your-subdomain");
  assert.equal(refusal.currentAccount, "your-subdomainhelp");
  assert.match(refusal.detail, /"32"/, "the refusal names the reference it is about");
});

test("the SAME-DAY record for the same reference is served", () => {
  // Chris Lee's expense, written after the cutover. Same ref, different account
  // era — this is the row that should have rendered.
  const uc02Row = { createdAt: "2026-08-30T05:16:28.396Z" };
  assert.equal(byTicketAccountRefusal(uc02Row, "32", { currentSubdomain: NOW }), null);
});

test("a raw database row spelling created_at is understood too", () => {
  assert.ok(byTicketAccountRefusal({ created_at: "2026-08-19T02:23:07Z" }, "32", { currentSubdomain: NOW }));
  assert.equal(byTicketAccountRefusal({ created_at: "2026-08-30T00:00:01Z" }, "32", { currentSubdomain: NOW }), null);
});

test("a Date object works as well as an ISO string", () => {
  const refusal = byTicketAccountRefusal({ createdAt: new Date("2026-08-19T02:23:07Z") }, "32", {
    currentSubdomain: NOW,
  });
  assert.ok(refusal);
  assert.equal(refusal.storedAccount, "your-subdomain");
});

// -- the three deliberate pass-throughs ------------------------------------

test("PASS-THROUGH: no configured subdomain serves the row rather than hiding it", () => {
  // A laptop running `npm run uc02-api` with no .env. Refusing here would make
  // the sidebar permanently blank for a reason no message would explain.
  assert.equal(byTicketAccountRefusal({ createdAt: "2026-08-19T02:23:07Z" }, "32", { currentSubdomain: null }), null);
  assert.equal(byTicketAccountRefusal({ createdAt: "2026-08-19T02:23:07Z" }, "32", { currentSubdomain: "" }), null);
});

test("PASS-THROUGH: a timestamp inside the migration window is served, and is genuinely ambiguous", () => {
  const inWindow = "2026-08-29T02:00:00Z";
  assert.equal(resolveTicketAccount(inWindow).ambiguous, true, "precondition: this instant really is ambiguous");
  assert.equal(byTicketAccountRefusal({ createdAt: inWindow }, "32", { currentSubdomain: NOW }), null);
});

test("PASS-THROUGH: an unreadable or missing timestamp is served", () => {
  for (const createdAt of [null, undefined, "", "not a date"]) {
    assert.equal(byTicketAccountRefusal({ createdAt }, "32", { currentSubdomain: NOW }), null, String(createdAt));
  }
});

test("a null row is not a refusal — the route's own 404 handles that", () => {
  assert.equal(byTicketAccountRefusal(null, "32", { currentSubdomain: NOW }), null);
  assert.equal(byTicketAccountRefusal(undefined, "32", { currentSubdomain: NOW }), null);
});

test("the oldest account is refused too, not just the most recent retirement", () => {
  const refusal = byTicketAccountRefusal({ createdAt: "2026-08-01T00:00:00Z" }, "7", { currentSubdomain: NOW });
  assert.ok(refusal);
  assert.equal(refusal.storedAccount, "your-subdomain");
});

test("it refuses in BOTH directions — an your-subdomain deployment refuses a new-account row", () => {
  // Not hypothetical symmetry: it is what makes the guard a statement about
  // accounts rather than a hard-coded 'anything before the migration'.
  const refusal = foreignTicketAccountRefusal("2026-08-30T05:16:28Z", "your-subdomain", "32");
  assert.ok(refusal);
  assert.equal(refusal.storedAccount, "your-subdomainhelp");
  assert.equal(refusal.currentAccount, "your-subdomain");
});

test("the refusal body carries no record data — only the account facts", () => {
  const refusal = byTicketAccountRefusal(
    { createdAt: "2026-08-19T02:23:07Z", employeeName: "Alexandre Tremblay", amount: 880_00 },
    "32",
    { currentSubdomain: NOW }
  );
  assert.deepEqual(Object.keys(refusal).sort(), [
    "currentAccount",
    "detail",
    "found",
    "reason",
    "storedAccount",
  ]);
  assert.doesNotMatch(JSON.stringify(refusal), /Tremblay|88000/, "the refused record must not leak into the refusal");
});

// ---------------------------------------------------------------------------
// EVERY by-ticket ROUTE IS WIRED, checked by reading the sources.
//
// A unit test on the guard proves the guard. It cannot prove that the nine
// routes CALL it, and the original defect was exactly that shape: the answer
// (`zendeskAccounts.js`) had existed for a day and was wired into one consumer
// out of three. A route added later with the lookup copied from its neighbour
// would reintroduce the bug silently, and nothing else in the suite would fail.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

const BY_TICKET_SERVERS = [
  "src/review/server.js", // UC-01, /api/review/ticket/:id
  "src/uc02/server.js",
  "src/uc03/server.js",
  "src/uc04/server.js",
  "src/uc05/server.js",
  "src/uc06/server.js",
  "src/uc07/server.js",
  "src/uc08/server.js",
  "src/uc09/server.js",
];

test("all nine by-ticket routes consult the account guard", () => {
  for (const file of BY_TICKET_SERVERS) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(src, /byTicketAccountGuard\.js/, `${file} does not import the guard`);
    assert.match(src, /byTicketAccountRefusal\(/, `${file} imports the guard but never calls it`);
    assert.match(
      src,
      /if \(foreignAccount\) return send\(res, 404, foreignAccount\);/,
      `${file} calls the guard but does not act on its answer`
    );
  }
});

// Two spellings across the nine: the eight use-case servers write
// `send(res, 200, …)`; UC-01 writes `send(res, view.found ? 200 : 404, view)`.
// Matching only the first reported UC-01 as unguarded while it was guarded.
const SERVES_RECORD = /send\(res,[^;]*200/;

test("the guard is consulted BEFORE the record is sent", () => {
  // Ordering is the whole control. A guard that runs after `send()` refuses
  // nothing while looking exactly like this test's other assertions passing.
  for (const file of BY_TICKET_SERVERS) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const guardAt = src.indexOf("if (foreignAccount) return send(res, 404, foreignAccount);");
    const after = src.slice(guardAt);
    assert.ok(guardAt > 0, `${file}: guard not found`);
    // The record-serving 200 must come AFTER the guard. Searched over the rest
    // of the file rather than a fixed window: UC-01's handler carries ~90 lines
    // of ruling between the two, and a window tight enough to be meaningful for
    // the others reported that file as unguarded when it is guarded correctly.
    assert.match(after, SERVES_RECORD, `${file}: no 200 response follows the guard`);
    // ...and nothing serves a record BEFORE it. This is the assertion that
    // would actually catch a guard pasted in below the response.
    const lookupAt = Math.min(
      ...[/findByExternalRef\(/, /getReviewView\(/]
        .map((re) => src.search(re))
        .filter((i) => i >= 0)
    );
    const servedEarly = SERVES_RECORD.test(src.slice(lookupAt, guardAt));
    assert.equal(servedEarly, false, `${file}: a record is sent before the guard runs`);
  }
});

test("HERMETIC FLOOR: the ambient .env cannot decide this guard's verdict", async () => {
  // The bug this pins is not hypothetical — it is what the first version of
  // this change did. Two unrelated deployRouter tests failed on this container
  // and would have passed on a laptop with no ZENDESK_SUBDOMAIN.
  const { currentZendeskSubdomain } = await import("../src/shared/byTicketAccountGuard.js");
  assert.equal(process.env.NODE_TEST_CONTEXT, "child-v8", "precondition: this IS a node:test process");
  assert.equal(currentZendeskSubdomain(), null, "a test process must not inherit a real Zendesk account");
  // ...and with no account resolved, a pre-migration row is served, not hidden.
  assert.equal(byTicketAccountRefusal({ createdAt: "2026-08-19T02:23:07Z" }, "32"), null);
});
