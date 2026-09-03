// ---------------------------------------------------------------------------
// remoteuiWorkAuth.test.js  —  the EMPLOYER's work-authorization decision
//                              (Remote's stage 2), in the Remote UI stand-in
// ---------------------------------------------------------------------------
// WHAT IS PINNED HERE, AND WHY EACH ONE
//
//   1. THE COMPANY BOUNDARY, in both directions. Not "Lars is absent from a
//      list" alone — a list can be empty for a dozen reasons — but that his
//      request EXISTS, is `pending`, and is still refused when its id is quoted
//      directly. A boundary that has only ever been observed as an absence has
//      not been observed.
//   2. TWO VERBS AND NOTHING ELSE. Remote's update schema is
//      `additionalProperties: false` over a `oneOf` with exactly two branches,
//      and this repository has already shipped a payload that sent
//      `approved_by_remote` plus three fields the schema refuses — recording
//      REMOTE's approval of a trip Remote had never seen — with a green suite,
//      because the mock had been written from the code (src/uc04/workflow.js's
//      header). So the assertion is on the BODY that would go on the wire, not
//      on the response text.
//   3. AUDIT BEFORE THE OUTWARD ACT. Proved by making the outward act FAIL:
//      the durable row must still be there afterwards. An ordering test that
//      only ever runs the happy path cannot tell "first" from "at some point".
//   4. THE ACCESS KEY FAILS CLOSED. Required-and-unconfigured must refuse, not
//      allow. The window where a URL is live and its key is not yet set is the
//      one this surface must survive from the safe side — it writes.
//   5. A STAND-IN RECORD IS SELF-IDENTIFYING, in three independent places, so
//      no single rendering decision can hide it.
//
// HERMETIC WITH NO SOCKETS. The Remote client dispatches straight into
// src/remote/mockServer.js through createInProcessFetch(), so this file binds
// no port at all and needs no entry in src/shared/ports.js's TEST_PORTS.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { Readable } from "node:stream";

import { createInProcessFetch, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { createRemoteUiHandler } from "../src/remoteui/server.js";
import {
  CURRENT_STAGE,
  EMPLOYER_ACTIONS,
  EMPLOYER_VERBS,
  REMOTE_ONLY_STATUSES,
  STAGES,
  STAGE_3_NOTE,
  buildDecisionPayload,
  evaluateEmployerDecision,
} from "../src/remoteui/workAuthPolicy.js";
import {
  STANDIN_HEADER,
  STANDIN_ID_PREFIX,
  STANDIN_ROW_KEY,
  createWorkAuthorizationStandin,
  isStandinId,
} from "../src/remoteui/workAuthStandin.js";
import { ROLES, canRoleSubmit, DECIDE_WORK_AUTHORIZATION_ACTION } from "../src/remoteui/roles.js";
import { PORTAL_KEY_HEADER, portalAccessPosture } from "../src/portal/access.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "remoteui", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

const ADMIN = { "x-remoteui-session": "admin" };
const EMPLOYEE = { "x-remoteui-session": "employee" };
const EMPLOYER = { "x-remoteui-session": "employer" };

// The mock's own pending request for Chris Lee, and the stand-in rows. Named
// rather than discovered, so a fixture that silently disappears fails a test
// instead of quietly reducing what is covered.
const REMOTE_PENDING = "6b8e1d47-0c53-4a92-bf10-77d4c2e8a5f3";
const STANDIN_PENDING = "standin-wa-0001";
const STANDIN_OTHER_COMPANY = "standin-wa-0003"; // Lars van der Berg, co_northwind_02
const STANDIN_SETTLED = "standin-wa-0004";

let auditRows;
let patchCalls;
let handler;

/** An audit logger that records the ORDER things happened in. */
function recordingAudit() {
  return {
    logDurable: async (row) => {
      auditRows.push({ durable: true, ...row });
      return row;
    },
    log: async (row) => {
      auditRows.push({ durable: false, ...row });
      return row;
    },
    logTraceStep: async () => {},
  };
}

function buildHandler({ remote, access, patchFails = false, adminCompanyId, noPatchWrapper = false } = {}) {
  const client =
    remote ?? new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });

  // A thin recording wrapper, so the ORDER of (audit row, Remote write) is
  // observable and the write can be made to fail on demand. `noPatchWrapper` is
  // for the probe doubles below, which deliberately do NOT implement the whole
  // client surface — wrapping them would hide the very absence being tested.
  const observed = noPatchWrapper ? client : Object.create(client);
  if (!noPatchWrapper) {
    observed.patchWorkAuthorization = async (id, payload) => {
      patchCalls.push({ id, payload, auditRowsBefore: auditRows.length });
      if (patchFails) throw new Error("simulated 502 from Remote");
      return client.patchWorkAuthorization(id, payload);
    };
    observed.getEmployment = (id) => client.getEmployment(id);
    observed.listWorkAuthorizations = (opts) => client.listWorkAuthorizations(opts);
  }

  return createRemoteUiHandler({
    remote: client,
    remoteWorkAuth: observed,
    audit: recordingAudit(),
    amendmentStore: new AmendmentStore(),
    zendesk: { createTicket: async () => ({ id: 1 }), updateTicket: async () => ({}) },
    employees: [],
    employmentIdFieldId: "1",
    workAuthStandin: createWorkAuthorizationStandin(),
    ...(access ? { access } : {}),
    ...(adminCompanyId ? { adminCompanyId } : {}),
  });
}

