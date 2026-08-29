// ---------------------------------------------------------------------------
// zafApp.test.js  —  The ZAF sidebar's static assets
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
// docs/BUILD-LOG.md records what duplicated, uncompiled code cost the n8n
// build: two escapes collapsed on deploy, nothing crashed, and every ticket
// silently routed to human review. Browser assets have the same shape of risk —
// they are never imported by `npm test`, so a syntax error in main.js ships,
// the sidebar renders nothing, and the suite stays green. The fix there was to
// compile every node body on every run; this is the same fix one language over.
//
// It also pins the two invariants zaf-app/README.md claims: the sidebar renders
// with textContent (never innerHTML), and it does not re-derive the approval
// policy in browser JavaScript.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..", "zaf-app");
const ASSETS = join(APP, "assets");

const read = (...parts) => readFileSync(join(...parts), "utf8");

/**
 * Source with comments removed, for assertions that COUNT code constructs.
 * Block comments go first so a `//` inside one cannot be mistaken for a line
 * comment; regex literals are left alone because `\/` is not `//`.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// AN AUTH REFUSAL IS NOT AN OUTAGE
// ---------------------------------------------------------------------------
// WHAT HAPPENED. A specialist opened a real escalation and the sidebar said
// "9 backing services are unreachable", listing nine HTTP 401s. Every one of
// those nine had answered — immediately, and with a precise
// `signed_identity_required` reason naming the setting to fix. The APIs were
// honest and the sidebar mistranslated them into an outage, which sends the
// reader to debug networking instead of ticking a box.
//
// The distinction is the whole value: "I cannot reach the service" is usually
// transient and worth retrying, "the service refused me" is a configuration
// fact that will still be true after any number of retries.

test("nine refusals render as an authentication problem, not nine outages", () => {
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");

  // The classifier exists and reads BOTH the status and the code — a ZAF
  // client.request rejection does not always carry a parseable body, so status
  // alone would miss cases and code alone would miss the rest.
  assert.match(main, /function isAuthRefusal\(status, code\)/);
  assert.match(main, /status === 401 \|\| status === 403/);

  // The status is actually carried out of the request layer. Before this, only
  // `err.message` survived, which is why the aggregate could not tell the two
  // apart even though every individual reply said so.
  assert.match(main, /cxStatus/);
  assert.match(main, /results\[i\] = \{ error: err\.message, status:/);

  // And the headline changes.
  assert.match(main, /not authenticated to the APIs/);
  // Naming the setting is the point — a title that says "not authenticated"
  // and stops there is no more actionable than "unreachable".
  assert.match(main, /cxSharedSecret/);
  assert.match(main, /ZAF_SHARED_SECRET/);
});

test("a 401 distinguishes a wrong secret from a bundle that never signed", () => {
  // THE FACT ONLY THE SENDER HAS. A deployed API refuses an unsigned read and a
  // wrongly-signed read with the same 401, and a ZAF client.request rejection
  // often carries no parseable body — so from the failure alone "the shared
  // secret does not match" and "this bundle never sent a token" look identical.
  // Their fixes are completely different: retype a setting, or re-upload the
  // app. Naming the wrong one costs an afternoon, and did: this account's
  // secret was correct all along, while its installed bundle had been uploaded
  // 32 minutes before read-signing existed in this file.
  //
  // An installed ZAF app is a STATIC UPLOAD. It does not track the repo and it
  // cannot know it is old. What it CAN know is whether it just signed.
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");

  assert.match(main, /var lastRequestWasSigned = false;/);
  // Set on the signed path and cleared on the unsigned fallback — one without
  // the other makes the flag lie in one direction forever.
  assert.match(main, /lastRequestWasSigned = true;/);
  assert.match(main, /lastRequestWasSigned = false;\n\s*var init = \{ method: method/);

  // Carried onto the recorded failure and aggregated.
  assert.match(main, /signed: lastRequestWasSigned/);
  assert.match(main, /anyRefusalWasSigned/);

  // Both branches exist and name DIFFERENT fixes.
  assert.match(main, /a request this app DID sign/);
  assert.match(main, /sent those requests UNSIGNED/);
  assert.match(main, /zcli apps:update/);
  // And the unsigned branch must say a secret cannot help, or a reader does the
  // useless thing anyway.
  assert.match(main, /no secret you save/);
});

test("one unreachable API among refusals is still reported as unreachable", () => {
  // The safety direction. `allErrorsAreAuth` starts true and is falsified by
  // the first non-auth failure, so the tidier headline is only claimed when it
  // is true of EVERY failure. A real outage hidden inside a configuration
  // message is exactly the kind of swallowed signal this repo keeps paying for.
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  assert.match(main, /var allErrorsAreAuth = true;/);
  assert.match(main, /if \(!isAuthRefusal\(r\.status, r\.code\)\) allErrorsAreAuth = false;/);
});

test("manifest is valid ZAF v2 and points at files that exist", () => {
  const manifest = JSON.parse(read(APP, "manifest.json"));

  assert.equal(manifest.frameworkVersion, "2.0");
  const sidebar = manifest.location.support.ticket_sidebar;
  assert.ok(sidebar, "the app must register a ticket_sidebar location");
  assert.ok(existsSync(join(APP, sidebar.url)), `${sidebar.url} is referenced but missing`);

  // The sidebar is useless without somewhere to call — a missing default here
  // means an installed app that silently talks to nothing.
  const apiParam = manifest.parameters.find((p) => p.name === "apiBaseUrl");
  assert.ok(apiParam, "apiBaseUrl must be a settable parameter");
  assert.equal(apiParam.required, true);
  assert.equal(apiParam.secure, false, "the API base URL is not a secret; real secrets stay server-side");
});

// A ZAF SECURE setting is never sent to the browser — that is the entire point
// of one. So `settings.cxSharedSecret` is permanently "" in the page, and the
// original switch, `settings.cxSharedSecret.trim() !== ""`, could never be
// true. The admin saved the secret, the app still concluded the signed path was
// unconfigured, and every approval went out unsigned to be refused 401 by a
// correctly-configured API. Confirmed against a live install: the value is
// stored, is not readable back, and is absent from the settings payload.
//
// Nothing could catch this from inside the bundle — no test can observe what
// Zendesk declines to send — so the guard is structural: the decision to sign
// must not be derived from the secret at all.
test("the signing switch never reads the secure setting, which the browser can never see", () => {
  const main = read(APP, "assets", "main.js");
  const fn = main.slice(main.indexOf("function signedRequestsConfigured"));
  const body = fn.slice(0, fn.indexOf("}") + 1);

  assert.doesNotMatch(
    body,
    /cxSharedSecret/,
    "signedRequestsConfigured() reads the secure setting; it is always empty in the browser"
  );
  assert.match(body, /signWrites/, "the switch should read the non-secure signWrites checkbox");

  // ...and the checkbox has to exist as a real, NON-secure setting, or the
  // admin has no way to turn signing on.
  const manifest = JSON.parse(read(APP, "manifest.json"));
  const sw = manifest.parameters.find((p) => p.name === "signWrites");
  assert.ok(sw, "manifest declares no signWrites setting");
  assert.equal(sw.secure, false, "signWrites must NOT be secure — the app has to read it");
  assert.equal(sw.type, "checkbox");

  // The secret itself must stay secure: it is only ever a {{setting.}}
  // placeholder that Zendesk substitutes server-side.
  const secret = manifest.parameters.find((p) => p.name === "cxSharedSecret");
  assert.equal(secret.secure, true);
  assert.match(main, /\{\{setting\.cxSharedSecret\}\}/, "the placeholder must still be used for signing");
});

// Approving set an inline "Approved." line and then, 900ms later, called
// load(), which rebuilds the panel from the server and destroys that line. The
// agent got a sub-second flash and then a panel that looked much as before —
// on the one control in this sidebar that authorises a real-world action. The
// confirmation has to outlive the re-read, so it is held outside the render.
test("a decision's confirmation survives the re-read that follows it", () => {
  const main = read(APP, "assets", "main.js");

  assert.match(main, /pendingFlash\s*=/, "no flash is set when a decision succeeds");
  assert.match(main, /function renderFlash\(/, "no renderer for it");

  // It must be rendered by render(), which is what runs after the reload — not
  // only by the click handler, which is the thing being destroyed.
  const render = main.slice(main.indexOf("function render(view"));
  assert.match(render.slice(0, 600), /renderFlash\(\)/, "render() never draws the flash");

  // Consumed exactly once, or a stale confirmation follows the agent onto the
  // next ticket and tells them something happened that did not.
  const fn = main.slice(main.indexOf("function renderFlash("));
  assert.match(fn.slice(0, 800), /pendingFlash = null/, "the flash is never cleared");

  // Announced, not just drawn: the buttons it replaces are gone from the DOM,
  // so a screen-reader user has nothing else telling them the click landed.
  assert.match(fn.slice(0, 800), /setAttribute\("role", "status"\)/);
});

test("translations parse and describe the app", () => {
  const en = JSON.parse(read(APP, "translations", "en.json"));
  assert.ok(en.app.name);
  assert.ok(en.app.short_description);
});

// Zendesk rejects an upload whose manifest declares a parameter the default
// locale does not label, and the rejection names one key at a time — so a
// six-parameter gap is six failed uploads, each looking like a new problem.
//
// This assertion used to read `assert.ok(en.app.parameters.apiBaseUrl)` under
// the comment "every manifest parameter needs a translation". The comment was
// the requirement; the assertion checked one parameter out of nine. Six were
// added later for UC-02/03/04/05/07/09 and none of them got a translation,
// which is precisely what the comment claimed was covered. A comment cannot
// fail; only the loop below can.
test("EVERY manifest parameter has a label and helpText in the default locale", () => {
  const manifest = JSON.parse(read(APP, "manifest.json"));
  const en = JSON.parse(read(APP, "translations", "en.json"));
  const translated = en.app.parameters || {};

  for (const param of manifest.parameters) {
    const t = translated[param.name];
    assert.ok(t, `manifest parameter "${param.name}" has no entry in translations/en.json`);
    assert.ok(t.label, `manifest parameter "${param.name}" has no label`);
    assert.ok(t.helpText, `manifest parameter "${param.name}" has no helpText`);
  }

  // ...and nothing translated that the manifest does not declare, which would
  // be a stale setting a reader could reasonably try to configure.
  for (const name of Object.keys(translated)) {
    assert.ok(
      manifest.parameters.some((p) => p.name === name),
      `translations/en.json labels "${name}", which the manifest does not declare`
    );
  }
});

test("the bundled design system is byte-identical to the shared original", () => {
  // A ZAF app ships as a self-contained zip that Zendesk serves, so unlike
  // every other surface in this repo the sidebar cannot fetch
  // src/shared/ui/remote-ui.css from one of our servers — it has to carry a
  // copy. A copy nobody checks is a copy that drifts, and the drift would be
  // invisible: the sidebar would simply start looking like a different
  // product from the dashboard, months later, with no error anywhere.
  //
  // Same reasoning as test/n8nParity.test.js, one asset type over: the
  // duplication is acknowledged and pinned rather than hoped about.
  const shared = readFileSync(join(__dirname, "..", "src", "shared", "ui", "remote-ui.css"), "utf8");
  const bundled = read(ASSETS, "remote-ui.css");
  assert.equal(
    bundled,
    shared,
    "zaf-app/assets/remote-ui.css has drifted from src/shared/ui/remote-ui.css — re-copy it"
  );
});

test("iframe.html loads exactly the assets that exist", () => {
  const html = read(ASSETS, "iframe.html");
  for (const asset of ["remote-ui.css", "style.css", "countryNames.js", "country.js", "panels.js", "main.js"]) {
    assert.ok(html.includes(asset), `iframe.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
  // panels.js defines the registry main.js reads on load, so order matters.
  assert.ok(html.indexOf("panels.js") < html.indexOf("main.js"), "panels.js must load before main.js");
  // The country map, then the one file that reads it, then both renderers.
  // Loaded the other way round the sidebar renders codes with nothing failing
  // anywhere — the quietest possible regression of the whole change.
  assert.ok(
    html.indexOf("countryNames.js") < html.indexOf('src="country.js"'),
    "countryNames.js must load before country.js, which reads it"
  );
  assert.ok(
    html.indexOf('src="country.js"') < html.indexOf("panels.js"),
    "country.js must load before the panels and the shell, which both name countries"
  );
  // Same for the stylesheets, for the opposite reason: style.css deliberately
  // overrides parts of the shared system for a ~320px column, so it has to
  // come second or the shared rules win and the sidebar renders at
  // full-page proportions inside a narrow iframe.
  assert.ok(
    html.indexOf("remote-ui.css") < html.indexOf('href="style.css"'),
    "remote-ui.css must load before style.css so the sidebar's overrides win"
  );
  assert.ok(html.includes("zaf_sdk"), "the ZAF SDK must be bootstrapped");
});

test("every browser script compiles — the n8n lesson, one language over", () => {
  for (const file of ["main.js", "panels.js", "country.js", "countryNames.js"]) {
    assert.doesNotThrow(
      () => new vm.Script(read(ASSETS, file), { filename: file }),
      `${file} does not parse — it would ship broken and the suite would stay green`
    );
  }
});

test("the sidebar never writes dynamic values with innerHTML", () => {
  // This screen renders content that originated in a support ticket, which is
  // untrusted text. Pinning the absence of innerHTML keeps that guarantee from
  // being given away by a future one-line 'quick fix'.
  for (const file of ["main.js", "panels.js", "country.js", "countryNames.js"]) {
    const source = read(ASSETS, file);
    assert.ok(!/\.innerHTML\s*=/.test(source), `${file} assigns innerHTML`);
    assert.ok(!/insertAdjacentHTML|document\.write/.test(source), `${file} injects raw markup`);
  }
});

test("the sidebar does not re-derive the approval policy in the browser", () => {
  // Whether the buttons appear must come from the API's `actionable` flag —
  // one copy of the rule, in src/review/reviewPolicy.js. A UI that branched on
  // the case's own decision/status fields would be the duplicated-gates bug.
  const main = read(ASSETS, "main.js");
  assert.ok(main.includes("view.actionable"), "the shell must read actionability from the API");
  assert.ok(
    !/decision\s*===\s*["']human_review["']/.test(main),
    "main.js branches on the raw decision — that is a second copy of the policy"
  );
});

test("the outcome badge prints the API's words and derives nothing of its own", () => {
  // WHAT THIS PROTECTS. The DECISION card now leads with a badge stating the
  // claim's outcome in Remote's own status vocabulary (APPROVED / DECLINED /
  // PENDING). The tempting implementation is three lines in the browser:
  // `status === "approved" ? ...`. That would be a second copy of a judgement
  // the server already makes, and it would get the two hard cases wrong —
  // a HELD claim is not decided, and a recorded approval whose Remote PATCH
  // never landed is not an approved expense. Both distinctions live in
  // describeOutcome() (src/uc02/reviewPolicy.js), server-side.
  const main = read(ASSETS, "main.js");

  assert.match(main, /function renderOutcomeBadge\(outcome\)/, "the badge renderer must exist");
  // It reads the server's fields...
  for (const field of ["outcome.label", "outcome.tone", "outcome.detail", "outcome.remoteStatus"]) {
    assert.ok(main.includes(field), `main.js must render ${field} from the API`);
  }
  // ...and never decides for itself what an outcome means.
  const code = stripComments(main);
  for (const pattern of [
    /status\s*===\s*["']approved["']/,
    /status\s*===\s*["']declined["']/,
    /status\s*===\s*["']held["']/,
    /\bremoteResult\b/,
  ]) {
    assert.ok(
      !pattern.test(code),
      `main.js derives the outcome itself (${pattern}) — that judgement belongs to describeOutcome()`
    );
  }

  // Colour is never the sole carrier: the label is appended as text on every
  // path, so the badge reads correctly in monochrome and to a screen reader.
  assert.match(main, /el\("span", "r-outcome-label", outcome\.label\)/);
});

test("the badge's tones use the STATE scale, never the chart series palette", () => {
  // --r-series-* is the metrics dashboard's categorical palette, tuned for
  // adjacent stacked-bar fills under CVD. Using it for status would put a
  // green "escalate" dot in this sidebar and a red one on the dashboard for
  // the same fact — the exact bug the decision badges above were already
  // fixed for. The state scale (--r-dot-settled/waiting/stopped) is the one
  // measured status palette.
  const css = read(ASSETS, "style.css");
  assert.match(css, /\.r-outcome\.tone-settled\s*\{[^}]*--r-dot-settled/);
  assert.match(css, /\.r-outcome\.tone-waiting\s*\{[^}]*--r-dot-waiting/);
  assert.match(css, /\.r-outcome\.tone-stopped\s*\{[^}]*--r-dot-stopped/);

  const outcomeBlock = css.slice(css.indexOf(".r-outcome"), css.indexOf("/* -- approval meter"));
  assert.ok(
    !/--r-series-/.test(outcomeBlock),
    "the outcome badge must not reach for the chart series palette"
  );
});

test("the UC-02 panel's positive verb is Approve, and the API still answers to the old one", () => {
  // The rename (2026-08-19): `release` was the outlier and Remote's own word
  // is `approved`. `decline` stays `decline` — that IS Remote's word
  // (DeclineExpenseParams / status `declined`), and later the same day the
  // rest of the sidebar came to it (see the next test).
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);

  const panels = read(ASSETS, "panels.js");
  assert.match(panels, /\{ action: "approve", label: "Approve", className: "approve" \}/);
  assert.match(panels, /\{ action: "decline", label: "Decline"/);
  assert.ok(
    !/action:\s*["']release["']/.test(stripComments(panels)),
    "the bundle must post the canonical verb; `release` survives only as a server-side input alias"
  );

  // The server-side alias is what lets this bundle and the API be deployed in
  // either order. Asserted against the API's own source, since a ZAF bundle
  // living in a Zendesk account cannot be redeployed atomically with it.
  const reviewPolicy = readFileSync(new URL("../src/uc02/reviewPolicy.js", import.meta.url), "utf8");
  assert.match(reviewPolicy, /ACTION_ALIASES = Object\.freeze\(\{ release: "approve" \}\)/);
});

test("the negative verb the bundle POSTS is `decline`, and the API still answers to `deny`", () => {
  // 2026-08-19. `deny` occurs ZERO times in Remote's documented corpus against
  // 648 of `decline`/`declined` (docs/REMOTE-VOCABULARY.md §2.1), so the
  // sidebar's own word moved for UC-01's review, UC-04, UC-05 and UC-06.
  //
  // ASSERTED ON THE SOURCE, because this is a browser bundle: npm test never
  // imports these files, and a wrong verb here is a button that 400s in a live
  // Zendesk account with nothing failing on this machine.
  const main = stripComments(read(ASSETS, "main.js"));
  const panels = stripComments(read(ASSETS, "panels.js"));

  assert.match(main, /submit\("decline"\)/, "UC-01's default pair must post the canonical verb");
  assert.ok(!/submit\("deny"\)/.test(main), "main.js must no longer post the old verb");

  // UC-06's dual-role block posts it too. UC-09's block is deliberately still
  // on `deny` — its server was not renamed — so `deny` is expected in panels.js
  // exactly once, and this pins the count rather than its absence.
  assert.equal((panels.match(/submit\("decline"\)/g) || []).length, 1, "UC-06's role block posts decline");
  assert.equal((panels.match(/submit\("deny"\)/g) || []).length, 1, "only UC-09 still posts deny");
  assert.match(panels, /declineLabel: "Decline"/, "UC-04 and UC-05 label the button Decline");
  assert.ok(!/denyLabel/.test(panels), "the old option name must be gone from every panel");

  // The server-side alias is what lets this bundle and the four APIs be
  // deployed in either order. Asserted against the API's own source, since a
  // ZAF bundle living in a Zendesk account cannot be redeployed atomically.
  const vocabulary = readFileSync(new URL("../src/shared/declineVocabulary.js", import.meta.url), "utf8");
  assert.match(vocabulary, /ACTION_ALIASES = Object\.freeze\(\{ deny: "decline" \}\)/);
  assert.match(vocabulary, /STATUS_ALIASES = Object\.freeze\(\{ denied: "declined" \}\)/);

  // And the stylesheet must still carry the OLD class, because UC-09's button
  // still asks for it — dropping it would leave a live control unstyled.
  const css = read(ASSETS, "style.css");
  assert.match(css, /\.btn\.decline,/);
  assert.match(css, /\.btn\.deny \{/);
});

test("the panel registry resolves per use case and falls back honestly", () => {
  // Execute panels.js the way the browser would, then use it.
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);

  const { CXPanelFor, CXPanels } = context.window;
  for (const uc of ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"]) {
    assert.ok(CXPanels[uc], uc + " must have a registered panel");
    assert.equal(CXPanelFor(uc), CXPanels[uc]);
  }

  // A genuinely unregistered use case (none currently exist, but the
  // fallback path itself must still work) says so rather than rendering an
  // empty box that looks finished.
  const fallback = CXPanelFor("UC-99");
  assert.equal(fallback, context.window.CXDefaultPanel);
  const rows = fallback.rows({ case: { useCase: "UC-99" } });
  assert.ok(rows.some((r) => /No panel registered/.test(r.value)));
});

// ---------------------------------------------------------------------------
// E4-F16 (rca-0nm) — ticket #108: a specialist approving a third-party-door
// case saw the SAME hint as an ordinary Zendesk case ("Approving issues the
// standard verification letter and solves the ticket"), true only for the
// requester who actually receives it — and on this path the ticket's own
// requester is the door, never the bank who asked (VC-33). Nothing told the
// specialist a manual send to the bank was still outstanding. The fix is
// copy, not plumbing: approveHint() and rows() both branch on
// `case.source === "third_party_door"`.
// ---------------------------------------------------------------------------
test("UC-01's approveHint names the manual-send step on a third-party-door case, and stays the ordinary sentence otherwise", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;
  const panel = CXPanelFor("UC-01");

  const ordinaryHint = panel.approveHint({ case: { source: "zendesk" } });
  assert.match(ordinaryHint, /Approving issues the standard verification letter and solves the ticket\./);
  assert.ok(!/manual/i.test(ordinaryHint), "an ordinary Zendesk-borne case must not mention a manual step it doesn't have");

  const doorHint = panel.approveHint({ case: { source: "third_party_door", returnAddress: "ops@firstbank.example" } });
  assert.match(doorHint, /nothing is sent to them automatically/);
  assert.match(doorHint, /send the letter to ops@firstbank\.example yourself/);
  assert.doesNotMatch(doorHint, /solves the ticket\. The letter discloses/, "must not be the ordinary sentence verbatim");

  // A door case with no return address on record must still say SOMETHING
  // actionable rather than silently dropping the sentence — and, since
  // E5-F18 (rca-3fm, ticket #114), it must say plainly that NO address is on
  // file rather than a sentence phrased as if one exists ("the return
  // address on file" reads like a real value even when it's a fallback).
  const noAddress = panel.approveHint({ case: { source: "third_party_door", returnAddress: null } });
  assert.match(noAddress, /No return address on file/);
  assert.doesNotMatch(
    noAddress,
    /send the letter to the return address on file yourself/,
    "must not phrase the fallback as if a real address exists"
  );
});

// ---------------------------------------------------------------------------
// E5-F18 (rca-3fm) — ticket #114: the "Return address (third party)" row
// rendered a bare em-dash (show()'s default fallback) with no explanation,
// directly above "Outward disclosure: MANUAL SEND OUTSTANDING" — an
// instruction to post the letter with no stated destination and no
// indication that none had been captured at all. Fixed by giving both
// approveHint() and rows() the same explicit fallback string instead of the
// generic "—".
// ---------------------------------------------------------------------------
test("E5-F18: a third-party-door case with no captured return address says so plainly — never a bare em-dash", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;
  const panel = CXPanelFor("UC-01");

  for (const missing of [null, undefined, ""]) {
    const rows = panel.rows({
      case: { source: "third_party_door", employmentId: "emp_active_001", returnAddress: missing },
      documents: [],
    });
    const addressRow = rows.find((r) => r.label === "Return address (third party)");
    assert.ok(addressRow, "a third-party-door case must always carry this row");
    assert.notEqual(addressRow.value, "—", "must never render a bare em-dash under an instruction to post the letter");
    assert.match(addressRow.value, /No return address on file/);
  }
});

test("UC-01's rows() surface the return address and an outstanding-send flag ONLY for a third-party-door case", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;
  const panel = CXPanelFor("UC-01");

  const ordinaryRows = panel.rows({ case: { source: "zendesk", employmentId: "emp_active_001" }, documents: [] });
  assert.ok(!ordinaryRows.some((r) => r.label === "Return address (third party)"), "an ordinary case must carry no return-address row");
  assert.ok(!ordinaryRows.some((r) => r.label === "Outward disclosure"), "an ordinary case must carry no outward-disclosure row");

  const doorRowsNoLetter = panel.rows({
    case: { source: "third_party_door", employmentId: "emp_active_001", returnAddress: "ops@firstbank.example" },
    documents: [],
  });
  const addressRow = doorRowsNoLetter.find((r) => r.label === "Return address (third party)");
  assert.ok(addressRow, "a third-party-door case must show where the letter belongs");
  assert.equal(addressRow.value, "ops@firstbank.example");
  const disclosureRowNoLetter = doorRowsNoLetter.find((r) => r.label === "Outward disclosure");
  assert.match(disclosureRowNoLetter.value, /Not sent/);

  const doorRowsWithLetter = panel.rows({
    case: { source: "third_party_door", employmentId: "emp_active_001", returnAddress: "ops@firstbank.example" },
    documents: [{ type: "employment_verification_letter" }],
  });
  const disclosureRowWithLetter = doorRowsWithLetter.find((r) => r.label === "Outward disclosure");
  assert.match(
    disclosureRowWithLetter.value,
    /MANUAL SEND OUTSTANDING/,
    "once a letter exists on a door case, the panel must say a human still has to send it"
  );
});

test("UC-06's panel supplies its own dual-role renderActions; UC-08's has none", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);

  const { CXPanelFor } = context.window;
  assert.equal(typeof CXPanelFor("UC-06").renderActions, "function", "UC-06 needs custom dual-role controls");
  assert.equal(
    CXPanelFor("UC-08").renderActions,
    undefined,
    "UC-08 must render no controls at all — main.js's actionable gate already keeps it non-actionable, " +
      "and a renderActions here would be a second, unnecessary place that could someday grow buttons"
  );
});

test("UC-06 and UC-08 panels return data, not markup, and tolerate a sparse case", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;

  const uc06View = {
    case: {
      useCase: "UC-06",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      amendmentType: "SALARY_INCREASE",
      requestedEffectiveDate: "2026-07-15",
      summary: "Salary increase from $50,000 to $60,000, effective 2026-07-15.",
      adminApproval: { approver: "admin_jane", note: "" },
      payrollApproval: null,
      createdAt: "2026-07-30T10:00:00.000Z",
    },
  };
  for (const row of CXPanelFor("UC-06").rows(uc06View)) {
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.value, "string");
    assert.ok(!/[<>]/.test(row.value), `UC-06 panel emitted markup-looking value: ${row.value}`);
  }
  /* THE TWO APPROVAL ROWS ARE GONE (2026-08-20), and the assertion moved to the
     thing that replaced them rather than being deleted. `approvalRoles()` is
     the richer statement of the same fact — it names the role, what that role
     decides, and who filled the slot — and main.js draws a meter counting the
     two above the forms. The old rows are asserted ABSENT so they cannot drift
     back and make it four statements again. */
  const uc06Rows = CXPanelFor("UC-06").rows(uc06View);
  assert.ok(
    !uc06Rows.some((r) => /Approved by admin_jane/.test(r.value)),
    "the Admin approval row is back — the capacity card already says this, with the role and what it decides"
  );
  assert.ok(!uc06Rows.some((r) => r.value === "Pending"), "the Payroll approval row is back");
  const uc06Roles = CXPanelFor("UC-06").approvalRoles(uc06View);
  assert.equal(uc06Roles.roles[0].filledBy, "admin_jane", "the capacity card lost the signature the row used to carry");
  assert.equal(uc06Roles.roles[1].filledBy, null, "the outstanding slot stopped reading as outstanding");

  const uc06Sparse = CXPanelFor("UC-06").rows({ case: { useCase: "UC-06" } });
  for (const row of uc06Sparse) {
    assert.ok(!/undefined|null/.test(row.value), `sparse UC-06 case rendered "${row.value}"`);
  }

  const uc08View = {
    case: {
      useCase: "UC-08",
      employmentId: "emp_active_001",
      inquiryType: "dual_residency",
      jurisdictions: ["DE", "ES"],
      presenceDays: null,
      dossier: { narrative: "Restated facts only.", citations: [{ id: "oecd-model-art-4", title: "OECD Model Art. 4" }] },
      createdAt: "2026-07-30T10:00:00.000Z",
    },
  };
  for (const row of CXPanelFor("UC-08").rows(uc08View)) {
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.value, "string");
    assert.ok(!/[<>]/.test(row.value), `UC-08 panel emitted markup-looking value: ${row.value}`);
  }
  assert.ok(CXPanelFor("UC-08").rows(uc08View).some((r) => r.value === "DE, ES"));

  const uc08Sparse = CXPanelFor("UC-08").rows({ case: { useCase: "UC-08" } });
  for (const row of uc08Sparse) {
    assert.ok(!/undefined|null/.test(row.value), `sparse UC-08 case rendered "${row.value}"`);
  }
});

