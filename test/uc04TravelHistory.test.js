// ---------------------------------------------------------------------------
// uc04TravelHistory.test.js — UC-04's two day thresholds, from both sides
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `src/portal/server.js` sent `travelHistory: []` as a literal at the UC-04
// call site. The comment above it said the portal has no source of prior trips
// and that inventing one would make the cumulative-day gate look like it had
// data it does not have. The first clause was true; the conclusion was not. The
// effect was that BOTH of UC-04's day thresholds —
//
//   * the Schengen 90-days-in-a-rolling-180 immigration limit, and
//   * the 183-days-in-a-trailing-365 tax-residency watch
//
// — were unreachable from the portal for every request ever filed through it.
// Neither could fire, for anyone.
//
// AND NOTHING WOULD HAVE CAUGHT IT. That is the point of this file. The suite
// was full of assertions that those gates REFUSE the right inputs, and every
// one of them passed, because they call `classifyRisk()` directly with a
// history the portal could never supply. A gate that structurally cannot fire
// and a gate that is appropriately quiet produce identical output, identical
// flags and identical green runs (CLAUDE.md §4, BUILD-LOG §3.30). Only a
// POSITIVE test — "this input MUST produce this flag, through the surface a
// person actually uses" — separates them, and only a pair of them separates a
// threshold that works from one that fires on everything.
//
// So every threshold below is asserted in BOTH directions through the REAL
// portal handler, and the reported figure is checked against the matrix's own
// exported counter rather than against a number written down here.
//
// TWO LIMITS, TWO WINDOWS, TWO QUESTIONS — and the case where they disagree is
// the one worth having. A traveller can be comfortably inside the immigration
// limit and past the residency watch on the same stated history, because one
// looks back 180 days and the other 365. A demo showing one number is less
// instructive than one showing the two can point different ways.
//
// EVERY DATE HERE IS INSENSITIVE TO FINDING C-1
// (docs/knowledge/layer-1-statutory/CONTRADICTIONS.md). This code computes ONE
// trailing 180-day window anchored at the trip start; Reg. (EU) 2016/399
// Art. 6(1) evaluates "the 180-day period preceding each day of stay". Those
// are different computations. Nothing here is changed on the strength of that
// finding — it is a separate, reviewed unit of work — but every scenario is
// placed far enough from 90 that both computations reach the same verdict, so
// no test in this file pins a number the regulation disputes.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler, buildTravelHistory } from "../src/portal/server.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { draftSummary } from "../src/uc04/requestParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";
import { computeCumulativeDays, tripDurationDays, SCHENGEN, DNV_COUNTRIES } from "../src/uc04/riskMatrix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// A literal, and registered in TEST_PORTS in src/shared/ports.js — the scan in
// test/ports.test.js compares the two directions and fails on either half. 4112
// is the first free slot in TEST_BAND (4090-4149); 4098 reads free and is
// portalUc03Continuation.test.js's.
const REMOTE_PORT = 4112;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

let remote;
let remoteServer;
let handler;

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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    h(req, res).catch(reject);
  });
}

const post = (body) => callApi(handler, { method: "POST", path: "/api/requests/uc04", body });

/** The mock's own always-active, workation-permitted fixture. */
const SUBJECT = "emp_active_001";

/** Everything a UC-04 request needs that is not the subject of a given test. */
const BASE = {
  persona: "admin",
  employmentId: SUBJECT,
  homeCountry: "DE",
  nationality: "DE",
  destinationCountry: "ES",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  now: "2026-08-15",
};

const detailFor = (body, label) => (body.details ?? []).find((d) => d.label === label);

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
  handler = createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores: {
      uc02: new ExpenseStore(),
      uc03: new CaseStore(),
      uc04: new AuthorizationStore(),
      uc05: new ResignationStore(),
      uc07: new RelocationDossierStore(),
      uc08: new TaxDossierStore(),
      uc09: new AdjustmentStore(),
    },
    llm: FAKE_LLM,
  });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 0. The literal is gone — the defect itself, pinned
// ---------------------------------------------------------------------------
// A behavioural test alone would not stop someone re-hard-coding the empty
// array while every other assertion here still passed on a direct call. This
// reads the real file, with comments stripped, so the prose ABOUT the old
// literal (which this repo deliberately keeps) cannot satisfy it.

