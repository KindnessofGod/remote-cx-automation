// ---------------------------------------------------------------------------
// zafApprovalRole.test.js  —  the sidebar says what capacity you are acting in
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// A specialist opened a live UC-04 escalation (ticket #51, raised through the
// request portal) and asked, in these words:
//
//     "does the tag section show me which type of human approval that i am
//      acting as?"
//
// It does not, and it was never going to. `uc04_specialist_approval` and
// `queue_mobility_specialists` are ROUTING metadata — they record where the
// ticket was sent, not what the person reading it is being asked to be — and
// Zendesk's tag box is not a place anybody looks for that. The one screen where
// the decision is actually made said nothing about it at all.
//
// It got sharper the same day. Role entitlement landed (commit 2f3c722,
// src/review/approverEntitlement.js), so an approver can now be refused
// `approver_not_entitled` ON CLICK. Learning that you were never the right
// person for this ticket, from a refusal, after typing your name into an
// approval box, is the worst available moment to find out.
//
// ---------------------------------------------------------------------------
// THE LINE THIS FILE POLICES, AND IT IS EXACT
// ---------------------------------------------------------------------------
// Naming a role is a property of the USE CASE. Deciding whether a person holds
// one is a policy about a person, and it lives server-side. So:
//
//   · a panel MAY name the slot and report who has already filled it (both are
//     read off the API's own row);
//   · a panel MAY NOT decide, guess, or cache whether the reader is entitled;
//   · `youHold` is printed ONLY when an API sends it, and no API sends it yet;
//   · `view.actionable` is still the ONE question that gates a control, and 🔴
//     UC-07/UC-08 gain nothing clickable from any of this.
//
// The parity test below is the load-bearing one: every `roleId` the browser
// prints is asserted against USE_CASE_ROLES in src/review/approverEntitlement.js
// — imported, not restated — because a role the sidebar names and the roster
// does not contain is a control that appears to exist and cannot be granted.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { USE_CASE_ROLES } from "../src/review/approverEntitlement.js";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler } from "../src/uc04/server.js";
/* The fake-DOM harness now lives in test/fixtures/zafSidebar.js — a second test
   file needed it, and a copied harness drifts exactly the way a copied gate
   does, silently, with both copies still passing. */
import {
  capacityBlock,
  callHandler,
  collect,
  renderSidebar,
  rowValue,
  servedBy,
  textOf,
} from "./fixtures/zafSidebar.js";

const MAIN = new URL("../zaf-app/assets/main.js", import.meta.url);
const PANELS = new URL("../zaf-app/assets/panels.js", import.meta.url);

const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

/** panels.js in a sandbox, which is all the registry needs. */
function loadPanels() {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(readFileSync(PANELS, "utf8"), { filename: "panels.js" }).runInContext(context);
  return context.window;
}

/**
 * A descriptor, brought back across the realm boundary.
 *
 * CLAUDE.md §6 has this gotcha written down and it still cost a run here: a
 * value built inside a `node:vm` context has that context's Array/Object
 * prototypes, so assert.deepEqual compares two identical-looking arrays and
 * fails on prototype identity. JSON round-tripping is also what n8n does
 * between nodes, and what ZAF does between the iframe and an API — so it is the
 * shape the assertion should be made against anyway.
 */
function describeRoles(window, useCase, view) {
  return JSON.parse(JSON.stringify(window.CXPanelFor(useCase).approvalRoles(view || { case: { useCase } })));
}

const ALL_USE_CASES = ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"];

// ---------------------------------------------------------------------------
// THE DESCRIPTOR ITSELF
// ---------------------------------------------------------------------------

