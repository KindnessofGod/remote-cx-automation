// ---------------------------------------------------------------------------
// cutoffEngine.js  —  Deterministic payroll cutoff evaluation
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-06's entire risk lives in one question: can this amendment still make
// the payroll cycle it's supposed to apply to? This is pure, deterministic
// arithmetic over dates — no LLM anywhere near it, per docs/use-cases/UC-06.md
// §6 ("Must NOT... skip cutoff/schema/money checks").
//
// `now` is always an explicit argument, never `new Date()` read internally —
// same reasoning as every other pure function in this repo (policyEngine.js,
// metrics/compute.js): a function that reads the system clock itself can't be
// tested deterministically. Callers pass real `Date.now()` in production and
// a fixed timestamp in tests.
//
// The three outcomes this returns map directly onto docs/use-cases/UC-06.md
// §12's three cutoff scenarios:
//   1. well before cutoff       -> ordinary dual-approval flow
//   2. cutoff already passed    -> the requested cycle can no longer take it;
//                                   policyEngine.js treats this as an escalate,
//                                   not a silent roll-to-next-cycle (see that
//                                   file's header for why)
//   3. within 48h of cutoff     -> still time, but urgent: flagged so the
//                                   workflow fires the extra Slack/Zendesk
//                                   urgent-escalation action alongside the
//                                   normal dual-approval routing
// ---------------------------------------------------------------------------

const URGENT_WINDOW_HOURS = 48;

/**
 * Parse a payroll timestamp as UTC, explicitly (finding F-26a).
 *
 * `new Date("2026-09-05 17:00:00")` and `new Date("2026-09-05T17:00:00")` are
 * both parsed in the SERVER'S LOCAL ZONE — the first because it isn't ISO at
 * all so V8 falls back to its legacy local-time parser, the second because
 * ECMA-262 says a date-TIME with no offset is local. Only the date-ONLY form
 * ("2026-09-05") is specified as UTC. So a cutoff of "2026-09-05 17:00:00"
 * meant 08:00Z in Tokyo and 00:00Z the next day in Los Angeles, and the same
 * amendment flipped between `cutoff_lock_passed` and approvable depending on
 * which machine evaluated it. A payroll cutoff is a fact about the payroll
 * calendar, not about where the worker process happens to run.
 *
 * A zone-less value is therefore pinned to UTC here; a value that DOES carry
 * a zone ("...Z", "+02:00") is left exactly as written, because that one is
 * unambiguous and reinterpreting it would be its own bug.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number} epoch ms, or NaN when there is nothing parseable
 */
export function parseUtcInstant(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;

  const text = value.trim();
  if (!text) return NaN;

  // "YYYY-MM-DD[ T]HH:MM[:SS[.sss]]" with NO trailing zone designator.
  const zoneless = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(text);
  if (zoneless) return Date.parse(`${zoneless[1]}T${zoneless[2]}Z`);

  return Date.parse(text);
}

// ---------------------------------------------------------------------------
// THE OVERLAPPING-CYCLE AMBIGUITY, which country filtering does NOT fix
// ---------------------------------------------------------------------------
// Live, the Netherlands carries TWO cycles covering the same June period with
// DIFFERENT cutoffs — a `main` run locking 2026-06-20 and a `one_off` run
// locking 2026-06-10 [CONFIRMED, GET /v1/payroll-runs]. Country filtering
// cannot separate them: both are NL. `evaluateCutoff()`'s `.find()` therefore
// returns whichever the API happened to list first, and ten days of difference
// in a payroll lock is the difference between an amendment landing and not
// landing.
//
// Choosing between them needs a rule over `status`/`type` ("prefer the main
// run", "ignore completed runs") that Remote's reference does not confirm —
// nothing there says a one_off run is not the governing cycle for a mid-period
// change. Inventing that rule would be the same title-mistaken-for-a-path move
// that produced the dead payroll gate in the first place. So the ambiguity is
// REPORTED, not resolved: policyEngine.js escalates with both candidates
// recorded and no cycle chosen.
//
// Cycles that AGREE on the cutoff are not ambiguous in any consequential sense.
// `.find()` still picks one arbitrarily, but every candidate answers the only
// question this gate asks ("is the lock already passed?") identically, so a
// human adds nothing.
//
// This pair mirrors workflows/nodes-uc06/amendmentGates.js exactly;
// test/n8nUc06Parity.test.js is what holds the two copies together.
// ---------------------------------------------------------------------------

