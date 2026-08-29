// ---------------------------------------------------------------------------
// uc04-travel-history-matrix.mjs  —  drive UC-04's day arithmetic for real
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-04's substance is the day counting: the Schengen 90/180 peak measured per
// day of stay (Reg. (EU) 2016/399 art. 6(1)), the 183-in-365 tax-residency
// watch, the union-not-sum overlap rule, and the refusal on a stay that cannot
// be read. Three of those four were rewritten in commit 73920c9 and NOTHING
// documented a set of inputs that demonstrates any of them: docs/DEMO-COUNTRIES.md's
// UC-04 rows were chosen BEFORE the rewrite and deliberately made insensitive
// to it, so by construction none of them shows the new behaviour.
//
// This script is the missing half. Every figure it prints is COMPUTED by the
// functions under test, never asserted from a label — the same discipline as
// scripts/demo-countries-matrix.mjs, whose shape it follows: an `observed`
// column, not an `expected` one.
//
// TWO LAYERS PER SCENARIO, and the difference matters:
//   ARITHMETIC — schengenPeakDays() / computeCumulativeDays() called directly.
//                Pure, offline, no employment record needed.
//   DECISION   — handleWorkationRequest() against a REAL Remote Sandbox
//                employment through the read-only stand-in, so the gates that
//                sit in front of the arithmetic (identity, employment status,
//                employer permission) really run.
// A scenario whose arithmetic is right and whose decision is wrong is a finding
// about the gates; one where both agree is a demonstrable demo row.
//
// NOT A TEST. It reaches the network on purpose and must never be imported by
// `npm test`. The standing guard on these figures is test/uc04TravelHistoryMatrix.test.js,
// which is hermetic and pins the arithmetic half only.
//
//     NODE_USE_ENV_PROXY=1 node scripts/uc04-travel-history-matrix.mjs
//     NODE_USE_ENV_PROXY=1 node scripts/uc04-travel-history-matrix.mjs --json out.json
//     node scripts/uc04-travel-history-matrix.mjs --arithmetic-only   # no network
//
// `--arithmetic-only` exists so the numbers can be re-derived with no
// credentials at all; it prints the same figures and simply leaves the decision
// column unrun rather than reporting a decision nobody took.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { writeFileSync } from "node:fs";

import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { normalizeCountryCode } from "../src/shared/countryCodes.js";

import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { draftSummary as uc04DraftSummary } from "../src/uc04/requestParser.js";
import {
  VISA_TYPES,
  JOB_DUTY_CATEGORIES,
  SCHENGEN,
  DNV_COUNTRIES,
  schengenPeakDays,
  computeCumulativeDays,
  tripDurationDays,
  travelHistoryProblems,
  SCHENGEN_LIMIT_DAYS,
  SCHENGEN_WINDOW_DAYS,
} from "../src/uc04/riskMatrix.js";

const ARITHMETIC_ONLY = process.argv.includes("--arithmetic-only");
const JSON_OUT = (() => {
  const i = process.argv.indexOf("--json");
  return i >= 0 ? process.argv[i + 1] : null;
})();

// ---------------------------------------------------------------------------
// Hosts and cast. The STAND-IN, not the raw gateway, and that is not drift:
// UC-04's second gate reads `employment.custom_fields.workation_permission`,
// a key the raw Sandbox returns for no employment at all, so every scenario
// against the gateway stops at `blocked / employer_permission_not_granted`
// before the risk matrix runs (CLAUDE.md §6, docs/DEMO-COUNTRIES.md §6.4).
// ---------------------------------------------------------------------------
const STANDIN = process.env.REMOTE_STANDIN_BASE_URL || "https://your-sandbox-standin.vercel.app";
const GATEWAY = process.env.REMOTE_API_BASE_URL || "https://gateway.remote-sandbox.com";
const TOKEN = process.env.REMOTE_API_TOKEN;

const standin = new RemoteClient({ baseUrl: STANDIN, token: TOKEN });
const gateway = new RemoteClient({ baseUrl: GATEWAY, token: TOKEN });

// The only two Sandbox records the stand-in carries an enrichment profile for
// (src/remotebridge/enrichment.js STANDIN_PROFILES) — so the only two that can
// reach a UC-04 decision other than `blocked`. Re-verified live before every
// run by verifyCast() below, because a dead id 404s in a way that reads as a
// credential or host fault and is neither.
const CARRIER = "3537d9ee-2017-4a53-952e-9d3b042aeab5"; // Alexandre Tremblay, CA, contractor, active
const COMPANY_ID = "a9d4ce72-7773-4ea3-830d-c5b36a15e48d";

