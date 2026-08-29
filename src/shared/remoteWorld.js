// ---------------------------------------------------------------------------
// remoteWorld.js — execute in the same world the decision was made in
// ---------------------------------------------------------------------------
// THE DEFECT THIS EXISTS TO CLOSE (found live 2026-08-19, by a human clicking
// Release in the ZAF sidebar):
//
//   Remote API PATCH /v1/expenses/exp_sandbox_over_cap_402~fresh-0425041sf1
//   failed: 404
//
// The request portal DECIDES in the mock world — deploy/cx-apis/deps.js hands
// buildPortalHandler() a RemoteClient whose transport dispatches straight into
// src/remote/mockServer.js, deliberately, so that a publicly reachable page can
// never write into a real Remote account. But the record it leaves behind is
// EXECUTED later, by one of the nine review APIs, against the real gateway —
// using a sub-record id (`exp_*`, `war_*`) that exists only in the mock. The
// real Sandbox's expenses are UUIDs, wholly disjoint from the mock's fixtures,
// so the bare id 404s exactly as the suffixed one does. No portal-originated
// claim could ever be released or declined.
//
// WHY IT WAS INVISIBLE. Every fail-closed test passed. A path that
// structurally cannot succeed is indistinguishable from one refusing
// correctly, and only a POSITIVE test — "this record MUST be releasable" —
// tells them apart (CLAUDE.md §4/§5; this is the third time today).
//
// An id-shape heuristic would have been worse than nothing: the portal's
// personas MIRROR real Sandbox employment ids, so `getEmployment()` often
// succeeds against the real gateway while the sub-records never do. The
// discriminator has to be the record's ORIGIN, which is a durable fact already
// persisted on every row (`source`, written by src/portal/server.js's
// PORTAL_SOURCE and its siblings) — not a guess about an id string.
//
// THIS FILE IS DELIBERATELY MECHANICAL. It knows nothing about "portal": the
// mapping from a source tag to a client lives in ONE place, the deployment's
// own wiring (deploy/cx-apis/deps.js), which is also the only place that knows
// what the mock world is and how to reach it. A workflow only ever asks "which
// client belongs to this record?"; it never restates the answer.
// ---------------------------------------------------------------------------

/**
 * The Remote client that belongs to a record's world.
 *
 * Backwards-compatible on purpose: a plain RemoteClient (or a test fake, or
 * unavailableRemote()) has no `forSource`, and is returned unchanged. That is
 * what lets the four approval paths adopt this without a breaking signature
 * change, and what keeps every existing caller and test working untouched.
 *
 * @param {object} remote  the dependency the workflow was given. When the
 *   deployment built a source-aware client it also exposes `forSource(source)`.
 * @param {string|null|undefined} source  the record's own `source` column.
 * @returns {object} the client to execute this record against.
 */
export function remoteFor(remote, source) {
  if (remote && typeof remote.forSource === "function") {
    // `|| remote` and not `??`: a resolver that answers with anything falsy
    // has failed to answer, and the safe answer is the client the caller
    // already holds — never `undefined`, which would turn a wrong-world write
    // into a TypeError three frames away from its cause.
    return remote.forSource(source) || remote;
  }
  return remote;
}
