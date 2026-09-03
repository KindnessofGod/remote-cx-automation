// ---------------------------------------------------------------------------
// uc04MobilityReview.test.js  —  STAGE 3: Remote's own mobility review,
//                                recorded here and never sent to Remote
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST, AND THE ONE THING THAT MUST NEVER BREAK
//
// A work authorization has three deciders (UC-04.md §1a): the employee files,
// the CUSTOMER'S OWN MANAGER approves (the only decision Remote's API accepts —
// `PATCH` takes exactly `approved_by_manager` / `declined_by_manager`), and
// REMOTE'S MOBILITY TEAM reviews what the employer approved. Remote publishes
// NO ENDPOINT for that third stage.
//
// Until 2026-08-31 the conclusion drawn from that was "so the sidebar offers
// nothing", and the reviewer had nowhere to put a decision they were
// nonetheless expected to make. The resolution is to record it HERE and SAY SO.
// This file exists to make sure the second half of that sentence cannot rot:
//
//   · `approved_by_remote` / `declined_by_remote` are written on NO path —
//     asserted STRUCTURALLY (they appear in no payload-building code in
//     src/uc04/, and `submitMobilityReview()` has no Remote client to send one
//     with) and BEHAVIOURALLY (a real clearance is driven end to end against a
//     recording Remote client that fails the test if it is touched at all).
//   · The notice saying "this is not sent to Remote" reaches the reviewer
//     BEFORE the click, the audit row, the employee's status page and the
//     document — always the same server-composed string, never a paraphrase.
//   · Stage 3 is refused out of order, unentitled, and unsigned.
//   · The employee can see each stage, and can collect a record only once the
//     last of the three decisions is in.
//
// HERMETIC: mock Remote dispatched in-process, no port bound, every LLM seam
// injected as an offline stub (CLAUDE.md §6 — a genuine but unreachable
// OPENAI_API_KEY in this devcontainer makes an un-injected call a real,
// retried, billed request).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest, submitWorkationApproval, submitMobilityReview } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler, sidebarActionability } from "../src/uc04/server.js";
import { settledFacts } from "../src/uc04/approvalPolicy.js";
import {
  evaluateMobilityReview,
  describeMobilityReview,
  MOBILITY_REVIEW_SHORT_LABELS,
  employerApprovalState,
  MOBILITY_REVIEW_AUDIT_ACTIONS,
  MOBILITY_REVIEW_VERDICT_ACTIONS,
  MOBILITY_REVIEW_NOTICE,
  MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE,
} from "../src/uc04/mobilityReview.js";
import { readMobilityReview } from "../src/uc04/mobilityReviewLog.js";
import { renderWorkAuthorizationRecordHtml } from "../src/uc04/authorizationRecord.js";
import { evaluateAuthorizationRecordDelivery } from "../src/uc04/recordDelivery.js";
import { createEntitlementChecker, parseRoster } from "../src/review/approverEntitlement.js";

import { createPortalHandler } from "../src/portal/server.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

// The one ZAF harness, shared rather than copied — see its own header for why.
import { renderSidebar, callHandler } from "./fixtures/zafSidebar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_UC04 = join(__dirname, "..", "src", "uc04");

// --- the LLM seams, faked. See the header. ---------------------------------
const offline = { isConfigured: () => false };
const fakeDraftSummary = (args) => draftSummary(args, offline);
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: fakeDraftSummary,
  judge: (args) => judgeNarrative(args, offline),
};

const FACTORS = {
  homeCountry: "DE",
  nationality: "DE",
  // ES matches the mock's own pending work-authorization request for
  // emp_active_001, so the employer's approval really resolves a record.
  destination: { country: "ES" },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
};

function remoteClient() {
  return new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
}

function world() {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();
  const remote = remoteClient();
  return { audit, authorizationStore, remote };
}

