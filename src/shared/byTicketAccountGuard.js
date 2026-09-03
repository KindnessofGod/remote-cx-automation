// ---------------------------------------------------------------------------
// byTicketAccountGuard.js — one guard for all nine `by-ticket/:ref` routes
// ---------------------------------------------------------------------------
// THE BUG THIS EXISTS FOR, observed 2026-08-30 rather than theorised.
//
// The ZAF sidebar asks every configured use-case API "who holds a case for
// ticket N?" and renders the FIRST that claims it, in a fixed order that puts
// UC-06 second and UC-02 fourth. A specialist opened `your-subdomainhelp` ticket
// #32 — Chris Lee's expense claim, filed minutes earlier — and the sidebar
// showed them Alexandre Tremblay's CONTRACT AMENDMENT: a UC-06 row written
// 2026-08-19, eleven days before that ticket existed, against the retired
// `your-subdomain` account, which had reached #143 while this one restarted at #1.
//
// Both records answered `found: true` for "ticket 32" and both were telling the
// truth about their own account. Nothing errored. The sidebar even said "also
// matched in the UC-02 expenses API" — it detected the collision and picked the
// wrong winner, because a bare integer carries no account.
//
// CLAUDE.md §7's honest-gaps item 23 predicted exactly this and named the
// growth property that makes it urgent: the overlap window is the new account's
// ticket count, so it widens with every ticket filed. `zendeskAccounts.js` was
// built as the answer and was wired into the approval queue only — one consumer
// of three. This is the second.
//
// WHY IT LIVES BESIDE THE ROUTE AND NOT IN THE SIDEBAR. The sidebar is one
// caller. Fixing it there leaves the API still handing a pre-migration record
// to the audit viewer, to `curl`, and to whatever reads it next — and the nine
// routes are the last place the row's own timestamp is still in scope.
// ---------------------------------------------------------------------------

import { config } from "./config.js";
import { foreignTicketAccountRefusal } from "./zendeskAccounts.js";

/**
 * The refusal body for a by-ticket hit that belongs to a retired account, or
 * null when the row may be served.
 *
 * Reads the row's OWN `createdAt` — never a value derived from the request —
 * because the whole point is that the request cannot distinguish the two
 * tickets. `created_at` is accepted alongside it so a raw database row works
 * as well as a store view.
 *
 * `currentSubdomain` is injectable so a test can state the account instead of
 * inheriting whatever `.env` the developer happens to have, which is the same
 * reason every other seam in this repo is injectable.
 *
 * @param {{createdAt?: string|Date, created_at?: string|Date}|null|undefined} row
 * @param {string|number} reference  the ref that was asked for
 * @param {{currentSubdomain?: string|null}} [opts]
 */
export function byTicketAccountRefusal(row, reference, opts = {}) {
  if (!row) return null;
  const currentSubdomain =
    opts.currentSubdomain !== undefined ? opts.currentSubdomain : currentZendeskSubdomain();
  const writtenAt = row.createdAt ?? row.created_at ?? null;
  return foreignTicketAccountRefusal(writtenAt, currentSubdomain, reference);
}

/**
 * The account this process talks to — or null under test.
 *
 * HERMETIC UNDER TEST, WHATEVER THE ENVIRONMENT HOLDS. `src/shared/config.js`
 * does `import "dotenv/config"`, so a test process inherits whatever real
 * `.env` the developer happens to have. That made this guard's behaviour a
 * function of the machine it ran on: two `deployRouter` tests, which are about
 * pooled state and have nothing to do with Zendesk accounts, went red here
 * because their fixture is dated 2026-08-01 and this container's `.env` names
 * `your-subdomainhelp` — and they would have stayed green on a laptop with no
 * subdomain set. A guard whose verdict depends on the ambient environment is
 * not a guard, it is a coin toss with a good comment.
 *
 * So under test the answer is `null` — the same "no configured account, serve
 * the row" branch a fresh clone takes — unless a caller states the account
 * explicitly. This is the floor `src/portal/wiring.js` puts under the LLM
 * seams for the same reason, and injection is still the rule above it: every
 * assertion about what this guard REFUSES passes `currentSubdomain` in.
 *
 * The cost is stated rather than hidden: no test drives the refusal through a
 * live HTTP route. What covers the routes instead is structural — the wiring
 * test in test/byTicketAccountGuard.test.js reads all nine sources and asserts
 * each calls the guard, and does so before it serves a record.
 */
export function currentZendeskSubdomain() {
  if (process.env.NODE_TEST_CONTEXT) return null;
  return (config.zendesk && config.zendesk.subdomain) || null;
}
