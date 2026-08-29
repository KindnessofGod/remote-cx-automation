// ---------------------------------------------------------------------------
// portalUc05Success.test.js  —  the portal's UC-05 quick-fills, DRIVEN
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The report was: "all the UC-05 ones I am trying are ones that my system does
// not cover". Three requests had been driven through the live portal that day
// and all three escalated — a Brazilian resignation (no rule in the notice
// table) and a Portuguese one proposing a leaving date 23 days inside the
// statutory minimum. Both refusals are CORRECT. Neither shows the use case
// doing the thing it exists to do: compute a statutory leaving date and a
// holiday settlement that a person can then sign.
//
// That is this repository's most expensive recurring defect, arriving from the
// demo side rather than the code side (docs/BUILD-LOG.md §3.30, CLAUDE.md §4):
// a path that STRUCTURALLY CANNOT SUCCEED and a path that is APPROPRIATELY
// REFUSING look identical from outside, and every fail-closed assertion passes
// in both cases. Only a positive test tells them apart — "this exact input MUST
// reach `prepared_for_signoff`, with a real date and a real figure on it".
//
// So every assertion here is positive. Each of the four Portuguese quick-fills
// is sent through the REAL portal route with the REAL field values the button
// loads, and the decision, the statutory end date, the notice length and the
// payout are all read back off the stored row rather than off the panel copy.
// The last test then asks the UC-05 API — the surface the sidebar actually
// calls — whether the case is actionable, because a prepared report that
// renders no sign-off button is the same dead end approached from the other
// side.
//
// HERMETIC. Remote is reached through createInProcessFetch(), so this file
// binds no port (src/shared/ports.js's TEST_PORTS has no entry for it, on
// purpose). The one LLM seam UC-05 has is injected with the real
// extractFromLetter() forced down its unconfigured branch, the repo-standard
// idiom — no network call, production code path.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { createUc05Handler } from "../src/uc05/server.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { fromRemoteInteger } from "../src/shared/money.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(__dirname, "..", "src", "portal", "assets", "app.js");

/** The real SCENARIOS object out of app.js — the same lift portalCopy.test.js makes. */
function scenarios() {
  const app = readFileSync(APP_JS, "utf8");
  const start = app.indexOf("  var SCENARIOS = {");
  const end = app.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, "SCENARIOS has moved — re-point this test");
  const context = { SCENARIOS: null };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end + 4).replace("var SCENARIOS =", "SCENARIOS ="), context);
  return context.SCENARIOS;
}

const unconfigured = { isConfigured: () => false };

/** One portal + one UC-05 API over ONE store, so the sidebar reads what the portal wrote. */
function world() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const audit = new AuditLogger();
  const resignations = new ResignationStore();
  const portal = createPortalHandler({
    remote,
    audit,
    stores: {
      uc02: new ExpenseStore(),
      uc03: new CaseStore(),
      uc04: new AuthorizationStore(),
      uc05: resignations,
      uc07: new RelocationDossierStore(),
      uc08: new TaxDossierStore(),
      uc09: new AdjustmentStore(),
    },
    llm: { extract: (args) => extractFromLetter(args, unconfigured) },
  });
  const uc05Api = createUc05Handler({ resignationStore: resignations, audit, remote });
  return { portal, uc05Api, resignations };
}

