// ---------------------------------------------------------------------------
// zafWhoThisIsAbout.test.js  —  the person a decision is about, on the screen
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner, reading the ZAF sidebar on a live ticket:
//
//     "In that Zendesk bar I never even saw any relevant info of the employee
//      — not even name. That is bad."
//
// And, on the same pass, the rule they asked for every row on every panel to be
// held to:
//
//     "All your Zendesk bars are made for the person building, not the person
//      using it. Look at each from the stakeholder's perspective: what would
//      they need in each bar to make their job easier."
//
// Every panel opened with a 36-character UUID. `src/shared/employeeSubject.js`
// now publishes the person, re-read from Remote when the panel is opened, and
// `basis.requester` (src/uc04/decisionFacts.js) has published who FILED the
// request since the basis landed — parsed by the loader and dropped one line
// short of any renderer, because it carries no `sentence` and the generic prose
// pass skipped it.
//
// WHAT THESE ASSERTIONS ARE ABOUT. Not that a function was called: that a
// specialist reading the panel is shown a name, is shown what the record does
// NOT carry as a sentence rather than as a blank, and is never shown a name the
// browser invented. The cases are real — driven through the actual workflows
// against the mock Remote server and served by the actual API handlers —
// because a fixture written to agree with the panel is the failure mode this
// repo pays for most often (CLAUDE.md §4).
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler } from "../src/uc04/server.js";

import { callHandler, collect, renderSidebar, servedBy, textOf } from "./fixtures/zafSidebar.js";

const UC04_BASE = "http://uc04.whothisisabout.test";
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

/**
 * The exact case the owner was looking at when they asked the question: a
 * workation filed by a company admin ABOUT somebody else, awaiting a mobility
 * specialist. It is the only one of the nine that publishes both halves of this
 * block, which is why every relationship assertion below uses it.
 */
async function seedUc04() {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();
  await handleWorkationRequest(
    {
      externalRef: "9204",
      employmentId: "emp_active_001",
      source: "portal",
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
      travelHistory: [{ country: "ES", startDate: "2026-07-01", endDate: "2026-08-14" }],
      now: "2026-08-15",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  return createUc04Handler({ authorizationStore, audit, remote });
}

async function renderUc04() {
  const handler = await seedUc04();
  const answer = await callHandler(handler, { method: "GET", path: "/api/authorizations/by-ticket/9204" });
  assert.equal(answer.body.found, true, "the seed stopped producing a case");
  const rendered = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 9204,
    respond: servedBy(UC04_BASE, answer.body),
  });
  return { ...rendered, view: answer.body };
}

/** Render an arbitrary view through the shell — for the states no seed produces. */
async function renderView(view) {
  return renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: UC04_BASE },
    ticketId: 9204,
    respond: servedBy(UC04_BASE, view),
  });
}

/** What a reader sees before clicking: a closed <details> gives only its summary. */
function openText(node) {
  if (node.tagName === "details") {
    const summary = node.childNodes.find((k) => k.tagName === "summary");
    return summary ? textOf(summary) : "";
  }
  const own = node.textContent ? String(node.textContent) : "";
  return (own + " " + node.childNodes.map(openText).join(" ")).replace(/\s+/g, " ").trim();
}

function subjectCard(root) {
  return collect(root, (n) => String(n.className).indexOf("r-subject-card") !== -1)[0] || null;
}

// ===========================================================================
// 1. The name, where the uuid was
// ===========================================================================

test("the header names the person, and does not print their uuid beside it", async () => {
  const { root, view } = await renderUc04();
  const name = view.employee.displayName;
  assert.ok(name, "src/uc04/server.js stopped publishing a display name — this test now asserts nothing");

  const subject = collect(root, (n) => String(n.className) === "r-subject")[0];
  assert.ok(subject, "the header lost its subject line");
  const line = textOf(subject);
  assert.match(line, new RegExp(name), "the header still opens on an identifier rather than a person");
  assert.ok(
    !line.includes(view.employee.employmentId),
    "the uuid is printed beside the name — the decoding this block exists to remove"
  );
});

test("the employment id is still on the page, in the record a person quotes into Remote", async () => {
  // The id is the handle. Naming the person must not cost the reader the value
  // they retype into Remote, a ticket or a colleague's message — it moves, it
  // does not vanish.
  const { root, view } = await renderUc04();
  assert.ok(textOf(root).includes(view.employee.employmentId), "the employment id vanished from the panel entirely");
});

test("the name is not repeated as a row underneath the heading that is already the name", async () => {
  // 86f4dd9's rule, applied to the block that came after it: a card whose
  // heading says the thing does not then say it again in its first row.
  const { root, view } = await renderUc04();
  const card = subjectCard(root);
  assert.ok(card, "the who-this-is-about card is not on the page");
  const occurrences = textOf(card).split(view.employee.displayName).length - 1;
  assert.equal(occurrences, 0, "the person's name is printed inside the card as well as in the header");
});