/**
 * Every cycle whose period covers the requested effective date — the same
 * predicate `evaluateCutoff()` uses to pick one, kept as a separate function
 * because "how many cover it" is a different question from "which one".
 * @param {object[]} cycles
 * @param {string|number|Date} requestedEffectiveDate
 * @returns {object[]}
 */
export function cyclesCovering(cycles, requestedEffectiveDate) {
  const effective = parseUtcInstant(requestedEffectiveDate);
  return (cycles ?? []).filter(
    (c) => effective >= parseUtcInstant(c.period_start) && effective <= parseUtcInstant(c.period_end)
  );
}

/**
 * How many DISTINCT locks a set of cycles claims. An unreadable cutoff is its
 * own bucket, so "one readable, one unreadable" counts as a disagreement — one
 * of them says escalate and the other does not, which is precisely a decision a
 * coin-flip must not make.
 * @param {object[]} cycles
 * @returns {number}
 */
export function distinctCutoffCount(cycles) {
  const seen = new Set();
  for (const cycle of cycles ?? []) {
    const ms = parseUtcInstant(cycle.cutoff_date);
    seen.add(Number.isNaN(ms) ? "unreadable" : String(ms));
  }
  return seen.size;
}

/**
 * @param {object} args
 * @param {string} args.requestedEffectiveDate  "YYYY-MM-DD" — when the change should take effect
 * @param {string|number|Date} args.now          submission time
 * @param {object[]} args.payrollCycles          from RemoteClient.listPayrollRuns(), e.g.
 *   [{id, period_start, period_end, cutoff_date, process_date, pay_date}]
 * @returns {{
 *   cycle: object|null,
 *   noMatchingCycle: boolean,
 *   cutoffUnknown: boolean,
 *   cutoffAlreadyPassed: boolean,
 *   urgentWithin48h: boolean,
 *   retroactive: boolean,
 *   hoursUntilCutoff: number|null
 * }}
 */
export function evaluateCutoff({ requestedEffectiveDate, now, payrollCycles }) {
  const effective = parseUtcInstant(requestedEffectiveDate);
  const nowMs = parseUtcInstant(now);

  const cycle = (payrollCycles ?? []).find(
    (c) => effective >= parseUtcInstant(c.period_start) && effective <= parseUtcInstant(c.period_end)
  );

  if (!cycle) {
    return {
      cycle: null,
      noMatchingCycle: true,
      cutoffUnknown: false,
      cutoffAlreadyPassed: false,
      urgentWithin48h: false,
      retroactive: false,
      hoursUntilCutoff: null,
    };
  }

  const cutoffMs = parseUtcInstant(cycle.cutoff_date);

  // AN UNREADABLE CUTOFF FAILS CLOSED (finding F-26b). This used to produce
  // NaN, and every comparison against NaN is false — so `cutoffAlreadyPassed`
  // and `urgentWithin48h` BOTH read false and the amendment sailed through as
  // "comfortably before the cutoff". That is a positive claim ("this change
  // will make the payroll run") derived from having no information at all.
  // The cycle exists, we simply cannot say where its lock is, so a human has
  // to; policyEngine.js escalates on this flag.
  if (Number.isNaN(cutoffMs) || Number.isNaN(nowMs)) {
    return {
      cycle,
      noMatchingCycle: false,
      cutoffUnknown: true,
      cutoffAlreadyPassed: false,
      urgentWithin48h: false,
      retroactive: false,
      hoursUntilCutoff: null,
    };
  }

  const hoursUntilCutoff = (cutoffMs - nowMs) / (1000 * 60 * 60);
  const cutoffAlreadyPassed = hoursUntilCutoff < 0;
  const urgentWithin48h = !cutoffAlreadyPassed && hoursUntilCutoff <= URGENT_WINDOW_HOURS;

  return {
    cycle,
    noMatchingCycle: false,
    cutoffUnknown: false,
    cutoffAlreadyPassed,
    urgentWithin48h,
    // The research doc's algorithm (Part 12) calls this case "retroactive" —
    // kept as informational/audit context even though policyEngine.js routes
    // it to escalate rather than silently drafting a retroactive payload.
    retroactive: cutoffAlreadyPassed,
    hoursUntilCutoff,
  };
}