test("every panel answers what capacity the agent is being asked to act in", () => {
  const { CXPanelFor } = loadPanels();

  for (const uc of ALL_USE_CASES) {
    const panel = CXPanelFor(uc);
    assert.equal(typeof panel.approvalRoles, "function", `${uc} cannot say whose decision this is`);

    const described = panel.approvalRoles({ case: { useCase: uc } });
    assert.ok(described && typeof described === "object", `${uc} returned no descriptor`);
    assert.equal(typeof described.summary, "string", `${uc} has no plain-language summary`);
    assert.ok(described.summary.length > 20, `${uc}'s summary says nothing useful`);
    assert.ok(Array.isArray(described.roles), `${uc}'s roles must be a list`);

    // DATA, NEVER MARKUP — the same contract rows() has kept since this file's
    // sibling was written. main.js writes every one of these with textContent,
    // and the content originates in a support ticket.
    for (const role of described.roles) {
      for (const field of ["label", "decides"]) {
        assert.equal(typeof role[field], "string", `${uc} role is missing ${field}`);
        assert.ok(!/[<>]/.test(role[field]), `${uc} emitted markup-looking ${field}: ${role[field]}`);
      }
      // A sparse case must render an ABSENCE, never the string "undefined".
      assert.ok(role.filledBy === null || typeof role.filledBy === "string");
      assert.ok(role.roleId === null || typeof role.roleId === "string");
      // ENTITLEMENT IS NEVER SELF-ANSWERED. A panel that filled this in would
      // be a second copy of an access control, in a bundle any agent can
      // download.
      assert.equal(role.youHold, undefined, `${uc} decided its own entitlement`);
    }
  }
});

test("the roles the sidebar names are exactly the roles the roster can grant", () => {
  // THE DRIFT THIS MAKES IMPOSSIBLE. A role named here and absent from
  // USE_CASE_ROLES is a slot an agent is told to fill and no operator can ever
  // grant them — `approver_not_entitled` forever, with the sidebar insisting
  // they are the right person. The vocabulary is IMPORTED rather than restated,
  // for the same reason scripts/verify-trace-nodes.mjs lifts TRACED_CALLS out
  // of the deployed body: a local copy would share the typo and compare equal.
  const window = loadPanels();
  const { CXPanelFor } = window;

  // UC-09's third slot only exists on a high-risk adjustment, so the view has
  // to ask for it — the panel lists the slots THIS case actually requires.
  const views = {
    "UC-09": { case: { useCase: "UC-09", approvalSlotsRequired: 3 } },
  };

  for (const [useCase, expected] of Object.entries(USE_CASE_ROLES)) {
    const view = views[useCase] || { case: { useCase } };
    const ids = describeRoles(window, useCase, view).roles.map((r) => r.roleId);
    const want = expected.map((role) => `${useCase.toLowerCase().replace(/[^a-z0-9]/g, "")}:${role}`);
    assert.deepEqual(ids, want, `${useCase} names roles the entitlement roster does not define`);
  }

  // And a use case with NO roster names no grant. UC-02's "Finance Ops
  // reviewer" is a real job and not a real entitlement — printing an id for it
  // would invent a control that does not exist.
  for (const uc of ALL_USE_CASES.filter((u) => !USE_CASE_ROLES[u])) {
    for (const role of describeRoles(window, uc).roles) {
      assert.equal(role.roleId, null, `${uc} publishes an entitlement id for a use case with no roster`);
    }
  }
});

test("🔴 use cases name nobody, because there is nobody to name", () => {
  // UC-07 and UC-08 have no execution path at all. A role list for them would
  // be the same overstatement as a button: it would imply somebody, somewhere,
  // can sign this off here.
  const window = loadPanels();
  for (const uc of ["UC-07", "UC-08"]) {
    const described = describeRoles(window, uc);
    assert.deepEqual(described.roles, [], `${uc} offers a role slot it cannot honour`);
    assert.match(described.summary, /nobody approves/i, `${uc} does not say plainly that nobody approves here`);
  }
});

