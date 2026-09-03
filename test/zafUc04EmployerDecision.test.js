// ---------------------------------------------------------------------------
// zafUc04EmployerDecision.test.js  —  the sidebar must not make the CUSTOMER's
// work-authorization decision, and must not pretend to make Remote's own
// ---------------------------------------------------------------------------
// THE DEFECT, IN ONE SENTENCE. The ZAF sidebar's UC-04 panel rendered Approve
// and Decline; those buttons posted to
// `POST /api/authorizations/:id/approve|decline`, which
// `submitWorkationApproval()` turns into
// `PATCH /v1/work-authorization-requests/{id}` carrying `approved_by_manager`.
//
// WHY THAT IS THE WRONG PERSON. Remote's work-authorization lifecycle has three
// stages (verified against developer.remote.com on 2026-08-30):
//
//   1. the EMPLOYEE submits;
//   2. the CUSTOMER'S MANAGER approves or declines — the schema names this party
//      `employer_approver`, its example address is `user0@company.com`, and it
//      carries `employer_special_instructions`, "Special instructions from the
//      employer";
//   3. REMOTE'S OWN MOBILITY TEAM reviews — `approved_by_remote` /
//      `declined_by_remote`.
//
// `PATCH` accepts EXACTLY the two stage-2 values, in both documented variants.
// There is NO endpoint for stage 3 anywhere: the whole surface is two GETs and
// two PATCHes. So a Remote CX specialist clicking Approve in Zendesk was making
// the customer's decision under their own name — and could not have been given
// a stage-3 button instead, because one would report success having written
// nothing to Remote. That is this repository's most expensive recurring failure
// (CLAUDE.md §6).
//
// WHAT THIS FILE PINS, and why each half is needed:
//
//   · THE SIDEBAR CANNOT ACT. Structurally — no `post` in the loader, no
//     `renderActions` on the panel, and a shell that refuses to draw controls
//     without somewhere to send them — and behaviourally, via the server's own
//     `actionable: false` on the sidebar's route.
//   · THE ABSENCE IS EXPLAINED. A missing button and a broken button look
//     identical. The server sends the words; the bundle renders them.
//   · THE CAPABILITY SURVIVES. `POST .../approve` still works and still PATCHes
//     Remote, because the employer's decision has to be makeable SOMEWHERE —
//     the customer-facing surface is that caller. Deleting the route would have
//     been a bigger defect than the one being fixed, and this file is the thing
//     that would notice if a later pass deleted it.
//   · AND IT IS NOT THE 🔴 CLAIM. UC-04 has an execution path; it is simply not
//     on this screen. `test/zafExecutionClaim.test.js` owns the rendered half of
//     that distinction; the copy assertion here is the source-level backstop.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { startMockServer, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler, sidebarActionability, CX_SIDEBAR_NO_DECISION } from "../src/uc04/server.js";

const MAIN = new URL("../zaf-app/assets/main.js", import.meta.url);
const PANELS = new URL("../zaf-app/assets/panels.js", import.meta.url);

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

let audit;
let authorizationStore;
let handler;
beforeEach(() => {
  audit = new AuditLogger();
  authorizationStore = new AuthorizationStore();
  handler = createUc04Handler({ authorizationStore, audit, remote });
  resetWorkAuthorizations();
});