// ===========================================================================
// 2. The facts the specialist can now check, and the one they can now compare
// ===========================================================================

test("every field the server published is on the page, under the server's own label", async () => {
  const { root, view } = await renderUc04();
  const card = textOf(subjectCard(root));
  for (const field of view.employee.fields) {
    if (field.key === "full_name") continue; // the heading
    assert.ok(card.includes(field.label), `the field "${field.label}" is published and not rendered`);
    if (field.value) assert.ok(card.includes(field.value), `the value of "${field.label}" is not on the page`);
  }
});

test("the record's country and the country the request states are both readable, so a reader can compare them", async () => {
  // src/uc04/decisionFacts.js says of the stated home country: "It is not read
  // from the Remote employment record and is never compared to it, so a wrong
  // country here is not caught anywhere." That sentence is only actionable if
  // the record's own country is on the same screen. It was not, on any panel,
  // until this block existed.
  const { root, view } = await renderUc04();
  const card = textOf(subjectCard(root));
  const recordCountry = view.employee.fields.find((f) => f.key === "country_code");
  assert.ok(recordCountry && recordCountry.value, "the fixture's employment carries no country to compare against");
  assert.ok(card.includes(recordCountry.value), "the record's country is not on the page");
  assert.ok(card.includes("Home country, as stated on the request"), "the stated home country is not on the page");
});

test("a country in this block is read as a name, never as a two-letter code", async () => {
  // The sidebar's half of "codes decide, names are read" (7986dcb). The stated
  // home country arrives as `DE`.
  const { root, view } = await renderUc04();
  const stated = view.basis.requester.subject.statedHomeCountry.value;
  assert.equal(stated, "DE", "the fixture stopped carrying a bare code — this test is asserting nothing");
  const card = textOf(subjectCard(root));
  assert.ok(card.includes("Germany"), "the stated home country still renders as a code");
});

// ===========================================================================
// 3. Who filed it — the field that was published and never drawn
// ===========================================================================

test("who filed the request, and whether they are the person it is about, are both stated", async () => {
  const { root, view } = await renderUc04();
  const card = textOf(subjectCard(root));
  const filer = view.basis.requester.filedBy.id;
  assert.ok(filer, "the fixture stopped recording a filer");
  assert.ok(card.includes(filer), "the filer is not named anywhere");
  assert.equal(
    view.basis.requester.actingFor.state,
    "on_behalf_of_the_subject",
    "the fixture stopped being a request filed about somebody else"
  );
  assert.ok(
    card.includes("Someone else, for the employee"),
    "the panel does not say that the filer is not the person this is about"
  );
});

test("the acting-for words are a rename of the server's state, and the server's own sentence is still on the page", async () => {
  // Three states are renamed in the browser the way DECISION_LABELS renames a
  // decision. That is presentation only, and it is safe ONLY because the
  // server's sentence stays beside it — a rename that replaced the account
  // would be the browser deciding what the state means.
  const { root, view } = await renderUc04();
  const whole = textOf(root);
  assert.ok(whole.includes(view.basis.requester.actingFor.finding), "the server's own sentence about acting-for was dropped");
  assert.ok(whole.includes(view.basis.requester.identity.finding), "the server's own sentence about the identity check was dropped");
});

test("the absence of the requester's own words is stated, not left to be inferred", async () => {
  // An escalated case with no explanation on it reads as a requester who
  // explained nothing. The truth is that the words exist — in the audit record
  // and in the prompt — and this table has no column for them.
  const { root, view } = await renderUc04();
  const whole = textOf(root);
  assert.equal(view.basis.requester.statedReason.state, "not_retained");
  assert.ok(whole.includes(view.basis.requester.statedReason.finding), "the panel is silent about the missing free text");
});

test("engineering backlog does not reach this block", async () => {
  // `whatItWouldTake` names a column to add to a table. 0f71708 took four such
  // blocks off the page above one Approve button; this block must not put one
  // back.
  const { root, view } = await renderUc04();
  const whole = textOf(root);
  const backlog = view.basis.requester.statedReason.whatItWouldTake;
  assert.ok(backlog, "the fixture stopped publishing a whatItWouldTake to be excluded");
  assert.ok(!whole.includes(backlog), "a `whatItWouldTake` is rendered — that is a work item, not a decision input");
});

// ===========================================================================
// 4. What a specialist needs TO DECIDE is open; what it does not establish is
//    counted
// ===========================================================================

test("the values are readable without clicking, and the notes are counted rather than hidden", async () => {
  const { root } = await renderUc04();
  const open = openText(root);
  for (const value of ["admin_jane", "Someone else, for the employee", "Verified", "Germany"]) {
    assert.ok(open.includes(value), `"${value}" needs a click, and it is what the specialist decides on`);
  }
  assert.match(
    open,
    /What each of these does not establish — \d+ notes/,
    "the notes are neither open nor counted — a reader cannot tell they exist"
  );
});