test("UC-03 names the owner of the one thing it cannot finish alone", () => {
  // UC-03 USED TO BE IN THE LIST ABOVE and no longer belongs there. The roster
  // gained "uc03:travel_support_specialist" (USE_CASE_ROLES in
  // src/review/approverEntitlement.js): the one thing this router cannot finish
  // alone is a formal travel letter on the entity's letterhead, and Travel &
  // Mobility Support signs it off.
  //
  // AND THE SUMMARY MOVED AGAIN, in the direction the naming was pointing at.
  // It used to end "nothing is signed on this screen", which was true of the
  // screen when it was written — src/uc03/server.js had no POST route — and
  // stopped being true when the sign-off shipped. main.js's loadUc03 hard-coded
  // `actionable: false` to match, so the one UC-03 outcome that needs a human
  // was unreachable on the only screen built to reach it. Both halves are
  // fixed; this pins the sentence to the state, so a third move has to come
  // with a reason.
  const window = loadPanels();
  const described = describeRoles(window, "UC-03");
  assert.equal(described.roles.length, 1);
  assert.equal(described.roles[0].roleId, "uc03:travel_support_specialist");
  assert.match(described.roles[0].decides, /travel letter/i);
  // Nothing is ever pre-filled: a slot nobody has signed must not be invented.
  assert.equal(described.roles[0].filledBy, null);
  // The summary names where the signature happens, and still says plainly that
  // a request routed on to UC-04 is NOT decided here — the panel's second
  // claim, and the one that is still about a different screen.
  assert.match(described.summary, /signs that off here/i);
  assert.match(described.summary, /approved there, not on this screen/i);
  assert.ok(
    !/nothing is signed on this screen/i.test(described.summary),
    "the old sentence outlived its truth once; it must not come back while the sign-off route exists"
  );
});

test("a filled slot is reported from the API's own row, and an empty one is not invented", () => {
  const { CXPanelFor } = loadPanels();

  const uc06 = CXPanelFor("UC-06").approvalRoles({
    case: {
      useCase: "UC-06",
      adminApproval: { approver: "admin_jane", at: "2026-08-19T09:00:00.000Z", note: null },
      payrollApproval: null,
    },
  });
  assert.equal(uc06.roles[0].filledBy, "admin_jane");
  // Formatted for a person by the panel's own date() helper, never a raw ISO string.
  assert.match(uc06.roles[0].filledOn, /2026/);
  assert.doesNotMatch(uc06.roles[0].filledOn, /T\d\d:\d\d:\d\dZ?/);
  assert.equal(uc06.roles[1].filledBy, null, "an unsigned slot must stay empty");

  // UC-04 records a DECLINE under different column names than an approval, and
  // both are the same fact for this card: somebody has already answered.
  const declined = CXPanelFor("UC-04").approvalRoles({
    case: { useCase: "UC-04", declinedBy: "sam@remote.com", declinedAt: "2026-08-19T10:00:00.000Z" },
  });
  assert.equal(declined.roles[0].filledBy, "sam@remote.com");
  assert.equal(declined.roles[0].filledAs, "Declined");
});

test("the browser holds no roster and computes no entitlement", () => {
  // The bundle is downloadable by anyone with an agent seat. A roster in it
  // would be both a disclosure and a second copy of the control — and the copy
  // would be the one that is wrong, because it cannot be updated without a
  // re-upload.
  // COMMENTS STRIPPED FIRST. Both files explain, at length, why the roster is
  // not here — and a check that read the prose would fail on the explanation
  // for the very property it is checking.
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const panels = strip(readFileSync(PANELS, "utf8"));
  const main = strip(readFileSync(MAIN, "utf8"));
  for (const [name, source] of [["panels.js", panels], ["main.js", main]]) {
    assert.ok(!/APPROVER_ROLES/.test(source), `${name} carries the roster's name`);
    assert.ok(!/parseRoster|createEntitlementChecker/.test(source), `${name} reaches for the entitlement module`);
    assert.ok(!/youHold\s*=[^=]/.test(source), `${name} assigns an entitlement verdict of its own`);
  }
  // main.js may only READ the server's verdict.
  assert.match(main, /role\.youHold === true/);
  assert.match(main, /role\.youHold === false/);
  // ...and it is read off the view the API returned, never off anything typed
  // on screen or held in this bundle.
  assert.match(main, /if \(view\.approvalRoles && typeof view\.approvalRoles === "object"\) return view\.approvalRoles;/);
});

// ---------------------------------------------------------------------------
// WHAT ENDS UP ON THE SCREEN
// ---------------------------------------------------------------------------
// These render. They boot the real zaf-app/assets/main.js against a fake DOM
// and read the words that came out — the same approach as
// test/zafExecutionClaim.test.js, and for the same reason: `npm test` never
// imports a browser asset, so a card nothing asserts can ship saying anything.

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