/** Drive the real handler with a real request/response pair. No socket. */
function call(h, { method = "GET", path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    req.method = method;
    req.url = path;
    req.headers = headers;
    const chunks = [];
    const res = {
      statusCode: 200,
      _headers: {},
      setHeader(k, v) {
        this._headers[k] = v;
      },
      getHeader(k) {
        return this._headers[k];
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {
          /* an asset, not JSON */
        }
        resolve({ status: this.statusCode, headers: this._headers, raw, json });
      },
    };
    Promise.resolve(h(req, res)).catch(reject);
  });
}

beforeEach(() => {
  auditRows = [];
  patchCalls = [];
  // A PATCH mutates the mock's request in place — that is what a PATCH is — so
  // without this the first test to approve leaves it approved for every test
  // after it, and the second test's request simply stops resolving. That
  // failure presents as an ABSENCE, which is indistinguishable from the feature
  // not working.
  resetWorkAuthorizations();
  handler = buildHandler();
});

// ---------------------------------------------------------------------------
// The pure policy — Remote's schema, transcribed, and the two verbs
// ---------------------------------------------------------------------------

test("the employer has exactly two verbs, and neither of them is Remote's own verdict", () => {
  assert.deepEqual(EMPLOYER_ACTIONS, ["approve", "decline"]);
  assert.deepEqual(Object.values(EMPLOYER_VERBS), ["approved_by_manager", "declined_by_manager"]);
  for (const remoteOnly of REMOTE_ONLY_STATUSES) {
    assert.ok(
      !Object.values(EMPLOYER_VERBS).includes(remoteOnly),
      `${remoteOnly} is Remote's own stage-3 verdict and has no endpoint — an employer must never be able to send it`
    );
  }
});

test("buildDecisionPayload emits exactly Remote's two branches and no extra property", () => {
  const approved = buildDecisionPayload({ action: "approve" });
  assert.deepEqual(approved.payload, { status: "approved_by_manager" });

  const approvedWithWords = buildDecisionPayload({ action: "approve", employerSpecialInstructions: "  no contracts  " });
  assert.deepEqual(approvedWithWords.payload, {
    status: "approved_by_manager",
    employer_special_instructions: "no contracts",
  });

  const declined = buildDecisionPayload({ action: "decline", reason: "no permit" });
  assert.deepEqual(declined.payload, { status: "declined_by_manager", reason: "no permit" });

  // `additionalProperties: false` punishes an invented field exactly as it
  // punishes a manufactured empty string — so an empty instruction is omitted,
  // not sent as "".
  const blank = buildDecisionPayload({ action: "approve", employerSpecialInstructions: "   " });
  assert.deepEqual(Object.keys(blank.payload), ["status"]);

  for (const built of [approved, approvedWithWords, declined, blank]) {
    for (const key of Object.keys(built.payload)) {
      assert.ok(
        ["status", "reason", "employer_special_instructions"].includes(key),
        `${key} is not a property of either update branch — the schema is additionalProperties:false`
      );
    }
  }
});

test("a decline with no reason is refused rather than given an invented one", () => {
  const verdict = buildDecisionPayload({ action: "decline", reason: "   " });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "decline_reason_required");
  assert.equal(verdict.status, 400);
});

