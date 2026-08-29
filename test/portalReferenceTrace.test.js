// ---------------------------------------------------------------------------
// portalReferenceTrace.test.js  —  Every reference the portal SHOWS is findable
// ---------------------------------------------------------------------------
// THE PROMISE UNDER TEST, quoted from the page the requester reads:
//
//   "Reference sent: uc04-20260819205605-2hnba — the id that ties every record
//    of this request together; quote it to have this request traced."
//
// A requester quoted exactly that and found nothing. Against production:
//
//   select … from audit_log where details->>'externalRef' like 'uc04-20260819%'
//   -> 0 rows
//
// The decision existed. It was filed under `"50"` — the Zendesk ticket id of
// the UC-03 travel request the assessment continued — because a continuation is
// deliberately filed under the travel request's reference, so that the two
// decisions read as one story (src/portal/uc03Continuation.js). Right, and
// silent, and the sentence on screen was therefore false.
//
// WHY THIS FILE EXISTS RATHER THAN ONE MORE UC-04 ASSERTION
// This repo has been here before. An earlier pass found 0 of 13 portal-issued
// references reaching `audit_log` and fixed 41 call sites (test/auditProvenance
// .test.js). This one still slipped through, because the surface that broke the
// promise was not a writer that dropped a ref — it was a route that MINTED one
// reference and STORED another. A per-use-case check cannot see that, and a
// hand-listed set of use cases will miss whichever surface is added next.
//
// So this file walks the surfaces. `REQUEST_TYPES` is the portal's own list of
// what it accepts, and a type with no recipe here FAILS rather than being
// skipped — the failure mode of a hand-listed set is silence, and silence is
// what let this through.
//
// WHAT "FINDABLE" MEANS, EXACTLY. src/auditview/readStore.js resolves a
// reference with `where details->>'externalRef' = $1` — one column, exact
// match, no fallbacks. So a reference is findable if and only if some
// `audit_log` row carries it in that one field. A `submittedRef` column sitting
// beside `externalRef` would be true, recorded, and invisible to the only
// lookup a human has.
//
// SCOPE, STATED RATHER THAN LEFT TO BE DISCOVERED. This covers references shown
// beside a submission that was DECIDED, and (via the identity-refusal rows
// src/portal/refusalAudit.js writes) references shown beside a 401/403. It does
// NOT cover the 400s — "you left a box empty" — which that file argues at
// length must not be audited. The page still prints the reference line on those
// refusals, which is a smaller instance of the same overstatement; it is
// recorded here as a known boundary rather than quietly satisfied.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler, REFERENCE_SUPERSEDED_ACTION, REFERENCE_RELINKED_ACTION } from "../src/portal/server.js";
import { REQUEST_TYPES } from "../src/portal/requestTypes.js";
import { NO_TICKET_DECISIONS } from "../src/portal/ticketing.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { draftNarrative as draftRelocationNarrative } from "../src/uc07/dossierBuilder.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftNarrative as draftTaxNarrative } from "../src/uc08/dossierBuilder.js";
import { parseAdjustmentRequest } from "../src/uc09/adjustmentParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, "..", "src", "portal", "server.js"), "utf8");

// A literal, and deliberately so — the registry's TEST_BAND (4090-4099) is
// reserved for a test's own mock. test/ports.test.js enforces that this stays
// out of both the seed band and every server's port.
const REMOTE_PORT = 4110;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
  extract: (args) => extractFromLetter(args, unconfigured),
  parseRelocation: parseRelocationRuleBased,
  draftRelocationNarrative: (args) => draftRelocationNarrative(args, unconfigured),
  parseInquiry: parseInquiryRuleBased,
  draftTaxNarrative: (args) => draftTaxNarrative(args, unconfigured),
  // UC-09's parser has no rule-based branch to force — an amount that will be
  // paid is never guessed from prose — so this stands a scripted model up and
  // runs the REAL parser's shape validation, source tagging and x100 scaling.
  parseAdjustment: (args) =>
    parseAdjustmentRequest(args, {
      isConfigured: () => true,
      backoff: async () => {},
      askJson: async () => ({
        type: "bonus",
        amount: 500,
        currency: "EUR",
        description: String(args.requestText ?? ""),
        amountTaxType: "gross",
      }),
    }),
};

