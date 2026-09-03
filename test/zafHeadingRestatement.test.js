// ---------------------------------------------------------------------------
// zafHeadingRestatement.test.js  —  a heading says the thing once
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner, looking at a banner on the request portal whose heading
// read "Continued from your travel request" and whose body then explained at
// length what that meant:
//
//     "remove this part … only the heading is needed. Same for every use case."
//
// The shape being named is a heading that says the thing, followed by prose
// that says the thing again. It grows one card at a time and no single card
// looks wrong: each sentence was written by someone who could not see the
// heading above it or the rows below it, and each was correct on its own. The
// page is where the repetition lives, so the page is where it is tested — the
// same reasoning as test/zafSidebarLayout.js's, one register down: that file
// tests ORDER, this one tests whether a sentence had to be printed at all.
//
// THE FOUR THINGS THIS SWEEP MUST NOT TAKE, and every assertion below exists to
// hold one of them in place:
//
//   1. A STATEMENT OF WHAT THE SYSTEM DID OR DID NOT DO. "Nothing is written to
//      Remote either way", "there is no control for it on this screen", "no
//      immigration document was read". A specialist cannot check those against
//      anything on screen; they are the screen.
//   2. THE 🔴 FRAMING STATEMENT, verbatim and above the analysis. It is prose
//      under a heading and it is the one sentence that must never be cut.
//   3. THE HONESTY SENTENCES — "no role would change that", "no risk score can
//      lower the floor", "there is no second signature". Each exists because
//      something would otherwise be read as a permission, a ranking or a fact.
//   4. A HEADING PLUS A REAL FACT, which is not redundancy at all.
//
// The assertions are therefore two-sided wherever a sentence was cut: what went
// is asserted ABSENT so it cannot drift back, and what it was protecting is
// asserted PRESENT so the cut cannot quietly take it next time.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { createUc08Handler } from "../src/uc08/server.js";
import { draftNarrative } from "../src/uc08/dossierBuilder.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { handleRelocationReview } from "../src/uc07/workflow.js";
import { createUc07Handler } from "../src/uc07/server.js";
import { draftNarrative as draftRelocationNarrative } from "../src/uc07/dossierBuilder.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";

import { callHandler, collect, renderSidebar, servedBy, textOf } from "./fixtures/zafSidebar.js";

const MAIN = new URL("../zaf-app/assets/main.js", import.meta.url);
const PANELS = new URL("../zaf-app/assets/panels.js", import.meta.url);

const ALL_USE_CASES = ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"];

const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });
const fakeDraftNarrative = (args) => draftNarrative(args, { isConfigured: () => false });
const fakeDraftRelocationNarrative = (args) => draftRelocationNarrative(args, { isConfigured: () => false });

/** panels.js on its own — it registers itself on `window` and touches nothing else. */
function loadPanels() {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(readFileSync(PANELS, "utf8"), { filename: "panels.js" }).runInContext(context);
  return context.window;
}

