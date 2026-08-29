// ---------------------------------------------------------------------------
// staleness.js  —  GAP 1 (rca-h7v): "a stale scenario reports as a live
// defect"
// ---------------------------------------------------------------------------
// `discoverScenarios()` (scenarios.js) selects the NEWEST AVAILABLE real
// decision for each required reason. A Zendesk comment is written once, at
// decision time, and never changes — so if the newest available example was
// decided BEFORE a fix to the surface it exercises was deployed, the runner
// would otherwise report that fix as still broken. E5-F19 is the case that
// found this: the fix landed at 13:20:58Z; the two tickets judged were
// decided at 12:49:23Z and 07:37:34Z, both before the fix existed anywhere.
//
// THE FIX IS NOT "create a fresh ticket and wait for the graph" — that turns
// a three-minute check into a minutes-long one with a live write on every
// commit, and a check that stops being cheap stops being run. STALE is the
// correct verdict; producing a fresh decision is the EVALUATOR'S job.
//
// Conservative first version, exactly as rca-h7v allows: one global "deploy
// time" (the current commit's own timestamp) rather than per-surface
// provenance. This can over-report STALE (any commit at all moves the
// threshold forward, whether or not it touched the surface in question) —
// that is an accepted, named trade-off, to be refined to per-surface
// provenance later if the false-stale rate turns out to be high.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The commit timestamp of `ref`, as a `Date` — the "deploy time" this module
 * compares scenario evidence against. Injectable so tests never shell out to
 * real git.
 *
 * @param {object} [opts]
 * @param {string} [opts.ref] a git ref, default "HEAD"
 * @param {(cmd:string, args:string[], options:object) => string} [opts.execImpl]
 * @param {string} [opts.cwd]
 * @returns {Date}
 * @throws if git produces no output for the ref — never invents a date.
 */
export function getCommitTimestamp({ ref = "HEAD", execImpl = execFileSync, cwd = REPO_ROOT } = {}) {
  const raw = execImpl("git", ["log", "-1", "--format=%cI", ref], { cwd, encoding: "utf8" });
  const out = String(raw).trim();
  if (!out) {
    throw new Error(`git log produced no output for ref "${ref}" — cannot establish a deploy time to compare staleness against`);
  }
  return new Date(out);
}

/**
 * Is `decidedAt` (an ISO timestamp string, as stored on a decision row)
 * older than `deployTime`? An unparsable timestamp is never treated as stale
 * — inventing staleness from a bad date would be exactly the "fail closed on
 * a guess" failure this repo's exit-2 doctrine exists to prevent; an
 * unreadable decision timestamp is a separate problem from a stale one.
 *
 * @param {string} decidedAt
 * @param {Date} deployTime
 * @returns {boolean}
 */
export function isScenarioStale(decidedAt, deployTime) {
  const at = new Date(decidedAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() < deployTime.getTime();
}

/**
 * Downgrade a "fail" row to "stale" when the scenario it was judged against
 * is stale relative to `deployTime`. Only "fail" rows are touched — "pass"
 * and "na" carry no claim that a defect exists, so there is nothing to
 * un-claim, and "unreadable" is already the correct "could not tell" verdict
 * for a different reason.
 *
 * @param {object[]} rows
 * @param {Array<{reason:string, decision:{at:string}}>} scenarios
 * @param {Date} deployTime
 * @returns {object[]} a new array; input rows are not mutated
 */
export function markStaleFailures(rows, scenarios, deployTime) {
  const decidedAtByReason = new Map(scenarios.map((s) => [s.reason, s.decision.at]));

  return rows.map((r) => {
    if (r.verdict !== "fail") return r;
    const decidedAt = decidedAtByReason.get(r.scenario);
    if (decidedAt === undefined) return r;
    if (!isScenarioStale(decidedAt, deployTime)) return r;
    return {
      ...r,
      verdict: "stale",
      detail:
        `${r.detail} — STALE (GAP 1, rca-h7v): the newest available example of scenario "${r.scenario}" ` +
        `was decided ${decidedAt}, before the deploy at ${deployTime.toISOString()} that could have changed ` +
        "this surface. This cannot be read as a live defect — it can only be read as unknown until a fresh " +
        "decision of this reason exists.",
    };
  });
}