test("a third verb has no representation at all, including one borrowed from the prototype chain", () => {
  for (const action of ["approved_by_remote", "cancel", "escalate", "", null, "constructor", "toString"]) {
    const verdict = buildDecisionPayload({ action });
    assert.equal(verdict.ok, false, `${String(action)} must not build a payload`);
    assert.equal(verdict.code, "unknown_action");
  }
});

test("only the company admin may decide — the role matrix says so, not the route", () => {
  assert.equal(canRoleSubmit(ROLES.company_admin, DECIDE_WORK_AUTHORIZATION_ACTION), true);
  assert.equal(canRoleSubmit(ROLES.employee, DECIDE_WORK_AUTHORIZATION_ACTION), false);
  assert.equal(canRoleSubmit(ROLES.employer, DECIDE_WORK_AUTHORIZATION_ACTION), false);
});

test("the verdict fails closed on every missing piece", () => {
  const scope = { companyId: "co_amend_01", recordIds: new Set(["x"]) };
  const record = { id: "x", status: "pending" };

  assert.equal(evaluateEmployerDecision({ session: null, action: "approve", record, scope }).code, "unauthenticated");
  assert.equal(
    evaluateEmployerDecision({ session: { role: ROLES.employee }, action: "approve", record, scope }).code,
    "role_not_authorized"
  );
  assert.equal(
    evaluateEmployerDecision({ session: { role: ROLES.company_admin }, action: "approve", record: null, scope }).code,
    "work_authorization_not_found"
  );
  assert.equal(
    evaluateEmployerDecision({
      session: { role: ROLES.company_admin },
      action: "approve",
      record,
      scope: { companyId: "co_amend_01", recordIds: new Set() },
    }).code,
    "not_your_company"
  );
});

// ---------------------------------------------------------------------------
// The stages — this screen is stage 2 of 3, and stage 3 has no endpoint
// ---------------------------------------------------------------------------

test("the three stages are stated, and stage 3 is named as Remote's with no endpoint", async () => {
  assert.equal(STAGES.length, 3);
  assert.equal(STAGES.filter((s) => s.ours).length, 1);
  assert.equal(STAGES.find((s) => s.ours).number, CURRENT_STAGE);
  assert.match(STAGES[2].api, /No endpoint exists/);
  assert.match(STAGE_3_NOTE, /Mobility Team/);
  assert.match(STAGE_3_NOTE, /approved_by_remote/);
  assert.match(STAGE_3_NOTE, /publishes no endpoint/);

  const res = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(res.status, 200);
  assert.equal(res.json.stage, CURRENT_STAGE);
  assert.equal(res.json.nextStage, STAGE_3_NOTE);
  assert.deepEqual(res.json.remoteOnlyStatuses, REMOTE_ONLY_STATUSES);
});

test("the page's own copy says which stage this is and that Remote reviews it separately", () => {
  const html = read("workauth.html");
  assert.match(html, /2 of 3/);
  assert.match(html, /Request Hub/);
  assert.match(html, /approved_by_manager/);
  assert.match(html, /declined_by_manager/);
  assert.ok(!/approved_by_remote/.test(html), "the page must not offer Remote's own verdict as a thing it can send");
});

// ---------------------------------------------------------------------------
// The company boundary — in both directions
// ---------------------------------------------------------------------------

test("the queue lists only this company's requests — Lars is at another company and is absent", async () => {
  const res = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(res.status, 200);
  assert.equal(res.json.companyId, "co_amend_01");

  const ids = res.json.requests.map((r) => r.id);
  assert.ok(!ids.includes(STANDIN_OTHER_COMPANY), "a request from another company must not be listed");
  assert.ok(ids.includes(STANDIN_PENDING));

  // The scope is derived by reading each employment BACK from Remote, so the
  // employment that fell outside is visible as a fact rather than as a silence.
  const lars = res.json.scope.employments.find((e) => e.employmentId === "673a1884-86fb-4101-83d3-b6c544d93bca");
  assert.ok(lars, "Lars must be a candidate that was checked, not one that was never considered");
  assert.equal(lars.inCompany, false);
  assert.equal(lars.observedCompanyId, "co_northwind_02");
});