let remote;
let remoteServer;

function freshStores() {
  return {
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
}

function callApi(h, { method, path, body = null, headers = {} }) {
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
        resolve({ status: this.statusCode, headers: this.headers, body: payload ? JSON.parse(payload) : null });
      },
    };
    h(req, res).catch(reject);
  });
}

function buildPortal({ zendesk = undefined } = {}) {
  const audit = new AuditLogger();
  const stores = freshStores();
  return { audit, stores, handler: createPortalHandler({ remote, audit, stores, llm: FAKE_LLM, zendesk }) };
}

/** A Zendesk double that hands back a numeric ticket id, like the real one. */
function fakeZendesk() {
  let next = 900;
  return {
    async createTicket() {
      next += 1;
      return { id: next };
    },
    async updateTicket(id, patch) {
      return { ticket: { id, ...patch } };
    },
  };
}

const post = (h, type, body) => callApi(h, { method: "POST", path: `/api/requests/${type}`, body });

const CHRIS = "8ab12460-b568-4c1e-af9d-09b1fabd8f46";

/**
 * One submission per request type that the gates ACCEPT — i.e. one that gets as
 * far as a decision, because a request refused for a blank field writes nothing
 * by design (see this file's header).
 *
 * Keyed by the portal's own route segment so the sweep below can walk
 * REQUEST_TYPES and demand one of these for every entry. A `body` here is a
 * function of the reference, never a constant, so a type cannot accidentally
 * be tested with a reference some other type already used.
 */
