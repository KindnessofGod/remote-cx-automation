/**
 * W-3 — HOW MUCH NOTICE THERE ACTUALLY IS.
 *
 * A request filed four days before departure and one filed three months out
 * produced byte-identical output on the specialist's panel. Lead time is the
 * first thing a real mobility team triages on, and it is the fact that decides
 * whether every other remedy this panel names is real or decorative: "obtain
 * the destination's authorization before approving", "obtain the certificate
 * named below", a Modelo 21-RFI that must reach the payer by the 20th — each
 * has a lead time of weeks.
 *
 * THREE PROPERTIES ARE PINNED HERE AND EACH IS A DECISION, NOT A DETAIL:
 *
 * 1. IT IS SOFT, ALWAYS. Short notice is neither an immigration bar nor a
 *    data-quality fault, and those two are the whole of UC-04's blocking set
 *    (docs/UC04-RESEARCH-FINDINGS.md §5). Every mobility product surveyed
 *    clears the low-risk and routes the rest to a named human; none refuses a
 *    trip on its own authority (§3). It may move the level to `medium`. It may
 *    never reach `high` — that routes to the Tier-2 legal queue UC-04.md
 *    reserves for unconfirmed jurisdictions — and it may never block.
 *
 * 2. THE LINE IS A FLOOR AND MUST NOT BORROW A CEILING'S WORDS. Every other
 *    measurement on this panel is a ceiling, so the renderers say "67 of 90
 *    days" and "23 days left". Said about a minimum that inverts: "91 of 14
 *    days, 77 days left" reads as the worst row on the page when it is the
 *    safest.
 *
 * 3. THE 14 DAYS ARE THIS SYSTEM'S OWN AND THE ROW SAYS SO. No authority sets
 *    a notice period for a workation. A limit a reader takes for a rule is
 *    worse than no limit at all.
 *
 * And the fourth, which is the n8n discipline this repo already runs on the
 * gate bodies: the deployed Code node must reach the same answer, or production
 * tells a specialist something this file has never seen.
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

import { classifyRisk, LEAD_TIME_MINIMUM_DAYS } from "../src/uc04/riskMatrix.js";
import { evaluate } from "../src/uc04/policyEngine.js";
import { describeDecisionBasis } from "../src/uc04/decisionFacts.js";

const NOW = "2026-09-01T00:00:00Z";

const factorsFor = (startDate, over = {}) => ({
  homeCountry: "US",
  nationality: "US",
  destination: { country: "NL" },
  startDate,
  endDate: startDate,
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  priorTravel: [],
  ...over,
});

function riskFor(startDate, over = {}) {
  const f = factorsFor(startDate, over);
  return classifyRisk({
    sourceCountry: f.homeCountry,
    homeCountry: f.homeCountry,
    nationality: f.nationality,
    destinationCountry: f.destination.country,
    startDate: f.startDate,
    endDate: f.endDate,
    visaType: f.visaType,
    jobDuties: f.jobDuties,
    hasContractSigningAuthority: f.hasContractSigningAuthority,
    travelHistory: [],
    now: NOW,
  });
}

const leadRowFor = (startDate) => {
  const f = factorsFor(startDate);
  const risk = riskFor(startDate);
  const basis = describeDecisionBasis({
    authorizationRow: { factors: f, risk, flags: (risk.flags ?? []).map((x) => x.code ?? x), tripDays: 1 },
  });
  return basis.measurements.find((m) => m.key === "lead_time");
};

// ---------------------------------------------------------------------------
// The number itself
// ---------------------------------------------------------------------------

test("notice is counted in whole calendar days from now to departure", () => {
  assert.equal(riskFor("2026-09-05").leadTimeDays, 4);
  assert.equal(riskFor("2026-09-15").leadTimeDays, 14);
  assert.equal(riskFor("2026-12-01").leadTimeDays, 91);
});

test("the count is measured on day boundaries, so the clock time cannot move it", () => {
  // A trip starting tomorrow is one day away at 00:01 and at 23:59. Counting in
  // elapsed milliseconds would call the same trip 0 days at one hour and 1 at
  // another, which is how a notice period silently changes with the time of day
  // an agent happens to open the ticket.
  const early = classifyRisk({ ...riskInput("2026-09-15"), now: "2026-09-01T00:00:01Z" });
  const late = classifyRisk({ ...riskInput("2026-09-15"), now: "2026-09-01T23:59:59Z" });
  assert.equal(early.leadTimeDays, late.leadTimeDays);
  assert.equal(early.leadTimeDays, 14);
});

function riskInput(startDate) {
  const f = factorsFor(startDate);
  return {
    sourceCountry: f.homeCountry,
    homeCountry: f.homeCountry,
    nationality: f.nationality,
    destinationCountry: f.destination.country,
    startDate: f.startDate,
    endDate: f.endDate,
    visaType: f.visaType,
    jobDuties: f.jobDuties,
    hasContractSigningAuthority: f.hasContractSigningAuthority,
    travelHistory: [],
  };
}

// ---------------------------------------------------------------------------
// 1. It is soft, always
// ---------------------------------------------------------------------------

test("short notice raises a flag and moves the level to medium — never high, never blocked", () => {
  const short = riskFor("2026-09-05");
  assert.ok(short.flags.includes("lead_time_short"));
  assert.equal(short.riskLevel, "medium");

  const comfortable = riskFor("2026-12-01");
  assert.ok(!comfortable.flags.includes("lead_time_short"));
  assert.equal(comfortable.riskLevel, "low");
});

test("Remote's recommended window is reported and never flagged", () => {
  // Two lines doing different jobs. 14 days is the floor below which Remote's
  // own process changes — that raises a flag. 21 days is the bottom of the
  // window Remote RECOMMENDS, and a trip inside a vendor's own stated range is
  // not an exception. Treating advice as a threshold is how this repository has
  // twice turned a recommendation into a refusal (C-10, C-20).
  const belowRecommended = leadRowFor("2026-09-16"); // 15 days
  assert.equal(belowRecommended.state, "attention");
  assert.match(belowRecommended.note, /Advice, not a threshold/);
  assert.ok(!riskFor("2026-09-16").flags.includes("lead_time_short"));
  assert.equal(riskFor("2026-09-16").riskLevel, "low", "advice moved the risk level");

  const comfortable = leadRowFor("2026-10-01"); // 30 days
  assert.equal(comfortable.state, "within_limit");
  assert.match(comfortable.note, /inside the three-to-eight week window Remote recommends/);
});

test("the boundary is inclusive of the minimum — exactly 14 days is not short", () => {
  assert.ok(!riskFor("2026-09-15").flags.includes("lead_time_short"), "14 days is the minimum, not below it");
  assert.ok(riskFor("2026-09-14").flags.includes("lead_time_short"), "13 days is below the minimum");
});

test("short notice never changes the decision — the request is still approvable", () => {
  // THE PROPERTY THAT MATTERS MOST. A gate that refuses on short notice would
  // send an ordinary trip to the Tier-2 legal queue, which is the defect §7
  // item 7 already records once. This one is a fact on a screen.
  const employment = { id: "e", status: "active", company_id: "c", custom_fields: { workation_permission: true } };
  const decide = (startDate) =>
    evaluate({ identityVerified: true, employment, factors: factorsFor(startDate), now: NOW, travelHistory: [] });

  const short = decide("2026-09-05");
  const comfortable = decide("2026-12-01");
  assert.equal(short.decision, "ready_for_approval");
  assert.equal(short.reason, "all_gates_passed");
  assert.equal(short.decision, comfortable.decision);
  assert.equal(short.reason, comfortable.reason);
  // The only difference between the two is the flag and the level it moved.
  assert.ok(short.flags.includes("lead_time_short"));
  assert.ok(!comfortable.flags.includes("lead_time_short"));
});

test("a trip already under way is start_in_past, which blocks above this and returns first", () => {
  // Negative lead time must never present as "short notice" — the request is
  // refused for a different reason, by a gate that runs earlier.
  const past = riskFor("2026-08-01");
  assert.equal(past.riskLevel, "blocked");
  assert.ok(past.reasons.includes("start_in_past"));
  assert.ok(!past.flags.includes("lead_time_short"));
  assert.equal(past.leadTimeDays, null, "a blocked run reports no soft measurements, the same as cumulativeDays");
});

// ---------------------------------------------------------------------------
// 2. The line is a floor
// ---------------------------------------------------------------------------

test("the measurement row declares its limit is a floor, and is never 'breached'", () => {
  const short = leadRowFor("2026-09-05");
  assert.equal(short.comparison, "floor");
  assert.equal(short.limit, LEAD_TIME_MINIMUM_DAYS);
  assert.equal(short.measured, 4);
  assert.equal(short.headroom, 4 - LEAD_TIME_MINIMUM_DAYS);
  // `breached` is a ceiling concept. "Over the limit" is exactly what 4 days
  // against a 14-day minimum is not, and its tone is the one reserved for
  // things an approval cannot override.
  assert.equal(short.breached, false);
  assert.equal(short.state, "urgent");

  const comfortable = leadRowFor("2026-12-01");
  assert.equal(comfortable.state, "within_limit");
  assert.equal(comfortable.breached, false);
});

test("the renderers say a floor's words, not a ceiling's", () => {
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  // The summary line: "4 days · 14 days minimum", never "4 of 14 days".
  assert.match(main, /m\.comparison === "floor"/);
  assert.match(main, /" minimum"/);
  // The margin: short or spare, never "left".
  assert.match(main, /" short"/);
  assert.match(main, /" spare"/);
  // The detail block: Minimum, and Short by / Margin.
  assert.match(main, /isFloor \? "Minimum" : "Limit"/);
  assert.match(main, /"Short by" : "Margin"/);
  // AND THE PLURAL. "1 days short" is the sort of thing a specialist reads as
  // evidence nobody looked at the screen.
  assert.match(main, /function amount\(n, unit\)/);
});

test("one day short reads as one day, not as '1 days'", () => {
  const row = leadRowFor("2026-09-14");
  assert.equal(row.measured, 13);
  assert.match(row.note, /^13 days until departure/);
  const oneDay = leadRowFor("2026-09-02");
  assert.match(oneDay.note, /^1 day until departure/);
  assert.doesNotMatch(oneDay.note, /1 days/);
});

// ---------------------------------------------------------------------------
// 3. The line is this system's own, and says so
// ---------------------------------------------------------------------------

test("the row carries Remote's own guidance as its authority, marked as vendor guidance", () => {
  /* UPGRADED THE DAY IT SHIPPED, and the upgrade is the point. This asserted
     `[PROPOSED]` and `authority === null`, which was honest about a number this
     project had chosen. It did not need to choose one: Remote publishes a notice
     expectation for exactly this request, and rung 1 of the substitution ladder
     is never overridden by a lower rung. What must NOT drift is the marking —
     `[VENDOR-PUBLIC]` is not `[CONFIRMED]`, and a vendor's process expectation
     is not a rule of law, which is exactly what makes an exception the
     specialist's call rather than a refusal. */
  const row = leadRowFor("2026-09-05");
  assert.match(row.basis.status, /\[VENDOR-PUBLIC\]/);
  assert.doesNotMatch(row.basis.status, /\[CONFIRMED\]/, "vendor guidance is being dressed as a verified rule");
  assert.match(row.basis.authority, /Remote Help Center, article 37802834593805/);
  assert.equal(row.basis.reviewedOn, "2026-08-18");
  assert.match(row.basis.detail, /3-8 weeks before your intended departure/);
  assert.match(row.basis.detail, /not a rule\s*\n?\s*of law|Neither is a rule/);
  // NO SOURCE PATH. This block renders straight at an approver, and a
  // `src/uc0N` path there is engineering backlog wearing a provenance label —
  // test/zafSidebarLayout.test.js refuses it for every surface.
  assert.doesNotMatch(JSON.stringify(row.basis), /src\/uc0\d/);
});

