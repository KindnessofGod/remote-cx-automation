// ---------------------------------------------------------------------------
// portalUc03Continuation.test.js  —  UC-03 -> UC-04, as a human act
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST, AND WHY IT IS ITS OWN FILE
//
// A `route_to_uc04` now offers the employee a continuation: their trip details
// carry across, they supply the four things a travel request never states, and
// the resulting work-authorization assessment is tied back to the travel
// request that started it. The whole design rests on ONE distinction, so this
// file's job is to pin that distinction from both sides:
//
//   THE EMPLOYEE raising a work authorization is legitimate — it is Remote's
//   own flow, performed on the surface this portal stands in for.
//   UC-03's AUTOMATION raising one is refused (src/uc03/uc04Intake.js), and
//   the only thing separating the two is a deliberate, recorded human act.
//
// So the tests below check that the act is real (its own authenticated route,
// its own durable row, and no 200 if that row cannot be written), that the
// automation still cannot do it (no continuation without a human POST, and
// every crossing refused), and that nothing is created in Remote by any of it.
//
// EVERY LLM SEAM IS FAKED, the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom: this
// devcontainer carries a genuine but unreachable OPENAI_API_KEY, so a missed
// seam is a real, retried, slow network call and shows up as a jump in the
// suite's total time (CLAUDE.md §6).
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler, REFERENCE_SUPERSEDED_ACTION } from "../src/portal/server.js";
import { PERSONAS } from "../src/portal/personas.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";
import { UC04_REQUIRED_INPUTS } from "../src/uc03/uc04Intake.js";
import {
  UC04_FORM_FIELDS,
  CARRIED_FIELDS,
  continuationRef,
  checkContinuable,
  describeContinuation,
  CONTINUATION_REQUESTED,
  CONTINUATION_LINKED,
} from "../src/portal/uc03Continuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");
const CONTINUATION_SRC = readFileSync(join(__dirname, "..", "src", "portal", "uc03Continuation.js"), "utf8");

// A literal, and deliberately so: this is a TEST's own mock and the registry's
// TEST_BAND (4090-4099) is reserved for exactly this. 4098 is free —
// test/ports.test.js enforces that it stays out of every server's port.
const REMOTE_PORT = 4098;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

/** Chris Lee — the employee both the UC-03 quick-fills and this file use. */
const CHRIS = PERSONAS.chris.employmentId;
/** Emma Thompson — a DIFFERENT employee, for the ownership crossing. */
const EMMA = PERSONAS.emma.employmentId;

/** A request the rule-based classifier routes to UC-04. */
const WORKATION_TEXT =
  "I would like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?";
/** A request it auto-resolves, so it produces no handoff event at all. */
const TRIP_TEXT =
  "I am travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?";

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

/** Same in-process handler driver every other server suite in this repo uses. */
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

/**
 * A whole portal of its own per test, so an audit log or a case store from one
 * assertion can never satisfy another. Returns the handler AND its audit logger,
 * because half these tests are about which rows were written.
 */
function buildPortal({ audit = new AuditLogger(), stores = freshStores() } = {}) {
  return {
    audit,
    stores,
    handler: createPortalHandler({ remote, audit, stores, llm: FAKE_LLM }),
  };
}

const post = (h, type, body) => callApi(h, { method: "POST", path: `/api/requests/${type}`, body });
const continueTo = (h, body) =>
  callApi(h, { method: "POST", path: "/api/requests/uc03/continue", body });

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 1. The drift guards — both of which fail SILENTLY in production
// ---------------------------------------------------------------------------

// If UC-04 gains a required input and this map does not, the employee is never
// asked for it and UC-04 refuses `factors_invalid` — a refusal describing OUR
// omission while reading as a finding about their trip, which is the
// manufactured-refusal shape docs/BUILD-LOG.md §3.30 names. Read out of UC-04's
// own list rather than restated, so a local copy cannot share a typo and
// compare equal.
test("every input UC-04 requires has a form field the continuation can fill", () => {
  const mapped = new Set(UC04_FORM_FIELDS.map((f) => f.input));
  for (const required of UC04_REQUIRED_INPUTS) {
    assert.ok(
      mapped.has(required.input),
      `UC-04 requires "${required.input}" and src/portal/uc03Continuation.js maps it to no form field — ` +
        "the employee would never be asked for it and UC-04 would refuse factors_invalid describing our own gap"
    );
  }
});

// Assigning to a missing element is a no-op in the browser, not an error, so a
// renamed field id would leave the prefill writing into nothing — silently, and
// only in production, because npm test never imports app.js.
test("every field the continuation writes into exists in the real form", () => {
  const html = read("index.html");
  const ids = [
    ...UC04_FORM_FIELDS.flatMap((f) => f.fields),
    ...CARRIED_FIELDS.map((c) => c.field),
    "uc04-reasonText",
    "uc04-externalRef",
    // The banner the carried-over summary is rendered into.
    "uc04-continuation",
  ];
  for (const id of new Set(ids)) {
    assert.ok(html.includes(`id="${id}"`), `index.html has no element with id="${id}"`);
  }
});

