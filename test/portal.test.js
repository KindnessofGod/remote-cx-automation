// ---------------------------------------------------------------------------
// portal.test.js  —  The request portal (src/portal/)
// ---------------------------------------------------------------------------
// Four concerns, matching the remoteui/playground/chatdemo test discipline:
//
//   1. The browser assets compile and never write markup. `npm test` never
//      imports app.js, so a syntax error there would otherwise ship silently
//      behind a green suite — the same shape of risk as an n8n Code node body
//      (CLAUDE.md §6). The page renders text a person typed, so the innerHTML
//      ban is a real safety property, not a style rule.
//   2. Every one of the seven request types reaches its REAL workflow and
//      comes back with a sensible decision — one input that passes the gates
//      and one that is refused by them. Driven through the REAL handler
//      against the REAL mock Remote server (hermetic — localhost only), so
//      "the portal runs the actual gates" is demonstrated rather than claimed.
//   3. The 🔴 guarantee, structurally: the portal cannot hand UC-07 or UC-08 a
//      write-capable client. Asserted the way test/uc08.test.js asserts it of
//      the workflow itself — against the source with comments stripped — and
//      then behaviourally, by wiring a Remote client that throws on ANY call
//      and watching both dossiers compile anyway.
//   4. No port literal anywhere in src/portal/ (src/shared/ports.js is the
//      only place a port number is written down — see test/ports.test.js).
//
// EVERY LLM SEAM IS FAKED. This devcontainer carries a genuine but unreachable
// OPENAI_API_KEY, so any call site without an injected fake makes a real,
// retried, slow, failing network call — a hazard this repo has been burned by
// three times (issues #31, #32, #27, and again in the UC-09 merge). The fakes
// below are the repo-standard `(args) => realFn(args, {isConfigured: () => false})`
// idiom: the REAL function, forced down its deterministic branch, so the test
// exercises production code rather than a stub.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler, PORTAL_SOURCE, UC07_PLAN_DEFAULTS, buildTimeOffBalances, buildPresencePeriods } from "../src/portal/server.js";
import { CONSENT_AGE_WARN_DAYS } from "../src/shared/consentPolicy.js";
import { computePresenceDays } from "../src/uc08/presenceCalculator.js";
import { REQUEST_TYPES } from "../src/portal/requestTypes.js";
import { PERSONAS, resolvePersona } from "../src/portal/personas.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { reconcilePtoPayout } from "../src/uc05/ptoPayout.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { draftNarrative as draftRelocationNarrative } from "../src/uc07/dossierBuilder.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftNarrative as draftTaxNarrative } from "../src/uc08/dossierBuilder.js";
import { parseAdjustmentRequest } from "../src/uc09/adjustmentParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const PORTAL_SRC = join(__dirname, "..", "src", "portal");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// A literal, and deliberately so: this is a TEST's own mock, and the registry's
// TEST_BAND (4090-4099) is reserved for exactly this. 4090-4096 and 4099 are
// already claimed by other test files; 4097 is free. test/ports.test.js
// enforces that this stays out of both the seed band and every server's port.
const REMOTE_PORT = 4097;

// --- the LLM seams, every one of them, forced down its deterministic branch --
const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased, // already the rule-based path
  classifyTravel: classifyTravelInquiryRuleBased, // already the rule-based path
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
  extract: (args) => extractFromLetter(args, unconfigured),
  parseRelocation: parseRelocationRuleBased,
  draftRelocationNarrative: (args) => draftRelocationNarrative(args, unconfigured),
  parseInquiry: parseInquiryRuleBased,
  draftTaxNarrative: (args) => draftTaxNarrative(args, unconfigured),
  // UC-09's parser is the ONE seam that cannot be forced down a "deterministic
  // branch", because after finding F-10 it has no rule-based branch to force:
  // an amount that will be paid is never guessed from prose. So this stands a
  // model up instead — the REAL parseAdjustmentRequest() against a scripted
  // answer, so its shape validation, source tagging and ×100 scaling are all
  // the production ones, with no network call. (The portal's UC-09 form is
  // free-text only by design; running it with no LLM configured now correctly
  // escalates every request with `amount_not_extracted`, which is asserted
  // separately below.)
  parseAdjustment: (args) => {
    const text = String(args.requestText ?? "");
    const amount = /\$([\d,]+(?:\.\d+)?)/.exec(text);
    return parseAdjustmentRequest(args, {
      isConfigured: () => true,
      backoff: async () => {},
      askJson: async () => ({
        type: text.toLowerCase().includes("relocation") ? "relocation_allowance" : "bonus",
        amount: amount ? Number(amount[1].replace(/,/g, "")) : null,
        currency: "USD",
        description: text,
        // Read out of the text, never inferred. Remote requires
        // `amount_tax_type` and neither reading may be assumed — gross and net
        // pay different sums for the same integer.
        amountTaxType: text.toLowerCase().includes("net")
          ? "net"
          : text.toLowerCase().includes("gross")
            ? "gross"
            : null,
      }),
    });
  },
};

/** The same portal, with UC-09's LLM unavailable — the refusal posture. */
const FAKE_LLM_NO_ADJUSTMENT_PARSER = {
  ...FAKE_LLM,
  parseAdjustment: (args) => parseAdjustmentRequest(args, unconfigured),
};

let remote;
let remoteServer;
let audit;
let handler;

function freshStores() {
  return {
    uc01: new CaseStore(),
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
}

/** Same in-process handler driver every other server suite in this repo uses. */
function callApi(h, { method, path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, headers: this.headers, body: payload ? JSON.parse(payload) : null });
      },
    };
    h(req, res).catch(reject);
  });
}

const post = (type, body) => callApi(handler, { method: "POST", path: `/api/requests/${type}`, body });

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
  audit = new AuditLogger();
  handler = createPortalHandler({ remote, audit, stores: freshStores(), llm: FAKE_LLM });
});