// ---------------------------------------------------------------------------
// 4. The deployed node agrees
// ---------------------------------------------------------------------------

test("the n8n Workation Gates body computes the same notice and raises the same flag", () => {
  // The gates exist twice (CLAUDE.md §6). A number that differs between the two
  // paths is a specialist being told two things about one trip, and no test
  // that imports a function can see it.
  const source = readFileSync(new URL("../workflows/nodes-uc04/workationGates.js", import.meta.url), "utf8");
  const run = (startDate) => {
    const request = {
      employmentId: "emp_active_001",
      session: { companyId: "co", authenticatedAdminId: "admin" },
      externalRef: "lead-1",
      source: "webhook",
      now: NOW,
      travelHistory: [],
      factors: factorsFor(startDate),
    };
    const sandbox = {
      $: () => ({ first: () => ({ json: request }) }),
      $input: {
        first: () => ({
          json: { data: { employment: { id: "emp_active_001", status: "active", company_id: "co", custom_fields: { workation_permission: true } } } },
        }),
      },
    };
    return JSON.parse(JSON.stringify(vm.runInNewContext(`(function () {\n${source}\n})()`, sandbox, { timeout: 5000 })[0].json));
  };

  for (const startDate of ["2026-09-05", "2026-09-14", "2026-09-15", "2026-12-01"]) {
    const node = run(startDate);
    const real = riskFor(startDate);
    assert.equal(node.risk.leadTimeDays, real.leadTimeDays, `lead time diverged for ${startDate}`);
    assert.equal(
      node.risk.flags.includes("lead_time_short"),
      real.flags.includes("lead_time_short"),
      `the flag diverged for ${startDate}`
    );
    assert.equal(node.risk.riskLevel, real.riskLevel, `the level diverged for ${startDate}`);
  }
});