test("Lars's request EXISTS and is pending — so the refusal below is a boundary, not an absence", () => {
  const standin = createWorkAuthorizationStandin();
  const record = standin.findById(STANDIN_OTHER_COMPANY);
  assert.ok(record, "the fixture must exist, or the boundary test proves nothing");
  assert.equal(record.status, "pending");
  assert.equal(standin.indexOf(STANDIN_OTHER_COMPANY).employmentId, "673a1884-86fb-4101-83d3-b6c544d93bca");
});

test("and it is excluded FOR HIS COMPANY, named in the response rather than silently dropped", async () => {
  const res = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  const excluded = res.json.scope.standinUnattributed.find((r) => r.id === STANDIN_OTHER_COMPANY);
  assert.ok(excluded, "an exclusion nobody can see is how this surface contradicted itself once already");
  assert.equal(excluded.observedCompanyId, "co_northwind_02");
  assert.match(excluded.reason, /co_northwind_02, not co_amend_01/);
});

// ---------------------------------------------------------------------------
// THE INVARIANT THE ORIGINAL SET COULD NOT SEE
// ---------------------------------------------------------------------------
// Both worlds passed independently: the stand-in asserted its own `companyId`
// and the scope read one off the employment record, and nothing compared them.
// Driven by hand against a Remote whose employments sit elsewhere, ONE response
// said in `scope` that Chris Lee is not in this company and in `requests` that
// his request is this company's to decide.

test("no listed request may name an employment the scope excluded — in ANY posture", async () => {
  const postures = [
    { label: "default (mock, co_amend_01)", adminCompanyId: undefined },
    { label: "a company nobody is at", adminCompanyId: "a9d4ce72-7773-4ea3-830d-c5b36a15e48d" },
    { label: "the OTHER company — Lars's", adminCompanyId: "co_northwind_02" },
  ];

  for (const posture of postures) {
    const h = buildHandler({ adminCompanyId: posture.adminCompanyId });
    const res = await call(h, { path: "/api/work-authorizations", headers: ADMIN });
    assert.equal(res.status, 200, posture.label);

    const inScope = new Set(res.json.scope.employments.filter((e) => e.inCompany).map((e) => e.employmentId));
    for (const entry of res.json.requests) {
      assert.ok(
        inScope.has(entry.employmentId),
        `${posture.label}: ${entry.id} is listed as decidable, but its employment ${entry.employmentId} was ` +
          `excluded from the scope. The page would be saying both things at once.`
      );
      // And the company shown for it is the one the RECORD answered with, not
      // one a fixture asserted.
      assert.equal(entry.observedCompanyId, res.json.companyId, `${posture.label}: ${entry.id}`);
    }
  }
});

test("pointed at the OTHER company, the boundary reverses — Lars is in and everyone else is out", async () => {
  // The sharpest form of "the boundary is really about companies": flip the
  // company the console speaks for and the admitted set flips with it. A
  // boundary that only ever refuses the same person could be refusing him for
  // any reason at all.
  const h = buildHandler({ adminCompanyId: "co_northwind_02" });
  const res = await call(h, { path: "/api/work-authorizations", headers: ADMIN });

  const ids = res.json.requests.map((r) => r.id);
  assert.ok(ids.includes(STANDIN_OTHER_COMPANY), "Lars's request must now be decidable");
  assert.ok(!ids.includes(STANDIN_PENDING), "Chris Lee's must not be");
  assert.equal(res.json.scope.employments.filter((e) => e.inCompany).length, 1);

  // And the refusal follows the same way round.
  const decided = await call(h, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_PENDING}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(decided.status, 403);
  assert.equal(decided.json.code, "not_your_company");
});

test("a stand-in cannot assert a company — it has no company to assert", () => {
  const standin = createWorkAuthorizationStandin();
  for (const row of standin.listAll()) {
    assert.equal(
      standin.indexOf(row.id).companyId,
      undefined,
      "the index must carry no company: rung 3 asserting one over an employment record is what the ladder forbids"
    );
    assert.equal(row[STANDIN_ROW_KEY].companyId, undefined, "and the marker block must not carry one either");
    assert.ok(row[STANDIN_ROW_KEY].employmentId, "it names an employment, and the employment answers for the company");
  }
  assert.equal(typeof standin.listForCompany, "undefined", "there must be no way to ask this store for a company's rows");

  // The store can only be scoped by employments the CALLER established.
  assert.deepEqual(standin.listForEmployments([]).map((r) => r.id), []);
  assert.deepEqual(
    standin.listForEmployments(["673a1884-86fb-4101-83d3-b6c544d93bca"]).map((r) => r.id),
    [STANDIN_OTHER_COMPANY]
  );
});

