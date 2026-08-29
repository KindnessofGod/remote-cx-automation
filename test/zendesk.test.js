// ---------------------------------------------------------------------------
// zendesk.test.js  —  ZendeskClient, normalizeZendeskTicket, and the
// end-to-end write-back from handleVerificationTicket. All against the local
// mock Zendesk server (src/zendesk/mockServer.js) — no real account, no
// network calls outside localhost. Run with:  npm test
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer as startZendeskMock, TICKETS } from "../src/zendesk/mockServer.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { normalizeZendeskTicket } from "../src/zendesk/normalizeTicket.js";
import { startMockServer as startRemoteMock } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

const EMPLOYMENT_ID_FIELD_ID = 360000000001;

let zendeskServer, remoteServer, zendesk, remote;

before(async () => {
  zendeskServer = await startZendeskMock(4015);
  remoteServer = await startRemoteMock(4016);
  zendesk = new ZendeskClient({ baseUrl: "http://localhost:4015", email: "agent@example.com", apiToken: "test" });
  remote = new RemoteClient({ baseUrl: "http://localhost:4016" });
});
after(() => {
  zendeskServer && zendeskServer.close();
  remoteServer && remoteServer.close();
});

// Reset the mock ticket to a known state before each test — several tests mutate it.
beforeEach(() => {
  TICKETS["1001"] = {
    id: 1001,
    subject: "Employment verification letter",
    description: "Please send me a standard employment verification letter.",
    status: "open",
    tags: [],
    custom_fields: [{ id: EMPLOYMENT_ID_FIELD_ID, value: "emp_active_001" }],
    // Kept in step with the fixture in src/zendesk/mockServer.js: a real ticket
    // carries the requester Zendesk authenticated, and that is the only identity
    // signal a ticket has. This reset shadowed the module fixture, so omitting
    // it here would have quietly restored the no-requester ticket for every test
    // in this file — including the two VC-28 tests below, which would then have
    // compared two null sessions and passed while proving nothing.
    requester: { id: 500001, email: "amara@acme.test", name: "Amara Okafor" },
    comments: [],
  };
});

test("ZendeskClient.getTicket fetches the mock ticket", async () => {
  const ticket = await zendesk.getTicket(1001);
  assert.equal(ticket.id, 1001);
  assert.equal(ticket.status, "open");
});

test("ZendeskClient.getTicket returns null for a missing ticket", async () => {
  const ticket = await zendesk.getTicket(9999);
  assert.equal(ticket, null);
});

test("ZendeskClient.resolveWithLetter sets status solved and posts a public comment", async () => {
  await zendesk.resolveWithLetter(1001, "<p>Letter</p>");
  const ticket = await zendesk.getTicket(1001);
  assert.equal(ticket.status, "solved");
  assert.equal(ticket.comments.length, 1);
  assert.equal(ticket.comments[0].public, true);
  assert.match(ticket.comments[0].html_body, /Letter/);
});

test("ZendeskClient.flagForReview applies tags and an internal note without resolving", async () => {
  await zendesk.flagForReview(1001, { note: "needs a human", tags: ["verification_exception"] });
  const ticket = await zendesk.getTicket(1001);
  assert.equal(ticket.status, "open"); // unchanged — not resolved
  assert.deepEqual(ticket.tags, ["verification_exception"]);
  assert.equal(ticket.comments[0].public, false);
  assert.match(ticket.comments[0].body, /needs a human/);
});

// rca-iih7 / D-30: additionalTags/removeTags exist so a caller does not have
// to know (and risk clobbering) a ticket's full current tag set just to add
// or drop one.
test("ZendeskClient.flagForReview: additionalTags adds without touching existing tags", async () => {
  TICKETS["1001"].tags = ["queue_hr_ops", "uc01_human_review"];
  await zendesk.flagForReview(1001, { note: "declined", additionalTags: ["verification_declined"] });
  const ticket = await zendesk.getTicket(1001);
  assert.deepEqual(new Set(ticket.tags), new Set(["queue_hr_ops", "uc01_human_review", "verification_declined"]));
});

test("ZendeskClient.flagForReview / resolveWithLetter: removeTags drops only the named tag", async () => {
  TICKETS["1001"].tags = ["queue_hr_ops", "uc01_human_review"];
  await zendesk.resolveWithLetter(1001, "<p>Letter</p>", { removeTags: ["uc01_human_review"] });
  const ticket = await zendesk.getTicket(1001);
  assert.deepEqual(ticket.tags, ["queue_hr_ops"]);
});