/** A real UC-04 workation, through the real gates and the real API handler. */
async function seedUc04() {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();
  const result = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "PT" },
        startDate: "2026-09-01",
        endDate: "2026-09-21",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-19",
      externalRef: "51",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  return { result, handler: createUc04Handler({ authorizationStore, audit, remote }) };
}

const UC04_BASE = "http://uc04.test";

test("a live UC-04 case says which capacity the specialist is being asked to act in", async () => {
  const { result, handler } = await seedUc04();
  assert.equal(result.decision, "ready_for_approval", "the fixture stopped being approvable");

  const { root, text, buttons } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 51,
    respond: async (url) => {
      const res = await callHandler(handler, { method: "GET", path: url.slice(UC04_BASE.length) });
      return res;
    },
  });

  const block = capacityBlock(root);
  assert.ok(block, "the sidebar never rendered the capacity card");
  const capacity = textOf(block);

  assert.match(capacity, /Who decides this/);
  assert.match(capacity, /Mobility specialist/, "the role the agent is acting in is not named");
  assert.match(capacity, /uc04:mobility_specialist/, "the grant to quote when asking for access is missing");
  assert.match(capacity, /outstanding/i, "an unsigned slot is not reported as outstanding");
  // The honest sentence, while no API answers entitlement. It has to name the
  // refusal code, because that is the string the agent will actually see if it
  // turns out they are not on the roster.
  assert.match(capacity, /checked by the API when you submit/i);
  assert.match(capacity, /approver_not_entitled/);

  // NOT a claim about this specific human. That judgement is the server's, and
  // no API makes it yet. Case-sensitive and anchored on the VERDICT form: the
  // honest fallback sentence a few lines up legitimately contains the words
  // "whether you hold this role", which is the opposite of a claim.
  assert.doesNotMatch(capacity, /\bYou hold this role/);
  assert.doesNotMatch(capacity, /\bYou do not hold this role/);

  // The rest of the screen is untouched, and this card is not a control.
  assert.equal(collect(block, (n) => n.tagName === "button").length, 0, "the capacity card grew a button");
  assert.ok(buttons.length >= 2, "the real approve/decline controls disappeared");
  // And the two rows this pass fixed, read off the real handler's response.
  const rows = textOf(root);
  assert.doesNotMatch(rows, /\[object Object\]/, "a raw object is still being printed");
  // THE RISK ROW IS GONE (2026-08-19), and with it the field-name defect it was
  // written to catch: the panel no longer reads `risk.riskLevel` at all. The
  // classification is published by the server as `basis.riskLevel`, with the
  // sentence saying it is a routing rollup — a bare second copy in a row put the
  // word "risk" on this screen four times with three different values, which is
  // what the project owner read as the panel contradicting itself.
  assert.doesNotMatch(rows, /Risk level/, "the bare risk row is back beside the rollup that supersedes it");
  assert.doesNotMatch(text, /Risk level — /, "the risk classification renders as an absence again");
});

test("the card renders when the case CANNOT be decided here, which is when it matters most", async () => {
  // A blocked UC-04 request is not actionable, so main.js renders the refusal
  // sentence instead of controls. That is exactly the state in which "then who
  // does decide this?" is the live question, and the card used to be inside the
  // actionable branch where it could never be seen.
  const view = {
    found: true,
    authorization: {
      id: "auth_blocked",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      risk: { riskLevel: "blocked" },
      decision: "blocked",
      reason: "sanctioned_region",
      flags: ["sanctioned_region"],
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    useCaseTier: "medium",
    executionModel: "single_approval",
    caseRisk: "high",
    caseRiskEscalated: true,
    escalatingFlagCount: 1,
    actionable: false,
    actionableReason: "A blocked request cannot be approved by anyone.",
  };

  const { root, buttons } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 52,
    respond: servedBy(UC04_BASE, view),
  });

  const block = capacityBlock(root);
  assert.ok(block, "an unactionable case renders no capacity card at all");
  assert.match(textOf(block), /Mobility specialist/);
  assert.equal(buttons.length, 0, "an unactionable case rendered a control");
});

