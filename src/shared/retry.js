// ---------------------------------------------------------------------------
// retry.js  —  generic retry-then-escalate wrapper (00-FOUNDATION.md §4 invariant 10)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A single-attempt try/catch treats one transient blip (a dropped connection,
// a momentary 500) the same as a genuine, permanent failure — both fall back
// immediately. withRetry() gives a transient failure up to `retries` attempts
// with backoff between them before the caller's existing fallback takes over.
// It never REPLACES that fallback — it only decides how many attempts happen
// before the caller's own catch block sees a final error.
//
// `onAttempt` is the seam that makes every attempt traceable (invariant 7):
// callers pass a closure that calls AuditLogger.logTraceStep() per attempt,
// so a call that fails once and succeeds on retry produces two trace entries,
// never a single hidden success. This module knows nothing about audit
// logging itself — that separation keeps it a small, generic utility.
//
// `shouldRetry` (added when this was wired into the Remote/Zendesk REST
// clients, closing the BUILD-LOG roadmap item — the three LLM call sites
// already had this wrapper, issue #32) lets a caller mark some failures as
// NOT worth retrying — a 404 (nothing will change on attempt 2) or a 400
// (the request itself is wrong, retrying sends the same bad request again).
// Default is "retry everything," so every existing caller (the classifier,
// draftSummary, draftNarrative) is unaffected by this addition.
// ---------------------------------------------------------------------------

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 200;

/** Real backoff: waits longer on each successive attempt. Tests inject a fast/no-op one. */
async function defaultBackoff(attempt) {
  await new Promise((resolve) => setTimeout(resolve, DEFAULT_BACKOFF_MS * attempt));
}

/**
 * Retry an async function up to `retries` attempts before re-throwing its
 * last error, waiting `backoff(attempt)` between attempts (never after the
 * final one — there is no point delaying a throw nobody is waiting on).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.retries]  total attempts, not additional retries after the first. Default 3.
 * @param {(attempt:number) => Promise<void>} [opts.backoff]  injectable for hermetic, instant tests.
 * @param {(info:{attempt:number, ok:boolean, error?:string}) => void} [opts.onAttempt]  fired after every attempt, success or failure.
 * @param {(err: Error) => boolean} [opts.shouldRetry]  decides whether a given failure is worth another attempt. Default: always retry (matches pre-existing behavior for every caller that doesn't pass this).
 * @returns {Promise<T>}
 */
export async function withRetry(
  fn,
  { retries = DEFAULT_RETRIES, backoff = defaultBackoff, onAttempt = null, shouldRetry = () => true } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      onAttempt?.({ attempt, ok: true });
      return result;
    } catch (err) {
      lastError = err;
      onAttempt?.({ attempt, ok: false, error: err.message });
      if (!shouldRetry(err)) throw err; // e.g. a 404/400 — attempt 2 would only repeat the same wrong request
      if (attempt < retries) {
        await backoff(attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Is this HTTP status transient — worth another attempt — or does it mean
 * "this request is wrong," where retrying just repeats the same mistake?
 * Used by the Remote/Zendesk REST clients' retry wrapping:
 *   - 429 (rate limited) and 5xx (server-side failure) — transient, retry.
 *   - everything else (404 not found, 400 bad request, 401/403 auth, etc.)
 *     — NOT retried. A missing record stays missing; a malformed or
 *     unauthorized request stays malformed/unauthorized.
 * @param {number} status
 */
export function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}
