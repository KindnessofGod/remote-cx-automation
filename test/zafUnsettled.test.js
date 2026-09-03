// ---------------------------------------------------------------------------
// zafUnsettled.test.js  —  what a dossier could NOT settle, on the screen
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// Five use cases compute an `uncited` list — the findings this repository
// deliberately records as resting on no citation, each with the reason — and
// two of them compute `openQuestions`, the things a 🔴 dossier could not
// answer. Every one of them was computed on every read, serialised, sent over
// the wire, and rendered by nothing. src/uc04/decisionFacts.js said so in a
// comment: "`uncited` is the same statement in the other direction, AND IT IS
// RENDERED TOO: a citation block that only ever appears where a citation
// exists teaches a reader that everything unmarked is fine." That sentence
// described a renderer that did not exist.
//
// It is the §3.98 defect class: a data layer moved, the view layer did not,
// and nothing failed because the output is prose no test reads. So the
// assertions below all run the REAL sidebar against the REAL API handlers over
// the harness's fake DOM, and read the words that came out. A test that built
// a view object by hand would pass against a loader that drops the field — and
// that is not hypothetical: `citationCoverage` shipped exactly that way hours
// before this file was written, green in test/zafApp.test.js (which calls
// panels.rows() directly with a hand-built view) and absent from every real
// sidebar because loadUc08 never set it. One of the tests below is that bug.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler } from "../src/uc04/server.js";
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

const UC04_BASE = "http://uc04.unsettled.test";
const UC07_BASE = "http://uc07.unsettled.test";
const UC08_BASE = "http://uc08.unsettled.test";

const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeDraftNarrative = (args) => draftNarrative(args, { isConfigured: () => false });
const fakeDraftRelocationNarrative = (args) => draftRelocationNarrative(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

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

/** A 🔴 UC-08 dual-residency dossier on NL/PT — a pair the corpus holds. */
async function renderUc08() {
  const audit = new AuditLogger();
  const dossierStore = new DossierStore();
  await handleTaxInquiry(
    {
      externalRef: "9308",
      employmentId: "emp_active_001",
      source: "seed",
      text:
        "I have been splitting my time between the Netherlands and Portugal this year and I think " +
        "I may be a dual resident of both countries for tax purposes. Can you help?",
      now: "2026-08-20",
    },
    { audit, dossierStore, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  const handler = createUc08Handler({ dossierStore, audit });
  const answer = await callHandler(handler, { method: "GET", path: "/api/dossiers/by-ticket/9308" });
  assert.equal(answer.body.found, true);
  const view = answer.body;
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc08ApiBaseUrl: UC08_BASE },
      ticketId: 9308,
      respond: servedBy(UC08_BASE, view),
    })),
  };
}

/** A 🔴 UC-07 permanent relocation whose every deterministic gate passes. */
async function renderUc07() {
  const dossierStore = new RelocationDossierStore();
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
      dossierStore,
      classify: parseRelocationRuleBased,
      draftNarrative: fakeDraftRelocationNarrative,
      judge: fakeJudge,
    }
  );
  const handler = createUc07Handler({ dossierStore });
  const answer = await callHandler(handler, { method: "GET", path: "/api/dossiers/by-ticket/9307" });
  assert.equal(answer.body.found, true);
  const view = answer.body;
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc07ApiBaseUrl: UC07_BASE },
      ticketId: 9307,
      respond: servedBy(UC07_BASE, view),
    })),
  };
}

/**
 * A 🟡 UC-04 workation awaiting a specialist. DE → ES on a Schengen short stay:
 * `immigration_document` comes back `unavailable`, which is the one dimension
 * in the repository that records an absence of any source for its finding.
 */
async function renderUc04() {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();
  await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      travelHistory: [
        { country: "ES", startDate: "2026-07-01", endDate: "2026-08-14" },
        { country: "ES", startDate: "2025-10-01", endDate: "2026-02-28" },
      ],
      now: "2026-08-15",
      externalRef: "9304",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  const handler = createUc04Handler({ authorizationStore, audit, remote });
  const answer = await callHandler(handler, { method: "GET", path: "/api/authorizations/by-ticket/9304" });
  assert.equal(answer.body.found, true);
  const view = answer.body;
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
      ticketId: 9304,
      respond: servedBy(UC04_BASE, view),
    })),
  };
}

const headings = (root) =>
  collect(root, (n) => n.tagName === "h2" || n.tagName === "summary").map((n) => textOf(n));

// ---------------------------------------------------------------------------
// openQuestions
// ---------------------------------------------------------------------------

