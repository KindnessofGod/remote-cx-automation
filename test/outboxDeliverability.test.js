// The one address this page exists to flag must be flagged. The first version
// of the check required `@example.com` immediately after the at-sign and so
// passed `…@rempel-paucek-4c3wac.example.com` as deliverable — the exact
// address that FIFTEEN auto-resolved tickets' letters were sent to, and the
// reason the owner only ever received third-party refusals from this system.
// (Fifteen is measured off the live desk, 2026-08-23, rca-a4yw. The figure this
// file first carried was seven, and seven was never measured.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectOutbox, isUndeliverable } from "../src/outbox/server.js";

test("the Sandbox address that swallowed the auto-resolved letters is UNDELIVERABLE", () => {
  assert.equal(isUndeliverable("owner+employee-eor-usa-10001@rempel-paucek-4c3wac.example.com"), true);
  assert.equal(isUndeliverable("owner+employee-eor-esp-15@rempel-paucek-4c3wac.example.com"), true);
});

test("reserved names are caught as a subdomain or as the whole domain", () => {
  for (const e of ["a@example.com", "a@example.org", "a@x.example.net", "a@thing.test", "a@thing.invalid", "a@localhost"]) {
    assert.equal(isUndeliverable(e), true, `${e} must be undeliverable`);
  }
});

test("a real address is deliverable, and a lookalike is not confused for one", () => {
  for (const e of ["a.person@gmail.com", "b.person@gmail.com", "someone@remote.com"]) {
    assert.equal(isUndeliverable(e), false, `${e} must be deliverable`);
  }
  // Not reserved: the reserved list is exact names, not any domain containing them.
  assert.equal(isUndeliverable("a@example.company"), false);
  assert.equal(isUndeliverable("a@notexample.com"), false);
});

test("a missing address is undeliverable, never assumed fine", () => {
  assert.equal(isUndeliverable(null), true);
  assert.equal(isUndeliverable(""), true);
});


// ---------------------------------------------------------------------------
// The instrument must pass its own control. A page that flags EVERY message as
// undeliverable is indistinguishable from a working one, and for its first
// version this page was exactly that: it hid both of the only genuinely
// delivered letters on the desk. These two tests are the negative and the
// positive control, in that order.
// ---------------------------------------------------------------------------

/** Minimal Zendesk stand-in: a search hit, its requester, and its comments. */
function fakeDesk(tickets, users) {
  return async (path) => {
    if (path.startsWith("/api/v2/search.json")) return { results: tickets };
    const u = path.match(/^\/api\/v2\/users\/(-?\d+)\.json/);
    if (u) {
      const user = users[u[1]];
      if (!user) throw new Error("HTTP 400"); // Zendesk 400s on author -1
      return { user };
    }
    const c = path.match(/^\/api\/v2\/tickets\/(\d+)\/comments\.json/);
    if (c) return { comments: tickets.find((t) => String(t.id) === c[1]).comments };
    throw new Error(`unexpected path ${path}`);
  };
}

test("POSITIVE CONTROL: a reply on a ticket the sender also requested is still OUTBOUND", async () => {
  // The #108/#114 shape. The third-party door is submitted by the admin, so the
  // requester and the author of our reply are the SAME Zendesk user. The first
  // version filtered on `author_id !== requester_id` and therefore dropped the
  // only two letters on the desk that reached a real inbox.
  const items = await collectOutbox(fakeDesk(
    [{ id: 108, subject: "third party", status: "solved", tags: ["third_party_door"], requester_id: 1,
       comments: [{ public: false, author_id: 1, created_at: "2026-08-22T10:24:12Z", plain_body: "AI summary" },
                  { public: true, author_id: 1, created_at: "2026-08-22T10:36:37Z", plain_body: "letter" }] }],
    { 1: { id: 1, email: "b.person@gmail.com", name: "Dana Okoro", role: "admin" } },
  ));
  assert.equal(items.length, 1, "the letter must be visible, not filtered away as inbound");
  assert.equal(items[0].deliverable, true, "a real gmail inbox IS the positive control");
  assert.equal(items[0].text, "letter");
});

test("NEGATIVE CONTROLS: the requester's own message is inbound, and Zendesk's bounce tag outranks the address", async () => {
  const items = await collectOutbox(fakeDesk(
    [{ id: 112, subject: "rental", status: "solved", requester_id: 2,
       // Not a reserved domain. Zendesk still recorded the notification failing.
       tags: ["system_email_notification_failure"],
       comments: [{ public: true, author_id: 2, created_at: "2026-08-22T12:30:00Z", plain_body: "I need a letter" },
                  { public: true, author_id: 1, created_at: "2026-08-22T12:38:06Z", plain_body: "we cannot issue it" }] }],
    { 1: { id: 1, email: "b.person@gmail.com", name: "Agent", role: "admin" },
      2: { id: 2, email: "usa-demo-employee-monthly-12@rempel-paucek-4c3wac.com", name: "Demo", role: "end-user" } },
  ));
  assert.equal(items.length, 1, "the end-user's own opening message is not something this desk sent");
  assert.equal(items[0].text, "we cannot issue it");
  assert.equal(isUndeliverable(items[0].to), false, "the address itself is NOT reserved");
  assert.equal(items[0].reserved, false);
  assert.equal(items[0].bounced, true);
  assert.equal(items[0].deliverable, false, "Zendesk's own failure tag outranks a well-formed address");
});