test("when an API answers the entitlement question, the sidebar prints its answer verbatim", async () => {
  // NOTHING SENDS THIS TODAY. It is the shape a server should send, pinned here
  // so the two halves can be built in either order — the same discipline the
  // signed-read path needed, where an API and a bundle each waited for the
  // other and neither worked.
  const view = {
    found: true,
    authorization: {
      id: "auth_entitled",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      risk: { riskLevel: "medium" },
      decision: "ready_for_approval",
      reason: "specialist_review_required",
      flags: [],
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    useCaseTier: "medium",
    executionModel: "single_approval",
    caseRisk: "medium",
    caseRiskEscalated: false,
    escalatingFlagCount: 0,
    actionable: true,
    actionableReason: null,
    approvalRoles: {
      summary: "One named mobility specialist decides this.",
      roles: [
        {
          roleId: "uc04:mobility_specialist",
          label: "Mobility specialist",
          decides: "whether this trip may go ahead",
          filledBy: null,
          filledOn: null,
          filledAs: null,
          youHold: false,
        },
      ],
    },
  };

  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 53,
    respond: servedBy(UC04_BASE, view),
  });

  const capacity = textOf(capacityBlock(root));
  assert.match(capacity, /You do not hold this role/i, "the server's verdict was dropped");
  // ...and the fallback sentence stands down, because the question has been
  // answered. Printing both would tell the agent it is unknown and known.
  assert.doesNotMatch(capacity, /checked by the API when you submit/i);
});

test("a multi-role case says how many signatures are still outstanding", async () => {
  const view = {
    found: true,
    amendment: {
      id: "amd_1",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      amendmentType: "SALARY_INCREASE",
      adminApproval: { approver: "admin_jane", at: "2026-08-19T09:00:00.000Z", note: null },
      payrollApproval: null,
      createdAt: "2026-08-19T08:00:00.000Z",
      decision: "dual_approval_required",
      reason: "dual_approval_required",
      flags: [],
    },
    useCaseTier: "medium",
    executionModel: "dual_approval",
    caseRisk: "medium",
    caseRiskEscalated: false,
    escalatingFlagCount: 0,
    actionable: true,
    actionableReason: null,
  };

  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc06ApiBaseUrl: "http://uc06.test" },
    ticketId: 54,
    respond: servedBy("http://uc06.test", view),
  });

  const capacity = textOf(capacityBlock(root));
  assert.match(capacity, /Customer Admin/);
  assert.match(capacity, /Payroll Specialist/);
  assert.match(capacity, /Approved by admin_jane/);
  // NAMED, not counted — UC-06's own approval meter renders "1 of 2 approvals
  // recorded" a few lines below, and two "1 of 2"s meaning opposite things on
  // one screen is the ambiguity this card exists to remove, not to add.
  assert.match(capacity, /Still to sign: Payroll Specialist\./);
  assert.doesNotMatch(capacity, /1 of 2 roles/);
});

// ---------------------------------------------------------------------------
// "ACTING AS" — THE PLACE TO SAY WHICH ROLE YOU ARE PLAYING
// ---------------------------------------------------------------------------
// The second half of the same ask: "there needs to be a clear indication when I
// am playing a role. There needs to be a logical place to enter that role."
// src/portal/ already answers it for requesters with a "Signed in as" persona
// picker; this is the approver side of it.
//
// THE PROPERTY THAT MAKES IT SAFE, and the reason these tests exist: the picker
// changes which FORM is on screen and nothing else. Each form posts its own
// fixed role, exactly as it did when both were rendered at once, so the picker
// is precisely as authoritative as scrolling was — none. A picker that could
// grant a role would be worse than no picker at all.

/** Every role form the panel rendered, by the role its class names. */
function roleSlots(root) {
  const out = {};
  collect(root, (n) => /(?:^|\s)role-slot-([a-z0-9_]+)/.test(String(n.className))).forEach((n) => {
    out[String(n.className).match(/(?:^|\s)role-slot-([a-z0-9_]+)/)[1] ] = n;
  });
  return out;
}

