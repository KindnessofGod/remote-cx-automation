// ---------------------------------------------------------------------------
// zafLongformDisclosure.test.js  —  reference prose collapses, a decision does not
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner, looking at an escalated UC-05 case in the live Zendesk
// sidebar:
//
//     "this mountainous text should be collapsed. not just displayed there."
//
// What they were reading was the shortfall-handling block: a framing sentence
// and seven entries, each a full paragraph of statutory prose with its article
// citation — 3.4k characters, open, one after another, under the decision. The
// citation disclosure one inch above it ("The rule this is based on — 1
// document") was already collapsed and read correctly. These were not.
//
// The line the panel now draws is not a word count. It is a question: does a
// specialist need this TO DECIDE, or once they have decided how to proceed?
// The verdict, the figures, the gap and what was not established are the first
// kind and stay open. A menu of handlings, each explaining what one statute
// says about one option, is the second.
//
// EVERY ASSERTION BELOW IS ABOUT WHAT A READER CAN SEE WITHOUT CLICKING, which
// is the only measure the complaint was about. `openText()` walks the tree and
// stops at every <details>, taking its <summary> and nothing else — the same
// thing a browser shows before anyone touches it.
//
// The cases are real: the actual UC-05 workflow against the mock Remote server,
// served by the actual API handler. A fixture written to agree with the panel
// is the failure mode this repo pays for most often (CLAUDE.md §4).
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { createUc05Handler } from "../src/uc05/server.js";
import { DossierStore } from "../src/uc08/dossierStore.js";
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

const UC05_BASE = "http://uc05.longform.test";
const UC07_BASE = "http://uc07.longform.test";
const UC08_BASE = "http://uc08.longform.test";

// João Silva — the PT employment in the mock fixtures, >2 years' service, so
// Código do Trabalho art. 400's 60-day bracket applies. Portugal is the ONE
// country whose notice statute this repository has actually read, which is why
// it is the only one that produces handling options at all
// (src/uc05/decisionSources.js's SHORTFALL_HANDLINGS).
const PT_EMPLOYMENT = "378eee6b-c6db-4484-ba32-7283bd0e2de9";

const fakeDraftNarrative = (args) => draftNarrative(args, { isConfigured: () => false });
const fakeDraftRelocationNarrative = (args) => draftRelocationNarrative(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

/* A relocation whose every deterministic gate passes, so the dossier this
   suite reads is the FRIENDLIEST one UC-07 ever produces: verdict PROCEED, no
   flags, a fully calculated cost estimate. That is the case where a missing
   "this is not a relocation decision" costs the most — a page of confident
   green facts is exactly what gets read as a green light. Copied from
   test/uc07Server.test.js's own seed rather than invented here. */
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

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

/** What a reader sees before clicking anything: a <details> contributes only its <summary>. */
function openText(node) {
  if (node.tagName === "details") {
    const summary = node.childNodes.filter((c) => c.tagName === "summary")[0];
    return summary ? textOf(summary) : "";
  }
  const own = node.textContent ? String(node.textContent) : "";
  return (own + " " + node.childNodes.map(openText).join(" ")).replace(/\s+/g, " ").trim();
}

function disclosures(root) {
  return collect(root, (n) => n.tagName === "details");
}

function summaryOf(details) {
  const summary = details.childNodes.filter((c) => c.tagName === "summary")[0];
  return summary ? textOf(summary) : "";
}

/**
 * The escalated Portuguese resignation the complaint was made about: a proposed
 * last working day 44 days inside the statutory minimum, so the decision is a
 * shortfall somebody has to choose a handling for.
 */
async function renderUc05Shortfall() {
  const audit = new AuditLogger();
  const resignationStore = new ResignationStore();
  const result = await handleResignationRequest(
    {
      employmentId: PT_EMPLOYMENT,
      session: { authenticatedEmploymentId: PT_EMPLOYMENT },
      proposedEndDate: "2026-09-05",
      reason: "family reasons",
      now: "2026-08-20",
      externalRef: "9205",
    },
    { remote, audit, resignationStore }
  );
  // If this stops being a shortfall the case under test has changed, and every
  // assertion below would pass vacuously against a page with no handlings.
  assert.equal(result.decision, "escalate", "the PT seed no longer escalates");
  assert.equal(result.reason, "statutory_discrepancy", "the PT seed no longer decides on the shortfall gate");

  const handler = createUc05Handler({ resignationStore, audit, remote });
  const answer = await callHandler(handler, { method: "GET", path: "/api/resignations/by-ticket/9205" });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.found, true);
  const view = answer.body;

  const handling = view.basis && view.basis.discrepancy && view.basis.discrepancy.handling;
  assert.ok(handling, "the server stopped publishing shortfall handlings — the panel has nothing to collapse");

  return {
    view,
    handling,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc05ApiBaseUrl: UC05_BASE },
      ticketId: 9205,
      respond: servedBy(UC05_BASE, view),
    })),
  };
}

