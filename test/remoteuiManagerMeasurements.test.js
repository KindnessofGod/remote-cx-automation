// ---------------------------------------------------------------------------
// remoteuiManagerMeasurements.test.js — the person who signs sees the counts
// ---------------------------------------------------------------------------
// THE REPORT THIS ANSWERS, from a people-operations manager driving the live
// deployment on 2026-09-02 and asked whether she would authorise her team's
// travel on this screen. Her answer was no, and her reason was one sentence:
//
//   "The screen I decide from is materially thinner than the screen the employee
//    already saw. The traveller is shown a Schengen day-count, a tax-residency
//    watch line and an eighteen-rung explanation of what was checked. I am shown
//    a name, a two-letter country code, two dates and the words
//    `ready_for_approval`. I am the one carrying the border risk and the PE
//    exposure, and I have the least information of anyone in the chain."
//
// She proved it: she filed the "exactly on the Schengen line" case, the portal
// told the TRAVELLER "90 of 90 — 0 day(s) of headroom", and her approval row
// said "Risk level: low". The strings "90", "headroom" and "permanent
// establishment" appeared nowhere on her screen.
//
// The fix is not a new computation. It is the SAME `describeDecisionBasis()`
// the ZAF sidebar renders from, on the same stored row, passed through whole —
// because a second derivation is how the screen that DECIDES and the screen
// that REVIEWS come to word one trip differently.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluate as evaluateUc04 } from "../src/uc04/policyEngine.js";
import { describeDecisionBasis } from "../src/uc04/decisionFacts.js";
import { measurementsOf } from "../src/remoteui/workAuthRecords.js";

const ACTIVE_EMPLOYMENT = {
  status: "active",
  company_id: "company-1",
  custom_fields: { workation_permission: true },
};

/** The manager's own case: 76 prior days in NL plus a 14-day trip. */
function janesRow() {
  const factors = {
    homeCountry: "US",
    nationality: "US",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    destination: { country: "NL" },
    startDate: "2026-10-01",
    endDate: "2026-10-14",
  };
  const result = evaluateUc04({
    identityVerified: true,
    employment: ACTIVE_EMPLOYMENT,
    factors,
    now: "2026-09-14",
    travelHistory: [{ country: "NL", startDate: "2026-04-04", endDate: "2026-06-18" }],
  });
  return {
    result,
    row: {
      factors,
      risk: result.risk,
      tripDays: result.risk?.tripDays ?? null,
      cumulativeDays: result.risk?.cumulativeDays ?? null,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
    },
  };
}

test("the manager's row carries the Schengen count the traveller was already shown", () => {
  const { row, result } = janesRow();
  assert.equal(result.decision, "ready_for_approval", "fixture no longer reaches the approval path");

  const measurements = measurementsOf(row);
  const schengen = measurements.find((m) => m.key === "schengen_90_180");
  assert.ok(schengen, "the count that decides whether this trip is lawful is still missing from the approver's row");
  assert.ok(Number.isFinite(schengen.measured), "the row names a limit but not the measurement against it");
  assert.equal(schengen.limit, 90);

  // The tax watch line too — the other number she searched for and did not find.
  assert.ok(measurements.find((m) => m.key === "tax_residency_183"), "the 183-day watch line is missing");
});

test("NOTHING IS RE-DERIVED — these are the sidebar's own rows, verbatim", () => {
  // The rule `activityProfileOf()` already follows. Two derivations is how the
  // deciding screen and the reviewing screen come to word one trip differently,
  // and the wrong one is always the one nobody re-reads.
  const { row } = janesRow();
  assert.deepEqual(
    measurementsOf(row),
    describeDecisionBasis({ authorizationRow: row }).measurements,
    "the manager's screen is composing its own version of the counts"
  );
});

test("A FLOOR TRAVELS AS A FLOOR, and the renderer honours it", () => {
  const { row } = janesRow();
  const lead = measurementsOf(row).find((m) => m.key === "lead_time");
  assert.ok(lead, "notice-before-departure is missing from the approver's row");
  assert.equal(lead.comparison, "floor", "the one minimum on this screen is being carried as a ceiling");

  // Rendered by a ceiling renderer this prints "91 of 14 days · 77 days left"
  // on a trip three months out — arithmetically right, backwards, and it scans
  // as the worst row on the page when it is the safest.
  const js = readFileSync(new URL("../src/remoteui/assets/workauth.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("function renderMeasurements("), js.indexOf("function definition("));
  assert.match(fn, /comparison === "floor"/, "the renderer does not distinguish a floor from a ceiling");
  assert.match(fn, /minimum/, "a floor is not labelled as a minimum");
  assert.match(fn, /short by/, "a value UNDER a floor has no wording of its own");
  // And the ceiling branch still says "of", which is what a ceiling reads as.
  assert.match(fn, /" of "/);
});

test("a check that never ran is DRAWN, saying so — not silently dropped", () => {
  // Omitting it would leave the manager reading a page that looks complete. The
  // server decides which state a row is in; the renderer only prints it.
  const js = readFileSync(new URL("../src/remoteui/assets/workauth.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("function renderMeasurements("), js.indexOf("function definition("));
  assert.match(fn, /not measured on this run/, "an unmeasured row is dropped rather than reported");
});

test("a request with no stored decision publishes NOTHING, not an empty findings section", () => {
  // A request read from Remote or from the stand-in has no decision to describe.
  // An empty list renders as no section; a section asserting no findings would
  // be this screen claiming a clean bill it never computed.
  assert.deepEqual(measurementsOf(null), []);
  assert.deepEqual(measurementsOf({}), []);
});

test("a throwing describer costs the section, never the decision", () => {
  // This is the only surface Remote's API accepts a verdict from. Losing the
  // approve/decline controls because a describer threw would be an outage of
  // the decision itself.
  assert.deepEqual(measurementsOf({ get factors() { throw new Error("boom"); } }), []);
});

test("the scope composer actually PUTS them on the entry the page renders", () => {
  // The three tests above prove the composer is right and the renderer is
  // right. Neither notices if nothing ever joins them — which is the shape of
  // failure that ships a fix nobody sees. Asserted structurally because the
  // composer needs a live employer scope to run.
  const scope = readFileSync(new URL("../src/remoteui/workAuthScope.js", import.meta.url), "utf8");
  assert.match(scope, /entry\.measurements = measurementsOf\(record\)/, "the counts never reach the entry the page renders");
  assert.match(scope, /import \{[\s\S]*?measurementsOf[\s\S]*?\} from "\.\/workAuthRecords\.js"/);

  // And the page draws them. `renderMeasurements` existing is not the same
  // claim as it being called.
  const js = readFileSync(new URL("../src/remoteui/assets/workauth.js", import.meta.url), "utf8");
  assert.match(js, /renderMeasurements\(dl, entry\.measurements\)/, "the renderer is defined but never called");
});
