// ---------------------------------------------------------------------------
// runner.js  —  THE FACT LOOP. This is rule 1, in code.
// ---------------------------------------------------------------------------
// for (fact of facts) for (surface of surfaces) for (scenario of scenarios)
//
// Deliberately a flat, un-cached triple loop rather than anything cleverer:
// the entire reason this runner exists is that a human executed this loop by
// hand and stopped after one iteration (E4-F14). The loop itself is the
// artifact worth pinning with a test — see test/surfaceVerifyRunner.test.js,
// which asserts it iterates EVERY registered surface for EVERY fact, using
// fakes, so the property survives even if a future surface or fact is added
// and someone reaches for a hand-picked subset "just for this one".
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array<{reason:string,label:string,decision:object}>} opts.scenarios
 * @param {Record<string,{id:string,contract:string,audience:string,textFor:Function}>} opts.surfaces
 * @param {Array<{id:string,appliesToScenario:Function,evaluate:Function}>} opts.facts
 * @param {(scenario:object)=>Promise<object|null>} opts.resolveSubject
 * @returns {Promise<{rows: object[], grid: object[]}>}
 */
export async function runFactLoop({ scenarios, surfaces, facts, resolveSubject }) {
  const surfaceList = Object.values(surfaces);
  const rows = [];

  // CACHED BY (surface, scenario), NOT by (fact, surface, scenario). Several
  // facts can legitimately apply to the same scenario on the same surface —
  // without this, a browser-driven surface (zafSidebarBody) would be re-read
  // once per APPLICABLE FACT rather than once per scenario, multiplying real
  // network/browser calls for no reason: the text a surface renders for a
  // given scenario does not depend on which fact is asking. The fact loop's
  // STRUCTURE (every fact reaches every surface) is unchanged — this cache
  // only avoids re-doing the same read twice, it never skips a combination.
  const readCache = new Map();
  const subjectCache = new Map();

  async function cachedTextFor(surface, scenario) {
    const key = `${surface.id}::${scenario.decision.id}`;
    if (readCache.has(key)) return readCache.get(key);
    const promise = (async () => {
      try {
        return { text: await surface.textFor(scenario), error: null };
      } catch (err) {
        return { text: null, error: err };
      }
    })();
    readCache.set(key, promise);
    return promise;
  }

  async function cachedSubjectFor(scenario) {
    const key = scenario.decision.id;
    if (subjectCache.has(key)) return subjectCache.get(key);
    const promise = resolveSubject(scenario).catch(() => null);
    subjectCache.set(key, promise);
    return promise;
  }

  for (const fact of facts) {
    for (const surface of surfaceList) {
      for (const scenario of scenarios) {
        if (!fact.appliesToScenario(scenario)) {
          rows.push({
            fact: fact.id,
            surface: surface.id,
            scenario: scenario.reason,
            verdict: "na",
            detail: "fact does not apply to this scenario's reason",
          });
          continue;
        }

        const { text, error: readError } = await cachedTextFor(surface, scenario);

        if (readError) {
          rows.push({
            fact: fact.id,
            surface: surface.id,
            scenario: scenario.reason,
            verdict: "unreadable",
            detail: readError.message,
            error: readError,
          });
          continue;
        }

        const subject = await cachedSubjectFor(scenario);
        const result = fact.evaluate(surface.id, text, scenario, subject);
        rows.push({ fact: fact.id, surface: surface.id, scenario: scenario.reason, ...result });
      }
    }
  }

  return { rows };
}

/**
 * Render the rows as a grid (fact rows x "surface/scenario" columns) for
 * terminal output.
 */
export function formatGrid(rows) {
  const facts = [...new Set(rows.map((r) => r.fact))];
  const columns = [...new Set(rows.map((r) => `${r.surface}·${r.scenario}`))];
  const lookup = new Map(rows.map((r) => [`${r.fact}\0${r.surface}·${r.scenario}`, r]));

  const symbol = (v) => (v === "pass" ? "PASS" : v === "fail" ? "FAIL" : v === "stale" ? "STAL" : v === "unreadable" ? "????" : " na ");

  const lines = [];
  const colWidth = Math.max(...columns.map((c) => c.length), 6);
  lines.push(`${"fact".padEnd(36)} | ${columns.map((c) => c.padEnd(colWidth)).join(" | ")}`);
  for (const f of facts) {
    const cells = columns.map((c) => {
      const r = lookup.get(`${f}\0${c}`);
      return (r ? symbol(r.verdict) : " na ").padEnd(colWidth);
    });
    lines.push(`${f.padEnd(36)} | ${cells.join(" | ")}`);
  }
  return lines.join("\n");
}

/** Overall run verdict, per rule 4: 0 clean / 1 real defect / 2 could not tell. */
export function overallExitCode(rows) {
  if (rows.some((r) => r.verdict === "unreadable" || r.verdict === "stale")) return 2;
  if (rows.some((r) => r.verdict === "fail")) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// GAP 2 (rca-h7v) — "a fact with no scenario is indistinguishable from a
// passing one." blockedBranchHasGroup was `na` in every one of its sixteen
// cells and nobody noticed, because a fact that can never fire and a fact
// that is quietly passing render identically in the grid. This is the
// dead-gate shape (C-16) one level up, inside the tool built to detect it.
//
// A fact "reaches" a scenario only when it produces a DETERMINATE verdict
// (pass/fail) for it — "na" means the fact declined to have an opinion
// (appliesToScenario said no, or the fact itself judged the surface N/A), and
// "unreadable" means the SURFACE refused to say, not the fact answering.
// Neither rescues a fact from having never actually been exercised.
// ---------------------------------------------------------------------------

/**
 * @param {object[]} rows  the rows produced by runFactLoop
 * @param {Array<{id:string, required?:boolean}>} facts
 * @returns {{
 *   zeroScenarioFacts: string[],
 *   oneScenarioFacts: string[],
 *   coverageFailRows: object[],
 * }}
 */
export function analyzeFactCoverage(rows, facts) {
  const scenariosByFact = new Map();
  for (const r of rows) {
    if (r.verdict !== "pass" && r.verdict !== "fail") continue; // na / unreadable are not exercise
    if (!scenariosByFact.has(r.fact)) scenariosByFact.set(r.fact, new Set());
    scenariosByFact.get(r.fact).add(r.scenario);
  }

  const exercisedCount = (factId) => scenariosByFact.get(factId)?.size ?? 0;

  const zeroScenarioFacts = facts.filter((f) => exercisedCount(f.id) === 0).map((f) => f.id);
  const oneScenarioFacts = facts.filter((f) => exercisedCount(f.id) === 1).map((f) => f.id);

  // An unexercised REQUIRED check is not a neutral outcome — it FAILS the
  // run, exactly as a missing required scenario does in scenarios.js.
  const coverageFailRows = facts
    .filter((f) => f.required && exercisedCount(f.id) === 0)
    .map((f) => ({
      fact: f.id,
      surface: "n/a",
      scenario: "n/a",
      verdict: "fail",
      detail:
        `REQUIRED fact "${f.id}" was exercised on zero scenarios — it never produced a pass/fail verdict anywhere. ` +
        "An unexercised required check is not a neutral outcome (GAP 2, rca-h7v); it is reported as a FAIL, not 'na'.",
    }));

  return { zeroScenarioFacts, oneScenarioFacts, coverageFailRows };
}