/**
 * A 🔴 UC-08 dossier for a jurisdiction pair the corpus actually holds, so the
 * `basis` it publishes carries real citations, real caveats and a three-limb
 * treaty test — the densest reference payload any panel receives, and therefore
 * the one most likely to be collapsed by mistake.
 */
async function renderUc08Dossier() {
  const audit = new AuditLogger();
  const dossierStore = new DossierStore();
  await handleTaxInquiry(
    {
      externalRef: "9208",
      employmentId: "emp_active_001",
      source: "seed",
      text:
        "I have been splitting my time between the Netherlands and Portugal this year and I think I " +
        "may be a dual resident of both countries for tax purposes. Can you help?",
      now: "2026-08-20",
    },
    // Every LLM seam injected: this suite is hermetic, and a genuine but
    // unreachable OPENAI_API_KEY in .env is enough to make an uninjected call
    // real, slow and failing (CLAUDE.md §6).
    { audit, dossierStore, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  const handler = createUc08Handler({ dossierStore, audit });
  const answer = await callHandler(handler, { method: "GET", path: "/api/dossiers/by-ticket/9208" });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.found, true);
  const view = answer.body;
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc08ApiBaseUrl: UC08_BASE },
      ticketId: 9208,
      respond: servedBy(UC08_BASE, view),
    })),
  };
}

/**
 * A 🔴 UC-07 relocation dossier, driven through the real workflow and the real
 * read-only handler. The other no-execution-path use case: same builder, same
 * mandatory framing sentence, a different specialist and a different set of
 * findings.
 */
async function renderUc07Dossier() {
  const dossierStore = new RelocationDossierStore();
  const result = await handleRelocationReview(
    {
      text: "We're permanently relocating our engineer from Spain to the Netherlands.",
      employmentId: "emp_active_001",
      externalRef: "9207",
      source: "seed",
      plan: FEASIBLE_PLAN,
    },
    {
      audit: new AuditLogger(),
      dossierStore,
      classify: parseRelocationRuleBased,
      draftNarrative: fakeDraftRelocationNarrative,
      judge: fakeJudge,
    }
  );
  // If this stops being the friendly case, the assertions below are still true
  // but they stop testing the situation that motivates them.
  assert.equal(result.decision, "escalate", "UC-07 stopped escalating — every request must");
  assert.equal(result.dossier.verdict, "PROCEED", "the UC-07 seed no longer produces the all-clear dossier");

  const handler = createUc07Handler({ dossierStore });
  const answer = await callHandler(handler, { method: "GET", path: "/api/dossiers/by-ticket/9207" });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.found, true);
  const view = answer.body;
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc07ApiBaseUrl: UC07_BASE },
      ticketId: 9207,
      respond: servedBy(UC07_BASE, view),
    })),
  };
}

// ---------------------------------------------------------------------------
// THE COMPLAINT
// ---------------------------------------------------------------------------

test("the shortfall handlings are behind a disclosure, not printed at the reader", async () => {
  const { root, handling } = await renderUc05Shortfall();

  // The entries the server published, other than the framing sentence.
  const bodies = [
    ...handling.options.map((o) => o.whatTheSourceSays),
    handling.exemption.whatTheSourceSays,
    ...handling.boundaries,
  ];
  assert.ok(bodies.length >= 3, "fewer entries than the shape this rule is for");

  const open = openText(root);
  const all = textOf(root);
  bodies.forEach((body) => {
    const opening = body.slice(0, 60);
    assert.ok(all.includes(opening), "an entry vanished from the page entirely: " + opening);
    assert.ok(!open.includes(opening), "an entry is still open on the page: " + opening);
  });
});

