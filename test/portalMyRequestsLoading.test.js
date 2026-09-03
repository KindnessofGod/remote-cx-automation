// ---------------------------------------------------------------------------
// portalMyRequestsLoading.test.js — an empty table is an ANSWER, and it was the
// wrong one
// ---------------------------------------------------------------------------
// Reported 2026-09-02 by an employee driving the live deployment as themselves:
//
//   "I opened it right after filing three things. Empty table. Just column
//    headers. No loading, no error, nothing. I genuinely concluded my requests
//    had been lost, and switched personas to check whether I'd filed as the
//    wrong person."
//
// Measured: 21 seconds and 118 KB for an account with 93 records, against a
// 4-second poll — 19 requests issued and 9 answers received in 75 seconds, each
// racing the others into the same tbody.
//
// TWO DEFECTS, ONE EXPERIENCE.
//
// (1) The "Reading each record's current state…" line exists, and it is the
//     line UNDER the table. This table scrolls sideways and is tall, so on a
//     real account the only "loading" word on the page is below the fold while
//     the reader stares at an empty tbody. An empty tbody is indistinguishable
//     from an answer — and every result screen in the portal ends by sending
//     the reader to this page, so "you have nothing" is the hand-off story
//     collapsing at the last step.
//
// (2) The poll overtook the read it was polling, so rows appeared, vanished and
//     reappeared as an older, slower response landed after a newer one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");

function bodyOf(name) {
  const start = APP.indexOf("function " + name + "(");
  assert.ok(start > 0, `${name}() has been renamed`);
  const end = APP.indexOf("\n  function ", start + 10);
  return APP.slice(start, end === -1 ? APP.length : end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("an explicit load puts the loading state IN the table, not only under it", () => {
  const body = bodyOf("loadMyRequests");
  assert.match(body, /rows\.appendChild\(loadingRow\(\)\)/, "the tbody is left empty while the read is in flight");
  // The note under the table is kept as well — this adds, it does not move.
  assert.match(body, /setMyRequestsNote\("Reading each record's current state/);
});

test("the loading row spans the table by READING the header, never a literal", () => {
  const body = bodyOf("loadingRow");
  assert.match(body, /querySelectorAll\("#my-requests th"\)/, "the column count is hard-coded");
  assert.match(body, /colSpan = head\.length/);
  // A literal column count is a second copy of a fact the header already holds,
  // and it stops spanning the day somebody adds a column.
  assert.doesNotMatch(body, /colSpan = \d+/, "a literal column count crept back in");
});

test("a POLL defers while a read is in flight; an explicit load never does", () => {
  const body = bodyOf("loadMyRequests");
  assert.match(body, /if \(quiet && myRequestsInFlight\) return;/, "the poll can still overtake the read it polls");

  // The asymmetry is the rule: pressing "Check now" is a person asking, and a
  // control that silently declines to act is worse than a slow one.
  const guard = body.indexOf("quiet && myRequestsInFlight");
  assert.ok(guard > 0);
  assert.doesNotMatch(
    body.slice(0, guard),
    /if \(myRequestsInFlight\) return/,
    "an explicit load is being skipped too — the button would silently do nothing"
  );
});

test("the in-flight flag is cleared on EVERY settle path, including failure", () => {
  const body = bodyOf("loadMyRequests");
  const clears = (body.match(/myRequestsInFlight = false/g) || []).length;
  assert.ok(clears >= 2, `the flag is cleared on ${clears} path(s); success and failure both need it`);

  // A flag left set by a failed read silences the poller permanently — one
  // transient error becoming a page that never refreshes again and never says
  // why. Assert the failure path clears it BEFORE its early return.
  const cat = body.indexOf(".catch(");
  const clearInCatch = body.indexOf("myRequestsInFlight = false", cat);
  const earlyReturn = body.indexOf("return;", cat);
  assert.ok(cat > 0 && clearInCatch > cat && clearInCatch < earlyReturn,
    "the failure path returns before clearing the flag — the poller would stop for good");
});