// The origin country is an INPUT (`factors.homeCountry`), never the carrier
// record's own country, so a carrier changes nothing about the branch under
// test — it only makes the branch reachable.
const NOW = process.env.DEMO_NOW || new Date().toISOString().slice(0, 10);

// Every LLM seam forced into its unconfigured branch, the idiom every test file
// in this repo uses, so no scenario makes a real OpenAI call just because .env
// carries a key (CLAUDE.md §6).
const draft = (a) => uc04DraftSummary(a, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: "judge_disabled_for_matrix_run" });

// ---------------------------------------------------------------------------
// THE PRE-73920c9 ARITHMETIC, VENDORED VERBATIM.
//
// Two scenarios below exist to show what the fix CHANGED, and a claim about
// what the old code said is worthless unless the old code says it. This is the
// body of `computeCumulativeDays()` exactly as `git show 73920c9^:src/uc04/riskMatrix.js`
// carries it — a per-period SUM with no interval merge — plus the single
// trailing 180-day window anchored at the trip start that `classifyRisk()` used
// to compare against 90.
//
// It is a fossil and must never be imported by anything that decides. It exists
// so the "what the old arithmetic said" column is computed rather than
// remembered.
// ---------------------------------------------------------------------------
function legacyCumulativeDays({ travelHistory, country, windowStart, windowEnd }) {
  const winStart = new Date(windowStart).getTime();
  const winEnd = new Date(windowEnd).getTime();
  const target = normalizeCountryCode(country);
  if (!target) return { days: 0, periodsCounted: 0 };
  let days = 0;
  let periodsCounted = 0;
  for (const p of travelHistory ?? []) {
    if (normalizeCountryCode(p?.country) !== target) continue;
    const start = Math.max(new Date(p.startDate).getTime(), winStart);
    const end = Math.min(new Date(p.endDate).getTime(), winEnd);
    if (end < start) continue;
    days += Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    periodsCounted++;
  }
  return { days, periodsCounted };
}

