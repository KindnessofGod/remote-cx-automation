// ---------------------------------------------------------------------------
// portalDecisionDialog.test.js — the portal announces a decision, once.
//
// WHY THIS IS SOURCE-READING RATHER THAN BEHAVIOURAL. `zaf-app` and this
// portal share the constraint recorded in CLAUDE.md §6: browser assets are
// never imported by `npm test`, so a syntax error or a dropped guard ships
// while the suite stays green. test/portal.test.js already compiles this file
// and forbids `innerHTML`; these are the properties of the announcement that
// are worth the same treatment, because each one is a real failure mode:
//
//   - announcing on the FIRST read would greet a returning requester with a
//     dialog per decision made while they were away
//   - announcing more than once would re-open on every 4-second poll
//   - re-deriving "is this finished?" from a status string would put a second
//     opinion about finality in the browser, which is the whole thing the
//     portal's read-only boundary exists to prevent
//
// THREE MORE WERE ADDED 2026-09-03, ALL THREE FROM ONE REPORT. The owner
// opened the deployment and was met with a dialog per already-decided request,
// each needing its own Close, each looking unstyled:
//
//   - a seen-set shared across personas announces the NEXT person's history in
//     full the moment the picker moves (the flood)
//   - a queue that shows N decisions as N dialogs cannot be told from one that
//     will not stop (the clicking)
//   - a dialog naming CSS classes no stylesheet defines renders as a raw
//     browser control on a styled page, and nothing in the suite could see it,
//     because a class name is a string (the ugliness)
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");
const PORTAL_CSS = readFileSync(new URL("../src/portal/assets/style.css", import.meta.url), "utf8");
const SHARED_CSS = readFileSync(new URL("../src/shared/ui/remote-ui.css", import.meta.url), "utf8");
const CSS = PORTAL_CSS + "\n" + SHARED_CSS;

/**
 * Comments stripped, for the assertions that forbid a pattern.
 *
 * Both "must not appear" checks below failed on their first run against the
 * COMMENTS that explain why the pattern is forbidden -- the header of
 * noteDecisions() names `status.state === "declined"` as the thing it refuses
 * to do, and showDecision()'s names "Approved"/"Declined" as the words it
 * refuses to spell. A guard that cannot tell a prohibition from its own
 * rationale would push the next author into deleting the explanation to get
 * the suite green, which is the opposite of what it is for.
 */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