function pickerOptions(root) {
  const select = collect(root, (n) => String(n.className).indexOf("role-picker-select") !== -1)[0];
  return select ? select.childNodes.map((o) => ({ value: o.value, label: String(o.textContent) })) : null;
}

function uc06View(overrides = {}) {
  return {
    found: true,
    amendment: {
      id: "amd_1",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      amendmentType: "SALARY_INCREASE",
      adminApproval: { approver: "admin_jane", at: "2026-08-19T09:00:00.000Z", note: null },
      payrollApproval: null,
      createdAt: "2026-08-19T08:00:00.000Z",
      decision: "dual_approval_required",
      reason: "dual_approval_required",
      flags: [],
      ...overrides,
    },
    useCaseTier: "medium",
    executionModel: "dual_approval",
    caseRisk: "medium",
    caseRiskEscalated: false,
    escalatingFlagCount: 0,
    actionable: true,
    actionableReason: null,
  };
}

test("a dual-control case offers a place to say which role you are acting in", async () => {
  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc06ApiBaseUrl: "http://uc06.test" },
    ticketId: 55,
    respond: servedBy("http://uc06.test", uc06View()),
  });

  const options = pickerOptions(root);
  assert.ok(options, "a two-role case rendered no way to choose a role");
  assert.deepEqual(options.map((o) => o.value), ["customer_admin", "payroll_specialist"]);
  // A slot somebody has already signed is still selectable — an agent may want
  // to read it — but it says so, so nobody types into a form nobody is waiting
  // on.
  assert.match(options[0].label, /already signed/);

  // AND IT OPENS ON THE WORK. The admin has signed; payroll has not; the form on
  // screen is payroll's.
  const slots = roleSlots(root);
  assert.ok(/is-hidden/.test(String(slots.customer_admin.className)), "the signed slot's form is still on screen");
  assert.ok(!/is-hidden/.test(String(slots.payroll_specialist.className)), "the outstanding slot's form is hidden");

  // Hidden, NOT REMOVED. Both forms keep their own role and their own buttons —
  // which is what makes the picker a view control instead of a gate.
  assert.equal(collect(slots.customer_admin, (n) => n.tagName === "button").length, 0, "a signed slot has no controls");
  assert.ok(collect(slots.payroll_specialist, (n) => n.tagName === "button").length >= 2);

  // The honest sentence, in the picker itself.
  const picker = collect(root, (n) => String(n.className) === "r-role-picker")[0];
  assert.match(textOf(picker), /grants nothing/i);
  assert.match(textOf(picker), /decided when you submit/i);
});

test("the picker never becomes the thing that decides", () => {
  // Structural, because this is the property that makes a role picker
  // acceptable at all in a bundle any agent can download. The selected value
  // must not reach a request body, a header, or an entitlement check: the role
  // that is POSTed comes from the block whose button was pressed, in panels.js,
  // and it always has.
  const main = readFileSync(MAIN, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const picker = main.slice(main.indexOf("function attachRolePicker("), main.indexOf("function renderActions(view"));
  assert.ok(picker.length > 500, "attachRolePicker was not found where expected");
  for (const forbidden of [/view\.post/, /cxPost/, /cxRequest/, /approver/, /actionable/, /youHold/]) {
    assert.ok(!forbidden.test(picker), `the picker reaches for ${forbidden} — it may only show and hide`);
  }
  // Its entire effect on the DOM is a display class.
  assert.match(picker, /setHidden\(/);
  assert.match(main, /function setHidden\(node, hidden\)/);
});

test("one slot is not a choice, and a slot with no form is never offered", async () => {
  // UC-04 has a single approver. A picker with one option is furniture that
  // implies a decision the agent does not have to make.
  const { handler } = await seedUc04();
  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 51,
    respond: async (url) =>
      String(url).indexOf(UC04_BASE) === 0
        ? await callHandler(handler, { method: "GET", path: String(url).slice(UC04_BASE.length) })
        : { status: 404, body: { found: false } },
  });
  assert.equal(pickerOptions(root), null, "a single-approver case rendered a role picker");
  // ...and the card still names the role, which is the half that answers the
  // question on its own.
  assert.match(textOf(capacityBlock(root)), /Mobility specialist/);
});