// ---------------------------------------------------------------------------
// "Asked and got nothing" vs "asked nothing"
// ---------------------------------------------------------------------------

test("an empty scope reports that Remote was asked NOTHING, not that Remote holds nothing", async () => {
  const h = buildHandler({ adminCompanyId: "a9d4ce72-7773-4ea3-830d-c5b36a15e48d" });
  const res = await call(h, { path: "/api/work-authorizations", headers: ADMIN });

  assert.equal(res.json.requests.length, 0);
  assert.equal(res.json.remoteProbe.asked, false);
  assert.equal(res.json.remoteProbe.verdict, "nothing_to_ask");
  assert.match(res.json.remoteProbe.detail, /asked about NOBODY/);
  assert.match(res.json.remoteProbe.detail, /not a finding/);

  // And the scope says which empty state this is.
  assert.equal(res.json.scope.verdict.state, "no_employment_in_company");
  assert.match(res.json.scope.verdict.detail, /a9d4ce72/);
  assert.match(res.json.scope.verdict.detail, /Nothing below is evidence about what is pending/);

  // EVERY candidate is still reported — this is an exclusion, not a failure to
  // look, and the two must not read the same.
  //
  // DERIVED, NOT RESTATED (2026-09-03). This assertion used to be the literal
  // `11`, and adding one persona to the roster failed it with `12 !== 11` — a
  // message that reads as a regression and is a roster change. A count cannot
  // tell coverage going up from coverage going down (CLAUDE.md §6). What the
  // test means is "the same people the in-company scope reports, all excluded",
  // so it is now compared against that scope rather than against a number.
  const inCompany = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.ok(res.json.scope.employments.length > 0, "no candidates were reported at all");
  assert.equal(res.json.scope.employments.length, inCompany.json.scope.employments.length);
  assert.equal(res.json.scope.employments.every((e) => e.inCompany === false), true);
});

test("a scope with people in it reports that Remote was genuinely asked", async () => {
  const res = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(res.json.remoteProbe.asked, true);
  assert.equal(res.json.remoteProbe.verdict, "answered");
  assert.ok(res.json.remoteProbe.employmentsQueried > 0);
  assert.equal(res.json.scope.verdict.state, "has_scope");
});

test("a Remote that cannot be listed is `unavailable`, never an empty finding", async () => {
  const blind = {
    getEmployment: async (id) => ({ id, company_id: "co_amend_01", status: "active" }),
    // no listWorkAuthorizations at all
  };
  const h = buildHandler({ remote: blind, noPatchWrapper: true });
  const res = await call(h, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(res.json.remoteProbe.asked, false);
  assert.equal(res.json.remoteProbe.verdict, "unavailable");
  assert.match(res.json.remoteProbe.detail, /never asked/);
});

test("every failing call is `unavailable` too — a failure is not an absence", async () => {
  const failing = {
    getEmployment: async (id) => ({ id, company_id: "co_amend_01", status: "active" }),
    listWorkAuthorizations: async () => {
      throw new Error("simulated 503");
    },
  };
  const h = buildHandler({ remote: failing, noPatchWrapper: true });
  const res = await call(h, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(res.json.remoteProbe.asked, true);
  assert.equal(res.json.remoteProbe.verdict, "unavailable");
  assert.equal(res.json.remoteProbe.failures.length, res.json.remoteProbe.employmentsQueried);
  assert.match(res.json.remoteProbe.detail, /nothing is known/);
});

test("`npm run remoteui` defaults to the MOCK — the Sandbox is opt-IN", () => {
  // THE TRIGGER FOR ALL OF THE ABOVE. This read
  // `remoteMode !== "mock" && Boolean(config.remote.token)`, so merely having a
  // REMOTE_API_TOKEN in .env pointed the surface at the real Sandbox, whose
  // employments sit at a company no demo session speaks for. Eleven candidates,
  // eleven `inCompany: false`, an empty queue, and a boundary that "passed"
  // without ever being about anybody's company.
  const cli = readFileSync(join(__dirname, "..", "src", "remoteui", "cli.js"), "utf8");
  assert.match(cli, /const useSandbox = remoteMode === "sandbox";/);
  assert.ok(
    !/useSandbox\s*=\s*[^;]*config\.remote\.token/.test(cli),
    "the presence of a token must not silently change which Remote this surface reads"
  );
  // And when someone DOES opt in, the mismatch is named at startup rather than
  // left to be read off an empty page.
  assert.match(cli, /REMOTEUI_ADMIN_COMPANY_ID/);
});

test("the console's company comes from the process, never from a request", async () => {
  // A header, body or query parameter naming a company must not move the scope.
  const attempts = [
    { path: "/api/work-authorizations?companyId=co_northwind_02", headers: ADMIN },
    { path: "/api/work-authorizations", headers: { ...ADMIN, "x-company-id": "co_northwind_02" } },
  ];
  for (const attempt of attempts) {
    const res = await call(handler, attempt);
    assert.equal(res.json.companyId, "co_amend_01");
    assert.ok(!res.json.requests.some((r) => r.id === STANDIN_OTHER_COMPANY));
  }
});

test("the page renders the two empty states differently, and never as one", () => {
  const source = read("workauth.js");
  assert.match(source, /remoteProbe\.asked/, "the page must branch on whether Remote was asked");
  assert.match(source, /Remote was not asked about anybody/);
  assert.match(source, /renderExclusions/, "what is NOT shown must be renderable");
});

test("quoting another company's request id is refused — knowing an id entitles nobody", async () => {
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_OTHER_COMPANY}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "not_your_company");
  assert.equal(auditRows.length, 0, "a refused decision must write no decision row");

  // And nothing changed on the record.
  const standin = createWorkAuthorizationStandin();
  assert.equal(standin.findById(STANDIN_OTHER_COMPANY).status, "pending");
});

