// ---------------------------------------------------------------------------
// uc04SidebarCopy.test.js — what a UC-04 case SAYS, on the rendered page
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner opened a live UC-04 case in the Zendesk sidebar, reached by
// continuing a UC-03 routing, and said: "I saw so many things here I was not
// happy with. e.g. how can the relevant doc be absent". An audit of that one
// rendered page found fifteen defects. Every one of them was a STRING — server
// prose or a browser label — and not one had a test, because `npm test` never
// imports a browser asset and server prose is only ever compared to itself.
//
// So the assertions below drive the real workflow, the real read handler and
// the real zaf-app bundle over the fake DOM, and read the words that came out.
// Each is anchored to a specific defect and says which, because a copy test
// with no failure behind it becomes a spelling lock nobody may edit.
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
import { callHandler, collect, renderSidebar, servedBy, textOf } from "./fixtures/zafSidebar.js";

const BASE = "http://uc04.copy.test";
const CHRIS = "8ab12460-b568-4c1e-af9d-09b1fabd8f46"; // US, full-time, workation permission

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

/**
 * The exact case the owner was looking at, after the demo route moved to the
 * Netherlands: Chris Lee files his own 21-day trip, with the one prior stay the
 * continuation now offers, so BOTH day windows report a real figure.
 */
async function renderCase() {
  const authorizationStore = new AuthorizationStore();
  await handleWorkationRequest(
    {
      externalRef: "8404",
      employmentId: CHRIS,
      // The employee filing about their own employment — the shape
      // src/uc04/submissionIdentity.js accepts, and the one the portal's
      // continuation produces. An admin session would print a raw admin id
      // under "Filed by", correctly, and would not exercise the name lookup.
      session: { authenticatedEmploymentId: CHRIS },
      factors: {
        homeCountry: "US",
        nationality: "US",
        destination: { country: "NL" },
        startDate: "2026-09-01",
        endDate: "2026-09-21",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      travelHistory: [{ country: "NL", startDate: "2026-05-01", endDate: "2026-06-15" }],
      now: "2026-08-15",
    },
    {
      remote,
      audit: new AuditLogger(),
      authorizationStore,
      draftSummary: (args) => draftSummary(args, { isConfigured: () => false }),
      judge: async () => ({ verdict: "not_evaluated", reason: null }),
    }
  );
  const handler = createUc04Handler({ authorizationStore, audit: new AuditLogger(), remote });
  const answer = await callHandler(handler, { method: "GET", path: "/api/authorizations/by-ticket/8404" });
  assert.equal(answer.body.found, true);
  const view = answer.body;
  const rendered = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: BASE },
    ticketId: 8404,
    respond: servedBy(BASE, view),
  });
  return { view, root: rendered.root, text: textOf(rendered.root) };
}

// ---------------------------------------------------------------------------
// Claims that were FALSE
// ---------------------------------------------------------------------------

test("the page never claims this system holds no register of covered country pairs", async () => {
  // THE OWNER'S OWN COMPLAINT. The treaty dimension said "this system holds no
  // register of pairs that ARE covered" — printed directly above a citation to
  // D-20, the SSA's own status table, which carries the very pair it was
  // denying. Three registers exist: UC-08's SOCIAL_SECURITY_COVERAGE,
  // riskMatrix's EU_EEA_FOR_A1, and caveat C-9, which is rendered under this
  // same finding and names five covered pairs by authority and effective date.
  //
  // SUPERSEDED 2026-08-31, AND THE FIX WENT FURTHER THAN THE SENTENCE. The
  // owner then asked why a demo pair reads "unknown" at all. It no longer
  // does: the dimension reads both registers, so US–NL reports COVERED with
  // the network, the certificate and the detachment maximum. The claim this
  // test was named for cannot be made about this pair any more, because the
  // page now names the instruments instead of denying they exist.
  const { text } = await renderCase();
  assert.doesNotMatch(text, /no register of pairs that ARE covered/);
  assert.doesNotMatch(
    text,
    /is not on the list of pairs known to LACK an agreement/,
    "a pair BOTH registers answer for is still being reported as an absence of a recorded gap"
  );
  assert.match(text, /Both limbs are covered for United States → Netherlands/);
  // The bound is the point: an instrument in force is not a certificate issued.
  assert.match(text, /No certificate of coverage is confirmed for this trip/);
  assert.match(text, /Certificate that evidences it US certificate of coverage/);
});

