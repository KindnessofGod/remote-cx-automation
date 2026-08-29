// ---------------------------------------------------------------------------
// zafUc03LetterOffer.test.js  —  the offer a specialist READS and cannot take
// ---------------------------------------------------------------------------
// TWO SEPARATE THINGS ARE PINNED HERE, and they pull in opposite directions.
//
// 1. THE SIDEBAR STOPPED DECIDING ACTIONABILITY FOR UC-03. `loadUc03` used to
//    hard-code `actionable: false` with a sentence explaining that
//    src/uc03/server.js had no POST route at all — true when it was written,
//    and false from the moment the travel-letter sign-off landed there. It was
//    the ONE loader of nine answering that question in the browser, which is
//    the rule main.js's own header calls rule 2, and it failed in the direction
//    that HIDES work: a drafted letter sat waiting for a signature this panel
//    had decided locally could not be given. The API answers `actionable` and
//    `actionableReason`; the loader now reads them.
//
// 2. THE LETTER OFFER IS RENDERED HERE AND IS NOT A CONTROL HERE. UC-03's
//    auto-resolved answer offers the employee the formal letter
//    (src/uc03/letterOffer.js). A specialist should SEE that — "have they been
//    told, and have they asked?" is otherwise guesswork — but must not be given
//    a button for it, because accepting needs the TRAVELLER's own authenticated
//    session. `POST /api/cases/:id/request-letter` refuses without one
//    (`session_required`) and refuses anybody else's (`not_the_traveller`),
//    prime directive #3. A ZAF token is minted by Zendesk for the AGENT, so a
//    control offered here could not work for the person looking at it — and a
//    control that cannot work is worse than no control, because it reads as
//    something the specialist has failed to use.
//
// ASSERTED ON THE SOURCE, like every other check in test/zafApp.test.js: npm
// test never imports a browser asset, so a control added here would ship into a
// live Zendesk account with nothing failing on this machine.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "zaf-app", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

/** Block comments first, so a `//` inside one is not read as a line comment. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** One `function NAME(...) { ... }` body, by brace depth, comments stripped. */
function functionBody(source, name) {
  const code = stripComments(source);
  const start = code.indexOf("function " + name + "(");
  assert.ok(start !== -1, name + " is missing from the asset");
  const open = code.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return code.slice(open, i + 1);
}

// ---------------------------------------------------------------------------
// 1. Actionability is the server's answer, for all nine
// ---------------------------------------------------------------------------

test("loadUc03 reads actionable off the response instead of deciding it here", () => {
  const body = functionBody(read("main.js"), "loadUc03");

  assert.match(body, /actionable: data\.actionable === true/);
  assert.match(body, /actionableReason: data\.actionableReason/);
  // The old constant, and the sentence that went with it. Both were true once,
  // which is exactly why their return would be silent.
  assert.ok(!/actionable: false/.test(body), "UC-03's actionability must not be a constant in the browser again");
  assert.ok(
    !/there is no write route/i.test(body),
    "the claim that UC-03 has no write route outlived its truth once already"
  );
});

test("no loader decides actionability in the browser", () => {
  // The general form of the same rule, now true of all nine. UC-03 was the last
  // holdout; UC-07's and UC-08's APIs genuinely have no POST route in the file
  // at all — the 🔴 structural guarantee both use cases are argued from — and
  // they still answer `actionable: false` themselves rather than leaving the
  // browser to conclude it. A constant here would be the shell holding a copy
  // of a claim the server is the author of, which is how the two could ever
  // come to disagree.
  const loaders = [
    "loadUc01", "loadUc02", "loadUc03", "loadUc04", "loadUc05",
    "loadUc06", "loadUc07", "loadUc08", "loadUc09",
  ];
  for (const loader of loaders) {
    const body = functionBody(read("main.js"), loader);
    assert.ok(
      !/actionable:\s*(true|false)\b/.test(body),
      loader + " decides actionability in the browser — the API answers that question"
    );
  }
});