after(async () => {
  // Close the mock so the event loop drains — a test file that keeps listening
  // never lets `node --test` exit.
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 1. Static assets
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// "No matter what I do in UC-02 I always get the replay"
// ---------------------------------------------------------------------------
// The report, and the shape of the fix. UC-02 replays the stored decision for
// an expense it has already judged — correct, and what stops a redelivery
// paying twice — but the fixture list is fixed, so on a returning tester every
// scenario on this page was a one-shot. "File this as a new claim" opens it,
// and it defaults ON: off by default meant a tester had to already know the
// control existed before any scenario would run twice, which is exactly the
// state that produced the report.
//
// It is also symmetric with the reference control beside it, which defaults to
// "generate a new one" and offers reuse as the deliberate choice. Both now make
// the working case the default and the demonstration the explicit act.

test("the UC-02 fresh-claim control exists and is ON by default", () => {
  const html = read("index.html");
  const match = html.match(/<input[^>]*id="uc02-freshCopy"[^>]*>/);
  assert.ok(match, "the UC-02 form must offer a fresh-claim control");
  assert.match(match[0], /\bchecked\b/, "it must default ON — see this block's header");

  // And the page must actually apply it, in the builder that sends UC-02's body.
  const app = read("app.js");
  assert.match(app, /expenseId: freshCopyOf\(value\("uc02-expenseId"\)\)/);
  assert.match(app, /checked\("uc02-freshCopy"\)/);
});

test("index.html loads exactly the assets that exist", () => {
  const html = read("index.html");
  for (const asset of ["style.css", "app.js"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
  // The shared design system, served by server.js from src/shared/ui/.
  assert.ok(html.includes("remote-ui.css"), "index.html must load the shared design system");
  // ...and every one of them is addressed RELATIVELY. The portal is also
  // mounted under /portal on the Vercel deployment, where an absolute
  // "/app.js" asks the deployment's router for a use case by that name and
  // 404s. test/portalAccess.test.js pins the matching <base> injection.
  assert.ok(!/(?:src|href)="\/[^"]*"/.test(html), "index.html must not load an asset by absolute path");
});

test("app.js compiles", () => {
  assert.doesNotThrow(() => new vm.Script(read("app.js"), { filename: "app.js" }));
});

test("app.js never writes dynamic values with innerHTML", () => {
  const source = read("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

// --- the roster/scenario coupling, which fails SILENTLY ---------------------
//
// applyScenario() does `byId("persona").value = scenario.persona`. Assigning a
// value that is not an <option> in the <select> does NOT throw and does NOT
// clear the field — the browser silently leaves the PREVIOUS selection in
// place. So a scenario naming a persona that no longer exists does not produce
// an error a tester would notice; it quietly submits as whoever happened to be
// selected, which is the single worst outcome available on a page whose entire
// subject is that identity comes from an authenticated signal.
//
// This is exactly the bug class the 2026-08-18 roster change could have
// introduced (six personas removed at once, referenced from ~13 scenarios), so
// it is pinned here rather than left to review. The persona keys are read out
// of the REAL asset, not restated, because a local copy of the list would share
// any typo and compare equal.
test("no scenario quick-fill names a persona that does not exist", () => {
  const source = read("app.js");
  const scenarioKeys = [...source.matchAll(/persona:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scenarioKeys.length > 15, "the scenario table should not have silently emptied");

  for (const key of new Set(scenarioKeys)) {
    assert.ok(
      Object.hasOwn(PERSONAS, key),
      `app.js scenario references persona "${key}", which personas.js does not define — ` +
        "the picker would silently keep the previous selection and submit as the wrong person"
    );
  }
});

// --- the SUBJECT half of the same roster coupling, which also fails silently -
//
// The persona picker is only one of the two places a person's identity enters
// this page. UC-04/07/08/09 take a SUBJECT — an employment id typed into the
// form — and those fields have their own defaults, placeholders and
// scenario fill values. When the roster was cut to the project owner's own
// Sandbox on 2026-08-18, the personas were repointed and these fields were
// missed, so the picker offered seven real people while every quick-fill
// submitted `emp_active_001`: a mock-only fixture that is not in the owner's
// Sandbox at all, and is exactly what the owner had asked to be removed.
//
// It fails quietly in a way the persona bug does not: the request SUCCEEDS.
// The portal's Remote reads are the mock fixtures, so `emp_active_001` resolves
// and a perfectly ordinary decision comes back — nothing errors, nothing looks
// wrong, and a tester cross-checking the id against their own account is the
// only way to notice. So it is pinned here.
//
// The allowlist is READ OUT OF personas.js, never restated: a local copy of the
// seven ids would share any typo and compare equal, the same reason the persona
// test above reads its keys out of the real asset.
test("no portal form default or scenario fill names an employment id outside the Sandbox roster", () => {
  const sandboxIds = new Set(
    Object.values(PERSONAS)
      .map((p) => p.employmentId)
      .filter(Boolean)
  );
  assert.ok(sandboxIds.size >= 7, "the persona roster should not have silently emptied");

  const found = [];

  // Scenario quick-fills: `"uc04-employmentId": "<id>"` and friends.
  for (const m of read("app.js").matchAll(/"uc\d\d-employmentId":\s*"([^"]*)"/g)) {
    found.push(["app.js scenario fill", m[1]]);
  }
  // Form defaults and placeholders on the four subject inputs.
  for (const m of read("index.html").matchAll(/id="uc\d\d-employmentId"[^>]*/g)) {
    for (const attr of m[0].matchAll(/(?:value|placeholder)="([^"]*)"/g)) {
      found.push(["index.html form field", attr[1]]);
    }
  }
  assert.ok(found.length >= 15, `expected the subject fields to still be populated, found ${found.length}`);

  for (const [where, id] of found) {
    if (id === "") continue; // a deliberately blank optional field is not a claim
    assert.ok(
      sandboxIds.has(id),
      `${where} offers employment id "${id}", which is not one of the project owner's own Sandbox ` +
        "people (personas.js). The portal's Remote reads are the mock fixtures, so a stale id still " +
        "returns a decision — the request succeeds and nobody notices the subject is fictional."
    );
  }
});

test("the page has a card, a form and a scenario row for every request type the server serves", () => {
  const html = read("index.html");
  const appJs = read("app.js");
  for (const type of REQUEST_TYPES) {
    assert.ok(html.includes(`id="card-${type.id}"`), `no card for ${type.useCase}`);
    assert.ok(html.includes(`id="form-${type.id}"`), `no form for ${type.useCase}`);
    assert.ok(html.includes(`data-scenarios="${type.id}"`), `no scenario row for ${type.useCase}`);
    assert.ok(appJs.includes(`${type.id}:`), `app.js has no body builder for ${type.useCase}`);
  }
});

test("the browser carries no copy of a tier description or a humanControl sentence — it renders what /api/context sends", () => {
  // The port-registry bug's shape: three sincere copies of one fact, checked
  // against the wrong thing. requestTypes.js is the single source; a duplicate
  // in the assets would be a place for it to drift silently.
  const assets = read("index.html") + read("app.js") + read("style.css");
  for (const type of REQUEST_TYPES) {
    assert.ok(!assets.includes(type.description), `${type.useCase}'s description is duplicated into the browser assets`);
    assert.ok(!assets.includes(type.humanControl), `${type.useCase}'s humanControl sentence is duplicated into the browser assets`);
    assert.ok(!assets.includes(type.title), `${type.useCase}'s title is duplicated into the browser assets`);
  }
});

test("app.js re-derives no decision — it maps a decision string to a colour and nothing else", () => {
  const source = read("app.js");
  // A comparison against a decision string would be the browser deciding.
  assert.ok(!/===\s*["'](auto_resolve|auto_approve|human_review|escalate|blocked)["']/.test(source), "app.js branches on a decision value");
  // ZERO, AND IT USED TO BE ONE. The single read was nextStep(), which chose
  // between "a specialist decides it" and the 🔴 "nothing here approves this,
  // and nothing anywhere does" from `executionPath` alone — so it could not
  // tell an auto-approval from a hand-off, and told a requester whose expense
  // had already been approved at Remote that a specialist would decide it. Both
  // sentences moved to src/portal/plainAnswer.js, which is given the decision
  // as well. The page now branches on nothing the server sent at all; a
  // reappearance here is a deliberate act and should be argued for.
  assert.equal((source.match(/executionPath\s*===/g) || []).length, 0, "the page has started branching on executionPath again");
});

// ---------------------------------------------------------------------------
// 2. Context
// ---------------------------------------------------------------------------

test("GET /api/context serves the eight request types, the personas, and the expense picker", async () => {
  // L-14: UC-01's self-service letter is the eighth — the destination G-2's
  // deflection message has promised since it landed.
  const res = await callApi(handler, { method: "GET", path: "/api/context" });
  assert.equal(res.status, 200);
  assert.equal(res.body.requestTypes.length, 8);
  assert.deepEqual(
    res.body.requestTypes.map((t) => t.id),
    ["uc01", "uc02", "uc03", "uc04", "uc05", "uc07", "uc08", "uc09"]
  );
  // Every type ships its tier, description and humanControl, because the page
  // has no copy of its own.
  for (const type of res.body.requestTypes) {
    assert.ok(["low", "medium", "high"].includes(type.tier));
    assert.ok(type.description.length > 20);
    assert.ok(type.humanControl.length > 20);
  }

  assert.equal(res.body.personas.length, Object.keys(PERSONAS).length);
  // The session objects are the server's own and must never be shipped.
  for (const persona of res.body.personas) {
    assert.equal(persona.session, undefined, "a persona's session must never reach the browser");
  }

  // R7-42 / D-02: the page must not fall back to insertion order for its
  // default persona — the server names one explicitly, and it must be a
  // persona actually offered in the list above.
  assert.ok(res.body.defaultPersonaId, "the context response must name a default persona");
  assert.ok(
    res.body.personas.some((p) => p.id === res.body.defaultPersonaId),
    "the named default persona must be one of the offered personas"
  );

  // Money leaves the API in human units — the mock stores 12500 (×100).
  const clean = res.body.expenses.find((e) => e.id === "exp_auto_101");
  assert.ok(clean, "the picker must offer the mock's expense fixtures");
  assert.equal(clean.amount, 125);
  assert.equal(clean.currency, "USD");
});

test("an unknown request type 404s rather than guessing", async () => {
  const res = await post("uc42", { persona: "chris" });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "unknown_request_type");
});

test("an unknown persona is refused rather than defaulted — the identity gate's own fail-closed shape", async () => {
  const res = await post("uc02", { persona: "definitely-not-a-persona", expenseId: "exp_auto_101" });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "unauthenticated");
});

test("L-14: UC-01 self-service — an active, complete, eligible employee is issued the letter with no ticket", async () => {
  const res = await post("uc01", { persona: "chris" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_resolve");
  assert.match(res.body.letterHtml, /Employment Verification Letter/);
  assert.equal(res.body.ticketCreated, false, "self-service must never raise a ticket — see ticketing.js's NO_TICKET_DECISIONS");
  // F-8: this used to fall through to the 🔴 UC-07/UC-08 sentence ("this use
  // case has no execution path…") because "uc01" was not a key in
  // NO_TICKET_DECISIONS at all — served on a 🟢 use case that had just issued
  // a letter. It must read the true reason: nobody has to look at an
  // auto-resolved decision.
  assert.match(res.body.ticketNote, /needs no human/i);
  assert.doesNotMatch(res.body.ticketNote, /no execution path/i);
});

test("L-14: UC-01 self-service — an admin persona is refused; this letter is issued to the employee it is about", async () => {
  const res = await post("uc01", { persona: "admin" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_self_serve");
});

test("L-14: UC-01 self-service — a non-active employment is refused, not silently issued", async () => {
  const res = await post("uc01", { persona: "thomas" }); // archived, per personas.js
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "employee_not_active");
});

test("rca-etp9 (round-7 R7-03): the employee's free-text note reaches the request payload and is durably stored, without changing the decision or the letter", async () => {
  const stores = freshStores();
  const noteHandler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  const postNote = (body) => callApi(noteHandler, { method: "POST", path: "/api/requests/uc01", body });

  const withNote = await postNote({ persona: "chris", note: "This is for a mortgage application with my bank." });
  assert.equal(withNote.status, 200);
  assert.equal(withNote.body.decision, "auto_resolve");
  assert.equal(withNote.body.reason, "self_service_all_gates_passed");

  // NEVER READ BY THE GATES OR THE TEMPLATE — the decision and the rendered
  // letter are identical with or without a note (src/uc01/selfServiceLetter.js's
  // own header: "the only free-text field ... plays no part in whether the
  // letter issues").
  assert.match(withNote.body.letterHtml, /Employment Verification Letter/);
  assert.doesNotMatch(withNote.body.letterHtml, /mortgage application/i);

  // AND IT ACTUALLY REACHED THE SERVER — stored as its own document tied to
  // the case, not merely accepted and dropped.
  const noteDocs = stores.uc01.documents.filter(
    (d) => d.caseId === withNote.body.recordId && d.type === "employee_note"
  );
  assert.equal(noteDocs.length, 1);
  assert.equal(noteDocs[0].content, "This is for a mortgage application with my bank.");

  // AN EMPTY BOX IS NOT A NOTE — omitting it (or sending only whitespace)
  // stores nothing, the same "null means they did not say" rule UC-03's
  // optional boxes already follow.
  const blank = await postNote({ persona: "emma", note: "   " });
  assert.equal(blank.status, 200);
  const blankNoteDocs = stores.uc01.documents.filter((d) => d.caseId === blank.body.recordId && d.type === "employee_note");
  assert.equal(blankNoteDocs.length, 0);
});

test("rca-0jya (R7-41): a joined self-service duplicate tells the employee WHEN the hold clears, and does not claim a permanent 'exact reference' block it does not have", async () => {
  // A pgPool-backed store, unlike the shared `handler` above (no pgPool, so
  // the join path is unreachable there — see workflowClaims.js's documented
  // degradation) — same fake `workflow_claims` shape
  // test/selfServiceLetterDedup.test.js uses for the identical reason.
  function fakeClaimsPool() {
    const claims = new Map();
    return {
      async query(sql, params = []) {
        const q = sql.replace(/\s+/g, " ").trim();
        if (/^insert into workflow_claims/i.test(q)) {
          const [useCase, externalRef, decision] = params;
          const key = `${useCase} ${externalRef}`;
          if (claims.has(key)) return { rows: [], rowCount: 0 };
          claims.set(key, decision);
          return { rows: [{ external_ref: externalRef }], rowCount: 1 };
        }
        if (/^select decision from workflow_claims/i.test(q)) {
          const [useCase, externalRef] = params;
          const decision = claims.get(`${useCase} ${externalRef}`);
          return decision === undefined ? { rows: [], rowCount: 0 } : { rows: [{ decision }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  const stores = freshStores();
  stores.uc01 = new CaseStore({ pgPool: fakeClaimsPool() });
  const dedupHandler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  const postDedup = (body) => callApi(dedupHandler, { method: "POST", path: "/api/requests/uc01", body });

  const first = await postDedup({ persona: "chris" });
  const second = await postDedup({ persona: "chris" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyHandled, true);
  assert.equal(second.body.alreadyHandledKind, "delivery");
  assert.equal(second.body.duplicateDelivery, true);

  // THE FIX: the employee is told WHEN this stops applying, not left to
  // wonder whether it is permanent.
  assert.equal(typeof second.body.duplicateWindowExpiresAt, "string");
  const expiresAt = new Date(second.body.duplicateWindowExpiresAt);
  assert.ok(!Number.isNaN(expiresAt.getTime()));
  assert.ok(expiresAt.getTime() > Date.now(), "the reported expiry must be in the future");
  assert.ok(expiresAt.getTime() <= Date.now() + 60 * 60 * 1000, "must fall within the one-hour self-service window");

  // AND THE WORDING NO LONGER BORROWS THE OTHER SIX ADAPTERS' PERMANENT-KEY
  // EXPLANATION, which names an "exact reference" self-service never asked
  // the employee for and never expires.
  assert.match(second.body.duplicateExplanation, /hour/i);
  assert.doesNotMatch(
    second.body.duplicateExplanation,
    /exact reference/i,
    "self-service's own explanation must not claim a permanent, reference-keyed block it does not have"
  );
});

// ---------------------------------------------------------------------------
// 3. The seven request types, each against its REAL workflow
// ---------------------------------------------------------------------------

test("UC-02: a clean claim auto-approves, and the response carries the server's own description of the type", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_clean_401", externalRef: "portal-2001" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "auto_approve");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.deepEqual(res.body.flags, []);
  assert.ok(res.body.recordId, "the stored expense record's id must come back");

  // Descriptive fields come from requestTypes.js via the server, never the page.
  assert.equal(res.body.useCase, "UC-02");
  assert.equal(res.body.tier, "low");
  assert.equal(res.body.executionPath, "auto");
  assert.equal(res.body.recordLabel, "Expense record");
  // AND THE ROWS THAT ARE THE SPECIALIST'S ARE NOT ON IT. "Category decided by"
  // — whether a model or the keyword fallback picked the Remote category — used
  // to be asserted here as PRESENT on the requester's payload. It is now
  // routed: server.js publishes it as a specialistDetail(), so it reaches the
  // Zendesk note the Finance Ops reviewer opens and not the panel of the person
  // who filed a lunch receipt. test/portalRequesterFacts.test.js proves both
  // halves of that in one run.
  const labels = res.body.details.map((d) => d.label);
  for (const routed of ["Category decided by", "Category", "Decided by", "Risk tier recorded"]) {
    assert.ok(!labels.includes(routed), `"${routed}" is the specialist's row and is on the requester's panel`);
  }
});

test("UC-02: a claim over the category cap is routed to a human, not waved through", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_over_cap_402", externalRef: "portal-2002" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "human_review");
  assert.equal(res.body.reason, "over_policy_cap");
  assert.deepEqual(res.body.flags, ["over_policy_cap"]);

  // AND IT SAYS BY HOW MUCH. The refusal used to report only the verdict; a
  // tester reading the Zendesk note built from these very `details` could not
  // see the amount, the cap, or the overage.
  //
  // THE WORKED EXAMPLE, and note WHICH cap it lands against. The fixture
  // exp_sandbox_over_cap_402 is 88000 ($880.00) and its RECORDED category is
  // meals — but its title is "Whole-department dinner at the New York
  // offsite", and the classifier resolves that to EXTERNAL meals and
  // entertainment, whose cap is 30000 ($300.00), not internal meals' 50000.
  // That is the classifier doing its job, and it is why this end-to-end
  // assertion and the describer's unit test in test/uc02Review.test.js quote
  // different caps: this one is the real pipeline, that one is the pure
  // function given a cap directly.
  //
  //   88000 - 30000 = 58000  ->  $580.00 over
  //   58000 / 30000 = 1.9333 ->  193.3%
  //
  // Asserted here and not only against the describer, because this is the
  // exact string that reaches the specialist's Zendesk note.
  const cap = res.body.details.find((d) => d.label === "Cap comparison");
  assert.ok(cap, "an over-cap refusal must state the figures it compared");
  assert.match(cap.value, /880\.00 USD/);
  assert.match(cap.value, /300\.00 USD/);
  assert.match(cap.value, /580\.00 USD/);
  assert.match(cap.value, /193\.3% over/);
  // Never the raw x100 integers: rendering one as currency is a 100x error in
  // front of somebody authorising a payment.
  assert.ok(!cap.value.includes("88000") && !cap.value.includes("30000"));
});

test("UC-02: a clean expense carries no cap row, because there was no cap refusal", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_clean_401", externalRef: "portal-2404" });
  assert.equal(res.body.decision, "auto_approve");
  // The row is ABSENT rather than blank. `details` is spread verbatim into the
  // Zendesk internal note, so an empty row would be a blank line in a
  // specialist's inbox.
  assert.equal(res.body.details.find((d) => d.label === "Cap comparison"), undefined);
});

test("UC-02: claiming someone else's expense fails the ownership gate", async () => {
  // exp_sandbox_other_owner_403 belongs to James; the session is Chris's. The
  // claim is otherwise clean, so ownership is the only gate that can refuse it.
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_other_owner_403", externalRef: "portal-2003" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "expense_employment_mismatch");
});

test("UC-02: an admin cannot file an employee's expense claim", async () => {
  const res = await post("uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_claim");
});

test("UC-03: a plainly-safe business trip auto-resolves", async () => {
  const res = await post("uc03", {
    persona: "chris",
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
    externalRef: "portal-3001",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_resolve");
  assert.equal(res.body.tier, "low");
  assert.ok(res.body.details.some((d) => d.label === "Informational answer"));
});

test("UC-03: a workation is handed to UC-04 rather than answered here", async () => {
  const res = await post("uc03", {
    persona: "chris",
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    externalRef: "portal-3002",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "route_to_uc04");
  // `Routed to: uc04_work_authorization` is the name of the route inside this
  // system and is now a specialistDetail(). What the requester is told instead
  // is a sentence — the plain answer's — and an offer they can act on.
  assert.ok(!res.body.details.some((d) => d.label === "Routed to"), "the routing key is on the requester's panel");
  // WHAT THE LEAD HAS TO BE, rather than what it currently says. This line read
  // `/different request/` and broke the moment that sentence was rewritten
  // (commit 0674261, "'Not answered' was not true, and the rest of it was about
  // us") — a test quoting one clause of somebody else's copy fails on an
  // improvement to it and says nothing about the property it was written for.
  // The property is that the traveller is told about THEIR trip in a sentence,
  // and never handed the name this system gave the route.
  assert.match(res.body.plainAnswer.lead, /Portugal/, "the lead does not mention where they asked to work from");
  assert.ok(
    !/uc-?0\d|work_authorization/i.test(res.body.plainAnswer.lead),
    `the route's own name is in the sentence the requester reads: ${res.body.plainAnswer.lead}`
  );
});

test("UC-03: a non-active employee's inquiry fails the employment gate", async () => {
  const res = await post("uc03", {
    persona: "thomas",
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026.",
    externalRef: "portal-3003",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "employee_not_active");
});

test("UC-04: a low-risk Schengen trip is prepared for the single mobility specialist", async () => {
  const res = await post("uc04", {
    persona: "admin",
    employmentId: "emp_active_001",
    homeCountry: "DE",
    nationality: "DE",
    destinationCountry: "ES",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    reasonText: "Two weeks with the Madrid team.",
    externalRef: "portal-4001",
    now: "2026-08-15",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.equal(res.body.tier, "medium");
  assert.equal(res.body.executionPath, "single_approver");
  // Travel history is sent empty, and the result says the count is a floor
  // rather than presenting an unknown as a confirmed zero.
  const cumulative = res.body.details.find((d) => d.label === "Cumulative days abroad");
  assert.match(cumulative.value, /a floor, not a count/);
});

test("UC-04: a same-country 'workation' is blocked by the real risk matrix", async () => {
  const res = await post("uc04", {
    persona: "admin",
    employmentId: "emp_active_001",
    homeCountry: "NG",
    nationality: "NG",
    destinationCountry: "NG",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay", // irrelevant — the same-country block fires first
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    externalRef: "portal-4002",
    now: "2026-08-15",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "blocked");
  assert.equal(res.body.reason, "same_country_workation");
});

// ---------------------------------------------------------------------------
// THE SLUG IN PLAIN WORDS, ON THE FOUR USE CASES THAT WERE STILL SHOWING ONLY
// THE SLUG.
// ---------------------------------------------------------------------------
// UC-02's adapter has carried `decidedBy`/`gateLadder`/"What happened" since
// the gate ladder was built. UC-03, UC-04, UC-05 and UC-09 grew the identical
// per-reason `means` beside their own gates (src/shared/gateLadder.js) and
// their own APIs already returned it — and this adapter layer read none of it,
// so a portal submission to any of those four printed `same_country_workation`
// and stopped. The system held the sentence and rendered the identifier.
//
// It reaches past the page: `details` is what buildTicketNote() writes into
// the Zendesk internal note, so the specialist opening the hand-off got the
// identifier too.
//
// Every assertion below comes in a pair — the specific words ARE there, and
// the bare slug is NOT all that is there. The slug itself must survive on
// `reason`, because it is the exact string in `audit_log`, in the metrics
// exception ranking and in the n8n ports.
// ---------------------------------------------------------------------------

test("UC-04: a refusal is explained in words, with the slug kept beside it", async () => {
  const res = await post("uc04", {
    persona: "admin",
    employmentId: "emp_active_001",
    homeCountry: "NG",
    nationality: "NG",
    destinationCountry: "NG",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    externalRef: "portal-4090",
    now: "2026-08-15",
  });
  assert.equal(res.status, 200);
  // The machine-readable slug survives untouched.
  assert.equal(res.body.reason, "same_country_workation");
  // And the words are now there beside it.
  assert.ok(res.body.decidedBy, "no decidedBy on a UC-04 decision");
  assert.ok(res.body.decidedBy.means.length > 20, "decidedBy.means is not a sentence");
  assert.notEqual(res.body.decidedBy.means, res.body.reason);
  const what = res.body.details.find((d) => d.label === "What happened");
  assert.ok(what, "no 'What happened' row — the panel and the ticket note both read this");
  assert.equal(what.value, res.body.decidedBy.means);
  // "gate 4 of 18 — risk_matrix, which checks that..." is the SPECIALIST'S row
  // now: a coordinate in an ordering this repository owns, useful to whoever
  // re-examines the case and inert to the person who filed it, whose answer is
  // the plain-words sentence one row up. It is still published — as a
  // specialistDetail(), so buildTicketNote() prints it — and
  // test/portalRequesterFacts.test.js drives a real hand-off and reads it back
  // out of the created ticket.
  assert.equal(
    res.body.details.find((d) => d.label === "Decided by"),
    undefined,
    "the gate coordinate is still on the requester's panel"
  );
  // And the whole ladder is sent as data, so the page prints an order it never
  // learns.
  assert.ok(Array.isArray(res.body.gateLadder) && res.body.gateLadder.length > 1);
  assert.equal(res.body.gateLadder.filter((r) => r.status === "decided").length, 1);
});

test("UC-03, UC-05 and UC-09 carry the same words-plus-slug pair", async () => {
  const uc03 = await post("uc03", {
    persona: "chris",
    text: "Can I work from Portugal for three weeks in September?",
    externalRef: "portal-3090",
  });
  assert.equal(uc03.status, 200);
  assert.ok(uc03.body.decidedBy, "UC-03 sent no decidedBy");
  assert.notEqual(uc03.body.decidedBy.means, uc03.body.reason);
  assert.equal(uc03.body.details.find((d) => d.label === "What happened").value, uc03.body.decidedBy.means);

  const uc05 = await post("uc05", {
    persona: "chris",
    proposedEndDate: "2026-09-30",
    externalRef: "portal-5090",
    now: "2026-08-15",
  });
  assert.equal(uc05.status, 200);
  assert.ok(uc05.body.decidedBy, "UC-05 sent no decidedBy");
  assert.notEqual(uc05.body.decidedBy.means, uc05.body.reason);

  // UC-09 on a terminated employment stops at a real gate, so the words are
  // there. (Its amount-parser refusals — `amount_not_extracted` /
  // `unparseable_amount` — are produced by the WORKFLOW rather than by an
  // ordered gate in evaluate(), so they have no GATE_SEQUENCE row and
  // describeDecidingGate() honestly returns null. The next test pins what the
  // adapter does in that case; whether those two belong in the ladder is a
  // question about where the ladder's boundary is, not a rendering bug.)
  const uc09 = await post("uc09", {
    persona: "admin",
    employmentId: "emp_terminated_002",
    requestText: "Pay a 500 EUR referral bonus this month.",
    externalRef: "portal-9090",
    now: "2026-08-15",
  });
  assert.equal(uc09.status, 200);
  assert.ok(uc09.body.decidedBy, "UC-09 sent no decidedBy");
  assert.notEqual(uc09.body.decidedBy.means, uc09.body.reason);
  assert.equal(uc09.body.details.find((d) => d.label === "What happened").value, uc09.body.decidedBy.means);
});

test("a reason with no gate row says so, rather than a page silently showing nothing", async () => {
  // The honest degradation. describeDecidingGate() returns null for a reason it
  // has no row for — never a fabricated gate position, which would read like a
  // real one. The adapter must then SAY that, because a missing row is a
  // different fact from a gate having nothing to say, and a "What happened"
  // line that silently vanished would be indistinguishable from the feature
  // never having been wired.
  const res = await post("uc09", {
    persona: "admin",
    employmentId: "emp_active_001",
    requestText: "Please pay something extra, thanks.", // no figure to parse
    externalRef: "portal-9091",
    now: "2026-08-15",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decidedBy, null);
  // THE ROW IS STILL PUBLISHED AND IT IS NOW THE SPECIALIST'S. Its sentence
  // describes a gap in THIS REPOSITORY'S OWN TABLES — "no row in this use
  // case's gate sequence describes the reason ..." — which is a work item for
  // whoever maintains the ladder and is unreadable to the person who asked for
  // a payment. What happened to their request is still answered, in a sentence,
  // by the plain answer at the top of the panel, which is composed from the
  // decision class and needs no gate row to exist.
  assert.equal(
    res.body.details.find((d) => d.label === "What happened"),
    undefined,
    "an account of our own missing gate row reached the requester"
  );
  assert.ok(res.body.plainAnswer.lead.length > 20, "the requester was left with nothing at all");
  // The ladder is empty rather than a sequence of guessed statuses.
  // The ladder is empty rather than a sequence of guessed statuses.
  assert.deepEqual(res.body.gateLadder, []);
});

test("app.js renders no gate machinery on the requester's panel at all", () => {
  // WHAT THIS TEST USED TO ASSERT, and why it is the opposite now.
  //
  // It pinned a bug fix: the gate note was rendered only `if
  // (payload.decidedBy.note)`, and only UC-02's describeDecidingGate() produces
  // a `note`, so the four use cases publishing a shared ladder had their gate
  // line and their whole ladder dropped by a truthiness test on a field one of
  // five happens to carry. The fix was right and the thing it fixed should not
  // have been on this page: "Decided by gate 12 of 16 — Policy cap", that
  // gate's PASSING condition (which says the opposite of what happened on a
  // refusal), sixteen collapsed rungs each with a "Checks:" line, and a
  // paragraph ending in a citation to `docs/GATES.md`. None of it answers what
  // happened to my request, whether I must do anything, who has it, or how I
  // collect what was produced.
  //
  // It is not deleted from the system: `payload.gateLadder` and
  // `payload.decidedBy` are still on the envelope for a surface built for the
  // specialist (the ZAF sidebar renders both), and the deciding gate travels to
  // the Zendesk note as its own labelled row. This page is simply no longer a
  // surface that draws it.
  // COMMENTS STRIPPED FIRST. Removing a block from this file leaves a comment
  // behind saying what was removed and why — that is the repository's house
  // style and it is how the next reader learns not to put it back. A source
  // search that did not strip them would read those explanations as the code
  // they describe, which is the same mistake the structural no-write-path tests
  // in src/uc07/ and src/uc08/ already avoid the same way.
  const app = read("app.js")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/gateLadder\(payload\.gateLadder\)/.test(app), "the gate ladder is still rendered on the result panel");
  assert.ok(!/function gateLadder\(/.test(app), "the ladder renderer is still here, one wiring away from coming back");
  assert.ok(!/That gate checks: /.test(app), "the deciding gate's passing condition is still printed");
  assert.ok(!/Decided by gate /.test(app), "the gate coordinate is still printed");
  assert.ok(!/docs\/GATES\.md/.test(app), "a path in the source tree is still printed to the requester");
  assert.ok(!/reason-slug/.test(app), "the raw reason slug is still rendered beside the sentence");

  // AND THE SENTENCE THAT REPLACED IT IS STILL RENDERED. Removing the machinery
  // must not remove the one part of it that answered a reader's question — the
  // deciding gate's plain-words `means`, which is the reason paragraph.
  assert.ok(
    /if \(payload\.decidedBy && payload\.decidedBy\.means\) \{/.test(app),
    "the deciding gate's plain-words sentence is no longer rendered either"
  );
});

test("UC-04: an employee cannot file a workation request on their own behalf", async () => {
  const res = await post("uc04", { persona: "chris", employmentId: "emp_active_001", destinationCountry: "ES" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_request");
});

test("UC-05: a UK resignation within statute is prepared for HR Ops sign-off, with a real PTO payout", async () => {
  const res = await post("uc05", {
    persona: "emma",
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
    reason: "new opportunity",
    ptoType: "vacation",
    ptoDaysAccrued: "18",
    ptoDaysUsed: "6",
    ptoHourlyRate: "32.50",
    currency: "GBP",
    externalRef: "portal-5001",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff");
  assert.equal(res.body.executionPath, "single_approver");
  // "Date came from: structured_input" is the SPECIALIST'S row now — the HR Ops
  // signatory needs to know whether the date they are confirming was typed or
  // extracted from a pasted letter; the employee typed it and knows.
  assert.equal(
    res.body.details.find((d) => d.label === "Date came from"),
    undefined,
    "the extraction-source slug is on the requester's panel"
  );
  const payout = res.body.details.find((d) => d.label === "PTO payout");
  assert.match(payout.value, /GBP/, "the payout must be reported in human units with its currency");
  // WHERE THE BALANCES CAME FROM, IN WORDS AND NOT AS THE SOURCE TAG. The line
  // used to end `(time_off_records)` — an identifier from a table the resigning
  // employee has never seen, in brackets, after their money. The FACT is kept:
  // a payout worked out from recorded leave and a payout of zero because none
  // is recorded are different statements, and the second is the one a reader
  // would otherwise supply from memory.
  assert.doesNotMatch(payout.value, /time_off_records/, "the reconciler's own source tag is still printed raw");
  assert.match(payout.value, /leave balances on record/, "where the figure came from must still be said");
});

test("UC-05: a proposed date shorter than statutory notice is a discrepancy, never a silent acceptance", async () => {
  const res = await post("uc05", {
    persona: "joao",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
    reason: "family reasons",
    externalRef: "portal-5002",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "statutory_discrepancy");
  assert.ok(res.body.flags.includes("discrepancy_earlier_than_statutory"));
});

test("UC-05: with no accrued days sent, the payout reports no records rather than a zero it never computed", async () => {
  const res = await post("uc05", {
    persona: "anna",
    proposedEndDate: "2026-10-31",
    now: "2026-08-10",
    currency: "EUR",
    externalRef: "portal-5003",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff");
  // Said in words rather than as `no_time_off_records`. The absence is the
  // point of this test and it survives the rewording — see ptoSourceWords().
  assert.match(
    res.body.details.find((d) => d.label === "PTO payout").value,
    /no leave balances are recorded/,
    "a zero payout must still say WHY it is zero"
  );
});

// --- finding F-30: the adapter must not manufacture a rate it was not given ---
//
// UC-05's reconciler refuses a balance it cannot multiply (F-28), and UC-07's
// gate refuses a cashout it cannot derive (F-29). Both refusals are reachable
// only if the ABSENCE survives the adapter. buildTimeOffBalances() used to
// close the hole it was standing in front of: `Number.isFinite(hourlyRate)
// ? toRemoteInteger(hourlyRate) : 0`, with `Number("") === 0` making even the
// guarded branch produce a zero. A well-formed balance with a zero rate on 8
// genuinely accrued days reconciles to a confident 0.00 — an underpayment a
// human signs off on, with `pto_balance_unusable` unreachable through this
// entry point because the evidence was destroyed one layer earlier.
//
// The adapter decides nothing about it. It preserves the absence and UC-05's
// gate — the only place that judgement belongs — does the refusing.

test("UC-05 adapter: a blank hourly-rate box stays missing all the way into the real reconciler", () => {
  for (const [label, body] of [
    ["blank string", { ptoDaysAccrued: "8", ptoDaysUsed: "", ptoHourlyRate: "" }],
    ["field absent entirely", { ptoDaysAccrued: "8" }],
    ["unreadable", { ptoDaysAccrued: "8", ptoHourlyRate: "thirty-two fifty" }],
  ]) {
    const balances = buildTimeOffBalances(body);
    assert.equal(balances.length, 1, `${label}: 8 accrued days is a balance, not "no records"`);
    assert.ok(
      !("hourlyRateInRemoteInteger" in balances[0]) || balances[0].hourlyRateInRemoteInteger === undefined,
      `${label}: the adapter invented an hourly rate`
    );

    // …and pushed through UC-05's own reconciler, unchanged, it refuses.
    const payout = reconcilePtoPayout({ balances, currency: "EUR" });
    assert.equal(payout.computable, false, `${label}: a rate we never had produced a computable payout`);
    assert.equal(payout.totalInRemoteInteger, null, `${label}: a payout total was invented`);
    assert.deepEqual(payout.unusableLines[0].missing, ["hourlyRateInRemoteInteger"], `${label}: wrong field named`);
  }
});

test("UC-05 adapter: a blank days-used box is omitted, not sent as an explicit zero string", () => {
  // The reconciler documents daysUsed as optional but REFUSES `""`. Sending a
  // blank box through raw would escalate every request that left an optional
  // field alone; sending `0` would be the adapter answering a question nobody
  // asked. Omitting the key lets the reconciler apply its own documented rule.
  const balances = buildTimeOffBalances({ ptoDaysAccrued: "8", ptoDaysUsed: "", ptoHourlyRate: "20" });
  assert.ok(!("daysUsed" in balances[0]) || balances[0].daysUsed === undefined, "a blank days-used box became a value");
  assert.equal(reconcilePtoPayout({ balances, currency: "EUR" }).computable, true, "an optional blank must not refuse the line");
});

test("UC-05 adapter: an unreadable accrual is refused, never reported as 'no records'", () => {
  const balances = buildTimeOffBalances({ ptoDaysAccrued: "eight", ptoHourlyRate: "32.50" });
  assert.equal(balances.length, 1, "an unreadable accrual is not the same fact as an empty PTO section");
  const payout = reconcilePtoPayout({ balances, currency: "EUR" });
  assert.equal(payout.computable, false);
  assert.deepEqual(payout.unusableLines[0].missing, ["daysAccrued"]);
});

test("UC-05: a resignation with accrued days and a blank rate escalates as pto_balance_unusable", async () => {
  const res = await post("uc05", {
    persona: "anna",
    proposedEndDate: "2026-10-31",
    now: "2026-08-10",
    currency: "EUR",
    ptoType: "vacation",
    ptoDaysAccrued: "8",
    ptoDaysUsed: "",
    ptoHourlyRate: "",
    externalRef: "portal-5004",
  });
  assert.equal(res.status, 200, "the refusal must be a decision, not a crash");
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "pto_balance_unusable");
  assert.ok(res.body.flags.includes("pto_balance_unusable"));
  assert.ok(res.body.flags.includes("pto_missing_hourlyRateInRemoteInteger"), "the escalation must name the missing field");
  const payout = res.body.details.find((d) => d.label === "PTO payout").value;
  assert.ok(!/0\.00/.test(payout), `the page must not state a payout figure it never derived: ${payout}`);
  assert.match(payout, /hourlyRateInRemoteInteger/, "the page must name what was missing");
});

test("UC-05: a rate that IS supplied still produces the real payout — the fix refuses absence, not everything", async () => {
  // 18 accrued - 6 used = 12 days x 8h x 32.50/h = 3120.00 GBP.
  // The counterpart to the refusal above: a fail-closed change that refuses
  // valid input passes every negative assertion and is the most expensive
  // failure mode on this project (docs/BUILD-LOG.md §3.30). This is the test
  // that would catch it. It passes before AND after the fix, by design.
  const res = await post("uc05", {
    persona: "emma",
    // Emma's GB bracket is 35 days (ERA 1996 §86), so the date has to clear it
    // for this test to be about the PAYOUT rather than about the notice period.
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
    ptoType: "vacation",
    ptoDaysAccrued: "18",
    ptoDaysUsed: "6",
    ptoHourlyRate: "32.50",
    currency: "GBP",
    externalRef: "portal-5005",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff");
  assert.ok(!res.body.flags.includes("pto_balance_unusable"), "a complete balance must not be refused");
  assert.equal(
    res.body.details.find((d) => d.label === "PTO payout").value,
    "3120.00 GBP — from the leave balances on record"
  );
});

test("UC-05: an explicit zero rate is the requester's answer, and is computed — not refused", () => {
  // "the user said zero" and "we don't know" are different facts, and only one
  // of them is safe to compute with. This pins the first: a typed 0 still
  // reconciles, so the fix cannot be read as "blank and zero are the same".
  const payout = reconcilePtoPayout({
    balances: buildTimeOffBalances({ ptoDaysAccrued: "8", ptoDaysUsed: "0", ptoHourlyRate: "0" }),
    currency: "EUR",
  });
  assert.equal(payout.computable, true);
  assert.equal(payout.totalInRemoteInteger, 0);
});

test("UC-07: a feasible relocation still only ever compiles a dossier — the decision is escalate", async () => {
  const res = await post("uc07", {
    text: "We're permanently relocating our engineer from Spain to the Netherlands. She already has the right to work there. Source last working day June 30, destination start July 1.",
    employmentId: "emp_active_001",
    externalRef: "portal-7001",
    salary: "65000",
    minimumVisaSalary: "55000",
    currency: "EUR",
    months: "12",
    creationDate: "2026-05-01",
    proposedStartDate: "2026-07-01",
    destinationStartDate: "2026-07-01",
    sourceTerminationDate: "2026-06-30",
    sourceLastWorkingDay: "2026-06-30",
    destinationSupported: true,
    immigrationSupportRequired: false,
    immigrationConfirmed: true,
    rightToWorkConfirmed: true,
    destinationStartDateConfirmed: true,
    sourceExitPlanValidated: true,
    employerPresenceInDestination: true,
    taxTreatyNexusConfirmed: true,
    ptoTransferAllowed: true,
    sourcePtoDays: "12",
    seniorityPreservable: "yes",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.tier, "high");
  assert.equal(res.body.executionPath, "none", "UC-07 must advertise no execution path");
  assert.match(res.body.reason, /PROCEED/, "a feasible plan still escalates — the verdict is the dossier's, not an action");
  // The fees the form deliberately does not collect stay honest as a pending
  // quote rather than being rendered as a zero cost.
  assert.match(res.body.details.find((d) => d.label === "Cost estimate").value, /awaiting quotes/);
});

test("UC-07: an unsupported destination and a below-minimum salary produce a BLOCK verdict, still with no execution path", async () => {
  const res = await post("uc07", {
    text: "Moving our contractor to a country that isn't on the supported list, full time. The salary offered is below the visa minimum.",
    externalRef: "portal-7002",
    salary: "40000",
    minimumVisaSalary: "55000",
    currency: "USD",
    destinationSupported: false,
    immigrationConfirmed: false,
    rightToWorkConfirmed: false,
    destinationStartDateConfirmed: false,
    sourceExitPlanValidated: false,
    employerPresenceInDestination: false,
    taxTreatyNexusConfirmed: false,
    ptoTransferAllowed: false,
    sourcePtoDays: "18",
    seniorityPreservable: "unknown",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.match(res.body.reason, /BLOCK/);
  assert.ok(res.body.flags.includes("UC07_DESTINATION_COUNTRY_UNSUPPORTED"));
  assert.ok(res.body.flags.includes("UC07_SALARY_BELOW_VISA_MINIMUM"));
  // "unknown" seniority is a real answer, and a different one from "resets".
  assert.match(res.body.details.find((d) => d.label === "Seniority").value, /REVIEW/i);
});

// --- finding F-30, second site: the same shape one adapter line down --------
//
// UC-07's F-29 fix changed `sourcePtoDays`' default from 0 to null in the gate
// itself, because "nobody counted the balance" and "the balance is zero" are
// different facts. buildRelocationPlan() then rebuilt the zero on the way in
// with `Number(body.sourcePtoDays) || 0`, so a blank day-count box arrived at
// the gate as a counted zero: LIQUIDATE, 0 days, nothing owed, computable —
// and UC07_PTO_CASHOUT_NOT_COMPUTABLE unreachable through this entry point on
// the days axis. The salary axis was already honest here (`money()` yields
// undefined for a blank box), which is why the day count survived review.

test("UC-07: a blank PTO day count reaches the gate as unknown, not as a counted zero", async () => {
  const res = await post("uc07", {
    text: "Permanent relocation from Spain to the Netherlands, full time.",
    externalRef: "portal-7003",
    salary: "65000",
    currency: "EUR",
    ptoTransferAllowed: false, // so the balance is LIQUIDATED and a figure is owed
    sourcePtoDays: "", // …and nobody has counted it
  });
  assert.equal(res.status, 200);
  assert.ok(
    res.body.flags.includes("UC07_PTO_CASHOUT_NOT_COMPUTABLE"),
    `an uncounted balance must be flagged, not settled at zero: ${JSON.stringify(res.body.flags)}`
  );
  const pto = res.body.details.find((d) => d.label === "PTO decision").value;
  assert.ok(!/\b0 days\b/.test(pto), `the dossier must not state a day count nobody produced: ${pto}`);
});

test("UC-07: a PTO day count that IS given still cashes out — the refusal is of absence, not of the field", async () => {
  const res = await post("uc07", {
    text: "Permanent relocation from Spain to the Netherlands, full time.",
    externalRef: "portal-7004",
    salary: "66000", // 66,000/mo ÷ 22 working days × 11 days = 33,000.00
    currency: "EUR",
    ptoTransferAllowed: false,
    sourcePtoDays: "11",
  });
  assert.equal(res.status, 200);
  assert.ok(!res.body.flags.includes("UC07_PTO_CASHOUT_NOT_COMPUTABLE"), "a counted balance must not be refused");
  assert.match(res.body.details.find((d) => d.label === "PTO decision").value, /11 days/);
});

test("UC-07: an explicit zero PTO balance is a real answer and settles at zero", async () => {
  const res = await post("uc07", {
    text: "Permanent relocation from Spain to the Netherlands, full time.",
    externalRef: "portal-7005",
    salary: "65000",
    currency: "EUR",
    ptoTransferAllowed: false,
    sourcePtoDays: "0",
  });
  assert.equal(res.status, 200);
  assert.ok(!res.body.flags.includes("UC07_PTO_CASHOUT_NOT_COMPUTABLE"), "a counted zero is derivable, and derives to zero");
  assert.match(res.body.details.find((d) => d.label === "PTO decision").value, /0 days/);
});

test("UC-07: a relocation with no description is refused rather than guessed at", async () => {
  const res = await post("uc07", { text: "   " });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "text_required");
});

test("UC-08: a withholding question counts presence days deterministically and cites a retrieved passage", async () => {
  const res = await post("uc08", {
    text: "I've been asked to work from our London office for a few months. Do we need to withhold UK payroll tax for this?",
    employmentId: "emp_active_001",
    externalRef: "portal-8001",
    targetCountry: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
    presencePeriods: [
      { country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" },
      { country: "", startDate: "", endDate: "" }, // a blank row is dropped, never padded
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.executionPath, "none", "UC-08 must advertise no execution path");
  const presence = res.body.details.find((d) => d.label === "Presence days");
  // "distinct" / "overlaps counted once" is load-bearing wording, not
  // decoration: the count is the UNION of calendar days (F-22), so a day
  // recorded twice upstream cannot double the 183-day figure a specialist reads
  // here. "N of M supplied record(s)" is load-bearing for the same kind of
  // reason (F-40): it is what lets a reader tell a zero computed from real
  // records apart from a zero computed from none, and it shows immediately if
  // fewer records were counted than were supplied.
  assert.match(
    presence.value,
    /^92 distinct day\(s\) in United Kingdom between 2026-01-01 and 2026-12-31 \(1 of 1 supplied record\(s\) fell in that country and window; overlaps counted once\)$/
  );
  // "Treaty passages cited: OECD Model Tax Convention, Article 15 ... (short-term
  // assignment,183 days)" is the retriever describing HOW it found each passage
  // — provenance of a list, which is what the tax specialist checks and not a
  // statement about the asker's tax position. Routed to the ticket; the
  // narrative and the mandatory framing line are what the requester reads.
  assert.equal(
    res.body.details.find((d) => d.label === "Treaty passages cited"),
    undefined,
    "the retrieval provenance is on the requester's panel"
  );
  assert.match(res.body.details.find((d) => d.label === "Framing").value, /RESEARCH SUPPORT ONLY/);
});

test("UC-08: with no target country or window, the day count is reported as not counted rather than as zero", async () => {
  const res = await post("uc08", {
    text: "I've been splitting my time between Germany and Spain and I think I may be a dual resident.",
    externalRef: "portal-8002",
    presencePeriods: [],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.match(res.body.details.find((d) => d.label === "Presence days").value, /not counted/);
});

test("UC-08: an empty question is refused rather than answered", async () => {
  const res = await post("uc08", { text: "" });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "text_required");
});

test("UC-09: a standard bonus needs two approvals and executes nothing from the portal", async () => {
  const res = await post("uc09", {
    persona: "admin",
    employmentId: "emp_active_001",
    requestText: "Process a $5,000 gross performance bonus for the Q2 cycle",
    reasonText: "Annual performance bonus",
    externalRef: "portal-9001",
    now: "2026-06-20",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "dual_approval_required");
  assert.equal(res.body.executionPath, "multi_role_approval");
  assert.equal(res.body.details.find((d) => d.label === "Approvals required before any money moves").value, "2");
  // "Executed? no — the portal has no approve control; the write fires only from
  // the approval endpoint once every slot is filled" is an account of which of
  // OUR OWN surfaces holds the write. The absence it reports — no money has
  // moved, and none can until every approval is recorded — is what matters to
  // the requester, and they are told it twice without this row: in the plain
  // answer's sentence, and on the approvals row directly above.
  assert.equal(
    res.body.details.find((d) => d.label === "Executed?"),
    undefined,
    "an account of this system's own execution path is on the requester's panel"
  );
  assert.match(res.body.plainAnswer.lead, /no money moves until/);
});

test("UC-09: a high-value adjustment raises the floor to three approvals, never lowers it", async () => {
  const res = await post("uc09", {
    persona: "admin",
    employmentId: "emp_active_001",
    requestText: "Process a $15,000 gross relocation top-up",
    reasonText: "Relocation assistance",
    externalRef: "portal-9002",
    now: "2026-06-20",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "triple_approval_required");
  assert.equal(res.body.details.find((d) => d.label === "Approvals required before any money moves").value, "3");
});

test("UC-09: paying a terminated employee fails the employment gate", async () => {
  const res = await post("uc09", {
    persona: "admin",
    employmentId: "emp_terminated_002",
    requestText: "Process a $5,000 final bonus",
    externalRef: "portal-9003",
    now: "2026-06-20",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "employment_not_active");
});

test("UC-09: an employee cannot request their own off-cycle payment", async () => {
  const res = await post("uc09", { persona: "chris", employmentId: "emp_active_001", requestText: "Process a $5,000 bonus for me" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_request");
});

test("every submission is tagged as coming from the portal, so a record can be traced to a typed request", async () => {
  const entries = audit.forUseCase("UC-02");
  assert.ok(entries.length > 0, "UC-02 submissions must be audited");
  assert.equal(PORTAL_SOURCE, "portal");
});

// ---------------------------------------------------------------------------
// 4. The 🔴 guarantee: the portal cannot hand UC-07/UC-08 a write-capable client
// ---------------------------------------------------------------------------

test("STRUCTURAL: the UC-07 and UC-08 adapters pass no remote/zendesk client at all", () => {
  const fullSource = readFileSync(join(PORTAL_SRC, "server.js"), "utf8");
  // Strip comments first: the file's header explains IN PROSE exactly why
  // `remote` is absent from these two adapters, which a naive substring search
  // would otherwise trip over — the same trap test/uc08.test.js documents.
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  for (const name of ["uc07", "uc08"]) {
    // Isolate the adapter: from `async ucNN(body) {` to the start of the next one.
    const start = code.indexOf(`async ${name}(body)`);
    assert.ok(start !== -1, `${name}'s adapter must exist in server.js`);
    const rest = code.slice(start);
    const end = rest.search(/\n\s{4}async uc\d\d\(body\)|\n\s{2}};/);
    const adapter = end === -1 ? rest : rest.slice(0, end);

    assert.ok(!/\bremote\b/.test(adapter), `the ${name} adapter must never reference a Remote client`);
    assert.ok(!/\bzendesk\b/i.test(adapter), `the ${name} adapter must never reference a Zendesk client`);
  }
});

test("BEHAVIORAL: UC-07 and UC-08 compile a dossier even when every Remote call would throw", async () => {
  // If either workflow could reach a write-capable client, this client is the
  // one it would reach — every property is a function that throws. Both
  // requests succeeding is the proof that neither touches it.
  const explodingRemote = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error("the portal must never hand UC-07/UC-08 a Remote client");
        };
      },
    }
  );
  const h = createPortalHandler({
    remote: explodingRemote,
    audit: new AuditLogger(),
    stores: freshStores(),
    llm: FAKE_LLM,
  });

  const relocation = await callApi(h, {
    method: "POST",
    path: "/api/requests/uc07",
    body: { text: "Permanently relocating our engineer from Spain to the Netherlands.", externalRef: "portal-7900" },
  });
  assert.equal(relocation.status, 200);
  assert.equal(relocation.body.decision, "escalate");

  const tax = await callApi(h, {
    method: "POST",
    path: "/api/requests/uc08",
    body: { text: "Am I a dual resident of Germany and Spain?", externalRef: "portal-8900" },
  });
  assert.equal(tax.status, 200);
  assert.equal(tax.body.decision, "escalate");
});

test("the portal offers no approve/deny route at all — an intake surface has no second human gate", async () => {
  for (const path of ["/api/requests/uc04/approve", "/api/approvals", "/api/requests/uc09/approve"]) {
    const res = await callApi(handler, { method: "POST", path, body: { approver: "someone" } });
    assert.notEqual(res.status, 200, `${path} must not be an approval endpoint`);
  }
});

// ---------------------------------------------------------------------------
// 5. Housekeeping
// ---------------------------------------------------------------------------

test("no file in src/portal/ hard-codes a port literal", () => {
  // src/shared/ports.js is the only place a port number is written down — a
  // literal here is how three separate collisions in this repo began
  // (test/ports.test.js's header). Comments and strings are stripped first, so
  // documentation and quoted reference ids don't trip it.
  for (const file of ["server.js", "cli.js", "requestTypes.js", "personas.js"]) {
    const code = readFileSync(join(PORTAL_SRC, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[\s\S]*?`/g, "``");
    const literals = [...code.matchAll(/\b(4\d{3})\b/g)].map((m) => m[1]);
    assert.deepEqual(literals, [], `src/portal/${file} hard-codes ${literals.join(", ")} — import it from src/shared/ports.js`);
  }
});

test("UC-07's undeclared plan facts are declared once, visibly, rather than hidden in browser state", () => {
  // The form collects the facts that move the gates; the rest are documented
  // constants on the server. A missing fee stays absent so the estimate reads
  // QUOTE_REQUIRED instead of a zero it never knew.
  assert.equal(UC07_PLAN_DEFAULTS.transferFeeRemoteInteger, null);
  assert.equal(UC07_PLAN_DEFAULTS.mobilityFeeRemoteInteger, null);
  assert.equal(UC07_PLAN_DEFAULTS.destinationEntityActive, true);
  assert.ok(Object.isFrozen(UC07_PLAN_DEFAULTS));
});

test("UC-08: an unreadable presence record is reported as NOT COUNTED, never as a number", async () => {
  // F-22: an unparseable date used to clamp to the window boundary and produce
  // a fabricated day count that looked exactly like a real one. A specialist
  // chases a visible blank; they act on a plausible number.
  const res = await post("uc08", {
    text: "Do we need to withhold UK payroll tax for this assignment?",
    employmentId: "emp_active_001",
    externalRef: "portal-8003",
    targetCountry: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
    presencePeriods: [{ country: "GB", startDate: "sometime in spring", endDate: "2026-04-01" }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  const presence = res.body.details.find((d) => d.label === "Presence days");
  assert.match(presence.value, /^NOT COUNTED/);
  assert.doesNotMatch(presence.value, /\d+ distinct day/);
  assert.match(presence.value, /sometime in spring/, "the offending input is named for investigation");
});

// ---------------------------------------------------------------------------
// 5. The mirrored Sandbox personas
// ---------------------------------------------------------------------------
// Chris Lee, Emma Thompson and Carlos Silva are keyed by employment ids that
// genuinely exist in the project owner's Remote Sandbox (confirmed live
// 2026-08-18), while the RECORDS behind those ids stay in this repo's mock —
// see the "MIRRORED SANDBOX RECORDS" block in src/remote/mockServer.js and the
// header of src/portal/personas.js for the whole argument.
//
// THE TEST THAT MATTERS IS THE POSITIVE ONE. CLAUDE.md §4's most expensive
// recurring lesson is that "refuses correctly" and "structurally cannot
// succeed" are indistinguishable from outside, and no amount of negative
// testing separates them. A mirrored persona that could only ever be shown
// being refused would be exactly that failure, dressed as caution. So each of
// the three is driven to a decision that is NOT a refusal, through the real
// workflow, and Carlos's one refusal is asserted BY REASON so it is pinned as
// the correct answer for Brazil rather than as an unexplained "not success".

/** The seven ids, written out once so a typo cannot silently pass twice. */
const MIRRORED = {
  chris: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
  emma: "d73cff71-ced7-4bcf-b764-b9899abc6340",
  carlos: "c2cd77da-d576-423f-b4f1-f9e40b313353",
  anna: "09b65526-643b-4956-959b-916e6429bd23",
  thomas: "9927057d-c8bc-4c71-940d-a5bc4ccf877e",
  james: "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b",
  joao: "378eee6b-c6db-4484-ba32-7283bd0e2de9",
  // Added when the roster grew a positive/negative pair per outcome, so a demo
  // can switch the answer by switching who is asking rather than by retyping
  // the request. Same rule as every row above it: a real Sandbox id, mirrored
  // by a fixture in src/remote/mockServer.js, never a mock-only `emp_*` key.
  lars: "673a1884-86fb-4101-83d3-b6c544d93bca",
  alexandre: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
  amanda: "e818418e-1db7-431d-a663-9f477addb8bd",
  // Round-6 D-02: the employee persona that isolated evaluation round told the
  // requester THEY are — src/livedemo/employees.js's real-ticket Alex Morgan —
  // and the roster had nowhere for them to say so.
  alex: "2f7f8210-91fc-47db-803c-77a1cc625781",
};

/** The personas that were removed when the roster became Sandbox-only. */
const REMOVED_PERSONAS = ["amara", "priya", "kofi", "oliver", "lena", "katarzyna"];

test("every mirrored persona resolves, and carries its REAL Sandbox employment id", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/context" });
  const byId = Object.fromEntries(res.body.personas.map((p) => [p.id, p]));

  for (const [key, employmentId] of Object.entries(MIRRORED)) {
    assert.ok(byId[key], `persona "${key}" must be offered by /api/context`);
    assert.equal(byId[key].employmentId, employmentId);
    assert.equal(byId[key].kind, "employee");
    // The note is the only place a tester can see the UUID, so it must be there.
    assert.ok(byId[key].note.includes(employmentId), `${key}'s note must print the Sandbox id`);
    assert.match(byId[key].note, /Sandbox/i);
    // The session is server-owned and built from the id, never from a request.
    assert.deepEqual(PERSONAS[key].session, { authenticatedEmploymentId: employmentId });
  }
});

test("the roster is EXACTLY the mirrored people plus the admin — no mock-only persona survives", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/context" });
  const ids = res.body.personas.map((p) => p.id).sort();
  assert.deepEqual(ids, [...Object.keys(MIRRORED), "admin"].sort());
  assert.equal(res.body.personas.length, Object.keys(MIRRORED).length + 1);

  // Every EMPLOYEE persona carries a real Sandbox UUID. This is the claim the
  // page's own copy now makes, so it is pinned rather than left to prose: a
  // future addition keyed by an `emp_*` fixture id would make that copy a lie.
  for (const persona of res.body.personas) {
    if (persona.kind !== "employee") continue;
    assert.match(
      persona.employmentId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      `employee persona "${persona.id}" must carry a real Sandbox UUID, not a mock fixture id`
    );
  }

  assert.equal(byIdKind(res, "admin"), "company_admin");
  assert.equal(res.body.personas.find((p) => p.id === "admin").employmentId, null);
});

function byIdKind(res, id) {
  return res.body.personas.find((p) => p.id === id)?.kind;
}

test("a REMOVED persona is refused, not defaulted — the roster change kept the fail-closed shape", async () => {
  for (const key of REMOVED_PERSONAS) {
    assert.equal(resolvePersona(key), null, `"${key}" must no longer resolve`);
    const res = await post("uc02", { persona: key, expenseId: "exp_sandbox_clean_401" });
    assert.equal(res.status, 401, `a request as "${key}" must be refused`);
    assert.equal(res.body.code, "unauthenticated");
  }
});

test("the mock FIXTURES the removed personas pointed at are untouched — only the picker shrank", async () => {
  // The suite and the nine ucNN CLIs still depend on these, and two are still
  // reachable from the portal as the SUBJECT of an admin request.
  for (const id of ["emp_active_001", "emp_terminated_002", "emp_uk_001", "emp_de_001", "emp_pl_001", "emp_active_003"]) {
    const employment = await remote.getEmployment(id);
    assert.ok(employment, `fixture "${id}" must still exist — this ticket removed personas, not fixtures`);
  }
});

test("every mirrored persona's employment is really fetchable from the mock, under its real id", async () => {
  for (const [key, employmentId] of Object.entries(MIRRORED)) {
    const employment = await remote.getEmployment(employmentId);
    assert.ok(employment, `${key}'s employment must resolve — a mirrored id with no fixture is a 404 waiting to happen`);
    assert.equal(employment.id, employmentId);
    // MOST OF THEM SIT IN THE ADMIN PERSONA'S COMPANY, AND ONE DELIBERATELY
    // DOES NOT. `lars` is at `co_northwind_02` on purpose: the admin persona
    // can file for every other employee here and is REFUSED for him, which is
    // the company boundary being demonstrated rather than a fixture mistake
    // (src/portal/personas.js's admin note says exactly this). Asserted as a
    // named exception rather than relaxed to "any company", so a SECOND
    // persona drifting out of the admin's company still fails here.
    const expectedCompany = key === "lars" ? "co_northwind_02" : "co_amend_01";
    assert.equal(employment.company_id, expectedCompany, `${key} is not in the company its demo needs`);
  }
  // The facts that WERE captured live. Everything else on these records is this
  // repo's own fixture data and is deliberately not asserted here as fact.
  const expected = {
    chris: { full_name: "Chris Lee", country_code: "US", status: "active" },
    emma: { full_name: "Emma Thompson", country_code: "GB", status: "active" },
    carlos: { full_name: "Carlos Silva", country_code: "BR", status: "active" },
    anna: { full_name: "Anna Müller", country_code: "DE", status: "active" },
    thomas: { full_name: "Thomas Weber", country_code: "DE", status: "archived" },
    james: { full_name: "James Wilson", country_code: "GB", status: "active" },
    joao: { full_name: "João Silva", country_code: "PT", status: "active" },
  };
  for (const [key, facts] of Object.entries(expected)) {
    const employment = await remote.getEmployment(MIRRORED[key]);
    assert.equal(employment.full_name, facts.full_name);
    assert.equal(employment.country_code, facts.country_code);
    assert.equal(employment.status, facts.status);
  }
  const carlos = await remote.getEmployment(MIRRORED.carlos);
  assert.equal(carlos.contract_type, "contractor", "the Sandbox record is genuinely a contractor");
});

test("Thomas Weber is 'archived', and that really does trip the status gate", async () => {
  // The status he replaced was "terminated". The gates test `status !== "active"`
  // rather than any one string, so archived must refuse through the same branch —
  // asserted by RUNNING it, because a persona that looks like it demonstrates a
  // refusal but does not is worse than no persona at all.
  const employment = await remote.getEmployment(MIRRORED.thomas);
  assert.equal(employment.status, "archived", "mirrored verbatim, not normalised to 'terminated'");

  const uc03 = await post("uc03", { persona: "thomas", text: "I'm travelling to Spain in September 2026.", externalRef: "portal-3103" });
  assert.equal(uc03.body.decision, "escalate");
  assert.equal(uc03.body.reason, "employee_not_active");
  assert.ok(uc03.body.flags.includes("employment_status_archived"), "the flag must name the REAL status, not a status this record does not have");

  const uc05 = await post("uc05", { persona: "thomas", proposedEndDate: "2026-09-15", now: "2026-08-16", externalRef: "portal-5103" });
  assert.equal(uc05.body.decision, "escalate");
  assert.equal(uc05.body.reason, "employee_not_active");
});

test("POSITIVE: Anna Müller's German resignation reaches prepared_for_signoff, on the month-anchored rule", async () => {
  const res = await post("uc05", {
    persona: "anna",
    proposedEndDate: "2026-10-31",
    now: "2026-08-10",
    reason: "relocation",
    currency: "EUR",
    externalRef: "portal-5104",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.match(res.body.details.find((d) => d.label === "Rule applied").value, /BGB/);
});

test("João Silva's short notice escalates on PORTUGAL's own rule — not Poland's, relabelled", async () => {
  // The Poland scenario had no Sandbox subject (there is no Polish employment in
  // the account), so PT stands in. It must escalate for PT's OWN reason, and the
  // rule the response names must be the Portuguese one.
  const res = await post("uc05", {
    persona: "joao",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
    reason: "family reasons",
    externalRef: "portal-5105",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "statutory_discrepancy");
  assert.ok(res.body.flags.includes("discrepancy_earlier_than_statutory"));
  assert.match(res.body.details.find((d) => d.label === "Rule applied").value, /Código do Trabalho/);
});

test("POSITIVE: James Wilson's own claim auto-approves, and the SAME shape of claim from Chris is refused for ownership", async () => {
  // The pair differs only in who submits it: both claims are James's, both are
  // clean, both are USD (the cap's currency). So the refusal below can only be
  // the ownership gate — which is the entire point of the demonstration.
  const own = await post("uc02", { persona: "james", expenseId: "exp_sandbox_own_404", externalRef: "portal-2103" });
  assert.equal(own.status, 200);
  assert.equal(own.body.decision, "auto_approve");
  assert.equal(own.body.reason, "all_gates_passed");
  assert.deepEqual(own.body.flags, []);

  const other = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_other_owner_403", externalRef: "portal-2104" });
  assert.equal(other.status, 200);
  assert.equal(other.body.decision, "escalate");
  assert.equal(other.body.reason, "expense_employment_mismatch");
});

test("POSITIVE: Chris Lee's own clean claim reaches auto_approve — the mirrored persona can SUCCEED, not merely be refused", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_clean_401", externalRef: "portal-2101" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_approve");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.deepEqual(res.body.flags, []);
  assert.ok(res.body.recordId);
});

test("POSITIVE: Emma Thompson's UK resignation reaches prepared_for_signoff, on the real statutory rule", async () => {
  const res = await post("uc05", {
    persona: "emma",
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
    reason: "new opportunity",
    ptoType: "vacation",
    ptoDaysAccrued: "12",
    ptoDaysUsed: "3",
    ptoHourlyRate: "40.00",
    currency: "GBP",
    externalRef: "portal-5101",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "prepared_for_signoff");
  assert.equal(res.body.reason, "all_gates_passed");
  const rule = res.body.details.find((d) => d.label === "Rule applied");
  assert.match(rule.value, /Employment Rights Act 1996/);
});

test("POSITIVE: Carlos Silva's trip auto_resolves — the contractor record clears UC-03's gates too", async () => {
  const res = await post("uc03", {
    persona: "carlos",
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
    externalRef: "portal-3101",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_resolve");
  assert.equal(res.body.reason, "all_gates_passed");
});

test("Chris Lee's over-cap claim is still refused — the same person demonstrates both directions", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_over_cap_402", externalRef: "portal-2102" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "human_review");
  assert.equal(res.body.reason, "over_policy_cap");
});

test("Brazil escalates UC-05 as unsupported_country — a correct answer, pinned by reason rather than by 'not success'", async () => {
  const res = await post("uc05", {
    persona: "carlos",
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
    reason: "new opportunity",
    currency: "BRL",
    externalRef: "portal-5102",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "unsupported_country");
  assert.ok(res.body.flags.includes("country_BR"), "the refusal must name the country it could not rule on");
});

test("the company admin can act for a mirrored employee — UC-04 prepares a request for the mobility specialist", async () => {
  const res = await post("uc04", {
    persona: "admin",
    employmentId: MIRRORED.emma,
    homeCountry: "GB",
    nationality: "GB",
    destinationCountry: "ES",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    reasonText: "Two weeks working alongside the Madrid team.",
    externalRef: "portal-4101",
    now: "2026-08-15",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.equal(res.body.reason, "all_gates_passed");
});

test("the company admin can request an off-cycle payment for a mirrored employee, and it still needs two approvals", async () => {
  const res = await post("uc09", {
    persona: "admin",
    employmentId: MIRRORED.chris,
    requestText: "Please pay a $1,500 gross spot bonus for the release.",
    externalRef: "portal-9101",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "dual_approval_required");
  const slots = res.body.details.find((d) => d.label === "Approvals required before any money moves");
  assert.equal(slots.value, "2");
});

test("UC-02's picker offers Chris Lee's own expenses, so the use case is drivable as him at all", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/context" });
  const his = res.body.expenses.filter((e) => e.employmentId === MIRRORED.chris).map((e) => e.id);
  // Without these, every expense in the dropdown belongs to someone else and
  // every submission as Chris fails the ownership gate — a use case that looks
  // like it is working correctly while being impossible to exercise.
  assert.ok(his.includes("exp_sandbox_clean_401"));
  assert.ok(his.includes("exp_sandbox_over_cap_402"));
});

test("every Sandbox id the page prints is a real one, and it still says the reads are the mock's", () => {
  const html = read("index.html");

  // WHAT THIS ASSERTED BEFORE, AND WHY THE DIRECTION TURNED ROUND. It used to
  // require index.html to print EVERY id in MIRRORED, so a tester could
  // cross-check each against their own Sandbox. That made a paragraph of
  // hand-maintained UUIDs a hard requirement of the roster — and the moment the
  // roster grew (a positive/negative persona pair per outcome) the copy was
  // stale and this test failed for a page nobody had touched.
  //
  // The claim worth keeping is the one that can go WRONG rather than merely out
  // of date: an id printed on the page must be a REAL mirrored id and never a
  // mock fixture key. A stale paragraph is a documentation gap; a fabricated or
  // `emp_*` id under the sentence "every employee persona carries a real
  // Sandbox employment id" is the overstatement CLAUDE.md §3 directive 7 warns
  // about. The picker itself is the complete, always-current list — each
  // persona's note carries its own id, pinned by the mirrored-persona test
  // above — so nothing is lost by not requiring the prose to repeat it.
  const printed = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
  const real = new Set(Object.values(MIRRORED));
  for (const id of printed) {
    assert.ok(real.has(id), `index.html prints ${id}, which is not any persona's real Sandbox id`);
  }
  assert.ok(printed.length > 0, "the page names no Sandbox id at all — the cross-check claim has gone");
  // ...and it must still say the reads are the mock's, or the disclosure becomes
  // a half-truth that reads as "this page talks to your Sandbox".
  assert.match(html, /mock Remote server/);

  // The copy must no longer describe a roster that has non-Sandbox people in it.
  // That framing was true while `emp_active_001` and friends were on the picker
  // and is now the exact overstatement CLAUDE.md §3 directive 7 warns about.
  assert.doesNotMatch(html, /mock ids a real Sandbox would 404/,
    "the sidebar still claims some personas are mock ids — none are");
  assert.doesNotMatch(html, /Three (?:people|personas)/,
    "the copy still says three people are mirrored; every employee persona now is");

  // The one substitution that is NOT like-for-like has to be disclosed, not
  // quietly presented as if the Sandbox had a Polish employee.
  assert.match(html, /Portugal/, "the PT-for-PL substitution must be stated on the page");
});

// --- finding F-40: the UC-08 adapter must not delete a period row the requester touched ---
//
// The same failure as F-30 above, one use case over, and found the same way —
// by filling the form in rather than reading the code. buildPresencePeriods()
// was `.filter((r) => r && r.country && r.startDate && r.endDate)`, which is the
// portal deciding, one layer above the gate, that an incomplete travel record
// simply did not happen.
//
// Driven through the real route with TWO periods — a complete March–May stay in
// the UK and a July stay whose end date was left blank — the portal answered
// "92 distinct day(s) in GB … (1 period(s) counted)". Confident, precise, and
// computed from half the input, with nothing on the page saying a row had been
// discarded. On the use case whose entire subject is the 183-day threshold, the
// discarded July stay is exactly the evidence that decides the question.
//
// presenceCalculator.js already refuses an unreadable period by name and blanks
// the whole count — it never got the chance, because the evidence was destroyed
// before it arrived. The adapter decides nothing; it only stops concealing.

test("UC-08 adapter: a period row the requester started but did not finish survives to the gate", () => {
  const rows = [
    { country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" },
    { country: "GB", startDate: "2026-07-01", endDate: "" }, // started, unfinished
  ];
  const periods = buildPresencePeriods(rows);
  assert.equal(periods.length, 2, "the unfinished row must reach the calculator, not be deleted here");

  const counted = computePresenceDays({
    presencePeriods: periods,
    country: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(counted.status, "NOT_EVALUATED", "and the count must be refused, not quietly reduced to the readable half");
  assert.equal(counted.days, null);
  assert.ok(
    counted.problems.some((p) => /unparseable period dates for GB/.test(p)),
    `the offending row must be named, got: ${JSON.stringify(counted.problems)}`
  );
});

test("UC-08 adapter: an untouched row is still dropped — an empty row is not a stated period", () => {
  // The form always renders two period rows, both blank. A row nobody used is
  // not a travel record, and forwarding it would blank every count on the page.
  const periods = buildPresencePeriods([
    { country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" },
    { country: "", startDate: "", endDate: "" },
  ]);
  assert.equal(periods.length, 1);
  assert.deepEqual(periods[0], { country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" });
});

test("UC-08 adapter: POSITIVE — two complete rows both arrive, normalised, and really count", () => {
  // The check that would fail if "forward everything" had been implemented as
  // "refuse everything": a complete set must still produce a real number.
  const periods = buildPresencePeriods([
    { country: "gb", startDate: "2026-03-01", endDate: "2026-05-31" },
    { country: " GB ", startDate: "2026-09-01", endDate: "2026-09-30" },
  ]);
  assert.deepEqual(periods.map((p) => p.country), ["GB", "GB"], "country codes are upper-cased at the boundary");

  const counted = computePresenceDays({
    presencePeriods: periods,
    country: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(counted.status, "COUNTED");
  assert.equal(counted.days, 92 + 30, "March–May (92) plus September (30), counted once each");
  assert.equal(counted.periodsCounted, 2);
});

test("UC-08 adapter: a country typed with nothing else is still a stated row", () => {
  // "I was in France, I forget when" is a fact about the request that the
  // calculator must be allowed to refuse by name. Dropping it silently is the
  // failure direction that hides presence.
  const periods = buildPresencePeriods([{ country: "FR", startDate: "", endDate: "" }]);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].country, "FR");
});

// --- finding F-35: the adapter must not delete the evidence F-33 refuses on ---
//
// F-30 taught buildTimeOffBalances() to stop inventing a rate it was never
// given. It kept one shortcut on the days side:
//
//     if (Number.isFinite(daysAccrued) && daysAccrued <= 0) return [];
//
// justified in its own comment by reconcilePtoPayout() clamping negatives with
// `Math.max(0, …)`. That justification expired at F-33, which taught the
// reconciler to REFUSE a negative day count by name — and the shortcut was then
// suppressing exactly the input the new gate had been built to catch, one layer
// before it could see it. The same relationship F-30 removed, rebuilt over the
// top of it.
//
// Driven through the real form (Emma Thompson, -8 accrued days, a valid 40.00
// rate) the portal answered `prepared_for_signoff` and printed
// "PTO PAYOUT 0.00 GBP (no_time_off_records)": a final settlement of nothing,
// reported as though no balance had ever been mentioned, no flag anywhere, and
// an HR Ops sign-off button waiting on it.

test("UC-05 adapter: a NEGATIVE stated accrual reaches the gate instead of reading as 'no records'", () => {
  const balances = buildTimeOffBalances({ ptoDaysAccrued: "-8", ptoDaysUsed: "0", ptoHourlyRate: "40.00" });
  assert.equal(balances.length, 1, "a stated -8 is a balance we cannot read, not an absent PTO section");
  assert.equal(balances[0].daysAccrued, -8, "forwarded as stated, so the gate judges it rather than the adapter");

  const payout = reconcilePtoPayout({ balances, currency: "GBP" });
  assert.equal(payout.computable, false, "the F-33 refusal must be reachable through this entry point");
  assert.equal(payout.totalInRemoteInteger, null, "no confident 0.00 on a balance nobody could read");
  assert.deepEqual(payout.unusableLines[0].missing, ["daysAccrued"]);
});

test("UC-05 adapter: a negative days-USED reaches the gate too — that one overpays", () => {
  // `Math.max(0, 10 - (-5))` yields 15 days available out of a 10-day accrual.
  // The clamp cannot see it because the number it produces is positive and
  // plausible, which is why the refusal has to happen on the stated value.
  const balances = buildTimeOffBalances({ ptoDaysAccrued: "10", ptoDaysUsed: "-5", ptoHourlyRate: "40.00" });
  const payout = reconcilePtoPayout({ balances, currency: "GBP" });
  assert.equal(payout.computable, false);
  assert.deepEqual(payout.unusableLines[0].missing, ["daysUsed"]);
});

test("UC-05 adapter: a typed ZERO accrual is the requester's own answer and still computes", () => {
  // The deleted shortcut swallowed 0 as well as negatives, contradicting this
  // function's own documented rule. Both settle at 0.00, but only one of them
  // is an answer — and `source` is where that difference is recorded.
  const balances = buildTimeOffBalances({ ptoDaysAccrued: "0", ptoDaysUsed: "", ptoHourlyRate: "24.00" });
  assert.equal(balances.length, 1, "the employee said zero; that is a record");
  const payout = reconcilePtoPayout({ balances, currency: "EUR" });
  assert.equal(payout.computable, true);
  assert.equal(payout.totalInRemoteInteger, 0);
  assert.equal(payout.source, "time_off_records", "NOT no_time_off_records — a stated zero is not silence");
});

test("UC-05 adapter: an untouched PTO section is still honestly 'no records'", () => {
  // The one reading that genuinely justifies an empty array, unchanged.
  assert.deepEqual(buildTimeOffBalances({ ptoDaysAccrued: "" }), []);
  assert.deepEqual(buildTimeOffBalances({}), []);
  const payout = reconcilePtoPayout({ balances: [], currency: "EUR" });
  assert.equal(payout.source, "no_time_off_records");
});

// ---------------------------------------------------------------------------
// NOTHING POINTED A REQUESTER AT "MY REQUESTS"
// ---------------------------------------------------------------------------
// A requester filed an over-cap expense, was told a Finance Ops specialist
// would review it, and never saw the outcome. Nothing was broken: the
// specialist approved it, the row read `status: approved` with the reviewer
// recorded, and listByOwner() would have returned it. "My requests" is simply
// a separate nav item, and no submission result pointed at it — so the one
// place that would ever carry the answer was unreachable from the one screen
// that promised an answer was coming.
//
// The fix is a POINTER, never a control: the server says whether to show it and
// what it says (trackingHint(), src/portal/requestStatus.js), and the page
// opens the view that already exists.
// ---------------------------------------------------------------------------

test("tracking: a decision that needs a human points at 'My requests' and says so", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_over_cap_402", externalRef: "portal-2402" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "human_review");

  assert.equal(res.body.tracking.show, true);
  assert.equal(res.body.tracking.awaitingHuman, true, "a human_review is waiting on a person");
  assert.equal(res.body.tracking.label, "My requests");
  assert.match(res.body.tracking.sentence, /My requests/);
  // The sentence has to say the page will NOT update itself, because that
  // expectation is exactly what left the requester waiting on a screen that
  // was never going to change.
  assert.match(res.body.tracking.sentence, /will not update by itself/);
});

test("tracking: a decision that finished on its own still offers the route, without claiming a human is coming", async () => {
  const res = await post("uc02", { persona: "chris", expenseId: "exp_sandbox_clean_401", externalRef: "portal-2403" });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "auto_approve");

  assert.equal(res.body.tracking.show, true);
  assert.equal(res.body.tracking.awaitingHuman, false, "an auto-approval is over the moment it is returned");
  assert.match(res.body.tracking.sentence, /already final/);
});

test("tracking: a refusal that produced no record offers no route to a list it would not appear in", async () => {
  // An admin cannot file an employee's expense, so the workflow never ran and
  // there is no record. Pointing at "My requests" here would send somebody to
  // look for something that does not exist.
  const res = await post("uc02", { persona: "admin", expenseId: "exp_sandbox_clean_401" });
  assert.equal(res.status, 403);
  assert.equal(res.body.tracking, undefined, "a refused submission carries no tracking hint at all");
});

test("tracking: the page renders the server's sentence and re-derives nothing", () => {
  const source = read("app.js");
  // It reads `payload.tracking` and prints `hint.sentence` verbatim — the same
  // rule every other line on this page follows.
  assert.match(source, /payload\.tracking/);
  assert.match(source, /hint\.sentence/);
  // It opens the EXISTING view rather than rendering status of its own.
  assert.match(source, /function trackingLink\(payload\)/);
  assert.match(source, /showMyRequests\(\);/);
  // And it decides nothing: the whole point is that the server said whether to
  // show it. `hint.show` is the only gate, and there is no decision string in
  // the function — the file-wide "app.js branches on a decision value" guard
  // above already pins that globally, and this keeps it true here specifically.
  assert.match(source, /hint\.show !== true/);
});

// ---------------------------------------------------------------------------
// The deciding gate's sentence, printed once
// ---------------------------------------------------------------------------
// `gateNarration()` sends the same text twice — as `decidedBy.means`, rendered
// as the reason paragraph, and again as the "What happened" detail row. With a
// one-line `means` that was merely redundant. UC-03's routing rung now has to
// explain what happens NEXT (nothing was dispatched; here is what to file
// instead; here is what it needs), and four sentences printed twice on one
// panel reads as a page fault. See docs/CORRECTIONS-LOG.md C-31.
//
// The de-duplication is by VALUE, never by label, so it can only ever remove a
// repeat — never a row that says something the paragraph did not.
// ---------------------------------------------------------------------------

/** Pull one top-level `function name(...) {...}` out of the browser asset and run it. */
function assetFunction(name) {
  const source = read("app.js");
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `app.js no longer defines ${name}()`);
  // Balanced-brace scan from the opening `{` — the helpers here are small and
  // contain no braces inside strings, and a mis-scan fails loudly rather than
  // silently testing the wrong text.
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${name}() is unbalanced`);
  return vm.runInNewContext(`${source.slice(start, end)}; ${name}`);
}

test("withoutRepeatOf drops a detail row that repeats the reason paragraph, and only that row", () => {
  const withoutRepeatOf = assetFunction("withoutRepeatOf");
  const means = "Nothing was sent anywhere: no work-authorisation case was created.";
  const details = [
    { label: "What happened", value: means },
    { label: "Routed to", value: "uc04_work_authorization" },
    { label: "Handoff to UC-04", value: "CROSS_BORDER_WORK_REQUESTED — US → PT" },
  ];

  assert.deepEqual(
    withoutRepeatOf(details, means).map((d) => d.label),
    ["Routed to", "Handoff to UC-04"],
    "the repeated sentence is dropped and nothing else is"
  );

  // A row that merely STARTS with the paragraph, or differs by one character,
  // still says something the paragraph did not — it must survive.
  const nearly = [{ label: "What happened", value: means + " And here is the part you have not read." }];
  assert.equal(withoutRepeatOf(nearly, means).length, 1, "only a character-for-character repeat is dropped");

  // No `means` (a use case with no gate map) leaves the list untouched.
  assert.deepEqual(withoutRepeatOf(details, null), details);
  assert.deepEqual(withoutRepeatOf(details, undefined), details);
});

test("the result panel actually renders its details through withoutRepeatOf", () => {
  // The helper existing and being called by nothing is this repo's P8 pattern
  // (docs/CORRECTIONS-LOG.md) — a capability built and reachable by nobody.
  const source = read("app.js");
  assert.match(source, /detailTable\(withoutRepeatOf\(payload\.details, payload\.decidedBy && payload\.decidedBy\.means\)\)/);
  assert.equal((source.match(/detailTable\(/g) || []).length, 2, "detailTable is defined once and called once");
});

// =============================================================================
// G-4/F4: L-13's HTTP surface — GET/POST /api/consent-requests — driven over
// REAL HTTP for the first time. test/uc01.test.js:215,257 call
// updateConsentDecision() DIRECTLY, bypassing the route entirely; grep -rn
// "consent-requests" test/ found zero hits before this block. The evaluator
// (bead rca-5ry) drove all four of these by hand and found them working —
// this is about a regression shipping silently, never about a live break.
// =============================================================================

/** A fresh handler + its own CaseStore, isolated from every other test's state. */
function freshConsentHandler() {
  const stores = freshStores();
  const handler = createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
  return { handler, caseStore: stores.uc01 };
}

// chris and emma are both real, distinct employee personas (src/portal/personas.js).
const CHRIS_EMPLOYMENT_ID = "8ab12460-b568-4c1e-af9d-09b1fabd8f46";
const EMMA_EMPLOYMENT_ID = "d73cff71-ced7-4bcf-b764-b9899abc6340";

/** Seed one pending consent_records row the way L-9 would — a case, then the row. */
function seedPendingConsent(caseStore, employmentId) {
  const seedCase = caseStore.createCase({
    useCase: "UC-01",
    source: "third_party_door",
    employmentId,
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  const record = caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "pending",
    source: "third_party_door",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  return { seedCase, record };
}

test("L-13/F4: the persona gate — no persona at all is refused, unauthenticated", async () => {
  const { handler } = freshConsentHandler();
  const res = await callApi(handler, { method: "GET", path: "/api/consent-requests" });
  assert.equal(res.status, 401);
});

test("L-13/F4: the persona gate — a company_admin persona may not view consent requests", async () => {
  const { handler, caseStore } = freshConsentHandler();
  seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);
  const res = await callApi(handler, { method: "GET", path: "/api/consent-requests?persona=admin" });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "persona_cannot_view_consent_requests");
});

test("L-13/F4: GET returns the employee's own pending requests, with the ageing policy figure attached", async () => {
  const { handler, caseStore } = freshConsentHandler();
  const { record } = seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);

  const res = await callApi(handler, { method: "GET", path: "/api/consent-requests?persona=chris" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.agePolicyDays, CONSENT_AGE_WARN_DAYS);
  const found = res.body.requests.find((r) => r.id === record.id);
  assert.ok(found, "chris must see the pending request about his own employment");
  assert.equal(found.requestingParty, "First Bank");
  assert.equal(found.status, "pending");
});

test("L-13/F4: GET scopes to the employee's OWN employment — emma never sees chris's request", async () => {
  const { handler, caseStore } = freshConsentHandler();
  seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);

  const res = await callApi(handler, { method: "GET", path: "/api/consent-requests?persona=emma" });
  assert.equal(res.status, 200);
  assert.equal(res.body.requests.length, 0, "emma must not see a request about a different employment");
});

test("L-13/F4: decide — cross-party ownership is refused 403 not_your_consent_request (L-13's own done-criterion)", async () => {
  const { handler, caseStore } = freshConsentHandler();
  const { record } = seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${record.id}/decide`,
    body: { persona: "emma", decision: "grant" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "not_your_consent_request");

  // And it must not have moved — a refused decide is a no-op on the record.
  const stillPending = await caseStore.findConsentRecordById(record.id);
  assert.equal(stillPending.status, "pending");
});

test("L-13/F4: decide — the named employee grants, durably, and it is written before the response", async () => {
  const { handler, caseStore } = freshConsentHandler();
  const { record } = seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${record.id}/decide`,
    body: { persona: "chris", decision: "grant" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.request.status, "granted");

  // DURABLE AUDIT WRITE (invariant 4: nothing customer-facing precedes it —
  // here, "customer-facing" is the response the employee reads).
  const auditRow = audit.entries.find(
    (e) => e.action === "consent_granted" && e.details?.consentRecordId === record.id
  );
  assert.ok(auditRow, "granting consent must write a durable audit_log row");
  assert.equal(auditRow.actor, CHRIS_EMPLOYMENT_ID);

  const updated = await caseStore.findConsentRecordById(record.id);
  assert.equal(updated.status, "granted");
  assert.equal(updated.grantedByEmploymentId, CHRIS_EMPLOYMENT_ID);
  assert.equal(updated.grantedBySignal, "portal_persona_session");
  assert.notEqual(updated.grantedAt, null);
});

test("L-13/F4: decide — a denial is durable and audited the same way", async () => {
  const { handler, caseStore } = freshConsentHandler();
  const { record } = seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${record.id}/decide`,
    body: { persona: "chris", decision: "deny" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, "denied");

  const auditRow = audit.entries.find(
    (e) => e.action === "consent_denied" && e.details?.consentRecordId === record.id
  );
  assert.ok(auditRow, "denying consent must write a durable audit_log row");

  const updated = await caseStore.findConsentRecordById(record.id);
  assert.equal(updated.status, "denied");
  assert.equal(updated.grantedAt, null, "a denial never sets grantedAt — nothing was ever GRANTED");
});

test("L-13/F4: decide — a second decision on the same request is refused 409 already_decided", async () => {
  const { handler, caseStore } = freshConsentHandler();
  const { record } = seedPendingConsent(caseStore, CHRIS_EMPLOYMENT_ID);

  const first = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${record.id}/decide`,
    body: { persona: "chris", decision: "grant" },
  });
  assert.equal(first.status, 200);

  const second = await callApi(handler, {
    method: "POST",
    path: `/api/consent-requests/${record.id}/decide`,
    body: { persona: "chris", decision: "deny" },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "already_decided");

  // The FIRST decision must survive untouched — a refused second attempt must
  // never overwrite it, in either direction.
  const stillGranted = await caseStore.findConsentRecordById(record.id);
  assert.equal(stillGranted.status, "granted");
});

test("L-13/F4: decide — a request that does not exist is a 404, not a 403 or a silent 200", async () => {
  const { handler } = freshConsentHandler();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/consent-requests/00000000-0000-0000-0000-000000000000/decide",
    body: { persona: "chris", decision: "grant" },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "consent_request_not_found");
});