const SUBMISSIONS = {
  uc01: (ref) => ({ persona: "chris", externalRef: ref }),
  uc02: (ref) => ({ persona: "chris", expenseId: "exp_sandbox_clean_401", externalRef: ref }),
  uc03: (ref) => ({
    persona: "chris",
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026.",
    externalRef: ref,
  }),
  uc04: (ref) => ({
    persona: "admin",
    employmentId: CHRIS,
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "PT",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    externalRef: ref,
  }),
  uc05: (ref) => ({ persona: "chris", proposedEndDate: "2026-09-30", externalRef: ref }),
  uc07: (ref) => ({
    text: "Permanent relocation from Spain to the Netherlands, full time.",
    employmentId: CHRIS,
    salary: "65000",
    currency: "EUR",
    externalRef: ref,
  }),
  uc08: (ref) => ({
    text: "I've been asked to work from our London office for a few months. Do we need to withhold UK payroll tax?",
    employmentId: CHRIS,
    targetCountry: "GB",
    presencePeriods: [{ country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" }],
    externalRef: ref,
  }),
  uc09: (ref) => ({
    persona: "admin",
    employmentId: CHRIS,
    requestText: "Pay a 500 EUR referral bonus this month.",
    externalRef: ref,
  }),
};

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 1. The sweep — it WALKS the surfaces, it does not list them
// ---------------------------------------------------------------------------

// The completeness half, first and separately, because it is the half that
// catches the NEXT one. A request type added to the portal without a recipe
// here would otherwise be silently un-swept, which is the exact failure that
// let the UC-04 continuation through.
test("every request type the portal accepts has a submission here to sweep", () => {
  const missing = REQUEST_TYPES.map((t) => t.id).filter((id) => typeof SUBMISSIONS[id] !== "function");
  assert.deepEqual(
    missing,
    [],
    `these portal request types are not covered by the reference sweep: ${missing.join(", ")}. ` +
      "Add a submission that the gates accept — an untested surface is how the last one broke the promise."
  );
  const stale = Object.keys(SUBMISSIONS).filter((id) => !REQUEST_TYPES.some((t) => t.id === id));
  assert.deepEqual(stale, [], `these recipes name request types the portal no longer has: ${stale.join(", ")}`);
});

for (const type of REQUEST_TYPES) {
  test(`${type.id}: the reference the requester is shown finds the request in audit_log`, async () => {
    const { handler, audit } = buildPortal();
    const ref = `trace-${type.id}-0001`;

    const res = await post(handler, type.id, SUBMISSIONS[type.id](ref));
    assert.equal(res.status, 200, `the sweep needs a submission the gates ACCEPT: ${JSON.stringify(res.body)}`);

    // The one field src/auditview/readStore.js looks a reference up by.
    const found = audit.entries.filter((e) => e.details?.externalRef === ref);
    assert.ok(
      found.length > 0,
      `${type.useCase} showed the requester "${ref}" and no audit_log row carries it in details.externalRef — ` +
        "the page's claim that this id traces the request is false. " +
        `Rows written: ${JSON.stringify(audit.entries.map((e) => ({ a: e.action, r: e.details?.externalRef })))}`
    );

    // ...and the response says, on the wire, which reference the request was
    // actually filed under, so nobody has to assume it is the one they sent.
    assert.ok(
      Object.hasOwn(res.body, "recordedRef"),
      "every intake response must state the reference the request was filed under"
    );
  });
}

// ---------------------------------------------------------------------------
// 2. The case that broke it — a reference the server does NOT use
// ---------------------------------------------------------------------------
// Driven through the same public route, with UC-04's continuation as the one
// adapter that files under a different reference. Both strings must resolve,
// and each must lead to the other.

test("a substituted reference still finds the request, and names the one that was used", async () => {
  const { handler, audit } = buildPortal();
  const routed = await post(handler, "uc03", {
    persona: "chris",
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    externalRef: "trace-uc03-shared",
  });
  assert.equal(routed.body.decision, "route_to_uc04");

  await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03/continue",
    body: { persona: "chris", caseId: routed.body.recordId },
  });

  const shown = "trace-uc04-shown-to-requester";
  const assessed = await post(handler, "uc04", {
    ...SUBMISSIONS.uc04(shown),
    continuationOf: routed.body.recordId,
  });
  assert.equal(assessed.status, 200);

  // The reference the SERVER used — the travel request's — is what the
  // decision, the claim and the link all carry.
  assert.equal(assessed.body.recordedRef, "trace-uc03-shared");
  assert.notEqual(assessed.body.recordedRef, shown);

  // The reference the REQUESTER was shown resolves too. This is the assertion
  // the defect would have failed.
  const bySubmitted = audit.entries.filter((e) => e.details?.externalRef === shown);
  assert.equal(bySubmitted.length, 1, "the reference on the requester's screen must find exactly one row");
  assert.equal(bySubmitted[0].action, REFERENCE_SUPERSEDED_ACTION);
  assert.equal(bySubmitted[0].details.recordedRef, "trace-uc03-shared", "and it must point at the one in use");

  // Following that pointer lands on the request itself, in both use cases —
  // which is the whole reason the substitution happens.
  const byRecorded = audit.entries.filter((e) => e.details?.externalRef === "trace-uc03-shared");
  const useCases = new Set(byRecorded.map((e) => e.useCase));
  assert.ok(useCases.has("UC-03") && useCases.has("UC-04"), `one reference, both halves of the story: ${[...useCases]}`);
});

// ---------------------------------------------------------------------------
// 3. The rule, structurally — so it holds for a use case added later
// ---------------------------------------------------------------------------
// The behavioural sweep above only sees the types that exist today. These two
// pin the mechanism that makes it hold for the next one: the substitution check
// lives on the INTAKE ROUTE, once, above every adapter — the same placement
// argument recordIntakeRefusal() and the access gate both make — and it is
// awaited, because on the deployment the platform may freeze the invocation the
// moment the response is written.

