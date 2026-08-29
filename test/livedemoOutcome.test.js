// ---------------------------------------------------------------------------
// livedemoOutcome.test.js — what the live demo page says happened, and when it
//                           stops watching for it
// ---------------------------------------------------------------------------
// REPORTED 2026-08-28, after approving a real ticket in Zendesk: "it is meant to
// show on this page, approved and now download."
//
// Two separate defects sat behind that sentence and only one of them was
// cosmetic.
//
// 1. THE PAGE NEVER LOOKED AGAIN. `poll()` stopped as soon as ANY of
//    OUTCOME_TAGS appeared on the ticket, and `uc01_human_review` is one of
//    them. So the moment the automation handed a ticket to a person — the ONLY
//    case in which somebody then goes and does something in Zendesk — this page
//    stopped polling and froze on "Pending". The approval landed seconds later
//    and was never seen. It reads as the approval not working; nothing was
//    wrong with the approval.
//
// 2. THE PAGE NEVER SAID IT. Even once polling was fixed, the panel rendered a
//    Zendesk status word and a row of tags, leaving a reader to work out from
//    `solved` plus a tag list whether a human had said yes — on the one surface
//    in this repo built to be watched by somebody who is NOT in Zendesk.
//
// The outcome is decided SERVER-SIDE (`describeOutcome()`), for the same reason
// `/api/context` owns the portal's copy of its rules: the browser holds no copy
// of a rule the server owns, because the copy is the thing that drifts.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createLiveDemoHandler } from "../src/livedemo/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(__dirname, "..", "src", "livedemo", "assets", "app.js"), "utf8");

const LETTER = "<!doctype html><html><body>Employment Verification Letter</body></html>";

