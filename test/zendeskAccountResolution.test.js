// ---------------------------------------------------------------------------
// zendeskAccountResolution.test.js — a ticket number is meaningless without an
//                                    account (honest-gaps item 23)
// ---------------------------------------------------------------------------
// Zendesk numbers tickets from 1 in every account. This project has moved
// account twice, and the Supabase history stores bare integers with no record
// of which account they belonged to. Resolving them against whatever
// ZENDESK_SUBDOMAIN is set today does not merely 404 — it silently opens a
// REAL, UNRELATED ticket, and the approval queue then reports `confirmed` and
// names a group for it.
//
// The dangerous case is therefore a lookup that SUCCEEDS, which is why these
// tests spend most of their effort on that one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ZENDESK_ACCOUNTS,
  resolveTicketAccount,
  referenceBelongsToCurrentAccount,
} from "../src/shared/zendeskAccounts.js";
import { ticketVerdict } from "../src/approvalqueue/ticketVerdict.js";

const FOUND_51 = { checked: true, found: true, ticket: { id: 51, status: "open", group_id: 1 } };

test("each account resolves inside its own window", () => {
  assert.equal(resolveTicketAccount("2026-08-10T00:00:00Z").subdomain, "your-subdomain");
  assert.equal(resolveTicketAccount("2026-08-19T12:00:00Z").subdomain, "your-subdomain");
  assert.equal(resolveTicketAccount("2026-08-29T06:00:00Z").subdomain, "your-subdomainhelp");
});

test("the migration window is AMBIGUOUS, not resolved to either side", () => {
  // Both accounts could still create work between the new account's first
  // tickets and the webhook-secret rotation that made the old one incapable of
  // writing. Narrowing that by guesswork is the one thing this must not do.
  const r = resolveTicketAccount("2026-08-29T02:00:00Z");
  assert.equal(r.ambiguous, true);
  assert.equal(r.subdomain, null);
  assert.deepEqual(r.candidates.sort(), ["your-subdomain", "your-subdomainhelp"]);
});

test("a missing or unreadable timestamp fails to AMBIGUOUS, never to the current account", () => {
  // This is the input most likely to occur and the one where defaulting to
  // "today's account" would reintroduce the exact bug.
  for (const bad of [null, undefined, "", "not a date", {}]) {
    const r = resolveTicketAccount(bad);
    assert.equal(r.ambiguous, true, `${JSON.stringify(bad)} was resolved to an account`);
    assert.equal(r.subdomain, null);
  }
});

test("referenceBelongsToCurrentAccount is true ONLY for an unambiguous match", () => {
  assert.equal(referenceBelongsToCurrentAccount("2026-08-19T12:00:00Z", "your-subdomain"), true);
  assert.equal(referenceBelongsToCurrentAccount("2026-08-19T12:00:00Z", "your-subdomainhelp"), false);
  assert.equal(referenceBelongsToCurrentAccount("2026-08-29T02:00:00Z", "your-subdomainhelp"), false, "ambiguous must not pass");
  assert.equal(referenceBelongsToCurrentAccount(null, "your-subdomainhelp"), false);
  assert.equal(referenceBelongsToCurrentAccount("2026-08-29T06:00:00Z", null), false, "no configured subdomain must not pass");
});

test("THE DANGEROUS CASE: a ticket that EXISTS in the current account is still refused", () => {
  // A pre-migration reference "51" against the new account. The lookup
  // succeeded — there really is a #51 — and it is somebody else's. Before this
  // change the verdict was `confirmed`, with a working link and a group name.
  const v = ticketVerdict({
    reference: "51",
    lookup: FOUND_51,
    subdomain: "your-subdomainhelp",
    owningGroup: "Finance Ops",
    recordWrittenAt: "2026-08-19T12:00:00Z",
  });
  assert.equal(v.state, "foreign_account");
  assert.equal(v.url, null, "a link was rendered to an unrelated ticket");
  assert.notEqual(v.state, "confirmed");
  assert.match(v.detail, /your-subdomain/);
});

test("the same reference IS confirmed when the record predates no migration", () => {
  const v = ticketVerdict({
    reference: "51",
    lookup: FOUND_51,
    subdomain: "your-subdomain",
    owningGroup: "Finance Ops",
    recordWrittenAt: "2026-08-19T12:00:00Z",
  });
  assert.equal(v.state, "confirmed");
  assert.ok(v.url && v.url.includes("your-subdomain.zendesk.com"));
});

test("an ambiguous record is refused even against the right-looking account", () => {
  const v = ticketVerdict({
    reference: "51",
    lookup: FOUND_51,
    subdomain: "your-subdomainhelp",
    owningGroup: "Finance Ops",
    recordWrittenAt: null,
  });
  assert.equal(v.state, "foreign_account");
  assert.equal(v.url, null);
});

test("the foreign verdict never claims a queue", () => {
  // A group verdict computed from the wrong account's ticket would be a
  // confident answer about a ticket nobody asked about.
  const v = ticketVerdict({
    reference: "51",
    lookup: FOUND_51,
    subdomain: "your-subdomainhelp",
    owningGroup: "Finance Ops",
    recordWrittenAt: "2026-08-19T12:00:00Z",
  });
  assert.ok(v.group, "a group verdict is still reported");
  assert.notEqual(v.group.state, "owning_team", "it claimed the ticket was in the owning team's queue");
});

test("demo data opts out EXPLICITLY, and an unknown real subdomain does not", () => {
  const demo = ticketVerdict({
    reference: "51", lookup: FOUND_51, subdomain: "demo-account",
    owningGroup: "Finance Ops", recordWrittenAt: "2026-08-19T12:00:00Z", demo: true,
  });
  assert.equal(demo.state, "confirmed", "the seeded demo must still demonstrate a confirmed ticket");

  // Same input WITHOUT the flag: an unrecognised real account must fail loudly,
  // because that is the signal that a fourth account was configured and nobody
  // registered it in ZENDESK_ACCOUNTS.
  const unknown = ticketVerdict({
    reference: "51", lookup: FOUND_51, subdomain: "some-new-account",
    owningGroup: "Finance Ops", recordWrittenAt: "2026-08-19T12:00:00Z",
  });
  assert.equal(unknown.state, "foreign_account");
});

test("the account table is ordered and each window is well formed", () => {
  const subs = ZENDESK_ACCOUNTS.map((a) => a.subdomain);
  assert.deepEqual(subs, ["your-subdomain", "your-subdomain", "your-subdomainhelp"]);
  assert.equal(ZENDESK_ACCOUNTS[0].from, null, "the earliest account must have an open start");
  assert.equal(ZENDESK_ACCOUNTS[ZENDESK_ACCOUNTS.length - 1].until, null, "the current account must have an open end");
  for (const a of ZENDESK_ACCOUNTS) {
    if (a.from && a.until) assert.ok(Date.parse(a.from) < Date.parse(a.until), `${a.subdomain} has an inverted window`);
  }
});