test("the substitution check sits on the intake route, not in an adapter", () => {
  // The intake route runs from its own path match to the continue route below
  // it, so the window is the route rather than a character count that drifts.
  const from = SERVER_SRC.indexOf('isPath(parts, ["api", "requests"])');
  const to = SERVER_SRC.indexOf('isPath(parts, ["api", "requests", "uc03", "continue"])');
  assert.ok(from > 0 && to > from, "the intake route and the continue route must both still be there");
  assert.match(
    SERVER_SRC.slice(from, to),
    /await recordReferenceSubstitution\(/,
    "the intake route must record a substituted reference, and must await it"
  );
  // One call site. Seven would be seven things to remember.
  assert.equal(
    (SERVER_SRC.match(/await recordReferenceSubstitution\(/g) ?? []).length,
    1,
    "one call site: a use case added later is covered by existing, not by being remembered"
  );
});

test("an adapter that files under a different reference has to declare it", () => {
  // `recordedRef` defaults to the submitted reference, so an adapter that says
  // nothing is correct by default and only a DIVERGING one has to speak. That
  // default is the load-bearing line; if it ever became `null`, every type
  // would start writing a substitution row and the feed would fill with noise.
  assert.match(
    SERVER_SRC,
    /outcome\.envelope\.recordedRef !== undefined \? outcome\.envelope\.recordedRef : submittedRef/,
    "the route must fall back to the submitted reference for adapters that pass it straight through"
  );
  // And the one adapter that does diverge declares it beside the override.
  const uc04 = SERVER_SRC.slice(SERVER_SRC.indexOf("async uc04(body)"), SERVER_SRC.indexOf("async uc05(body)"));
  assert.match(uc04, /const externalRef = continuationCase \? continuationRef\(continuationCase\)/);
  assert.match(uc04, /recordedRef: externalRef/, "UC-04 substitutes, so UC-04 declares");
});

// ---------------------------------------------------------------------------
// 4. The other half of the split trail — the ticket id
// ---------------------------------------------------------------------------
// linkTicket() REPLACES a stored record's reference with its Zendesk ticket id,
// and everything decided about the request afterwards is filed under that id.
// On the live trail for one request the travel decision sat under
// `uc03-20260819205307-1psu2` and every row after it under `"50"`, with neither
// half naming the other — two half-stories under two ids, which is not what
// "the id that ties every record of this request together" promises.

test("a request handed to a human can still be traced by the reference its requester holds", async () => {
  const { handler, audit } = buildPortal({ zendesk: fakeZendesk() });

  // A routing raises a ticket, so the record's reference becomes the ticket id.
  const routed = await post(handler, "uc03", {
    persona: "chris",
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    externalRef: "trace-relink-1",
  });
  assert.equal(routed.body.decision, "route_to_uc04");
  assert.ok(routed.body.ticketId, "this decision must have been handed to a human for the test to mean anything");

  const relinks = audit.entries.filter((e) => e.action === REFERENCE_RELINKED_ACTION);
  assert.equal(relinks.length, 1, "the reference change must be recorded exactly once");
  assert.equal(
    relinks[0].details.externalRef,
    "trace-relink-1",
    "keyed on the requester's own reference — the only string they hold"
  );
  assert.equal(relinks[0].details.recordedRef, routed.body.ticketId, "and it names the ticket id the trail continues under");

  // Now the continuation, which files both decisions under the ticket id. The
  // requester's original reference must still reach it — in one hop.
  await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03/continue",
    body: { persona: "chris", caseId: routed.body.recordId },
  });
  await post(handler, "uc04", { ...SUBMISSIONS.uc04("trace-relink-uc04-shown"), continuationOf: routed.body.recordId });

  const hop = audit.entries.find((e) => e.details?.externalRef === "trace-relink-1" && e.details?.recordedRef);
  const continued = audit.entries.filter((e) => e.details?.externalRef === hop.details.recordedRef);
  assert.ok(
    continued.some((e) => e.useCase === "UC-04"),
    "following the pointer from the requester's reference must reach the work-authorization decision"
  );
});