test("nothing tells the reader a mobility specialist will approve this", async () => {
  // The 2026-08-30 three-stage rework established that no stage this system can
  // reach approves a work authorization, rewrote the panel and the server, and
  // left gate 18's `means` saying "a dossier was prepared for a mobility
  // specialist to approve … a named human still has to approve it". That string
  // renders as the panel's lead sentence — the loudest position on the page —
  // while the capacity card four inches below said "Nobody approves this here".
  const { text } = await renderCase();
  assert.doesNotMatch(text, /prepared for a mobility specialist to approve/);
  assert.match(text, /that decision belongs to the employer/);
  /* UPDATED 2026-08-31. This read `/Nobody approves this here/`, which was true
     of the panel for exactly one day and is not the claim this test is about.
     Remote's own mobility review (stage 3) IS now recorded on this screen — in
     this system, never sent to Remote (src/uc04/mobilityReview.js). What must
     still hold, and is what gate 18's `means` was contradicting, is that the
     WORK AUTHORIZATION — the employer's approval — is not decided here. That
     sentence is the panel's own account and it is unchanged. */
  assert.match(
    text,
    /The employer's approval is the customer's own, made by their manager in Remote's product/,
    "the panel's own account must still be there to agree with"
  );
  assert.match(text, /no API this system can call/i, "the stage with no endpoint is no longer named");
});

test("an absent free-text explanation says WHICH absence it is", async () => {
  // "The requester's own words — Not stated" asserted the requester explained
  // nothing. The note attached to that very row says the opposite: the words
  // exist, in the audit record, and this table has no column for them.
  const { text } = await renderCase();
  assert.match(text, /The requester's own words Not kept with this decision/);
  assert.doesNotMatch(text, /The requester's own words Not stated/);
});

// ---------------------------------------------------------------------------
// Machine vocabulary where a human one already existed
// ---------------------------------------------------------------------------

test("a name is printed where the page has already resolved one", async () => {
  // "Filed by 8ab12460-…" sat six inches under a card resolving the same id to
  // "Chris Lee". renderSubject already refuses to print a UUID twice — "the
  // same UUID twice is not two facts" — and renderEmployee printed it anyway.
  const { view, text } = await renderCase();
  assert.equal(view.employee.displayName, "Chris Lee", "the API stopped publishing a resolved name");
  assert.match(text, /Filed by Chris Lee/);
  // The id is not lost: "The case record" still carries it verbatim, which is
  // where somebody quoting it into Remote goes.
  assert.ok(text.indexOf(CHRIS) !== -1, "the raw id must remain quotable somewhere on the page");
});

test("prose names countries and duties, like the rows directly beneath it", async () => {
  // Three findings interpolated a raw alpha-2 code or an enum slug into a
  // sentence sitting directly above an evidence row rendering the same value in
  // words: "NL is inside the Schengen area" over "Destination Netherlands".
  const { text } = await renderCase();
  assert.doesNotMatch(text, /\b(NL|PT|US|CA|DE|ES) is inside the Schengen area/);
  assert.doesNotMatch(text, /No prior trips to (NL|PT|US|CA) /);
  assert.doesNotMatch(text, /Duties are 'engineering'/);
  assert.match(text, /Duties are 'Engineering'/);
});

test("the pair a treaty finding is keyed on says which pair it is", async () => {
  // "Country pair" was the nationality→destination pair, under a label
  // indistinguishable from the trip line's home→destination pair at the top of
  // the page. Identical here because Chris works where he is a national;
  // silently different for a Portuguese national working in Germany.
  const { text } = await renderCase();
  assert.doesNotMatch(text, /Country pair/);
  assert.match(text, /Nationality → destination United States → Netherlands/);
});

// ---------------------------------------------------------------------------
// Counts and numbering that did not describe what was on screen
// ---------------------------------------------------------------------------

test("no rung of the gate ladder renders with an empty description", async () => {
  // UC-04 position 15 carried `checks: "—"`, so the ladder printed a bug canary
  // as a rung marked `passed` with nothing to say. test/gateLadder.test.js now
  // floors `checks` at 20 characters, which found the identical placeholder in
  // UC-09.
  const { text } = await renderCase();
  assert.doesNotMatch(text, /Checks: —/);
  assert.match(text, /the risk matrix never reports a block without naming which rule blocked it/);
});

test("the ladder counts checks, and names how many gates they group into", async () => {
  // "All 18 gates" was a row count wearing the wrong word: UC-04 has 18
  // positions across 8 gate names, ten of them `risk_matrix`, rendered as ten
  // consecutive rows with the same caption.
  const { view, text } = await renderCase();
  const gates = new Set((view.gateLadder || []).map((r) => r.gate));
  const positions = new Set((view.gateLadder || []).map((r) => r.position));
  assert.ok(gates.size < positions.size, "this case no longer has a gate appearing at two positions");
  assert.match(text, new RegExp("All " + positions.size + " checks, in the order they run"));
  assert.match(text, new RegExp("grouped into " + gates.size + " gates"));
  assert.match(text, /Decided by check \d+ of \d+/);
  assert.doesNotMatch(text, /All \d+ gates, in the order/);
});

test("the findings are numbered by where they render, with no gap", async () => {
  // `dimension.position` is fixed on the server, and a CLEARED dimension is
  // filed into a collapsed section below the controls — taking its number with
  // it. A specialist read "1. … 3. … 4." and went looking for a finding 2 that
  // was one click away in a different section.
  const { root } = await renderCase();
  const labels = collect(root, (n) => String(n.className).indexOf("r-dimension-label") === 0).map((n) =>
    textOf(n)
  );
  const numbered = labels.filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split(".")[0]));
  assert.ok(numbered.length >= 3, "this case no longer renders enough numbered dimensions to test");
  // Every section restarts at 1 and counts up by one, so no section shows a gap.
  let expected = 0;
  for (const n of numbered) {
    expected = n === 1 ? 1 : expected + 1;
    assert.equal(n, expected, `the findings are numbered ${numbered.join(", ")} — a reader counting them finds a gap`);
  }
});