test("the standing statement that nothing is ranked stays OPEN — it is the honesty guarantee", async () => {
  // Losing this sentence into a collapsed body would be a real regression, not
  // a tidier page: a reader who opens the list and finds it ordered has been
  // given no reason not to read the order as a ranking. The panel is allowed to
  // hide what the statute says about each handling. It is not allowed to hide
  // that it is recommending none of them.
  const { root, handling } = await renderUc05Shortfall();
  const open = openText(root);
  assert.ok(
    open.includes("no order of preference"),
    "the 'listed in no order of preference' guarantee is no longer visible without clicking"
  );
  assert.ok(open.includes(handling.framing), "the framing sentence is not rendered open, verbatim");
});

test("the summary says what is inside and how many, never a bare 'show more'", async () => {
  const { root, handling } = await renderUc05Shortfall();
  const entries = handling.options.length + 1 /* exemption */ + handling.boundaries.length;

  const longform = disclosures(root).filter((d) => String(d.className) === "r-longform");
  assert.equal(longform.length, 1, "expected exactly one long-form disclosure on this case");

  const summary = summaryOf(longform[0]);
  // The count is the "how much of it there is" half. A reader deciding whether
  // to open it is deciding whether they have seven things to weigh or one.
  assert.ok(summary.includes(String(entries) + " entries"), "the summary does not count its entries: " + summary);
  // And the "what is inside" half — the group's own name, not a generic verb.
  assert.ok(summary.includes("How this can be handled"), "the summary does not name what is inside: " + summary);
  assert.ok(!/show more|read more|details/i.test(summary), "the summary is a bare affordance: " + summary);
});

test("the disclosure is native <details>/<summary>, so it is keyboard-reachable", async () => {
  // Not a style preference. A div with a click handler is unreachable by
  // keyboard and silent to a screen reader; <summary> is focusable, toggles on
  // Enter and Space, and announces its own state, with nothing to maintain.
  const { root } = await renderUc05Shortfall();
  const longform = disclosures(root).filter((d) => String(d.className) === "r-longform")[0];
  assert.ok(longform, "no long-form disclosure was rendered");
  assert.equal(longform.tagName, "details");
  assert.equal(longform.childNodes[0].tagName, "summary", "the summary must be the first child or the element cannot open");
});

// ---------------------------------------------------------------------------
// WHAT MUST NOT COLLAPSE
// ---------------------------------------------------------------------------

test("the decision, the figures and what was not established all stay open", async () => {
  // The complaint was about volume, and the wrong fix for volume is to collapse
  // the page. These four are what the specialist opened the panel to read.
  const { root, view } = await renderUc05Shortfall();
  const open = openText(root);

  assert.ok(open.includes(view.decidedBy.means), "the deciding sentence is no longer open");
  assert.ok(open.includes(view.basis.notice.sentence), "the statutory notice figure is no longer open");
  assert.ok(open.includes(view.basis.discrepancy.sentence), "the shortfall itself is no longer open");
  (view.basis.unknowns || []).forEach((unknown) => {
    assert.ok(open.includes(unknown.what), "an unknown is no longer open: " + unknown.what);
  });
});

test("a short field group is left alone — the rule is about reference prose, not about fields", async () => {
  // UC-06's `change` block publishes ONE field of about seventy characters:
  // the amendment itself, in a line. Collapsing that would hide the subject of
  // the decision behind a click to save nothing, so the threshold has to be
  // crossed by the prose and not by the mere existence of `fields`.
  //
  // Driven directly rather than through a use case, because the point is the
  // shape and not any one server's data.
  const view = {
    found: true,
    useCase: "UC-05",
    case: { id: "short-1", useCase: "UC-05", reason: "statutory_discrepancy", flags: [], status: "escalated" },
    actionable: false,
    actionableReason: "no path",
    basis: {
      discrepancy: {
        state: "stopped",
        sentence: "The proposed last working day is short of the statutory minimum.",
        fields: [
          { label: "How this can be handled", sentence: "A shortfall has to be handled by a person." },
          { label: "Serve it", sentence: "The employee works the notice." },
          { label: "Pay it", sentence: "The missing period is paid for." },
        ],
      },
    },
  };
  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc05ApiBaseUrl: UC05_BASE },
    ticketId: "short-1",
    respond: servedBy(UC05_BASE, view),
  });
  const open = openText(root);
  view.basis.discrepancy.fields.forEach((field) => {
    assert.ok(open.includes(field.sentence), "a short field was collapsed: " + field.sentence);
  });
  assert.equal(
    disclosures(root).filter((d) => String(d.className) === "r-longform").length,
    0,
    "a three-line field group was put behind a disclosure"
  );
});