/** The same in-process handler driver every other server suite in this repo uses. */
function call(handler, { method = "GET", path, body = null, headers = {} }) {
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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

/**
 * The body app.js's UC-05 collector builds from one scenario's fields.
 *
 * Mirrors `COLLECTORS.uc05` exactly — `value()` for the boxes that are sent raw
 * and `orNull()` for the ones an empty box must omit. Getting this wrong in the
 * lenient direction (sending "" where the page sends null) would hand UC-05 a
 * different request from the one the button makes, and the test would then be
 * about nothing.
 */
function uc05Body(scenario, externalRef) {
  const f = scenario.fields;
  const value = (key) => f[`uc05-${key}`] ?? "";
  const orNull = (key) => (f[`uc05-${key}`] ? f[`uc05-${key}`] : null);
  return {
    persona: scenario.persona,
    letterText: value("letterText"),
    proposedEndDate: orNull("proposedEndDate"),
    reason: orNull("reason"),
    ptoType: orNull("ptoType"),
    ptoDaysAccrued: value("ptoDaysAccrued"),
    ptoDaysUsed: value("ptoDaysUsed"),
    ptoHourlyRate: value("ptoHourlyRate"),
    currency: orNull("currency"),
    now: orNull("now"),
    externalRef: externalRef ?? f["uc05-externalRef"] ?? null,
  };
}

const detail = (body, label) => (body.details.find((d) => d.label === label) || {}).value;

/** Submit a quick-fill and hand back both the panel's answer and the stored row. */
async function submit(id, externalRef) {
  const scenario = scenarios().uc05.find((s) => s.id === id);
  assert.ok(scenario, `${id} has gone from the quick-fill row`);
  const { portal, uc05Api, resignations } = world();
  const res = await call(portal, { method: "POST", path: "/api/requests/uc05", body: uc05Body(scenario, externalRef) });
  assert.equal(res.status, 200, `${id} was refused before any gate ran: ${JSON.stringify(res.body)}`);
  const row = await resignations.findById(res.body.recordId);
  return { scenario, res, row, uc05Api };
}

// ---------------------------------------------------------------------------
// 1. THE HEADLINE — the first button on the row must be a success
// ---------------------------------------------------------------------------
// Ordering is not decoration here. The complaint was about what a tester meets
// FIRST, and the first quick-fill is the one anybody demonstrating this page
// clicks. A refusal in that slot is a demo of the system declining to work.

test("the first UC-05 quick-fill is a success, not a refusal", () => {
  const [first, ...rest] = scenarios().uc05;
  assert.ok(!first.fails, `the first quick-fill is marked refused: ${first.id}`);
  assert.equal(first.id, "uc05-pt-clean", "the headline scenario has moved — re-point this test or put it back");
  assert.ok(
    rest.some((s) => s.fails),
    "every refusal has gone from the row — a page that can only succeed proves as little as one that can only refuse"
  );
});

// ---------------------------------------------------------------------------
// 2. THE FOUR PORTUGUESE SCENARIOS, DRIVEN
// ---------------------------------------------------------------------------
// One test per scenario rather than a loop over a table, because the whole
// point is the SPECIFIC numbers: a loop asserting "some date, some figure"
// would pass against a notice period of one day and a settlement of one cent.
//
// Portugal is the only country this can be done on from this page. The demo set
// is NL · PT · CA · US (docs/DEMO-COUNTRIES.md) and the notice table holds GB,
// IE, DE, PL, IN, PH, MX, CA, PT (src/uc05/noticePeriodTable.js) — the
// intersection is PT and CA, and no Canadian persona exists in
// src/portal/personas.js because the roster mirrors the owner's own Sandbox.

test("POSITIVE: the headline Portuguese resignation reaches a sign-off with real figures", async () => {
  const { res, row } = await submit("uc05-pt-clean", "uc05-success-clean");

  assert.equal(res.body.decision, "prepared_for_signoff", `reason: ${res.body.reason}`);
  assert.equal(res.body.reason, "all_gates_passed");
  assert.deepEqual(res.body.flags, []);

  // The statutory side. Every one of these is a number a person acts on, so
  // each is asserted as a value and not merely as "present".
  assert.equal(row.notice.countryCode, "PT");
  assert.equal(row.notice.tenureMonths, 86);
  assert.equal(row.notice.noticeDays, 60, "Portugal's over-two-year bracket");
  assert.equal(row.notice.noticeEndDate, "2026-10-19", "60 calendar days from 2026-08-20");
  assert.equal(row.notice.basis, "statutory");
  assert.equal(row.notice.discrepancy, "later_than_statutory");
  assert.equal(row.notice.discrepancyDays, 42);

  // The money side, in Remote's ×100 integer form: (18 - 5) days x 8 h x 26.00.
  assert.equal(row.payout.computable, true);
  assert.equal(row.payout.source, "time_off_records");
  assert.equal(row.payout.totalInRemoteInteger, 270400);
  assert.equal(row.payout.currency, "EUR");
  assert.equal(fromRemoteInteger(row.payout.totalInRemoteInteger).toFixed(2), "2704.00");

  // And what the page actually prints, since a correct row rendered as "not
  // calculated" would still be a demo of nothing.
  assert.equal(detail(res.body, "Statutory notice"), "60 days (statutory) → last working day 2026-10-19");
  assert.equal(detail(res.body, "PTO payout"), "2704.00 EUR — from the leave balances on record");
});

test("POSITIVE: the settlement scenario nets days used and pays a half day", async () => {
  const { res, row } = await submit("uc05-pt-payout", "uc05-success-payout");

  assert.equal(res.body.decision, "prepared_for_signoff", `reason: ${res.body.reason}`);
  assert.equal(row.notice.noticeEndDate, "2026-10-19");
  assert.equal(row.notice.discrepancy, "later_than_statutory");

  // 24 accrued - 6.5 used = 17.5 days. The half day is the point: a whole-number
  // balance cannot show whether the subtraction happened at all, and a payout
  // that silently truncated to 17 would be short by 8 hours' pay.
  assert.equal(row.payout.lines.length, 1);
  assert.equal(row.payout.lines[0].daysAvailable, 17.5);
  assert.equal(row.payout.lines[0].hoursPerDay, 8);
  assert.equal(row.payout.totalInRemoteInteger, 399000, "17.5 days x 8 h x 28.50 EUR");
  assert.equal(detail(res.body, "PTO payout"), "3990.00 EUR — from the leave balances on record");
});

test("POSITIVE: a leaving date exactly on the statutory date still reaches a sign-off", async () => {
  const { res, row } = await submit("uc05-pt-exact", "uc05-success-exact");

  // The boundary. src/uc05/policyEngine.js escalates `earlier_than_statutory`
  // only, so the day itself must pass — off-by-one in that comparison would
  // send a lawful resignation to a legal desk.
  assert.equal(row.notice.noticeEndDate, "2026-10-19");
  assert.equal(row.notice.proposedEndDate, "2026-10-19");
  assert.equal(row.notice.discrepancy, "match");
  assert.equal(row.notice.discrepancyDays, 0);
  assert.equal(res.body.decision, "prepared_for_signoff", `reason: ${res.body.reason}`);

  // A TYPED ZERO IS AN ANSWER. The days-used box holds "0", which
  // buildTimeOffBalances() forwards rather than omitting (finding F-35), so the
  // payout is the full 12-day accrual and its source names the records.
  assert.equal(row.payout.lines[0].daysAvailable, 12);
  assert.equal(row.payout.source, "time_off_records");
  assert.equal(row.payout.totalInRemoteInteger, 249600, "12 days x 8 h x 26.00 EUR");
});

test("POSITIVE: the same employee read before their second anniversary gets the shorter bracket", async () => {
  const { res, row } = await submit("uc05-pt-under-two-years", "uc05-success-bracket");

  // The bracket lookup, shown returning its OTHER answer. Every other Portuguese
  // scenario on the page sits in the 60-day half, and a lookup only ever seen
  // returning one value demonstrates no more than a constant would.
  assert.equal(row.notice.tenureMonths, 22);
  assert.equal(row.notice.noticeDays, 30, "Portugal's under-two-year bracket");
  assert.equal(row.notice.noticeEndDate, "2021-05-31");
  assert.equal(res.body.decision, "prepared_for_signoff", `reason: ${res.body.reason}`);
  assert.equal(row.payout.totalInRemoteInteger, 123200, "(9 - 2) days x 8 h x 22.00 EUR");

  // The other half of the same pair, asserted here so the two figures can never
  // drift onto one shared value without a failure.
  const over = await submit("uc05-pt-clean", "uc05-success-bracket-control");
  assert.notEqual(over.row.notice.noticeDays, row.notice.noticeDays);
  assert.equal(over.row.notice.noticeDays, 60);
});

// ---------------------------------------------------------------------------
// 3. THE NOTES ARE CLAIMS, AND CLAIMS GET RUN
// ---------------------------------------------------------------------------
// The Germany quick-fill's note used to say the empty holiday boxes make the
// result "say the balance is unknown rather than showing a zero nobody worked
// out". Driven, the payout row reads exactly `0.00 EUR — no leave balances are recorded for this employee`:
// the source tag is the honest half, and the zero is right there on the screen.
// A note nobody executes is how that survived. These two run them.

test("every figure a UC-05 quick-fill quotes in its note is the figure it produces", async () => {
  const quoted = [
    { id: "uc05-pt-clean", ref: "uc05-note-clean", text: "2,704.00 EUR", line: "2704.00 EUR" },
    { id: "uc05-pt-payout", ref: "uc05-note-payout", text: "3,990.00 EUR", line: "3990.00 EUR" },
  ];

  for (const q of quoted) {
    const { scenario, res } = await submit(q.id, q.ref);
    assert.ok(scenario.note.includes(q.text), `${q.id}'s note no longer quotes ${q.text}: ${scenario.note}`);
    assert.ok(
      String(detail(res.body, "PTO payout")).startsWith(q.line),
      `${q.id}'s note claims ${q.text} and the run produced ${detail(res.body, "PTO payout")}`
    );
  }
});

test("the blank-balance quick-fill really does print a zero, which is what its note now says", async () => {
  const { scenario, res } = await submit("uc05-de", "uc05-note-blank");
  assert.equal(detail(res.body, "PTO payout"), "0.00 EUR — no leave balances are recorded for this employee");
  assert.ok(
    /reads 0\.00/.test(scenario.note),
    `the note no longer describes the zero the page prints: ${scenario.note}`
  );
  assert.ok(
    !/unknown/i.test(scenario.note),
    `the note claims the balance is shown as unknown, and it is shown as 0.00: ${scenario.note}`
  );
});

// ---------------------------------------------------------------------------
// 4. ACTIONABLE IN THE SIDEBAR — the other dead end
// ---------------------------------------------------------------------------
// A report that reaches `prepared_for_signoff` and then renders no sign-off
// button is the same demonstration of nothing, approached from the far side.
// The verdict is READ from the surface the sidebar calls
// (GET /api/resignations/by-ticket/:externalRef, which consults
// evaluateResignationActionability in src/uc05/signoffPolicy.js) rather than
// re-derived here — a test that re-implements the policy agrees with itself.

test("POSITIVE: each successful quick-fill leaves a case the sidebar can act on", async () => {
  for (const id of ["uc05-pt-clean", "uc05-pt-payout", "uc05-pt-exact", "uc05-pt-under-two-years"]) {
    const scenario = scenarios().uc05.find((s) => s.id === id);
    const { portal, uc05Api } = world();
    const externalRef = `uc05-sidebar-${id}`;

    const submitted = await call(portal, {
      method: "POST",
      path: "/api/requests/uc05",
      body: uc05Body(scenario, externalRef),
    });
    assert.equal(submitted.body.decision, "prepared_for_signoff", `${id}: ${submitted.body.reason}`);

    const view = await call(uc05Api, { path: `/api/resignations/by-ticket/${encodeURIComponent(externalRef)}` });
    assert.equal(view.status, 200, `${id}: the sidebar found no case for its own reference`);
    assert.equal(view.body.found, true);
    assert.equal(view.body.actionable, true, `${id} renders no sign-off control: ${view.body.actionableReason}`);
    assert.equal(view.body.resignation.decision, "prepared_for_signoff");
    assert.ok(view.body.resignation.notice.noticeEndDate, `${id} reached the sidebar with no statutory date`);
    assert.ok(
      Number.isInteger(view.body.resignation.payout.totalInRemoteInteger),
      `${id} reached the sidebar with no payout figure`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. THE CONTRAST CASE IS STILL THERE AND STILL REFUSES
// ---------------------------------------------------------------------------
// Kept deliberately: a row of buttons that only ever succeeds is exactly as
// uninformative as the one that only ever refused, and this scenario is the one
// that reached the live account as the 23-day shortfall.

test("the short-notice Portuguese scenario still escalates, and is marked refused", async () => {
  const { scenario, res } = await submit("uc05-pt", "uc05-contrast-short");
  assert.equal(scenario.fails, true, "the contrast case is no longer marked refused on its button");
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "statutory_discrepancy");
  assert.ok(res.body.flags.includes("discrepancy_days_-23"), `flags: ${JSON.stringify(res.body.flags)}`);
});