/** The old Schengen verdict: one window anchored at the trip start, prior days summed, plus the trip. */
function legacySchengen({ travelHistory, country, tripStart, tripEnd }) {
  const startMs = new Date(tripStart).getTime();
  const winStart = new Date(startMs - SCHENGEN_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const cum = legacyCumulativeDays({ travelHistory, country, windowStart: winStart, windowEnd: tripStart });
  const trip = tripDurationDays(tripStart, tripEnd);
  const total = cum.days + trip;
  return { window: { from: winStart, to: tripStart }, prior: cum.days, trip, total, breached: total > SCHENGEN_LIMIT_DAYS };
}

/**
 * The figure the PORTAL's own result panel recomputes for the Schengen row
 * (src/portal/server.js describeTravelWindows()). It uses today's union-based
 * counter but the OLD single trailing 180-day window anchored at the trip
 * start, so it can disagree with the decision it is printed beside. Computed
 * here with the same call the portal makes, so the disagreement is observed
 * rather than alleged.
 */
function portalPanelSchengen({ travelHistory, country, tripStart, tripEnd }) {
  const from = new Date(new Date(tripStart).getTime() - SCHENGEN_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const cum = computeCumulativeDays({ travelHistory, country, windowStart: from, windowEnd: tripStart });
  const trip = tripDurationDays(tripStart, tripEnd);
  const total = cum.days === null || trip === null ? null : cum.days + trip;
  return { window: { from, to: tripStart }, prior: cum.days, trip, total };
}

// ---------------------------------------------------------------------------
// The scenarios. One behaviour each, named by the behaviour rather than by the
// route, because the route is incidental and the behaviour is the point.
// ---------------------------------------------------------------------------
const BASE = {
  startDate: "2026-09-07",
  endDate: "2026-09-27", // 21 days inclusive
  visaType: VISA_TYPES.schengen_short_stay,
  jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
};
const toNL = { homeCountry: "CA", nationality: "CA", destination: { country: "NL" } };
const toCA = {
  homeCountry: "GB",
  nationality: "GB",
  destination: { country: "CA" },
  visaType: VISA_TYPES.work_permit,
};

/** @type {Array<{id:string, behaviour:string, label:string, factors:object, travelHistory:Array, extra?:object}>} */
const SCENARIOS = [
  {
    id: "TH-00",
    behaviour: "no prior stays — 0 over 0 is a floor, not a count",
    label: "CA→NL, 21 days, no travel history at all",
    factors: { ...BASE, ...toNL },
    travelHistory: [],
  },
  {
    id: "TH-01",
    behaviour: "a real count that changes nothing",
    label: "CA→NL, 21 days, one 10-day prior NL stay — counting visibly happens, no flag moves",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "NL", startDate: "2026-08-01", endDate: "2026-08-10" }],
  },
  {
    id: "TH-02",
    behaviour: "approaching the Schengen 90/180 allowance",
    label: "CA→NL, 21 days, 67 prior NL days — the peak lands just under the line",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "NL", startDate: "2026-05-01", endDate: "2026-07-06" }],
  },
  {
    id: "TH-03",
    behaviour: "breaching the Schengen 90/180 allowance",
    label: "CA→NL, 21 days, 70 prior NL days — over by the smallest possible margin",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "NL", startDate: "2026-05-01", endDate: "2026-07-09" }],
  },
  {
    id: "TH-04",
    behaviour: "breaching with NO history — the trip is itself days of stay",
    label: "CA→NL, a single 100-day trip, empty travel history",
    factors: { ...BASE, ...toNL, endDate: "2026-12-15" },
    travelHistory: [],
  },
  {
    id: "TH-05",
    behaviour: "THE PER-DAY WINDOW MATTERING — per-trip blocks, per-day clears",
    label: "CA→NL, 60-day trip from 2026-09-01, 60 prior NL days ending 2026-05-04",
    factors: { ...BASE, ...toNL, startDate: "2026-09-01", endDate: "2026-10-30" },
    travelHistory: [{ country: "NL", startDate: "2026-03-06", endDate: "2026-05-04" }],
  },
  {
    id: "TH-06",
    behaviour: "overlapping stays — union, not sum, and the difference decides",
    label: "CA→NL, 45-day trip, two overlapping NL stays (31 + 32 stated days, 41 distinct)",
    factors: { ...BASE, ...toNL, endDate: "2026-10-21" },
    travelHistory: [
      { country: "NL", startDate: "2026-05-01", endDate: "2026-05-31" },
      { country: "NL", startDate: "2026-05-10", endDate: "2026-06-10" },
    ],
  },
  {
    id: "TH-07",
    behaviour: "the 180-day boundary — a stay inside it counts",
    label: "CA→NL, 21 days, a 10-day NL stay starting exactly on the peak window's first day",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "NL", startDate: "2026-04-01", endDate: "2026-04-10" }],
  },
  {
    id: "TH-08",
    behaviour: "the 180-day boundary — the same stay ten days earlier counts for nothing",
    label: "CA→NL, 21 days, the TH-07 stay shifted out of every window that peaks",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "NL", startDate: "2026-03-22", endDate: "2026-03-31" }],
  },
  {
    id: "TH-09",
    behaviour: "the 183-in-365 watch, measured and NOT fired",
    label: "GB→CA on a work permit, 21 days, 162 prior CA days — exactly on the line",
    factors: { ...BASE, ...toCA },
    travelHistory: [{ country: "CA", startDate: "2026-01-20", endDate: "2026-06-30" }],
  },
  {
    id: "TH-10",
    behaviour: "the 183-in-365 watch, fired",
    label: "GB→CA on a work permit, 21 days, 163 prior CA days — one day past the line",
    factors: { ...BASE, ...toCA },
    travelHistory: [{ country: "CA", startDate: "2026-01-19", endDate: "2026-06-30" }],
  },
  {
    id: "TH-11",
    behaviour: "an unreadable stay — refused, and the row is named",
    label: "CA→NL, a 123-day NL stay plus one row with a blank end date (73920c9's own case)",
    factors: { ...BASE, ...toNL },
    travelHistory: [
      { country: "NL", startDate: "2026-03-01", endDate: "2026-07-01" },
      { country: "NL", startDate: "2026-05-01", endDate: "" },
    ],
  },
  {
    id: "TH-12",
    behaviour: "an unreadable stay — dates the wrong way round",
    label: "CA→NL, one NL stay whose end precedes its start",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "NL", startDate: "2026-07-01", endDate: "2026-03-01" }],
  },
  {
    id: "TH-13",
    behaviour: "an unreadable stay — no country on the row",
    label: "CA→NL, one 123-day stay with an empty country",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "", startDate: "2026-03-01", endDate: "2026-07-01" }],
  },
  {
    id: "TH-14",
    behaviour: "a prior stay in a DIFFERENT Schengen state — counted for nothing (finding C-3)",
    label: "CA→NL, 21 days, 80 prior days in Spain",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "ES", startDate: "2026-05-01", endDate: "2026-07-19" }],
  },
  {
    id: "TH-15",
    behaviour: "⚠️ A COUNTRY NAME INSTEAD OF A CODE — silently dropped, no problem raised",
    label: "CA→NL, 21 days, the SAME 80-day stay written as \"Netherlands\" rather than \"NL\"",
    factors: { ...BASE, ...toNL },
    travelHistory: [{ country: "Netherlands", startDate: "2026-05-01", endDate: "2026-07-19" }],
  },
];