test("a 🔴 dossier keeps its analysis open — its rows ARE the page", async () => {
  /* A 🔴 use case has no execution path and no controls: the dossier IS the
     only thing its escalation bought, and collapsing it would throw away the
     entire output of the one kind of use case that produces nothing but output.
     Commit 0f71708 moved this case by 4% where it moved the others by 40, and
     that was the rule holding, not the rule failing.

     THE WAY IT NEARLY BROKE. These views began publishing a `basis` of their
     own — a hand-curated citation map (commit 553c4a9) — and this file began
     passing it through. "A findings section leads the page, so the rows are
     reference material" then read TRUE for a payload that contains no finding
     at all, and swept the verdict, every flag with its message, the cost
     estimate and the narrative into "The case record", underneath the
     documents they were written from. Measured on the seeded dossier: 1,884 of
     1,970 characters visible before, 1,139 of 2,430 after. */
  const { root, view } = await renderUc08Dossier();
  const open = openText(root);

  // The dossier's own words, not a proxy for them.
  const dossier = view.dossierRow.dossier;
  assert.ok(dossier.narrative, "the seed produced no narrative to look for");
  assert.ok(open.includes(dossier.narrative), "the dossier narrative is no longer visible without a click");
  // The mandatory `framing` disclaimer used to be excluded from this
  // assertion, with a note saying the panel had never rendered it. It does
  // now, and it has its own section at the foot of this file.
  assert.ok(open.includes(dossier.framing), "the mandatory framing statement is not visible without a click");

  assert.equal(
    disclosures(root).filter((d) => String(d.className) === "r-longform").length,
    0,
    "a 🔴 dossier's analysis was put behind a long-form disclosure"
  );
});

test("a three-limb cumulative test is never hidden behind its own first limb", async () => {
  /* WHY THE THRESHOLDS ARE WHERE THEY ARE, stated as the case that sets them.
     UC-08's `treaty` block publishes three fields: limbs (a), (b) and (c) of
     ONE cumulative condition in the convention's employment-income article.
     There is no framing sentence among them — the block's own sentence does
     that job — so a rule that collapsed short groups and treated the first
     field as their introduction would have hidden two of three conditions
     behind a summary named after the first, which invites reading limb (a) as
     the whole test. That is a worse defect than the one this file exists to
     fix, and it is why a group has to be a MENU (five or more entries past
     twelve hundred characters) before any of it is folded away. */
  const { root, view } = await renderUc08Dossier();
  const treaty = view.basis && view.basis.treaty;
  assert.ok(treaty && (treaty.fields || []).length >= 3, "the treaty block no longer publishes its limbs");

  const open = openText(root);
  treaty.fields.forEach((field) => {
    assert.ok(
      open.includes(field.sentence.slice(0, 60)),
      "a limb of a cumulative test was collapsed: " + field.label
    );
  });
});

test("a panel with no basis cannot be collapsed by this rule AT ALL — structurally, not by threshold", async () => {
  /* WHY THIS IS SEPARATE FROM THE TEST ABOVE, AND WHY IT IS THE STRONGER ONE.
     The 🔴 exception is usually stated as "UC-08 publishes no `basis`, so its
     rows are the page". That is a fact about today's server, and today's server
     changes: UC-08's dossier view is growing a `basis` in this very working
     tree. A test asserting `view.basis === undefined` would have been pinning
     somebody else's schema, and it would have failed for a reason that has
     nothing to do with whether any prose got hidden.

     The exception this change owes is structural instead. Long-form collapsing
     happens in ONE place, renderNarrativeBlock, which is only ever reached
     through partitionBasis — so a panel that publishes no basis has no field
     group to collapse and cannot lose a line to this rule however long its
     rows run. That is a property of where the code sits, not of a threshold,
     and it is what this test states. */
  const view = {
    found: true,
    useCase: "UC-08",
    case: {
      id: "dossier-1",
      useCase: "UC-08",
      reason: "cross_border_tax_inquiry",
      flags: ["tax_residency_risk"],
      status: "escalated",
      dossier: { verdict: "ESCALATE", narrative: "x".repeat(3000), citations: [] },
    },
    actionable: false,
    actionableReason: "UC-08 has no execution path.",
  };
  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc08ApiBaseUrl: UC08_BASE },
    ticketId: "dossier-1",
    respond: servedBy(UC08_BASE, view),
  });
  assert.equal(
    disclosures(root).filter((d) => String(d.className) === "r-longform").length,
    0,
    "3,000 characters of dossier narrative on a basis-less panel were collapsed — the rule reached somewhere it must not"
  );
});