/** What a reader sees before clicking anything: a <details> contributes only its <summary>. */
function openText(node) {
  if (node.tagName === "details") {
    const summary = node.childNodes.filter((c) => c.tagName === "summary")[0];
    return summary ? textOf(summary) : "";
  }
  const own = node.textContent ? String(node.textContent) : "";
  return (own + " " + node.childNodes.map(openText).join(" ")).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// A SUMMARY SAYS WHAT ITS OWN ROWS CANNOT
// ---------------------------------------------------------------------------
// "Who decides this" is the heading; under it every role prints its label, its
// state, what it decides and who filled it. A summary that opens "One named
// mobility specialist decides this" has said the heading and then the row.

test("no capacity summary reprints what one of its own role rows says", () => {
  const { CXPanelFor } = loadPanels();
  for (const uc of ALL_USE_CASES) {
    const described = CXPanelFor(uc).approvalRoles({ case: { useCase: uc } });
    for (const role of described.roles || []) {
      // The LABEL is deliberately not checked: UC-03's summary names Travel &
      // Mobility Support on purpose, because naming where the signature happens
      // is the claim that summary exists to make (test/zafApprovalRole.test.js
      // pins it). What no summary may do is print a row's own `decides`
      // sentence a second time, because that sentence is always directly below.
      assert.ok(
        !String(described.summary).includes(role.decides),
        `${uc}'s summary reprints "${role.decides}", which its own role row states directly below it`
      );
    }
  }
});

test("the single-approver summaries keep the absence and drop the heading", () => {
  const { CXPanelFor } = loadPanels();

  // UC-02, UC-04 and UC-05 each have exactly one role, so "one X decides this"
  // is the heading plus the only row. What a row structurally cannot say is
  // that there is no SECOND one — a missing signature is not a visible row.
  for (const [uc, kept] of [
    ["UC-02", /no second signature/i],
    /* UC-04's ABSENCE CHANGED KIND ON 2026-08-30, so the claim its summary
       exists to make changed with it. It used to be "there is no second
       signature on this one" — true while a Remote CX specialist signed the
       first. That signature was `approved_by_manager`, which Remote's schema
       gives to the CUSTOMER'S own manager, so it was never Remote CX's to give
       and has moved to the customer-facing surface. The absence now worth
       stating is bigger and is the one no row can carry: NEITHER party decides
       here, and the Remote-side stage that would has no endpoint at all. */
    ["UC-04", /no API this system can call/i],
    // UC-05's absence is of a different kind and is the more important one: it
    // is a statement about what this system does NOT do to Remote.
    ["UC-05", /nothing is written to Remote either way/i],
  ]) {
    const summary = CXPanelFor(uc).approvalRoles({ case: { useCase: uc } }).summary;
    assert.match(summary, kept, `${uc} lost the claim its summary existed to make`);
    assert.ok(
      !/\bdecides this\b/i.test(summary),
      `${uc}'s summary says "decides this" again under a heading reading "Who decides this"`
    );
  }
});

test("the 🔴 summaries stop at the answer, because the rail and the framing carry the rest", () => {
  const { CXPanelFor } = loadPanels();
  for (const uc of ["UC-07", "UC-08"]) {
    const summary = CXPanelFor(uc).approvalRoles({ case: { useCase: uc } }).summary;
    // THE ANSWER, and the honesty sentence that stops "nobody approves" being
    // read as a permissions problem somebody could fix.
    assert.match(summary, /nobody approves/i, `${uc} stopped saying plainly that nobody approves here`);
    assert.match(summary, /no role would change that/i, `${uc} lost the half that is only here`);
    // WHAT WENT, AND WHERE IT STILL IS. "no execution path" is the tier rail's
    // sentence (EXECUTION_MODELS.none in main.js) and "research support" is the
    // mandatory framing statement's — printed at the top of the page, verbatim.
    assert.ok(
      !/no execution path/i.test(summary),
      `${uc}'s summary restates the tier rail's own sentence about execution`
    );
    assert.ok(
      !/research support/i.test(summary),
      `${uc}'s summary restates the framing statement, which is printed above the analysis and must stay there`
    );
  }
});

test("UC-09's floor sentence still names the floor it is about", () => {
  const { CXPanelFor } = loadPanels();
  // The sentence it used to lean on ("Two different people must sign … before
  // any money moves") is the tier rail's, and went. A trailing "that floor"
  // would then point at nothing.
  const two = CXPanelFor("UC-09").approvalRoles({ case: { useCase: "UC-09", approvalSlotsRequired: 2 } }).summary;
  assert.match(two, /floor of two/i);
  assert.ok(!/that floor/i.test(two), "the antecedent was removed; the pronoun must not survive it");

  // THREE IS A FACT ABOUT THE CASE, not a restatement: the rail says "at least
  // two", and only this sentence says this adjustment needs three.
  const three = CXPanelFor("UC-09").approvalRoles({ case: { useCase: "UC-09", approvalSlotsRequired: 3 } }).summary;
  assert.match(three, /three different people/i);
});

// ---------------------------------------------------------------------------
// THE CONTROLS DO NOT RE-INTRODUCE THEMSELVES
// ---------------------------------------------------------------------------

function uc06View() {
  return {
    found: true,
    amendment: {
      id: "amd_1",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      amendmentType: "SALARY_INCREASE",
      requestedEffectiveDate: "2026-10-01",
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
}

function uc09View(approvalSlotsRequired = 2) {
  return {
    found: true,
    adjustment: {
      id: "adj_1",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      adjustment: { type: "CORRECTION", amount: 500000, currency: "USD" },
      approvalSlotsRequired,
      requesterApproval: null,
      approverApproval: null,
      paymentReleaserApproval: null,
      createdAt: "2026-08-19T08:00:00.000Z",
      decision: "off_cycle_adjustment_required",
      reason: "off_cycle_adjustment_required",
      flags: [],
    },
    useCaseTier: "high",
    executionModel: "multi_role_approval",
    caseRisk: "high",
    caseRiskEscalated: false,
    escalatingFlagCount: 0,
    actionable: true,
    actionableReason: null,
  };
}

test("a panel that draws its own controls does not print the hint over them", async () => {
  // BOTH HINTS SAID WHO MUST APPROVE, which by then is the tier rail's sentence,
  // the capacity card's role list, the approval meter's count and each
  // fieldset's legend. Five statements of one fact, the last of them directly
  // above the form.
  const { CXPanelFor } = loadPanels();

  for (const [uc, setting, view] of [
    ["UC-06", "uc06ApiBaseUrl", uc06View()],
    ["UC-09", "uc09ApiBaseUrl", uc09View()],
  ]) {
    const base = "http://" + uc.toLowerCase() + ".heading.test";
    const { root, buttons } = await renderSidebar({
      settings: { apiBaseUrl: "", [setting]: base },
      ticketId: 55,
      respond: servedBy(base, view),
    });
    assert.ok(buttons.length >= 2, `${uc} rendered no controls, so this proves nothing about them`);

    const hint = CXPanelFor(uc).approveHint(view);
    assert.ok(
      !textOf(root).includes(hint),
      `${uc} prints its approveHint above controls whose legend, meter and role card already say it`
    );
    // WHAT THE HINT WAS PROTECTING IS STILL THERE: how many signatures this
    // gate wants, and that one of them is already in.
    assert.match(textOf(root), /1 of 2 approvals recorded|0 of 2 approvals recorded/);
  }
});

test("the acting-as picker shows a form and says nothing the card above said", async () => {
  const base = "http://uc06.picker.heading.test";
  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc06ApiBaseUrl: base },
    ticketId: 56,
    respond: servedBy(base, uc06View()),
  });

  const picker = collect(root, (n) => String(n.className) === "r-role-picker")[0];
  assert.ok(picker, "the dual-control case rendered no picker");
  const text = textOf(picker);

  // The running note printed "<Role> decides <the same sentence the card above
  // prints under that role's name>". Selecting a role reprinted a line already
  // on screen.
  const { CXPanelFor } = loadPanels();
  for (const role of CXPanelFor("UC-06").approvalRoles({ case: { useCase: "UC-06" } }).roles) {
    assert.ok(
      !text.includes(role.decides),
      `the picker reprints "${role.decides}", which the capacity card states directly above it`
    );
  }

  // AND THE SENTENCE THAT MAKES A ROLE PICKER ACCEPTABLE AT ALL STAYS. It is a
  // statement about what this control does NOT do, which no heading can make.
  assert.match(text, /grants nothing/i);
});