// ---------------------------------------------------------------------------
function arithmeticFor(sc) {
  const destination = sc.factors.destination.country;
  const { startDate, endDate } = sc.factors;
  const problems = travelHistoryProblems(sc.travelHistory);
  const tripDays = tripDurationDays(startDate, endDate);

  // THE SAME PREDICATE classifyRisk() USES, not a looser one. Asking
  // schengenPeakDays() about a Canadian trip produces a real number against a
  // limit that does not govern it — a figure nobody would ever act on, printed
  // in the same shape as one they would. `governs` says which case this is.
  const governs = SCHENGEN.has(destination) && !DNV_COUNTRIES.has(destination);
  const suppressed = SCHENGEN.has(destination) && DNV_COUNTRIES.has(destination);
  const peak = governs
    ? schengenPeakDays({
        travelHistory: sc.travelHistory,
        country: destination,
        tripStart: startDate,
        tripEnd: endDate,
      })
    : null;

  const residencyWindowFrom = new Date(new Date(startDate).getTime() - 365 * 86400000)
    .toISOString()
    .slice(0, 10);
  const residency = computeCumulativeDays({
    travelHistory: sc.travelHistory,
    country: destination,
    windowStart: residencyWindowFrom,
    windowEnd: startDate,
  });

  return {
    tripDays,
    travelHistoryProblems: problems,
    schengen: peak
      ? {
          governs: true,
          status: peak.status,
          peakDays: peak.peakDays,
          peakDate: peak.peakDate,
          window: peak.window ? `${peak.window.from} → ${peak.window.to}` : null,
          limit: peak.limit,
          breached: peak.breached,
          headroom: peak.peakDays === null ? null : peak.limit - peak.peakDays,
        }
      : {
          governs: false,
          why: suppressed
            ? `${destination} is in DNV_COUNTRIES, so the 90/180 check is SUPPRESSED — a suppressed check and a passed check produce identical silence`
            : `${destination} is outside the Schengen area, so the 90/180 allowance never governed this trip`,
        },
    residency: {
      status: residency.status,
      priorDays: residency.days,
      periodsCounted: residency.periodsCounted,
      window: `${residencyWindowFrom} → ${startDate}`,
      total: residency.days === null || tripDays === null ? null : residency.days + tripDays,
      limit: 183,
    },
    legacy: governs
      ? legacySchengen({
          travelHistory: sc.travelHistory,
          country: destination,
          tripStart: startDate,
          tripEnd: endDate,
        })
      : null,
    portalPanel: governs
      ? portalPanelSchengen({
          travelHistory: sc.travelHistory,
          country: destination,
          tripStart: startDate,
          tripEnd: endDate,
        })
      : null,
  };
}

async function decisionFor(sc) {
  const audit = new AuditLogger();
  const result = await handleWorkationRequest(
    {
      employmentId: CARRIER,
      session: { companyId: COMPANY_ID, authenticatedAdminId: "uc04_travel_matrix" },
      factors: sc.factors,
      travelHistory: sc.travelHistory,
      now: NOW,
      source: "uc04-travel-history-matrix",
      externalRef: `uc04-th-${sc.id.toLowerCase()}-${Date.now()}`,
    },
    { remote: standin, audit, authorizationStore: new AuthorizationStore(), draftSummary: draft, judge: fakeJudge }
  );
  const measurements = result.basis?.measurements ?? [];
  return {
    decision: result.decision,
    reason: result.reason,
    riskLevel: result.riskLevel,
    flags: result.flags,
    tripDays: result.tripDays,
    cumulativeDays: result.cumulativeDays,
    measurements: measurements.map((m) => ({
      key: m.key,
      state: m.state,
      measured: m.measured,
      limit: m.limit,
      headroom: m.headroom,
      window: m.window ? `${m.window.from} → ${m.window.to}` : null,
    })),
  };
}