test("the UC-04 adapter no longer hard-codes an empty travel history", () => {
  const source = readFileSync(join(__dirname, "..", "src", "portal", "server.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/travelHistory:\s*\[\s*\]/.test(source),
    "src/portal/server.js hard-codes travelHistory: [] again — every day threshold in UC-04 is unreachable from the portal while it does"
  );
  assert.ok(
    /travelHistory:\s*travel\.periods/.test(source),
    "the UC-04 adapter should forward the requester's stated prior stays"
  );
});

// ---------------------------------------------------------------------------
// 1. Schengen 90/180 — under, and over
// ---------------------------------------------------------------------------

test("POSITIVE, UNDER: 30 stated Schengen days plus a 14-day trip clears 90/180, and the panel states the figure and its headroom", async () => {
  const travelHistory = [{ country: "ES", startDate: "2026-07-01", endDate: "2026-07-30" }];
  const res = await post({
    ...BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    externalRef: "th-under-90",
    travelHistory,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(!res.body.flags.includes("schengen_overstay"), "nothing should have breached the Schengen limit");

  // The REPORTED figure must equal the COMPUTED one. A threshold row whose
  // number is written down in the test proves the sentence renders, not that
  // it is true — so the expected value comes from the matrix's own exported
  // counter, over the matrix's own window.
  const prior = computeCumulativeDays({
    travelHistory,
    country: "ES",
    windowStart: "2026-03-05", // 2026-09-01 minus 180 days
    windowEnd: "2026-09-01",
  });
  const trip = tripDurationDays("2026-09-01", "2026-09-14");
  assert.equal(prior.days, 30);
  assert.equal(trip, 14);

  const row = detailFor(res.body, "Schengen 90-in-180");
  assert.ok(row, "the panel should carry a Schengen row when the destination is in Schengen");
  assert.match(row.value, /Within the limit/);
  // THE COUNTRY BY NAME, NEVER THE CODE. `ES` still decides — it is what
  // computeCumulativeDays() counts against and what the request carried — but
  // this row is prose a traveller reads, and countryLabel() names it there.
  assert.match(row.value, new RegExp(`${prior.days} day\\(s\\) already stated in Spain`));
  assert.match(row.value, new RegExp(`= ${prior.days + trip} of 90`));
  assert.match(row.value, new RegExp(`${90 - (prior.days + trip)} day\\(s\\) of headroom`));
});

test("POSITIVE, OVER: 120 stated Schengen days plus a 21-day trip breaches 90/180, and the number is stated", async () => {
  const travelHistory = [{ country: "ES", startDate: "2026-04-01", endDate: "2026-07-29" }];
  const res = await post({
    ...BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-21",
    externalRef: "th-over-90",
    travelHistory,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "blocked");
  assert.equal(res.body.reason, "schengen_90_180_exceeded");
  assert.ok(res.body.flags.includes("schengen_overstay"));

  const prior = computeCumulativeDays({
    travelHistory,
    country: "ES",
    windowStart: "2026-03-05",
    windowEnd: "2026-09-01",
  });
  const total = prior.days + tripDurationDays("2026-09-01", "2026-09-21");
  assert.equal(total, 141);

  const row = detailFor(res.body, "Schengen 90-in-180");
  assert.match(row.value, /OVER THE LIMIT/);
  assert.match(row.value, new RegExp(`= ${total} of 90`));
  assert.match(row.value, new RegExp(`over by ${total - 90}`));

  // A hard block returns before the residency window is ever measured, and the
  // panel must say THAT rather than print a zero or fall silent. "Not reached"
  // and "within the line" are opposite facts.
  const watch = detailFor(res.body, "183-in-365 tax-residency watch");
  assert.match(watch.value, /Not reached/);
  assert.ok(!/of 183/.test(watch.value), "no total may be stated for a count that was never taken");
});

// ---------------------------------------------------------------------------
// 2. The 183-in-365 tax-residency watch — under, and over
// ---------------------------------------------------------------------------
// Driven against a NON-Schengen destination on purpose: a Schengen destination
// with enough days to pass 183 would be blocked by the 90/180 gate first, so
// the watch could never be observed alone. Great Britain is inside the matrix's
// curated scope, outside SCHENGEN and outside DNV_COUNTRIES, and forms no known
// non-treaty pair with DE — so the ONLY thing that can move the outcome here is
// the day count, which is what makes it a clean test of the day count.

test("POSITIVE, UNDER: 100 stated GB days plus a 30-day trip stays under the 183 watch, with the headroom stated", async () => {
  const travelHistory = [{ country: "GB", startDate: "2026-01-05", endDate: "2026-04-14" }];
  const res = await post({
    ...BASE,
    destinationCountry: "GB",
    visaType: "business_visa",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    externalRef: "th-under-183",
    travelHistory,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(
    !res.body.flags.includes("tax_residency_watch"),
    "130 days is not 183 — the watch must not fire, or it fires on everything"
  );

  const prior = computeCumulativeDays({
    travelHistory,
    country: "GB",
    windowStart: "2025-09-01", // 2026-09-01 minus 365 days
    windowEnd: "2026-09-01",
  });
  const total = prior.days + tripDurationDays("2026-09-01", "2026-09-30");
  assert.equal(total, 130);

  const row = detailFor(res.body, "183-in-365 tax-residency watch");
  assert.match(row.value, /Under the watch line/);
  assert.match(row.value, new RegExp(`= ${total} of 183`));
  assert.match(row.value, new RegExp(`${183 - total} day\\(s\\) of headroom`));

  // A non-Schengen destination gets no Schengen row at all — and that is a
  // third state, distinct from "within the limit" and from "suppressed".
  assert.equal(detailFor(res.body, "Schengen 90-in-180"), undefined);
});

test("POSITIVE, OVER: 170 stated GB days plus a 30-day trip raises tax_residency_watch, with the number", async () => {
  const travelHistory = [{ country: "GB", startDate: "2025-12-01", endDate: "2026-05-19" }];
  const res = await post({
    ...BASE,
    destinationCountry: "GB",
    visaType: "business_visa",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    externalRef: "th-over-183",
    travelHistory,
  });

  assert.equal(res.status, 200);
  // A watch is a FINDING for the specialist, not a refusal — the decision is
  // unchanged and the flag is what moved. Asserting the decision here as well
  // is deliberate: it stops anyone "fixing" the watch into a block.
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(res.body.flags.includes("tax_residency_watch"));

  const prior = computeCumulativeDays({
    travelHistory,
    country: "GB",
    windowStart: "2025-09-01",
    windowEnd: "2026-09-01",
  });
  const total = prior.days + tripDurationDays("2026-09-01", "2026-09-30");
  assert.equal(total, 200);

  const row = detailFor(res.body, "183-in-365 tax-residency watch");
  assert.match(row.value, /OVER THE WATCH LINE/);
  assert.match(row.value, new RegExp(`= ${total} of 183`));
  assert.match(row.value, new RegExp(`over by ${total - 183}`));

  // The figure the panel reports must be the figure the DECISION used, not a
  // second computation that happens to agree today.
  const cumulative = detailFor(res.body, "Cumulative days abroad");
  assert.match(cumulative.value, new RegExp(`${prior.days} day\\(s\\) over ${prior.periodsCounted} prior trip\\(s\\)`));
  assert.ok(
    !/a floor, not a count/.test(cumulative.value),
    "with a stated history this IS a count — the floor sentence would conceal the figure that decided the case"
  );
});

// ---------------------------------------------------------------------------
// 3. The two limits disagree — the case that makes the pair worth having
// ---------------------------------------------------------------------------

test("ONE HISTORY, TWO ANSWERS: comfortably inside the Schengen limit and past the 183-day watch at the same time", async () => {
  const travelHistory = [
    // Inside both windows.
    { country: "ES", startDate: "2026-07-01", endDate: "2026-08-14" },
    // Inside the 365-day residency window, OUTSIDE the 180-day Schengen one.
    // That is the entire reason the two thresholds answer differently.
    { country: "ES", startDate: "2025-10-01", endDate: "2026-02-28" },
  ];
  const res = await post({
    ...BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    externalRef: "th-disagree",
    travelHistory,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(!res.body.flags.includes("schengen_overstay"), "the immigration limit is not breached");
  assert.ok(res.body.flags.includes("tax_residency_watch"), "the residency watch IS past");

  const trip = tripDurationDays("2026-09-01", "2026-09-14");
  const schengen =
    computeCumulativeDays({ travelHistory, country: "ES", windowStart: "2026-03-05", windowEnd: "2026-09-01" }).days +
    trip;
  const residency =
    computeCumulativeDays({ travelHistory, country: "ES", windowStart: "2025-09-01", windowEnd: "2026-09-01" }).days +
    trip;

  // The numbers are the finding: 59 against a 90 limit, 210 against a 183 one,
  // from the same stated stays.
  assert.equal(schengen, 59);
  assert.equal(residency, 210);
  assert.ok(schengen <= 90 && residency > 183, "the scenario has stopped demonstrating a disagreement");

  assert.match(detailFor(res.body, "Schengen 90-in-180").value, new RegExp(`= ${schengen} of 90`));
  assert.match(detailFor(res.body, "183-in-365 tax-residency watch").value, new RegExp(`= ${residency} of 183`));
});

// ---------------------------------------------------------------------------
// 4. The DNV suppression, with a real number behind it
// ---------------------------------------------------------------------------
// DNV_COUNTRIES contains PT, and membership SUPPRESSES the Schengen check
// rather than adding one — so a traveller with a large stated Schengen history
// gets no 90/180 finding at all going to Portugal, on the strength of a
// five-entry list with `authority: null, version: null, reviewedOn: null`.
//
// THIS TEST DOES NOT FIX THAT AND MUST NOT. The suppression is a documented,
// deliberately-surfaced gap (DNV_COUNTRIES_PROVENANCE, KNOWLEDGE-SOURCES L1-07).
// What it pins is that the number which WOULD have been measured is visible
// beside the statement that it was not consulted — because a suppressed check
// and a passed check produce identical silence, and they are opposite facts.

test("SUPPRESSED, NOT PASSED: 85 stated Portuguese days would be 106 of 90, and the Schengen check is skipped anyway", async () => {
  assert.ok(SCHENGEN.has("PT"), "the premise of this test is that PT is inside Schengen");
  assert.ok(DNV_COUNTRIES.has("PT"), "the premise of this test is that PT suppresses the check");

  const travelHistory = [{ country: "PT", startDate: "2026-05-20", endDate: "2026-08-12" }];
  const res = await post({
    ...BASE,
    homeCountry: "NL",
    nationality: "NL",
    destinationCountry: "PT",
    visaType: "digital_nomad_visa",
    startDate: "2026-09-01",
    endDate: "2026-09-21",
    externalRef: "th-pt-suppressed",
    travelHistory,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(
    !res.body.flags.includes("schengen_overstay"),
    "the whole finding is that no overstay is raised despite the days"
  );

  const would =
    computeCumulativeDays({ travelHistory, country: "PT", windowStart: "2026-03-05", windowEnd: "2026-09-01" }).days +
    tripDurationDays("2026-09-01", "2026-09-21");
  assert.ok(would > 90, `${would} days must be over the limit, or this scenario demonstrates nothing`);

  const row = detailFor(res.body, "Schengen 90-in-180");
  assert.match(row.value, /NOT APPLIED/);
  assert.match(row.value, new RegExp(`= ${would} of 90`));
  // The two sentences that stop a reader filing this under "passed".
  assert.match(row.value, /the limit was excused/);
  assert.match(row.value, /uncited/);
});

// ---------------------------------------------------------------------------
// 5. An unreadable stay is refused, not quietly dropped
// ---------------------------------------------------------------------------
// UC-04's `computeCumulativeDays()` answers `{days: NaN}` for a stay whose
// dates it cannot read: `Math.max(NaN, winStart)` is NaN, the `end < start`
// guard never trips, and NaN loses EVERY comparison — so `> 90` and `> 183` are
// both silently false and the request clears. That is a defect in the
// calculator, reported rather than fixed here. This test pins the portal not
// being the thing that reaches it.

test("a stay the day counter cannot read is refused by name, never trimmed away", async () => {
  const res = await post({
    ...BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    externalRef: "th-unreadable",
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" }, // 123 days — would breach
      { country: "ES", startDate: "2026-04-01", endDate: "" }, // the poisoning row
    ],
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, "travel_history_unreadable");
  assert.match(res.body.reason, /prior stay 2/, "the refusal must name WHICH stay could not be read");
});

test("THE CALCULATOR NOW REFUSES FOR ITSELF — the premise this portal guard was built on is closed", () => {
  // WHAT THIS TEST USED TO SAY. It asserted `Number.isNaN(poisoned.days)`, and
  // it was right: `Math.max(NaN, winStart)` is NaN, the `end < start` guard
  // never tripped because `NaN < NaN` is false, and the count came back NaN —
  // which loses BOTH `> 90` and `> 183`, so a 123-day Spanish stay plus one
  // blank end date scored `low` with no reasons and no flags. NaN then
  // serialises to `null` through JSON, so the durable row read "not computed"
  // rather than "computed wrong".
  //
  // The arithmetic has been fixed, so the premise is now the opposite one, and
  // it is asserted here rather than deleted: the portal's intake guard is now
  // DEFENCE IN DEPTH rather than the only thing standing between a caller and a
  // silent clearance. The n8n path and any direct API caller reach the same
  // calculator and get the same refusal.
  const refused = computeCumulativeDays({
    travelHistory: [
      { country: "ES", startDate: "2026-05-01", endDate: "2026-08-31" },
      { country: "ES", startDate: "2026-04-01", endDate: "" },
    ],
    country: "ES",
    windowStart: "2026-03-05",
    windowEnd: "2026-09-01",
  });

  assert.equal(refused.status, "NOT_EVALUATED");
  assert.equal(refused.days, null);
  assert.ok(!Number.isNaN(refused.days), "a NaN would still be a number-shaped answer to a question nobody could answer");
  // THE REFUSAL MUST NOT BE MISTAKABLE FOR "NO DATA". `days: null` alone reads
  // exactly like the honest absence it used to impersonate, so the result
  // carries a status that says WHICH it is and a problem that names the row.
  assert.match(refused.problems.join(" "), /prior stay 2/);
  assert.equal(refused.periodsCounted, 0, "periodsCounted said 2 while days said nothing — the row asserted it had looked at two stays and produced no count");
});

test("a stay whose dates run backwards is refused too, rather than silently skipped", async () => {
  const res = await post({
    ...BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    externalRef: "th-backwards",
    travelHistory: [{ country: "ES", startDate: "2026-07-30", endDate: "2026-07-01" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "travel_history_unreadable");
  assert.match(res.body.reason, /ends \(2026-07-01\) before it starts/);
});

// ---------------------------------------------------------------------------
// 6. Absence is unchanged — the floor stays a floor
// ---------------------------------------------------------------------------

test("a request that states no prior stays behaves exactly as it did, and still calls its 0 a floor", async () => {
  const res = await post({
    ...BASE,
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    externalRef: "th-none",
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  const cumulative = detailFor(res.body, "Cumulative days abroad");
  assert.match(cumulative.value, /0 day\(s\) over 0 prior trip\(s\)/);
  assert.match(cumulative.value, /a floor, not a count/);
  // No measured threshold rows either: a limit printed with nothing measured
  // against it tells a reader a rule exists, which they already knew.
  assert.equal(detailFor(res.body, "Schengen 90-in-180"), undefined);
  assert.equal(detailFor(res.body, "Prior stays stated by the requester"), undefined);
});

// ---------------------------------------------------------------------------
// 7. buildTravelHistory() in isolation
// ---------------------------------------------------------------------------

test("buildTravelHistory drops an untouched row, keeps a stated one, and normalises the country", () => {
  const { periods, unreadable } = buildTravelHistory([
    { country: "", startDate: "", endDate: "" }, // the form's own empty row
    { country: " es ", startDate: "2026-07-01", endDate: "2026-07-30" },
  ]);
  assert.deepEqual(unreadable, []);
  assert.deepEqual(periods, [{ country: "ES", startDate: "2026-07-01", endDate: "2026-07-30" }]);
});

test("buildTravelHistory reports every unreadable row rather than the first", () => {
  const { periods, unreadable } = buildTravelHistory([
    { country: "ES", startDate: "next Tuesday", endDate: "2026-07-30" },
    { country: "", startDate: "2026-07-01", endDate: "2026-07-30" },
    { country: "ES", startDate: "2026-07-01", endDate: "2026-07-30" },
  ]);
  assert.equal(unreadable.length, 2, "a requester fixing one row at a time is a requester submitting three times");
  assert.match(unreadable[0], /prior stay 1/);
  assert.match(unreadable[1], /prior stay 2: no country/);
  // The good row is still parsed — the ADAPTER refuses the whole request; this
  // function's job is to report, not to decide.
  assert.equal(periods.length, 1);
});

test("buildTravelHistory tolerates the field being absent entirely", () => {
  assert.deepEqual(buildTravelHistory(undefined), { periods: [], unreadable: [] });
  assert.deepEqual(buildTravelHistory(null), { periods: [], unreadable: [] });
  assert.deepEqual(buildTravelHistory("2026-07-01"), { periods: [], unreadable: [] });
});