test("every note is still on the page, verbatim, one click away", async () => {
  const { root, view } = await renderUc04();
  const whole = textOf(root);
  const r = view.basis.requester;
  for (const finding of [r.filedBy.finding, r.actingFor.finding, r.identity.finding, r.subject.statedNationality.finding]) {
    assert.ok(whole.includes(finding), "a requester note was dropped rather than collapsed");
  }
});

// ===========================================================================
// 5. The four ways it must fail out loud
// ===========================================================================

const FAILURE_STATES = [
  ["not_found", "No such employment record"],
  ["unavailable", "The employee record could not be read"],
  ["not_looked_up", "The employee record was not looked up"],
  ["no_employment_id", "This case names no employee"],
];

for (const [state, heading] of FAILURE_STATES) {
  test(`state "${state}" renders the server's sentence under its own heading, never a blank`, async () => {
    // `src/shared/employeeSubject.js` splits these for the reason
    // src/shared/upstreamFailure.js splits its three: "Remote says there is no
    // such record" and "we could not ask Remote" send a specialist to two
    // different places, and one heading for both sends them to the wrong one.
    const finding = `A sentence written by the server for state ${state}.`;
    const { root } = await renderView({
      found: true,
      authorization: { id: "a1", employmentId: "emp_x", requester: "admin_jane", decision: "escalate", flags: [], createdAt: "2026-08-01T00:00:00.000Z" },
      employee: { state, employmentId: "emp_x", displayName: null, fields: [], readAt: null, httpStatus: null, finding },
      actionable: false,
      actionableReason: "Escalated.",
      useCaseTier: "medium",
      caseRisk: "medium",
    });
    const card = subjectCard(root);
    assert.ok(card, `no card rendered for state ${state}`);
    const text = textOf(card);
    assert.ok(text.includes(heading), `state ${state} rendered no heading of its own`);
    assert.ok(text.includes(finding), `state ${state} dropped the server's own account of what happened`);
  });
}

test("a field the record does not carry is rendered as its absence sentence, not as a blank", async () => {
  const absence = "The employment record carries no job title.";
  const { root } = await renderView({
    found: true,
    authorization: { id: "a1", employmentId: "emp_x", requester: "admin_jane", decision: "escalate", flags: [], createdAt: "2026-08-01T00:00:00.000Z" },
    employee: {
      state: "available",
      employmentId: "emp_x",
      displayName: "Amara Okafor",
      fields: [{ key: "job_title", label: "Job title", value: null, absence }],
      readAt: "2026-08-20T00:00:00.000Z",
      httpStatus: null,
      finding: "Read from Remote just now.",
    },
    actionable: false,
    actionableReason: "Escalated.",
    useCaseTier: "medium",
    caseRisk: "medium",
  });
  const text = textOf(subjectCard(root));
  assert.ok(text.includes("Job title"), "the label vanished with the value");
  assert.ok(text.includes(absence), "an absent field rendered as a blank — indistinguishable from nobody showing it");
});

// ===========================================================================
// 6. Silence is the safe direction, and nothing here is written in the browser
// ===========================================================================

test("a view carrying neither field renders no card at all", async () => {
  // A card promising a person, for a payload that carries none, is a claim that
  // the read failed. Seven of the nine APIs published no `employee` the day
  // this landed; those panels must look exactly as they did.
  const { root } = await renderView({
    found: true,
    authorization: { id: "a1", employmentId: "emp_x", requester: "admin_jane", decision: "escalate", flags: [], createdAt: "2026-08-01T00:00:00.000Z" },
    actionable: false,
    actionableReason: "Escalated.",
    useCaseTier: "medium",
    caseRisk: "medium",
  });
  assert.equal(subjectCard(root), null, "an empty who-this-is-about card was rendered for a view that publishes neither field");
});

test("no sentence in this block is written in the browser", async () => {
  // The same rule 9914403 pinned for the 🔴 framing statement, generalised: a
  // rendering layer that composed its own account of an employment record would
  // be making a claim on behalf of a use case whose spec it cannot read, and
  // would go on making it after the server changed its wording, silently.
  const { view } = await renderUc04();
  const assets = ["main.js", "panels.js"]
    .map((f) => readFileSync(new URL(`../zaf-app/assets/${f}`, import.meta.url), "utf8"))
    .join("\n")
    // Comments carry quotations from the server on purpose; strip them first.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const sentences = [
    view.employee.finding,
    view.basis.requester.filedBy.finding,
    view.basis.requester.identity.finding,
    view.basis.requester.subject.statedHomeCountry.finding,
  ];
  for (const sentence of sentences) {
    assert.ok(!assets.includes(sentence), "a server sentence is hard-coded in the bundle — it will outlive the server's own wording");
  }
});