// ---------------------------------------------------------------------------
// 2. Nationality — the one input where reading the record would "work"
// ---------------------------------------------------------------------------
//
// src/remote/mockServer.js's fixtures carry a flat `nationality`, and
// normalizeEmployment()'s early return hands the mock's flat shape back
// untouched — so `employment.nationality` is readable here and prefilling from
// it would pass every offline test forever, against a field Remote has never
// returned. GET /v1/employments/{employment_id}'s schema has ZERO occurrences of
// nationality, citizenship or passport (fetched live 2026-08-19), and so does
// Remote's own work-authorization object. This is the fixture-agrees-with-the-
// code defect §3.66 and §3.30 both name, and it is worth pinning from both
// directions because the mock makes the wrong thing easy.

test("nationality is never prefilled from the employment record", async () => {
  const { handler, stores } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-nat-1" });
  const opened = await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  assert.equal(opened.status, 200);
  const nationalityPrefill = opened.body.prefill.find((p) => p.field === "uc04-nationality");
  assert.equal(nationalityPrefill, undefined, "nationality must not be among the prefilled fields");

  // And it must be ASKED, with the "we never ask" reason rather than the "you
  // did not say" one — the two are different facts about the same blank box.
  const asked = opened.body.stillNeeded.find((s) => s.uc04Issue === "missing_nationality");
  assert.ok(asked, "nationality must appear in the still-needed list");
  assert.match(asked.why, /no source for this/);

  // AND THE FIXTURE NO LONGER CARRIES THE TRAP AT ALL, which is a stronger
  // property than "we did not read it".
  //
  // This assertion used to run the other way: it required the mock to HAVE a
  // nationality, on the reasoning that a test proving we never prefill from a
  // field is meaningless if the field is absent. Sound as far as it went, and
  // it made the fixture's invented field load-bearing in a test whose whole
  // subject is that the field should not be there. `nationality` has zero
  // occurrences in Remote's live employment capture (test/fixtures/
  // sandboxCapture.js), nothing in src/ ever read it off a record — every
  // consumer takes factors.nationality off the REQUEST, where a human supplies
  // it, which is correct precisely because Remote cannot — so its only possible
  // future was as a trap: normalizeEmployment() hands the mock's flat shape
  // back untouched, so the first person to reach for employment.nationality
  // would have got a working value offline, for ever, against a field
  // production never returns. It was removed from the fixtures (BUILD-LOG
  // §3.73). The source-level guard below is what keeps this module honest;
  // this line keeps the FIXTURE honest, and the two fail for different reasons.
  const employment = await remote.getEmployment(CHRIS);
  assert.equal(
    employment.nationality,
    undefined,
    "the mock must not carry a nationality — Remote's employment schema has no such field, and a " +
      "fixture that invents one makes reading it look correct offline for ever"
  );
});

test("the continuation module never reads a nationality off an employment record", () => {
  const code = CONTINUATION_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // The NAME appears in code — it is one of the inputs the employee is asked
  // for. What must never appear is a READ of it, or of an employment record at
  // all: this module is handed a handoff event, and an employment record is the
  // only object that could carry the field the mock invented.
  assert.ok(
    !/\.nationality\b/.test(code),
    "src/portal/uc03Continuation.js reads a `.nationality` property — the field is not on Remote's " +
      "employment schema, and the mock's having one is exactly what makes reading it look fine"
  );
  assert.ok(
    !/\bemployment\s*[.?[]/.test(code),
    "src/portal/uc03Continuation.js reads a property off an employment record — it is handed a handoff " +
      "event, and reaching for the record is how a field Remote does not return gets read"
  );
});

// ---------------------------------------------------------------------------
// 3. The offer exists only where a handoff event does
// ---------------------------------------------------------------------------

test("a routing offers the continuation, and carries origin from the record and destination from the reading", async () => {
  const { handler } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-offer-1" });

  assert.equal(routed.body.decision, "route_to_uc04");
  assert.equal(routed.body.continuation.available, true);

  const opened = await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });
  const byField = Object.fromEntries(opened.body.prefill.map((p) => [p.field, p]));

  assert.equal(byField["uc04-employmentId"].value, CHRIS);
  assert.equal(byField["uc04-homeCountry"].value, "US");
  assert.equal(byField["uc04-homeCountry"].authority, "record", "the employment's country is a record fact");
  assert.equal(byField["uc04-destinationCountry"].value, "PT");
  assert.equal(
    byField["uc04-destinationCountry"].authority,
    "reading",
    "the destination came out of free text and must be labelled as a reading, not a fact"
  );
});