test("the company is never taken from the request — a body naming another company changes nothing", async () => {
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_OTHER_COMPANY}/decision`,
    body: { action: "approve", companyId: "co_northwind_02", session: { companyId: "co_northwind_02" } },
    headers: ADMIN,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "not_your_company");
});

test("an unknown session key fails closed rather than defaulting", async () => {
  for (const headers of [{}, { "x-remoteui-session": "constructor" }, { "x-remoteui-session": "nobody" }]) {
    const res = await call(handler, { path: "/api/work-authorizations", headers });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "unauthenticated");
  }
});

test("an employee cannot approve their own travel, and the employer-consent role is not this role", async () => {
  for (const headers of [EMPLOYEE, EMPLOYER]) {
    const listed = await call(handler, { path: "/api/work-authorizations", headers });
    assert.equal(listed.status, 403);
    assert.equal(listed.json.code, "role_not_authorized");

    const decided = await call(handler, {
      method: "POST",
      path: `/api/work-authorizations/${STANDIN_PENDING}/decision`,
      body: { action: "approve" },
      headers,
    });
    assert.equal(decided.status, 403);
    assert.equal(decided.json.code, "role_not_authorized");
  }
  assert.equal(auditRows.length, 0);
});

// ---------------------------------------------------------------------------
// Two verbs and nothing else, over HTTP
// ---------------------------------------------------------------------------

test("an unknown verb is refused before anything is written, and the two are named back", async () => {
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_PENDING}/decision`,
    body: { action: "approved_by_remote" },
    headers: ADMIN,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, "unknown_action");
  assert.deepEqual(res.json.actions, ["approve", "decline"]);
  assert.equal(auditRows.length, 0);
  assert.equal(patchCalls.length, 0);
});

test("a request that is no longer awaiting a manager is refused by its own name", async () => {
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_SETTLED}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "not_awaiting_manager");
  // Specifically NOT `not_your_company` — it IS this company's request, and
  // saying otherwise would send the reader to investigate the wrong thing.
  assert.match(res.json.reason, /awaiting manager review/);
});

