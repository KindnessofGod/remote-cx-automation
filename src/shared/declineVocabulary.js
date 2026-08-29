// ---------------------------------------------------------------------------
// declineVocabulary.js  —  `deny` was never Remote's word. `decline` is.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `deny` occurs **zero** times in Remote's entire documented corpus;
// `decline`/`declined` occurs 648 times (docs/REMOTE-VOCABULARY.md §2.1,
// measured against the `.md` twins named by Remote's own llms.txt). Remote's
// expense status enum has `declined`, its request type is `DeclineExpenseParams`,
// its time-off endpoint is `POST /v1/timeoff/{id}/decline`, its work-authorization
// and travel-letter enums both carry `declined_by_manager` / `declined_by_remote`,
// and four of its webhooks are named `*.declined*`. `deny` is ours alone, and it
// was ours by accident rather than by decision — UC-02 already said `decline`,
// because that is the word Remote's own API forced on it.
//
// So the negative review verb across UC-04, UC-05, UC-06 and UC-01's ZAF review
// moved to `decline`, 2026-08-19. See docs/BUILD-LOG.md §3.61.
//
// WHY A SHARED MODULE AND NOT FOUR COPIES
// src/uc02/reviewPolicy.js kept its `release`->`approve` alias maps local, and
// that was right for one use case. This rename lands in four, plus the shared
// case store, and a verb spelling is a property of the VOCABULARY, not of any
// one use case — two copies drift, which is the same reasoning that made UC-04
// import UC-03's restricted-jurisdiction set rather than copy it (CLAUDE.md
// §7.2). One map, imported.
//
// WHAT THIS MODULE IS NOT
// It is not a repo-wide rewrite rule. UC-09's `deny` is deliberately untouched
// here (its files are being changed on another branch this session), and UC-02
// keeps `decline` because it already had it. Nothing calls these functions
// implicitly — every call site is an explicit edge: a server entry point, or
// the one place a Postgres row becomes an in-memory row.
//
// BOTH MAPS ARE INPUT/READ ONLY. Nothing in this repository emits `deny` or
// writes `denied` any more, so both maps can be deleted the day no deployed
// caller sends the old verb and no stored row carries the old status — and
// deleting them cannot change any recorded outcome.
// ---------------------------------------------------------------------------

/**
 * Action spellings this system still ANSWERS TO but no longer produces.
 *
 * WHY AN ALIAS RATHER THAN A CLEAN BREAK. The rename is ours; the callers are
 * not all ours to redeploy at the same instant. The ZAF app is a bundle
 * uploaded into a live Zendesk account (installation `9990001`, "Remote CX
 * Review v1.01", enabled — CLAUDE.md §8), and `zaf-app/assets/main.js` builds
 * its URL as `…/:id/" + action`. Between deploying these APIs and re-uploading
 * that bundle, the installed sidebar keeps posting `/deny`. Without the alias
 * every decline in that window fails `unknown_action` — a rename taking a live
 * approval surface offline mid-session, which is precisely the class of
 * self-inflicted dead gate this repository keeps paying for.
 */
export const ACTION_ALIASES = Object.freeze({ deny: "decline" });

/**
 * Stored `status` values this system still READS but no longer writes.
 *
 * `uc04_authorizations`, `uc05_resignations`, `uc06_amendments` and `cases`
 * each have a `status` column that took `denied`. Renaming the verb without
 * this map would render any such row as an unrecognised status — a request
 * that WAS decided reported as unknown, which is worse than the inconsistent
 * word was. It is a READ-SIDE map applied where a Postgres row becomes an
 * in-memory row, so it works whether or not the (optional, idempotent) data
 * migration in docs/SETUP-CHECKLIST.md is ever run: backward compatibility
 * that depends on a human executing SQL is not backward compatibility.
 */
export const STATUS_ALIASES = Object.freeze({ denied: "declined" });

/**
 * The canonical spelling of an action a caller supplied. Applied ONCE, at the
 * edge (each workflow's `submit*` entry point), so nothing downstream — the
 * audit action name, the stored status, the response `code` — ever has to know
 * the alias existed.
 *
 * @param {unknown} action
 * @returns {unknown} the canonical verb, or **the input unchanged** when it is
 *   not an alias — so an unrecognised verb still fails its own `ACTIONS` check
 *   rather than being quietly rewritten into a valid one. That is the property
 *   worth pinning: a normaliser that "helpfully" resolves garbage is a gate
 *   that has stopped gating.
 */
export function normalizeDecisionAction(action) {
  if (typeof action !== "string") return action;
  return Object.prototype.hasOwnProperty.call(ACTION_ALIASES, action) ? ACTION_ALIASES[action] : action;
}

/**
 * The canonical spelling of a stored status. Same rule one column over: a row
 * written before the rename reads back as what it always meant, and anything
 * unrecognised is returned untouched so it still falls through to whatever
 * "this status is not one we know" branch the caller already has.
 *
 * @param {unknown} status
 */
export function canonicalDecisionStatus(status) {
  if (typeof status !== "string") return status;
  return Object.prototype.hasOwnProperty.call(STATUS_ALIASES, status) ? STATUS_ALIASES[status] : status;
}