// The routing gate is position 5 and the destination/duration gates are 6 and 9,
// so a `route_to_uc04` is decided BEFORE anything looks for dates. Absent has to
// stay absent: an empty string in a date input is the same pixel as an absent
// one and a different claim in a payload.
test("dates the classifier never read stay null and are asked for", async () => {
  const { handler } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-dates-1" });
  const opened = await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  const start = opened.body.prefill.find((p) => p.field === "uc04-startDate");
  assert.equal(start.value, null, "an unread date must be null, never an empty string");
  assert.ok(
    opened.body.stillNeeded.some((s) => s.uc04Issue === "missing_dates"),
    "the dates must be asked for"
  );
});

test("a decision that is not a routing offers no continuation and cannot be continued", async () => {
  const { handler } = buildPortal();
  const resolved = await post(handler, "uc03", { persona: "chris", text: TRIP_TEXT, externalRef: "cont-noroute-1" });

  assert.equal(resolved.body.decision, "auto_resolve");
  assert.equal(resolved.body.continuation.available, false, "no handoff event, so nothing to continue");

  const refused = await continueTo(handler, { persona: "chris", caseId: resolved.body.recordId });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "continuation_not_routed");
});

// ---------------------------------------------------------------------------
// 4. The act is a HUMAN act — authenticated, owned, and recorded
// ---------------------------------------------------------------------------

test("only the travelling employee may continue their own routing", async () => {
  const { handler } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-own-1" });
  const caseId = routed.body.recordId;

  const asAdmin = await continueTo(handler, { persona: "admin", caseId });
  assert.equal(asAdmin.status, 403);
  assert.equal(asAdmin.body.code, "persona_cannot_continue");

  const asOther = await continueTo(handler, { persona: "emma", caseId });
  assert.equal(asOther.status, 403);
  assert.equal(asOther.body.code, "continuation_not_yours");

  const unknown = await continueTo(handler, { persona: "not-a-persona", caseId });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.code, "unauthenticated");

  const missing = await continueTo(handler, { persona: "chris", caseId: "no-such-case" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "continuation_case_not_found");

  const unnamed = await continueTo(handler, { persona: "chris" });
  assert.equal(unnamed.status, 400);
  assert.equal(unnamed.body.code, "continuation_case_required");
});

// isPath() is a PREFIX match, so without the exact-length check a sub-resource
// that does not exist would answer 200 rather than 404 — the same defect the
// intake route's own header records paying for.
test("the continue route has no sub-resources", async () => {
  const { handler } = buildPortal();
  const deeper = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03/continue/anything",
    body: { persona: "chris" },
  });
  assert.equal(deeper.status, 404);
  assert.equal(deeper.body.code, "no_such_route");
});

test("the employee's act of intent is recorded durably, and names what was offered", async () => {
  const { handler, audit } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-audit-1" });
  await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  const row = audit.entries.find((e) => e.action === CONTINUATION_REQUESTED);
  assert.ok(row, "the continuation must write an audit row — that row IS the human act");
  assert.equal(row.actor, CHRIS, "the actor is the server's answer, from the persona map");
  assert.equal(row.details.uc03CaseId, routed.body.recordId);
  assert.equal(row.details.uc04RecordCreated, false);
  assert.equal(row.details.remoteRequestCreated, false);
  assert.ok(row.details.handoffEvent, "the row records the event that was offered, not only that one was");
  assert.equal(row.details.handoffEvent.event_type, "CROSS_BORDER_WORK_REQUESTED");
  // Selected BY NAME by src/auditview/readStore.js — a parallel shape is a row
  // that exists in Postgres and is invisible in the viewer.
  assert.equal(typeof row.details.externalRef, "string");
  assert.equal(row.details.source, "portal");
});

// THE INVERSION THAT MATTERS. Everywhere else in the portal a failed audit
// write must not break the caller's outcome. Here it must: the recorded human
// act is the ONLY thing separating this continuation from the silent dispatch
// src/uc03/uc04Intake.js refuses, so proceeding without it would produce
// exactly the refused thing while reporting success.
test("no continuation is offered if the act of intent cannot be recorded", async () => {
  const throwingAudit = new AuditLogger();
  throwingAudit.logDurable = async () => {
    throw new Error("audit store unreachable");
  };
  const { handler } = buildPortal({ audit: throwingAudit });

  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-fail-1" });
  const opened = await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  assert.notEqual(opened.status, 200, "a continuation whose human act went unrecorded must not succeed");
  assert.equal(opened.body.ok, false);
});

// ---------------------------------------------------------------------------
// 5. The link — both directions, in the durable record
// ---------------------------------------------------------------------------