// ---------------------------------------------------------------------------
// THE ONE SENTENCE THAT MUST NEVER BE CUT
// ---------------------------------------------------------------------------
// Commit 9914403 moved this from character ~4,735 of the UC-07 case record to
// character ~290 of the page, and from ABSENT to present on UC-08. A sweep that
// removes prose sitting under a heading would take it if nothing stopped it.

const FEASIBLE_PLAN = {
  destinationSupported: true,
  destinationEntityActive: true,
  annualGrossSalaryRemoteInteger: 6500000,
  currency: "EUR",
  months: 12,
  minimumVisaSalaryRemoteInteger: 5500000,
  transferFeeRemoteInteger: 150000,
  creationDate: "2026-05-01",
  proposedStartDate: "2026-07-01",
  destinationStartDate: "2026-07-01",
  sourceTerminationDate: "2026-06-30",
  sourceLastWorkingDay: "2026-06-30",
  minimumOnboardingLeadTimeBusinessDays: 20,
  immigrationSupportRequired: false,
  immigrationConfirmed: true,
  rightToWorkConfirmed: true,
  destinationStartDateConfirmed: true,
  sourceExitPlanValidated: true,
  employerPresenceInDestination: true,
  taxTreatyNexusConfirmed: true,
  ptoTransferAllowed: true,
  sourcePtoDays: 12,
  seniorityPreservable: true,
};