// ---------------------------------------------------------------------------
// THE MANDATORY FRAMING STATEMENT — the one sentence that cannot be a click away
// ---------------------------------------------------------------------------
// WHY THIS BELONGS IN THIS FILE AND NOT IN A NEW ONE. Every test above asks the
// same question — what can a reader see WITHOUT clicking — and this is that
// question asked about the field where the answer matters most. UC-07 and
// UC-08 have no execution path; their entire safety argument is that they
// CONCLUDE NOTHING, and `dossier.framing` is the sentence that makes that true
// for the reader. A dossier of statutory quotations, presence-day counts and
// treaty limbs with no statement of what it is not reads as an answer.
//
// It reached this screen two different wrong ways before this section existed:
// on UC-08 not at all (no loader passed the field through), and on UC-07 as
// row 34 of the case record labelled "Standing", printed UNDER the drafted
// narrative it exists to qualify. Absent and buried are different failures and
// neither is acceptable, so the assertions below pin POSITION as well as
// presence.
// ---------------------------------------------------------------------------

/** Every ancestor chain, checked for a <details> — the structural form of "not collapsible". */
function isInsideDisclosure(root, text) {
  const disclosed = disclosures(root);
  return disclosed.some((d) => {
    const body = d.childNodes.filter((c) => c.tagName !== "summary").map(textOf).join(" ");
    return body.replace(/\s+/g, " ").includes(text);
  });
}

for (const [label, renderCase] of [
  ["UC-08 tax dossier", renderUc08Dossier],
  ["UC-07 relocation dossier", renderUc07Dossier],
]) {
  test(`${label}: the mandatory framing statement is on the page, verbatim`, async () => {
    const { root, view } = await renderCase();
    const framing = view.dossierRow.dossier.framing;
    assert.ok(framing, "the server stopped publishing a framing statement — the panel has nothing to render");
    // Verbatim, not paraphrased: the wording is the use case's and the panel
    // composes none of it. `textOf` normalises whitespace, so this is an
    // equality check on the sentence itself.
    assert.ok(
      textOf(root).replace(/\s+/g, " ").includes(framing),
      "the framing statement is nowhere on the rendered page"
    );
  });

  test(`${label}: the framing statement is visible without clicking anything`, async () => {
    const { root, view } = await renderCase();
    const framing = view.dossierRow.dossier.framing;
    assert.ok(
      openText(root).includes(framing),
      "the framing statement is only reachable by opening a disclosure — a warning behind a click " +
        "is a warning the reader chose not to see, and this one is not theirs to choose"
    );
  });

  test(`${label}: the framing statement is never inside a <details>, structurally`, async () => {
    // Stronger than the visibility check above and separate from it on purpose:
    // openText() answers "is it visible today", this answers "could a future
    // pass fold it away". A <details> that happened to be rendered open would
    // pass the first and fail this one, which is the correct direction.
    const { root, view } = await renderCase();
    assert.equal(
      isInsideDisclosure(root, view.dossierRow.dossier.framing),
      false,
      "the framing statement was put inside a disclosure"
    );
  });

  test(`${label}: the framing statement is read BEFORE the analysis, not after it`, async () => {
    /* POSITION IS THE HALF THAT WAS BROKEN ON UC-07. The sentence was on the
       page and it was open — as row 34, below the narrative, the cost estimate
       and every flag. A reader who reaches a confident 12-month cost figure
       first has already begun reading the page as an answer; the disclaimer
       then corrects a reading they have finished forming. So it has to precede
       the dossier's own output, and that is what is asserted here. */
    const { root, view } = await renderCase();
    const dossier = view.dossierRow.dossier;
    const open = openText(root);
    const framingAt = open.indexOf(dossier.framing);
    assert.ok(framingAt >= 0, "the framing statement is not open on the page at all");

    assert.ok(dossier.narrative, "the seed produced no narrative to position against");
    const narrativeAt = open.indexOf(dossier.narrative);
    assert.ok(narrativeAt >= 0, "the narrative is no longer open — this test is measuring nothing");
    assert.ok(
      framingAt < narrativeAt,
      "the framing statement is printed after the dossier narrative it qualifies"
    );
  });

  test(`${label}: the framing statement is printed once, not twice`, async () => {
    /* The panel and the shell both had a claim on this sentence, and for one
       revision both printed it — the shell under the header and UC-07's record
       rows as "Standing". Two copies one screen apart is the repetition this
       page was taken apart for, and here it is worse than usual: a sentence a
       reader has already skimmed once is a sentence they skim the second
       time. */
    const { root, view } = await renderCase();
    const framing = view.dossierRow.dossier.framing;
    const all = textOf(root).replace(/\s+/g, " ");
    const occurrences = all.split(framing).length - 1;
    assert.equal(occurrences, 1, `the framing statement appears ${occurrences} times on one page`);
  });
}