test("a continued assessment is tied to the travel request that started it, both ways", async () => {
  const { handler, audit } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-link-1" });
  const caseId = routed.body.recordId;
  const opened = await continueTo(handler, { persona: "chris", caseId });

  const assessed = await post(handler, "uc04", {
    persona: "admin",
    continuationOf: caseId,
    employmentId: CHRIS,
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "PT",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    externalRef: opened.body.externalRef,
  });

  assert.equal(assessed.body.decision, "ready_for_approval");
  assert.equal(assessed.body.continuationOf.uc03CaseId, caseId);

  const link = audit.entries.find((e) => e.action === CONTINUATION_LINKED);
  assert.ok(link, "the link must be recorded where nothing rewrites it");
  // BOTH ids on ONE row is what makes the trail readable in either direction:
  // record -> travel request, and travel request -> record.
  assert.equal(link.details.uc03CaseId, caseId);
  assert.equal(link.details.uc04AuthorizationId, assessed.body.recordId);
  assert.equal(link.details.remoteRequestCreated, false);

  // And the specialist opening the work-authorization ticket is told where it
  // came from, in the details list that IS the Zendesk internal note.
  const from = assessed.body.details.find((d) => d.label === "Continued from");
  assert.ok(from, "the panel must name the travel request this continued");
  assert.match(from.value, new RegExp(caseId));
});

// The shared reference is the point of the tie, and it is safe BY DESIGN:
// workflow_claims is keyed (use_case, external_ref) precisely because "one
// ticket may legitimately reach two use cases (UC-03 routes on to UC-04)".
test("both decisions are filed under one reference", async () => {
  const { handler, audit } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-ref-1" });
  const opened = await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  await post(handler, "uc04", {
    persona: "admin",
    continuationOf: routed.body.recordId,
    employmentId: CHRIS,
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "PT",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    // Deliberately WRONG: the server re-derives the reference from the durable
    // UC-03 row, so a body cannot decide which request this is filed beside.
    externalRef: "a-reference-the-caller-made-up",
  });

  const uc04Rows = audit.entries.filter((e) => e.useCase === "UC-04" && e.details && e.details.externalRef);
  assert.ok(uc04Rows.length > 0, "UC-04 must have written at least one audited decision");

  // EVERY ROW ABOUT THE REQUEST ITSELF carries the shared reference. The one
  // exception is the row that exists precisely to say the reference was
  // substituted — it is keyed on the string the requester holds, which is the
  // whole reason it can be found by them. Selected by ACTION rather than by
  // "the rows that disagree", so a future row that quietly disagrees fails
  // here instead of being explained away.
  const decisionRows = uc04Rows.filter((e) => e.action !== REFERENCE_SUPERSEDED_ACTION);
  assert.ok(decisionRows.length > 0, "UC-04 must have written at least one audited decision");
  for (const row of decisionRows) {
    assert.equal(
      row.details.externalRef,
      opened.body.externalRef,
      "the UC-04 decision must be filed under the UC-03 request's own reference, not the caller's"
    );
  }

  // ...AND THE REFERENCE THE REQUESTER WAS SHOWN STILL FINDS THE REQUEST.
  // This is the half that was missing. The page prints the reference it sent
  // and calls it "the id that ties every record of this request together";
  // against production, `details->>'externalRef' like 'uc04-2026%'` returned
  // zero rows while the decision sat under the ticket id. Substituting is
  // right; substituting silently is not.
  const substitutions = audit.entries.filter((e) => e.action === REFERENCE_SUPERSEDED_ACTION);
  assert.equal(substitutions.length, 1, "one substitution, recorded once");
  assert.equal(
    substitutions[0].details.externalRef,
    "a-reference-the-caller-made-up",
    "the substitution row must be keyed on the reference the REQUESTER holds — it is the only string they can quote"
  );
  assert.equal(
    substitutions[0].details.recordedRef,
    opened.body.externalRef,
    "and it must name the reference everything else is filed under, so the trail continues"
  );
  // Named for what it is. `externalRef` keeps one meaning per row.
  assert.notEqual(substitutions[0].details.recordedRef, substitutions[0].details.externalRef);
  assert.match(substitutions[0].details.note, new RegExp(opened.body.externalRef));
});

// The ordinary case writes nothing. A row per submission saying "your
// reference is your reference" is noise, and a feed that is mostly noise
// trains its reader to stop looking.
test("no substitution row when the requester's reference is the one used", async () => {
  const { handler, audit } = buildPortal();
  await post(handler, "uc04", {
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
    externalRef: "plain-uc04-ref-1",
  });

  assert.equal(
    audit.entries.filter((e) => e.action === REFERENCE_SUPERSEDED_ACTION).length,
    0,
    "an ordinary admin-filed assessment substitutes nothing and must record nothing"
  );
  const decided = audit.entries.filter((e) => e.details?.externalRef === "plain-uc04-ref-1");
  assert.ok(decided.length > 0, "and the requester's own reference still finds the decision");
});