// ---------------------------------------------------------------------------
// A SETTLED DECISION IS A LIST OF FACTS
// ---------------------------------------------------------------------------
// The owner read a closed UC-04 approval and asked "please explain to me why
// all this story". The facts were right; describeSettled() joins them with
// NEWLINES, and HTML collapses newlines, so five labelled facts arrived as one
// run-on sentence. src/uc04/server.js now sends the structured `settled`
// alongside, and this is the half that renders it.

test("a closed decision renders as labelled rows, not as a paragraph", async () => {
  const view = {
    found: true,
    authorization: {
      id: "auth_done",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      risk: { riskLevel: "low" },
      decision: "ready_for_approval",
      reason: "all_gates_passed",
      flags: [],
      status: "executed",
      approver: "b.person@gmail.com",
      approvedAt: "2026-08-19T22:25:07.000Z",
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    useCaseTier: "medium",
    executionModel: "single_approval",
    caseRisk: "low",
    caseRiskEscalated: false,
    escalatingFlagCount: 0,
    actionable: false,
    actionableReason: "Approved.\nApproved by: b.person@gmail.com\nApproved on: 19 Aug 2026 at 22:25 UTC",
    settled: {
      headline: "Approved.",
      facts: [
        { label: "Approved by", value: "b.person@gmail.com" },
        { label: "Approved on", value: "19 Aug 2026 at 22:25 UTC" },
        { label: "Note left", value: "k" },
        { label: "Sent to Remote", value: "No — no work-authorisation request is linked to it." },
      ],
      finality: "This is final — an approved request cannot be approved or declined again.",
    },
  };

  const { root, buttons } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 56,
    respond: servedBy(UC04_BASE, view),
  });

  // Every fact on its own labelled row, read the same way the Case card is read.
  for (const [label, value] of [
    ["Approved by", "b.person@gmail.com"],
    ["Approved on", "19 Aug 2026 at 22:25 UTC"],
    ["Note left", "k"],
  ]) {
    assert.equal(rowValue(root, label), value, label + " is not a row of its own");
  }
  assert.match(textOf(root), /This is final/);

  // ONCE, AND ONLY ONCE. Two places could print the approver's name — these
  // rows, and the capacity card's own "Approved by …" line directly above. One
  // decision printed twice inches apart is how a reader starts wondering
  // whether they are looking at two, so the card defers to the rows and shows
  // the slot as RECORDED without repeating the name.
  const text = textOf(root);
  assert.ok(
    text.indexOf("b.person@gmail.com") === text.lastIndexOf("b.person@gmail.com"),
    "the approver's name is printed twice"
  );
  assert.match(textOf(capacityBlock(root)), /recorded/i, "the capacity card stopped saying the slot is filled");
  // ...and the run-on string it replaces is nowhere on screen.
  assert.doesNotMatch(text, /Approved\.\s*Approved by:/);

  // A settled case is not a decidable one, whatever it renders.
  assert.equal(buttons.length, 0, "a settled decision offered a control");
});

test("an API that sends no `settled` still renders its reason", async () => {
  // Eight of the nine send no such field today. The fallback is the string they
  // do send — never a blank card, which would read as "nothing to see here" on
  // a case somebody has to work.
  const view = {
    found: true,
    dossierRow: { id: "d1", employmentId: "emp_active_001", createdAt: "2026-08-19T10:00:00.000Z", dossier: {} },
    useCaseTier: "high",
    executionModel: "none",
    caseRisk: "high",
    caseRiskEscalated: false,
    escalatingFlagCount: 0,
    actionable: false,
    actionableReason: "UC-08 has no execution path — this dossier can only be escalated.",
  };
  const { root, buttons } = await renderSidebar({
    settings: { apiBaseUrl: "", uc08ApiBaseUrl: "http://uc08.test" },
    ticketId: 57,
    respond: servedBy("http://uc08.test", view),
  });
  assert.match(textOf(root), /no execution path/);
  assert.equal(buttons.length, 0, "🔴 UC-08 grew a control");
});