test("a panel returns data, not markup, and tolerates a sparse case", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);

  const panel = context.window.CXPanelFor("UC-01");
  const view = {
    case: {
      useCase: "UC-01",
      employmentId: "emp_active_001",
      requester: "unauthenticated",
      classification: { intent: "standard_letter", requesterType: "third_party", confidence: 0.92 },
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    documents: [{ type: "employment_verification_letter", contentHash: "abc" }],
  };

  const rows = panel.rows(view);
  for (const row of rows) {
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.value, "string", "values must be strings the shell can set as textContent");
    assert.ok(!/[<>]/.test(row.value), `panel emitted markup-looking value: ${row.value}`);
  }
  assert.ok(rows.some((r) => r.value === "92%"), "confidence is rendered as a percentage");
  assert.ok(rows.some((r) => /Yes/.test(r.value)), "an issued letter is reported");

  // A case that never reached classification must not render "undefined".
  const sparse = panel.rows({ case: { useCase: "UC-01" }, documents: [] });
  for (const row of sparse) {
    assert.ok(!/undefined|null/.test(row.value), `sparse case rendered "${row.value}"`);
  }
});

test("the six newly-registered panels (UC-02/03/04/05/07/09) offer renderActions only where a decision surface actually exists", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;

  // UC-07 is never actionable through its API — there is no write route in
  // that file at all, so `view.actionable` can never be true and main.js's
  // existing "visible, not actionable" path covers it with zero use-case-
  // specific branching. Same shape as UC-08.
  //
  // UC-02 USED TO BE ON THIS LIST, and that was the defect rather than the
  // design. UC-02.md §6 has always specified a Finance Ops decision
  // ("PATCH status: declined (with reason) or hold"); it simply had no
  // implementation, so a flagged claim was visible and unresolvable forever.
  // It now has three real routes (src/uc02/server.js) gated by a real policy
  // (src/uc02/reviewPolicy.js), so it belongs with the single-approver group
  // below.
  //
  // AND UC-03 CAME OFF IT THE SAME WAY, one use case later. It is a router and
  // decides nearly everything alone — but `policyEngine.js`'s gate 11 stops a
  // DRAFTED TRAVEL LETTER until a specialist signs it, and src/uc03/server.js
  // grew `POST /api/cases/:id/signoff` and `/decline` for exactly that. The
  // panel said "there is no write route" for a while after there was one, and
  // main.js hard-coded `actionable: false` to match — so the one thing UC-03
  // cannot finish alone was unfinishable on the only screen built to finish it.
  assert.equal(
    CXPanelFor("UC-07").renderActions,
    undefined,
    "UC-07 must render no controls — there is no write route for main.js's actionable gate to unlock"
  );

  // UC-04 (single specialist), UC-05 (single HR Ops sign-off), UC-02 (single
  // Finance Ops reviewer) and UC-03 (single Travel & Mobility Support
  // signature) each have exactly one decision-maker — a real renderActions,
  // not UC-06/09's multi-role shape. UC-02's is the only one with three verbs
  // rather than two; see its panel for why `hold` exists.
  for (const uc of ["UC-02", "UC-03", "UC-04", "UC-05"]) {
    assert.equal(typeof CXPanelFor(uc).renderActions, "function", uc + " needs a single-approver control");
  }

  // UC-03 POSTS THE API'S OWN VERBS. "approve" is not one of them — main.js's
  // default pair would have posted it, which is why this panel supplies its
  // own actions at all, and a wrong verb here is a button that fails its
  // policy's ACTIONS check in a live Zendesk account with nothing failing on
  // this machine.
  const panels = read(ASSETS, "panels.js");
  assert.match(panels, /approveAction: "signoff",\n\s*approveLabel: "Sign off the letter"/);
  assert.match(panels, /role: "travel_support_specialist"/);

  // UC-09 is the one 🔴-framed use case with a real execution path — it
  // needs the multi-role controls, same shape as UC-06's dual approval but
  // generalized to a floor of 2, conditionally 3.
  assert.equal(typeof CXPanelFor("UC-09").renderActions, "function", "UC-09 needs multi-role controls");
});