async function verifyCast() {
  // A dead employment id 404s in a way that reads as a credential, host or
  // permission problem and is none of them (CLAUDE.md §6). Confirm against the
  // RAW gateway — the stand-in's job is to enrich, so asking it whether a
  // record exists is asking the wrong service.
  const e = await gateway.getEmployment(CARRIER);
  if (!e) throw new Error(`carrier ${CARRIER} did not resolve — list /v1/employments before debugging anything else`);
  return {
    id: CARRIER,
    name: e?.basic_information?.name ?? null,
    status: e?.status ?? null,
    country: e?.country?.code ?? null,
  };
}

const line = (s = "") => process.stdout.write(`${s}\n`);
const n = (v) => (v === null || v === undefined ? "—" : String(v));

async function main() {
  line("UC-04 TRAVEL-HISTORY MATRIX — observed, not expected");
  line(`now=${NOW}  host=${ARITHMETIC_ONLY ? "(arithmetic only, no network)" : STANDIN}`);
  let cast = null;
  if (!ARITHMETIC_ONLY) {
    cast = await verifyCast();
    line(`carrier=${cast.id}  ${n(cast.name)}  status=${n(cast.status)}  country=${n(cast.country)}  [verified live against the gateway]`);
  }
  line("");

  const rows = [];
  for (const sc of SCENARIOS) {
    const arithmetic = arithmeticFor(sc);
    let decision = null;
    let error = null;
    if (!ARITHMETIC_ONLY) {
      try {
        decision = await decisionFor(sc);
      } catch (e) {
        error = e.message;
      }
    }
    rows.push({ ...sc, arithmetic, decision, error });

    line(`── ${sc.id}  ${sc.behaviour}`);
    line(`   ${sc.label}`);
    line(`   input   factors=${JSON.stringify(sc.factors)}`);
    line(`           travelHistory=${JSON.stringify(sc.travelHistory)}`);
    const a = arithmetic;
    line(`   trip    ${n(a.tripDays)} day(s)`);
    if (a.travelHistoryProblems.length > 0) {
      line(`   PROBLEMS ${JSON.stringify(a.travelHistoryProblems)}`);
    }
    if (a.schengen.governs) {
      line(
        `   schengen ${a.schengen.status} peak=${n(a.schengen.peakDays)}/${n(a.schengen.limit)} on ${n(a.schengen.peakDate)} ` +
          `window=${n(a.schengen.window)} breached=${n(a.schengen.breached)} headroom=${n(a.schengen.headroom)}`
      );
    } else {
      line(`   schengen NOT GOVERNING — ${a.schengen.why}`);
    }
    line(
      `   residency ${a.residency.status} prior=${n(a.residency.priorDays)} over ${a.residency.periodsCounted} stay(s) ` +
        `+ trip = ${n(a.residency.total)}/183  window=${a.residency.window}`
    );
    if (a.legacy) {
      line(
        `   pre-73920c9 per-trip window ${a.legacy.window.from} → ${a.legacy.window.to}: ` +
          `${n(a.legacy.prior)} prior (SUMMED) + ${n(a.legacy.trip)} trip = ${n(a.legacy.total)}/90 breached=${a.legacy.breached}`
      );
    }
    if (a.portalPanel) {
      line(
        `   portal panel recompute (union arithmetic, start-anchored window): ${n(a.portalPanel.prior)} + ${n(a.portalPanel.trip)} = ${n(a.portalPanel.total)}/90`
      );
    }
    if (error) line(`   DECISION ERROR ${error}`);
    if (decision) {
      line(
        `   DECISION ${decision.decision} / ${decision.reason}  risk=${n(decision.riskLevel)}  flags=${JSON.stringify(decision.flags)}`
      );
      line(`            cumulativeDays=${JSON.stringify(decision.cumulativeDays)}`);
      for (const m of decision.measurements) {
        line(`            basis ${m.key}: ${m.state} measured=${n(m.measured)}/${n(m.limit)} headroom=${n(m.headroom)} window=${n(m.window)}`);
      }
    }
    line("");
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ now: NOW, host: ARITHMETIC_ONLY ? null : STANDIN, cast, rows }, null, 2));
    line(`wrote ${JSON_OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