test("the 🔴 exception is untouched — the dossier rows are still open and there are still no controls", async () => {
  /* THE THING THIS CHANGE MUST NOT HAVE DONE. Adding a block above the analysis
     is one edit away from pushing the analysis behind a disclosure to make room
     for it, and on a use case with no execution path the analysis is the only
     thing the escalation produces. Both 🔴 panels declare
     `recordIsTheAnalysis: true` and their rows stay open; `view.actionable` is
     false and no button may exist. Asserted here rather than trusted because
     this file is the one that added the block. */
  for (const renderCase of [renderUc08Dossier, renderUc07Dossier]) {
    const { root, buttons, view } = await renderCase();
    assert.equal(view.actionable, false, "a 🔴 dossier reported itself actionable");
    assert.equal(buttons.length, 0, "a 🔴 dossier rendered a control");
    assert.ok(
      openText(root).includes(view.dossierRow.dossier.narrative),
      "the dossier's own analysis stopped being visible without a click"
    );
  }
});

test("the panel composes no disclaimer of its own — every word of it is the server's", async () => {
  /* THE DEFECT THIS WOULD BE. A rendering layer that wrote its own "this is not
     tax advice" would be making a legal claim on behalf of a use case whose
     spec it cannot read, and it would go on making it after the use case
     changed its wording — silently, because nothing would fail. Inventing the
     sentence in the browser is a worse defect than the missing one it fixes.
     So: neither browser asset may contain the sentence, and a view carrying no
     framing must render no framing block at all. */
  // Comments stripped, the same way test/zafApp.test.js checks for re-derived
  // policy: the reasoning above a renderer is allowed to QUOTE the sentence it
  // is about — that is what makes the comment readable — and the executable
  // half must not contain a syllable of it.
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const file of ["main.js", "panels.js"]) {
    const code = stripComments(readFileSync(new URL(`../zaf-app/assets/${file}`, import.meta.url), "utf8"));
    assert.doesNotMatch(
      code,
      /RESEARCH SUPPORT ONLY/,
      `${file} carries a hard-coded disclaimer — the wording belongs to the use case`
    );
  }

  const view = {
    found: true,
    useCase: "UC-08",
    case: {
      id: "no-framing-1",
      useCase: "UC-08",
      reason: "cross_border_tax_inquiry",
      flags: [],
      status: "escalated",
      dossier: { verdict: "ESCALATE", narrative: "A dossier whose server sent no framing.", citations: [] },
    },
    actionable: false,
    actionableReason: "UC-08 has no execution path.",
  };
  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc08ApiBaseUrl: UC08_BASE },
    ticketId: "no-framing-1",
    respond: servedBy(UC08_BASE, view),
  });
  assert.equal(
    collect(root, (n) => String(n.className) === "r-framing").length,
    0,
    "a framing block was rendered for a view that carries no framing statement"
  );
});

