// ---------------------------------------------------------------------------
// zafSidebarLayout.test.js  —  the sidebar is ONE page, in one order
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner opened a live UC-04 case and said:
//
//     "the UI in general is stressful to look at and not coherent, feels like
//      multiple reports in one."
//     "there is just too much info on there. some might be straight
//      unnecessary, and even the important ones are just not really well
//      placed. it is just all over the place."
//
// They were right, and the cause was structural rather than cosmetic. The panel
// had been built in seven passes — the case card, the WHY block, the gate
// ladder, the decision dimensions, the measurements, the role card, the settled
// decision — each of which was reviewed on its own and each of which had its
// own tests. Nobody had ever tested the WHOLE PAGE, so nothing could see that
// `a1_certificate_recommended` appeared three times, that one paragraph
// appeared twice, that four blocks of engineering backlog sat above the
// Approve button, or that 3,900 pixels of gate table stood between a specialist
// and the control they had opened the panel to use.
//
// Every assertion below is about a RELATIONSHIP BETWEEN PARTS — an order, a
// count, a containment. That is deliberate: each part was already correct in
// isolation, and being correct in isolation is exactly what the previous
// version was.
//
// The cases are real. They run the actual workflows against the mock Remote
// server and are served by the actual API handlers, because a fixture written
// to agree with the panel is the failure mode this repo pays for most often
// (CLAUDE.md §4).
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
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { createUc05Handler } from "../src/uc05/server.js";

import { callHandler, collect, renderSidebar, servedBy, textOf } from "./fixtures/zafSidebar.js";

const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

const UC04_BASE = "http://uc04.layout.test";
const UC05_BASE = "http://uc05.layout.test";

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

/**
 * A UC-04 workation awaiting a specialist: two flags, four dimensions, two
 * measurements, one of each cleared, and 17 gates. This is the exact shape the
 * owner was looking at.
 */
async function seedUc04Awaiting() {
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
      // Two stated stays: inside the Schengen window, past the residency watch.
      travelHistory: [
        { country: "ES", startDate: "2026-07-01", endDate: "2026-08-14" },
        { country: "ES", startDate: "2025-10-01", endDate: "2026-02-28" },
      ],
      now: "2026-08-15",
      externalRef: "9104",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  return createUc04Handler({ authorizationStore, audit, remote });
}

/**
 * A UC-05 resignation ESCALATED at gate 4: Brazil is not in the statutory
 * notice table, so no notice period and no payout were ever produced.
 *
 * This is the case that broke the previous design. Nothing can be signed here,
 * and almost every block on the page behaved as though something could.
 */
async function seedUc05Escalated() {
  const audit = new AuditLogger();
  const resignationStore = new ResignationStore();
  // Carlos Silva — the only BR employment in the mock fixtures.
  const employmentId = "c2cd77da-d576-423f-b4f1-f9e40b313353";
  const result = await handleResignationRequest(
    {
      employmentId,
      session: { authenticatedEmploymentId: employmentId },
      proposedEndDate: "2026-09-30",
      reason: "new opportunity",
      now: "2026-08-19",
      externalRef: "9105",
    },
    { remote, audit, resignationStore }
  );
  assert.equal(result.decision, "escalate", "the BR seed no longer escalates — the case under test has changed");
  assert.equal(result.reason, "unsupported_country");
  return { handler: createUc05Handler({ resignationStore, audit, remote }), employmentId };
}

async function viewFor(handler, path) {
  const answer = await callHandler(handler, { method: "GET", path });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.found, true);
  return answer.body;
}

/** Every rendered node, depth-first — i.e. reading order. */
function inReadingOrder(root) {
  return collect(root, () => true);
}

/** Where a node whose own text matches sits in reading order; -1 if absent. */
function positionOf(root, pattern) {
  const nodes = inReadingOrder(root);
  for (let i = 0; i < nodes.length; i += 1) {
    if (pattern.test(String(nodes[i].textContent || ""))) return i;
  }
  return -1;
}

function firstControlPosition(root) {
  const nodes = inReadingOrder(root);
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].tagName === "button") return i;
  }
  return -1;
}

async function renderUc04() {
  const handler = await seedUc04Awaiting();
  const view = await viewFor(handler, "/api/authorizations/by-ticket/9104");
  return {
    view,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
      ticketId: 9104,
      respond: servedBy(UC04_BASE, view),
    })),
  };
}