async function renderDossiers() {
  const mock = await startMockServer(0);
  const remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
  try {
    const taxStore = new TaxDossierStore();
    await handleTaxInquiry(
      {
        externalRef: "9308",
        employmentId: "emp_active_001",
        source: "seed",
        text:
          "I have been splitting my time between the Netherlands and Portugal this year and I think I " +
          "may be a dual resident of both countries for tax purposes. Can you help?",
        now: "2026-08-20",
      },
      {
        audit: new AuditLogger(),
        dossierStore: taxStore,
        classify: parseInquiryRuleBased,
        draftNarrative: fakeDraftNarrative,
        judge: fakeJudge,
      }
    );
    const uc08 = (
      await callHandler(createUc08Handler({ dossierStore: taxStore, audit: new AuditLogger() }), {
        method: "GET",
        path: "/api/dossiers/by-ticket/9308",
      })
    ).body;

    const relocationStore = new RelocationDossierStore();
    await handleRelocationReview(
      {
        text: "We're permanently relocating our engineer from Spain to the Netherlands.",
        employmentId: "emp_active_001",
        externalRef: "9307",
        source: "seed",
        plan: FEASIBLE_PLAN,
      },
      {
        audit: new AuditLogger(),
        dossierStore: relocationStore,
        classify: parseRelocationRuleBased,
        draftNarrative: fakeDraftRelocationNarrative,
        judge: fakeJudge,
      }
    );
    const uc07 = (
      await callHandler(createUc07Handler({ dossierStore: relocationStore }), {
        method: "GET",
        path: "/api/dossiers/by-ticket/9307",
      })
    ).body;

    /* The framing sentence is on the dossier the API returned; main.js's own
       loaders lift it to `view.framing` (loadUc07/loadUc08), which is the hop
       commit 9914403 found missing on UC-08. Reading it from the same place the
       loader does keeps this test measuring the page rather than a field name.
       A dossier that stopped carrying one would make every assertion below
       vacuous, so it is checked here rather than assumed. */
    const framingOf = (body) => body.dossierRow && body.dossierRow.dossier && body.dossierRow.dossier.framing;
    assert.ok(framingOf(uc07) && framingOf(uc08), "a dossier stopped publishing its framing statement");
    return { uc07: { body: uc07, framing: framingOf(uc07) }, uc08: { body: uc08, framing: framingOf(uc08) } };
  } finally {
    mock.close();
  }
}

test("the 🔴 framing statement survives the sweep, verbatim and above the analysis", async () => {
  const { uc07, uc08 } = await renderDossiers();

  for (const [uc, setting, seeded, ticketId] of [
    ["UC-07", "uc07ApiBaseUrl", uc07, 9307],
    ["UC-08", "uc08ApiBaseUrl", uc08, 9308],
  ]) {
    const view = { framing: seeded.framing };
    const base = "http://" + uc.toLowerCase() + ".framing.heading.test";
    const { root } = await renderSidebar({
      settings: { apiBaseUrl: "", [setting]: base },
      ticketId,
      respond: servedBy(base, seeded.body),
    });

    const visible = openText(root);
    // VERBATIM. Not paraphrased, not summarised, not shortened — the wording is
    // the use case's and this panel writes none of it.
    assert.ok(
      visible.includes(view.framing),
      `${uc} no longer prints its framing statement where a reader sees it without clicking`
    );
    assert.match(view.framing, /RESEARCH SUPPORT ONLY/, `${uc}'s framing lost the words that make it a warning`);
    // ONCE. Two copies train a reader to skim the first, which is the copy that
    // matters most.
    assert.equal(
      visible.split(view.framing).length - 1,
      1,
      `${uc} prints its framing statement more than once`
    );
    // ABOVE THE ANALYSIS. The framing qualifies everything under it, so nothing
    // it qualifies may come first.
    const nodes = collect(root, () => true);
    const framingAt = nodes.findIndex((n) => String(n.textContent || "").includes(view.framing));
    const analysisAt = nodes.findIndex((n) => /^(h2|h3)$/.test(String(n.tagName)));
    assert.ok(framingAt > -1 && analysisAt > -1);
    assert.ok(
      framingAt < analysisAt,
      `${uc} prints a section of the analysis above the sentence that says what the whole page is not`
    );
    // NEVER BEHIND A CLICK.
    const inDisclosure = collect(root, (n) => n.tagName === "details").some((d) =>
      textOf(d).includes(view.framing)
    );
    assert.ok(!inDisclosure, `${uc} put its framing statement inside a disclosure`);
  }
});
