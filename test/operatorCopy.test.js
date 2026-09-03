// ---------------------------------------------------------------------------
// operatorCopy.test.js  —  the operator surfaces say each thing once
// ---------------------------------------------------------------------------
// WHAT THIS PINS
//
// The project owner, looking at a banner whose heading read "Continued from
// your travel request" and whose body then explained at length what that meant:
// "remove this part … only the heading is needed. Same for every use case."
//
// The shape is a heading that says the thing, followed by prose that says the
// thing again. `test/portalCopy.test.js` pins that rule for the REQUESTER's
// surfaces. This file pins it for the seven surfaces an OPERATOR or a
// specialist opens — the approval queue, the audit trail viewer, the nine-use-
// case dashboard, and the four demo surfaces — where the judgement is
// deliberately NOT the same one.
//
// WHY THE JUDGEMENT DIFFERS HERE, AND WHY THIS FILE HAS TWO HALVES
//
// A requester wants the form. An operator wants to know what a number MEANS and
// how it was derived, because they are about to act on it: "36 of 39 waiting
// cannot be actioned" is worth nothing asserted and everything explained. So
// cutting prose on these pages is only safe in one direction, and a test that
// only banned words would license exactly the wrong sweep — the next agent
// would strip the caveats and pass.
//
//   §1 bans the sentences that were the heading again. Exact strings, because
//      the point is that these particular ones do not come back; a rewrite that
//      says something new is not what this is guarding against.
//   §2 requires the statements that must survive any future sweep: what a
//      number means, what an absence means, what the page cannot do, and the
//      operator remedies. This is the load-bearing half. A page that has been
//      gutted passes every assertion in §1.
//
// HERMETIC: reads static assets off disk. No port, no socket, no network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** The seven operator-facing static pages. */
const PAGES = {
  "approval queue": "src/approvalqueue/assets/index.html",
  "audit viewer": "src/auditview/assets/index.html",
  dashboard: "src/dashboard/assets/index.html",
  playground: "src/playground/assets/index.html",
  "chat demo": "src/chatdemo/assets/index.html",
  "live demo": "src/livedemo/assets/index.html",
  "remote UI stand-in": "src/remoteui/assets/index.html",
};

/**
 * Some of these pages compose their prose in the browser asset rather than in
 * the markup — the queue's tile notes and the dashboard's per-section blurbs
 * are string literals in app.js. Searching only the HTML would report a
 * statement as MISSING when it is on screen, which is the same class of false
 * alarm the surfaces themselves exist to avoid, so the corpus is both files.
 */
const asset = (page) => PAGES[page].replace(/index\.html$/, "app.js");
const corpus = (page) =>
  (read(PAGES[page]) + "\n" + read(asset(page)))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

// =============================================================================
// 1. The heading, said twice
// =============================================================================
//
// Each entry is prose that was removed because the heading, a tile note, a
// column header, a field label or a badge on the same screen already said it.
// The comment names which one, so a future editor restoring a sentence can see
// what it would be duplicating rather than having to guess why it went.

const REMOVED_ECHOES = {
  "approval queue": [
    // h1 "Nobody can act on these", and the tile above it already reads
    // "Nobody can act on / waiting, with no reachable place to be approved".
    "Each of these is waiting on a person and has no reachable place",
    // Every one of these is a labelled row on the card itself.
    "Who it waits on, how long it has waited",
    // Named the table's own column headers back to the reader.
    "What is waiting where, and whether that use case has an approval",
    // h2 "Teams and their queues", and the server's account-level verdict
    // prints directly below it in very nearly these words.
    "Every team the routing table hands work to",
  ],
  dashboard: [
    // The sidebar lists all nine, and the <title> is "UC-01…09".
    "All nine use cases, side by side",
  ],
  playground: [
    // The four numbered cards below say which role each step is.
    "Play both roles",
  ],
  "chat demo": [
    // h1 "UC-01 Chat Demo".
    "A conversational wrapper around UC-01",
    // The same banner's own "Demo/testing aid, not a submission deliverable".
    "an in-memory sandbox",
  ],
  "live demo": [
    // Said by the title, the "Live · real account" badge, the warning banner
    // and the submit button. The form says what to fill in.
    "This is the real thing, end to end",
  ],
  "remote UI stand-in": [
    // Card note: "On the company's behalf — only for the company's own
    // employees."
    "The employer consents on the company's behalf",
    // Card note: "To an amendment of your own contract, and nobody else's."
    "She can consent only to amendments of her own contract",
    // The field's own hint says "(from a submission result)".
    "Paste the amendment id from a submission or a consent",
    // Card note: "read-only, for the role signed in above".
    "Nothing on this card can approve, deny or change anything",
  ],
};

for (const [page, echoes] of Object.entries(REMOVED_ECHOES)) {
  test(`${page}: prose that was its own heading again does not come back`, () => {
    // Comments carry the record of WHY each was cut, so they are stripped
    // before the search — otherwise the explanation would fail the assertion.
    const rendered = corpus(page);
    for (const echo of echoes) {
      assert.ok(
        !rendered.includes(echo.replace(/\s+/g, " ")),
        `${PAGES[page]} still renders "${echo}" — the heading, a tile note, a ` +
          `column header or a field label on the same screen already says it.`
      );
    }
  });
}