// ---------------------------------------------------------------------------
// THE IDEMPOTENCY HALF
// ---------------------------------------------------------------------------
// Recording the substitution changes what is WRITTEN, never what is CLAIMED —
// and the claim is the exactly-once guarantee, so it is pinned in both
// directions rather than reasoned about. `workflow_claims`' primary key is
// `(use_case, external_ref)`, keyed that way in CLAUDE.md §4 "because one
// ticket may legitimately reach two use cases (UC-03 routes on to UC-04)".
// That is this case, arriving:
//
//   * the routing and the assessment continuing it are TWO claims under ONE
//     string, because they differ in the first column; and
//   * a genuine redelivery of either is still refused at the key.
//
// It needs a pool that really enforces the constraint. `claimExternalRef()`
// documents its unconfigured path plainly — with no ledger it proceeds rather
// than faking the guarantee in memory — so a test without one would assert
// nothing at all while passing. Same double, and same reasoning, as
// test/portalTicket.test.js's.
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

function ledgerBackedPortal() {
  const pgPool = fakeLedgerPool();
  const stores = freshStores();
  for (const store of Object.values(stores)) store.pgPool = pgPool;
  return { ...buildPortal({ stores }), pgPool };
}

const ASSESSMENT = {
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
};

test("a UC-03 routing and the UC-04 assessment continuing it are two claims, not one", async () => {
  const { handler, pgPool } = ledgerBackedPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "claim-pair-1" });
  await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  const assessed = await post(handler, "uc04", {
    ...ASSESSMENT,
    continuationOf: routed.body.recordId,
    externalRef: "a-different-string-entirely",
  });

  assert.equal(routed.body.recordedRef, "claim-pair-1");
  assert.equal(assessed.body.recordedRef, "claim-pair-1", "the assessment is filed under the travel request's reference");
  assert.ok(assessed.body.recordId, "and it produced its own record");

  // TWO rows, ONE string. Neither swallowed the other.
  assert.ok(pgPool.claims.has("UC-03::claim-pair-1"), "the routing claimed its own reference");
  assert.ok(pgPool.claims.has("UC-04::claim-pair-1"), "the assessment claimed the same reference in its own use case");
  // And the reference the requester was shown claimed NOTHING — it is not a
  // delivery key, it is a pointer, which is exactly what the substitution row
  // says about it.
  assert.ok(!pgPool.claims.has("UC-04::a-different-string-entirely"));
});

test("a redelivery of a continued assessment is still refused at the key", async () => {
  const { handler, audit, pgPool } = ledgerBackedPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "claim-dupe-1" });
  await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  const first = await post(handler, "uc04", { ...ASSESSMENT, continuationOf: routed.body.recordId, externalRef: "shown-once" });
  const second = await post(handler, "uc04", { ...ASSESSMENT, continuationOf: routed.body.recordId, externalRef: "shown-twice" });

  assert.ok(first.body.recordId, "the first delivery was decided");
  assert.equal(second.body.alreadyHandled, true, "the second was refused at the ledger, not re-decided");
  assert.equal(second.body.recordId ?? null, null, "and it wrote no second record");
  assert.equal(pgPool.claims.size, 2, "two claims: UC-03's and UC-04's — the redelivery added none");

  // The substitution row is written for the refused delivery too, and it has
  // to be: the requester was shown `shown-twice` and told it traces their
  // request. A redelivery that leaves them holding an unresolvable id is the
  // same defect one layer along.
  const superseded = audit.entries.filter((e) => e.action === REFERENCE_SUPERSEDED_ACTION);
  assert.deepEqual(
    superseded.map((e) => e.details.externalRef).sort(),
    ["shown-once", "shown-twice"],
    "every reference the requester was shown resolves, including the redelivery's"
  );
});

test("a continuation naming a case that is not a UC-03 routing is refused, not absorbed", async () => {
  const { handler } = buildPortal();
  const resolved = await post(handler, "uc03", { persona: "chris", text: TRIP_TEXT, externalRef: "cont-bad-1" });

  const notRouted = await post(handler, "uc04", {
    persona: "admin",
    continuationOf: resolved.body.recordId,
    employmentId: CHRIS,
    destinationCountry: "PT",
    nationality: "US",
    homeCountry: "US",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
  });
  assert.equal(notRouted.status, 404);
  assert.equal(notRouted.body.code, "continuation_not_found");
});

test("a continued assessment cannot point at another employee's trip", async () => {
  const { handler } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-subj-1" });

  const mismatched = await post(handler, "uc04", {
    persona: "admin",
    continuationOf: routed.body.recordId,
    employmentId: EMMA,
    destinationCountry: "PT",
    nationality: "GB",
    homeCountry: "GB",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
  });
  assert.equal(mismatched.status, 403);
  assert.equal(mismatched.body.code, "continuation_subject_mismatch");
});