test("UC-03 posts to its own sign-off routes and to no accept route", () => {
  const body = functionBody(read("main.js"), "loadUc03");

  // The sign-off exists, addressed by case id, with the action supplied by the
  // panel — the only place UC-03's verbs are named in the browser.
  assert.match(body, /view\.post = function \(action, body\)/);
  assert.match(body, /"\/api\/cases\/" \+ encodeURIComponent\(row\.id\) \+ "\/" \+ action/);

  // AND NO ACCEPT ROUTE, ANYWHERE IN THE BUNDLE. This is the load-bearing one:
  // the offer's accept path is the traveller's, and a sidebar that knew the URL
  // would be one edit away from putting a button on it.
  const main = stripComments(read("main.js"));
  const panels = stripComments(read("panels.js"));
  assert.ok(!/request-letter/.test(main), "main.js must not name the accept route");
  assert.ok(!/request-letter/.test(panels), "panels.js must not name the accept route");
});

// ---------------------------------------------------------------------------
// 2. The offer renders, read-only, and only when the server says it is open
// ---------------------------------------------------------------------------

test("the offer is rendered from the server's own field and only when it is open", () => {
  const body = functionBody(read("main.js"), "renderLetterOffer");

  assert.match(body, /view\.letterOffer/);
  // `offered !== true` -> null. A case with no offer renders no block at all,
  // rather than a box explaining an absence on eight panels out of nine.
  assert.match(body, /offer\.offered !== true/);
  assert.match(body, /return null/);

  // The trip the letter would certify, so a specialist reads the same three
  // values the employee was shown.
  for (const field of ["destinationCountry", "startDate", "endDate"]) {
    assert.ok(body.includes("carries." + field), "the block never renders carries." + field);
  }

  // And it is actually on the page — a renderer nothing calls is the same
  // defect as an offer nothing renders, one layer down.
  assert.match(stripComments(read("main.js")), /var offered = renderLetterOffer\(view\);/);
});

test("the offer block contains no control of any kind", () => {
  const body = functionBody(read("main.js"), "renderLetterOffer");

  // STRUCTURAL, in UC-08's sense: not a control that refuses at runtime, but no
  // code that could be one. A button, a handler, or a call to view.post are the
  // three ways a control gets built in this file, and none of them is here.
  assert.ok(!/"button"/.test(body), "the offer block must build no button");
  assert.ok(!/addEventListener/.test(body), "the offer block must bind no handler");
  assert.ok(!/view\.post|cxPost|cxRequest/.test(body), "the offer block must post nothing");
  assert.ok(!/innerHTML/.test(body), "a ticket's text is untrusted — textContent only");

  // AND IT SAYS SO. "There is no button" is indistinguishable from "the button
  // has not loaded" unless the page says which, and the two send a specialist
  // to do completely different things.
  const prose = functionBody(read("main.js"), "renderLetterOffer");
  assert.match(prose, /no control for it on this screen/i);

  // WHOSE OFFER IT IS, SAID ONCE. This used to be pinned twice over: the
  // heading, and a sentence under it opening "This is the employee's to accept,
  // not yours" — the heading negated. The heading is the claim; the sentence
  // kept only the part a heading cannot make, which is the assertion above.
  assert.match(prose, /"Offered to the employee"/);
  assert.ok(
    !/not yours/i.test(prose),
    "the heading already says whose offer this is — a sentence restating it is the thing that was removed"
  );
});

test("the offer sits below the controls, never among them", () => {
  const main = stripComments(read("main.js"));
  const actions = main.indexOf("root.appendChild(renderActions(view, ticketId, currentUser));");
  const offer = main.indexOf("var offered = renderLetterOffer(view);");
  assert.ok(actions !== -1 && offer !== -1);
  assert.ok(
    offer > actions,
    "the offer must render AFTER the decision card — it is not one of that card's controls and must not read as one"
  );

  // renderActions is where every control in this shell is built, and the offer
  // is not built there.
  assert.ok(
    !functionBody(main, "renderActions").includes("letterOffer"),
    "the offer must never be rendered inside the controls card"
  );
});