test("every open question the server raised reaches the page, word for word", async () => {
  const { view, root } = await renderUc08();

  // PRECONDITION, not decoration: if the view stops publishing questions the
  // assertions below would pass against a page that renders nothing.
  assert.ok(view.openQuestions.length >= 2, "UC-08 stopped publishing open questions");

  const page = textOf(root);
  assert.match(page, /What still has to be established/);
  view.openQuestions.forEach((q) => {
    // Whole sentences, not keywords. The panel composes no part of these — a
    // paraphrase here would be this file writing the server's prose for it.
    assert.ok(
      page.indexOf(q.question.replace(/\s+/g, " ")) !== -1,
      "an open question the server raised is not on the page: " + q.code
    );
  });
});

test("the most consequential band is open and the rest is counted, not hidden", async () => {
  const { view, root } = await renderUc07();
  const priorities = view.openQuestions.map((q) => q.priority);
  const top = Math.min(...priorities);
  const inTopBand = priorities.filter((p) => p === top).length;
  // This case is only interesting if the server actually raises more than one
  // band; UC-07's friendly relocation raises three.
  assert.ok(priorities.some((p) => p !== top), "UC-07 raised a single priority band — the split is untested here");

  const section = collect(root, (n) => String(n.className).indexOf("r-questions") !== -1)[0];
  assert.ok(section, "no open-questions section rendered");

  const collapsed = collect(section, (n) => n.tagName === "details");
  assert.equal(collapsed.length, 1, "the lower bands must be behind exactly one disclosure");

  const insideCollapsed = collect(collapsed[0], (n) => n.tagName === "li").length;
  const allItems = collect(section, (n) => n.tagName === "li").length;
  assert.equal(allItems - insideCollapsed, inTopBand, "the open band is not the server's own top priority band");
  assert.equal(allItems, view.openQuestions.length, "a question was dropped rather than collapsed");

  // COUNTED, so a reader knows what closing it costs them.
  assert.match(textOf(collapsed[0]), new RegExp(insideCollapsed + " further question"));
});

test("open questions sit above the record they qualify", async () => {
  const { root } = await renderUc08();
  const order = headings(root);
  const questions = order.findIndex((h) => /What still has to be established/.test(h));
  const record = order.findIndex((h) => h === "Case");
  assert.ok(questions !== -1 && record !== -1, "one of the two sections did not render");
  assert.ok(
    questions < record,
    "a priority-1 question qualifies every figure in the record — it cannot be printed after it"
  );
});

// ---------------------------------------------------------------------------
// uncited
// ---------------------------------------------------------------------------

test("UC-08's flat uncited list reaches the page, each absence with its reason", async () => {
  const { view, root } = await renderUc08();
  assert.ok(view.uncited.length >= 3, "UC-08 stopped stating its unconditional absences");

  const nodes = collect(root, (n) => String(n.className) === "r-uncited");
  assert.equal(nodes.length, view.uncited.length, "an absence the server stated is missing from the page");

  view.uncited.forEach((absence) => {
    const rendered = nodes.map(textOf).join(" || ");
    assert.ok(rendered.indexOf(absence.label) !== -1, "an absence lost its label: " + absence.finding);
    // The REASON is the whole content. A "no source" line with no reason is
    // worse than no line — it reads as a rendering fault.
    assert.ok(rendered.indexOf(absence.why.slice(0, 60)) !== -1, "an absence lost its reason: " + absence.finding);
  });
});

test("an absence is drawn as an absence, never as a caveat", async () => {
  // A caveat is a contradiction the corpus records AGAINST a source it holds;
  // this is the absence of any source at all. They must not share a class,
  // because .r-caveat carries the warning colour and would say the corpus
  // found something wrong here when what it found was nothing.
  const { root } = await renderUc08();
  const absences = collect(root, (n) => String(n.className) === "r-uncited");
  assert.ok(absences.length > 0);
  absences.forEach((n) => assert.ok(String(n.className).indexOf("caveat") === -1));
});

test("UC-04 states an absence beside the finding it belongs to, not in a section of its own", async () => {
  const { view, root } = await renderUc04();

  const dimension = (view.basis.dimensions || []).find((d) => (d.uncited || []).length);
  assert.ok(dimension, "no UC-04 dimension records an uncited finding — this case no longer tests anything");

  // Inside the finding's own citation disclosure. A specialist who has opened
  // "the rule this is based on" is asking exactly the question an absence
  // answers; a section further down would be a bibliography of silences.
  const disclosures = collect(root, (n) => n.tagName === "details" && String(n.className).indexOf("r-sources") !== -1);
  const withAbsence = disclosures.filter((d) => collect(d, (n) => String(n.className) === "r-uncited").length);
  assert.equal(withAbsence.length, 1, "the absence is not inside the finding's own disclosure");
  assert.match(textOf(withAbsence[0]), /rests on no source/);

  // And EXACTLY once. UC-04 publishes the same absences twice — per dimension,
  // and deduped under `basis.sources.uncited` for an API reader — so a
  // renderer reading both would print every one of them again.
  assert.ok(view.basis.sources.uncited.length > 0, "UC-04 stopped publishing the deduped copy");
  const all = collect(root, (n) => String(n.className) === "r-uncited");
  assert.equal(all.length, dimension.uncited.length, "the deduped API copy is being rendered a second time");
});