// ---------------------------------------------------------------------------
// A 🔴 DOSSIER SAYS NOTHING A BROWSER MADE UP, AND SAYS ITS FLAGS ONCE
// ---------------------------------------------------------------------------
// The project owner's rule for every row on every panel: "would this row change
// what the specialist does, or help them defend the decision afterwards?" Two
// things on these two pages failed it in the same place — the first two inches,
// directly under the mandatory research disclaimer.
//
// (1) `global_mobility_review` and `cross_border_tax_inquiry` are written in
//     zaf-app/assets/main.js's own loaders, because these views publish no
//     decision of their own. Every other panel's slug is kept beside the prose
//     precisely because it is the exact string in `audit_log`, in the metrics
//     exception ranking and in the n8n ports. Neither of these is in any of
//     them: a Tier-3 lawyer was reading a word a browser invented, traceable to
//     nothing.
//
// (2) UC-07's flag codes printed twice — once as `HIGH · UC07_...` chips with
//     no message, once as rows carrying the severity, the code AND the sentence
//     saying what to do. Nine codes, twice, and the copy that came first was
//     the unusable one.
// ---------------------------------------------------------------------------

test("neither dossier prints a reason slug the browser wrote for it", async () => {
  for (const [label, renderCase, slug] of [
    ["UC-08", renderUc08Dossier, "cross_border_tax_inquiry"],
    ["UC-07", renderUc07Dossier, "global_mobility_review"],
  ]) {
    const { root } = await renderCase();
    assert.ok(
      !textOf(root).includes(slug),
      `${label} still prints "${slug}" — a string no server emits and no audit row contains`
    );
  }
});

test("UC-08 still states that no escalation flags were raised — the negative is its only statement", async () => {
  // UC-08's rows carry no flag line at all, so the shell's block is the only
  // place this is said, negative case included. It must NOT be swept up by the
  // rule that stands that block down for UC-07.
  const { root, view } = await renderUc08Dossier();
  const flags = view.dossierRow.dossier.flags || [];
  assert.equal(flags.length, 0, "the seed started raising flags — this test is now asserting the wrong branch");
  assert.ok(textOf(root).includes("No escalation flags were raised"), "UC-08 stopped saying that nothing was raised");
});

/** A UC-07 request with no plan attached, which raises every sequencing gate.
 *  renderUc07Dossier() is deliberately the FRIENDLY case (verdict PROCEED, zero
 *  flags) and cannot show a flag being printed twice. */
async function renderUc07Flagged() {
  const dossierStore = new RelocationDossierStore();
  await handleRelocationReview(
    {
      text: "Our engineer in Spain wants to relocate permanently to the Netherlands.",
      employmentId: "emp_active_001",
      externalRef: "9217",
      source: "seed",
    },
    {
      audit: new AuditLogger(),
      dossierStore,
      classify: parseRelocationRuleBased,
      draftNarrative: fakeDraftRelocationNarrative,
      judge: fakeJudge,
    }
  );
  const handler = createUc07Handler({ dossierStore });
  const answer = await callHandler(handler, { method: "GET", path: "/api/dossiers/by-ticket/9217" });
  assert.equal(answer.body.found, true);
  const view = answer.body;
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc07ApiBaseUrl: UC07_BASE },
      ticketId: "9217",
      respond: servedBy(UC07_BASE, view),
    })),
  };
}

test("UC-07 states each flag exactly once, with the message that says what to do about it", async () => {
  const { root, view } = await renderUc07Flagged();
  const flags = view.dossierRow.dossier.flags || [];
  assert.ok(flags.length >= 2, "the seed no longer raises the flags under test");
  const page = textOf(root);
  for (const flag of flags) {
    const occurrences = page.split(flag.code).length - 1;
    // The drafted narrative lists every code as well, and that is the server's
    // prose rather than a second rendering decision — so the bound is on how
    // many times THIS FILE draws it: the row, and the narrative's own copy.
    assert.ok(occurrences <= 2, `${flag.code} appears ${occurrences} times — the bare chip list is back`);
    assert.ok(page.includes(flag.message), `${flag.code} is on the page without the sentence saying what to do about it`);
  }
  assert.ok(
    !page.includes(flags[0].severity + " · " + flags[0].code),
    "the severity-and-code-only chip is back above the research disclaimer's own analysis"
  );
});