// ---------------------------------------------------------------------------
// 6. Nothing is created in Remote — and the verdict says so
// ---------------------------------------------------------------------------
//
// src/uc04/requestLink.js resolves a decision with no matching Remote request
// as `unlinked` — Remote answering "no such request", which is an ANSWER and
// not a failure. This build must not defeat that, and the requester must be
// told the verdict has nowhere to go yet.

test("a continued assessment has no Remote counterpart, and says so", async () => {
  const { handler } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-remote-1" });
  await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  const assessed = await post(handler, "uc04", {
    persona: "admin",
    continuationOf: routed.body.recordId,
    employmentId: CHRIS,
    homeCountry: "US",
    nationality: "US",
    destinationCountry: "PT",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
  });

  const line = assessed.body.details.find((d) => d.label === "Remote work-authorization request");
  assert.ok(line, "the panel must say which Remote request this attaches to");
  assert.ok(
    !/this decision will be recorded against it at Remote/.test(line.value),
    "no Remote work-authorization request exists, so nothing may claim the verdict is transmittable"
  );

  const from = assessed.body.details.find((d) => d.label === "Continued from");
  assert.match(
    from.value,
    /still has to file it in Remote/,
    "the requester must be told the employee still has to raise the real request"
  );
});

test("the continuation creates nothing anywhere — no Remote write, no UC-04 record", async () => {
  const { handler, stores } = buildPortal();
  const routed = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "cont-none-1" });
  const opened = await continueTo(handler, { persona: "chris", caseId: routed.body.recordId });

  assert.equal(opened.status, 200);
  assert.equal(
    stores.uc04.authorizations.length,
    0,
    "continuing must create no UC-04 record — the employee has asked, not submitted"
  );
});

// The structural half of the same guarantee, asserted the way test/uc08.test.js
// asserts the 🔴 tier's: against the source with comments stripped, so a comment
// promising restraint cannot pass for the restraint itself.
test("the continuation module cannot write anywhere", () => {
  const code = CONTINUATION_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const forbidden of ["createWorkAuthorization", "updateWorkAuthorization", "patch", "createTicket", "pgPool"]) {
    assert.ok(
      !code.includes(forbidden),
      `src/portal/uc03Continuation.js references ${forbidden} — it is a pure describer and must call nothing`
    );
  }
});

// ---------------------------------------------------------------------------
// 7. The pure module, on its own
// ---------------------------------------------------------------------------

test("a case with no reference of its own still gets a stable one", () => {
  assert.equal(continuationRef({ id: "abc", externalRef: "2000" }), "2000");
  assert.equal(continuationRef({ id: "abc", externalRef: "  " }), "uc03-case-abc");
  assert.equal(continuationRef({ id: "abc" }), "uc03-case-abc");
  // Stable across calls — a random reference would claim a fresh key in
  // workflow_claims on every attempt and defeat the ledger it is fed to.
  assert.equal(continuationRef({ id: "abc" }), continuationRef({ id: "abc" }));
});

test("checkContinuable names the real refusal, one at a time", () => {
  assert.equal(checkContinuable(null, CHRIS).code, "continuation_case_not_found");
  assert.equal(
    checkContinuable({ id: "1", useCase: "UC-01", decision: "route_to_uc04", employmentId: CHRIS }, CHRIS).code,
    "continuation_not_a_travel_request"
  );
  assert.equal(
    checkContinuable({ id: "1", useCase: "UC-03", decision: "auto_resolve", employmentId: CHRIS }, CHRIS).code,
    "continuation_not_routed"
  );
  assert.equal(
    checkContinuable({ id: "1", useCase: "UC-03", decision: "route_to_uc04", employmentId: EMMA }, CHRIS).code,
    "continuation_not_yours"
  );
  assert.equal(
    checkContinuable({ id: "1", useCase: "UC-03", decision: "route_to_uc04", employmentId: CHRIS }, null).code,
    "continuation_not_yours",
    "no session employment id must fail closed, not pass by matching nothing"
  );
  assert.deepEqual(
    checkContinuable({ id: "1", useCase: "UC-03", decision: "route_to_uc04", employmentId: CHRIS }, CHRIS),
    { ok: true }
  );
});