test("the announcement exists and is a real <dialog>", () => {
  assert.match(APP, /function showDecisions\(/, "no decision dialog");
  assert.match(APP, /el\("dialog", "interstitial-dialog decision-dialog"\)/);
  // The browser owns focus trapping, Escape and the inert background. A
  // hand-rolled overlay gets all three subtly wrong -- the same reasoning the
  // letter dialog records.
  assert.match(APP, /dialog\.showModal\(\)/);
  assert.match(APP, /aria-labelledby/);
});

test("the FIRST read for a persona seeds without announcing", () => {
  // A returning requester with twenty settled requests must get zero dialogs.
  assert.match(APP, /var seenSettled = \{\}/, "the seed store is gone");
  assert.match(
    APP,
    /if \(!seenSettled\[persona\]\) \{[\s\S]{0,200}seenSettled\[persona\] = settledNow;[\s\S]{0,40}return;/,
    "the first read for a persona must seed and return before anything is queued"
  );
});

test("THE SEEN-SET IS PER PERSONA — switching persona seeds, it does not announce", () => {
  // THE BUG THIS PINS. One set for the page meant that switching persona
  // replaced the whole list with someone else's, matched nothing in the set,
  // and announced every one of the new persona's already-decided requests. A
  // quick-fill scenario moves the persona too, so it fired on the intake form
  // as well. Observed on the deployment against decisions up to three days old.
  const fn = code(APP).slice(code(APP).indexOf("function noteDecisions("), code(APP).indexOf("function drainAnnouncements("));
  assert.match(fn, /function noteDecisions\(requests, persona\)/, "noteDecisions does not take the persona");
  assert.match(fn, /if \(!persona\) return;/, "a read with no persona is compared against somebody's set");
  // Every read of the set must be keyed. An unkeyed `seenSettled[key]` here is
  // the original defect returning.
  const unkeyed = fn.match(/seenSettled\[(?!persona\])/g) || [];
  assert.equal(unkeyed.length, 0, "the seen-set is read without a persona key");
});

test("the persona is the one the read was made FOR, captured before it is issued", () => {
  // The read was measured at 21 seconds on a real account — long enough to
  // change persona while it is in flight. Reading the picker when the answer
  // lands compares A's rows against B's set, which is the same bug through a
  // smaller door.
  for (const [what, region] of [
    ["the background watch", APP.slice(APP.indexOf("function startDecisionWatch("), APP.indexOf("function startPolling("))],
    ["loadMyRequests", APP.slice(APP.indexOf("function loadMyRequests("), APP.indexOf("function renderMyRequests("))],
  ]) {
    assert.match(region, /var askedFor = /, `${what} does not capture the persona before the read`);
    assert.match(region, /noteDecisions\(payload\.requests \|\| \[\], askedFor\)/, `${what} does not hand the persona to noteDecisions`);
    assert.doesNotMatch(
      region,
      /noteDecisions\([^)]*byId\("persona"\)/,
      `${what} reads the picker when the answer lands instead of using the persona it asked for`
    );
  }
});

test("finality is read from the server's flag, never re-derived from a status string", () => {
  assert.match(APP, /request\.settled !== true/, "settled is not read from the server's own flag");
  // The failure this forbids: a browser-side list of which states count as
  // finished, which would drift from src/portal/requestStatus.js the first
  // time a state is added there.
  const noteDecisions = code(APP).slice(code(APP).indexOf("function noteDecisions("), code(APP).indexOf("function drainAnnouncements("));
  assert.doesNotMatch(
    noteDecisions,
    /status\.state\s*===/,
    "noteDecisions() decides finality from a status string instead of `settled`"
  );
});

test("a decision is announced once, not on every poll", () => {
  assert.match(APP, /seenSettled\[persona\]\[key2\] = true/, "seen keys are not carried forward");
  assert.match(APP, /seenSettled\[persona\] && !seenSettled\[persona\]\[key\]/, "freshness is not measured against the seen set");
});

test("MANY DECISIONS ARE ONE DIALOG WITH ONE CLOSE, never one dialog each", () => {
  // Changed 2026-09-03: it used to open the next as each was closed, so three
  // decisions meant three dismissals and the reader could not tell a queue
  // three long from one that would not stop.
  assert.match(APP, /var announceQueue = \[\]/);
  assert.match(APP, /if \(announcing \|\| !announceQueue\.length\) return;/);
  assert.match(
    APP,
    /showDecisions\(announceQueue\.splice\(0, announceQueue\.length\)\)/,
    "the queue is not drained whole into one dialog"
  );
  // The close handler must drain, or a decision that arrived while the dialog
  // was open is lost silently.
  assert.match(APP, /announcing = false;[\s\S]{0,200}drainAnnouncements\(\);/);
  // ONE close button, however many decisions.
  const fn = code(APP).slice(code(APP).indexOf("function showDecisions("), code(APP).indexOf("function startDecisionWatch("));
  assert.equal((fn.match(/el\("button"/g) || []).length, 1, "the dialog builds more than one button");
});

test("a fact the server's own sentence already carries is not printed again", () => {
  // The screenshot that prompted this said "Approved by: admin_jane … Note
  // left: <note>" in the sentence, then repeated the note under "They added:",
  // then the decider and time again under "Decided by" — in a second time
  // zone, so one decision read as three.
  const fn = code(APP).slice(code(APP).indexOf("function decisionBlock("), code(APP).indexOf("function showDecisions("));
  assert.match(fn, /!alreadySaid\(sentence, status\.note\)/, "the note is repeated when the sentence already quotes it");
  assert.match(fn, /!alreadySaid\(sentence, status\.decidedBy\)/, "the decider is repeated when the sentence already names them");
  // A CONTAINMENT TEST, NEVER A SPELLING ONE. Matching on wording would make
  // this a second opinion about what the server said; asking whether the
  // sentence contains the server's own field cannot be wrong about the wording,
  // and its failure mode is a repeat rather than a fact going missing.
  const helper = code(APP).slice(code(APP).indexOf("function alreadySaid("), code(APP).indexOf("function decisionBlock("));
  assert.match(helper, /indexOf\(value\) !== -1/, "alreadySaid does not test containment");
  assert.doesNotMatch(helper, /Approved|Declined|Note left/, "alreadySaid matches on wording instead of on the field");
});

test("the dialog draws the decision through the TABLE's renderer, not a second one", () => {
  // The server publishes a settled decision twice: as labelled facts
  // (`resolutionFacts`) and as one paragraph (`resolution`). The table draws
  // the facts — resolutionBlock() was written when the owner asked "why all
  // this story" of a prose approval — and the dialog was still drawing the
  // paragraph, which is what made it a wall of text. A second renderer here
  // would be free to drift from the table it must agree with, on the same row,
  // for the same reader.
  const fn = code(APP).slice(code(APP).indexOf("function decisionBlock("), code(APP).indexOf("function showDecisions("));
  assert.match(fn, /resolutionBlock\(request\)/, "the dialog does not use the table's renderer");
  assert.doesNotMatch(fn, /resolution-fact|resolution-label|resolution-value/, "the dialog re-implements the fact rendering");
  // settledFactsFor() drops who/when/note because the TABLE has a column for
  // each. The dialog has no columns, so it must print them itself — dropping
  // them in both places would lose the decider's name entirely.
  assert.match(fn, /status\.decidedBy/, "the dialog never names the decider");
  assert.match(fn, /status\.note/, "the dialog never shows the note");
  // The dedupe applies to the PARAGRAPH path only: nothing is repeated when
  // fields were drawn, because settledFactsFor() already removed those three.
  assert.match(fn, /var sentence = asFields \? "" :/, "the dedupe compares against a paragraph that was not drawn");
});

test("the fact styling reaches the dialog, not only the table", () => {
  // Every one of these rules was scoped to `.my-requests-table`. Reusing the
  // renderer without widening them would have drawn the fields unstyled — the
  // same defect as the missing button class, one layer along.
  for (const cls of ["resolution-headline", "resolution-fact", "resolution-label", "resolution-value", "resolution-finality"]) {
    assert.match(PORTAL_CSS, new RegExp("\\.decision-item \\." + cls + "[\\s,{]"), `.${cls} is not styled inside the dialog`);
  }
});

test("every CSS class the dialog names is defined in a stylesheet", () => {
  // THE GUARD THAT WOULD HAVE CAUGHT THE UGLINESS. This dialog asked for
  // `interstitial-actions` and `r-button`. Neither exists in any stylesheet —
  // every other dialog in the portal uses `interstitial-buttons` and `r-btn` —
  // so the button row had no layout and Close was a raw browser control on a
  // styled page. A class name is a string: nothing else in the suite can see it.
  //
  // HOOKS ARE EXEMPT AND NAMED. Two classes carry no rules on purpose: they are
  // how JavaScript finds the dialog again. Listing them here is what keeps this
  // check strict — a new unstyled class has to be argued for, not absorbed.
  const HOOKS = new Set(["decision-dialog", "decision-panel"]);
  const region = APP.slice(APP.indexOf("function decisionBlock("), APP.indexOf("function startDecisionWatch("));
  const used = new Set();
  for (const m of region.matchAll(/el\("[a-z0-9]+", "([a-z0-9 -]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) used.add(cls);
  }
  assert.ok(used.size >= 6, `only ${used.size} classes found — the scan missed the dialog`);
  const undefinedClasses = [...used].filter((c) => !HOOKS.has(c) && !new RegExp("\\." + c + "[\\s,{:.>]").test(CSS));
  assert.deepEqual(undefinedClasses, [], `classes with no rule anywhere: ${undefinedClasses.join(", ")}`);
});

test("the heading's programmatic focus ring is suppressed, and only the heading's", () => {
  // showDecisions() focuses the heading so a screen reader starts at the top of
  // the announcement. Chrome draws its ring on that, which put a heavy black
  // box around the title. Dropping it is safe for a tabindex="-1" heading and
  // is NOT safe for a control, so the rule must name the heading.
  assert.match(PORTAL_CSS, /\.interstitial-title:focus \{ outline: none; \}/);
  assert.doesNotMatch(PORTAL_CSS, /\.interstitial-panel:focus-within \{[^}]*outline: none/, "a focus ring is suppressed for real controls");
});

test("the dialog prints the SERVER's verdict words, composing none of its own", () => {
  const dialog = code(APP).slice(code(APP).indexOf("function decisionBlock("), code(APP).indexOf("function startDecisionWatch("));
  assert.match(dialog, /status\.label/, "the heading is not the server's label");
  assert.match(dialog, /request\.resolution/, "the server's resolution sentence is not used");
  // The two verdict words must not be spelled in the browser at all: that is
  // how a page comes to say "Approved" about a record that says something else.
  assert.doesNotMatch(dialog, /"Approved"|"Declined"/, "a verdict word is hard-coded in the browser");
});

test("the background watch announces without rendering, and stands down for the table's own poll", () => {
  const watch = APP.slice(APP.indexOf("function startDecisionWatch("), APP.indexOf("function startPolling("));
  assert.match(watch, /noteDecisions\(payload\.requests \|\| \[\], askedFor\)/);
  assert.doesNotMatch(watch, /renderMyRequests\(/, "the watch renders the table, racing the visible poll");
  assert.match(watch, /if \(card && !card\.hidden\) return;/, "the watch does not stand down when the table is visible");
  assert.match(watch, /if \(!persona \|\| !persona\.value\) return;/, "the watch polls with no persona");
});

test("the watch is slower than the table poll — it runs all session", () => {
  const table = Number(/var POLL_MS = (\d+)/.exec(APP)[1]);
  const watch = Number(/var DECISION_WATCH_MS = (\d+)/.exec(APP)[1]);
  assert.ok(watch > table, `background watch (${watch}ms) must be slower than the table poll (${table}ms)`);
  assert.ok(watch >= 10000, "a background check faster than 10s costs a serverless invocation for nothing");
});

test("noteDecisions runs BEFORE the table is redrawn", () => {
  const i = APP.indexOf("noteDecisions(payload.requests || [], askedFor);\n        renderMyRequests(");
  assert.ok(i > 0, "the comparison must happen against what the reader was last shown");
});