test("UC-02/UC-03/UC-04/UC-05/UC-07/UC-09 panels return data, not markup, and tolerate a sparse case", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;

  function checkPanel(uc, fullCase, expectedSubstringMatchers) {
    const fullView = { case: fullCase };
    const rows = CXPanelFor(uc).rows(fullView);
    for (const row of rows) {
      assert.equal(typeof row.label, "string");
      assert.equal(typeof row.value, "string");
      assert.ok(!/[<>]/.test(row.value), uc + " panel emitted markup-looking value: " + row.value);
    }
    for (const matcher of expectedSubstringMatchers) {
      assert.ok(rows.some((r) => matcher.test(r.value)), uc + " panel missing expected row matching " + matcher);
    }

    const sparse = CXPanelFor(uc).rows({ case: { useCase: uc } });
    for (const row of sparse) {
      assert.ok(!/undefined|null/.test(row.value), "sparse " + uc + " case rendered \"" + row.value + "\"");
    }
  }

  checkPanel(
    "UC-02",
    {
      useCase: "UC-02",
      employmentId: "emp_active_001",
      expenseId: "exp_1",
      decision: "auto_approve",
      reason: "all_gates_passed",
      categoryId: "cat_travel",
      categorySource: "llm",
      confidence: 0.95,
      flags: [],
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    // NOT `/auto_approve/` any more. The decision, the reason, the deciding
    // gate, the flag codes and the store's own status were all rows on this
    // card and are each said once, elsewhere, by something that says more:
    // the outcome badge, the WHY card with its audit slug, the collapsed
    // provenance block, and the "Finance Ops" row. What is asserted instead is
    // the one row nothing else can produce — the confidence figure WITH the
    // statement of whether this run consulted it.
    [/95%/]
  );
  {
    const uc02Labels = CXPanelFor("UC-02")
      .rows({
        case: {
          useCase: "UC-02",
          employmentId: "emp_active_001",
          expenseId: "exp_1",
          decision: "auto_approve",
          reason: "all_gates_passed",
          status: "pending_review",
          flags: ["over_policy_cap"],
          createdAt: "2026-07-30T10:00:00.000Z",
        },
      })
      .map((r) => r.label);
    for (const gone of ["Decision", "Reason", "Decided by", "Flags", "State"]) {
      assert.ok(!uc02Labels.includes(gone), `the "${gone}" row is back on UC-02 — it is a second copy of something the page states better`);
    }
  }

  checkPanel(
    "UC-03",
    {
      useCase: "UC-03",
      employmentId: "emp_active_001",
      requester: "amara@acme.test",
      classification: { intent: "business_travel", destinationCountry: "DE" },
      decision: "auto_resolve",
      reason: "all_gates_passed",
      flags: [],
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    // `auto_resolve` was a Decision row here too; see the UC-02 note.
    [/DE/]
  );

  // THIS FIXTURE USED TO AGREE WITH THE PANEL INSTEAD OF WITH THE API, in the
  // two exact places the panel was wrong — `risk: {level}` (the row carried
  // `riskLevel`, from src/uc04/riskMatrix.js's own return value) and
  // `cumulativeDays: 21` (the row carries `{days, periodsCounted}`). So the
  // suite was green while every real UC-04 case in the live sidebar rendered
  // "Risk level —" and "Cumulative days [object Object]". It is CLAUDE.md §4's
  // recurring failure exactly: fixtures written to match the code, and the code
  // to match the fixtures, with neither ever compared to what the server sends.
  //
  // THE RISK ROW IS GONE (2026-08-19) and so is that half of the defect: the
  // panel no longer reads `risk` at all. It printed the same value the server
  // publishes as `basis.riskLevel` — which travels with the sentence saying it
  // is a routing rollup and must not be read as the assessment — and printing
  // the bare copy made "risk" the word for four different things on one screen.
  // The remaining expectations are the two rows this test was really written
  // for. `risk` stays on the fixture deliberately, so that a panel reaching for
  // it again would have something to reach for and this test would still be
  // comparing against what the store really holds.
  checkPanel(
    "UC-04",
    {
      useCase: "UC-04",
      employmentId: "emp_active_001",
      requester: "admin_jane",
      risk: { riskLevel: "medium" },
      tripDays: 21,
      cumulativeDays: { days: 21, periodsCounted: 2 },
      decision: "ready_for_approval",
      flags: ["non_treaty_pair"],
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    [/21 day\(s\) across 2 prior trip\(s\)/]
  );

  checkPanel(
    "UC-05",
    {
      useCase: "UC-05",
      employmentId: "emp_active_001",
      requester: "priya@acme.test",
      notice: { noticeEndDate: "2026-09-01", discrepancy: "match" },
      // `totalInRemoteInteger`, the name reconcilePtoPayout() actually returns
      // (src/uc05/ptoPayout.js). The fixture used to say `amount`, which the
      // real object has never carried — so the panel printed "—" for every
      // computed payout and this test agreed with it.
      payout: { totalInRemoteInteger: 120000, currency: "USD" },
      decision: "prepared_for_signoff",
      reason: "all_gates_passed",
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    // `prepared_for_signoff` was a Decision row here too; see the UC-02 note.
    [/2026-09-01/, /1,200\.00 USD/]
  );

  checkPanel(
    "UC-07",
    {
      useCase: "UC-07",
      employmentId: "emp_active_001",
      relocationType: "permanent_relocation",
      sourceCountry: "NG",
      destinationCountry: "DE",
      dossier: { verdict: "REVIEW", narrative: "Deterministic feasibility verdict: REVIEW.", citations: [] },
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    [/NG/, /DE/, /REVIEW/]
  );

  checkPanel(
    "UC-09",
    {
      useCase: "UC-09",
      employmentId: "emp_active_001",
      requester: "admin_1",
      // ×100, as Remote holds it and as src/uc09/workflow.js stores it: this is
      // $5,000.00, not $5,000. The fixture used to say 5000 and expect "5000
      // USD", so the test encoded the same 100× misreading the panel did.
      adjustment: { type: "bonus", amount: 500000, currency: "USD" },
      approvalSlotsRequired: 2,
      decision: "dual_approval_required",
      flags: [],
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    [/bonus/, /5,000\.00 USD/]
  );
});

// ---------------------------------------------------------------------------
// UC-07's panel must render the DOSSIER, not a summary of it
// ---------------------------------------------------------------------------
// A 🔴 escalation buys one thing: the specialist opens the ticket already
// holding the analysis. The panel used to render eight rows and drop the flags
// with their severities, the sequencing dates, the transition-safety verdict,
// PTO, seniority, the whole cost estimate and the QUOTE_REQUIRED components —
// so the compile happened and the specialist still had to go elsewhere, which
// is the same outcome as not having compiled it. These are POSITIVE tests: they
// assert what the panel MUST CONTAIN. Asserting only that UC-07 offers no
// buttons cannot tell a complete dossier from an empty one.
// ---------------------------------------------------------------------------

/** A realistic full dossier, shaped exactly like src/uc07/dossierBuilder.js's. */
const UC07_DOSSIER = {
  relocationType: "permanent_relocation",
  sourceCountry: "FR",
  destinationCountry: "DE",
  parseSource: "rule_based_fallback",
  verdict: "REVIEW",
  feasible: false,
  flags: [
    { code: "UC07_PE_RISK_REVIEW_REQUIRED", severity: "MEDIUM", message: "Potential permanent-establishment exposure for the client must be reviewed." },
    { code: "UC07_PTO_TRANSFER_NOT_ALLOWED", severity: "LOW", message: "PTO cannot be transferred; it will be liquidated in final settlement." },
  ],
  requiredActions: ["PE_REVIEW", "TAX_REVIEW"],
  dateChecks: {
    mot: { valid: true, code: "VALID", requiredLeadTime: 20, requestedLeadTime: 43, earliestAllowedDate: "2026-06-29" },
    coverage: { gapDays: 0, overlapDays: 0, status: "CLEAN" },
    alignment: { aligned: true, duplicateManagementFeeRisk: false, reason: "termination on the last day of a month" },
  },
  transitionSafety: {
    sourceOffboardingAuthorized: false,
    missing: ["source_exit_plan_validated"],
    reason: "source offboarding NOT authorized until: source_exit_plan_validated",
  },
  pto: { decision: "LIQUIDATE", destinationOpeningBalance: 0, liquidatedDays: 15, reason: "Statutory PTO transfer not supported." },
  seniority: { status: "REQUIRES_LEGAL_REVIEW", seniorityDate: null, reason: "Must be confirmed by legal review." },
  uncertainty: 0.5,
  costEstimate: {
    status: "CALCULATED",
    ref: "cc_abc123",
    currency: "EUR",
    months: 12,
    annualGrossSalaryRemoteInteger: 7200000,
    monthlyGrossSalaryRemoteInteger: 600000,
    annualFeeRemoteInteger: 864000,
    monthlyFeeRemoteInteger: 72000,
    lifetimeMonthlyFeesRemoteInteger: 864000,
    components: [
      { key: "monthlyManagementFee", label: "Monthly EOR management fee", remoteInteger: 72000, currency: "EUR", status: "CALCULATED" },
      { key: "ptoCashout", label: "Liquidated PTO payout", remoteInteger: 409091, currency: "EUR", status: "CALCULATED" },
      { key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: 0, currency: "EUR", status: "QUOTE_REQUIRED" },
      { key: "mobilityFee", label: "Mobility / visa support", remoteInteger: 0, currency: "EUR", status: "QUOTE_REQUIRED" },
    ],
    knownTotalRemoteInteger: 481091,
    knownTotalDisplay: "4,810.91 EUR",
    pendingQuotes: ["eorTransferFee", "mobilityFee"],
  },
  citations: [
    {
      id: "mobility-pto-portability",
      title: "PTO portability between source and destination contracts",
      summary: "Accrued PTO balances transfer between contracts only where local law explicitly permits it.",
      matchedOn: ["pto", "liquidat"],
    },
  ],
  narrative: "Request type: permanent_relocation. Deterministic feasibility verdict: REVIEW.",
  faithfulness: { verdict: "not_evaluated", reason: null },
  framing: "RESEARCH SUPPORT ONLY — not a relocation decision or a legal, immigration, or tax determination.",
  customerFacingAcknowledgement: "Thank you for your relocation request.",
};

function uc07Panel() {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  return context.window.CXPanelFor("UC-07");
}

function uc07Rows() {
  return uc07Panel().rows({
    case: {
      useCase: "UC-07",
      employmentId: "emp_active_001",
      relocationType: "permanent_relocation",
      sourceCountry: "FR",
      destinationCountry: "DE",
      dossier: UC07_DOSSIER,
      createdAt: "2026-07-30T10:00:00.000Z",
    },
  });
}

test("UC-07's panel renders every section of the dossier, not a summary of it", () => {
  const text = uc07Rows().map((r) => r.label + ": " + r.value).join("\n");

  // Every deterministic gate's own output must reach the specialist's screen.
  for (const required of [
    /Route: FR → DE/,
    // NOT the gate's word on its own. "REVIEW" and "PROCEED" are the gate's
    // vocabulary and only one of them is self-explanatory; the row says what the
    // verdict MEANS for the reader, which is describeVerdict()'s own account.
    /Feasibility verdict: Needs review before sign-off/,
    /Uncertainty: 50%/,
    // Each flag with its severity AND its full message — a bare code tells the
    // reader a gate fired but not what to do about it.
    /Flag · MEDIUM: Potential permanent-establishment/,
    /Flag · LOW: PTO cannot be transferred/,
    /Required actions: pe review, tax review/,
    // The use case's headline rule (Build Pack Part 9) and what it waits on.
    /Transition safety: NOT authorized — awaiting: source exit plan validated/,
    /Employment coverage: clean/,
    /Month-end alignment: Aligned/,
    /Minimum onboarding time: valid \(needs 20 business days, plan allows 43\)/,
    /PTO: liquidate — opening balance 0 day\(s\), 15 liquidated/,
    /Seniority: requires legal review/,
    /Narrative faithfulness check: Not evaluated/,
  ]) {
    assert.match(text, required, "UC-07 panel is missing a dossier section matching " + required);
  }

  /* THE FRAMING STATEMENT IS DELIBERATELY NOT A ROW ANY MORE, and this used to
     assert that it was — `/Standing: RESEARCH SUPPORT ONLY/`, matching row 34
     of this record, printed under the narrative and the cost estimate it
     exists to qualify. It is UC-07's mandatory disclaimer: on a use case with
     no execution path it says what the whole page is FOR, and a reader who
     meets it after a fully calculated 12-month cost figure has already begun
     reading the page as an answer.

     It now renders in the shell, directly under the header and above every
     finding, on any panel whose view carries one (renderFraming, main.js), and
     the row was removed so the same sentence is not printed twice on one
     screen. Its presence, its position and its verbatim wording are pinned in
     test/zafLongformDisclosure.test.js, which is the file whose whole subject
     is what a reader can see without clicking. Asserted here as an absence so
     that re-adding the row fails loudly rather than quietly duplicating it. */
  assert.doesNotMatch(text, /Standing: RESEARCH SUPPORT ONLY/, "the framing statement is a row again");
});

test("UC-07's panel shows the money, including the components Remote has not quoted", () => {
  const text = uc07Rows().map((r) => r.label + ": " + r.value).join("\n");

  // The salary is annual (Remote's own `annual_gross_salary` period) and the
  // monthly figure is shown beside it, so neither can be read as the other.
  assert.match(text, /Annual gross salary: 72,000\.00 EUR/);
  assert.match(text, /Monthly gross salary: 6,000\.00 EUR/);
  assert.match(text, /EOR management fee: 720\.00 EUR \/ month/);
  assert.match(text, /Liquidated PTO payout: 4,090\.91 EUR/);

  // THE HONESTY MARKERS. An unquoted fee that is simply absent from the panel
  // reads as a fee of zero; a total that silently excludes two pending quotes
  // reads as the whole cost. Both must say so on screen.
  assert.match(text, /One-off EOR transfer fee: Quote required — not priced by this system/);
  assert.match(text, /Mobility \/ visa support: Quote required — not priced by this system/);
  assert.match(text, /Known total \(excludes pending quotes\): 4,810\.91 EUR/);
  // Named by the label the estimate already gives each component, not by the
  // key it is stored under.
  assert.match(text, /Still to be quoted: One-off EOR transfer fee, Mobility \/ visa support/);
});

test("UC-07's panel cites its guidance with what matched it, never a bare title", () => {
  const citation = uc07Rows().find((r) => /^Guidance · /.test(r.label));
  assert.ok(citation, "the dossier's citations must be rendered");
  assert.match(citation.value, /Accrued PTO balances transfer/, "the citation's substance, not just its title");
  assert.match(citation.value, /matched on: pto, liquidat/, "and what matched it — a retrieval signal, never a precision score");
});

test("UC-07's panel stays data-only and survives a dossier that is barely populated", () => {
  const panel = uc07Panel();

  for (const row of uc07Rows()) {
    assert.equal(typeof row.label, "string");
    assert.equal(typeof row.value, "string", "values must be strings the shell can set as textContent");
    assert.ok(!/[<>]/.test(row.value), "UC-07 panel emitted markup-looking value: " + row.value);
  }

  // An empty dossier and an entirely empty case must both render honestly —
  // "—" and explicit "not evaluated" text, never "undefined" or "null".
  for (const sparse of [panel.rows({ case: { useCase: "UC-07", dossier: {} } }), panel.rows({ case: { useCase: "UC-07" } })]) {
    for (const row of sparse) {
      assert.ok(!/undefined|null/.test(row.value), 'sparse UC-07 case rendered "' + row.value + '"');
      assert.ok(!/[<>]/.test(row.value));
    }
  }

  // And it still offers no controls: a panel is only ever asked what controls
  // look like, never whether there should be any (main.js's view.actionable).
  assert.equal(panel.renderActions, undefined);
});

test("the shell surfaces a UC-07 dossier's flags instead of hard-coding none", () => {
  // main.js's loadUc07 used to set `flags: []` unconditionally, so the shared
  // "Why" card printed "No escalation flags were raised" over a dossier with
  // seven raised gates — a false negative on the most load-bearing line in a
  // 🔴 review.
  const main = read(ASSETS, "main.js");
  assert.ok(
    !/reason: "global_mobility_review", flags: \[\]/.test(main),
    "loadUc07 hard-codes an empty flag list"
  );
  assert.ok(
    /row\.dossier && row\.dossier\.flags/.test(main),
    "loadUc07 must read the flags off the dossier the API returned"
  );
});

test("every loader whose API sends `decidedBy` passes it through to the Why card", () => {
  // THE "WHY" CARD PRINTS THE SLUG WHEN — AND ONLY WHEN — NOTHING BETTER
  // ARRIVED. renderWhy() has read `view.decidedBy.means` since the UC-02 fix,
  // and four loaders were dropping that field on the floor: src/uc03,
  // src/uc04, src/uc05 and src/uc09's servers have all returned `decidedBy`
  // (and `gateLadder`) on their by-ticket route since src/shared/gateLadder.js
  // landed, and loadUc03/04/05/09 built a view without it. So a specialist
  // opened a UC-04 authorization and read `duration_over_cap` — a slug — while
  // the sentence explaining it sat in the response body the loader had just
  // parsed.
  //
  // Asserted on the source because a browser asset is never imported by
  // `npm test`; this is the same discipline as the loadUc07 flags check above.
  const main = read(ASSETS, "main.js");
  const passthrough = main.match(/decidedBy: data\.decidedBy \|\| null/g) || [];
  assert.ok(
    passthrough.length >= 5,
    "expected UC-02/03/04/05/09 to pass decidedBy through; found " + passthrough.length
  );
  for (const loader of ["loadUc03", "loadUc04", "loadUc05", "loadUc09"]) {
    const body = main.slice(main.indexOf("function " + loader));
    const end = body.indexOf("\n  }\n");
    assert.ok(
      /decidedBy: data\.decidedBy/.test(body.slice(0, end)),
      loader + " does not read decidedBy off the response its server already sends"
    );
  }
  // And the card still keeps the slug beneath the prose — it is the exact
  // string in audit_log, in the metrics exception ranking and in the n8n ports,
  // so prose that REPLACED it would make the card readable and the system
  // harder to trace.
  assert.ok(/reason-slug/.test(main), "the slug must survive beside the prose");
});

test("loadUc04 stops hard-coding review:null, so the header badge can't contradict the DECISION block", () => {
  // rca-m70i (round-7 R7-15), ticket #51: the status chip read "Awaiting
  // specialist approval" while the DECISION block a few lines below, on the
  // SAME panel, read "Approved." — because renderHeader's badge already knows
  // to prefer `view.review.status` once it stops being "pending" (rca-il7,
  // N-1), but loadUc04 always sent `review: null`, so that preference never
  // had anything to read for this use case. UC-01 was fine because its
  // `review` row IS the settlement record; UC-04's settlement lives on
  // `settled` (settledFacts()) instead, so the loader has to translate it.
  const main = read(ASSETS, "main.js");
  const body = main.slice(main.indexOf("function loadUc04"), main.indexOf("function loadUc05"));
  assert.ok(
    !/review:\s*null,/.test(body),
    "loadUc04 must not unconditionally send review:null — it silences the badge fix for this use case"
  );
  assert.ok(
    /review:\s*data\.settled/.test(body),
    "loadUc04 should derive view.review from data.settled, the same fact the DECISION block renders"
  );
});

// ---------------------------------------------------------------------------
// SIGNED WRITES — the half of the mechanism that lived only on the server.
// ---------------------------------------------------------------------------
// src/review/zafAuth.js could verify a signed identity, and this bundle never
// sent one: every approve/deny went out as a bare fetch() with an
// `X-ZAF-Approver` header, i.e. a claim. A server in signed-identity mode
// therefore 401'd every real approval forever, and nothing in either half's
// own tests could see it — each was correct in isolation. These assertions are
// about the JOIN.
//
// The mechanism is ZAF's own: client.request() with a `jwt` block, HS256 only,
// signed on Zendesk's servers from a SECURE app setting.
//   https://developer.zendesk.com/documentation/apps/app-developer-guide/making-api-requests-from-a-zendesk-app/
// ---------------------------------------------------------------------------

test("the manifest declares the signing secret as a SECURE, optional setting", () => {
  const manifest = JSON.parse(read(APP, "manifest.json"));
  const param = manifest.parameters.find((p) => p.name === "cxSharedSecret");

  assert.ok(param, "the app must be able to hold the HS256 signing secret");
  assert.equal(param.secure, true, "a non-secure setting would ship the secret inside a downloadable bundle");
  assert.equal(param.required, false, "an install with no secret must still render — that is the local-demo path");
  // A default would put a real secret in the repo and in every install.
  assert.ok(!param.default, "a signing secret must have no default value");
});

test("every request in the sidebar goes through the one signing helper — reads included", () => {
  // Nine loaders each hand-rolling their own request is how five of them ended
  // up sending an unsigned header, and how ALL NINE ended up reading with a
  // bare fetch() against an API whose read gate now requires a signed identity.
  // The invariant is counted rather than described: exactly one fetch() and one
  // client.request() exist in this file, both inside cxRequest(), so cxGet()
  // and cxPost() cannot drift apart on how they sign.
  // Comments stripped first: this file's own prose explains the defect by
  // naming `fetch()` several times, and a count that included those would be
  // measuring the documentation instead of the code.
  const main = stripComments(read(ASSETS, "main.js"));

  const fetches = main.match(/(?<![A-Za-z0-9_."])fetch\(/g) || [];
  assert.equal(fetches.length, 1, "found " + fetches.length + " fetch() calls — every request must go through cxRequest()");

  const zafRequests = main.match(/client\s*\.\s*request\(/g) || [];
  assert.equal(zafRequests.length, 1, "found " + zafRequests.length + " client.request() calls — there is one signing shape");

  assert.ok(/function cxRequest\(/.test(main), "the shared request helper must exist");
  assert.ok(/function cxPost\(/.test(main), "the write verb must exist");
  assert.ok(/function cxGet\(/.test(main), "the read verb must exist — an unsigned read is the breach this closed");

  // Both verbs must be built on it, not beside it.
  for (const verb of ["cxPost", "cxGet"]) {
    const body = main.slice(main.indexOf("function " + verb + "("));
    assert.match(body.slice(0, 400), /cxRequest\(/, verb + "() does not delegate to cxRequest()");
  }

  // And every loader must read through cxGet(): nine panels, nine reads.
  const gets = main.match(/cxGet\(/g) || [];
  assert.ok(gets.length >= 9, "expected at least nine cxGet() reads, one per use case; found " + gets.length);
});

// A 401 on a read must not be flattened into "no case for this ticket". Those
// are opposite things to an agent deciding whether to work the ticket by hand,
// and the empty-panel version hides an authentication problem behind what looks
// like an ordinary outcome. Only a 404 is allowed to resolve.
test("a refused read surfaces as an error, never as an empty panel", () => {
  const main = read(ASSETS, "main.js");
  const cxRequest = main.slice(main.indexOf("function cxRequest("), main.indexOf("function cxPost("));
  assert.match(cxRequest, /status === 404/, "only a 404 may resolve to the not-found value");
  assert.match(cxRequest, /describeRefusal\(/, "a refusal must be described, not reduced to a status code");
  // The refusal body's own words reach the agent — a bare "HTTP 401" sends the
  // reader to look for an outage instead of a missing setting.
  const describe = main.slice(main.indexOf("function describeRefusal("));
  assert.match(describe.slice(0, 400), /body\.reason/);
});

test("the signed path uses ZAF's documented jwt block — HS256, placeholders, secure:true", () => {
  const main = read(ASSETS, "main.js");
  assert.ok(/client\s*\.?\s*request\(/.test(main), "signed writes must go through client.request()");
  assert.ok(main.includes('Authorization: "Bearer {{jwt.token}}"'), "the token placeholder must be forwarded");
  assert.ok(main.includes('algorithm: "HS256"'), "ZAF signs HS256 only — any other algorithm can never verify");
  assert.ok(
    main.includes('secret_key: "{{setting.cxSharedSecret}}"'),
    "the secret must be referenced by placeholder, so its value stays on Zendesk's servers"
  );
  assert.ok(/secure:\s*true/.test(main), "secure:true is required for a request that references a secure setting");
});

test("the bundle contains no secret of its own, only the placeholder", () => {
  // A ZAF bundle is downloadable by anyone with an agent seat. The only
  // acceptable occurrences of the setting are the placeholder and the
  // is-it-configured check — never a literal value.
  for (const file of ["main.js", "panels.js"]) {
    const source = read(ASSETS, file);
    const assignments = source.match(/cxSharedSecret\s*[:=]\s*"(?!\{\{|")[^"]+"/g) || [];
    assert.deepEqual(assignments, [], `${file} appears to hard-code a signing secret: ${assignments.join(", ")}`);
  }
});

test("an unconfigured install still works, and the sidebar never signs RS256", () => {
  const main = read(ASSETS, "main.js");
  // The local demo (`npm run review-api`, seeded in memory) has no shared
  // secret AND is not reachable from Zendesk's proxy, so the unsigned path has
  // to survive. It is the weaker posture, which the server refuses when it is
  // in signed mode — losing the ability to approve, never the requirement to
  // be authenticated.
  assert.ok(/signedRequestsConfigured\(\)/.test(main), "the choice must be explicit, not implicit");
  assert.ok(main.includes('"X-ZAF-Approver"'), "the unsigned fallback must still identify the agent");
  // RS256 is the server-side-app mechanism; a client-side bundle cannot sign
  // with it, so it must never appear as an algorithm here. (Prose explaining
  // WHY is fine and is why this checks the algorithm, not the string.)
  assert.ok(
    !/algorithm:\s*["']RS256["']/.test(main),
    "main.js signs RS256 — that is the other app type's mechanism and ZAF cannot produce it"
  );
});

test("the JWT claims come from ZAF's currentUser, not from anything on screen", () => {
  const main = read(ASSETS, "main.js");
  assert.ok(
    main.includes('"currentUser.name"') && main.includes('"currentUser.email"'),
    "identity for the claims must be read from the ZAF client"
  );
  // Honesty: a signature proves the call came through a real installed instance
  // of this app, not which agent clicked. The comment saying so is load-bearing
  // — this repo's whole posture is that an overclaim discredits everything else.
  assert.ok(
    /does NOT prove which agent clicked/i.test(main) || /not prove WHICH agent/i.test(main),
    "main.js must state plainly what a valid signature does and does not prove"
  );
});

// ---------------------------------------------------------------------------
// THE ACCOUNT OF WHY — the gate ladder and the decision facts
// ---------------------------------------------------------------------------
// Six of the nine APIs compute a full structured account of why they decided —
// `gateLadder` (every rung of the real evaluation order, marked passed /
// decided / not_reached) and, under `basis` or `decisionFacts`, the figures the
// gate actually compared — and shipped it on the same response the sidebar was
// already parsing. The sidebar threw all of it away and printed one slug: a
// capability fully built and reachable by nobody, on the one screen a human
// uses to make the decision the 🟡 tier exists to route to them.
//
// These assertions are about the DISTINCTIONS, because the distinctions are
// the whole value and a renderer that flattened them would look finished. They
// run against the source and against the data tables inside it, since npm test
// never imports a browser asset — the same discipline as every check above.
// ---------------------------------------------------------------------------

/**
 * Evaluate one top-level `var NAME = { ... };` object literal out of a browser
 * asset, so a lookup table can be asserted as DATA rather than as text. Braces
 * inside comments are stripped first; none of the literals below contains a
 * brace inside a string, which is what makes the depth count sufficient.
 */
function objectLiteral(source, name) {
  const code = stripComments(source);
  const start = code.indexOf("var " + name + " = {");
  assert.ok(start !== -1, `${name} is missing from the asset`);
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
  return vm.runInNewContext("(" + code.slice(open, i + 1) + ")");
}

/**
 * Extract one top-level `function NAME(...) { ... }` and return it as a
 * callable — for a pure helper with no closure over other module state, so it
 * can be exercised directly rather than only read as text.
 */
function extractFunction(source, name) {
  const code = stripComments(source);
  const start = code.indexOf("function " + name + "(");
  assert.ok(start !== -1, `${name} is missing from the asset`);
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
  return vm.runInNewContext("(" + code.slice(start, i + 1) + ")");
}

test("a gate that never ran is never described as one that passed", () => {
  // docs/GATES.md rule 2, which it calls "the single most common misreading of
  // a decision panel": a gate below the deciding one has said NOTHING. Folding
  // `not_reached` in with `passed` would turn twelve unevaluated rungs into
  // twelve endorsements.
  const main = read(ASSETS, "main.js");
  const words = objectLiteral(main, "GATE_RUNG_WORDS");

  assert.deepEqual(Object.keys(words).sort(), ["decided", "not_reached", "passed"]);
  assert.equal(new Set(Object.values(words)).size, 3, "two rung statuses share a word");
  assert.doesNotMatch(words.not_reached, /pass/i, "`not reached` must not read as a pass");

  // And the ladder itself is rendered, from the server's statuses only.
  assert.match(main, /function renderGateLadder\(rungs\)/);
  assert.match(main, /GATE_RUNG_WORDS\[rung\.status\] \|\| rung\.status/);
  // No gate order of its own: the position, the name, the wording and the
  // status all come off the rung the server sent.
  const ladder = main.slice(main.indexOf("function renderGateLadder("), main.indexOf("function renderDecidedBy("));
  assert.ok(!/sort\(|indexOf\(reason|GATE_SEQUENCE/.test(ladder), "the sidebar derives a gate order of its own");
  // rca-ynsb: the ladder's own copy used to end "docs/GATES.md explains the
  // order and what each one protects" — a repo file the specialist reading
  // this panel, inside a Zendesk ticket, has no way to open.
  assert.ok(!/docs\/GATES\.md/.test(ladder), "the rendered ladder cites an unreachable repo file");

  // The stylesheet has to draw the difference too — a dashed rail for a rung
  // where nothing ran, a state colour only where something did.
  const css = read(ASSETS, "style.css");
  assert.match(css, /\.gate-rung\.is-passed \{[^}]*--r-dot-settled/);
  assert.match(css, /\.gate-rung\.is-not_reached \{[^}]*dashed/);
});

// rca-iih7 / D-31. UC-01's own GATE_SEQUENCE has 22 rows describing 13 gates
// (seven reasons share position 1 — five engagement-eligibility reasons plus
// the two upstream-offboarding-read reasons rca-bdz added — three share
// position 2, two share position 13) — real data, not a synthetic fixture,
// so this test fails if UC-01's ladder shape ever changes under it.
// `renderGateLadder`'s heading used to read "All 20 gates" (a row count)
// over a list numbered 1…13 with repeats, and "Decided by gate 9 of 13" (a
// distinct-position count) underneath it — two different numbers on one
// screen, neither labelled as counting something different from the other.
test("groupRungsByGate: UC-01's 22-row ladder collapses to 13 uniquely-numbered gates", async () => {
  const { describeGateLadder, GATE_SEQUENCE } = await import("../src/uc01/policyEngine.js");
  const main = read(ASSETS, "main.js");
  const groupRungsByGate = extractFunction(main, "groupRungsByGate");

  const distinctPositions = new Set(GATE_SEQUENCE.map((r) => r.position)).size;
  assert.equal(distinctPositions, 13, "this test's own premise (22 rows, 13 gates) is stale — update it");

  const ladder = describeGateLadder("over_scope_request"); // decided at position 9, per GATE_SEQUENCE
  assert.equal(ladder.length, 22, "UC-01's GATE_SEQUENCE row count moved — update this test alongside it");

  // JSON round-tripped: groupRungsByGate ran in a separate vm realm, and
  // node:vm results are cross-realm — assert.deepEqual on the raw array
  // fails on Array.prototype identity, not on content (CLAUDE.md §6).
  const grouped = JSON.parse(JSON.stringify(groupRungsByGate(ladder)));
  assert.equal(grouped.length, 13, "the heading and the rendered list must agree: 13 gates, not 22 rows");
  assert.deepEqual(
    grouped.map((g) => g.position),
    Array.from({ length: 13 }, (_, i) => i + 1),
    "every position 1..13 must appear exactly once, in order — no duplicate rung numbers"
  );

  const decidedGroup = grouped.find((g) => g.position === 9);
  assert.equal(decidedGroup.status, "decided", "the deciding gate's group must read as decided, not as one of its siblings' statuses");
  assert.equal(grouped.find((g) => g.position === 1).status, "passed", "a gate entirely before the decision must read as passed");
  assert.equal(grouped.find((g) => g.position === 13).status, "not_reached", "a gate after the decision must read as not reached");
});

test("`cleared` is the only kind of state the sidebar draws as a pass", () => {
  // The vocabulary src/uc04/decisionFacts.js defines, and the reason it is
  // five-valued rather than boolean. `unknown` (the check ran on absent data),
  // `unavailable` (the check does not exist yet), `not_assessed` (an earlier
  // gate decided first) and `suppressed` (a limit was EXCUSED) are each an
  // ABSENCE of a verdict, and they are absences of different things. Drawing
  // any of them the way "cleared" is drawn is how an unevaluated country came
  // to sit on a one-click approval screen (finding F-14).
  const main = read(ASSETS, "main.js");
  const states = objectLiteral(main, "FACT_STATES");

  const settled = Object.keys(states).filter((key) => states[key].tone === "settled");
  assert.deepEqual(
    settled.sort(),
    ["clear", "cleared", "valid", "within_limit"],
    "a state that does not mean 'checked, and nothing was found against it' is being drawn as a pass"
  );

  for (const key of ["unknown", "unavailable", "not_assessed", "suppressed"]) {
    const state = states[key];
    assert.ok(state, `${key} has no rendering at all — it would print as a raw slug`);
    assert.equal(state.tone, "open", `${key} must not carry a verdict's tone`);
    assert.ok(state.means, `${key} must say what it IS — that sentence is what stops it reading as a pass`);
    assert.notEqual(state.word, states.cleared.word, `${key} reads as "cleared"`);
  }

  // The one that is easiest to get wrong, and the most expensive: an excused
  // limit is not a met limit.
  assert.match(states.suppressed.means, /skipped rather than met|excused/i);
  assert.doesNotMatch(states.suppressed.word, /clear|pass|within/i);

  // Every state renders a WORD, so the screen reads in monochrome and to a
  // screen reader; colour is only ever the third cue.
  for (const key of Object.keys(states)) {
    assert.ok(states[key].word && typeof states[key].word === "string", `${key} has no word`);
  }

  // An unrecognised state falls through to the OPEN tone, never a pass — a new
  // state added server-side must not arrive here looking fine.
  assert.match(main, /return FACT_STATES\[state\] \|\| \{ word: String\(state\), tone: "open", means: null \}/);

  // The open tone is drawn as a hollow ring rather than a filled dot, so "no
  // verdict was reached" cannot be skim-read as a verdict.
  const css = read(ASSETS, "style.css");
  assert.match(css, /\.r-fact-state\.tone-open::before \{[^}]*background: transparent/);
  const block = css.slice(css.indexOf(".r-fact-state {"));
  assert.ok(!/--r-series-/.test(block), "a state mark must never take the chart series palette");
});

test("an excused check carries the provenance of whatever excused it", () => {
  // A suppression a reader cannot see is a control that has been removed in
  // silence. When a Portugal workation skips the Schengen 90/180 check, the
  // specialist has to be able to read that the basis is DNV_COUNTRIES — a
  // five-entry hand-written list whose own record says "[PROPOSED] —
  // illustrative, no authority" (DNV_COUNTRIES_PROVENANCE, src/uc04/riskMatrix.js).
  const main = read(ASSETS, "main.js");
  assert.match(main, /function renderProvenance\(provenance\)/);
  for (const field of ["provenance.table", "provenance.status", "provenance.authority", "provenance.version", "provenance.reviewedOn", "provenance.reference"]) {
    assert.ok(main.includes(field), `the provenance block drops ${field}`);
  }
  // The nulls are deliberate upstream — an unauthored table has no authority
  // and no review date — so they render as stated absences. An omitted row
  // reads as one nobody thought to include.
  assert.match(main, /provenance\.authority \|\| "none named"/);
  assert.match(main, /provenance\.reviewedOn \|\| "never"/);
  // And it is reached from the measurement that was suppressed.
  const measurement = main.slice(main.indexOf("function renderMeasurement("), main.indexOf("function renderNarrativeBlock("));
  assert.match(measurement, /renderProvenance\(measurement\.basis\)/);
  // A limit with no measured value states which side is missing rather than
  // printing a 0 that would read as a measurement.
  assert.match(measurement, /no figure was taken on this run/);
});

test("the transparency renderers contain no control — 🔴 stays unactionable", () => {
  // UC-07 and UC-08 have no execution path by design and `view.actionable` is
  // always false for them server-side. Rendering a richer dossier must not
  // introduce a button: the safe path must never double as a dismiss button,
  // and `view.actionable` must stay the ONE question that gates controls.
  const main = read(ASSETS, "main.js");
  const section = main.slice(main.indexOf("var GATE_RUNG_WORDS"), main.indexOf("function renderWhy(view)"));
  assert.ok(section.length > 2000, "the transparency section was not found where expected");
  for (const forbidden of [/el\("button"/, /addEventListener/, /view\.post/, /actionable/]) {
    assert.ok(!forbidden.test(section), `the basis renderers reach for ${forbidden} — they must render only`);
  }
});

test("every loader passes through the account its API already sends", () => {
  // The gap this closed, measured: `gateLadder` and `decisionFacts` each
  // occurred ZERO times in zaf-app/ while UC-02/03/04/05/06/09 all shipped
  // them. A field parsed and dropped is indistinguishable, from the sidebar,
  // from a field the server never computed.
  const main = read(ASSETS, "main.js");

  const ladders = main.match(/gateLadder: data\.gateLadder \|\| \[\]/g) || [];
  assert.ok(ladders.length >= 6, `expected UC-02/03/04/05/06/09 to pass the ladder through; found ${ladders.length}`);

  // The fact bundles (UC-02/03) and the per-use-case bases (UC-04/05/06).
  const bundles = main.match(/decisionFacts: data\.decisionFacts \|\| null/g) || [];
  assert.ok(bundles.length >= 2, `expected UC-02 and UC-03 to pass decisionFacts through; found ${bundles.length}`);
  const bases = main.match(/basis: data\.basis \|\| null/g) || [];
  assert.ok(bases.length >= 3, `expected UC-04/05/06 to pass basis through; found ${bases.length}`);

  // UC-06 was dropping ALL THREE, and it is the use case that could least
  // afford it: its dual control is two people answering different questions.
  const uc06 = main.slice(main.indexOf("function loadUc06("), main.indexOf("function loadUc08("));
  for (const field of [/decidedBy: data\.decidedBy/, /gateLadder: data\.gateLadder/, /basis: data\.basis/]) {
    assert.match(uc06, field, "loadUc06 drops part of the account its API sends");
  }

  // And the card is actually rendered, between the reason and the buttons.
  assert.match(main, /var basis = renderDecisionBasis\(view\);/);
  const render = main.slice(main.indexOf("function render(view"));
  assert.ok(
    render.indexOf("renderDecisionBasis") < render.indexOf("renderActions(view"),
    "the account must render BEFORE the controls — it is read to make the decision, not after it"
  );
});

test("a use case that publishes no account renders no empty promise", () => {
  // describeDecidingGate() returns null and describeGateLadder() returns []
  // for a reason with no row, deliberately, rather than guessing. The sidebar
  // has to degrade the same way: UC-01's review API and UC-07's dossier API
  // publish neither field today, and an empty "What this decision turns on"
  // card would claim an account that does not exist.
  const main = read(ASSETS, "main.js");
  const basis = main.slice(main.indexOf("function renderDecisionBasis(view)"));
  assert.match(basis.slice(0, 400), /if \(!basis && !bundle\) return null;/);
  // The gate block moved below the controls (renderDetails) and gained the flag
  // codes, so its null check now has to cover both halves: a use case with no
  // gate sequence AND no flags renders nothing at all, never an empty
  // disclosure promising an account that does not exist.
  assert.match(main, /var decidedBy = renderDecidedBy\(view, [^)]*\);\n\s*if \(decidedBy\) section\.appendChild\(decidedBy\);/);
  const decidedBy = main.slice(main.indexOf("function renderDecidedBy(view, flags)"));
  assert.match(decidedBy.slice(0, 400), /if \(\(!decidedBy \|\| !decidedBy\.gate\) && !codes\.length\) return null;/);
});

test("UC-04's panel never prints a cumulative-day count it does not have", () => {
  // Two defects in one row. It printed `[object Object]` on every UC-04 case,
  // because `cumulativeDays` is {days, periodsCounted} and the row ran it
  // through show(). And the fix must not simply print `days`: 0 across 0 prior
  // trips is a FLOOR, not a count — nobody read Remote for prior travel, the
  // request carried none — which is why UC-04.md §9 makes an empty history a
  // reason to escalate rather than a clean record.
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const panel = context.window.CXPanelFor("UC-04");

  const empty = panel.rows({ case: { useCase: "UC-04", cumulativeDays: { days: 0, periodsCounted: 0 } } });
  const emptyRow = empty.find((r) => r.label === "Cumulative days");
  assert.ok(!/\[object Object\]/.test(emptyRow.value), "the row still prints a raw object");
  assert.doesNotMatch(emptyRow.value, /^0\b/, "0 days over 0 trips must not be printed as a measurement");
  assert.match(emptyRow.value, /no prior trips/i);

  const counted = panel.rows({ case: { useCase: "UC-04", cumulativeDays: { days: 42, periodsCounted: 3 } } });
  const countedRow = counted.find((r) => r.label === "Cumulative days");
  assert.match(countedRow.value, /42 day\(s\) across 3 prior trip\(s\)/);
});

// ---------------------------------------------------------------------------
// TWO THINGS CALLED "TIER"
// ---------------------------------------------------------------------------
// The rendering half of this lives in test/zafExecutionClaim.test.js, which
// boots this file against real handlers and reads what ends up on screen. These
// are the source-level companions: the tables, and the guarantee that no later
// edit can reach for the shorter, ambiguous name again.

test("the rail's tier table makes no claim about what may be executed", () => {
  // The old table had a `means` column, so "high" carried BOTH the tier and the
  // sentence "no execution path exists — this can only be escalated". The
  // sentence is the 🔴 architectural guarantee and the tier it hung off was the
  // ESCALATED CASE RISK, so one advisory flag on 🟡 UC-04 printed it over that
  // case's own working Approve button. Splitting the table is what makes that
  // combination unsayable: a tier can no longer carry a promise.
  const main = read(ASSETS, "main.js");
  const tiers = objectLiteral(main, "USE_CASE_TIERS");

  assert.deepEqual(Object.keys(tiers).sort(), ["high", "low", "medium"]);
  for (const key of Object.keys(tiers)) {
    assert.ok(tiers[key].glyph, `${key} has no glyph`);
    assert.ok(tiers[key].name, `${key} has no name`);
    assert.equal(tiers[key].means, undefined, `${key} carries an execution claim again`);
    // The name says it is about the USE CASE. "High risk" on its own was read
    // as a verdict on the request in front of the specialist, which is the
    // other half of the same conflation.
    assert.match(tiers[key].name, /use case/i, `${key} does not say it describes the use case`);
    assert.doesNotMatch(JSON.stringify(tiers[key]), /execution|escalat|approve/i);
  }
});

test("this request's risk is stated as a finding, never as a permission", () => {
  // Both facts survived the fix — the case risk is not suppressed to resolve
  // the contradiction, because it never was one. It is worded so it cannot be
  // read as a statement about what the system may do, and never as a "score":
  // UC-04.md §7 forbids collapsing the four dimensions into one, so a panel
  // implying a score exists would be a fresh overstatement.
  const main = read(ASSETS, "main.js");
  assert.match(main, /function renderCaseRisk\(view\)/);

  const block = main.slice(main.indexOf("function renderCaseRisk(view)"), main.indexOf("function renderHeader(view)"));
  assert.match(block, /This request: /);
  assert.doesNotMatch(block, /scored|score/i, "the case-risk line implies a single score");
  assert.doesNotMatch(block, /execution path/i, "the case-risk line makes a claim about execution");
  // Escalated or not is said explicitly. "medium" alone leaves a reader unable
  // to tell a baseline from a verdict — the precise ambiguity being fixed.
  assert.match(block, /caseRiskEscalated/);
  assert.match(block, /baseline/);
  assert.match(block, /It does not change what may be executed/);
});

test("no loader carries the ambiguous `tier` onto the view", () => {
  // The APIs still send `tier` — deployed clients and existing server tests
  // read it — but nothing in this file may. `view.tier` occurring zero times is
  // what stops the conflation returning through a later edit that reaches for
  // the shorter name.
  const main = stripComments(read(ASSETS, "main.js"));
  assert.ok(!/view\.tier\b/.test(main), "something reads view.tier again");
  assert.ok(!/\btier: data\.tier\b/.test(main), "a loader copies the legacy tier onto the view");

  // And every loader passes the two named-apart facts through. A field parsed
  // and dropped is indistinguishable, from the sidebar, from one the server
  // never computed — which is how `gateLadder` reached zero of nine panels.
  const passthroughs = main.match(/riskPosture\(data\)/g) || [];
  assert.ok(passthroughs.length >= 8, `expected every loader to pass the posture through; found ${passthroughs.length}`);
});

test("no panel prints a money field at Remote's ×100 scale", () => {
  // THE 100× MISREAD, ON THE ONE SCREEN WHERE IT COSTS MONEY. UC-09's summary
  // card printed `show(adj.amount)` — the raw Remote integer — so a $5,000.00
  // off-cycle payment rendered as "500000 USD" directly above the controls that
  // release it, while the basis panel below printed 5,000.00. Two figures for
  // one payment, differing by 100, and the larger one first.
  //
  // ×100 is a global invariant (CLAUDE.md §3), and this file owns exactly one
  // copy of it — the `money()` helper. The check is therefore that every money
  // row goes THROUGH that helper, not that the numbers happen to look right:
  // a row that formats inline would be a second copy of the convention in
  // browser JavaScript, which is how the two halves came to disagree.
  const panels = stripComments(read(ASSETS, "panels.js"));

  const rawScaled = panels.match(/show\((\w+)\.(amount|total|payout)\b[^)]*\)/g) || [];
  assert.deepEqual(rawScaled, [], "a money field is rendered without the ×100 helper: " + rawScaled.join(", "));

  // Both known money rows go through it, and both name the field the server
  // really sends — `payout.amount` never existed at all, so that row printed
  // "—" for every computed payout it was meant to show.
  assert.match(panels, /label: "Amount", value: money\(adj\.amount, adj\.currency\)/);
  assert.match(panels, /label: "PTO payout", value: money\(payout\.totalInRemoteInteger, payout\.currency\)/);

  // And the helper still refuses to invent a figure: a non-integer renders as
  // an absence, never as a 0 that would read as "nothing is owed".
  const helper = panels.slice(panels.indexOf("function money(remoteInteger, currency)"));
  assert.match(helper.slice(0, 300), /Math\.round\(remoteInteger\) !== remoteInteger\) return "—"/);
});

// ---------------------------------------------------------------------------
// rca-0f5j (R7-02) — "Letter issued — Yes — N on file" used to be a bare
// assertion with no view, download or resend control anywhere beside it. A
// specialist declined to act on a real ticket for exactly this reason. There
// is no specialist-facing endpoint that ever holds a document's rendered
// content (src/review/store.js strips `content` from every row it returns,
// deliberately), so the fix does not invent one — it points at the delivery
// mechanism that already exists: the letter is posted as the ticket's own
// public reply (src/review/service.js's zendesk.resolveWithLetter()) for
// every case except a third-party-door disclosure, which already carries its
// own "Outward disclosure" row saying nothing is auto-sent.
// ---------------------------------------------------------------------------
test("rca-0f5j: an issued letter carries a row that tells the specialist how to verify it", () => {
  const context = { window: {} };
  vm.createContext(context);
  new vm.Script(read(ASSETS, "panels.js"), { filename: "panels.js" }).runInContext(context);
  const { CXPanelFor } = context.window;
  const panel = CXPanelFor("UC-01");

  const view = {
    case: { source: "zendesk", employmentId: "emp_active_001", createdAt: "2026-07-30T10:00:00.000Z" },
    documents: [
      {
        type: "employment_verification_letter",
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        contentHash: "deadbeefcafebabe1234567890",
        createdAt: "2026-08-01T10:00:00.000Z",
      },
    ],
  };
  const rows = panel.rows(view);

  const verify = rows.find((r) => r.label === "Verify the letter");
  assert.ok(verify, "an issued letter must carry a row explaining how to check the claim");
  assert.equal(typeof verify.value, "string");
  assert.ok(!/[<>]/.test(verify.value), "still data, not markup — main.js writes it with textContent");
  assert.match(verify.value, /public reply/, "must point at where the letter actually is: the ticket's own transcript");
  assert.match(verify.value, /a1b2c3d4/, "must carry enough of the document id to cross-check against audit_log.details.letterDocumentId");
  assert.match(verify.value, /deadbeefca/, "must carry enough of the hash to cross-check against audit_log.details.letterContentHash");

  // No letter yet — no verification row to offer.
  const noLetterRows = panel.rows({ case: { source: "zendesk" }, documents: [] });
  assert.ok(!noLetterRows.some((r) => r.label === "Verify the letter"), "nothing to verify before a letter exists");

  // A third-party-door case is never told to look at the ticket's public
  // reply — VC-33 (the third party is never the ticket requester) and the
  // "Outward disclosure" row already say plainly that nothing auto-sends.
  const doorRows = panel.rows({
    case: { source: "third_party_door", returnAddress: "ops@firstbank.example" },
    documents: [{ type: "employment_verification_letter", id: "x", contentHash: "y", createdAt: "2026-08-01T10:00:00.000Z" }],
  });
  assert.ok(
    !doorRows.some((r) => r.label === "Verify the letter"),
    "a third-party-door letter is not on this ticket's transcript — pointing there would be wrong, not just unhelpful"
  );
  assert.ok(doorRows.some((r) => r.label === "Outward disclosure"), "the door case still carries its own disclosure row");
});