test("describeContinuation answers the same shape whether or not a continuation exists", () => {
  const none = describeContinuation({ handoffEvent: null, intake: null, caseRow: null });
  assert.equal(none.available, false);
  assert.deepEqual(none.prefill, []);
  assert.deepEqual(none.stillNeeded, []);
  // The notice travels either way, so a caller has one shape to read.
  //
  // WHAT IT USED TO BE, AND WHY IT IS NOT THAT ANY MORE. This assertion read
  // `none.fileItInRemote.steps.length >= 3` and its comment said a requester
  // "may still need to know who raises an RWA". The four steps it was counting
  // narrated Remote's own Requests section back to a Remote employee, from a
  // support tool, and the paragraph under them explained which API operations
  // exist — our engineering constraint, printed to a traveller. The project
  // owner's judgement, and it is right: "we are supposed to implement it, not
  // tell Remote how they do their thing."
  //
  // So the assertion moved with the copy rather than being deleted: what
  // survives is a headline that names the DECISION ("this is a different
  // request"), one sentence of honesty about what continuing does and does not
  // do, and the words on the two buttons. The reasoning behind the removal
  // lives in WORK_AUTHORIZATION_NOTICE's own header.
  assert.match(none.notice.headline, /needs authorization/i);
  assert.match(none.notice.sentence, /nothing is submitted until you send that form/i);
  assert.ok(none.notice.action && none.notice.dismiss, "both buttons need their words from the server");
  assert.equal(none.fileItInRemote, undefined, "the Requests-section procedure must not come back");
});

// ---------------------------------------------------------------------------
// 8. The browser half, which npm test never imports
// ---------------------------------------------------------------------------