test("normalizeZendeskTicket maps a raw ticket to the internal ticket shape", () => {
  const ticket = normalizeZendeskTicket(TICKETS["1001"], { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID });
  assert.equal(ticket.text, "Please send me a standard employment verification letter.");
  assert.equal(ticket.employmentId, "emp_active_001");
  assert.equal(ticket.source, "zendesk");
  assert.equal(ticket.externalRef, "1001");
  // THE SESSION IS DERIVED, NOT NULL (L-11 / DRIFT-118). This asserted
  // `session === null` until 2026-08-21, matching a normalizer that hard-coded
  // it — while the live n8n path derived a session from the ticket's
  // Zendesk-authenticated requester all along. The two production paths reached
  // opposite identity verdicts from the same ticket, and this assertion was one
  // of the things certifying it.
  assert.deepEqual(ticket.session, { authenticatedEmail: "amara@acme.test" });
  // G-3/L-8: NO consent field at all any more — a normalizer has no way to
  // look in `consent_records` (that lookup is workflow.js's STEP 2c), so it
  // must not assert an opinion about it, not even `null`.
  assert.equal("consentOnRecord" in ticket, false);
  assert.equal("consentRecord" in ticket, false);
});

test("VC-28: the two normalizers derive the SAME identity from the SAME ticket", async () => {
  // DRIFT-118 made mechanical. `src/zendesk/normalizeTicket.js` and
  // `workflows/nodes/normalizeTicket.js` are the two production entry points,
  // and until L-11 they disagreed about who was asking: one emitted a null
  // session unconditionally, the other read the ticket's authenticated
  // requester. Every hermetic test stayed green through it, because each path
  // was only ever tested against itself.
  //
  // This runs the n8n body in a vm sandbox the way test/n8nParity.test.js does,
  // feeds both the identical raw ticket, and compares the SESSION each derives.
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const raw = TICKETS["1001"];

  const nodeSide = normalizeZendeskTicket(raw, { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID });

  const body = readFileSync(new URL("../workflows/nodes/normalizeTicket.js", import.meta.url), "utf8");
  // The n8n node reads its own account's field id, which is not the mock's, so
  // the ticket is presented with the field id that node expects. The identity
  // derivation under test is untouched by that.
  const forN8n = { ...raw, custom_fields: [{ id: 9990000000001, value: "emp_active_001" }] };
  const sandbox = { $input: { first: () => ({ json: { body: { ticket: forN8n } } }) }, console };
  vm.createContext(sandbox);
  // JSON round-trip: a vm result is CROSS-REALM, and `assert.deepEqual` fails on
  // prototype identity rather than on content — two byte-identical objects
  // compare unequal. Round-tripping is also exactly what n8n does between nodes,
  // so this compares what the next node would actually receive. (CLAUDE.md §6.)
  const n8nSide = JSON.parse(JSON.stringify(vm.runInContext(`(function(){${body}})()`, sandbox)[0].json));

  assert.deepEqual(
    nodeSide.session,
    n8nSide.session,
    "the two normalizers must derive the same identity from the same ticket"
  );
  assert.equal(nodeSide.employmentId, n8nSide.employmentId);
  assert.equal(nodeSide.externalRef, n8nSide.externalRef);
});

test("VC-28: a ticket with no requester fails CLOSED on both paths, identically", async () => {
  // The failure/recovery half of VC-28. A missing requester email must yield
  // unverified on BOTH paths — the same absence reaching the same verdict, not
  // one path guessing and the other refusing.
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const anonymous = { ...TICKETS["1001"], requester: undefined, via: undefined };

  const nodeSide = normalizeZendeskTicket(anonymous, { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID });

  const body = readFileSync(new URL("../workflows/nodes/normalizeTicket.js", import.meta.url), "utf8");
  const forN8n = { ...anonymous, custom_fields: [{ id: 9990000000001, value: "emp_active_001" }] };
  const sandbox = { $input: { first: () => ({ json: { body: { ticket: forN8n } } }) }, console };
  vm.createContext(sandbox);
  const n8nSide = JSON.parse(JSON.stringify(vm.runInContext(`(function(){${body}})()`, sandbox)[0].json));

  assert.equal(nodeSide.session, null);
  assert.equal(n8nSide.session, null);
});