test("a disclosure holding only absences says so, and does not claim a document count", async () => {
  const { root } = await renderUc04();
  const summaries = collect(root, (n) => n.tagName === "summary").map(textOf);
  assert.ok(
    summaries.some((s) => /rests on no source/.test(s)),
    "a group whose only content is an absence must say that in its summary"
  );
  summaries.forEach((s) => assert.doesNotMatch(s, /— 0 documents/));
});

// ---------------------------------------------------------------------------
// The plumbing bug this file was written after
// ---------------------------------------------------------------------------

test("citationCoverage reaches the real sidebar, not only a hand-built view", async () => {
  // panels.js has read `view.citationCoverage.scope` since the day it shipped
  // and leads UC-08's rows with it; loadUc08 never set the field. The existing
  // test called panels.rows() with a view built by hand, so it was green
  // throughout. This one goes through the loader.
  const { view, root } = await renderUc08();
  assert.ok(view.citationCoverage && view.citationCoverage.scope, "the API stopped publishing citationCoverage");
  assert.ok(
    textOf(root).indexOf(view.citationCoverage.scope.slice(0, 80)) !== -1,
    "the sentence saying what the retrieved material IS did not reach the page"
  );
});

// ---------------------------------------------------------------------------
// confirmations — the other direction, and the framings that bound them
// ---------------------------------------------------------------------------
// WHY THESE ARE PRINTED AT ALL, given they change no decision: both libraries
// say it themselves. src/uc04/decisionSources.js — "a list of faults teaches
// distrust of everything equally"; src/uc08/decisionSources.js — "a reader needs
// to know that this pair was checked rather than assumed to fail together".
//
// The UC-04 case below is the one that makes the argument concrete. Its Schengen
// measurement carries FOUR entries: two citations, two caveats and two
// confirmations. Before this, a specialist saw the two caveats and neither
// confirmation — so the page said the 90/180 rule here is disputed, and never
// said the 90 and the 180 are Article 6(1)'s own numbers and it is only their
// APPLICATION that is in dispute.
// ---------------------------------------------------------------------------

/** The one group on the seeded UC-04 case that carries confirmations. */
function groupWithConfirmations(view) {
  const all = [
    ...(view.basis.dimensions || []).flatMap((d) => d.sources || []),
    ...(view.basis.measurements || []).flatMap((m) => m.sources || []),
  ];
  return all.find((g) => (g.confirmations || []).length) || null;
}

test("a check that was tested against its authority and held says so on the page", async () => {
  const { view, root } = await renderUc04();
  const group = groupWithConfirmations(view);
  assert.ok(group, "no UC-04 group carries a confirmation — this case no longer tests anything");
  assert.ok(group.caveats.length, "precondition: this group carries caveats too, which is the whole point");

  const page = textOf(root);
  group.confirmations.forEach((c) => {
    assert.ok(page.indexOf(c.headline) !== -1, "a confirmation lost its headline: " + c.id);
    assert.ok(page.indexOf(c.detail.slice(0, 60)) !== -1, "a confirmation lost its detail: " + c.id);
  });

  // MARKED FOR WHAT IT IS. "Checked and matched" names what was done — one
  // number, one list, one date, against the authority it came from. Without a
  // marker it would read as a finding of the same kind as the caveat above it.
  const nodes = collect(root, (n) => String(n.className) === "r-confirmation");
  assert.equal(nodes.length, group.confirmations.length);
  nodes.forEach((n) => assert.match(textOf(n), /^Checked and matched — /));
});

test("a confirmation is not drawn as a caveat, and follows it", async () => {
  const { view, root } = await renderUc04();
  const group = groupWithConfirmations(view);
  assert.ok(group);

  // A caveat is a contradiction recorded AGAINST a source we hold; a
  // confirmation is the opposite finding. Sharing a class would give the
  // confirmation the warning colour and lose the distinction entirely.
  collect(root, (n) => String(n.className) === "r-confirmation").forEach((n) =>
    assert.ok(String(n.className).indexOf("caveat") === -1)
  );

  // ORDER IS THE CORPUS'S OWN, not a layout preference. K-2's detail ends "How
  // they are applied is THE CAVEAT ABOVE" — the confirmation is written as a
  // bound on the dispute preceding it, so printing it first would leave that
  // sentence pointing at nothing.
  assert.match(
    group.confirmations.map((c) => c.detail).join(" "),
    /caveat above/,
    "the corpus no longer states the ordering these assertions rest on"
  );
  const box = collect(root, (n) => String(n.className) === "r-source-group").find(
    (n) => collect(n, (x) => String(x.className) === "r-confirmation").length
  );
  assert.ok(box, "the confirmation is not inside a finding's own source group");
  const kinds = collect(box, (n) => ["r-caveat", "r-confirmation"].indexOf(String(n.className)) !== -1).map(
    (n) => n.className
  );
  assert.equal(kinds.indexOf("r-caveat"), 0, "a caveat must be the first of the two kinds in the group");
  assert.ok(
    kinds.lastIndexOf("r-caveat") < kinds.indexOf("r-confirmation"),
    "every caveat must precede every confirmation"
  );
});