test("the page decides nothing about the continuation itself", () => {
  const app = read("app.js");
  // Comments stripped, because this file's own prose NAMES the comparison it is
  // promising not to make — a promise that matched its own text would be the
  // check passing on the strength of the claim rather than the code.
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // The offer is rendered on the server's `available` flag. A decision-string
  // comparison here would be a second copy of UC-03's routing rule, in the one
  // place nothing type-checks.
  assert.ok(/payload\.continuation/.test(code), "the offer must be read off the server's response");
  assert.ok(/\.available !== true/.test(code), "the offer must branch on the server's flag");
  assert.ok(
    !/["']route_to_uc04["']\s*===|===\s*["']route_to_uc04["']/.test(code),
    "app.js compares against the route_to_uc04 decision string — the server already answered that question"
  );
  // And the link it sends is a NAME the server re-reads, never a set of facts.
  assert.ok(/continuationOf: pendingContinuation/.test(code), "the UC-04 body must carry the case id");
});

test("the page reaches the continuation route, and only ever with a case id", () => {
  const app = read("app.js");
  assert.ok(app.includes("api/requests/uc03/continue"), "app.js must call the continue route");
  // Relative, like every other call on this page: the portal is also mounted
  // under /portal on the deployment, where an absolute path 404s.
  assert.ok(!app.includes('"/api/requests/uc03/continue"'), "the continue route must be addressed relatively");
});

test("the admin persona is found, never written down", () => {
  const app = read("app.js");
  assert.ok(
    /p\.kind === "company_admin"/.test(app),
    "the assessment's persona must be found by kind — a literal key would be a second copy of personas.js"
  );
  const adminKeys = Object.values(PERSONAS).filter((p) => p.kind === "company_admin");
  assert.ok(adminKeys.length >= 1, "the roster must offer a company admin for the assessment step");
});

// ---------------------------------------------------------------------------
// 9. The interruption, and the copy that came off the page to make room
// ---------------------------------------------------------------------------
// A `route_to_uc04` is not a finding about the trip — it is a REDIRECTION, and
// the panel used to announce it at the very bottom, under the gate ladder and
// the facts table, several screens below the fold. The one person who can
// unblock the request was the one person who would never scroll to the button.
// So the decision now interrupts: the notice is the first thing after the
// outcome, and it is shown as a modal the moment the result renders.
//
// A MODAL IS ONLY ALLOWED HERE BECAUSE THE BROWSER SUPPLIES ITS ACCESSIBILITY.
// `<dialog>.showModal()` traps focus, closes on Escape, makes the rest of the
// page inert and restores focus on close. A hand-rolled overlay does none of
// those, and the hand-rolled focus traps people write are subtly wrong — an
// inaccessible dialog would be worse than the wall of text it replaces. These
// tests pin the four properties that make it usable, and the fifth that makes
// it honest: dismissing it must not take the information away.
// ---------------------------------------------------------------------------

test("the interstitial is a real dialog, labelled, dismissible, and degrades to the page", () => {
  const app = read("app.js");
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // The browser's own dialog, and a capability check rather than a version
  // guess — a browser without showModal simply leaves the node on the page.
  assert.match(code, /el\("dialog", "interstitial-dialog"\)/);
  assert.match(code, /typeof document\.createElement\("dialog"\)\.showModal !== "function"\) return null;/);
  assert.match(code, /dialog\.showModal\(\);/);

  // LABELLED BY THE ANSWER'S HEADING, and by a heading rather than by a string
  // this file typed: whichever block leads the dialog carries the id and the
  // dialog points at that same element, so the visible title and the accessible
  // name cannot drift apart. Two ids exist because two blocks can lead — the
  // ANSWER whenever there is one, the promoted offer as the fallback for a
  // payload that carries none. Neither is ever written out twice.
  assert.match(code, /var ANSWER_TITLE_ID = "[^"]+";/);
  assert.match(code, /var INTERSTITIAL_TITLE_ID = "[^"]+";/);
  assert.match(code, /lead\.id = ANSWER_TITLE_ID;/);
  assert.match(code, /heading\.id = INTERSTITIAL_TITLE_ID;/);
  assert.match(code, /dialog\.setAttribute\("aria-labelledby", title\.id\)/);
  assert.match(
    code,
    /var title = live\[0\]\.querySelector\("\.plain-answer-lead, \.interstitial-title"\);/,
    "the dialog must be named by the FIRST block in it — the answer when there is one"
  );

  // ESCAPE AND THE BUTTON END IN THE SAME PLACE. `close` fires for the
  // browser's own dismissal as well as for close(), so both paths run restore()
  // — the only arrangement in which they cannot diverge.
  assert.match(code, /dialog\.addEventListener\("close", restore\)/);
  assert.match(code, /dismiss\.addEventListener\("click", function \(\) \{\s*dialog\.close\(\);/);

  // AND DISMISSING TAKES NOTHING AWAY. Every block is moved back to where it
  // was in the result rather than destroyed, so a dismissed notice is a quieter
  // notice and never a missing one — and the walk is BACKWARDS, because the
  // answer's remembered anchor is the recommendation, which has to be back on
  // the page before anything can be inserted in front of it.
  assert.match(code, /spots\[i\]\.home\.insertBefore\(spots\[i\]\.node, spots\[i\]\.anchor\)/);
  assert.match(code, /for \(var i = spots\.length - 1; i >= 0; i -= 1\)/);
});

test("the notice is the first thing in the result, and is shown only after it is on the page", () => {
  const app = read("app.js");
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const head = code.indexOf("wrap.appendChild(head);");
  const built = code.indexOf("var offers = offersOn(payload);");
  const reference = code.indexOf("if (sentRef) wrap.appendChild(referenceLine(sentRef));");
  assert.ok(head !== -1 && built !== -1 && reference !== -1);
  assert.ok(built > head && built < reference, "the notice must sit at the top of the result, above the reference");

  // showModal() moves focus, and moving focus into a node that is not yet in
  // the document is how a dialog ends up unreachable by a keyboard.
  const inDocument = code.indexOf("box.appendChild(wrap);");
  const presented = code.indexOf("presentResultDialog([answerBlock, interstitial])");
  assert.ok(presented !== -1, "render() no longer opens the dialog — re-point this test");
  assert.ok(presented > inDocument, "the dialog must be opened only after the result is in the document");
  // AND THE ANSWER LEADS IT. The order of that array is the order the blocks
  // are read in and the order they sit in on the page; putting the offer first
  // would put a recommendation above the answer it is a recommendation about.
  const args = code.slice(presented, code.indexOf(")", presented));
  assert.ok(args.indexOf("answerBlock") < args.indexOf("interstitial"), "the answer must lead the dialog");
});

test("the result panel no longer narrates Remote's product or our API surface", () => {
  // THE EDITORIAL RULE, PINNED. "Would a Remote employee learn something they
  // need from this sentence, or is this the system explaining itself?" The
  // second kind goes. Statements about what this system DID stay — they are how
  // a requester knows whether anything is waiting on them.
  const app = read("app.js");
  const continuation = readFileSync(join(__dirname, "..", "src", "portal", "uc03Continuation.js"), "utf8");
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const contCode = continuation.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  for (const gone of [
    "New request → Remote Work Authorization",
    "No API creates a work-authorization request",
    "that is Remote's own stated notice period",
    "second, unaudited place",
    "no execution path to expose",
  ]) {
    assert.ok(!code.includes(gone), "the page still prints removed copy: " + gone);
    assert.ok(!contCode.includes(gone), "the payload still carries removed copy: " + gone);
  }

  // AND THE FACTS SURVIVE, which is the half this edit must not take. Each of
  // these is a statement about our own behaviour, and a requester needs every
  // one of them to know what is waiting on whom.
  // BOTH OF THESE MOVED, and neither went. They were nextStep()'s two
  // sentences, written in the browser off `executionPath` alone; they are now
  // written by src/portal/plainAnswer.js, which knows the decision too and so
  // can tell an approval from a hand-off. Asserted against that module rather
  // than against app.js, because that is where the words live now — and the
  // facts themselves are pinned by test/portalPlainAnswer.test.js, driven
  // through the real handlers rather than matched against source.
  const answers = readFileSync(join(__dirname, "..", "src", "portal", "plainAnswer.js"), "utf8");
  assert.match(answers, /waiting on one specialist at/);
  assert.match(answers, /here or anywhere else in this system/);
  assert.match(contCode, /nothing is submitted until you send that form/);
  assert.match(contCode, /asked rather than filled in for you/);
});