// The LLM seam, faked: a genuine but unreachable OPENAI_API_KEY in this
// devcontainer turns an un-injected call into a real, slow, failing request.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function callApi({ method, path, body = null }) {
  return new Promise((resolve, reject) => {
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
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

/** An approvable request, carried on a Zendesk ticket so both routes are reachable. */
function seedApprovable(externalRef = "9401") {
  return handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        // ES matches the mock's own pending work-authorization request for this
        // employment, so the approval path really resolves a record rather than
        // taking the "no Remote counterpart" branch.
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
      externalRef,
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

/** panels.js on its own — it registers itself on `window` and touches nothing else. */
function loadPanels() {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(readFileSync(PANELS, "utf8"), { filename: "panels.js" }).runInContext(context);
  return context.window;
}

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// THE SERVER
// ---------------------------------------------------------------------------

test("the sidebar's route reports no case as actionable, however approvable it is", async () => {
  await seedApprovable("9401");
  const res = await callApi({ method: "GET", path: "/api/authorizations/by-ticket/9401" });

  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  // THE PRECONDITION. If this row were not approvable, `actionable: false` would
  // prove nothing at all — it would just be the approval policy refusing
  // normally, which it has always done.
  assert.equal(res.body.employerActionable, true, "the fixture stopped being approvable by the employer");
  assert.equal(res.body.actionable, false, "the sidebar is being offered the customer's decision again");
});

test("the sidebar's refusal names both owners, because a missing button and a broken one look the same", async () => {
  await seedApprovable("9402");
  const { body } = await callApi({ method: "GET", path: "/api/authorizations/by-ticket/9402" });

  // Stage 2 — whose it is, and where it is made.
  assert.match(body.actionableReason, /employer's approval belongs to the customer/i);
  assert.match(body.actionableReason, /in Remote's product/i);
  // Stage 3 — why Remote's own review is not offered here either. This is the
  // half that is easy to leave out, and the half that stops a reader concluding
  // the button is merely missing.
  assert.match(body.actionableReason, /no endpoint for that stage/i);
  // ...and what the screen IS for, so the refusal does not read as a dead end.
  assert.match(body.actionableReason, /the prepared case/i);
});

test("the case's own refusal still comes first, and is never replaced by the surface's", async () => {
  // A blocked request is refused for a reason ABOUT THE CASE, and that reason is
  // the one a specialist needs first. The surface sentence is appended, never
  // substituted — otherwise fixing the attribution defect would have destroyed
  // every policy refusal the panel has ever shown.
  const blocked = sidebarActionability({ allowed: false, reason: "A blocked request cannot be approved by anyone." });
  assert.ok(blocked.actionableReason.startsWith("A blocked request cannot be approved by anyone."));
  assert.ok(blocked.actionableReason.endsWith(CX_SIDEBAR_NO_DECISION));
  assert.equal(blocked.actionable, false);
  assert.equal(blocked.employerActionable, false);

  // And on a case the policy would have allowed there is no case-reason to
  // carry, so the surface sentence stands alone rather than after a blank.
  const open = sidebarActionability({ allowed: true, reason: null });
  assert.equal(open.actionableReason, CX_SIDEBAR_NO_DECISION);
});

test("the employer-side read is untouched — the customer's own surface still gets a real answer", async () => {
  // THE ROUTES HAVE DIFFERENT AUDIENCES, which is what makes the split honest
  // rather than a fudge. A Zendesk ticket id is held only by Remote's CX staff;
  // an employer looking at their own request in Remote's product holds an
  // authorization id and no ticket. Flipping `actionable` on BOTH would leave
  // the field carrying no information anywhere and would break the one surface
  // that may legitimately act.
  const created = await seedApprovable("9403");
  const byId = await callApi({ method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(byId.body.actionable, true, "the employer-side read lost the stage-2 answer");
});

test("the employer's approval still executes — the capability was never the defect", async () => {
  // If a later pass deletes `POST /api/authorizations/:id/approve` on the
  // strength of the fix above, this is what notices. The customer's decision has
  // to be makeable somewhere: removing it would take away the one stage Remote's
  // API actually supports.
  const created = await seedApprovable("9404");
  const res = await callApi({
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/approve",
    body: { approver: "manager@company.com", note: "Approved by the employer." },
  });
  assert.equal(res.status, 200, "the employer can no longer approve anywhere");
  assert.equal(res.body.ok, true);
});

// ---------------------------------------------------------------------------
// THE BUNDLE — STRUCTURALLY, NOT BY THE SERVER'S GOOD BEHAVIOUR
// ---------------------------------------------------------------------------
// `zaf-app/assets/*.js` is never imported by `npm test`, so a change here ships
// silently. These read the real source.

/* ---------------------------------------------------------------------------
   NARROWED 2026-08-31, AND ONLY IN THE HALF THAT WAS ABOUT ABSENCE
   ---------------------------------------------------------------------------
   The two tests below used to assert that the loader attaches NO `post` and the
   panel supplies NO `renderActions` — the strongest possible reading of "this
   screen does not act". That reading has been superseded by an explicit product
   decision: Remote's mobility reviewer must be able to record stage 3 in
   Zendesk, and it is recorded in THIS system because Remote publishes no
   endpoint for it (src/uc04/mobilityReview.js).

   WHAT THIS FILE WAS ACTUALLY DEFENDING IS UNCHANGED AND IS STILL ASSERTED,
   harder than before: the sidebar must never make the CUSTOMER'S decision. So
   these two now pin the shape of the control rather than its absence —
   `POST .../mobility-review` and nowhere else, `clear`/`decline` and never
   `approve`, and the verb in the BODY rather than as a route segment, which is
   what makes the employer's endpoint structurally unreachable from this bundle
   rather than merely unused.

   `test/uc04MobilityReview.test.js` owns the server half. --------------------- */

test("UC-04's loader posts to the mobility-review route and to nothing else", () => {
  const main = readFileSync(MAIN, "utf8");
  const start = main.indexOf("function loadUc04(");
  const end = main.indexOf("function loadUc05(");
  assert.ok(start > -1 && end > start, "loadUc04 was not found where expected");
  const body = stripComments(main.slice(start, end));

  assert.match(body, /\/mobility-review"/, "loadUc04 no longer posts stage 3 anywhere");

  // THE EMPLOYER'S ENDPOINT MUST BE UNREACHABLE FROM HERE. Not "unused" — the
  // URL is a fixed string, so no verb the panel names can become a route
  // segment. `+ "/" + action` is the shape the 2026-08-30 defect was built on.
  assert.ok(
    !/authorizations\/[^"']*"\s*\+\s*(encodeURIComponent\()?\s*action/.test(body),
    "loadUc04 builds its URL from the action again — any verb can become a route segment"
  );
  assert.ok(!/"approve"|'approve'/.test(body), "loadUc04 names the employer's verb");
  assert.ok(!/\/decline"|\/approve"/.test(body), "loadUc04 targets an employer decision path");
});

test("the UC-04 panel's controls are stage 3's, and its verbs are never the employer's", () => {
  const { CXPanelFor } = loadPanels();
  const panel = CXPanelFor("UC-04");
  assert.equal(typeof panel.renderActions, "function", "the UC-04 panel lost its mobility-review controls");

  // The 🔴 pair is quoted so the CONTRAST is visible here rather than inferred:
  // they render nothing because nobody, anywhere, may act. UC-04 renders
  // something because somebody may — just not the employer's decision.
  assert.equal(CXPanelFor("UC-07").renderActions, undefined);
  assert.equal(CXPanelFor("UC-08").renderActions, undefined);

  // The verbs, read out of the real source.
  const panels = stripComments(readFileSync(PANELS, "utf8"));
  const start = panels.indexOf('"UC-04": {');
  const end = panels.indexOf('"UC-05": {');
  const block = panels.slice(start, end);
  assert.match(block, /action: "clear"/, "the clearance verb is gone");
  assert.match(block, /action: "decline"/);
  assert.ok(!/action: "approve"/.test(block), "the UC-04 panel offers the employer's verb again");
});

test("the panel draws no control at all when the server sends no notice", () => {
  // THE CONTROL AND THE SENTENCE SHIP TOGETHER OR NEITHER SHIPS. An unlabelled
  // version of this control is exactly the defect it is designed not to be: a
  // button that records a decision without saying that the decision goes
  // nowhere near Remote. So a view with no `mobilityReview` — an older API, a
  // hand-built fixture — gets an empty container, not a naked pair of buttons.
  const { CXPanelFor } = loadPanels();
  const made = [];
  const ctx = {
    el(tag, cls, text) {
      const node = { tag, cls, text, children: [], appendChild: (c) => node.children.push(c), setAttribute() {} };
      made.push(node);
      return node;
    },
    resize() {},
    reload() {},
    labelledField() {
      throw new Error("renderSingleApproverActions must not run without a notice");
    },
  };
  const out = CXPanelFor("UC-04").renderActions({ case: { useCase: "UC-04" } }, ctx);
  assert.equal(out.children.length, 0, "controls were drawn with no notice to put above them");
});

test("the shell will not draw a control it has nowhere to send", () => {
  // DEFENCE IN DEPTH, and the cheapest of the three locks. Without it the whole
  // fix rests on the server answering `actionable: false` forever — one stale
  // fixture or one future route away from an Approve button whose click throws,
  // or worse, is quietly rewired to something that writes.
  const main = stripComments(readFileSync(MAIN, "utf8"));
  assert.match(
    main,
    /if \(typeof view\.post !== "function"\) \{/,
    "renderActions lost the guard that refuses controls with no destination"
  );
});

test("the panel explains the absence, and never borrows the 🔴 tier's sentence", () => {
  const { CXPanelFor } = loadPanels();
  const described = CXPanelFor("UC-04").approvalRoles({ case: { useCase: "UC-04" } });

  // WHO DOES DECIDE, both of them, in the requester's language.
  assert.match(described.summary, /employer's approval is the customer's own/i);
  assert.match(described.summary, /no API this system can call/i);

  /* AND NOT "no execution path exists". UC-04 HAS one — a named human approving
     is this 🟡 use case's execution path (CLAUDE.md §3 directive 2) — it is just
     not walked here. That sentence is the 🔴 tier's architectural guarantee, and
     printing it on a use case that has a working path is the overstatement
     UC-07/UC-08 exist to make impossible. */
  assert.ok(!/no execution path/i.test(described.summary), "UC-04 borrowed the 🔴 tier's guarantee");
  assert.ok(!/no execution path/i.test(CXPanelFor("UC-04").approveHint({})), "the hint borrowed it instead");

  // The Remote-side role is named but never claimed as filled — see the
  // descriptor's own comment. `authorization.approver` is the EMPLOYER's
  // stage-2 signature and belongs in the settled rows, not in this slot.
  assert.equal(described.roles.length, 1);
  assert.equal(described.roles[0].roleId, "uc04:mobility_specialist");
  const withSignature = CXPanelFor("UC-04").approvalRoles({
    case: { useCase: "UC-04", approver: "cx.agent@remote.com", approvedAt: "2026-08-19T10:00:00.000Z" },
  });
  assert.equal(
    withSignature.roles[0].filledBy,
    null,
    "the employer's signature is being reported as a Remote mobility specialist's again"
  );
});