// =============================================================================
// 2. What must survive any sweep
// =============================================================================
//
// The half that matters. Every string below states what a number MEANS, what an
// ABSENCE means, what the page CANNOT do, or what an operator should DO about
// it — and an operator is the reader who runs the script a remedy names. None
// of these is redundant with a heading, and cutting one would turn a surface
// somebody acts on into one nobody can trust.
//
// Pinned as substrings of the rendered page rather than as whole sentences, so
// wording stays editable and the STATEMENT is what is required to exist.

const MUST_SURVIVE = {
  "approval queue": [
    // An absent group is not "we found none" — the distinction the whole
    // stuck list is read through.
    ['"none found"', "an absent stuck group means no items, not 'none found'"],
    // Why a team is listed on a quiet hour at all.
    ["standing hole", "a team with no Zendesk group is a standing hole"],
    // The tiles: what each number counts, and the third one especially.
    ["no reachable place to be approved", "what the stuck count counts"],
    ["counted as neither", "'cannot tell' is neither reachable nor stuck"],
    ["records read across all nine use cases", "the waiting count's denominator"],
    // Two kinds of absence, which a single boolean would have merged.
    ["which of the two kinds of absence", "by-design vs. missing approval control"],
    // What the page itself cannot do.
    ["no POST route", "the queue is read-only by construction"],
  ],
  "audit viewer": [
    // A genuine duplicate call vs. the retry wrapper's own bookkeeping.
    ["clean 1..n sequence", "duplicate call vs. retry sequence"],
    // The boundary of a search: "not here" is not "not looked for".
    ["does not rule these out", "where the lookup did NOT look"],
    // The one question the alerts table exists to answer.
    ["lost a decision, or", "audit_durable: lost a decision or only a Zendesk update"],
    // What the wide columns mean before a reader scrolls to them.
    ["is the record id its sibling rows share", "what the Group column is"],
    // Fabricated rows must never read as production history.
    ["not production history", "the seeded-mode banner"],
    ["no POST route", "the viewer is read-only by construction"],
  ],
  dashboard: [
    // An unreachable section is stated, never blanked.
    ["says so plainly instead of showing", "a section whose API is down says so"],
    // The remedy, naming the command — this reader runs it.
    ["npm run uc0N-api", "how to start the API a section needs"],
    // Where the numbers come from.
    ["polls its own real list endpoint", "the data is fetched live, not cached"],
  ],
  playground: [
    ["real classifier, identity check and policy gates", "the decision is the real one"],
    ["nothing here reaches Supabase or a real Zendesk ticket", "the in-memory boundary"],
  ],
  "chat demo": [
    ["never writes to Supabase and never touches a", "the in-memory boundary"],
    ["not a submission deliverable", "what this surface is and is not"],
  ],
  "live demo": [
    // The one surface in the repo that writes to a real external account.
    ["This touches a real Zendesk account", "the consequence of pressing send"],
    ["nothing is undone afterwards", "it cannot be rolled back"],
  ],
  "remote UI stand-in": [
    ["This is a stand-in, not Remote's real platform", "the honesty disclosure"],
    // Rewritten 2026-09-02: the old sentence claimed the amendment API "has no
    // public API", which DRIFT-031 records as false — POST /v1/contract-
    // amendments exists. The surface is a demonstration stand-in, and says so.
    ["demonstration stand-in", "why this surface exists at all"],
    // Which identity you are signed in as — the form's ids must belong to it.
    // The NAME is no longer a literal in the HTML (it drifted: the markup said
    // Amara Okafor while the server signed in Jan Willem Bakker); app.js
    // renders the server's own answer under this caption.
    ["The employee session is", "who the employee session is"],
    ["only amendments your signed-in role is party to", "why a valid id can return nothing"],
    ["refused server-side", "the role matrix is not a client-side claim"],
  ],
};

for (const [page, required] of Object.entries(MUST_SURVIVE)) {
  test(`${page}: every statement of meaning, absence, limit and remedy is still on the page`, () => {
    const rendered = corpus(page);
    for (const [needle, why] of required) {
      assert.ok(
        rendered.includes(needle.replace(/\s+/g, " ")),
        `${PAGES[page]} no longer states: ${why} (looked for "${needle}"). ` +
          `Trimming an operator surface may remove a heading said twice; it may ` +
          `not remove what a number means, what an absence means, what the page ` +
          `cannot do, or what to do about it.`
      );
    }
  });
}

// =============================================================================
// 3. No empty shells
// =============================================================================

test("no operator page carries a heading followed by an empty paragraph", () => {
  // Cutting a sub-heading means deleting the element, not blanking it: an empty
  // <p> renders as a gap the next editor fills back in with the heading again.
  // (Elements app.js fills at runtime are exempt — they carry an id.)
  for (const [page, path] of Object.entries(PAGES)) {
    const html = read(path);
    const empty = [...html.matchAll(/<p class="(?:r-page-sub|r-card-note|path-intro)"\s*>\s*<\/p>/g)];
    assert.deepEqual(
      empty.map((m) => m[0]),
      [],
      `${page} (${path}) has an empty prose element — delete the element instead.`
    );
  }
});