async function renderUc05() {
  const { handler, employmentId } = await seedUc05Escalated();
  const view = await viewFor(handler, "/api/resignations/by-ticket/9105");
  return {
    view,
    employmentId,
    ...(await renderSidebar({
      settings: { apiBaseUrl: "", uc05ApiBaseUrl: UC05_BASE },
      ticketId: 9105,
      respond: servedBy(UC05_BASE, view),
    })),
  };
}

// ---------------------------------------------------------------------------
// THE ORDER
// ---------------------------------------------------------------------------

test("what needs weighing comes before the controls, and the provenance comes after", async () => {
  // THE MEASUREMENT THAT PROMPTED THIS: 4,001 rendered pixels stood between the
  // top of the panel and the Approve button on this exact case, and the two
  // findings a specialist actually had to weigh were most of the way down them,
  // under a cleared check, a cleared measurement and a 17-row gate table.
  //
  // The rule is not "shorter". It is that everything above the control is
  // something you read TO DECIDE, and everything below it is something you read
  // to TRACE a decision afterwards.
  const { root } = await renderUc04();
  const control = firstControlPosition(root);
  assert.ok(control > 0, "the UC-04 case rendered no control at all");

  // Above: the finding that has to be weighed.
  const weighed = positionOf(root, /past the 183-day watch line/);
  assert.ok(weighed > -1, "the deciding finding is not on the page");
  assert.ok(weighed < control, "a finding the specialist must weigh renders BELOW the controls");

  // Below: the gate order, the audit slug, the record. None of these is read to
  // make a decision.
  for (const [label, pattern] of [
    ["the gate order", /^Decided by gate \d+ of \d+/],
    ["the case record", /^The case record$/],
    ["the cleared checks", /^Every check that cleared/],
  ]) {
    const at = positionOf(root, pattern);
    assert.ok(at > -1, `${label} disappeared from the page entirely`);
    assert.ok(at > control, `${label} renders ABOVE the controls`);
  }
});

test("the whole gate ladder is still there, and a gate that never ran still says so", async () => {
  // Collapsing the ladder must not flatten the one distinction it exists for:
  // docs/GATES.md rule 2, "a gate that never ran approved of nothing".
  const { root, view } = await renderUc05();
  const text = textOf(root);
  const notReached = (view.gateLadder || []).filter((rung) => rung.status === "not_reached");
  assert.ok(notReached.length >= 3, "the BR escalation no longer leaves gates unreached");
  for (const rung of notReached) assert.ok(text.includes(rung.gate), `gate "${rung.gate}" vanished from the ladder`);
  assert.match(text, /not reached/);
  assert.match(text, /said nothing about this case in either direction/);
  // And never as a pass.
  assert.doesNotMatch(text, /not reached — passed|passed \(not reached\)/i);
});

// ---------------------------------------------------------------------------
// SAYING EACH THING ONCE
// ---------------------------------------------------------------------------

