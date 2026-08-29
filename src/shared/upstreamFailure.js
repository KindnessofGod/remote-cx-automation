// ---------------------------------------------------------------------------
// upstreamFailure.js  —  "the read failed" is not "the policy refused"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Four n8n graphs carry `onError: continueRegularOutput` on their Remote HTTP
// nodes. That setting does NOT stop the run and does NOT mark the node red: the
// node reports `executionStatus: "success"` and emits an ERROR OBJECT in place
// of the data, which then flows downstream as if it were a record. The gates
// read `…json.data.employment`, get `undefined`, and escalate — recording
// `identity_not_verified` for what was actually a 404 or a 403 from Remote.
//
// Live proof, 2026-08-17 (executions 4218 / 4232 / 4238): UC-02 swallowed a 404
// on the employment read, a 404 on the expense read AND a 403 on the categories
// read, then wrote an `audit_log` row saying `identity_not_verified` — while the
// webhook had supplied a perfectly good `session.authenticatedEmploymentId`
// that would have PASSED the identity gate on a good fetch. Reading that row,
// a human triages an identity problem that does not exist, and the actual cause
// (a dead Sandbox employment id and a scope-less token) is recorded nowhere.
//
// THE DISTINCTION THIS MODULE RESTORES — three different things, three
// different fixes, and until now one indistinguishable audit row:
//
//   1. "Remote says this record does not exist"   -> 404. An authoritative
//      answer about the data. Fix the id / the request.       kind: not_found
//   2. "Remote could not be reached / refused us" -> 403, 5xx, a transport
//      error, anything that is not a 404. An outage or a credential problem;
//      NOTHING about this request is knowable.                kind: unreachable
//   3. "the policy refused"                       -> no upstream failure at
//      all. The gates saw real data and said no. Unchanged by this module.
//
// FAIL-CLOSED BY CONSTRUCTION. Every verdict this module produces is an
// `escalate`. It is only ever consulted at a gate that was ALREADY going to
// refuse (or ahead of every gate, for the employment read every gate depends
// on), so it can only ever change the RECORDED REASON of a refusal — never turn
// a refusal into an approval. `test/upstreamFailure.test.js` pins that
// property directly against all three use cases' real policy engines.
//
// WHERE THIS RUNS. Both execution paths, deliberately:
//   - n8n: the gates Code nodes port `describeUpstreamError()` and
//     `upstreamVerdict()` verbatim (a Code node cannot import), which is why
//     they are written as dependency-free pure functions with no `import` and
//     no optional-chaining-on-call syntax. The parity tests execute the ported
//     copies against these.
//   - Node: src/ucNN/workflow.js builds the same failure list from what its
//     REST client can observe. That client returns null on 404 and THROWS on
//     anything else, so the Node path only ever reports `not_found` — a genuine
//     difference in the two paths' error surfaces, not a divergence in policy.
// ---------------------------------------------------------------------------

/** Recorded when an upstream answered authoritatively that the record is gone. */
export const UPSTREAM_NOT_FOUND = "not_found";
/** Recorded when the upstream could not be reached or refused the call. */
export const UPSTREAM_UNREACHABLE = "unreachable";

/**
 * The exception reason for a 404. Distinct from `identity_not_verified` and
 * from every policy reason ON PURPOSE: `src/metrics/compute.js`'s
 * `rankExceptionReasons()` counts by this exact string, so an upstream failure
 * rises in the dashboard as its own row — "the top exception reason is the next
 * thing to engineer" only works if the reason names the thing to engineer.
 */
export const REASON_UPSTREAM_NOT_FOUND = "upstream_record_not_found";
/** The exception reason for a 403 / 5xx / transport failure. Ranks separately. */
export const REASON_UPSTREAM_UNAVAILABLE = "upstream_unavailable";

/**
 * Recognise the item n8n's `continueRegularOutput` emits in place of data.
 *
 * The real shape, read off live execution 4218 rather than guessed:
 *   { json: { error: { message, name, stack, code, status } } }
 * `status` carries the HTTP status (404 / 403); `message` is the axios-style
 * `'404 - "{\"message\":\"Employment not found\"}"'`. The item's `json` has
 * EXACTLY one key, `error` — which is the check used here, because a genuine
 * Remote response is an envelope with `data` on it. A real payload that happens
 * to carry its own `error` field alongside `data` is therefore not mistaken for
 * a failed fetch.
 *
 * @param {unknown} raw   the upstream node's `…first().json`, or a plain value
 * @param {string} call   stable, snake_case name of the read: "employment",
 *   "expense", "expense_categories", "country_schema", "payroll_runs". It ends
 *   up in a flag and in the audit details, so it must not be a display string.
 * @returns {{call:string, status:number|null, kind:string, message:string}|null}
 *   null when this is ordinary data.
 */
export function describeUpstreamError(raw, call) {
  if (!raw || typeof raw !== "object") return null;
  if (!("error" in raw)) return null;
  // An envelope carrying real data is not a failed fetch, whatever else is on
  // it. n8n's error item has `error` and nothing else.
  if ("data" in raw) return null;

  const err = raw.error;
  if (typeof err === "string") {
    return { call, status: null, kind: UPSTREAM_UNREACHABLE, message: err.slice(0, 200) };
  }
  if (!err || typeof err !== "object") return null;

  // n8n uses `status`; some node types report `httpCode` as a string.
  const numeric = Number(err.status ?? err.httpCode ?? err.statusCode);
  const status = Number.isInteger(numeric) ? numeric : null;

  const message =
    typeof err.message === "string"
      ? err.message.slice(0, 200)
      : String(err.name ?? "upstream call failed");

  return {
    call,
    // Only a 404 is an answer ABOUT THE RECORD. Everything else — 403, 5xx, a
    // socket error, an unknown status — means the request was never truly
    // evaluated, and must never be read as "the record is not there".
    kind: status === 404 ? UPSTREAM_NOT_FOUND : UPSTREAM_UNREACHABLE,
    status,
    message,
  };
}

/**
 * Is this reason one this module produced? Used where a LATER guard would
 * otherwise overwrite an earlier upstream verdict — "ordered gates, first
 * failure wins" has to keep holding once gate 0 exists.
 * @param {unknown} reason
 */
export function isUpstreamReason(reason) {
  return reason === REASON_UPSTREAM_NOT_FOUND || reason === REASON_UPSTREAM_UNAVAILABLE;
}

/**
 * The failure recorded for one named read, or null.
 * @param {Array<{call:string}>|null|undefined} failures
 * @param {string} call
 */
export function findUpstreamFailure(failures, call) {
  if (!Array.isArray(failures)) return null;
  for (const failure of failures) {
    if (failure && failure.call === call) return failure;
  }
  return null;
}

/**
 * Turn one failure into the reason/flags a gate should record instead of its
 * own refusal reason. Always an escalation; never anything else.
 *
 * The flag pairs the call with the status (`upstream_employment_404`,
 * `upstream_expense_categories_403`) so a human reading `audit_log.details`
 * knows WHICH call failed and WHAT it answered without opening n8n.
 *
 * @param {{call:string, status:number|null, kind:string}|null} failure
 * @returns {{decision:"escalate", reason:string, flags:string[]}|null}
 */
export function upstreamVerdict(failure) {
  if (!failure) return null;
  const reason =
    failure.kind === UPSTREAM_NOT_FOUND ? REASON_UPSTREAM_NOT_FOUND : REASON_UPSTREAM_UNAVAILABLE;
  return {
    decision: "escalate",
    reason,
    flags: [reason, `upstream_${failure.call}_${failure.status === null ? "error" : failure.status}`],
  };
}