/** Drive GET /api/status/:id against a fake ticket state. */
function statusFor({ status, tags, letter = false }) {
  const zendesk = {
    getTicket: async () => ({ id: 1, requester_id: 9, status, tags }),
    getTicketComments: async () =>
      letter ? [{ public: true, author_id: 1, html_body: LETTER }] : [],
  };
  const handler = createLiveDemoHandler({ zendesk, remote: {}, employmentIdFieldId: "1" });
  return new Promise((resolve) => {
    const req = {
      method: "GET",
      url: "/api/status/1",
      headers: {},
      on(event, cb) {
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    handler(req, { statusCode: 200, setHeader() {}, end: (p) => resolve(JSON.parse(p)) });
  });
}

// ---------------------------------------------------------------------------
// 1. The four things that can have happened, told apart
// ---------------------------------------------------------------------------

test("a specialist's approval is reported as an approval, not as 'solved'", async () => {
  // The reported case. `uc01_human_review` is REMOVED when a decision is
  // recorded (src/review/service.js), so an approved ticket looks like any other
  // solved one — except that it carries the letter a person authorised.
  const res = await statusFor({ status: "solved", tags: ["uc01", "queue_hr_ops"], letter: true });
  assert.equal(res.outcome.kind, "approved");
  assert.match(res.outcome.label, /Approved by a specialist/);
  assert.equal(res.outcome.letterAvailable, true);
});

test("an automatic resolution is never reported as somebody having approved it", async () => {
  // The distinction the whole demo turns on: "nobody touched this" and "a
  // person authorised this" are the two halves of the argument, and collapsing
  // them would claim a human control that never ran.
  const res = await statusFor({ status: "solved", tags: ["uc01", "uc01_auto_resolved"], letter: true });
  assert.equal(res.outcome.kind, "auto");
  assert.match(res.outcome.label, /automatically/i);
  assert.doesNotMatch(res.outcome.label, /specialist/i);
});

test("a decline is reported as a decline and offers no letter, even though the ticket may be solved", async () => {
  // ORDER MATTERS HERE. A declined ticket can also be solved and can also carry
  // an earlier public comment, so `verification_declined` is tested FIRST —
  // otherwise a refusal would render as an approval with a download button.
  const res = await statusFor({ status: "solved", tags: ["uc01", "verification_declined"], letter: true });
  assert.equal(res.outcome.kind, "declined");
  assert.equal(res.outcome.letterAvailable, false, "a declined request offered a letter to download");
});

test("a hand-off says a person has it, and offers nothing to download yet", async () => {
  const res = await statusFor({ status: "pending", tags: ["uc01", "uc01_human_review", "queue_hr_ops"] });
  assert.equal(res.outcome.kind, "waiting");
  assert.equal(res.outcome.letterAvailable, false);
});

test("a ticket still being processed is not reported as any outcome at all", async () => {
  const res = await statusFor({ status: "open", tags: ["uc01"] });
  assert.equal(res.outcome.kind, "pending");
});

// ---------------------------------------------------------------------------
// 2. The polling bug — the one that made the approval invisible
// ---------------------------------------------------------------------------

test("a hand-off is NOT terminal, so the page keeps watching for the decision", () => {
  // Asserted against the browser file itself, because this is the only place
  // the rule lives and it is the exact rule that was wrong. `waiting` and
  // `pending` must be absent from the terminal set: they are the two states in
  // which something is still going to happen.
  const match = appJs.match(/var TERMINAL_OUTCOMES\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, "TERMINAL_OUTCOMES has moved — re-point this test");
  const terminal = match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  assert.deepEqual(terminal.sort(), ["approved", "auto", "declined"]);
  assert.ok(!terminal.includes("waiting"), "the page stops watching the moment a person is asked — the reported bug");
  assert.ok(!terminal.includes("pending"), "the page stops watching while the workflow is still running");
});

test("the page stops polling on a tag list, never again", () => {
  // The old code read `OUTCOME_TAGS.some(...)` to decide it was finished, and
  // `uc01_human_review` was in that list. The tags are still rendered — they
  // are evidence a reader can check — but they must no longer DECIDE when to
  // stop looking.
  const pollBody = appJs.slice(appJs.indexOf("function poll("), appJs.indexOf("function renderWatchStopped("));
  assert.ok(
    !pollBody.includes("OUTCOME_TAGS"),
    "poll() decides it is finished from the tag list again, which is what froze the page on a hand-off"
  );
  assert.match(pollBody, /TERMINAL_OUTCOMES/, "poll() no longer consults the server's outcome");
});

test("giving up is visible, because a page that has stopped looks exactly like one that has not", () => {
  assert.match(appJs, /function renderWatchStopped\(/, "the page can now go quiet with nothing said");
  assert.match(appJs, /Check again/, "there is no way to resume the watch by hand");
  // Bounded rather than infinite, and slower once it is clearly a person's turn.
  assert.match(appJs, /var GIVE_UP_MS/);
  assert.match(appJs, /kind === "waiting" \? SLOW_MS : FAST_MS/);
});

// ---------------------------------------------------------------------------
// 3. The download
// ---------------------------------------------------------------------------

test("the letter download refuses when there is no letter, rather than serving an empty file", async () => {
  const zendesk = {
    getTicket: async () => ({ id: 1, requester_id: 9, status: "open", tags: [] }),
    getTicketComments: async () => [],
  };
  const handler = createLiveDemoHandler({ zendesk, remote: {}, employmentIdFieldId: "1" });
  const res = await new Promise((resolve) => {
    const req = {
      method: "GET",
      url: "/api/letter/1.pdf",
      headers: {},
      on(event, cb) {
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    let code = 200;
    handler(req, {
      set statusCode(v) {
        code = v;
      },
      get statusCode() {
        return code;
      },
      setHeader() {},
      end: (p) => resolve({ status: code, body: JSON.parse(p) }),
    });
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_letter_yet");
});

test("a missing PDF renderer degrades to the HTML download, and says so", () => {
  // The renderer needs headless Chromium. A machine without it must not turn a
  // perfectly good letter into a dead button — and a bare <a download> would
  // silently navigate to a JSON error page, which is the failure this guards.
  assert.match(
    readFileSync(join(__dirname, "..", "src", "livedemo", "server.js"), "utf8"),
    /pdf_unavailable/,
    "the server no longer distinguishes 'no renderer' from 'no letter'"
  );
  assert.match(appJs, /pdf_unavailable/, "the page does not handle a missing renderer");
  assert.match(appJs, /Download HTML/, "the fallback the reader is told to use does not exist");
});

// ---------------------------------------------------------------------------
// 4. The PDF is the letter, not Zendesk's rendering of it
// ---------------------------------------------------------------------------

test("the downloaded letter has no stray title line above the letterhead", () => {
  // `comment.html_body` is not the document we posted. Zendesk strips <html>,
  // <head> and <title> and KEEPS THEIR TEXT, then wraps the remainder in
  // `<div class="zd-comment">` — so the letter's own title survives as a bare
  // text node and prints as a stray "Employment Verification Letter" line above
  // the letterhead. Harmless in a ticket thread; wrong on a PDF somebody emails
  // to their bank.
  const source = readFileSync(join(__dirname, "..", "src", "livedemo", "server.js"), "utf8");
  const body = source.slice(source.indexOf("function letterHtmlFrom"), source.indexOf("\nfunction isPath"));
  const letterHtmlFrom = new Function(`${body}; return letterHtmlFrom;`)();

  const wrapped =
    '<div class="zd-comment" dir="auto">\n\n  Employment Verification Letter\n\n' +
    '  <div style="max-width: 720px;">Rempel-Paucek 4C3WAC … Employer of Record</div></div>';
  const cut = letterHtmlFrom(wrapped);
  assert.ok(cut.startsWith('<div style='), "the stray title line survives into the PDF");
  assert.match(cut, /Employer of Record/, "the cut removed part of the letter itself");

  // FALLS BACK TO THE WHOLE THING, both ways. A PDF with one stray line is a
  // blemish; a PDF missing the employer's name is a broken document, and this
  // function must not be able to produce the second while preventing the first.
  const noMarker = '<div class="zd-comment"> junk <div style="x">nothing recognisable</div>';
  assert.ok(noMarker === letterHtmlFrom(noMarker), "an unrecognised body was cut anyway");
  assert.equal(letterHtmlFrom("<p>plain</p>"), "<p>plain</p>", "a body that never matched was altered");
  assert.equal(letterHtmlFrom(null), null, "a non-string input was not passed through");
});