test("a relink row IS written, self-keyed on the ticket id, when the requester submitted no reference — rca-v07y", async () => {
  // THE PREVIOUS VERSION OF THIS TEST asserted the opposite and was itself the
  // bug: "nothing was shown, so there is nothing to join the ticket id to" drew
  // the wrong conclusion from a true premise. `linkTicket()` still repoints the
  // STORE's `external_ref` at the ticket id whether or not a reference was
  // submitted (proved by test/portalTicket.test.js's "findable BY TICKET ID"
  // case) — but skipping the audit_log row entirely left `/audit`'s reference
  // lookup (readStore.js's `lookupRef()`, which reads ONLY audit_log) with no
  // way to ever find the ticket <-> decision join for exactly the submissions
  // that arrived with no reference of their own. Measured against production
  // 2026-08-22: 42 of 60 UC-02 decisions carried `externalRef: null` and NONE
  // carried the ticket id the hand-off actually created.
  const { handler, audit } = buildPortal({ zendesk: fakeZendesk() });
  const routed = await post(handler, "uc03", {
    persona: "chris",
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
  });
  assert.ok(routed.body.ticketId);

  const relinks = audit.entries.filter((e) => e.action === REFERENCE_RELINKED_ACTION);
  assert.equal(relinks.length, 1, "a self-relink row must exist even with no prior reference to relink FROM");
  // Self-keyed: the ticket id is now the only reference this request has, so
  // it is what `externalRef` carries — the exact field `/audit` searches.
  assert.equal(relinks[0].details.externalRef, routed.body.ticketId);
  assert.equal(relinks[0].details.recordedRef, routed.body.ticketId);
  assert.equal(relinks[0].details.ticketId, routed.body.ticketId);
  assert.match(relinks[0].details.note, /No reference was submitted/);
});

// ---------------------------------------------------------------------------
// 5. The relink row must carry the decision's reason AND its record's own
//    correlation field — rca-whir
// ---------------------------------------------------------------------------
// Before this pass, `recordTicketRelink()` wrote its OWN action name
// (`REFERENCE_RELINKED_ACTION`, "portal_reference_relinked") as `details.reason`
// and carried the record id under a key (`recordId`) no decision row anywhere
// writes — so even though the relink row is the ONLY UC-02 row carrying a
// real, numeric, joinable Zendesk ticket id (`details.ticketId`), nothing
// could correlate it back to the decision it belongs to. Measured against
// production 2026-08-22: 65 UC-02 audit rows, 21 carrying some externalRef,
// exactly ONE numeric and joinable.
//
// `src/surfaceverify/scenarios.js`'s `discoverScenarios()` deliberately does
// NOT pick this row as the scenario's `decision` (see test/
// surfaceVerifyScenarios.test.js) — doing so would silently replace the real
// gate outcome (`human_review`) with this row's own action name and stop
// every fact keyed on `.action` from ever firing. Instead it is found as a
// SIBLING of the true decision row, correlated by the same field name that
// row's own `details` already carries (`storeId` for UC-02,
// src/auditview/readStore.js's CORRELATION_FIELDS) — which is what this test
// asserts is actually written, alongside the reason.
test("a UC-02 ticket relink row carries the decision's own reason and its record's correlation field", async () => {
  const { handler, audit } = buildPortal({ zendesk: fakeZendesk() });

  const filed = await post(handler, "uc02", {
    persona: "chris",
    expenseId: "exp_sandbox_over_cap_402",
  });
  assert.equal(filed.body.decision, "human_review");
  assert.equal(filed.body.reason, "over_policy_cap");
  assert.ok(filed.body.ticketId, "an over-cap expense must be ticketed for this test to mean anything");
  assert.ok(filed.body.recordId, "the expense's own store id must be on the response for this test to mean anything");

  const relinks = audit.entries.filter((e) => e.action === REFERENCE_RELINKED_ACTION);
  assert.equal(relinks.length, 1);
  assert.equal(
    relinks[0].details.reason,
    "over_policy_cap",
    "the relink row records the DECISION's reason for readability, though discoverScenarios() no longer picks it by that field"
  );
  assert.equal(relinks[0].details.ticketId, filed.body.ticketId);
  // THE CORRELATION FIELD — the actual join key. UC-02 decision rows carry
  // their record id as `storeId` (src/uc02/workflow.js); the relink row must
  // carry the SAME field under the SAME name, or sibling correlation can never
  // find it.
  assert.equal(
    relinks[0].details.storeId,
    filed.body.recordId,
    "the relink row must carry the record's correlation field (storeId) so it can be found as the decision's sibling"
  );
});