function occurrences(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

test("a paragraph the panel has already printed is not printed again", async () => {
  // FOUR COPIES, ONE STRING. On this case the owner counted the same paragraph
  // under Why, under gate 4, inside the escalation note and again in the
  // refusal. Each field is right to carry it — each is a complete answer to its
  // own question — so the repetition is a property of the PAGE.
  const { root, view } = await renderUc05();
  const text = textOf(root);
  const means = view.decidedBy.means;
  assert.ok(means && means.length > 80, "the fixture no longer carries the paragraph under test");
  assert.equal(
    occurrences(text, means),
    1,
    "the deciding paragraph is on this page more than once"
  );
  // ...and removing it from the refusal did not remove the refusal's own words.
  assert.match(text, /ESCALATED at gate 4/);
  assert.match(text, /worked on its own ticket/);
});

test("a flag code is not repeated in words the page has already said", async () => {
  // `a1_certificate_recommended` appeared three times on one UC-04 case: a row
  // in the case card, a chip under Why, and the dimension that explains it. The
  // CODE survives — it is the routing vocabulary and the audit string — but it
  // survives once, with the other audit strings, below the controls.
  const { root, view } = await renderUc04();
  const control = firstControlPosition(root);
  const flags = view.authorization.flags || [];
  assert.ok(flags.length >= 2, "the fixture no longer raises the flags under test");
  for (const flag of flags) {
    const at = positionOf(root, new RegExp("^" + flag + "$"));
    assert.ok(at > -1, `the flag code ${flag} is not on the page at all`);
    assert.ok(at > control, `the flag code ${flag} still renders above the controls`);
    assert.equal(occurrences(textOf(root), flag), 1, `${flag} appears more than once`);
  }
});

test("the subject line names the person, and never prints the same identifier twice", async () => {
  // TWO PROPERTIES, AND THE SECOND IS OLDER THAN THE FIRST.
  //
  // (1) The project owner, on a live ticket: "I never even saw any relevant
  //     info of the employee — not even name. That is bad." The header opened
  //     with 36 hexadecimal characters. src/uc05/server.js now publishes
  //     `employee`, so the header reads the name the SERVER resolved.
  //
  // (2) A self-filed resignation records the employment id in `requester` as
  //     well, so the header read "c2cd77da-… · filed by c2cd77da-…" — the
  //     same 36 characters, twice, in front of an HR person. That dedupe still
  //     compares the two IDs, not the display name: a name is never what makes
  //     two records the same record.
  //
  // The id is not lost — "The case record" below carries it verbatim, which is
  // where somebody quoting it into Remote goes. Asserted, so a future pass
  // cannot "tidy" the identifier off the page entirely.
  const { root, view, employmentId } = await renderUc05();
  const subject = collect(root, (n) => String(n.className) === "r-subject")[0];
  assert.ok(subject, "the header lost its subject line");
  assert.doesNotMatch(String(subject.textContent), /filed by/);

  const name = view.employee && view.employee.displayName;
  assert.ok(name, "src/uc05/server.js stopped publishing a display name — this test is now asserting nothing");
  assert.equal(String(subject.textContent).trim(), name, "the header is not the person's name");
  assert.equal(
    occurrences(String(subject.textContent), employmentId),
    0,
    "the uuid is still in the header beside the name — the decoding this pass exists to remove"
  );
  assert.equal(occurrences(textOf(root), employmentId) > 0, true, "the employment id vanished from the page entirely");
});

// ---------------------------------------------------------------------------
// ONE RISK STATEMENT
// ---------------------------------------------------------------------------

test("one risk verdict stands above the controls, and the other two are below them", async () => {
  // FOUR STATEMENTS, THREE VALUES, ONE WORD. "🟡 Medium-risk use case", "This
  // request: high risk", the panel's own "Risk level: medium" row and "Risk
  // rollup: medium" all rendered above the Approve button. Each was correct
  // about a different subject; together they read as the page contradicting
  // itself, which is how the owner read them.
  //
  // What survives above the controls is the verdict about THE REQUEST — the
  // only one of the four that is about the thing being decided. The tier's name
  // and the routing rollup are still on the page, in the case record, where a
  // rollup belongs.
  const { root } = await renderUc04();
  const control = firstControlPosition(root);

  const request = positionOf(root, /^This request: /);
  assert.ok(request > -1 && request < control, "the request's own risk verdict is not above the controls");

  const rollupAt = positionOf(root, /^Risk rollup: /);
  assert.ok(rollupAt > -1, "the routing rollup was dropped from the page rather than moved");
  assert.ok(rollupAt > control, "the routing rollup still competes with the request's own risk above the controls");

  // The tier headline is gone as a headline — the risk sentence names the
  // baseline itself, so nothing needs a rival one.
  assert.equal(positionOf(root, /^Medium-risk use case$/), -1, "the tier headline is back above the controls");

  // rca-iih7 / D-31: "Classified as a medium-risk use case" used to repeat the
  // SAME baseline the risk sentence above already names — a round-6 specialist
  // read that plus the tier glyph's colour as risk stated three different ways
  // that did not obviously agree. It is gone outright now, not moved: the risk
  // sentence above the controls is the only place the baseline is stated in
  // words.
  assert.equal(positionOf(root, /^Classified as a /), -1, "the tier's name still repeats the risk sentence's own baseline");
});

test("the execution model names the use case as its subject, never the request", async () => {
  // "A named human must approve before anything is written" is true of the use
  // case and was read as a promise about the request — on an ESCALATED case
  // where nobody can approve anything, three lines above the server saying so.
  const { root } = await renderUc05();
  const text = textOf(root);
  assert.match(text, /Nothing in this use case is written until a named human approves it\./);
});

// ---------------------------------------------------------------------------
// AN ESCALATION IS NOT A REFUSAL SOMEBODY CAN STILL SIGN
// ---------------------------------------------------------------------------

test("an escalated case names who owns it without offering a slot anyone can fill", async () => {
  // The card was built for two states: fillable, and filled. This case is
  // neither, and the card said "HR Ops · OUTSTANDING" and "Whether you hold
  // this role is checked by the API when you submit" — two promises about a
  // submission that cannot be made — three lines above the server's own "It has
  // no sign-off path here."
  const { root, buttons } = await renderUc05();
  const text = textOf(root);

  assert.equal(buttons.length, 0, "an escalated case grew a control");
  assert.match(text, /HR Ops/, "the owner of the decision is no longer named");
  assert.match(text, /not open here/, "an unfillable slot still reads as outstanding work on this screen");
  assert.doesNotMatch(text, /outstanding/i, "the slot still claims a signature is owed here");
  assert.doesNotMatch(
    text,
    /checked by the API when you submit/i,
    "the panel still explains what happens when you submit a decision that cannot be submitted"
  );

  // And the refusal is read BEFORE the card that names the owner, not after it.
  const refusal = positionOf(root, /It has no sign-off path here/);
  const owner = positionOf(root, /^Who decides this$/);
  assert.ok(refusal > -1 && owner > -1, "the refusal or the ownership card is missing");
  assert.ok(refusal < owner, "the panel still offers a sign-off path before withdrawing it");
});

test("a section only claims findings when there are findings", async () => {
  // "What this decision turns on" over two sentences reading "no notice end date
  // was produced" and "no payout was reconciled" is an empty section pretending
  // to be content. Neither turns anything: the run stopped at gate 4.
  const { root } = await renderUc05();
  const text = textOf(root);
  assert.doesNotMatch(text, /What needs weighing/, "an escalation with no findings claims findings to weigh");
  assert.match(text, /What this run found/);
  // And it must never claim checks cleared when the run stopped before them —
  // that is `not_reached` read as `passed`, one section over.
  assert.doesNotMatch(text, /every check that ran cleared/i);
});

// ---------------------------------------------------------------------------
// WHAT MUST STILL BE TRUE
// ---------------------------------------------------------------------------

test("a cleared check is collapsed; a check with no verdict is not", async () => {
  // `cleared` is the ONLY state that means fine. Collapsing the cleared ones is
  // a design choice; collapsing an `unknown` or a `suppressed` one would be the
  // defect the five-state vocabulary exists to prevent.
  const { root, view } = await renderUc04();
  const control = firstControlPosition(root);
  const dimensions = view.basis.dimensions || [];

  const cleared = dimensions.filter((d) => d.state === "cleared");
  const open = dimensions.filter((d) => d.state === "unknown" || d.state === "unavailable");
  assert.ok(cleared.length && open.length, "the fixture no longer has one of each");

  for (const d of cleared) {
    const at = positionOf(root, new RegExp(d.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(at > control, `the cleared check "${d.label}" is still in front of the specialist`);
  }
  for (const d of open) {
    const at = positionOf(root, new RegExp(d.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(at > -1 && at < control, `"${d.label}" has no verdict and was collapsed as if it did`);
  }
});

test("a state this file has never seen is shown, never filed under cleared", async () => {
  // THE FAILURE THIS FORBIDS IS INVISIBLE. A state added server-side tomorrow
  // that fell through to the cleared group would produce a page with nothing to
  // report, which looks exactly like a clean case. factState() answers `open`
  // for an unknown state and `open` is not `settled`, so it arrives in front of
  // the specialist instead.
  const view = {
    found: true,
    authorization: {
      id: "auth_novel_state",
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
    basis: {
      dimensions: [
        {
          position: 1,
          key: "invented",
          label: "A dimension in a state this bundle predates",
          state: "state_this_bundle_has_never_heard_of",
          finding: "Whatever it means, it is not a pass.",
        },
      ],
    },
  };

  const { root } = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 9106,
    respond: servedBy(UC04_BASE, view),
  });
  const control = firstControlPosition(root);
  const at = positionOf(root, /A dimension in a state this bundle predates/);
  assert.ok(at > -1, "a finding in an unrecognised state was dropped entirely");
  assert.ok(at < control, "a finding in an unrecognised state was filed away as if it had cleared");
});

test("the panel states its gaps and never its engineering backlog", async () => {
  // THE DISTINCTION, AND IT IS THE IMPORTANT ONE. The GAP — "coverage
  // unconfirmed; the absence of a recorded gap is not a record of coverage" —
  // is decision-relevant and must stay: a specialist has to know the system
  // does not know. The REMEDIATION PLAN — which table to build, which source
  // file resolves it, which column is missing — is engineering backlog, and the
  // approval screen is not where backlog is read. There were four of those
  // blocks above the Approve button on one UC-04 case.
  for (const rendered of [await renderUc04(), await renderUc05()]) {
    // THE CITATIONS ARE EXEMPT, AND ONLY THEY ARE. A citation block names where
    // the curated map lives, which is the provenance OF A CITATION — the reader
    // asked where the rule comes from and that is the answer. It is not a plan
    // for changing this system, and it only exists behind a disclosure inside
    // the finding that raised it. Everything outside those blocks is what an
    // approver reads without asking for it.
    const outsideCitations = textOf(
      (function strip(node) {
        const copy = { ...node, childNodes: node.childNodes.filter((c) => String(c.className) !== "r-sources").map(strip) };
        return copy;
      })(rendered.root)
    );
    assert.doesNotMatch(outsideCitations, /What it would take:/, "the remediation plan is back on the approval screen");
    assert.doesNotMatch(outsideCitations, /src\/uc0\d/, "a source file path is being shown to an approver");
    assert.doesNotMatch(outsideCitations, /\bcolumn\b[^.]*\buc0\d_/, "a missing database column is being shown to an approver");
  }

  // The gaps themselves survive, in both cases, in their own words.
  const uc04 = textOf((await renderUc04()).root);
  assert.match(uc04, /absence of a recorded gap, not a record of coverage/);
  const uc05 = textOf((await renderUc05()).root);
  assert.match(uc05, /gap in our own table/);
});

test("the state gloss is printed where a state can be misread, and not where it cannot", async () => {
  // Every non-settled state used to print its definition, so a page with four
  // findings carried four of them — including "Measured against the limit and
  // past it" under a finding already reading "210 days against a 183-day watch
  // line — over by 27". The four that are ABSENCES of a verdict keep theirs:
  // that sentence is what stops an absence being skim-read as a pass.
  const { root } = await renderUc04();
  const text = textOf(root);
  assert.match(text, /its answer is not evidence in either direction/, "the `unknown` gloss was dropped");
  assert.match(text, /nothing was ever consulted/, "the `unavailable` gloss was dropped");
  assert.doesNotMatch(text, /Measured against the limit and past it\./, "a verdict is being restated as a definition");
});

test("a citation sits inside the finding it explains, not in a bibliography", async () => {
  // The citations are hand-curated per finding (src/uc04/decisionSources.js) and
  // NOTHING rendered them: a specialist who wanted to know why 183 days is the
  // line had nowhere to go from the screen asking them to weigh it. A list at
  // the foot of the panel would be a bibliography — it tells you documents exist
  // and leaves you to work out which finding each belongs to.
  const { root, view } = await renderUc04();
  const dimensions = collect(root, (n) => String(n.className).indexOf("r-dimension ") === 0);
  assert.ok(dimensions.length, "no dimension was rendered at all");

  const withSources = dimensions.filter((d) => collect(d, (n) => String(n.className) === "r-sources").length);
  assert.ok(withSources.length, "no finding carries its own citations");

  // The documents are the server's, named exactly as it named them.
  const cited = view.basis.dimensions.find((d) => (d.sources || []).length);
  const title = cited.sources[0].citations[0].title;
  assert.ok(
    withSources.some((d) => textOf(d).includes(title)),
    "the citation is on the page but not inside the finding it explains"
  );

  // And the honesty of the method travels with it: hand-curated, no ranking, no
  // similarity score.
  assert.match(textOf(root), /no search, no ranking and no similarity score/);
});