test("a disclosure counts the contradictions it is hiding, not only the documents", async () => {
  // The treaty finding advertised "1 document" over one citation and THREE
  // recorded contradictions — including C-9, which says the pair the finding
  // calls unknown is in fact covered. A caveat is the corpus contradicting code
  // this repo ships; it is more decision-relevant than the citation above it.
  const { root, text } = await renderCase();
  const summaries = collect(root, (n) => n.tagName === "summary").map(textOf);
  // The counts moved when the finding turned covered — two instruments now,
  // and C-9 retired because the claim it disputed is no longer made. What is
  // being pinned is the COUNTING, not the numbers: a disclosure that names its
  // documents and hides its contradictions is the defect.
  assert.ok(
    summaries.some((s) => /based on — 2 documents, 2 caveats/.test(s)),
    "the treaty disclosure no longer counts its caveats: " + JSON.stringify(summaries)
  );
  for (const summary of summaries.filter((s) => /based on —/.test(s))) {
    assert.match(
      summary,
      /caveats?|findings? with none/,
      "a source disclosure names its documents and says nothing about what contradicts them: " + summary
    );
  }
  assert.doesNotMatch(text, /based on — 1 document\b(?!,)/);
});

// ---------------------------------------------------------------------------
// The two risk numbers
// ---------------------------------------------------------------------------

test("the tier baseline and the per-request rollup each name their own subject", async () => {
  // The loudest line said "This request: medium risk" — which with zero flags
  // is the static USE-CASE baseline out of riskEngine.js — while the quietest
  // line at the bottom said "Risk rollup: low", the only per-request assessment
  // made. Nothing said they were different quantities.
  const { view, text } = await renderCase();
  // The flags live on the record, not at the top of the payload.
  assert.deepEqual(view.authorization.flags, [], "this case raises a flag now — the no-flag branch is untested here");
  assert.equal(view.caseRiskEscalated, false, "precondition: nothing was raised, so caseRisk IS the tier baseline");
  assert.match(text, /This use case: medium risk/);
  assert.doesNotMatch(text, /This request: medium risk/);
  // "this request", not "this trip": the rail is shared by all nine use cases and
  // was calling a contract amendment a trip (2026-09-02, UC-06 sidebar review D-8).
  assert.match(text, /This is a property of the use case, not an assessment of this request/);
});

// ---------------------------------------------------------------------------
// And the substance the route move was for
// ---------------------------------------------------------------------------

test("the Schengen allowance is measured rather than excused, and both windows report", async () => {
  /* THE ROUTE MOVED PT -> NL FOR THIS (2026-08-31). Portugal is in
     riskMatrix.js's five-entry DNV_COUNTRIES — `[PROPOSED]`, no authority, no
     version, never reviewed — and that one list both PICKED the travel document
     the continuation suggested and SUPPRESSED the count, so UC-04's single most
     substantive computation rendered as "Excused, not measured". The
     Netherlands is the only one of the four demo countries that can produce the
     number: PT is suppressed, and CA and US are not in the Schengen area at
     all. */
  const { text } = await renderCase();
  assert.doesNotMatch(text, /Excused, not measured/);
  assert.match(text, /67 days of stay against a limit of 90/, "the Schengen window no longer reports a figure");
  assert.match(text, /23 days of headroom/);
  // AND THE SECOND WINDOW, which is only rendered when a prior stay exists —
  // the reason the continuation now offers one. Two windows measuring the same
  // days against different limits is the distinction UC-04.md §7 forbids
  // collapsing, and it was unreachable from the flow the demo walks.
  assert.match(text, /67 days against a 183-day watch line/, "the tax-residency watch did not render");
  // AND ITS LABEL NAMES THE COUNTRY. A code interpolated INTO a label is
  // invisible to the browser's country-label registry, which maps whole labels
  // — so this row read "Days in NL" under a finding saying "Netherlands".
  assert.match(text, /Days in Netherlands across a rolling 365 days/);
  assert.doesNotMatch(text, /Days in NL /);
});