test("only the two documented statuses ever reach Remote's PATCH", async () => {
  await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${REMOTE_PENDING}/decision`,
    body: { action: "approve", employerSpecialInstructions: "no client contracts" },
    headers: ADMIN,
  });
  assert.equal(patchCalls.length, 1);
  assert.deepEqual(patchCalls[0].payload, {
    status: "approved_by_manager",
    employer_special_instructions: "no client contracts",
  });
  assert.ok(Object.values(EMPLOYER_VERBS).includes(patchCalls[0].payload.status));
});

// ---------------------------------------------------------------------------
// Which world the write lands in — real record vs stand-in
// ---------------------------------------------------------------------------

test("a record Remote handed us is PATCHed at Remote, and the change reads back off the API", async () => {
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${REMOTE_PENDING}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "approved_by_manager");
  assert.equal(res.json.remoteWrite.transmitted, true);
  assert.equal(res.json.remoteWrite.target, "remote_api");

  // The DESTINATION is checked, never the response flag — a green run that
  // touched nothing is the failure mode this repository names most often.
  const client = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const back = await client.getWorkAuthorization(REMOTE_PENDING);
  assert.equal(back.status, "approved_by_manager");
});

test("a stand-in record is never sent to Remote, and says so", async () => {
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_PENDING}/decision`,
    body: { action: "decline", reason: "the destination needs a permit we do not hold" },
    headers: ADMIN,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, "declined_by_manager");
  assert.equal(res.json.remoteWrite.transmitted, false);
  assert.equal(res.json.remoteWrite.target, "standin");
  assert.match(res.json.remoteWrite.detail, /never|not to Remote|nothing there to PATCH/i);
  assert.equal(patchCalls.length, 0, "a stand-in record must not reach Remote's PATCH");
});

test("a stand-in record is self-identifying in three independent places", async () => {
  const listed = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });

  // 1. the id
  const standins = listed.json.requests.filter((r) => r.origin === "standin");
  assert.ok(standins.length > 0);
  for (const entry of standins) {
    assert.ok(isStandinId(entry.id));
    assert.ok(entry.id.startsWith(STANDIN_ID_PREFIX));
    // 2. a block ON the record, so it survives being read out of this envelope
    const block = entry.request[STANDIN_ROW_KEY];
    assert.ok(block, "every stand-in record must carry its own marker block");
    assert.equal(block.ladderRung, 3);
    assert.match(block.note, /STAND-IN RECORD/);
    assert.match(block.sandboxProbe, /404/);
  }
  // 3. a response header, the same shape src/remotebridge/ uses
  assert.equal(listed.headers[STANDIN_HEADER], standins.map((s) => s.id).join(","));

  // And nothing Remote actually said is marked or rewritten.
  const real = listed.json.requests.filter((r) => r.origin === "remote_api");
  assert.ok(real.length > 0, "the rung-2 read must be exercised, or this proves only that rung 3 works");
  for (const entry of real) {
    assert.equal(entry.request[STANDIN_ROW_KEY], undefined);
    assert.equal(isStandinId(entry.id), false);
  }
});

test("the rung-2 probe is reported, not assumed — including what it answered", async () => {
  const res = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.match(res.json.remoteProbe.endpoint, /work-authorization-requests/);
  assert.ok(res.json.remoteProbe.employmentsQueried > 0, "Remote must actually be asked");
  assert.equal(typeof res.json.remoteProbe.rowsReturned, "number");
  assert.deepEqual(res.json.remoteProbe.failures, []);
});

test("the Remote record is nested, never spread — no employment_id is taught onto it", async () => {
  const res = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  for (const entry of res.json.requests) {
    assert.equal(
      entry.request.employment_id,
      undefined,
      "a WorkAuthorizationRequest carries no employment reference on the wire; putting one on it teaches a shape the API has never returned"
    );
    assert.ok(entry.employmentId, "the attribution belongs BESIDE the record, not on it");
  }
});

// ---------------------------------------------------------------------------
// Ordering: the durable record first, the outward act second
// ---------------------------------------------------------------------------

test("the audit row is written BEFORE Remote is called", async () => {
  await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${REMOTE_PENDING}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(patchCalls.length, 1);
  assert.ok(
    patchCalls[0].auditRowsBefore >= 1,
    "Remote was called with no audit row yet written — a transport failure would then lose the decision, not just the act"
  );
  const decision = auditRows[0];
  assert.equal(decision.durable, true, "the decision row must be logDurable, not best-effort");
  assert.equal(decision.action, "work_authorization_employer_approved");
  assert.equal(decision.actor, "admin_jane");
  assert.equal(decision.details.status, "approved_by_manager");
  assert.equal(decision.details.stage, CURRENT_STAGE);
  assert.equal(decision.details.companyId, "co_amend_01");
  assert.equal(
    decision.details.remoteReviewOutstanding,
    true,
    "the row itself must say Remote's own review has not happened — a reader of the trail alone must not think the employee is cleared"
  );
});