test("UC-08 says which pair was checked rather than assumed to fail with its neighbour", async () => {
  // Canada–Portugal is the pair the corpus verified against the agreement
  // itself, and it is recorded precisely BECAUSE Canada–Netherlands did not
  // check out. A dossier that printed only the failures would leave a reader
  // treating the two as equally shaky.
  const audit = new AuditLogger();
  const dossierStore = new DossierStore();
  await handleTaxInquiry(
    {
      externalRef: "9309",
      employmentId: "emp_active_001",
      source: "seed",
      text: "Our employee moved from Canada to Portugal — which country's social security applies? totalization",
      now: "2026-08-20",
    },
    { audit, dossierStore, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  const answer = await callHandler(createUc08Handler({ dossierStore, audit }), {
    method: "GET",
    path: "/api/dossiers/by-ticket/9309",
  });
  const view = answer.body;
  const confirmations = (view.sources || []).flatMap((g) => g.confirmations || []);
  assert.ok(confirmations.length, "the CA/PT dossier stopped carrying its confirmation");

  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc08ApiBaseUrl: UC08_BASE },
    ticketId: 9309,
    respond: servedBy(UC08_BASE, view),
  });
  const page = textOf(root);
  confirmations.forEach((c) => assert.ok(page.indexOf(c.headline) !== -1, "missing confirmation " + c.id));
});

test("the three framing sentences render, once for the page", async () => {
  const { view, root } = await renderUc04();
  const framings = view.basis.sources;
  ["framing", "caveatFraming", "confirmationFraming"].forEach((key) => {
    assert.ok(framings[key], "the server stopped publishing " + key);
  });

  const page = textOf(root);
  // A citation drawn with no statement that a citation decides nothing, and a
  // confirmation with no statement that it is not an approval, are the two
  // readings these sentences exist to prevent. Both were unrendered until now.
  const occurrences = (needle) => page.split(needle).length - 1;
  assert.equal(occurrences(framings.framing.slice(0, 70)), 1, "the source framing is missing or repeated");
  assert.equal(occurrences(framings.caveatFraming.slice(0, 70)), 1, "the caveat framing is missing or repeated");
  assert.equal(
    occurrences(framings.confirmationFraming.slice(0, 70)),
    1,
    "the confirmation framing is missing or repeated"
  );

  // ONCE FOR THE PAGE, not once per disclosure: a UC-04 case has five source
  // disclosures, and three framing sentences repeated five times would be most
  // of the panel.
  const disclosures = collect(root, (n) => n.tagName === "details" && /r-sources/.test(String(n.className)));
  assert.ok(disclosures.length >= 3, "this case no longer has enough disclosures to make repetition a risk");
});

test("the framing note is inside the findings section, and does not retitle it", async () => {
  /* MOVED BELOW THE FINDINGS ON 2026-08-31, and the first placement was wrong.
     It sat directly under the section's own H2 — which on a case with nothing
     to weigh reads "What was not established" — with the sub-label that would
     have re-headed the findings list suppressed, so a note about how to read
     citations was sitting under, and effectively titling, a heading about
     findings. The findings are what the section is for. */
  const { root } = await renderUc04();
  const order = headings(root);
  const note = order.findIndex((h) => /How to read the sources under each finding/.test(h));
  const sectionHeading = order.findIndex((h) => /^(What needs weighing|What was not established|What this run found)$/.test(h));
  const firstSourceBox = order.findIndex((h) => /this is based on|rests on no source|governs this route/.test(h));
  assert.ok(note !== -1, "the framing note did not render");
  assert.ok(sectionHeading !== -1 && firstSourceBox !== -1, "the findings section did not render");
  assert.ok(note > sectionHeading, "the note is between a heading and the content that heading names");
  assert.ok(note > firstSourceBox, "the note must follow the findings whose citations it explains");

  // STILL ONCE, and still inside the findings section rather than adrift at the
  // bottom of the page — the two properties §3.102 was built on.
  const decidedBy = order.findIndex((h) => /^Decided by check/.test(h));
  if (decidedBy !== -1) assert.ok(note < decidedBy, "the note fell out of the findings section entirely");
});