/** A request the employer may approve, on a Zendesk ticket so both routes reach it. */
function seedApprovable(w, externalRef = "9501") {
  return handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: FACTORS,
      now: "2026-08-15",
      externalRef,
    },
    { ...w, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

/** Seed, then let the customer's manager approve — i.e. reach the start of stage 3. */
async function seedEmployerApproved(w, externalRef = "9501") {
  const created = await seedApprovable(w, externalRef);
  const approved = await submitWorkationApproval(
    { authorizationId: created.authorizationId, action: "approve", approver: "manager@company.test", note: "Fine by me." },
    { ...w, entitlement: null }
  );
  assert.equal(approved.ok, true, "the fixture stopped being approvable by the employer");
  return created.authorizationId;
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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

// ===========================================================================
// 1. `approved_by_remote` IS NEVER WRITTEN — the non-negotiable one
// ===========================================================================

test("no file under src/uc04/ ever builds a payload carrying approved_by_remote or declined_by_remote", () => {
  // STRUCTURAL. Comments are stripped first, because both strings are DISCUSSED
  // at length in this use case's headers (that is the point — the reasoning has
  // to survive) and a naive grep would either fail forever or have to be
  // weakened into uselessness. What must not exist is the value in CODE.
  const files = [
    "workflow.js",
    "server.js",
    "approvalPolicy.js",
    "mobilityReview.js",
    "mobilityReviewLog.js",
    "authorizationRecord.js",
    "recordDelivery.js",
  ];
  for (const file of files) {
    const source = readFileSync(join(SRC_UC04, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const forbidden of ['"approved_by_remote"', "'approved_by_remote'", '"declined_by_remote"', "'declined_by_remote'"]) {
      assert.ok(
        !source.includes(forbidden),
        `src/uc04/${file} contains the literal ${forbidden} in code — Remote publishes no endpoint that sets it, ` +
          "and writing it records that Remote approved a work authorization Remote has never seen"
      );
    }
  }
});

test("submitMobilityReview has no Remote client, so no edit to it can reach Remote", () => {
  // The strongest half of the guarantee, and it is a property of the SIGNATURE
  // rather than of anyone's discipline: there is no `remote` in scope inside
  // that function to call.
  const source = readFileSync(join(SRC_UC04, "workflow.js"), "utf8");
  const start = source.indexOf("export async function submitMobilityReview");
  assert.ok(start > -1, "submitMobilityReview was not found");
  const signature = source.slice(start, source.indexOf(")", source.indexOf("{ audit", start)) + 1);
  assert.ok(!/\bremote\b/.test(signature), `submitMobilityReview grew a Remote dependency:\n${signature}`);
});

test("a real clearance touches Remote not once, and says so in every place it is published", async () => {
  // BEHAVIOURAL, against a client that fails the test on ANY call. The
  // structural check above cannot see a dynamic import or a client smuggled in
  // through the store; this can.
  const w = world();
  const authorizationId = await seedEmployerApproved(w, "9510");

  const before = w.audit.entries.length;
  const result = await submitMobilityReview(
    { authorizationId, action: "clear", reviewer: "mobility@remote.test", note: "Cleared on the facts." },
    { audit: w.audit, authorizationStore: w.authorizationStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "workation_mobility_review_cleared");
  assert.equal(result.sentToRemote, false);
  assert.match(result.reason, /not sent to Remote/i);
  assert.equal(result.mobilityReview.sentToRemote, false);
  assert.equal(result.mobilityReview.remoteEndpointExists, false);

  // The audit row: durable, named, findable, and NOT claiming a Remote write.
  const rows = w.audit.entries.slice(before).filter((e) => MOBILITY_REVIEW_VERDICT_ACTIONS.has(e.action));
  assert.equal(rows.length, 1, "exactly one stage-3 verdict row per clearance");
  const row = rows[0];
  assert.equal(row.useCase, "UC-04");
  assert.equal(row.action, MOBILITY_REVIEW_AUDIT_ACTIONS.clear);
  assert.equal(row.actor, "mobility@remote.test");
  assert.equal(row.details.authorizationId, authorizationId);
  // src/auditview/readStore.js searches `details->>'externalRef'` BY NAME — a
  // row without it cannot be found from the one id a human holds.
  assert.equal(row.details.externalRef, "9510");
  assert.equal(row.details.sentToRemote, false);
  assert.equal(row.details.notice, MOBILITY_REVIEW_NOTICE);
  // `remoteResult` must be ABSENT, not null: readStore.js's summarize() reads
  // `hasOwnProperty(details, "remoteResult")`, so writing the key at all would
  // make this row report a Remote write in the audit viewer.
  assert.equal(
    Object.prototype.hasOwnProperty.call(row.details, "remoteResult"),
    false,
    "the stage-3 row carries a remoteResult key — the audit viewer will report a Remote write that never happened"
  );
});

// ===========================================================================
// 2. THE THREE REFUSALS THE BRIEF NAMES
// ===========================================================================

test("stage 3 is refused when the employer has not approved — by its own name", async () => {
  const w = world();
  const created = await seedApprovable(w, "9520");

  const result = await submitMobilityReview(
    { authorizationId: created.authorizationId, action: "clear", reviewer: "mobility@remote.test" },
    { audit: w.audit, authorizationStore: w.authorizationStore }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "employer_approval_not_recorded");
  assert.match(result.reason, /comes AFTER the employer's approval/i);
  // AND NOTHING WAS RECORDED. A refusal that still wrote a verdict row would be
  // worse than no gate at all.
  assert.equal(await readMobilityReview({ audit: w.audit, authorizationId: created.authorizationId }), null);
});

test("stage 3 is refused when the EMPLOYER DECLINED, under a different code from 'not yet'", async () => {
  // Two different afternoons of work for whoever reads the refusal: one waits,
  // the other never happens. Collapsing them into "pending" would tell a
  // reviewer to come back for a trip that is over.
  const w = world();
  const created = await seedApprovable(w, "9521");
  const declined = await submitWorkationApproval(
    { authorizationId: created.authorizationId, action: "decline", approver: "manager@company.test", note: "No." },
    { ...w }
  );
  assert.equal(declined.ok, true);

  const result = await submitMobilityReview(
    { authorizationId: created.authorizationId, action: "clear", reviewer: "mobility@remote.test" },
    { audit: w.audit, authorizationStore: w.authorizationStore }
  );
  assert.equal(result.code, "employer_declined");
  assert.notEqual(result.code, "employer_approval_not_recorded");
});

test("stage 3 is refused for an unentitled reviewer, and the entitlement is consulted LAST", async () => {
  const roster = parseRoster("sam@remote.test=mobility_specialist");
  const entitlement = createEntitlementChecker({ grants: roster, source: "test roster" });

  const w = world();
  const authorizationId = await seedEmployerApproved(w, "9530");

  const refused = await submitMobilityReview(
    { authorizationId, action: "clear", reviewer: "random.agent@remote.test" },
    { audit: w.audit, authorizationStore: w.authorizationStore, entitlement }
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "approver_not_entitled");
  assert.equal(await readMobilityReview({ audit: w.audit, authorizationId }), null);

  // The rostered reviewer gets through the same gate.
  const allowed = await submitMobilityReview(
    { authorizationId, action: "clear", reviewer: "sam@remote.test" },
    { audit: w.audit, authorizationStore: w.authorizationStore, entitlement }
  );
  assert.equal(allowed.ok, true, allowed.reason);
});

test("entitlement never masks the real reason — an out-of-order attempt reports the ordering, not the role", () => {
  // CONSULTED LAST is the property, and it is worth its own assertion: an
  // unentitled person attempting an out-of-order review must read
  // `employer_approval_not_recorded`, because fixing their roster entry would
  // not have helped.
  const entitlement = { check: () => ({ allowed: false, code: "approver_not_entitled", reason: "no", status: 403 }) };
  const verdict = evaluateMobilityReview({
    authorizationRow: { id: "a", status: "pending_specialist_approval", flags: [] },
    reviewer: "nobody@remote.test",
    action: "clear",
    entitlement,
  });
  assert.equal(verdict.code, "employer_approval_not_recorded");
});

test("stage 3 refuses without a signed identity where the posture requires one", async () => {
  const w = world();
  const authorizationId = await seedEmployerApproved(w, "9540");

  // The deployment posture: signed identity required, no verifier provisioned.
  // Fails CLOSED and by its own name — the same shape as every other write
  // route on this API.
  const strict = createUc04Handler({ ...w, requireSignedIdentity: true, zafVerifier: null });
  const refused = await callApi(strict, {
    method: "POST",
    path: `/api/authorizations/${authorizationId}/mobility-review`,
    body: { action: "clear", approver: "mobility@remote.test" },
  });
  assert.equal(refused.body.ok, false);
  assert.ok(refused.status === 401 || refused.status === 500, `expected a refusal, got ${refused.status}`);
  assert.notEqual(refused.body.code, "workation_mobility_review_cleared");
  assert.equal(await readMobilityReview({ audit: w.audit, authorizationId }), null);

  // A NAME IN THE BODY IS NOT AN IDENTITY. The refusal above must not be
  // escapable by supplying a more plausible-looking one.
  const stillRefused = await callApi(strict, {
    method: "POST",
    path: `/api/authorizations/${authorizationId}/mobility-review`,
    body: { action: "clear", approver: "head.of.mobility@remote.com" },
  });
  assert.equal(stillRefused.body.ok, false);
});

test("a second review is refused, and the refusal names who already made the first", async () => {
  const w = world();
  const authorizationId = await seedEmployerApproved(w, "9550");
  await submitMobilityReview(
    { authorizationId, action: "clear", reviewer: "first@remote.test" },
    { audit: w.audit, authorizationStore: w.authorizationStore }
  );

  const second = await submitMobilityReview(
    { authorizationId, action: "decline", reviewer: "second@remote.test" },
    { audit: w.audit, authorizationStore: w.authorizationStore }
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "mobility_review_already_recorded");
  assert.match(second.reason, /first@remote\.test/);

  // And the stored verdict is still the FIRST one.
  const review = await readMobilityReview({ audit: w.audit, authorizationId });
  assert.equal(review.outcome, "cleared");
  assert.equal(review.reviewer, "first@remote.test");
});

test("an unknown verb is refused rather than normalised into a valid one", async () => {
  const w = world();
  const authorizationId = await seedEmployerApproved(w, "9560");
  for (const action of ["approve", "sign_off", "", null]) {
    const result = await submitMobilityReview(
      { authorizationId, action, reviewer: "mobility@remote.test" },
      { audit: w.audit, authorizationStore: w.authorizationStore }
    );
    assert.equal(result.code, "unknown_action", `"${action}" was accepted as a stage-3 verb`);
  }
  // `approve` in particular: it is the EMPLOYER's verb on this same use case,
  // and the two stages sharing one word is how one comes to be believed to
  // perform the other.
  assert.equal(await readMobilityReview({ audit: w.audit, authorizationId }), null);
});

// ===========================================================================
// 3. THE ROUTE — ordering, and what the sidebar is told
// ===========================================================================

test("POST /:id/mobility-review is not read as an approval verb by the employer route", async () => {
  // ROUTE ORDERING. `/:id/:action` matches any third segment, so without the
  // stage-3 route coming first a live clearance would be reported as a typo
  // (`unknown_action`) — or worse, canonicalised into something else.
  const w = world();
  const authorizationId = await seedEmployerApproved(w, "9570");
  const handler = createUc04Handler(w);

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/authorizations/${authorizationId}/mobility-review`,
    body: { action: "clear", approver: "mobility@remote.test" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.code, "workation_mobility_review_cleared");
  assert.equal(res.body.sentToRemote, false);
});

test("the sidebar opens for stage 3 only after the employer has approved, and never for stage 2", async () => {
  const w = world();
  const handler = createUc04Handler(w);
  const created = await seedApprovable(w, "9580");

  // BEFORE: the employer's decision is outstanding. This is the 2026-08-30
  // guarantee and it is unchanged — the sidebar may not make the customer's
  // decision, however approvable the request is.
  const pending = await callApi(handler, { method: "GET", path: "/api/authorizations/by-ticket/9580" });
  assert.equal(pending.body.employerActionable, true, "the fixture stopped being approvable by the employer");
  assert.equal(pending.body.actionable, false, "the sidebar is being offered the customer's decision again");
  assert.equal(pending.body.mobilityReview.state, "not_reached");
  assert.equal(pending.body.mobilityReview.openHere, false);

  // AFTER the employer approves: stage 3 is this screen's, and it opens.
  await submitWorkationApproval(
    { authorizationId: created.authorizationId, action: "approve", approver: "manager@company.test" },
    { ...w }
  );
  const open = await callApi(handler, { method: "GET", path: "/api/authorizations/by-ticket/9580" });
  assert.equal(open.body.actionable, true, "stage 3 never opens — the reviewer still has nowhere to record a decision");
  assert.equal(open.body.mobilityReview.state, "open");
  assert.match(open.body.actionableReason, /not sent to Remote/i);
  // The employer's own answer is still published, and is still "no" — a settled
  // row cannot be approved again, which is exactly why stage 3 is reachable.
  assert.equal(open.body.employerActionable, false);

  // AFTER the review: closed again, and it says who and what.
  await callApi(handler, {
    method: "POST",
    path: `/api/authorizations/${created.authorizationId}/mobility-review`,
    body: { action: "clear", approver: "mobility@remote.test" },
  });
  const closed = await callApi(handler, { method: "GET", path: "/api/authorizations/by-ticket/9580" });
  assert.equal(closed.body.actionable, false);
  assert.equal(closed.body.mobilityReview.state, "cleared");
  assert.equal(closed.body.mobilityReview.recorded.reviewer, "mobility@remote.test");
});

test("sidebarActionability() called with one argument is byte-for-byte what it always was", () => {
  // The 2026-08-30 behaviour is the DEFAULT, not a branch that happens to be
  // taken: a caller that knows nothing about stage 3 gets the old answer.
  const open = sidebarActionability({ allowed: true, reason: null });
  assert.equal(open.actionable, false);
  const blocked = sidebarActionability({ allowed: false, reason: "A blocked request cannot be approved by anyone." });
  assert.equal(blocked.actionable, false);
  assert.ok(blocked.actionableReason.startsWith("A blocked request cannot be approved by anyone."));
  // ...and a stage-3 block that is not open changes nothing either.
  assert.equal(sidebarActionability({ allowed: true, reason: null }, { openHere: false }).actionable, false);
});

// ===========================================================================
// 4. THE DOCUMENT
// ===========================================================================

const CLEARED_ROW = {
  id: "auth-doc-1",
  createdAt: "2026-08-20T09:00:00.000Z",
  employmentId: "emp_active_001",
  requester: "admin_jane",
  status: "executed",
  approver: "manager@company.test",
  approvedAt: "2026-08-25T10:00:00.000Z",
  approvalNote: "Fine by me.",
  remoteResult: { transmitted: false, reason: "no_remote_work_authorization_request" },
  externalRef: "9600",
  factors: FACTORS,
  flags: [],
};
const CLEARED_REVIEW = {
  outcome: "cleared",
  reviewer: "mobility@remote.test",
  at: "2026-08-30T11:00:00.000Z",
  note: null,
  sentToRemote: false,
};

test("the record states what was approved, by whom, and — for every stage — where it is recorded", () => {
  const html = renderWorkAuthorizationRecordHtml({
    employment: { full_name: "Chris Lee", job_title: "Staff Engineer", status: "active", contract_type: "employee" },
    legalEntity: { name: "Remote US EOR Inc.", country_name: "United States" },
    authorizationRow: CLEARED_ROW,
    review: CLEARED_REVIEW,
    reference: "9600",
    today: "2026-08-31",
  });

  assert.match(html, /Chris Lee/);
  assert.match(html, /Remote US EOR Inc\./);
  assert.match(html, /manager@company\.test/, "the employer's approver is not on the record");
  assert.match(html, /mobility@remote\.test/, "Remote's reviewer is not on the record");
  assert.match(html, /Spain \(ES\)/);
  assert.match(html, /2026-09-01 to 2026-09-14/);

  // THE NEGATIVE, IN THE EMPLOYEE'S OWN WORDS AND NOT PARAPHRASED.
  //
  // Compared through the apostrophe entity, because the renderer escapes every
  // interpolated value (`escapeHtml`, src/shared/html.js) and the notice is full
  // of apostrophes. Unescaping ONE entity here rather than importing the escaper
  // keeps this an assertion about the sentence a reader sees, not a restatement
  // of the escaping rule — which has its own tests one use case over.
  const readable = html.replace(/&#0?39;/g, "'");
  assert.ok(
    readable.includes(MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE),
    "the record does not carry the server's own 'Remote's systems hold no record of it' sentence"
  );
  assert.match(readable, /Remote's own systems hold no record of it/i);
  // And it must not read as a clearance nobody gave.
  assert.match(html, /not<\/strong> a visa, a work\s+permit, or an immigration clearance/i);
  // Stage 2 honestly reported: this fixture was never transmitted.
  assert.match(html, /nothing at Remote to update/i);
});

test("the record carries NO SALARY, and cannot grow one by accident", () => {
  // BEHAVIOURAL — against a record that really holds pay in all three shapes
  // this repository has ever seen.
  const html = renderWorkAuthorizationRecordHtml({
    employment: {
      full_name: "Chris Lee",
      job_title: "Staff Engineer",
      status: "active",
      contract_type: "employee",
      base_salary: 9500000,
      currency: "USD",
      contract_details: {
        annual_gross_salary: 9500000,
        compensation_currency_code: "USD",
        payment_terms: { compensation_gross_amount: 25000, period_unit: "monthly" },
      },
    },
    legalEntity: { name: "Remote US EOR Inc." },
    authorizationRow: CLEARED_ROW,
    review: CLEARED_REVIEW,
    today: "2026-08-31",
  });
  for (const spelling of ["9500000", "95000", "$95,000", "25000", "USD", "salary", "Salary", "compensation"]) {
    assert.ok(!html.includes(spelling), `the work-authorization record printed "${spelling}"`);
  }

  // STRUCTURAL — the renderer must not so much as NAME a money field, because
  // "it happens not to render one" and "it cannot" are different guarantees and
  // only the second survives an edit. UC-01's letter has two tests pinning the
  // same rule for the same reason.
  const source = readFileSync(join(SRC_UC04, "authorizationRecord.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  for (const field of ["base_salary", "annual_gross_salary", "compensation_gross_amount", "formatMoney", "currency"]) {
    assert.ok(!source.includes(field), `authorizationRecord.js references "${field}" — this document states no pay`);
  }
});

test("the record is refused before clearance and issued after, and only to the employee it is about", () => {
  const employeeSession = { authenticatedEmploymentId: "emp_active_001" };

  // Stage 2 outstanding.
  assert.equal(
    evaluateAuthorizationRecordDelivery({
      authorizationRow: { ...CLEARED_ROW, status: "pending_specialist_approval", approvedAt: null },
      session: employeeSession,
    }).code,
    "employer_approval_not_recorded"
  );
  // Stage 3 outstanding — a DIFFERENT code, because a different person is
  // holding it up.
  assert.equal(
    evaluateAuthorizationRecordDelivery({ authorizationRow: CLEARED_ROW, session: employeeSession, review: null }).code,
    "mobility_review_not_recorded"
  );
  // Declined by Remote: there is no artifact for a refused trip.
  assert.equal(
    evaluateAuthorizationRecordDelivery({
      authorizationRow: CLEARED_ROW,
      session: employeeSession,
      review: { ...CLEARED_REVIEW, outcome: "declined" },
    }).code,
    "mobility_review_declined"
  );
  // Cleared.
  const allowed = evaluateAuthorizationRecordDelivery({
    authorizationRow: CLEARED_ROW,
    session: employeeSession,
    review: CLEARED_REVIEW,
  });
  assert.equal(allowed.allowed, true);

  // IDENTITY FAILS CLOSED, and a stranger is refused BEFORE they learn whether
  // a clearance exists — the refusal order every gate in this repo uses.
  assert.equal(
    evaluateAuthorizationRecordDelivery({ authorizationRow: CLEARED_ROW, session: null, review: CLEARED_REVIEW }).code,
    "session_required"
  );
  assert.equal(
    evaluateAuthorizationRecordDelivery({
      authorizationRow: CLEARED_ROW,
      session: { authenticatedEmploymentId: "someone-else" },
      review: CLEARED_REVIEW,
    }).code,
    "not_the_employee"
  );
  // A company admin who FILED it is still not the subject. Deliberate — see
  // src/uc04/recordDelivery.js's header.
  assert.equal(
    evaluateAuthorizationRecordDelivery({
      authorizationRow: CLEARED_ROW,
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      review: CLEARED_REVIEW,
    }).code,
    "session_required"
  );
});

// ===========================================================================
// 5. WHAT THE EMPLOYEE SEES — driven through the real portal handler
// ===========================================================================

function portal() {
  const stores = buildPortalStores();
  const audit = new AuditLogger();
  const remote = remoteClient();
  const handler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  return { handler, stores, audit, remote };
}

const myRequests = (handler, persona) =>
  callApi(handler, { method: "GET", path: `/api/my-requests?persona=${persona}` });

async function fileAsJoao(handler) {
  const filed = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      persona: "joao",
      homeCountry: "PT",
      nationality: "PT",
      destinationCountry: "NL",
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
      externalRef: "uc04-stage-view-1",
      now: "2026-08-15",
    },
  });
  return filed;
}

test("the employee sees each stage of their own request, and the right one is outstanding at each point", async () => {
  const { handler, stores, audit } = portal();
  const filed = await fileAsJoao(handler);
  assert.equal(filed.body.decision, "ready_for_approval", JSON.stringify(filed.body).slice(0, 400));
  const authorizationId = filed.body.authorizationId ?? filed.body.recordId;

  // --- STAGE 1 FILED: waiting on the customer's own manager.
  let row = (await myRequests(handler, "joao")).body.requests.find((r) => r.type === "uc04");
  assert.ok(row, "the filed workation is not in My requests at all");
  assert.equal(row.status.state, "awaiting_review");
  assert.match(row.status.awaitingRole, /manager/i, "the employee is told the wrong person is holding this");
  assert.equal(row.stages.state, "not_reached");
  assert.equal(row.document.state, "drafted");
  assert.equal(row.document.label, "With your manager");
  assert.equal(row.document.collect, null, "a collect control is offered before anybody has decided");

  // --- STAGE 2 DONE: the employer approved. Now Remote's review is what is
  //     outstanding, and the page must say so rather than reading "finished".
  const authorizationRow = await stores.uc04.findById(authorizationId);
  assert.ok(authorizationRow, "the portal's own store cannot find the row it just wrote");
  await submitWorkationApproval(
    { authorizationId, action: "approve", approver: "manager@company.test" },
    { remote: remoteClient(), audit, authorizationStore: stores.uc04 }
  );

  row = (await myRequests(handler, "joao")).body.requests.find((r) => r.type === "uc04");
  assert.equal(row.stages.state, "open");
  assert.equal(row.stages.sentToRemote, false);
  assert.equal(row.stages.employer.approved, true);
  assert.equal(row.stages.employer.approver, "manager@company.test");
  assert.equal(row.document.label, "With Remote", "the employee is not told who is holding it now");
  assert.equal(row.document.collect, null);
  // And the status sentence must not claim Remote issued anything.
  assert.ok(!/issued at Remote/i.test(row.status.detail), row.status.detail);

  // --- STAGE 3 DONE: cleared. The record becomes collectable.
  await submitMobilityReview(
    { authorizationId, action: "clear", reviewer: "mobility@remote.test", note: "No PE exposure on these facts." },
    { audit, authorizationStore: stores.uc04 }
  );

  row = (await myRequests(handler, "joao")).body.requests.find((r) => r.type === "uc04");
  assert.equal(row.stages.state, "cleared");
  assert.equal(row.stages.recorded.reviewer, "mobility@remote.test");
  assert.equal(row.stages.sentToRemote, false);
  assert.equal(row.document.state, "issued");
  assert.equal(row.document.collect.method, "POST");
  assert.equal(row.document.collect.path, "api/requests/uc04/record");
  // The two fields that stop the browser's ONE collector from posting a
  // letter's vocabulary at a record's route — see src/portal/letterAccess.js.
  assert.equal(row.document.collect.idField, "authorizationId");
  assert.equal(row.document.collect.noun, "work authorization record");
  // RELATIVE, NO LEADING SLASH — the production outage src/portal/letterAccess.js
  // records for UC-03's letter applies here identically.
  assert.ok(!row.document.collect.path.startsWith("/"));
});

test("the collect route refuses before clearance, issues after, and refuses everybody but the subject", async () => {
  const { handler, stores, audit } = portal();
  const filed = await fileAsJoao(handler);
  const authorizationId = filed.body.authorizationId ?? filed.body.recordId;
  const collect = (persona, id = authorizationId) =>
    callApi(handler, { method: "POST", path: "/api/requests/uc04/record", body: { persona, authorizationId: id } });

  // Before anyone has decided.
  let res = await collect("joao");
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "employer_approval_not_recorded");

  await submitWorkationApproval(
    { authorizationId, action: "approve", approver: "manager@company.test" },
    { remote: remoteClient(), audit, authorizationStore: stores.uc04 }
  );
  res = await collect("joao");
  assert.equal(res.body.code, "mobility_review_not_recorded", "a record was issued before Remote reviewed it");

  await submitMobilityReview(
    { authorizationId, action: "clear", reviewer: "mobility@remote.test" },
    { audit, authorizationStore: stores.uc04 }
  );

  // Somebody else's employee cannot have it, and the admin who could have filed
  // it cannot either.
  assert.equal((await collect("chris")).body.code, "not_the_employee");
  assert.equal((await collect("admin")).body.code, "session_required");

  // The subject can.
  res = await collect("joao");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.type, "work_authorization_record");
  assert.equal(res.body.sentToRemote, false);
  assert.equal(res.body.caveat, MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE);
  assert.match(res.body.content, /Work Authorization — record of decisions/);
  assert.match(res.body.content, /mobility@remote\.test/);
  assert.ok(!/salary/i.test(res.body.content), "the collected record printed pay");

  // THE COLLECTION IS AUDITED, with the hash of exactly what was handed over —
  // there is no `documents` row for this artifact, so this row is the only
  // durable statement of which bytes went out.
  const issued = audit.entries.filter((e) => e.action === "workation_record_issued");
  assert.equal(issued.length, 1);
  assert.equal(issued[0].details.authorizationId, authorizationId);
  assert.equal(issued[0].details.contentHash.length, 64);
  assert.equal(issued[0].details.sentToRemote, false);
});

// ===========================================================================
// 6. THE PURE HELPERS, at their edges
// ===========================================================================

test("employerApprovalState reads the STATUS, not the signature — a stopped approval is not an approval", () => {
  // `recordApproval()` fills the slot BEFORE the freshness re-check, so a row
  // whose employment went inactive carries `approvedAt` and never reached
  // `executed`. Reading the signature alone would treat that as an approval.
  const stopped = employerApprovalState({ status: "pending_specialist_approval", approvedAt: "2026-08-25T10:00:00Z", approver: "m@c.test" });
  assert.equal(stopped.approved, false);
  assert.equal(employerApprovalState(CLEARED_ROW).approved, true);
  // A legacy `denied` row still reads as declined — the stores canonicalise on
  // read, and this must not be the one place that forgets.
  assert.equal(employerApprovalState({ status: "denied", deniedBy: { approver: "m@c.test" } }).declined, true);
  // A null row is neither, never a guess.
  assert.equal(employerApprovalState(null).approved, false);
  assert.equal(employerApprovalState(null).declined, false);
});

test("describeMobilityReview always publishes sentToRemote: false, in every state", () => {
  const states = [
    describeMobilityReview({ authorizationRow: null }),
    describeMobilityReview({ authorizationRow: { status: "pending_specialist_approval" } }),
    describeMobilityReview({ authorizationRow: { status: "declined", declinedBy: {} } }),
    describeMobilityReview({ authorizationRow: CLEARED_ROW }),
    describeMobilityReview({ authorizationRow: CLEARED_ROW, review: CLEARED_REVIEW }),
    describeMobilityReview({ authorizationRow: CLEARED_ROW, review: { ...CLEARED_REVIEW, outcome: "declined" } }),
  ];
  assert.deepEqual(
    states.map((s) => s.sentToRemote),
    [false, false, false, false, false, false]
  );
  assert.deepEqual(states.map((s) => s.state), ["unknown", "not_reached", "not_reached", "open", "cleared", "declined"]);
  // EXACTLY ONE STATE OPENS A CONTROL.
  assert.equal(states.filter((s) => s.openHere).length, 1);
  for (const s of states) assert.equal(s.notice, MOBILITY_REVIEW_NOTICE);
});

// ===========================================================================
// 7. THE BROWSER BUNDLE — read from source, because `npm test` never imports it
// ===========================================================================
// `src/portal/assets/*.js` is not imported by the suite, so a change there ships
// silently — the same shape of risk as the n8n Code node bodies and the ZAF
// bundle (CLAUDE.md §6). These read the real file.

test("the portal page draws the stage block and never composes the notice itself", () => {
  const app = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");
  const stripped = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  assert.match(stripped, /function stagesBlock\(request\)/, "the three-party stage line is not drawn at all");
  assert.match(stripped, /request\.stages/, "the page never reads the stage block the server sends");

  // THE PAGE COMPOSES NO VERDICT. Every sentence about where the decision goes
  // is the server's; a copy here is a second place "this is not sent to Remote"
  // could be softened, and the softer copy is the one that gets believed.
  assert.ok(
    !/not sent to Remote/i.test(stripped),
    "the portal page has grown its own copy of the not-sent-to-Remote sentence"
  );
});

test("the collector sends the id field and the noun the SERVER named, not a hard-coded pair", () => {
  // Both were hard-coded to a letter's vocabulary. Left alone, the button this
  // page offers for a UC-04 record would have posted `caseId` to a route that
  // wants `authorizationId` — the server refusing a control the same server had
  // just offered.
  const app = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");
  const stripped = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert.match(stripped, /endpoint\.idField \|\| "caseId"/, "the collector hard-codes caseId again");
  assert.match(stripped, /doc\.collect && doc\.collect\.noun/, "the buttons hard-code the word 'letter' again");
  assert.match(stripped, /work_authorization_record: "work authorization record"/);
});

// ===========================================================================
// 8. THE RENDERED SIDEBAR — the real bundle, against a fake DOM
// ===========================================================================

test("the sidebar renders the mobility-review controls WITH the notice, and never an Approve", async () => {
  // `npm test` never imports a browser asset, so anything this bundle renders
  // that no test reads can ship saying anything at all. This runs the real
  // main.js and panels.js and asserts on the words that came out.
  const w = world();
  const handler = createUc04Handler(w);
  await seedEmployerApproved(w, "9590");

  const base = "http://uc04.test";
  const screen = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: base },
    ticketId: "9590",
    // ONE BASE URL ANSWERED, EVERYTHING ELSE 404 — main.js defaults
    // `apiBaseUrl` to localhost:4020 when blank, so UC-01's loader is always in
    // the race and a responder that answered every URL would serve a UC-04 body
    // to it.
    respond: async (url) =>
      String(url).indexOf(base) === 0
        ? await callHandler(handler, { method: "GET", path: String(url).slice(base.length) })
        : { status: 404, body: { found: false } },
  });

  assert.ok(screen.buttons.length > 0, "Remote's reviewer has no control on the rendered page");
  const labels = screen.buttons.map((b) => String(b.textContent));
  assert.deepEqual(labels.sort(), ["Record clearance", "Record decline"]);
  // THE VERB THAT MUST NEVER APPEAR. `approve` is the employer's word for the
  // employer's decision on this same use case.
  assert.ok(!labels.some((l) => /approve/i.test(l)), "the sidebar offered the customer's decision again");

  // THE SENTENCE IS ON THE PAGE, above the controls, in the server's own words.
  assert.ok(
    screen.text.includes(MOBILITY_REVIEW_NOTICE),
    "the controls are drawn without the sentence saying the decision goes nowhere near Remote"
  );
});

test("the sidebar draws nothing to click while the EMPLOYER's decision is still outstanding", async () => {
  // The 2026-08-30 guarantee, asserted on the rendered page rather than on the
  // server's field: a Remote CX agent must not be able to make the customer's
  // decision, however approvable the request is.
  const w = world();
  const handler = createUc04Handler(w);
  await seedApprovable(w, "9591");

  const base = "http://uc04.test";
  const screen = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: base },
    ticketId: "9591",
    respond: async (url) =>
      String(url).indexOf(base) === 0
        ? await callHandler(handler, { method: "GET", path: String(url).slice(base.length) })
        : { status: 404, body: { found: false } },
  });

  assert.equal(screen.buttons.length, 0, "the sidebar offered a control before the employer had decided");
  assert.match(screen.text, /employer's approval belongs to the customer/i);
  assert.match(screen.text, /no endpoint for that stage/i);
});

// ---------------------------------------------------------------------------
// THE SEAM BETWEEN STAGE 2 AND STAGE 3 (2026-08-31)
// ---------------------------------------------------------------------------
// Found by driving stage 1 → 2 → 3 against the live deployment, and invisible to
// every test that existed: the stage-2 tests asserted `approved_by_manager` was
// written, the stage-3 tests fed rows carrying `executed`, and each half was
// internally consistent. A request the customer's manager had genuinely just
// approved refused stage 3 with `employer_approval_not_recorded` — a message
// asserting the employer had not approved, beside a record saying they had.
//
// These drive the seam from BOTH sides, using the status strings the employer
// surface actually writes, so the two vocabularies can never drift apart again
// without something failing.

test("stage 3 opens on `approved_by_manager` — the status the employer surface actually writes", () => {
  const state = employerApprovalState({
    status: "approved_by_manager",
    approver: "manager@customer.test",
    approvedAt: "2026-08-31T10:00:00Z",
  });
  assert.equal(state.approved, true);
  assert.equal(state.declined, false);
  assert.equal(state.approver, "manager@customer.test");
});

test("stage 3 still opens on `executed` — the older single-approval path is not broken by the fix", () => {
  const state = employerApprovalState({ status: "executed", approver: "a@b.test", approvedAt: "2026-08-31T10:00:00Z" });
  assert.equal(state.approved, true);
});

test("an employer DECLINE is read as declined, not as 'nobody has looked'", () => {
  // canonicalDecisionStatus() folds `denied` into `declined` but returns
  // `declined_by_manager` unchanged — measured, not assumed. Unhandled, this row
  // fell through to the neutral state and refused stage 3 with the wrong reason:
  // the reviewer needs to know the trip was refused, not that it is unreviewed.
  const state = employerApprovalState({ status: "declined_by_manager", declinedAt: "2026-08-31T10:00:00Z" });
  assert.equal(state.declined, true);
  assert.equal(state.approved, false);
});

test("a status with no timestamp is NOT an approval, on either spelling", () => {
  // A row mid-write, or one hand-built by a caller. "The employer approved" is
  // not a claim to make from a status string alone.
  for (const status of ["executed", "approved_by_manager"]) {
    assert.equal(employerApprovalState({ status }).approved, false, status);
  }
});

test("end to end: an employer-approved row lets a clear through, and an unapproved one does not", () => {
  const approved = { status: "approved_by_manager", approver: "m@c.test", approvedAt: "2026-08-31T10:00:00Z" };
  const pending = { status: "pending_specialist_approval" };
  assert.equal(
    evaluateMobilityReview({ authorizationRow: approved, reviewer: "r@remote.test", action: "clear" }).allowed,
    true
  );
  const refused = evaluateMobilityReview({ authorizationRow: pending, reviewer: "r@remote.test", action: "clear" });
  assert.equal(refused.allowed, false);
  assert.equal(refused.code, "employer_approval_not_recorded");
});

// ---------------------------------------------------------------------------
// STAGE 3 IN THE COLUMN THE EMPLOYEE ACTUALLY READS
// ---------------------------------------------------------------------------
// Reported by the project owner on 2026-09-01, reading their own "My requests"
// page on the deployment: "I was expecting to see that the Mobility Specialists
// have approved the work authorization. I checked. I didn't see anything. And
// the page makes you look as if approval by the manager is the final approval."
//
// Both halves were true and both had one cause. The row's status badge is
// derived from the store row, which records stages 1 and 2 and structurally
// cannot see stage 3 — so a trip the employer had approved AND Remote's
// mobility team had cleared showed exactly one word, "Approved by your manager",
// above a settled line ending "This is final". The clearance WAS on the row, as
// prose at the bottom of a tall cell, below the fold. A fact a reader cannot
// find is not a fact the page has told them.
// ---------------------------------------------------------------------------

test("every state a stage-3 block can be in carries a short label — none can be added without one", () => {
  // The stamp is applied in a WRAPPER for exactly this reason: a new branch
  // cannot ship without a label, and a missing one renders as an empty badge.
  const blocks = [
    describeMobilityReview({ authorizationRow: null }),
    describeMobilityReview({ authorizationRow: { status: "pending_specialist_approval" } }),
    describeMobilityReview({ authorizationRow: { status: "declined", declinedBy: {} } }),
    describeMobilityReview({ authorizationRow: CLEARED_ROW }),
    describeMobilityReview({ authorizationRow: CLEARED_ROW, review: CLEARED_REVIEW }),
    describeMobilityReview({ authorizationRow: CLEARED_ROW, review: { ...CLEARED_REVIEW, outcome: "declined" } }),
  ];

  for (const block of blocks) {
    assert.equal(typeof block.shortLabel, "string");
    assert.ok(block.shortLabel.length > 0, `state ${block.state} has no short label`);
    assert.equal(block.shortLabel, MOBILITY_REVIEW_SHORT_LABELS[block.state], `state ${block.state} is mislabelled`);
    // Read on its own, out of any heading — so it has to name the stage.
    assert.match(block.shortLabel, /mobility review/i);
  }

  // Every state these six produce really is covered by the map, and the map has
  // no entries for states nothing produces.
  assert.deepEqual(
    new Set(blocks.map((block) => block.state)),
    new Set(Object.keys(MOBILITY_REVIEW_SHORT_LABELS))
  );
});

test("the short label is a STATE, never a summary of the honesty notice", () => {
  const cleared = describeMobilityReview({ authorizationRow: CLEARED_ROW, review: CLEARED_REVIEW });

  // The badge says what happened. It must not start explaining what recording
  // it does and does not mean — every paraphrase of that anyone writes is
  // shorter and more reassuring than the original, which is the direction that
  // gets believed.
  assert.doesNotMatch(cleared.shortLabel, /remote'?s? (own )?(systems?|endpoint|api)/i);
  assert.doesNotMatch(cleared.shortLabel, /not sent|no endpoint|durable|audit/i);

  // And the original is STILL THERE, unabridged, on the same block — the badge
  // is an addition to the notice, never a replacement for it.
  assert.ok(cleared.detail.includes(MOBILITY_REVIEW_NOTICE), "the verbatim notice left the block");
  assert.equal(cleared.notice, MOBILITY_REVIEW_NOTICE);
  assert.equal(cleared.sentToRemote, false);
});

test("a cleared review and an outstanding one do not read alike", () => {
  // The row must be able to say "a stage is still open" and "a stage is done"
  // in the same column, or the first reads as finished — which is the reported
  // defect. Distinctness is the assertion; the wording is the file's.
  const open = describeMobilityReview({ authorizationRow: CLEARED_ROW }).shortLabel;
  const cleared = describeMobilityReview({ authorizationRow: CLEARED_ROW, review: CLEARED_REVIEW }).shortLabel;
  const declined = describeMobilityReview({
    authorizationRow: CLEARED_ROW,
    review: { ...CLEARED_REVIEW, outcome: "declined" },
  }).shortLabel;

  assert.equal(new Set([open, cleared, declined]).size, 3);
  assert.match(cleared, /cleared/i);
  assert.match(declined, /declined/i);
  assert.doesNotMatch(open, /cleared|declined/i);
});

test("the portal draws the stage badge in the STATUS cell, not only as prose below the fold", () => {
  const app = readFileSync(
    new URL("../src/portal/assets/app.js", import.meta.url),
    "utf8"
  );

  // The badge is composed from the SERVER's short label — the browser never
  // writes a status word of its own.
  assert.match(app, /stages\.shortLabel|s\.shortLabel/, "the page ignores the server's short label");
  assert.match(app, /statusCell\.appendChild\(stageBadge\)/, "the stage badge is not in the status cell");

  // ONE COPY. Drawing it in the status cell AND in the prose block would be the
  // same fact twice, and the copy nobody scrolls to is the one that reads as
  // the answer.
  assert.equal(
    (app.match(/"badge stage-"/g) || []).length,
    1,
    "the stage badge is drawn in two places"
  );
});

test("the approve branch's finality names WHOSE decision is final; the decline branch does not need to", () => {
  const policy = readFileSync(new URL("../src/uc04/approvalPolicy.js", import.meta.url), "utf8");

  // A work authorization has a third decider after the employer, so a bare
  // "This is final" as the last line of the employee's own row is read as the
  // whole request being finished — which is what was reported.
  assert.match(
    policy,
    /finality: "The employer's decision is final — an approved request cannot be approved or declined again\."/,
    "the approve branch's finality no longer says whose decision it is"
  );

  // The decline branch keeps the unqualified sentence, and that asymmetry is
  // the point: a decline really does end the chain, because stage 3 reviews
  // what the employer APPROVED and is `not_reached` on a declined request.
  assert.match(policy, /finality: "This is final — a declined request has to be filed again/);
  assert.equal(
    describeMobilityReview({ authorizationRow: { status: "declined", declinedBy: { by: "m@c.test" } } }).state,
    "not_reached",
    "if a declined request could still reach stage 3, its finality sentence would need scoping too"
  );
});

// ---------------------------------------------------------------------------
// THE HEADER BADGE AFTER THE EMPLOYER HAS APPROVED
// ---------------------------------------------------------------------------
// Reported 2026-09-01 by the project owner, having driven the whole chain:
// UC-03 ticket -> continuation -> UC-04 request -> approved it -> opened the
// ticket in Zendesk expecting to see the approval, and did not.
//
// The record was right the whole time. `0531c363` on the deployment: filed
// 16:58:54Z, approved by admin_jane 17:02:05Z, `approved_by_manager`, stage 3
// `openHere: true`. What was wrong was the panel's headline. Its badge reads
// `case.decision` — the AUTOMATION's verdict, `ready_for_approval`, a
// historical fact that correctly never changes — and only prefers a settled
// status when one exists in the SHARED review queue. UC-04 has none: the
// customer's manager approves in Remote's own product and the verdict lands on
// `uc04_authorizations` itself. So the badge said "Awaiting specialist
// approval" above a settled block on the same panel naming the approver and the
// minute.
//
// That is rca-il7 exactly, arriving by the one route rca-il7's fix does not
// cover. The words come from the server, so the browser still derives no status
// word of its own.
// ---------------------------------------------------------------------------

test("an approved row publishes a badge naming WHICH approval happened", () => {
  const settled = settledFacts({
    status: "approved_by_manager",
    approver: "admin_jane",
    approvedAt: "2026-09-01T17:02:05.336Z",
  });

  assert.equal(settled.state, "approved");
  assert.equal(settled.badge, "Approved by the employer");

  // NOT a bare "Approved". Three parties decide a work authorization and stage
  // 3 is still outstanding the moment this badge first appears — an unqualified
  // word here is the ambiguity the whole three-stage rework exists to remove.
  assert.notEqual(settled.badge, "Approved");
  assert.match(settled.badge, /employer/i);

  // The stage that is still outstanding, on the same record, at the same moment.
  const stage = describeMobilityReview({
    authorizationRow: {
      status: "approved_by_manager",
      approver: "admin_jane",
      approvedAt: "2026-09-01T17:02:05.336Z",
    },
  });
  assert.equal(stage.openHere, true, "the badge must not say 'employer' while stage 3 is unreachable");
  assert.equal(stage.state, "open");
});

test("a declined row publishes its own badge, and the two are distinct", () => {
  const declined = settledFacts({ status: "declined_by_manager", declinedAt: "2026-09-01T17:02:05.336Z" });
  assert.equal(declined.state, "declined");
  assert.equal(declined.badge, "Declined");

  // An OPEN row publishes nothing, so the panel falls back to the automation's
  // own decision word exactly as it always did.
  assert.equal(settledFacts({ status: "pending_specialist_approval" }), null);
});

test("the sidebar prefers the record's own settlement over the automation's decision word", () => {
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  const start = main.indexOf("function renderHeader(");
  const header = main.slice(start, main.indexOf("function renderRemoteRequest(", start));

  assert.match(header, /view\.settled && view\.settled\.badge/, "the header ignores the record's own settlement");

  // THE WORDS ARE THE SERVER'S. The browser must not build a status word out of
  // `headline` or any other prose — that is a second place the vocabulary could
  // drift, which is what put two spellings of "declined" in this repo once.
  assert.doesNotMatch(header, /settled\.headline/, "the header derives a badge from prose");

  // LAST, so it wins over the review-queue branch. A settlement on the record
  // is the later and more specific fact.
  assert.ok(
    header.indexOf("view.settled.badge") > header.indexOf("REVIEW_STATUS_LABELS[review.status]"),
    "the record's settlement must be consulted after the review queue's, not before"
  );

  // Both spellings have a dot colour, so neither settled badge inherits the
  // waiting amber its underlying decision word still carries.
  const css = readFileSync(new URL("../zaf-app/assets/style.css", import.meta.url), "utf8");
  for (const key of ["approved", "declined"]) {
    assert.match(css, new RegExp(`\\.decision-${key} \\{`), `no dot colour for a settled ${key} badge`);
  }
});

// ---------------------------------------------------------------------------
// "SENT TO REMOTE" ON AN EMPLOYER APPROVAL — three cases, not two
// ---------------------------------------------------------------------------
// Found by a browser sweep of the live deployment, 2026-09-01. An approved
// trip's card in "My requests" read, four lines apart:
//
//   SENT TO REMOTE  "No Remote write is recorded against it, so the approval
//                    MAY NOT HAVE REACHED REMOTE — check the audit trail before
//                    assuming the work authorisation exists."
//   ...and below:   "Remote publishes no endpoint for this stage, so this is
//                    not sent to Remote and Remote's own systems will not show
//                    it."
//
// The first sentence is right for UC-02/06/09, where a write is attempted and
// silence really does mean "we do not know". Here it is false in the direction
// that costs most: it tells a manager who has just approved a trip to doubt
// whether the approval landed, and sends them looking for a write that could
// never have existed.
// ---------------------------------------------------------------------------

const APPROVED_BY_MANAGER = {
  status: "approved_by_manager",
  approver: "admin_jane",
  approvedAt: "2026-09-01T17:02:05.336Z",
};

/** The "Sent to Remote" row off a settled block. */
const sentToRemote = (row) =>
  (settledFacts(row).facts.find((f) => f.label === "Sent to Remote") ?? {}).value ?? "";

test("no result AND no linked request: says nothing was attempted, never that it may have failed", () => {
  // This is every /remoteui approval: recordEmployerDecision() makes no Remote
  // call and writes no remoteResult, and no Remote request exists to write to.
  const value = sentToRemote(APPROVED_BY_MANAGER);

  assert.doesNotMatch(value, /may not have reached/i, "an approval that could not be transmitted is reported as possibly lost");
  assert.doesNotMatch(value, /check the audit trail/i, "the reader is sent looking for a write that cannot exist");
  assert.match(value, /^No —/, "the answer to 'was this sent to Remote' must still lead with no");
  assert.match(value, /no write was attempted/i);
  // And it does not overcorrect into reassurance about the wrong thing: the
  // approval is recorded HERE, which is a claim about this system only.
  assert.match(value, /recorded here/i);
  assert.doesNotMatch(value, /Remote's systems (show|hold|have)/i);
});

test("A LINK ID IS NOT A WRITE — a linked request with no recorded result answers 'we do not know'", () => {
  // THE MORE SERIOUS HALF, and this test found it by accident while covering
  // the case above. `remoteOutcome()` passed `row.workAuthorizationId` in the
  // result's place when no result existed, and remoteWriteClause() reads any
  // truthy value as "it landed" — so a row asserted "Yes — the
  // work-authorisation request was updated at Remote" on the strength of an id.
  //
  // That id is set at LINK time (src/uc04/workflow.js:207), when the employee's
  // request is matched to a Remote request that already existed. The write is a
  // separate, later act that records its own result. So the id proves the
  // TARGET exists and never that anything reached it.
  // The fallback's own case, and the one that must survive untouched: a Remote
  // request IS linked, so a write was possible and its outcome is genuinely
  // unknown. Reporting that as "nothing was attempted" would turn a real
  // uncertainty into a false all-clear, which is the opposite defect.
  // `executed`, NOT `approved_by_manager`. The discriminator is WHICH PATH
  // settled the row, not whether an id is present: transmitVerdict() settles a
  // row `executed` and DOES attempt a Remote write, so an executed row holding
  // no result is a genuine unknown — the result went missing, and saying
  // "nothing was attempted" would be a false all-clear.
  const value = sentToRemote({
    status: "executed",
    approver: "admin_jane",
    approvedAt: "2026-09-01T17:02:05.336Z",
    workAuthorizationId: "wa_1234567890",
  });

  assert.match(value, /may not have reached Remote/i, "an unknown transmission is no longer reported as unknown");
  assert.match(value, /check the audit trail/i);
  assert.doesNotMatch(value, /no write was attempted/i);
  // The bug this test was written for: it must not claim the write LANDED on
  // the strength of the id alone.
  assert.doesNotMatch(value, /^Yes —/, "a link id is being read as proof of a Remote write");
  assert.doesNotMatch(value, /updated at Remote/);
});

test("an employer decision says no write was attempted EVEN WITH a linked request", () => {
  // Because the claim is about the CODE PATH, not the field.
  // recordEmployerDecision() takes no Remote client, so a linked target changes
  // nothing about whether anything was sent to it. This is the case that makes
  // "gate on the status, not the id" load-bearing rather than stylistic.
  const value = sentToRemote({ ...APPROVED_BY_MANAGER, workAuthorizationId: "wa_1234567890" });
  assert.match(value, /no write was attempted/i);
  assert.doesNotMatch(value, /^Yes —/);
  assert.doesNotMatch(value, /may not have reached/i);
});

test("an explicit transmitted:false and a recorded success both still answer as they did", () => {
  const declared = sentToRemote({
    ...APPROVED_BY_MANAGER,
    remoteResult: { transmitted: false, detail: "no Remote request is linked to it." },
  });
  assert.match(declared, /^No —/);
  assert.match(declared, /The approval is real and recorded/);

  const landed = sentToRemote({
    ...APPROVED_BY_MANAGER,
    workAuthorizationId: "wa_1234567890",
    remoteResult: { transmitted: true, id: "wa_1234567890" },
  });
  assert.match(landed, /^Yes —/);
  assert.match(landed, /updated at Remote/);
});