test("normalizeZendeskTicket throws when the employment-id custom field is missing", () => {
  const ticketWithoutField = { ...TICKETS["1001"], custom_fields: [] };
  assert.throws(
    () => normalizeZendeskTicket(ticketWithoutField, { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID }),
    /no employment id/
  );
});

test("end-to-end: auto_resolve posts the letter and resolves the real (mock) ticket", async () => {
  const ticket = normalizeZendeskTicket(TICKETS["1001"], { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID });
  const result = await handleVerificationTicket(
    { ...ticket, session: { authenticatedEmail: "amara@acme.test" } }, // simulate an authenticated self session
    { remote, audit: new AuditLogger(), caseStore: new CaseStore(), zendesk, classify: classifyRequestRuleBased }
  );

  assert.equal(result.decision, "auto_resolve");

  const updatedTicket = await zendesk.getTicket(1001);
  assert.equal(updatedTicket.status, "solved");
  assert.equal(updatedTicket.comments.length, 1);
  assert.match(updatedTicket.comments[0].html_body, /Employment Verification Letter/);
});

test("end-to-end: escalate tags the real (mock) ticket verification_exception without resolving", async () => {
  TICKETS["1001"].custom_fields = [{ id: EMPLOYMENT_ID_FIELD_ID, value: "emp_terminated_002" }];
  const ticket = normalizeZendeskTicket(TICKETS["1001"], { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID });
  // THE SESSION MUST MATCH THE RECORD IT NAMES (kofi@acme.test — see
  // mockServer.js's emp_terminated_002 fixture), or this stops being an
  // escalation at all. Since G-3, an authenticated signal that does NOT
  // match its own claimed record is a THIRD PARTY — a pending consent
  // question (`awaiting_employee_consent`), not an escalation — and a
  // mismatched "amara@acme.test" here would prove nothing about the
  // terminated-employee gate this test exists to demonstrate.
  const result = await handleVerificationTicket(
    { ...ticket, session: { authenticatedEmail: "kofi@acme.test" } },
    { remote, audit: new AuditLogger(), caseStore: new CaseStore(), zendesk, classify: classifyRequestRuleBased }
  );

  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "employee_not_active");

  const updatedTicket = await zendesk.getTicket(1001);
  assert.equal(updatedTicket.status, "open"); // not resolved
  assert.ok(updatedTicket.tags.includes("verification_exception"));
});

// --- OAuth client_credentials mode (see restClient.js's header comment for
// what's verified about the real endpoint vs. assumed) --------------------

test("ZendeskClient (OAuth mode) fetches a token and uses it as a Bearer header", async () => {
  const oauthZendesk = new ZendeskClient({
    baseUrl: "http://localhost:4015",
    clientId: "mock_client_id",
    clientSecret: "mock_client_secret",
  });
  const ticket = await oauthZendesk.getTicket(1001);
  assert.equal(ticket.id, 1001);
});

test("ZendeskClient (OAuth mode) reuses a cached token instead of re-fetching every call", async () => {
  const oauthZendesk = new ZendeskClient({
    baseUrl: "http://localhost:4015",
    clientId: "mock_client_id",
    clientSecret: "mock_client_secret",
  });
  await oauthZendesk.getTicket(1001);
  const firstToken = oauthZendesk._accessToken;
  await oauthZendesk.getTicket(1001);
  assert.equal(oauthZendesk._accessToken, firstToken); // same token object — no re-fetch
});

test("ZendeskClient (OAuth mode) surfaces a clear error on a bad client secret", async () => {
  const badOauthZendesk = new ZendeskClient({
    baseUrl: "http://localhost:4015",
    clientId: "mock_client_id",
    clientSecret: "wrong_secret",
  });
  await assert.rejects(() => badOauthZendesk.getTicket(1001), /OAuth token request failed/);
});

test("without a zendesk dep, handleVerificationTicket never touches the mock ticket", async () => {
  const ticket = normalizeZendeskTicket(TICKETS["1001"], { employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID });
  await handleVerificationTicket(
    { ...ticket, session: { authenticatedEmail: "amara@acme.test" } },
    { remote, audit: new AuditLogger(), caseStore: new CaseStore(), classify: classifyRequestRuleBased } // no zendesk
  );
  const untouchedTicket = await zendesk.getTicket(1001);
  assert.equal(untouchedTicket.status, "open");
  assert.equal(untouchedTicket.comments.length, 0);
});