test("when Remote's PATCH fails, the decision still stands and the failure is named separately", async () => {
  handler = buildHandler({ patchFails: true });
  const res = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${REMOTE_PENDING}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(res.status, 502);
  assert.equal(res.json.code, "decision_recorded_remote_write_failed");

  const durable = auditRows.filter((r) => r.durable);
  assert.equal(durable.length, 1, "the decision must survive a failed transmission");
  assert.equal(durable[0].action, "work_authorization_employer_approved");
  assert.ok(
    auditRows.some((r) => r.action === "work_authorization_employer_write_failed"),
    "and the failure must be recorded as its own event — 'nobody decided' and 'Remote was not told' are different facts"
  );
});

// ---------------------------------------------------------------------------
// The access key — fails CLOSED
// ---------------------------------------------------------------------------

test("required-but-unconfigured refuses every API call, by its own name", async () => {
  const access = portalAccessPosture({ VERCEL: "1" }, { persistent: false });
  assert.equal(access.required, true);
  assert.equal(access.keyConfigured, false);
  handler = buildHandler({ access });

  const listed = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(listed.status, 401);
  assert.equal(listed.json.code, "portal_access_key_not_configured");

  const decided = await call(handler, {
    method: "POST",
    path: `/api/work-authorizations/${STANDIN_PENDING}/decision`,
    body: { action: "approve" },
    headers: ADMIN,
  });
  assert.equal(decided.status, 401);
  assert.equal(decided.json.code, "portal_access_key_not_configured");
  assert.equal(auditRows.length, 0);
});

test("a configured key is demanded, checked, and opens the surface", async () => {
  const access = portalAccessPosture({ VERCEL: "1", PORTAL_ACCESS_KEY: "s3cret" }, { persistent: false });
  handler = buildHandler({ access });

  const missing = await call(handler, { path: "/api/work-authorizations", headers: ADMIN });
  assert.equal(missing.json.code, "portal_access_key_required");

  const wrong = await call(handler, {
    path: "/api/work-authorizations",
    headers: { ...ADMIN, [PORTAL_KEY_HEADER]: "guess" },
  });
  assert.equal(wrong.json.code, "portal_access_key_invalid");

  const right = await call(handler, {
    path: "/api/work-authorizations",
    headers: { ...ADMIN, [PORTAL_KEY_HEADER]: "s3cret" },
  });
  assert.equal(right.status, 200);
  assert.equal(right.json.ok, true);
});

test("the page shell is served without a key — that is how the reader is told one is needed", async () => {
  handler = buildHandler({ access: portalAccessPosture({ VERCEL: "1" }, { persistent: false }) });
  const page = await call(handler, { path: "/work-authorizations" });
  assert.equal(page.status, 200);
  assert.match(page.raw, /<h1[^>]*>Work authorization requests<\/h1>/);
});

// ---------------------------------------------------------------------------
// The browser assets — never imported by npm test, so pinned here
// ---------------------------------------------------------------------------

test("workauth.js compiles and never injects raw markup", () => {
  const source = read("workauth.js");
  assert.doesNotThrow(() => new vm.Script(source, { filename: "workauth.js" }));
  assert.ok(!/\.innerHTML\s*=/.test(source), "workauth.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "workauth.js injects raw markup");
});

test("workauth.html loads exactly the assets that exist, and loads them RELATIVELY", () => {
  const html = read("workauth.html");
  for (const asset of ["workauth.js", "style.css", "remote-ui.css"]) {
    assert.ok(html.includes(asset), `workauth.html must load ${asset}`);
  }
  // Absolute paths ignore <base href>, so under the deployment's /remoteui
  // prefix the browser would ask the domain root for /workauth.js and get the
  // router's 404 — on a page whose shell renders perfectly.
  assert.ok(!/(?:src|href)="\//.test(html), "assets must be referenced relatively so <base href> can move them");

  const amendment = readFileSync(join(ASSETS, "index.html"), "utf8");
  assert.ok(!/(?:src|href)="\//.test(amendment), "the amendment page must be mountable too");
});

test("the client never restates a rule the server owns", () => {
  const source = read("workauth.js");
  // The two verbs travel as `chosenAction` and are validated server-side; the
  // page must not carry its own copy of Remote's status strings, or a change to
  // the schema would leave one of the two behind.
  assert.ok(!/approved_by_manager|declined_by_manager|approved_by_remote/.test(source));
  // And it never sends a company: the boundary is the server's alone.
  assert.ok(!/companyId\s*:/.test(source));
});
